# @dcmjs-org/codemods

The migration codemods of dcmjs, in the format of the
[Codemod registry](https://docs.codemod.com/). Each package under
`registry/` is self-contained: a `codemod.yaml`, a `workflow.yaml`, the
transform in `scripts/`, the fixtures in `tests/<language>/<case>/`
(`input`, `expected`, and `metrics.json` for the reported sites), and a
README.

| Package                                                                                  | Runs                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`@dcmjs-org/dcmjs-1`](registry/dcmjs/1/README.md)                                       | The two packages below, in order                      |
| [`@dcmjs-org/dcmjs-1-package-name`](registry/dcmjs/1/package-name/README.md)             | The dependency and the module name                    |
| [`@dcmjs-org/dcmjs-1-naturalized-values`](registry/dcmjs/1/naturalized-values/README.md) | The naturalized values of 1.0                         |
| [`@dcmjs-org/dcmjs-1-event-stream`](registry/dcmjs/1/event-stream/README.md)             | Optional: the event stream for the read and the write |

## Use

```sh
npx codemod @dcmjs-org/dcmjs-1 --dry-run
```

Before the packages are published, run a package from a checkout:

```sh
npx codemod workflow run -w packages/codemods/registry/dcmjs/1/package-name -t <project>
```

## Develop

```sh
cd packages/codemods
pnpm run validate            # codemod workflow validate, then the fixtures
pnpm test                    # the fixtures only
pnpm run generate-keywords   # after a dictionary update
```

To write the expected output and `metrics.json` of a new fixture, run
`npx codemod jssg test -u -l <language> scripts/<script>.ts tests/<language>`
in the package, and read the result before you commit it.

This package is private on npm. The registry packages are published with
`npx codemod publish`, the child packages before the aggregate.
