# CPX-BIZ-02 业务流程与状态机（五生命周期模型）

- 版本：V2.0 · 状态：待确认
- 约束：受 `docs/product/product-baseline-v1.md` V1.0「修正 2」约束；只描述状态机与协作规则，不含表结构与迁移
- 取代：`docs/business/financing-process.md`（单状态机版，已作废，本文件不沿用其模型）
- 术语：全部取自基线第六节术语表，不自造同义词；「案件」「分析轮次」「数据版本」「报告版本」「资料项」「待核实事项」「就绪结论」按表内定义使用

## 〇、三条不可协商的结论
| # | 结论 | 展开 |
|---|---|---|
| 1 | 案件生命周期只回答「服务走到哪一段」，不承载产物效力、轮次进度、单份资料状态 | §3.1 |
| 2 | 列表页「进度」是投影，只读派生，绝不落库为可写字段 | §4 |
| 3 | 已签发报告不因数据更新而失效，只标记「数据已更新，建议复核」 | §5 |

## 一、为什么必须拆

### 1.1 一个真实时刻

某案件 2026-03 的真实状态：第 2 轮分析已定稿、报告 V2 已签发但客户尚未签收；同时企业补交了 3 个月银行流水，第 3 轮已自动开轮并停在资料核验。单一 `status` 只能取一个值：

| 若写成 | 系统里看起来 | 实际后果 |
|---|---|---|
| `APPROVED`（旧模型口径：已签发） | 案件即将完结 | 第 3 轮的资料核验没有合法来源状态，动作「无出处」；运营者看到「已签发」不再催资料 |
| `DOCUMENT_REVIEW`（旧模型口径：资料审核中） | 正在收资料 | 「报告待交付」从列表页消失，客户三天后才收到报告 |

两个事实都是真的。这不是「状态不够多」，而是一个字段被要求同时表达两个正交维度。

### 1.2 四类失败模式
| # | 失败模式 | 具体表现 | 后果 |
|---|---|---|---|
| F1 | 维度混叠 | 「待复核」（流程）与「报告已签发」（产物效力）可同时成立，却互斥于同一枚举 | 取值爆炸为笛卡尔积，每加一个维度就要重排枚举 |
| F2 | 回退覆盖历史 | 复核退回把 `APPROVED` 改成 `DOCUMENT_REVIEW`，第 2 轮已产出的评估被覆盖 | 无法解释「当时为什么这么判断」 |
| F3 | 语义漂移 | `APPROVED` 既当「复核通过」又当「已签发」；`DELIVERED` 既当报告已交付又当案件已结束 | 同名不同义，报表按字面理解必然出错 |
| F4 | 责任模块耦合 | 报告模块要改案件 `status` 才能表达自身状态 | 模块边界被状态字段击穿 |

### 1.3 拆分判据

三个条件同时成立才独立成状态机，用于拒绝「再拆一个」的随意扩张。

| 维度 | 生命周期 | 变化频率 | 事务边界 | 责任模块 | 存续跨度 |
|---|---|---|---|---|---|
| 服务阶段 | 案件生命周期 | 低（全程 6–8 次） | 案件聚合 | case | 全程 |
| 计算批次 | 分析轮次 | 中（每次数据变更 1 次） | 轮次聚合 | analysis / assessment | 一轮 |
| 产物效力 | 报告版本 | 低（每版 4–6 次） | 报告聚合 | review / report | 一版 |
| 单份资料 | 资料项 | 中 | 资料项聚合 | document | 一项 |
| 单条疑问 | 待核实事项 | 中 | 待核实事项聚合 | assessment | 一条（可跨轮） |

反例：`ReviewTask` **不**独立成状态机写入本文件。它的五个内部状态完全被 `ReportVersion` 的 `IN_REVIEW → APPROVED` 覆盖，独立描述只会制造两份真相。

## 二、总览：五个生命周期如何关联
```
                    FinancingCase (caseId)
                             │
   ┌────────────┬────────────┼─────────────┬──────────────────┐
CaseMaterial  AnalysisRound   Report     CaseStatusEvent
(1:N)         (1:N)           (1:N)      (审计时间线)
                  │   │
                  │   └── VerificationItem (1:N, itemId + rootItemId 跨轮)
                  ├── Document/Version ──▶ DataVersion(digest) ──变更即开新轮
                  └── roundNo ──▶ ReportVersion (1:N, versionNo)
```

| 键 | 作用域 | 谁携带 | 规则 |
|---|---|---|---|
| `caseId` | 全局 | 全部五个生命周期 | 唯一关联键；跨生命周期只通过它引用，不共享状态字段 |
| `roundNo` | 案件内递增，从 1 开始 | 分析轮次、待核实事项、报告版本 | 报告版本与轮次一对一（§5.3），故 `ReportVersion.roundNo` 非空且唯一 |
| `versionNo` | 报告内递增，从 1 开始 | 报告版本 | 与 `roundNo` **不必相等**：同一轮可因笔误修订出第二版 |
| `materialCode` | 案件内唯一 | 资料项 | `requirementLevel` 立案时快照，字典改版不回溯在途案件 |
| `rootItemId` | 案件内稳定 | 待核实事项 | 首次发现时分配，跨轮不变；一条疑问的完整历史 = 同一 `rootItemId` 的全部行 |
| `dataVersionId` | 案件内递增 | 分析轮次、证据引用 | 轮次绑定后不可更换（INV-06）；证据的 `dataVersionId` 必须等于所支撑轮次版本（INV-18） |

| 生命周期 | 聚合根 | 责任模块（Java 包） | 状态字段 |
|---|---|---|---|
| 案件生命周期 | `FinancingCase` | `case`（`authorization`/`document` 提供守卫输入） | `lifecycle` |
| 分析轮次 | `AnalysisRound` | `analysis`（计算 `finance`，评估 `assessment`） | `status` |
| 报告版本 | `Report` + `ReportVersion` | `report`（复核由 `review` 承载） | `status` |
| 资料项 | `CaseMaterial` | `document`（解析 `dataimport`） | `status` |
| 待核实事项 | `VerificationItem` | `assessment` | `status` |

**铁律**：一个生命周期只能写自己的状态字段。报告签发不得直接写案件 `lifecycle`，只能发事件由 `case` 决定是否推进；资料核验不得写轮次状态，只能经数据版本事件间接影响。

## 三、五个生命周期

