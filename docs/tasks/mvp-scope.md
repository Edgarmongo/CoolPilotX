# CPX-MVP-01 首期任务卡与验收标准（V1.1）

- 编号：CPX-MVP-01
- 版本：V1.1（按 `docs/product/product-baseline-v1.md` V1.0 重写，取代 V1.0 任务卡）
- 状态：待确认
- 前置：`product-baseline-v1.md`（最高约束）、`financing-domain-model.md`（CPX-BIZ-01）、`financing-workflow.md` V2.0（CPX-BIZ-02）、`backend-module-boundaries.md`（CPX-ARCH-02）、`er-design.md` V1.1（CPX-DB-01）、`ADR-001-工程基线`
- 约束：本文只定义任务与验收，不含代码、不初始化工程、不建库

## 零、三条前提

| # | 前提 | 落地方式 |
|---|---|---|
| 0-1 | 阶段只有 CPX-01~CPX-06 六个，名称严格用产品基线第五节表述，不增不减 | 本文第三节标题逐字对齐 |
| 0-2 | 状态取值以 `financing-workflow.md` 为准，旧单状态字段（`DRAFT`/`DOCUMENT_REVIEW`/`SUBMITTED`/`AUTHORIZATION_PENDING`/`DATA_EXTRACTION`/`DATA_QUALITY_CHECK`/`MANUAL_REVIEW`/`REPORT_PENDING`/`APPROVED` 等）全部废弃 | 任何代码、接口、枚举、迁移里出现旧值即视为缺陷；`ck_financing_case_status` 随迁移 DROP |
| 0-3 | **AI 不是首期前置条件**（产品基线第五节） | 所有 AI 相关子任务标注「可选增强」，不进入关键路径、不计入基线工期；关闭 AI 后六张卡全部验收项仍须通过 |

**五个生命周期与状态取值（唯一口径）**

| 生命周期 | 状态取值 | 聚合根 | 表 |
|---|---|---|---|
| 案件 | `INTAKE` `AUTHORIZATION` `COLLECTING` `ANALYZING` `REVIEW` `DELIVERED` `CLOSED` + `ON_HOLD` `WITHDRAWN` `DECLINED` | `FinancingCase` | `cpx_financing_case.lifecycle` |
| 分析轮次 | `DRAFT` `DATA_READY` `COMPUTED` `ASSESSED` `CLOSED` `SUPERSEDED` | `AnalysisRound` | `cpx_analysis_round.status` |
| 报告版本 | `DRAFT` `IN_REVIEW` `APPROVED` `ISSUED` `DELIVERED` `VOID` | `Report`+`ReportVersion` | `cpx_report_version.status` |
| 资料项 | `REQUIRED` `REQUESTED` `RECEIVED` `PARSED` `VERIFIED` `WAIVED` `REJECTED` | `CaseMaterial` | `cpx_case_material.status` |
| 待核实事项 | `OPEN` `ANSWERED` `RESOLVED` `WAIVED` | `VerificationItem` | `cpx_verification_item.status` |

---

## 一、环境事实

### 1.1 已核实事实（2026-10-30 实测，沿用 V1.0，结论未变）

| 编号 | 项 | 实测值 | 对开发的影响 |
|---|---|---|---|
| F-01 | JDK | Java 21.0.5 | 满足 Spring Boot 4.0.8 最低要求，无需额外配置 |
| F-02 | Maven | 3.9.9 | 满足 Boot 4 的 Maven 3.6.3+ 要求 |
| F-03 | 依赖源 | Maven Central 不可直连；阿里云镜像可取到 Spring Boot 4.0.8 | **必须配 mirror**，否则 `mvn` 直接超时；禁止 `RELEASE` 与范围版本 |
| F-04 | PostgreSQL | 16.15 客户端已装，5432 在监听，`postgres` 用户认证失败 | 无法建库即无法执行里程碑 0，**第 1 个卡点** |
| F-05 | Docker | 29.8.0 守护进程运行中；已有 Milvus 容器但 19530 未暴露 | Milvus 不属本期，但需确认不是本项目占用 |
| F-06 | Python | 3.13.14 可用；`fastapi`/`pandas`/`openpyxl`/`pdfplumber` 均未安装 | wheel 兼容风险；架构基线为 3.12 |
| F-07 | Node | 22.22.2 可用 | 满足 Vite 5+；`npm` 源待确认 |
| F-08 | 未核实 | JDK 发行版、磁盘空间、8080/8000/5433 占用、系统时区 | 见 1.2 |

### 1.2 待确认清单 E-01~E-13

每条必须留下「命令 + 原始输出」，写入 `docs/env/verified.md`。**未确认项不得以默认值推进。**

| 编号 | 待确认 | 确认命令 | 通过标准 | 阻塞 |
|---|---|---|---|---|
| E-01 | `postgres` 超级用户口令 | `psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -c "select version();"` | 返回 `PostgreSQL 16.15` | M0 |
| E-02 | 是否新建库 `coolpilotx` 与专用账号 `cpx` | `psql -U postgres -c "\l"` / `\du` | 无同名库与角色；确定由 `cpx` 跑应用 | M0 |
| E-03 | 字符集与时区 | `psql -U postgres -c "show server_encoding; show timezone;"` | `UTF8`；时区任意（连接串强制 UTC） | M0 |
| E-04 | Maven 镜像 | `cat ~/.m2/settings.xml` `mvn -v` | 存在指向阿里云 `.../repository/public` 的 `<mirror>` | M0 |
| E-05 | 依赖可解析 | `mvn dependency:get -Dartifact=org.springframework.boot:spring-boot-starter-web:4.0.8` | `BUILD SUCCESS` | M0 |
| E-06 | Docker Compose | `docker compose version` | ≥ 2.20（`condition: service_healthy`） | M0 |
| E-07 | 基础镜像可拉取 | `docker pull postgres:16-alpine` `docker pull eclipse-temurin:21-jre-alpine` | 均成功 | M0 |
| E-08 | 端口占用 | `netstat -ano \| findstr ":5432 :5433 :8080 :8000 :80"` | 5433/8080/8000 空闲 | M0 |
| E-09 | pip 源 | `python -m pip config list`；`pip download fastapi -d ./tmp/pipchk --no-deps` | 源可访问、无需 VPN | CPX-03（可选增强） |
| E-10 | Python 版本决策 | `python -c "import sys;print(sys.version)"`；`py -0p` | 确认 3.12 是否存在；3.13 需实测 `pdfplumber`/`openpyxl` cp313 wheel | CPX-03 |
| E-11 | Milvus 容器归属 | `docker ps -a --format "{{.Names}}\t{{.Image}}\t{{.Ports}}"` | 确认与本项目无关或记录占用端口 | 不阻塞 |
| E-12 | npm 源与磁盘 | `npm config get registry`；`Get-PSDrive D` | 源可用；可用空间 ≥ 20GB | CPX-01d |
| E-13 | 系统时区 | `Get-TimeZone` | 记录实值；后端强制 UTC，展示层 `Asia/Shanghai` | 不阻塞 |

### 1.3 开工闸门

| 闸门 | 条件 | 不满足时 |
|---|---|---|
| G-ENV | E-01~E-08 全部有记录且通过 | 停在环境阶段，不写任何代码 |
| G-M0 | 里程碑 0 的 M0-A1~A6 全绿 | 不进 CPX-01 |
| G-CARD | 上一张卡全部验收项通过且回归绿 | 不开下一张卡 |

**硬规则**：环境未确认前只做里程碑 0。M0 自身依赖 E-01~E-08，「先建库、再验证、最后写业务」是唯一顺序。

---

## 二、里程碑 0：空工程验证（最先做）

### 2.1 为什么必须先做

「Spring Boot 4.0.8 + MyBatis + Flyway + PostgreSQL 16」这一组合有三个已知不确定点（MyBatis Starter 是否适配 Boot 4、Flyway 10+ 的数据库模块拆分、Boot 4 抬升到 Jakarta EE 11 后的第三方兼容）。若把验证推到 CPX-01 之后，这三个风险会在业务代码写了几千行之后同时爆炸，届时无法区分「框架不兼容」与「业务代码写错」。M0 用半天把风险提前到第 1 天，并顺带产出 E-01~E-13 的记录。本阶段不写业务表、不写业务逻辑、不建 `cpx_` 业务表。

### 2.2 交付物

