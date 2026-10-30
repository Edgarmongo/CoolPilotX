# CPX-DB-02 数据字典（PostgreSQL 16）

- 编号：CPX-DB-02
- 版本：V1.1（与 `er-design.md` V1.1 同步）
- 前置：`ADR-001 工程基线`、`product-baseline-v1.md V1.0`、`financing-domain-model.md`、`financing-workflow.md`、`CPX-DB-01 数据库设计`
- 覆盖：46 张表、全部字段（V1.0 的 41 张 + V1.1 新增 5 张）。与 `er-design.md` 冲突时以本文为准
- 用途：写 Flyway 脚本、写 MyBatis 映射、写接口契约时唯一对照表

「来源」列缩写：`UI` 界面录入 · `SYS` 系统生成 · `IMP` 解析导入 · `AI` AI 建议（经人工确认后由 Java 写入） · `CALC` Java 计算 · `DERIVE` 同事务由关联对象派生 · `JOB` 定时任务

「空」列：`N` 非空，`Y` 可空。

V1.1 的五个新表集中在第十六节，既有表的字段增量直接改在原表中并标注「V1.1」，全部改动见第二十二节「V1.1 变更记录」。

---

## 一、identity 用户权限域

### 1.1 `cpx_user` 用户

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | 用户标识 | SYS | 否 |
| username | varchar(64) | N | — | UNIQUE `(username) WHERE deleted_at IS NULL`；`~ '^[a-z0-9_.-]{3,64}$'` | 登录名，小写 | UI | 否 |
| display_name | varchar(64) | N | — | — | 显示名 | UI | 否 |
| email | varchar(128) | Y | — | `~ '^[^@\s]+@[^@\s]+$'` | 邮箱，用于通知 | UI | 否 |
| password_hash | varchar(100) | N | — | — | BCrypt 哈希 | SYS | 是（不可逆，禁止任何接口返回） |
| status | varchar(16) | N | `'ACTIVE'` | CHECK `ACTIVE/DISABLED/LOCKED` | 账号状态 | UI | 否 |
| failed_login_count | integer | N | `0` | CHECK `>= 0` | 连续登录失败次数 | SYS | 否 |
| locked_until | timestamptz | Y | — | — | 锁定截止，空表示未锁 | SYS | 否 |
| last_login_at | timestamptz | Y | — | — | 最近成功登录 | SYS | 否 |
| password_changed_at | timestamptz | Y | — | — | 改密时间，用于强制轮换 | SYS | 否 |
| must_change_password | boolean | N | `true` | — | 首登强制改密 | SYS | 否 |
| deleted_at | timestamptz | Y | — | — | 软删除 | UI | 否 |
| created_at | timestamptz | N | `now()` | — | 创建时间 | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器维护 | 更新时间 | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | 创建人 | SYS | 否 |
| updated_by | uuid | Y | — | 无外键 | 更新人 | SYS | 否 |

### 1.2 `cpx_role` 角色

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| code | varchar(32) | N | — | UNIQUE；CHECK `ADMIN/REVIEWER/VIEWER/SYSTEM` | 角色码，与 BIZ-01 第五节一致 | SYS | 否 |
| name | varchar(64) | N | — | — | 中文名 | SYS | 否 |
| description | varchar(200) | Y | — | — | 职责说明 | SYS | 否 |
| is_system | boolean | N | `false` | — | 内置角色，禁止删除 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |

### 1.3 `cpx_permission` 权限点

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| code | varchar(64) | N | — | UNIQUE；`~ '^[A-Z_]+:[A-Z_]+$'` | 权限码，如 `CASE:SUBMIT` | SYS | 否 |
| name | varchar(64) | N | — | — | 中文名 | SYS | 否 |
| module | varchar(32) | N | — | — | 所属模块，如 `case` | SYS | 否 |
| action | varchar(32) | N | — | — | 动作，如 `submit` | SYS | 否 |
| description | varchar(200) | Y | — | — | — | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

### 1.4 `cpx_user_role` 用户角色关联

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| user_id | uuid | N | — | PK 之一，FK → `cpx_user(id)` | 用户 | UI | 否 |
| role_id | uuid | N | — | PK 之一，FK → `cpx_role(id)` | 角色 | UI | 否 |
| granted_by | uuid | Y | — | 无外键 | 授予人 | SYS | 否 |
| granted_at | timestamptz | N | `now()` | — | 授予时间 | SYS | 否 |

### 1.5 `cpx_role_permission` 角色权限关联

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| role_id | uuid | N | — | PK 之一，FK → `cpx_role(id)` | 角色 | SYS | 否 |
| permission_id | uuid | N | — | PK 之一，FK → `cpx_permission(id)` | 权限点 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

---

## 二、customer 客户域

### 2.1 `cpx_customer` 企业客户

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | 客户标识 | SYS | 否 |
| customer_no | varchar(32) | N | — | UNIQUE `(customer_no) WHERE deleted_at IS NULL` | 客户编号 `CUS-000123` | SYS | 否 |
| legal_name | varchar(200) | N | — | — | 企业全称（工商登记名） | UI | 否 |
| unified_credit_code | char(18) | N | — | UNIQUE `WHERE deleted_at IS NULL`；`~ '^[0-9A-HJ-NPQRTUWXY]{18}$'` | 统一社会信用代码 | UI | 否（公示信息） |
| legal_representative | varchar(50) | Y | — | — | 法定代表人姓名 | UI | 是（个人信息，仅展示） |
| established_on | date | Y | — | — | 成立日期 | UI | 否 |
| registered_capital_amount | numeric(18,2) | Y | — | CHECK `>= 0` | 注册资本（元） | UI | 否 |
| industry_code | varchar(16) | Y | — | — | 国标行业代码 | UI | 否 |
| industry_name | varchar(64) | Y | — | — | 行业名称 | UI | 否 |
| region_code | varchar(12) | Y | — | — | 行政区划代码 | UI | 否 |
| address | varchar(300) | Y | — | — | 经营地址 | UI | 是（含精确门牌，列表页只显示到区） |
| status | varchar(16) | N | `'ACTIVE'` | CHECK `ACTIVE/INACTIVE` | 合作状态 | UI | 否 |
| remark | varchar(1000) | Y | — | — | 备注 | UI | 否 |
| deleted_at | timestamptz | Y | — | — | 软删除 | UI | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |
| updated_by | uuid | Y | — | 无外键 | — | SYS | 否 |

### 2.2 `cpx_contact` 联系人

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| customer_id | uuid | N | — | FK → `cpx_customer(id)` | 所属客户 | UI | 否 |
| name | varchar(50) | N | — | — | 姓名 | UI | 是（个人信息） |
| title | varchar(50) | Y | — | — | 职务 | UI | 否 |
| mobile_ciphertext | bytea | Y | — | — | 手机号密文（AES-256-GCM） | UI | 是 |
| mobile_last4 | char(4) | Y | — | `~ '^[0-9]{4}$'` | 手机号后四位 | DERIVE | 是 |
| mobile_hash | char(64) | Y | — | `~ '^[0-9a-f]{64}$'` | 手机号 HMAC-SHA256，用于查重 | DERIVE | 是 |
| email | varchar(128) | Y | — | — | 邮箱 | UI | 是 |
| is_primary | boolean | N | `false` | 部分唯一 `(customer_id) WHERE is_primary AND deleted_at IS NULL` | 主联系人 | UI | 否 |
| note | varchar(500) | Y | — | — | 备注 | UI | 否 |
| deleted_at | timestamptz | Y | — | — | 软删除 | UI | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |

---

## 三、case 案件域

### 3.1 `cpx_financing_case` 融资案件

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | 案件标识 | SYS | 否 |
| case_no | varchar(32) | N | — | UNIQUE；`~ '^CPX-[0-9]{4}-[0-9]{4}$'`；不可变 | 业务编号 `CPX-2026-0001` | SYS | 否 |
| customer_id | uuid | N | — | FK → `cpx_customer(id)` | 归属客户 | UI | 否 |
| customer_name_snapshot | varchar(200) | N | — | — | 立案时企业全称快照 | DERIVE | 否 |
| owner_user_id | uuid | N | — | FK → `cpx_user(id)` | 案件负责人 | UI | 否 |
| lifecycle | varchar(32) | N | `'INTAKE'` | CHECK 10 值，见 17.1；原列名 `status`（V1.1 改名） | 案件生命周期 | SYS | 否 |
| lifecycle_entered_at | timestamptz | N | `now()` | — | 当前生命周期进入时间（原 `status_entered_at`） | SYS | 否 |
| hold_from | varchar(32) | Y | — | CHECK 7 值或 NULL；`lifecycle = 'ON_HOLD'` 时必填 | 挂起前的状态，C12 恢复的目标 | SYS | 否 |
| previous_case_no | varchar(32) | Y | — | FK → `cpx_financing_case(case_no)`；`~ '^CPX-[0-9]{4}-[0-9]{4}$'`；`<> case_no` | 续做时承接的原案编号 | UI | 否 |
| version | integer | N | `0` | CHECK `>= 0` | 乐观锁版本 | SYS | 否 |
| submitted_at | timestamptz | Y | — | — | C02 提交受理时间 | SYS | 否 |
| delivered_at | timestamptz | Y | — | — | C09 交付时间 | SYS | 否 |
| closed_at | timestamptz | Y | — | `lifecycle = 'CLOSED'` 时非空 | C10 关闭时间（原 `archived_at`） | SYS | 否 |
| closing_note | varchar(500) | Y | — | — | 关闭说明；仍有 OPEN 的 HIGH 待核实事项时填写（G-C6，提示不阻塞） | UI | 否 |
| retention_until | date | Y | — | — | 资料保留到期日 | JOB | 否 |
| terminated_reason | varchar(500) | Y | — | `WITHDRAWN`/`DECLINED` 时非空 | 撤回 / 不予服务理由 | UI | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |
| updated_by | uuid | Y | — | 无外键 | — | SYS | 否 |

### 3.2 `cpx_financing_requirement` 融资需求（版本链）

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| version_no | integer | N | — | UNIQUE `(case_id, version_no)`；CHECK `> 0` | 需求版本号，从 1 起 | SYS | 否 |
| is_current | boolean | N | `true` | 部分唯一 `(case_id) WHERE is_current` | 是否当前版本 | SYS | 否 |
| financing_type | varchar(32) | N | — | CHECK 6 值，见 17.2 | 融资品种 | UI | 否 |
| purpose | varchar(500) | Y | — | — | 资金用途 | UI | 否 |
| financing_amount | numeric(18,2) | N | `0` | CHECK `>= 0` | 申请金额（元） | UI | 是（商业敏感） |
| term_months | integer | Y | — | CHECK `> 0` | 期限（月） | UI | 否 |
| funding_gap_amount | numeric(18,2) | Y | — | CHECK `>= 0` | 资金缺口（元） | UI | 是（商业敏感） |
| existing_financing_amount | numeric(18,2) | Y | — | CHECK `>= 0` | 现有融资余额（元） | UI | 是（征信相关） |
| repayment_source | varchar(500) | Y | — | — | 还款来源说明 | UI | 否 |
| expected_drawdown_on | date | Y | — | — | 预计提款日 | UI | 否 |
| change_reason | varchar(500) | Y | — | `version_no > 1` 时必填 | 变更原因 | UI | 否 |
| changed_by | uuid | Y | — | 无外键 | 变更人 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |

### 3.3 `cpx_case_status_event` 状态流转事件

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| seq_no | integer | N | — | UNIQUE `(case_id, seq_no)`；CHECK `> 0` | 案件内序号，从 1 起 | SYS | 否 |
| from_status | varchar(32) | Y | — | CHECK 10 值或 NULL（创建时为 NULL） | 来源生命周期状态 | SYS | 否 |
| to_status | varchar(32) | N | — | CHECK 10 值（同 `ck_financing_case_lifecycle`） | 目标生命周期状态 | SYS | 否 |
| transition_code | varchar(8) | N | — | `~ '^(C(0[1-9]|1[0-4])|R0[1-7]|P0[1-9]|M0[1-9]|V0[1-6])$'` | 动作号，对应 workflow 五张转换表（C*/R*/P*/M*/V*） | SYS | 否 |
| action_name | varchar(64) | N | — | — | 动作名，如"提交复核" | SYS | 否 |
| actor_type | varchar(8) | N | — | CHECK `USER/SYSTEM` | 操作者类型 | SYS | 否 |
| actor_user_id | uuid | Y | — | 无外键；`USER` 时必填 | 操作者 | SYS | 否 |
| reason | varchar(500) | Y | — | 退回/撤回/不予服务/挂起/恢复时必填 | 原因 | UI | 否 |
| guard_code | varchar(16) | Y | — | `~ '^(G-C[1-7]|G-R[1-5]|G-P[1-6]|M0[1-9]|V0[1-6])$'` | 守卫编号（V1.1 随五状态机改命名，长度 8 → 16） | SYS | 否 |
| guard_passed | boolean | Y | — | — | 守卫结果 | SYS | 否 |
| guard_result | jsonb | Y | — | — | 结构化阻断项（BIZ-01 7.3） | SYS | 否 |
| occurred_at | timestamptz | N | `now()` | — | 发生时间 | SYS | 否 |
| trace_id | varchar(64) | Y | — | — | 链路 ID | SYS | 否 |

### 3.4 `cpx_case_material` 案件材料清单实例

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| material_code | varchar(64) | N | — | UNIQUE `(case_id, material_code)` | 材料编码 | DERIVE | 否 |
| material_name | varchar(200) | N | — | — | 材料名快照（字典可改名） | DERIVE | 否 |
| requirement_level | varchar(16) | N | — | CHECK `REQUIRED/CONDITIONAL/OPTIONAL` | 要求级别快照 | DERIVE | 否 |
| data_scope | varchar(32) | Y | — | CHECK 5 值或 NULL | 对应数据范围 | DERIVE | 否 |
| applies_reason | varchar(200) | Y | — | — | CONDITIONAL 项的适用理由 | SYS | 否 |
| status | varchar(32) | N | `'REQUIRED'` | CHECK 7 值，见 17.2（V1.1 新增） | 资料项状态（M01–M09 状态机） | SYS | 否 |
| status_entered_at | timestamptz | N | `now()` | — | 当前状态进入时间，用于"停滞 N 天"提示（V1.1 新增） | SYS | 否 |
| waiver_reason | varchar(500) | Y | — | `status = 'WAIVED'` 时必填 | 豁免理由 | UI | 否 |
| waived_by | uuid | Y | — | 无外键；`status = 'WAIVED'` 时必填 | 豁免人 | SYS | 否 |
| waived_at | timestamptz | Y | — | `status = 'WAIVED'` 时必填 | 豁免时间 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |

