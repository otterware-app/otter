import type { ChatTurn } from "@otter/contracts/chats";

/**
 * Puts a delivery that just finished (the last turn) where it happened among the chat's turns: one
 * caught up on late, after messages sent since, goes before them. A turn without a time stays put.
 */
export function placeDelivered(turns: ChatTurn[]): void {
  const delivery = turns.at(-1);
  if (!delivery?.delivered || delivery.startedAt === undefined) return;
  const at = turns.findIndex(
    (t, i) =>
      i < turns.length - 1 && t.startedAt !== undefined && t.startedAt > delivery.startedAt!,
  );
  if (at < 0) return;
  // A reply goes with the message it answers.
  const before =
    at > 0 && turns[at].role === "assistant" && turns[at - 1].role === "user" ? at - 1 : at;
  turns.splice(turns.length - 1, 1);
  turns.splice(before, 0, delivery);
}
