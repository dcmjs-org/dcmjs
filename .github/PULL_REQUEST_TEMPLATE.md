<!--
Write for a motivated reader who may not know programming, radiology, or
imaging jargon. Define terms on first use; one good metaphor beats a
formal definition. See docs/WRITING_STYLE.md before writing.

Small PRs into a staging branch need the first section and the checklist.
The one merge per package into 1.0-beta needs every section.
See RELEASE_PLAN.md, section 5.
-->

## What this changes

<!-- Two to four plain sentences: what changed, and why. -->

## The idea, in plain terms

<!-- One concept, one metaphor. Required for package merges into
1.0-beta; optional for small staging PRs. -->

## Try it

<!-- A runnable code example with its expected output. -->

```js

```

## API

<!-- Link to the documentation page, or list the public functions this
adds or changes with one sentence each. -->

## Evidence

<!--
Tests: the exact command, the pass/fail counts, and a link to the green
CI run.
Benchmarks (when performance is claimed): the table, the Node version,
and the hardware it ran on.
-->

## Breaking changes

<!-- Each behavior change a current user could notice, or "None." -->

## Fixtures used

<!-- A DATACITATION.md link for every DICOM test file this PR adds or
relies on, or "None." No fixture lands without a citation row. -->

## Checklist

-   [ ] CI is green (tests on Node 22 and 24, lint, format, audit)
-   [ ] The title is a conventional commit (`feat:`, `fix:`, `docs:`, …)
-   [ ] Pure file moves are in their own commits and declared above
-   [ ] The prose follows docs/WRITING_STYLE.md
