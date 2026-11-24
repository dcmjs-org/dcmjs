# CM-4: write a naturalized dataset directly to Part 10

Phase 2. Partly automatic. Apply with or after [CM-3](03-async-read.md).

The 0.x write is three steps: `denaturalizeDataset` of the meta and of the
dataset, `new DicomDict(meta)`, and `dicomDict.write()`. The event stream does
one step from the naturalized dataset: `DicomEventStream.fromNaturalized(ds)`
gives events, and a writer turns the events to Part 10 bytes.

The output bytes come from the same encoder as `DicomDict.write()`. The
output is a correct Part 10 file that reads back to the same dataset. It is
not byte-identical to the input file (MIGRATION, "Writing").

## Detect

1. `new DicomDict(denaturalizeDataset(meta))`, an assignment
   `dicomDict.dict = denaturalizeDataset(dataset)`, and `dicomDict.write(...)`.
2. `datasetToBuffer(dataset)`, `datasetToBlob(dataset)` and
   `datasetToDict(dataset)` followed by `.write()`.
3. A read, an edit, and a write of the same file (a filter, a
   de-identification, a tag update), where the code holds the whole dataset
   only to write it again.

## Transform

```js
import {
    DicomEventStream,
    StreamingPart10Writer
} from "@dcmjs/dcmjs/eventStream";
```

**A naturalized dataset in memory.** Put the file meta information on
`_meta`. `fromNaturalized` writes `_meta` as the file meta group:

```diff
-const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
-dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
-const buffer = dicomDict.write();
+dataset._meta = meta;
+const buffer = await DicomEventStream.fromNaturalized(dataset).toPart10();
```

`toPart10(writeOptions)` takes the `writeOptions` of `DicomDict.write()`.

Set `_meta` on the dataset itself. A spread or JSON copy of the dataset loses
the deletes of private aliases (NAT-U-HIST-6), so a deleted private element
comes back in the output.

**A read, an edit and a write of one file.** Use a listener that edits the
events, and `StreamingPart10Writer`, so that no step holds the whole dataset.
This is a new design, not a mechanical rewrite. Use it when files can be
larger than memory. [EXAMPLES.md](../../EXAMPLES.md) ("Copy file-to-file
without holding the dataset") gives the complete code, with backpressure:

```js
const writer = new StreamingPart10Writer({
    onChunk: chunk => out.write(chunk)
});
await DicomEventStream.fromPart10Stream(fs.createReadStream(src)).process(
    writer
);
```

When the edit needs the whole dataset (for example a new value that depends
on several attributes), use CM-3 to read and the in-memory transform above to
write.

## Review

-   **The call becomes asynchronous.** As in CM-3, each caller must `await`
    the result.
-   **The file meta information.** The 0.x code often builds `meta` by hand
    (`MediaStorageSOPClassUID`, `MediaStorageSOPInstanceUID`,
    `TransferSyntaxUID`, `ImplementationClassUID`). Keep that code, and assign
    the result to `_meta`. When the dataset comes from CM-3, use
    `listener.meta`, so that the output keeps the transfer syntax of the source.
    The writer recomputes `FileMetaInformationGroupLength`.
-   **Private data.** The write keeps private elements (CM-2 step 2.5). Confirm
    that each write path removes the private data that the project must not
    write.
-   **Deflate.** When `_meta.TransferSyntaxUID` is
    `1.2.840.10008.1.2.1.99`, the body is deflated (MIGRATION, "Deflate is now
    real on write").

## Verify

-   Read each output file back with CM-3, and compare it with the dataset
    before the write. The element set and the values must be equal, and
    `PixelData` must be byte-identical.
-   For a de-identification path, check that the output holds no private
    element that the project must remove.
