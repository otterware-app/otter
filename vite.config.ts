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
                  name: "@otter-mail/core",
                  message: "Import from @otter-mail/core/extension-kit.",
                },
              ],
              patterns: [
                {
                  group: [
                    "~/*",
                    "**/apps/**",
                    "**/packages/**",
                    "@otter-mail/web/*",
                    "!@otter-mail/web/extension-kit",
                    "@otter-mail/desktop/*",
                    "!@otter-mail/desktop/extension-kit",
                  ],
                  message:
                    "Extensions use the app through @otter-mail/core/extension-kit, @otter-mail/web/extension-kit or @otter-mail/desktop/extension-kit.",
                },
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
