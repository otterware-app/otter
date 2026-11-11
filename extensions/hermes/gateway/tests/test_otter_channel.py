import asyncio
import sys
from pathlib import Path

import pytest
from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from otter_channel import (  # noqa: E402
    NEW_CHAT,
    parse_target,
    pointer_of,
    post_pointer,
    redact,
    unwrap_cron,
)


def test_targets():
    assert parse_target("new") == NEW_CHAT
    assert parse_target(" api_1793000000_0a1b2c3d ") == "api_1793000000_0a1b2c3d"
    assert parse_target("20261109_101500_abc123") == "20261109_101500_abc123"
    for bad in ("", "  ", "a b", "x:y", "../etc", "-new", "a" * 200):
        assert parse_target(bad) is None


def test_pointer():
    assert pointer_of("api_1_2", at=1234) == {
        "kind": "message",
        "agentId": "hermes",
        "sessionKey": "api_1_2",
        "agentName": "Hermes",
        "at": 1234,
    }
    assert pointer_of("api_1_2", "Morning brief", at=1)["title"] == "Morning brief"
    assert isinstance(pointer_of("s")["at"], int)


def test_unwrap_cron():
    wrapped = (
        "Cronjob Response: Morning brief\n(job_id: 0a1b2c)\n-------------\n\n"
        "**Today**\n\nThree meetings.\n\n"
        'To stop or manage this job, send me a new message (e.g. "stop reminder Morning brief").'
    )
    assert unwrap_cron(wrapped) == ("Morning brief", "**Today**\n\nThree meetings.")
    assert unwrap_cron("just a message") == (None, "just a message")


def test_redact():
    assert redact("Bearer otter_ch_secret failed", "otter_ch_secret") == "Bearer otter_ch_… failed"
    assert redact("nothing", "") == "nothing"


def _relay(status: int):
    received = []

    async def pointers(request):
        received.append((request.headers.get("Authorization"), await request.json()))
        return web.Response(status=status, text="no")

    app = web.Application()
    app.router.add_post("/channel/v1/pointers", pointers)
    return app, received


async def _with_relay(status, fn):
    app, received = _relay(status)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    try:
        await fn(f"http://127.0.0.1:{port}/")
    finally:
        await runner.cleanup()
    return received


def test_post_pointer():
    pointer = pointer_of("api_1_2", at=5)
    received = asyncio.run(_with_relay(202, lambda url: post_pointer(url, "otter_ch_t", pointer)))
    assert received == [("Bearer otter_ch_t", pointer)]


def test_post_pointer_refused():
    async def post(url):
        with pytest.raises(RuntimeError, match="401"):
            await post_pointer(url, "otter_ch_t", pointer_of("s"))

    asyncio.run(_with_relay(401, post))
