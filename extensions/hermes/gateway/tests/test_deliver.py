import asyncio
import importlib.util
import logging
import sys
from pathlib import Path

import pytest

pytest.importorskip("hermes_state", reason="needs Hermes's Python environment")

PLUGIN = Path(__file__).resolve().parents[1]


@pytest.fixture
def plugin(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    for name in ("OTTER_RELAY_URL", "OTTER_CHANNEL_TOKEN", "OTTER_HOME_CHANNEL"):
        monkeypatch.delenv(name, raising=False)
    spec = importlib.util.spec_from_file_location(
        "otter_plugin", PLUGIN / "__init__.py", submodule_search_locations=[str(PLUGIN)]
    )
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "otter_plugin", module)
    spec.loader.exec_module(module)
    from otter_plugin import adapter

    return adapter


def _db():
    from hermes_constants import get_hermes_home
    from hermes_state import SessionDB

    return SessionDB(get_hermes_home() / "state.db")


def test_new_chat_kept_when_the_relay_is_down(plugin, caplog):
    extra = {"relay_url": "http://127.0.0.1:1", "token": "otter_ch_secret"}
    wrapped = (
        "Cronjob Response: Morning brief\n(job_id: 0a1b2c)\n-------------\n\n**Today**\n\n"
        'To stop or manage this job, send me a new message (e.g. "stop reminder Morning brief").'
    )
    with caplog.at_level(logging.WARNING):
        first = asyncio.run(plugin.deliver(extra, "new", wrapped))
        second = asyncio.run(plugin.deliver(extra, "new", wrapped))
    assert first["success"] and second["success"]
    db = _db()
    session = db.get_session(first["message_id"])
    assert session["source"] == "otter"
    assert db.get_session_title(first["message_id"]) == "Morning brief"
    assert db.get_session_title(second["message_id"]) == "Morning brief #2"
    messages = db.get_messages(first["message_id"])
    assert [(m["role"], m["content"]) for m in messages] == [("assistant", "**Today**")]
    assert "telling the relay" in caplog.text and "otter_ch_secret" not in caplog.text


def test_existing_chat_and_missing_one(plugin):
    extra = {"relay_url": "http://127.0.0.1:1", "token": "otter_ch_t"}
    db = _db()
    db.create_session("api_1794185043_bb138f58", "api_server")
    result = asyncio.run(plugin.deliver(extra, "api_1794185043_bb138f58", "Plain message"))
    assert result == {"success": True, "message_id": "api_1794185043_bb138f58"}
    assert db.get_messages("api_1794185043_bb138f58")[-1]["content"] == "Plain message"
    assert db.get_session_title("api_1794185043_bb138f58") is None
    assert asyncio.run(plugin.deliver(extra, "api_0_missing", "x")) == {"error": "no Hermes session api_0_missing"}
    assert "error" in asyncio.run(plugin.deliver(extra, "not a chat", "x"))


def test_tells_the_relay_the_chats_title(plugin, monkeypatch):
    told = []

    async def post(url, token, pointer):
        told.append(pointer)

    monkeypatch.setattr(plugin, "post_pointer", post)
    extra = {"relay_url": "http://relay.test", "token": "otter_ch_t"}
    new = asyncio.run(plugin.deliver(extra, "new", "Hi"))
    db = _db()
    db.create_session("api_1794185043_cc249f69", "api_server")
    db.set_session_title("api_1794185043_cc249f69", "Trip to Lisbon")
    asyncio.run(plugin.deliver(extra, "api_1794185043_cc249f69", "Booked."))
    assert [(p["sessionKey"], p.get("title"), p["agentName"]) for p in told] == [
        (new["message_id"], "Hermes", "Hermes"),
        ("api_1794185043_cc249f69", "Trip to Lisbon", "Hermes"),
    ]
    assert all("Booked." not in str(p) for p in told)


def test_plain_send_is_titled_hermes(plugin):
    result = asyncio.run(plugin.deliver({"relay_url": "http://127.0.0.1:1", "token": "t"}, "new", "Hi"))
    assert _db().get_session_title(result["message_id"]) == "Hermes"


def test_registers_with_this_hermes(plugin):
    from gateway.platform_registry import PlatformEntry

    entries = []

    class Ctx:
        def register_platform(self, **fields):
            entries.append(PlatformEntry(source="plugin", **fields))

    package = sys.modules["otter_plugin"]
    package.register(Ctx())
    (entry,) = entries
    assert entry.name == "otter" and entry.cron_deliver_env_var == "OTTER_HOME_CHANNEL"
    assert entry.standalone_sender_fn is not None and entry.platform_hint
