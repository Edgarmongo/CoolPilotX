# CPX-ARCH-01 系统总体架构

- 编号：CPX-ARCH-01
- 状态：待确认
- 前置：`ADR-001 工程基线`、`CPX-DOMAIN-01 领域模型`、`CPX-BIZ-01 业务流程与状态机`
- 适用范围：首期单机部署、单用户、单租户
- 约束来源：本文所有裁定必须与前三份文档一致；冲突时以前三份为准，本文只负责"怎么落地"

---

## 一、架构总览

### 1.1 一句话结论

系统由**一个 Java 单体进程**承载全部业务事实与流程状态，由**一个可替换的 Python 服务**承载全部非确定性 AI 能力，两者通过内部 HTTP 通信，共享一个 PostgreSQL，文件二进制落受控目录。

### 1.2 权威边界（本文最重要的一条）

| 关注点 | 权威来源 | 说明 |
|---|---|---|
| 业务事实（客户、案件、资料、流水、指标、报告） | **Java** | 唯一可写业务表的一方 |
| 流程状态与状态流转 | **Java** | 状态机、守卫、乐观锁、状态事件全在 Java |
| 金额与指标计算 | **Java** | ADR-001 A-08 硬约束，Python 不得参与算术 |
| 权限与授权校验 | **Java** | 拦截点在服务端入口，不在页面 |
| 审计日志 | **Java** | 仅 `audit` 模块可写 |
| 文本抽取、分类、措辞生成、解释性文字 | **Python** | 输出仅为"建议"与"结构化候选" |
| 建议的采纳 | **Java（人工确认后）** | ADR-001 A-09，AI 只写 `cpx_ai_suggestion` / `cpx_ai_execution_log` |

**Python 可整体替换而业务代码零改动**：Java 只依赖 `AiClientPort`（内部 HTTP 契约），换模型、换框架、换语言都不影响业务事务。

### 1.3 分层视图

```
浏览器  Vue 3 + Vite + Element Plus + TypeScript（只做展示，金额按字符串收发）
   │ HTTPS / JSON（同源，Nginx 反代）
   ▼
[C1] nginx :80/:443 ── 静态资源 · /api 反代 · 上传限制 · 安全头
   │ http://backend:8080
   ▼
[C2] backend  Java 21 / Spring Boot 4.0.8  [业务事实与流程状态权威]
     api 层         Controller · DTO · 参数校验
     application    用例编排 · 事务边界 · 鉴权与授权拦截
     domain         聚合 · 值对象 · 状态机 · 守卫（不依赖 Spring）
     infrastructure MyBatis Mapper · StoragePort · AiClient
     横切           audit（审计）· aigateway（唯一 AI 出站方）
   │ JDBC（唯一业务库客户端）              │ HTTP（仅 aigateway 出站）
   ▼                                       ▼
[C4] postgres:16                    [C3] ai-service  Python/FastAPI
     业务表 · Flyway · pg_trgm          解析 · 抽取 · 分类 · 措辞
     审计分区表                         PyMuPDF / python-docx / openpyxl
   ▲                                     │ 受限账号，只写 2 张 AI 表
   └─────────────────────────────────────┘
   ai-service ✗ 不得访问 backend；postgres ✗ 无出站网络
```

### 1.4 进程与依赖矩阵

| 组件 | 可访问 | 不可访问 | 强制手段 |
|---|---|---|---|
| nginx | backend:8080 | postgres、ai-service | 不在 `cpx-back` 网络 |
| backend | postgres:5432、ai-service:8000 | 外网 | 出站仅白名单 |
| ai-service | postgres:5432（**仅两张 AI 表**） | backend 的内部接口 | 独立数据库账号 + 表级 GRANT |
| postgres | 无出站 | — | `internal: true` 网络 |
| 前端 | 仅 `/api/**` | 任何内部端口 | 无直连路径 |

> Python 连库是为了写 `cpx_ai_suggestion` / `cpx_ai_execution_log`（A-09 允许的边界）。用独立角色 `cpx_ai` 授权，只 `GRANT INSERT, SELECT` 这两张表，其余表零权限。**这是技术隔离，不是约定。**

---

## 二、运行时拓扑

### 2.1 容器清单

| 服务 | 镜像 | 端口（宿主→容器） | 资源上限 | 重启策略 |
|---|---|---|---|---|
| `nginx` | `nginx:1.27-alpine` | `80→80`、`443→443` | 0.25 CPU / 128 MB | unless-stopped |
| `backend` | 本地构建 `cpx/backend:{version}` | 不暴露 | 2 CPU / 2 GB（`-Xmx1g`） | unless-stopped |
| `ai-service` | 本地构建 `cpx/ai-service:{version}` | 不暴露 | 2 CPU / 2 GB | unless-stopped |
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5433→5432`（仅调试） | 2 CPU / 2 GB | unless-stopped |

**端口规划原则**：只有 nginx 对公网暴露；postgres 宿主映射绑定 `127.0.0.1`（仅本机 psql 排障，生产可注释）；backend 与 ai-service 一律不映射宿主端口，避免绕过 Nginx 的鉴权与限流。宿主实占端口仅 `80/443` 与 `5433`。

### 2.2 网络隔离

```
cpx-front  bridge，可出外网              cpx-back  bridge，internal: true，无出站
┌────────┐        ┌─────────┐            ┌─────────┐        ┌────────────┐
│ nginx  │───────▶│ backend │            │ backend │───────▶│ ai-service │
└────────┘        └────┬────┘            └────┬────┘        └─────┬──────┘
                       │  backend 同时接入两张网络（唯一跨网组件） │
                       └──────────────────────────────────────────┘
                                            ▼
                                     ┌────────────┐
                                     │  postgres  │
                                     └────────────┘
