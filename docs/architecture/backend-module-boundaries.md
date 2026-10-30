# CPX-ARCH-02 后端模块边界

- 编号：CPX-ARCH-02
- 状态：待确认
- 前置：`docs/product/product-baseline-v1.md`（V1.0，最高约束）、`docs/business/financing-domain-model.md`（CPX-BIZ-01）、`docs/decisions/ADR-001-工程基线.md`、`docs/architecture/system-architecture.md`（CPX-ARCH-01）
- 技术前提（不再讨论）：Java 21 + Spring Boot 4.0.8 + MyBatis + PostgreSQL 16 + Flyway
- **⚠ 本文档关于"首期单 Maven 工程、不拆子模块"的裁定已被 `docs/decisions/ADR-002-多模块结构.md` 取代**：实现改为 19 个 Maven 子模块，边界由 POM 在编译期强制。第 6 行、第 20 行、第十一章的表述以 ADR-002 为准；依赖矩阵与 ArchUnit 断言仍然有效。
- 作用：把 CPX-ARCH-01 §4 的"工程结构"从一张目录草图细化成可执行、可断言、可评审的模块契约。本文与 CPX-ARCH-01 §4 冲突处，以本文为准（差异见 §十二）

## 〇、一页结论

| 项 | 裁定 |
|---|---|
| 包总数 | 18 个（16 个业务模块 + 2 个基础模块），聚合根 23 个 |
| 分层 | 每个业务模块固定四层 `api / application / domain / infrastructure`，依赖单向向内 |
| 依赖方向 | 10 级纵向阶梯（§三）；**向下直接依赖 application 接口，同级与向上一律走 Port** |
| 跨模块写 | 只通过 application 接口与领域事件；**任何模块不得直接调用他域 Mapper 写库** |
| 证据 | `evidence` 是唯一允许被所有域直接依赖的模块，且它不依赖任何业务域 |
| 审计 | 仅 `audit` 可写 `cpx_audit_log`，其余模块只可调 `AuditPort` |
| AI | 仅 `aigateway` 可出站；业务模块只可见 `common.ai.AiSuggestionPort`；`report` 连这个也不可见 |
| 边界强制 | 单 Maven 工程 = 无编译期隔离，**全部靠 ArchUnit 断言 + CI 拦截**（§七，16 条） |

**一句话风险提示**：单工程按包分模块的唯一防线是架构测试。没有 §七 的 16 条断言，本文所有规则都只是文档，三个月后必然退化为"一个大包"。

## 一、六域到 Java 包的映射

根包 `com.coolpilotx`。域与包的对应关系**严格按产品基线 §三**：D1–D6 六个业务域 + E 横切证据域。

| 域 | Java 包 | 聚合根 | 对外暴露的应用服务接口（方法要点） |
|---|---|---|---|
| **D1 客户与融资需求** | `customer` | `Customer`（含 `Contact`） | `CustomerAppService`：`create / update / archive / changePrimaryContact`；`CustomerQueryService`：`get / page / byCreditCode` |
| | `case` | `FinancingCase`（含 `FinancingRequirement` 版本链） | `CaseAppService`：`create / changeRequirement / transition(expectedFrom, expectedVersion) / assignOwner / withdraw`；`CaseQueryService`：`detail / timeline / page` |
| **D2 资料与数据管理** | `authorization` | `CaseAuthorization`（含 `AuthorizationScope`） | `AuthorizationAppService`：`grant / revoke / listActive`；`AuthorizationQueryService`：`covers / activeScopes / history` |
| | `document` | `CaseMaterial`、`Document`（含 `DocumentVersion`） | `DocumentAppService`：`upload / addVersion / verify / reject / deleteUploaded / openContent`；`MaterialAppService`：`initCompleteness / request / waive / completeness`；`DocumentQueryService`：`versions / metadata` |
| | `dataimport` | `ImportBatch`（含 `ImportRecord`） | `ImportAppService`：`submit / retry / confirm / getBatch / pageRecords` |
| | `dataquality` | `QualityIssue` | `QualityAppService`：`runRules(dataVersionId) / acknowledge / resolve / waive / listOpen` |
| **D3 财务与经营分析** | `finance`（子包 `statement` / `transaction` / `debt` / `metric`） | `FinancialStatement`、`BankTransaction`、`DebtRecord`、`FinancialMetric` | `StatementAppService`：`importVersion / listByPeriod / items`；`TransactionAppService`：`page / classify / confirmCategory / summary`；`DebtAppService`：`register / update / list`；`MetricAppService`：`calculateForVersion / recalculate`；`MetricQueryService`：`byPeriod / latest / snapshot` |
| **D4 风险与准备度评估** | `analysis` | `AnalysisRound`（含 `MetricSnapshot`） | `AnalysisRoundAppService`：`openOnVersion / compute / close / supersede / inheritUnresolved`；`RoundQueryService`：`get / listByCase / closedRound` |
| | `assessment` | `VerificationItem`、`RiskFinding`、`ReadinessAssessment`（含 `DimensionResult`） | `VerificationAppService`：`openFromRules / answer / resolve / waive`；`RiskFindingAppService`：`draft / confirm / list`；`AssessmentAppService`：`generate / get / latest` |
| **D5 审核与报告** | `review` | `ReviewTask`（含 `ReviewRecord`） | `ReviewAppService`：`openTask / claim / decide / listPending`；`ReviewQueryService`：`latestApproval / history` |
| | `report` | `Report`（含 `ReportVersion`、`ReportClause`） | `ReportAppService`：`createVersion / render / submitForReview / issue / deliver / void`；`ReportQueryService`：`versions / preview / delivery` |
| **D6 平台与智能化** | `identity` | `User` / `Role`（含 `Permission`） | `AuthAppService`：`login / logout / me`；`UserAdminAppService`：`create / disable / assignRole` |
| | `audit` | `AuditLog`（append-only） | `AuditQueryService`：`byTarget / byActor / page`；写入只经 `AuditPort` |
| | `aigateway` | `AiTask`（含 `AiSuggestion`） | `AiTaskAppService`：`submit / poll / cancel`；`AiSuggestionAppService`：`accept / reject / listPending`（**仅建议面板可用**） |
| | `knowledge` | `KnowledgeClause`（首期弱聚合，仅字典级） | `KnowledgeAppService`：`upsertClause / disable`；`RetrievalQueryService`：`search` |
| **E 证据与数据血缘** | `evidence` | `DataVersion`（含 `VersionMember`）、`EvidenceReference` | `DataVersionAppService`：`createOnDocumentChange / list / resolveMembers`；`EvidenceAppService`：`attachBatch / byTarget / trace`；`EvidenceValidationService`：`validateForReport`（不对外发布） |
| 基础 | `common` | — | `common.kernel`（`DataScope`、`ActorContext`、`PageResult`）、`common.port`（`AuditPort`、`StoragePort`、`AiSuggestionPort`、`RetrievalPort`）、`common.error` |
| | `infrastructure` | — | 无业务语义的技术实现：`storage.LocalStorageAdapter`、`config`、`web`（全局异常、拦截器） |

**映射的五条硬性说明**