### 3.1 案件生命周期 CaseLifecycle
| 状态码 | 中文 | 含义 | 责任模块 | 终态 |
|---|---|---|---|---|
| `INTAKE` | 受理 | 已建档，需求要素在补全，资料清单快照已生成但未索要 | case | 否 |
| `AUTHORIZATION` | 授权 | 等待客户签署授权书，或授权范围未覆盖所需数据范围 | authorization | 否 |
| `COLLECTING` | 资料收集 | 授权已覆盖，正在索要、接收、核验资料项 | document | 否 |
| `ANALYZING` | 分析 | 至少一轮分析在推进，尚未进入报告复核 | analysis | 否 |
| `REVIEW` | 复核 | 存在报告版本处于 `IN_REVIEW`/`APPROVED` | review | 否 |
| `DELIVERED` | 交付 | 报告已签发且交付记录完整 | report | 否 |
| `CLOSED` | 关闭 | 服务结束，案件只读，资料按保留策略处理，报告永久留存 | case | 是 |
| `ON_HOLD` | 挂起 | 可恢复暂停；**必须**记录 `holdFrom`（挂起前状态）与 `holdReason` | case | 否（可恢复） |
| `WITHDRAWN` | 客户撤回 | 客户主动终止，需撤回凭证 | case | 是 |
| `DECLINED` | 不予服务 | 我方决定不承接或终止；不代表任何银行拒贷，措辞不得暗示 | case | 是 |

**`ON_HOLD` 为什么是独立状态而不是布尔标记**：挂起要出现在列表、要统计停滞时长、要阻止一切推进。用布尔标记意味着每个守卫都要额外判一次，漏一处就是一次违规推进；存成状态后「非终态才允许推进」这一条守卫自动覆盖。

| # | From | To | 动作 | 守卫 | 操作人 |
|---|---|---|---|---|---|
| C01 | — | `INTAKE` | 创建案件 | 客户存在且 `ACTIVE`；资料清单快照生成成功 | ADMIN |
| C02 | `INTAKE` | `AUTHORIZATION` | 提交受理 | G-C1 需求要素齐备 | ADMIN |
| C03 | `AUTHORIZATION` | `COLLECTING` | 授权通过 | G-C2 授权有效且覆盖 | ADMIN |
| C04 | `COLLECTING` | `ANALYZING` | 进入分析 | G-C3 必填资料可分析 | ADMIN |
| C05 | `ANALYZING` | `REVIEW` | 提交复核 | G-C4 轮次定稿且报告可复核；须 P02 先置 `IN_REVIEW` | ADMIN |
| C06 | `REVIEW` | `ANALYZING` | 退回重算 | 复核意见要求重算，理由必填 | REVIEWER |
| C07 | `REVIEW` | `COLLECTING` | 退回补资料 | 存在新增未核验资料项，理由必填 | REVIEWER |
| C08 | `COLLECTING`/`ANALYZING`/`REVIEW` | `AUTHORIZATION` | 授权失效回退 | G-C7 授权不再成立 | SYSTEM |
| C09 | `REVIEW` | `DELIVERED` | 交付 | G-C5 报告已签发且交付记录完整 | ADMIN |
| C10 | `DELIVERED` | `CLOSED` | 关闭 | G-C6 无未终结报告版本 | ADMIN |
| C11 | 任意非终态 | `ON_HOLD` | 挂起 | `holdReason` 非空；记录 `holdFrom` | ADMIN |
| C12 | `ON_HOLD` | `holdFrom` | 恢复 | 挂起原因已消解，`resumeNote` 非空；恢复后立即复检 G-C2/G-C3 | ADMIN |
| C13 | 任意非终态 | `WITHDRAWN` | 客户撤回 | `withdrawEvidenceRef` 非空（书面/邮件凭证） | ADMIN |
| C14 | 任意非终态 | `DECLINED` | 不予服务 | `declineReason` 非空，不得填授信判断类理由 | ADMIN |

| 编号 | 条件 | 判定方式 |
|---|---|---|
| G-C1 | 需求要素齐备 | 当前需求版本：`purpose` 非空 且 `financingAmount > 0` 且 `termMonths > 0` 且 `fundingGapAmount` 非空 且 `financingType` 非空 |
| G-C2 | 授权有效且覆盖 | 存在授权：`revokedAt IS NULL` 且 `validFrom <= today <= validTo` 且范围 ⊇ 案件所需范围 且 授权关联的需求版本号 = 当前需求版本号 |
| G-C3 | 必填资料可分析 | 全部 `requirementLevel = REQUIRED` 的资料项 `status ∈ {PARSED, VERIFIED, WAIVED}`。**允许 `PARSED`**：分析先跑以及早暴露缺口；评估另要求 `VERIFIED`（G-R4） |
| G-C4 | 轮次定稿且报告可复核 | 存在 `status = CLOSED` 的轮次且 `assessmentId` 非空；存在绑定该 `roundNo` 且 `status = IN_REVIEW` 的报告版本 |
| G-C5 | 交付记录完整 | 存在 `status = ISSUED` 的报告版本；交付记录含 `deliveredAt`/`channel`/`recipient`/`versionNo`/`fileHash` 五项，缺一不可 |
| G-C6 | 无未终结报告版本 | 不存在 `status ∈ {DRAFT, IN_REVIEW, APPROVED, ISSUED}` 的报告版本；若仍有 `OPEN` 的 HIGH 待核实事项，须填 `closingNote` 说明已随报告披露（**提示，不阻塞**） |
| G-C7 | 授权失效 | G-C2 返回 false，且案件尚有未关闭轮次或未签发报告 |

**需求版本变更会解除 G-C2**：用途从「流动资金贷款」改为「设备采购」时，授权书的用途描述已不成立，案件必须回到 `AUTHORIZATION`。理由：授权是「为这个用途处理这些数据」的同意，用途变了同意的基础就变了。

**有意留白**：`CLOSED` 不可重开，`WITHDRAWN`/`DECLINED` 不可复活。需继续服务时新建案件并通过 `previousCaseNo` 引用原案。理由：终止记录一旦可逆，客诉时无法证明「当时确实终止过」。

**对既有文档的连带影响**：`financing-process.md` 全文作废，其守卫 G1–G11 拆分后并入本节；`er-design.md` 的 `ck_financing_case_status` 仍为旧 18 个取值，需按上表 10 个取值重写（本文不提供迁移脚本，由后续任务卡承载）；`financing-domain-model.md` §4 需补 `holdFrom`、`previousCaseNo` 两个字段。`OPEN-QUESTIONS.md` 的 A-4 已落入 `selfReviewed` 与 §7，B-5 的「归档」并入 `CLOSED` 由 `retentionUntil` 承载。