```

- backend 同时接入两张网络（唯一跨网组件），nginx 只进 `cpx-front`，postgres/ai-service 只进 `cpx-back`。
- `cpx-back` 声明 `internal: true`，数据库与 AI 服务无外网出口；AI 若需调用外部大模型，走 JDK 侧统一代理出站（见 3.4），不在 `cpx-back` 开口子。

### 2.3 数据卷

| 卷 / 挂载 | 容器路径 | 内容 | 备份策略 |
|---|---|---|---|
| `cpx-pgdata`（named） | `/var/lib/postgresql/data` | 全部业务数据 | 每日 `pg_dump` + 每周基础备份 |
| `./storage`（bind） | `/app/storage` | `documents/{customerId}/{caseId}/{documentId}/v{n}` | 增量同步至异机，保留 90 天 |
| `./storage/tmp` | `/app/storage/tmp` | 上传临时区、解析中间产物 | 不备份，启动时清理超过 24h 的文件 |
| `./config/nginx`（ro） | `/etc/nginx/conf.d` | 反代与安全头 | 随代码走 Git |
| `cpx-logs`（named） | `/app/logs` | 结构化日志（JSON 行） | 按天滚动，保留 30 天 |
| `./secrets`（ro） | `/run/secrets` | 数据库口令、JWT 密钥、AI 令牌 | 不入 Git，权限 600 |

- 存储路径严格遵循 A-10：二进制不落库；`storage/` 不在任何静态资源映射下，只能经鉴权后流式下载；文件名重写为 `{documentId}_{sha256前8位}.{ext}`，绝不使用用户原始文件名（防路径穿越）。

### 2.4 健康检查与启动顺序

| 服务 | 检查方式 | 间隔/超时/重试 | 启动判定 |
|---|---|---|---|
| `postgres` | `pg_isready -U cpx -d coolpilotx` | 10s / 5s / 5 | 就绪后 backend 才启动 |
| `ai-service` | `GET /healthz`（不校验依赖，仅进程活性） | 15s / 3s / 5 | `start_period: 30s` |
| `backend` | `GET /actuator/health/liveness`（就绪用 `/readiness`，含 DB 探活） | 15s / 3s / 5 | `start_period: 60s` |
| `nginx` | `GET /healthz` 返回 200 | 15s / 3s / 3 | 依赖 backend healthy |

- `depends_on` 使用 `condition: service_healthy`；健康检查**不探 AI 依赖**——AI 挂了 backend 仍应 healthy，只降级 AI 功能（对齐 CPX-BIZ-01 §4.3）；Flyway 先于 Web 容器就绪，迁移失败即进程退出，不会出现"服务起来了但表不对"。

---

## 三、请求链路：上传银行流水并解析

### 3.1 总体形态：同步受理 + 异步解析

5 万行流水的解析无法在 HTTP 请求内可靠完成。接口**同步完成受理与落库**，解析交给进程内后台线程池，前端用 `importBatchId` 轮询。

```
[阶段 A：请求线程，同步，目标 ≤2s]
浏览器 POST /api/cases/{caseId}/imports?type=BANK_STATEMENT
  → nginx      体积上限 50MB / client_body_timeout 60s / proxy_read_timeout 60s
  → A1 鉴权    JWT → Principal(userId, roles)
  → A2 授权    查有效 CaseAuthorization，dataScopes ⊇ BANK_STATEMENT（只读事务）
  → A3 幂等    Idempotency-Key 查表，命中直接返回首次结果
  → A4 落盘    流式写 storage/tmp，边写边算 SHA-256（不占内存）
  → A5 TX1     document / document_version(UPLOADED) / import_batch(PENDING) / audit
  → A6 提交后  rename 至正式目录 + 投递解析任务到专用线程池
  → A7 返回    202 {importBatchId, documentId}

[阶段 B：后台线程，异步，目标 ≤60s / 5 万行]
  → B1 调 Python POST /v1/parse/bank-statement（multipart + storageKey）
  → B2 Python  PyMuPDF/openpyxl 取文本与表格 → LLM 仅做列映射与异常行判定
               → 返回结构化行 + parserVersion + warnings（不写业务表）
  → B3 校验    日期可解析 / 金额非空 / 借贷方向合法 / 行数与合计双对账（纯内存）
  → B4 TX2..n  每 2000 行一个事务写 cpx_bank_transaction
  → B5 TXf     批次置 PARSED|FAILED + 统计 + AI 执行记录回填
  → B6 提交后  发布 ParseCompletedEvent → 审计 + 触发数据质量检查
