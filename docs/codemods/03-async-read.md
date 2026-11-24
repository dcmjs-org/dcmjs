# CM-3: read Part 10 directly to a naturalized dataset

Phase 2. Partly automatic. Apply after [CM-2](02-naturalized-values.md)
passes.

The 0.x read is two steps: `DicomMessage.readFile` decodes the whole buffer to
a tag-keyed dict, and `naturalizeDataset` converts the dict. The event stream
of `@dcmjs/dcmjs/eventStream` does one step. It gives the naturalized dataset
directly, and it reads a file in chunks, so it can read a file larger than
memory.

Both paths give the same naturalized dataset (NAT-U-PROD-1), except for the
known differences in the Review section. The code that uses the dataset after
CM-2 does not change.

## Detect

1. `DicomMessage.readFile(buffer, options)`, followed by
   `naturalizeDataset(dicomDict.dict)`, and often by
   `naturalizeDataset(dicomDict.meta)`.
2. `new AsyncDicomReader()`, `reader.stream.setData(buffer)`,
   `await reader.readFile()`, followed by `naturalizeDataset(reader.dict)`.
3. A buffer that the code makes only for the read:
   `fs.readFileSync(path)`, `await fs.promises.readFile(path)`,
   `await response.arrayBuffer()`, `await blob.arrayBuffer()`.

Do not change:

-   A read that uses the tag-keyed dict and does not naturalize it. Leave it on
    `readFile`, or use `toDataSet()` (same `{ meta, dict }` shape).
-   `naturalizeDataset(json)` on DICOM JSON that is already in memory. The call
    is synchronous and correct in 1.0. See "DICOM JSON" in the Review section.

## Transform

Import the facade from the subpath:

```js
import {
    DicomEventStream,
    NaturalizedListener
} from "@dcmjs/dcmjs/eventStream";
```

**A buffer that is already in memory.**

```diff
-const dicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
-const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
+const dataset = await DicomEventStream.fromPart10(arrayBuffer).toNaturalized();
```

**The file meta information too.** `toNaturalized()` gives no `_meta`. Use
the listener, which keeps the naturalized file meta information in `meta`:

```diff
-const dicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
-const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
-const meta = DicomMetaDictionary.naturalizeDataset(dicomDict.meta);
+const listener = await DicomEventStream.fromPart10(arrayBuffer).process(new NaturalizedListener());
+const dataset = listener.result;
+const meta = listener.meta;
```

**A file or a response: read the stream, not a buffer.**

```diff
-const bytes = fs.readFileSync(path);
-const dicomDict = dcmjs.data.DicomMessage.readFile(bytes.buffer);
-const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
+const dataset = await DicomEventStream.fromPart10Stream(fs.createReadStream(path)).toNaturalized();
```

```diff
-const dicomDict = DicomMessage.readFile(await response.arrayBuffer());
-const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
+const dataset = await DicomEventStream.fromPart10Stream(response.body).toNaturalized();
```

`fromPart10Stream` accepts an `ArrayBuffer`, a `Uint8Array`, a Node read
stream, a WHATWG `ReadableStream` and an async iterable. A stream source is
single-use: a second `process()` or `to...()` call rejects. A buffer source
can run again.

**The read options.**

| `readFile` option                  | Event stream                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ignoreErrors`                     | Same name, on `fromPart10` and `fromPart10Stream`                                                                                               |
| `forceStoreRaw`                    | Same name                                                                                                                                       |
| `allowMissingHeader`               | Same name                                                                                                                                       |
| `noCopy`                           | Not accepted. Use `toNaturalized({ binaryAs: "Uint8Array" })` to get binary values with no copy (NAT-U-BIN-3)                                   |
| `untilTag`, `includeUntilTagValue` | Not accepted. Keep `readFile`, or use `asyncIterable()` and `break` at the tag ([EXAMPLES.md](../../EXAMPLES.md), "Pull events and stop early") |

## Review

-   **The call becomes asynchronous.** Each function that changes from
    `readFile` to the event stream returns a `Promise`. Make each caller
    `async`, and `await` the result, up to a caller that is already
    asynchronous. A tool can find the callers. A person decides where the
    chain stops, for example in a synchronous constructor or a getter.
-   **Error timing.** `readFile` throws inside the call. The event stream
    rejects the `Promise`. A `try`/`catch` around the call works only with
    `await` inside the `try`.
-   **Encapsulated pixel data.** For a file with no Basic Offset Table,
    `fromPart10` and `fromPart10Stream` give one entry for each fragment, and
    `readFile` gives one entry for each frame. Code that reads
    `dataset.PixelData[frameIndex]` of a compressed file must keep `readFile`,
    or must map the fragments to frames. See "Known differences" in
    [specs/naturalized-dataset.md](../specs/naturalized-dataset.md).
-   **IS and DS precision.** `NaturalizedListener` keeps the source string of
    an IS or DS value that a JavaScript number cannot hold exactly. The value
    can be a string where `readFile` gives a number. Use `Number(...)` where the
    code needs a number.
-   **Cardinality.** `NaturalizedListener` applies its
    `cardinalityViolationPolicy` to a single-value attribute that has more than
    one value. `naturalizeDataset` keeps the list and does not warn.
-   **DICOM JSON.** `naturalizeDataset(json)` keeps `{ InlineBinary }`.
    `fromDicomWebJson(json).toNaturalized()` decodes the base64 to a list of one
    fragment. Change a DICOM JSON read only when the code decodes the
    `InlineBinary` itself after the read.
-   **Bundles and jest.** The subpath is ES modules only. See the jest
    configuration in [CM-1](01-package-name.md).

## Verify

-   For each Part 10 fixture of the project, compare the old read and the new
    read. A test can do the compare with `deepEqual` of `@dcmjs/core`. A
    difference must match an item of the Review section.
-   For a large file, measure the peak memory of the new read. The memory must
    stay near the size of the largest element, not the size of the file.