| 编号 | 交付物 | 说明 |
|---|---|---|
| M0-D1 | `backend/pom.xml` | 版本全部锁定；web/jdbc/validation/actuator/flyway-core/flyway-database-postgresql/postgresql/mybatis |
| M0-D2 | `V1__baseline.sql` | 仅 `cpx_health_probe(id int primary key, note varchar(64), created_at timestamptz default now())` 与 `cpx_touch_updated_at()` |
| M0-D3 | `HealthProbeMapper` | 一个 `select now()`、一个 `count(*)` |
| M0-D4 | `GET /internal/probe/db` | 返回 `{dbNow, probeRows, flywayVersion}` |
| M0-D5 | `docker-compose.dev.yml` | 仅 `postgres:16-alpine`，宿主 `127.0.0.1:5433`，卷 `cpx-pgdata` |
| M0-D6 | `docs/env/verified.md` | E-01~E-13 命令与原始输出 |

### 2.3 验收标准

| 编号 | 断言 | 判定 |
|---|---|---|
| M0-A1 | 构建通过且产物存在 | `mvn -q clean package` 退出码 0，`target/*.jar` 存在 |
| M0-A2 | 版本锁定无冲突 | `mvn dependency:tree` 中 `spring-boot` 为 `4.0.8`；无 `omitted for conflict`；`effective-pom` 无 `LATEST`/`RELEASE` |
| M0-A3 | 服务可启动 | `GET /actuator/health` 返回 `{"status":"UP"}` 且 HTTP 200 |
| M0-A4 | 迁移成功 | `select version, success from flyway_schema_history` 1 行且 `success=true`；`\dt` 含 `cpx_health_probe` |
| M0-A5 | MyBatis 可读写 | `dbNow` 与 `psql -c "select now()"` 差值 < 5s；`probeRows` 为整数 |
| M0-A6 | 失败即停 | 任一失败则产出「现象 + 报错栈 + 候选方案」记录，不进入 CPX-01 |

### 2.4 工作量与风险

0.5 人日（含环境确认）。三条风险与预案：MyBatis Starter 不适配 Boot 4 → 回退手工装配 `SqlSessionFactoryBean` + `MapperScannerConfigurer`；Flyway 报 `Unsupported Database` → 显式引入 `flyway-database-postgresql` 且与 `flyway-core` 版本完全一致；第三方不兼容 → M0 只验最小集，其余依赖在各卡首次引入时单独验。

---

## 三、首期任务卡 CPX-01~CPX-06

通用约定：验收标准均为可直接写成测试的断言，「接口 + 迁移」与「页面」分属不同子任务；卡片内列为「不包含」的内容一律不写，即使只差一行。所有卡片默认遵守第五节的纪律，不重复列。

### CPX-01 客户与案件管理

| 项 | 内容 |
|---|---|
| 目标 | 能登记企业、创建融资案件；案件生命周期状态机可驱动，列表「进度」是只读投影 |
| 交付物 | `common`/`infrastructure`/`identity`/`audit`/`customer`/`case` 六包；迁移 V1–V4、V15、V16；`/api/auth/*`、`/api/me`、`/api/customers`、`/api/cases`（创建/详情/流转/时间线）、`/api/dictionaries/lifecycles`；ArchUnit 断言 A-01~A-16；前端登录页、客户列表与编辑页、案件列表与详情页 |
| 前置 | M0 全绿；G-ENV 通过 |
| 关键实现要点 | 聚合 `Customer`(含 `Contact`)、`FinancingCase`(含 `FinancingRequirement` 版本链)。表：`cpx_customer`、`cpx_contact`、`cpx_financing_case`(`lifecycle`/`hold_from`/`previous_case_no`/`closing_note`/`version`)、`cpx_financing_requirement`(`version_no`/`is_current`/`change_reason`)、`cpx_case_status_event`(`seq_no`/`transition_code`/`guard_code`/`guard_result`)、`cpx_case_material`(立案快照 8 项 `REQUIRED`)。①转换表为启动时构建的不可变结构，缺失转换抛异常。②守卫为纯函数，入参 `GuardContext` 由 `AuthorizationQueryPort`/`MaterialReadinessPort`/`QualityGatePort` 组装，不读库、不读时钟。③本卡只启用 C01/C02/C11/C12/C13/C14；其余转换登记为 `GUARD_NOT_IMPLEMENTED` 并阻断，**禁止写死 `return true`**，随卡逐个启用。④每次流转写 `cpx_case_status_event` 与 `AuditPort`，`seq_no` 案件内单调。⑤`case_no` 由数据库序列 + 年份生成，`uq_financing_case_no` 兜底。⑥`progress(caseId)` 按 workflow §四 的 14 条优先级只读计算，库中不得存在 `progress`/`display_status` 列 |
| 验收标准 | ① 100 并发建案：`case_no` 全部匹配 `^CPX-\d{4}-\d{4}$`，`count(distinct case_no)=100`。<br>② `purpose` 为空提交：422 `GUARD_FAILED`，`guard=G-C1`，`blockingItems` 含 `purpose`，`cpx_case_status_event` 无新增。<br>③ 请求 `INTAKE→ANALYZING`：422 `ILLEGAL_TRANSITION`，事件表无新增。<br>④ 本卡请求 C04：422 `GUARD_NOT_IMPLEMENTED`（证明未启用转换被阻断而非放行）。<br>⑤ C11 缺 `holdReason`：422；挂起后 `lifecycle=ON_HOLD` 且 `hold_from` 非空；C12 恢复后回到 `hold_from`。<br>⑥ 两个并发请求携带同一 `expectedVersion`：一个 200、一个 409 `STATE_CONFLICT`，`version` 只 +1。<br>⑦ 同 `Idempotency-Key` 重放 C02：返回 200 + `Idempotent-Replay: true`，事件表不新增。<br>⑧ 立案后 `cpx_case_material` 中 `requirement_level='REQUIRED'` 恰 8 行，且 `requirement_level` 已快照（改字典不回溯该案件）。<br>⑨ `information_schema.columns` 查 `cpx_financing_case` 不含 `status`/`progress`/`display_status` 列。<br>⑩ ArchUnit A-01~A-16 全绿且 `@Ignore` 计数为 0 |
| 不包含 | 密码找回、邮箱/短信验证、OAuth/SSO、多租户、客户门户、客户批量导入、案件删除、需求变更审批流、`CLOSED` 重开、跨案件复制 |
| 人日 | 4.5（子任务 1.5 + 1.5 + 1.0 + 0.5） |
| 风险 | 中高。状态机是全系统最高频变更代码，守卫若在本卡写成"读库判断"，CPX-02/CPX-04/CPX-06 每次加守卫都要返工；投影若被落库，立刻产生第二份真相 |

| 子任务 | 范围 | 验收点 | 人日 |
|---|---|---|---|
| CPX-01a | 工程底座：pom、统一响应与全局异常、`AuditPort`、迁移 V1–V4/V15/V16、登录与失败锁定、ArchUnit 16 条 | 未带令牌访问 `/api/customers` 返回 401 `UNAUTHENTICATED`；连续 5 次错密后第 6 次 423 `ACCOUNT_LOCKED` 且 `LOGIN_FAILED` 审计 5 条；`mvn test` 中 A-01~A-16 全绿；`flyway_schema_history` 全部 `success=true` | 1.5 |
| CPX-01b | `customer`+`case` 聚合：信用代码部分唯一、主联系人部分唯一、需求版本链、`case_no` 生成 | 重复信用代码 409 `DUPLICATE_CREDIT_CODE`；第二个 `is_primary=true` 触发数据库冲突并返回 409；改需求产生 `version_no=2` 且 `change_reason` 必填、旧行 `is_current=false`；100 并发编号唯一 | 1.5 |
| CPX-01c | 生命周期状态机内核（C01/C02/C11–C14）+ 投影 + 时间线 + 审计 | 6 个动作全绿；非法转换 422；`expectedVersion` 并发一成一败；投影 14 条优先级表驱动单测全绿；时间线 `seq_no` 连续无空洞 | 1.0 |
| CPX-01d | 前端：登录页、客户列表/编辑、案件列表（投影列）、案件详情与时间线 | 5 步可点击路径全部通过；列表按 `lifecycle` 过滤的返回行数与 API 一致；`size=1000` 返回 400 | 0.5 |

### CPX-02 授权与资料管理

