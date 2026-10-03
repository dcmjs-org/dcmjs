# @dcmjs-org/validator

Scaffold only — no working code exists yet.

This is the future home of dataset validation against `@dcmjs-org/schemas`.
The design discussion is deliberately deferred: it is "slice H" in the
rewrite's planning documents, per RELEASE_PLAN.md section 11. This package
stays private ("No, until it is real" in the plan's publish column) and ships
nothing until that work actually happens.

The one source file, `src/index.js`, exports a `validate()` that throws
"not implemented". That is a deliberate decision: the package resolves by
name today so the workspace layout is settled, but nothing can silently
depend on validation existing before it does.
