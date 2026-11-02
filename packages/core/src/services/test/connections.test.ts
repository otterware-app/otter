import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { MailAccount } from "../../types.ts";

const mocks = vi.hoisted(() => ({
  accounts: [] as MailAccount[],
  listCalendars: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock("../account-store.js", () => ({ listAccounts: async () => mocks.accounts }));
vi.mock("../../ipc.js", () => ({ broadcast: mocks.broadcast }));
vi.mock("../../providers/index.js", () => ({
  isSignedIn: () => true,
  capabilitiesOf: (a: MailAccount) => ({ calendar: a.provider !== "imap" }),
  findProvider: (a: MailAccount) =>
    a.provider === "imap" ? {} : { calendar: { listCalendars: mocks.listCalendars } },
}));

const { NoCalendarAccess } = await import("../../providers/provider.ts");
const { forgetRefusals, listConnections, noteAllowed } = await import("../connections.ts");

const gmail: MailAccount = { id: "me@gmail.com", email: "me@gmail.com", name: "Me" };
const icloud: MailAccount = {
  id: "me@icloud.com",
  email: "me@icloud.com",
  name: "Me",
  provider: "imap",
};

beforeEach(() => {
  mocks.accounts = [gmail, icloud];
  mocks.listCalendars.mockReset();
  mocks.broadcast.mockReset();
  forgetRefusals(gmail.id);
});

describe("listConnections", () => {
  it("derives a connection per mailbox, with a calendar only where there is one", async () => {
    mocks.listCalendars.mockResolvedValue([]);
    const connections = await listConnections();
    expect(connections.map((c) => [c.id, c.provider, c.resources.map((r) => r.kind)])).toEqual([
      ["me@gmail.com", "google", ["mail", "calendar"]],
      ["me@icloud.com", "imap", ["mail"]],
    ]);
    expect(connections.flatMap((c) => c.resources.flatMap((r) => r.needs))).toEqual([]);
  });

  it("asks once whether the calendar may list every calendar, and says what's missing", async () => {
    mocks.listCalendars.mockRejectedValue(new NoCalendarAccess("insufficient scopes"));
    const [first] = await listConnections();
    expect(first!.resources[1]!.needs.map((n) => n.allow)).toEqual(["Allow calendar access"]);
    await listConnections();
    expect(mocks.listCalendars).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast).toHaveBeenCalledWith("connections:changed");
  });

  it("forgets a refusal once the calendar works or the mailbox signs in again", async () => {
    mocks.listCalendars.mockRejectedValue(new NoCalendarAccess("insufficient scopes"));
    await listConnections();
    noteAllowed(gmail.id, "listCalendars");
    expect((await listConnections())[0]!.resources[1]!.needs).toEqual([]);

    forgetRefusals(gmail.id);
    mocks.listCalendars.mockResolvedValue([]);
    await listConnections();
    expect(mocks.listCalendars).toHaveBeenCalledTimes(2);
  });

  it("reports a signature kept only here as a mail permission", async () => {
    mocks.listCalendars.mockResolvedValue([]);
    mocks.accounts = [{ ...gmail, signatureInGmail: false }];
    const [connection] = await listConnections();
    expect(connection!.resources[0]!.needs.map((n) => n.operation)).toEqual(["saveSignature"]);
  });
});