**V1.1 把状态改为落库，并删除了 `is_waived` 布尔列。** 原设计认为清单项状态可由 `cpx_document` + `cpx_document_version` 实时推导，理由是"落库必然漂移"。这个理由在只有 6 个推导得出来的状态时成立，但 workflow §3.4 的状态机有两个状态**推不出来**：`REJECTED`（核验人退回，是人的决定，不是文件状态）与 `WAIVED`（豁免，是批准行为）。用 `is_waived` 布尔补一个状态，结果是同一维度存在两种表达（`is_waived` 与"文件被退回"），守卫要判两处。

改为落库后的代价必须明说：`status` 与文档版本状态之间可能不一致（例如 `status = 'VERIFIED'` 后有人补传了新版本）。补偿手段是三条——M03（收到文件）与 M05（核验通过）的写入路径必须在同一事务内改状态；文件变更即把资料项退回 `RECEIVED`；每日巡检核对"`status = 'VERIFIED'` 但存在未核验的当前版本"的行。

---

## 四、authorization 授权域

### 4.1 `cpx_case_authorization` 案件授权

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | UI | 否 |
| authorization_no | varchar(32) | N | — | UNIQUE | 授权编号 | SYS | 否 |
| purpose | varchar(500) | N | — | — | 处理目的，必须写明用于本次融资准备 | UI | 否 |
| valid_from | date | N | — | — | 生效日 | UI | 否 |
| valid_to | date | N | — | CHECK `>= valid_from` | 失效日 | UI | 否 |
| granted_by_name | varchar(100) | N | — | — | 客户方授权签署人 | UI | 是（个人信息） |
| granted_by_user_id | uuid | N | — | FK → `cpx_user(id)` | 我方登记人 | SYS | 否 |
| granted_at | timestamptz | N | `now()` | — | 登记时间 | SYS | 否 |
| revoked_at | timestamptz | Y | — | — | 撤销时间 | UI | 否 |
| revoke_reason | varchar(500) | Y | — | 撤销时必填 | 撤销原因 | UI | 否 |
| evidence_document_id | uuid | Y | — | FK → `cpx_document(id)` | 授权书原件 | UI | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |

### 4.2 `cpx_case_authorization_scope` 授权数据范围

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| authorization_id | uuid | N | — | PK 之一，FK → `cpx_case_authorization(id)` | 授权 | DERIVE | 否 |
| data_scope | varchar(32) | N | — | PK 之一，CHECK 5 值 | 数据范围 | UI | 否 |
| case_id | uuid | N | — | 反规范化，供 EXCLUDE 使用 | 所属案件 | DERIVE | 否 |
| valid_from | date | N | — | 与主表同值 | 生效日 | DERIVE | 否 |
| valid_to | date | N | — | 与主表同值 | 失效日 | DERIVE | 否 |
| revoked_at | timestamptz | Y | — | 与主表同值 | 撤销时间 | DERIVE | 否 |

约束 `ex_auth_scope_no_overlap`：`case_id`、`data_scope` 相同且 `daterange(valid_from, valid_to, '[]')` 重叠、`revoked_at IS NULL` 的行不允许并存。

---

## 五、document 资料域

### 5.1 `cpx_material_requirement` 材料清单字典

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| material_code | varchar(64) | N | — | UNIQUE | 材料编码，如 `BANK_STATEMENT_12M` | SYS | 否 |
| material_name | varchar(200) | N | — | — | 材料名称 | SYS | 否 |
| doc_type | varchar(64) | N | — | — | 对应文档类型码 | SYS | 否 |
| requirement_level | varchar(16) | N | — | CHECK `REQUIRED/CONDITIONAL/OPTIONAL` | 要求级别 | SYS | 否 |
| data_scope | varchar(32) | N | — | CHECK 5 值 | 涉及数据范围，决定授权拦截 | SYS | 否 |
| financing_type | varchar(32) | Y | — | 空表示适用全部 | 适用融资品种 | SYS | 否 |
| sort_no | integer | N | `0` | — | 清单展示顺序 | SYS | 否 |
| description | varchar(500) | Y | — | — | 获取说明 | SYS | 否 |
| is_active | boolean | N | `true` | — | 停用后不参与新案件 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |

### 5.2 `cpx_document` 资料文档

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | UI | 否 |
| doc_type | varchar(64) | N | — | 无 CHECK（字典可扩展） | 资料类型码 | UI | 否 |
| title | varchar(200) | N | — | — | 展示标题 | UI | 否 |
| period_label | varchar(16) | Y | — | — | 覆盖期间，如 `2025-01` | UI | 否 |
| data_scope | varchar(32) | Y | — | CHECK 5 值或 NULL | 涉及数据范围 | DERIVE | 否 |
| current_version_id | uuid | Y | — | FK → `cpx_document_version(id)` | 当前版本 | DERIVE | 否 |
| deleted_at | timestamptz | Y | — | 仅 `UPLOADED` 可置 | 软删除 | UI | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |
| updated_by | uuid | Y | — | 无外键 | — | SYS | 否 |

### 5.3 `cpx_document_version` 文档版本

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| document_id | uuid | N | — | FK → `cpx_document(id)` | 所属文档 | SYS | 否 |
| version_no | integer | N | — | UNIQUE `(document_id, version_no)`；CHECK `> 0` | 版本号，从 1 起 | SYS | 否 |
| storage_key | varchar(500) | N | — | UNIQUE | 存储键，归档后为 `archived://...` | SYS | 否 |
| original_filename | varchar(255) | N | — | — | 原始文件名，仅展示，禁止拼接路径 | UI | 否 |
| mime_type | varchar(128) | Y | — | — | MIME 类型 | SYS | 否 |
| file_size_bytes | bigint | N | — | CHECK `> 0` | 字节数 | SYS | 否 |
| sha256 | char(64) | N | — | `~ '^[0-9a-f]{64}$'` | 内容哈希 | SYS | 否 |
| page_count | integer | Y | — | CHECK `> 0` | PDF 页数 | IMP | 否 |
| verification_state | varchar(32) | N | `'UPLOADED'` | CHECK 5 值，见 17.2 节枚举（V1.1 移除 `PARSE_FAILED`） | 核验状态 | SYS | 否 |
| uploaded_by | uuid | Y | — | 无外键 | 上传人 | SYS | 否 |
| uploaded_at | timestamptz | N | `now()` | — | 上传时间 | SYS | 否 |
| superseded_at | timestamptz | Y | — | — | 被替代时间 | SYS | 否 |
| purged_at | timestamptz | Y | — | — | 二进制按保留期清除时间 | JOB | 否 |
| deleted_at | timestamptz | Y | — | 仅 `UPLOADED` 可置 | 软删除 | UI | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |

**V1.1 移除 `PARSE_FAILED`。** 文件的核验状态只有 5 个，与领域模型 §5 一致；"解析失败"是**导入批次**的结果（`cpx_data_import.status = 'FAILED'` + `error_message`），不是文件的属性。同一个文件版本解析失败后重试成功时，若把失败写进 `verification_state`，就会出现 `UPLOADED → PARSE_FAILED → PARSED` 这种状态机之外的迁移。workflow §3.4 的 M04 守卫随之改为"该文件版本不存在 `FAILED` 的导入批次"。

### 5.4 `cpx_document_review` 资料核验记录

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| document_id | uuid | N | — | FK → `cpx_document(id)` | 文档 | DERIVE | 否 |
| document_version_id | uuid | N | — | FK → `cpx_document_version(id)` | 被核验版本 | SYS | 否 |
| reviewer_user_id | uuid | N | — | FK → `cpx_user(id)` | 核验人 | SYS | 否 |
| decision | varchar(16) | N | — | CHECK `VERIFY/REJECT` | 结论 | UI | 否 |
| reason_code | varchar(32) | Y | — | — | 退回原因码 | UI | 否 |
| comment | varchar(1000) | Y | — | — | 说明 | UI | 否 |
| reviewed_at | timestamptz | N | `now()` | — | 核验时间 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

---

## 六、dataimport 导入域

### 6.1 `cpx_data_import` 导入批次

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | 批次标识 | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| document_id | uuid | N | — | FK → `cpx_document(id)` | 来源文档 | SYS | 否 |
| document_version_id | uuid | N | — | FK → `cpx_document_version(id)` | 来源版本 | SYS | 否 |
| import_type | varchar(32) | N | — | CHECK 6 值 | 导入类型 | UI | 否 |
| status | varchar(16) | N | `'PENDING'` | CHECK 6 值 | 批次状态 | SYS | 否 |
| parser_type | varchar(16) | N | — | CHECK `RULE/AI/HYBRID` | 解析方式 | SYS | 否 |
| parser_version | varchar(32) | N | — | — | 解析器版本，可复现 | SYS | 否 |
| row_count | integer | N | `0` | CHECK `>= 0` | 总行数 | IMP | 否 |
| success_count | integer | N | `0` | CHECK `>= 0` | 成功行数 | IMP | 否 |
| failed_count | integer | N | `0` | CHECK `>= 0`；成功+失败 ≤ 总数 | 失败行数 | IMP | 否 |
| started_at | timestamptz | Y | — | — | 开始时间 | SYS | 否 |
| finished_at | timestamptz | Y | — | — | 结束时间 | SYS | 否 |
| confirmed_at | timestamptz | Y | — | — | 人工确认时间，确认后批次锁定 | SYS | 否 |
| confirmed_by | uuid | Y | — | 无外键 | 确认人 | SYS | 否 |
| error_message | varchar(1000) | Y | — | — | 失败摘要 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |

### 6.2 `cpx_data_import_record` 原始数据行

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK | — | SYS | 否 |
| import_id | uuid | N | — | FK → `cpx_data_import(id)` | 所属批次 | SYS | 否 |
| row_no | integer | N | — | UNIQUE `(import_id, row_no)`；CHECK `> 0` | 原始文件行号 | IMP | 否 |
| sheet_name | varchar(64) | Y | — | — | 工作表名 | IMP | 否 |
| raw_data | jsonb | N | — | — | 原始行键值（未清洗） | IMP | 是（原始材料内容） |
| parsed_data | jsonb | Y | — | — | 标准化后字段 | IMP | 是 |
| parse_status | varchar(16) | N | `'PARSED'` | CHECK `PARSED/FAILED/SKIPPED/DUPLICATE` | 行级解析结果 | IMP | 否 |
| error_message | varchar(500) | Y | — | — | 行级错误 | IMP | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| purged_at | timestamptz | Y | — | — | 内容按保留期清理的时刻（V1.1 新增）；非空即表示 `raw_data` / `parsed_data` 已清空 | JOB | 否 |

`raw_data` / `parsed_data` 中的账号、姓名、手机号在写入前必须脱敏（见第十八节）。原始材料本身不落库（A-10）。

保留期到期后（8.3），`raw_data := '{}'::jsonb`、`parsed_data := NULL`、`purged_at := now()`。**判定"这一行是否已清"只看 `purged_at`，不看内容是否为空**——`raw_data` 是 `NOT NULL`，空行本身也是 `{}`，两者必须可区分。

---

## 七、dataquality 质量域

### 7.1 `cpx_data_quality_issue` 数据质量问题

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| rule_code | varchar(32) | N | — | 无 CHECK，如 `DQ-REV-01` | 规则编号 | SYS | 否 |
| rule_version | varchar(16) | N | — | — | 规则版本 | SYS | 否 |
| severity | varchar(32) | N | — | CHECK `BLOCKER/MAJOR/MINOR/INFO` | 严重级别 | SYS | 否 |
| status | varchar(32) | N | `'OPEN'` | CHECK `OPEN/ACKNOWLEDGED/RESOLVED/WAIVED` | 处置状态 | SYS | 否 |
| title | varchar(200) | N | — | — | 问题标题 | SYS | 否 |
| detail | varchar(2000) | Y | — | — | 详细说明，禁止定性指控措辞 | SYS | 否 |
| dedupe_key | varchar(200) | N | — | 部分唯一 `(case_id, dedupe_key) WHERE status IN ('OPEN','ACKNOWLEDGED')` | 去重摘要 | SYS | 否 |
| target_type | varchar(32) | Y | — | CHECK `STATEMENT_ITEM/BANK_TXN/METRIC/DOCUMENT/DEBT` | 目标类型（多态） | SYS | 否 |
| target_id | varchar(64) | Y | — | 多态，无外键 | 目标标识 | SYS | 否 |
| evidence_refs | jsonb | N | `'[]'` | CHECK `jsonb_typeof = 'array'` | 证据引用 | SYS | 否 |
| resolution | varchar(1000) | Y | — | — | 处置说明 | UI | 否 |
| resolved_by | uuid | Y | — | 无外键 | 处置人 | SYS | 否 |
| resolved_at | timestamptz | Y | — | — | 处置时间 | SYS | 否 |
| waived_by | uuid | Y | — | 无外键；豁免时必填 | 豁免人 | SYS | 否 |
| waived_at | timestamptz | Y | — | 豁免时必填 | 豁免时间 | SYS | 否 |
| waiver_reason | varchar(1000) | Y | — | 豁免时必填 | 豁免理由 | UI | 否 |
| waiver_approved_by | uuid | Y | — | 无外键；豁免时必填 | 批准人 | SYS | 否 |
| detected_at | timestamptz | N | `now()` | — | 检出时间 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |

---

## 八、finance 财务域

### 8.1 `cpx_financial_statement` 财务报表

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| statement_type | varchar(32) | N | — | CHECK `BALANCE_SHEET/INCOME_STATEMENT/CASH_FLOW` | 报表类型 | UI | 否 |
| period_type | varchar(8) | N | — | CHECK `YEAR/QUARTER/MONTH/POINT/TTM` | 期间类型 | UI | 否 |
| data_period | varchar(10) | N | — | 部分唯一 `(case_id, statement_type, data_period) WHERE is_current` | 期间标签 | UI | 否 |
| currency | char(3) | N | `'CNY'` | — | 币种 | UI | 否 |
| amount_scale | integer | N | `1` | CHECK `1/1000/10000` | 金额单位倍率（元/千元/万元） | UI | 否 |
| import_id | uuid | N | — | FK → `cpx_data_import(id)` | 来源批次 | SYS | 否 |
| document_version_id | uuid | N | — | FK → `cpx_document_version(id)` | 来源文件版本 | DERIVE | 否 |
| version_no | integer | N | `1` | CHECK `> 0` | 重导产生的版本号 | SYS | 否 |
| is_current | boolean | N | `true` | — | 是否当前版本 | SYS | 否 |
| superseded_at | timestamptz | Y | — | — | 被替代时间 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |

