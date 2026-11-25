# dcmjs 1.0: the event stream

Optional. Run it after `@dcmjs-org/dcmjs-1` and after the tests pass on 1.0.

The 0.x read is two steps: `DicomMessage.readFile` decodes the buffer, and
`naturalizeDataset` converts the dict. The 0.x write is three steps:
`denaturalizeDataset`, `new DicomDict`, and `write`. The event stream of
`@dcmjs-org/dcmjs/eventStream` does each one in one asynchronous call, and it
gives the same naturalized dataset.

```sh
npx codemod @dcmjs-org/dcmjs-1-event-stream --dry-run
```

## What it changes

The codemod changes a site only inside an `async` function, or at the top
level of an ES module. So no caller changes. It adds
`import { DicomEventStream, NaturalizedListener } from "@dcmjs-org/dcmjs/eventStream"`
with the names that it uses.

```diff
-const dataset = DicomMetaDictionary.naturalizeDataset(DicomMessage.readFile(buffer).dict);
+const dataset = await DicomEventStream.fromPart10(buffer).toNaturalized();
```

```diff
-const dicomDict = DicomMessage.readFile(buffer, { ignoreErrors: true });
-const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
-const meta = DicomMetaDictionary.naturalizeDataset(dicomDict.meta);
+const dicomDict = await DicomEventStream.fromPart10(buffer, { ignoreErrors: true }).process(new NaturalizedListener());
+const dataset = dicomDict.result;
+const meta = dicomDict.meta;
```

```diff
-const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
-dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
-const buffer = dicomDict.write(writeOptions);
+dataset._meta = meta;
+const buffer = await DicomEventStream.fromNaturalized(dataset).toPart10(writeOptions);
```

The statements must be adjacent, and the dict variable must have no other
use. The `readFile` options `ignoreErrors`, `forceStoreRaw` and
`allowMissingHeader` keep their meaning.

## What it reports

`dcmjs-1-manual`, a site that the codemod did not change:

-   `the function is not async`: make the function `async`, `await` it in
    each caller, and run the codemod again.
-   `the file is CommonJS`: the subpath is ES modules only.
-   `the option <name> has no event stream form`: `noCopy` (use
    `toNaturalized({ binaryAs: "Uint8Array" })`), and `untilTag` (keep
    `readFile`, or use `asyncIterable()` and `break` at the tag).
-   `<name> has other uses`: the code also uses the dict. Move that use to the
    naturalized dataset, or keep `readFile`.
-   `new DicomDict: ... not three adjacent statements`: write the code in the
    form above, or change it by hand.

`dcmjs-1-review`, at each read that the codemod changed in a file that uses
`PixelData`: for encapsulated pixel data with no Basic Offset Table, the
event stream gives one entry for each fragment, and `readFile` gives one
entry for each frame.

## What it cannot find

-   The event stream keeps the source string of an IS or DS value that a
    JavaScript number cannot hold exactly. Use `Number(...)` where the code
    needs a number.
-   `NaturalizedListener` applies its `cardinalityViolationPolicy` to a VM 1
    attribute that has more than one value.
-   `dataset._meta = meta` sets a property on the dataset of the caller. A
    spread or JSON copy of the dataset loses the deletes of private aliases,
    so set `_meta` on the dataset itself.
-   A read from a file or a response can use a stream in place of a buffer:
    `DicomEventStream.fromPart10Stream(fs.createReadStream(path))` or
    `fromPart10Stream(response.body)`. That change removes the buffer, and it
    is not mechanical.
-   `datasetToBuffer` and `datasetToBlob` build the file meta information
    themselves. They do not change.
-   After the run, the import of `DicomMessage` or `DicomDict` can be unused.
    Your linter finds it.