1. **D4 对应两个包**（`analysis` / `assessment`）。`AnalysisRound` 事务边界独立（CPX-BIZ-01 §二），`analysis` 不得依赖 `assessment`，反向允许。
2. **`finance` 四个子包单向**：`metric` 依赖其余三个，反向禁止——指标是计算产物，不得反向修改财务事实。
3. **`document` 承载两个聚合根**（`CaseMaterial` / `Document`）：材料项状态由文件核验驱动，拆包只会得到一个 60 行的空模块。
4. **`aigateway` 不是业务模块**：无业务聚合，`AiTask` 只是出站记账；任何业务模块不得 import `aigateway.**`（§七 A-08）。
5. **`knowledge` 与 `evidence` 是本文新增包**：D6 的"知识库"与 E 域在 CPX-ARCH-01 §4.1 中均无落地位置（见 §十二 修正 1、2）。

## 二、四层结构：职责与禁止事项

每个业务模块内部固定四层。目录形如 `com.coolpilotx.case.{api,application,domain,infrastructure}`。

| 层 | 职责 | 允许依赖 | 禁止事项 |
|---|---|---|---|
| `api` | Controller、请求/响应 DTO、Bean Validation 注解、DTO↔领域对象的**无逻辑**转换、HTTP 状态码映射 | 本模块 `application`；`common.error`；`common.kernel` | 禁止写业务判断（`if (status == ...)`）、禁止直接调 Mapper、禁止 import 他域任何包、禁止在 Controller 组装跨聚合流程 |
| `application` | 用例编排、**事务边界**、鉴权与授权拦截、事件发布、端口调用、DTO 组装（读侧） | 本模块 `domain`、本模块 `infrastructure`（仅查询）、他域更低层级的 `application` 接口、他域 `domain.port` | 禁止实现业务规则（规则在 `domain`）；禁止直接写 SQL；禁止在事务内做 HTTP/文件 IO（AI、存储、下载） |
| `domain` | 聚合、实体、值对象、状态机、守卫、领域事件、**本模块 Port 接口定义** | 仅 JDK + `common.kernel`（纯值对象）+ 他域 `domain.port`（仅在同级协作时） | 禁止 Spring 任何注解与类型、禁止 MyBatis、禁止 `@Transactional`、禁止持有 `ApplicationEventPublisher`、禁止 IO、禁止读系统时钟（`Instant.now()` 须由参数传入） |
| `infrastructure` | MyBatis Mapper 接口与 XML、仓储实现、`Port` 适配器（`adapter` 子包）、只读查询 SQL（`read` 子包）、外部客户端 | 本模块 `domain`、`common.port`、框架 | 禁止被 `domain`/`application` 反向依赖具体类（`application` 只能依赖其实现的接口）；禁止在 Mapper 里做业务判断；禁止跨域写库 |

### 2.1 为什么 `domain` 不能依赖 Spring

| 理由 | 具体后果 |
|---|---|
| **可裸测** | 13 主状态 + 4 异常状态的转换表、守卫函数必须是纯函数（MVP P0-02 关键要点②）。带 `@Service` 的聚合类无法在不启动容器的情况下遍历断言；一旦需要 `@SpringBootTest`，状态机测试从毫秒级变成分钟级，人就再也不跑它 |
| **事务语义不得渗入模型** | `@Transactional` 标在聚合方法上，会把"一次业务动作"切成多个事务；更常见的是自调用导致注解失效，产生"看起来原子、实际不原子"的写入 |
| **不变量不能被基础设施替代** | 领域不变量（如"报告签发前必须有 APPROVED 复核"）一旦落到 Mapper/触发器里，就无法在应用层给出"缺哪一项"的可读原因（ADR-001 A-07 要求守卫返回 `blockingItems`） |
| **边界可迁移** | 单工程将来若拆模块，`domain` 应能零改动搬走。依赖 Spring 的 domain 搬走时要连带搬容器配置，等于没拆 |

### 2.2 为什么 `domain` 不能依赖 MyBatis

| 理由 | 具体后果 |
|---|---|
| **表结构变化会穿透业务判断** | `@Select`/`RowMapper` 一旦进 domain，字段改名要从 SQL 一路改到不变量校验，且编译器不报错、只在运行时炸 |
| **懒加载与 N+1 污染模型** | 聚合内的"按需加载子集合"会让 `case` 详情页在渲染时触发 20 次查询，性能问题被藏进模型 |
| **金额与精度** | MyBatis 的 `DoubleTypeHandler` 一旦参与，`numeric(18,2)` 精度在映射层就丢了（INV-11、ADR-001 A-02）。domain 只接受 `BigDecimal`，映射责任必须在 infrastructure |
| **测试要连库** | 依赖 Mapper 的守卫函数必须起 PG + Flyway 才能测，而守卫是最高频变更代码（`transition` 每次都要过守卫） |

**反向约束**：`application` 也不得依赖 Mapper 具体类，只能依赖 `domain` 定义的 repository/port 接口，实现由 `infrastructure` 提供。唯一例外是**只读查询**：`application` 可直接调用本模块 `infrastructure.read` 的查询服务（避免为每个列表页造一个仓储），但不得借此写库。

## 三、模块依赖矩阵

### 3.1 十级纵向阶梯

| 级别 | 模块 | 说明 |
|---|---|---|
| L0 | `common` | 纯工具、共享值对象、横切 Port 定义。不依赖任何业务模块 |
| L1 | `evidence`、`audit`、`aigateway`、`knowledge`、`identity` | 横切能力层。只依赖 L0 |
| L2 | `customer` | 独立主数据，不知道案件存在 |
| L3 | `case` | 只表达流程，不知道如何算账、如何评 |
| L4 | `authorization`、`document`、`dataimport` | 资料与数据入口 |
| L5 | `finance` | 财务事实与指标（含四个子包） |
| L6 | `dataquality` | 对财务事实施加校验规则 |
| L7 | `analysis` | 轮次与快照 |
| L8 | `assessment` | 待核实事项、风险事项、就绪结论 |
| L9 | `review` | 复核任务与记录（泛化 target，不认识具体业务对象） |
| L10 | `report` | 报告版本、渲染、签发、交付 |

### 3.2 依赖白名单（谁可以依赖谁）

| 模块 | 可直接依赖的模块（import 其 `application` 接口） | 必须走 Port 的协作 |
|---|---|---|
| `common` | 无 | — |
| `infrastructure` | `common` | — |
| `evidence` | `common`、`audit`(Port) | 存在性校验通过 `EvidenceSourcePort`（他域实现） |
| `audit` | `common` | — |
| `aigateway` | `common`、`audit`(Port) | 只向 `common.ai.AiSuggestionPort` 注册实现 |
| `knowledge` | `common` | 只向 `common.retrieval.RetrievalPort` 注册实现 |
| `identity` | `common`、`audit`(Port) | 只向 `common.kernel.ActorContext` 供给者注册 |
| `customer` | `common`、`evidence`、`audit`(Port) | — |
| `case` | `common`、`customer`、`evidence`、`audit`(Port) | `AuthorizationQueryPort`、`MaterialReadinessPort`、`QualityGatePort` |
| `authorization` | `common`、`evidence`、`audit`(Port) | — |
| `document` | `common`、`evidence`、`audit`(Port) | `AuthorizationQueryPort` |
| `dataimport` | `common`、`evidence`、`audit`(Port) | `AuthorizationQueryPort`、`DocumentSourcePort` |
| `finance` | `common`、`dataimport`、`evidence`、`audit`(Port) | `AuthorizationQueryPort` |
| `dataquality` | `common`、`finance`、`dataimport`、`evidence`、`audit`(Port) | — |
| `analysis` | `common`、`finance`、`dataquality`、`evidence`、`audit`(Port) | — |
| `assessment` | `common`、`analysis`、`finance`、`evidence`、`audit`(Port) | `AiSuggestionPort`（仅措辞建议） |
| `review` | `common`、`evidence`、`audit`(Port) | — |
| `report` | `common`、`review`、`evidence`、`audit`(Port) | `RoundQueryPort`、`AssessmentQueryPort`、`MetricQueryPort`、`ReviewQueryPort`、`EvidenceQueryPort`、`StoragePort` |

