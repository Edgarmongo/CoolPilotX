"""CoolPilotX AI 服务入口。

边界（不可违背，见 docs/architecture/ai-architecture.md）：
- 本服务只提供文档解析、字段提取、LLM 调用、RAG 检索与 Agent 编排能力
- 不写任何业务表，只写 cpx_ai_suggestion 与 cpx_ai_execution_log
- 不做金额汇总与财务计算，那是 Java 的职责
- 返回结构化数据，不返回自由文本结论
"""

from fastapi import FastAPI

app = FastAPI(
    title="CoolPilotX AI Service",
    version="0.1.0",
    description="文档解析与 AI 辅助能力服务",
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """进程活性探针。不校验下游依赖，避免 AI 不可用时把主流程拖垮。"""
    return {"status": "ok", "service": "coolpilotx-ai-service"}
