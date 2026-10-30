# CPX-DB-01 数据库设计（PostgreSQL 16）

- 编号：CPX-DB-01
- 版本：V1.1（按 `docs/product/product-baseline-v1.md` V1.0 修订）
- 状态：初稿
- 前置：`ADR-001 工程基线`、`product-baseline-v1.md V1.0`、`financing-domain-model.md`、`financing-workflow.md`
- 库名：`coolpilotx`，表统一 `cpx_` 前缀
- 目标：一个工程师照本文能直接写 Flyway 脚本，不需要回头猜

本文所有裁定都可以追溯到四份前置文档。凡与前置文档冲突处，在第十节集中列出并说明取舍。

**V1.1 的修订范围**：新增第 2.16 节的 5 张表、第 3.13–3.17 节的字段级设计、3.18 的既有表 ALTER 汇总、第七节追溯链全章重写、第八节保留策略分级；其余章节为增量修改（改列、改约束、改索引），全部改动逐条登记在第十二节「V1.1 变更记录」。原 V1.0 的 41 张表结构、索引原则、分区策略、命名规范全部保留。

---

## 一、建表规范

### 1.1 命名

| 对象 | 规则 | 示例 |
|---|---|---|
| 表 | `cpx_` + 单数 snake_case 业务名 | `cpx_financing_case`，不写 `cpx_cases` |
| 字段 | snake_case，只允许 `[a-z0-9_]` | `financing_amount` |
| 主键 | 一律 `id`，不写 `case_id` 做主键 | `cpx_financing_case.id` |
| 外键列 | `<被引用实体>_id`，与目标表主键同名加实体前缀 | `customer_id`、`document_version_id` |
| 金额 | 以 `_amount` 结尾 | `registered_capital_amount` |
| 比率 | 以 `_ratio` 结尾 | `debt_service_coverage_ratio` |
| 天数 | 以 `_days` 结尾 | `inventory_turnover_days` |
| 时间点 | `timestamptz`，以 `_at` 结尾 | `submitted_at`、`deleted_at` |
| 日历日期 | `date`，以 `_on` 结尾 | `established_on`、`txn_on` |
| 区间 | 用 `_from` / `_to`（date），仅在表示有效期时例外于上一条 | `valid_from`、`valid_to` |
| 业务编号 | 以 `_no` 结尾，同时存字符串与唯一约束 | `case_no`、`report_no` |
| 版本号 | 业务版本用 `version_no`，乐观锁用 `version`，两者不混用 | `version_no = 3` / `version = 7` |
| 布尔 | `is_` / `has_` 前缀 | `is_current`、`is_primary` |
| 索引 | `idx_<表去掉 cpx_ 前缀>_<列缩写>` | `idx_financing_case_customer_status` |
| 唯一索引 | `uq_` 前缀 | `uq_document_version_no` |
| 部分索引 | `idx_` 或 `uq_` + 后缀 `_active` / `_open` / `_current` | `uq_requirement_current` |
| 外键 | `fk_<表>_<列>` | `fk_document_version_document` |
| CHECK | `ck_<表>_<语义>` | `ck_metric_single_value` |

不使用复数、不使用驼峰、不使用中文拼音缩写（`kh`、`je` 一律禁止）。

### 1.2 主键（遵循 A-03）

判定标准只有一条：**这个对象是否会被 URL 直接引用、或在别的聚合里被当作身份引用**。是 → UUID；只通过父对象访问的从属明细 → `bigint identity`。

| 主键类型 | 表 | 理由 |
|---|---|---|
| `uuid default gen_random_uuid()` | 全部聚合根与实体：`cpx_user`、`cpx_customer`、`cpx_financing_case`、`cpx_document`、`cpx_document_version`、`cpx_financial_metric`、`cpx_metric_snapshot`、`cpx_assessment`、`cpx_report`、`cpx_report_version`、`cpx_ai_task`、`cpx_ai_suggestion` 等；V1.1 新增 `cpx_data_version`、`cpx_analysis_round`、`cpx_verification_item` | 对外不可枚举，避免改 URL 越权；跨库/离线导入不撞键 |
| `bigint generated always as identity` | `cpx_case_status_event`、`cpx_data_import_record`、`cpx_financial_statement_item`、`cpx_bank_transaction`、`cpx_metric_snapshot_item`、`cpx_metric_source`、`cpx_ai_execution_log`、`cpx_audit_log`；V1.1 新增 `cpx_evidence_ref` | 单案可达数万行，UUID 作 B-tree 键会放大约 2–3 倍索引体积并加剧页分裂 |
| 复合主键 | `cpx_user_role(user_id, role_id)`、`cpx_role_permission(role_id, permission_id)`、`cpx_case_authorization_scope(authorization_id, data_scope)`；V1.1 新增 `cpx_data_version_member(data_version_id, document_version_id)` | 关联表天然唯一，不额外造代理键 |
| `varchar` 主键 | `cpx_idempotency(idempotency_key)` | 幂等键本身就是唯一标识，多一列 UUID 只增加一次索引回表 |

V1.1 的两个新判断：

- `cpx_analysis_round` 用 UUID 而不是 bigint：轮次会被报告版本、待核实事项、证据引用跨聚合引用，且要在接口里作为 `roundId` 出现。它的行量（3×10^4）远低于流水类表，UUID 的体积代价可以忽略。
- `cpx_evidence_ref` 用 bigint 而不是 UUID：它是全库第二大的表（10^7 级，见 5.6 节体量对比），且**从不被任何表反向引用**——报告、轮次、指标都不需要"我的 evidenceRefId 是多少"。没有反向引用就没有对外暴露问题，UUID 只剩体积代价。

`gen_random_uuid()` 在 PG 13+ 内置于 `pgcrypto` 之外的核心函数，**不需要 `CREATE EXTENSION pgcrypto`**。这一点常被抄错的模板带偏。

### 1.3 类型基线

| 语义 | 类型 | 硬性规定 |
|---|---|---|
| 金额 | `numeric(18,2)` | 禁止 `double precision` / `real` / `money` |
| 比率 | `numeric(10,6)` | 存 0.012345 而非 1.2345 或 "1.23%" |
| 天数 | `integer` | 周转天数、账龄天数均为整数 |
| 置信度 | `numeric(5,4)` | 取值 [0,1] |
| 时间点 | `timestamptz` | 连接串 `TimeZone=UTC`，禁止 `timestamp` 无时区 |
| 业务日期 | `date` | 交易日期、成立日期、到期日 |
| 枚举 | `varchar(32)` + `CHECK` | 不用原生 `ENUM`（A-04） |
| 半结构化 | `jsonb` | 不用 `json`，不用 `text` 存 JSON |
| 哈希 | `char(64)` | SHA-256 小写十六进制，`CHECK (~ '^[0-9a-f]{64}$')` |
| 文件大小 | `bigint` | 单文件可达数百 MB |
| IP | `inet` | 审计用，`varchar` 存会丢失比较能力 |
| 二进制 | 不落库（A-10） | 唯一例外：手机号密文 `bytea`（见数据字典 4 节） |

### 1.4 公共审计字段

除关联表与追加型日志表外，所有业务表带四列：

```sql
created_at  timestamptz not null default now(),
updated_at  timestamptz not null default now(),
created_by  uuid,
updated_by  uuid
```

- `created_by` / `updated_by` **不建外键**。理由：写入由 MyBatis 拦截器统一填充，且用户可能被停用或软删除；为它加外键会让每条高频写入多一次约束检查与一把共享锁。
- 系统写入（解析、定时任务、状态机自动流转）时两列为 `NULL`，语义由 `cpx_case_status_event.actor_type` 或 `cpx_audit_log.actor_type` 表达，不引入哨兵 UUID。
- `updated_at` 由统一触发器维护，见 1.7。

追加型表（`cpx_audit_log`、`cpx_ai_execution_log`、`cpx_case_status_event`、`cpx_metric_source`、`cpx_review_record`）**只有 `created_at`**，没有 `updated_at`——它们不该被更新。少一列，就少一次误改的可能。

V1.1 新增两处：

- `cpx_data_version_member`、`cpx_evidence_ref` 归入追加型表（只有 `created_at`）：版本一旦建立，成员集合就是那一版数据的定义，改它等于伪造历史；证据引用同理。
- `cpx_data_version` 属于第三类，本文称「准追加型」：只有 `created_at` / `created_by`，没有 `updated_at` / `updated_by`，唯一允许变的列是 `status`（`ACTIVE → SUPERSEDED`），并用 `superseded_at` 记录这次迁移的时刻。理由：给它加 `updated_at` 会制造"这一版数据被谁在何时改过"的假象——事实上它只可能被作废一次，且作废时间需要精确到可审计。

### 1.5 软删除

只有主数据允许软删除，且只允许一种实现：`deleted_at timestamptz`，默认 `NULL`，非空即视为已删。

| 表 | 允许软删 | 说明 |
|---|---|---|
| `cpx_customer`、`cpx_contact`、`cpx_user`、`cpx_role` | 是 | 主数据，可能被引用，不能物理删 |
| `cpx_document`、`cpx_document_version` | 是，仅限 `verification_state = 'UPLOADED'` | 传错文件要能撤回；已核验的资料不可删（INV-03） |
| 其余全部业务表 | 否 | 用状态字段表达终结，不用删除 |

四条约束：

1. 所有唯一约束必须写成部分唯一索引并带 `WHERE deleted_at IS NULL`，否则删掉的老数据会永久占位。
2. 查询一律显式带 `deleted_at IS NULL`，不做全局拦截器改写 SQL——隐式改写会在复杂 join 里产生错误结果且难排查。
3. `cpx_financing_case` 明确**不允许删除**（DOMAIN 3.2 不变量 3），终态只有 `CLOSED` / `WITHDRAWN` / `DECLINED`（V1.1 按 workflow §3.1 替换旧三值 `CUSTOMER_WITHDRAWN` / `REJECTED_FOR_SERVICE` / `ARCHIVED`）。
4. 软删除必须同时写 `cpx_audit_log`，动作码 `DOCUMENT_DELETE` 或 `MASTER_DELETE`。

### 1.6 枚举与 CHECK（遵循 A-04）

- 列类型 `varchar(32)`，约束写成具名 `CONSTRAINT ck_<table>_<col>`，便于后续单独 `DROP CONSTRAINT` 再重建。
- 新增取值 = 一次 `ALTER TABLE ... DROP CONSTRAINT` + `ADD CONSTRAINT`，在 Flyway 里是普通 DDL，可回滚。
- Java 侧 `enum` 是唯一语义来源，数据库只是守卫。集成测试必须断言「Java 枚举值集合 == 数据库允许值集合」，防止漂移（A-04 的代价条款）。
- 取值使用大写下划线常量，禁止中文入库，禁止小写混用。
- 业务上"无限增长"的编码（`metric_code`、`rule_code`、`material_code`、`action`）**不加 CHECK**，由字典表或 Java 枚举维护。给它们加 CHECK 等于每次新增业务指标都要发一次 DDL 迁移，这是自找的停机。

### 1.7 `updated_at` 触发器

```sql
create or replace function cpx_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
```

每张带 `updated_at` 的表在 Flyway 中 `CREATE TRIGGER trg_<table>_touch BEFORE UPDATE ... EXECUTE FUNCTION cpx_touch_updated_at()`。

为什么用触发器而不是拦截器：MyBatis 拦截器只能覆盖 Mapper 路径，运维手工修数、数据修复脚本、`ON CONFLICT DO UPDATE` 全都绕过它；`updated_at` 错了会让"最后一次修改时间"的审计结论直接失真。触发器是唯一覆盖全部写入路径的位置。

为什么不用触发器维护 `version`：乐观锁版本必须由业务代码显式 `version = version + 1`，否则"读-改-写"中的并发冲突会被静默吞掉。

### 1.8 排序与分页

- 所有列表默认按 `created_at DESC, id DESC` 排序，`id` 作为并列打破键，避免翻页时记录重复或丢失。
- 深分页（页码 > 100）一律改键集分页（`WHERE (created_at, id) < (:lastCreatedAt, :lastId)`），`OFFSET` 在大表上是线性成本。

---

## 二、表清单总览

合计 **46 张表**（V1.0 的 41 张 + V1.1 新增 5 张）。`PK` 列：`U` = uuid，`B` = bigint identity，`C` = 复合主键，`V` = varchar。

### 2.1 identity 用户权限域（5）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_user` | 用户 | User | U | 10^1 | 极低（月级） |
| `cpx_role` | 角色 | Role | U | 10^1 | 极低（随发版） |
| `cpx_permission` | 权限点 | Permission | U | 10^2 | 极低（随发版） |
| `cpx_user_role` | 用户角色关联 | User | C | 10^1 | 极低 |
| `cpx_role_permission` | 角色权限关联 | Role | C | 10^2 | 极低 |

### 2.2 customer 客户域（2）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_customer` | 企业客户 | Customer（根） | U | 10^3 | 低（日级个位数） |
| `cpx_contact` | 联系人 | Customer（内部实体） | U | 5×10^3 | 低 |

### 2.3 case 案件域（4）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_financing_case` | 融资案件 | FinancingCase（根） | U | 10^3–10^4 | 低（状态变更时） |
| `cpx_financing_requirement` | 融资需求（版本化） | FinancingCase（值对象版本链） | U | 3×10^3–3×10^4 | 低 |
| `cpx_case_status_event` | 状态流转事件 | FinancingCase（事件流） | B | 3×10^5 | 中（每流转一条） |
| `cpx_case_material` | 案件材料清单实例 | FinancingCase（内部集合） | U | 2×10^4 | 低（立案时批量插入） |

### 2.4 authorization 授权域（2）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_case_authorization` | 案件授权 | CaseAuthorization（根） | U | 2×10^3 | 极低 |
| `cpx_case_authorization_scope` | 授权数据范围 | CaseAuthorization（内部集合） | C | 8×10^3 | 极低 |

### 2.5 document 资料域（4）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_material_requirement` | 材料清单字典 | MaterialRequirement（字典根） | U | 3×10^1 | 随发版 |
| `cpx_document` | 资料文档 | Document（根） | U | 10^5 | 低（上传时） |
| `cpx_document_version` | 文档版本 | Document（内部实体） | U | 1.5×10^5 | 低 |
| `cpx_document_review` | 资料核验记录 | Document（内部实体） | U | 3×10^5 | 低 |

### 2.6 dataimport 导入域（2）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_data_import` | 导入批次 | ImportBatch（根） | U | 10^5 | 中 |
| `cpx_data_import_record` | 原始数据行 | ImportBatch（内部实体） | B | 10^7 | 高（批量插入） |

### 2.7 dataquality 质量域（1）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_data_quality_issue` | 数据质量问题 | QualityIssue（根） | U | 10^6 | 中（每轮检查批量写） |

### 2.8 finance 财务域（5）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_financial_statement` | 财务报表（按期间） | FinancialStatement（根） | U | 10^4 | 低 |
| `cpx_financial_statement_item` | 报表科目明细 | FinancialStatement（内部实体） | B | 5×10^5 | 中（导入时批量） |
| `cpx_financial_metric` | 财务指标（计算产物） | 无（计算产物，append-only） | U | 10^6 | 中（每次重算批量） |
| `cpx_bank_transaction` | 银行流水 | BankTransaction（独立实体集合） | B | 10^7 | 高（导入） |
| `cpx_debt_record` | 债务记录 | DebtRecord（根） | U | 10^4 | 低 |

### 2.9 analysis 分析域（5）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_analysis_round` | 分析轮次（V1.1） | AnalysisRound（根） | U | 3×10^4 | 中（每次数据变更开一轮） |
| `cpx_metric_snapshot` | 指标快照（头） | MetricSnapshot（根） | U | 10^4 | 低 |
| `cpx_metric_snapshot_item` | 快照指标行（冻结值） | MetricSnapshot（内部实体） | B | 10^6 | 中（锁定快照时批量） |
| `cpx_metric_source` | 指标来源引用 | MetricSnapshot（追溯从属） | B | 3×10^6 | 中（与指标同批写） |
| `cpx_analysis_result` | 分析结果 | AnalysisResult（根） | U | 10^4 | 低 |

`cpx_analysis_round` 落在 analysis 模块（DOMAIN 第七节把 `AnalysisRound` 归 D4），但它是「数据版本 → 分析产物 → 报告」的枢纽，所以与 E 域三张表同批落地，见 3.15。

### 2.10 assessment 评估域（3）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_assessment` | 准备度评估 | Assessment（根） | U | 10^4 | 低 |
| `cpx_verification_item` | 待核实事项（V1.1） | VerificationItem（根） | U | 3×10^5 | 中 |
| `cpx_risk_finding` | 风险事项 | Assessment（内部实体） | U | 10^5 | 低 |

### 2.11 review 审核域（2）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_review_task` | 复核任务 | ReviewTask（根） | U | 3×10^4 | 低 |
| `cpx_review_record` | 复核记录 | ReviewTask（内部实体） | U | 3×10^4 | 低 |

### 2.12 report 报告域（2）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_report` | 报告 | Report（根） | U | 10^4 | 低 |
| `cpx_report_version` | 报告版本（含交付信息） | Report（内部实体） | U | 2×10^4 | 低 |

### 2.13 ai 网关域（3）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_ai_task` | AI 任务 | AiTask（根） | U | 10^6 | 中 |
| `cpx_ai_execution_log` | AI 执行明细 | AiTask（内部实体） | B | 1.2×10^6 | 高（每次尝试一条） |
| `cpx_ai_suggestion` | AI 建议 | AiTask（内部实体） | U | 10^6 | 中 |

### 2.14 audit 审计域（2）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_audit_log` | 审计日志（按月分区） | 无（append-only） | B（含分区键） | 10^7/年 | 很高 |
| `cpx_audit_anchor` | 审计日锚点（append-only） | 无（append-only） | B | 365/年 | 每日 1 次 |

> `cpx_audit_anchor` 是 CPX-SEC-01 §7.6 哈希链的落地依赖。没有它，哈希链只能防"改一行"，防不住"整表重算"。字段与写入规则见 3.12。

### 2.15 platform 平台支撑（2）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_idempotency` | 幂等键登记 | 无（技术表） | V | 10^6（24h 存活） | 高（每次写操作） |
| `cpx_field_dictionary` | 字段字典 | FieldDictionary（字典根） | U | 5×10^2 | 随发版 |

### 2.16 evidence 证据与血缘域（3，V1.1 新增）

| 表 | 中文 | 聚合归属 | PK | 预估行量 | 写入频率 |
|---|---|---|---|---|---|
| `cpx_data_version` | 数据版本 | DataVersion（根） | U | 3×10^4 | 中（每次资料变更 1 行） |
| `cpx_data_version_member` | 版本成员 | DataVersion（内部集合） | C | 3×10^5 | 中（随版本同批写） |
| `cpx_evidence_ref` | 证据引用 | EvidenceReference（根） | B | 10^7 | 很高（报告渲染时批量写） |

行量推算口径：案件 10^3–10^4，每案 3–8 个数据版本 → 版本 3×10^4；每版 5–20 个文件版本 → 成员 3×10^5；每个报告版本约 300–500 条证据引用（数字逐个挂、结论逐条挂），报告版本 2×10^4 → 证据 10^7 量级。证据引用与 `cpx_audit_log` 是同量级的表，体量对比与分区结论见 5.6。

### 2.17 相对用户给定清单的补齐与重定义（13 项）

| 新增表 | 为什么必须存在（一句话） |
|---|---|
| `cpx_user_role` | 多对多关联必须有落点，否则权限无法表达；用户清单只有三张主表，缺关联等于权限模型不可用 |
| `cpx_role_permission` | 同上，角色与权限点的绑定关系 |
| `cpx_case_status_event` | INV-12 要求每次流转记录操作人/时间/原因/守卫结果，`case` 表上的 `status` 只能存当下、存不了历史 |
| `cpx_idempotency` | BIZ-01 7.2 明确要求 24h 幂等，否则重复点击提交会生成两个复核任务甚至两次签发 |
| `cpx_ai_suggestion` | A-09 规定 AI 只能写建议表；没有这张表，"AI 只写建议"就是一句空话，AI 服务将无处落数据 |
| `cpx_financial_statement_item` | 报表必须落到科目级，否则无法重算指标、也无法把指标追溯到"哪一行数字" |
| `cpx_material_requirement` | G-C3 守卫依赖"必填资料清单"，清单必须可配置（DOMAIN 3.7 明确"守卫条件会被反复修改"） |
| `cpx_field_dictionary` | Excel/AI 提取需要表头别名与类型映射；硬编码在解析器里，每接一家银行的流水格式就要发一次版 |
| `cpx_case_material` | G-C3 需要"本案件适用哪些材料"的实例；字典变更不能追溯改变在途案件的要求，且资料无法取得时需要豁免落点 |
| `cpx_case_authorization_scope` | 同一 scope 的授权有效期不重叠必须由数据库保证（EXCLUDE 约束），`jsonb` 数组做不到 |
| `cpx_metric_snapshot_item` | 快照必须是自包含的冻结值，否则指标重算后"历史快照"实际会跟着变，INV-06 失效 |
| `cpx_metric_source` | 指标 → 原始数据行是多对多，`jsonb` 里的 id 无法建外键，追溯链会在这一层断掉（见第 8 节） |
| `cpx_financing_requirement` | 用户清单里有该表，此处定义为版本链表，承载"需求变更"留痕（DOMAIN 3.2 不变量 2） |

> 上表 13 行中有 4 张（`cpx_case_material`、`cpx_case_authorization_scope`、`cpx_metric_snapshot_item`、`cpx_metric_source`）属于"用户清单外、领域模型隐含"，其余为用户清单缺项。

V1.1 新增的 5 张表不计入本节：它们不是"用户清单缺项"，而是产品基线修正 2（案件状态与分析结果分离）、修正 3（证据链是底层能力）直接要求的新对象。缺了它们，基线里"数据版本""分析轮次""证据引用""待核实事项"四个术语在库里没有落点。五张表的字段级设计见 3.13–3.17。

---

## 三、核心表字段级 DDL 要点

只列关键表。未列出的表字段见 `data-dictionary.md`，两处定义必须一致，以字典为准。

### 3.1 `cpx_financing_case`（聚合根，U）

V1.1 改动：`status` 改名 `lifecycle` 并换成 10 个新取值；新增 `hold_from`、`previous_case_no`、`closing_note`；`archived_at` 改名 `closed_at`；删除 `data_version`（改由 `cpx_data_version` 的 `ACTIVE` 行表达）。逐条理由见 3.1.1。