**注意两处刻意的"能用却不用"**：`report` 对 `review` 虽在更低层级，仍走 `ReviewQueryPort`——只为拿"是否存在 APPROVED 记录"这一个窄契约，不让报告模块获得复核的写入能力。`assessment` 对 `finance` 同理走 `MetricQueryPort`，避免评估逻辑直接遍历指标表。

### 3.3 显式禁止的依赖（红线）

| 编号 | 禁止 | 后果（为什么是红线） |
|---|---|---|
| N-01 | `case` → `finance` / `analysis` / `assessment` / `report` | 案件会开始"顺手算一下"，状态机与算账耦合，改指标口径要动状态机 |
| N-02 | `finance` → `analysis` / `assessment` | 指标是事实、分析是解释。反向依赖会让"解释"倒灌进"事实"，历史指标不可复现 |
| N-03 | `assessment` → `report` / `review` | 评估必须先于报告独立存在，否则评估会被报告格式倒逼 |
| N-04 | `analysis` → `assessment` | 否则 D4 两包成环，轮次关闭时无法判断"评估尚未生成"的合法中间态 |
| N-05 | 任何业务模块 → `aigateway.**` | ADR-001 A-09 要求 AI 只有一条出站通道。绕过端口 = AI 建议可直写业务表路径被打开 |
| N-06 | `report` → `common.ai` / `RetrievalPort` | 报告渲染必须确定性（P5、CPX-ARCH-01 R4）；渲染路径一旦可调 AI，`contentHash` 失去意义 |
| N-07 | 任何模块 → `*/domain/**`（他域）、`*/infrastructure/**`（他域） | 越过契约直接改别人的模型 |
| N-08 | 非 `audit` 模块 → `cpx_audit_log` 的任何 Mapper | INV-10 的反面：审计一旦可被业务改写，追溯失效 |
| N-09 | `evidence` → 任何 D1–D6 模块（`document`/`finance`/`review` 等） | E 域按 `targetType + targetId` 泛化引用。一旦反向认识具体聚合，任何业务表变更都会打穿证据层 |
| N-10 | `common` → 任何 `com.coolpilotx.*`（`common` 自身除外） | 违反即架构腐烂第一信号（`common` 会退化成业务垃圾桶） |
| N-11 | `api` → 他域任何包 | 跨域编排只能发生在 `application`，否则事务边界失控 |
| N-12 | 任何模块 → `dataquality` 的写接口（除 `case` 的读端口） | 质量项的关闭必须由规则重跑或人工动作驱动，不能被他域"顺手改状态" |

### 3.4 允许跨域读表，但不允许跨域写表

| 场景 | 允许 | 约束 |
|---|---|---|
| 列表页/详情页聚合查询 | 允许在 `infrastructure.read` 直查他域表或视图（CPX-ARCH-01 §6.1 "只读查询服务直拼 SQL"） | 只读事务；禁止在 SQL 里做业务判断（用 `CASE WHEN` 推导状态即违规）；必须显式 `deleted_at IS NULL` |
| 任何写操作 | 禁止 | 唯一路径：他域 `application` 接口或领域事件 |
| 跨域写入的例外 | 无 | 包括"只改一个字段"也不允许 |

## 四、端口与适配器

### 4.1 端口的两个归属地

| 类别 | 定义位置 | 实现位置 | 理由 |
|---|---|---|---|
| 横切端口（无业务语义） | `common.port` | 对应能力模块 `infrastructure.adapter` | 避免每个业务模块各自声明一遍 `AuditPort`；`mvp-scope` P0-01 已裁定 `AuditPort` 定义在 `common` |
| 跨域查询端口 | **消费方** `domain.port` | **提供方** `infrastructure.adapter` | 接口跟着需求走：谁需要数据谁定义契约，提供方只负责满足。这样提供方换实现不影响消费方，且消费方拿不到写能力 |

**为什么不把业务端口也塞进 `common`**：`common` 一旦出现 `AuthorizationQueryPort`，就必须认识 `DataScope`、`CaseId` 等业务概念，之后每个域的 DTO 都会想搬进来，`common` 变成第二个上帝包（反模式 P-06）。

### 4.2 关键端口清单

| 端口 | 定义 | 实现 | 方法签名要点 |
|---|---|---|---|
| `AuthorizationQueryPort` | `case.domain.port`（`document`、`dataimport`、`finance` 复用） | `authorization.infrastructure.adapter` | 只读；必须带 `Instant at`，**不得有默认值**（撤销即时生效）；返回空集表示无授权，不抛异常；不得返回授权实体本身，只返回范围枚举 |
| `EvidenceQueryPort` | `report.domain.port` | `evidence.infrastructure.adapter` | 入参必须是"待校验声明集合"而非"报告 ID"，避免校验时反查库；返回 `EvidenceCheckResult` 必须包含 `List<MissingEvidence>`（含 targetType + targetId + 缺失原因），供前端展示"缺哪一条" |
| `ReviewQueryPort` | `report.domain.port` | `review.infrastructure.adapter` | 只回答 `latestApproval(targetType, targetId)`，返回 `Optional<ReviewApproval>`；不返回任务列表、不提供 `decide` |
| `AiSuggestionPort` | `common.port` | `aigateway.infrastructure.adapter` | **只有 `submit`（入队）与 `find`/`pending`（查询）**，没有"同步生成"方法；返回体不得含裸数字（P5）；调用方必须能处理"任务不存在/超时" |
| `StoragePort` | `common.port` | `infrastructure.storage.LocalStorageAdapter` | `put` 的 key 由调用方构造且必须已规范化（不接受原始文件名）；`open` 返回流，不返回 `byte[]`（几十 MB 文件不得进堆）；无 `update`，只 `put` 新版本 + `delete`（仅 `UPLOADED` 状态） |
| `AuditPort` | `common.port` | `audit.infrastructure.adapter` | `record(AuditEntry)` 必须**不抛异常**（队列满降级同步写并 WARN）；入参不得含业务实体，只含 `actorType/action/targetType/targetId/result` |
| `RetrievalPort` | `common.port` | `knowledge.infrastructure.adapter` | `search(query, topK)` 返回带 `clauseId + score`；知识库不可用时返回空列表而非异常（A-11 降级要求） |
| `EvidenceSourcePort` | `evidence.domain.port` | `document` / `finance` / `review` 各自 `infrastructure.adapter`（Spring 注入 `List<EvidenceSourcePort>`） | `exists(evidenceKind, sourceObjectId)`；按 `evidenceKind` 路由，多个实现按支持的 kind 集合注册，冲突时启动失败 |
| `MetricQueryPort` | `assessment.domain.port` | `finance.infrastructure.adapter` | 必须按 `dataVersionId + metricCode + period` 三元组查，禁止"取最新"；返回含 `formulaCode/formulaVersion` |
| `RoundQueryPort` | `report.domain.port` | `analysis.infrastructure.adapter` | `closedRound(roundId)` 返回 `Optional`，非 `CLOSED` 状态返回空而非异常 |
| `MaterialReadinessPort` | `case.domain.port` | `document.infrastructure.adapter` | 一次返回全量齐备性快照（禁止在循环里逐条查，MVP P0-03 ⑥） |
| `QualityGatePort` | `case.domain.port` | `dataquality.infrastructure.adapter` | `blockers(caseId)` 只返回 `BLOCKER` 且未 `RESOLVED`/`WAIVED` 的项，供守卫 G5 组装 `blockingItems` |
| `DocumentSourcePort` | `dataimport.domain.port` | `document.infrastructure.adapter` | `storageKeyOf(documentVersionId)`；不返回 `Document` 聚合 |

