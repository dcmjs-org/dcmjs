# dcmjs 1.0: the package name

`@dcmjs-org/dcmjs` has the export names of dcmjs 0.x, so this codemod changes
names only. A project that already uses the 1.0 beta does not need it. The
codemod is optional: the unscoped `dcmjs` package publishes 1.x too, and it
re-exports `@dcmjs-org/dcmjs`.

```sh
npx codemod @dcmjs-org/dcmjs-1-package-name --dry-run
```

## What it changes

-   `package.json`: the entry `"dcmjs"` in `dependencies`, `devDependencies`,
    `peerDependencies` and `optionalDependencies` becomes
    `"@dcmjs-org/dcmjs": "^1.0.0"`. To install a beta, change the version after
    the run, or change `VERSION` in `scripts/package-json.ts`.
-   The module name `"dcmjs"` becomes `"@dcmjs-org/dcmjs"` in `import`,
    `export ... from`, `import type`, `require()`, `import()`,
    `import x = require()`, `declare module`, `require.resolve()`, and the
    module calls of jest and vitest (`jest.mock`, `jest.requireActual`,
    `vi.mock`, ...). The local names do not change.

It does not change another package whose name contains `dcmjs` (for example
`dcmjs-dimse`), a string that is not a module name, or the UMD global
`dcmjs` (1.0 keeps that name).

## What it reports (`dcmjs-1-manual`)

-   `dcmjs/<path>: 1.0 has no such subpath`: an import of a file in the 0.x
    package, for example `dcmjs/build/dcmjs.es.js`. Import `@dcmjs-org/dcmjs`,
    or one of its subpaths (`/eventStream`, `/media`, `/encapsulated`,
    `/image`).
-   `"<text>": a configuration names the 0.x package`: a string such as the
    jest `moduleNameMapper` key `"^dcmjs$"`, or a path into
    `node_modules/dcmjs`. When the project uses a subpath and jest, use this
    configuration:

    ```js
    moduleNameMapper: {
        "^@dcmjs-org/dcmjs$":
            "<rootDir>/node_modules/@dcmjs-org/dcmjs/build/dcmjs.es.js",
        "^@dcmjs-org/dcmjs/(eventStream|media|encapsulated|image)$":
            "<rootDir>/node_modules/@dcmjs-org/dcmjs/build/$1.es.js"
    },
    transformIgnorePatterns: ["/node_modules/(?!@dcmjs-org)"]
    ```

    Jest must transform these files with a project-wide `babel.config.js`,
    because a `.babelrc` does not apply to `node_modules`.

## What it cannot find

-   **Node version.** 1.0 needs Node `>=22.13`. Update `engines` and the CI
    matrix.
-   **A `require()` and a subpath in one program.** A `require()` of the
    default entry loads the UMD build, which has its own reader state (the log
    level and the `registerTag()` entries). When the project also imports a
    subpath, change the `require()` to an `import`.
-   **Two copies of dcmjs.** A dependency can still use dcmjs 0.x. Then the
    program loads two copies, and a `registerTag()` call of one copy does not
    apply to the other. Run `npm ls dcmjs` (or `pnpm why dcmjs`).
-   **`LOG_LEVEL`.** The ESM entries read the `LOG_LEVEL` environment variable
    when they load.
-   A bundler alias or a script that names the package in a file that is not
    JavaScript, TypeScript or `package.json`.
