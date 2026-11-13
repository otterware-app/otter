import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const notify = vi.fn();
vi.mock("../../platform.js", () => ({ platform: () => ({ notify }) }));
vi.mock("../settings-store.js", () => ({
  getSettings: async () => ({ notificationsMode: "inbox" }),
}));
vi.mock("./settings.js", () => ({
  getProviderSettings: async () => ({
    selected: "home",
    agents: [{ id: "home", kind: "openclaw", name: "Home", settings: {} }],
  }),
}));

const { notifyAsk } = await import("./service.js");

const ask = (key: string, focused: boolean) =>
  notifyAsk("home", { key, title: "Command approval", body: "date", focused });
const settle = () => vi.advanceTimersByTimeAsync(600);

afterEach(() => {
  notify.mockReset();
  vi.useRealTimers();
});

describe("what an agent asks of the user", () => {
  it("notifies once, however many windows report it or a turn picked up again asks again", async () => {
    vi.useFakeTimers();
    ask("openclaw:req-1:approval:a", false);
    ask("openclaw:req-1:approval:a", false);
    await settle();
    ask("openclaw:req-1:approval:a", false);
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      title: "Command approval",
      subtitle: "Home is waiting for you",
      body: "date",
    });
  });

  it("doesn't notify when a window that showed it had focus", async () => {
    vi.useFakeTimers();
    ask("openclaw:req-2:approval:a", false);
    ask("openclaw:req-2:approval:a", true);
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it("names the chat to open", async () => {
    vi.useFakeTimers();
    notifyAsk("home", {
      key: "openclaw:req-5",
      title: "Morning brief",
      subtitle: "Finished",
      chat: "chat-1",
      focused: false,
    });
    await settle();
    expect(notify).toHaveBeenCalledWith({
      title: "Morning brief",
      subtitle: "Finished",
      chat: "chat-1",
    });
  });

  it("keeps the same id in another turn apart", async () => {
    vi.useFakeTimers();
    ask("openclaw:req-3:approval:1", true);
    ask("openclaw:req-4:approval:1", false);
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