### 4.3 三段签名示意（仅示意，不含实现）

```java
public interface AuthorizationQueryPort {
    boolean covers(UUID caseId, DataScope scope, Instant at);
    Set<DataScope> activeScopes(UUID caseId, Instant at);
}

public interface EvidenceQueryPort {
    EvidenceCheckResult validate(UUID dataVersionId, List<EvidenceClaim> claims);
    List<EvidenceView> byTarget(EvidenceTargetType type, UUID targetId);
}

public interface AiSuggestionPort {
    AiTaskId submit(AiTaskRequest request);          // 只入队，不同步等待结果
    Optional<AiSuggestion> find(AiTaskId taskId);
    List<AiSuggestion> pending(AiTaskType type, UUID targetId);
}
```

### 4.4 适配器编写规则

| 规则 | 说明 |
|---|---|
| 命名 | `XxxAdapter` 且位于 `infrastructure.adapter`；同一端口有多个实现时后缀区分（`LocalStorageAdapter`、`MinioStorageAdapter`） |
| 单一职责 | 一个适配器只实现一个端口，禁止 `XxxAdapter implements A, B, C` |
| 不得复用 Mapper | 适配器可以调本模块自己的查询服务，但不得让消费方拿到 Mapper |
| 异常转换 | 端口实现必须把技术异常转成端口契约内的异常（如 `StorageUnavailable`），不得把 `SQLException` 漏给 `domain` |
| 只读端口必须只读 | 提供方实现只读端口时，只能用只读 Mapper；代码评审必查项 |

## 五、跨模块调用规则与领域事件

### 5.1 同步还是事件：判定标准

按顺序回答三个问题，第一个"是"即定性，不再往下问。

| 顺序 | 问题 | 是 | 否 |
|---|---|---|---|
| 1 | **调用方是否必须立刻拿到结果才能继续？**（守卫判定、签发前校验、渲染前证据校验） | 同步 | 下一问 |
| 2 | **失败是否必须让调用方的事务回滚？**（不变量要求原子） | 同步 | 下一问 |
| 3 | 剩余全部情况：通知他域"已发生的事实"，接收方可延迟处理 | — | **领域事件** |

**推论（必须写进评审清单）**：凡是"必须回滚"的场景，就不允许用事件表达。事件是"事实已发生"的广播，不是"请你也做一件事"的指令。把指令塞进事件的典型症状是：订阅方失败，发布方已提交，两边永久不一致且无人对账。

### 5.2 事件的两种时机

| 类型 | 发布时机 | 失败处理 | 适用 |
|---|---|---|---|
| 一致性事件 | 发布方事务内同步（`ApplicationEventPublisher.publishEvent`，监听器同线程） | 监听器抛异常 → 整体回滚 | 派生数据必须与主数据同生同灭（如资料变更与数据版本） |
| 通知事件 | 事务提交后（`@TransactionalEventListener(AFTER_COMMIT)`），同线程同步执行 | 记 WARN + 对账任务补偿，不回滚 | 跨聚合同步、投影刷新、时间线 |

**为什么大部分事件放在提交后**：CPX-BIZ-01 §十 的原则是"失败即回滚"，但它同时要求"首期不引入消息队列"。若把所有事件都放事务内，`DataVersionCreated` 触发开轮失败会导致资料核验回滚——用户看到"核验失败"，真实原因却是"轮次创建失败"，且重试会重复核验。**裁定**：只有 `DocumentChanged` 走一致性事件（它的失败语义确实是"资料核验没完成"），其余全部走通知事件 + 对账补偿。这与 CPX-BIZ-01 §十的意图一致（同步分发、无 MQ），只是把"哪些必须回滚"逐条落定。

**两条硬约束**：① 事务内事件处理器禁止任何外部 IO（HTTP、文件、AI），否则单事务时长不可控；② 提交后事件处理器不得修改发布方聚合（只读或写自己的聚合）。

### 5.3 首期全部领域事件

| # | 事件 | 发布方 | 订阅方 | 时机 | 载荷要点 | 失败后果与补偿 |
|---|---|---|---|---|---|---|
| E-01 | `DocumentChanged`（ADDED/REPLACED/REMOVED/MANUAL_CORRECTION） | `document` | `evidence` | **事务内** | `caseId, documentId, documentVersionId, sha256, changeType, occurredAt` | 回滚资料变更。不产生版本即意味着后续分析基于旧数据（INV-19） |
| E-02 | `DataVersionCreated` | `evidence` | `analysis` | 提交后 | `caseId, dataVersionId, versionNo, digest` | 对账任务每 5 分钟扫描"ACTIVE 版本无对应轮次"并补建（INV-16） |
| E-03 | `DocumentUploaded` | `document` | `dataimport` | 提交后 | `importBatchId, documentVersionId, importType, storageKey` | 补偿扫描 `PENDING` 超 2 分钟的批次重新投递（幂等） |
| E-04 | `ImportBatchConfirmed` | `dataimport` | `finance` | 提交后 | `caseId, importBatchId, parserVersion, rowCount` | 提供 `recalculate` 手工入口；指标缺失可由对账任务发现 |
| E-05 | `MetricRecalculated` | `finance` | `dataquality` | 提交后 | `caseId, dataVersionId, metricCodes` | 质量规则可由人工重跑 |
| E-06 | `AnalysisRoundComputed` | `analysis` | `assessment` | 提交后 | `caseId, roundId, dataVersionId, snapshotId` | 提交后事件失败 → 轮次停在 `COMPUTED`，可手工"生成评估" |
| E-07 | `AnalysisRoundClosed` | `analysis` | `review` | 提交后 | `caseId, roundId, assessmentId` | 复核台显示"待建任务"入口，人工补建 |
| E-08 | `AssessmentCompleted` | `assessment` | `case` | 提交后 | `caseId, roundId, assessmentId, readinessOutcome` | 时间线短暂缺行；守卫读时实时查询，不受影响 |
| E-09 | `ReviewDecided` | `review` | `report`、`case` | 提交后 | `reviewTaskId, targetType, targetId, decision` | 签发时同步调 `ReviewQueryPort` 兜底（INV-08），事件丢失不阻塞签发 |
| E-10 | `ReportIssued` | `report` | `case` | 提交后 | `caseId, reportId, reportVersionNo, issuedAt` | 案件生命周期推进由守卫补偿；报告本身已可交付 |
| E-11 | `ReportDelivered` | `report` | `case` | 提交后 | `caseId, reportId, deliveredAt, channel` | 同上；交付记录本身在 `report` 内已落库 |
| E-12 | `AuthorizationRevoked` | `authorization` | `finance`、`analysis`、`assessment` | 提交后 | `caseId, dataScope, revokedAt` | **安全拦截不依赖本事件**（靠 `AuthorizationQueryPort` 实时查）；本事件只负责把已生成结果标记"授权已撤销"，失败由对账任务补齐 |
| E-13 | `MaterialWaived` | `document` | `assessment` | 提交后 | `caseId, materialCode, waivedBy, reason` | 报告"已豁免事项"章节在渲染时实时查询材料快照，不依赖事件 |