| 项 | 内容 |
|---|---|
| 目标 | 能记录授权范围、上传并管理文件版本；资料项状态与文件版本驱动数据版本，授权缺失在服务端硬拦截 |
| 交付物 | `authorization`/`document`/`evidence` 三包（`evidence` 本卡只交付 `DataVersion`+`VersionMember`+`DigestCalculator`）；迁移 V5、V6、V18（E 域三表中本卡用两张）；`/api/cases/{id}/authorizations`（登记/撤销/查询）、`POST /api/cases/{id}/documents`（流式）、`GET /api/documents/{id}/versions/{n}/content`、`POST /api/documents/{id}/versions/{n}/verify`、`GET /api/cases/{id}/materials`；`StoragePort`+`LocalStorageAdapter`；前端授权登记页、资料清单页、上传组件 |
| 前置 | CPX-01 |
| 关键实现要点 | 聚合 `CaseAuthorization`(含 `AuthorizationScope`)、`CaseMaterial`、`Document`(含 `DocumentVersion`)、`DataVersion`(含 `VersionMember`)。表：`cpx_case_authorization`、`cpx_case_authorization_scope`(EXCLUDE `daterange` 不重叠)、`cpx_document`、`cpx_document_version`、`cpx_document_review`、`cpx_case_material`(7 值 `status` 落库)、`cpx_data_version`、`cpx_data_version_member`。①授权拦截四点（解析入口、导入入口、AI 入口、报告导出入口）在服务端，`AuthorizationQueryPort` 必须带 `Instant at` 且无默认值。②落盘顺序：写 `storage/tmp` 边写边算 SHA-256 → `rename` → 提交元数据；`storage_key` 不含原始文件名。③`VERIFIED` 只能由人工推进；一个资料项挂多文件时，全部当前版本 `VERIFIED` 才可 M05。④**版本成员规则**：成员 = `verification_state ∈ {PARSED, VERIFIED}` 的当前文件版本，且 `data_scope` 非空（授权书等非分析资料不入成员）；同一事务内采纳的多个文件合并为一个版本。⑤`digest = sha256(join(';', 按成员 sha256 升序的 sha256+'|'+coalesce(scope_note,'')))`，由 `DigestCalculator` 单点实现。⑥INV-19 三种写入结果：与当前 `ACTIVE` 同 digest 不建版本；与历史 `SUPERSEDED` 同 digest 复用该版本置回 `ACTIVE`；其余新建。⑦`DocumentChanged` 为一致性事件（事务内），失败回滚资料变更 |
| 验收标准 | ① 无授权调用上传或解析：403 `AUTHORIZATION_REQUIRED`，`cpx_document_version`/`cpx_data_import` 无新增，审计 `DENIED` 1 条。<br>② 撤销授权后同一请求立即 403（同步查询生效，不等事件）。<br>③ 同 `dataScope` 插入重叠区间：数据库抛 `ex_auth_scope_no_overlap`，接口 409 `AUTH_SCOPE_OVERLAP`。<br>④ 上传文件名 `../../etc/passwd`：落盘仍在 `storage/documents` 下且路径不含 `..`；`sha256` 与库中一致。<br>⑤ 上传 51MB：413 `FILE_TOO_LARGE`，`storage/tmp` 无残留。<br>⑥ 同文档二次上传：`version_no=2`，v1 转 `SUPERSEDED` 且仍可下载。<br>⑦ `VERIFIED` 版本调用删除：409 `DOCUMENT_IMMUTABLE`；`UPLOADED` 可删且写 `DOCUMENT_DELETE` 审计。<br>⑧ 一个资料项挂 3 个文件只核验 2 个：状态停在 `PARSED`，齐备性返回 `2/3`；全部核验后转 `VERIFIED`。<br>⑨ `WAIVED` 缺 `waiverReason` 或 `waivedBy`：422，且 `ck_case_material_waiver` 无法绕过。<br>⑩ 重传内容完全相同的文件：202 `DUPLICATE_SUSPECTED`，`cpx_data_version` 行数不变（INV-19）。<br>⑪ 一次采纳 3 个文件：`cpx_data_version` +1、`cpx_data_version_member` +3，独立复算 `digest` 与库值相等。<br>⑫ 任意时刻 `select count(*) from cpx_data_version where case_id=? and status='ACTIVE'` = 1。<br>⑬ 数据集回到历史组合：复用历史版本并置 `ACTIVE`，`version_no` 不增，审计 `DATA_VERSION_REACTIVATED` |
| 不包含 | MinIO 适配器、断点续传、分片上传、在线预览、病毒扫描、水印、OCR、授权书的电子签章 |
| 人日 | 4.0（1.0 + 1.5 + 1.0 + 0.5） |
| 风险 | 中高。`digest` 若掺入 `document_version_id`，重传即产生假版本；成员集合若允许追加，旧报告的证据链会凭空多出文件 |

| 子任务 | 范围 | 验收点 | 人日 |
|---|---|---|---|
| CPX-02a | 授权聚合 + 范围 EXCLUDE + 四点拦截 + C03/G-C2 + C08 回退 | 无授权 403；撤销后立即 403；重叠区间 409；需求版本升到 v2 后 G-C2 为 false 并触发 C08 回到 `AUTHORIZATION` | 1.0 |
| CPX-02b | 上传与版本 + `StoragePort` + 资料项 M01–M09 + 齐备性 | SHA-256 一致；路径穿越被重写；`VERIFIED` 不可删；多文件 `n/m`；`WAIVED` 三字段齐全；齐备性一次查询返回全量 | 1.5 |
| CPX-02c | 数据版本与血缘：`DataVersion`+`VersionMember`+`DigestCalculator`+`DocumentChanged` 一致性事件 | INV-19 三种写入结果各 1 个用例；同事务多文件合并为 1 个版本；`ACTIVE` 恒为 1 行；成员不可增删（UPDATE 被拒绝） | 1.0 |
| CPX-02d | 前端：授权登记页（含范围勾选）、资料清单页（`n/m` 已核验、豁免入口）、上传组件 | 授权登记后范围列表与库一致；资料页显示「n/m 已核验」；豁免需填理由与批准人方可提交 | 0.5 |

### CPX-03 数据提取与质量检查

| 项 | 内容 |
|---|---|
| 目标 | 把上传的报表与流水变成结构化行，用可配置规则判定「这份数据能不能进入分析」，并识别缺失与冲突（规则提取，不含 AI 前置） |
| 交付物 | `dataimport`/`dataquality` 两包；解析器（Excel、文本层 PDF）；≥12 条质量规则；迁移 V7、V8；`POST /api/documents/{id}/imports`、`GET /api/imports/{id}`、`POST /api/imports/{id}/confirm`、`GET /api/cases/{id}/quality-issues`、`POST /api/quality-issues/{id}/resolve\|acknowledge\|waive`；`QualityGatePort` 实现；前端导入进度页、质量问题清单页 |
| 前置 | CPX-02；E-09/E-10 仅影响可选增强，不阻塞本卡主线 |
| 关键实现要点 | 聚合 `ImportBatch`(含 `ImportRecord`)、`QualityIssue`。表：`cpx_data_import`(PENDING/PARSING/PARSED/FAILED/CONFIRMED/ROLLED_BACK)、`cpx_data_import_record`(`source_row_no`/`parse_status`/`purged_at`)、`cpx_data_quality_issue`(`rule_code`/`rule_version`/`dedupe_key`/`severity`/`status`)。①同步受理 + 异步解析：接口 ≤2s 返回 202 + `importBatchId`。②双对账：行数与金额合计必须与源文件一致，不平整批 `FAILED`。③每 2000 行一个独立事务，`import_batch_id` 为业务回滚锚点，终态单独提交。④规则集至少含：必填列完整、合计勾稽、跨表勾稽（资产=负债+权益）、期间连续、金额方向合法、重复行、日期越界、科目缺失。⑤`dedupe_key = rule_code + target + 关键值`，重跑不重复登记。⑥扫描件（无文本层）识别为 `FAILED`/`SCANNED_NO_TEXT_LAYER`，文件版本保持 `UPLOADED`，**不得写入 `PARSE_FAILED`（该值已从枚举移除）**。⑦资料项 `RECEIVED→PARSED`（M04）由批次终态驱动；`G-R2` 由 `QualityGatePort` 提供「BLOCKER 且未 RESOLVED/WAIVED」计数 |
| 验收标准 | ① 黄金样例 xlsx 解析后 `row_count` 与源文件数据行数相等，金额合计差 = `0.00`。<br>② 人为删掉源文件一行后重跑：批次 `FAILED`/`ROW_COUNT_MISMATCH`，该批次在 `cpx_financial_statement_item` 与 `cpx_bank_transaction` 残留 0 行。<br>③ 同一数据版本连跑两遍规则：`cpx_data_quality_issue` 行数不变。<br>④ 存在 `OPEN` 或 `ACKNOWLEDGED` 的 `BLOCKER` 时 `QualityGatePort.blockers(caseId)` 非空，轮次保持 `DRAFT`（与 CPX-04 联调断言）。<br>⑤ 停掉 AI 服务后上传解析：批次正常 `PARSED`，`cpx_ai_suggestion` 无新增，案件 `lifecycle` 与请求前一致。<br>⑥ 3000 行 xlsx ≤20s；5 万行流水 ≤60s（10 次取样 P95）。<br>⑦ 扫描件 PDF：批次 `FAILED`/`SCANNED_NO_TEXT_LAYER`，`cpx_document_version.verification_state='UPLOADED'`。<br>⑧ 枚举一致性测试：Java `DataImportStatus`/`QualityIssueSeverity` 取值集合 == 数据库 CHECK 允许集合。<br>⑨ `GET /api/cases/{id}/quality-issues?size=50` P95 ≤800ms |
| 不包含 | 扫描件 OCR、多银行模板库、跨文件自动配对、解析结果可视化编辑器、AI 分类建议的采纳界面（可选增强另列） |
| 人日 | 4.0（1.0 + 1.0 + 1.5 + 0.5）；可选增强 0.5 不计入 |
| 风险 | 高。解析质量决定后续全部指标；5 万行 60s 是硬指标；Python 3.13 的 wheel 兼容性未验证（仅影响可选增强，主线用 Java 规则提取） |