| 字段 | 类型 | 空 | 默认 | 约束 / 索引 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_no | varchar(32) | N | — | UNIQUE；CHECK `~ '^CPX-[0-9]{4}-[0-9]{4}$'`；不可变 |
| customer_id | uuid | N | — | FK → `cpx_customer(id)` |
| customer_name_snapshot | varchar(200) | N | — | 立案时冻结企业全称，历史报告保留当时名称 |
| owner_user_id | uuid | N | — | FK → `cpx_user(id)` |
| lifecycle | varchar(32) | N | `'INTAKE'` | CHECK 10 个取值（见 6.1）；原列名 `status` |
| lifecycle_entered_at | timestamptz | N | `now()` | 当前生命周期进入时间，用于"停滞超 N 天"看板 |
| hold_from | varchar(32) | Y | — | CHECK 7 个可挂起状态；`lifecycle = 'ON_HOLD'` 时必填；C11 写入，C12 恢复后置空 |
| previous_case_no | varchar(32) | Y | — | FK → `cpx_financing_case(case_no)`；CHECK 格式；CHECK `<> case_no` |
| version | integer | N | `0` | 乐观锁，`CHECK (version >= 0)` |
| submitted_at | timestamptz | Y | — | C02 写入 |
| delivered_at | timestamptz | Y | — | C09 写入 |
| closed_at | timestamptz | Y | — | C10 写入（原 `archived_at`） |
| closing_note | varchar(500) | Y | — | G-C6 要求：仍有 `OPEN` 的 HIGH 待核实事项时填，提示不阻塞 |
| retention_until | date | Y | — | 交付日 + 36 个月，归档清理任务的扫描列 |
| terminated_reason | varchar(500) | Y | — | `WITHDRAWN` / `DECLINED` 必填 |
| created_at / updated_at | timestamptz | N | `now()` | 触发器维护 updated_at |
| created_by / updated_by | uuid | Y | — | 无外键 |

索引：

```sql
create unique index uq_financing_case_no on cpx_financing_case (case_no);
create index idx_financing_case_customer_lifecycle on cpx_financing_case (customer_id, lifecycle);
create index idx_financing_case_owner_lifecycle on cpx_financing_case (owner_user_id, lifecycle);
create index idx_financing_case_open on cpx_financing_case (lifecycle_entered_at)
  where lifecycle not in ('CLOSED','WITHDRAWN','DECLINED');
create index idx_financing_case_retention on cpx_financing_case (retention_until)
  where closed_at is not null;
create index idx_financing_case_previous on cpx_financing_case (previous_case_no)
  where previous_case_no is not null;
```

#### 3.1.1 改动理由与既有数据影响

| 改动 | 语义 | 理由 | 对既有数据的影响 |
|---|---|---|---|
| `status` → `lifecycle`（改名 + 换约束） | 列名与领域模型 `lifecycle` 对齐 | 旧列名 `status` 与报告版本、轮次、资料项的 `status` 同名不同义，代码里只能靠注释区分（数据字典 18.2 最后一条明令禁止）。改名是消除歧义最便宜的方式 | 需一次性映射，见下表。当前未上线，无生产数据；映射表供后续若有测试数据时使用 |
| 新增 `hold_from` | 挂起前的状态 | C12 恢复必须知道回到哪个状态。用布尔标记表达挂起会让每个守卫多判一次（workflow §3.1 已论证） | 无历史值可填，`ON_HOLD` 存量记录为 0 |
| 新增 `previous_case_no` | 承接的原案编号 | workflow §3.1「有意留白」：`CLOSED`/`WITHDRAWN`/`DECLINED` 不可复活，续做必须新建案件并引用原案。用编号而非 `previous_case_id`：引用的是"对外可见的业务事实"，不是外键关系 | 全部为 NULL |
| 新增 `closing_note` | 关闭时说明 | G-C6 要求"仍有未关闭 HIGH 事项时须说明"，该说明必须能落库并在报告/审计里被引用 | 全部为 NULL |
| `archived_at` → `closed_at` | 关闭时刻 | 新模型没有"归档"这个状态，终态叫 `CLOSED`；列名与状态名不一致会让"归档清理"与"案件关闭"两件事继续混在一起 | 改名保留值 |
| 删除 `data_version bigint` | 案件当前数据版本号 | 见下段 | 该列的值映射为 `cpx_data_version.version_no`（`WHERE status = 'ACTIVE'`） |

**为什么删 `data_version` 而不保留双轨**：V1.0 用一个自增计数器表达"财务数据变了几次"，V1.1 的 `cpx_data_version` 已经用 `(case_id, version_no)` 表达了同一件事。两套编号并存必然漂移：一个是 `UPDATE ... data_version = data_version + 1`，一个是插入新行，任何一条写入路径漏了另一套，守卫（G-R3：`snapshot.dataVersion = round.dataVersionId`）就会拿两个不同的数比较。删掉计数器后，"当前数据版本"由部分唯一索引 `uq_data_version_active (case_id) WHERE status = 'ACTIVE'` 唯一确定，一次索引查找即可。

对应地，`cpx_financial_metric.data_version` 与 `cpx_metric_snapshot.data_version` 两个 bigint 列同时删除，改为 `data_version_id uuid`（见 3.7、3.8）。这是本轮唯一一处"删列"，代价是写迁移时要多一次 join，收益是追溯链上不再有"数字对不上 id"的中间态。

旧 18 值 → 新 10 值的映射（仅用于迁移存量测试数据，不做业务回填）：

| 旧值 | 新值 | 说明 |
|---|---|---|
| `DRAFT` | `INTAKE` | 建档即受理 |
| `SUBMITTED`、`AUTHORIZATION_PENDING` | `AUTHORIZATION` | 提交后第一个动作就是等授权 |
| `DOCUMENT_REVIEW`、`NEED_MORE_DOCUMENTS` | `COLLECTING` | 旧模型把"补资料"独立成状态，新模型由资料项状态表达 |
| `DATA_EXTRACTION`、`DATA_QUALITY_CHECK`、`DATA_INCONSISTENT`、`DATA_ANALYSIS`、`RISK_ANALYSIS`、`ASSESSMENT_PENDING` | `ANALYZING` | 六个值全部是"轮次推进到哪一步"，由 `cpx_analysis_round.status` 表达 |
| `MANUAL_REVIEW`、`REPORT_PENDING`、`APPROVED` | `REVIEW` | 报告复核与签发都属于复核段；`APPROVED`（旧义"已签发"）落在待交付，不单独成状态 |
| `DELIVERED` | `DELIVERED` | 语义一致 |
| `ARCHIVED` | `CLOSED` | 改名 |
| `CUSTOMER_WITHDRAWN` | `WITHDRAWN` | 改名 |
| `REJECTED_FOR_SERVICE` | `DECLINED` | 改名 |

映射的信息损失是**有意的**：18 个值里 11 个在回答"轮次算到哪一步"，这些信息迁移后由 `cpx_analysis_round` 承载。迁移脚本必须先把轮次表建好并回填，再改案件列，否则旧状态里的进度信息会直接丢掉（见 11 节 V18 顺序）。

### 3.2 `cpx_financing_requirement`（值对象版本链，U）

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` |
| version_no | integer | N | — | CHECK `> 0`；UNIQUE `(case_id, version_no)` |
| is_current | boolean | N | `true` | 部分唯一：`(case_id) WHERE is_current` |
| financing_type | varchar(32) | N | — | CHECK 6 值 |
| purpose | varchar(500) | Y | — | G-C1 要求非空才可提交 |
| financing_amount | numeric(18,2) | N | `0` | CHECK `>= 0`（草稿可为 0，G-C1 在校验层要求 `> 0`） |
| term_months | integer | Y | — | CHECK `> 0` |
| funding_gap_amount | numeric(18,2) | Y | — | CHECK `>= 0` |
| existing_financing_amount | numeric(18,2) | Y | — | CHECK `>= 0` |
| repayment_source | varchar(500) | Y | — | — |
| expected_drawdown_on | date | Y | — | — |
| change_reason | varchar(500) | Y | — | `version_no > 1` 时必填（CHECK 见 6.1） |
| changed_by | uuid | Y | — | 无外键 |
| created_at / created_by | timestamptz / uuid | N / Y | `now()` / — | — |

为什么金额允许为 0 而不是 `> 0`：草稿阶段允许先建档后补要素。把"必须 > 0"放进 CHECK，会让用户连草稿都存不下，只能在前端做假校验——约束应当拦"永远不合法"的值，而不是"此刻不合法"的值。

### 3.3 `cpx_case_status_event`（事件流，B）

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | bigint | N | identity | PK |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` |
| seq_no | integer | N | — | UNIQUE `(case_id, seq_no)`；案件内单调递增 |
| from_status | varchar(32) | Y | — | CHECK 10 值或 NULL（创建时） |
| to_status | varchar(32) | N | — | CHECK 10 值（同 `ck_financing_case_lifecycle`） |
| transition_code | varchar(8) | N | — | CHECK `^T(0[1-9]|1[0-9]|2[01])$|^X0[12]$` |
| action_name | varchar(64) | N | — | 与转换表动作列一致，如"提交复核" |
| actor_type | varchar(8) | N | — | CHECK `USER / SYSTEM` |
| actor_user_id | uuid | Y | — | 无外键（历史事件的 actor 可能已停用） |
| reason | varchar(500) | Y | — | 退回、撤回、不予服务必填 |
| guard_code | varchar(16) | Y | — | `G-C1`–`G-C7` / `G-R1`–`G-R5` / `G-P1`–`G-P6`（V1.1 随五状态机改名；长度由 8 放宽到 16） |
| guard_passed | boolean | Y | — | — |
| guard_result | jsonb | Y | — | 结构化阻断项，直接回给前端（BIZ-01 7.3） |
| occurred_at | timestamptz | N | `now()` | — |
| trace_id | varchar(64) | Y | — | 与审计、AI 调用串联 |

为什么需要 `seq_no` 而不是只靠 `occurred_at`：同一毫秒内可能连续两次自动流转（C03 进入授权），`timestamptz` 精度足够但排序不稳定；时间线是客诉时的第一手材料，必须严格有序。

### 3.4 `cpx_case_authorization` + `cpx_case_authorization_scope`（U / 复合）

| 字段（主表） | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` |
| authorization_no | varchar(32) | N | — | UNIQUE |
| purpose | varchar(500) | N | — | 必须写明"用于本次融资准备服务" |
| valid_from / valid_to | date | N | — | CHECK `valid_to >= valid_from` |
| granted_by_name | varchar(100) | N | — | 客户方授权签署人 |
| granted_by_user_id | uuid | N | — | 我方登记人，FK → `cpx_user(id)` |
| granted_at | timestamptz | N | `now()` | — |
| revoked_at | timestamptz | Y | — | — |
| revoke_reason | varchar(500) | Y | — | 撤销时必填 |
| evidence_document_id | uuid | Y | — | FK → `cpx_document(id)`，授权书原件 |

| 字段（范围表） | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| authorization_id | uuid | N | — | PK 之一，FK → 主表 |
| data_scope | varchar(32) | N | — | PK 之一，CHECK 5 值 |
| case_id | uuid | N | — | 反规范化，供 EXCLUDE 约束使用 |
| valid_from / valid_to | date | N | — | 与主表同值，反规范化 |
| revoked_at | timestamptz | Y | — | 与主表同值，反规范化 |

```sql
create extension if not exists btree_gist;

alter table cpx_case_authorization_scope
  add constraint ex_auth_scope_no_overlap
  exclude using gist (
    case_id with =,
    data_scope with =,
    daterange(valid_from, valid_to, '[]') with &&
  ) where (revoked_at is null);
```

这是本设计里唯一使用 `EXCLUDE` 的地方，值得解释：DOMAIN 3.3 要求"同一 dataScope 在同一时刻只能有一条有效授权"。用普通唯一索引表达不了"时间区间不重叠"，只能退化成"同一时刻只能有一条记录"——那会禁止提前登记下一期授权（旧授权 6/30 到期，6/1 就该签新授权书）。`daterange &&` 精确表达了这个不变量，且允许未来区间并存。`case_id` / `valid_from` / `valid_to` / `revoked_at` 反规范化的唯一目的就是让这条约束能被数据库直接执行，写入时由同一事务维护两张表。

### 3.5 `cpx_document` + `cpx_document_version`（U）

| 字段（document） | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` |
| doc_type | varchar(64) | N | — | 对应 `cpx_material_requirement.material_code`；不加 CHECK |
| title | varchar(200) | N | — | 用户可读标题 |
| period_label | varchar(16) | Y | — | 文件覆盖期间，如 `2025-01`；同类型多期文件的区分依据 |
| data_scope | varchar(32) | Y | — | 该文件涉及的数据范围，用于授权拦截 |
| current_version_id | uuid | Y | — | FK → `cpx_document_version(id)`，同事务维护 |
| deleted_at | timestamptz | Y | — | 仅 `UPLOADED` 状态可置 |
| created_at / updated_at / created_by / updated_by | — | — | — | 标准四列 |

| 字段（version） | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| document_id | uuid | N | — | FK → `cpx_document(id)` |
| version_no | integer | N | — | UNIQUE `(document_id, version_no)`，CHECK `> 0` |
| storage_key | varchar(500) | N | — | UNIQUE；`{customerId}/{caseId}/{documentId}/v{n}/{documentId}_{sha8}.{ext}` |
| original_filename | varchar(255) | N | — | **仅用于展示**，绝不参与路径拼接（A-10） |
| mime_type | varchar(128) | Y | — | — |
| file_size_bytes | bigint | N | — | CHECK `> 0` |
| sha256 | char(64) | N | — | CHECK 64 位小写十六进制 |
| page_count | integer | Y | — | PDF 页数 |
| verification_state | varchar(32) | N | `'UPLOADED'` | CHECK 5 值（UPLOADED/PARSED/VERIFIED/REJECTED/SUPERSEDED）；V1.1 移除 `PARSE_FAILED` |
| uploaded_by | uuid | Y | — | 无外键 |
| uploaded_at | timestamptz | N | `now()` | — |
| superseded_at | timestamptz | Y | — | 被新版本替代时刻 |
| purged_at | timestamptz | Y | — | 二进制按保留期清除时刻（8.3） |
| deleted_at | timestamptz | Y | — | 仅 `UPLOADED` 可置 |

```sql
-- 每个文档最多一个"未作废、未删除"的版本，兜住 current_version_id 的漂移
create unique index uq_document_version_current
  on cpx_document_version (document_id)
  where verification_state <> 'SUPERSEDED' and deleted_at is null;

create index idx_document_case_type on cpx_document (case_id, doc_type) where deleted_at is null;
create index idx_document_version_sha on cpx_document_version (sha256);
```

`sha256` 放在版本而不是文档上：同一文档多版本哈希必然不同，放在文档上只能存"最新一次"，去重会漏。去重提示按 `(case_id, sha256)` join 文档表实现（DOMAIN 3.4 不变量 2：提示但不拒收）。

### 3.6 `cpx_data_quality_issue`（聚合根，U）

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` |
| rule_code | varchar(32) | N | — | 如 `DQ-REV-01`，不加 CHECK |
| rule_version | varchar(16) | N | — | 规则版本，重跑可比对 |
| severity | varchar(32) | N | — | CHECK `BLOCKER / MAJOR / MINOR / INFO` |
| status | varchar(32) | N | `'OPEN'` | CHECK `OPEN / ACKNOWLEDGED / RESOLVED / WAIVED` |
| title | varchar(200) | N | — | — |
| detail | varchar(2000) | Y | — | 禁止定性指控措辞（INV-13） |
| dedupe_key | varchar(200) | N | — | 由 rule_code + 目标对象 + 关键值生成的稳定摘要 |
| target_type | varchar(32) | Y | — | `STATEMENT_ITEM / BANK_TXN / METRIC / DOCUMENT / DEBT` |
| target_id | varchar(64) | Y | — | 多态引用，不建外键 |
| evidence_refs | jsonb | N | `'[]'` | CHECK `jsonb_typeof = 'array'` |
| resolution | varchar(1000) | Y | — | — |
| resolved_by / resolved_at | uuid / timestamptz | Y | — | — |
| waived_by / waived_at | uuid / timestamptz | Y | — | 豁免必须留人 |
| waiver_reason | varchar(1000) | Y | — | 豁免理由 |
| waiver_approved_by | uuid | Y | — | 批准人 |
| detected_at | timestamptz | N | `now()` | — |
| created_at / updated_at | timestamptz | N | `now()` | — |

```sql
-- G-R2 守卫的专用索引，谓词必须与查询完全一致才会命中
create index idx_quality_issue_blocker_open
  on cpx_data_quality_issue (case_id)
  where severity = 'BLOCKER' and status in ('OPEN','ACKNOWLEDGED');

-- 同一案件同一问题不重复登记
create unique index uq_quality_issue_dedupe
  on cpx_data_quality_issue (case_id, dedupe_key)
  where status in ('OPEN','ACKNOWLEDGED');
```

### 3.7 `cpx_financial_metric`（计算产物，append-only，U）

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` |
| metric_code | varchar(64) | N | — | 不加 CHECK，由 Java `MetricCode` 枚举维护 |
| period_type | varchar(8) | N | — | CHECK `YEAR / QUARTER / MONTH / POINT / TTM` |
| data_period | varchar(10) | N | — | 规范标签：`2025`、`2025-03`、`2025Q1`、`2025-12-31` |
| value_amount | numeric(18,2) | Y | — | 金额类指标 |
| value_ratio | numeric(10,6) | Y | — | 比率类指标 |
| value_days | integer | Y | — | 天数类指标 |
| unit | varchar(16) | N | — | CHECK `CNY / PERCENT / DAYS / TIMES` |
| formula | varchar(1000) | N | — | 人类可读公式文本 |
| formula_version | varchar(16) | N | — | 公式版本，A-08 硬要求 |
| data_version_id | uuid | N | — | FK → `cpx_data_version(id)`；V1.1 新增，替代原 `data_version bigint` |
| source_refs | jsonb | N | `'[]'` | 展示用摘要；真实外键在 `cpx_metric_source` |
| computed_at | timestamptz | N | `now()` | — |
| superseded_at | timestamptz | Y | — | 被重算替代时刻 |
| superseded_by | uuid | Y | — | 自引用 FK，指向替代它的新行 |
| created_at / created_by | timestamptz / uuid | N / Y | `now()` / — | — |

```sql
alter table cpx_financial_metric
  add constraint ck_financial_metric_single_value
  check (num_nonnulls(value_amount, value_ratio, value_days) = 1);

-- "同一数据版本下，同一指标同一期间同一公式版本只保留一个当前值"
create unique index uq_financial_metric_current
  on cpx_financial_metric (case_id, data_version_id, metric_code, data_period, formula_version)
  where superseded_at is null;

-- 历史版本查询（第 10 节 Q2）
create index idx_financial_metric_history
  on cpx_financial_metric (case_id, metric_code, data_period, computed_at desc);

create index idx_financial_metric_data_version
  on cpx_financial_metric (data_version_id, metric_code);
```

**为什么 `uq_financial_metric_current` 必须加 `data_version_id`（V1.1 修正）**：V1.0 的索引是 `(case_id, metric_code, data_period, formula_version) WHERE superseded_at IS NULL`。在多轮模型下这条会直接拒绝合法写入——第 2 轮基于新数据重算 `REVENUE / 2025 / v1.2`，旧行未被 `superseded`（它仍然是第 1 轮的有效结论，报告要能引用），新行插入即撞唯一键。而如果把旧行标记为 superseded，第 1 轮的报告就拿不到"当前值"，历史链被自己破坏。加上 `data_version_id` 后，语义从"每案每指标只有一个当前值"变成"每案**每数据版本**每指标只有一个当前值"，这才是多轮模型真正要的不变量。代价：查"最新指标值"时必须先定位 ACTIVE 数据版本，多一次索引查找。

`data_version` → `data_version_id` 的替换理由：bigint 计数器无法 join，只能靠两端各自维护同一个数字；而追溯链的第四层要求"从指标一步跳到数据版本"。用 uuid 外键，`report → round → data_version → metric` 与 `metric → data_version` 两条方向都是真实外键。

为什么用 `num_nonnulls(...) = 1` 而不是一个 `numeric(24,6) value`：A-02 要求金额 `numeric(18,2)`、比率 `numeric(10,6)`。合并成一列就必须在 18,6 和 10,6 之间二选一——选前者让比率少 6 位有效数字，选后者让万亿级金额溢出。三列 + 互斥 CHECK 是唯一同时满足两条精度要求的写法，代价是 Java 侧多一个 `MetricValue` 值对象封装。

### 3.8 `cpx_metric_snapshot` / `_item` / `cpx_metric_source`

`cpx_metric_snapshot`（U）

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | FK |
| snapshot_no | integer | N | — | UNIQUE `(case_id, snapshot_no)` |
| round_no | integer | N | — | V1.1 新增；复合 FK `(case_id, round_no)` → `cpx_analysis_round(case_id, round_no)` |
| data_version_id | uuid | N | — | V1.1 新增；FK → `cpx_data_version(id)`；复合 FK `(case_id, data_version_id)` → `cpx_data_version(case_id, id)` |
| metric_count | integer | N | — | 快照包含的指标行数 |
| digest | char(64) | N | — | 对指标集合按固定顺序串联后的 SHA-256，快照指纹 |
| locked | boolean | N | `false` | G-R3 判定依据 |
| locked_at / locked_by | timestamptz / uuid | Y | — | — |
| created_at / created_by | timestamptz / uuid | N / Y | `now()` / — | — |

```sql
create index idx_metric_snapshot_case_locked on cpx_metric_snapshot (case_id, snapshot_no desc)
  where locked;
create index idx_metric_snapshot_round on cpx_metric_snapshot (case_id, round_no);
create index idx_metric_snapshot_data_version on cpx_metric_snapshot (data_version_id);
```

不给 `(case_id, data_version_id)` 加唯一约束：公式版本升级会改变指标值但数据版本不变，此时必须允许同一 `data_version_id` 存在新快照（同一轮内重算也会产生新 `snapshot_no`）。"本轮快照"由 `cpx_analysis_round.metric_snapshot_id` 唯一指向，不靠"取最大号"猜。

**`round_no` 是快照自己要回答的问题，不是冗余**：`analysis_round.metric_snapshot_id` 是反向指针，且允许为空（开轮时还没有快照）。渲染、审计、按轮清理都需要"这个快照属于哪一轮"，必须能单表回答。

**插入顺序**：`cpx_analysis_round` 与 `cpx_metric_snapshot` 互相引用（轮次指向快照，快照带 `round_no`），构成一个环。解法是三步同事务：① 插入轮次（`metric_snapshot_id` 为 NULL）→ ② 插入快照（`round_no` 已知）→ ③ 回填 `round.metric_snapshot_id`。两侧外键都可空/延后，所以不需要 `DEFERRABLE`，但**禁止**把三步拆到不同事务——中间态会让 G-R3 读到"COMPUTED 但没有快照"的轮次。

`cpx_metric_snapshot_item`（B）：`snapshot_id`（FK）、`metric_id`（FK → `cpx_financial_metric`）、`metric_code`、`period_type`、`data_period`、`value_amount` / `value_ratio` / `value_days`、`unit`、`formula_version`、`computed_at`、`created_at`；唯一 `(snapshot_id, metric_id)`，索引 `(snapshot_id, metric_code)`。

值列在快照行里冗余一份，不做纯引用：DOMAIN 3.8 要求分析结果绑定**不可变**快照，报告渲染器要能单表读出全部数字。引用式快照一旦遇到指标行被归档或保留期清理，历史报告就会渲染空白——这是不可接受的失败模式，宁可多存一份 30 字节的数字。

`cpx_metric_source`（B，追溯表）：

| 字段 | 类型 | 空 | 约束 |
|---|---|---|---|
| id | bigint | N | PK |
| metric_id | uuid | N | FK → `cpx_financial_metric(id)` |
| case_id | uuid | N | 反规范化，供按案件清理 |
| source_type | varchar(16) | N | CHECK `STATEMENT_ITEM / BANK_TXN / DEBT_RECORD` |
| statement_item_id | bigint | Y | FK → `cpx_financial_statement_item(id)` |
| bank_transaction_id | bigint | Y | FK → `cpx_bank_transaction(id)` |
| debt_record_id | uuid | Y | FK → `cpx_debt_record(id)` |
| source_row_no | integer | Y | 原始文件行号 |
| aggregation_role | varchar(16) | Y | CHECK `NUMERATOR / DENOMINATOR / SUM / INPUT` |