**事件类的硬约定**：命名为过去式 + `Event` 后缀，位于 `domain.event`；只含 ID 与原语，**不得携带聚合对象**（否则订阅方会误用过期快照）；字段全部 `final`；不得含 `BigDecimal` 以外的数值类型。

## 六、事务边界

### 6.1 必须单事务的操作

| 操作 | 事务内原子对象 | 依据 |
|---|---|---|
| 案件状态流转 | `cpx_financing_case`（含乐观锁 `version`）+ `cpx_case_status_event` + 守卫结果 | INV-12；一次流转要么全留痕要么不流转 |
| 资料上传受理 | `cpx_document` + `cpx_document_version` + `cpx_import_batch`（PENDING）+ 审计（异步） | CPX-ARCH-01 §3.2 TX1 |
| 资料核验 | `document_version.verification_state` + `cpx_case_material.status` + `cpx_data_version`（含成员） | INV-04 + E-01 一致性事件 |
| 指标计算落库 | `cpx_financial_metric` 全量 + `cpx_metric_source` + `cpx_metric_snapshot` + 轮次状态 | INV-05；快照与指标错位会让报告引用到不存在的指标 |
| 评估生成 | `cpx_assessment` + `cpx_dimension_result` + `cpx_risk_finding` + 本批 `cpx_evidence_reference` | INV-14；结论与证据必须同生同灭 |
| 报告版本创建 | `cpx_report_version` + `cpx_report_clause` + 本版 `cpx_evidence_reference` + `evidence_check_result` | 见 §6.3 |
| 报告签发 | `report_version.status` + 签发动作记录 + 状态事件 | INV-08/INV-09；签发不可逆 |
| 质量项关闭 | `cpx_data_quality_issue.status` + 处置记录 | 状态与原因不得分离 |

### 6.2 为什么"导入 5 万行流水"不能单事务

| 维度 | 单事务的实际后果 | 数据 |
|---|---|---|
| WAL 与 I/O | 5 万行 × 约 250B ≈ 12.5MB 数据 + 索引，WAL 通常为其 3–5 倍，单事务提交前需一次 fsync 全部日志 | 单事务 WAL 40–60MB |
| 内存 | MyBatis `ExecutorType.BATCH` 的 pending statements 在 commit 前不释放，5 万行参数对象留在堆内 | 峰值数百 MB，与 `-Xmx1g` 冲突 |
| 锁与膨胀 | 长事务持有一个快照，期间 autovacuum 无法回收该 xmin 之后的死元组；同案件其他写入被阻塞 | 全库膨胀，不止本表 |
| 超时 | 单事务时长 45–60s，远超 `leak-detection-threshold=20000ms`，连接池（10）被单个导入占满 | 期间所有请求 3s 后 `connection-timeout` 失败 |
| 失败成本 | 60s 预算下无重试余量；任一行失败即全量重来 | 一次失败 = 一次 60s 白跑 |
| 与不变量的一致性 | "批次结果可整体回滚"是**业务语义**，不需要数据库级原子性来证明 | CPX-BIZ-01 §五 ImportBatch 不变量 |

**裁定（与 CPX-ARCH-01 §3.2 一致）**：每 2000 行一个独立事务（25 批，单批 <500ms），终态 `TXf` 单独提交。业务级回滚靠 `DELETE FROM cpx_bank_transaction WHERE import_batch_id = ?` 一条语句完成。三个前提条件缺一不可：① `import_batch_id` 在所有明细行上非空且有索引；② 批次状态机 `PENDING → PARSING → PARSED / FAILED`，只有 `PARSING/FAILED` 允许按批次删除；③ `CONFIRMED` 后禁止按批次删除，修正走调整记录。

### 6.3 证据引用写入与报告渲染的事务关系

| 步骤 | 事务 | 动作 | 失败后果 |
|---|---|---|---|
| ① 收集挂点 | TX-R 内 | 依据本轮已关闭轮次的快照、评估结果，生成 `ReportClause` 骨架与数字挂点（`{{metric:CODE:PERIOD}}`），clauseId 由应用层预生成 UUID | 无落库，直接失败 |
| ② 组装证据声明 | TX-R 内 | 每个挂点生成 `EvidenceClaim`（targetType + targetId + evidenceKind + dataVersionId + formulaCode/Version） | 同上 |
| ③ **同步校验** | TX-R 内（只读子查询） | `EvidenceQueryPort.validate(dataVersionId, claims)` 逐条校验存在性、版本一致、计算可回溯 | **中止整个事务**，返回 `MissingEvidence[]`；不落任何版本 |
| ④ 落库 | TX-R 内 | `report_version` + `report_clause` + `evidence_reference`（批量）+ `evidence_check_result` + 置 `IN_REVIEW` | 整体回滚，无半成品 |
| ⑤ 渲染 | **无事务** | 只读渲染为 HTML/PDF，计算 `contentHash`，产物写 `storage/reports/...` | 版本停在 `IN_REVIEW`；可重复渲染（幂等，输入相同则哈希相同） |

**四条不可协商的规则**

1. **证据引用与报告版本同事务定稿**。不允许"先出版本、后补证据"，否则会出现"已签发但证据不全"的窗口。
2. **渲染在事务外**。渲染 ≤3s 且要读文件系统、写存储，放进事务会直接违反 §6.2 的长事务约束。
3. **渲染不得回写证据**。渲染器只消费已定稿的证据集；需要新证据 = 作废该版本重走 ①–④。
4. **签发时再校验一次（只读）**。`issue` 事务内重新执行 `EvidenceQueryPort.validate`，防"版本创建后底层资料被替换"。两次校验的对象不同：③ 校验"是否可进入复核"，签发校验"复核后是否仍然成立"。

### 6.4 允许最终一致的操作

| 操作 | 一致性级别 | 补偿机制 |
|---|---|---|
| 审计写入 | 最终一致（有界队列 + 批量 flush，队列满降级同步） | 每日对账：状态事件数 vs 审计记录数（R7） |
| 数据版本 → 开新轮 | 最终一致（E-02 提交后） | 5 分钟对账扫描，补建缺失轮次 |
| 批次解析投递 | 最终一致（E-03 提交后） | `PENDING` 超时重投（幂等） |
| AI 建议生成 | 最终一致，失败即降级为 `RULE` 口径 | 不重试内容，只重提交任务 |
| 授权撤销后的"标记" | 最终一致 | 拦截同步生效，标记可延迟 |
| 只读投影（案件时间线、进度投影） | 最终一致 | 读时实时计算兜底 |

## 七、ArchUnit 断言清单

全部落在 `src/test/java/com/coolpilotx/architecture/`，`mvn test` 失败即阻断合并。命名 `A-01`…`A-16`，与 §三 红线编号交叉引用。