| 子任务 | 范围 | 验收点 | 人日 |
|---|---|---|---|
| CPX-03a | 批次受理 + 异步线程池 + 分批入库 + 双对账 + Excel 报表解析 | 202 受理 ≤2s；行数与合计双对账不一致即整批 `FAILED` 且零残留；`success_count+failed_count <= row_count` | 1.0 |
| CPX-03b | 文本层 PDF 流水解析 + 5 万行性能 + 无文本层识别 | 5 万行 ≤60s；`source_row_no` 与源文件行号一一对应；扫描件返回 `SCANNED_NO_TEXT_LAYER` 且不重试 | 1.0 |
| CPX-03c | 规则引擎 ≥12 条 + 去重 + 处置与豁免 + `QualityGatePort` | 重跑行数不变；`BLOCKER` 未处置时端口返回 ≥1；`WAIVED` 缺批准人 422；规则版本变化后可区分新旧结果 | 1.5 |
| CPX-03d | 前端：导入进度（轮询）、质量问题清单（处置与豁免） | 进度在 3 次轮询内到达终态；清单可按 `severity`/`status` 过滤；豁免需二次确认并显示批准人 | 0.5 |
| CPX-03x（**可选增强**） | AI 文档分类与字段候选值：走 `AiSuggestionPort`，只写 `cpx_ai_suggestion`，人工 ACCEPT 后才生效 | 关闭 AI 服务时本卡全部主线验收项仍通过；AI 建议不含裸数字；拒绝建议后业务数据不变 | 0.5（不计入） |

### CPX-04 财务与资金分析

| 项 | 内容 |
|---|---|
| 目标 | 计算基础指标并逐条追溯来源；分析由轮次驱动，数据变更自动开轮，旧轮如实标为被取代 |
| 交付物 | `finance` 四子包（statement/transaction/debt/metric）+ `analysis` 包（R01/R02/R03/R06/R07）；`evidence` 包的 `EvidenceAppService.attachBatch` 与 finance 侧 `EvidenceSourcePort` 适配器；迁移 V9、V10、V18 余下部分、V19；`POST /api/imports/{id}/confirm`、`GET /api/cases/{id}/rounds`、`POST /api/rounds/{id}/compute`、`GET /api/cases/{id}/metrics?period=`、流水分类接口；前端指标卡片页、轮次时间线 |
| 前置 | CPX-03 |
| 关键实现要点 | 聚合 `FinancialStatement`(含 `StatementItem`)、`BankTransaction`、`DebtRecord`、`FinancialMetric`(含 `MetricSource`)、`AnalysisRound`(含 `MetricSnapshot`)。表：`cpx_financial_statement(_item)`、`cpx_bank_transaction`、`cpx_debt_record`、`cpx_financial_metric`(`data_version_id`/`formula`/`formula_version`)、`cpx_metric_source`、`cpx_metric_snapshot(_item)`、`cpx_analysis_round`(`round_no`/`data_version_id` 不可变/`status`/`superseded_by_round_no`/`supersede_reason`)、`cpx_evidence_ref`。①消费 `DataVersionCreated` 开轮（R01），`uq_analysis_round_data_version` 兜住重复投递。②R02 依赖 `QualityGatePort` 与批次终态；R03 快照按「建快照 → 置 `round.metric_snapshot_id` → 回填快照 `round_no`」三步写。③R06：新版本 `ACTIVE` 且 digest 不同时，未定稿旧轮转 `SUPERSEDED`（`NEW_DATA`）；**已 `CLOSED` 的轮次不转**，只写 `superseded_by_round_no`。④R07：案件进入 `WITHDRAWN`/`DECLINED` 时未定稿轮转 `SUPERSEDED`（`CASE_TERMINATED`）。⑤**继承钩子**：`analysis` 定义 `VerificationItemCarryPort`，本卡提供返回 0 的空实现，CPX-05 替换为真实实现——不得为此让 `analysis` 依赖 `assessment`。⑥**指标证据**：每个指标在同一事务内写 `EvidenceReference`（`targetType=METRIC`、`evidenceKind=CALCULATION`、`formulaCode`+`formulaVersion`、`dataVersionId`=本轮版本）；任一指标缺证据则整轮 `COMPUTED` 失败。⑦一切金额 `BigDecimal`，除法 `divide(divisor, 6, HALF_UP)`，比率 `numeric(10,6)`。⑧资金缺口情景测算标注「情景测算，非评估结论」，不参与就绪结论 |
| 验收标准 | ① 固定样例毛利率 `compareTo(new BigDecimal("0.352100")) == 0`，禁止 `equals` 比较。<br>② 分母为 0：指标为 `null` + `warnings` 含 `ZERO_DENOMINATOR`，HTTP 200。<br>③ 5 万行导入 ≤60s，`success_count + failed_count = row_count`。<br>④ 上传新文件产生 V2 并自动开第 2 轮（`round_no=2`）：第 1 轮未定稿转 `SUPERSEDED` 且 `supersede_reason='NEW_DATA'`；第 1 轮若已 `CLOSED` 则状态不变、仅 `superseded_by_round_no=2`。<br>⑤ 同一 `DataVersionCreated` 连续投递 3 次：`cpx_analysis_round` 仅 1 行。<br>⑥ 直接 `UPDATE cpx_analysis_round SET data_version_id=?`：触发器抛 INV-06 异常。<br>⑦ 每个 `cpx_financial_metric` 行存在 ≥1 条 `evidence_ref`（`CALCULATION`）且 `data_version_id` 等于其自身版本；人为跳过一条证据写入 → 轮次停留 `DATA_READY`，返回 422 `EVIDENCE_CHECK_FAILED` 并列出缺失指标码。<br>⑧ 指标 JSON 中金额为字符串 `"1234.56"`；ArchUnit 断言全工程无 `double`/`float` 字段与参数。<br>⑨ 重算后旧指标 `superseded_at` 非空，已锁定快照的 `snapshot_item` 值不变（INV-06）。<br>⑩ 案件转 `WITHDRAWN`：未定稿轮次转 `SUPERSEDED`/`CASE_TERMINATED`，已 `CLOSED` 轮次不变。<br>⑪ 轮次时间线接口返回每轮的 `roundNo`/`status`/`dataVersionNo`/`supersededByRoundNo`，字段齐全且与库一致 |
| 不包含 | 现金流预测模型、敏感性分析矩阵、多币种、合并报表抵消、指标自定义公式编辑器、授信口径评分、AI 生成指标解释（可选增强另列） |
| 人日 | 4.5（1.5 + 1.0 + 1.5 + 0.5） |
| 风险 | 高。轮次自动开轮若写成"人点按钮"，第 3 版数据下会展示第 2 轮结论且界面看不出来；指标证据漏写会让报告无法引用，返工面覆盖 CPX-05/CPX-06 |

