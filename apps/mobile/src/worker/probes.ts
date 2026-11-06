import { sha256 } from "@noble/hashes/sha2";
import { createAuthClient } from "better-auth/client";
import PostalMime from "postal-mime";

import {
  handle,
  mailStore,
  signInWithSession,
  type MailAccount,
  type MessageDetail,
  type MessageSummary,
} from "@otter-mail/core";
import { platform } from "@otter-mail/core/extension-kit";
import { connectImap } from "@otter-mail/core/imap";
import { createCredentials } from "@otter-mail/mobile-credentials";
import { openSqlite } from "@otter-mail/mobile-sqlite";
import { createWorkerHost } from "@otter-mail/mobile-worker";

import { connectMailServer } from "../persistence/platform";
import { call } from "./call";

/**
 * Phase 0's gate, measured where core runs: each probe returns plain numbers
 * the UI shows and logs (`[gate] …` in the device log).
 */

const host = createWorkerHost();
const now = () => host.now();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** `gate:probe`: run one of the phase 0 gate's probes where core runs. */
export function registerProbes(): void {
  handle("gate:probe", (params) => {
    const { name, args } = params as { name: string; args?: unknown };
    return runProbe(name, args);
  });
}

async function runProbe(name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case "boot":
      return boot();
    case "nitro":
      return nitro((args as { count?: number } | undefined)?.count ?? 1000);
    case "sqlite":
      return sqlite();
    case "charsets":
      return charsets();
    case "imap":
      return imap();
    case "net:start":
      return netStart(args as { base: string });
    case "net:status":
      return { ...net, socketState: socket?.readyState ?? -1 };
    case "bench:list":
      return benchList();
    case "bench:churn":
      return benchChurn((args as { seconds?: number } | undefined)?.seconds ?? 10);
    case "bench:churnStatus":
      return churn;
    case "memory":
      return { residentMB: Math.round(host.residentMemory() / 1048576) };
    case "translate":
      return translateNewest((args as { target?: string } | undefined)?.target ?? "en");
    case "notify":
      return notifyNewest();
    case "background":
      return call("background:refresh", { budgetMs: 20_000 });
    case "recovered-drafts":
      return call("drafts:importRecovered");
    case "dev-session":
      return devSession();
    default:
      throw new Error(`No probe ${name}.`);
  }
}

async function boot() {
  const g = globalThis as Record<string, unknown>;
  const parsed = await PostalMime.parse(
    "From: Ada <ada@example.com>\r\nSubject: =?koi8-r?B?8NLJ18XU?=\r\nContent-Type: text/plain; charset=iso-8859-2\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=A3=F3d=BC\r\n",
  );
  const auth = createAuthClient({ baseURL: "https://relay.demo.invalid" });
  return {
    runtimeKind: g.__RUNTIME_KIND,
    bundleMode: g._WORKLETS_BUNDLE_MODE_ENABLED === true,
    turboModuleProxy: typeof g.__turboModuleProxy,
    nativeModuleProxy: typeof g.nativeModuleProxy,
    batchedBridge: typeof g.__fbBatchedBridge,
    hermes: typeof g.HermesInternal === "object",
    postalMime: { subject: parsed.subject, text: parsed.text?.trim() },
    betterAuth: typeof auth.getSession === "function",
    noble: hex(sha256(new TextEncoder().encode("abc"))).slice(0, 16),
    subtle: hex(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc"))),
    ).slice(0, 16),
    uuid: crypto.randomUUID(),
    url: new URL("https://a.example/x?y=1#z").searchParams.get("y"),
    stream: typeof ReadableStream,
  };
}

async function nitro(count: number) {
  const started = now();
  const values = await Promise.all(
    Array.from({ length: count }, (_, i) => host.echo(i, (i % 7) * 0.2)),
  );
  const echoMs = now() - started;
  const echoOk = values.every((value, i) => value === i);

  const credentials = createCredentials();
  const swiftStarted = now();
  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, i) =>
      credentials.googleAccessToken(`nobody${i}@gate.test`, false),
    ),
  );
  return {
    count,
    echo: { resolved: values.length, inOrder: echoOk, ms: Math.round(echoMs) },
    swift: {
      settled: settled.length,
      rejectedSignedOut: settled.filter(
        (r) => r.status === "rejected" && String(r.reason).includes("signed-out"),
      ).length,
      ms: Math.round(now() - swiftStarted),
    },
  };
}

const GATE_ACCOUNT = "gate@bench.test";
const WORDS = [
  "invoice",
  "lunch",
  "meeting",
  "otter",
  "quarterly",
  "receipt",
  "travel",
  "launch",
  "review",
  "draft",
];

