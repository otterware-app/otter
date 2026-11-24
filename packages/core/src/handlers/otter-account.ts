import { OTTER_ACCOUNT_STATE_CHANNEL, type OtterAccountState } from "@otter/contracts";
import type { MeResponse, PutPushDeviceRequest, RelayEvent } from "@otter/contracts/relay";

import { SignInCancelledError } from "../google.ts";
import { broadcast, handle } from "../ipc.ts";
import { logger } from "../logger.ts";
import { runs } from "../modules.ts";
import { platform } from "../platform.ts";
import { listAccounts } from "../services/account-store.ts";
import { agentDelivered } from "../services/agent/service.ts";
import { getAccount } from "../services/account-store.ts";
import { getImapPassword } from "../services/imap-passwords.ts";
import type { NotificationConnection } from "@otter/contracts/relay";
import { findProvider, isSignedIn } from "../providers/index.ts";
import {
  clearLinkedSnapshot,
  linkedAccountIds,
  reconcileAccounts,
} from "../services/linked-accounts.ts";
import { setPushedAccounts, syncAccount, syncAllAccounts } from "../services/mail-sync.ts";
import { calendarPushed, syncDueCalendars } from "../services/calendar-sync.ts";
import {
  deleteOtterAccount,
  getOtterUser,
  listDevices,
  onOtterAccountChange,
  relayRequest,
  signIn,
  signInRedirect,
  signOut,
  signOutDevice,
} from "../services/otter-account.ts";
import { forgetSyncedPreferences, pullPreferences } from "../services/preferences.ts";
import { forgetAgentData, syncAgentData } from "../services/agent-sync.ts";
import { getRealtimeState, startRealtime, stopRealtime } from "../services/realtime.ts";
import { removeLocalAccount } from "./mail.ts";

const REFRESH_EVERY_MS = 60 * 60_000;
/** Where the relay sends the browser after background-notification consent: "native" opens the phone app. */
const RETURN_TO = { desktop: "desktop", web: "web", mobile: "native" } as const;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function otterState(): OtterAccountState {
  const user = getOtterUser();
  return {
    user: user && { id: user.id, email: user.email, name: user.name, picture: user.picture },
    realtime: getRealtimeState(),
  };
}

const publishState = () => broadcast(OTTER_ACCOUNT_STATE_CHANNEL, otterState());

let refreshing: Promise<void> | null = null;
let refreshAgain = false;

/**
 * Reconciles the linked accounts, then makes sure Gmail pushes every linked,
 * signed-in account's changes; accounts it can't watch keep polling. Calls
 * made while one runs coalesce into a single rerun.
 */
function refresh(): Promise<void> {
  if (!runs("mail")) return Promise.resolve();
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      refreshAgain = false;
      await refreshOnce();
    } while (refreshAgain);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshOnce(): Promise<void> {
  try {
    const { pushTopic } = await relayRequest<MeResponse>("GET", "/v1/me");
    await reconcileAccounts(removeLocalAccount);
    const linked = linkedAccountIds();
    const pushed: string[] = [];
    for (const account of await listAccounts()) {
      const watch = findProvider(account)?.watchViaRelay;
      if (!watch || !linked.has(account.email.toLowerCase()) || !isSignedIn(account)) continue;
      try {
        if (await watch(account.id, pushTopic)) pushed.push(account.id);
      } catch (err) {
        logger.failure("otter-account", `Couldn't watch ${account.id}`, err);
      }
    }
    setPushedAccounts(pushed);
  } catch (err) {
    logger.failure("otter-account", "Refresh failed", err);
  }
}

async function syncPreferences(): Promise<void> {
  await pullPreferences().catch((err: unknown) =>
    logger.failure("otter-account", "Preferences sync failed", err),
  );
}

async function onEvent(event: RelayEvent): Promise<void> {
  if (event.type === "agent-sync") {
    await syncAgentData();
    return;
  }
  if (event.type === "accounts") {
    await refresh();
    return;
  }
  if (event.type === "preferences") {
    await syncPreferences();
    return;
  }
  if (event.type === "agent") {
    // A message's session may have no chat yet; an approval's or a question's is the one that asked.
    await agentDelivered(
      event.pointer.kind === "message" ? (event.pointer.sessionKey ?? undefined) : undefined,
    );
    return;
  }
  if (event.type === "calendar") {
    if (runs("calendar")) await calendarPushed(event.email);
    return;
  }
  if (event.type !== "mail" || !runs("mail")) return;
  const account = (await listAccounts()).find(
    (a) => a.email.toLowerCase() === event.email.toLowerCase(),
  );
  if (!account) return;
  logger.info("otter-account", "Gmail pushed a change", { accountId: account.id });
  syncAccount(account.id, { force: true, trigger: "push" });
}