| 子任务 | 范围 | 验收点 | 人日 |
|---|---|---|---|
| CPX-04a | 报表导入确认 + 科目明细 + 债务记录 + 流水分类与去重 | 同案件同期间同报表类型仅一套有效数据；`dedupe_key` 冲突计数正确；债务可回溯到合同文件或原始行 | 1.5 |
| CPX-04b | 轮次引擎：R01/R02/R03/R06/R07 + carry 端口空实现 + 幂等 | 一个数据版本只开一轮（重复事件 3 次仍 1 行）；已 `CLOSED` 轮不转 `SUPERSEDED`；绑定列被 UPDATE 即触发器异常；案件终止触发 R07 | 1.0 |
| CPX-04c | 指标计算 ≥9 类 × 2 期 + `MetricSource` + 指标证据同事务写入 | 毛利率精度断言；分母 0 不抛异常；每指标 ≥1 条证据且版本一致；缺证据则整轮失败 | 1.5 |
| CPX-04d | 前端：指标卡片页（按期间切换）、轮次时间线（第 N 轮/状态/数据版本/被谁取代） | 指标值与 API 一致；时间线可见 `SUPERSEDED` 轮次及其 `supersededByRoundNo`；`SUPERSEDED` 轮不可点「计算」 | 0.5 |

### CPX-05 风险事项与准备度评估

| 项 | 内容 |
|---|---|
| 目标 | 输出有证据支持的分析结果：三档就绪结论、风险事项、待核实事项；不输出分数、不含授信判断 |
| 交付物 | `assessment` 包（`VerificationItem`/`RiskFinding`/`ReadinessAssessment`/`ReadinessPolicy`/`WordingDictionary`）+ `VerificationItemCarryPort` 实现；迁移 V11（含 V1.1 列调整）、V18 中 `cpx_verification_item`；R04；`POST /api/rounds/{id}/assess`、`GET /api/cases/{id}/assessments/latest`、待核实事项 V01–V05 接口、风险事项接口；前端评估页、待核实看板（含跨轮历史）、风险清单下钻证据 |
| 前置 | CPX-04 |
| 关键实现要点 | 表：`cpx_verification_item`(`round_no`/`root_item_id`/`prior_round_no`/`prior_answer_note`/`status`/`version`)、`cpx_risk_finding`(`case_id`/`round_no`/`severity`/`statement`)、`cpx_assessment`(`round_no`/`readiness_outcome`/五维依据)、`cpx_evidence_ref`。①五维固定：资料完整性、数据可核验性、口径一致性、需求清晰度、待核实事项；结论三档 `READY`/`NEED_SUPPLEMENT`/`INSUFFICIENT`，**不输出 0–100 分数**。②`MetricQueryPort` 按 `(dataVersionId, metricCode, period)` 三元组查，禁止「取最新」。③每条 `VerificationItem`/`RiskFinding`/评估维度在同一事务内写至少一条 `EvidenceReference`，无证据拒绝创建（V01 守卫）。④`observation` 只陈述事实；`possibleCauses` 为并列数组；写库前经 `WordingDictionary` 拦截定性词。⑤**跨轮继承 V06**：开轮事务内只继承 `OPEN`/`ANSWERED`；新建记录、`rootItemId` 沿用、`priorRoundNo` 指回来源、新记录状态一律 `OPEN`、`priorAnswerNote` ≤200 字；不改原轮任何字段；同轮同 `rootItemId` 唯一；`carryCount` 查询派生（`round_no - min(round_no)`）。⑥`RESOLVED` 只能由人工推进，不提供自动关闭接口 |
| 验收标准 | ① R04 前置不满足（无锁定快照或必填资料未 `VERIFIED`/`WAIVED`）：422 `GUARD_FAILED`，`guard=G-R4`，`blockingItems` 精确到 `materialCode`。<br>② 评估生成后：`cpx_verification_item` 与 `cpx_risk_finding` 每一行都有 ≥1 条证据（API 断言 + 巡检 SQL ⑤ 为 0 行）。<br>③ 构造 `observation` 含「隐瞒」：422 `WORDING_REJECTED`，无任何落库。<br>④ 五维依据均非空；`readiness_outcome` ∈ 三档；返回体与报告中匹配 `\d{1,3}\s*分` 命中 0。<br>⑤ 返回体匹配 `/授信评级|通过率|获批概率|授信额度/` 命中 0。<br>⑥ 新版本开轮后：原 4 条事项中 `OPEN` 1 条 + `ANSWERED` 1 条 → 新轮新增 2 行，`status='OPEN'`、`root_item_id` 相同、`prior_round_no` = 原轮号、`prior_answer_note` ≤200；`RESOLVED`/`WAIVED` 不继承。<br>⑦ 原轮记录 `updated_at` 与字段值均未变化（继承不改原记录）。<br>⑧ 同一轮为同一 `root_item_id` 插第二条：数据库唯一冲突，接口 409。<br>⑨ 同一 `root_item_id` 的 `carryCount` 在第 4 轮时为 3，列表与报告均出现「已连续 3 轮未澄清」提示。<br>⑩ 关闭 AI 服务后生成评估仍成功，`narrative_source='RULE'`。<br>⑪ 不存在任何把 `VerificationItem` 直接置 `RESOLVED` 的自动接口（API 清单扫描）；`RESOLVED` 必须带 `resolution` 与 `resolvedBy` |
| 不包含 | 授信评分、违约概率、行业对标、同业数据库、偿债能力计入准备度、图表引擎、AI 自动生成整份结论（措辞建议为可选增强） |
| 人日 | 4.0（1.5 + 0.5 + 1.5 + 0.5） |
| 风险 | 中高。五维口径若未先定死会边写边改；继承若"复制状态"（把 `ANSWERED` 带过去），会让上一版数据的解释静默套用到新数据上 |

| 子任务 | 范围 | 验收点 | 人日 |
|---|---|---|---|
| CPX-05a | `VerificationItem` 聚合 V01–V05 + 禁词词典 + 证据守卫 + R04 | 无证据创建被拒；`ANSWERED` 缺答复正文 422；`RESOLVED` 缺结论正文 422；禁词命中 422 且零落库 | 1.5 |
| CPX-05b | 跨轮继承 V06：`VerificationItemCarryPort` 真实实现 + `carryCount` 派生 | 只继承 `OPEN`/`ANSWERED`；新记录一律 `OPEN`；原轮零改动；同轮同 `rootItemId` 唯一；`carryCount>=3` 有显式提示 | 0.5 |
| CPX-05c | `RiskFinding` + 五维 `ReadinessAssessment` + 三档结论 + 证据挂载 | 五维依据非空；三档之一；每风险事项 ≥1 证据；结论无分数、无授信词；重跑生成新评估且旧评估 `is_current=false` | 1.5 |
| CPX-05d | 前端：评估页（五维+三档+免责声明）、待核实看板（跨轮历史）、风险清单下钻证据 | 同一 `rootItemId` 可查看全部轮次记录并按轮排序；每条结论可点开证据到「文件页 / 数据行」；免责声明固定展示 | 0.5 |

### CPX-06 人工审核与报告

