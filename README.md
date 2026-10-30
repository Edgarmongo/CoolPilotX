# CoolPilotX

企业融资准备与分析系统。基于企业授权提供的资料，整理经营情况、分析资金需求、识别资料缺口，形成经过人工复核的融资准备报告。

**当前状态**：工程骨架已就绪（20 个 Maven 模块可构建），业务功能尚未实现。设计基线已完成，见 [`docs/`](docs/README.md)。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3 + Vite + Element Plus + TypeScript |
| 核心后端 | Java 21 + Spring Boot 4.0.8 + MyBatis |
| 数据库 | PostgreSQL 16 + Flyway |
| AI 服务 | Python 3.12 + FastAPI |
| 部署 | Docker Compose + Nginx |

**边界**：Java 是业务事实与流程状态的权威来源；Python 是可替换的 AI 能力服务，只能写建议表。这条用数据库角色权限强制。

---

## 目录结构

```
CoolPilotX/
├── backend/                  核心业务平台（19 个 Maven 模块）
│   ├── pom.xml               父 POM：Spring Boot 4.0.8 / Java 21
│   ├── cpx-common/           基础类型、错误、工具
│   ├── cpx-identity/         用户·角色·权限
│   ├── cpx-customer/         企业客户·联系人
│   ├── cpx-case/             融资案件·需求·案件生命周期
│   ├── cpx-authorization/    客户授权·数据范围
│   ├── cpx-evidence/         数据版本·证据引用·血缘
│   ├── cpx-document/         文件·版本·核验
│   ├── cpx-data/             导入批次·质量检查
│   ├── cpx-finance/          报表·流水·债务·指标
│   ├── cpx-analysis/         分析轮次·经营与资金分析
│   ├── cpx-assessment/       待核实事项·风险事项·准备度评估
│   ├── cpx-review/           人工复核
│   ├── cpx-report/           报告·版本·签发·交付
│   ├── cpx-ai/               AI 契约与策略（厂商中立）
│   ├── cpx-knowledge/        知识库与检索
│   ├── cpx-audit/            审计
│   ├── cpx-infrastructure/   适配器：存储·模型·解析客户端
│   ├── cpx-web/              HTTP 适配层（唯一的 Controller 所在）
│   └── cpx-boot/             装配根·唯一启动入口·Flyway 迁移
├── frontend/                 Vue 3 前端
│   └── src/{api,components,layouts,router,stores,types,utils,views}
├── ai-service/               Python AI 服务
│   └── app/{api,core,schemas,document,extraction,agents,rag,llm,prompts,evaluation}
├── database/                 参考 SQL 与种子数据
├── deploy/                   Docker、Nginx、配置、脚本
├── docs/                     设计与产品文档（见 docs/README.md）
├── scripts/                  本地开发脚本
├── storage/                  运行时文件（客户资料，不入 Git）
└── tests/                    端到端 / 集成 / 验收 / 测试数据
```

模块依赖方向由 POM 强制，越界即编译失败。见 [`docs/decisions/ADR-002-多模块结构.md`](docs/decisions/ADR-002-多模块结构.md)。

---

## 快速开始

### 前置条件

- JDK 21、Maven 3.9+
- PostgreSQL 16
- Node 20+（前端）
- Python 3.12+（AI 服务）

### 配置 Maven 镜像

Maven Central 在国内常不可直连。在 `~/.m2/settings.xml` 配置阿里云镜像：

```xml
<mirror>
  <id>aliyun-public</id>
  <url>https://maven.aliyun.com/repository/public</url>
  <mirrorOf>central</mirrorOf>
</mirror>
```

### 构建后端

```bash
mvn -f backend/pom.xml -DskipTests package
```

### 启动数据库

```bash
cp .env.example .env      # 填写 CPX_DB_PASSWORD
docker compose up -d postgres
```

### 启动 AI 服务

```bash
cd ai-service
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

### 启动前端

```bash
cd frontend
npm install
npm run dev
```

---

## 文档

设计文档是项目的约束来源，**改代码前先读**：

| 文档 | 内容 |
|---|---|
| [产品基线 V1.0](docs/product/product-baseline-v1.md) | 定位、三条硬修正、九条冻结原则、术语表 |
| [领域模型](docs/business/financing-domain-model.md) | 六域 + 证据域、20 条不变量 |
| [业务流程与状态机](docs/business/financing-workflow.md) | 五个独立生命周期 |
| [数据库设计](docs/database/er-design.md) | 47 张表、追溯链 |
| [模块边界](docs/architecture/backend-module-boundaries.md) | 依赖矩阵、Port、ArchUnit |
| [首期任务卡](docs/tasks/mvp-scope.md) | CPX-01~06、验收标准 |
| [待决策清单](docs/decisions/OPEN-QUESTIONS.md) | 开工前必须先定的事 |

开发规则见 [`AGENTS.md`](AGENTS.md)。

---

## 这套系统不做什么

- 不代替银行作出授信决定，不承诺获批额度、利率或放款时间
- 不建立"银行通过率评分"
- 不编造经营事实，不为资料做包装
- 不在未经授权的情况下获取征信、账户及内部银行数据

报告的结论是**资料准备情况与待核实事项**，不是"银行会不会贷款"。
