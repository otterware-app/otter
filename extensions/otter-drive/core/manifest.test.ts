import { extensionManifest } from "@otter-mail/core/extension-kit";
import { describe, expect, it } from "vite-plus/test";

import { manifest } from "../manifest.ts";
import { parseDelimited } from "../ui/table.ts";

const base = {
  id: "x",
  name: "X",
  description: "X.",
  category: "integration",
  dataUse: "None.",
};

describe("workspaces in the manifest", () => {
  it("declares Drive", () => {
    expect(manifest.contributes?.workspaces).toEqual([{ id: "drive", title: "Drive" }]);
  });

  it("refuses ids the app's own spaces and routes take, and ones that aren't lowercase", () => {
    for (const id of ["calendar", "chats", "settings", "Drive", "my-drive"])
      expect(() =>
        extensionManifest({
          otterMail: { ...base, contributes: { workspaces: [{ id, title: "T" }] } },
        }),
      ).toThrow(/workspace/);
  });
});

describe("parseDelimited", () => {
  it("reads quoted cells, doubled quotes and CRLF", () => {
    expect(parseDelimited('a,"b, c"\r\n"say ""hi""",2\n', ",")).toEqual([
      ["a", "b, c"],
      ['say "hi"', "2"],
    ]);
  });

  it("stops at the row limit", () => {
    expect(parseDelimited("1\n2\n3\n", ",", 2)).toEqual([["1"], ["2"]]);
  });
});
