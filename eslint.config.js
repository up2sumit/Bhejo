import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Ignore build output + server runtime data + misc
  globalIgnores(["dist", "build", "coverage", "server/.data"]),

  // ---------- Frontend (React/Vite) ----------
  {
    files: ["src/**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    rules: {
      // Your codebase is big; keep this as warnings while developing
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^[A-Z_]",
          ignoreRestSiblings: true,
        },
      ],

      // These are opinionated rules that are noisy for this project right now.
      // We can re-enable later after a cleanup pass.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/static-components": "off",

      // Fast-refresh rule is strict; your app intentionally exports helpers in some component files.
      "react-refresh/only-export-components": "off",

      // Reduce noise while we stabilize
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "no-extra-boolean-cast": "warn",
      "no-misleading-character-class": "warn",
    },
  },

  // ---------- Backend (Node/Express) ----------
  {
    files: ["server/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node, // ✅ enables process, Buffer, etc.
        ...globals.es2021,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },

  // ---------- Root config files (vite/eslint/etc.) ----------
  {
    files: ["*.config.js", "vite.config.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
]);
