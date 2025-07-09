// eslint.config.js
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
    js.configs.recommended,
    prettier,

    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.jest
            }
        },
        rules: {
            "no-loss-of-precision": "off",
            "no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_" // for function parameters
                }
            ]
        }
    }
];
