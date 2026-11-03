import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { GraphError } from "./graph.ts";
import { cancelScheduledSend, scheduleSend, send } from "./send.ts";

const graph = vi.hoisted(() => vi.fn());
vi.mock("./graph.js", async (original) => ({ ...(await original()), graph }));

const ME = "me@contoso.test";
const mail = { to: "you@example.com", subject: "Later", body: "Hello" };
const SEND_AT = Date.parse("2026-10-29T09:00:00Z");
const calls = () =>
  graph.mock.calls.map(([, path, init]) => [init?.method ?? "GET", path, init?.body]);

beforeEach(() => {
  graph.mockReset();
  graph.mockImplementation(async (_account: string, path: string, init?: { method?: string }) =>
    init?.method === "POST" && path === "/me/messages" ? { id: "m1" } : {},
  );
});

describe("Outlook scheduled sends", () => {
  it("sets the send time, holds the message in the Outbox, then sends it", async () => {
    expect(await send(ME, mail, SEND_AT)).toEqual({ messageId: "m1" });
    expect(calls().slice(1)).toEqual([
      [
        "PATCH",
        "/me/messages/m1",
        {
          singleValueExtendedProperties: [
            { id: "SystemTime 0x3FEF", value: "2026-10-29T09:00:00.000Z" },
          ],
        },
      ],
      ["POST", "/me/messages/m1/move", { destinationId: "outbox" }],
      ["POST", "/me/messages/m1/send", undefined],
    ]);
  });

  it("sends at once without a time", async () => {
    await send(ME, mail);
    expect(calls().slice(1)).toEqual([["POST", "/me/messages/m1/send", undefined]]);
  });

  it("deletes the message when it can't be held", async () => {
    graph.mockImplementation(async (_account: string, path: string, init?: { method?: string }) => {
      if (path.endsWith("/move")) throw new Error("Offline");
      return init?.method === "POST" && path === "/me/messages" ? { id: "m1" } : {};
    });
    await expect(send(ME, mail, SEND_AT)).rejects.toThrow("Offline");
    expect(calls().at(-1)).toEqual(["POST", "/me/messages/m1/permanentDelete", undefined]);
  });

  it("cancels by deleting the held message, then purges it so it isn't left in Deleted Items", async () => {
    graph.mockImplementation(async (_account: string, path: string) =>
      path.includes("$select") ? { id: "m1", isDraft: true } : {},
    );
    expect(await cancelScheduledSend(ME, "m1")).toBe("cancelled");
    expect(calls()).toEqual([
      ["DELETE", "/me/messages/m1", undefined],
      ["GET", "/me/messages/m1?$select=id,isDraft", undefined],
      ["POST", "/me/messages/m1/permanentDelete", undefined],
    ]);
  });

  it("says when Outlook had already sent it, and puts it back in Sent Items", async () => {
    graph.mockImplementation(async (_account: string, path: string) =>
      path.includes("$select") ? { id: "m1", isDraft: false } : {},
    );
    expect(await cancelScheduledSend(ME, "m1")).toBe("sent");
    expect(calls()).toEqual([
      ["DELETE", "/me/messages/m1", undefined],
      ["GET", "/me/messages/m1?$select=id,isDraft", undefined],
      ["POST", "/me/messages/m1/move", { destinationId: "sentitems" }],
    ]);
  });

  it("counts a message deleted elsewhere as cancelled", async () => {
    graph.mockRejectedValueOnce(new GraphError(404, "ErrorItemNotFound", ""));
    expect(await cancelScheduledSend(ME, "m1")).toBe("cancelled");
  });

  it("holds the composer's own draft instead of making another", async () => {
    expect(await scheduleSend(ME, mail, SEND_AT, "d1")).toEqual({ messageId: "d1" });
    expect(calls().map(([method, path]) => `${method} ${path}`)).toEqual([
      "PATCH /me/messages/d1",
      "POST /me/messages/d1/move",
      "POST /me/messages/d1/send",
    ]);
  });

  it("never deletes the composer's draft when holding it fails", async () => {
    graph.mockImplementation(async (_account: string, path: string) => {
      if (path.endsWith("/move")) throw new Error("Offline");
      return {};
    });
    await expect(scheduleSend(ME, mail, SEND_AT, "d1")).rejects.toThrow("Offline");
    expect(calls().some(([, path]) => String(path).endsWith("/permanentDelete"))).toBe(false);
  });
});