### 8.2 `cpx_financial_statement_item` 报表科目明细

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK | — | SYS | 否 |
| statement_id | uuid | N | — | FK → `cpx_financial_statement(id)` | 所属报表 | SYS | 否 |
| item_code | varchar(32) | N | — | UNIQUE `(statement_id, item_code)` | 科目编码，如 `REVENUE` | IMP | 否 |
| item_name | varchar(100) | N | — | — | 科目名称 | IMP | 否 |
| item_level | smallint | N | `1` | CHECK `>= 1` | 层级，用于缩进渲染 | IMP | 否 |
| parent_item_code | varchar(32) | Y | — | 自引用科目编码 | 上级科目 | IMP | 否 |
| amount | numeric(18,2) | N | `0` | — | 本期金额（已按 `amount_scale` 归一为元） | IMP | 是（财务敏感） |
| is_subtotal | boolean | N | `false` | — | 是否为小计行 | IMP | 否 |
| sort_no | integer | N | `0` | — | 报表内顺序 | IMP | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

### 8.3 `cpx_financial_metric` 财务指标

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| metric_code | varchar(64) | N | — | 无 CHECK，见 17.3 metric_code 清单 | 指标编码 | CALC | 否 |
| period_type | varchar(8) | N | — | CHECK `YEAR/QUARTER/MONTH/POINT/TTM` | 期间类型 | CALC | 否 |
| data_period | varchar(10) | N | — | 部分唯一约束的一部分 | 期间标签 | CALC | 否 |
| value_amount | numeric(18,2) | Y | — | 与另两列互斥（`num_nonnulls = 1`） | 金额类指标值 | CALC | 是（财务敏感） |
| value_ratio | numeric(10,6) | Y | — | 同上 | 比率类指标值（0.012345） | CALC | 是 |
| value_days | integer | Y | — | 同上 | 天数类指标值 | CALC | 否 |
| unit | varchar(16) | N | — | CHECK `CNY/PERCENT/DAYS/TIMES` | 单位 | CALC | 否 |
| formula | varchar(1000) | N | — | — | 公式文本，可核验 | CALC | 否 |
| formula_version | varchar(16) | N | — | — | 公式版本 | CALC | 否 |
| data_version_id | uuid | N | — | FK → `cpx_data_version(id)`（V1.1 新增，替代原 `data_version bigint`） | 计算时所用的数据版本 | CALC | 否 |
| source_refs | jsonb | N | `'[]'` | — | 展示用来源摘要（真链在 `cpx_metric_source`） | CALC | 否 |
| computed_at | timestamptz | N | `now()` | — | 计算时间 | CALC | 否 |
| superseded_at | timestamptz | Y | — | — | 被重算替代时间 | SYS | 否 |
| superseded_by | uuid | Y | — | FK → `cpx_financial_metric(id)` | 替代它的新行 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | 计算触发人 | SYS | 否 |

**V1.1 的唯一约束变更**：当前值唯一索引从 `(case_id, metric_code, data_period, formula_version) WHERE superseded_at IS NULL` 改为 **`(case_id, data_version_id, metric_code, data_period, formula_version) WHERE superseded_at IS NULL`**。理由：多轮分析必然基于不同数据版本重算同一指标，旧索引会在第 2 轮重算时直接拒绝写入；而把旧行标 `superseded` 又会让第 1 轮报告失去"当前值"。加上 `data_version_id` 后语义变为"每案每数据版本每指标只保留一个当前值"。

### 8.4 `cpx_bank_transaction` 银行流水

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| import_id | uuid | N | — | FK → `cpx_data_import(id)` | 来源批次 | SYS | 否 |
| import_record_id | bigint | N | — | FK → `cpx_data_import_record(id)` | 来源行 | SYS | 否 |
| source_row_no | integer | Y | — | — | 原始文件行号 | DERIVE | 否 |
| txn_on | date | N | — | — | 交易日期 | IMP | 否 |
| direction | varchar(8) | N | — | CHECK `IN/OUT` | 借贷方向 | IMP | 否 |
| amount | numeric(18,2) | N | — | CHECK `> 0` | 发生额（正数，方向另存） | IMP | 是（财务敏感） |
| balance_after | numeric(18,2) | Y | — | — | 交易后余额 | IMP | 是（财务敏感） |
| currency | char(3) | N | `'CNY'` | — | 币种 | IMP | 否 |
| account_no_last4 | char(4) | Y | — | `~ '^[0-9]{4}$'` | 本方账号后四位 | IMP | 是 |
| account_no_hash | char(64) | Y | — | `~ '^[0-9a-f]{64}$'` | 本方账号 HMAC，用于同账户聚合 | DERIVE | 是 |
| counterparty_name | varchar(200) | Y | — | — | 对方户名 | IMP | 是（第三方信息） |
| counterparty_account_last4 | char(4) | Y | — | `~ '^[0-9]{4}$'` | 对方账号后四位 | IMP | 是 |
| summary | varchar(500) | Y | — | — | 摘要/用途 | IMP | 是（可能含个人信息） |
| category_code | varchar(32) | Y | — | 无 CHECK | 现金流分类码 | AI | 否 |
| category_source | varchar(16) | N | `'RULE'` | CHECK `RULE/AI/MANUAL` | 分类来源 | SYS | 否 |
| confirmed | boolean | N | `false` | CHECK 见 `er-design.md` 6.1 | 分类是否已人工确认 | UI | 否 |
| confirmed_by | uuid | Y | — | 无外键 | 确认人 | SYS | 否 |
| confirmed_at | timestamptz | Y | — | — | 确认时间 | SYS | 否 |
| dedupe_key | char(64) | N | — | UNIQUE `(case_id, dedupe_key)` | 去重摘要 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

`dedupe_key = sha256(txn_on|direction|amount|balance_after|counterparty_name|summary|source_row_no)`，同一案件内重复导入直接冲突。

### 8.5 `cpx_debt_record` 债务记录

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| lender_name | varchar(200) | N | — | — | 债权人/金融机构 | UI | 是（征信相关） |
| debt_type | varchar(16) | N | — | CHECK `LOAN/LEASE/FACTORING/BOND/OTHER` | 债务类型 | UI | 是 |
| contract_no | varchar(64) | Y | — | — | 合同编号 | UI | 是 |
| principal_amount | numeric(18,2) | N | — | CHECK `>= 0` | 本金（元） | UI | 是 |
| outstanding_amount | numeric(18,2) | N | — | CHECK `>= 0` 且 `<= principal_amount` | 余额（元） | UI | 是 |
| start_on | date | Y | — | — | 起始日 | UI | 是 |
| maturity_on | date | Y | — | — | 到期日 | UI | 是 |
| interest_ratio | numeric(10,6) | Y | — | CHECK `>= 0` | 年化利率（0.045000） | UI | 是 |
| repayment_method | varchar(32) | Y | — | — | 还款方式 | UI | 否 |
| guarantee_type | varchar(32) | Y | — | — | 担保方式 | UI | 是 |
| status | varchar(16) | N | `'ACTIVE'` | CHECK `ACTIVE/SETTLED/OVERDUE` | 存续状态 | UI | 是 |
| source_document_id | uuid | Y | — | FK → `cpx_document(id)` | 合同/对账单文件 | UI | 否 |
| source_import_record_id | bigint | Y | — | FK → `cpx_data_import_record(id)` | 债务清单原始行 | SYS | 否 |
| remark | varchar(500) | Y | — | — | 备注 | UI | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |

---

## 九、analysis 分析域

### 9.1 `cpx_metric_snapshot` 指标快照

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| snapshot_no | integer | N | — | UNIQUE `(case_id, snapshot_no)`；CHECK `> 0` | 案件内快照序号 | SYS | 否 |
| round_no | integer | N | — | 复合 FK `(case_id, round_no)` → `cpx_analysis_round(case_id, round_no)`（V1.1 新增） | 所属分析轮次 | SYS | 否 |
| data_version_id | uuid | N | — | FK → `cpx_data_version(id)`；复合 FK `(case_id, data_version_id)`（V1.1 新增，替代原 `data_version bigint`） | 生成时所用的数据版本 | SYS | 否 |
| metric_count | integer | N | `0` | CHECK `>= 0` | 指标行数 | SYS | 否 |
| digest | char(64) | N | — | `~ '^[0-9a-f]{64}$'` | 快照指纹 | SYS | 否 |
| locked | boolean | N | `false` | — | 是否已锁定（G-R3 依据） | UI | 否 |
| locked_at | timestamptz | Y | — | 锁定时必填 | 锁定时间 | SYS | 否 |
| locked_by | uuid | Y | — | 无外键 | 锁定人 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |

### 9.2 `cpx_metric_snapshot_item` 快照指标行

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK | — | SYS | 否 |
| snapshot_id | uuid | N | — | FK → `cpx_metric_snapshot(id)`；UNIQUE `(snapshot_id, metric_id)` | 快照 | SYS | 否 |
| metric_id | uuid | N | — | FK → `cpx_financial_metric(id)` | 原指标 | SYS | 否 |
| metric_code | varchar(64) | N | — | — | 指标编码副本 | DERIVE | 否 |
| period_type | varchar(8) | N | — | CHECK 5 值 | 期间类型副本 | DERIVE | 否 |
| data_period | varchar(10) | N | — | — | 期间标签副本 | DERIVE | 否 |
| value_amount | numeric(18,2) | Y | — | 与另两列互斥 | 冻结金额值 | DERIVE | 是 |
| value_ratio | numeric(10,6) | Y | — | 同上 | 冻结比率值 | DERIVE | 是 |
| value_days | integer | Y | — | 同上 | 冻结天数值 | DERIVE | 否 |
| unit | varchar(16) | N | — | CHECK 4 值 | 单位 | DERIVE | 否 |
| formula_version | varchar(16) | N | — | — | 公式版本 | DERIVE | 否 |
| computed_at | timestamptz | N | — | — | 原计算时间 | DERIVE | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

### 9.3 `cpx_metric_source` 指标来源引用

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK | — | SYS | 否 |
| metric_id | uuid | N | — | FK → `cpx_financial_metric(id)` | 指标 | SYS | 否 |
| case_id | uuid | N | — | 反规范化，按案件清理用 | 所属案件 | DERIVE | 否 |
| source_type | varchar(16) | N | — | CHECK `STATEMENT_ITEM/BANK_TXN/DEBT_RECORD` | 来源类型 | CALC | 否 |
| statement_item_id | bigint | Y | — | FK → `cpx_financial_statement_item(id)` | 报表科目行 | CALC | 否 |
| bank_transaction_id | bigint | Y | — | FK → `cpx_bank_transaction(id)` | 流水行 | CALC | 否 |
| debt_record_id | uuid | Y | — | FK → `cpx_debt_record(id)` | 债务记录 | CALC | 否 |
| source_row_no | integer | Y | — | — | 原始文件行号 | DERIVE | 否 |
| aggregation_role | varchar(16) | Y | — | CHECK `NUMERATOR/DENOMINATOR/SUM/INPUT` | 在公式中的角色 | CALC | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

`source_type` 与三个外键列的互斥关系由 `ck_metric_source_exclusive` 强制（见 `er-design.md` 3.8）。

### 9.4 `cpx_analysis_result` 分析结果

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| analysis_type | varchar(32) | N | — | CHECK `OPERATING/CASH_FLOW/DEBT_SERVICE/CONCENTRATION` | 分析类型 | UI | 否 |
| snapshot_id | uuid | N | — | FK → `cpx_metric_snapshot(id)`；UNIQUE `(case_id, analysis_type, snapshot_id) WHERE superseded_at IS NULL` | 绑定快照，不可变 | SYS | 否 |
| conclusion | jsonb | N | — | — | 结构化结论（非自由文本） | CALC | 否 |
| narrative | text | Y | — | — | 文字说明 | AI | 否 |
| narrative_source | varchar(16) | N | `'RULE'` | CHECK `RULE/AI_ASSISTED/HUMAN` | 文字来源 | UI | 否 |
| superseded_at | timestamptz | Y | — | — | 被新分析替代时间 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |

---

## 十、assessment 评估域

### 10.1 `cpx_assessment` 准备度评估

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| assessment_no | integer | N | — | UNIQUE `(case_id, assessment_no)`；CHECK `> 0` | 案件内评估序号 | SYS | 否 |
| round_no | integer | N | — | 复合 FK `(case_id, round_no)` → `cpx_analysis_round(case_id, round_no)`（V1.1 新增） | 所属分析轮次 | SYS | 否 |
| snapshot_id | uuid | N | — | FK → `cpx_metric_snapshot(id)` | 绑定的已锁定快照 | SYS | 否 |
| analysis_refs | jsonb | N | `'[]'` | CHECK `jsonb_typeof = 'array'` | 引用到的分析结果 id | SYS | 否 |
| readiness_outcome | varchar(32) | Y | — | CHECK `READY/NEED_SUPPLEMENT/INSUFFICIENT` | 准备度结论（三档，不含分数） | UI | 否 |
| dimensions | jsonb | N | — | 准备度五维结构，见下（V1.1 重定义） | 五维结果 | CALC | 否 |
| summary | varchar(2000) | Y | — | 禁止出现评级/通过率/获批概率 | 结论摘要 | AI | 否 |
| frozen_at | timestamptz | Y | — | — | 复核通过后冻结时间 | SYS | 否 |
| frozen_by | uuid | Y | — | 无外键 | 冻结触发人 | SYS | 否 |
| is_current | boolean | N | `true` | 部分唯一 `(case_id, round_no) WHERE is_current`（V1.1 改：原为 `(case_id)`） | 该轮次的当前评估 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键 | — | SYS | 否 |

`dimensions` 的键在 V1.1 **重定义为准备度五维**（基线修正 1：首期不评估偿债能力）：

| 键 | 中文 | `status` 取值 | `basis` 内容 |
|---|---|---|---|
| `completeness` | 资料完整性 | `GOOD/FAIR/WEAK/UNKNOWN` | 必填资料项 id 及其状态 |
| `verifiability` | 数据可核验性 | 同上 | 证据覆盖率（有证据的指标 id / 全部指标 id） |
| `consistency` | 口径一致性 | 同上 | 质量检查项 id + 待核实事项 id |
| `clarity` | 需求清晰度 | 同上 | 需求版本号与缺失要素名 |
| `verificationItems` | 待核实事项 | 同上 | 未终结事项 id 及其 `severity` |

