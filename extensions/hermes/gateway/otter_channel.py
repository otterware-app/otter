"""What the Otter channel does apart from Hermes's gateway, so its tests run without one."""

import re
import time
from typing import Optional

import aiohttp

NEW_CHAT = "new"
AGENT_ID = "hermes"
AGENT_NAME = "Hermes"
DEFAULT_TITLE = "Hermes"

_SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
# cron/scheduler_delivery.py's wrap_response; the chat is titled with the job instead.
_CRON_WRAPPER = re.compile(
    r"^Cronjob Response: (?P<name>[^\n]*)\n\(job_id: [^\n]*\)\n-------------\n\n(?P<body>.*)\n\n"
    r'To stop or manage this job, send me a new message \(e\.g\. "stop reminder [^\n]*"\)\.$',
    re.S,
)


def parse_target(ref: str) -> Optional[str]:
    """`new`, or the id of a Hermes session (an Otter chat); else None."""
    ref = (ref or "").strip()
    return ref if _SESSION_ID.match(ref) else None


def unwrap_cron(content: str) -> tuple[Optional[str], str]:
    """(job name, result) of a cron delivery Hermes wrapped; (None, content) otherwise."""
    match = _CRON_WRAPPER.match(content or "")
    if not match:
        return None, content
    return match["name"].strip() or None, match["body"]


def pointer_of(session_id: str, title: Optional[str] = None, at: Optional[int] = None) -> dict:
    """What the relay is told of a delivery: which chat to read and, for an iPhone's alert as in
    T3 Code, its title and the agent's name; never its text."""
    return {
        "kind": "message",
        "agentId": AGENT_ID,
        "sessionKey": session_id,
        **({"title": title} if title else {}),
        "agentName": AGENT_NAME,
        "at": at if at is not None else int(time.time() * 1000),
    }


def redact(text: str, token: str) -> str:
    return text.replace(token, "otter_ch_…") if token else text


async def post_pointer(relay_url: str, token: str, pointer: dict, *, timeout: float = 10.0) -> None:
    url = f"{relay_url.rstrip('/')}/channel/v1/pointers"
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
        async with session.post(url, json=pointer, headers={"Authorization": f"Bearer {token}"}) as response:
            if response.status != 202:
                raise RuntimeError(f"relay answered {response.status}: {(await response.text())[:200]}")