### 3.2 分析轮次 AnalysisRound
| 状态码 | 中文 | 含义 | 责任模块 | 终态 |
|---|---|---|---|---|
| `DRAFT` | 草稿 | 已开轮并绑定数据版本，尚未确认数据可算 | analysis | 否 |
| `DATA_READY` | 数据就绪 | 导入批次全部终态、无阻断级质量检查项 | dataquality | 否 |
| `COMPUTED` | 已计算 | 指标快照已生成并锁定 | finance | 否 |
| `ASSESSED` | 已评估 | 就绪结论与风险事项已产出 | assessment | 否 |
| `CLOSED` | 已定稿 | 结论经人工确认，可被报告版本引用 | analysis | 是（可被更新数据参考性取代，§5.2） |
| `SUPERSEDED` | 已被取代 | 未定稿即被新轮或案件终止取代；内容全部保留只读 | analysis | 是 |

| # | From | To | 动作 | 守卫 | 操作人 |
|---|---|---|---|---|---|
| R01 | — | `DRAFT` | 自动开轮 | G-R1 数据版本为 `ACTIVE` 且尚无轮次绑定它 | SYSTEM |
| R02 | `DRAFT` | `DATA_READY` | 数据就绪 | G-R2 导入终态且无 BLOCKER | SYSTEM |
| R03 | `DATA_READY` | `COMPUTED` | 执行计算 | G-R3 快照已锁定且版本一致 | SYSTEM |
| R04 | `COMPUTED` | `ASSESSED` | 形成评估 | G-R4 结论三档之一且五维依据齐 | SYSTEM |
| R05 | `ASSESSED` | `CLOSED` | 定稿本轮 | G-R5 结论已人工确认 | ADMIN |
| R06 | `DRAFT`/`DATA_READY`/`COMPUTED`/`ASSESSED` | `SUPERSEDED` | 新数据取代旧轮 | 新数据版本 `ACTIVE` 且 `digest` 不同 | SYSTEM |
| R07 | 同上四态 | `SUPERSEDED` | 案件终止取代 | 案件进入 `WITHDRAWN`/`DECLINED`；`supersedeReason = CASE_TERMINATED` | SYSTEM |

| 编号 | 条件 | 判定方式 |
|---|---|---|
| G-R1 | 可开轮 | 存在 `status = ACTIVE` 的数据版本且无轮次的 `dataVersionId` 等于它；`(caseId, dataVersionId)` 唯一约束兜底防重复开轮 |
| G-R2 | 数据就绪 | 该案件所有导入批次为终态（无 `PENDING`/`PARSING`）；`COUNT(qualityIssue WHERE severity = BLOCKER AND status = OPEN) = 0` |
| G-R3 | 计算完成 | 存在快照：`locked = true` 且 `snapshot.dataVersion = round.dataVersionId`；公式版本已记录（INV-05） |
| G-R4 | 评估完成 | 存在 `ReadinessAssessment`，`outcome` 为三档之一且五维依据非空；**且**全部 `REQUIRED` 资料项 `status ∈ {VERIFIED, WAIVED}`（INV-07 在此闸口落地） |
| G-R5 | 可定稿 | 存在 `APPROVED` 的 `ReviewTask(targetType = ASSESSMENT, targetId = 本轮 assessmentId)`；本轮无 `OPEN` 的 `BLOCKER` 质量检查项 |

**`SUPERSEDED` 的语义边界**：只表示「还没定稿就被更新的数据替掉」。已 `CLOSED` 的轮次**不转** `SUPERSEDED`，只用 `supersededByRoundNo` 记血缘，理由见 §5.2。

**待核实事项 `OPEN` 不阻塞 R05**：报告本身就要列出「还有哪些事项待企业澄清」，把它当阻塞项会让「信息不足」这一正常结论永远发不出去。关闭环节同样只提示不阻塞（见 G-C6）——客户拒不答复时，硬阻塞会让案件永远关不掉。

### 3.3 报告版本 ReportVersion
| 状态码 | 中文 | 含义 | 责任模块 | 终态 | 内容可改 |
|---|---|---|---|---|---|
| `DRAFT` | 草稿 | 由模板渲染生成，可重生成 | report | 否 | 是 |
| `IN_REVIEW` | 复核中 | 已冻结提交复核 | review | 否 | 否 |
| `APPROVED` | 复核通过 | 待签发 | review | 否 | 否 |
| `ISSUED` | 已签发 | 具对外效力，签发人已确认 | report | 否 | 否 |
| `DELIVERED` | 已交付 | 交付记录完整 | report | 是 | 否 |
| `VOID` | 已作废 | 不再具有效力，理由必填 | report | 是 | 否 |

| # | From | To | 动作 | 守卫 | 操作人 |
|---|---|---|---|---|---|
| P01 | — | `DRAFT` | 生成报告草稿 | G-P1 轮次已定稿且证据校验通过 | SYSTEM |
| P02 | `DRAFT` | `IN_REVIEW` | 提交复核 | G-P2 内容哈希稳定且无阻断项 | ADMIN |
| P03 | `IN_REVIEW` | `DRAFT` | 要求修改 | 存在 `CHANGES_REQUESTED` 复核记录，意见非空 | REVIEWER |
| P04 | `IN_REVIEW` | `APPROVED` | 复核通过 | G-P3 存在通过的复核记录 | REVIEWER |
| P05 | `APPROVED` | `ISSUED` | 签发 | G-P4 复核有效、授权有效、声明齐 | ADMIN |
| P06 | `ISSUED` | `DELIVERED` | 交付 | G-P5 交付记录完整且哈希一致 | ADMIN |
| P07 | `DRAFT`/`IN_REVIEW`/`APPROVED` | `VOID` | 作废未签发版本 | `voidReason` 必填；`IN_REVIEW` 需先撤回复核任务 | ADMIN |
| P08 | `ISSUED`/`DELIVERED` | `VOID` | 作废已签发版本 | G-P6 理由与替代版本 | ADMIN |
| P09 | `IN_REVIEW`/`APPROVED` | `VOID` | 随案件撤回 | 案件进入 `WITHDRAWN`/`DECLINED` | SYSTEM |

| 编号 | 条件 | 判定方式 |
|---|---|---|
| G-P1 | 可生成草稿 | 绑定轮次 `status = CLOSED`；证据校验通过：每个数字有 `METRIC` 类引用、每条结论 ≥1 引用、全部引用 `dataVersionId` = 轮次版本（INV-14/18）；正文无裸数字、无未替换 `{{metric:…}}` 占位符 |
| G-P2 | 可提交复核 | `contentHash` 已生成且可复算一致；`evidenceCheckResult` 通过且时间晚于最后一次内容生成；无 `OPEN` 的 `BLOCKER` 质量检查项 |
| G-P3 | 可复核通过 | 存在 `ReviewTask(targetType = REPORT_VERSION, targetId = 本版本)` 且 `status = APPROVED`；`selfReviewed` 已显式记录（单人场景必须为 `true`，不得留空） |
| G-P4 | 可签发 | G-P3 仍成立（复核未撤回）；`issuedBy` 非空；签发时刻仍满足 G-C2 |
| G-P5 | 可交付 | 交付记录五项齐全（同 G-C5）；`fileHash` 与 `contentHash` 对应导出文件一致 |
| G-P6 | 可作废已签发版本 | `voidReason` 非空；且 `replacementVersionNo` 非空 或 `caseTerminated = true`；已 `DELIVERED` 的还需记录客户告知方式与时间 |