function summaries(start: number, count: number): MessageSummary[] {
  return Array.from({ length: count }, (_, k) => {
    const i = start + k;
    const word = WORDS[i % WORDS.length]!;
    return {
      id: `m${i}`,
      threadId: `t${Math.floor(i / 3)}`,
      fromName: `Sender ${i % 500}`,
      fromEmail: `sender${i % 500}@example.com`,
      to: "me@bench.test",
      subject: `${word} update ${i}`,
      snippet: `About the ${word}: message ${i} with a few words of preview text for the list.`,
      date: 1_700_000_000_000 + i * 60_000,
      unread: i % 4 === 0,
      starred: i % 50 === 0,
      labelIds: i % 10 === 0 ? ["SENT"] : ["INBOX", "UNREAD"].slice(0, i % 4 === 0 ? 2 : 1),
      hasAttachments: false,
    };
  });
}

function timed<T>(fn: () => T, runs = 5): { ms: number; result: T } {
  const times: number[] = [];
  let result!: T;
  for (let i = 0; i < runs; i++) {
    const t = now();
    result = fn();
    times.push(now() - t);
  }
  times.sort((a, b) => a - b);
  return { ms: Math.round(times[Math.floor(runs / 2)]! * 100) / 100, result };
}

function sqlite() {
  const probe = openSqlite(`${host.dataDirectory}/gate-probe.db`);
  const options = probe.compileOptions();
  const version = probe.version;
  probe.exec("CREATE VIRTUAL TABLE IF NOT EXISTS t USING fts5(x)");
  const journal = probe.get("PRAGMA journal_mode", []);
  probe.close();

  mailStore.removeAccountData(GATE_ACCOUNT);
  let t = now();
  mailStore.upsertMessages(GATE_ACCOUNT, summaries(0, 10_000));
  const batch10kMs = Math.round(now() - t);

  t = now();
  for (let start = 10_000; start < 100_000; start += 10_000) {
    mailStore.upsertMessages(GATE_ACCOUNT, summaries(start, 10_000));
  }
  const seed90kMs = Math.round(now() - t);
  const total = mailStore.countAllMessages(GATE_ACCOUNT);

  const page = timed(() => mailStore.getThreadsPage(GATE_ACCOUNT, "INBOX", 0, 50));
  const deepPage = timed(() => mailStore.getThreadsPage(GATE_ACCOUNT, "INBOX", 20_000, 50));
  const search = timed(() => mailStore.searchMessages("quarterly", GATE_ACCOUNT, 0, 50));
  const searchPrefix = timed(() => mailStore.searchMessages("lau", GATE_ACCOUNT, 0, 50));
  const unread = timed(() => mailStore.countUnreadForLabel(GATE_ACCOUNT, "INBOX"));
  const thread = timed(() => mailStore.getThreadMessages(GATE_ACCOUNT, "t12345"));

  t = now();
  mailStore.removeAccountData(GATE_ACCOUNT);
  const removeMs = Math.round(now() - t);

  return {
    version,
    fts5: options.includes("ENABLE_FTS5"),
    journal: journal?.journal_mode,
    batch10kMs,
    seed90kMs,
    total,
    queries: {
      inboxPage50: { ms: page.ms, rows: page.result.messages.length },
      inboxPage50AtOffset20k: { ms: deepPage.ms, rows: deepPage.result.messages.length },
      ftsSearch: { ms: search.ms, rows: search.result.messages.length },
      ftsPrefixSearch: { ms: searchPrefix.ms, rows: searchPrefix.result.messages.length },
      unreadCount: { ms: unread.ms, value: unread.result },
      thread: { ms: thread.ms, rows: thread.result.length },
    },
    removeAccountMs: removeMs,
  };
}

