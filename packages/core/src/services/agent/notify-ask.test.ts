import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const notify = vi.fn();
const dismissNotification = vi.fn();
const broadcast = vi.fn();
let mockSettings = { notificationsMode: "inbox", agentNotificationsMode: "all" as const };

vi.mock("../../platform.ts", () => ({
  platform: () => ({ notify, dismissNotification }),
}));
vi.mock("../../ipc.ts", () => ({ broadcast }));
vi.mock("../settings-store.ts", () => ({
  getSettings: async () => mockSettings,
}));
vi.mock("./settings.ts", () => ({
  getProviderSettings: async () => ({
    selected: "home",
    agents: [
      {
        id: "home",
        kind: "openclaw",
        name: "Rowan",
        avatar: "data:image/png;base64,abc",
        settings: {},
      },
      { id: "work", kind: "hermes", name: "brokk", settings: {} },
    ],
  }),
}));

const { notifyAsk, dismissNotification: dismiss } = await import("./service.ts");

const ask = (key: string, viewing: boolean) =>
  notifyAsk("home", {
    key,
    kind: "approval",
    title: "Command approval",
    body: "date",
    chat: "chat-1",
    chatTitle: "Deploy check",
    viewing,
    appFocused: false,
  });
const settle = () => vi.advanceTimersByTimeAsync(600);

afterEach(() => {
  notify.mockReset();
  dismissNotification.mockReset();
  broadcast.mockReset();
  mockSettings = { notificationsMode: "inbox", agentNotificationsMode: "all" };
  vi.useRealTimers();
});

describe("what an agent asks of the user", () => {
  it("notifies once, from the agent and its chat, with Approve and Deny, however many windows report it", async () => {
    vi.useFakeTimers();
    ask("openclaw:req-1:approval:a", false);
    ask("openclaw:req-1:approval:a", false);
    await settle();
    ask("openclaw:req-1:approval:a", false);
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      id: "openclaw:req-1:approval:a",
      category: "agent",
      title: "Rowan · Deploy check",
      body: "Needs approval: date",
      actions: ["Approve", "Deny"],
      icon: "data:image/png;base64,abc",
      agent: { id: "home", name: "Rowan", conversation: "Deploy check" },
      chat: "chat-1",
    });
  });

  it("doesn't notify when a window is actively viewing that chat", async () => {
    vi.useFakeTimers();
    ask("openclaw:req-2:approval:a", false);
    ask("openclaw:req-2:approval:a", true);
    await settle();
    expect(notify).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("sends an in-app notice instead of an OS banner when Otter is focused elsewhere", async () => {
    vi.useFakeTimers();
    notifyAsk("home", {
      key: "openclaw:req-inapp:approval:a",
      kind: "approval",
      title: "Command approval",
      body: "git status",
      chat: "chat-1",
      chatTitle: "Deploy check",
      viewing: false,
      appFocused: true,
    });
    await settle();
    expect(notify).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith("agent:inAppNotice", {
      id: "openclaw:req-inapp:approval:a",
      kind: "approval",
      title: "Rowan · Deploy check",
      body: "Needs approval: git status",
      chat: "chat-1",
      agentName: "Rowan",
    });
  });

  it("sends finished replies quietly and decouples agent notifications from mail settings", async () => {
    vi.useFakeTimers();
    mockSettings = { notificationsMode: "off", agentNotificationsMode: "all" };
    notifyAsk("home", {
      key: "openclaw:req-5",
      kind: "finished",
      title: "Morning brief",
      chatTitle: "Morning brief",
      body: "All clear.",
      chat: "chat-1",
      viewing: false,
      appFocused: false,
    });
    await settle();
    expect(notify).toHaveBeenCalledWith({
      id: "openclaw:req-5",
      category: "agent",
      title: "Rowan · Morning brief",
      body: "Finished: All clear.",
      reply: "Reply to Rowan",
      icon: "data:image/png;base64,abc",
      agent: { id: "home", name: "Rowan", conversation: "Morning brief" },
      silent: true,
      chat: "chat-1",
    });
  });

  it("gives an agent without a picture its kind's mark", async () => {
    vi.useFakeTimers();
    notifyAsk("work", {
      key: "hermes:req-6",
      kind: "message",
      title: "Inbox",
      chatTitle: "Inbox",
      body: "Two need you.",
      chat: "chat-2",
      mark: "<svg/>",
      viewing: false,
      appFocused: false,
    });
    await settle();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: { id: "work", name: "brokk", mark: "<svg/>", conversation: "Inbox" },
      }),
    );
    expect(notify.mock.calls[0]?.[0]).not.toHaveProperty("icon");
  });

  it("respects agentNotificationsMode needs-you and off", async () => {
    vi.useFakeTimers();
    mockSettings = { notificationsMode: "all", agentNotificationsMode: "needs-you" as never };
    notifyAsk("home", {
      key: "openclaw:req-needs-finished",
      kind: "finished",
      title: "Done",
      body: "Done",
      viewing: false,
      appFocused: false,
    });
    notifyAsk("home", {
      key: "openclaw:req-needs-q",
      kind: "question",
      title: "Which env?",
      body: "Staging or prod?",
      chatTitle: "Deploy",
      options: ["Staging", "Prod"],
      viewing: false,
      appFocused: false,
    });
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Rowan · Deploy",
        body: "Asks: Staging or prod?",
        actions: ["Staging", "Prod"],
        reply: "Answer Rowan",
      }),
    );

    notify.mockReset();
    mockSettings = { notificationsMode: "all", agentNotificationsMode: "off" as never };
    notifyAsk("home", {
      key: "openclaw:req-off-a",
      kind: "approval",
      title: "Run",
      body: "ls",
      viewing: false,
      appFocused: false,
    });
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it("cancels in-flight notices dismissed during the settle window and forwards dismissals", async () => {
    vi.useFakeTimers();
    ask("openclaw:req-cancel-id", false);
    dismiss({ id: "openclaw:req-cancel-id" });
    ask("openclaw:req-cancel-chat", false);
    dismiss({ chat: "chat-1" });
    await settle();
    expect(notify).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    expect(dismissNotification).toHaveBeenCalledWith({ id: "openclaw:req-cancel-id" });
    expect(dismissNotification).toHaveBeenCalledWith({ chat: "chat-1" });

    ask("openclaw:req-3:approval:1", true);
    ask("openclaw:req-4:approval:1", false);
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
