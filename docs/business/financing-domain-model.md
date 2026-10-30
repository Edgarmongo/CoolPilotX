# CPX-BIZ-01 融资业务领域模型

- 状态：待确认
- 约束：受 `docs/product/product-baseline-v1.md` V1.0 约束
- 目的：把六个业务域与证据域落成聚合、不变量与协作规则，作为数据库设计与模块划分的唯一依据

---

## 一、建模的三个取舍

在列聚合之前，先说明三个决定模型形状的判断。它们不是风格问题，选错了后面全是返工。

### 取舍 1：数据版本是一等公民

多数系统把"数据"当成会原地变化的东西：企业补了一份流水，系统把旧数据删掉、写入新数据。这样做的后果是——上一轮的分析结论失去了参照物，再也解释不清"当时那版报告是基于什么算出来的"。

**本模型的选择**：案件的数据集每变一次，生成一个新 `DataVersion`。指标、发现、评估全部绑定到具体版本，旧版本永久保留、只读。

代价是存储增长与实现复杂度上升（每次分析都要处理"新版本 vs 旧版本"的差异）。收益是任何一份历史报告都能被完整重建——这是"可核验"三个字的物理基础。

### 取舍 2：分析轮次独立于案件阶段

案件可能停在"资料收集中"很久，期间已经跑过两轮分析。如果只有案件状态，就无法表达"第 2 轮分析已完成、报告待出，同时第 3 轮资料正在补充"这种真实情况。

**本模型的选择**：`AnalysisRound` 独立聚合，有自己的状态机，绑定一个 `DataVersion`。案件生命周期只表达"服务走到哪一段"，轮次表达"算到第几遍"。

### 取舍 3：证据引用是结构化对象，不是文本

报告里写"数据来源：2025 年审计报告"是不可追溯的——资料换版后这句话依然存在，但它指向的东西已经变了。

**本模型的选择**：`EvidenceReference` 是带类型的结构化引用，必须指向**具体版本**上的**具体位置**（文件版本 + 页码/行号，或数据行 + 列）。渲染器校验其可达性，不可达则不渲染。

---

## 二、域与聚合总览

| 域 | 聚合根 | 内部实体 / 值对象 | 写入频率 |
|---|---|---|---|
| D1 客户与融资需求 | `Customer` | `Contact` | 低 |
| | `FinancingCase` | `FinancingRequirement`（版本链） | 低 |
| D2 资料与数据管理 | `CaseAuthorization` | `AuthorizationScope` | 低 |
| | `CaseMaterial` | — | 中 |
| | `Document` | `DocumentVersion` | 中 |
| | `ImportBatch` | `ImportRecord` | 高 |
| | `QualityIssue` | — | 中 |
| D3 财务与经营分析 | `FinancialStatement` | `StatementItem` | 中 |
| | `BankTransaction` | —（独立实体，量大） | 很高 |
| | `DebtRecord` | — | 低 |
| | `FinancialMetric` | `MetricSource` | 高（每次分析） |
| D4 风险与准备度评估 | `AnalysisRound` | `MetricSnapshot` | 中 |
| | `VerificationItem` | — | 中 |
| | `RiskFinding` | — | 低 |
| | `ReadinessAssessment` | `DimensionResult` | 低 |
| D5 审核与报告 | `ReviewTask` | `ReviewRecord` | 低 |
| | `Report` | `ReportVersion` | 低 |
| D6 平台与智能化 | `User` / `Role` | `Permission` | 低 |
| | `AiTask` | `AiSuggestion` | 高 |
| | `AuditLog` | —（append-only） | 很高 |
| **E 证据与血缘** | `DataVersion` | `VersionMember` | 中 |
| | `EvidenceReference` | — | 很高 |

**为什么 `AnalysisRound` 是聚合根而不是 `FinancingCase` 的子实体**：轮次的创建、完成、作废是独立的事务边界，且一次轮次涉及指标快照、待核实事项、风险事项、评估结果四组数据。把它塞进案件聚合会让案件变成"上帝对象"，任何一次读取都加载全部历史。

---

## 三、E 证据与血缘域（底层能力）

### 3.1 DataVersion 数据版本

一次数据变更产生一个版本。它不存数据本身，只存"哪一版资料构成了这一版数据"。

