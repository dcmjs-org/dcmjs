# Codemods: upgrade a project from dcmjs 0.x to 1.0

Each file in this directory describes one codemod: a code change that a
person, an AI agent, or a `jscodeshift` transform can apply to a project that
uses dcmjs 0.x. Each description gives:

-   **Detect**: the code patterns that the codemod changes.
-   **Transform**: the mechanical rewrite, with a before and an after.
-   **Review**: the cases that a tool cannot decide. A person must look at each
    one.
-   **Verify**: how to check the result.

[MIGRATION.md](../MIGRATION.md) explains each behaviour change, and
[specs/naturalized-dataset.md](../specs/naturalized-dataset.md) gives the
rules. The codemods do not restate the rules. They tell you what to change in
the code.

## Package name

dcmjs 1.0 releases as **`@dcmjs-org/dcmjs`**, and the workspace packages
release under the same scope (`@dcmjs-org/core`, `@dcmjs-org/parser`, ...).
The beta uses the same names, so a project that already uses the beta skips
CM-1 and changes only the version.

## Order

Apply the codemods in order, and run the tests of the project after each
one. Phase 1 changes as little as possible. Phase 2 is optional, and you can
apply it one call site at a time.

| ID                               | Phase | Codemod                                         | Automatic |
| -------------------------------- | ----- | ----------------------------------------------- | --------- |
| [CM-1](01-package-name.md)       | 1     | Change the package name to `@dcmjs-org/dcmjs`   | Yes       |
| [CM-2](02-naturalized-values.md) | 1     | Adapt the code to the naturalized values of 1.0 | Partly    |
| [CM-3](03-async-read.md)         | 2     | Read Part 10 directly to a naturalized dataset  | Partly    |
| [CM-4](04-async-write.md)        | 2     | Write a naturalized dataset directly to Part 10 | Partly    |

-   **Phase 1** keeps the 0.x calls (`DicomMessage.readFile`,
    `naturalizeDataset`, `denaturalizeDataset`, `DicomDict.write`). After
    phase 1 the project runs on 1.0 with the same structure.
-   **Phase 2** replaces the read, naturalize, denaturalize and write steps with
    the event stream of `@dcmjs-org/dcmjs/eventStream`. The event stream gives the
    naturalized dataset directly, reads a file larger than memory, and is
    asynchronous. Apply phase 2 only after phase 1 passes, because phase 2
    gives the same naturalized values as phase 1.

## Out of scope

The three changes for standard compliance in
[BREAKING_CHANGES.md](../BREAKING_CHANGES.md) (`uid()`, the private creator
range, the anonymizer keywords) need no code change in most projects. Read
that file if a project checks the length of a UID, reads elements
(gggg,0001-000F), or depends on the list of `cleanTags()`.