原五维（`operating` 经营、`cashFlow` 现金流、`debtService` 偿债、`dataQuality` 数据完备、`compliance` 资料合规）**已废弃**：前两个属于投资/信贷判断，第三个直接违反"首期不评估偿债能力"。键名固定由 Java 常量保证，数据库不做嵌套 schema 校验——`jsonb` 的 CHECK 表达不了嵌套结构，强校验只能靠 `jsonb_path_exists`，维护成本高于收益。

`cpx_assessment` **只承载准备度评估**，与 `cpx_risk_finding`（分析层的关注点）并列，不是父子关系：风险事项不参与三档结论的推导，只作为报告的分析章节，`cpx_risk_finding.assessment_id` 可空回填。

### 10.2 `cpx_risk_finding` 风险事项

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | 复合 FK `(case_id, round_no)` → `cpx_analysis_round(case_id, round_no)`（V1.1 新增） | 所属案件 | SYS | 否 |
| round_no | integer | N | — | 同上（V1.1 新增） | 归属分析轮次 | SYS | 否 |
| assessment_id | uuid | Y | — | FK → `cpx_assessment(id)`；复合 FK `(assessment_id, round_no)` → `cpx_assessment(id, round_no)`；V1.1 由非空改可空 | 被写进哪次评估的报告章节（可空回填） | SYS | 否 |
| finding_no | integer | N | — | UNIQUE `(case_id, round_no, finding_no)`；CHECK `> 0`（V1.1 改作用域） | 本轮事项序号 | SYS | 否 |
| category | varchar(32) | N | — | CHECK 7 值 | 风险类别 | CALC | 否 |
| severity | varchar(16) | N | — | CHECK `HIGH/MEDIUM/LOW` | 影响程度 | CALC | 否 |
| title | varchar(200) | N | — | — | 标题 | CALC | 否 |
| description | varchar(2000) | Y | — | 禁止定性指控措辞（INV-13） | 描述 | AI | 否 |
| impact | jsonb | Y | — | — | 结构化影响（涉及金额、期间） | CALC | 否 |
| suggestion | varchar(2000) | Y | — | — | 建议补充或说明事项 | AI | 否 |
| evidence_refs | jsonb | N | — | CHECK `jsonb_array_length(...) >= 1` | 至少一条证据引用 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

**与 `cpx_verification_item` 的区别（V1.1 明确，两者不许合并）**：

| 维度 | `cpx_risk_finding` 风险事项 | `cpx_verification_item` 待核实事项 |
|---|---|---|
| 回答的问题 | 这件事对融资准备意味着什么 | 这份资料能不能对上 |
| 性质 | 分析层的**判断**，可带建议与影响 | 资料层的**疑问**，只陈述可观察事实 |
| 产生者 | 分析规则（Java）+ 人工补充 | 校验规则命中 + 人工登记 |
| 关闭方式 | 随轮次结束，无需企业答复 | 必须有人答复或被豁免 |
| 是否进报告 | 是，作为分析章节 | 是，作为"待核实清单"/"已豁免事项" |
| 与轮次的关系 | `round_no` | `round_no`，且可跨轮继承（`root_item_id`） |
| 合并的后果 | 事实与观点混在一起，报告既不敢下判断又把疑问当结论 | 同左 |

`evidence_refs` 是 `jsonb` 摘要（列表页渲染用），**真实证据链在 `cpx_evidence_ref`**（`target_type = 'RISK_FINDING'`）。两处并存是刻意的：摘要列避免列表页 N+1，真实链条要能建索引与被巡检。`jsonb_array_length >= 1` 的 CHECK 只是最低门槛，不能替代对 `cpx_evidence_ref` 的校验。

---

## 十一、review 审核域

### 11.1 `cpx_review_task` 复核任务

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| target_type | varchar(16) | N | — | CHECK `DOCUMENT/DATA/ASSESSMENT/REPORT` | 被审对象类型 | SYS | 否 |
| target_id | uuid | N | — | 多态，无外键 | 被审对象标识 | SYS | 否 |
| requester_user_id | uuid | N | — | FK → `cpx_user(id)` | 提交人 | SYS | 否 |
| assignee_user_id | uuid | N | — | FK → `cpx_user(id)` | 复核人 | UI | 否 |
| status | varchar(24) | N | `'PENDING'` | CHECK 6 值 | 任务状态 | SYS | 否 |
| is_self_review | boolean | N | `false` | CHECK 见 `er-design.md` 6.1（与提交人相同时必须为 true） | 是否单人复核 | SYS | 否 |
| submitted_at | timestamptz | N | `now()` | — | 提交时间 | SYS | 否 |
| due_on | date | Y | — | — | 期望完成日 | UI | 否 |
| closed_at | timestamptz | Y | — | — | 关闭时间 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |

部分唯一 `(target_type, target_id) WHERE status IN ('PENDING','IN_PROGRESS')`：同一对象同时只能有一个在办复核，这是幂等的最后一道兜底。

### 11.2 `cpx_review_record` 复核记录

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| review_task_id | uuid | N | — | FK → `cpx_review_task(id)` | 复核任务 | SYS | 否 |
| reviewer_user_id | uuid | N | — | FK → `cpx_user(id)` | 复核人 | SYS | 否 |
| decision | varchar(24) | N | — | CHECK `APPROVE/REQUEST_CHANGES/REJECT` | 结论 | UI | 否 |
| comment | varchar(2000) | Y | — | `REQUEST_CHANGES`/`REJECT` 时必填 | 意见 | UI | 否 |
| is_self_review | boolean | N | `false` | — | 是否为单人复核 | DERIVE | 否 |
| decided_at | timestamptz | N | `now()` | — | 决定时间 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

---

## 十二、report 报告域

### 12.1 `cpx_report` 报告

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)`；UNIQUE `(case_id)`（V1.1 改：原部分唯一 `WHERE status <> 'VOID'`，随 `status` 下沉失效） | 所属案件 | SYS | 否 |
| report_no | varchar(32) | N | — | UNIQUE；`~ '^RPT-[0-9]{4}-[0-9]{4}$'` | 报告编号 | SYS | 否 |
| title | varchar(200) | N | — | — | 报告标题 | SYS | 否 |
| template_code | varchar(64) | N | — | — | 模板编码与版本，如 `FIN_PREP_V1` | SYS | 否 |
| current_version_no | integer | N | `0` | CHECK `>= 0` | 当前版本号（指向最新版本的序号） | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |

**V1.1 删除了 `status`、`issued_at`、`issued_by`、`voided_at`、`void_reason` 五列**，全部下沉到 `cpx_report_version`。理由：报告的效力（草稿/复核中/已签发/已交付/已作废）是**版本级事实**，放在容器上时，同案出现第 2 版报告就无法同时表达两个版本的效力——要么覆盖旧状态（历史被改），要么加更多状态值（枚举爆炸）。`cpx_report` 从此只回答"这是哪份报告"，不回答"它现在什么效力"。

### 12.2 `cpx_report_version` 报告版本

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| report_id | uuid | N | — | FK → `cpx_report(id)`；UNIQUE `(report_id, version_no)` | 所属报告 | SYS | 否 |
| case_id | uuid | N | — | 复合 FK `(report_id, case_id)` → `cpx_report(id, case_id)`（V1.1 新增） | 所属案件（反规范化，供轮次复合外键使用） | DERIVE | 否 |
| version_no | integer | N | — | CHECK `> 0` | 版本号，报告内从 1 起 | SYS | 否 |
| round_no | integer | N | — | 复合 FK `(case_id, round_no)` → `cpx_analysis_round(case_id, round_no)`；部分唯一 `(report_id, round_no) WHERE status <> 'VOID'`（V1.1 新增） | 绑定的分析轮次，必须为 `CLOSED` | SYS | 否 |
| status | varchar(32) | N | `'DRAFT'` | CHECK 6 值，见 17.2（V1.1 由 `cpx_report` 下沉） | 报告版本状态 | SYS | 否 |
| snapshot_id | uuid | N | — | FK → `cpx_metric_snapshot(id)` | 渲染所用快照 | SYS | 否 |
| assessment_id | uuid | N | — | FK → `cpx_assessment(id)` | 渲染所用评估 | SYS | 否 |
| storage_key | varchar(500) | N | — | UNIQUE | PDF 存储键 | SYS | 否 |
| file_sha256 | char(64) | N | — | `~ '^[0-9a-f]{64}$'` | 导出文件哈希（交付留证，G-P5） | SYS | 否 |
| file_size_bytes | bigint | N | — | CHECK `> 0` | 文件大小 | SYS | 否 |
| content_hash | char(64) | N | — | `~ '^[0-9a-f]{64}$'`（V1.1 新增） | 正文规范化内容哈希（G-P2 复核的就是它） | SYS | 否 |
| render_input_hash | char(64) | N | — | — | 渲染输入摘要，验证"同输入同输出" | SYS | 否 |
| metric_refs | jsonb | N | — | CHECK `jsonb_typeof = 'array'` | 报告中引用的 metric_id 清单 | SYS | 否 |
| evidence_check_result | jsonb | N | `'{}'` | CHECK `jsonb_typeof = 'object'`（V1.1 新增） | 渲染前证据校验结果：是否通过、缺失项、校验时的 `dataVersionId`、校验时间 | SYS | 否 |
| generated_at | timestamptz | N | `now()` | — | 生成时间 | SYS | 否 |
| generated_by | uuid | Y | — | 无外键 | 触发人 | SYS | 否 |
| issued_at | timestamptz | Y | — | `status IN ('ISSUED','DELIVERED')` 时必填（V1.1 新增） | 签发时间 | UI | 否 |
| issued_by | uuid | Y | — | 无外键；同上必填；不得为 SYSTEM 账号（V1.1 新增） | 签发人 | SYS | 否 |
| delivered_at | timestamptz | Y | — | — | 交付时间 | UI | 否 |
| delivery_method | varchar(16) | Y | — | CHECK `EMAIL/DOWNLOAD/ONSITE/OTHER` | 交付方式 | UI | 否 |
| delivered_to_name | varchar(100) | Y | — | — | 接收人 | UI | 是（个人信息） |
| delivered_to_contact | varchar(100) | Y | — | — | 接收联系方式（脱敏存） | UI | 是 |
| delivery_evidence_document_id | uuid | Y | — | FK → `cpx_document(id)` | 交付凭证（回执） | UI | 否 |
| voided_at | timestamptz | Y | — | `status = 'VOID'` 时必填（V1.1 新增） | 作废时间 | UI | 否 |
| void_reason | varchar(500) | Y | — | 同上（V1.1 新增） | 作废理由 | UI | 否 |
| replacement_version_no | integer | Y | — | CHECK `> 0`（V1.1 新增） | 作废已签发版本时必须给出替代版本（G-P6） | UI | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

**三个哈希列的分工，不能合并**：

| 列 | 覆盖 | 判定什么 | 变了说明 |
|---|---|---|---|
| `render_input_hash` | 输入（指标 id + 值 + 模板版本 + 结论文本） | 同输入必同输出 | 数据或模板变了 |
| `content_hash` | 正文规范化文本（去字体、时间戳、页码） | 复核的是这一版内容 | 正文被改过 |
| `file_sha256` | 导出 PDF 字节 | 客户手里那份就是这份 | 重新导出过（字节可能不同） |

**`round_no` 为什么必须落列而不是从 `snapshot_id` 反推**：快照只证明"用了哪份指标"，证明不了"基于哪一轮结论"；且同一轮重算后 `metric_snapshot_id` 会换，反推就断了。有了 `round_no`，报告与轮次之间是普通外键，且触发器可以据此校验"轮次必须 `CLOSED`"。

---

## 十三、ai 网关域

### 13.1 `cpx_ai_task` AI 任务

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| case_id | uuid | Y | — | FK → `cpx_financing_case(id)` | 关联案件，通用任务为空 | SYS | 否 |
| task_type | varchar(32) | N | — | CHECK 6 值 | 任务类型 | SYS | 否 |
| status | varchar(16) | N | `'PENDING'` | CHECK 6 值 | 任务状态 | SYS | 否 |
| model_id | varchar(64) | N | — | — | 模型标识 | SYS | 否 |
| prompt_version | varchar(32) | N | — | — | 提示词版本 | SYS | 否 |
| input_refs | jsonb | N | `'[]'` | — | 输入引用（文档 id、指标 id） | SYS | 否 |
| output_refs | jsonb | Y | — | — | 输出引用 | SYS | 否 |
| latency_ms | integer | Y | — | CHECK `>= 0` | 端到端耗时 | SYS | 否 |
| prompt_tokens | integer | Y | — | CHECK `>= 0` | 输入 token | SYS | 否 |
| completion_tokens | integer | Y | — | CHECK `>= 0` | 输出 token | SYS | 否 |
| cost_amount | numeric(18,2) | Y | — | CHECK `>= 0` | 成本（元） | SYS | 否 |
| retry_count | integer | N | `0` | CHECK `>= 0` | 已重试次数 | SYS | 否 |
| max_retry | integer | N | `3` | CHECK `>= 0` | 最大重试次数 | SYS | 否 |
| error_code | varchar(64) | Y | — | — | 错误码 | SYS | 否 |
| error_message | varchar(1000) | Y | — | — | 错误摘要 | SYS | 否 |
| requested_by | uuid | Y | — | 无外键 | 触发人 | SYS | 否 |
| started_at | timestamptz | Y | — | — | 开始时间 | SYS | 否 |
| finished_at | timestamptz | Y | — | — | 结束时间 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

### 13.2 `cpx_ai_execution_log` AI 执行明细

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK | — | SYS | 否 |
| ai_task_id | uuid | N | — | FK → `cpx_ai_task(id)`；UNIQUE `(ai_task_id, attempt_no)` | 任务 | SYS | 否 |
| attempt_no | integer | N | — | CHECK `> 0` | 第几次尝试 | SYS | 否 |
| request_payload | jsonb | Y | — | 入库前脱敏 | 请求体 | SYS | 是（可能含原始数据） |
| response_payload | jsonb | Y | — | — | 响应体 | SYS | 是 |
| http_status | smallint | Y | — | — | HTTP 状态码 | SYS | 否 |
| latency_ms | integer | Y | — | CHECK `>= 0` | 耗时 | SYS | 否 |
| prompt_tokens | integer | Y | — | CHECK `>= 0` | 输入 token | SYS | 否 |
| completion_tokens | integer | Y | — | CHECK `>= 0` | 输出 token | SYS | 否 |
| error_message | varchar(1000) | Y | — | — | 错误摘要 | SYS | 否 |
| occurred_at | timestamptz | N | `now()` | — | 发生时间 | SYS | 否 |

### 13.3 `cpx_ai_suggestion` AI 建议

AI 服务**只能写这张表**（A-09）。业务事实由 Java 在人工 `ACCEPT` 后写入对应业务表。

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| ai_task_id | uuid | N | — | FK → `cpx_ai_task(id)` | 产出任务 | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)` | 所属案件 | SYS | 否 |
| suggestion_type | varchar(32) | N | — | CHECK 7 值 | 建议类型 | AI | 否 |
| target_type | varchar(32) | Y | — | CHECK `DOCUMENT/FIELD/BANK_TXN/METRIC/QUALITY_ISSUE/REPORT` | 建议作用对象类型 | AI | 否 |
| target_id | varchar(64) | Y | — | 多态，无外键 | 作用对象标识 | AI | 否 |
| payload | jsonb | N | — | — | 建议内容 | AI | 是（可能含原文片段） |
| confidence | numeric(5,4) | Y | — | CHECK 0–1 | 置信度 | AI | 否 |
| status | varchar(16) | N | `'PENDING'` | CHECK `PENDING/ACCEPTED/REJECTED/SUPERSEDED` | 处置状态 | SYS | 否 |
| reviewed_by | uuid | Y | — | 无外键 | 处置人 | SYS | 否 |
| reviewed_at | timestamptz | Y | — | — | 处置时间 | SYS | 否 |
| reject_reason | varchar(500) | Y | — | 拒绝时必填 | 拒绝理由 | UI | 否 |
| applied_ref_type | varchar(32) | Y | — | — | 采纳后生成的业务对象类型 | SYS | 否 |
| applied_ref_id | varchar(64) | Y | — | 多态，无外键 | 采纳后生成的业务对象 id | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