| 属性 | 说明 |
|---|---|
| versionNo | 案件内递增，V1、V2…… |
| digest | 成员文件版本哈希的有序拼接再哈希，用于判定"数据是否真的变了" |
| triggerType | `INITIAL` / `DOCUMENT_ADDED` / `DOCUMENT_REPLACED` / `DOCUMENT_REMOVED` / `MANUAL_CORRECTION` |
| triggerRef | 触发对象（如 documentVersionId） |
| members | `VersionMember[]`：documentVersionId + 该文件下被采纳的数据行范围 |
| createdAt / createdBy | — |
| status | `ACTIVE` / `SUPERSEDED` |

**核心规则**：`digest` 相同则视为数据未变，不产生新版本，也不触发新一轮分析。这条防的是"企业重传一份一模一样的文件，系统白跑一遍分析并生成一份新报告"。

### 3.2 EvidenceReference 证据引用

统一引用对象。**任何进入报告的结论都必须挂载至少一条。**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| refId | UUID | 是 | — |
| targetType | 枚举 | 是 | `METRIC` / `VERIFICATION_ITEM` / `RISK_FINDING` / `ASSESSMENT` / `REPORT_CLAUSE` |
| targetId | UUID | 是 | 被支撑的对象 |
| evidenceKind | 枚举 | 是 | 见下表 |
| sourceObjectId | UUID | 条件 | 指向的版本化对象（documentVersionId / statementItemId / transactionId / debtId / metricId / reviewRecordId） |
| sourceLocator | 结构 | 否 | 位置：`{page, row, cell, charRange}` 或 `{lineNo}` |
| dataVersionId | UUID | 是 | 该证据所属数据版本 |
| periodLabel | 文本 | 条件 | 涉及的会计期间 |
| formulaCode / formulaVersion | 文本 | 条件 | 计算类证据必填 |
| reviewRecordId | UUID | 否 | 若结论经人工确认，指向该记录 |
| confidence | 数值 | 否 | AI 提取时的置信度，人工录入为空 |
| note | 文本 | 否 | 补充说明，限 200 字 |

**evidenceKind 取值**

| 取值 | 含义 | 典型场景 | 必填的定位信息 |
|---|---|---|---|
| `SOURCE_DOCUMENT` | 原始文件 | 审计报告正文第 12 页 | sourceObjectId + page |
| `EXTRACTED_FIELD` | 提取字段 | 报表"营业收入"科目 | sourceObjectId + page/row |
| `DATA_ROW` | 结构化数据行 | 流水第 3042 行 | sourceObjectId + lineNo |
| `CALCULATION` | 计算结果 | 毛利率 = 毛利润/营业收入 | formulaCode + formulaVersion |
| `RULE_HIT` | 规则命中 | 勾稽差异超阈值 | 规则码 + 命中时的输入值 |
| `HUMAN_REVIEW` | 人工复核 | 复核人确认口径 | reviewRecordId |
| `EXTERNAL_PUBLIC` | 公开信息 | 工商登记信息 | 来源 URL + 快照时间 |

**校验规则（渲染器强制）**

1. `sourceObjectId` 必须指向**已存在**的对象，且该对象未被物理删除。
2. `dataVersionId` 必须等于报告版本所绑定的轮次的 `dataVersionId`。跨版本引用一律拒绝——否则会出现"用第 3 轮的数据支撑第 2 轮的结论"。
3. `CALCULATION` 类必须能找到对应 `FinancialMetric` 记录，且 `formulaVersion` 一致。
4. 校验失败时报告生成**中止**，返回具体缺失项，而不是降级生成一份带空引用的报告。

---

## 四、D1 客户与融资需求

### Customer（聚合根）

| 属性 | 说明 |
|---|---|
| customerId | UUID |
| legalName / unifiedCreditCode / legalRepresentative | 主体信息 |
| establishedOn / registeredCapital / industry / address | 工商信息 |
| businessSummary | 业务概况（**企业自行陈述**，标记来源） |
| status | `ACTIVE` / `INACTIVE` |

**内部实体 Contact**：一个客户多个联系人，恰好一个主联系人。

**不变量**
- 统一社会信用代码全局唯一。
- 主体信息变更不回溯修改历史报告中的快照，历史报告保留当时名称。

### FinancingCase（聚合根）