```sql
alter table cpx_metric_source add constraint ck_metric_source_exclusive check (
  (source_type = 'STATEMENT_ITEM' and statement_item_id is not null
     and bank_transaction_id is null and debt_record_id is null)
  or (source_type = 'BANK_TXN' and bank_transaction_id is not null
     and statement_item_id is null and debt_record_id is null)
  or (source_type = 'DEBT_RECORD' and debt_record_id is not null
     and statement_item_id is null and bank_transaction_id is null)
);
create index idx_metric_source_metric on cpx_metric_source (metric_id, aggregation_role);
create index idx_metric_source_stmt_item on cpx_metric_source (statement_item_id)
  where statement_item_id is not null;
```

三列可空外键换真实外键约束，是本设计里最值得坚持的取舍之一：`jsonb` 存 `{"type":"STATEMENT_ITEM","id":123}` 看起来也能追溯，但它断链时数据库不会报错，等到出报告才发现某个指标指向一条已不存在的记录。宽表的代价是每行多 20 字节，换来的是"追溯链不可能断"。

### 3.9 `cpx_assessment` / `cpx_risk_finding`

| 字段（assessment） | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | FK |
| assessment_no | integer | N | — | UNIQUE `(case_id, assessment_no)` |
| round_no | integer | N | — | V1.1 新增；复合 FK `(case_id, round_no)` → `cpx_analysis_round(case_id, round_no)` |
| snapshot_id | uuid | N | — | FK → `cpx_metric_snapshot(id)`，必须是 `locked = true` 的快照（应用层校验） |
| analysis_refs | jsonb | N | `'[]'` | 引用到的 analysis_result id 列表，展示用 |
| readiness_outcome | varchar(32) | Y | — | CHECK `READY / NEED_SUPPLEMENT / INSUFFICIENT`，G-R4 前可为空 |
| dimensions | jsonb | N | — | **准备度五维**结果（V1.1 重定义，见下） |
| summary | varchar(2000) | Y | — | 不得出现授信评级、通过率、获批概率 |
| frozen_at / frozen_by | timestamptz / uuid | Y | — | 复核通过后冻结，修改需新版本 |
| is_current | boolean | N | `true` | 部分唯一 `(case_id, round_no) WHERE is_current`（V1.1 改，原为 `(case_id)`） |
| created_at / created_by | timestamptz / uuid | N / Y | `now()` / — | — |

| 字段（risk_finding） | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | V1.1 新增；FK，复合 FK `(case_id, round_no)` → `cpx_analysis_round(case_id, round_no)` |
| round_no | integer | N | — | V1.1 新增；归属轮次 |
| assessment_id | uuid | Y | — | V1.1 由 NOT NULL 改可空；FK → `cpx_assessment(id)`；复合 FK `(assessment_id, round_no)` → `cpx_assessment(id, round_no)` |
| finding_no | integer | N | — | UNIQUE `(case_id, round_no, finding_no)`（V1.1 改，原为 `(assessment_id, finding_no)`） |
| category | varchar(32) | N | — | CHECK 7 值 |
| severity | varchar(16) | N | — | CHECK `HIGH / MEDIUM / LOW` |
| title | varchar(200) | N | — | — |
| description | varchar(2000) | Y | — | 禁止定性指控（INV-13） |
| impact | jsonb | Y | — | 结构化影响，如受影响金额与期间 |
| suggestion | varchar(2000) | Y | — | — |
| evidence_refs | jsonb | N | — | CHECK `jsonb_array_length(evidence_refs) >= 1`（DOMAIN 3.9 不变量 2） |
| created_at | timestamptz | N | `now()` | — |

#### 3.9.1 `cpx_assessment` 只承载准备度评估，不含偿债能力（V1.1 重定义）

`dimensions` 的五个键必须是准备度维度，**不得包含 `debtService` / `operating` / `cashFlow`**。V1.0 的字典写的是"经营 / 现金流 / 偿债 / 数据完备 / 资料合规"，其中偿债维度直接违反基线修正 1（首期不评估偿债能力），必须替换：

| 键 | 中文 | 检查内容 | 数据来源 |
|---|---|---|---|
| `completeness` | 资料完整性 | 必填资料是否齐备或已豁免 | `cpx_case_material` 计数 |
| `verifiability` | 数据可核验性 | 关键数字能否追到具体资料与行号 | `cpx_evidence_ref` 覆盖率 |
| `consistency` | 口径一致性 | 不同来源的数据能否相互解释 | `cpx_data_quality_issue` + `cpx_verification_item` |
| `clarity` | 需求清晰度 | 用途、金额、期限、资金缺口是否明确 | `cpx_financing_requirement` 当前版本 |
| `verificationItems` | 待核实事项 | 是否存在未处理的 HIGH 级事项 | `cpx_verification_item` 计数 |

每键含 `status`（`GOOD / FAIR / WEAK / UNKNOWN`）与 `basis`（指标 id 或对象 id 数组）。键名固定由 Java 常量保证，数据库不做嵌套 schema 校验（理由同 V1.0：`jsonb_path_exists` 的维护成本高于收益）。

结论仍只有三档，不输出分数：三档取值沿用 `READY` / `NEED_SUPPLEMENT` / `INSUFFICIENT`，中文标签分别是「可进入正式资料提交准备」/「补充指定资料后再评估」/「当前信息不足」。数据库存码，中文标签由 Java 文案模板给出——把中文存进库会让文案调整变成数据迁移。

#### 3.9.2 与 `cpx_risk_finding` 的关系：并列，不是父子（V1.1 修正）

| 维度 | `cpx_assessment` | `cpx_risk_finding` |
|---|---|---|
| 回答的问题 | 准备得怎么样 | 这件事对融资准备意味着什么 |
| 是否进入结论 | 是（三档结论的唯一来源） | 否。只作为报告的分析章节与证据，**不参与**结论推导 |
| 归属 | 一轮一次评估 | 一轮可有多条，产生时点早于评估 |
| 与轮次的关系 | `round_no` 外键 | `round_no` 外键 |
| 与对方的关系 | 不引用风险事项 | `assessment_id` 可空回填，仅表示"这条事项被写进了某次评估的报告章节" |

V1.0 把 `risk_finding` 设计成 `assessment` 的内部实体（`assessment_id NOT NULL`），在多轮模型下有两个具体问题：① 风险事项由分析规则产出，发生时间早于评估，强制挂评估会导致"先建一个空评估"或"产出后等评估再插"；② 评估重算会产生新 `assessment_no`，旧风险事项要么变成孤儿、要么被迫整组复制。改为同挂 `round_no`、`assessment_id` 可空回填，两个问题都消失。

`(assessment_id, round_no)` 的复合外键是防漂移用的：`cpx_assessment.id` 是主键，`unique (id, round_no)` 平凡成立，因此可以直接拿它当复合外键的目标，保证回填的 `assessment_id` 与本行 `round_no` 属于同一轮。这个"用平凡唯一键做复合外键"的写法在本设计中重复出现（`cpx_report_version`、`cpx_data_version`），是本轮保证"每一层都是真实外键"的主手段，不依赖任何触发器。

```sql
alter table cpx_assessment add constraint uq_assessment_id_round unique (id, round_no);
alter table cpx_risk_finding
  add constraint fk_risk_finding_assessment_round
  foreign key (assessment_id, round_no) references cpx_assessment (id, round_no);
create index idx_risk_finding_round on cpx_risk_finding (case_id, round_no, severity);
```

### 3.10 `cpx_report` / `cpx_report_version`

`cpx_report`（U）：`id`、`case_id`（FK）、`report_no`（UNIQUE）、`title`、`template_code`、`current_version_no`、标准四列。唯一 `(case_id)`：一个案件只有一份报告，多轮多版是同一报告的多个版本。

**V1.1 把 `status`、`issued_at`、`issued_by`、`voided_at`、`void_reason` 从 `cpx_report` 下沉到 `cpx_report_version`**。理由有两层：① 修正 2 要求"报告版本"独立成一个生命周期，而 V1.0 的 `cpx_report_version` 根本没有状态列，效力事实全放在容器上——这正是"一个字段表达多个维度"的原型；② 同案多版共存（workflow §5.3：V1、V2 都保持 `DELIVERED`）时，容器级 `status` 无法同时表达两个版本的效力，`uq_report_case_active (case_id) WHERE status <> 'VOID'` 会直接拒绝第二份报告进入流程。下沉后约束改为 `(report_id, version_no)` 与 `(report_id, round_no)` 两条唯一。

`cpx_report_version`（U）：

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| report_id | uuid | N | — | FK → `cpx_report(id)`；UNIQUE `(report_id, version_no)` |
| case_id | uuid | N | — | V1.1 新增；复合 FK `(report_id, case_id)` → `cpx_report(id, case_id)`，保证与报告的归属一致 |
| version_no | integer | N | — | CHECK `> 0` |
| round_no | integer | N | — | V1.1 新增；复合 FK `(case_id, round_no)` → `cpx_analysis_round(case_id, round_no)`；部分唯一 `(report_id, round_no) WHERE status <> 'VOID'` |
| status | varchar(32) | N | `'DRAFT'` | V1.1 新增；CHECK `DRAFT / IN_REVIEW / APPROVED / ISSUED / DELIVERED / VOID` |
| snapshot_id | uuid | N | — | FK → `cpx_metric_snapshot(id)` |
| assessment_id | uuid | N | — | FK → `cpx_assessment(id)` |
| storage_key | varchar(500) | N | — | UNIQUE，PDF 落存储 |
| file_sha256 | char(64) | N | — | 交付哈希（DOMAIN 3.11 不变量 4） |
| file_size_bytes | bigint | N | — | — |
| content_hash | char(64) | N | — | V1.1 新增；正文内容（模板变量 + 指标值 + 结论文本）的规范化 SHA-256 |
| render_input_hash | char(64) | N | — | 渲染输入摘要（指标集合 + 模板版本 + 结论版本） |
| metric_refs | jsonb | N | — | 报告中引用的 metric_id 清单；渲染器拒绝渲染无 metric_id 的数字（A-08） |
| evidence_check_result | jsonb | N | — | V1.1 新增；渲染前证据校验结果（通过/缺失项/校验时间/校验的 dataVersionId） |
| generated_at / generated_by | timestamptz / uuid | N / Y | `now()` / — | — |
| issued_at / issued_by | timestamptz / uuid | Y | — | P05 写入；`status IN ('ISSUED','DELIVERED')` 时必填，且 `issued_by` 不得为空 |
| delivered_at | timestamptz | Y | — | G-C5/G-P5 判定依据 |
| delivery_method | varchar(16) | Y | — | CHECK `EMAIL / DOWNLOAD / ONSITE / OTHER` |
| delivered_to_name | varchar(100) | Y | — | 接收人 |
| delivered_to_contact | varchar(100) | Y | — | 接收联系方式（脱敏存） |
| delivery_evidence_document_id | uuid | Y | — | FK → `cpx_document(id)` |
| voided_at / void_reason | timestamptz / varchar(500) | Y | — | P07/P08 写入；`status = 'VOID'` 时必填 |
| replacement_version_no | integer | Y | — | G-P6 要求：作废已签发版本时必须给替代版本或标记案件终止 |
| created_at | timestamptz | N | `now()` | — |

```sql
alter table cpx_report add constraint uq_report_id_case unique (id, case_id);

alter table cpx_report_version add constraint ck_report_delivery_complete check (
  delivered_at is null
  or (delivery_method is not null and delivered_to_name is not null
      and delivered_to_contact is not null and file_sha256 is not null)
);

alter table cpx_report_version add constraint ck_report_version_issued check (
  status not in ('ISSUED','DELIVERED') or (issued_at is not null and issued_by is not null)
);

alter table cpx_report_version add constraint ck_report_version_void check (
  status <> 'VOID' or (void_reason is not null and voided_at is not null)
);

-- 报告版本与轮次：一版只挂一轮；同一轮只有在旧版作废后才允许再出一版（workflow §2「同一轮可因笔误修订」）
create unique index uq_report_version_round
  on cpx_report_version (report_id, round_no) where status <> 'VOID';
```

**三个哈希列各管一件事，不能合并**：

| 列 | 覆盖什么 | 用来判定 | 变了说明什么 |
|---|---|---|---|
| `render_input_hash` | 输入（指标 id + 值 + 模板版本 + 结论文本） | 同输入必同输出（DOMAIN 3.11 不变量） | 数据或模板变了 |
| `content_hash` | 正文规范化文本（去掉字体、时间戳、页码） | G-P2「内容哈希稳定」，复核的是这一版内容 | 正文被人改过 |
| `file_sha256` | 导出 PDF 的字节 | G-P5 交付校验，客户手里那份就是这份 | 重新导出过（字体/元数据可能不同） |

若只用 `file_sha256` 做 G-P2 守卫，同一份内容用不同机器导出会得到不同哈希，复核会被无意义地卡住；若只用 `content_hash`，则无法证明发出去的文件没被替换。三者分工明确，任何两列合并都会丢掉一个能力。

`round_no` 让"报告版本 → 分析轮次"成为一条普通外键，而不是靠 `snapshot_id` 反推轮次——`snapshot_id` 只能证明"用了哪份指标"，证明不了"基于哪一轮的结论"，且同一轮重算后快照会换，反推就断了。

交付信息不单独建表：一个版本只交付一次，重发是同一文件的再次传输，记入 `cpx_audit_log`（动作 `REPORT_REDELIVER`）。为"可能重发"建一张只有两三个字段的表，收益不抵维护成本；而 G-P5 需要的是"这个版本是否已完整交付"，列上就能判定。

### 3.11 `cpx_audit_log`（分区父表）

| 字段 | 类型 | 空 | 默认 | 说明 |
|---|---|---|---|---|
| id | bigint | N | identity | 与 `occurred_at` 组成 PK |
| occurred_at | timestamptz | N | `now()` | 分区键 |
| actor_user_id | uuid | Y | — | 匿名/系统为 NULL |
| actor_type | varchar(8) | N | — | CHECK `USER / SYSTEM / ANON` |
| actor_role | varchar(32) | Y | — | 角色码快照 |
| action | varchar(64) | N | — | 如 `DOCUMENT_DOWNLOAD`、`CASE_STATUS_CHANGE` |
| resource_type | varchar(32) | N | — | 多态，不建外键 |
| resource_id | varchar(64) | Y | — | UUID 与 bigint 混存，统一转字符串 |
| case_id | uuid | Y | — | 按案件检索的主路径 |
| result | varchar(16) | N | — | CHECK `SUCCESS / DENIED / FAILED` |
| ip | inet | Y | — | — |
| user_agent | varchar(500) | Y | — | — |
| trace_id | varchar(64) | Y | — | — |
| detail | jsonb | Y | — | 变更前后值、守卫结果；写入前脱敏 |

`PRIMARY KEY (id, occurred_at)`：PG 要求分区表的主键包含全部分区键。`id` 用 identity，跨分区全局唯一。

### 3.12 `cpx_audit_anchor`（日锚点，append-only，B）

哈希链需要一个"链外参照物"：把每天链头的 `record_hash` 写进一张独立表，并随备份同步到异机。这样即使有人用超级用户权限重算了整张审计表，重算结果也对不上已经外发的锚点文件。

| 字段 | 类型 | 空 | 默认 | 说明 |
|---|---|---|---|---|
| id | bigint generated always as identity | N | — | 主键 |
| anchor_date | date | N | — | 锚点日期，唯一 |
| chain_head_hash | char(64) | N | — | 当日最后一条 `record_hash` |
| record_count | bigint | N | — | 当日审计条数，用于发现"删一片" |
| signature | char(64) | Y | — | 锚点行自身的哈希，覆盖前 4 列 |
| created_at | timestamptz | N | now() | — |

```sql
create table cpx_audit_anchor (
  id              bigint generated always as identity primary key,
  anchor_date     date        not null,
  chain_head_hash char(64)    not null,
  record_count    bigint      not null,
  signature       char(64),
  created_at      timestamptz not null default now(),
  constraint uq_audit_anchor_date unique (anchor_date)
);
```

**写入规则**：每日 00:05 由定时任务写入前一日锚点，同时输出 `storage/logs/audit-anchor/{date}.txt`，随备份异机同步。锚点表与审计表一样禁止 `UPDATE`/`DELETE`。

**校验规则**：① 逐条重算 `record_hash`；② `prev_hash` 连续无断点；③ 每日链头 = 锚点 `chain_head_hash`；④ 当日实际条数 = 锚点 `record_count`。

**诚实的局限**：如果攻击者同时握有数据库超级用户权限、锚点文件的异机写权限与全部备份，整条链仍可被重算。单机部署下这是投入产出比的上限；要真正解决需要外部时间戳服务（RFC 3161）或写入只读存储（WORM），属于首期不做项。

### 3.13 `cpx_data_version`（E 域聚合根，U）

一次数据变更产生一个版本。它不存数据本身，只存"哪一版资料构成了这一版数据"，以及"这份构成是否真的变了"。

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)`；UNIQUE `(case_id, version_no)`、`(case_id, digest)` 的首列 |
| version_no | integer | N | — | `CHECK (> 0)`；案件内从 1 递增，不可变 |
| digest | char(64) | N | — | `CHECK (~ '^[0-9a-f]{64}$')`；成员文件内容哈希的有序拼接再哈希，**INV-19 的判定依据** |
| trigger_type | varchar(32) | N | — | CHECK `INITIAL / DOCUMENT_ADDED / DOCUMENT_REPLACED / DOCUMENT_REMOVED / MANUAL_CORRECTION` |
| trigger_ref | varchar(64) | Y | — | 触发对象标识；`DOCUMENT_*` 三类写 `document_version_id`，`MANUAL_CORRECTION` 写修正单号。**多态，不建外键**（理由见 7.4） |
| status | varchar(32) | N | `'ACTIVE'` | CHECK `ACTIVE / SUPERSEDED` |
| superseded_at | timestamptz | Y | — | 转 `SUPERSEDED` 的时刻；`CHECK (status <> 'SUPERSEDED' or superseded_at is not null)` |
| created_at | timestamptz | N | `now()` | — |
| created_by | uuid | Y | — | 无外键；系统触发的版本为 NULL |

```sql
create unique index uq_data_version_no on cpx_data_version (case_id, version_no);

-- INV-19：同一案件内 digest 不得重复，重复即"数据没变"，数据库直接拒绝新版本
create unique index uq_data_version_digest on cpx_data_version (case_id, digest);

-- "案件当前数据版本"唯一确定，替代 cpx_financing_case.data_version 计数器
create unique index uq_data_version_active on cpx_data_version (case_id) where status = 'ACTIVE';

-- 供 cpx_metric_snapshot / cpx_evidence_ref 做 (case_id, id) 复合外键
create unique index uq_data_version_case_id on cpx_data_version (case_id, id);

create index idx_data_version_case on cpx_data_version (case_id, version_no desc);
```

**digest 的精确定义**（写进 Java `DigestCalculator`，不允许各模块自己拼）：

```
digest = sha256( join(';', sorted_by(document_version.sha256 asc) of member:
                        document_version.sha256 || '|' || coalesce(scope_note, '')
                     ) )
```

排序键是文件内容哈希而不是 `document_version_id`。这一点决定 INV-19 能否真正生效：企业把同一份文件重传一次，会产生新的 `document_version` 行（新 id、同 `sha256`），若 digest 含 id，重复上传就会产生新版本并白跑一轮分析——正是领域模型要防的那个失败模式。

**唯一约束带来的三种写入结果**（`uq_data_version_digest` 冲突不能一律报错）：

| 情形 | 判定 | 处理 | 审计动作 |
|---|---|---|---|
| digest 与当前 `ACTIVE` 版本相同 | 数据未变（重传同一文件、或变更净效果为零） | 不建版本、不开轮，返回现有 `data_version_id` | `DATA_VERSION_DUPLICATE` |
| digest 与某个 `SUPERSEDED` 历史版本相同 | 数据集回到历史状态（如 A+B → A+B+C → A+B） | 不新建版本；把该历史版本置回 `ACTIVE`，原 `ACTIVE` 置 `SUPERSEDED` 并写 `superseded_at`；正常开新轮绑定它 | `DATA_VERSION_REACTIVATED` |
| 都不同 | 正常变更 | 新建版本（`version_no = max + 1`）并开轮 | `DATA_VERSION_CREATED` |

第二行是本设计里唯一一处**削弱"旧版本永久只读"**的地方，必须明说：`cpx_data_version` 的 `id` / `version_no` / `digest` / 成员集合全部不可变，"只读"在内容层面严格成立；只有 `status` 允许 `SUPERSEDED → ACTIVE` 回摆，因为"数据集回到 V1"这件事本身就是真话，而让 V3 与 V1 共享同一 digest 会让"某 digest 对应哪个版本"变成一对多，比状态回摆更难处理。

替代方案（已否决）：把唯一约束降级为 `(case_id, digest) WHERE status = 'ACTIVE'`，允许历史上出现两行同 digest。否决理由：那样 INV-19 只在"与当前版本重复"时成立，而基线要求的是"digest 相同不得产生新版本"这条不变量本身，不是它的一个近似。

**状态迁移的语句顺序**：置旧版 `SUPERSEDED` 必须先于插入新 `ACTIVE` 行，否则 `uq_data_version_active` 会瞬时冲突。两者在同一事务内，顺序固定为 `UPDATE 旧 → INSERT 新 → INSERT 成员 → INSERT 轮次`。

### 3.14 `cpx_data_version_member`（复合主键）

表达"这一版数据由哪些文件版本构成"。没有它，`digest` 只是一个摘要，无法回答"V2 到底替换了哪份文件"。

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| data_version_id | uuid | N | — | PK 之一；FK → `cpx_data_version(id)` |
| document_version_id | uuid | N | — | PK 之一；FK → `cpx_document_version(id)` |
| scope_note | varchar(200) | Y | — | 该文件下被采纳的范围，如 `2025-01..2025-12`、`sheet:流水!A3:J5002` |
| created_at | timestamptz | N | `now()` | — |

```sql
create index idx_data_version_member_doc on cpx_data_version_member (document_version_id, data_version_id);
```

复合主键而不是代理键，两个理由：① 一个版本里同一文件版本只能出现一次，主键本身就是这条不变量；② 它是纯关联表，没有任何被外部引用的需求（对照 1.2 的判定标准）。

`idx_data_version_member_doc` 的方向是"文件版本 → 数据版本"：资料被替换时要立刻知道"它参与了哪几版数据、影响了哪几轮分析"，这条反查是影响面分析的唯一入口。默认的复合主键只服务"版本 → 成员"方向。

成员集合写入后不可增删。补一条文件就必须是新版本，不能往旧版本里塞——否则旧报告的证据链会突然多出一个它当年没看过的文件。

### 3.15 `cpx_analysis_round`（聚合根，U）

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)`；UNIQUE `(case_id, round_no)`、`(case_id, data_version_id)` 的首列 |
| round_no | integer | N | — | `CHECK (> 0)`；案件内从 1 递增，不可变 |
| data_version_id | uuid | N | — | FK → `cpx_data_version(id)`；复合 FK `(case_id, data_version_id)`；**绑定后不可变**（触发器，见 3.15.1） |
| status | varchar(32) | N | `'DRAFT'` | CHECK `DRAFT / DATA_READY / COMPUTED / ASSESSED / CLOSED / SUPERSEDED` |
| metric_snapshot_id | uuid | Y | — | FK → `cpx_metric_snapshot(id)`；`COMPUTED` 之后必填 |
| assessment_id | uuid | Y | — | FK → `cpx_assessment(id)`；`ASSESSED` 之后必填 |
| started_at | timestamptz | N | `now()` | R01 开轮时刻 |
| closed_at | timestamptz | Y | — | R05 定稿时刻；`CHECK (status <> 'CLOSED' or closed_at is not null)` |
| superseded_by_round_no | integer | Y | — | 被哪一轮取代；复合 FK `(case_id, superseded_by_round_no)` → `cpx_analysis_round(case_id, round_no)`；`CHECK (> round_no)` |
| supersede_reason | varchar(32) | Y | — | CHECK `NEW_DATA / CASE_TERMINATED`；`status = 'SUPERSEDED'` 时必填 |
| version | integer | N | `0` | 乐观锁，`CHECK (>= 0)` |
| created_at / updated_at | timestamptz | N | `now()` | 触发器维护 updated_at |
| created_by / updated_by | uuid | Y | — | 无外键 |