**为什么 P05 要重新校验授权**：报告导出是授权拦截的四个入口之一（解析、导入、AI 调用、报告导出）。授权在起草后被撤销时签发必须失败，否则等于持撤销的同意把客户资料交出去。

### 3.4 资料项 CaseMaterial
| 状态码 | 中文 | 含义 | 责任模块 | 终态 |
|---|---|---|---|---|
| `REQUIRED` | 待索要 | 清单要求存在，尚未向客户提出 | document | 否 |
| `REQUESTED` | 已索要 | 已发出索要，等待客户提供 | document | 否 |
| `RECEIVED` | 已收到 | 文件已上传或登记，尚未完成解析 | document | 否 |
| `PARSED` | 已解析 | 关键字段已提取，尚未人工核验 | dataimport | 否 |
| `VERIFIED` | 已核验 | 人工确认可用，可作为评估输入 | document | 否（可被新版本覆盖） |
| `REJECTED` | 已退回 | 核验不通过，需重新提供 | document | 否 |
| `WAIVED` | 已豁免 | 确认无法取得，经批准免除 | document | 是 |

| # | From | To | 动作 | 守卫 | 操作人 |
|---|---|---|---|---|---|
| M01 | — | `REQUIRED` | 生成资料项 | 清单字典版本已发布；`requirementLevel` 快照写入 | SYSTEM |
| M02 | `REQUIRED` | `REQUESTED` | 发出索要 | 客户主联系人非空 | ADMIN |
| M03 | `REQUESTED` | `RECEIVED` | 收到文件 | 文件已上传且 `docType` 与 `materialCode` 匹配 | ADMIN/SYSTEM |
| M04 | `RECEIVED` | `PARSED` | 解析完成 | 导入批次已达终态，且该文件版本不存在 `status='FAILED'` 的导入批次 | SYSTEM |
| M05 | `PARSED` | `VERIFIED` | 人工核验通过 | 该资料项全部当前文件版本 `verificationState = VERIFIED`；核验人非空（INV-04） | ADMIN/REVIEWER |
| M06 | `PARSED` | `REJECTED` | 核验退回 | 理由非空且具体到缺哪个字段/哪一页 | REVIEWER |
| M07 | `REJECTED` | `REQUESTED` | 重新索要 | 索要说明写明要补什么 | ADMIN |
| M08 | `REQUIRED`/`REQUESTED`/`RECEIVED`/`PARSED`/`REJECTED` | `WAIVED` | 豁免 | `waiverReason` 非空；`requirementLevel = REQUIRED` 须 ADMIN 批准并留 `waivedBy` | ADMIN |
| M09 | `RECEIVED`/`PARSED` | `REQUIRED` | 文件被取回 | 尚无核验记录，理由必填 | ADMIN |

**多文件规则**：一个资料项可关联多个文件（如 12 个月流水分三个文件）。M05 要求**全部**当前文件版本均为 `VERIFIED` 才可推进；部分完成时停在 `PARSED`，界面显示「n/m 已核验」。理由：只核验一部分就标记已核验，等于把缺口藏在聚合状态后面。

**清单变更规则**：字典改版**不**回填在途案件。新增要求只能通过「追加资料项」写入，需填 `addReason` 与追加人，产生新的 `REQUIRED` 项。

### 3.5 待核实事项 VerificationItem
| 状态码 | 中文 | 含义 | 责任模块 | 终态 |
|---|---|---|---|---|
| `OPEN` | 待答复 | 已识别疑问，尚未获得企业答复 | assessment | 否 |
| `ANSWERED` | 已答复 | 已收到答复，尚未判定是否足以消解 | assessment | 否 |
| `RESOLVED` | 已解决 | 差异已解释清楚或被资料消除 | assessment | 是 |
| `WAIVED` | 已豁免 | 确认不再追，须在报告「已豁免事项」列出 | assessment | 是 |

| # | From | To | 动作 | 守卫 | 操作人 |
|---|---|---|---|---|---|
| V01 | — | `OPEN` | 规则命中生成 | ≥1 条证据引用；表述通过定性词词典拦截（INV-13） | SYSTEM |
| V02 | `OPEN` | `ANSWERED` | 登记企业答复 | 答复正文非空，标明来源（口头/书面）与时间 | ADMIN |
| V03 | `ANSWERED` | `RESOLVED` | 核实成立 | 结论正文非空；≥1 条 `HUMAN_REVIEW` 类证据引用 | ADMIN/REVIEWER |
| V04 | `ANSWERED` | `OPEN` | 答复不足 | 理由非空，写明还需澄清什么 | ADMIN/REVIEWER |
| V05 | `OPEN`/`ANSWERED` | `WAIVED` | 豁免 | `waiverReason` 非空；报告须列出 | ADMIN |
| V06 | 未终结态 | `OPEN`（新轮新记录） | 跨轮继承 | 见 §6；不改原记录状态 | SYSTEM |

**`RESOLVED` 只能由人推进**：判断「这个解释成立」是专业判断，让系统自动关闭待核实事项等于让系统替复核人下结论。

## 四、案件进度投影

列表页「进度」= `progress(caseId)`，由五个生命周期的当前状态**查询期计算**得出。

| 属性 | 结论 |
|---|---|
| 是否落库 | **否**。不设 `progress`/`display_status` 列，不设冗余字段 |
| 是否可写 | **否**。无任何接口接受进度写入 |
| 是否可驱动流转 | **否**。全部守卫读原始状态字段，不得读投影值 |
| 一致性 | 同一次查询内基于同一事务快照计算，避免读到半更新态 |

| 输入 | 来源 | 用途 |
|---|---|---|
| `lifecycle`、`holdFrom`；最大 `roundNo`、`supersededByRoundNo` | `FinancingCase`、`AnalysisRound` | 主阶段、挂起展示、「第 N 轮已出报告」判定 |
| 最新报告版本状态 | `ReportVersion` | 报告环节优先于阶段 |
| 资料项按状态计数 | `CaseMaterial` | 「m/n 已核验」 |
| `OPEN` 待核实事项数与最高等级 | `VerificationItem` | 待澄清提示 |