| 属性 | 说明 |
|---|---|
| caseId / caseNo | UUID / `CPX-2026-0001` |
| customerId | 归属客户 |
| requirement | 值对象版本链：用途、金额、期限、当前融资情况、资金缺口 |
| lifecycle | 案件生命周期状态（见 workflow 文档） |
| ownerUserId | 负责人 |
| version | 乐观锁 |

**为什么需求做成版本链**：金额与用途变更是真实高频事件。变更历史必须能回答"第 2 版需求是什么时候、因为什么改的"。单字段覆盖会永久丢失这个信息。

**不变量**
- 案件不可删除，只能撤回或终止。
- `caseNo` 生成后不可变。
- 生命周期状态变更必须记录操作人、时间、原因、守卫结果。

---

## 五、D2 资料与数据管理

### CaseAuthorization（聚合根）

数据范围拆为**独立子表**（`BANK_STATEMENT` / `FINANCIAL_STATEMENT` / `TAX` / `CREDIT_REPORT` / `DEBT_CONTRACT`），因为"同一范围在同一时刻只能有一条有效授权"需要用数据库约束表达，而 JSON 数组无法约束。

**不变量**
- 授权必须逐项覆盖才能处理对应数据；缺失即拦截，不是提示。
- 撤销即时生效；已生成的分析结果保留但标记"授权已撤销"。
- 拦截点在**服务端**：文档解析入口、数据导入入口、AI 调用入口、报告导出入口四处，而非仅隐藏按钮。

### CaseMaterial（聚合根）— 材料项实例

材料清单（字典）与案件上的实际收集情况必须分开。字典改版不能改写历史案件的要求，且"这份材料确实拿不到"需要一个诚实的落点。

| 属性 | 说明 |
|---|---|
| materialCode | 对应字典项 |
| requirementLevel | 快照：`REQUIRED` / `CONDITIONAL` / `OPTIONAL` |
| status | `REQUIRED` / `REQUESTED` / `RECEIVED` / `PARSED` / `VERIFIED` / `WAIVED` |
| waiverReason / waivedBy | 豁免理由与批准人 |
| documentIds | 关联文件（可多个版本） |

**不变量**
- `REQUIRED` 且未 `VERIFIED`、未 `WAIVED` 时，不允许进入评估阶段。
- `WAIVED` 必须在报告中显式列出"已豁免事项"。给无法取得的资料一个出口，比逼着用户谎报"已解决"更安全。

### Document（聚合根）+ DocumentVersion（内部实体）

| Document 属性 | 说明 |
|---|---|
| docType | 资料类型（对应材料清单编码） |
| currentVersionNo | 当前版本 |
| verificationState | `UPLOADED` / `PARSED` / `VERIFIED` / `REJECTED` / `SUPERSEDED` |

| DocumentVersion 属性 | 说明 |
|---|---|
| versionNo / sha256 / storageKey / pageCount | 版本内容 |
| uploadedAt / uploadedBy / source | 来源 |
| parserVersion | 解析器版本（AI 解析必填） |

**不变量**
- 原始文件不可修改，修正产生新版本。
- `VERIFIED` 只能由人工动作推进；系统自动解析最多到 `PARSED`。
- 文件哈希相同视为重复，提示但不自动拒绝（可能是补传不同期间的同名文件）。

### ImportBatch（聚合根）+ ImportRecord

一次导入 = 一个批次。批次记录解析器类型与版本、行列统计、失败行清单。

**不变量**：批次结果可整体回滚；人工确认后批次锁定，后续修正走调整记录。

### QualityIssue（聚合根）— 质量检查项

| 属性 | 说明 |
|---|---|
| ruleCode | 如 `DQ-CHECK-01`（资产负债勾稽） |
| severity | `BLOCKER` / `MAJOR` / `MINOR` / `INFO` |
| status | `OPEN` / `ACKNOWLEDGED` / `RESOLVED` / `WAIVED` |
| evidenceRefs | 证据引用 |

**与待核实事项的区别**：质量检查项是**系统对数据自身的判断**（勾稽不平、期间断裂、重复行）；待核实事项是**需要向企业澄清的疑问**（收入与回款对不上，为什么）。前者可自动关闭（数据修好了），后者必须有人答复。

---

## 六、D3 财务与经营分析

三个聚合根，一个计算产物。