function start(): void {
  // The phone can pull its agents over HTTP before the realtime socket connects.
  if (platform().kind === "mobile") void syncAgentData();
  startRealtime({
    onConnected: () => {
      void refresh();
      void syncPreferences();
      void syncAgentData();
      if (runs("mail")) void syncAllAccounts({ force: true, trigger: "push" });
      if (runs("calendar")) void syncDueCalendars("push");
    },
    onEvent: (event) => void onEvent(event),
    onStateChange: (state) => {
      if (state !== "live") setPushedAccounts([]);
      publishState();
    },
    onRefused: () => void relayRequest("GET", "/v1/me").catch(() => {}),
  });
  refreshTimer ??= setInterval(() => {
    if (getRealtimeState() === "live") void refresh();
  }, REFRESH_EVERY_MS);
}

function stop(): void {
  stopRealtime();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  setPushedAccounts([]);
  clearLinkedSnapshot();
  forgetSyncedPreferences();
}

export function registerOtterAccountHandlers(): void {
  onOtterAccountChange(() => {
    if (getOtterUser()) start();
    else stop();
    publishState();
  });

  handle("otter:getState", async () => otterState());

  if (platform().kind === "mobile") {
    handle("otter:setAgentPushDevice", async (params: unknown) => {
      const p = params as
        | { userId?: unknown; device?: Partial<PutPushDeviceRequest> | null }
        | undefined;
      const user = getOtterUser();
      if (!user || p?.userId !== user.id) throw new Error("The Otter account changed.");
      const device = p.device;
      if (device === null) return relayRequest("DELETE", "/v1/push/device");
      const { token, topic, environment } = device ?? {};
      if (
        typeof token !== "string" ||
        !/^(?:[a-f\d]{2}){1,256}$/i.test(token) ||
        typeof topic !== "string" ||
        !topic ||
        (environment !== "sandbox" && environment !== "production")
      )
        throw new Error("Invalid APNs device.");
      return relayRequest("PUT", "/v1/push/device", {
        token,
        topic,
        environment,
        mode: "all",
        mailboxes: [],
      } satisfies PutPushDeviceRequest);
    });
  }

  handle("otter:notificationConnections", async () => {
    if (!getOtterUser())
      return { connections: [], providers: { gmail: false, outlook: false, imap: false } };
    return relayRequest<{
      connections: NotificationConnection[];
      providers: Record<string, boolean>;
    }>("GET", "/v1/notification-connections");
  });
  handle("otter:connectNotifications", async (params: unknown) => {
    const { accountId } = params as { accountId: string };
    const account = await getAccount(accountId);
    if (!account || !getOtterUser()) throw new Error("Sign in to your Otter account first.");
    if (!isSignedIn(account)) throw new Error("Sign in to this mailbox first.");
    if (account.provider === "imap") {
      const password = getImapPassword(accountId);
      if (!password || !account.imap) throw new Error("Reconnect this IMAP mailbox first.");
      await relayRequest("PUT", "/v1/notification-connections/imap", {
        email: account.email,
        password,
        settings: account.imap,
      });
      return { connected: true };
    }
    return relayRequest<{ url: string }>("POST", "/v1/notification-connections/authorize", {
      email: account.email,
      returnTo: RETURN_TO[platform().kind],
    });
  });
  handle("otter:disconnectNotifications", async (params: unknown) => {
    const { accountId } = params as { accountId: string };
    const account = await getAccount(accountId);
    if (!account) return;
    await relayRequest(
      "DELETE",
      "/v1/notification-connections/" + encodeURIComponent(account.email),
    );
  });

  // otter:signIn — "Sign in with Google", for the Otter account only (never
  // a mailbox). The desktop opens Google in the browser; the web app answers
  // `{ redirectTo }` for the page to go sign in (back to `callbackURL`). The
  // renderer gets null when the user cancels.
  handle("otter:signIn", async (params: unknown) => {
    const p = params as { callbackURL?: unknown } | undefined;
    const google = platform().google;
    try {
      if (google.signInForIdToken) {
        await signIn(await google.signInForIdToken());
      } else {
        const callbackURL = typeof p?.callbackURL === "string" ? p.callbackURL : "";
        return { redirectTo: await signInRedirect(callbackURL) };
      }
      return otterState();
    } catch (err) {
      if (err instanceof SignInCancelledError) return null;
      throw err;
    }
  });

  handle("otter:cancelSignIn", async () => {
    platform().google.cancelSignIn();
  });

  handle("otter:signOut", async () => {
    await signOut();
    await forgetAgentData();
    return otterState();
  });

  handle("otter:listDevices", async () => listDevices());

  handle("otter:signOutDevice", async (params: unknown) => {
    const token = (params as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string") throw new Error('Invalid parameter: "token".');
    await signOutDevice(token);
  });

  handle("otter:deleteAccount", async () => {
    await deleteOtterAccount();
    return otterState();
  });

  if (getOtterUser()) start();
}
