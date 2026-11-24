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
      "apps/*-mobile/ios/**",
      "apps/*-mobile/android/**",
      "apps/*-mobile/.expo/**",
      "apps/*-mobile/expo-env.d.ts",
    ],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: [
      "dist",
      "dist-electron",
      "release",
      "node_modules",
      "native/*/.build/**",
      "apps/*-mobile/ios/**",
      "apps/*-mobile/android/**",
      "apps/*-mobile/.expo/**",
      "apps/*-mobile/expo-env.d.ts",
    ],
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
      {
        // What an extension's halves share (its calls, its forms' state): a phone's half imports it too.
        files: ["extensions/*/shared/**/*.ts"],
        rules: {
          "eslint/no-restricted-globals": [
            "error",
            ...["window", "document", "navigator", "location", "localStorage"].map((name) => ({
              name,
              message:
                "An extension's shared files run in React Native too: ask @otter/client's host.",
            })),
          ],
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [{ name: "@otter/core", message: "Import from @otter/core/extension-kit." }],
              patterns: [
                {
                  group: [
                    "~/*",
                    "**/apps/**",
                    "**/packages/**",
                    "@otter/web/*",
                    "@otter/desktop/*",
                    "@otter/ui/*",
                    "react-dom",
                    "react-native",
                  ],
                  message:
                    "An extension's shared files draw nothing: they reach the app through @otter/client.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/client/**/*.{ts,tsx}"],
        rules: {
          "eslint/no-restricted-globals": [
            "error",
            ...[
              "window",
              "document",
              "navigator",
              "location",
              "history",
              "localStorage",
              "sessionStorage",
            ].map((name) => ({
              name,
              message: "@otter/client runs in React Native too: ask the host (src/host.ts).",
            })),
          ],
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "react-dom",
                  message: "@otter/client runs in React Native too.",
                },
                {
                  name: "react-native",
                  message: "@otter/client runs in a browser too.",
                },
              ],
              patterns: [
                {
                  group: ["react-dom/*", "@otter/ui/*", "~/*", "**/apps/**"],
                  message: "@otter/client draws nothing and belongs to no app.",
                },
              ],
            },
          ],
        },
      },
      {
        files: [
          "apps/*-mobile/**/*.{ts,tsx}",
          "packages/mobile/**/*.ts",
          "packages/ui-native/**/*.{ts,tsx}",
        ],
        rules: {
          "eslint/no-restricted-globals": [
            "error",
            ...["document", "localStorage", "sessionStorage"].map((name) => ({
              name,
              message: "React Native has no DOM.",
            })),
          ],
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [{ name: "react-dom", message: "React Native has no DOM." }],
              patterns: [
                {
                  group: ["react-dom/*", "@otter/ui/*", "@base-ui/*", "lucide-react"],
                  message: "The iPhone apps draw with @otter/ui-native.",
                },
              ],
            },
          ],
        },
      },
    ],
  },
});