| 编号 | 规则 | 断言表达要点 | 失败示例 |
|---|---|---|---|
| A-01 | `common` 不依赖任何业务包 | `noClasses().that().resideInAPackage("..common..").should().dependOnClassesThat().resideInAnyPackage("com.coolpilotx.case..", ...)` | 有人在 `common.PageResult` 里 import `com.coolpilotx.customer.domain.Customer` |
| A-02 | `domain` 层不依赖 Spring | `..domain..` 不得依赖 `org.springframework..` | `FinancingCase` 上标了 `@Service` 或 `@Transactional` |
| A-03 | `domain` 层不依赖 MyBatis / JDBC | `..domain..` 不得依赖 `org.apache.ibatis..`、`java.sql..` | `CaseGuard` 注入 `CaseMapper` 判断"资料是否齐备" |
| A-04 | `domain` 层不依赖 Servlet / Jackson | 不得依赖 `jakarta.servlet..`、`com.fasterxml.jackson..` | 聚合里用 `@JsonIgnore` 控制序列化 |
| A-05 | `domain` 不得依赖本模块 `application` / `infrastructure` | `..domain..` 到 `..application..`、`..infrastructure..` 零依赖 | 聚合直接调 `XxxRepositoryImpl` |
| A-06 | `api` 层不依赖他域任何包 | `..api..` 只允许 `..application..`、`..common..` | Controller 里直接 `new` 了 `finance` 的 DTO |
| A-07 | 依赖方向符合十级阶梯（禁止向上） | 逐条 `noClasses().that().resideInAPackage("..case..").should().dependOnClassesThat().resideInAnyPackage("..finance..", "..analysis..", "..assessment..", "..report..")` 等，按 §3.3 N-01/N-02/N-03/N-04 逐条写 | `case` 里出现 `MetricQueryService` |
| A-08 | 任何模块不依赖 `aigateway` 实现 | `noClasses().that().resideOutsideOfPackage("..aigateway..").should().dependOnClassesThat().resideInAPackage("..aigateway..")` | `assessment.application` 直接调 `AiTaskAppService.submit` |
| A-09 | `report` 不依赖任何 AI 能力 | `..report..` 不得依赖 `..aigateway..`、`..common.ai..` | 报告章节文字在渲染时调 AI 润色 |
| A-10 | 仅 `audit` 可访问审计表 Mapper | `classes().that().haveSimpleNameEndingWith("AuditLogMapper").should().resideInAPackage("..audit.infrastructure..")` | `case` 复制了一份 `AuditLogMapper` 图省事 |
| A-11 | 禁止 `double` / `float` 字段与参数 | `noFields().should().haveRawType(double.class).orShould().haveRawType(float.class)`（全工程，含 DTO）；方法返回值与参数同理 | `RiskFinding` 加了 `double confidence` |
| A-12 | `domain` 层禁止生命周期注解 | 类/方法上不得出现 `@Service`、`@Component`、`@Repository`、`@Transactional`、`@Autowired` | 守卫函数标了 `@Transactional(readOnly = true)` |
| A-13 | 命名约定 | `..api..` 中类型以 `Controller` 结尾；`..application..` 中以 `AppService`/`QueryService` 结尾；`..domain.port..` 中以 `Port` 结尾；`..infrastructure.adapter..` 中以 `Adapter` 结尾；`..infrastructure.persistence..` 中以 `Mapper` 结尾 | 端口实现叫 `AuthorizationHelper`，谁都找不到 |
| A-14 | 事件类约束 | 以 `Event` 结尾、位于 `..domain.event..`、字段全 `final`；`ApplicationEventPublisher` 只允许出现在 `..application..` | 在 `domain` 里注入 `ApplicationEventPublisher` 直接发事件 |
| A-15 | 包之间无环 | `slices().matching("com.coolpilotx.(*)..").should().beFreeOfCycles()` | `document` 与 `dataimport` 互相调用形成环 |
| A-16 | 金额字段类型与命名 | 字段名以 `Amount`/`Ratio`/`Days` 结尾者，类型必须为 `BigDecimal`（`Days` 为 `Integer`）；`BigDecimal` 比较不得用 `equals` | `private BigDecimal total;` 且用 `equals` 比较两个金额 |

**两条补充规则（不属于 ArchUnit，但同属 CI 门禁）**：① Flyway 脚本一旦提交禁止修改，只能新增 `V{n}__`；② 枚举值集合与数据库 `CHECK` 取值集合必须逐项相等（ADR-001 A-04 明确要求的一致性测试）。

```java
@ArchTest
static final ArchRule A02_domainIsFrameworkFree = noClasses()
        .that().resideInAPackage("com.coolpilotx..domain..")
        .should().dependOnClassesThat().resideInAnyPackage(
                "org.springframework..", "org.apache.ibatis..", "jakarta.servlet..");
```

## 八、包结构树（到聚合根级别）

每个业务模块除 `domain` 外固定含 `api/`、`application/`、`infrastructure/{persistence,adapter,read}`，下树中省略；`domain` 内部结构完整展开。

```
com.coolpilotx
├── common/          L0  kernel(DataScope·ActorContext·PageResult·Money·Period) · port(AuditPort·StoragePort·AiSuggestionPort·RetrievalPort) · error
├── infrastructure/  L0  storage/LocalStorageAdapter · web(全局异常·traceId·审计字段拦截) · config(Jackson 金额字符串·MyBatis·线程池)
├── evidence/        L1  E   DataVersion(VersionMember) · EvidenceReference ｜ policy/EvidenceIntegrityPolicy ｜ port/EvidenceSourcePort ｜ event/DataVersionCreated
├── audit/           L1  D6  AuditLog
├── aigateway/       L1  D6  AiTask(AiSuggestion)
├── knowledge/       L1  D6  KnowledgeClause
├── identity/        L1  D6  User · Role(Permission)
├── customer/        L2  D1  Customer(Contact)
├── case/            L3  D1  FinancingCase(FinancingRequirement 版本链)
│                            statemachine/CaseStatus·TransitionTable·Guard(G1–G7)·GuardContext/Result
│                            port/AuthorizationQueryPort·MaterialReadinessPort·QualityGatePort ｜ event/CaseTransitioned
├── authorization/   L4  D2  CaseAuthorization(AuthorizationScope)
├── document/        L4  D2  CaseMaterial · Document(DocumentVersion)
├── dataimport/      L4  D2  ImportBatch(ImportRecord) ｜ worker/(解析线程池，无领域逻辑)
├── finance/         L5  D3  statement/FinancialStatement(StatementItem) · transaction/BankTransaction
│                            debt/DebtRecord · metric/FinancialMetric(MetricSource)·Formula·FormulaVersion
├── dataquality/     L6  D2  QualityIssue ｜ rule/QualityRule(DQ-CHECK-01…)
├── analysis/        L7  D4  AnalysisRound(MetricSnapshot)
├── assessment/      L8  D4  VerificationItem · RiskFinding · ReadinessAssessment(DimensionResult)
│                            policy/ReadinessPolicy(五维→三档就绪结论)·WordingDictionary(定性词拦截) ｜ port/MetricQueryPort
├── review/          L9  D5  ReviewTask(ReviewRecord)
└── report/          L10 D5  Report(ReportVersion·ReportClause)
                             render/TemplateRenderer·PlaceholderResolver(纯函数，无 Spring) ｜ policy/IssuePolicy
                             port/RoundQueryPort·AssessmentQueryPort·ReviewQueryPort·EvidenceQueryPort
```

