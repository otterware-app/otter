import { describe, expect, it, vi } from "vite-plus/test";

import { importSwiftNotificationsMode } from "./swift-preferences";

const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

const SWIFT_USER = JSON.stringify({ id: "u1", email: "me@x.com" });
const pick = (keys: string[], values: Record<string, string>) =>
  Object.fromEntries(
    keys.flatMap((k) => {
      const value = k === "otter:user" ? SWIFT_USER : values[k];
      return value === undefined ? [] : [[k, value]];
    }),
  );

describe("importSwiftNotificationsMode", () => {
  it("keeps the mode the Swift app hadn't sent, once", async () => {
    const storage = memory();
    const invoke = vi.fn(async () => undefined);
    const read = vi.fn((keys: string[]) => pick(keys, { "push:pending-mode:u1": "off" }));
    await importSwiftNotificationsMode({ storage, email: "Me@x.com", read, invoke });
    await importSwiftNotificationsMode({ storage, email: "Me@x.com", read, invoke });
    expect(read).toHaveBeenCalledWith(["push:pending-mode:u1"]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("preferences:keepNotificationsMode", { mode: "off" });
  });

  it("leaves the account's mode alone when nothing was pending or it's unknown", async () => {
    const invoke = vi.fn(async () => undefined);
    await importSwiftNotificationsMode({
      storage: memory(),
      email: "Me@x.com",
      read: (keys: string[]) => pick(keys, {}),
      invoke,
    });
    await importSwiftNotificationsMode({
      storage: memory(),
      email: "Me@x.com",
      read: (keys: string[]) => pick(keys, { "push:pending-mode:u1": "loud" }),
      invoke,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("ignores a Swift user other than the account signed in now", async () => {
    const invoke = vi.fn(async () => undefined);
    await importSwiftNotificationsMode({
      storage: memory(),
      email: "someone@else.com",
      read: (keys: string[]) => pick(keys, { "push:pending-mode:u1": "off" }),
      invoke,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("tries again next launch if keeping it failed", async () => {
    const storage = memory();
    const read = (keys: string[]) => pick(keys, { "push:pending-mode:u1": "all" });
    await expect(
      importSwiftNotificationsMode({
        storage,
        email: "Me@x.com",
        read,
        invoke: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
    const invoke = vi.fn(async () => undefined);
    await importSwiftNotificationsMode({ storage, email: "Me@x.com", read, invoke });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
