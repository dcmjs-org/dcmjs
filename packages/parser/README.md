# @dcmjs-org/parser

The event-stream reading side of dcmjs: the listener contract
(`EventStreamListener`, the event vocabulary, `CONTRACT_VERSION`), the
collecting and naturalizing listeners (`CollectorListener`,
`NaturalizedListener`), the generators that turn inputs into contract events
(`fromPart10`, `fromPart10Stream`, `fromDicomWebJson`, `fromDataSet`), the
shared emit helpers, the async-iterator adapter, and the element-decode core
(`decodeCore`) the streaming reader parses with.

Everything here builds on `@dcmjs-org/core`. The package has one temporary
dependency on `@dcmjs-org/legacy`. In two places, the streaming reader passes
the work to the eager reader:

- the fallback for undefined-length elements that are not SQ, in
  `decodeCore.decodeWithEagerReadTag`;
- the bare (meta-less) dataset fallback, in `fromPart10Stream`.

Both places get the eager reader through core's late-binding seam
(`ValueRepresentation.getDicomMessageClass()`). `src/index.js` imports
`@dcmjs-org/legacy` to wire that seam. When the two fallbacks move to the
standard async handling, remove the import and the dependency. The list of
open items in `beta-1-release-notes.md` at the repository root tracks this
work.

## Build

`pnpm run build` writes `dist/index.mjs` (ES module) and `dist/index.cjs`
(CommonJS). The published package loads these files, so it works in plain
Node without a bundler. Inside the workspace, `main` points at `src/` so that
the tests run on the source.
