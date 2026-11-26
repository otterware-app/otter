/**
 * Measures the built desktop app (`pnpm build` first) on the made-up mailboxes, grown to a few
 * thousand messages: launch to mail on screen, the first sync, opening a message, switching
 * folders, searching, scrolling the list, and memory.
 *
 *   node scripts/bench-desktop.ts [--runs 5] [--messages 5000] [--json out.json] [--loaded]
 *
 * --loaded measures it with everything open, as a day's use leaves it: the browser panel with
 * three tabs (real sites: it needs the network), the calendar panel and the chat window.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";

// @ts-expect-error: a .mjs helper without types
import {
  desktopDir,
  electronChildEnv,
  resolveElectronPath,
} from "../apps/desktop/scripts/electron-launcher.mjs";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    messages: { type: "string", default: "5000" },
    json: { type: "string" },
    loaded: { type: "boolean", default: false },
  },
});
const runs = Number(values.runs);
const messageCount = Number(values.messages);
const MAILBOX = "demo@otter.example";

type Sample = Record<string, number>;

const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

async function launch(home: string): Promise<{ app: ElectronApplication; page: Page; t0: number }> {
  const env = electronChildEnv() as Record<string, string>;
  delete env.VITE_DEV_SERVER_URL;
  const t0 = Date.now();
  const app = await electron.launch({
    executablePath: resolveElectronPath() as string,
    args: [desktopDir as string],
    cwd: desktopDir as string,
    env: { ...env, OTTER_HOME: home, OTTER_DEV_DATA: "fake" },
  });
  const page = await app.firstWindow();
  return { app, page, t0 };
}

/**
 * Caches `count` messages for the made-up Gmail mailbox, spread over the past two years, as a
 * finished sync would have (core's own mail store writes them). Only the cache: the made-up
 * server keeps its few, as its state file grown to thousands would have the backend parse and
 * rewrite it, measuring the fake server instead of the app; and a first sync through the API
 * runs at the Gmail quota's pace (about a message a second).
 */
async function growMailbox(userData: string, count: number): Promise<void> {
  const file = NodePath.join(userData, "demo-gmail.json");
  const state = JSON.parse(NodeFS.readFileSync(file, "utf8"));
  const box = state.mailboxes[MAILBOX];
  const originals = (Object.values(box.messages) as Array<Record<string, any>>).filter(
    (m) => !(m.labelIds as string[]).includes("DRAFT"),
  );
  const now = Date.now();
  const added: Array<Record<string, any>> = [];
  for (let n = Object.keys(box.messages).length; n < count; n++) {
    const source = originals[n % originals.length]!;
    const id = `${box.idPrefix}b${n.toString(16).padStart(11, "0")}`;
    const date = now - Math.round((n / count) * 730 * 86_400_000) - 3_600_000;
    let labels = (source.labelIds as string[]).filter((l) => l !== "UNREAD");
    if (n % 3 === 0 && !labels.includes("INBOX")) labels = [...labels, "INBOX"];
    if (n % 7 === 0) labels = [...labels, "UNREAD"];
    const message = {
      ...source,
      id,
      threadId: id,
      labelIds: labels,
      internalDate: date,
      headers: (source.headers as Array<{ name: string; value: string }>)
        .filter((h) => !/^(In-Reply-To|References)$/i.test(h.name))
        .map((h) =>
          /^subject$/i.test(h.name)
            ? { ...h, value: `${h.value} #${n}` }
            : /^date$/i.test(h.name)
              ? { ...h, value: new Date(date).toUTCString().replace("GMT", "+0000") }
              : /^message-id$/i.test(h.name)
                ? { ...h, value: `<${id}@otter.example>` }
                : h,
        ),
    };
    box.messages[id] = message;
    added.push(message);
  }

  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(NodePath.join(userData, "mail-cache.db"));
  const { setPlatform } = await import("../packages/core/src/platform.ts");
  setPlatform({ database: () => database, broadcast: () => {}, log: () => {} } as never);
  const store = await import("../packages/core/src/services/mail-store.ts");
  const header = (m: Record<string, any>, name: string) =>
    (m.headers as Array<{ name: string; value: string }>).find((h) => h.name.toLowerCase() === name)
      ?.value ?? "";
  const person = (value: string) => {
    const match = /^"?([^"<]*)"?\s*<([^>]+)>$/.exec(value);
    return match ? { name: match[1]!.trim(), email: match[2]! } : { name: "", email: value };
  };
  store.upsertMessageDetails(
    MAILBOX,
    added.map((m) => {
      const from = person(header(m, "from"));
      return {
        id: m.id,
        threadId: m.threadId,
        fromName: from.name,
        fromEmail: from.email,
        to: header(m, "to"),
        subject: header(m, "subject"),
        snippet: String(m.text ?? "").slice(0, 120),
        date: m.internalDate,
        unread: m.labelIds.includes("UNREAD"),
        starred: m.labelIds.includes("STARRED"),
        labelIds: m.labelIds,
        hasAttachments: false,
        bodyHtml: m.html,
        bodyText: m.text,
        attachments: [],
      };
    }),
  );
  database.close();
}

