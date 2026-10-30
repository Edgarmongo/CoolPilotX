# CoolPilotX — 项目开发规则

本文件约束本仓库内的所有改动。改代码前先读 `docs/README.md` 与对应模块的设计文档。
**设计文档描述的是目标，代码与 POM 才是当前事实。** 不要把计划中的设计说成已实现。

## 一、模块边界（Maven 强制，不只是约定）

后端是模块化单体：`cpx-boot` 是装配根与唯一启动入口，`cpx-web` 是唯一的 HTTP 适配层。

| 规则 | 说明 |
|---|---|
| Controller、HTTP DTO、参数校验、HTTP 异常映射只允许出现在 `cpx-web` | 业务模块不得引入 Spring MVC、Servlet、`MultipartFile` |
| 业务模块不得依赖 `cpx-boot` | 启动模块只能被依赖，不能反向依赖 |
| 禁止 Maven 循环依赖 | 依赖方向见 `docs/architecture/backend-module-boundaries.md` |
| 跨模块只通过 `application` 接口或领域事件 | 不得直接调用其他模块的 Mapper |
| 仅 `cpx-audit` 可写 `cpx_audit_log` | 其他模块通过 Port 调用 |
| `cpx-evidence` 不反向依赖任何业务域 | 它提供引用与校验能力，不感知业务语义 |
| `cpx-ai` 只放厂商中立的契约与策略 | 供应商 SDK、HTTP 实现、专有 DTO 一律放 `cpx-infrastructure` |

## 二、金额与计算

- 金额一律 `BigDecimal` + PostgreSQL `numeric(18,2)`。禁止 `double` / `float` 参与任何金额运算。
- `BigDecimal` 比较必须用 `compareTo`，禁止 `equals`（`1.0` 与 `1.00` 不相等）。
- 除法统一 `divide(divisor, 6, RoundingMode.HALF_UP)`，展示层再二次舍入。
- 金额、比率、期间汇总、账龄、偿债倍数**只能由 Java 计算**。AI 输出不得成为任何权威财务结果。

## 三、状态与数据

- 五个生命周期各自独立，不得合回单一 `status` 字段：案件 `lifecycle`、分析轮次、报告版本、资料项、待核实事项。
- 状态流转必须走状态机，且每次流转落一条事件（操作人、时间、原因、守卫结果）。
- 原始文件不可修改，只能新增版本。
- 上传 ≠ 已核实：`VERIFIED` 只能由人工动作推进。
- 新数据版本必须开启新一轮分析；旧轮保留、只读。
- AI 只能写 `cpx_ai_suggestion` 与 `cpx_ai_execution_log`，不得写任何业务表。

## 四、报告与证据

- 报告中的每个数字必须挂 `EvidenceReference`；渲染器校验不通过即中止，不得降级生成。
- 证据引用的 `dataVersionId` 必须等于报告所绑轮次的数据版本，跨版本引用一律拒绝。
- 表述不得出现定性指控词（隐瞒/造假/虚假/欺诈/恶意/骗贷等），写库前由词典拦截。
- 结论只说"资料准备情况与待核实事项"，不得出现授信评级、通过率、获批概率。

## 五、数据安全

- `storage/` 下的客户资料不得提交，已在 `.gitignore` 中排除。
- 密钥、数据库口令一律通过环境变量注入，禁止写入配置文件与代码。
- 客户数据默认留在受控环境；调用外部模型必须经授权。

## 六、开发流程

1. 先设计、只读审计，再形成任务卡（`docs/tasks/`），经批准后实施。
2. 每一阶段结束同步更新设计文档；文档与代码冲突时，先对齐再改代码。
3. 提交前必须能通过 `mvn -f backend/pom.xml -DskipTests package`。
4. 数据库变更一律通过 Flyway 迁移（`cpx-boot/src/main/resources/db/migration`），禁止手工改库。