| 优先级 | 条件 | `progressLabel` | `progressTone` |
|---|---|---|---|
| 1 | `lifecycle = WITHDRAWN` | 客户已撤回 | GRAY |
| 2 | `lifecycle = DECLINED` | 不予服务 | GRAY |
| 3 | `lifecycle = CLOSED` | 已关闭 | GRAY |
| 4 | `lifecycle = ON_HOLD` | 已挂起（原阶段：{holdFrom 中文}） | AMBER |
| 5 | 存在 `ISSUED`/`DELIVERED` 报告版本，且最新轮未定稿（或 `SUPERSEDED`）并有 `REQUIRED`/`REQUESTED`/`REJECTED` 资料项 | 补充资料中（第 {N} 轮已出报告） | AMBER |
| 6 | 存在 `DELIVERED` 报告版本 | 已交付（报告 V{n}） | GREEN |
| 7 | 存在 `ISSUED` 报告版本 | 报告待交付（V{n}） | BLUE |
| 8 | 存在 `APPROVED` 报告版本 | 待签发（V{n}） | BLUE |
| 9 | 存在 `IN_REVIEW` 报告版本 | 复核中（V{n}） | BLUE |
| 10 | 存在 `OPEN` 的 HIGH 待核实事项 | 待企业澄清（{n} 项） | AMBER |
| 11 | `lifecycle = COLLECTING` | 资料收集中（{verified}/{required} 已核验） | NORMAL |
| 12 | `lifecycle = ANALYZING` | 分析中（第 {roundNo} 轮：{轮次状态中文}） | NORMAL |
| 13 | `lifecycle = REVIEW` | 复核中 | NORMAL |
| 14 | `lifecycle = AUTHORIZATION` / `INTAKE` | 待授权 / 受理中 | NORMAL |

自上而下命中即停。**规则 5 的 {N}** 取已 `ISSUED`/`DELIVERED` 版本所绑定的 `roundNo`。这一行必须排在规则 6–9 之前，否则永远不可见——而它正是单状态字段表达不了的那句：同一行同时陈述两件事，资料在补、第 N 轮结论已发出。

**规则 6–9 优先于 11–14**：报告处于复核/签发/待交付时，客户最关心报告到哪一步，此时「资料收集中」是内部事实，不该占据主文案。

次级字段：`subLabel`（按 `statusEnteredAt` 算停滞天数，超 7 天才显示）；`blockingCount`（未 `VERIFIED`/`WAIVED` 的 `REQUIRED` 资料项 + `OPEN` 的 `BLOCKER` 质量检查项 + `OPEN` 的 HIGH 待核实事项，三项求和）；`latestRoundNo`、`latestReportVersionNo`（各取最大值，缺省 0）。

## 五、轮次与报告的联动

### 5.1 触发链
```
资料变更（上传/替换/删除/人工修正）
  → 重算 DataVersion.digest
  → digest 与上一版相同 → 结束，不开轮（INV-19）
  → digest 不同 → 生成新 DataVersion（ACTIVE，旧版转 SUPERSEDED）→ DataVersionCreated
  → 自动开新一轮（R01），roundNo = max + 1
  → 未定稿旧轮 → SUPERSEDED（R06）；已 CLOSED 旧轮 → 保持 CLOSED，仅写 supersededByRoundNo
  → 已签发报告 → 派生 stale 标记（不修改报告内容）
```

**开轮为什么自动而不是按钮**：漏开一轮，第 3 版数据下显示的就是第 2 轮结论，而这种错误在界面上看不出来。自动开轮多几次计算，漏开轮直接给错结论，两者代价不对等。

### 5.2 已签发报告是否失效

**结论：不失效。保持 `ISSUED`/`DELIVERED`，附加「数据已更新，建议复核」标记。**

| 处理方式 | 是否采用 | 理由 |
|---|---|---|
| 自动作废 | 否 | 作废是行政动作，必须有人负责；自动作废会让客户手里的文件与系统记录不一致 |
| 保持有效 + 标记 | **是** | 报告是对「签发时那版数据」的结论，签发是既成事实；数据后来变了说明结论需更新，不说明当时结论错了 |
| 无标记静默保留 | 否 | 运营者看不到陈旧，客户拿新数据仍用旧报告，等于交付了一份已知过时的判断 |

**标记必须是派生值**：`ISSUED` 之后内容不可修改（INV-09），把标记写成报告版本字段会破这条不变量。实现为派生字段 `dataStaleness`：

| 取值 | 判定 |
|---|---|
| `CURRENT` | 报告所绑轮次的 `dataVersionId` = 案件当前 `ACTIVE` 数据版本 |
| `STALE` | 不等，且后续轮次已 `CLOSED` 或 `ASSESSED` |
| `STALE_PENDING` | 不等，但后续轮次仍在 `DRAFT`/`DATA_READY`/`COMPUTED` |

配套动作 `ReportStaleNoticeAcknowledged`：运营者确认「已看到数据更新」时，在报告聚合（非版本内容）写 `staleAcknowledgedAt`，仅用于消除提醒，不改变效力。

### 5.3 更新后如何出新报告
| 问题 | 结论 | 理由 |
|---|---|---|
| 能否复用旧轮结论出新版报告 | **不能** | 新版本证据的 `dataVersionId` 必须等于所绑轮次版本（INV-18），旧轮版本号对不上，渲染器直接拒绝 |
| 一份报告能否合并多轮结论 | **不能**，报告版本与轮次一对一 | 合并会让「这个数字来自哪一版数据」失去唯一答案，证据校验退化为形式 |
| 新旧版本如何共存 | 新版本走完整 `DRAFT→…→DELIVERED`；旧版本保持 `DELIVERED` | 历史上发过什么必须查得到 |
| 何时才用 `VOID` | 仅当「这一版本身有错」（错误签发、错发客户） | `VOID` 表示「这版不该存在」，数据更新不属于此类 |

## 六、待核实事项的跨轮继承
| # | 规则 | 判定 |
|---|---|---|
| 1 | 只继承 `status ∈ {OPEN, ANSWERED}` 的项 | `RESOLVED`/`WAIVED` 不继承；按 `rootItemId` 仍可查全部历史 |
| 2 | 继承 = 新建记录，不移动原记录 | 新记录 `roundNo` = 新轮，`rootItemId` 沿用，`carriedFromRoundNo`/`carriedFromItemId` 指回来源；同一轮同一 `rootItemId` 至多一条（唯一约束） |
| 3 | 新记录状态一律 `OPEN` | 即使原项为 `ANSWERED` 也不继承「已答复」 |
| 4 | 原答复作只读参考携带 | `priorAnswerNote` =「第 N 轮答复（参考）」+ 摘要，≤200 字 |
| 5 | 继承在开轮事务内完成（R01） | 不等数据就绪：待核实事项问的是「企业要澄清什么」，与本轮算没算完无关 |
| 6 | 继承不改原轮任何字段 | 第 2 轮时间线上，那条记录当时就是 `OPEN` |

