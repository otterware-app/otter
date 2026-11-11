"""Otter as a delivery channel for Hermes.

A delivery is kept on Hermes, as an assistant message in a session (a new one, source `otter`, or
an Otter chat's), and the relay is told only which session to read. Otter's apps read it through
Hermes's API server, which is also how they talk to Hermes, so nothing here listens.
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from gateway.config import Platform

try:
    from gateway.platforms._shared import (
        env_is_connected,
        extra_or_secret,
        get_scoped_secret,
        seed_extra_from_env,
        send_error,
    )
except ImportError:
    from ._compat import (
        env_is_connected,
        extra_or_secret,
        get_scoped_secret,
        seed_extra_from_env,
        send_error,
    )
from gateway.platforms.base import BasePlatformAdapter, SendResult

from ._compat import register_platform
from .otter_channel import (
    DEFAULT_TITLE,
    NEW_CHAT,
    parse_target,
    pointer_of,
    post_pointer,
    redact,
    unwrap_cron,
)

logger = logging.getLogger(__name__)

RELAY_URL_ENV = "OTTER_RELAY_URL"
TOKEN_ENV = "OTTER_CHANNEL_TOKEN"
HOME_ENV = "OTTER_HOME_CHANNEL"
SOURCE = "otter"


def _relay(extra: Optional[dict]) -> tuple[str, str]:
    return (
        str(extra_or_secret(extra, "relay_url", RELAY_URL_ENV) or "").strip(),
        str(extra_or_secret(extra, "token", TOKEN_ENV) or "").strip(),
    )


def _job_name(job_id: Any) -> Optional[str]:
    if not job_id:
        return None
    try:
        from cron.jobs import get_job

        job = get_job(str(job_id))
    except Exception:
        logger.debug("Otter: no cron job %s", job_id, exc_info=True)
        return None
    return (job or {}).get("name") or None


def _open_db():
    try:
        from hermes_state_ids import new_session_id
        from hermes_state_registry import acquire, release_or_close

        return acquire(), new_session_id, release_or_close
    except ImportError:
        # Released Hermes (0.19) has neither: its own database, ids as its gateway makes them.
        from hermes_constants import get_hermes_home
        from hermes_state import SessionDB

        def new_id() -> str:
            return f"{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}"

        return SessionDB(get_hermes_home() / "state.db"), new_id, lambda db: db.close()


def _keep(chat_id: str, text: str, title: str) -> tuple[str, Optional[str]]:
    """The session `text` is kept in, and the chat's title."""
    db, new_session_id, release_or_close = _open_db()
    try:
        if chat_id == NEW_CHAT:
            session_id = db.create_session(new_session_id(), SOURCE)
            title = db.get_next_title_in_lineage(title)
            db.set_session_title(session_id, title)
        elif db.get_session(chat_id) is None:
            raise LookupError(f"no Hermes session {chat_id}")
        else:
            session_id = db.get_compression_tip(chat_id)
            title = db.get_session_title(chat_id)
        db.append_message(session_id, "assistant", text)
        return session_id, title
    finally:
        release_or_close(db)


async def deliver(extra: Optional[dict], chat_id: str, content: str, job_id: Any = None) -> dict:
    """Keep `content` in the chat `chat_id` names and point Otter at it."""
    target = parse_target(chat_id)
    if target is None:
        return {"error": f"not an Otter chat: {chat_id!r} (use 'new' or a Hermes session id)"}
    name, text = unwrap_cron(content)
    title = name or _job_name(job_id) or DEFAULT_TITLE
    try:
        session_id, title = await asyncio.to_thread(_keep, target, text, title)
    except LookupError as e:
        return {"error": str(e)}
    chat = session_id if target == NEW_CHAT else target
    relay_url, token = _relay(extra)
    try:
        await post_pointer(relay_url, token, pointer_of(chat, title))
    except Exception as e:
        # The message is kept on Hermes; Otter reads it the next time it looks.
        logger.warning("Otter: telling the relay about %s failed: %s", chat, redact(str(e), token))
    return {"success": True, "message_id": chat}


class OtterAdapter(BasePlatformAdapter):
    def __init__(self, config, **kwargs):
        super().__init__(config=config, platform=Platform(SOURCE))
        self._extra = getattr(config, "extra", {}) or {}

    @property
    def name(self) -> str:
        return "Otter"

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        relay_url, token = _relay(self._extra)
        if not (relay_url and token):
            self._set_fatal_error(
                "config_missing", f"{RELAY_URL_ENV} and {TOKEN_ENV} must be set", retryable=False
            )
            return False
        self._mark_connected()
        return True

    async def disconnect(self) -> None:
        self._mark_disconnected()

    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,
                   metadata: Optional[dict[str, Any]] = None) -> SendResult:
        result = await deliver(self._extra, chat_id, content, (metadata or {}).get("job_id"))
        if result.get("error"):
            return SendResult(success=False, error=result["error"])
        return SendResult(success=True, message_id=result["message_id"])

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        return None

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        return {"name": "New Otter chat" if chat_id == NEW_CHAT else chat_id, "type": "dm", "chat_id": chat_id}


async def _standalone_send(pconfig, chat_id: str, message: str, *, thread_id: Optional[str] = None,
                           media_files: Optional[list[str]] = None, force_document: bool = False) -> dict:
    result = await deliver(getattr(pconfig, "extra", {}) or {}, chat_id, message)
    return send_error(result["error"]) if result.get("error") else result


def _parse_target_ref(ref: str) -> Optional[tuple[str, Optional[str]]]:
    target = parse_target(ref)
    return (target, None) if target else None


def _env_enablement() -> Optional[dict]:
    relay_url = str(get_scoped_secret(RELAY_URL_ENV, "") or "").strip()
    token = str(get_scoped_secret(TOKEN_ENV, "") or "").strip()
    if not (relay_url and token):
        return None
    return {"relay_url": relay_url, **seed_extra_from_env((), home_env=HOME_ENV, home_default=NEW_CHAT)}


PLATFORM_HINT = (
    "You can deliver to Otter, the user's app for mail, calendar, files and their agents. "
    "Delivering to `otter:new` (or just `otter`) starts a new chat in Otter for each delivery, titled "
    "with the scheduled job's name: good for scheduled briefs, digests and alerts. `otter:<session id>` "
    "posts into an existing Otter chat (a Hermes session id). Otter renders markdown."
)


def register(ctx):
    register_platform(
        ctx,
        name=SOURCE,
        label="Otter",
        dashboard_description="Deliver scheduled results and messages to Otter, as chats.",
        adapter_factory=OtterAdapter,
        check_fn=lambda: True,
        is_connected=env_is_connected(RELAY_URL_ENV, TOKEN_ENV),
        config_connected_fn=lambda config: all(_relay(config.extra)),
        required_env=[RELAY_URL_ENV, TOKEN_ENV],
        install_hint="No extra packages needed",
        env_enablement_fn=_env_enablement,
        cron_deliver_env_var=HOME_ENV,
        standalone_sender_fn=_standalone_send,
        parse_target_ref_fn=_parse_target_ref,
        emoji="🦦",
        allow_update_command=False,
        platform_hint=PLATFORM_HINT,
    )