```

### 3.2 事务边界与回滚点

| 步骤 | 事务 | 边界 | 失败后果 | 回滚/补偿 |
|---|---|---|---|---|
| A1 鉴权 | 无 | — | 401 | 无副作用 |
| A2 授权校验 | 只读事务 | 单次查询 | 403 `AUTHORIZATION_REQUIRED` | 无副作用 |
| A3 幂等占位 | TX0（独立短事务） | INSERT `cpx_idempotency` | 冲突返回首次结果 | 占位行 24h 过期清理 |
| A4 落盘 tmp | **无事务**（文件系统不可回滚） | 单文件 | 磁盘满/中断 | 定时任务清理过期 tmp；SHA 不完整即丢弃 |
| A5 元数据落库 | **TX1** | document + version + batch + audit | 异常 | TX1 回滚，tmp 文件成孤儿由清理器回收 |
| A6 rename + 投递 | 无事务 | 提交后动作 | 投递失败 | 批次停在 PENDING，由补偿扫描器重新投递（幂等） |
| B1 调 Python | 无 | HTTP 调用，`connectTimeout=2s`、`readTimeout=120s` | 超时/5xx | 批次置 FAILED，`error_code=AI_UNAVAILABLE`，可人工重试 |
| B3 校验 | 无（纯内存） | — | 全部行不合法 | 批次 FAILED，不写任何流水行 |
| B4 分批写 | **TX2..TXn** | 每 2000 行一事务 | 中途异常 | **业务级回滚**：`DELETE FROM cpx_bank_transaction WHERE import_batch_id = ?`，再置 FAILED |
| B5 终态 | **TXf** | batch 状态 + 统计 | 异常 | 重试 TXf；行数据已在，重复执行幂等 |
| B6 事件 | 提交后 | 进程内事件 | 监听器异常 | 不回收数据；事件失败记 WARN，靠对账任务补 |

**关键裁定**：

1. **5 万行不放进单个数据库事务**。单事务会产生数万行 WAL 与长事务，锁膨胀、autovacuum 受阻、超时不可控。改用"每批 2000 行独立提交 + 按 `import_batch_id` 物理清理"实现**业务语义上的整体可回滚**（对齐 CPX-DOMAIN-01 §3.6 "一个批次的结果必须能整体回滚"）。
2. **`import_batch_id` 是清理锚点**。所有流水行必带该列并建索引，删除是单条 `DELETE` 而非逐行定位。
3. **确认即锁定**：批次 `CONFIRMED` 后不允许再按批次删除，修正走"调整记录"（领域不变量）。
4. **文件先落地、元数据后落库**。顺序不能反：先写库再写文件，会出现"库里有记录但文件不存在"的死链；当前顺序最坏只产生可回收的孤儿文件。
5. **AI 不参与事务**。Python 调用的成败只影响该批次状态，绝不回滚案件主状态（CPX-BIZ-01 §4.3）。

### 3.3 失败矩阵（前端可见的错误码）

| 场景 | HTTP | 错误码 | 前端动作 |
|---|---|---|---|
| 未登录/令牌过期 | 401 | `UNAUTHENTICATED` | 跳登录 |
| 无 `BANK_STATEMENT` 授权或已撤销 | 403 | `AUTHORIZATION_REQUIRED` | 引导登记授权 |
| 同一幂等键重复提交 | 200 | —（返回首次结果） | 无感 |
| 文件超限/类型不符 | 413 / 415 | `FILE_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | 提示重选 |
| 同案件同 SHA-256 已存在 | 202 | `DUPLICATE_SUSPECTED`（不拒绝） | 提示"疑似重复"，可继续 |
| Python 超时/不可用 | 202 已返回，批次 FAILED | `AI_UNAVAILABLE` | 提示"解析服务暂不可用，可重试或手工录入" |
| 解析行数对账不平 / 案件状态不允许导入 | 批次 FAILED / 409 | `ROW_COUNT_MISMATCH` / `STATE_CONFLICT` | 展示期望与实际行数；或刷新案件状态 |

### 3.4 AI 出站与超时策略

| 项 | 值 | 依据 |
|---|---|---|
| 连接超时 | 2s | 同机容器，2s 已极宽松 |
| 读超时（解析） | 120s | 5 万行表格抽取的最坏估计 |
| 读超时（措辞生成） | 30s | 单次文本生成 |
| 重试 | 仅对连接失败与 5xx，最多 1 次，指数退避 1s | 解析非幂等风险低但耗时长，不无限重试 |
| 熔断 | 连续 5 次失败开启 60s 熔断，期间直接降级 | 防止线程池被拖死 |
| 并发上限 | 解析线程池 2 线程、队列 4，满则拒绝并提示稍后 | 与单用户假设匹配，保护内存 |

---

## 四、工程结构