```sql
create unique index uq_analysis_round_no on cpx_analysis_round (case_id, round_no);

-- G-R1 幂等兜底：一个数据版本只能开一轮，重复事件不会开出第二轮（workflow §9）
create unique index uq_analysis_round_data_version on cpx_analysis_round (case_id, data_version_id);

create index idx_analysis_round_case_status on cpx_analysis_round (case_id, status);
create index idx_analysis_round_open on cpx_analysis_round (case_id, round_no desc)
  where status not in ('CLOSED','SUPERSEDED');
```

`superseded_by_round_no` 用业务号而不是 `superseded_by_round_id`，是为了让 `(case_id, superseded_by_round_no)` 能直接做复合外键指向 `(case_id, round_no)`——单看 `round_no` 不唯一，必须带 `case_id` 才能成为真外键。若存的是 uuid，则多一次 join 才能显示"被第几轮取代"，而报告与列表页都要显示这个业务号。

`uq_analysis_round_data_version` 是本表最重要的一条约束：它把"一个数据版本只分析一次"从代码约定变成数据库事实。没有它，`DataVersionCreated` 事件重复投递（首期用 Spring 事件同步分发，重试路径存在）就会开出两个同版本轮次，两份指标、两份评估，报告该引用哪一个没有答案。

#### 3.15.1 两条跨表一致性约束：都裁定用触发器

| 约束 | 表达的业务规则 | 裁定 | 理由 |
|---|---|---|---|
| `cpx_analysis_round.data_version_id` 绑定后不可变 | INV-06：一轮分析只对应一个数据版本 | **触发器** | 这是"一旦被改，整条追溯链静默失真"的约束。应用层能做到，但绕过路径太多：修数脚本、`ON CONFLICT DO UPDATE`、运维手工 UPDATE。触发器的成本是一次列比较，轮次写入频率是"每次数据变更一次"，可以忽略 |
| `cpx_report_version` 只能引用 `CLOSED` 轮次 | INV「报告版本必须绑定 CLOSED 轮次」（domain §8、workflow 反模式 5） | **触发器兜底 + 应用层守卫双层** | 触发器保证"库里不可能存在指向非 CLOSED 轮次的报告版本"；应用层仍保留 G-P1 守卫，因为触发器只能抛一句 `raise exception`，给不出 `blockingItems` 结构化阻断（workflow §9 要求守卫失败必须返回缺失项）。两者职责不同，不是重复 |

```sql
-- INV-06：绑定后不可变
create or replace function cpx_round_bind_immutable() returns trigger
language plpgsql as $$
begin
  if new.data_version_id is distinct from old.data_version_id then
    raise exception 'INV-06: cpx_analysis_round.data_version_id is immutable (round_no=%)', old.round_no;
  end if;
  if new.case_id is distinct from old.case_id or new.round_no is distinct from old.round_no then
    raise exception 'analysis_round identity columns are immutable';
  end if;
  return new;
end $$;

create trigger trg_round_bind_immutable before update on cpx_analysis_round
  for each row execute function cpx_round_bind_immutable();
```

```sql
-- 报告版本只能引用 CLOSED 轮次
create or replace function cpx_report_version_requires_closed_round() returns trigger
language plpgsql as $$
declare
  v_status varchar(32);
begin
  select status into v_status
  from cpx_analysis_round
  where case_id = new.case_id and round_no = new.round_no;

  if v_status is null then
    raise exception 'analysis round not found: case=% round=%', new.case_id, new.round_no;
  end if;
  if v_status <> 'CLOSED' then
    raise exception 'report version must bind a CLOSED round (case=% round=% status=%)',
      new.case_id, new.round_no, v_status;
  end if;
  return new;
end $$;

create trigger trg_report_version_closed_round
  before insert or update of round_no, case_id on cpx_report_version
  for each row execute function cpx_report_version_requires_closed_round();
```

触发器的三条实现约束，写迁移时必须遵守：

1. 触发器只校验 `INSERT` 与 `UPDATE OF round_no, case_id`，不校验普通 `UPDATE`。报告版本在 `DRAFT → IN_REVIEW → ISSUED` 之间会多次更新 `status`，每次都重查轮次是纯浪费；轮次一旦 `CLOSED` 不会退回（workflow 反模式 7 明令禁止把 `CLOSED` 改回 `SUPERSEDED`），所以"插入时成立"等价于"永远成立"。
2. 数据迁移时（V18）必须先建轮次并置 `CLOSED`，再插入报告版本；若顺序反了，触发器的报错信息会直接指出缺哪一轮，不会静默放过。
3. 触发器函数不加 `SECURITY DEFINER`，按调用者权限执行——否则它就成了绕过 RLS/权限的通道。

两条约束都**不**用 `CHECK`：`CHECK` 不能跨表，这是 PostgreSQL 的硬限制，不是风格选择。也不用 `EXCLUDE`/`FOREIGN KEY` 伪装：外键能保证"轮次存在"，保证不了"轮次是 CLOSED"。

### 3.16 `cpx_evidence_ref`（证据引用，B）

全库第二大的表，也是"证据链是底层能力"这句话的物理落点。**任何进入报告的数字与结论都必须至少挂一条。**

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | bigint | N | identity | PK |
| case_id | uuid | N | — | 反规范化；FK → `cpx_financing_case(id)`；复合 FK `(case_id, data_version_id)` |
| target_type | varchar(32) | N | — | CHECK `METRIC / VERIFICATION_ITEM / RISK_FINDING / ASSESSMENT / REPORT_CLAUSE` |
| target_id | varchar(64) | N | — | 被支撑对象标识；**多态，不建外键**（见 7.4） |
| evidence_kind | varchar(32) | N | — | CHECK `SOURCE_DOCUMENT / EXTRACTED_FIELD / DATA_ROW / CALCULATION / RULE_HIT / HUMAN_REVIEW / EXTERNAL_PUBLIC` |
| source_object_type | varchar(32) | Y | — | CHECK `DOCUMENT_VERSION / STATEMENT_ITEM / BANK_TRANSACTION / DEBT_RECORD / METRIC / REVIEW_RECORD / NONE`；配合 `source_object_id` 使用 |
| source_object_id | varchar(64) | Y | — | 指向的版本化对象；**多态，不建外键**（见 7.4） |
| source_locator | jsonb | Y | — | 位置：`{"page":12}`、`{"page":3,"row":18}`、`{"lineNo":3042}`、`{"sheet":"流水","range":"A3:J5002"}`；`CHECK (source_locator is null or jsonb_typeof(source_locator) = 'object')` |
| data_version_id | uuid | N | — | FK → `cpx_data_version(id)`；INV-18 的载体 |
| period_label | varchar(16) | Y | — | 涉及的会计期间，如 `2025`、`2025-03` |
| formula_code | varchar(64) | Y | — | `CALCULATION` / `RULE_HIT` 类必填 |
| formula_version | varchar(16) | Y | — | 同上 |
| review_record_id | uuid | Y | — | FK → `cpx_review_record(id)`；`HUMAN_REVIEW` 类必填 |
| confidence | numeric(5,4) | Y | — | CHECK `between 0 and 1`；AI 提取时填，人工录入为空 |
| note | varchar(200) | Y | — | 补充说明 |
| created_at | timestamptz | N | `now()` | — |

```sql
alter table cpx_evidence_ref add constraint ck_evidence_ref_required_locator check (
  case evidence_kind
    when 'SOURCE_DOCUMENT'  then source_object_id is not null
    when 'EXTRACTED_FIELD'  then source_object_id is not null
    when 'DATA_ROW'         then source_object_id is not null
    when 'CALCULATION'      then formula_code is not null and formula_version is not null
    when 'RULE_HIT'         then formula_code is not null
    when 'HUMAN_REVIEW'     then review_record_id is not null
    when 'EXTERNAL_PUBLIC'  then source_locator is not null
    else false
  end
);
```

**两类查询与对应的两条索引**（这是本节唯一需要背下来的部分）：

```sql
-- ① 某结论的全部证据：报告渲染、复核时逐条列出"这句话凭什么"
--    等值条件 (target_type, target_id)，按 id 排序保证渲染顺序稳定
create index idx_evidence_ref_target on cpx_evidence_ref (target_type, target_id, id);

-- ② 某数据行被哪些结论引用：改一条流水前的影响面分析、以及"这个数字被用了几次"的审计
create index idx_evidence_ref_source
  on cpx_evidence_ref (source_object_type, source_object_id, evidence_kind)
  where source_object_id is not null;

-- ③ 渲染前校验 INV-18：某轮次版本下的全部证据（也是一次性取回整批引用避免 N+1）
create index idx_evidence_ref_version on cpx_evidence_ref (data_version_id, target_type);

-- ④ 复核记录反查：这条复核意见支撑了哪些结论
create index idx_evidence_ref_review on cpx_evidence_ref (review_record_id)
  where review_record_id is not null;

-- ⑤ 防"堆证据"：同一目标、同一来源、同一位置只允许一条，避免引用数被灌水
create unique index uq_evidence_ref_unique
  on cpx_evidence_ref (target_type, target_id, evidence_kind, source_object_type, source_object_id, source_locator)
  nulls not distinct;
```

索引 ② 把 `source_object_type` 放在最前，不是可有可无：`source_object_id` 是 `varchar`，`cpx_bank_transaction.id` 是 `bigint`，`cpx_document_version.id` 是 `uuid`。没有类型列时反查只能靠 `::text`/`::bigint` 强转并全表扫，且不同表的 id 会互相撞（`12` 既是某条流水也可能是某张报表科目的 id）。加上类型列后，反查是"类型 + id"的等值匹配，走的是一条普通 btree。

索引 ⑤ 用了 PG 15+ 的 `NULLS NOT DISTINCT`：`source_locator` 为空时，两个"同一目标 + 同一来源 + 无位置"的重复引用也应视为重复。默认语义下 NULL 互不相等，唯一索引会放过它们。

**`case_id` 为什么冗余**：① 反查"某案件的全部证据"要能走一条索引而不经过 `data_version`；② 清理与归档以案件为单位；③ 复合外键 `(case_id, data_version_id)` 让"证据的 case 与版本的 case 必须一致"成为数据库事实，防止跨案件串数据。代价是每行多 16 字节，在 10^7 行上约 160MB，换掉一次全表 join，值。

**`target_id` 与 `source_object_id` 为什么用 `varchar(64)` 而不是 uuid**：被引用的对象里，`cpx_bank_transaction`、`cpx_financial_statement_item`、`cpx_metric_source` 的主键是 `bigint`，其余是 `uuid`。统一列型只能用字符串。V1.0 的两张多态表（`cpx_data_quality_issue.target_id`、`cpx_review_task.target_id`）已经用 `varchar(64)`，同一概念保持同一写法，比"这篇文档里 uuid、那篇文档里 varchar"更容易落地。领域模型 §3.2 写的是 UUID，此处按数据库现实改为 `varchar(64)`，记入第十节偏差表。

### 3.17 `cpx_verification_item`（待核实事项，U）

**与 `cpx_data_quality_issue` 的分工，一句话**：质量检查项是**系统对数据自身的校验**（勾稽不平、重复行、期间断裂），可以随数据修好而自动关闭；待核实事项是**需要向企业澄清的疑问**（收入与回款对不上，为什么），必须有人答复。两者不可合并——合并后要么让自动校验被迫等人回答，要么让疑问被规则重跑静默关闭。

| 字段 | 类型 | 空 | 默认 | 约束 |
|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK；**由应用生成**，以便首次发现时 `root_item_id = id` |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)`；复合 FK `(case_id, round_no)` |
| round_no | integer | N | — | 归属轮次；未解决项可继承到下一轮 |
| root_item_id | uuid | N | — | 疑问的稳定身份，首次发现时 = 自身 id，跨轮不变 |
| code | varchar(32) | N | — | 规则码，如 `VI-REV-01`；不加 CHECK（Java 枚举维护） |
| category | varchar(32) | N | — | CHECK `DIFFERENCE / MISSING / CALIBER / FIELD_ANOMALY`（差异 / 缺失 / 口径 / 字段异常） |
| severity | varchar(16) | N | — | CHECK `HIGH / MEDIUM / LOW` |
| observation | varchar(2000) | N | — | **只陈述可观察到的事实**，不含定性判断 |
| possible_causes | jsonb | N | `'[]'` | 并列的可能原因，不作结论；`CHECK (jsonb_typeof(...) = 'array' and jsonb_array_length(...) >= 1)` |
| recommended_action | varchar(1000) | Y | — | 建议补充或澄清的动作 |
| status | varchar(32) | N | `'OPEN'` | CHECK `OPEN / ANSWERED / RESOLVED / WAIVED` |
| prior_round_no | integer | Y | — | 继承来源轮次；复合 FK `(case_id, prior_round_no)`；`CHECK (prior_round_no < round_no)`；首次发现为 NULL |
| prior_answer_note | varchar(200) | Y | — | 继承时携带的原答复只读摘要（「第 N 轮答复（参考）」+ 摘要） |
| answer_note | varchar(2000) | Y | — | 企业答复正文；V02 守卫要求非空 |
| answer_source | varchar(16) | Y | — | CHECK `ORAL / WRITTEN`；答复来源 |
| answered_by / answered_at | uuid / timestamptz | Y | — | 登记人与登记时间 |
| resolution | varchar(2000) | Y | — | 核实结论正文；V03 要求非空 |
| resolved_by / resolved_at | uuid / timestamptz | Y | — | — |
| waiver_reason | varchar(500) | Y | — | V05 豁免理由；报告须列出 |
| version | integer | N | `0` | 乐观锁 |
| created_at / updated_at | timestamptz | N | `now()` | 触发器维护 updated_at |
| created_by / updated_by | uuid | Y | — | 无外键 |

```sql
-- 同一轮同一疑问至多一条（workflow §6 规则 2）
create unique index uq_verification_item_root
  on cpx_verification_item (case_id, round_no, root_item_id);

-- 同一轮同一规则码至多一条，防规则重跑重复登记
create unique index uq_verification_item_code
  on cpx_verification_item (case_id, round_no, code);

-- 进度投影与守卫：OPEN 的 HIGH 计数、阻塞项清单
create index idx_verification_item_open
  on cpx_verification_item (case_id, severity)
  where status in ('OPEN','ANSWERED');

-- 跨轮历史：同一 root_item_id 的全部记录按轮次排列
create index idx_verification_item_history
  on cpx_verification_item (case_id, root_item_id, round_no);

alter table cpx_verification_item add constraint ck_verification_item_status check (
     status in ('OPEN','ANSWERED','RESOLVED','WAIVED')
);

alter table cpx_verification_item add constraint ck_verification_item_answer check (
  status not in ('ANSWERED','RESOLVED') or answer_note is not null
);

alter table cpx_verification_item add constraint ck_verification_item_resolve check (
  status <> 'RESOLVED' or (resolution is not null and resolved_by is not null and resolved_at is not null)
);