---

## 十四、audit 审计域

### 14.1 `cpx_audit_log` 审计日志（按月分区）

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK 之一（与 `occurred_at` 复合） | — | SYS | 否 |
| occurred_at | timestamptz | N | `now()` | PK 之一，分区键 | 发生时间 | SYS | 否 |
| actor_user_id | uuid | Y | — | 无外键 | 操作者 | SYS | 否 |
| actor_type | varchar(8) | N | — | CHECK `USER/SYSTEM/ANON` | 操作者类型 | SYS | 否 |
| actor_role | varchar(32) | Y | — | — | 角色码快照 | SYS | 否 |
| action | varchar(64) | N | — | 无 CHECK，见 17.3 | 动作码 | SYS | 否 |
| resource_type | varchar(32) | N | — | — | 资源类型 | SYS | 否 |
| resource_id | varchar(64) | Y | — | 多态，无外键 | 资源标识 | SYS | 否 |
| case_id | uuid | Y | — | 无外键（审计保留期长于案件） | 关联案件 | SYS | 否 |
| result | varchar(16) | N | — | CHECK `SUCCESS/DENIED/FAILED` | 结果 | SYS | 否 |
| ip | inet | Y | — | — | 来源 IP | SYS | 是（个人信息） |
| user_agent | varchar(500) | Y | — | — | UA | SYS | 否 |
| trace_id | varchar(64) | Y | — | — | 链路 ID | SYS | 否 |
| detail | jsonb | Y | — | 入库前脱敏 | 变更前后值、守卫结果 | SYS | 是 |
| chain_date | date | N | — | 与 `chain_seq` 构成分区内唯一 | 哈希链所属日期 | SYS | 否 |
| chain_seq | bigint | N | — | 与 `chain_date` 构成分区内唯一 | 当日链内序号，从 1 递增 | SYS | 否 |
| prev_hash | char(64) | Y | — | — | 前一条 `record_hash`；当日首条为当日锚点哈希 | SYS | 否 |
| record_hash | char(64) | N | — | — | `sha256(prev_hash ‖ 规范化字段串)` | SYS | 否 |

> 唯一性说明：PG 不允许分区表上的唯一索引缺少分区键，因此 `(chain_date, chain_seq)` 的唯一索引建在**每个分区**上（见 CPX-DB-02 §5.2）。分区创建脚本必须一并建这条索引。

### 14.2 `cpx_audit_anchor` 审计日锚点（append-only）

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK | — | SYS | 否 |
| anchor_date | date | N | — | UNIQUE | 锚点日期 | SYS | 否 |
| chain_head_hash | char(64) | N | — | — | 当日最后一条 `record_hash` | SYS | 否 |
| record_count | bigint | N | — | — | 当日审计条数，用于发现"删一片" | SYS | 否 |
| signature | char(64) | Y | — | — | 锚点行自身哈希，覆盖前 4 列 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

---

## 十五、platform 平台支撑

### 15.1 `cpx_idempotency` 幂等键

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| idempotency_key | varchar(128) | N | — | PK | 客户端传入的幂等键 | UI | 否 |
| scope | varchar(64) | N | — | — | 命名空间，如 `case:submit` | SYS | 否 |
| request_hash | char(64) | N | — | — | 请求体摘要，同键不同体视为冲突 | SYS | 否 |
| response_status | smallint | Y | — | — | 首次响应状态码 | SYS | 否 |
| response_body | jsonb | Y | — | 已脱敏 | 首次响应体 | SYS | 否 |
| resource_type | varchar(32) | Y | — | 多态 | 结果资源类型 | SYS | 否 |
| resource_id | varchar(64) | Y | — | 多态 | 结果资源 id | SYS | 否 |
| actor_user_id | uuid | Y | — | 无外键 | 发起人 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| expires_at | timestamptz | N | — | 索引 `(expires_at)` | 过期时间（创建 + 24h） | SYS | 否 |

主键用 `idempotency_key` 而不是代理 UUID：幂等的本质就是"同一个键只允许一行"，用业务键做主键，`ON CONFLICT` 天然幂等，少一次唯一索引回表。

### 15.2 `cpx_field_dictionary` 字段字典

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | — | SYS | 否 |
| entity_code | varchar(64) | N | — | UNIQUE `(entity_code, field_code)` | 实体码，如 `BANK_TXN` | SYS | 否 |
| field_code | varchar(64) | N | — | 同上 | 字段码，如 `txn_on` | SYS | 否 |
| field_name_cn | varchar(100) | N | — | — | 中文名 | SYS | 否 |
| data_type | varchar(16) | N | — | CHECK 5 值 | 逻辑类型 | SYS | 否 |
| unit | varchar(16) | Y | — | — | 单位 | SYS | 否 |
| enum_values | jsonb | Y | — | — | 枚举值集合 | SYS | 否 |
| alias_names | jsonb | N | `'[]'` | CHECK `jsonb_typeof = 'array'` | 表头别名，供导入匹配 | SYS | 否 |
| is_sensitive | boolean | N | `false` | — | 是否敏感字段 | SYS | 否 |
| mask_rule | varchar(32) | Y | — | — | 脱敏规则码 | SYS | 否 |
| description | varchar(500) | Y | — | — | 说明 | SYS | 否 |
| is_active | boolean | N | `true` | — | 是否启用 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| updated_at | timestamptz | N | `now()` | 触发器 | — | SYS | 否 |

---

## 十六、V1.1 新增表（5）

本节集中收录 V1.1 新增的五张表。它们分属 E 证据与血缘域（`cpx_data_version`、`cpx_data_version_member`、`cpx_evidence_ref`）与 D4 分析/评估域（`cpx_analysis_round`、`cpx_verification_item`），放在一起是因为它们共同构成"轮次 → 版本 → 证据"这条新链路，分开查会看不出关系。

### 16.1 `cpx_data_version` 数据版本

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | 数据版本标识 | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)`；UNIQUE `(case_id, version_no)` / `(case_id, digest)` 首列 | 所属案件 | SYS | 否 |
| version_no | integer | N | — | CHECK `> 0`；案件内从 1 递增，不可变 | 版本号 V1、V2…… | SYS | 否 |
| digest | char(64) | N | — | `~ '^[0-9a-f]{64}$'`；UNIQUE `(case_id, digest)` | 成员文件内容哈希有序拼接后的 SHA-256 | SYS | 否 |
| trigger_type | varchar(32) | N | — | CHECK 5 值，见 17.2 | 触发类型 | SYS | 否 |
| trigger_ref | varchar(64) | Y | — | 多态，无外键 | 触发对象：`DOCUMENT_*` 写文件版本 id，人工修正写修正单号 | SYS | 否 |
| status | varchar(32) | N | `'ACTIVE'` | CHECK `ACTIVE/SUPERSEDED`；部分唯一 `(case_id) WHERE status = 'ACTIVE'` | 版本状态 | SYS | 否 |
| superseded_at | timestamptz | Y | — | `status = 'SUPERSEDED'` 时必填 | 被取代时刻 | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |
| created_by | uuid | Y | — | 无外键；系统触发为 NULL | 触发人 | SYS | 否 |

本表**没有** `updated_at`：除 `status` 外全部列不可变，`superseded_at` 记录唯一一次状态迁移（理由见 `er-design.md` 1.4）。

`digest` 的计算规则固定为 `sha256(join(';', 按 sha256 升序排列的 member: sha256 || '|' || coalesce(scope_note,'')))`，**不含 `document_version_id`**——否则企业重传同一份文件会产生新版本并白跑一轮分析，正是 INV-19 要防的。

### 16.2 `cpx_data_version_member` 版本成员

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| data_version_id | uuid | N | — | PK 之一；FK → `cpx_data_version(id)` | 数据版本 | SYS | 否 |
| document_version_id | uuid | N | — | PK 之一；FK → `cpx_document_version(id)` | 构成该版本的文件版本 | SYS | 否 |
| scope_note | varchar(200) | Y | — | — | 该文件下被采纳的范围，如 `2025-01..2025-12`、`sheet:流水!A3:J5002` | SYS | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

复合主键同时表达"一个版本里同一文件版本只能出现一次"。成员集合写入后不可增删：补文件必须产生新版本。

索引 `idx_data_version_member_doc (document_version_id, data_version_id)` 服务反向查询"这份文件参与了哪几版数据"，是资料替换时影响面分析的入口。

### 16.3 `cpx_analysis_round` 分析轮次

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK | 轮次标识 | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)`；UNIQUE `(case_id, round_no)` | 所属案件 | SYS | 否 |
| round_no | integer | N | — | CHECK `> 0`；案件内从 1 递增，不可变 | 轮次号 | SYS | 否 |
| data_version_id | uuid | N | — | FK → `cpx_data_version(id)`；UNIQUE `(case_id, data_version_id)`；复合 FK `(case_id, data_version_id)`；**触发器保证不可变** | 绑定的数据版本 | SYS | 否 |
| status | varchar(32) | N | `'DRAFT'` | CHECK 6 值，见 17.2 | 轮次状态 | SYS | 否 |
| metric_snapshot_id | uuid | Y | — | FK → `cpx_metric_snapshot(id)`；`COMPUTED` 后必填 | 本轮指标快照 | SYS | 否 |
| assessment_id | uuid | Y | — | FK → `cpx_assessment(id)`；`ASSESSED` 后必填 | 本轮准备度评估 | SYS | 否 |
| started_at | timestamptz | N | `now()` | — | 开轮时间（R01） | SYS | 否 |
| closed_at | timestamptz | Y | — | `status = 'CLOSED'` 时必填 | 定稿时间（R05） | SYS | 否 |
| superseded_by_round_no | integer | Y | — | 复合 FK `(case_id, superseded_by_round_no)` → `(case_id, round_no)`；`> round_no` | 被哪一轮取代 | SYS | 否 |
| supersede_reason | varchar(32) | Y | — | CHECK `NEW_DATA/CASE_TERMINATED`；`status = 'SUPERSEDED'` 时必填 | 取代原因（R06/R07） | SYS | 否 |
| version | integer | N | `0` | CHECK `>= 0` | 乐观锁 | SYS | 否 |
| created_at / updated_at | timestamptz | N | `now()` | 触发器维护 `updated_at` | — | SYS | 否 |
| created_by / updated_by | uuid | Y | — | 无外键 | — | SYS | 否 |

`UNIQUE (case_id, data_version_id)` 是 G-R1 的幂等兜底：`DataVersionCreated` 事件重复投递时，第二次开轮直接冲突，不会出现两个同版本轮次。

`superseded_by_round_no` 用业务号而非 uuid，目的是让 `(case_id, superseded_by_round_no)` 能直接做复合外键指向 `(case_id, round_no)`——单列 `round_no` 不唯一，无法建外键。

写入顺序（与 `cpx_metric_snapshot` 互相引用）：① 插轮次（`metric_snapshot_id` 为 NULL）→ ② 插快照 → ③ 回填 `metric_snapshot_id`，三步同一事务。

### 16.4 `cpx_evidence_ref` 证据引用

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | bigint | N | identity | PK | — | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)`；复合 FK `(case_id, data_version_id)` | 所属案件（反规范化） | SYS | 否 |
| target_type | varchar(32) | N | — | CHECK 5 值，见 17.2 | 被支撑对象类型 | SYS | 否 |
| target_id | varchar(64) | N | — | 多态，无外键 | 被支撑对象标识；`REPORT_CLAUSE` 用 `{reportVersionId}#{clauseNo}` | SYS | 否 |
| evidence_kind | varchar(32) | N | — | CHECK 7 值，见 17.2 | 证据种类 | SYS | 否 |
| source_object_type | varchar(32) | Y | — | CHECK 7 值，见 17.2 | 来源对象类型（反查与巡检必需） | SYS | 否 |
| source_object_id | varchar(64) | Y | — | 多态，无外键 | 来源对象标识（uuid 与 bigint 混存，统一转字符串） | SYS | 否 |
| source_locator | jsonb | Y | — | `jsonb_typeof = 'object'` | 位置：`{"page":12}` / `{"page":3,"row":18}` / `{"lineNo":3042}` / `{"sheet":"流水","range":"A3:J5002"}` | SYS | 否 |
| data_version_id | uuid | N | — | FK → `cpx_data_version(id)` | 证据所属数据版本（INV-18 载体） | SYS | 否 |
| period_label | varchar(16) | Y | — | — | 涉及的会计期间，如 `2025`、`2025-03` | SYS | 否 |
| formula_code | varchar(64) | Y | — | `CALCULATION`/`RULE_HIT` 类必填 | 计算或规则编码 | CALC | 否 |
| formula_version | varchar(16) | Y | — | `CALCULATION` 类必填 | 公式版本，与指标记录必须一致 | CALC | 否 |
| review_record_id | uuid | Y | — | FK → `cpx_review_record(id)`；`HUMAN_REVIEW` 类必填 | 人工复核记录 | SYS | 否 |
| confidence | numeric(5,4) | Y | — | CHECK `0 <= confidence <= 1` | AI 提取置信度，人工录入为空 | AI | 否 |
| note | varchar(200) | Y | — | — | 补充说明 | UI | 否 |
| created_at | timestamptz | N | `now()` | — | — | SYS | 否 |