## 九、证据与血缘域专项

### 9.1 职责三问

| 问题 | 答案 |
|---|---|
| 谁写 `EvidenceReference`？ | **只有 `evidence` 模块。** 两条写入路径：① `EvidenceAppService.attachBatch(...)`，由 `finance`（指标来源）、`dataquality`（规则命中）、`assessment`（风险与就绪）、`report`（报告条款）在**各自的事务内**调用；② `evidence` 内部由 `DataVersionAppService` 写入版本成员关系。任何其他模块不得出现 `EvidenceReferenceMapper` |
| 谁校验？ | 规则在 `evidence.domain.policy.EvidenceIntegrityPolicy`（纯函数）；外部可达性由 `EvidenceSourcePort` 提供；编排在 `evidence.application.EvidenceValidationService`；**裁决者**是调用方 `report`——校验不通过就不创建版本 |
| 校验何时执行？ | 报告版本落库的同一事务内（§6.3 ③），且签发时再执行一次只读复核。**不做异步、不做定时** |

### 9.2 为什么校验必须在报告渲染前同步执行

| 理由 | 若异步/延后的具体后果 |
|---|---|
| **渲染是单向且不可逆的** | 渲染会写 `storage/reports/`、生成 PDF、计算 `contentHash`。异步校验失败时产物已生成，只能作废——用户已经看到一份"看起来完整"的报告，且哈希已进入交付记录 |
| **失败语义要求同步返回** | 校验失败的正确响应是"中止并返回缺失项清单"（CPX-BIZ-01 §3.2 规则 4）。异步无法把"缺第 3 条款的营业收入证据"返回给正在点"生成报告"的人 |
| **校验依赖当次事务的写入可见性** | ③ 的校验对象包含 ① ② 刚组装的 `EvidenceClaim` 与刚写入的 clause 结构，这些在提交前只对当前事务可见。异步执行时要么读不到，要么读到半成品 |
| **INV-14 / INV-18 是签发的前置条件，不是事后告警** | 签发不可逆（INV-09）。若校验滞后于签发，"已签发报告存在无证据数字"就是既成事实，只能作废并对外解释 |
| **跨版本引用必须在此刻被拦住** | 规则 2 要求 `dataVersionId == round.dataVersionId`。异步校验时轮次可能已被 `SUPERSEDED`，用第 3 轮数据支撑第 2 轮结论这类错误将无法在写入侧阻断 |

### 9.3 三类校验的具体判定

| 校验 | 判定 | 拒绝示例 |
|---|---|---|
| 存在性 | `sourceObjectId` 指向的对象存在且未物理删除（软删除视为不存在） | 引用了被替换并清理的 `documentVersionId` |
| 版本一致 | 全部 `dataVersionId` 等于报告版本所绑定轮次的 `dataVersionId` | 用 V4 的流水行支撑 V3 的结论 |
| 计算可回溯 | `CALCULATION` 类必须找到 `financial_metric` 且 `formulaCode + formulaVersion` 一致 | 指标已按 V2 公式重算，报告仍引 V1 公式 |

**渲染器的独立防线**：即使证据集全部通过，渲染器仍会二次扫描正文——出现裸数字且无 `metricId` 挂点即拒绝渲染（P5）。这两道防线互不替代：证据校验管"引用对不对"，裸数字扫描管"有没有引用"。

## 十、反模式清单

| 编号 | 反模式 | 后果 |
|---|---|---|
| P-01 | `case` 里直接查 `finance` 表判断"指标是否已算完" | 案件包变成上帝包；改一个指标口径要回归状态机；`case` 的单元测试开始需要财务样例数据 |
| P-02 | `domain` 注入 Mapper 做守卫判断 | 守卫无法裸测，13 状态转换的遍历测试要起 PG；不变量散落进 SQL，`blockingItems` 无法给出可读原因 |
| P-03 | 报告渲染时实时查库补数字 | 同一版本两次渲染结果可能不同，`contentHash` 失效，报告不可复现，"可核验"三个字破产 |
| P-04 | 用领域事件做签发前校验（"等复核通过事件到了再签发"） | 事件在提交后执行，签发已落库，INV-08 失效；且事件丢失时无人发现 |
| P-05 | AI 建议绕开 `AiSuggestionPort` 直写业务表 | INV-10 失效；无法追溯"这个金额是谁改的"；审计对账出现无法解释的差异 |
| P-06 | 建 `common.dto` 放各域共享 DTO（`CustomerDTO`、`CaseDTO`） | `common` 退化为业务耦合中心，任何域改字段都触发全工程重编译与全量回归；最终谁都不敢动 |
| P-07 | 在事务内调 AI 或写文件 | 单事务时长从 50ms 涨到 30s；连接池（10）被占满；`leak-detection` 告警成为常态噪声 |
| P-08 | 5 万行导入用单事务，"为了原子性" | WAL 数十 MB、堆内 pending batch 数百 MB、长事务阻塞 autovacuum；失败一次白跑 60s，且期间全站请求超时 |
| P-09 | 在 `api` 层写业务判断（Controller 里 `if (status == 'DRAFT')`） | 状态机被绕过，流转不留痕（INV-12），前端换一个入口就能越权 |
| P-10 | 每个模块各写一份"检查授权"的工具方法 | 拦截点变成 5 份实现（解析入口、导入入口、AI 入口、导出入口、下载入口），漏一处即数据泄露（INV-02） |
| P-11 | 用 `String` 传 `status` / `dataScope`，省略枚举 | 编译期无保护，数据库 `CHECK` 成为唯一防线；拼写错误只在运行时暴露，且表现为"查不到数据"而非报错 |
| P-12 | `evidence` 直接 import `document` / `finance` 做存在性校验 | E 域变成所有域的下游，任何业务表结构调整都要改证据层；证据层一旦回滚困难，全员阻塞 |

## 十一、什么条件下才拆成独立 Maven 子模块

**默认不拆**（CPX-ARCH-01 §4.2 已裁定）。拆分是成本决策，不是品味决策：单工程下移动一个包 = 改 import；拆模块后 = 改 N 处 pom + 处理循环依赖 + 重新配置构建。

### 11.1 量化触发条件（满足任意两条才启动评估）

| # | 条件 | 阈值 | 度量方式 |
|---|---|---|---|
| T-01 | 构建时间 | `mvn clean package` P95 > 3 分钟，或 `mvn test` > 15 分钟（连续 10 次构建取样） | CI 日志 |
| T-02 | 单模块规模 | 某模块 Java 源文件 > 400 个，或单个 `domain` 包内类 > 60 个 | `find`/cloc |
| T-03 | 边界表达失效 | ArchUnit 规则出现 > 3 条 `ignoreDependency` 例外，且每条例外无法用一句话说明理由 | 测试代码评审 |
| T-04 | 交叉依赖密度 | 某模块 `application` 被 ≥ 3 个其他模块 import，且这些依赖无法收敛到一个端口 | ArchUnit 统计 |
| T-05 | 独立部署需求 | 某能力需要独立进程/独立扩缩容/独立发布节奏（如报告渲染批量作业） | 运维需求单 |
| T-06 | 第三方依赖冲突 | 两个模块需要在同一 classpath 共存不兼容的依赖大版本（`mvn dependency:tree` 出现 `omitted for conflict` 且无法通过 `exclusion` 解决） | 依赖树 |
| T-07 | 人员与冲突 | 开发者 > 3 人，且同一批文件月冲突 > 3 次 | Git 统计 |
| T-08 | 变更耦合度 | 某模块月变更行数 > 全量的 30%，但与其他模块的协同提交 < 5 次/月 | Git 统计 |

