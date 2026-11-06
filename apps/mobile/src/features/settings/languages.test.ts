import { expect, it } from "vite-plus/test";

import { effectiveReadLanguages, languageSummary } from "./languages";

it("reads the chosen languages, else the iPhone's", () => {
  expect(effectiveReadLanguages(["fr"], ["en-US"])).toEqual(["fr"]);
  expect(effectiveReadLanguages([], ["en-GB", "en-US", "zh-Hans-CN"])).toEqual(["en", "zh"]);
  expect(effectiveReadLanguages([], [])).toEqual(["en"]);
});

it("sums them up as Settings shows them", () => {
  expect(languageSummary(["en", "fr"])).toBe("English, French");
  expect(languageSummary(["en", "fr", "de"])).toBe("English +2");
});