| 聚合 | 关键约束 |
|---|---|
| `FinancialStatement`（按期间） | 同案件同期间同报表类型仅一套有效数据；重新导入产生新版本 |
| `BankTransaction`（独立实体） | 必须关联批次与原始行号；分类含 `categorySource`（RULE/AI/MANUAL）与 `confirmed` |
| `DebtRecord`（独立实体） | 必须能回溯到合同文件或对账单 |
| `FinancialMetric`（计算产物） | 必须带 formula / formulaVersion / dataVersionId / sourceRefs / computedAt；写入后不可编辑 |

**流水为什么不做聚合**：单案件可达数万行，作为子实体加载会拖垮任何一次查询。按批次组织，按需分页。

**指标为什么是"产物"而非"实体"**：指标没有独立生命周期，它的存在完全依赖于某次计算。允许编辑指标 = 允许篡改结论。

---

## 七、D4 风险与准备度评估

### AnalysisRound（聚合根）— 本轮模型的核心

| 属性 | 说明 |
|---|---|
| roundNo | 案件内递增 |
| caseId / dataVersionId | 绑定数据版本（**不可变**） |
| status | `DRAFT` / `DATA_READY` / `COMPUTED` / `ASSESSED` / `CLOSED` / `SUPERSEDED` |
| metricSnapshotId | 本轮指标快照 |
| assessmentId | 本轮评估结果 |
| startedAt / closedAt | — |
| supersededByRoundNo | 被哪一轮取代 |

**不变量**
- 一轮分析只对应一个数据版本，绑定后不可更换。
- 数据版本变化时，新一轮自动创建；旧轮标记 `SUPERSEDED` 但保留全部内容。
- 只有 `CLOSED` 的轮次才能被报告引用。

### VerificationItem（聚合根）— 待核实事项

| 属性 | 说明 |
|---|---|
| roundNo | 归属轮次；未解决的可继承到下一轮 |
| code | 规则码，如 `VI-REV-01` |
| category | 差异 / 缺失 / 口径 / 字段异常 |
| severity | HIGH / MEDIUM / LOW |
| observation | **只陈述可观察到的事实**，不含定性判断 |
| possibleCauses | 并列的可能原因，不作结论 |
| recommendedAction | 建议补充或澄清的动作 |
| status | `OPEN` / `ANSWERED` / `RESOLVED` / `WAIVED` |

**不变量**
- 表述中不得出现"隐瞒""造假""欺诈""恶意"等定性词，写库前由词典拦截。
- 每条必须有至少一条证据引用。
- 状态与风险事项不可互相替代。

### RiskFinding（聚合根）— 风险事项

与待核实事项的区别：它是**分析层面的判断**，可以带建议与影响判断，但仍不得作违法定性。

| 属性 | 说明 |
|---|---|
| category | 偿债压力 / 资金缺口 / 客户集中 / 账期结构 / 担保安排 |
| severity | HIGH / MEDIUM / LOW |
| statement | 结论陈述（受证据支撑） |
| impact | 对本次融资准备的影响（非授信判断） |
| suggestion | 建议动作 |
| evidenceRefs | ≥1 条 |

### ReadinessAssessment（聚合根）

**只回答"准备得怎么样"，不回答"能不能贷到"。**

五维（**均不含偿债能力**）：

| 维度 | 检查内容 |
|---|---|
| 资料完整性 | 必填资料是否齐备或已豁免 |
| 数据可核验性 | 关键数字能否追溯到具体资料与行号 |
| 口径一致性 | 不同来源的数据能否相互解释 |
| 需求清晰度 | 用途、金额、期限、资金缺口是否明确 |
| 待核实事项 | 是否存在未处理的 HIGH 级事项 |

**输出**：三档结论 + 每维的依据 + 固定免责声明。**不输出分数。**

---

## 八、D5 审核与报告

### ReviewTask（聚合根）

| 属性 | 说明 |
|---|---|
| targetType | `DOCUMENT` / `DATA` / `ASSESSMENT` / `REPORT_VERSION` |
| targetId | 被审对象 |
| status | `PENDING` / `IN_PROGRESS` / `APPROVED` / `CHANGES_REQUESTED` / `REJECTED` |
| selfReviewed | 单人复核标记（首期必须显式记录） |

### Report（聚合根）+ ReportVersion

