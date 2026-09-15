---
title: Working in the monorepo
---

dcmjs is a pnpm monorepo. This page is the contributor's map: where things
live, which commands matter, and the gate philosophy that keeps the 1.0
rewiring honest.

## Workspace layout

The pnpm workspace (`pnpm-workspace.yaml`) contains the repo root plus
`packages/*`:

| Package | Path | Published? | What it is |
| --- | --- | --- | --- |
| `dcmjs` | `/` (repo root) | yes (the only one) | the data layer: `DicomMessage`, `DicomDict`, dictionary, VR classes, writer, naturalize, SR/adapters |
| `@dcmjs/parser` | `packages/parser` | no (private) | the vendored dicom-parser tokenizer — layer 0, offsets only, self-contained |
| `@dcmjs/docs` | `packages/docs` | no (private) | this Docusaurus site |

Key source locations:

- `src/lazy/LazyDicomReader.js` — the lazy read core (R1+R2 of the plan):
  `readFileLazy`, the lazy entry, materialization, dirty tracking, the writer
  seam (`_sourceSpan`, `_dirty`, `isCleanForPassthrough`). Its long docblock
  is the authoritative statement of the lazy core's intentional divergences —
  read it before touching read semantics.
- `src/DicomMessage.js`, `src/Tag.js`, `src/DicomDict.js` — `readFile` core
  dispatch, the backpatch writer, passthrough emission.
- `packages/parser/src` — the tokenizer. Treat it as a stable engine:
  byte-level behavior is pinned by its own 245-test suite and the gates below.
- `packages/parser/bench` — `parse-gate.cjs` (benchmark gate) and
  `bundle-gate.mjs` (self-containment gate).
- [the roadmap](roadmap.md) — **the engineering plan and log.** Per-section
  status notes, the R8 gate checklist, the open 1.0 API decisions, and pointers
  to the commits that executed each step. When in doubt about why something is
  the way it is, start there. (It absorbed the former `docs/REWIRING-PLAN.md`.)

## Commands

All from the repo root unless noted:

```bash
pnpm install                 # install the whole workspace

pnpm test                    # full main suite (jest), lazy core by default
DCMJS_CORE=eager pnpm test   # the same suite on the legacy eager core
pnpm exec jest test/data.test.js          # one suite (note: `pnpm test <path>`
                                          # does NOT filter — the script
                                          # already passes `.` to jest)
pnpm exec jest packages/parser            # just the parser's 245 tests
pnpm --filter @dcmjs/parser test          # same, via the workspace package

pnpm run bench:parser        # parse non-regression gate vs published
                             # dicom-parser@1.8.21 (runs node --expose-gc)
pnpm run gate:parser-bundle  # parser self-containment / side-effect gate

pnpm run build               # rollup build of the dcmjs bundle
pnpm run lint                # eslint --fix over src/ and test/
pnpm run format              # prettier over src/ and test/
```

Docs site (from `packages/docs`):

```bash
pnpm start                   # local dev server
pnpm run build               # production build (broken links fail the build)
```

## The gate philosophy

Two rules, enforced mechanically:

1. **Never regress the tokenizer.** `bench:parser` compares the vendored
   tokenizer against the published `dicom-parser@1.8.21` over the full
   `testImages` corpus and fails if the geometric-mean ratio exceeds 1.10 or
   any single file exceeds 1.25 (currently ~0.85 — faster on every file).
   `gate:parser-bundle` proves the parser stays a dependency-free island: a
   rollup bundle must resolve entirely from `packages/parser/src`, pull zero
   dictionary or dcmjs bytes, never import pako, stay under 120 kB, and
   import with no side effects. If your change makes the parser reach into
   dcmjs — or dcmjs reach into parser internals — a gate fails.

2. **Both cores stay equivalent until the eager core is deleted.** Any change
   to read semantics must keep the full main suite (635 tests) green on the
   default lazy core *and* under `DCMJS_CORE=eager`. The lazy core's
   documented divergences (error timing under `ignoreErrors`, see
   [the migration page](../migration/from-0x.md)) are pinned by
   `test/lazy-hardening.test.js`; anything else that behaves differently
   between cores is a bug. This dual-run requirement disappears only when the
   eager loop is deleted in 1.x (see the [roadmap](roadmap.md)).

Additional standing checks: the byte-identity suite (read → write of every
corpus fixture with zero edits must reproduce the input byte-for-byte) and the
lossless-read-write suite on both cores. The numbers behind all of this are on
the [performance page](../performance.md).

## Practical notes

- The parser suite runs offline against `packages/parser/testImages`; nothing
  downloads at test time. The main suite's integration tests live under
  `test/`.
- `babel.config.js` declares `babelrcRoots` so the parser package's own
  `.babelrc` works under the root jest run; the root `.babelrc` and rollup
  output are unaffected.
- The workspace pins supply-chain policies in `pnpm-workspace.yaml`
  (`minimumReleaseAge`, `blockExoticSubdeps`, trust policy). If an install
  fails on a fresh dependency, that is usually the release-age rule doing its
  job.
- Commit style follows conventional commits (`feat:`, `fix:`, `docs:`,
  `feat!:` for breaking changes); the rewiring step commits
  (`git log --oneline`) are good models — each carries its gate results in
  the message body.
