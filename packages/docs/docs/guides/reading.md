---
title: Reading DICOM files
---

# Reading DICOM files

`DicomMessage.readFile(buffer, options)` parses a DICOM Part 10 stream and
returns a `DicomDict` with two sections, both keyed by clean uppercase
8-hex tag strings:

- `meta` - the group `0002` file meta information (the
  FileMetaInformationGroupLength element itself, `00020000`, is consumed
  during reading and never appears here);
- `dict` - the dataset body.

```js
import dcmjs from "dcmjs";
const { DicomMessage } = dcmjs.data;

const dicomDict = DicomMessage.readFile(arrayBuffer, {
    ignoreErrors: false,
    untilTag: null,
    includeUntilTagValue: false,
    noCopy: false,
    forceStoreRaw: false
});

console.log(dicomDict.meta["00020010"].Value); // transfer syntax UID
console.log(dicomDict.dict["00100010"].Value); // patient name
```

`buffer` may be an `ArrayBuffer` or a `Uint8Array` (any `ArrayBuffer`
view).

## Entry shape

Every entry has the same observable shape on both cores:

```js
{ vr, Value, _rawValue }
```

- `vr` - the value representation as a string (`"PN"`, `"SQ"`, ...);
- `Value` - the decoded, formatted value (almost always an array);
- `_rawValue` - the unformatted value as stored in the file, retained for
  raw-storing VRs (or for all VRs with `forceStoreRaw: true`).

With the default **eager** core, `Value` and `_rawValue` are plain data
properties, decoded during `readFile` through the regular VR classes.

With the **deprecated lazy** core (`core: "lazy"`), they are
non-enumerable *getters*: the element's bytes are decoded on first access
and cached. `Object.keys(entry)` still yields
`["vr", "Value", "_rawValue"]`, and `JSON.stringify` or any deep iteration
simply materializes everything it touches - the same end state as the
eager core. Lazy entries also carry non-enumerable writer-facing state
(`_sourceSpan`, `_dirty`, and friends) used by the
[passthrough writer](writing-and-editing.md); treat those as internal.

## Options reference

### `core` and the `DCMJS_CORE` environment variable

`core: "lazy" | "eager"` selects the read core per call. The default comes
from `DicomMessage.defaultCore`, which is `"eager"` unless the `DCMJS_CORE`
environment variable is set. Any other value throws
`Unknown DicomMessage.readFile core`.

```js
const eager = DicomMessage.readFile(buffer); // default: eager
const lazy = DicomMessage.readFile(buffer, { core: "lazy" }); // deprecated
```

:::caution Deprecated
The lazy core (and with it the byte-identity passthrough write path) is
**deprecated as of 2026-08-02 and scheduled for removal in the next
release** — the event-stream API delivers the strategic streaming/memory
benefits without a second buffered read engine. `core: "lazy"` /
`DCMJS_CORE=lazy` remain as an escape hatch for one release and emit a
one-time warning. See the [Lazy core](../architecture/lazy-core.md) page.
:::

### `untilTag`

Stop reading at a given element. The value must be a **clean uppercase
8-hex tag string** (for example `"00080060"`), and the stop is
*inclusive*: the `untilTag` element itself appears in the result and is
the last element read.

Matching is an exact, case-sensitive string comparison against the
canonical clean form. A value that is not its own canonical form -
lowercase hex digits (`"0008103e"` instead of `"0008103E"`), punctuated
tags (`"(0008,0060)"`), or the wrong length - **never matches**,
and the whole file is read as if `untilTag` were not given. This mirrors
the 0.x behavior exactly.

```js
const head = DicomMessage.readFile(buffer, {
    untilTag: "00080060", // Modality
    includeUntilTagValue: true
});
// head.dict contains everything up to and including 00080060;
// PixelData (7FE00010) was never read.
```

:::note
A meta-group `untilTag` (group `0002`) earlier than the TransferSyntaxUID
(`00020010`) is rejected by the lazy core with a clear error (the eager
core crashed with a `TypeError` in this case because it could not resolve
the transfer syntax). `untilTag: "00020010"` with
`includeUntilTagValue: false` delegates to the eager core to replicate its
exact historical behavior.
:::

### `includeUntilTagValue`

Only meaningful together with `untilTag`. With `true`, the `untilTag`
element is read normally. With `false` (the default), its value is not
read and the entry is a stub with eager's exact historical shape:

