import { describe, expect, it } from "vite-plus/test";

import { draftSaveQueue } from "./use-draft-autosave.ts";

function fakeDraft() {
  const draft = { content: "", saved: "", saves: [] as string[], finish: [] as (() => void)[] };
  const save = async () => {
    if (draft.content === draft.saved) return;
    const snapshot = draft.content;
    draft.saves.push(snapshot);
    await new Promise<void>((resolve) => draft.finish.push(resolve));
    draft.saved = snapshot;
  };
  return { draft, queue: draftSaveQueue(save) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Saving a draft", () => {
  it("saves again what was typed while a save was in flight", async () => {
    const { draft, queue } = fakeDraft();
    draft.content = "Hello";
    void queue.trigger();
    draft.content = "Hello there";
    void queue.trigger();
    expect(draft.saves).toEqual(["Hello"]);

    draft.finish[0]!();
    await settle();
    expect(draft.saves).toEqual(["Hello", "Hello there"]);
    draft.finish[1]!();
    await settle();
    expect(draft.saved).toBe("Hello there");
  });

  it("closes only once the latest text is saved", async () => {
    const { draft, queue } = fakeDraft();
    draft.content = "Hello";
    void queue.trigger();
    draft.content = "Hello there";
    let closed = false;
    const closing = queue.trigger().then(() => {
      closed = true;
    });

    draft.finish[0]!();
    await settle();
    expect(closed).toBe(false);
    draft.finish[1]!();
    await closing;
    expect(draft.saved).toBe("Hello there");
    expect(queue.pending()).toBeNull();
  });

  it("keeps one save in flight at a time", async () => {
    const { draft, queue } = fakeDraft();
    draft.content = "a";
    void queue.trigger();
    draft.content = "ab";
    void queue.trigger();
    draft.content = "abc";
    void queue.trigger();
    expect(draft.saves).toEqual(["a"]);

    draft.finish[0]!();
    await settle();
    expect(draft.saves).toEqual(["a", "abc"]);
    draft.finish[1]!();
    await settle();
    expect(draft.saves).toEqual(["a", "abc"]);
    expect(draft.saved).toBe("abc");
  });
});