alter table cpx_verification_item add constraint ck_verification_item_waive check (
  status <> 'WAIVED' or waiver_reason is not null
);
```

**三个没有落的字段，以及为什么**：

| workflow 里的字段 | 本设计的处理 | 理由 |
|---|---|---|
| `carriedFromItemId` | 不建列 | 由 `(case_id, prior_round_no, root_item_id)` 唯一确定（`uq_verification_item_root` 保证这一点），存下来只会多一处可能不一致的副本 |
| `carryCount` | 不建列，查询派生 | `round_no − MIN(round_no) OVER (PARTITION BY root_item_id)`。存列会在"插入继承记录"与"更新计数"之间产生第二种真相，而这个值只在列表与报告生成时读一次 |
| 状态迁移原因（V04「答复不足，还需澄清什么」） | 写 `cpx_audit_log`（`action = VERIFICATION_ITEM_TRANSITION`，`detail` 含 from/to/reason/actor） | 一条疑问最多 4 次迁移，为它单建事件表的收益不抵成本；但**必须**留痕，否则"为什么又打开了"无从解释 |

**"每条必须有至少一条证据引用"如何落地**：这条不变量（domain §7）无法用 `CHECK` 表达，因为证据在另一张表。落地方式是三段：V01 写入时同事务校验（无证据则拒绝创建）→ 报告渲染前 `EvidenceQueryPort` 校验 → 每日巡检 SQL 扫"零证据的 OPEN 事项"。不做触发器：触发器要跨表 count，而这条约束的失败应该以结构化阻断返回给用户，不是抛异常。

### 3.18 V1.1 对既有表的 ALTER 语义汇总

前面各节按表分散写了改动，这里是写迁移脚本时的单页对照。**"影响"列问的是"库里已有数据会怎样"**，当前系统未上线、无生产数据，多数为"无影响"；凡是需要回填或会失败的，都单独写明。

| # | 表 | ALTER 动作 | 理由 | 对既有数据的影响 |
|---|---|---|---|---|
| 1 | `cpx_financing_case` | `RENAME COLUMN status TO lifecycle`；`DROP CONSTRAINT ck_financing_case_status`；`ADD CONSTRAINT ck_financing_case_lifecycle CHECK (10 值)`；`RENAME COLUMN status_entered_at TO lifecycle_entered_at`；`RENAME COLUMN archived_at TO closed_at`；`ADD hold_from / previous_case_no / closing_note`；`DROP COLUMN data_version` | 见 3.1.1 | 需 18→10 映射；`data_version` 的值转存为 `cpx_data_version.version_no`（若已有数据） |
| 2 | `cpx_case_status_event` | 重建 `ck_status_event_status`（10 值）；重建 `ck_status_event_code`（C/R/P/M/V 动作号）；`guard_code` 由 `varchar(8)` 改 `varchar(16)` | 状态取值以 workflow 为准；旧 T01–T21/X01–X02 已不存在 | 旧事件的 `transition_code` 无法一一对应，迁移时整体重编号并写一条 `MIGRATION_NOTE` 审计 |
| 3 | `cpx_case_material` | `ADD status varchar(32) NOT NULL DEFAULT 'REQUIRED'`；`ADD status_entered_at timestamptz NOT NULL DEFAULT now()`；`ADD CONSTRAINT ck_case_material_status`；`DROP COLUMN is_waived`；重建 `ck_case_material_waiver` | 状态机含两个推不出来的状态（`REJECTED`/`WAIVED`），且 `is_waived` 与状态重复表达（见 10.2 #5） | 存量行按"有 `waived_at` → `WAIVED`，否则按文档当前版本推导一次"回填；**回填后必须人工抽查**，推导不准的项会以错误的初始状态进入流程 |
| 4 | `cpx_document_version` | 重建 `ck_document_version_state`（5 值，移除 `PARSE_FAILED`） | 解析失败属于导入批次，不属于文件（见 10.2 #6） | 若存在 `PARSE_FAILED` 的存量行，迁移时置为 `UPLOADED` 并由批次状态体现失败 |
| 5 | `cpx_data_import_record` | `ADD purged_at timestamptz` | 保留期清理后需区分"空行"与"已清理" | 存量行为 NULL（未清理） |
| 6 | `cpx_financial_metric` | `ADD data_version_id uuid`；回填；置 `NOT NULL` + FK；`DROP COLUMN data_version`；`DROP INDEX uq_financial_metric_current` 并以新列序重建 | 计数器无法 join；旧唯一索引在多轮重算时必撞（见 3.7） | 回填按 `(case_id, data_version)` 匹配 `cpx_data_version(case_id, version_no)`；匹配不到的行必须停下人工处理，不能给默认值——那会让指标落到错误的版本上 |
| 7 | `cpx_metric_snapshot` | `ADD round_no integer`；`ADD data_version_id uuid`；回填；`NOT NULL` + 复合 FK；`DROP COLUMN data_version`；`ADD idx_metric_snapshot_round` | 快照要能独立回答"属于哪一轮"（见 3.8） | 回填 `round_no` 依据 `cpx_analysis_round.metric_snapshot_id` 反查；无对应轮次的快照说明是迁移前遗留，需人工归档 |
| 8 | `cpx_assessment` | `ADD round_no integer NOT NULL`（含回填）；复合 FK；`DROP INDEX uq_assessment_current` 并以 `(case_id, round_no)` 重建；`ADD UNIQUE (id, round_no)`；`dimensions` 结构重定义 | 一次评估属于一轮；五维必须换成准备度维度（见 3.9.1） | 存量 `dimensions` 含偿债/经营维度，**无法自动映射**，只能按新五维重算一次评估；旧 JSON 原样保留在审计里 |
| 9 | `cpx_risk_finding` | `ADD case_id`、`ADD round_no`；`ALTER assessment_id DROP NOT NULL`；重建唯一索引为 `(case_id, round_no, finding_no)`；`ADD UNIQUE (id, round_no)` on assessment | 风险事项挂轮次，不挂评估（见 3.9.2） | `round_no` 从 `assessment.round_no` 回填；`case_id` 从 assessment 或 finding 所属案件回填 |
| 10 | `cpx_report` | `DROP COLUMN status / issued_at / issued_by / voided_at / void_reason`；`DROP INDEX uq_report_case_active`；`ADD UNIQUE (case_id)`、`ADD UNIQUE (id, case_id)` | 效力是版本级事实（见 3.10） | 若存量报告有 `ISSUED` 状态，必须先把它写进对应版本的 `issued_at/issued_by`，再删列，否则签发事实丢失 |
| 11 | `cpx_report_version` | `ADD case_id / round_no / status / issued_at / issued_by / voided_at / void_reason / replacement_version_no / content_hash / evidence_check_result`；3 条 CHECK + 2 条唯一索引 | 版本成为报告生命周期的承载者 | `status` 回填自 `cpx_report.status`；`content_hash` 对存量 PDF 重算或置为 `file_sha256`（需在迁移说明中标注为"非规范化内容哈希"） |

两条写迁移脚本时的硬规则：

1. **先加可空列、回填、再置非空**。直接 `ADD COLUMN ... NOT NULL` 在有大表时会锁表重写，且回填逻辑没有执行位置。
2. **回填失败必须中断，不许给默认值**。第 6、7 行为例：`data_version_id` 匹配不上说明历史数据本身不完整，给一个默认版本等于伪造血缘。

---

## 四、索引设计

原则：每个索引必须对应一条真实查询。没有查询的索引就是写放大与缓存污染。下表之外不允许随意加索引，新增须带查询来源。

| 索引 | 表 | 定义要点 | 服务的查询 | 为什么必须有 |
|---|---|---|---|---|
| `uq_financing_case_no` | case | `(case_no)` | 按业务编号搜索案件 | 编号对外唯一，且是客服查询入口 |
| `idx_financing_case_customer_lifecycle` | case | `(customer_id, lifecycle)` | 客户详情页列出其全部案件 | 客户维度是最高频入口 |
| `idx_financing_case_owner_lifecycle` | case | `(owner_user_id, lifecycle)` | "我的案件"工作台 | 首期单用户，但权限模型按多角色设计 |
| `idx_financing_case_open` | case | 部分索引，排除 3 个终态（`CLOSED`/`WITHDRAWN`/`DECLINED`） | 首页看板"在办案件 N 件" | 终态数据占绝大多数，全表索引会随历史膨胀 |
| `idx_financing_case_retention` | case | `(retention_until) WHERE closed_at IS NOT NULL` | 归档清理任务每日扫描 | 只扫已关闭，索引体积极小 |
| `idx_financing_case_previous` | case | `(previous_case_no) WHERE NOT NULL` | 续做案件的溯源查询 | 绝大多数案件为空，部分索引几乎为零成本 |
| `uq_requirement_current` | requirement | `(case_id) WHERE is_current` | 读取当前需求 | 同时充当"每案仅一条当前需求"的约束 |
| `uq_case_status_event_seq` | status_event | `(case_id, seq_no)` | 案件时间线按序渲染 | 同时是唯一约束 |
| `uq_case_material_code` | case_material | `(case_id, material_code)` | G-C3 按案件取清单 | 防止立案时重复插入 |
| `ex_auth_scope_no_overlap` | auth_scope | EXCLUDE gist | 授予授权前判断是否冲突 | 唯一能表达"区间不重叠"的手段 |
| `idx_auth_scope_case` | auth_scope | `(case_id, data_scope)` | G-C2 计算授权覆盖范围 | EXCLUDE 索引不能替代等值查询路径（gist 对 `=` 效率低于 btree） |
| `idx_document_case_type` | document | `(case_id, doc_type) WHERE deleted_at IS NULL` | G-C3 逐项比对材料齐备性 | G-C3 是整个流程最高频的守卫 |
| `uq_document_version_current` | version | `(document_id) WHERE not superseded` | 取当前版本 | 兜住 `current_version_id` 漂移 |
| `idx_document_version_sha` | version | `(sha256)` | 重复上传检测 | 去重查询先按哈希收敛 |
| `idx_document_review_version` | review | `(document_version_id, reviewed_at desc)` | 某版本的核验历史 | 核验记录只按版本查 |
| `idx_import_case_status` | import | `(case_id, status)` | G-R2 判断是否还有解析中的批次 | G-R2 每次流转都跑 |
| `uq_import_record_row` | import_record | `(import_id, row_no)` | 追溯"第 N 行" | 同时是唯一约束；追溯链的叶子节点 |
| `idx_import_record_failed` | import_record | `(import_id) WHERE parse_status = 'FAILED'` | 导入失败行清单 | 失败行占比 < 5%，全表索引浪费 |
| `idx_quality_issue_blocker_open` | issue | 部分索引，`severity='BLOCKER' AND status IN ('OPEN','ACKNOWLEDGED')` | G-R2 / G-R5 计数 | 谓词与查询完全一致才命中，索引通常只有几十行 |
| `uq_quality_issue_dedupe` | issue | `(case_id, dedupe_key) WHERE status IN ('OPEN','ACKNOWLEDGED')` | 重跑规则时去重 | 防止同一问题被登记 5 次 |
| `uq_statement_current` | statement | `(case_id, statement_type, data_period) WHERE is_current` | 取当前报表 | 同时表达"同期同类型仅一套有效数据" |
| `uq_statement_item_code` | item | `(statement_id, item_code)` | 科目定位 | 同时是唯一约束 |
| `uq_financial_metric_current` | metric | `(case_id, data_version_id, metric_code, data_period, formula_version) WHERE superseded_at IS NULL` | 取当前指标值 | 表达"同版本仅保留最新"；V1.1 补 `data_version_id`，否则多轮重算必撞唯一键 |
| `idx_financial_metric_history` | metric | `(case_id, metric_code, data_period, computed_at desc)` | Q2 历史版本查询 | 有序列，省一次 Sort |
| `idx_metric_snapshot_case` | snapshot | `(case_id, snapshot_no desc) WHERE locked` | 取最新已锁定快照 | G-R3 判定 |
| `uq_metric_snapshot_item` | snap_item | `(snapshot_id, metric_id)` | 快照内定位指标 | 同时是唯一约束 |
| `idx_metric_source_metric` | metric_source | `(metric_id, aggregation_role)` | 从指标下钻到数据行 | 追溯链的主要方向 |
| `idx_metric_source_stmt_item` | metric_source | `(statement_item_id) WHERE not null` | 反查"这个科目被哪些指标用了" | 数据修正时的影响面分析 |
| `idx_bank_txn_case_date` | bank_txn | `(case_id, txn_on, id)` | 流水按时间分页 | 最高频的流水查询 |
| `idx_bank_txn_case_category` | bank_txn | `(case_id, category_code, txn_on)` | 分类汇总（经营现金流） | 汇总必须走索引，否则每次分析全表扫 |
| `uq_bank_txn_dedupe` | bank_txn | `(case_id, dedupe_key)` | 重复导入拦截 | 同一份流水导两次是常见事故 |
| `idx_debt_case_status` | debt | `(case_id, status)` | 债务清单与到期排序 | — |
| `uq_assessment_no` | assessment | `(case_id, assessment_no)` | 版本列表 | 同时是唯一约束 |
| `uq_assessment_current` | assessment | `(case_id, round_no) WHERE is_current` | 取本轮当前评估 | V1.1 改：每案每轮一个当前评估，原 `(case_id)` 在多轮模型下必然冲突 |
| `uq_assessment_id_round` | assessment | `(id, round_no)` | 供 `cpx_risk_finding` 做复合外键 | 平凡唯一（`id` 已是 PK），只为一个目的存在：让"回填的 assessment 必须同轮"成为外键 |
| `uq_risk_finding_no` | finding | `(case_id, round_no, finding_no)` | 事项清单排序 | V1.1 改：风险事项改挂轮次，序号作用域随之变 |
| `idx_risk_finding_round` | finding | `(case_id, round_no, severity)` | 按轮次列出风险事项 | 报告章节渲染的主路径 |
| `uq_review_task_active` | review_task | `(target_type, target_id) WHERE status IN ('PENDING','IN_PROGRESS')` | 防止同一对象重复建复核任务 | 幂等兜底 |
| `idx_review_task_assignee` | review_task | `(assignee_user_id, status)` | 我的待办 | — |
| `uq_report_case` | report | `(case_id)` | 取案件当前报告容器 | V1.1 改：原 `(case_id) WHERE status <> 'VOID'` 随 `status` 下沉而失效；一案件一份报告容器，多轮多版是其版本 |
| `uq_report_version_no` | report_version | `(report_id, version_no)` | 版本列表 | 同时是唯一约束 |
| `uq_report_version_round` | report_version | `(report_id, round_no) WHERE status <> 'VOID'` | 报告版本与轮次对应 | 一版只挂一轮；同一轮只有在旧版作废后才允许再出一版（笔误修订） |
| `idx_report_version_status` | report_version | `(status, generated_at DESC)` | 复核工作台与发送队列 | 状态值只有 6 个但分布极偏，配 `generated_at` 才能避免全表排序 |
| `idx_ai_task_pending` | ai_task | `(created_at) WHERE status IN ('PENDING','RUNNING')` | 队列轮询取任务 | 只扫未完成任务，避免全表 |
| `uq_ai_exec_attempt` | ai_exec | `(ai_task_id, attempt_no)` | 重试历史 | 同时是唯一约束 |
| `idx_ai_suggestion_pending` | suggestion | `(case_id, created_at) WHERE status = 'PENDING'` | 待处置建议列表 | 处置率是 AI 可用性的核心指标 |
| `idx_audit_case_time` | audit | 分区内 `(case_id, occurred_at desc)` | 案件审计时间线 | — |
| `idx_audit_actor_time` | audit | 分区内 `(actor_user_id, occurred_at desc)` | 某人操作回溯 | — |
| `uq_audit_anchor_date` | anchor | `(anchor_date)` | 每日仅一条锚点 | 同时是唯一约束 |
| `idx_idempotency_expire` | idempotency | `(expires_at)` | 清理过期键 | 每小时扫一次 |
| `uq_field_dictionary` | field_dict | `(entity_code, field_code)` | 解析器取字段映射 | 同时是唯一约束 |
| `uq_data_version_no` | data_version | `(case_id, version_no)` | 按版本号定位 | 同时是唯一约束 |
| `uq_data_version_digest` | data_version | `(case_id, digest)` | 判定"数据是否真的变了" | INV-19 的数据库兜底，重复 digest 直接拒绝插入 |
| `uq_data_version_active` | data_version | `(case_id) WHERE status = 'ACTIVE'` | 取案件当前数据版本 | 替代 `cpx_financing_case.data_version` 计数器，杜绝双轨漂移 |
| `idx_data_version_member_doc` | ver_member | `(document_version_id, data_version_id)` | 某文件版本参与了哪几版数据 | 资料替换时的影响面分析入口（主键只服务反方向） |
| `uq_analysis_round_no` | round | `(case_id, round_no)` | 按轮次号定位 | 同时是唯一约束，且是上游复合外键的目标 |
| `uq_analysis_round_data_version` | round | `(case_id, data_version_id)` | 一个数据版本只开一轮 | `DataVersionCreated` 重复投递的幂等兜底（workflow §9） |
| `idx_analysis_round_open` | round | `(case_id, round_no DESC) WHERE status NOT IN ('CLOSED','SUPERSEDED')` | 取进行中的轮次 | 案件进度投影每次列表刷新都读，只扫少量行 |
| `idx_evidence_ref_target` | evidence | `(target_type, target_id, id)` | **某结论的全部证据** | 报告渲染的主路径，按 id 排序保证渲染顺序稳定 |
| `idx_evidence_ref_source` | evidence | `(source_object_type, source_object_id, evidence_kind) WHERE source_object_id IS NOT NULL` | **某数据行被哪些结论引用** | 改数前的影响面分析；带类型列才能跨 bigint/uuid 两种主键做等值匹配 |
| `idx_evidence_ref_version` | evidence | `(data_version_id, target_type)` | 渲染前校验 INV-18 的一次性取数 | 避免逐条证据查一次库（N+1） |
| `uq_evidence_ref_unique` | evidence | `(target_type, target_id, evidence_kind, source_object_type, source_object_id, source_locator) NULLS NOT DISTINCT` | 同一目标同一来源同一位置只挂一条 | 防止"堆证据"把引用数灌水，也防止重渲染重复写入 |
| `uq_verification_item_root` | verification | `(case_id, round_no, root_item_id)` | 同一轮同一疑问至多一条 | 跨轮继承的落点，同时让 `carriedFromItemId` 可派生 |
| `uq_verification_item_code` | verification | `(case_id, round_no, code)` | 同一轮同一规则码至多一条 | 规则重跑不得重复登记 |
| `idx_verification_item_open` | verification | `(case_id, severity) WHERE status IN ('OPEN','ANSWERED')` | 进度投影的"待澄清 N 项"、守卫阻断清单 | 谓词与查询完全一致，索引只有几十行 |
| `idx_verification_item_history` | verification | `(case_id, root_item_id, round_no)` | 一条疑问的完整跨轮历史 | 报告"已连续 3 轮未澄清"提示的依据 |

**明确不建的索引**：

- `cpx_audit_log.resource_id` 单列索引：选择性极低（同一 id 只出现一两次），且查询总是带 `case_id`。
- `cpx_bank_transaction.import_id` 单列索引：已由 `(case_id, ...)` 与 `import_record_id` 覆盖，批量插入时少一个索引就少一份 WAL。
- 任何 `status` 单列索引：状态值分布极不均匀（`DELIVERED` 占 90%），单列索引必然被规划器忽略。

---

## 五、分区策略

### 5.1 只分区 `cpx_audit_log`

判定依据：只有它同时满足三条——只追加、不可删、按时间线性增长且需要按时间归档。

`cpx_ai_execution_log` 不分区：保留期 90 天，`DELETE` 每次只影响数万行，分区带来的 DDL 运维成本高于收益。

`cpx_evidence_ref` 虽然体量与审计表同级，但**不分区**——判定见 5.6，理由不是"行数不够"，而是访问模式与生命周期都不符合分区的前提。

### 5.2 父表

```sql
create table cpx_audit_log (
  id           bigint generated always as identity,
  occurred_at  timestamptz not null default now(),
  actor_user_id uuid,
  actor_type   varchar(8)  not null,
  actor_role   varchar(32),
  action       varchar(64) not null,
  resource_type varchar(32) not null,
  resource_id  varchar(64),
  case_id      uuid,
  result       varchar(16) not null,
  ip           inet,
  user_agent   varchar(500),
  trace_id     varchar(64),
  detail       jsonb,
  chain_date   date   not null,          -- 哈希链所属日期（CPX-SEC-01 §7.6）
  chain_seq    bigint not null,          -- 当日链内序号，从 1 递增
  prev_hash    char(64),                 -- 前一条 record_hash；当日首条为当日锚点哈希
  record_hash  char(64) not null,        -- sha256(prev_hash || 规范化字段串)
  constraint pk_audit_log primary key (id, occurred_at),
  constraint ck_audit_log_actor_type check (actor_type in ('USER','SYSTEM','ANON')),
  constraint ck_audit_log_result check (result in ('SUCCESS','DENIED','FAILED'))
) partition by range (occurred_at);
```

**关于 `(chain_date, chain_seq)` 的唯一性**：PostgreSQL 要求分区表上的唯一索引必须包含分区键，因此**不能**在父表上建 `unique (chain_date, chain_seq)`。正确做法是为每个分区单独建唯一索引——`chain_date` 天然落在该分区所属月份内，所以"分区内唯一"恰好等于"全局唯一"：

```sql
create unique index uq_audit_log_p202610_chain
  on cpx_audit_log_p202610 (chain_date, chain_seq);
```

分区创建脚本（§5.3）必须同时创建该月分区的这条唯一索引，否则哈希链会出现序号断裂却无人察觉。这条要写进 `ddl-lint` 检查项。


索引建在父表上，PG 自动为每个分区建对应索引（含后续 `ATTACH` 的分区，需 `CREATE INDEX ... ON ONLY` 的变体，见 5.4）。

### 5.3 分区创建

命名 `cpx_audit_log_p{YYYYMM}`，边界为自然月左闭右开。

```sql
create table cpx_audit_log_p202610 partition of cpx_audit_log
  for values from ('2026-10-01 00:00:00+00') to ('2026-11-01 00:00:00+00');
```

**必须有默认分区**，否则某月忘记建分区会导致审计写入直接报错，进而把主流程拖垮（审计写入失败不应阻断业务）：

```sql
create table cpx_audit_log_pdefault partition of cpx_audit_log default;
```

预建节奏：每月 25 日由 Java 定时任务（`@Scheduled`，单实例锁由 `cpx_idempotency` 表兼任）创建"下月 + 下下月"两个分区，幂等写法 `CREATE TABLE IF NOT EXISTS`。默认分区常年为空是健康信号；一旦有数据，说明预建漏了，应告警并手工迁移。

### 5.4 归档

流程固定为四步，不做 `DELETE`：

1. `ALTER TABLE cpx_audit_log DETACH PARTITION cpx_audit_log_p202310;`（PG 16 支持 `DETACH ... CONCURRENTLY`，但要求无默认分区引用，实操中在维护窗口执行普通 DETACH 即可，锁持有时间为毫秒级）。
2. 对已独立的分区表 `COPY ... TO PROGRAM 'gzip > /archive/audit_202310.csv.gz'` 或 `pg_dump -t cpx_audit_log_p202310`，落对象存储并记录归档清单（表名、行数、SHA-256、归档时间、执行人）。
3. 校验行数与摘要一致后 `DROP TABLE cpx_audit_log_p202310;`。
4. 在 `cpx_audit_log` 写一条 `AUDIT_ARCHIVE` 记录（写入当前在线分区），记录被归档分区的月界与行数——审计日志自身的归档也必须有审计。

归档前置条件：该分区所有 `case_id` 对应案件均已 `CLOSED` 且超过保留期；存在法务保全（legal hold）的案件时跳过其所在分区并在归档清单中标注。

### 5.5 分区带来的约束

- 主键必须含 `occurred_at`，因此 `id` 单列查询不能走主键索引，需 `WHERE id = ? ` 全分区扫（实际不存在这种查询，审计只按人/案件/时间查）。
- 外键不能引用分区表，`cpx_audit_log` 也就不可能被引用——这正是审计表应有的地位。
- `UPDATE` / `DELETE` 由触发器阻断：

```sql
create or replace function cpx_audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'cpx_audit_log is append-only';
end $$;

create trigger trg_audit_log_no_update before update or delete on cpx_audit_log
  for each row execute function cpx_audit_log_immutable();
