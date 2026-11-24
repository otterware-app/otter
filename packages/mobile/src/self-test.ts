/**
 * The checks behind the apps' development self-test: what core needs of Hermes (the "What Hermes
 * lacks" table in docs/expo-migration.md), of the phone host, and a round trip through core over
 * its fake.
 */
import { agentApi, type ProviderSnapshot } from "@otter/client/agents/api";
import {
  deleteConversation,
  isBlank,
  newChat,
  sendMessage,
  useChats,
} from "@otter/client/agents/chat-store";
import { foldSearchText } from "@otter/shared/chat-search";
import { findVerificationCode } from "@otter/shared/verification-code";

import { openDatabase } from "./database.ts";
import { appFiles } from "./files.ts";
import { longTasks } from "./long-tasks.ts";
import { polyfilled } from "./polyfills.ts";
import { keychainSecrets } from "./secrets.ts";
import { startup } from "./start.ts";

/** `gap`: known missing, and not needed by the apps yet; it shows how it stands without failing the test. */
export type Check = { name: string; gap?: true; run(): Promise<string | void> };

export type CheckResult = { name: string; ok: boolean; gap: boolean; detail: string; ms: number };

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

function until<T>(read: () => T | undefined, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const value = read();
      if (value === undefined) return false;
      off();
      clearTimeout(timer);
      resolve(value);
      return true;
    };
    const off = useChats.subscribe(() => void check());
    const timer = setTimeout(() => {
      off();
      reject(new Error(`No ${what} within ${ms / 1000} s.`));
    }, ms);
    check();
  });
}

