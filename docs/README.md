# CoolPilotX 文档索引

- 版本：V1.1（对应产品基线 V1.0 的工程化收敛）
- 当前阶段：**设计阶段**。不建库、不写代码、不执行 Flyway 迁移。

---

## 阅读顺序

前两份是约束，其余是展开。**按顺序读**，否则后面的取舍会显得没有理由。

| # | 文档 | 编号 | 内容 | 行数 |
|---|---|---|---|---|
| 0 | [产品基线 V1.0](product/product-baseline-v1.md) | — | **最高约束**：定位、三条硬修正、六域+证据域、九条冻结原则、MVP 范围、术语表 | 185 |
| 1 | [融资业务领域模型](business/financing-domain-model.md) | CPX-BIZ-01 | 六域 + 证据域的聚合、20 条不变量、`EvidenceReference` 定义 | 391 |
| 2 | [业务流程与状态机](business/financing-workflow.md) | CPX-BIZ-02 | **五个独立生命周期**、进度投影、轮次与报告联动、四场景走查 | 544 |
| 3 | [数据库设计](database/er-design.md) | CPX-DB-01 | PostgreSQL 表结构、索引、分区、追溯链、V1.1 变更 | 2141 |
| 4 | [数据字典](database/data-dictionary.md) | CPX-DB-02 | 47 张表逐字段定义、枚举全集、脱敏规则 | 1539 |
| 5 | [后端模块边界](architecture/backend-module-boundaries.md) | CPX-ARCH-02 | 18 个包、依赖矩阵、13 个 Port、16 条 ArchUnit 断言 | 489 |
| 6 | [系统总体架构](architecture/system-architecture.md) | CPX-ARCH-01 | 运行时拓扑、请求链路、配置、非功能目标 | 500 |
| 7 | [AI 与 Agent 架构](architecture/ai-architecture.md) | CPX-AI-01 | Java/Python 契约、四个 Agent、RAG、评测门槛 | 450 |
| 8 | [安全架构](architecture/security-architecture.md) | CPX-SEC-01 | 威胁模型、授权体系、文件隔离、审计防篡改 | 450 |
| 9 | [首期任务卡](tasks/mvp-scope.md) | CPX-MVP-01 | 里程碑 0 + CPX-01~06 + 24 个子任务 + 验收标准 | 405 |
| ★ | [**待决策清单**](decisions/OPEN-QUESTIONS.md) | — | 待拍板事项，按是否阻塞开工分档 | — |
| — | [工程基线裁定](decisions/ADR-001-工程基线.md) | ADR-001 | 12 项技术裁定 | 247 |
| — | [多模块结构裁定](decisions/ADR-002-多模块结构.md) | ADR-002 | 由单工程改为 19 模块，取代 CPX-ARCH-02 相关裁定 | 96 |

**已作废**：`architecture/domain-model.md`（技术视角聚合清单，已并入 CPX-BIZ-01 与 CPX-ARCH-02）、`business/financing-process.md`（单状态机版本，已被产品基线"修正 2"推翻）。

---

## 这一版改了什么

相比上一版，三处结构性修正：

**1. 融资准备度与授信能力切割。** 评估只回答"资料齐备度、数据可核验性、口径一致性、需求清晰度"。偿债情景测算仍存在，但归为分析产物，不进评分，不产生任何授信含义。不设 0–100 分，只输出三档结论。

**2. 一个状态字段拆成五个生命周期。** 案件生命周期、分析轮次、报告版本、资料项、待核实事项各自独立。核心是新增 `AnalysisRound`——同一案件可以跑到第 3 轮，而第 2 轮的报告仍处于已签发状态，互不覆盖。

**3. 证据链成为底层能力。** 新增 `DataVersion`（数据版本）与 `EvidenceReference`（证据引用）两个对象。报告里的每个数字必须挂载证据，指向具体版本上的具体位置（文件页/数据行），并绑定计算规则版本。渲染器校验不通过就中止，不降级生成。

---

## 技术栈

Vue 3 + Vite + Element Plus · Java 21 + Spring Boot 4.0.8 + MyBatis · **PostgreSQL 16** · Flyway · Python + FastAPI · Docker Compose + Nginx

**边界**：Java 是业务事实与流程状态的权威来源；Python 是可替换的 AI 能力服务，只能写建议表。这条用数据库角色权限强制。

---

## 动手之前

读 [待决策清单](decisions/OPEN-QUESTIONS.md)。A 档未定，编码无法开始。

第一步不是 CPX-01，是**里程碑 0**：空工程 + 一条 Flyway 迁移 + 一个 MyBatis 查询 + `/actuator/health`。Spring Boot 4 与 MyBatis、Flyway 的兼容性无法靠设计规避，必须先用半天验证。