```

触发器建在父表上，自动作用于全部分区。清理只能通过 DETACH + DROP 完成，绕不过去。

### 5.6 `cpx_evidence_ref` 与 `cpx_audit_log` 的体量对比与分区结论

**结论：`cpx_evidence_ref` 不分区。** 两者行量同量级，但分区收益的结构性前提只有审计表满足。

| 维度 | `cpx_audit_log` | `cpx_evidence_ref` |
|---|---|---|
| 年增行量 | 10^7 | 3×10^6（5 年累计 10^7） |
| 平均行宽 | ~400 字节（含 `detail` jsonb、UA、IP） | ~250 字节（locator 短、note 限 200 字） |
| 5 年体积 | ~20 GB（含索引） | ~3–4 GB（含索引） |
| 写入形态 | 持续、全操作、异步批量 | 集中：报告渲染时一次写 300–500 条，其余时间几乎为 0 |
| 主查询 | **按时间范围**（某月、某区间）与按案件 | **点查**：`(target_type, target_id)` 取某结论全部证据；`(source_object_*)` 反查引用 |
| 生命周期 | 在线 36 个月 → 冷归档 → DROP | 与报告同寿命，永久保留 |
| 是否有"整段可丢弃" | 有（到期月份整个分区） | **没有**（哪一年的证据都不能丢） |
| 是否被外键引用 | 不能（分区表不能被引用） | 也不能（无表引用它），但它是追溯链的终点之一 |

**不分区四条理由**：

1. **分区的最大收益是"DETACH + DROP 整段"，而证据引用没有可丢弃的整段。** 保留策略要求它与报告同寿命（见 8.1 的 L1 层），按月分区后再也不会执行 `DROP PARTITION`，只剩下"每次查询多一层分区裁剪、每张分区多一套索引"的成本。为不存在的收益付运维代价，是过度设计。
2. **主查询是点查，时间不是过滤条件。** `idx_evidence_ref_target` 与 `idx_evidence_ref_source` 都是等值匹配。若按 `created_at` 月分区，这两条索引要么建在父表上、要么每个分区各建一份；而查询本身不带时间谓词，规划器必须扫描全部活跃分区再归并——10^7 行分散到 60 个分区，单次"取某结论 3 条证据"要开 60 次索引扫描。当前单表索引一次 B-tree 下降（约 3 层）就结束。
3. **写入是尖峰而非持续，分区改变不了尖峰。** 证据写入与报告渲染在同一事务，一次 300–500 行；分区表在这条路径上还要额外做分区路由判断。审计表之所以需要分区，是因为它按时间线性增长且永不删除在线数据，证据表不是。
4. **唯一约束会被分区打断。** `uq_evidence_ref_unique`（防堆证据）在分区表上必须把分区键并入唯一索引，而正确性要求的是"全表唯一"。这是 V1.0 在审计表哈希链上踩过的同一个坑（5.2 节：只能每个分区各建一条），没必要在新表上再踩一次。

**什么时候重新评估**（写进容量评审清单，不写进代码）：

| 触发条件 | 届时方案 |
|---|---|
| 单表超过 5×10^7 行或 20 GB | 按 `hash(case_id)` 分区（16 个分区），保持"同案数据同分区"，点查仍可裁剪到单分区 |
| 出现"按时间段导出全部证据"的合规需求 | 改为按 `created_at` 月分区，并把点查索引改为 `(case_id, target_type, target_id)` 三级定位 |
| 单次报告渲染 p95 写库耗时 > 2s | 先查是否缺少批量插入与 `uq_evidence_ref_unique` 的写放大，再谈分区 |

`cpx_audit_log` 的分区方案不动（5.2–5.5 保持原样）。两者不能"统一处理"：一个是按时间丢弃的流水，一个是与报告同寿命的证据，放在同一套分区策略里必然有一方受损。

---

## 六、约束

### 6.1 CHECK 约束清单

| 表 | 约束名 | 定义 |
|---|---|---|
| case | `ck_financing_case_lifecycle` | `lifecycle in ('INTAKE','AUTHORIZATION','COLLECTING','ANALYZING','REVIEW','DELIVERED','CLOSED','ON_HOLD','WITHDRAWN','DECLINED')`（V1.1 替换旧 18 值约束 `ck_financing_case_status`） |
| case | `ck_financing_case_case_no` | `case_no ~ '^CPX-[0-9]{4}-[0-9]{4}$'` |
| case | `ck_financing_case_version` | `version >= 0` |
| case | `ck_financing_case_terminal_reason` | `lifecycle not in ('WITHDRAWN','DECLINED') or terminated_reason is not null` |
| case | `ck_financing_case_hold` | `(lifecycle <> 'ON_HOLD' or hold_from is not null) and (hold_from is null or hold_from in ('INTAKE','AUTHORIZATION','COLLECTING','ANALYZING','REVIEW','DELIVERED','CLOSED'))` |
| case | `ck_financing_case_previous` | `previous_case_no is null or (previous_case_no ~ '^CPX-[0-9]{4}-[0-9]{4}$' and previous_case_no <> case_no)` |
| case | `ck_financing_case_closed` | `lifecycle <> 'CLOSED' or closed_at is not null` |
| requirement | `ck_requirement_type` | `financing_type in ('WORKING_CAPITAL','PROJECT_LOAN','LEASE_FINANCING','BILL_FINANCING','SUPPLY_CHAIN','OTHER')` |
| requirement | `ck_requirement_amount` | `financing_amount >= 0 and (funding_gap_amount is null or funding_gap_amount >= 0) and (term_months is null or term_months > 0)` |
| requirement | `ck_requirement_change_reason` | `version_no = 1 or change_reason is not null` |
| status_event | `ck_status_event_status` | `from_status` / `to_status` 均属 `ck_financing_case_lifecycle` 的 10 值集合（`from_status` 允许 NULL）；V1.1 随案件列改名同步 |
| status_event | `ck_status_event_code` | `transition_code ~ '^(C(0[1-9]|1[0-4])|R0[1-7]|P0[1-9]|M0[1-9]|V0[1-6])$'`（V1.1 改为五个状态机的动作号，原 T01–T21/X01–X02 已作废） |
| status_event | `ck_status_event_actor` | `actor_type in ('USER','SYSTEM')`；`actor_type = 'USER'` 时 `actor_user_id is not null` |
| case_material | `ck_case_material_level` | `requirement_level in ('REQUIRED','CONDITIONAL','OPTIONAL')` |
| case_material | `ck_case_material_status` | `status in ('REQUIRED','REQUESTED','RECEIVED','PARSED','VERIFIED','WAIVED','REJECTED')`（V1.1 新增） |
| case_material | `ck_case_material_waiver` | `status <> 'WAIVED' or (waiver_reason is not null and waived_by is not null and waived_at is not null)`（V1.1 由 `is_waived` 布尔改为状态判定） |
| authorization | `ck_authorization_valid_range` | `valid_to >= valid_from` |
| authorization | `ck_authorization_revoke` | `revoked_at is null or revoke_reason is not null` |
| auth_scope | `ck_auth_scope_code` | `data_scope in ('BANK_STATEMENT','FINANCIAL_STATEMENT','TAX','CREDIT_REPORT','DEBT_CONTRACT')` |
| document_version | `ck_document_version_state` | `verification_state in ('UPLOADED','PARSED','VERIFIED','REJECTED','SUPERSEDED')`（V1.1 移除 `PARSE_FAILED`，解析失败由 `cpx_data_import.status = 'FAILED'` 表达） |
| document_version | `ck_document_version_sha` | `sha256 ~ '^[0-9a-f]{64}$' and file_size_bytes > 0 and version_no > 0` |
| document_review | `ck_document_review_decision` | `decision in ('VERIFY','REJECT')` |
| material_req | `ck_material_req_level` | `requirement_level in ('REQUIRED','CONDITIONAL','OPTIONAL')` |
| data_import | `ck_data_import_type` | `import_type in ('BANK_STATEMENT','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW','DEBT_LIST','TAX_RETURN')` |
| data_import | `ck_data_import_status` | `status in ('PENDING','PARSING','PARSED','FAILED','CONFIRMED','ROLLED_BACK')` |
| data_import | `ck_data_import_counts` | `failed_count >= 0 and success_count >= 0 and success_count + failed_count <= row_count` |
| import_record | `ck_import_record_status` | `parse_status in ('PARSED','FAILED','SKIPPED','DUPLICATE')` |
| quality_issue | `ck_quality_issue_severity` | `severity in ('BLOCKER','MAJOR','MINOR','INFO')` |
| quality_issue | `ck_quality_issue_status` | `status in ('OPEN','ACKNOWLEDGED','RESOLVED','WAIVED')` |
| quality_issue | `ck_quality_issue_waiver` | `status <> 'WAIVED' or (waiver_reason is not null and waived_by is not null and waiver_approved_by is not null)` |
| quality_issue | `ck_quality_issue_evidence` | `jsonb_typeof(evidence_refs) = 'array'` |
| statement | `ck_statement_type` | `statement_type in ('BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW')` |
| statement | `ck_statement_scale` | `amount_scale in (1,1000,10000)` |
| financial_metric | `ck_financial_metric_period_type` | `period_type in ('YEAR','QUARTER','MONTH','POINT','TTM')` |
| financial_metric | `ck_financial_metric_single_value` | `num_nonnulls(value_amount, value_ratio, value_days) = 1` |
| financial_metric | `ck_financial_metric_unit` | `unit in ('CNY','PERCENT','DAYS','TIMES')` |
| bank_txn | `ck_bank_txn_direction` | `direction in ('IN','OUT')` |
| bank_txn | `ck_bank_txn_category_source` | `category_source in ('RULE','AI','MANUAL')`；`category_source = 'MANUAL'` 时 `confirmed = true` |
| bank_txn | `ck_bank_txn_confirmed` | `not confirmed or (confirmed_by is not null and confirmed_at is not null)` |
| debt | `ck_debt_type` | `debt_type in ('LOAN','LEASE','FACTORING','BOND','OTHER')` |
| debt | `ck_debt_amount` | `principal_amount >= 0 and outstanding_amount >= 0 and outstanding_amount <= principal_amount` |
| metric_source | `ck_metric_source_exclusive` | 见 3.8 |
| analysis | `ck_analysis_type` | `analysis_type in ('OPERATING','CASH_FLOW','DEBT_SERVICE','CONCENTRATION')` |
| analysis | `ck_analysis_narrative_source` | `narrative_source in ('RULE','AI_ASSISTED','HUMAN')` |
| assessment | `ck_assessment_outcome` | `readiness_outcome in ('READY','NEED_SUPPLEMENT','INSUFFICIENT')` |
| risk_finding | `ck_risk_finding_evidence` | `jsonb_array_length(evidence_refs) >= 1` |
| risk_finding | `ck_risk_finding_severity` | `severity in ('HIGH','MEDIUM','LOW')` |
| review_task | `ck_review_task_self` | `assignee_user_id <> requester_user_id or is_self_review = true` |
| review_task | `ck_review_task_status` | `status in ('PENDING','IN_PROGRESS','APPROVED','CHANGES_REQUESTED','REJECTED','CANCELLED')` |
| report | `ck_report_no` | `report_no ~ '^RPT-[0-9]{4}-[0-9]{4}$'`（V1.1 替换原 `ck_report_status`：状态已下沉到版本） |
| report_version | `ck_report_version_status` | `status in ('DRAFT','IN_REVIEW','APPROVED','ISSUED','DELIVERED','VOID')`（V1.1 新增，取代 `ck_report_status`） |
| report_version | `ck_report_version_issued` | `status not in ('ISSUED','DELIVERED') or (issued_at is not null and issued_by is not null)` |
| report_version | `ck_report_version_void` | `status <> 'VOID' or (void_reason is not null and voided_at is not null)` |
| report_version | `ck_report_delivery_complete` | 见 3.10 |
| report_version | `ck_report_version_replacement` | `status <> 'VOID' or not (issued_at is not null) or replacement_version_no is not null or void_reason is not null`（G-P6：作废已签发版本必须给替代版本或说明案件终止） |
| ai_task | `ck_ai_task_type` | `task_type in ('DOC_CLASSIFY','FIELD_EXTRACT','TX_CLASSIFY','METRIC_EXPLAIN','RISK_DRAFT','REPORT_DRAFT')` |
| ai_task | `ck_ai_task_status` | `status in ('PENDING','RUNNING','SUCCEEDED','FAILED','TIMEOUT','CANCELLED')` |
| ai_suggestion | `ck_ai_suggestion_status` | `status in ('PENDING','ACCEPTED','REJECTED','SUPERSEDED')` |
| ai_suggestion | `ck_ai_suggestion_confidence` | `confidence is null or (confidence >= 0 and confidence <= 1)` |
| ai_suggestion | `ck_ai_suggestion_reject` | `status <> 'REJECTED' or reject_reason is not null` |
| audit_log | `ck_audit_log_actor_type` / `ck_audit_log_result` | 见 5.2 |
| data_version | `ck_data_version_status` | `status in ('ACTIVE','SUPERSEDED')` |
| data_version | `ck_data_version_trigger` | `trigger_type in ('INITIAL','DOCUMENT_ADDED','DOCUMENT_REPLACED','DOCUMENT_REMOVED','MANUAL_CORRECTION')` |
| data_version | `ck_data_version_digest` | `digest ~ '^[0-9a-f]{64}$' and version_no > 0` |
| data_version | `ck_data_version_superseded` | `status <> 'SUPERSEDED' or superseded_at is not null` |
| analysis_round | `ck_analysis_round_status` | `status in ('DRAFT','DATA_READY','COMPUTED','ASSESSED','CLOSED','SUPERSEDED')` |
| analysis_round | `ck_analysis_round_closed` | `status <> 'CLOSED' or closed_at is not null` |
| analysis_round | `ck_analysis_round_supersede` | `status <> 'SUPERSEDED' or supersede_reason in ('NEW_DATA','CASE_TERMINATED')` |
| analysis_round | `ck_analysis_round_supersede_no` | `superseded_by_round_no is null or superseded_by_round_no > round_no` |
| evidence_ref | `ck_evidence_ref_target_type` | `target_type in ('METRIC','VERIFICATION_ITEM','RISK_FINDING','ASSESSMENT','REPORT_CLAUSE')` |
| evidence_ref | `ck_evidence_ref_kind` | `evidence_kind in ('SOURCE_DOCUMENT','EXTRACTED_FIELD','DATA_ROW','CALCULATION','RULE_HIT','HUMAN_REVIEW','EXTERNAL_PUBLIC')` |
| evidence_ref | `ck_evidence_ref_source_type` | `source_object_type is null or source_object_type in ('DOCUMENT_VERSION','STATEMENT_ITEM','BANK_TRANSACTION','DEBT_RECORD','METRIC','REVIEW_RECORD','NONE')` |
| evidence_ref | `ck_evidence_ref_required_locator` | 见 3.16（按 `evidence_kind` 分支要求定位信息） |
| evidence_ref | `ck_evidence_ref_locator_shape` | `source_locator is null or jsonb_typeof(source_locator) = 'object'` |
| evidence_ref | `ck_evidence_ref_confidence` | `confidence is null or (confidence >= 0 and confidence <= 1)` |
| verification_item | `ck_verification_item_status` / `_answer` / `_resolve` / `_waive` | 见 3.17 |
| verification_item | `ck_verification_item_category` | `category in ('DIFFERENCE','MISSING','CALIBER','FIELD_ANOMALY')` |
| verification_item | `ck_verification_item_severity` | `severity in ('HIGH','MEDIUM','LOW')` |
| verification_item | `ck_verification_item_prior` | `prior_round_no is null or prior_round_no < round_no` |
| verification_item | `ck_verification_item_causes` | `jsonb_typeof(possible_causes) = 'array' and jsonb_array_length(possible_causes) >= 1` |

`ck_review_task_self` 是本设计里最不"标准"、却最必要的一条：DOMAIN 3.10 要求复核人不得与提交人相同，而首期只有一个账号。与其在代码里写 `if (sameUser) { /* 放过 */ }`，不如把"允许自审但必须显式标记"变成数据库约束——这样统计报表里"单人复核占比"永远可查，披露页也有真实数据可引用。

### 6.2 外键策略

统一 `ON DELETE RESTRICT ON UPDATE RESTRICT`，不写 `CASCADE`。理由：业务数据不允许被级联删除，任何删除都必须是显式动作并留审计。

**建外键的（引用完整性有业务价值）**：

| 子表.列 | 父表 | 理由 |
|---|---|---|
| `cpx_financing_case.customer_id` | `cpx_customer` | 案件不能悬空于客户（INV-01） |
| `cpx_financing_case.owner_user_id` | `cpx_user` | 负责人必须是真实用户 |
| `cpx_financing_requirement.case_id` | `cpx_financing_case` | 同聚合 |
| `cpx_case_status_event.case_id` | `cpx_financing_case` | 事件必须依附案件 |
| `cpx_case_material.case_id` | `cpx_financing_case` | 同聚合 |
| `cpx_case_authorization.case_id` / `.evidence_document_id` | case / document | 授权必须指向真实案件与授权书 |
| `cpx_case_authorization_scope.authorization_id` | `cpx_case_authorization` | 同聚合 |
| `cpx_document.case_id` / `.current_version_id` | case / version | 资料必须属于案件 |
| `cpx_document_version.document_id` | `cpx_document` | 同聚合 |
| `cpx_document_review.document_id` / `.document_version_id` | document / version | 核验记录不可指向不存在的版本 |
| `cpx_data_import.case_id` / `.document_id` / `.document_version_id` | case / document / version | 导入批次必须能回到源文件（追溯链前提） |
| `cpx_data_import_record.import_id` | `cpx_data_import` | 同聚合 |
| `cpx_data_quality_issue.case_id` | `cpx_financing_case` | 问题必须属于案件 |
| `cpx_financial_statement.case_id` / `.import_id` / `.document_version_id` | case / import / version | 报表必须可回溯到源文件 |
| `cpx_financial_statement_item.statement_id` | `cpx_financial_statement` | 同聚合 |
| `cpx_financial_metric.case_id` / `.superseded_by` | case / metric | 指标必须属于案件；版本链自引用 |
| `cpx_bank_transaction.case_id` / `.import_id` / `.import_record_id` | case / import / record | 追溯链核心，此处断链等于系统失去可核验性 |
| `cpx_debt_record.case_id` / `.source_document_id` / `.source_import_record_id` | case / document / record | 债务必须能指向合同或对账单 |
| `cpx_metric_snapshot.case_id` | `cpx_financing_case` | — |
| `cpx_metric_snapshot_item.snapshot_id` / `.metric_id` | snapshot / metric | 同聚合 + 指标引用 |
| `cpx_metric_source.metric_id` / `.statement_item_id` / `.bank_transaction_id` / `.debt_record_id` | metric / item / txn / debt | 追溯链的唯一实现手段 |
| `cpx_analysis_result.case_id` / `.snapshot_id` | case / snapshot | INV-06 |
| `cpx_assessment.case_id` / `.snapshot_id` | case / snapshot | 评估必须绑定不可变快照 |
| `cpx_risk_finding.assessment_id` | `cpx_assessment` | 同聚合 |
| `cpx_review_task.case_id` / `.requester_user_id` / `.assignee_user_id` | case / user / user | — |
| `cpx_review_record.review_task_id` / `.reviewer_user_id` | task / user | — |
| `cpx_report.case_id` | `cpx_financing_case` | — |
| `cpx_report_version.report_id` / `.snapshot_id` / `.assessment_id` / `.delivery_evidence_document_id` | report / snapshot / assessment / document | 报告数字必须能追到快照，签发必须能追到评估 |
| `cpx_ai_task.case_id` | `cpx_financing_case` | 可空（跨案件的通用任务） |
| `cpx_ai_suggestion.ai_task_id` / `.case_id` | ai_task / case | AI 建议必须能追到执行记录 |
| `cpx_ai_execution_log.ai_task_id` | `cpx_ai_task` | — |
| `cpx_user_role.user_id` / `.role_id` | user / role | — |
| `cpx_role_permission.role_id` / `.permission_id` | role / permission | — |
| `cpx_financing_case.previous_case_no` | `cpx_financing_case(case_no)` | 续做关系必须指向真实存在的原案；自引用，`CHECK <>` 防自我循环 |
| `cpx_data_version.case_id` | `cpx_financing_case` | 数据版本必须属于案件 |
| `cpx_data_version_member.data_version_id` / `.document_version_id` | data_version / document_version | 成员关系是"这一版数据由哪些文件构成"的唯一证据，不允许悬空 |
| `cpx_analysis_round.case_id` / `.data_version_id` / `.metric_snapshot_id` / `.assessment_id` | case / data_version / snapshot / assessment | 轮次是追溯链的第二层，任何一环断开则报告无法解释来源 |
| `cpx_analysis_round (case_id, superseded_by_round_no)` | `cpx_analysis_round (case_id, round_no)` | 血缘到具体轮次；用业务号做外键，避免为显示"第几轮"再 join 一次 |
| `cpx_metric_snapshot (case_id, round_no)` / `(case_id, data_version_id)` | round / data_version | 快照必须落在某一轮、某一数据版本上 |
| `cpx_assessment (case_id, round_no)` | round | 评估必须属于某一轮 |
| `cpx_risk_finding (case_id, round_no)` / `(assessment_id, round_no)` | round / assessment | 风险事项挂轮次；回填的评估必须同轮 |
| `cpx_report_version (case_id, round_no)` / `(report_id, case_id)` | round / report | 报告版本必须绑定真实轮次，且归属与其报告容器一致 |
| `cpx_evidence_ref.case_id` / `.data_version_id` / `.review_record_id` | case / data_version / review_record | 证据必须落在某一数据版本上（INV-18 的外键底座）；人工复核类证据必须指向真实复核记录 |
| `cpx_verification_item (case_id, round_no)` / `(case_id, prior_round_no)` | round | 归属轮次与继承来源轮次都必须真实存在 |

**本表新增的写法：复合外键 + 平凡唯一键。** `cpx_risk_finding`、`cpx_report_version`、`cpx_metric_snapshot` 都需要"某一列必须与父对象的对应列一致"（如 `round_no` 必须等于其评估的 `round_no`）。做法是在父表上加一条 `unique (id, <该列>)`——因为 `id` 已是主键，这条唯一约束平凡成立、不增加实际约束力，但**它给了外键一个可引用的目标**。这样一致性由外键保证，不需要触发器，也不需要"应用层记得一起改"。代价是每条多一个几乎无成本的索引项。

**刻意不建外键的（并在代码里承担校验责任）**：

| 列 | 原因 | 补偿措施 |
|---|---|---|
| 全部 `created_by` / `updated_by` / `uploaded_by` / `changed_by` / `issued_by` / `granted_by_user_id`（历史类操作人列除外，见下） | 用户可能被停用或软删除；审计型写入要求"即使账号不存在也能落库"。为高频写入加外键等于每次写多一次共享锁 | 应用层写入前校验用户存在；`cpx_audit_log` 同样不建 |
| `cpx_data_quality_issue.target_id` | 多态（可指向报表科目、流水、指标、文档、债务），列类型都无法统一 | 应用层按 `target_type` 校验；提供月度一致性巡检 SQL |
| `cpx_review_task.target_id` | 同上（DOCUMENT/DATA/ASSESSMENT/REPORT 四种目标） | 同上；另由 `uq_review_task_active` 防止重复建任务 |
| `cpx_ai_suggestion.target_type/target_id` | 同上 | 绑定 `ai_task` 已能定位上下文 |
| `cpx_ai_suggestion.applied_ref_id` | 指向人工确认后生成的业务对象，类型不定 | 只作展示，不作为完整性依据 |
| `cpx_audit_log.resource_id` / `.case_id` | 审计为旁路记录，父记录被归档后审计还要保留（保留期更长） | 不校验；审计的价值在于"当时发生了什么"，不在于"现在还能 join 上" |
| `cpx_idempotency.resource_id` | 多态 | — |
| `cpx_evidence_ref.target_id` | 多态：可指向指标、待核实事项、风险事项、评估、报告条款五类，其中既有 uuid 也有复合键 | 写入时同事务校验；渲染前同步校验；每日巡检（7.5） |
| `cpx_evidence_ref.source_object_id` / `.source_object_type` | 多态：可指向文件版本、报表科目（bigint）、流水（bigint）、债务（uuid）、指标（uuid）、复核记录（uuid），主键类型跨 bigint 与 uuid 两种 | 同上；另加"按类型分支的反连接巡检"（7.5 SQL ①） |
| `cpx_data_version.trigger_ref` | 多态：`DOCUMENT_*` 指向文件版本，`MANUAL_CORRECTION` 指向修正单；触发源未来可能增加 | 触发源只用于解释"为什么产生这一版"，追溯链不依赖它（真实成员关系在 `cpx_data_version_member`），因此允许弱引用 |
| `cpx_field_dictionary` 的所有列 | 纯字典，无引用对象 | — |

最关键的一条判断：**审计与追溯不是同一件事**。需要"逐层可 join"的（指标→原始行→文件版本）必须建外键；只需要"当时记了什么"的（审计、AI 建议处置）不该建外键，否则归档清理会被外键卡死。

### 6.3 唯一与排斥约束汇总

| 类型 | 约束 | 表达的业务规则 |
|---|---|---|
| 唯一 | `uq_financing_case_no` | 案件编号唯一且不可变 |
| 唯一 | `uq_customer_credit_code (WHERE deleted_at IS NULL)` | 统一社会信用代码全局唯一（DOMAIN 3.1） |
| 部分唯一 | `uq_contact_primary (customer_id) WHERE is_primary AND deleted_at IS NULL` | 恰好一个主联系人 |
| 部分唯一 | `uq_requirement_current (case_id) WHERE is_current` | 每案一条当前需求 |
| 部分唯一 | `uq_auth_scope_active` 由 EXCLUDE 替代 | 同案同范围授权期不重叠 |
| 部分唯一 | `uq_document_version_current` | 每文档一个有效版本 |
| 部分唯一 | `uq_statement_current` | 同案同期同类型一套有效报表 |
| 部分唯一 | `uq_financial_metric_current` | 同指标同期间同公式版本一个当前值 |
| 部分唯一 | `uq_assessment_current (case_id, round_no) WHERE is_current` | 每案每轮一个当前评估（V1.1 改作用域） |
| 部分唯一 | `uq_review_task_active` | 同一对象一个在办复核 |
| 唯一 | `uq_report_case (case_id)` | 每案一个报告容器；多轮多版是它的版本 |
| 部分唯一 | `uq_report_version_round (report_id, round_no) WHERE status <> 'VOID'` | 一版只挂一轮；同轮再出版本前必须先作废旧版 |
| 唯一 | `uq_data_version_no (case_id, version_no)` | 案件内版本号唯一且递增 |
| 唯一 | `uq_data_version_digest (case_id, digest)` | **INV-19**：digest 相同不得产生新版本 |
| 部分唯一 | `uq_data_version_active (case_id) WHERE status = 'ACTIVE'` | 每案任一时刻只有一个当前数据版本 |
| 唯一 | `uq_analysis_round_no (case_id, round_no)` | 案件内轮次号唯一 |
| 唯一 | `uq_analysis_round_data_version (case_id, data_version_id)` | 一个数据版本只开一轮（G-R1 幂等兜底） |
| 唯一 | `uq_evidence_ref_unique` | 同一目标同一来源同一位置只挂一条证据 |
| 唯一 | `uq_verification_item_root (case_id, round_no, root_item_id)` | 同一轮同一疑问至多一条 |
| 唯一 | `uq_verification_item_code (case_id, round_no, code)` | 同一轮同一规则码至多一条 |
| 唯一 | `uq_bank_txn_dedupe (case_id, dedupe_key)` | 同一流水不重复入库 |
| 排斥 | `ex_auth_scope_no_overlap` | 授权区间不重叠 |

---

## 七、追溯链设计（V1.1 重写）

V1.0 的追溯链是一条单线："评估 → 快照 → 指标 → 来源行 → 批次 → 文件版本"。在多轮模型下这条线不够用了，它回答不了基线修正 3 提出的第一个问题——"这句话用的是哪一版资料"。评估可能有多个，快照可能被重算，而报告到底挂在哪一轮、那一轮绑的是哪一版数据，V1.0 的链里没有落点。

V1.1 拆成**两条链**，两条都必须逐层可 join：

| 链 | 回答的问题 | 起点 | 终点 |
|---|---|---|---|
| **结构链** | 这份报告基于哪一轮、哪一版数据、哪几个文件 | `cpx_report_version.round_no` | 存储层的原始文件 |
| **证据链** | 报告里的这个数字、这句话凭什么 | `cpx_evidence_ref` | 指标 / 数据行 / 文件页 + 公式版本 + 复核记录 |

两条链在第 4 层汇合于 `cpx_document_version`。汇合点上再加一条约束：证据引用的 `data_version_id` 必须等于报告所绑轮次的数据版本（INV-18），否则会出现"用第 3 轮的数据支撑第 2 轮的结论"。

### 7.1 结构链（报告版本 → 原始文件）

```
cpx_report_version (case_id, round_no)
        │ 复合外键 (case_id, round_no)
        ▼
cpx_analysis_round ──── data_version_id ────▶ cpx_data_version
        │                                          │
        │ metric_snapshot_id                       │ (data_version_id)
        ▼                                          ▼