| 项 | 内容 |
|---|---|
| 目标 | 完成复核、渲染、签发、交付的收尾链路；报告是可交付物而非截图，渲染前证据校验强制失败即中止 |
| 交付物 | `review`/`report` 两包；模板渲染器（`TemplateRenderer`+`PlaceholderResolver`，纯函数）；`EvidenceValidationService` 调用侧；每日一致性巡检任务；迁移 V12、V13（含 V1.1 列调整）、V20；C05/C06/C07/C09/C10 与 R05；`POST /api/rounds/{id}/close`、`POST /api/cases/{id}/reports`、`POST /api/reports/{id}/versions/{n}/submit`、`/approve`、`/issue`、`/deliver`、`/void`；前端复核台、报告预览与下载、交付登记 |
| 前置 | CPX-05 |
| 关键实现要点 | 聚合 `ReviewTask`(含 `ReviewRecord`)、`Report`(含 `ReportVersion`、`ReportClause`)。表：`cpx_review_task`(`target_type`/`target_id`/`status`/`is_self_review`)、`cpx_review_record`、`cpx_report`、`cpx_report_version`(`case_id`/`round_no`/`status`/`content_hash`/`evidence_check_result`/`issued_at`/`issued_by`/`void_reason`/`replacement_version_no`/交付五字段)。①报告版本只能绑定 `CLOSED` 轮次：触发器兜底 + G-P1 守卫双层，触发器只抛异常、守卫给 `blockingItems`。②渲染确定性：模板 + `{{metric:CODE:PERIOD}}` 占位符由 Java 替换；出现裸数字即拒绝渲染；渲染在事务外，输入相同则 `contentHash` 相同。③**证据同步校验**（§6.3 五步）：组装 claim → `EvidenceQueryPort.validate(dataVersionId, claims)` 三查（存在性 / `dataVersionId` 一致 / `formulaVersion` 可回溯）→ 失败中止整事务并返回 `MissingEvidence[]` → 版本、条款、证据同事务落库 → 无事务渲染。④签发（P05）在事务内再执行一次只读证据校验并复检 G-C2。⑤单人复核：`is_self_review=true` 强制，报告首页固定披露「同一人编制与复核」。⑥`dataStaleness` 为派生值（`CURRENT`/`STALE`/`STALE_PENDING`），已签发报告不因数据更新改变状态或内容。⑦**每日一致性巡检**（02:30）：五类反连接（孤儿来源、跨版本引用、`formulaVersion` 不符、结构链与支链未闭合、结论零证据），窗口为最近 90 天 + 全部未 `VOID` 报告；只报告不自动修 |
| 验收标准 | ① 无 `APPROVED` 复核直接签发：422 `GUARD_FAILED`，`guard=G-P3`，版本仍 `IN_REVIEW`。<br>② 注入一段无证据条款：P01 返回 422 `EVIDENCE_CHECK_FAILED`，`MissingEvidence[]` 含 `targetType`+`targetId`+原因，`cpx_report_version` 无新增、`cpx_evidence_ref` 无新增。<br>③ 注入裸数字「营业收入 12,345,600.00 元」：渲染拒绝，码 `BARE_NUMBER_REJECTED`。<br>④ 引用上一版本指标（`dataVersionId` ≠ 轮次版本）：拒绝，码 `CROSS_VERSION_EVIDENCE`。<br>⑤ 输入不变两次渲染：`contentHash` 完全相同，导出 PDF 字节级一致（SHA-256 相同）。<br>⑥ 30 页报告渲染 ≤3s。<br>⑦ 签发后调用修改接口：409 `REPORT_IMMUTABLE`；签发前撤销授权：422（P05 复检 G-C2 失败）。<br>⑧ 交付缺 `recipient`：400 `DELIVERY_INCOMPLETE`；补齐五项后案件转 `DELIVERED` 且 `delivered_at` 非空。<br>⑨ 巡检五条 SQL 在 E2E 数据集上均返回 0 行；人为删除一条 `cpx_metric_source` 后巡检 ④ 返回 ≥1 行，任务以非零退出并告警，**库内数据未被自动修改**。<br>⑩ 插入绑定非 `CLOSED` 轮次的报告版本：触发器异常（证明触发器已装）。<br>⑪ 数据更新后已签发报告：`status` 与 `content_hash` 不变，`dataStaleness='STALE'`；确认提醒后写 `staleAcknowledgedAt`。<br>⑫ 作废缺 `voidReason` 或 `replacementVersionNo`：422；作废后旧 PDF 仍可下载。<br>⑬ 报告 PDF 文本含「本报告不代表授信评级、授信评分或审批意见」与「同一人编制与复核」 |
| 不包含 | 在线协同编辑、Word 导出、电子签章、客户自助门户、邮件自动发送、多语言模板、报告模板可视化配置 |
| 人日 | 5.5（1.0 + 2.0 + 1.5 + 1.0） |
| 风险 | 中高。PDF 中文字体嵌入与分页是隐性成本；确定性渲染极易被随机 ID 或 `now()` 破坏，`contentHash` 一旦漂移，交付记录与证据链同时失效 |

| 子任务 | 范围 | 验收点 | 人日 |
|---|---|---|---|
| CPX-06a | `review` 包 + 自审标记 + C05/C06/C07 + R05 定稿（G-R5） | 同一账号提交并复核：`is_self_review=true`；无 `APPROVED` 的评估复核时 R05 被拒；C07 退回后案件回 `COLLECTING` 且理由必填 | 1.0 |
| CPX-06b | 渲染器 + 占位符替换 + 裸数字拒绝 + `contentHash` + P01/P02 | 两次渲染哈希相同；裸数字与未替换占位符均拒绝；`DRAFT→IN_REVIEW` 需 `evidenceCheckResult` 晚于最后一次内容生成 | 2.0 |
| CPX-06c | 证据同步校验 + 签发二次校验 + 每日巡检 + P04/P05/P06/P07/P08 + C09/C10 | 三类拒绝用例（无证据/裸数字/跨版本）各 1 条；签发后不可改；作废需替代版本；巡检五条 SQL 全 0 行且只读 | 1.5 |
| CPX-06d | 前端：复核台（待办/决策/意见）、报告预览与下载、交付登记、陈旧提醒 | 复核意见非空才可提交；预览分页正确、中文不乱码；交付登记五项缺一不可提交；陈旧标记可见 | 1.0 |

---

## 四、端到端验收脚本（S1：一次完整交付）

合成资料包固定在 `fixtures/e2e/`：示例精密制造有限公司（统一社会信用代码 1 个、2024/2025 资产负债表与利润表各 1 份 xlsx、12 个月流水 3000 行 xlsx、借款合同 3 份合 1 个 PDF、授权书 1 份 PDF、纳税申报表扫描件 1 份 + 文本层 1 份）。资料字典固定为 r1 版本、8 项全部 `REQUIRED`：营业执照、授权书、资产负债表、利润表、近 12 个月银行流水、借款合同、纳税申报表、社保缴纳明细。本脚本将来逐行翻成自动化 E2E，断言只落在「接口返回码 + 数据库行数与关键列 + PDF 文本抽取」，不使用截图比对。

| # | 动作 | 案件 `lifecycle` | 轮次 | 报告版本 | 资料项 / 事项 | 数据版本 |
|---|---|---|---|---|---|---|
| 1 | ADMIN 登录 | — | — | — | — | — |
| 2 | 错口令 5 次后第 6 次 | — | — | — | — | — |
| 3 | 建客户（信用代码唯一） | — | — | — | — | — |
| 4 | 建案件，仅填金额 300 万、不填用途后提交 | `INTAKE`（保持） | — | — | 8 项 `REQUIRED` | — |
| 5 | 补齐用途/期限/资金缺口，执行 C02 | `INTAKE`→`AUTHORIZATION` | — | — | — | — |
| 6 | 未登记授权直接上传流水 | 保持 | — | — | — | — |
| 7 | 登记授权（5 类范围）+ 上传授权书，执行 C03 | `AUTHORIZATION`→`COLLECTING` | — | — | 授权书 `RECEIVED` | — |
| 8 | 上传并解析批次 A（营业执照、资产负债表、利润表） | 保持 | 第 1 轮 `DRAFT`（R01 自动） | — | 3 项 `RECEIVED`→`PARSED` | V1（3 成员） |
| 9 | 人工核验批次 A 三个文件（M05） | 保持 | 保持 | — | 3 项 `PARSED`→`VERIFIED` | — |
| 10 | 上传并解析批次 B（流水 3000 行、借款合同） | 保持 | 第 2 轮 `DRAFT`；第 1 轮→`SUPERSEDED`(`NEW_DATA`) | — | 5 项 `VERIFIED`/`PARSED` | V2（5 成员） |
| 11 | 上传纳税申报表扫描件 → 批次 `FAILED`；资料项 M06 退回后补传文本版并解析 | 保持 | 第 3 轮 `DRAFT`；第 2 轮→`SUPERSEDED`(`NEW_DATA`) | — | 该资料项 `REJECTED`→`REQUESTED`→`RECEIVED`→`PARSED` | V3（6 成员） |
| 12 | 确认社保明细无法取得，执行 M08 豁免 | 保持 | 保持 | — | 1 项 `REQUIRED`→`WAIVED`（理由 + 批准人） | — |
| 13 | 核验其余 6 个资料项 | 保持 | 保持 | — | 7 项 `VERIFIED` + 1 项 `WAIVED`（G-C3 满足） | — |
| 14 | 在 V3 上重跑质量规则，处置 4 条问题 | 保持 | 保持 `DRAFT`（G-R2 未过） | — | 质量项：`BLOCKER`→`WAIVED`、2 `MAJOR`→`ACKNOWLEDGED`、1 `MINOR`→`RESOLVED` | — |
| 15 | 质量项处置完毕，R02 数据就绪 | 保持 | `DRAFT`→`DATA_READY` | — | — | — |
| 16 | 执行 C04 进入分析，R03 计算并锁定快照 | `COLLECTING`→`ANALYZING` | `DATA_READY`→`COMPUTED` | — | 指标证据 19 条写入 | — |
| 17 | R04 生成评估（五维 + 三档 + 4 待核实 + 3 风险） | 保持 | `COMPUTED`→`ASSESSED` | — | 事项与风险证据写入 | — |
| 18 | 建 `ASSESSMENT` 复核任务并通过，R05 定稿 | 保持 | `ASSESSED`→`CLOSED` | — | 复核记录 1 条（`is_self_review=true`） | — |
| 19 | P01 生成报告 V1（证据校验通过）、P02 提交复核，执行 C05 | `ANALYZING`→`REVIEW` | 保持 `CLOSED` | `DRAFT`→`IN_REVIEW` | 报告条款证据 12 条 | — |
| 20 | P04 复核通过、P05 签发（复检证据 + 复检授权） | 保持 | 保持 | `IN_REVIEW`→`APPROVED`→`ISSUED` | 复核记录 1 条 | — |
| 21 | P06 交付（五项齐全 + 哈希一致），执行 C09 | `REVIEW`→`DELIVERED` | 保持 | `ISSUED`→`DELIVERED` | — | — |
| 22 | C10 关闭（`closingNote` 说明 1 条 `OPEN` HIGH 已披露） | `DELIVERED`→`CLOSED` | 保持 | 保持 | `retentionUntil` = 交付日 + 36 个月 | — |
| 23 | 每日巡检 + 审计对账 | 保持 `CLOSED` | 3 轮均只读 | 保持 | 五类巡检 0 行 | — |