```js
{ vr: undefined, Value: 0, _rawValue: undefined }
```

### `ignoreErrors`

With `ignoreErrors: false` (the default), errors propagate to you - see
[Error timing](#error-timing) below for *when*. With `ignoreErrors: true`,
the reader recovers what it can:

- **Structural errors** (truncated file, malformed framing) yield a
  partial dict containing the elements read before the failure, on both
  cores.
- **Value-level errors** (an element whose stored bytes cannot be decoded,
  an unsupported character set inside a sequence item, garbage inside an
  encapsulated pixel-data fragment stream): here the lazy core
  intentionally diverges from 0.x, and is strictly more informative.
  The 0.x eager core caught the error mid-scan and returned a dict
  **truncated at the failing element** - everything at and after it was
  silently lost. The lazy core returns the **full dict**; at first access
  of the failing entry it logs one warning and resolves just that entry's
  `Value`/`_rawValue` to `undefined`. Every other element of the file
  remains available.

```js
const dicomDict = DicomMessage.readFile(buffer, { ignoreErrors: true });
// A corrupt element no longer hides the rest of the file:
dicomDict.dict["7FE00010"].Value; // undefined (+ one logged warning)
dicomDict.dict["00100010"].Value; // still readable
```

:::warning
If your 0.x code used the *absence* of tags after a corrupt element as a
corruption signal, update it: under the lazy core those tags are present
and only the broken entry resolves to `undefined`.
:::

### `noCopy`

Controls binary value ownership, as in 0.x: with `noCopy: true`, binary
values (OB/OW buffers, pixel-data fragments) come back as `Uint8Array`
views/wrappers instead of standalone `ArrayBuffer` copies, and
multi-fragment frames in encapsulated pixel data are returned as the raw
fragment list for the application to assemble. The lazy core replicates
the eager core's `noCopy` shapes exactly.

### `forceStoreRaw`

By default only raw-storing VRs keep `_rawValue`. With
`forceStoreRaw: true`, every entry retains its unformatted raw value
alongside the formatted `Value` - useful when you need to inspect exactly
what was stored (for example trailing padding or non-conformant encodings)
without giving up the formatted view.

## Error timing

The lazy core changes *when* errors surface, not *whether* they do:

- **Structural errors throw at `readFile` time.** Anything that prevents
  the tokenizer from framing the stream - missing `DICM` marker, missing
  or malformed meta group length (without `ignoreErrors`), element lengths
  overrunning the buffer - fails immediately, exactly like 0.x.
- **Value-level errors throw at first access.** An element whose *framing*
  is fine but whose *bytes* cannot be decoded (unsupported in-item
  character set, garbage tag inside encapsulated pixel data) does not
  throw during `readFile` - the value was never decoded. The
  eager-equivalent error is thrown on first access of that entry's
  `Value`/`_rawValue` (or warned-and-`undefined` under
  `ignoreErrors: true`, as above).

This is a direct consequence of laziness: work that does not happen at
read time cannot fail at read time. If you need 0.x's all-errors-up-front
behavior, either pass `core: "eager"` or force full materialization (for
example `JSON.stringify(dicomDict.dict)`) right after reading.

## The whole-file eager fallback

The tokenizer is stricter than the eager reader in a few corners: it
rejects trailing elements whose declared length overruns the buffer, it
predates the `UV`/`SV`/`OV` value representations, and it needs the
part-10 plumbing (meta group length, transfer syntax) in place. When the
tokenizer cannot parse a stream at all - or when the file's recorded meta
group length does not match the actual meta/body boundary - `readFile`
transparently **delegates the whole read to the eager core** with your
original buffer and options. The result, including any error the eager
core itself throws and any partial dict it recovers under `ignoreErrors`,
is byte-identical to what 0.x produced. The only observable difference is
that such a dict has plain data properties instead of lazy getters (and no
passthrough on write, since there are no source spans to pass through).

You do not opt into the fallback and there is no flag to detect it in
supported API; it exists so that malformed real-world files behave exactly
as they always have.

## See also

- [Lazy core architecture](../architecture/lazy-core.md) - how
  materialization works under the hood.
- [Writing and editing](writing-and-editing.md) - how lazily read entries
  interact with the byte-faithful writer.
- [Character sets](character-sets.md) - SpecificCharacterSet handling and
  the ISO_IR 192 normalize-on-read rule.
- [Migration from 0.x](../migration/from-0x.md) - the complete list of
  behavioral differences.