字段级条件约束 `ck_evidence_ref_required_locator`（按 `evidence_kind` 分支）：

| `evidence_kind` | 必填 | 说明 |
|---|---|---|
| `SOURCE_DOCUMENT` | `source_object_id` | 原始文件正文某一页 |
| `EXTRACTED_FIELD` | `source_object_id` | 提取字段 |
| `DATA_ROW` | `source_object_id` | 结构化数据行 |
| `CALCULATION` | `formula_code` + `formula_version` | 计算结果 |
| `RULE_HIT` | `formula_code` | 规则命中 |
| `HUMAN_REVIEW` | `review_record_id` | 人工复核 |
| `EXTERNAL_PUBLIC` | `source_locator` | 公开信息（URL + 快照时间放 locator） |

两条核心索引与用途：

| 索引 | 服务的查询 |
|---|---|
| `idx_evidence_ref_target (target_type, target_id, id)` | 某结论的全部证据（报告渲染主路径） |
| `idx_evidence_ref_source (source_object_type, source_object_id, evidence_kind) WHERE source_object_id IS NOT NULL` | 某数据行被哪些结论引用（改数前的影响面分析） |
| `idx_evidence_ref_version (data_version_id, target_type)` | 渲染前一次取回整批引用，避免 N+1；也是 INV-18 校验的扫描路径 |
| `uq_evidence_ref_unique (... ) NULLS NOT DISTINCT` | 同一目标同一来源同一位置只挂一条，防"堆证据" |

`source_object_id` 与 `target_id` 都是多态引用，**不建外键**，完整性由"写时校验 + 渲染前校验 + 每日巡检"三层保证（`er-design.md` 7.4/7.5）。这是本表唯一需要长期维护的成本，换来的是"新增一类证据来源不需要发 DDL"。

### 16.5 `cpx_verification_item` 待核实事项

| 字段 | 类型 | 空 | 默认 | 约束 | 含义 | 来源 | 敏感 |
|---|---|---|---|---|---|---|---|
| id | uuid | N | `gen_random_uuid()` | PK；由应用生成（以便 `root_item_id = id`） | 事项标识 | SYS | 否 |
| case_id | uuid | N | — | FK → `cpx_financing_case(id)`；复合 FK `(case_id, round_no)` | 所属案件 | SYS | 否 |
| round_no | integer | N | — | 复合 FK → `cpx_analysis_round(case_id, round_no)` | 归属轮次 | SYS | 否 |
| root_item_id | uuid | N | — | 与首次记录的 `id` 相同，跨轮不变 | 疑问的稳定身份 | SYS | 否 |
| code | varchar(32) | N | — | 无 CHECK（Java 枚举），如 `VI-REV-01` | 规则码 | SYS | 否 |
| category | varchar(32) | N | — | CHECK `DIFFERENCE/MISSING/CALIBER/FIELD_ANOMALY` | 类别：差异/缺失/口径/字段异常 | SYS | 否 |
| severity | varchar(16) | N | — | CHECK `HIGH/MEDIUM/LOW` | 等级 | SYS | 否 |
| observation | varchar(2000) | N | — | 禁止定性指控措辞（INV-13） | 只陈述可观察到的事实 | AI | 否 |
| possible_causes | jsonb | N | `'[]'` | `jsonb_typeof = 'array'` 且 `array_length >= 1` | 并列的可能原因，不作结论 | AI | 否 |
| recommended_action | varchar(1000) | Y | — | — | 建议补充或澄清的动作 | AI | 否 |
| status | varchar(32) | N | `'OPEN'` | CHECK 4 值，见 17.2 | 处理状态 | SYS | 否 |
| prior_round_no | integer | Y | — | 复合 FK `(case_id, prior_round_no)`；`< round_no` | 继承来源轮次，首次发现为 NULL | SYS | 否 |
| prior_answer_note | varchar(200) | Y | — | — | 继承时携带的原答复只读摘要 | DERIVE | 否 |
| answer_note | varchar(2000) | Y | — | `status IN ('ANSWERED','RESOLVED')` 时必填 | 企业答复正文 | UI | 否 |
| answer_source | varchar(16) | Y | — | CHECK `ORAL/WRITTEN` | 答复来源 | UI | 否 |
| answered_by | uuid | Y | — | 无外键 | 答复登记人 | SYS | 否 |
| answered_at | timestamptz | Y | — | — | 答复登记时间 | SYS | 否 |
| resolution | varchar(2000) | Y | — | `status = 'RESOLVED'` 时必填 | 核实结论正文 | UI | 否 |
| resolved_by | uuid | Y | — | 无外键 | 核实人（只能是人，不能是 SYSTEM） | SYS | 否 |
| resolved_at | timestamptz | Y | — | — | 核实时间 | SYS | 否 |
| waiver_reason | varchar(500) | Y | — | `status = 'WAIVED'` 时必填；报告须列出 | 豁免理由 | UI | 否 |
| version | integer | N | `0` | CHECK `>= 0` | 乐观锁 | SYS | 否 |
| created_at / updated_at | timestamptz | N | `now()` | 触发器维护 `updated_at` | — | SYS | 否 |
| created_by / updated_by | uuid | Y | — | 无外键 | — | SYS | 否 |

跨轮继承的三个字段与两个派生值：

| 项 | 处理 | 理由 |
|---|---|---|
| `root_item_id` | 落列，首次 = 自身 id | 一条疑问的完整历史 = 同一 `root_item_id` 的全部行 |
| `prior_round_no` | 落列，可空 | 继承来源轮次，同时是复合外键，保证来源轮次真实存在 |
| `prior_answer_note` | 落列（≤200 字） | 冻结"上一轮的答复摘要"，避免原记录后续被修改导致历史被追溯改写 |
| `carriedFromItemId`（workflow §6） | **不落列**，派生 | `(case_id, prior_round_no, root_item_id)` 唯一确定来源记录 |
| `carryCount`（workflow §6） | **不落列**，查询派生 | `round_no − MIN(round_no) OVER (PARTITION BY root_item_id)`，存列会产生第二份真相 |

唯一约束：`uq_verification_item_root (case_id, round_no, root_item_id)` 与 `uq_verification_item_code (case_id, round_no, code)`。前者保证同一轮同一疑问只有一条，是继承规则（workflow §6 规则 2）的数据库落点；后者防规则重跑重复登记。

与 `cpx_data_quality_issue` 的分工见 10.2 末尾的对照表：前者面向企业澄清（必须有人答复），后者是系统对数据的自校验（可随数据修好自动关闭）。

**"每条必须有至少一条证据"无法用 CHECK 表达**（证据在另一张表）。落地方式是：V01 写入时同事务校验 → 报告渲染前 `EvidenceQueryPort` 校验 → 每日巡检扫"零证据的 OPEN 事项"。

---

## 十七、枚举取值全集

### 17.1 案件生命周期 `cpx_financing_case.lifecycle` / `cpx_case_status_event.to_status`

| 值 | 中文 | 类型 | 责任模块 |
|---|---|---|---|
| INTAKE | 受理 | 起始态 | case |
| AUTHORIZATION | 授权 | 主状态 | authorization |
| COLLECTING | 资料收集 | 主状态 | document |
| ANALYZING | 分析 | 主状态 | analysis |
| REVIEW | 复核 | 主状态 | review |
| DELIVERED | 交付 | 主状态 | report |
| CLOSED | 关闭 | 终态 | case |
| ON_HOLD | 挂起 | 可恢复暂停 | case |
| WITHDRAWN | 客户撤回 | 终态 | case |
| DECLINED | 不予服务 | 终态 | case |

取值来源：`financing-workflow.md` §3.1（五状态机版本）。V1.0 的 18 个旧值与迁移映射见 `er-design.md` 3.1.1。

三条与取值相关的约束：① 只有 `ON_HOLD` 允许带 `hold_from`，其余状态 `hold_from` 必须为 NULL；② `WITHDRAWN`/`DECLINED` 必须带 `terminated_reason`；③ `CLOSED` 必须带 `closed_at`。三条都是"状态与伴随列一致"，不能只靠应用层。

### 17.2 枚举总表

| 表.字段 | 取值 | 中文含义 |
|---|---|---|
| customer.status | ACTIVE | 合作中 |
| | INACTIVE | 已停止合作 |
| user.status | ACTIVE | 正常 |
| | DISABLED | 已停用 |
| | LOCKED | 锁定（连续登录失败） |
| role.code | ADMIN | 管理员（全流程操作） |
| | REVIEWER | 复核人（仅核验与复核） |
| | VIEWER | 只读 |
| | SYSTEM | 系统任务账号 |
| requirement.financing_type | WORKING_CAPITAL | 流动资金贷款 |
| | PROJECT_LOAN | 项目贷款 |
| | LEASE_FINANCING | 融资租赁 |
| | BILL_FINANCING | 票据融资 |
| | SUPPLY_CHAIN | 供应链金融 |
| | OTHER | 其他 |
| case_material.requirement_level / material_requirement.requirement_level | REQUIRED | 必需 |
| | CONDITIONAL | 条件必需 |
| | OPTIONAL | 可选 |
| case_material.status（V1.1 新增） | REQUIRED | 待索要 |
| | REQUESTED | 已索要 |
| | RECEIVED | 已收到，未解析 |
| | PARSED | 已解析，未核验 |
| | VERIFIED | 已核验（可作为评估输入） |
| | WAIVED | 已豁免（须填理由与批准人，报告须列出） |
| | REJECTED | 已退回，需重新提供 |
| authorization_scope.data_scope | BANK_STATEMENT | 银行流水 |
| | FINANCIAL_STATEMENT | 财务报表 |
| | TAX | 税务资料 |
| | CREDIT_REPORT | 征信报告 |
| | DEBT_CONTRACT | 债务合同 |
| document_version.verification_state | UPLOADED | 已上传，未解析 |
| | PARSED | 已解析，未核验 |
| | VERIFIED | 人工已核验 |
| | REJECTED | 核验不通过 |
| | SUPERSEDED | 已被新版本替代 |
| document_review.decision | VERIFY | 核验通过 |
| | REJECT | 核验退回 |
| data_import.import_type | BANK_STATEMENT | 银行流水 |
| | BALANCE_SHEET | 资产负债表 |
| | INCOME_STATEMENT | 利润表 |
| | CASH_FLOW | 现金流量表 |
| | DEBT_LIST | 债务清单 |
| | TAX_RETURN | 纳税申报表 |
| data_import.status | PENDING | 待解析 |
| | PARSING | 解析中 |
| | PARSED | 解析完成 |
| | FAILED | 解析失败 |
| | CONFIRMED | 已人工确认（锁定） |
| | ROLLED_BACK | 已回滚 |
| data_import.parser_type | RULE | 规则解析 |
| | AI | AI 解析 |
| | HYBRID | 规则 + AI |
| import_record.parse_status | PARSED | 解析成功 |
| | FAILED | 解析失败 |
| | SKIPPED | 跳过（空行/表头） |
| | DUPLICATE | 重复行 |
| quality_issue.severity | BLOCKER | 阻断（未解决不得进入分析） |
| | MAJOR | 重大 |
| | MINOR | 一般 |
| | INFO | 提示 |
| quality_issue.status | OPEN | 待处理 |
| | ACKNOWLEDGED | 已知悉待处置 |
| | RESOLVED | 已解决 |
| | WAIVED | 已豁免（须填理由与批准人） |
| statement.statement_type | BALANCE_SHEET | 资产负债表 |
| | INCOME_STATEMENT | 利润表 |
| | CASH_FLOW | 现金流量表 |
| statement/metric.period_type | YEAR | 年度 |
| | QUARTER | 季度 |
| | MONTH | 月度 |
| | POINT | 时点 |
| | TTM | 滚动十二个月 |
| metric.unit | CNY | 元 |
| | PERCENT | 百分比（存 0–1 小数） |
| | DAYS | 天 |
| | TIMES | 倍 |
| bank_transaction.direction | IN | 流入 |
| | OUT | 流出 |
| bank_transaction.category_source | RULE | 规则分类 |
| | AI | AI 分类（须人工确认） |
| | MANUAL | 人工分类 |
| debt_record.debt_type | LOAN | 借款 |
| | LEASE | 融资租赁 |
| | FACTORING | 保理 |
| | BOND | 债券 |
| | OTHER | 其他 |
| debt_record.status | ACTIVE | 存续 |
| | SETTLED | 已结清 |
| | OVERDUE | 逾期 |
| metric_source.source_type | STATEMENT_ITEM | 报表科目行 |
| | BANK_TXN | 银行流水行 |
| | DEBT_RECORD | 债务记录 |
| metric_source.aggregation_role | NUMERATOR | 分子 |
| | DENOMINATOR | 分母 |
| | SUM | 求和项 |
| | INPUT | 直接输入项 |
| analysis_result.analysis_type | OPERATING | 经营分析 |
| | CASH_FLOW | 现金流分析 |
| | DEBT_SERVICE | 偿债分析 |
| | CONCENTRATION | 集中度分析 |
| analysis_result.narrative_source | RULE | 规则生成 |
| | AI_ASSISTED | AI 辅助 |
| | HUMAN | 人工撰写 |
| assessment.readiness_outcome | READY | 具备提交条件 |
| | NEED_SUPPLEMENT | 需补充材料或说明 |
| | INSUFFICIENT | 信息不足，暂不具备条件 |
| risk_finding.category | OPERATING | 经营 |
| | CASH_FLOW | 现金流 |
| | DEBT | 债务 |
| | GOVERNANCE | 治理 |
| | COMPLIANCE | 合规 |
| | CONCENTRATION | 集中度 |
| | OTHER | 其他 |
| risk_finding.severity | HIGH | 高 |
| | MEDIUM | 中 |
| | LOW | 低 |
| review_task.target_type | DOCUMENT | 资料 |
| | DATA | 数据 |
| | ASSESSMENT | 评估 |
| | REPORT | 报告 |
| review_task.status | PENDING | 待处理 |
| | IN_PROGRESS | 处理中 |
| | APPROVED | 通过 |
| | CHANGES_REQUESTED | 要求修改 |
| | REJECTED | 退回 |
| | CANCELLED | 已取消 |
| review_record.decision | APPROVE | 通过 |
| | REQUEST_CHANGES | 要求修改 |
| | REJECT | 退回 |
| report_version.status（V1.1 由 report 下沉） | DRAFT | 草稿（可重生成） |
| | IN_REVIEW | 复核中（内容冻结） |
| | APPROVED | 复核通过，待签发 |
| | ISSUED | 已签发（具对外效力） |
| | DELIVERED | 已交付（终态） |
| | VOID | 已作废（终态，理由必填） |
| report_version.delivery_method | EMAIL | 邮件发送 |
| | DOWNLOAD | 客户自助下载 |
| | ONSITE | 现场交付 |
| | OTHER | 其他 |
| ai_task.task_type | DOC_CLASSIFY | 资料分类 |
| | FIELD_EXTRACT | 字段提取 |
| | TX_CLASSIFY | 流水分类 |
| | METRIC_EXPLAIN | 指标解释 |
| | RISK_DRAFT | 风险事项草稿 |
| | REPORT_DRAFT | 报告文字草稿 |
| ai_task.status | PENDING | 待执行 |
| | RUNNING | 执行中 |
| | SUCCEEDED | 成功 |
| | FAILED | 失败 |
| | TIMEOUT | 超时 |
| | CANCELLED | 已取消 |
| ai_suggestion.suggestion_type | DOC_CLASSIFY | 资料分类建议 |
| | FIELD_EXTRACT | 字段提取建议 |
| | TX_CATEGORY | 流水分类建议 |
| | QUALITY_HINT | 质量问题提示 |
| | METRIC_EXPLAIN | 指标解释文本 |
| | RISK_DRAFT | 风险事项草稿 |
| | REPORT_DRAFT | 报告文字草稿 |
| ai_suggestion.status | PENDING | 待处置 |
| | ACCEPTED | 已采纳 |
| | REJECTED | 已拒绝 |
| | SUPERSEDED | 已被新建议替代 |
| audit_log.actor_type | USER | 用户 |
| | SYSTEM | 系统 |
| | ANON | 未认证 |
| audit_log.result | SUCCESS | 成功 |
| | DENIED | 被拒绝（权限/授权） |
| | FAILED | 失败（异常） |
| field_dictionary.data_type | STRING | 文本 |
| | DECIMAL | 小数 |
| | INTEGER | 整数 |
| | DATE | 日期 |
| | DATETIME | 时间 |