### 4.1 预期表记录数（S1 终态，硬断言）

| 表 | 行数 | 说明 |
|---|---|---|
| `cpx_customer` / `cpx_contact` | 1 / 1 | 主联系人恰好 1 个 |
| `cpx_financing_case` | 1 | `lifecycle='CLOSED'`，`hold_from` 为 NULL，`closed_at` 非空 |
| `cpx_financing_requirement` | 1 | `is_current=true`，`version_no=1` |
| `cpx_case_status_event` | 7 | C01/C02/C03/C04/C05/C09/C10，`seq_no` 1..7 连续 |
| `cpx_case_material` | 8 | 7 `VERIFIED` + 1 `WAIVED` |
| `cpx_case_authorization` / `_scope` | 1 / 5 | 5 类范围，`revoked_at` 为 NULL |
| `cpx_document` / `cpx_document_version` / `cpx_document_review` | 7 / 8 / 8 | 纳税申报表 2 个版本（v1 `REJECTED`、v2 `VERIFIED`） |
| `cpx_data_import` | 5 | 4 `CONFIRMED` + 1 `FAILED`(`SCANNED_NO_TEXT_LAYER`) |
| `cpx_financial_statement` / `_item` | 4 / 160 | 资产负债表 2 期 + 利润表 2 期，每期 40 科目 |
| `cpx_bank_transaction` / `cpx_debt_record` | 3000 / 3 | 流水行数 = 源文件数据行数 |
| `cpx_data_quality_issue` | 4 | 1 `WAIVED`(`BLOCKER`) + 2 `ACKNOWLEDGED` + 1 `RESOLVED` |
| `cpx_data_version` / `cpx_data_version_member` | 3 / 14 | V1=3、V2=5、V3=6 成员；`ACTIVE` 恒 1 行 |
| `cpx_analysis_round` | 3 | 第 1、2 轮 `SUPERSEDED`，第 3 轮 `CLOSED` |
| `cpx_metric_snapshot` / `_item` | 1 / 19 | 仅第 3 轮锁定 |
| `cpx_financial_metric` / `cpx_metric_source` | 19 / ≥19 | 9 指标类 × 2 期 + 1 资金缺口指标 |
| `cpx_verification_item` | 4 | 1 `OPEN`(HIGH) + 1 `ANSWERED` + 1 `RESOLVED` + 1 `WAIVED` |
| `cpx_risk_finding` | 3 | HIGH/MEDIUM/LOW 各 1 |
| `cpx_assessment` | 1 | 五维依据非空，`readiness_outcome` 三档之一 |
| `cpx_review_task` / `cpx_review_record` | 2 / 2 | `ASSESSMENT` 与 `REPORT_VERSION` 各 1 |
| `cpx_report` / `cpx_report_version` | 1 / 1 | V1 `DELIVERED` |
| `cpx_evidence_ref` | 43 | 19 指标 + 4 待核实 + 3 风险 + 5 评估维度 + 12 报告条款 |
| `cpx_ai_task` / `cpx_ai_suggestion` | 0 / 0 | 未启用 AI 的证明 |

### 4.2 证据链可追溯性检查点

| 编号 | 检查 | 判定 |
|---|---|---|
| E2E-E1 | 每个指标有 ≥1 条 `CALCULATION` 证据，且 `data_version_id` 等于第 3 轮版本 | 零缺失 |
| E2E-E2 | 四跳追溯：报告条款 → `cpx_evidence_ref` → `cpx_financial_metric` → `cpx_metric_source` → `cpx_data_import_record.source_row_no` → `cpx_document_version.sha256` → 存储层第 3 页 | 四跳全通，`sha256` 与磁盘一致 |
| E2E-E3 | 渲染前校验（P01）与签发前校验（P05）各执行一次，`evidence_check_result` 落库且 `passed=true` | 2 条记录 |
| E2E-E4 | 三类失败注入（无证据条款 / 裸数字 / 跨版本引用）各返回 422 且零落库 | 3/3 |
| E2E-E5 | 巡检 SQL ①–⑤ 全部返回 0 行 | 5/5 为 0 |
| E2E-E6 | `cpx_evidence_ref` 无一条触发 `uq_evidence_ref_unique` | 冲突 0 |
| E2E-E7 | 审计对账：`cpx_case_status_event` 计数 = 审计 `CASE_STATUS_CHANGE` 计数 = 7 | 差值 0 |

### 4.3 分支脚本（同一夹具，独立用例）

| 脚本 | 场景 | 关键预期 |
|---|---|---|
| S2 | 立案后把需求用途由「流动资金」改为「设备采购」 | G-C2 返回 false → C08 回退 `AUTHORIZATION`；重新授权后 C03 复入 `COLLECTING`；已生成指标保留并标记「授权已撤销」 |
| S3 | 第 3 轮 `CLOSED`、报告 V1 `DELIVERED` 后客户补交流水（案件未关闭） | V4 → 第 4 轮 `DRAFT`；继承 2 条事项（`ANSWERED`→`OPEN`）；V1 报告 `status` 不变、`dataStaleness='STALE'`；新报告 V2 绑定第 4 轮 |
| S4 | `COMPUTED` 阶段客户书面撤回 | C13 → `WITHDRAWN`；R07 未定稿轮 → `SUPERSEDED`(`CASE_TERMINATED`)；`IN_REVIEW`/`APPROVED` 版本 → `VOID`；`ISSUED` 版本不 `VOID`；一切推进被「非终态才允许推进」拦截 |

---

## 五、开发纪律（不可协商）

| 编号 | 纪律 | 落地方式 | 违反判定 |
|---|---|---|---|
| D-01 | 只读审计先行 | 每卡开工前跑现状审查（依赖方向、`BigDecimal`、状态直改、审计写入），产出问题清单再动手 | 卡末才发现结构性问题 |
| D-02 | 任务卡驱动 | 只做当前子任务「范围」列出的内容；额外需求写入下一张卡 | 提交出现卡外文件 |
| D-03 | 每卡结束更新文档 | 更新本文完成状态、`data-dictionary.md`、`docs/api/` 契约 | 代码改了字典没改 |
| D-04 | **ArchUnit 落地** | `src/test/java/com/coolpilotx/architecture/` 内 A-01~A-16 全部实现，`mvn test` 失败即阻断合并；`@Ignore` 计数必须为 0；规则出现 `ignoreDependency` 即视为边界失守信号 | 断言缺项、被 `@Ignore`、或出现无法一句话解释的例外 |
| D-05 | 金额只用 `BigDecimal` | 库 `numeric(18,2)`、比率 `numeric(10,6)`；比较用 `compareTo`；JSON 序列化为字符串；A-11/A-16 兜底 | 出现 `double`/`float`、`equals` 比较金额、JSON 输出数字 |
| D-06 | 状态流转走状态机 | 每个生命周期只有一个入口（`CaseStateMachine.transition` / `AnalysisRound.transition` / `ReportVersion.transition` …），入参含 `expectedFrom + expectedVersion`；禁止任何 `update ... set status = ?` 旁路 SQL | 出现直改状态字段的 SQL 或 Mapper |
| D-07 | AI 不得写业务表 | AI 只经 `AiSuggestionPort` 写 `cpx_ai_task`/`cpx_ai_suggestion`；数据库角色层面只授予这两张表的 DML；人工 ACCEPT 后由 Java 写业务表（INV-10、A-08） | AI 侧出现任何业务表 DML，或业务模块 import `aigateway.**` |
| D-08 | 报告数字必须有 `EvidenceReference` | 渲染器二次扫描裸数字；所有数字经 `{{metric:CODE:PERIOD}}` 占位符由 Java 替换；无证据段落不得进入签发版本（INV-14/18） | 报告出现无引用数字，或渲染路径可调 AI |
| D-09 | 同步校验优先于事件 | 守卫、签发、渲染前证据校验一律同步；只有「已发生事实」的通知才走提交后事件；跨域禁止写表 | 用事件做签发前校验 |
| D-10 | 可解释的拒绝 | 守卫失败返回 `{code, guard, blockingItems[], actualStatus, traceId}`，`fixHint` 必须是可执行动作 | 只返回「操作失败」 |
| D-11 | 迁移只增不改 | 已合入的 `V{n}` 不得修改；枚举值集合与数据库 CHECK 必须逐项相等（一致性测试） | 历史脚本 diff 非空 |
| D-12 | 巡检是常态门禁 | 每日一致性巡检任务上线后，红灯必须在当个迭代内清零；巡检只报告不修数 | 巡检长期红灯仍继续开发 |
| D-13 | 文案红线 | 输出不得出现授信评级、通过率、获批概率、授信额度、造假、隐瞒、欺诈 | 禁词扫描命中 |

