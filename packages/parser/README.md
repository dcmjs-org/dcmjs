# @dcmjs-org/parser

The event-stream reading side of dcmjs: the listener contract
(`EventStreamListener`, the event vocabulary, `CONTRACT_VERSION`), the
collecting and naturalizing listeners (`CollectorListener`,
`NaturalizedListener`), the generators that turn inputs into contract events
(`fromPart10`, `fromPart10Stream`, `fromDicomWebJson`, `fromDataSet`), the
shared emit helpers, the async-iterator adapter, and the element-decode core
(`decodeCore`) the streaming reader parses with.

Everything here builds on `@dcmjs-org/core`. The package does not depend on
`@dcmjs-org/legacy`.

## Build

`pnpm run build` writes `dist/index.mjs` (ES module) and `dist/index.cjs`
(CommonJS). The published package loads these files, so it works in plain
Node without a bundler. Inside the workspace, `main` points at `src/` so that
the tests run on the source.
