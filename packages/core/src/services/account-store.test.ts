import { describe, expect, it } from "vite-plus/test";

import { utf8Decode, utf8Encode } from "../bytes.ts";
import { setPlatform, type Platform } from "../platform.ts";

const { addAccount, getAccount, updateAccount } = await import("./account-store.ts");

const files = new Map<string, string>();
const slowly = () => new Promise((resolve) => setTimeout(resolve, 5));

setPlatform({
  files: {
    read: async (path) => {
      await slowly();
      return files.has(path) ? utf8Encode(files.get(path)!) : null;
    },
    write: async (path, data) => {
      await slowly();
      files.set(path, typeof data === "string" ? data : utf8Decode(data));
    },
  },
} as Partial<Platform> as Platform);

describe("account-store", () => {
  it("keeps every change made at once", async () => {
    await addAccount({ id: "a", email: "a@x.com", name: "A" });
    await Promise.all([
      updateAccount("a", { signature: "<div>A</div>", signatureInGmail: true }),
      updateAccount("a", { name: "Ada", picture: "https://example.com/a.png" }),
      addAccount({ id: "b", email: "b@x.com", name: "B" }),
    ]);
    expect(await getAccount("a")).toMatchObject({
      name: "Ada",
      picture: "https://example.com/a.png",
      signature: "<div>A</div>",
      signatureInGmail: true,
    });
    expect(await getAccount("b")).toMatchObject({ email: "b@x.com" });
  });

  it("goes on after a change that fails", async () => {
    await expect(updateAccount("missing", { name: "M" })).rejects.toThrow("Account not found");
    expect(await updateAccount("a", { color: "#f00" })).toMatchObject({ color: "#f00" });
  });
});