**V1.1 新增枚举**

| 表.字段 | 取值 | 中文含义 |
|---|---|---|
| data_version.trigger_type | INITIAL | 首次建立（案件受理后第一批资料） |
| | DOCUMENT_ADDED | 新增文件 |
| | DOCUMENT_REPLACED | 文件被替换（产生新版本） |
| | DOCUMENT_REMOVED | 文件被移除 |
| | MANUAL_CORRECTION | 人工修正数据 |
| data_version.status | ACTIVE | 当前版本 |
| | SUPERSEDED | 已被后续版本取代 |
| analysis_round.status | DRAFT | 草稿（已绑定数据版本，数据未确认可算） |
| | DATA_READY | 数据就绪（批次终态、无 BLOCKER） |
| | COMPUTED | 已计算（指标快照已锁定） |
| | ASSESSED | 已评估（结论与风险事项已产出） |
| | CLOSED | 已定稿（可被报告版本引用） |
| | SUPERSEDED | 已被取代（未定稿即被新轮或案件终止替掉） |
| analysis_round.supersede_reason | NEW_DATA | 新数据版本产生 |
| | CASE_TERMINATED | 案件终止（撤回/不予服务） |
| case.hold_from | INTAKE / AUTHORIZATION / COLLECTING / ANALYZING / REVIEW / DELIVERED / CLOSED | 挂起前所处状态（不含 ON_HOLD 与三个终态） |
| verification_item.category | DIFFERENCE | 差异（两处数字对不上） |
| | MISSING | 缺失（应有未提供） |
| | CALIBER | 口径冲突（同一指标两种算法） |
| | FIELD_ANOMALY | 字段异常（值越界、格式异常） |
| verification_item.severity | HIGH | 高（必须澄清，报告须披露） |
| | MEDIUM | 中 |
| | LOW | 低 |
| verification_item.status | OPEN | 待答复 |
| | ANSWERED | 已答复，未判定是否足以消解 |
| | RESOLVED | 已解决（结论由人给出） |
| | WAIVED | 已豁免（报告须在"已豁免事项"列出） |
| verification_item.answer_source | ORAL | 口头答复 |
| | WRITTEN | 书面答复 |
| evidence_ref.target_type | METRIC | 指标（报告中的数字） |
| | VERIFICATION_ITEM | 待核实事项 |
| | RISK_FINDING | 风险事项 |
| | ASSESSMENT | 准备度评估（某一维的依据） |
| | REPORT_CLAUSE | 报告条款（段落级结论） |
| evidence_ref.evidence_kind | SOURCE_DOCUMENT | 原始文件（页码） |
| | EXTRACTED_FIELD | 提取字段（页/行） |
| | DATA_ROW | 结构化数据行（行号） |
| | CALCULATION | 计算结果（公式码 + 版本） |
| | RULE_HIT | 规则命中（规则码） |
| | HUMAN_REVIEW | 人工复核（复核记录） |
| | EXTERNAL_PUBLIC | 公开信息（URL + 快照时间） |
| evidence_ref.source_object_type | DOCUMENT_VERSION | 文件版本 |
| | STATEMENT_ITEM | 报表科目行 |
| | BANK_TRANSACTION | 银行流水行 |
| | DEBT_RECORD | 债务记录 |
| | METRIC | 财务指标 |
| | REVIEW_RECORD | 复核记录 |
| | NONE | 无来源对象（仅 locator，如公开信息） |

### 17.3 不受 CHECK 约束的编码（Java 枚举 / 字典维护）

这些列取值会持续增长，加 CHECK 等于每次扩展都要发 DDL，因此只由代码或字典保证。

| 列 | 维护方式 | 首批取值示例 |
|---|---|---|
| `cpx_financial_metric.metric_code` | Java `MetricCode` 枚举 | `REVENUE` 营业收入、`GROSS_PROFIT_RATIO` 毛利率、`NET_PROFIT_RATIO` 净利率、`CURRENT_RATIO` 流动比率、`QUICK_RATIO` 速动比率、`DEBT_TO_ASSET_RATIO` 资产负债率、`INTEREST_COVERAGE_RATIO` 利息保障倍数、`DEBT_SERVICE_COVERAGE_RATIO` 偿债备付率、`AR_TURNOVER_DAYS` 应收账款周转天数、`INVENTORY_TURNOVER_DAYS` 存货周转天数、`AP_TURNOVER_DAYS` 应付账款周转天数、`CASH_CONVERSION_CYCLE` 现金转换周期、`OPERATING_CASH_FLOW` 经营活动现金流、`OCF_TO_DEBT_RATIO` 经营现金流对债务比、`CUSTOMER_CONCENTRATION_RATIO` 客户集中度、`SUPPLIER_CONCENTRATION_RATIO` 供应商集中度、`CASH_POSITION` 期末现金 |
| `cpx_data_quality_issue.rule_code` | Java 规则枚举 | `DQ-DOC-01` 资料缺页、`DQ-STMT-01` 报表不平、`DQ-STMT-02` 期间缺失、`DQ-REV-01` 收入与流水不匹配、`DQ-TXN-01` 流水断档、`DQ-DEBT-01` 债务余额与流水不符 |
| `cpx_verification_item.code`（V1.1 新增） | Java 规则枚举 | `VI-REV-01` 收入与回款差异、`VI-DOC-01` 文件缺页、`VI-CAL-01` 口径不一致、`VI-FLD-01` 字段值异常 |
| `cpx_evidence_ref.formula_code`（V1.1 新增） | Java `MetricCode` / 规则码，与 `metric_code` 同一套 | 取值为 `metric_code` 全集或 `DQ-*` 规则码，不另立命名空间 |
| `cpx_data_import.import_type` 之外的 `doc_type` / `material_code` | `cpx_material_requirement` 字典 | `BANK_STATEMENT_12M`、`TAX_RETURN_ANNUAL`、`CREDIT_REPORT`、`AUTHORIZATION_LETTER`、`DEBT_CONTRACT` |
| `cpx_audit_log.action` | Java `AuditAction` 枚举 | `LOGIN`、`LOGIN_FAILED`、`LOGOUT`、`CASE_VIEW`、`CASE_STATUS_CHANGE`、`DOCUMENT_UPLOAD`、`DOCUMENT_DOWNLOAD`、`DOCUMENT_VERIFY`、`DOCUMENT_REJECT`、`DOCUMENT_DELETE`、`AUTHORIZATION_GRANT`、`AUTHORIZATION_REVOKE`、`ASSESSMENT_CHANGE`、`REPORT_ISSUE`、`REPORT_DELIVER`、`REPORT_REDELIVER`、`AI_SUGGESTION_ACCEPT`、`FILE_PURGE_PLAN`、`FILE_PURGED`、`AUDIT_ARCHIVE`；V1.1 新增 `DATA_VERSION_CREATED`、`DATA_VERSION_DUPLICATE`、`DATA_VERSION_REACTIVATED`、`ROUND_OPENED`、`ROUND_SUPERSEDED`、`VERIFICATION_ITEM_TRANSITION`、`EVIDENCE_CHECK_FAILED` |
| `cpx_bank_transaction.category_code` | 现金流分类枚举 | `SALES_RECEIPT` 销售收款、`PURCHASE_PAYMENT` 采购付款、`PAYROLL` 薪酬、`TAX_PAYMENT` 税费、`LOAN_INFLOW` 借款流入、`LOAN_REPAYMENT` 还款、`INTEREST_PAYMENT` 利息、`RELATED_PARTY` 关联方、`OTHER` 其他 |

---

## 十八、敏感字段与脱敏规则

### 18.1 分级

| 级别 | 定义 | 处置 |
|---|---|---|
| L1 禁止入库 | 明文密码、明文身份证号、明文银行卡完整号 | 一律不存 |
| L2 加密存储 | 手机号、邮箱等可还原的个人信息 | AES-256-GCM 密文 + 后四位/哈希索引列 |
| L3 脱敏存储 | 银行账号、对方账号、接收人联系方式 | 只存后四位 + HMAC 哈希，不存明文 |
| L4 受限访问 | 财务数据、征信类数据、合同号 | 明文入库，但按角色控制读取与导出，且导出留审计 |
| L5 公开 | 企业名称、统一社会信用代码 | 无限制 |

### 18.2 字段级清单

| 表.字段 | 级别 | 库内形态 | 接口返回 | 日志 / AI 入参 |
|---|---|---|---|---|
| cpx_user.password_hash | L1 派生 | BCrypt 哈希 | 永不返回 | 永不输出 |
| cpx_contact.name | L2 | 明文 | 全名（ADMIN/REVIEWER），`张*`（其他） | `张*` |
| cpx_contact.mobile_ciphertext / _last4 / _hash | L2 | 密文 + 后四位 + HMAC | `138****5678` | `138****5678` |
| cpx_contact.email | L2 | 明文 | `a***@example.com` | 同左 |
| cpx_customer.legal_representative | L2 | 明文 | 全名；列表页 `张*` | `张*` |
| cpx_customer.address | L2 | 明文 | 详情页全量；列表页只到区县 | 只到区县 |
| cpx_bank_transaction.account_no_last4 | L3 | 后四位 | `**** 1234` | `**** 1234` |
| cpx_bank_transaction.account_no_hash | L3 | HMAC-SHA256（密钥独立） | 不返回 | 不输出 |
| cpx_bank_transaction.counterparty_name | L3 | 明文 | 全称（有权限）/ 前两字 + `**` | 前两字 + `**` |
| cpx_bank_transaction.counterparty_account_last4 | L3 | 后四位 | `**** 5678` | `**** 5678` |
| cpx_bank_transaction.summary | L3 | 明文 | 原样（可能含个人信息，按角色） | 脱敏后送 AI |
| cpx_debt_record.*（整表） | L4 | 明文 | 仅 ADMIN/REVIEWER | 仅送聚合数字，不送合同号与债权人全称 |
| cpx_financial_statement_item.amount | L4 | 明文 | 有权限角色可见 | 可送 |
| cpx_financial_metric.value_* | L4 | 明文 | 全部角色可见（报告数字） | 可送 |
| cpx_data_import_record.raw_data / parsed_data | L4 | 入库前按字段字典 `is_sensitive` 脱敏 | 不直接返回 | 不送 |
| cpx_ai_execution_log.request_payload | L4 | 入库前脱敏 | 不返回 | — |
| cpx_audit_log.ip | L2 | inet | `192.168.*.*` | 不输出 |
| cpx_audit_log.detail | L4 | 入库前脱敏 | 按角色 | 不送 |
| cpx_report_version.delivered_to_name / _contact | L2 | 明文 / 脱敏 | 全名 + `138****5678` | 不送 |
| cpx_ai_suggestion.payload | L4 | 可能含原文片段，入库前脱敏 | 处置页可见 | — |
| cpx_verification_item.observation / answer_note / resolution（V1.1） | L4 | 明文（可能引用具体金额、往来方、期间） | 仅 ADMIN/REVIEWER | 脱敏后送 AI（人名、账号、往来方全称按 18.4 规则替换） |
| cpx_evidence_ref.note（V1.1） | L4 | 明文，限 200 字 | 按角色 | 不送 |
| cpx_data_version.digest（V1.1） | L5 | 哈希 | 可见 | 可送（不可逆） |

### 18.3 身份证号：不采集

系统首期**不采集身份证号**，理由是融资准备服务不需要核身，采集即产生无对价的合规负担（《个人信息保护法》最小必要原则）。若未来因开户或授权签署需要，落库规则固定为：`{field}_ciphertext bytea` + `{field}_last4 char(4)`，禁止明文列，禁止出现在任何日志与 AI 入参。