cpx_metric_snapshot                        cpx_data_version_member
        │                                          │ document_version_id
        │ snapshot_id                              ▼
        ▼                                   cpx_document_version
cpx_metric_snapshot_item                           │ document_id
        │ metric_id                                ▼
        ▼                                     cpx_document
cpx_financial_metric ──▶ cpx_metric_source ──▶ 报表科目 / 流水 / 债务
```

| 层 | 表 | 关键列 | 外键指向 | 断了会怎样 |
|---|---|---|---|---|
| L1 报告版本 | `cpx_report_version` | `(case_id, round_no)` | → `cpx_analysis_round(case_id, round_no)` | 报告说不出基于哪一轮结论 |
| L2 分析轮次 | `cpx_analysis_round` | `data_version_id` | → `cpx_data_version(id)` | 分析说不出用了哪一版数据 |
| L3 数据版本 | `cpx_data_version` | `id`、`digest`、`version_no` | 本层是枢纽，无上游 | `digest` 是数据指纹，可校验"当时算的到底是哪一组文件" |
| L4 版本成员 | `cpx_data_version_member` | `data_version_id`、`document_version_id` | → `cpx_data_version` / → `cpx_document_version` | 说不出这一版数据由哪些文件构成 |
| L5 文件版本 | `cpx_document_version` | `document_id`、`sha256`、`storage_key` | → `cpx_document(id)` | 版本找不到归属文档；`sha256` 是内容指纹 |
| L6 原始文件 | 存储层 | `storage_key` | 非数据库外键（A-10） | 取不到原件，降级为"能证明它是什么"（7.6 末段） |

L1 用复合外键而不是单列 `round_no`：`round_no` 只在案件内唯一，单列外键在 PostgreSQL 里根本无法建立。`(case_id, round_no)` 在 `cpx_analysis_round` 上有唯一索引（`uq_analysis_round_no`），因此可以直接被引用。这也解释了为什么 `cpx_report_version` 要新增 `case_id`——`report_id` 虽然能间接得到案件，但外键不能间接。

`cpx_report_version.case_id` 与 `cpx_report.case_id` 可能不一致，所以再加一条复合外键 `(report_id, case_id) → cpx_report(id, case_id)`（`cpx_report` 上加了平凡唯一键 `uq_report_id_case`）。两条外键咬合后，"报告的 case、轮次的 case、版本的 case"三者一致由数据库保证，不需要触发器。

### 7.2 数据侧支链（指标 → 原始行）

结构链到 L4 证明了"这一版数据由哪些文件构成"，但没有证明"某个具体数字来自哪一行"。后者走这条支链：

| 层 | 表 | 关键列 | 外键指向 |
|---|---|---|---|
| D1 快照 | `cpx_metric_snapshot` | `snapshot_id`（报告版本持有） | — |
| D2 快照指标行 | `cpx_metric_snapshot_item` | `snapshot_id`、`metric_id` | → snapshot / → `cpx_financial_metric.id` |
| D3 指标 | `cpx_financial_metric` | `data_version_id`、`formula`、`formula_version` | → `cpx_data_version(id)` |
| D4 指标来源 | `cpx_metric_source` | `metric_id`、`source_type`、三列可空外键 | → metric / → `cpx_financial_statement_item.id` 或 `cpx_bank_transaction.id` 或 `cpx_debt_record.id` |
| D5 原始行 | `cpx_financial_statement_item` / `cpx_bank_transaction` | `statement_id` / `import_record_id` + `source_row_no` | → `cpx_financial_statement.id` / → `cpx_data_import_record.id` |
| D6 批次 | `cpx_data_import` / `cpx_data_import_record` | `document_version_id` | → `cpx_document_version.id` |
| D7 文件版本 | `cpx_document_version` | 同结构链 L5 | 汇合点 |

**支线 A：报表科目 → 批次。** `cpx_financial_statement` 同时持有 `import_id` 与 `document_version_id`，即使指标来源指向 statement_item，也能一次跳回文件，不必经 `cpx_data_import` 中转。这是有意的冗余：报表是"整份文件一次导入"的产物，多存一个外键省掉两级 join。

**支线 B：债务 → 合同。** `cpx_debt_record.source_document_id` 直接指向合同文件，`source_import_record_id` 指向债务清单的原始行。债务既可能来自手工录入（只有文件），也可能来自批量导入（有行号），两条路都要能走通，所以两者都建。

**支链与结构链必须闭合**：D7 的文件版本必须出现在 L4 的成员集合里。这条是 V1.1 新增的检查——V1.0 没有数据版本概念，所以无法表达"这个指标用了不属于这一版数据的文件"。现在它可以被检出：`cpx_metric_source` 一路追到的 `document_version_id`，若不在该指标 `data_version_id` 的成员集合中，说明数据版本漏登记了成员，或指标算错了数据版本。巡检 SQL 见 7.5 ④。

### 7.3 证据链（数字/结论 → 引用 → 来源）

| 被支撑的对象 | `target_type` | 一条证据需要携带什么 | 典型 `evidence_kind` |
|---|---|---|---|
| 报告中的数字 | `METRIC` | `source_object_id` = metric_id、`formula_code`、`formula_version`、`period_label` | `CALCULATION` |
| 报告中的结论段落 | `REPORT_CLAUSE` | 段落锚点 + 至少一条指向底层对象的引用 | 混合 |
| 待核实事项 | `VERIFICATION_ITEM` | 指向具体数据行或文件页（"哪笔、哪页"） | `DATA_ROW` / `EXTRACTED_FIELD` / `SOURCE_DOCUMENT` |
| 风险事项 | `RISK_FINDING` | 同上；表述性结论通常还会挂一条 `HUMAN_REVIEW` | `DATA_ROW` / `CALCULATION` / `HUMAN_REVIEW` |
| 准备度评估的某一维 | `ASSESSMENT` | 该维依据的指标 id 或资料项状态 | `CALCULATION` / `RULE_HIT` |

**一次完整的数字解释要跳四次**，这是刻意设计的层级，不是冗余：

```
报告正文 "营业收入 12,345,600.00 元"
  → cpx_evidence_ref(METRIC, evidence_kind=CALCULATION, source_object_id=<metricId>,
                      formula_code=REVENUE, formula_version=v1.2, data_version_id=<V2>)
  → cpx_financial_metric (value, formula 文本, computed_at)
  → cpx_metric_source (SUM → statement_item 18 → import_record 42)
  → cpx_data_import_record (row_no=42) → cpx_data_import → cpx_document_version (#sha256)
  → 存储层原件第 3 页
```

如果只跳两次（报告 → 指标），复核人无法确认"这个指标算法对不对"；只跳三次（报告 → 指标 → 原始行），无法回答"这一行出自哪份文件的哪一版"。四跳是"可核验"三个字要求的最小深度。

`REPORT_CLAUSE` 类证据的 `target_id` 用 `{reportVersionId}#{clauseNo}` 这种复合形式（`varchar(64)` 足够），因为报告条款在渲染时生成、没有独立表，为它建表会让"报告内容"与"条款结构"两处都有真相。

### 7.4 `cpx_evidence_ref.source_object_id` 为什么不能建单一外键

| 原因 | 具体表现 |
|---|---|
| 目标跨 6 类对象 | 文件版本、报表科目、流水行、债务记录、指标、复核记录，分属 4 个模块 |
| 主键类型不统一 | `cpx_bank_transaction.id`、`cpx_financial_statement_item.id` 是 `bigint`；其余是 `uuid`。一列无法用两种类型做外键 |
| 目标还会增加 | 未来可能引用"报表页快照""外部工商快照"。每增加一类，拆列方案就要加一列 + 改一次互斥 CHECK，等于每次扩展都发 DDL |
| PostgreSQL 不支持多态外键 | 没有"按另一列的值选择引用表"的外键形式；写 `CHECK` 也无法引用其他表 |

替代方案比较：

| 方案 | 能否保证完整性 | 每次新增来源类型的成本 | 结论 |
|---|---|---|---|
| 拆成 6 个可空外键列 + 互斥 `CHECK`（`cpx_metric_source` 的做法） | 能（数据库级） | 加列 + 改 CHECK + 改所有写入代码，一次 DDL | **不采用**。`metric_source` 的来源类型是封闭的 3 类（报表科目、流水、债务），且写入集中在 Java 计算模块；证据引用的来源是开放的，且会被报告模板演进持续拉动 |
| `jsonb` 存 `{type, id}` | 不能 | 0 | 不采用。这正是"追溯链靠 jsonb 断掉"的原始问题 |
| 单列 `varchar(64)` + 三层校验（本节做法） | **不能由数据库单独保证**，由三层补偿 | 0（新增类型只改 Java 枚举与 CHECK 取值） | **采用** |

**结论：不建单一外键，用"应用层校验 + 定期一致性巡检 + 渲染前同步校验"三层保证完整性。**

| 层 | 时机 | 做什么 | 失败表现 |
|---|---|---|---|
| 第一层：写时校验 | 写 `cpx_evidence_ref` 的同一事务内 | 按 `source_object_type` 分支 `SELECT 1 ... WHERE id = ?`，不存在即回滚 | 返回 `EVIDENCE_CHECK_FAILED` + 缺失项，不落库 |
| 第二层：渲染前校验 | 报告生成（P01）与提交复核（P02）时 | 一次性把该 `data_version_id` 下的全部证据按 `target_type` 分组取回，逐条验可达性 + 校验 INV-18 | 渲染中止，返回缺失引用的段落与数字（workflow §9 错误码 `EVIDENCE_CHECK_FAILED`） |
| 第三层：定期巡检 | 每日 02:30，覆盖最近 90 天写入的证据 + 全部未 `VOID` 报告涉及的证据 | 五类反连接检查（7.5），任何一条输出即告警 | 生成巡检报告，不自动修数——孤儿证据只能由人判断是忽略还是补引用 |

为什么第三层不覆盖全表：10^7 行的全量反连接每天跑一次会与报表渲染争 IO。90 天窗口足以抓到"库内对象被误删"的绝大多数情形（对象一旦超过 90 天，正常业务路径不会再删它），而报告一经签发其证据就不再变化，全量检查放到每季度一次。

### 7.5 一致性巡检 SQL 思路（写成每日任务）

五类检查，每条都是"反连接"（`not exists`），输出即异常。**必须按 `source_object_type` / `target_type` 分开写**，不能统一强转后 union——那样既走不了索引，也会把不同表的 id 撞在一起。

```sql
-- ① 证据指向的来源对象不存在（按类型分支，最重的一类）
select 'BANK_TRANSACTION' as orphan_type, e.id as evidence_id, e.source_object_id
from cpx_evidence_ref e
where e.source_object_type = 'BANK_TRANSACTION' and e.created_at >= now() - interval '90 days'
  and not exists (select 1 from cpx_bank_transaction t where t.id = e.source_object_id::bigint)
union all
select 'STATEMENT_ITEM', e.id, e.source_object_id
from cpx_evidence_ref e
where e.source_object_type = 'STATEMENT_ITEM' and e.created_at >= now() - interval '90 days'
  and not exists (select 1 from cpx_financial_statement_item i where i.id = e.source_object_id::bigint)
union all
select 'DOCUMENT_VERSION', e.id, e.source_object_id
from cpx_evidence_ref e
where e.source_object_type = 'DOCUMENT_VERSION' and e.created_at >= now() - interval '90 days'
  and not exists (select 1 from cpx_document_version v where v.id::text = e.source_object_id)
union all
select 'METRIC', e.id, e.source_object_id
from cpx_evidence_ref e
where e.source_object_type = 'METRIC' and e.created_at >= now() - interval '90 days'
  and not exists (select 1 from cpx_financial_metric m where m.id::text = e.source_object_id)
union all
select 'DEBT_RECORD', e.id, e.source_object_id
from cpx_evidence_ref e
where e.source_object_type = 'DEBT_RECORD' and e.created_at >= now() - interval '90 days'
  and not exists (select 1 from cpx_debt_record d where d.id::text = e.source_object_id);
```

```sql
-- ② 证据的数据版本 ≠ 其所支撑报告所绑轮次的数据版本（INV-18 违规）
--    报告条款类证据的 target_id 形如 {reportVersionId}#{clauseNo}，用前缀匹配收敛
select rv.id as report_version_id, rv.round_no, count(*) as bad_refs
from cpx_report_version rv
join cpx_analysis_round r on r.case_id = rv.case_id and r.round_no = rv.round_no
join cpx_evidence_ref e
  on e.target_type = 'REPORT_CLAUSE'
 and e.target_id like rv.id::text || '%'
where rv.status <> 'VOID'
  and e.data_version_id <> r.data_version_id
group by rv.id, rv.round_no;
```

```sql
-- ③ 证据指向的指标 formula_version 与记录不一致（CALCULATION 类）
select e.id as evidence_id, e.formula_version as ref_version, m.formula_version as metric_version
from cpx_evidence_ref e
join cpx_financial_metric m on m.id::text = e.source_object_id
where e.evidence_kind = 'CALCULATION'
  and e.source_object_type = 'METRIC'
  and e.formula_version <> m.formula_version;
```

```sql
-- ④ 指标来源文件不在该指标数据版本的成员集合里（结构链与支链未闭合）
--    下面只写"报表科目"这一条分支；流水（经 cpx_bank_transaction.import_id）与
--    债务（经 cpx_debt_record.source_document_id）需同构的两条 union all 分支
select m.id as metric_id, m.metric_code, m.data_version_id, dv.id as document_version_id
from cpx_financial_metric m
join cpx_metric_source s on s.metric_id = m.id and s.source_type = 'STATEMENT_ITEM'
join cpx_financial_statement_item si on si.id = s.statement_item_id
join cpx_financial_statement fs on fs.id = si.statement_id
join cpx_data_import di on di.id = fs.import_id
join cpx_document_version dv on dv.id = di.document_version_id
where not exists (
  select 1 from cpx_data_version_member vm
  where vm.data_version_id = m.data_version_id
    and vm.document_version_id = dv.id
);
```

```sql
-- ⑤ 结论零证据：未终结的待核实事项、以及未作废轮次的风险事项，没有任何证据引用
select 'VERIFICATION_ITEM' as target_type, vi.id as target_id
from cpx_verification_item vi
where vi.status in ('OPEN','ANSWERED')
  and not exists (
    select 1 from cpx_evidence_ref e
    where e.target_type = 'VERIFICATION_ITEM' and e.target_id = vi.id::text
  )
union all
select 'RISK_FINDING', rf.id
from cpx_risk_finding rf
join cpx_analysis_round r on r.case_id = rf.case_id and r.round_no = rf.round_no
where r.status <> 'SUPERSEDED'
  and not exists (
    select 1 from cpx_evidence_ref e
    where e.target_type = 'RISK_FINDING' and e.target_id = rf.id::text
  );
```

巡检结果的处理原则：**只报告，不自动删除、不自动补引用**。孤儿证据可能意味着"该数据行被误删"（严重）或"该文件已按保留策略清理"（正常降级），这两者只能由人判断。自动清理会把最需要解释的异常变成静默消失。

### 7.6 上线前与发布后的验证 SQL

```sql
-- 指标无来源（允许的时点类指标除外）
select m.id as metric_id, m.metric_code, m.data_period
from cpx_financial_metric m
where m.superseded_at is null
  and not exists (select 1 from cpx_metric_source s where s.metric_id = m.id)
  and m.metric_code not in ('CASH_POSITION')
limit 100;

-- 报告版本绑定的轮次不是 CLOSED（触发器兜底后应为 0 行；这条用于验证触发器确实装上了）
select rv.id, rv.status, r.status as round_status
from cpx_report_version rv
join cpx_analysis_round r on r.case_id = rv.case_id and r.round_no = rv.round_no
where r.status <> 'CLOSED';

-- 数据版本成员为空（版本建了但没登记构成，digest 无法复算）
select dv.id, dv.version_no from cpx_data_version dv
where not exists (select 1 from cpx_data_version_member m where m.data_version_id = dv.id);
```

追溯链的价值在保留期到期后会降级：文件必须删，此时链路的价值从"能打开原件"变成"能证明原件是什么、谁在何时用什么哈希存过它"。这个降级必须显式记录（`purged_at` + `storage_key` 改为 `archived://` + 审计 `FILE_PURGED`），而不是让链路静默断开。这也是 `cpx_evidence_ref` 必须与报告同寿命的原因（8.1）。

---

## 八、数据保留与清理

### 8.1 保留策略的四级分层（V1.1 修订）

判定标准只有一句：**结论与血缘永久保留，原始材料的内容按期限清理，技术日志按用途清理。** 清理的边界是"材料"，不是"结论"，也不是"关系"。

| 级别 | 判定标准 | 数据 | 保留期 | 到期动作 |
|---|---|---|---|---|
| **L1 结论层** | 构成"当时为什么这么判断"，删了就无法解释 | `cpx_report` / `cpx_report_version`、`cpx_assessment`、`cpx_risk_finding`、`cpx_verification_item`、`cpx_financial_metric`、`cpx_metric_snapshot(_item)`、`cpx_analysis_result`、`cpx_analysis_round`、`cpx_data_version`、`cpx_data_version_member`、**`cpx_evidence_ref`** | **永久** | 不清理，只读 |
| **L2 数据骨架层** | 结论指向的具体数据行与文件元数据 | `cpx_document` / `cpx_document_version` 元数据、`cpx_financial_statement(_item)`、`cpx_bank_transaction`、`cpx_debt_record`、`cpx_data_import`、`cpx_metric_source`、`cpx_case_material`、`cpx_case_status_event` | 永久 | 不清理；归档后只读 |
| **L3 原始内容层** | 客户提供的材料本体 | `storage` 下的文件二进制、`cpx_data_import_record.raw_data` / `.parsed_data` | 交付后 36 个月 | 删对象；`storage_key` → `archived://`；`raw_data` → `'{}'`、`parsed_data` → NULL、写 `purged_at`；审计 `FILE_PURGED` |
| **L4 技术运行层** | 只为排障、安全与幂等 | `cpx_audit_log`、`cpx_ai_execution_log`、`cpx_ai_task` / `cpx_ai_suggestion`、`cpx_idempotency` | 审计 36 个月在线 + 84 个月冷归档；AI 90 天 / 24 个月；幂等 24 小时 | 分区归档 / 分批 DELETE |

**三个直接回答**（本轮修订要求给分级结论的项）：

| 数据 | 归级 | 结论 | 理由 |
|---|---|---|---|
| 数据版本 `cpx_data_version`（含成员） | L1 | **随报告永久保留** | 它是"报告基于哪一版数据"的唯一答案。删掉它，报告仍有结论、却失去主语，`digest` 也无法复算 |
| 分析轮次 `cpx_analysis_round` | L1 | **随报告永久保留** | 轮次是"第几遍、什么时候、基于哪版"的时间坐标；`superseded_by_round_no` 是轮次之间的血缘，删了就无法解释"第 2 轮的结论为什么被第 3 轮取代" |
| 证据引用 `cpx_evidence_ref` | L1 | **随报告永久保留** | 它是把"数字"钉到"文件页/数据行/公式版本"上的唯一表。删掉后报告内容一字不少，但每一个数字都变成无出处断言——报告本身的法律与专业价值随之消失 |

**为什么这三者不跟着原始资料一起清**：清理的对象是"内容"（文件字节、原始行），不是"关系"。文件删掉之后，`cpx_document_version` 行仍在、`sha256` 仍在、`storage_key` 变成 `archived://...`，证据依然能回答"来自哪份文件的哪一版哪一页、当时哈希是多少"，只是打不开原件。这个降级是有价值的——它证明"当年确实看过这份东西"，而"打不开"是保留期的必然结果，不是缺陷。把证据一起删掉，等于把可解释性换成节省几个 GB。

**L3 清理的两个技术细节**：

- `cpx_data_import_record.raw_data` 是 `NOT NULL`，清理时写 `'{}'::jsonb` 而不是 NULL。写 NULL 会违反约束，而放宽约束会让"空行"与"已清理"在数据上不可区分。为此新增 `purged_at timestamptz`（与 `cpx_document_version.purged_at` 同名同义），判定"这一行是否已清"只看它，不看内容是否为空。
- `parsed_data` 是 `jsonb` 可空，清理时置 NULL 即可，同样以 `purged_at` 为准。

36 个月的选择不变：融资服务纠纷的诉讼时效为 3 年，资料保留期不短于时效期是行业惯例，也便于客户续贷时复用。合同另有约定时以合同为准，`retention_until` 逐案可调。

### 8.2 按月清理（技术类数据）

| 任务 | 频率 | 动作 |
|---|---|---|
| 预建审计分区 | 每月 25 日 | 建下月、下下月分区 |
| 审计分区归档 | 每月 1 日 | 对超过 36 个月的分区执行 5.4 四步 |
| 幂等键清理 | 每小时 | `DELETE FROM cpx_idempotency WHERE expires_at < now() LIMIT 10000` |
| AI 执行日志清理 | 每日 03:00 | 分批 DELETE，单批 ≤ 5000 行，批间 sleep 200ms |
| 孤立 `storage` 对象清理 | 每周 | 列出存储中无对应 `cpx_document_version` 的对象（上传中断残留），超过 7 天删除 |

分批删除的理由：单条 `DELETE ... WHERE occurred_at < x` 可能锁住数十万行并撑爆 WAL，期间阻塞其他写入。分批 + 短事务是唯一安全的做法。

### 8.3 按案件清理（业务类数据）

触发条件：`closed_at is not null and retention_until < current_date`，且案件不在法务保全名单内。

执行顺序（必须按此顺序，否则外键会拒绝）：

1. 校验案件 `lifecycle = 'CLOSED'`，否则跳过并告警。
2. 汇总待删文件清单（`cpx_document_version.storage_key`），写入 `cpx_audit_log`（`action = 'FILE_PURGE_PLAN'`，`detail` 含清单摘要与总字节数）。
3. 删除存储对象；逐个成功后把 `storage_key` 更新为 `archived://{documentId}/v{n}`，并置 `purged_at`。
4. 清理 `cpx_data_import_record`：`raw_data := '{}'::jsonb`、`parsed_data := NULL`、`purged_at := now()`，按 `import_id` 分批（单批 ≤ 5000 行）。
5. 写 `cpx_audit_log`（`action = 'FILE_PURGED'`，`result = 'SUCCESS'`，`detail` 含成功/失败计数）。
6. 任何一步失败即停止，不继续下一步；失败的案件进入人工处理队列。

明确不做的事：不删 `cpx_financial_statement`、不删 `cpx_metric_snapshot`、不删报告、**不删数据版本 / 轮次 / 证据引用**——交付物、数字证据与血缘永久保留。清理的边界是"原始材料的内容"，不是"结论"，也不是"结论凭什么成立"。

### 8.4 清理自身的可审计性

所有清理动作（分区归档、日志删除、文件清除）必须写 `cpx_audit_log`，且这条记录本身不参与后续清理（`action` 以 `PURGE_` / `ARCHIVE_` 开头的记录永久保留）。清理任务如果没有留痕，事后无法回答"某份资料为什么不见了"——这比资料丢失本身更难处理。

---

## 九、典型查询与执行计划关注点

### Q1 某案件未处理的 BLOCKER 问题数（G-R2 / G-R5 守卫）

```sql
select count(*) as blocker_open
from cpx_data_quality_issue
where case_id = :caseId
  and severity = 'BLOCKER'
  and status in ('OPEN','ACKNOWLEDGED');
```

执行计划关注点：

- 必须命中 `idx_quality_issue_blocker_open`，且为 **Index Only Scan**（count(*) 不需要回表）。若显示 `Seq Scan`，九成是谓词写法与索引谓词不一致——比如把 `status in ('OPEN','ACKNOWLEDGED')` 写成 `status <> 'RESOLVED'`，规划器无法证明后者蕴含前者，部分索引直接失效。这是部分索引最常见的踩坑点。
- `Heap Fetches` 应接近 0。若很高，说明该表 `VACUUM` 滞后，需要调低 `autovacuum_vacuum_scale_factor`（建议 0.02）。
- 该查询在每次状态流转时执行，必须 < 5ms。若超过，说明索引没命中，不要靠加缓存掩盖。

### Q2 某指标在同一期间的历史计算版本

```sql
select m.id, m.value_amount, m.value_ratio, m.value_days,
       m.formula_version, m.data_version_id, m.computed_at, m.superseded_at
from cpx_financial_metric m
where m.case_id = :caseId
  and m.metric_code = :metricCode
  and m.data_period = :period
order by m.computed_at desc
limit 50;
```

执行计划关注点：

- 期望 `Index Scan using idx_financial_metric_history`，**不出现 Sort 节点**——索引列序 `(case_id, metric_code, data_period, computed_at desc)` 已与 ORDER BY 完全对齐。
- 若出现 `Sort`，检查是否索引列序被写成 `(case_id, metric_code, computed_at)`：等值列必须在前，排序列必须在最后，中间多一列就会退化为 Sort。
- 走 `Limit 50` 时规划器通常选 Index Scan；若它误判为走全表 + Sort，多半是统计信息过期，先 `ANALYZE cpx_financial_metric`。
- 若查询加 `and superseded_at is null`，会额外过滤，此时仍应走同一索引（该表当前值行数远小于历史行，过滤代价可忽略）。

### Q3 某案件的资料齐备性检查（G-C3 / G-R4 守卫）

V1.1 之后这个查询变简单了：`cpx_case_material.status` 落库，不再需要从文档版本反推状态，只需要补"n/m 已核验"的计数（workflow §3.4 多文件规则要求部分完成时显示比例）。

```sql
select cm.material_code,
       cm.material_name,
       cm.status,
       count(v.id) as current_version_count,
       count(v.id) filter (where v.verification_state = 'VERIFIED') as verified_version_count
from cpx_case_material cm
left join cpx_document d
       on d.case_id = cm.case_id
      and d.doc_type = cm.material_code
      and d.deleted_at is null
left join cpx_document_version v
       on v.id = d.current_version_id
where cm.case_id = :caseId
  and cm.requirement_level = 'REQUIRED'
group by cm.material_code, cm.material_name, cm.status
order by cm.material_code;
```

执行计划关注点：

- 期望计划形状为 `Nested Loop Left Join` + `HashAggregate`：外层是 `cpx_case_material` 的 `(case_id, material_code)` 索引扫描（通常 20 行以内），内层走 `idx_document_case_type`，再按 `cpx_document_version` 主键回表。
- 若出现 `Hash Left Join` 且 Hash 侧是全表 `cpx_document`，说明规划器估错了外层行数（默认统计假设 `case_id` 均匀分布，而实际案件间文档量差异极大）。解决方式：对该查询用 `EXPLAIN` 确认外层估算行数与实际差异超 10 倍时，考虑把 `LEFT JOIN` 改写成 `LATERAL` 子查询加 `LIMIT 1`，或在 `cpx_case_material` 上跑 `ANALYZE`。
- 一个案件同一 `doc_type` 可能有多份资料（多期流水、分卷上传），`current_version_count` 会大于 1。M05 的守卫语义是"全部当前版本均为 `VERIFIED`"，即 `verified_version_count = current_version_count`；只核验一部分时停在该资料项自己的 `PARSED`，界面显示"n/m 已核验"。这一点必须在实现守卫时确认口径，否则会把部分核验当成全部核验。
- **`status` 与文档版本可能不一致**（`status = 'VERIFIED'` 但某个当前版本被新上传替代）：这是落库状态机的固有风险，由 M03/M05 的写入路径保证"文件变更即回退资料项状态"，并由每日巡检核对。V1.0 的实时推导没有这个风险，但也无法表达 `REJECTED` 与 `WAIVED` 两个真实状态——两害取其一，选了可表达。
- 该查询禁止在循环里逐条执行（每材料一次查询 = 20 次往返）。必须一次取回整张清单，在 Java 侧组装守卫结果。

### Q4 待复核任务列表（复核工作台）

```sql
select t.id, t.target_type, t.target_id, t.is_self_review, t.submitted_at
from cpx_review_task t
where t.assignee_user_id = :userId
  and t.status in ('PENDING','IN_PROGRESS')
order by t.submitted_at asc
limit 20;
```

执行计划关注点：走 `idx_review_task_assignee (assignee_user_id, status)`；`status in (...)` 有两个值，规划器可能选 Bitmap Index Scan + Sort，数据量小时可接受。若 `Sort` 成本占比超过 50%，把索引改为 `(assignee_user_id, status, submitted_at)`，让排序也走索引。

---

## 十、与前置文档的偏差（需明确记录）

### 10.1 V1.0 已记录的六项（保留）

| 项 | 前置文档写法 | 本文写法 | 理由 |
|---|---|---|---|
| `sha256` 归属 | DOMAIN 3.4 放在 `Document` 上 | 放 `cpx_document_version` | 多版本哈希各不相同，放文档只能存最新一次，去重会漏 |
| `verificationState` 归属 | DOMAIN 3.4 放在 `Document` 上 | 放 `cpx_document_version` | `SUPERSEDED` 本质是版本级状态；放文档上会导致"当前版本被替代"与"文档状态"两套语义打架 |
| `dataScopes` | DOMAIN 3.3 作为聚合内集合属性 | 独立表 `cpx_case_authorization_scope` | 需要 EXCLUDE 约束保证区间不重叠，`jsonb` 数组做不到 |
| 报告交付记录 | DOMAIN 3.11 要求记录交付五要素 | 列在 `cpx_report_version` 上，不单独建表 | 一版本一次交付，重发记审计；单独建表只增加 join 成本 |
| `updated_at` 维护 | 未指定 | 统一触发器 | 覆盖 MyBatis 拦截器管不到的手工修数路径 |
| 指标值存储 | A-02 规定金额与比率两类精度 | 三列互斥 + CHECK | 单一 `numeric` 无法同时满足 18,2 与 10,6 |

以上六项都属实现层细化，不改变任何业务不变量。

### 10.2 V1.1 新增的偏差与冲突处理

| # | 项 | 冲突点 | 本设计的选择 | 理由 / 代价 |
|---|---|---|---|---|
| 1 | 案件状态 | ER V1.0 的 `status` 有 18 个取值，与 workflow §3.1 的 10 个取值直接冲突 | 改名 `lifecycle`，换 10 值，旧 18 值按 3.1.1 映射 | 基线修正 2 的最高约束；旧值里 11 个在回答"轮次算到哪一步"，迁到 `cpx_analysis_round`。代价：迁移必须先建轮次再改案件列 |
| 2 | `cpx_report.status` | ER V1.0 把报告效力放在容器上，而 workflow §3.3 要求 `ReportVersion` 有独立状态机 | `status`/`issued_*`/`void_*` 下沉到 `cpx_report_version`，容器只留编号与模板 | 同案多版并存时容器级状态无法表达；且这是"一个字段表达多维度"的原型。代价：5 个列搬家，`uq_report_case_active` 失效 |
| 3 | `cpx_metric_snapshot.data_version` | 旧设计用 bigint 计数器，新模型需要可 join 的版本实体 | 删 bigint，改 `data_version_id uuid`（`cpx_financial_metric` 同） | 计数器无法 join，双轨必漂移。代价：查"最新指标"多一次 ACTIVE 版本查找 |
| 4 | `cpx_financing_case.data_version` | 与 `cpx_data_version.version_no` 语义重叠 | 删除，由 `uq_data_version_active` 部分唯一索引表达"当前版本" | 两套编号并存必然漂移。代价：守卫语句从读一列改为一次索引查找 |
| 5 | `cpx_case_material` 状态 | ER V1.0 与字典 V1.0 明确"清单项状态不落库，由文档实时推导"，而 workflow §3.4 给了 7 值状态机（含 `REJECTED`、`WAIVED`） | **改为落库**，新增 `status` 列，删除 `is_waived` 布尔 | `WAIVED` 是人的决定、`REJECTED` 是核验结论，两者都推不出来；`is_waived` 与 `status='WAIVED'` 两套表达会打架。代价：状态与文档版本之间需要一致性检查（M05 要求全部当前版本 `VERIFIED`，落库后必须由写入路径保证前置条件，不能再靠实时 join） |
| 6 | `document_version.verification_state` | ER V1.0 有 6 值（含 `PARSE_FAILED`），DOMAIN §5 与基线术语表是 5 值 | 采用 5 值，移除 `PARSE_FAILED` | 解析失败是**导入批次**的结果（`cpx_data_import.status='FAILED'`），不是文件的核验状态。一个文件可能解析失败后重试成功，把失败写进版本状态会让"UPLOADED→PARSE_FAILED→PARSED"这种非法迁移出现。**连带影响：workflow §3.4 的 M04 守卫文字（"当前版本无 `PARSE_FAILED`"）需改为"该版本无 `status='FAILED'` 的导入批次"**，见 10.3 |
| 7 | `cpx_risk_finding` 归属 | ER V1.0 是 `assessment` 的内部实体（`assessment_id NOT NULL`），DOMAIN §2 把 `RiskFinding` 列为聚合根 | 改挂 `round_no`，`assessment_id` 可空回填 | 风险事项由分析规则产出，早于评估；强制挂评估会导致"先建空评估"或评估重算时整组复制。代价：`finding_no` 唯一域改为 `(case_id, round_no, finding_no)` |
| 8 | `cpx_assessment.dimensions` 五维 | ER V1.0 与字典 V1.0 的维度含"偿债（debtService）""经营（operating）""现金流（cashFlow）" | 改为基线修正 1 的五维：资料完整性、数据可核验性、口径一致性、需求清晰度、待核实事项 | 旧五维直接违反"首期不评估偿债能力"。这是**必须改**的一项，不是优化。代价：已存在的评估 JSON 结构不兼容（当前无生产数据） |
| 9 | `cpx_evidence_ref.target_id` 类型 | DOMAIN §3.2 写 `targetId UUID` | `varchar(64)` | 报告条款类目标是 `{reportVersionId}#{clauseNo}` 复合键；且与 `cpx_data_quality_issue.target_id`、`cpx_review_task.target_id` 的既有写法保持一致 |
| 10 | 报告版本与轮次"一对一" | workflow §5.3 说"一对一"，§2 又说"同一轮可因笔误修订出第二版" | 用部分唯一 `(report_id, round_no) WHERE status <> 'VOID'` | 两句都成立才有正解：**一版只能挂一轮**（硬），**一轮可在旧版作废后出第二版**（软）。全量唯一会禁止笔误修订，无唯一则允许一轮多版并存互相矛盾 |

### 10.3 发现但本轮不解决的冲突（需产品/流程文档同步）

以下四项不是数据库能单方面拍板的，本文按"最不坏"的方式落地，但对立项文档的修订必须由产品侧确认：

| # | 冲突 | 现状落地 | 待谁确认 |
|---|---|---|---|
| 1 | workflow §3.4 的 M04 守卫引用 `PARSE_FAILED`，而领域模型与基线术语表只有 5 个核验状态 | 本文按 5 值落库，守卫改为查导入批次 `FAILED` | 产品侧修订 workflow §3.4 文字 |
| 2 | workflow §2 规定 `ReportVersion.roundNo` "非空且唯一"，§5.3 又允许同轮笔误修订 | 用部分唯一（`WHERE status <> 'VOID'`）实现 | 确认"唯一"是否仅指"未作废版本唯一" |
| 3 | 基线与领域模型要求"任何进入报告的数字都必须挂证据"，但**封面、免责声明、目录**这些固定文本没有可引用的来源 | 数据库不拦（`evidence_ref` 只约束"有引用时必须可校验"），由渲染器按段落类型（`BOILERPLATE`）豁免 | 需确认豁免白名单，否则渲染器会拒绝生成报告 |
| 4 | 客户要求删除数据（`OPEN-QUESTIONS` 未决项）与"L1 层永久保留"直接冲突 | 本文按永久保留落库，不设计删除通道 | 需法务口径：删除请求是否覆盖已签发报告的证据链 |

第 3 项值得多说一句：它是"渲染器拒绝渲染无证据数字"这条硬规则的唯一例外，而例外必须显式枚举，否则实现时一定有人为了跑通而把整份报告标成 `BOILERPLATE`。

---

## 十一、Flyway 脚本落地顺序

按依赖方向排，避免外键前向引用。每个版本号一个脚本，脚本内不写 `IF NOT EXISTS`（迁移失败应当报错，而不是静默跳过）。

| 版本 | 内容 |
|---|---|
| V1 | 扩展（`btree_gist`、`pg_trgm`）、`cpx_touch_updated_at()`、`cpx_audit_log_immutable()` |
| V2 | identity 域 5 表 |
| V3 | customer 域 2 表 + 种子角色/权限 |
| V4 | case 域 4 表 |
| V5 | authorization 域 2 表（含 EXCLUDE） |
| V6 | document 域 4 表 + 材料字典种子数据 |
| V7 | dataimport 域 2 表 |
| V8 | dataquality 域 1 表 |
| V9 | finance 域 5 表 |
| V10 | analysis 域 4 表 |
| V11 | assessment 域 2 表 |
| V12 | review 域 2 表 |
| V13 | report 域 2 表 |
| V14 | ai 域 3 表 |
| V15 | audit 分区父表 + 默认分区 + 未来 3 个月分区 |
| V16 | platform 域 2 表 + 字段字典种子 |
| V17 | 视图与统计函数（如 `v_case_active_overview`） |

**V1.1 追加的三个版本**（顺序不可交换，理由见下）：

| 版本 | 内容 | 为什么排在这里 |
|---|---|---|
| V18 | E 域 3 表（`cpx_data_version`、`cpx_data_version_member`、`cpx_evidence_ref`）+ `cpx_verification_item` + 全部索引与 CHECK + `trg_round_bind_immutable()` 函数 | 它们不依赖任何被改造的列，先建可以先回填 |
| V19 | `cpx_analysis_round` 建表 + 既有表 ALTER：`cpx_financing_case`（改名/新增/删 `data_version`）、`cpx_case_material`（`status`）、`cpx_financial_metric`（`data_version_id`）、`cpx_metric_snapshot`（`round_no`、`data_version_id`）、`cpx_assessment`（`round_no`、`is_current` 索引域）、`cpx_risk_finding`（`case_id`、`round_no`、`assessment_id` 可空）、`cpx_report`（删 5 列）、`cpx_report_version`（`case_id`、`round_no`、`status` 等）、`cpx_document_version`（CHECK 5 值）、`cpx_data_import_record`（`purged_at`） | 必须晚于 V18：`analysis_round.data_version_id` 要引用 V18 建的版本表；`metric.data_version_id` 回填要能查到版本行 |
| V20 | 两条跨表触发器（`trg_report_version_closed_round`）、巡检视图与函数、审计动作码种子 | 必须晚于 V19：触发器要读 `cpx_report_version.round_no`，该列在 V19 才存在 |

**V1–V17 与 V18–V20 的关系**：V1–V17 是"按 V1.0 定义建库"的历史脚本。两种落地方式都允许，但必须产出一致的 schema：

| 路径 | 做法 | 适用 |
|---|---|---|
| 干净库（推荐） | 直接把 V1–V17 的建表语句改写成 V1.1 定义，V18–V20 只跑触发器与索引 | 新环境 |
| 增量库 | 保留 V1–V17 原样，依次执行 V18–V20 | 已有测试环境、以及"历史脚本不可改动"的合规要求 |

两条路径的产物用 `ddl-lint` 比对（表、列、约束、索引、触发器五个维度全量 diff），任何差异视为迁移失败。**不写 `IF NOT EXISTS`**：迁移失败应当报错，而不是静默跳过一半。

若库中已有业务数据，V19 之前必须先跑 3.1.1 的 18→10 映射脚本，且**先建轮次、回填 `round_no`、再改案件列**。顺序反了，旧值里 11 个"轮次进度"取值对应的信息会直接丢失，且无法从任何地方重建。

种子数据（角色、权限点、材料字典、字段字典）与 DDL 分开放在 `R__` 可重复迁移脚本中，避免每次改字典都要新增版本号。

---

## 十二、V1.1 变更记录

修订依据：`docs/product/product-baseline-v1.md` V1.0（修正 1 / 2 / 3）、`financing-domain-model.md`（六域 + 证据域、20 条不变量）、`financing-workflow.md` V2.0（五个状态机）。
修订方式：增量修改，不重写。V1.0 的 41 张表、索引原则、分区策略、命名规范、敏感分级全部保留；表总数 41 → 46。

### 12.1 新增表（5）

| 表 | 域 | 主键 | 章节 | 解决什么问题 |
|---|---|---|---|---|
| `cpx_data_version` | E | U | 3.13 | 数据版本从术语变成实体；`digest` 唯一约束兜住 INV-19 |
| `cpx_data_version_member` | E | C | 3.14 | 回答"这一版数据由哪些文件构成"，让 `digest` 可复算 |
| `cpx_evidence_ref` | E | B | 3.16 | 证据链的物理落点；基线修正 3 的承载表 |
| `cpx_analysis_round` | D4 | U | 3.15 | 轮次成为聚合根，报告得以说清"基于哪一轮" |
| `cpx_verification_item` | D4 | U | 3.17 | 待核实事项与质量检查项分开，`OPEN` 可跨轮继承 |

### 12.2 修改的表（10）

| 表 | 改动 | 影响 |
|---|---|---|
| `cpx_financing_case` | `status`→`lifecycle`（10 值）；`archived_at`→`closed_at`；`status_entered_at`→`lifecycle_entered_at`；新增 `hold_from`、`previous_case_no`、`closing_note`；删除 `data_version` | 约束与 5 个索引重建；旧 18 值需映射 |
| `cpx_case_material` | 新增 `status`（7 值）、`status_entered_at`；删除 `is_waived` | 从"实时推导"改为"落库状态机"，`ck_case_material_waiver` 改判据 |
| `cpx_financial_metric` | 新增 `data_version_id`；删除 `data_version`；`uq_financial_metric_current` 加 `data_version_id` | 多轮重算不再撞唯一键 |
| `cpx_metric_snapshot` | 新增 `round_no`、`data_version_id`；删除 `data_version`；新增 `idx_metric_snapshot_round` | 需按 3.8 的三步顺序写入（与轮次互引） |
| `cpx_assessment` | 新增 `round_no`；`is_current` 唯一域改 `(case_id, round_no)`；`dimensions` 五维重定义；新增 `uq_assessment_id_round` | 旧五维含偿债维度，不兼容旧 JSON |
| `cpx_risk_finding` | 新增 `case_id`、`round_no`；`assessment_id` 改可空；`finding_no` 唯一域改 `(case_id, round_no, finding_no)` | 从 assessment 内部实体变为挂轮次的聚合根 |
| `cpx_report` | 删除 `status`、`issued_at`、`issued_by`、`voided_at`、`void_reason`；`uq_report_case_active` 改 `uq_report_case (case_id)` | 状态下沉到版本；容器只管编号与模板 |
| `cpx_report_version` | 新增 `case_id`、`round_no`、`status`、`issued_at`、`issued_by`、`voided_at`、`void_reason`、`replacement_version_no`、`content_hash`、`evidence_check_result` | 成为报告生命周期的真正承载者；新增 3 条 CHECK 与 2 条唯一索引 |
| `cpx_document_version` | `ck_document_version_state` 移除 `PARSE_FAILED`（6 → 5 值） | 与领域模型一致；解析失败改由导入批次表达 |
| `cpx_data_import_record` | 新增 `purged_at` | L3 层清理后仍能区分"空行"与"已清理" |

其中 9 张是结构性修改（改/删/新增业务列），`cpx_data_import_record` 只加了一个清理标记列。

### 12.3 重写的章节

| 章节 | 变化 | 原因 |
|---|---|---|
| 七、追溯链设计 | 全章重写：单线改为"结构链 + 证据链"双链，新增 7.4 多态引用论证、7.5 五类巡检 SQL、7.6 验证 SQL | 旧链无法回答"基于哪一轮、哪一版数据"，基线修正 3 要求证据链是底层能力 |
| 8.1、8.3 | 保留期矩阵改为四级分层；明确数据版本 / 轮次 / 证据引用均随报告永久保留 | 原矩阵按表罗列，缺"为什么"；清理边界需要一句可执行的判据 |

### 12.4 新增的约束与触发器

| 对象 | 类型 | 表达的不变量 |
|---|---|---|
| `uq_data_version_digest` | 唯一索引 | INV-19：digest 相同不得产生新版本 |
| `uq_data_version_active` | 部分唯一索引 | 每案任一时刻只有一个当前数据版本（替代 `case.data_version` 计数器） |
| `uq_analysis_round_data_version` | 唯一索引 | 一个数据版本只开一轮（G-R1 幂等） |
| `uq_report_version_round` | 部分唯一索引 | 一版只挂一轮；同轮再出版本前须作废旧版 |
| `uq_evidence_ref_unique` | 唯一索引（`NULLS NOT DISTINCT`） | 同一目标同一来源同一位置只挂一条证据 |
| `uq_verification_item_root` | 唯一索引 | 同一轮同一疑问至多一条（跨轮继承的落点） |
| `trg_round_bind_immutable` | 触发器 | INV-06：轮次绑定的数据版本不可变 |
| `trg_report_version_closed_round` | 触发器 | 报告版本只能引用 `CLOSED` 轮次（应用层守卫 + 触发器兜底双层） |

### 12.5 明确未改动的部分

- 所有命名规范、类型基线、审计字段、软删除规则（1.1–1.8）不变。
- `cpx_audit_log` 的分区与哈希链方案（5.2–5.5）不变；只新增 5.6 说明证据表为何不分区。
- 授权域、导入域、AI 域、平台支撑域的表结构不变。
- `cpx_metric_source` 的三列可空外键写法不变——它是"封闭枚举 + 真实外键"的正面例子，`cpx_evidence_ref` 是"开放枚举 + 三层校验"的反面例子，两者并存是刻意的。

### 12.6 遗留问题（本轮不解决）

| # | 问题 | 影响面 | 建议处理 |
|---|---|---|---|
| 1 | 客户数据删除请求与 L1 层永久保留冲突 | 报告与证据链 | 需法务口径，见 10.3 #4 |
| 2 | 固定文本（封面/免责声明）无证据可挂，与"无证据不渲染"冲突 | 渲染器 | 需产品确认豁免白名单，见 10.3 #3 |
| 3 | workflow §3.4 的 M04 守卫仍写 `PARSE_FAILED` | 流程文档 | 产品侧修订为"导入批次 `FAILED`" |
| 4 | 报告版本"与轮次一对一"的两种口径 | 唯一索引语义 | 已按部分唯一实现，待产品确认 |
| 5 | 单人场景下"复核人 ≠ 提交人"的落地 | `selfReviewed` 披露 | 沿用 V1.0 的 `ck_review_task_self`，不在本轮范围内 |