| ReportVersion 属性 | 说明 |
|---|---|
| versionNo / roundNo | 版本号 / 绑定的分析轮次 |
| status | `DRAFT` / `IN_REVIEW` / `APPROVED` / `ISSUED` / `DELIVERED` / `VOID` |
| contentHash | 内容哈希，同一输入必须得到同一哈希 |
| evidenceCheckResult | 渲染前的证据校验结果 |

**不变量**
- 报告版本必须绑定一个 `CLOSED` 的分析轮次。
- 签发前必须存在 `APPROVED` 的复核记录。
- 签发后内容不可修改，只能作废并出新版本。
- 渲染前必须通过证据校验：每个数字有引用、每条结论有依据。
- 交付记录：时间、方式、接收人、版本号、文件哈希。

---

## 九、不变量总表

代码审查与集成测试的依据。

| 编号 | 不变量 | 检验方式 |
|---|---|---|
| INV-01 | 案件必须属于一个客户；客户可有多案件 | 外键 + 查询断言 |
| INV-02 | 无有效授权不得解析/导入对应数据范围 | 入口拦截测试 |
| INV-03 | 原始文件不可修改，只能新增版本 | 版本表 append-only |
| INV-04 | `VERIFIED` 只能人工推进 | 权限 + 状态机 |
| INV-05 | 指标必须带公式版本与数据版本 | 非空约束 |
| INV-06 | 分析轮次绑定不可变数据版本 | 绑定后禁止更新 |
| INV-07 | `BLOCKER` 质量项或未豁免必填资料未处理，不得进入评估 | 守卫函数 |
| INV-08 | 报告签发前必须有 `APPROVED` 复核记录 | 事务内校验 |
| INV-09 | 报告签发后不可修改 | 状态机 |
| INV-10 | AI 只能写建议表 | 数据库角色权限 |
| INV-11 | 金额只用 `BigDecimal` / `numeric` | ArchUnit + DB 类型 |
| INV-12 | 状态流转必须留痕（人、时间、原因、守卫结果） | 事件表非空 |
| INV-13 | 表述不得含定性指控词 | 写库前词典拦截 |
| INV-14 | 报告中的数字与结论必须有 `EvidenceReference` | 渲染器校验 |
| INV-15 | 准备度结论不得含授信判断 | 文案模板 + 评审 |
| INV-16 | 新数据版本必须开启新一轮分析 | 事件驱动创建 |
| INV-17 | 待核实事项与风险事项不得互相替代 | 类型系统区分 |
| INV-18 | 证据引用的 `dataVersionId` 必须等于轮次的数据版本 | 渲染器校验 |
| INV-19 | 同一数据版本 `digest` 不变则不产生新版本 | 哈希判定 |
| INV-20 | 待核实事项的继承必须保留原轮次记录 | 新轮只复制未解决项 |

---

## 十、域间协作

| 场景 | 方式 | 理由 |
|---|---|---|
| 案件推进需检查授权 | 同步调用 `AuthorizationQueryPort` | 必须立即知道结果 |
| 资料核验完成 | 事件 `DocumentVerified` → 案件域 | 资料域不该知道案件状态机 |
| 资料变更 | 事件 `DataVersionCreated` → 自动开启新轮次 | 轮次由数据驱动，不由人点按钮 |
| 轮次完成 | 事件 `RoundClosed` → 生成复核任务 | 解耦 |
| 报告签发 | 同步调用 `ReviewQueryPort` 校验 | 签发必须强一致 |
| 敏感操作 | 异步写 `AuditLog` | 不阻断主流程 |
| 证据引用校验 | 报告渲染前同步调用 `EvidenceQueryPort` | 不可达即中止渲染 |

首期不引入消息队列，用 Spring 事件同步分发，失败即回滚。

---

## 十一、需要你确认

1. **轮次触发方式**：资料变更即自动开新轮，还是由人点"重新分析"？（我建议自动开轮 + 允许人手动作废本轮）
2. **待核实事项继承**：未解决项自动带入下一轮，还是要求人逐条决定？（我建议自动带入并标注"继承自第 N 轮"）
3. **报告与轮次是否一对一**：一份报告只能引用一个轮次，还是可以合并多轮结论？（我建议一对一，"合并多轮"会让证据校验失去意义）
4. **`WAIVED` 的审批权**：首期只有你一人时，豁免是否只需签字确认即可？