const CORPUS: [label: string, bytes: number[], expected: string][] = [
  ["iso-8859-1", [0x63, 0x61, 0x66, 0xe9], "café"],
  ["windows-1252", [0x80, 0x20, 0x93, 0x68, 0x69, 0x94], "€ “hi”"],
  ["us-ascii", [0x61, 0x62, 0x63], "abc"],
  ["iso-8859-2", [0xa3, 0xf3, 0x64, 0xbc], "Łódź"],
  ["windows-1250", [0xa3, 0xf3, 0x64, 0x9f], "Łódź"],
  ["iso-8859-5", [0xbf, 0xe0, 0xd8, 0xd2, 0xd5, 0xe2], "Привет"],
  ["koi8-r", [0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4], "Привет"],
  ["windows-1251", [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2], "Привет"],
  ["iso-8859-7", [0xc5, 0xeb, 0xeb, 0xdc, 0xe4, 0xe1], "Ελλάδα"],
  ["iso-8859-9", [0xdd, 0x73, 0x74, 0x61, 0x6e, 0x62, 0x75, 0x6c], "İstanbul"],
  ["iso-8859-15", [0xa4], "€"],
  ["shift_jis", [0x93, 0xfa, 0x96, 0x7b], "日本"],
  ["iso-2022-jp", [0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x1b, 0x28, 0x42], "日本"],
  ["euc-jp", [0xc6, 0xfc, 0xcb, 0xdc], "日本"],
  ["gb2312", [0xd6, 0xd0, 0xce, 0xc4], "中文"],
  ["gbk", [0xd6, 0xd0, 0xce, 0xc4], "中文"],
  ["big5", [0xa4, 0xa4, 0xa4, 0xe5], "中文"],
  ["euc-kr", [0xc7, 0xd1, 0xb1, 0xb9], "한국"],
  ["windows-874", [0xca, 0xc7, 0xd1, 0xca, 0xb4, 0xd5], "สวัสดี"],
  ["utf-16le", [0x68, 0x00, 0x69, 0x00], "hi"],
  ["utf-8", [0xf0, 0x9f, 0x98, 0x80, 0x21], "😀!"],
];

async function charsets() {
  const results = CORPUS.map(([label, bytes, expected]) => {
    try {
      const text = new TextDecoder(label).decode(new Uint8Array(bytes));
      return { label, ok: text === expected, text };
    } catch (error) {
      return { label, ok: false, text: String(error) };
    }
  });
  const mime = await PostalMime.parse(
    "Subject: =?iso-8859-7?Q?=C5=EB=EB=DC=E4=E1?=\r\nContent-Type: text/plain; charset=windows-1251\r\nContent-Transfer-Encoding: base64\r\n\r\nz/Do4uXy\r\n",
  );
  const mimeOk = mime.subject === "Ελλάδα" && mime.text?.trim() === "Привет";
  return {
    passed: results.filter((r) => r.ok).length + (mimeOk ? 1 : 0),
    total: results.length + 1,
    failures: results.filter((r) => !r.ok),
    postalMime: { ok: mimeOk, subject: mime.subject, text: mime.text?.trim() },
  };
}

async function imap() {
  const out: Record<string, unknown> = {};
  for (const [security, port] of [
    ["tls", 31993],
    ["starttls", 31143],
  ] as const) {
    const started = now();
    try {
      const client = await connectImap({
        host: "localhost",
        port,
        security,
        auth: { user: "me@otter.test", pass: "pass" },
        connect: connectMailServer,
      });
      const folders = await client.list();
      const inbox = await client.select("INBOX", { readOnly: true });
      const fetched =
        inbox.exists > 0 ? await client.fetch("1:*", { envelope: true, flags: true }) : [];
      await client.logout();
      out[security] = {
        ok: true,
        ms: Math.round(now() - started),
        folders: folders.length,
        inbox: inbox.exists,
        subjects: fetched.slice(0, 3).map((m) => m.envelope?.subject),
      };
    } catch (error) {
      out[security] = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return out;
}

const net = {
  socketOpened: 0,
  socketMessages: 0,
  socketCloses: [] as string[],
  socketErrors: [] as string[],
  sseChunks: 0,
  sseEvents: 0,
  sseLastId: -1,
  sseEnded: "",
  startedAt: 0,
  lastEventAt: 0,
};
let socket: WebSocket | null = null;

async function netStart({ base }: { base: string }) {
  net.startedAt = Date.now();
  socket = new WebSocket(`${base.replace(/^http/, "ws")}/ws`, {
    headers: { Authorization: "Bearer gate-token" },
  } as unknown as string[]);
  socket.addEventListener("open", () => {
    net.socketOpened += 1;
  });
  socket.addEventListener("message", () => {
    net.socketMessages += 1;
    net.lastEventAt = Date.now();
  });
  socket.addEventListener("close", (event) =>
    net.socketCloses.push(`${(event as CloseEvent).code}`),
  );
  socket.addEventListener("error", (event) =>
    net.socketErrors.push(String((event as unknown as { message?: string }).message)),
  );

  void (async () => {
    try {
      const response = await fetch(`${base}/sse`, { headers: { Accept: "text/event-stream" } });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          net.sseEnded = "done";
          return;
        }
        net.sseChunks += 1;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const id = /^id: (\d+)/m.exec(event)?.[1];
          if (id) net.sseLastId = Number(id);
          net.sseEvents += 1;
          net.lastEventAt = Date.now();
        }
      }
    } catch (error) {
      net.sseEnded = error instanceof Error ? error.message : String(error);
    }
  })();
  return { started: true };
}