### 4.1 backend：单 Maven 工程，按包分模块

```
backend/
  pom.xml · Dockerfile
  src/main/java/com/coolpilotx/
    common/          统一响应、异常、BigDecimal 工具、时间、分页
    identity/  customer/  case/(+statemachine)  authorization/  document/
    dataimport/(+worker)  dataquality/  finance/{statement,transaction,debt,metric}
    analysis/  assessment/  review/  report/(+render)  aigateway/  audit/
    infrastructure/{storage,parser,ai,config}
    每个业务包内固定四层：api / application / domain / infrastructure
  src/main/resources/
    application.yml  application-dev.yml  application-prod.yml
    db/migration/    V1__baseline.sql, V2__...sql
    mapper/          仅复杂查询的 MyBatis XML
  src/test/java/     单元测试 + ArchUnit 架构测试 + Testcontainers 集成测试
```

**每个业务包内四层**（api / application / domain / infrastructure），依赖方向单向向内；`domain` 不打 `@Service`、不引 MyBatis（CPX-DOMAIN-01 §五）。

### 4.2 为什么首期不拆 Maven 子模块

| 维度 | 单工程按包分 | 多 Maven 模块 |
|---|---|---|
| 构建时间 | 一次编译，秒级 | 模块间 reactor 编排，配置成本先付 |
| 依赖可见性 | 靠 ArchUnit 约束 | 编译期强制，但需维护 15 个 pom |
| 重构成本 | 移动包即可 | 移动包 + 改 15 处依赖声明 |
| 团队规模 | 1 人 | 3 人以上才有收益 |
| 发布 | 一个 jar | 仍是同一个部署单元，无独立发布收益 |

**裁定**：模块边界用**包 + ArchUnit 断言**表达，不用 Maven 模块表达。边界是否被破坏，靠 CI 里的架构测试兜底，而不是靠 pom。

### 4.3 什么条件下才拆

满足**任意两条**即启动拆分，否则不拆：① 单工程编译 >3 分钟或全量测试 >15 分钟；② 某 `application` 层被 3 个以上包交叉依赖，ArchUnit 已难以表达；③ 需要独立部署某组能力（如报告渲染单独扩容）；④ 开发者 >3 人且频繁冲突；⑤ 某些包的第三方依赖版本无法在同一 classpath 共存。

拆分顺序（若发生）：`common` → `domain 内核（case/finance）` → `aigateway/report` 等边缘能力。**绝不先拆 `web`/`service`/`dao` 这种技术层模块**。

### 4.4 ai-service 目录结构

```
ai-service/
  pyproject.toml     依赖锁定：fastapi / uvicorn / pymupdf / python-docx / openpyxl / pydantic
  Dockerfile
  app/
    main.py          FastAPI 实例、路由挂载、异常处理器
    api/v1/          parse.py（流水/报表）· classify.py · extract.py · draft.py · health.py
    schemas/         Pydantic 模型，与 Java DTO 一一对应
    document/        pdf_text.py · docx_parser.py · xlsx_parser.py（取内容、版面与表格还原）
    extraction/      bank_statement.py · statement_mapper.py（取字段、列映射、行级校验）
    agents/          document_agent · data_quality_agent · finance_agent · report_agent
    rag/             知识库检索（首期 pg_trgm）
    llm/             client.py（超时/重试/用量）
    prompts/         提示词模板（顶层，供 llm 与 agents 共用，带版本号）
    evaluation/      离线评测脚本（只被 CLI 调用，不入生产路径）
    core/            config.py（环境变量）· logging.py（traceId）· errors.py（统一错误码）
  tests/             fixtures/ 脱敏样例 · test_bank_statement.py
```

> 与 CPX-AI-01 §3 一致：`document` 负责"取内容"，`extraction` 负责"取字段"，`prompts` 提为顶层。把解析和抽取混在一个 `parsers/` 目录里，会在接入第二个报表格式时立刻变成一团泥。

**Python 侧三条硬约束**：

1. 所有响应必须是可被 Java 校验的**结构化数据**，不返回自由文本结论。
2. 每个响应带 `parserVersion` 与 `warnings[]`，Java 侧必须落库（CPX-DOMAIN-01 §3.6）。
3. 不做任何金额汇总、比率计算——只做"取值"，不算"算账"。

---

## 五、配置与环境

### 5.1 配置文件分层

| 文件 | 内容 | 是否入 Git |
|---|---|---|
| `application.yml` | 公共配置：Jackson、MyBatis、Flyway、日志格式、线程池、上传限制 | 是 |
| `application-dev.yml` | 本地连接串、SQL 日志、`flyway.clean-disabled=false`、热重载 | 是 |
| `application-prod.yml` | 连接池调优、日志级别 INFO、`clean-disabled=true`、关闭 Swagger | 是 |
| `.env`（Compose 用） | 数据库口令、JWT 密钥、AI 令牌、外部模型 Key | **否**（`.gitignore`） |
| `secrets/*.txt` | 同上，以 Docker secret 方式挂载 | **否** |