/** Closes the app and waits for every process of it: the backend outlives the window briefly, and writes. */
async function quit(app: ElectronApplication): Promise<void> {
  const pids = await app
    .evaluate(({ app }) => app.getAppMetrics().map((m) => m.pid))
    .catch(() => [] as number[]);
  await app.close().catch(() => undefined);
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + 15_000;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
}

async function windowShown(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ BrowserWindow }) =>
      new Promise<number>((resolve) => {
        const check = () => {
          const win = BrowserWindow.getAllWindows().find((w) => w.isVisible());
          if (win) resolve(Date.now());
          else setTimeout(check, 2);
        };
        check();
      }),
  );
}

/** Runs `act`, then waits in the page until `ready` holds, and returns the time between. */
async function timed<A>(
  page: Page,
  act: () => Promise<unknown>,
  ready: (arg: A) => unknown,
  arg?: A,
) {
  const start = Date.now();
  await act();
  await page.waitForFunction(ready, arg as A, { timeout: 20_000, polling: "raf" });
  return Date.now() - start;
}

async function measure(home: string, interact: boolean): Promise<Sample> {
  const { app, page, t0 } = await launch(home);
  const sample: Sample = {};
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setSize(1600, 1000);
    });
    sample.windowShown = (await windowShown(app)) - t0;
    await page.locator("[data-message-row]").first().waitFor({ timeout: 120_000 });
    sample.firstMail = Date.now() - t0;
    const nav = await page.evaluate(() => {
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return {
        origin: performance.timeOrigin,
        fcp: fcp?.startTime ?? NaN,
        dcl: entry.domContentLoadedEventEnd,
      };
    });
    sample.pageStart = Math.round(nav.origin - t0);
    sample.domReady = Math.round(nav.dcl);
    sample.firstPaint = Math.round(nav.fcp);
    if (!interact) return sample;

    // Straight after mail shows, as someone who launched it to read something would.
    const first = page.locator("[data-message-row]").first();
    const firstId = await first.getAttribute("data-message-id");
    sample.openRightAway = await timed(
      page,
      () => first.click(),
      (id) => {
        const reader = document.querySelector("[data-tour=reader]");
        return location.hash.endsWith(id) && reader?.querySelector("h1") != null;
      },
      firstId!,
    );
    await page.keyboard.press("Escape");

    // Everything the window reopened with: the calendar panel's days, the browser's page.
    const panels = await page.evaluate(() => ({
      upcoming: [...document.querySelectorAll("span")].some((s) => s.textContent === "Upcoming"),
      browser: localStorage.getItem("gmail:browser-open") === "1",
      chat: localStorage.getItem("gmail:chat-window-open") === "1",
    }));
    sample.chatWindowOpen = panels.chat ? 1 : 0;
    if (panels.chat) {
      await page.locator("[data-message-id]:not([data-message-row])").first().waitFor();
    }
    if (panels.upcoming) {
      await page.waitForFunction(() => {
        const title = [...document.querySelectorAll("span")].find(
          (s) => s.textContent === "Upcoming",
        );
        return (title?.closest(".h-full")?.textContent?.length ?? 0) > 120;
      });
    }
    if (panels.browser) {
      await app.evaluate(
        ({ webContents }) =>
          new Promise<void>((resolve) => {
            const check = () => {
              const pages = webContents
                .getAllWebContents()
                .filter((w) => w.getType() === "webview");
              if (pages.length > 0 && pages.every((w) => !w.isLoading())) resolve();
              else setTimeout(check, 10);
            };
            check();
          }),
      );
    }
    sample.everythingReady = Date.now() - t0;
    sample.startupBlockedMs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let blocked = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) blocked += e.duration;
          }).observe({ type: "longtask", buffered: true });
          setTimeout(() => resolve(Math.round(blocked)), 50);
        }),
    );

    await page.waitForTimeout(2000);

    // Open a message, then go back to the list.
    const opens: number[] = [];
    const backs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const row = page.locator("[data-message-row]").nth(i * 3);
      const id = await row.getAttribute("data-message-id");
      opens.push(
        await timed(
          page,
          () => row.click(),
          (id) => {
            const reader = document.querySelector("[data-tour=reader]");
            return (
              location.hash.endsWith(id) &&
              reader?.querySelector("h1") &&
              !reader.querySelector(".animate-pulse") &&
              (reader.textContent ?? "").length > 60
            );
          },
          id!,
        ),
      );
      backs.push(
        await timed(
          page,
          () => page.keyboard.press("Escape"),
          () =>
            !/\/\d+$/.test(location.hash) &&
            (document.querySelector("[data-message-row]") as HTMLElement | null)?.offsetParent !=
              null,
        ),
      );
    }
    sample.openMessage = median(opens);
    sample.backToList = median(backs);

    // Folder switches: Sent, All Mail, back to Inbox.
    const switches: number[] = [];
    for (const [name, label] of [
      ["Sent", "SENT"],
      ["All Mail", "ALL"],
      ["Inbox", "INBOX"],
    ] as const) {
      const item = page.getByRole("button", { name: new RegExp(`^${name}(\\s|$)`) }).first();
      switches.push(
        await timed(
          page,
          () => item.click(),
          (label) =>
            location.hash.includes(`/${label}`) &&
            document.querySelectorAll("[data-message-row]").length > 0 &&
            !document.querySelector("[data-mail-list-pane] .animate-pulse"),
          label,
        ),
      );
    }
    sample.switchFolder = median(switches);

    // Scroll the whole inbox list, counting slow frames.
    const scroll = await page.evaluate(async () => {
      const viewport = document.querySelector(
        "[data-mail-list-pane] [data-slot=scroll-area-viewport]",
      ) as HTMLElement;
      const frames: number[] = [];
      let last = performance.now();
      const start = last;
      for (let i = 0; i < 120; i++) {
        viewport.scrollTop += 400;
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frames.push(now - last);
        last = now;
      }
      viewport.scrollTop = 0;
      frames.sort((a, b) => a - b);
      return {
        total: performance.now() - start,
        p95: frames[Math.floor(frames.length * 0.95)]!,
        long: frames.filter((f) => f > 50).length,
        rows: document.querySelectorAll("[data-message-row]").length,
      };
    });
    sample.scrollP95Frame = Math.round(scroll.p95);
    sample.scrollLongFrames = scroll.long;
    sample.rowsRendered = scroll.rows;

    // Search the mailbox.
    await page.getByRole("button", { name: "Search this mailbox" }).first().click();
    const box = page.locator("input[type=search], [data-mail-list-pane] input").first();
    await box.waitFor();
    sample.search = await timed(
      page,
      async () => {
        await box.fill("pasta");
        await box.press("Enter");
      },
      () =>
        /search|q=/.test(location.hash) &&
        document.querySelectorAll("[data-message-row]").length > 0,
    );
    await page.keyboard.press("Escape");

    // Calendar: the week's events, then the next week's.
    sample.openCalendar = await timed(
      page,
      () => page.getByRole("button", { name: "Calendar", exact: true }).first().click(),
      () => location.hash.includes("/calendar") && document.querySelector("[data-event]") != null,
    );
    const weekBefore = await page.evaluate(() =>
      [...document.querySelectorAll("[data-event-key]")]
        .map((e) => e.getAttribute("data-event-key"))
        .join(),
    );
    sample.calendarNextWeek = await timed(
      page,
      () => page.getByRole("button", { name: "Next", exact: true }).first().click(),
      (before) => {
        const keys = [...document.querySelectorAll("[data-event-key]")]
          .map((e) => e.getAttribute("data-event-key"))
          .join();
        return keys !== before && document.querySelector("[data-event]") != null;
      },
      weekBefore,
    );

    // Agents: the chats list, then a chat's transcript.
    sample.openAgents = await timed(
      page,
      () => page.getByRole("button", { name: "Agent", exact: true }).first().click(),
      () =>
        location.hash.includes("/agents") &&
        document.querySelectorAll("[data-chat-item]").length > 0 &&
        document.querySelector("textarea, [contenteditable=true]") != null,
    );
    const chats: number[] = [];
    for (let i = 0; i < 3; i++) {
      const item = page.locator("[data-chat-item]").nth(i);
      const id = await item.getAttribute("data-chat-item");
      chats.push(
        await timed(
          page,
          () => item.click(),
          (id) =>
            location.hash.includes(id) &&
            document.querySelector("[data-message-id]:not([data-message-row])") != null,
          id!,
        ),
      );
    }
    sample.openChat = median(chats);
    // The next launch opens where this one left off: in the Inbox.
    await page.evaluate((mailbox) => {
      location.hash = `#/mail/${mailbox}/INBOX`;
    }, MAILBOX);
    await page.locator("[data-message-row]").first().waitFor();
    if (values.loaded) await openEverything(page);

    await page.waitForTimeout(3000);
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics());
    sample.memoryMB = Math.round(
      metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024,
    );
    for (const m of metrics) {
      const name = `mem${m.serviceName === "node.mojom.NodeService" ? "Backend" : m.type === "Tab" ? "Renderer" : m.type === "Browser" ? "Main" : m.type === "GPU" ? "Gpu" : "Other"}`;
      sample[name] = (sample[name] ?? 0) + Math.round(m.memory.workingSetSize / 1024);
    }
    // CPU while idle, over five seconds.
    await page.waitForTimeout(5000);
    const idle = await app.evaluate(({ app }) => app.getAppMetrics());
    sample.idleCpuPct =
      Math.round(idle.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0) * 10) / 10;
  } finally {
    await quit(app);
  }
  return sample;
}

