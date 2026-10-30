import nicjansma from "eslint-config-nicjansma/flat.js";
import jsdoc from "eslint-plugin-jsdoc";
import globals from "globals";

export default [
    nicjansma,

    jsdoc.configs["flat/recommended"],
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.node
            }
        },
        rules: {
            // Enabled over nicjansma
            "no-var": "error",
            "prefer-const": "error",
            "jsdoc/require-jsdoc": ["warn", {
                require: { FunctionDeclaration: true, MethodDefinition: true, ClassDeclaration: true }
            }],
            "jsdoc/tag-lines": ["warn", "any", { startLines: 1 }],
            "jsdoc/no-undefined-types": "off",

            // Disabled over nicjansma
            "no-console": "off",
            "no-process-exit": "off",

            // Changed over nicjansma: allow `async (x) => ...`
            "space-before-function-paren": ["error", {
                anonymous: "never", named: "never", asyncArrow: "always"
            }]
        }
    },
    {
        // functions serialized by Puppeteer and run in the page
        files: ["resourcetiming-*.js"],
        languageOptions: {
            globals: {
                ...globals.browser
            }
        }
    }
];
