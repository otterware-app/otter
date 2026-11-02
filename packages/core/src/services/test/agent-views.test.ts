import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  views: [] as Record<string, unknown>[],
  counted: [] as unknown[],
}));

vi.mock("../../ipc.ts", () => {
  const accounts = [
    { id: "home", email: "me@home.example" },
    { id: "work", email: "me@work.example" },
  ];
  const labels: Record<string, { id: string; name: string; type: string }[]> = {
    home: [{ id: "L_receipts", name: "Receipts", type: "user" }],
    work: [{ id: "L_finance", name: "Finance", type: "user" }],
  };
  const handlers = new Map<string, (p: any) => unknown>([
    ["gmail:listAccounts", () => accounts],
    ["gmail:listLabels", (p) => labels[p.accountId] ?? []],
    ["gmail:listViews", () => state.views],
    [
      "gmail:saveView",
      (p) => {
        const existing = state.views.find((v) => v.id === p.id);
        if (existing) return Object.assign(existing, p);
        const view = {
          kind: "custom",
          icon: null,
          color: null,
          ...p,
          id: `v_${state.views.length}`,
        };
        state.views.push(view);
        return view;
      },
    ],
    ["gmail:deleteView", (p) => (state.views = state.views.filter((v) => v.id !== p.viewId))],
    [
      "gmail:countCombinedMessages",
      (p) => {
        state.counted.push(p.rules);
        return { total: 3, unread: 1 };
      },
    ],
  ]);
  return { registeredHandlers: () => handlers };
});

const { viewTools } = await import("../agent/tools/views.ts");

const confirmed: string[] = [];
const ctx = {
  caller: { mode: () => "approval-required" as const, turn: () => null },
  confirm: async (detail: string) => {
    confirmed.push(detail);
  },
};

function tool(name: string) {
  const found = viewTools.find((t) => t.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  return (args: Record<string, unknown> = {}) => found.run(args, ctx) as Promise<any>;
}

beforeEach(() => {
  state.views = [];
  confirmed.length = 0;
});

describe("view tools", () => {
  it("makes a view from label names, asks first, and says what it finds", async () => {
    const saved = await tool("save_view")({
      name: "Money",
      icon: "money",
      color: "green",
      rules: [
        { account: "me@home.example", mustHave: ["Receipts"] },
        { account: "me@work.example", mustHave: ["finance"], mustNotHave: ["unread"] },
      ],
    });
    expect(state.views[0]).toMatchObject({
      name: "Money",
      icon: "money",
      color: "#34c759",
      rules: [
        { accountId: "home", allOf: ["L_receipts"], noneOf: [] },
        { accountId: "work", allOf: ["L_finance"], noneOf: ["UNREAD"] },
      ],
    });
    expect(confirmed[0]).toContain("Make the view “Money”");
    expect(confirmed[0]).toContain("me@work.example: finance, not unread");
    expect(confirmed[0]).toContain("Wearing money in green");
    expect(saved).toMatchObject({
      name: "Money",
      matches: { total: 3, unread: 1 },
      rules: [
        { account: "me@home.example", mustHave: ["Receipts"], mustNotHave: [] },
        { account: "me@work.example", mustHave: ["Finance"], mustNotHave: ["UNREAD"] },
      ],
    });
  });

  it("changes only what's given, and deletes", async () => {
    const { id } = await tool("save_view")({
      name: "Money",
      rules: [{ account: "me@home.example", mustHave: ["Receipts"] }],
    });
    await tool("save_view")({ view: id, name: "Spending", icon: "🧾" });
    expect(state.views[0]).toMatchObject({
      name: "Spending",
      icon: "🧾",
      rules: [{ accountId: "home", allOf: ["L_receipts"], noneOf: [] }],
    });
    expect((await tool("list_views")()).views).toHaveLength(1);
    await tool("delete_view")({ view: id });
    expect(state.views).toHaveLength(0);
    expect(confirmed.at(-1)).toContain("Delete the view “Spending”");
  });

  it("refuses an unknown label or icon, before asking", async () => {
    await expect(
      tool("save_view")({ name: "X", rules: [{ account: "me@home.example", mustHave: ["Nope"] }] }),
    ).rejects.toThrow(/No label "Nope"/);
    await expect(
      tool("save_view")({
        name: "X",
        icon: "rocketship",
        rules: [{ account: "me@home.example", mustHave: ["Receipts"] }],
      }),
    ).rejects.toThrow(/isn't an icon/);
    expect(confirmed).toHaveLength(0);
  });
});