激活方式：`SPRING_PROFILES_ACTIVE=prod`，由 Compose 注入，不写死在镜像里。

### 5.2 敏感配置注入

**原则：镜像内零密钥，配置全部来自环境变量。** 密钥缺失时直接启动失败（fail-fast），不允许"用默认值兜底"——这是最容易被忽略的高危默认值。

| 配置 | 环境变量 | 说明 |
|---|---|---|
| 数据库 URL | `SPRING_DATASOURCE_URL` | `jdbc:postgresql://postgres:5432/coolpilotx?TimeZone=UTC`（A-05） |
| 数据库用户/口令 | `SPRING_DATASOURCE_USERNAME` / `_PASSWORD` | 口令由 secret 文件注入 |
| JWT 签名密钥 | `CPX_SECURITY_JWT_SECRET` | ≥32 字节，启动时校验长度，不合格拒绝启动 |
| AI 服务地址 | `CPX_AI_BASE_URL` | 默认 `http://ai-service:8000` |
| AI 服务令牌 | `CPX_AI_TOKEN` | 双向共享密钥，Python 侧校验 `X-Internal-Token` |
| 存储根目录 | `CPX_STORAGE_ROOT` | 默认 `/app/storage` |
| 外部模型 Key | `CPX_LLM_API_KEY` | **只给 ai-service**，Java 不持有 |

### 5.3 数据库连接池参数

HikariCP，面向"单用户 + 少量后台线程"的实际负载：

| 参数 | 值 | 依据 |
|---|---|---|
| `maximum-pool-size` | 10 | 单用户 HTTP 并发 ≤4；解析线程 2；定时任务 1；留 3 缓冲。PG 默认 `max_connections=100`，单实例占 10 完全安全 |
| `minimum-idle` | 5 | 低于 5 会在空闲后重建连接，PG 建连约 20–50ms，保留半数避免首请求抖动 |
| `connection-timeout` | 3000ms | 超过 3s 说明池已耗尽，早失败优于排队 |
| `idle-timeout` | 600000ms（10min） | 与 `keepalive` 配合，避免被网络设备静默断连 |
| `max-lifetime` | 1800000ms（30min） | 小于常见防火墙/负载均衡的 1h 空闲回收阈值 |
| `keepalive-time` | 300000ms（5min） | 主动探活；`validation-timeout` 2000ms；`auto-commit=false`（事务由 Spring 管理） |
| `leak-detection-threshold` | 20000ms | 借用超 20s 未归还打 WARN 并输出堆栈，用于发现长事务/漏关连接 |

**不设更大的池**：连接数不是吞吐瓶颈，PG 的并发写受 WAL 与 fsync 限制；盲目放大只会增加上下文切换与内存占用。若日后出现"池等待"告警，先查慢 SQL 与长事务，再考虑加池。

**批处理配套**：MyBatis `ExecutorType.BATCH`，`reWriteBatchedInserts=true`，单批 2000 行。

---

## 六、非功能需求

### 6.1 性能目标

| 场景 | 目标 | 度量点 | 备注 |
|---|---|---|---|
| 上传受理（≤50MB） | ≤2s（P95） | 接口返回 202 | 落盘 + 元数据，不含解析 |
| 5 万笔流水导入并解析完成 | ≤60s | 批次进入 `PARSED` | 含 Python 抽取 + 入库 |
| 单页列表查询（1000 行/页） | ≤800ms（P95） | 接口耗时 | 走覆盖索引 |
| 案件详情聚合 | ≤500ms（P95） | 接口耗时 | 只读查询服务直拼 SQL |
| 报告渲染（30 页、无 AI 同步调用） | ≤3s | 生成 PDF 完成 | 确定性渲染，模板预编译 |
| 指标全量重算（单案件） | ≤10s | 任务完成 | Java 内存计算 + 批量写 |
| AI 文字生成（单段） | ≤30s，失败可降级 | 建议表就绪 | 不阻塞报告签发 |

**60s 目标的现实性**：瓶颈在 Python 表格抽取而非数据库写入。5 万行批量插入在 PG 上约 3–6s（2000 行/批），因此预算分配为：抽取 ≤45s、传输 ≤3s、校验 ≤4s、入库 ≤8s。若抽取超预算，触发风险 R2。

### 6.2 并发假设

| 项 | 首期假设 | 设计余量 |
|---|---|---|
| 同时在线用户 | 1 | 支持 ≤5 不降级 |
| 并发 HTTP 请求 | ≤4 | Tomcat `max-threads=50`，实际用不到 |
| 同时解析任务 | 1 | 线程池 2，队列 4，超出直接拒绝 |
| 同时写同一案件 | 1 | 乐观锁 + 幂等键兜底 |
| 数据规模 | ≤50 客户、≤200 案件、≤300 万流水行 | 单表千万级内不分区 |

**明确不做的并发优化**：分布式锁、读写分离、连接池分片——在单用户假设下均为负收益。

### 6.3 可用性

