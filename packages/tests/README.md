# @dcmjs-org/tests

The home for test suites that span several dcmjs packages at once —
integration and equivalence tests that have no single-package owner. This
package is private and never published.

Today those suites still live in the root `test/` tree and run under the one
root Jest configuration. The main ones:

-   `test/eventStream/streamEquivalence.test.js` — proves the streaming
    reader and the eager reader produce equivalent datasets across the
    fixture corpus.
-   The dual-path issue bank under `test/issues/` — issue-derived regression
    suites that pin each scenario on both the legacy path and the
    event-stream path.

They migrate here after GA, when the Jest setup moves to per-package
configurations — that migration is a deliberate deferral, per RELEASE_PLAN.md
section 11 ("Jest modernization").

What lives here now is a single smoke test, `test/workspaceWiring.test.js`,
which proves this package is wired into the workspace: it imports
`@dcmjs-org/core` and `@dcmjs-org/parser` by package name (through the pnpm
workspace links, not relative paths) and runs a tiny dataset through both.
