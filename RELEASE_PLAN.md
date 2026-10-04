# dcmjs 1.0 Release Plan

Status: **proposal for maintainer review** (September 2026).
Supersedes the plan of 2026-08-07, which assumed work would flow through a
personal fork. This revision reflects two decisions from the September
maintainer discussions: the 1.0 rewrite ([PR #512]) will land as a series of
small, reviewable pull requests rather than one large one, and those pull
requests now go directly to this repository.

[PR #512]: https://github.com/dcmjs-org/dcmjs/pull/512

This document describes the plan in full so that maintainers can review the
process itself before any code moves. Nothing in this document is
self-executing; each step arrives as its own pull request.

---

## 1. The idea, in plain terms

PR #512 delivered the entire 1.0 rewrite at once: 303 files, 144,000 added
lines. The reviewers reasonably said they could not review a change that
large in one sitting.

This plan breaks that change into subsystems, each published as its own
package. Each subsystem is rebuilt from small reviewable pull requests on
its own staging branch, and merges into the `1.0-beta` release branch only
after a maintainer has reviewed it and the automated checks have passed.

The result is the same 1.0 release, but delivered in pieces a human can
review, with each piece individually tested and documented.

## 2. Where things stand

-   `master` is dcmjs 0.52.0, the version published on npm as `latest`.
-   The `1.0-beta` branch exists in this repository, currently identical to
    `master`. It is the assembly point for 1.0: content merges into it piece by
    piece, and each merge can publish a `1.0.0-beta.N` prerelease to npm.
-   The full rewrite lives on the author's fork and remains visible in
    PR #512, which now serves as the map of the total change rather than the
    thing to merge.
-   A detailed review of the rewrite produced 33 findings
    ([review map][review-map]); section 8 describes how each finding is
    routed.
-   The rewrite's author (Abbie Watson) now has write access to this
    repository, so all branches and pull requests described here are created
    here directly.

[review-map]: https://github.com/user-attachments/files/32256059/PR512-REVIEW-MAP.md

## 3. The packages

Today, everything dcmjs can do ships in a single npm package. That includes
things many users never need (FHIR mapping, DICOMDIR reading, video
handling), and bundling them made the library measurably larger for
everyone — about 19–36% larger in the 1.0 draft, depending on the build.

The fix is to split the library into packages that can be installed
independently. A hospital integration project that needs FHIR export
installs the FHIR package; a viewer that only parses images does not pay
for it.

The split below reflects the first review round on this document. The
engines are separated from the data types they operate on: one package
holds the shared building blocks, one holds the readers and writers
dcmjs users run today, and two hold the new streaming reader and writer.
That way a project can adopt the new engines piece by piece while the old
ones keep working unchanged.

| Package                             | What it does                                                                                                                                                                                                                                                                                                                                                 | Where the code is today                                                                                                                                                                                                                  | Published to npm?                                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@dcmjs-org/core`                       | The shared building blocks every other package uses: the DICOM value types, tags, buffer views, character-set handling, constants, and the runtime dictionary. No readers or writers live here.                                                                                                                                                              | `ValueRepresentation`, `SplitDataView`, `Tag`, `src/charset/`, `src/constants/`, the runtime dictionary files. Proposed but not settled: `DicomMetaDictionary` (the naturalization rules) — reviewers, please confirm where this belongs | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/legacy`                     | The engines dcmjs users run today: the eager whole-file reader and writer, and the async reader. They keep working unchanged, so current projects keep their behavior                                                                                                                                                                                        | `DicomMessage`, `DicomDict`, `AsyncDicomReader`, `BufferStream`, `datasetToBlob`                                                                                                                                                         | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/parser`                     | The new reading side: the event-stream contract and the streaming reader that handles files larger than memory. A note on the name: an earlier draft of this document used `@dcmjs-org/parser` for a vendored copy of the dicom-parser tokenizer. That vendored code is dropped from the 1.0 stream entirely; this package is the new reader, not that tokenizer | the reading half of `src/eventStream/`: the event contract, `fromPart10Stream`, and the listeners                                                                                                                                        | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/generator`                  | The new writing side: writers that produce DICOM files and DICOMweb JSON from the event stream, including the streaming writer for very large output                                                                                                                                                                                                         | `Part10Writer`, `StreamingPart10Writer`, `DicomWebJsonWriter` in `src/eventStream/`                                                                                                                                                      | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/schemas`                    | The machine-readable catalog of DICOM attributes: names, types, and rules, generated from the data dictionary                                                                                                                                                                                                                                                | `src/schema/`, `schema/`, `generate/`, `types/`                                                                                                                                                                                          | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/dicomdir`                   | Reads and writes DICOMDIR, the index file on the CDs and USB drives patients receive                                                                                                                                                                                                                                                                         | `src/media/`                                                                                                                                                                                                                             | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/pdfs`                       | Wraps PDF reports into DICOM instances and unwraps them again                                                                                                                                                                                                                                                                                                | `src/encapsulated/encapsulatedPdf.js`                                                                                                                                                                                                    | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/video`                      | Wraps MP4 video into DICOM instances without re-encoding, plus builders that turn decoded images into instances                                                                                                                                                                                                                                              | `src/encapsulated/encapsulatedVideo.js`, `src/image/`                                                                                                                                                                                    | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/media`                      | A convenience package that bundles and re-exports the three bulk-data helpers above (DICOMDIR, PDF, video). Those three stay individually installable; media is for projects that want all of them without tracking three names, and it keeps the package list from feeling too granular                                                                     | re-exports of `@dcmjs-org/dicomdir`, `@dcmjs-org/pdfs`, `@dcmjs-org/video`                                                                                                                                                                           | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/fhir`                       | Translates between DICOM and FHIR, the data format U.S. regulations require for patient record access                                                                                                                                                                                                                                                        | `packages/fhir/`                                                                                                                                                                                                                         | Yes                                                                                                                                                                                                                                              |
| `@dcmjs-org/fixtures`                   | The DICOM files used by the test suites, each with documented origin and license                                                                                                                                                                                                                                                                             | scattered today across `test/`, `packages/parser/testImages/`, `examples/data/`                                                                                                                                                          | No (kept private so installs stay small; can be published later if maintainers want)                                                                                                                                                             |
| `@dcmjs-org/tests`                      | Test suites that span several packages at once (integration and equivalence tests)                                                                                                                                                                                                                                                                           | parts of `test/`                                                                                                                                                                                                                         | No                                                                                                                                                                                                                                               |
| `@dcmjs-org/validator`                  | Future: checks datasets against `@dcmjs-org/schemas`. Only a scaffold for now; no working code exists yet                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                        | No, until it is real                                                                                                                                                                                                                             |
| `@dcmjs-org/web`                        | Support for DICOMweb, the standard's web API, building on the DICOMweb JSON reading and writing in the engines                                                                                                                                                                                                                                               | stretch goal                                                                                                                                                                                                                             | TBD                                                                                                                                                                                                                                              |
| `dcmjs` (the existing package name) | Becomes a thin wrapper that reproduces today's 0.52 surface: it re-exports `@dcmjs-org/legacy` and `@dcmjs-org/core`, plus the classic extras (structured reports, derivations, adapters, utilities, anonymizer). Exports from the new engines are added as they land, without disturbing the old surface                                                            | root `src/` minus everything above                                                                                                                                                                                                       | During the beta it publishes as `@dcmjs-org/dcmjs`, so a project can try it by changing only the import name. The unscoped `dcmjs` name starts publishing when the team decides it is ready — the first publish does not have to be the first commit |

What happened to the vendored tokenizer: the rewrite carried an adapted
copy of [dicom-parser] as a low-level tokenizer, used while evaluating the
lazy reading approach. Per review, it is dropped from the 1.0 stream
entirely, and the lazy reader with it. The modules built on top of it
(`decodeCore`, the tokenizer-backed `fromPart10`) and their test suites
(about 300 tests) retire too. The equivalence checks that compared the
streaming reader against that tokenizer will instead compare it against
the legacy eager reader, which becomes the single reference
implementation.

[dicom-parser]: https://github.com/cornerstonejs/dicomParser

One practical note on staging: the four engine packages (core, legacy,
parser, generator) share deeply intertwined code today, so the proposal is
to migrate them together on a single staging branch
(`release/1.0-beta-core`) and split them into their package folders at the
end, rather than run four parallel branches over the same files. Reviewers
can object here if they prefer otherwise.

All of these live in this one repository as folders in the existing pnpm
workspace. (pnpm is the package manager this repository already uses; a
"workspace" is its way of holding several packages in one repository so
they can be developed and tested together.)

A note on the scope name: this plan originally hoped for `@dcmjs/`, but
that npm organization is not ours. The packages publish under `@dcmjs-org/`
(matching the GitHub organization); the `@dcmjs-org` npm organization needs
registering by someone with npm account access before the first publish, if
it is not registered already. The owner of the `@dcmjs` name has been
contacted — if it becomes available, the team can reconsider the shorter
scope later; until then every name in this document reads `@dcmjs-org/`.

## 4. The branches

| Branch                       | Role                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `master`                     | Stable. Publishes to npm `latest`. Stays at 0.52.x until 1.0 is done.                                                                                            |
| `1.0-beta`                   | The release branch for 1.0. Each merge into it can publish a `1.0.0-beta.N` prerelease under the npm `beta` tag, so early adopters can `npm install dcmjs@beta`. |
| `release/1.0-beta-<package>` | One staging branch per package — `release/1.0-beta-core`, `release/1.0-beta-fhir`, and so on. Work accumulates here in small steps.                              |
| `release/0.5x`               | Maintenance line for the 0.52 series, for critical fixes after 1.0 ships. Created when first needed.                                                             |

This supersedes the earlier plan's `development` / `release/1.0` naming.

## 5. How a package gets in: the staging protocol

Each package travels the same road:

```
small PRs  ──▶  release/1.0-beta-<package>  ──▶  1.0-beta  ──▶  (at GA)  master
   step by step review              one reviewed merge per package
```

**Small PRs into a staging branch.** Each one needs:

-   Green automated checks (tests on Node 22 and 24, lint, formatting, audit).
-   A conventional-commit title (for example `fix: honor buffer offsets when
reading pooled Node buffers`). The release tooling reads these titles to
    compute version numbers, so they are load-bearing.
-   A short plain-language description: two to four sentences saying what
    changed and why.
-   A budget of roughly 500 hand-written changed lines. Pure file moves
    (`git mv` with no edits) are exempt but must be declared as moves in the
    description, and must sit in their own commits so reviewers and history
    tools can follow the rename.
-   Review: the author may self-merge pure moves and mechanical rewiring.
    Anything that changes behavior or public API needs a second set of eyes.

**One merge per package into `1.0-beta`.** When a staging branch is
complete, a single pull request merges it into `1.0-beta`. This is the PR a
maintainer reviews as "the package," and it carries the full description
package defined by the PR template: a plain-language summary, a worked code
example, links to API documentation, test evidence (suite names, counts,
and a link to the passing CI run), benchmark results on supported Node
versions, a list of breaking changes, and citations for any test files
used. It merges as a merge commit — not a squash — because the release
tooling needs to see the individual conventional commits.

**Keeping staging branches current.** After each package lands in
`1.0-beta`, the remaining staging branches merge `1.0-beta` into
themselves. They are never rebased: rebasing rewrites history that open PRs
point at, which strands reviewers.

## 6. The landing order

The packages land in dependency order — a package does not merge before
the packages it depends on:

| Step | What lands                                                                                                                                                                                    | Why this position                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | This document, plus a trivial "smoke test" PR                                                                                                                                                 | Proves the review pipeline itself works: checks run and report on PRs into `1.0-beta`. PR #512 never had a green check; the first thing to verify is that this repository's checks fire correctly here. |
| 1    | Process documents: PR template, writing style guide, data citation file, release tooling configuration                                                                                        | Sets the standards everything after must meet.                                                                                                                                                          |
| 2    | `@dcmjs-org/fixtures`                                                                                                                                                                             | Test files move first, each gaining a documented origin and license, because every later package's tests load them.                                                                                     |
| 3    | `@dcmjs-org/schemas`                                                                                                                                                                              | Nearly self-contained; nothing else in `src/` imports it.                                                                                                                                               |
| 4    | Green regression tests onto `release/1.0-beta-core`                                                                                                                                           | The subset of the rewrite's test bank that already passes against today's code lands first, as safety netting before anything moves — see section 7.                                                    |
| 5    | The 33 review findings, fixed one PR each, then the engine packages (`@dcmjs-org/core`, `@dcmjs-org/legacy`, `@dcmjs-org/parser`, `@dcmjs-org/generator`), each code slice arriving with its tests            | The heart of the release. The four engines migrate together on one staging branch and split into package folders at the end (see the staging note in section 3).                                        |
| 6    | `@dcmjs-org/dicomdir`, `@dcmjs-org/pdfs`, `@dcmjs-org/video`, then the `@dcmjs-org/media` bundle over them; `@dcmjs-org/fhir` (FHIR provides additional JSON schema to support and extend DicomWeb functionality) | Independent of each other once the engines exist; can proceed in parallel. The media bundle lands after its three constituents.                                                                         |
| 7    | The `@dcmjs-org/dcmjs` wrapper                                                                                                                                                                    | Reproduces the 0.52 surface from legacy + core; includes a bundle-size check against 0.52 to demonstrate the growth is gone.                                                                            |
| 8    | `@dcmjs-org/tests`, `@dcmjs-org/validator` scaffold                                                                                                                                                   | Cross-package suites and the placeholder for future validation work.                                                                                                                                    |

## 7. Tests travel with code, green tests lead

The engine migration keeps the staging branch green the whole way, in two
moves.

First, the part of the rewrite's test bank that already passes against
today's code — several hundred regression tests, mostly pinning fixed
issues — lands ahead of everything, as safety netting. If a later change
breaks 0.52 behavior that was supposed to survive, these tests catch it
immediately.

Second, every piece of code that moves over arrives in the same pull
request as the tests that cover it, green on arrival. A reviewer sees
behavior and proof together, and the branch never carries a deliberately
failing test. (An earlier draft of this document proposed landing the
whole bank first with failing tests marked "pending"; discussion
simplified this to the tests-with-code approach described here.)

## 8. Routing the 33 review findings

The [review map][review-map] from PR #512 lists 33 findings: 12 that can
lose or corrupt data, 19 that produce wrong results, and 2 minor ones.
They are routed as follows:

-   Each finding is fixed in its own small PR on `release/1.0-beta-core`,
    with a regression test beside it, **before** the file moves. Fixing
    before moving keeps each diff on the file paths the review map cites.
-   Findings whose defective code also exists on `master` (0.52) are
    additionally fixed on `master` in small hotfix PRs. Those publish 0.52.x
    patch releases through the existing pipeline, so current users get the
    fixes without waiting for 1.0.
-   Two findings live inside the lazy-reader code that 1.0 removes entirely;
    removal retires them.
-   Two findings are behavior improvements to keep (they move dcmjs closer to
    the DICOM standard); they are documented as intentional changes with
    opt-in compatibility filters, per the review map's own analysis.

A checklist issue tracks all 33 with three columns: finding, fixing PR,
and whether it applies to `master`.

## 9. How publishing works

All packages release together with one shared version number
(`1.0.0-beta.1`, `1.0.0-beta.2`, …). Releasing them in lockstep means
there is never a question of which combination of package versions works
together — a given beta number is one consistent set.

The mechanics, for those who want them:

-   The repository keeps using **semantic-release**, the tool already agreed
    on and already wired into `.github/workflows/publish-package.yml`. It
    reads the conventional-commit titles since the last release and computes
    the next version number.
-   A small script (`scripts/stamp-workspace-versions.mjs`) writes that
    computed version into every publishable package's `package.json`, and
    `pnpm -r publish --tag beta` publishes them all in one pass. pnpm skips
    the private packages automatically and rewrites the internal
    `workspace:*` references between packages into the exact stamped version,
    so the published packages point at each other correctly.
-   One git tag per release (`v1.0.0-beta.N`), never per-package tags — the
    version calculator keys off the last tag, and multiple tag families would
    confuse it.
-   The `.releaserc.json` in Appendix A tells semantic-release that
    `1.0-beta` is a prerelease branch publishing to the npm `beta` channel.
    The `prerelease: "beta"` entry is required, not decorative: the branch
    name itself is not a valid prerelease identifier, and without the entry
    the tool refuses to start.
-   **The first release needs a breaking-change commit.** The last tag on
    this lineage is `v0.52.0`, and semantic-release computes the next
    version from the commit types since that tag: a `feat:` commit alone
    yields `0.53.0-beta.1`, a `fix:` alone yields `0.52.1-beta.1`. For the
    first beta to be `1.0.0-beta.1`, the release that triggers it must
    include at least one commit with a `BREAKING CHANGE:` footer (or a
    `feat!:` title). The first package merge into `1.0-beta` carries that
    footer — which is also simply true: 1.0 is the major release. Before
    flipping the publish switch, confirm the computed version with
    `npx semantic-release --dry-run` on `1.0-beta`.

Two points from review discussion, adopted here:

-   The publishing configuration lands early — it is in the very next PR
    after this one (#519) — because getting the beta channel working is a
    top priority. That said, the **first actual publish does not have to
    happen early**: the configuration can sit gated behind the `publish`
    environment while packages move around, and the team flips the switch
    when the layout feels ready.
-   During the beta, the wrapper package publishes under the scoped name
    `@dcmjs-org/dcmjs` rather than touching the real `dcmjs` name. A project
    that wants to try 1.0 changes only its import label; every project
    that does nothing keeps getting 0.52 from npm exactly as before. The
    unscoped `dcmjs` name starts publishing 1.0 builds only when the team
    decides it is ready. Until the wrapper package exists (step 7 of the
    landing order), the repository's root `package.json` — which carries
    the unscoped `dcmjs` name — is marked `"private": true` on this
    lineage, so a recursive publish cannot ship the unscoped name by
    accident. The wrapper PR removes that flag when it renames the root
    surface to `@dcmjs-org/dcmjs`.

## 10. Finishing: general availability

When the package set is complete and the beta has had time in the field, a
single merge-commit PR takes `1.0-beta` into `master`. The publish
pipeline on `master` then releases `1.0.0` to npm `latest` for every
public package.

After GA, the 0.5x line winds down on the schedule from the earlier plan:
a `release/0.5x` branch for critical fixes, a deprecation notice in the
0.x README, an in-code warning shipped as 0.52.1, and `npm deprecate` on
the pre-1.0 range. The stale npm dist-tags (`vNext`, `dev`) get cleaned up
at the same time.

One deliberate manual step: dist-tag management beyond the publish itself
is not automated. The publish command tags each release with its channel
(`beta` from `1.0-beta`, `latest` from `master`), but promoting an
existing version to a different channel — and deleting the stale `vNext`
and `dev` tags — is done by hand with `npm dist-tag`. The config's
`npmPublish: false` means semantic-release's own `addChannel` step is a
no-op; wiring an `addChannelCmd` is deferred until there is a real
promotion to perform.

## 11. Deliberately deferred

Named here so their absence is a decision, not an oversight:

-   **Jest modernization.** The test runner setup (one root configuration,
    packages running with `--rootDir ../..`) works and stays. Migrating to
    per-package configurations waits until after GA.
-   **Publishing `@dcmjs-org/fixtures`.** Private for now; shipping ~10 MB of
    binary test files to npm helps no runtime user. Flipping it later is a
    one-line change.
-   **The validator.** Scaffold only. Real validation work gets its own
    design discussion (it is "slice H" in the rewrite's planning documents).
-   **Per-package version numbers.** Lockstep now; revisit after GA if
    packages start moving at genuinely different speeds.

## 12. Actions needed from the repository owner

1. Branch protection on `1.0-beta` (require PRs and green checks).
2. Add `1.0-beta` to the allowed branches of the `publish` GitHub
   environment, so the publish workflow may run from it.
3. Register the `@dcmjs-org` npm organization, if it is not registered
   already, and confirm the npm token in repository secrets can publish new
   packages under the `@dcmjs-org` scope (section 3).
4. Clean up the stale npm dist-tags when convenient (section 10).

---

## Appendix A — `.releaserc.json`

```json
{
    "branches": [
        { "name": "release/0.5x", "range": "0.x" },
        "master",
        { "name": "1.0-beta", "prerelease": "beta", "channel": "beta" }
    ],
    "plugins": [
        "@semantic-release/commit-analyzer",
        "@semantic-release/release-notes-generator",
        ["@semantic-release/npm", { "npmPublish": false }],
        [
            "@semantic-release/exec",
            {
                "prepareCmd": "node scripts/stamp-workspace-versions.mjs ${nextRelease.version}",
                "publishCmd": "pnpm -r publish --tag ${nextRelease.channel || 'latest'} --access public --no-git-checks"
            }
        ],
        "@semantic-release/github"
    ]
}
```

## Appendix B — publish workflow trigger

```yaml
on:
    push:
        branches:
            - master
            - 1.0-beta
            - release/0.5x
```

The publish step also needs `NODE_AUTH_TOKEN` set alongside the existing
`NPM_TOKEN`, because the recursive pnpm publish reads its credentials from
the `.npmrc` that the Node setup action writes.

## Appendix C — version stamp script, sketch

About forty lines: read the version from `process.argv[2]`, glob the root
and `packages/*/package.json`, skip any file with `"private": true`, write
the version field, done. Ships with tests in the step-1 PR.