| 项 | 目标 | 手段 |
|---|---|---|
| 服务可用性 | 单机，目标 99%（非 99.9%） | 容器 `restart: unless-stopped` + 健康检查 |
| 故障恢复 | RTO ≤30min | 重拉容器 / 从备份恢复 |
| 数据恢复 | RPO ≤24h（每日备份） | `pg_dump` 每日 + 周度基础备份 + 文件增量同步 |
| 降级 | AI 全不可用时核心流程仍可走 | 解析失败转人工录入；报告渲染不依赖 AI |
| 计划内维护 | 可接受 10 分钟停机 | 单机不做蓝绿，滚动无意义 |

**诚实结论**：单机架构不可能做到高可用。这里不假装有 SLA，而是用"备份可恢复 + 快速重拉"覆盖真实风险。真正的可用性升级（主备、多机）列入非目标。

### 6.4 日志与可观测性

| 类型 | 落地方式 | 保留 |
|---|---|---|
| 应用日志 | JSON 行格式（`logstash-logback-encoder`），字段固定：`ts, level, logger, traceId, userId, caseId, msg, durMs` | 30 天，按天滚动，单文件 100MB |
| 访问日志 | Nginx `access_log` 自定义格式，含 `$request_time`、`$upstream_response_time` | 14 天 |
| 审计日志 | `cpx_audit_log`，append-only + 按月分区（A-12），异步批量写 | 永久（归档分区） |
| 慢查询 | PG `log_min_duration_statement = 500ms`；应用侧 MyBatis 拦截器记录 >500ms 的 SQL 与参数 | 30 天 |
| 链路追踪 | 自建 `traceId`：Nginx 生成 → 请求头透传 → MDC → 日志 → 调 Python 时透传 | 随日志 |
| 指标 | `actuator/prometheus` 暴露 JVM、Hikari、HTTP、自定义业务计数（导入行数、解析失败数） | 30 天 |

**首期不引入 ELK / Prometheus 服务端**：日志落文件 + `docker logs` + grep 足够单机单用户使用，指标端点先留出。**审计写入不能丢也不能拖慢主流程**：进程内有界队列（10000）+ 批量 flush（200 条或 1s），队列满时降级为同步写并打 WARN。

**必查的五个告警信号**（当前用日志关键字 + 定时脚本，不上告警平台）：
`STATE_CONFLICT` 突增、`leak-detection` WARN、慢查询 >2s、批次 `FAILED` 率 >10%、磁盘使用 >80%。

---

## 七、构建与发布

### 7.1 本地开发流程

```
1. docker compose up -d postgres          # 只起数据库
2. cd backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
3. cd ai-service && uvicorn app.main:app --reload --port 8000
4. cd frontend && npm run dev             # Vite 代理 /api → localhost:8080
5. 前端构建产物由 Nginx 托管；开发期不经过 Nginx
```

- 数据库结构变更只能通过新增 `V{n}__{desc}.sql`，禁止手改库后补脚本；本地 `flyway.clean-disabled=false` 允许重建，`prod` 必须为 `true` 且 CI 加断言防误配。

### 7.2 镜像构建

| 镜像 | 基础镜像 | 要点 |
|---|---|---|
| `backend` | `eclipse-temurin:21-jre-alpine` | 多阶段构建；先拷 `pom.xml` 拉依赖再拷源码以复用层缓存；非 root 用户运行；`JAVA_TOOL_OPTIONS` 设 `-XX:MaxRAMPercentage=60` |
| `ai-service` | `python:3.12-slim` | `pip install --no-cache-dir`；预下载模型/字体；非 root；`PYTHONUNBUFFERED=1` |
| `frontend` | 构建产物 COPY 进 `nginx:1.27-alpine` | 产物 hash 命名，`index.html` 设 `no-cache` |

镜像标签：`cpx/backend:1.4.0` 与 `cpx/backend:latest` 双打；**部署只用确定版本号，不用 `latest`**。

### 7.3 版本号规则

语义化版本 `MAJOR.MINOR.PATCH`：

| 段 | 递增条件 |
|---|---|
| MAJOR | 数据库结构不兼容变更、API 破坏性变更 |
| MINOR | 新增业务能力、新增表（向后兼容迁移） |
| PATCH | 缺陷修复、配置调整、无结构变更 |

- 单一版本号贯穿 backend / ai-service / frontend，三者同版本发布，避免 Java 与 Python 契约错配；每次发布在 `docs/releases/{version}.md` 记录变更点、迁移脚本清单、回滚方式；镜像注入 `build.version` 与 `build.commit`。

### 7.4 数据库迁移在发布中的执行顺序

```
① 备份：pg_dump 全库 + 记录当前 flyway_schema_history 最大版本
② 预检：校验历史版本与镜像内脚本是否连续，缺失即中止
③ 摘流量：Nginx 返回 503 维护页，停旧 backend
④ 起新 backend：启动时自动 migrate（单实例，无并发迁移）；失败即进程退出、停止发布
⑤ 健康检查通过 → 起 ai-service → 恢复流量
⑥ 冒烟：建案件 → 上传样例 → 查详情 → 渲染报告 → 记录结果
```

