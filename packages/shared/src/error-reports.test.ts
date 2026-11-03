import { describe, expect, it } from "vite-plus/test";
import type { ErrorEvent } from "@sentry/core";

import { ConsentGate, scrubBreadcrumb, scrubEvent, scrubText } from "./error-reports.ts";

describe("scrubText", () => {
  it.each([
    ["sync failed for jane.doe+news@gmail.com: 401", "sync failed for [email]: 401"],
    [
      "ottermail://app/index.html#/jane@acme.co/Clients%2FAcme/18c2f",
      "ottermail://app/index.html#/[email]",
    ],
    [
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages?q=invoice",
      "GET https://gmail.googleapis.com/gmail/v1/users/me/messages",
    ],
    ["/v1/accounts/jane%40acme.co", "/v1/accounts/[email]"],
    ["Authorization: Bearer ya29.a0AfB_byC-xyz", "Authorization: Bearer [redacted]"],
    ["refresh 1//0gLm1abcdefghijklmnopqrstuvwxyz failed", "refresh [token] failed"],
    ["id_token eyJhbGciOi.eyJzdWIiOi.c2ln", "id_token [token]"],
    [
      "at /Users/jane/Library/x.js and /home/jane/.otter-mail",
      "at /Users/[user]/Library/x.js and /home/[user]/.otter-mail",
    ],
  ])("%s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it("keeps releases, which look like addresses", () => {
    expect(scrubText("otter-mail@0.13.23 and otter-mail@0.14.0-nightly.20261101.1")).toBe(
      "otter-mail@0.13.23 and otter-mail@0.14.0-nightly.20261101.1",
    );
  });

  it("keeps what says where an error happened", () => {
    const text = "GmailApiError: HTTP 429 at apps/desktop/src/main.ts:12:3 (backend.cjs:400:9)";
    expect(scrubText(text)).toBe(text);
  });
});

describe("scrubEvent", () => {
  it("drops what could hold mail and scrubs every string", () => {
    const event = scrubEvent({
      type: undefined,
      message: "Couldn't link jane@acme.co",
      release: "otter-mail@1.2.3",
      server_name: "janes-macbook",
      user: { id: "r_1", email: "jane@acme.co", ip_address: "1.2.3.4" },
      request: {
        url: "https://mail.otterware.app/jane@acme.co/INBOX?x=1",
        headers: { cookie: "s" },
        data: "body",
      },
      exception: {
        values: [
          {
            value: "token for jane@acme.co expired",
            stacktrace: { frames: [{ filename: "app:///main.cjs", vars: { body: "Hi Jane" } }] },
          },
        ],
      },
      breadcrumbs: [{ category: "fetch", data: { url: "https://x.test/a?q=secret" } }],
    } as ErrorEvent);
    expect(event).toEqual({
      message: "Couldn't link [email]",
      release: "otter-mail@1.2.3",
      user: { id: "r_1" },
      request: { url: "https://mail.otterware.app/[email]" },
      exception: {
        values: [
          {
            value: "token for [email] expired",
            stacktrace: { frames: [{ filename: "app:///main.cjs" }] },
          },
        ],
      },
      breadcrumbs: [{ category: "fetch", data: { url: "https://x.test/a" } }],
    });
  });

  it("asks Sentry not to place the sender by IP", () => {
    const event = scrubEvent({ type: undefined, sdk: { name: "sentry.javascript.electron" } });
    expect(event.sdk).toEqual({
      name: "sentry.javascript.electron",
      settings: { infer_ip: "never" },
    });
  });
});

describe("scrubBreadcrumb", () => {
  it("leaves out the console and clicks", () => {
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.click", message: "div.subject" })).toBeNull();
    expect(scrubBreadcrumb({ category: "mail-sync", message: "jane@acme.co synced" })).toEqual({
      category: "mail-sync",
      message: "[email] synced",
    });
  });

  it("keeps our window's routes but not the pages browsed", () => {
    const page = (url: string) =>
      scrubBreadcrumb({
        category: "electron",
        message: "renderer.dom-ready",
        data: { id: 3, url },
      });
    expect(page("https://drive.otterware.app/jane/a/report")?.data).toEqual({
      id: 3,
      url: "[page]",
    });
    expect(page("ottermail://app/index.html#/settings/general")?.data).toEqual({
      id: 3,
      url: "ottermail://app/index.html#/settings/general",
    });
  });
});

describe("ConsentGate", () => {
  it("holds reports until the choice is known", () => {
    const sent: ErrorEvent[] = [];
    const gate = new ConsentGate((event) => sent.push(event));
    const early = { type: undefined, message: "early" } as ErrorEvent;
    expect(gate.allowed(early)).toBe(false);
    gate.set(true);
    expect(sent).toEqual([early]);
    expect(gate.allowed(early)).toBe(true);
  });

  it("drops them when reports are off", () => {
    const sent: ErrorEvent[] = [];
    const gate = new ConsentGate((event) => sent.push(event));
    gate.allowed({ type: undefined } as ErrorEvent);
    gate.set(false);
    expect(sent).toEqual([]);
  });
});
