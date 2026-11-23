import { describe, expect, it } from "vite-plus/test";

import { helperInput } from "./translator.js";

describe("helperInput", () => {
  it("replaces lone surrogates, which Foundation's JSONDecoder rejects", () => {
    const cut = "Merci 🦦".slice(0, 7);
    expect(JSON.parse(helperInput({ text: cut, texts: ["\uDC00a", "ok 🦦 été"] }))).toEqual({
      text: "Merci �",
      texts: ["�a", "ok 🦦 été"],
    });
  });
});