**迁移与代码的兼容原则（扩展-收缩）**：任何一次发布，数据库必须同时兼容新旧两版代码。

| 变更类型 | 做法 |
|---|---|
| 加列 | 允许，必须可空或带默认值 |
| 加表/加索引 | 允许；大表索引用 `CREATE INDEX CONCURRENTLY`（需在独立迁移中，`flyway` 关事务） |
| 改列类型 | 分两次发布：先加新列双写，再切读，最后删旧列 |
| 删列/删表 | 至少延后一个版本，且确认无代码引用 |
| 改约束 | 先加 `NOT VALID` 约束，再 `VALIDATE` |

### 7.5 回滚策略

| 场景 | 手段 | 说明 |
|---|---|---|
| 代码缺陷、无结构变更 | 回滚镜像到上一版本 | 最快，1 分钟内 |
| 已执行向后兼容迁移 | 回滚镜像即可，**不回滚脚本** | 新列/新表对旧代码无影响 |
| 已执行破坏性迁移 | 恢复备份 + 回滚镜像 | 停机约 10–30min，须在维护窗口执行 |
| 迁移中途失败 | Flyway 事务回滚（DDL 在 PG 中事务安全）；若使用 `CONCURRENTLY` 则需手工清理 | 迁移脚本必须可重入 |
| 数据错误（逻辑层） | 用审计日志 + `metric_snapshot` 追溯，写修正迁移 | 不做"直接改库" |

**回滚脚本不写 `down` 迁移**：Flyway 社区版不支持 undo，且"反向 DDL"在数据已变更后往往不可行。取而代之的是"备份恢复"+"扩展-收缩保证向前兼容"。这一点必须在发布流程里说清楚，不能假装能优雅回滚。

---

## 八、关键技术风险与缓解

| # | 风险 | 触发信号 | 缓解措施 |
|---|---|---|---|
| R1 | **Spring Boot 4.0.8 生态兼容性**：MyBatis Starter、Flyway、springdoc、Security 的适配版本可能滞后，出现 `NoSuchMethodError` 或自动配置失效 | 依赖树解析失败、启动报 Bean 定义冲突、集成测试大面积红 | 里程碑 0 先做"空工程跑通"验证：仅含 Web + JDBC + Flyway + MyBatis 的最小工程，跑通 CRUD 与迁移后再写业务；版本全部锁定在 `pom.xml` 的 `<dependencyManagement>`；不使用 `RELEASE`/范围版本 |
| R2 | **5 万行解析超 60s**：银行流水版式差异大，表格抽取慢于预期 | 单次解析 `latencyMs > 45000`；批次 `FAILED` 中 `AI_TIMEOUT` 占比上升 | 按银行/版式缓存列映射模板，第二次起跳过 LLM；PDF 优先纯文本层，扫描件才走 OCR；解析线程池与超时可配；目标未达成时先降级为"分批返回 + 进度条"，而非直接放宽指标 |
| R3 | **解析结果质量漂移**：模型或版式变化导致金额串列、日期错位 | 人工修正率 >5%；行数对账不平；`warnings` 数量突增 | 强制"行数对账 + 金额合计对账"双校验，不平即整批 FAILED；`parserVersion` 全量记录，可按版本回归；保留 20 份黄金样例做发布前回归；表格类抽取优先用确定性规则（openpyxl 单元格直读），LLM 只补列名映射 |
| R4 | **AI 服务不可用拖垮主流程** | 熔断打开；解析线程池队列满；接口 5xx 上升 | 线程池隔离（不与 HTTP 共用）；熔断 60s 自动半开；所有 AI 调用有超时；失败一律转"待人工处理"，绝不回滚案件状态；报告渲染路径完全不依赖 AI |
| R5 | **单机资源争抢**：PG、JVM、Python 同时吃内存，OOM 或 swap 抖动 | 容器 OOMKilled；PG `out of memory`；响应时间阶梯上升 | 各容器设 CPU/内存上限（见 2.1）；JVM `MaxRAMPercentage=60`；Python 解析大文件时分块读，不整本载入；导入期间限制并发为 1 |
| R6 | **单机磁盘故障导致资料与库同时丢失** | 磁盘 SMART 告警、`pg_dump` 失败、写入报 ENOSPC | 数据卷与存储目录分离到不同物理盘（若只有一块盘，则必须做异机备份）；每日 `pg_dump` + 文件增量同步至异机；每月做一次**恢复演练**并记录耗时——没演练过的备份等于没有备份 |
| R7 | **审计日志丢失或拖慢主流程** | 队列积压 WARN；审计表写入延迟 >5s | 有界队列 + 队列满降级同步写；审计写入失败打 ERROR 并计入指标；每日对账：案件状态事件数 vs 审计记录数，差异告警 |
| R8 | **金额与时区错误**：`double` 混入、时区偏移导致期间错位 | Code Review 发现 `double`；跨月数据出现 1 天偏移；报表合计与明细不符 | CI 加 ArchUnit/正则规则禁止 `double`/`float` 出现在 `finance` 包；连接串强制 `TimeZone=UTC`；业务日期用 `date` 不用时间戳（A-05）；金额序列化为字符串，前端不做浮点运算 |
| R9 | **`pg_trgm` 检索召回不足** | 用户反馈"搜不到明明存在的条款"；平均检索点击率下降 | 首期接受（A-11 已裁定）；接口层保留 `RetrievalPort`；语料超过约 5 万段落时启动评估，届时换 BGE-M3 + 向量库，业务代码不变 |
| R10 | **乐观锁冲突与幂等表膨胀** | `409 STATE_CONFLICT` 频发；`cpx_idempotency` 行数超百万 | 前端提交带 `version` 与 `Idempotency-Key`；冲突时返回真实状态引导刷新；幂等表按 24h TTL 定时清理并建索引；单用户下冲突属异常，出现即排查而非加大重试 |