**规则 3 为什么一律退回 `OPEN`**：答复是对**上一版数据**的解释。新数据进来后同一解释可能不再成立（「这笔 80 万是关联方往来」在补了新流水后被证明是两笔）。直接继承 `ANSWERED` 等于默认旧解释在新数据上继续有效——这是最隐蔽的错误通过方式。

继承记录字段：`rootItemId`（跨轮不变）、`carriedFromRoundNo` / `carriedFromItemId`（首次发现为 `null`）、`priorAnswerNote`（只读摘要）、`carryCount`（新轮号 − 首次轮号）。`carryCount >= 3` 时列表与报告须显式提示「该疑问已连续 3 轮未澄清」——这类项通常意味着资料有结构性问题，比单个数字差异更值得写进报告。

## 七、角色与操作矩阵

首期单人，但权限按四角色设计。同一用户可同时持 ADMIN 与 REVIEWER；动作校验仍按角色执行，复核类动作必须写 `selfReviewed`。

| 动作 | ADMIN | REVIEWER | VIEWER | SYSTEM |
|---|---|---|---|---|
| 创建案件 / 编辑需求版本 | ✓ | — | — | — |
| 提交受理（C02） | ✓ | — | — | — |
| 登记 / 撤销授权 | ✓ | — | — | — |
| 授权覆盖校验（C03） | ✓ | — | — | ✓ |
| 发出索要（M02/M07）、上传资料（M03） | ✓ | — | — | ✓（仅上传） |
| 核验资料（M05） | ✓ | ✓ | — | — |
| 退回资料（M06） | — | ✓ | — | — |
| 豁免资料项（M08） | ✓ | — | — | — |
| 触发解析 / 计算（M04/R02/R03） | ✓ | — | — | ✓ |
| 开新轮（R01） | — | — | — | ✓ |
| 定稿本轮（R05） | ✓ | — | — | — |
| 答复登记（V02） | ✓ | — | — | — |
| 关闭待核实事项（V03/V04/V05） | ✓ | ✓ | — | — |
| 提交复核（C05/P02） | ✓ | — | — | — |
| 复核通过 / 要求修改（P03/P04） | — | ✓ | — | — |
| 退回重算 / 退回补资料（C06/C07） | — | ✓ | — | — |
| 签发报告（P05） | ✓ | — | — | — |
| 交付报告（P06/C09） | ✓ | — | — | — |
| 作废报告版本（P07/P08） | ✓ | — | — | — |
| 挂起 / 恢复（C11/C12）、撤回 / 不予服务（C13/C14）、关闭案件（C10） | ✓ | — | — | — |
| 查看案件与报告 / 下载原件 / 查看审计日志 | ✓ | ✓ / ✓ / — | ✓ / — / — | ✓ / — / — |

两条硬约束：`P05` 签发人不得为空、不得是 SYSTEM（签发是人的责任，不能让定时任务代签）；`P04` 复核人若同时是 `P02` 提交人，`selfReviewed` 必须为 `true` 并在报告页固定披露「同一人编制与复核」。

## 八、领域事件

命名一律过去式，描述已发生的事实。分两类发布，区别在失败是否回滚。

**事务内事件**（同步执行，失败整体回滚）：

| 事件 | 触发 | 关键载荷 |
|---|---|---|
| `DataVersionCreated` | 版本建立且 `digest` 变化 | `caseId`、`dataVersionId`、`triggerType`、`digest` |
| `AnalysisRoundOpened` | R01 | `caseId`、`roundNo`、`dataVersionId` |
| `VerificationItemsCarried` | 开轮时继承完成 | `caseId`、`fromRoundNo`、`toRoundNo`、`carriedCount` |
| `AnalysisRoundSuperseded` | R06/R07 | `caseId`、`roundNo`、`supersededByRoundNo`、`reason` |
| `AnalysisRoundClosed` | R05 | `caseId`、`roundNo`、`assessmentId`、`outcome` |
| `ReportVersionCreated` | P01 | `reportId`、`versionNo`、`roundNo`、`contentHash` |
| `ReportVersionSubmitted` | P02 | `reportId`、`versionNo`、`reviewTaskId` |
| `ReportVersionApproved` | P04 | `reportId`、`versionNo`、`reviewerId`、`selfReviewed` |
| `ReportIssued` | P05 | `reportId`、`versionNo`、`issuedBy`、`issuedAt` |
| `ReportDelivered` | P06 | `reportId`、`versionNo`、`deliveredTo`、`channel`、`fileHash` |
| `ReportVersionVoided` | P07/P08/P09 | `reportId`、`versionNo`、`voidReason`、`replacementVersionNo` |
| `CaseLifecycleChanged` | 案件每次流转 | `caseId`、`from`、`to`、`actor`、`reason`、`guardResult` |

事务内事件的典型消费者是状态机自身：`ReportIssued` 由 `case` 消费以决定是否进入 `DELIVERED`，这类联动必须在同一事务，否则会出现「报告已签发但案件仍在 `REVIEW`」的窗口期。

**提交后事件**（`AFTER_COMMIT`，失败仅记日志）：

| 事件 | 触发 | 关键载荷 |
|---|---|---|
| `CaseCreated` | C01 | `caseId`、`customerId`、`materialSnapshotVersion` |
| `CaseAuthorizationGranted` / `Revoked` | 授权登记 / 撤销 | `caseId`、`scopes`、`validTo` |
| `MaterialRequested` / `Received` / `Verified` / `Rejected` / `Waived` | M02–M08 | `caseId`、`materialCode`、`actor` |
| `VerificationItemRaised` / `Answered` / `Resolved` / `Waived` | V01–V05 | `caseId`、`roundNo`、`itemId`、`severity` |
| `ReportMarkedStale` / `ReportStaleNoticeAcknowledged` | `dataStaleness` 由 `CURRENT` 转 `STALE` / 运营者确认提醒 | `reportId`、`versionNo`、`currentDataVersionId`、`actor` |
| `CaseClosed` | C10 | `caseId`、`closedAt`、`retentionUntil` |

`ReportMarkedStale` 为什么放在提交后：它只是提醒，不影响任何流转判定。若放进事务内，一次通知失败会让「资料上传」整体失败——为了让用户看到提醒而阻断资料接收，代价与收益不对等。

## 九、并发与幂等

**乐观锁**：每个可变聚合根带 `version`，流转语句必须同时匹配期望前置状态与期望版本。

