---
title: Character Sets
---

DICOM string attributes are encoded with the character repertoire declared in
SpecificCharacterSet (0008,0005). dcmjs decodes them with the platform
`TextDecoder` and normalizes everything to UTF-8 in memory, so application
code only ever sees JavaScript strings.

## Supported encodings

(0008,0005) values are normalized (`_` and space become `-`, lowercased) and
looked up in `dcmjs.constants.encodingMapping`, which maps DICOM defined terms
to `TextDecoder` encoding labels. Supported sets include:

| DICOM defined term | Decoded as |
| --- | --- |
| (absent or empty), `ISO_IR 6`, `ISO 2022 IR 6` | `iso-8859-1` (default repertoire) |
| `ISO_IR 100` / `ISO 2022 IR 100` | `latin1` |
| `ISO_IR 101`, `109`, `110` (and ISO 2022 forms) | `iso-8859-2/3/4` |
| `ISO_IR 126`, `127`, `138`, `144`, `148` (and ISO 2022 forms) | Greek, Arabic, Hebrew, Cyrillic, Turkish |
| `ISO_IR 13` / `ISO 2022 IR 13` | `shift-jis` |
| `ISO 2022 IR 87`, `ISO 2022 IR 159` | `iso-2022-jp` |
| `ISO 2022 IR 149` | `euc-kr` |
| `ISO_IR 166` / `ISO 2022 IR 166` | `tis-620` (Thai) |
| `ISO 2022 IR 58` | `gb2312` |
| `GB18030`, `GBK`, `ISO 2022 GBK`, `ISO 2022 58` | Chinese |
| `ISO_IR 192` | `utf-8` |

Elements read before any charset is resolved use a shared latin1 decoder,
matching the DICOM default repertoire byte-for-byte.

## Normalize-on-read to ISO_IR 192

dcmjs deliberately rewrites the stored SpecificCharacterSet on read:

- string values are decoded with the declared charset and kept as (UTF-16)
  JavaScript strings;
- the (0008,0005) entry's `Value` is rewritten to `["ISO_IR 192"]`;
- the entry's `_rawValue` preserves the original declared value;
- on write, strings are encoded as UTF-8, so the output file is consistent
  with the rewritten declaration.

```js
const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
// file declared "ISO_IR 100"
dicomData.dict["00080005"].Value; // ["ISO_IR 192"]
dicomData.dict["00080005"]._rawValue; // ["ISO_IR 100"]
```

:::note
Whether to keep this normalize-on-read quirk (versus surfacing the original
charset explicitly, e.g. `dataset.originalCharacterSet`) is one of the open
1.0 API decisions tracked on the [roadmap](../development/roadmap.md).
:::

## Per-sequence-item charset contexts (lazy core)

DICOM allows a sequence item to carry its own (0008,0005), overriding the
dataset charset for that item. The 1.0 [lazy core](../architecture/lazy-core.md)
resolves a decoder once per dataset at wrap time and gives every sequence item
its own context: items start from the default repertoire (matching how the
0.x reader created a fresh stream per item) and an in-item (0008,0005)
resolves a per-item decoder applied to that item, with the same
`["ISO_IR 192"]` rewrite.

This exceeds the 0.x eager reader, which swapped a single stream decoder as
its read loop passed (0008,0005). One documented approximation: the lazy core
applies a charset to the whole dataset or item rather than "from this stream
position on", which is indistinguishable for conformant files where
(0008,0005) precedes all encoded strings, and diverges only on
non-conformant element ordering.

## Unsupported and multiple charsets

For a charset not in `encodingMapping`:

- `ignoreErrors: false` (default): `Error("Unsupported character set: ...")`
  is thrown;
- `ignoreErrors: true`: a warning is logged and the default repertoire is
  used.

For a multi-valued (0008,0005) (ISO 2022 code extensions): multiple charsets
are not supported; with `ignoreErrors: false` an error is thrown, with
`ignoreErrors: true` dcmjs warns and proceeds with the first charset only.

Error timing differs between cores (a documented divergence, pinned by the
hardening suite): the top-level charset is resolved when `readFile` returns on
both cores, but an unsupported charset inside a sequence item makes the eager
core throw during `readFile` (or, under `ignoreErrors`, truncate the dict at
the failing sequence), while the lazy core returns the full dict and raises
the same error at first access of the enclosing sequence entry (or, under
`ignoreErrors`, warns once and decodes the item with the default repertoire --
strictly more data recovered than the eager truncation).

## Interplay with the passthrough writer

The 1.0 [writer](../architecture/writer.md) emits untouched elements as
verbatim source bytes only when re-encoding would be byte-identical. Because
the writer always encodes strings as UTF-8, the dict-level gate
`charsetPassthroughSafe` is true only when the file's original top-level
charset is byte-stable under UTF-8 re-encoding: absent, empty, `ISO_IR 6`,
single-valued `ISO 2022 IR 6`, `ISO_IR 192`, or `UTF-8`.

Consequences today:

- **`ISO_IR 100` (and every other legacy charset) sources always re-encode.**
  A Latin-1 file with accented characters comes out as a UTF-8 file declaring
  `ISO_IR 192` -- correct, but never byte-identical to the source. A
  per-element ASCII fast path to widen this gate is planned 1.x work.
- Sequences containing an in-item (0008,0005) are always re-encoded (their
  materialization rewrites the stored value).
- The rewritten (0008,0005) entry itself carries no source span and is always
  re-encoded.
- Multi-valued charset declarations are never passthrough-safe.

See [Writing and editing](./writing-and-editing.md) for the rest of the
passthrough rules, and [Deflate](./deflate.md) for how the gate composes with
the deflate wrapper.