---

## 六、工期汇总

| 阶段 | 内容 | 乐观（人日） | 含 20% 缓冲 | 可并行项 |
|---|---|---|---|---|
| 环境 | E-01~E-13 确认与记录 | 0.5 | 0.6 | 无（串行闸门） |
| M0 | 空工程验证 | 0.5 | 0.6 | 无 |
| CPX-01 | 客户与案件管理 | 4.5 | 5.4 | 前端页（01d）可与 01b/01c 并行 |
| CPX-02 | 授权与资料管理 | 4.0 | 4.8 | 02c 数据版本可与 02b 并行 |
| CPX-03 | 数据提取与质量检查 | 4.0 | 4.8 | 03a 与 03b 可并行（需两人） |
| CPX-04 | 财务与资金分析 | 4.5 | 5.4 | 04a 与 04b 可并行 |
| CPX-05 | 风险事项与准备度评估 | 4.0 | 4.8 | 05b 继承可与 05c 并行 |
| CPX-06 | 人工审核与报告 | 5.5 | 6.6 | 06b 渲染与 06a 复核可并行（需两人） |
| E2E | 端到端脚本自动化与缺陷修复 | 1.5 | 1.8 | 无 |
| **合计** | — | **29.0** | **34.8** | — |

可并行（可选增强，不计入上表）：CPX-03x AI 文档分类与字段候选 0.5 人日；CPX-04 的 AI 指标解释 0.5 人日。

排期结论：

- **单人串行**：29 人日，按每周 5 天约 6 周；含缓冲约 7 周。这是现实基线。
- **两人并行**（一人 Java 主线、一人前端 + 可选增强）：可压到约 24 人日，但 CPX-02→CPX-04、CPX-05→CPX-06 是强串行点，联调成本会吃掉部分收益。
- **压不得的三块**：状态机与守卫（CPX-01c）、轮次与指标口径（CPX-04b/c）、报告确定性渲染与证据校验（CPX-06b/c）。压了就是返工。
- **最早可演示节点**：CPX-03 结束（约第 3 周）可演示「上传资料 → 出质量问题清单」；CPX-06 结束才是完整交付。
- **不建议在六卡完成前插入 P1**：P1 的多用户与客户门户会改写权限模型，而权限模型是 CPX-01a 的地基。

---

## 七、与 V1.0 任务卡的差异说明

### 7.1 卡片映射

| V1.0 | V1.1 | 变化 | 原因 |
|---|---|---|---|
| P0-01 项目基础、登录、客户 | CPX-01（子任务 01a/01b） | 拆入 | 底座与客户同属「客户与案件管理」的入口，单列阶段会多出第七个阶段，违反基线第五节 |
| P0-02 融资案件、授权 | CPX-01（01c）+ CPX-02（02a） | **拆分** | 授权属于「授权与资料管理」，与案件状态机分属不同阶段；状态机内核仍留在 CPX-01，授权转换 C03 由 CPX-02 启用 |
| P0-03 文件上传、分类、版本 | CPX-02（02b/02d）+ 02c（新增） | 合并并扩充 | 资料与授权同属 D2；新增数据版本，因「资料变更即产生版本」是基线修正 3 的前置 |
| P0-04 解析、质量检查 | CPX-03 | 保留 | 无结构变化；扫描件由「必须解析」改为「识别并拒绝」，因首期不做 OCR |
| P0-05 财务、流水、指标 | CPX-04 + 04b（新增轮次引擎） | 扩充 | 原卡只有 `data_version` 计数器，无轮次概念；新模型要求轮次独立聚合 |
| P0-06 偿债能力、经营风险 | CPX-05 | **改写** | 删去偿债能力评估与四类分析结论（基线修正 1：不评估偿债能力）；改为「待核实事项 + 风险事项 + 五维准备度」；偿债情景测算降级为分析产物，不进结论 |
| P0-07 人工审核、报告 | CPX-06 + 06c（新增证据校验与巡检） | 扩充 | 报告状态落到 `ReportVersion`；证据校验、签发二次校验、每日巡检为本版新增 |
| （无） | 零、三条前提；4.3 分支脚本 S2/S3/S4 | 新增 | 状态取值、AI 非前置、投影与陈旧标记需要显式脚本承载 |

### 7.2 新增的任务（本版特有）

| 新增项 | 所属卡 | 为什么必须新增 |
|---|---|---|
| 数据版本 `DataVersion` + `digest` 计算 + INV-19 三种写入结果 | CPX-02c | 没有版本就没有「这份报告基于哪版数据」；`digest` 掺 id 会让重传产生假版本 |
| 分析轮次引擎 R01/R02/R03/R06/R07 + 绑定不可变 | CPX-04b | 轮次是本轮模型的核心；漏开一轮会静默给出旧结论 |
| 指标证据同事务写入（`CALCULATION`） | CPX-04c | 无证据指标无法被报告引用，等到 CPX-06 补就晚了 |
| 事项/风险/评估证据守卫 | CPX-05a/05c | INV-14 要求结论必须有依据，且必须同生同灭 |
| 跨轮继承 V06 + `carryCount` 派生 | CPX-05b | 未解决疑问不能在新轮消失（INV-20），也不能把旧答复直接当新轮结论 |
| 渲染前同步证据校验 + `MissingEvidence[]` | CPX-06b/c | 异步校验会让"已渲染的报告"先落地，作废成本不可逆 |
| 签发时二次证据校验 | CPX-06c | 防「版本创建后底层资料被替换」 |
| 每日一致性巡检（五类反连接） | CPX-06c | `source_object_id` 是多态列，无法建外键，只能三层补偿 |
| 报告陈旧标记 `dataStaleness` | CPX-06d | 已签发报告不失效但必须提示，否则客户拿旧报告用新数据 |
| 案件进度投影（14 条优先级） | CPX-01c | 单状态字段被废弃后，列表「进度」必须由五个状态派生 |

### 7.3 废弃的表述（出现即缺陷）

| 废弃项 | 替代 |
|---|---|
| `cpx_financing_case.status` 与 18 值枚举 | `lifecycle` 10 值（`ck_financing_case_lifecycle`） |
| `DRAFT`/`SUBMITTED`/`DOCUMENT_REVIEW`/`AUTHORIZATION_PENDING`/`DATA_EXTRACTION`/`DATA_QUALITY_CHECK`/`MANUAL_REVIEW`/`REPORT_PENDING`/`APPROVED`（旧义） | 案件 7+3 值 + 轮次 6 值 + 报告 6 值，按维度分别表达 |
| `cpx_financing_case.data_version` 计数器 | `cpx_data_version` 的 `ACTIVE` 行（部分唯一索引） |
| `cpx_financing_metric.data_version` / `cpx_metric_snapshot.data_version`（bigint） | `data_version_id`（uuid） |
| `cpx_report.status` | `cpx_report_version.status` 6 值 |
| `cpx_case_material.is_waived` 布尔 | `status` 7 值 + `ck_case_material_waiver` |
| `cpx_document_version.verification_state = 'PARSE_FAILED'` | 解析失败由 `cpx_data_import.status='FAILED'` 表达 |
| `is_self_review` 之外的「跳过复核」捷径 | `is_self_review=true` 强制 + 报告首页固定披露 |