const BENCH_ACCOUNT = "bench@bench.test";

/** 5,000 single-message threads, read back through mail-store as the list would. */
function benchList() {
  if (mailStore.countAllMessages(BENCH_ACCOUNT) < 5000) {
    mailStore.removeAccountData(BENCH_ACCOUNT);
    mailStore.upsertMessages(
      BENCH_ACCOUNT,
      summaries(0, 5000).map((m) => ({ ...m, threadId: m.id, labelIds: ["INBOX"] })),
    );
  }
  const t = now();
  const page = mailStore.getThreadsPage(BENCH_ACCOUNT, "INBOX", 0, 5000);
  return { ms: Math.round(now() - t), rows: page.messages };
}

const churn = { running: false, batches: 0, rows: 0, maxBatchMs: 0, syncs: 0 };

/** A sync's worth of writes on the worker while the list scrolls: a batch of 500 every 50 ms, and real syncs. */
async function benchChurn(seconds: number) {
  const { syncAllAccounts } = require("@otter-mail/core") as typeof import("@otter-mail/core");
  Object.assign(churn, { running: true, batches: 0, rows: 0, maxBatchMs: 0, syncs: 0 });
  const until = Date.now() + seconds * 1000;
  let start = 200_000;
  const timer = setInterval(() => {
    if (Date.now() > until) {
      clearInterval(timer);
      churn.running = false;
      mailStore.removeAccountData(GATE_ACCOUNT);
      return;
    }
    const t = now();
    mailStore.upsertMessages(GATE_ACCOUNT, summaries(start, 500));
    churn.maxBatchMs = Math.max(churn.maxBatchMs, Math.round(now() - t));
    start += 500;
    churn.batches += 1;
    churn.rows += 500;
    if (churn.batches % 20 === 1) {
      churn.syncs += 1;
      void syncAllAccounts({ force: true });
    }
  }, 50);
  return { started: true };
}

async function newestInbox(): Promise<{ accountId: string; message: MessageDetail }> {
  const [account] = await call<MailAccount[]>("gmail:listAccounts");
  if (!account) throw new Error("No mailbox.");
  const [summary] = mailStore.getThreadsPage(account.id, "INBOX", 0, 1).messages;
  if (!summary) throw new Error("The inbox is empty.");
  const message = await call<MessageDetail>("gmail:getMessage", {
    accountId: account.id,
    messageId: summary.id,
  });
  return { accountId: account.id, message };
}

/** The newest inbox message in another language, through the Translation extension (Apple's Translation). */
async function translateNewest(target: string) {
  const [account] = await call<MailAccount[]>("gmail:listAccounts");
  if (!account) throw new Error("No mailbox.");
  for (const summary of mailStore.getThreadsPage(account.id, "INBOX", 0, 20).messages) {
    const message = await call<MessageDetail>("gmail:getMessage", {
      accountId: account.id,
      messageId: summary.id,
    });
    const text = (message.bodyText ?? message.snippet).trim().slice(0, 400);
    const detected = await call<{ language: string | null; confidence: number }>(
      "translation:detect",
      { text },
    );
    if (!detected.language || detected.language.split("-")[0] === target) continue;
    const segments = [message.subject, ...text.split(/\n+/).filter(Boolean).slice(0, 3)];
    const started = now();
    const result = await call<{ status: string; texts: string[] }>("translation:translate", {
      segments,
      source: detected.language,
      target,
    });
    return { segments, detected, target, ms: Math.round(now() - started), ...result };
  }
  throw new Error(`Nothing in the inbox to translate to ${target}.`);
}

/** Core's notify (HostEffect), as a new message in the inbox would raise it. */
async function notifyNewest() {
  const { accountId, message } = await newestInbox();
  platform().notify({
    title: message.fromName || message.fromEmail,
    subtitle: accountId,
    body: message.subject || message.snippet,
    open: { accountId, messageId: message.id },
  });
  return { accountId, messageId: message.id, threadId: message.threadId, subject: message.subject };
}

/** An Otter account from a `DEV_DEMO` relay's `/v1/dev/session` (`pnpm dev:demo`'s), no Google. */
async function devSession() {
  const response = await fetch(`${platform().relayUrl}/v1/dev/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "push-check@example.com" }),
  });
  const token = /session_token=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (!response.ok || !token) throw new Error(`No dev session (${response.status}).`);
  const user = await signInWithSession(decodeURIComponent(token));
  return { userId: user.id, email: user.email };
}
