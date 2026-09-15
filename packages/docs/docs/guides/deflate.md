---
title: Deflated Transfer Syntax
---

The Deflated Explicit VR Little Endian transfer syntax
(`1.2.840.10008.1.2.1.99`) stores a Part 10 file whose dataset is compressed
with raw deflate (RFC 1951). Per PS3.10 A.5 only the dataset after the file
meta group is deflated -- the 128-byte preamble, the `DICM` marker, and the
meta group itself are always uncompressed.

dcmjs 1.0 reads and writes this syntax transparently using
[pako](https://github.com/nodeca/pako).

## Reading deflated files

Nothing special is required -- `DicomMessage.readFile` detects the transfer
syntax from the meta group and inflates automatically:

```js
const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
dicomData.meta["00020010"].Value; // ["1.2.840.10008.1.2.1.99"]
dicomData.dict["00080060"].Value; // values read from the inflated body
```

On the default [lazy core](../architecture/lazy-core.md) the tokenizer is
handed a pako-backed inflater: it returns the original header bytes followed
by the inflated dataset, and all body element offsets index into that
header-plus-inflated buffer. On the eager escape-hatch core
(`core: "eager"`), the body is wrapped in a `DeflatedReadBufferStream` that
inflates with `pako.inflateRaw` before the read loop runs. Either way the
inflation is eager -- deflate is a stream-level wrapper, so there is no way to
inflate a single element on demand.

## Writing deflated files (new in 1.0)

`DicomDict.write` now actually deflates when the meta TransferSyntaxUID is
`1.2.840.10008.1.2.1.99`: the preamble, `DICM`, and meta group are written
uncompressed, the body is produced as Explicit VR Little Endian (the body
encoding the deflated syntax implies) into a scratch stream, and appended as a
raw deflate stream (`pako.deflateRaw`, the mirror of the read side's
`inflateRaw`).

:::warning The 0.x bug, now fixed
In dcmjs 0.x, `DicomDict.write` ignored the deflated transfer syntax: a dict
whose meta declared `1.2.840.10008.1.2.1.99` was written with an
*uncompressed* body under a deflated TSUID, silently producing files that
conforming readers reject or misparse. 1.0 fixes this -- the declared syntax
and the bytes now agree. If you carried a 0.x workaround (rewriting the TSUID
to `1.2.840.10008.1.2.1` before writing), you can drop it. See
[Migrating from 0.x](../migration/from-0x.md).
:::

The written output is verified against the published `dicom-parser` package
and round-trips with both read cores.

## Converting to and from deflated

Conversion is just a meta edit -- the body encoding is Explicit VR Little
Endian on both sides, only the stream-level wrapper changes:

```js
const { DicomMessage } = dcmjs.data;

// compress: ELE -> deflated
const dicomData = DicomMessage.readFile(eleArrayBuffer);
dicomData.meta["00020010"].Value = ["1.2.840.10008.1.2.1.99"];
const deflatedBuffer = dicomData.write();

// decompress: deflated -> ELE
const deflated = DicomMessage.readFile(deflatedBuffer);
deflated.meta["00020010"].Value = ["1.2.840.10008.1.2.1"];
const plainBuffer = deflated.write();
```

## Passthrough composes across the deflate wrapper

The 1.0 [writer's](../architecture/writer.md) byte-faithful passthrough
compares *body* syntaxes, treating the deflated syntax as Explicit VR Little
Endian in a deflate wrapper. A deflated source's element spans already index
the inflated body buffer, and `DicomDict.write` hands the writer the
pre-deflate body stream -- so untouched elements are emitted verbatim in every
combination:

| Source | Target | Passthrough destination |
| --- | --- | --- |
| deflated | deflated | inflated-source spans into the pre-deflate stream |
| ELE | deflated | source spans into the pre-deflate stream |
| deflated | ELE | inflated-source spans into the output stream |

Each combination is asserted as body byte-identity in the test suite
(`test/write-deflate.test.js`): inflating the written body reproduces the
inflated source body byte for byte (subject to the
[charset gate](./character-sets.md#interplay-with-the-passthrough-writer)).
Edited elements are re-encoded into the pre-deflate stream and everything else
still passes through.

:::note
The output *file* of a deflated target is not guaranteed byte-identical to a
deflated source even with full passthrough: deflate wrapper bytes depend on
the encoder. The byte-faithfulness guarantee applies to the pre-deflate
(inflated) body.
:::
