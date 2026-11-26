import { describe, expect, it, vi } from "vite-plus/test";
import type { ErrorEvent, Event, TransactionEvent } from "@sentry/core";

const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@sentry/core", async (original) => ({
  ...(await original<typeof import("@sentry/core")>()),
  ...sentry,
}));

import { ConsentGate, reportLog, scrubBreadcrumb, scrubEvent, scrubText } from "./error-reports.ts";

describe("reportLog", () => {
  it("sends a failure's tags beside its scope, and only string ones", () => {
    const error = new Error("Only your own folders can be renamed.");
    reportLog("error", "handlers", "gmail:updateLabel failed", {
      error,
      tags: { provider: "imap", server: "other", count: 3 },
    });
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { provider: "imap", server: "other", scope: "handlers" },
      contexts: { log: { message: "gmail:updateLabel failed" } },
    });

    reportLog("error", "sync", "the label list came back empty");
    expect(sentry.captureMessage).toHaveBeenCalledWith("the label list came back empty", {
      level: "error",
      tags: { scope: "sync" },
      fingerprint: ["sync", "the label list came back empty"],
    });
  });
});

describe("scrubText", () => {
  it.each([
    [
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages?q=invoice",
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages",
    ],
    ["Authorization: Bearer ya29.a0AfB_byC-xyz", "Authorization: Bearer [redacted]"],
    ["refresh 1//0gLm1abcdefghijklmnopqrstuvwxyz failed", "refresh [token] failed"],
    ["id_token eyJhbGciOi.eyJzdWIiOi.c2ln", "id_token [token]"],
  ])("%s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it("keeps who and where", () => {
    const text = "sync failed for jane@acme.co at /Users/jane/Library/x.js";
    expect(scrubText(text)).toBe(text);
  });

  it("keeps what says where an error happened", () => {
    const text = "GmailApiError: HTTP 429 at apps/desktop/src/main.ts:12:3 (backend.cjs:400:9)";
    expect(scrubText(text)).toBe(text);
  });
});

describe("scrubEvent", () => {
  it("keeps the user and drops what could hold a secret", () => {
    const event = scrubEvent({
      type: undefined,
      message: "Couldn't link jane@acme.co",
      release: "otter-mail@1.2.3",
      user: { id: "u_1", email: "jane@acme.co", username: "Jane" },
      request: {
        url: "https://mail.otterware.app/jane@acme.co/INBOX?x=1",
        headers: { cookie: "s" },
        data: "body",
      },
      exception: {
        values: [
          {
            value: "Bearer ya29.abc expired",
            stacktrace: { frames: [{ filename: "app:///main.cjs", vars: { body: "Hi Jane" } }] },
          },
        ],
      },
      breadcrumbs: [{ category: "fetch", data: { url: "https://x.test/a?code=secret" } }],
    } as ErrorEvent);
    expect(event).toEqual({
      message: "Couldn't link jane@acme.co",
      release: "otter-mail@1.2.3",
      user: { id: "u_1", email: "jane@acme.co", username: "Jane" },
      request: { url: "https://mail.otterware.app/jane@acme.co/INBOX" },
      exception: {
        values: [
          {
            value: "Bearer [redacted] expired",
            stacktrace: { frames: [{ filename: "app:///main.cjs" }] },
          },
        ],
      },
      breadcrumbs: [{ category: "fetch", data: { url: "https://x.test/a" } }],
    });
  });
});

describe("scrubEvent on a transaction", () => {
  it("redacts a device token in a span's URL", () => {
    const token = "a".repeat(64);
    const event = scrubEvent({
      type: "transaction",
      spans: [
        {
          span_id: "1",
          trace_id: "2",
          start_timestamp: 0,
          data: { "url.full": `https://api.push.apple.com/3/device/${token}` },
        },
      ],
    } as unknown as TransactionEvent);
    expect(event.spans?.[0]?.data?.["url.full"]).toBe(
      "https://api.push.apple.com/3/device/[redacted]",
    );
  });
});

describe("scrubBreadcrumb", () => {
  it("leaves out the console and keeps clicks", () => {
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.click", message: "div.subject" })).toEqual({
      category: "ui.click",
      message: "div.subject",
    });
  });
});

describe("ConsentGate", () => {
  it("holds reports until the choice is known", () => {
    const sent: Event[] = [];
    const gate = new ConsentGate((event) => sent.push(event));
    const early = { type: undefined, message: "early" } as ErrorEvent;
    expect(gate.allowed(early)).toBe(false);
    gate.set(true);
    expect(sent).toEqual([early]);
    expect(gate.allowed(early)).toBe(true);
  });

  it("drops them when reports are off", () => {
    const sent: Event[] = [];
    const gate = new ConsentGate((event) => sent.push(event));
    gate.allowed({ type: undefined } as ErrorEvent);
    gate.set(false);
    expect(sent).toEqual([]);
  });
});