| 聚合 | 冲突返回 |
|---|---|
| `FinancingCase` | `409 CASE_VERSION_CONFLICT` + 当前真实 `lifecycle` |
| `AnalysisRound` | `409 ROUND_VERSION_CONFLICT` + 当前真实 `status` |
| `ReportVersion` | `409 REPORT_VERSION_CONFLICT` + 当前真实 `status` |
| `CaseMaterial` | `409 MATERIAL_VERSION_CONFLICT` |
| `VerificationItem` | `409 ITEM_VERSION_CONFLICT` |

影响行数为 0 时一律返回冲突并附当前真实状态，禁止静默失败或静默重试。理由：状态机冲突几乎总是「别人已经推进过」，静默重试会把第二个动作当成第一次执行。

**幂等**：

| 层面 | 机制 |
|---|---|
| 命令级 | 请求头 `Idempotency-Key`；作用域 `(command, caseId, key)`；24 小时内同键直接返回首次结果（含首次错误码，不重新判定守卫） |
| 开轮 | `(caseId, dataVersionId)` 唯一约束，重复事件不会开出两个同版本轮次 |
| 报告版本 | `(reportId, roundNo)` 唯一约束，重复触发只产生一版 |
| 事件消费 | 以 `eventId` + 处理方名去重表，保证提交后事件重复投递无副作用 |

幂等结果必须缓存**错误**：用户点「提交复核」超时后重试，若首次因守卫失败、第二次因状态已变返回另一种错误，前端会展示两个互相矛盾的提示。

**守卫失败的结构化返回**：

```json
{
  "code": "GUARD_FAILED", "guard": "G-R4", "lifecycle": "ANALYSIS_ROUND",
  "message": "必填资料尚未完成核验，无法形成评估结论",
  "expectedFrom": "COMPUTED", "actualStatus": "COMPUTED",
  "blockingItems": [
    { "type": "MATERIAL", "code": "BANK_STATEMENT_12M", "title": "近 12 个月银行流水", "status": "PARSED", "requiredStatus": "VERIFIED", "severity": "BLOCKER", "fixHint": "完成第 3 个文件的人工核验后重试" },
    { "type": "QUALITY_ISSUE", "code": "DQ-CHECK-01", "title": "资产负债勾稽不平", "status": "OPEN", "severity": "BLOCKER", "fixHint": "差异 12,400.00 元，需确认口径或修正导入" },
    { "type": "AUTHORIZATION", "code": "SCOPE_MISSING", "title": "授权未覆盖「纳税申报表」范围", "status": "MISSING", "severity": "BLOCKER", "fixHint": "补充授权后重试" },
    { "type": "VERIFICATION_ITEM", "code": "VI-REV-03", "title": "营业收入与回款差异待澄清", "status": "OPEN", "severity": "HIGH", "fixHint": "不阻塞本次操作，但会进入报告待核实清单" }
  ],
  "traceId": "b1f0c4de-8a52-4c1e-9f0d-2b7c1e9a4d33"
}
```

| 字段 | 约束 |
|---|---|
| `guard` | 必填，守卫编号（G-C*/G-R*/G-P*），或资料项/待核实事项的动作号（M*/V*）；用于前端与日志定位 |
| `blockingItems[].type` | `MATERIAL` / `QUALITY_ISSUE` / `VERIFICATION_ITEM` / `AUTHORIZATION` / `EVIDENCE` |
| `blockingItems[].severity` | `BLOCKER` 阻塞本次动作；`HIGH` 仅提示不阻塞 |
| `blockingItems[].fixHint` | 必填，必须给出可执行动作，禁止写「请联系管理员」 |
| `actualStatus` | 必填，返回数据库真实状态而非请求中的期望状态 |

| 码 | HTTP | 含义 |
|---|---|---|
| `GUARD_FAILED` | 422 | 守卫不满足，附 `blockingItems` |
| `STATE_CONFLICT` | 409 | 乐观锁或前置状态不匹配 |
| `ILLEGAL_TRANSITION` | 422 | 目标转换未在转换表中登记 |
| `EVIDENCE_CHECK_FAILED` | 422 | 证据校验失败，附缺失引用的段落与数字 |

命中幂等缓存返回 200 + 响应头 `Idempotent-Replay: true`，不重复执行。

## 十、明确禁止的流转与反模式
| # | 反模式 | 为什么禁止 |
|---|---|---|
| 1 | 用 `lifecycle` 表达报告状态（如新增 `REPORT_ISSUED`） | 报告有独立状态机，混回去等于放弃修正 2 |
| 2 | 把投影 `progress` 写回数据库或作为守卫输入 | 派生值写回会产生第二份真相，必然与源状态不一致 |
| 3 | `ANALYZING` → `DELIVERED`（跳过复核与签发） | 报告无复核记录、无签发人，违反 INV-08 |
| 4 | `INTAKE` → `COLLECTING`（跳过授权） | 无授权即处理数据，违反 INV-02 |
| 5 | 报告版本绑定非 `CLOSED` 轮次 | 结论未定稿即可被引用，未完成的分析进了报告 |
| 6 | 跨数据版本引用证据 | 违反 INV-18，可追溯性直接失效 |
| 7 | 把已 `CLOSED` 的轮次改成 `SUPERSEDED` | 会抹掉「它曾经定稿」这一事实；先后关系用 `supersededByRoundNo` 表达 |
| 8 | 已签发报告直接改内容，或数据更新后自动作废已签发报告 | 内容不可改（INV-09，只能作废出新版）；自动作废会让客户手里的文件与系统不一致，且作废须人负责 |
| 9 | 未解决待核实事项在新轮被删除而非继承 | 违反 INV-20，疑问被静默消失 |
| 10 | 用 `ON_HOLD` 覆盖丢失 `holdFrom` | 恢复时无目标状态，只能人工猜，必然出错 |
| 11 | 资料项由系统直接置 `VERIFIED` | 违反 INV-04，核验是人的判断 |
| 12 | 守卫失败只返回一句「操作失败」，或流转不写原因与守卫结果 | 丢失可解释性；违反 INV-12，审计无法解释「为什么退回去了」 |

## 十一、端到端场景走查