/**
 * The browser panel with three tabs, the calendar panel and the chat window on a chat, for the
 * next launch. Escape (leaving a message, a search) closes the chat window, so each run ends
 * with this again.
 */
async function openEverything(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Agent", exact: true }).first().click();
  await page.locator("[data-chat-item]").first().click();
  await page.locator("[data-message-id]:not([data-message-row])").first().waitFor();
  await page.evaluate((mailbox) => {
    const tabs = [
      "https://www.google.com/",
      "https://en.wikipedia.org/wiki/Otter",
      "https://github.com/",
    ].map((url, i) => ({ id: `bench-${i}`, url, title: "", favicon: null }));
    localStorage.setItem("gmail:browser-tabs", JSON.stringify({ tabs, activeId: "bench-0" }));
    localStorage.setItem("gmail:browser-open", "1");
    localStorage.setItem("gmail:calendar-panel-open", "1");
    localStorage.setItem("gmail:chat-window-open", "1");
    location.hash = `#/mail/${mailbox}/INBOX`;
  }, MAILBOX);
  await page.locator("[data-message-row]").first().waitFor();
}

const kept = process.env.OTTER_BENCH_HOME;
const home = kept ?? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otter-bench-"));
const userData = NodePath.join(home, "userdata");
const results: Record<string, Sample[]> = { firstLaunch: [], grown: [], warm: [] };
try {
  // The first launch seeds the made-up services; then the mailbox grows and the cache starts over.
  if (!kept || !NodeFS.existsSync(NodePath.join(userData, "mail-cache.db"))) {
    results.firstLaunch!.push(await measure(home, true));
    console.log("first launch", results.firstLaunch![0]);
    await growMailbox(userData, messageCount);
    results.grown!.push(await measure(home, false));
    if (values.loaded) {
      const { app, page } = await launch(home);
      await page.locator("[data-message-row]").first().waitFor({ timeout: 60_000 });
      await openEverything(page).finally(() => quit(app));
    }
  }
  for (let i = 0; i < runs; i++) {
    const s = await measure(home, true);
    console.log("warm", s);
    results.warm!.push(s);
  }
} finally {
  if (!kept) NodeFS.rmSync(home, { recursive: true, force: true });
}

const keys = [...new Set(results.warm!.flatMap((s) => Object.keys(s)))];
const summary = Object.fromEntries(keys.map((k) => [k, median(results.warm!.map((s) => s[k]!))]));
const first = results.firstLaunch![0];
if (first) {
  console.log("\nFirst launch (new data home, nothing cached)");
  for (const k of ["windowShown", "firstMail"]) console.log(`  ${k.padEnd(18)}  ${first[k]}`);
}
console.log(`\n${messageCount} messages, ${runs} warm runs (median)`);
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(18)}  ${v}`);
if (values.json)
  NodeFS.writeFileSync(values.json, JSON.stringify({ messageCount, summary, results }, null, 2));