export const runtimeChecks: Check[] = [
  {
    name: "Installed here (missing from Hermes)",
    run: async () => polyfilled.join(", ") || "nothing",
  },
  {
    name: "ES2023 built-ins (toSorted, findLast…)",
    async run() {
      // What the shared code's ES2023 library lets it call.
      const needed: Record<string, unknown> = {
        "Array#at": Array.prototype.at,
        "Array#findLast": Array.prototype.findLast,
        "Array#findLastIndex": Array.prototype.findLastIndex,
        "Array#toSorted": Array.prototype.toSorted,
        "Array#toReversed": Array.prototype.toReversed,
        "Array#toSpliced": Array.prototype.toSpliced,
        "Array#with": Array.prototype.with,
        "Object.hasOwn": Object.hasOwn,
        "String#replaceAll": String.prototype.replaceAll,
      };
      const missing = Object.keys(needed).filter((name) => typeof needed[name] !== "function");
      expect(missing.length === 0, `Missing: ${missing.join(", ")}.`);
      return `${Object.keys(needed).length} present`;
    },
  },
  {
    name: "Streaming response.body (Expo's fetch)",
    async run() {
      const sse = "event: delta\ndata: one\n\nevent: delta\ndata: two\n\n";
      const response = await fetch(`data:text/event-stream,${encodeURIComponent(sse)}`);
      expect(response.body, "No body stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      expect(text === sse, `Read ${JSON.stringify(text)}.`);
      return `${response.constructor.name}, ${text.length} bytes`;
    },
  },
  {
    name: "URL, structuredClone",
    async run() {
      const url = new URL("https://relay.otterware.app/v1/agent-sync?since=4#x");
      expect(url.searchParams.get("since") === "4" && url.hash === "#x", "URL parsing is off.");
      const copy = structuredClone({
        at: new Date(0),
        bytes: new Uint8Array([1, 2]),
        m: new Map([[1, 2]]),
      });
      expect(
        copy.at instanceof Date && copy.bytes[1] === 2 && copy.m.get(1) === 2,
        "A clone lost its types.",
      );
    },
  },
  {
    name: "TextDecoder",
    async run() {
      const utf8 = new TextDecoder().decode(new Uint8Array([0xe2, 0x82, 0xac]));
      const utf16 = new TextDecoder("utf-16le").decode(new Uint8Array([0xac, 0x20]));
      const latin = new TextDecoder("windows-1252").decode(new Uint8Array([0x80, 0xe9]));
      expect(utf8 === "€" && utf16 === "€" && latin === "€é", "A charset decoded wrong.");
      const missing = ["shift_jis", "gbk", "euc-kr", "iso-2022-jp"].filter((label) => {
        try {
          return !new TextDecoder(label).encoding;
        } catch {
          return true;
        }
      });
      return `UTF-8, UTF-16, windows-1252${missing.length ? `; not ${missing.join(", ")}` : ""}`;
    },
  },
  {
    name: "atob, btoa, TextEncoder",
    async run() {
      expect(atob(btoa("otter")) === "otter", "base64 doesn't round-trip.");
      expect(new TextEncoder().encode("€").length === 3, "TextEncoder is off.");
    },
  },
  {
    name: "crypto: getRandomValues, randomUUID, SHA-256",
    async run() {
      const random = crypto.getRandomValues(new Uint8Array(32));
      expect(
        random.some((b) => b !== 0),
        "No randomness.",
      );
      expect(/^[0-9a-f-]{36}$/.test(crypto.randomUUID()), "Not a UUID.");
      const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc")));
      expect(
        digest === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        `SHA-256("abc") was ${digest}.`,
      );
    },
  },
  {
    name: "crypto.subtle Ed25519 (OpenClaw's device key)",
    async run() {
      const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
      expect(jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.d && jwk.x, "Not an Ed25519 JWK.");
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
      const signature = await crypto.subtle.sign(
        { name: "Ed25519" },
        key,
        new TextEncoder().encode("v3|device|otter"),
      );
      expect(signature.byteLength === 64, `A ${signature.byteLength}-byte signature.`);
    },
  },
  {
    name: "AbortSignal.timeout, AbortSignal.any, throwIfAborted",
    async run() {
      const timedOut = AbortSignal.timeout(10);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(timedOut.aborted && (timedOut.reason as Error).name === "TimeoutError", "No timeout.");
      const controller = new AbortController();
      const any = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
      controller.abort(new Error("stop"));
      expect(any.aborted, "AbortSignal.any didn't follow.");
      try {
        any.throwIfAborted();
        throw new Error("throwIfAborted didn't throw.");
      } catch (err) {
        expect((err as Error).message === "stop", "throwIfAborted threw something else.");
      }
    },
  },
  {
    name: "EventTarget, Event (the fake relay's socket)",
    async run() {
      class Socket extends EventTarget {}
      const socket = new Socket();
      let heard: unknown;
      socket.addEventListener(
        "message",
        (event) => (heard = (event as Event & { data?: unknown }).data),
      );
      socket.dispatchEvent(Object.assign(new Event("message"), { data: "pong" }));
      expect(heard === "pong", "The event didn't arrive.");
      return typeof MessageEvent === "undefined"
        ? "no MessageEvent (core doesn't need it)"
        : undefined;
    },
  },
  {
    name: "Intl formatToParts with a time zone",
    async run() {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        weekday: "short",
      }).formatToParts(new Date(Date.UTC(2026, 0, 1, 3, 30)));
      const part = (type: string) => parts.find((p) => p.type === type)?.value;
      const got = `${part("weekday")} ${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
      expect(got === "Wed 2025-12-31 22:30", `New York's wall clock was ${got}.`);
    },
  },
  {
    name: "\\p{…} and lookbehind (sign-in codes, chat search)",
    async run() {
      const code = findVerificationCode("Your sign-in code", "Your code is 482913.");
      expect(code === "482913", `Found ${code}.`);
      expect(foldSearchText("Crème Brûlée") === "creme brulee", "Accents weren't folded.");
    },
  },
  {
    name: "Blob from bytes (Otter Mail's postal-mime; varys's uploads, which the phone doesn't offer)",
    gap: true,
    async run() {
      const blob = new Blob([new Uint8Array([1, 2, 3])]);
      expect(blob.size === 3, `A ${blob.size}-byte blob.`);
    },
  },
  {
    name: "SQLite: WAL, FTS5, JSON1",
    async run() {
      const db = openDatabase("self-test.db");
      const mode = db.prepare("PRAGMA journal_mode").get()?.journal_mode;
      expect(mode === "wal", `Journal mode ${String(mode)}.`);
      db.exec(`
        DROP TABLE IF EXISTS notes;
        CREATE VIRTUAL TABLE notes USING fts5(body);
        INSERT INTO notes (body) VALUES ('the otter swims'), ('the heron waits');
      `);
      const found = db.prepare("SELECT body FROM notes WHERE notes MATCH ?").all("otter");
      expect(
        found.length === 1 && found[0]!.body === "the otter swims",
        "FTS5 found the wrong rows.",
      );
      const items = db
        .prepare("SELECT value FROM json_each(?) WHERE json_extract(?, '$.on') = 1")
        .all('["a","b"]', '{"on":1}');
      expect(items.map((r) => r.value).join() === "a,b", "JSON1 is off.");
      const changes = db.prepare("DELETE FROM notes WHERE notes MATCH ?").run("heron").changes;
      expect(changes === 1, `Deleted ${changes} rows.`);
    },
  },
  {
    name: "SQLite: kept statements (again, after a schema change, in transactions)",
    async run() {
      const db = openDatabase("self-test.db");
      const sync = db.prepare("PRAGMA synchronous").get()?.synchronous;
      expect(sync === 1, `synchronous ${String(sync)}, not NORMAL.`);
      db.exec("DROP TABLE IF EXISTS kept; CREATE TABLE kept (id INTEGER PRIMARY KEY, body TEXT);");
      const insert = db.prepare("INSERT INTO kept (body) VALUES (?)");
      const all = db.prepare("SELECT * FROM kept ORDER BY id");
      insert.run("a");
      insert.run("b");
      expect(all.all().length === 2, `${all.all().length} rows after running it twice.`);
      expect(all.get()?.body === "a", "get() read the wrong row.");
      db.exec("ALTER TABLE kept ADD COLUMN extra TEXT;");
      insert.run("c");
      const columns = Object.keys(all.get() ?? {});
      expect(columns.includes("extra"), `Columns after ALTER TABLE: ${columns.join()}.`);
      db.exec("BEGIN");
      insert.run("rolled back");
      db.exec("ROLLBACK");
      db.exec("BEGIN");
      insert.run("d");
      db.exec("COMMIT");
      const bodies = all.all().map((r) => r.body);
      expect(bodies.join() === "a,b,c,d", `Rows after a rollback and a commit: ${bodies.join()}.`);
      const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      expect(checkpoint?.busy === 0, "A kept statement holds a read open.");
    },
  },
  {
    name: "Keychain (names with “:”)",
    async run() {
      const secrets = keychainSecrets("dev.otterware.self-test");
      await secrets.set("agent:self-test:key", "secret");
      expect((await secrets.get("agent:self-test:key")) === "secret", "Not read back.");
      await secrets.delete("agent:self-test:key");
      expect((await secrets.get("agent:self-test:key")) === null, "Not deleted.");
    },
  },
  {
    name: "Files",
    async run() {
      const files = appFiles("self-test");
      await files.write("a/b.json", '{"ok":true}');
      const read = await files.read("a/b.json");
      expect(read && new TextDecoder().decode(read) === '{"ok":true}', "Not read back.");
      expect(
        (await files.list("a")).some((f) => f.name === "b.json"),
        "Not listed.",
      );
      await files.remove("a/b.json");
      expect((await files.read("a/b.json")) === null, "Not removed.");
    },
  },
];