### 11.2 拆分前置门禁（不满足则无论阈值如何都不拆）

| 门禁 | 要求 |
|---|---|
| G-1 | 16 条 ArchUnit 断言连续 2 个发布版本零违规（`@Ignore` 计数为 0） |
| G-2 | 每个模块的 `domain` 层已完全无 Spring/MyBatis 依赖（A-02/A-03 全绿） |
| G-3 | 不存在跨域写表（§3.4），跨域读已全部收敛到 `infrastructure.read` |
| G-4 | 打包产物仍是**单个 jar、单个部署单元**——拆 Maven 模块不等于拆服务 |

**没有 G-1 到 G-3 就拆模块，得到的是"17 个互相 import 的 jar"，比单工程更糟**：既付了配置成本，又没有边界。

### 11.3 拆分顺序（若发生）

| 顺序 | 模块 | 理由 |
|---|---|---|
| 1 | `common` | 无业务依赖，拆分零风险，先验证构建链 |
| 2 | `evidence`、`audit`、`aigateway`、`knowledge` | L1 横切，只依赖 `common`，边界最干净 |
| 3 | `case`、`finance` | 领域内核，被依赖最多，拆完能暴露全部违规依赖 |
| 4 | `report`、`assessment` | 边缘能力，最后拆 |

**绝不先拆 `api`/`application`/`domain`/`infrastructure` 这种技术层模块。** 那会把"按业务分模块"变成"按技术分模块"，等于退回三层架构，同时失去纵向切分和横向分层。

## 十二、对 CPX-ARCH-01 §4 的细化与修正

| # | 类型 | CPX-ARCH-01 §4 原文 | 本文裁定 | 理由 |
|---|---|---|---|---|
| 1 | **修正（缺口）** | §4.1 目录树只有 `analysis/assessment/review/report/...`，**E 证据域没有任何包** | 新增 `evidence` 包（L1，聚合根 `DataVersion`、`EvidenceReference`） | 产品基线修正 3 把证据链定为底层能力，领域模型给了两个聚合根，但工程结构里没有落点。缺这个包，"渲染器拒绝渲染无证据数字"无处实现 |
| 2 | **修正（缺口）** | §4.1 无知识库包，D6 的"知识库"只体现在 Python 侧 `rag/` | 新增 `knowledge` 包 + `common.port.RetrievalPort` | A-11 要求"接口层预留 RetrievalPort，业务代码不变"。接口在 Java 侧，实现可以在 Java（`pg_trgm`）或 Python，必须先有 Java 侧落点 |
| 3 | **细化** | "每个业务包内固定四层"与顶层 `infrastructure/{storage,parser,ai,config}` 并存，两处 `infrastructure` 语义未区分 | 顶层 `infrastructure` **只放无业务语义的技术实现**；业务包内 `infrastructure` 放本域持久化与端口适配器 | 原结构下 `LocalStorageAdapter` 既可能是 `infrastructure.storage` 又该在消费方包内，会造成两份实现 |
| 4 | **细化** | §4.1 把 `analysis` 与 `assessment` 并列为两个平级包，未说明归属 | 明确二者同属 D4，且 **`analysis` 不得依赖 `assessment`** | CPX-BIZ-01 把 `AnalysisRound` 定为独立聚合根（事务边界独立）。同级包不定序会形成环 |
| 5 | **细化** | `case/(+statemachine)` 未定义守卫的数据来源 | 守卫通过 `AuthorizationQueryPort` / `MaterialReadinessPort` / `QualityGatePort` 三个端口装配 `GuardContext` | 守卫必须是纯函数（MVP P0-02 ②），不能自己查库 |
| 6 | **细化** | `finance/{statement,transaction,debt,metric}` 未定子包间依赖 | `metric` 依赖前三个，反向禁止 | 指标是计算产物（CPX-BIZ-01 §六），不能被反向修改 |
| 7 | **修正（不可执行）** | §4.3 拆分条件为定性描述（"某 application 层被 3 个以上包交叉依赖""开发者 >3 人"），且"任意两条"即可拆 | 改为 8 条量化阈值 + 4 条前置门禁（§十一） | 定性条件无法判定，实际结果是"永远不会拆"或"凭感觉拆"。加门禁是为了防止"拆了但边界仍然烂" |
| 8 | **细化** | §4.2 说"边界靠 ArchUnit 约束"，但全文未列任何一条规则 | 给出 16 条可落地断言（§七），逐条带失败示例 | 没有具体规则的"靠 ArchUnit"等于没有约束 |
| 9 | **裁定冲突** | §3.2 A6/B6 说"提交后发布事件"，CPX-BIZ-01 §十说"Spring 事件同步分发，失败即回滚" | 二分：一致性事件（仅 E-01）事务内、失败回滚；通知事件（E-02…E-13）提交后、失败补偿（§5.2） | 两处都对一半。全放事务内会让"开轮失败"回滚"资料核验"，全放提交后会丢一致性。逐条定性比统一口径可靠 |
| 10 | **细化** | 未定义 `common` 的边界，仅写"统一响应、异常、BigDecimal 工具" | `common` 只含 `kernel`（共享值对象）、`port`（横切端口）、`error`；**禁止出现任何 DTO** | `common.dto` 是单工程按包分模块最常见的腐化入口（P-06） |
| 11 | **细化** | 未定义跨域读表规则 | 允许 `infrastructure.read` 只读跨域查询，禁止跨域写（§3.4） | §6.1 已要求"案件详情聚合 ≤500ms，只读查询服务直拼 SQL"，需要一个与之匹配的边界规则 |
| 12 | **细化** | §4.1 未定 `identity` 与其他模块的关系 | 业务模块不 import `identity`，操作人从 `common.kernel.ActorContext` 获取 | 否则每个模块都要依赖用户模型，改登录方式要动全工程 |

## 十三、待确认

1. **`knowledge` 是否首期就建包**：本文按"先建包、只放 `RetrievalPort` 实现与字典表"处理。若首期确定不做 P1-01 的 RAG，该包可延后到 P1，但 `common.port.RetrievalPort` 必须保留，否则 A-11 的"接口层预留"落空。
2. **`report` 是否允许调 `RetrievalPort`**：本文裁定**禁止**（A-09），理由是渲染必须确定性。若将来报告需要"引用条款原文"，正确做法是让条款引用在版本创建时（事务内）写入 `EvidenceReference`，而不是渲染时检索。
3. **`document` 承载 `CaseMaterial` 是否合适**：本文选择合并。若将来材料清单需要独立的审批流（豁免审批），应拆为 `material` 包并置于 L4 与 `document` 同级。
4. **一致性事件只保留 1 条是否太少**：`DocumentChanged → DataVersion` 是唯一"必须原子"的跨聚合写入。若实践中发现 `ImportBatchConfirmed → 指标重算` 也需要原子，应升级为一致性事件，而不是在 `dataimport` 里直接调 `finance`。