`cpx_field_dictionary.is_sensitive = true` 且 `mask_rule` 非空的字段，解析器在写入 `raw_data` / `parsed_data` 前必须调用统一脱敏器，这是唯一允许的脱敏入口——分散在各解析器里写脱敏，必然有一处漏掉。

### 18.4 脱敏规则码

| 规则码 | 规则 | 示例 |
|---|---|---|
| `LAST4` | 只留后四位 | `6222****1234` |
| `NAME` | 保留姓，其余星号 | `张*`、`欧阳**` |
| `PHONE` | 前 3 后 4 | `138****5678` |
| `EMAIL` | 保留首字符与域名 | `a***@example.com` |
| `COMPANY` | 保留前两字 | `深圳**科技有限公司` |
| `ADDRESS` | 只到区县 | `广东省深圳市南山区` |
| `IP` | 保留前两段 | `192.168.*.*` |
| `HASH` | 不返回，仅内部比对 | — |

---

## 十九、命名规范与保留字

### 19.1 强制规则

1. 表名单数、snake_case、`cpx_` 前缀。`cpx_user` 而非 `cpx_users`。
2. 字段名不得出现大写、空格、中文、拼音缩写。
3. 布尔字段以 `is_` / `has_` 开头，禁止 `flag`、`yn`、`status_flag`。
4. 时间点 `_at`，日历日期 `_on`，有效期区间 `_from` / `_to`。同一个语义只能有一种后缀。
5. 金额 `_amount`，比率 `_ratio`，天数 `_days`，编号 `_no`，版本号 `version_no`，乐观锁 `version`。
6. 外键列名 = 目标实体名 + `_id`，且与目标表主键语义一致（`document_version_id` 指向 `cpx_document_version.id`）。
7. 不使用 `data`、`info`、`value`、`type`、`name` 作为单独列名——必须带限定词（`raw_data`、`value_amount`、`debt_type`、`legal_name`）。唯一例外是 `cpx_financial_statement_item.amount`，因为该表上下文已完全限定"科目金额"。
8. 索引与约束必须具名，禁止依赖 PG 自动命名（自动名不可预测，回滚脚本无法引用）。

### 19.2 保留字与易踩坑词

PostgreSQL 允许部分关键字作列名（加引号即可），但 MyBatis XML、JPQL、前端代码生成器会因此报错或产生歧义。**一律禁止**用作列名或表名。

| 词 | 风险 | 本项目的替代写法 |
|---|---|---|
| user | 保留字（`USER` 是当前用户函数） | `cpx_user` 作表名可以，列名用 `actor_user_id` / `owner_user_id`，禁止 `user` |
| order | 保留字 | `sort_no`、`display_order` |
| case | 保留字 | `cpx_financing_case`；列名用 `financing_case_id` |
| group | 保留字 | `category_code`、`role_group` |
| check | 保留字 | `verification_state` |
| default | 保留字 | `is_default` |
| desc / asc | 保留字 | `description` |
| end / start | 保留字 | `valid_to` / `valid_from`、`started_at` |
| limit / offset | 保留字 | `max_retry`、`page_size`（不入库） |
| references | 保留字 | `evidence_refs` |
| authorization | 保留字（SQL 语句） | `cpx_case_authorization` 作表名可用，列名避免裸 `authorization` |
| current_date / current_user | 函数名 | 禁止作列名 |
| version | 非保留字，但易与 `version()` 函数混淆 | 只用于乐观锁；业务版本用 `version_no` |
| key | PostgreSQL 中非保留字，但 SQL 标准保留、多数 ORM 与前端代码生成器会误判 | 用 `idempotency_key`、`dedupe_key` |
| status | 非保留字 | 可用，但每张表只能有一个 `status`，其余状态列必须限定（`verification_state`、`parse_status`） |

最后一条是本项目最容易出错的地方：一个表出现两个 `status` 语义不同的列（例如既想表达"报告状态"又想表达"版本状态"），一定要拆表或改名，不要在代码里靠注释区分。

---

## 二十、Java 类型映射

| PostgreSQL | Java | MyBatis / Jackson 说明 |
|---|---|---|
| uuid | `java.util.UUID` | 需注册 `UUIDTypeHandler`；JSON 序列化为字符串 |
| varchar / text | `String` | — |
| char(n) | `String` | 注意尾部空格，本项目 `char` 只用于定长哈希与后四位 |
| bigint（identity） | `Long` | 主键用 `Long`，禁用 `long`（需表达"未持久化"） |
| integer | `Integer` | — |
| smallint | `Integer` | MyBatis 默认映射即可；不要用 `Short` |
| numeric(18,2) | `java.math.BigDecimal` | 序列化为字符串（A-02）；比较用 `compareTo` |
| numeric(10,6) / numeric(5,4) | `java.math.BigDecimal` | 同上；禁止 `double` |
| timestamptz | `java.time.Instant` | JDBC 4.2 原生支持；连接串 `TimeZone=UTC` |
| date | `java.time.LocalDate` | 业务日期，禁止转 `Instant` |
| boolean | `Boolean` | 可空列用包装类型 |
| jsonb | `String` 或 `com.fasterxml.jackson.databind.JsonNode` | 简单透传用 `String`（避免无谓解析），需要读字段时用 `JsonNode`；写入需 `::jsonb` 显式转换 |
| jsonb（数组） | `List<XxxRef>` + 自定义 TypeHandler | 仅在结构稳定时使用；结构不稳定的用 `JsonNode` |
| bytea | `byte[]` | 仅用于手机号密文 |
| inet | `String`（读写）或 `org.postgresql.util.PGobject` | 审计只需落库，读时转字符串 |
| varchar 枚举 | Java `enum` | 用 `EnumTypeHandler`；枚举名与数据库取值**逐字一致**，不做大小写转换 |

### 20.1 三条硬约束

1. **`numeric` 一律 `BigDecimal`，序列化为字符串**。返回 JSON 数字会让前端 `JSON.parse` 变成 IEEE 754 双精度，18 位金额必然丢精度。全局 `ObjectMapper` 配置 `WRITE_BIGDECIMAL_AS_PLAIN` + 自定义序列化器输出 `"1234567.89"`。
2. **`timestamptz` 一律 `Instant`**，禁止 `LocalDateTime`。`LocalDateTime` 不带时区，跨时区部署时"同一时刻"会变成两个值，而审计与状态事件的时间必须唯一。
3. **`jsonb` 写入必须显式 `CAST(#{v} AS jsonb)`**。MyBatis 把 `String` 当 `varchar` 发送时，PG 能隐式转换但某些驱动版本会报 `column is of type jsonb but expression is of type character varying`。这是本项目最容易在联调期浪费半天的坑，写进 Mapper 规范。

### 20.2 常用映射片段

| 场景 | 写法 |
|---|---|
| 状态机 UPDATE（乐观锁） | `update cpx_financing_case set lifecycle=#{to}, lifecycle_entered_at=now(), version=version+1 where id=#{id} and lifecycle=#{from} and version=#{version}`，返回 0 行即 409 |
| 开轮（幂等） | `insert into cpx_analysis_round(case_id, round_no, data_version_id, status) values (...) on conflict (case_id, data_version_id) do nothing returning id`，冲突即说明这一版已经开过轮 |
| 新建数据版本 | 同一事务内按 `UPDATE 旧版 set status='SUPERSEDED', superseded_at=now()` → `INSERT 新版` → `INSERT 成员` → `INSERT 轮次` 的顺序执行，否则 `uq_data_version_active` 会瞬时冲突 |
| 批量插入流水 | `insert ... on conflict (case_id, dedupe_key) do nothing`，靠唯一索引去重，不先查后插 |
| 幂等登记 | `insert into cpx_idempotency(...) values(...) on conflict (idempotency_key) do nothing returning *` |
| 读取当前指标 | `where superseded_at is null`，必须带此条件，否则会读到历史版本 |
| 审计批量写 | `insert into cpx_audit_log(...) values (...),(...)`，单批 ≤ 500 行，异步线程池提交 |

---

## 二十一、字典维护约定

1. `cpx_material_requirement`、`cpx_field_dictionary`、`cpx_role`、`cpx_permission` 的种子数据放在 Flyway `R__` 可重复迁移脚本中，用 `on conflict (code) do update` 保证幂等。
2. 字典变更必须写 `cpx_audit_log`（`action = 'DICT_CHANGE'`），并记录变更前后值——字典改动会改变守卫口径，属于需要解释的变更。
3. 字典的 `is_active = false` 只是停止新案件使用，**不回溯**已立案案件的 `cpx_case_material` 快照。这是"历史不被追溯改写"原则在字典层的落地。
4. `cpx_field_dictionary.alias_names` 的新增不要求发版，运营可直接维护；但每次新增别名后必须跑一次解析回归用例集，否则可能把"A 字段"匹配成"B 字段"。

---

## 二十二、V1.1 变更记录

修订依据：`product-baseline-v1.md` V1.0（修正 1/2/3）、`financing-domain-model.md`（六域 + 证据域、20 条不变量）、`financing-workflow.md` V2.0（五个状态机）、`er-design.md` V1.1。
修订方式：增量修改。V1.0 的 41 张表字段与全部命名规范保留；表总数 41 → 46，章节因新增第十六节后移一位（原十六至二十变为十七至二十一）。

### 22.1 新增表（5）

| 表 | 章节 | 字段数 | 主键 | 关键约束 |
|---|---|---|---|---|
| `cpx_data_version` | 16.1 | 10 | U | `UNIQUE (case_id, version_no)`、`UNIQUE (case_id, digest)`、部分唯一 `(case_id) WHERE status='ACTIVE'` |
| `cpx_data_version_member` | 16.2 | 4 | C | 复合主键 `(data_version_id, document_version_id)` |
| `cpx_analysis_round` | 16.3 | 16 | U | `UNIQUE (case_id, round_no)`、`UNIQUE (case_id, data_version_id)`、触发器保 `data_version_id` 不可变 |
| `cpx_evidence_ref` | 16.4 | 16 | B | 按 `evidence_kind` 分支的条件 CHECK、`uq_evidence_ref_unique` |
| `cpx_verification_item` | 16.5 | 26 | U | `UNIQUE (case_id, round_no, root_item_id)`、`UNIQUE (case_id, round_no, code)`、4 条状态一致性 CHECK |

### 22.2 修改的表（10）

| 表 | 字段级改动 |
|---|---|
| `cpx_financing_case` | `status` → `lifecycle`（18 值 → 10 值）；`status_entered_at` → `lifecycle_entered_at`；`archived_at` → `closed_at`；新增 `hold_from`、`previous_case_no`、`closing_note`；**删除 `data_version`** |
| `cpx_case_status_event` | `from_status`/`to_status` 取值集合改 10 值；`transition_code` 改五状态机动作号；`guard_code` 长度 8 → 16、正则可选 `G-C*/G-R*/G-P*/M*/V*` |
| `cpx_case_material` | 新增 `status`（7 值）、`status_entered_at`；**删除 `is_waived`**；`waiver_*` 判据改为 `status = 'WAIVED'` |
| `cpx_document_version` | `verification_state` 6 值 → 5 值（移除 `PARSE_FAILED`） |
| `cpx_data_import_record` | 新增 `purged_at` |
| `cpx_financial_metric` | 新增 `data_version_id`；**删除 `data_version`**；当前值唯一索引加 `data_version_id` |
| `cpx_metric_snapshot` | 新增 `round_no`、`data_version_id`；**删除 `data_version`** |
| `cpx_assessment` | 新增 `round_no`；`is_current` 唯一域改 `(case_id, round_no)`；`dimensions` 五维重定义 |
| `cpx_risk_finding` | 新增 `case_id`、`round_no`；`assessment_id` 改可空；`finding_no` 唯一域改 `(case_id, round_no, finding_no)` |
| `cpx_report` / `cpx_report_version` | `status`、`issued_at`、`issued_by`、`voided_at`、`void_reason` 从容器下沉到版本；版本新增 `case_id`、`round_no`、`content_hash`、`evidence_check_result`、`replacement_version_no` |

### 22.3 新增枚举（14 组）

`data_version.trigger_type`、`data_version.status`、`analysis_round.status`、`analysis_round.supersede_reason`、`case.hold_from`、`case_material.status`、`verification_item.category / severity / status / answer_source`、`evidence_ref.target_type / evidence_kind / source_object_type`、`report_version.status`。全部进 17.2 枚举总表，`verification_item.code` 与 `evidence_ref.formula_code` 进 17.3 无 CHECK 编码清单。

### 22.4 新增敏感字段标记（5 个字段）

`cpx_verification_item.observation / answer_note / resolution`（L4）、`cpx_evidence_ref.note`（L4）、`cpx_data_version.digest`（L5，可直接展示）。无 L1/L2/L3 级新增字段——证据引用只存"指向哪里"，不复制内容。

### 22.5 与 `er-design.md` 的一致性核对点

写 Flyway 脚本时，以下五处两文必须逐字一致，任一不一致以本文为准并回改 `er-design.md`：

| # | 核对点 | 本文位置 | er-design 位置 |
|---|---|---|---|
| 1 | 五个新表的字段名与约束名 | 16.1–16.5 | 3.13–3.17 |
| 2 | `cpx_financing_case` 的 10 个 lifecycle 值与三条伴随列 CHECK | 17.1 | 6.1 |
| 3 | `cpx_evidence_ref` 的两条核心索引列序 | 16.4 末 | 3.16 |
| 4 | `cpx_report_version` 的三个哈希列语义 | 12.2 | 3.10 |
| 5 | 保留期四级分层的表归属 | 无（只在 er-design） | 8.1 |

### 22.6 需要注意的兼容性影响

| 影响 | 说明 |
|---|---|
| 前端与接口字段 | 案件 `status` → `lifecycle`、资料项从"推导状态"改为"落库状态"，接口响应字段需同步改名；建议接口层先保留 `status` 别名一个迭代，再移除 |
| MyBatis 映射 | 删除的三列（`case.data_version`、`metric.data_version`、`snapshot.data_version`）若仍出现在 Mapper 中会直接报列不存在，必须同批清理 |
| 报表与统计 SQL | 任何按 `status` 分组统计案件进度的查询全部失效，需改按 `lifecycle` + 轮次/报告状态组合计算（进度是投影，不落库） |
| 既有测试数据 | 旧 18 值 → 新 10 值的映射有信息损失，映射脚本必须先建轮次再改案件列（见 `er-design.md` 3.1.1、11 节 V18–V20） |