const usable = (p: ProviderSnapshot) => p.enabled && p.status !== "error" && p.installed;

/** Through the bridge and @otter/client, as a screen would: over core's fake. */
export const roundTripChecks: Check[] = [
  {
    name: "Startup",
    async run() {
      // React Native's own mark, on the clock `performance.now()` reads.
      const entry = (
        performance as { rnStartupTiming?: { executeJavaScriptBundleEntryPointStart?: number } }
      ).rnStartupTiming?.executeJavaScriptBundleEntryPointStart;
      const js = entry
        ? Math.round(Date.now() - performance.now() + entry - startup.launchedAt)
        : null;
      const ready = startup.coreReadyAt - startup.launchedAt;
      const list = startup.listShownAt ? startup.listShownAt - startup.launchedAt : null;
      const blocks = longTasks(0, startup.listShownAt || Date.now());
      return `after launch: ${js ? `JavaScript at ${js} ms, ` : ""}core ready at ${ready} ms${list ? `, chats listed at ${list} ms` : ""}; longest JS block ${blocks.longest} ms`;
    },
  },
  {
    name: "The agents (agentApi.providers)",
    async run() {
      const { providers } = await agentApi.providers();
      expect(providers.some(usable), "No agent to chat with.");
      return providers.map((p) => `${p.name} (${p.kind})`).join(", ");
    },
  },
  {
    name: "The chats (the chat store)",
    async run() {
      const chats = await until(
        () => (useChats.getState().ready ? useChats.getState().conversations : undefined),
        10_000,
        "chats",
      );
      const listed = chats.filter((c) => !isBlank(c));
      expect(listed.length > 0, "No chats.");
      return `${listed.length} chats`;
    },
  },
  {
    name: "A message and its reply (sendMessage)",
    async run() {
      const { providers } = await agentApi.providers();
      const agent = providers.find(usable)!;
      const convoId = newChat(agent.id);
      // Nothing the scripted agent stops at (it asks on "plan", wants approval on "send"…).
      const question = "Where do things stand with Q4?";
      const sentAt = Date.now();
      sendMessage(
        {
          id: crypto.randomUUID(),
          convoId,
          provider: agent.id,
          question,
          input: question,
          title: "Self-test",
        },
        "queue",
      );
      await until(() => (useChats.getState().runs[convoId] ? true : undefined), 5_000, "run");
      const reply = await until(
        () => {
          const { runs, conversations } = useChats.getState();
          const turn = conversations.find((c) => c.id === convoId)?.turns.at(-1);
          return !runs[convoId] && turn?.role === "assistant" && turn.finishedAt ? turn : undefined;
        },
        60_000,
        "finished reply",
      );
      const blocks = longTasks(sentAt);
      deleteConversation(convoId, agent.id);
      const items = reply.items ?? [];
      const text = items.map((item) => (item.kind === "text" ? item.text : "")).join("");
      const steps = items.filter((item) => item.kind === "step").length;
      expect(!reply.error && text.length > 100, reply.error ?? `Only ${text.length} characters.`);
      return `${agent.name}: ${text.length} characters and ${steps} steps in ${((Date.now() - sentAt) / 1000).toFixed(1)} s; longest JS block while streaming ${blocks.longest} ms (p95 ${blocks.p95} ms)`;
    },
  },
];

export async function runChecks(
  checks: readonly Check[],
  onResult: (result: CheckResult) => void,
): Promise<void> {
  for (const check of checks) {
    const started = Date.now();
    try {
      const detail = await check.run();
      const ms = Date.now() - started;
      onResult({ name: check.name, ok: true, gap: Boolean(check.gap), detail: detail ?? "", ms });
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const ms = Date.now() - started;
      onResult({ name: check.name, ok: false, gap: Boolean(check.gap), detail, ms });
    }
  }
}
