# @dcmjs-org/parser

The event-stream reading side of dcmjs: the listener contract
(`EventStreamListener`, the event vocabulary, `CONTRACT_VERSION`), the
collecting and naturalizing listeners (`CollectorListener`,
`NaturalizedListener`), the generators that turn inputs into contract events
(`fromPart10`, `fromPart10Stream`, `fromDicomWebJson`, `fromDataSet`), the
shared emit helpers, the async-iterator adapter, and the element-decode core
(`decodeCore`) the streaming reader parses with.

Everything here builds on `@dcmjs-org/core`, never on `@dcmjs-org/legacy`: the sync
engines stay deprecable. The two narrow places where the streaming reader
deliberately delegates to the eager reader — the rare-shape fallback in
`decodeCore.decodeWithEagerReadTag` and the bare (meta-less) dataset fallback
in `fromPart10Stream` — reach it through core's existing late-binding seam
(`ValueRepresentation.getDicomMessageClass()`), which is wired whenever
`@dcmjs-org/legacy`'s `DicomMessage` module loads. Through the dcmjs wrapper and
every old `src/` import path that wiring is automatic; with this package
loaded standalone those two fallbacks throw a clear error instead.

During the 1.0 beta this package is marked private; the publish flag flips when
the workspace layout settles, per RELEASE_PLAN.md.