---

## 九、明确不做的事（首期）

| 不做 | 理由 | 何时重新评估 |
|---|---|---|
| 微服务拆分 | 单用户、单进程足够；拆分带来分布式事务、服务发现、链路追踪的净成本 | 出现独立扩容需求或团队 >3 人 |
| 消息队列（RabbitMQ/RocketMQ） | 领域事件用 Spring `ApplicationEventPublisher` 同步分发，失败即回滚，语义更简单 | 需要跨进程异步或事件重放时 |
| Kafka | 无流式场景，无多消费者 | 同上，且数据量级需先达标 |
| Redis | 无缓存热点、无分布式锁需求、无会话共享需求 | 出现明确的缓存收益或多实例会话 |
| Elasticsearch | `pg_trgm` + GIN 已覆盖中文短语检索（A-11） | 语料 >5 万段落且召回不达标 |
| 向量库（Milvus/pgvector） | 首期检索价值未验证，引入即过度设计（A-11） | 语义检索成为明确痛点 |
| 多租户 SaaS | 首期单用户，`tenant_id` 收益为零、成本全局（A-06） | 确定对外服务第二位客户时 |
| **自动授信评分 / 通过率预测** | 系统定位是"融资准备度评估"，不做信贷决策；输出授信结论存在合规与法律风险 | **永不做**（产品红线，非技术取舍） |
| 自研状态机框架化 / 分布式锁 / 读写分离 / 分库分表 | 表驱动 + 守卫函数已够用（A-07）；单机单用户，其余均为负收益 | 数据量或并发量级发生变化后 |
| Kubernetes / 完整 CI/CD 平台 | Compose 单机更简单，运维成本低一个数量级；发布频率低 | 需要多机编排，或每周发布 >3 次 |
| 移动端 / 小程序 / SSO（LDAP） | 桌面端为主，单账号本地认证足够 | 客户自助上传、多顾问协作成为需求时 |

---

## 十、与既有裁定的对应关系

| 本文结论 | 来源 | 一致性 |
|---|---|---|
| Java 为业务事实权威，Python 仅出建议 | ADR-001 A-08 / A-09 | 一致，本文补进程边界与表级授权 |
| 二进制不落库，走 `StoragePort`；审计 append-only + 月分区 | ADR-001 A-10 / A-12 | 一致，本文补卷规则与队列降级 |
| 首期单租户、无 `tenant_id`；`numeric(18,2)` + `timestamptz` UTC | ADR-001 A-06 / A-02 / A-05 | 一致，本文落到连接串与 CI 静态检查 |
| 单 Maven 工程按包分模块；领域事件进程内同步，不引 MQ | CPX-DOMAIN-01 §五 §六 | 一致，本文补拆分触发条件 |
| AI 失败不回滚案件状态；批次整体可回滚 | CPX-BIZ-01 §4.3 / CPX-DOMAIN-01 §3.6 | 一致，本文落为"熔断隔离 + 分批提交 + 按批次清理" |

**技术栈锁定（不再讨论）**：Vue 3 + Vite + Element Plus + TypeScript / Java 21 + Spring Boot 4.0.8 + MyBatis + PostgreSQL 16 + Flyway / Python + FastAPI + PyMuPDF + python-docx + openpyxl / Docker Compose + Nginx。向量库首期不引入。

---

## 十一、待确认

1. **分批提交策略**（§3.2）：接受"每 2000 行一事务 + 按批次删除"的业务级回滚，还是坚持单事务（会显著拖慢 5 万行导入并增加锁风险）？本文取前者。
2. **AI 服务是否直连数据库**（§1.4）：本文允许其以受限账号写两张 AI 表。若倾向"完全不连库、由 Java 代写"，则 Python 变为纯无状态服务，代价是 Java 多一次写库编排。
3. **Spring Boot 4.0.8 的生态验证**（R1）：是否接受在正式开发前插入一个"里程碑 0 空工程验证"，约半天工作量，用来提前暴露版本兼容问题。
4. **备份目标机器**（R6）：是否有第二台机器或对象存储可放 `pg_dump` 与文件增量？没有的话，单机故障等于数据全失，这一点需要明确接受。
