import { describe, expect, it } from "vite-plus/test";
import type { ChatTurn } from "@otter/contracts/chats";
import { placeDelivered } from "./chat-order.ts";

const turn = (id: string, role: ChatTurn["role"], startedAt?: number): ChatTurn => ({
  id,
  role,
  text: "",
  ...(startedAt !== undefined && { startedAt }),
});

describe("a delivery caught up on late", () => {
  it("goes where it happened, before the messages sent since, with their replies", () => {
    const turns = [
      turn("u-1", "user", 1),
      turn("a-1", "assistant", 2),
      turn("u-2", "user"),
      turn("a-2", "assistant", 20),
      { ...turn("a-run:delivery:d", "assistant", 10), delivered: { kind: "automation" as const } },
    ];
    placeDelivered(turns);
    expect(turns.map((t) => t.id)).toEqual(["u-1", "a-1", "a-run:delivery:d", "u-2", "a-2"]);
  });

  it("stays last when it's the newest, and leaves other turns alone", () => {
    const newest = [
      turn("u-1", "user", 1),
      { ...turn("a-run:delivery:d", "assistant", 10), delivered: { kind: "message" as const } },
    ];
    placeDelivered(newest);
    expect(newest.map((t) => t.id)).toEqual(["u-1", "a-run:delivery:d"]);
    const reply = [turn("u-1", "user", 5), turn("a-1", "assistant", 1)];
    placeDelivered(reply);
    expect(reply.map((t) => t.id)).toEqual(["u-1", "a-1"]);
  });
});
