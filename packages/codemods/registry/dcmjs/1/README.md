# dcmjs 1.0 migration

Runs the dcmjs 1.0 migration codemods in the recommended order. They do the
mechanical part of the upgrade from dcmjs 0.x, and they report each site that
needs a person. They write no comment into your code.
[MIGRATION.md](https://github.com/dcmjs-org/dcmjs/blob/main/docs/MIGRATION.md)
explains each change.

## Usage

Start from a clean branch.

```sh
npx codemod @dcmjs-org/dcmjs-1
```

To preview the changes before the codemods write files:

```sh
npx codemod @dcmjs-org/dcmjs-1 --dry-run
```

Then install, run your formatter, your linter and your tests, and work
through the report.

## The report

At the end of the run the tool prints two metrics. Each entry names a rule, a
file and a line.

-   `dcmjs-1-manual`: a site that the codemods did not change. The rule says
    what to do, for example
    `WindowCenter: a list VM keeps the list for one value, take the first value`.
-   `dcmjs-1-review`: a site where 1.0 changes what the code does, and where a
    person must decide. The most important rule is
    `denaturalizeDataset: private elements are kept`. dcmjs 0.x dropped the
    private elements on a round trip, and 1.0 keeps them. Check each write
    path that must not write private data.

## Included migrations

In the order in which they run:

1. `@dcmjs-org/dcmjs-1-package-name`: the dependency in `package.json`, and
   the module name `dcmjs` in imports, requires and mocks.
2. `@dcmjs-org/dcmjs-1-naturalized-values`: the code that depends on the
   0.x shapes of naturalized values: a sequence with one item, a single
   person name, a list VM with one value, private elements, and the
   workarounds that 1.0 makes unnecessary.

Each package has a README with what it changes, what it reports, and what it
cannot find.

## Optional: the event stream

`@dcmjs-org/dcmjs-1-event-stream` replaces `DicomMessage.readFile` with
`naturalizeDataset`, and `DicomDict.write` with `denaturalizeDataset`, by
the event stream of `@dcmjs-org/dcmjs/eventStream`. This migration does not
run here. Run it after the tests pass on 1.0:

```sh
npx codemod @dcmjs-org/dcmjs-1-event-stream --dry-run
```

## Publishing

Publish the child packages before this aggregate package. The workflow
resolves them from the Codemod registry at runtime.
