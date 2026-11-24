# CM-1: change the package name to `@dcmjs-org/dcmjs`

Phase 1. Automatic. A project that already uses the 1.0 beta skips this
codemod.

`@dcmjs-org/dcmjs` reproduces the 0.x surface of `dcmjs`, so this codemod changes
names only. It does not change a call.

## Detect

-   `package.json`: `"dcmjs"` in `dependencies`, `devDependencies` or
    `peerDependencies`.
-   An import or a require of `"dcmjs"` or `"dcmjs/..."`:
    -   `import dcmjs from "dcmjs"`
    -   `import { data, utilities } from "dcmjs"`
    -   `import * as dcmjs from "dcmjs"`
    -   `require("dcmjs")`, `await import("dcmjs")`
    -   `import type ... from "dcmjs"`, and `declare module "dcmjs"`
-   Build and test configuration that names the package: the jest
    `moduleNameMapper` and `transformIgnorePatterns`, a bundler `alias` or
    `external`, a Vite `optimizeDeps` entry, a webpack `resolve.alias`.
-   A path into the package files: `node_modules/dcmjs/build/...`.

Do not change:

-   The UMD global `dcmjs` (a `<script>` tag gives `window.dcmjs`). The 1.0
    build keeps the name `dcmjs`.
-   Another package whose name contains `dcmjs`, for example
    `@cornerstonejs/adapters` or `dcmjs-dimse`.
-   Text in a changelog or a comment that refers to 0.x.

## Transform

```diff
 // package.json
-"dcmjs": "^0.38.0"
+"@dcmjs-org/dcmjs": "^1.0.0"
```

```diff
-import dcmjs from "dcmjs";
+import dcmjs from "@dcmjs-org/dcmjs";

-const { data } = require("dcmjs");
+const { data } = require("@dcmjs-org/dcmjs");
```

Keep the local binding name (`dcmjs`), so no other line changes.

The subpaths (`/eventStream`, `/media`, `/encapsulated`, `/image`) are ES
modules only. When a project uses a subpath and runs jest, replace the
mapper of the default entry with the mapper below. The mapper makes the
default entry and each subpath share one copy of the reader state (the log
level and the `registerTag()` entries):

```js
// jest.config.js
moduleNameMapper: {
    "^@dcmjs-org/dcmjs$":
        "<rootDir>/node_modules/@dcmjs-org/dcmjs/build/dcmjs.es.js",
    "^@dcmjs-org/dcmjs/(eventStream|media|encapsulated|image)$":
        "<rootDir>/node_modules/@dcmjs-org/dcmjs/build/$1.es.js"
},
transformIgnorePatterns: ["/node_modules/(?!@dcmjs-org)"]
```

Jest must transform these files with a project-wide `babel.config.js`, because
a `.babelrc` does not apply to `node_modules`.

## Review

-   **Node version.** 1.0 needs Node `>=22.13`. Update `engines` and the CI
    matrix when they name an older version.
-   **A `require()` and a subpath in one program.** A `require()` of the default
    entry loads the UMD build, which has its own reader state. When the project
    also imports a subpath, change the `require()` to an `import`.
-   **Two copies of dcmjs.** A dependency of the project can still depend on
    `dcmjs` 0.x. Then the program loads two copies, and a `registerTag()` call
    or a log level of one copy does not apply to the other. Run
    `npm ls dcmjs` (or `pnpm why dcmjs`) and list each dependency that still
    uses 0.x.
-   **`LOG_LEVEL`.** The ESM entries read the `LOG_LEVEL` environment variable
    when they load. A test run that sets `LOG_LEVEL` for another tool also sets
    the dcmjs log level.

## Verify

-   `grep -rnE "from ['\"]dcmjs['\"/]|require\(['\"]dcmjs['\"/]" src test`
    finds nothing.
-   The install succeeds, and the tests of the project run. A test that fails
    now usually fails because of a naturalized value: apply CM-2.
