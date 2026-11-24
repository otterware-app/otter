import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tool_free import MARK, mark_answer, refuse_tools, without_tools  # noqa: E402

REQUEST = {"model": "m", "input": [], "tools": [{"name": "terminal"}], "tool_choice": "auto"}


def test_other_sessions_untouched():
    assert without_tools(request=REQUEST, session_id="api_1") is None
    assert refuse_tools(session_id="api_1") is None
    assert mark_answer(response_text="hi", session_id="api_1") is None


def test_no_tools_and_marked():
    rewritten = without_tools(request=REQUEST, session_id="otter-ask-1")["request"]
    assert rewritten == {"model": "m", "input": []}
    assert REQUEST["tools"]
    assert mark_answer(response_text="[]", session_id="otter-ask-1") == MARK + "[]"
    assert mark_answer(response_text="[]", session_id="otter-ask-1") is None


def test_refused_tool_is_never_marked():
    without_tools(request=REQUEST, session_id="otter-ask-2")
    assert refuse_tools(session_id="otter-ask-2")["action"] == "block"
    without_tools(request=REQUEST, session_id="otter-ask-2")
    assert mark_answer(response_text="[]", session_id="otter-ask-2") is None


def test_unstripped_is_never_marked():
    assert mark_answer(response_text="[]", session_id="otter-ask-3") is None