### S1 正常一次通过
| # | 动作 | 案件 | 轮次 | 报告 | 资料/事项 |
|---|---|---|---|---|---|
| 1 | 创建案件，补齐要素后提交 | `INTAKE` → `AUTHORIZATION` | — | — | 清单快照生成 6 项 `REQUIRED`；G-C1 通过 |
| 2 | 登记授权（覆盖 5 类范围）后校验通过 | → `COLLECTING` | — | — | G-C2 通过 |
| 3 | 逐个发出索要，客户上传 3 个文件 | 停留 | — | — | `REQUESTED` → `RECEIVED` → `PARSED`；数据版本 V1 建立 |
| 4 | 自动开轮 | 停留 | — → 第 1 轮 `DRAFT` | — | R01，继承 0 项 |
| 5 | 人工核验 3 个文件 | 停留 | → `DATA_READY` | — | → `VERIFIED`；G-C3 满足 |
| 6 | 进入分析 | → `ANALYZING` | 停留 | — | C04 |
| 7 | 计算 → 评估（结论「可进入正式资料提交准备」） | 停留 | `DATA_READY` → `COMPUTED` → `ASSESSED` | — | 3 项 `WAIVED` 已列 |
| 8 | 确认结论并定稿 | 停留 | → `CLOSED` | — | R05 |
| 9 | 生成草稿，提交复核 | → `REVIEW` | — | — → V1 `DRAFT` → `IN_REVIEW` | P01 证据校验通过；P02 + C05 |
| 10 | 复核通过（单人，`selfReviewed=true`）并签发 | 停留 | — | → `APPROVED` → `ISSUED` | P04 + P05，授权仍有效 |
| 11 | 交付并关闭案件 | `DELIVERED` → `CLOSED` | — | → `DELIVERED` | C09 + P06 + C10；写 `retentionUntil` |

### S2 资料不足退回（复核阶段发现缺口）
| # | 动作 | 案件 | 轮次 | 报告 | 资料/事项 |
|---|---|---|---|---|---|
| 1 | 承接 S1 第 9 步 | `REVIEW` | 第 1 轮 `CLOSED` | V1 `IN_REVIEW` | — |
| 2 | 复核人发现「纳税申报表」缺第 2 页 | 停留 | 停留 | → `DRAFT` | P03，`CHANGES_REQUESTED` |
| 3 | 退回补资料；该资料项 `PARSED` → `REJECTED` → `REQUESTED` | → `COLLECTING` | 停留 | 停留 `DRAFT` | C07 理由必填；M06 + M07 |
| 4 | 客户补传完整版 | 停留 | 停留 | — | → `RECEIVED` → `PARSED` |
| 5 | 数据版本 V2 建立，自动开第 2 轮 | 停留 | 第 2 轮 `DRAFT` | V1 仍 `DRAFT` | 第 1 轮保持 `CLOSED`；继承 0 项 |
| 6 | V1 草稿作废 | 停留 | — | `DRAFT` → `VOID` | P07，理由「数据已更新，改基于第 2 轮」 |
| 7 | 核验通过，进入分析并算完 | → `ANALYZING` | → `DATA_READY` → … → `CLOSED` | — | G-R4 满足 |
| 8 | 生成 V2，复核通过并签发 | → `REVIEW` | — | V2 `DRAFT` → `IN_REVIEW` → `APPROVED` → `ISSUED` | 绑定第 2 轮 |
| 9 | 交付并关闭 | → `DELIVERED` → `CLOSED` | — | → `DELIVERED` | — |

第 6 步与数据更新的区别：V1 从未签发，作废它没有对外影响，故用 `VOID`；若 V1 已签发，则走 §5.2 的保持有效 + 标记。

### S3 交付后补资料，开新轮并出 V2
| # | 动作 | 案件 | 轮次 | 报告 | 备注 |
|---|---|---|---|---|---|
| 1 | 承接 S1 末态 | `CLOSED` | 第 1 轮 `CLOSED` | V1 `DELIVERED` | 已只读 |
| 2 | 客户补交 3 个月流水 | 停留 `CLOSED` | — | — | 已关闭案件不可回流，须新建案件并填 `previousCaseNo` |
| 3 | 新案件走 S1 第 1–4 步 | `COLLECTING` | 第 1 轮 `DRAFT`（新案） | — | 历史链条不断，报告分属两案 |
| 4 | 同案内补资料，数据版本 V2 建立 | 停留 | 第 2 轮 `DRAFT` | V1 `DELIVERED` + `STALE_PENDING` | 第 1 轮保持 `CLOSED`，`supersededByRoundNo=2`；不改 V1 内容与状态 |
| 5 | 第 2 轮算完定稿，运营者确认陈旧提醒 | → `ANALYZING` → 回落 | → `CLOSED` | V1 → `STALE` + `staleAcknowledgedAt` | 发 `ReportMarkedStale`；确认仅消除提醒 |
| 6 | 生成 V2，签发交付 | → `REVIEW` → `DELIVERED` | — | V2 → `ISSUED` → `DELIVERED` | V1 保持 `DELIVERED`，不作废 |
| 7 | 关闭 | → `CLOSED` | — | — | 列表显示 V1、V2，V1 标注「已被 V2 更新」 |

第 2、3 步是关键判断：`CLOSED` 不可回流，补资料须开新案件（理由见 §3.1 有意留白）。同案内的资料更新才走同案新轮，即第 4 步之后的情形。

### S4 客户中途撤回
| # | 动作 | 案件 | 轮次 | 报告 | 资料/事项 |
|---|---|---|---|---|---|
| 1 | 承接 S1 第 6 步，计算已完成 | `ANALYZING` | 第 1 轮 `COMPUTED` | — | 已计算，未评估 |
| 2 | 客户书面要求终止，上传凭证 | 停留 | — | — | `withdrawEvidenceRef` 已挂 |
| 3 | 登记撤回 | → `WITHDRAWN` | `COMPUTED` → `SUPERSEDED`（`CASE_TERMINATED`） | — | C13 + R07，同一事务 |
| 4 | 后续守卫 | 终态 | 终态 | — | 一切推进被「非终态才允许推进」拦截 |
| 5 | 数据保全与展示 | 停留 | 全轮次保留只读 | — | 授权撤销即时生效，资料不删除；`progressLabel = 客户已撤回` |

若撤回发生在 `REVIEW`：第 3 步同时触发 P09，`IN_REVIEW`/`APPROVED` 的版本转 `VOID`；已 `ISSUED` 的版本不 VOID——已经交出去的效力，客户撤回不能单方面抹掉。

## 十二、需要你确认

1. **已 `CLOSED` 的轮次不再转 `SUPERSEDED`**（只用 `supersededByRoundNo` 记血缘），是否接受？我这样定是因为 `SUPERSEDED` 若也用于已定稿轮，「被取代」与「已定稿可被报告引用」会互相矛盾。
2. **必填资料允许 `PARSED` 即进入分析、但评估要求 `VERIFIED`**（G-C3 与 G-R4 分层），是否接受？这能让缺口更早暴露，代价是中间指标可能基于未核验数据。
3. **`ISSUED`/`DELIVERED` 作废（P08）是否需要客户书面确认记录**？目前只要求 `voidReason` + 替代版本号 + 客户告知方式，未强制凭证。
4. **交付（P06）的证据形态**：以「发送记录」为准（邮件/微信截图 + 哈希），还是要求客户签收单？前者可自动化，后者更硬但拖交付周期。
