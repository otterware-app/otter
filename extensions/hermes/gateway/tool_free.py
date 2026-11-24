"""Otter's one-off questions over text nobody vetted (its notes on your mail): asked in a session
whose id starts with `otter-ask-`, where the model is given no tools and any tool call is refused.
An answer starts with MARK only when every model request of its session went without tools, so
Otter sends nothing it hasn't checked to a Hermes without this."""

PREFIX = "otter-ask-"
MARK = "[otter:tool-free]\n"
_TOOL_KEYS = ("tools", "tool_choice", "parallel_tool_calls", "functions", "function_call")

_stripped: set[str] = set()
_tried_tools: set[str] = set()


def _ours(session_id) -> bool:
    return isinstance(session_id, str) and session_id.startswith(PREFIX)


def without_tools(request=None, session_id="", **_):
    if not _ours(session_id) or not isinstance(request, dict):
        return None
    _stripped.add(session_id)
    return {
        "request": {k: v for k, v in request.items() if k not in _TOOL_KEYS},
        "source": "otter",
        "reason": "Otter's question is answered without tools",
    }


def refuse_tools(session_id="", **_):
    if _ours(session_id):
        _tried_tools.add(session_id)
        return {"action": "block", "message": "No tools in this session."}
    return None


def mark_answer(response_text="", session_id="", **_):
    if not _ours(session_id):
        return None
    clean = session_id in _stripped and session_id not in _tried_tools
    _stripped.discard(session_id)
    _tried_tools.discard(session_id)
    return MARK + response_text if clean and response_text else None


def register(ctx) -> None:
    ctx.register_middleware("llm_request", without_tools)
    ctx.register_hook("pre_tool_call", refuse_tools)
    ctx.register_hook("transform_llm_output", mark_answer)
