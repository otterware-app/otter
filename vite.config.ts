import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**", "**/.build/**"],
  },
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: [
      "dist",
      "dist-electron",
      "release",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "native/*/.build/**",
    ],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: ["dist", "dist-electron", "release", "node_modules", "native/*/.build/**"],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "eslint/no-restricted-imports": [
        "error",
        {
          paths: [{ name: "radix-ui", message: "Use @otter/ui's components (Base UI)." }],
          patterns: [
            { group: ["@radix-ui/*"], message: "Use @otter/ui's components (Base UI)." },
            { group: ["**/components/ui/*"], message: "UI components are in @otter/ui." },
          ],
        },
      ],
    },
    overrides: [
      {
        files: ["extensions/**/*.{ts,tsx}"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "@otter/core",
                  message: "Import from @otter/core/extension-kit.",
                },
                { name: "radix-ui", message: "Use @otter/ui's components (Base UI)." },
              ],
              patterns: [
                {
                  group: [
                    "~/*",
                    "**/apps/**",
                    "**/packages/**",
                    "@otter/web/*",
                    "!@otter/web/extension-kit",
                    "@otter/desktop/*",
                    "!@otter/desktop/extension-kit",
                  ],
                  message:
                    "Extensions use the app through @otter/core/extension-kit, @otter/web/extension-kit or @otter/desktop/extension-kit.",
                },
                { group: ["@radix-ui/*"], message: "Use @otter/ui's components (Base UI)." },
              ],
            },
          ],
        },
      },
      {
        files: ["extensions/**/*.test.ts"],
        rules: { "eslint/no-restricted-imports": "off" },
      },
    ],
  },
});
