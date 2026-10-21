# @dcmjs-org/video

MP4-to-DICOM video encapsulation for dcmjs (Supplement 225). The package
reads the MP4 header without a decode, and puts the H.264 stream of the MP4
into a Video Photographic Image instance. The stream goes into the pixel data
fragments without a change, so the round trip is byte-identical.

-   `parseMp4Info(bytes | reader)` (async) — the geometry, the timing, and
    the transfer syntax of an MP4, without a decode.
-   `buildVideoDataset(mp4Info, options)` (sync) — the dataset without
    `PixelData`. It calls `createInstance` from `@dcmjs-org/core`, then sets
    the stream attributes.
-   `encapsulateVideo(mp4Bytes, options)` (async) — the buffered path. It
    returns a `Promise` of the dataset with `PixelData` as fragments.
-   `createVideoEventSource(input, options)` (async) — the streaming path.
    It returns a `Promise` of `{ run, info, dataset }`:
    -   `run(listener)` emits the dataset and the fragments as events, with
        one fragment in memory at a time. It returns a `Promise`.
    -   `info` is the `parseMp4Info` result.
    -   `dataset` is the `buildVideoDataset` result, without `PixelData`.
-   `extractEncapsulatedVideo(dataset)` — gets the MP4 stream back from a
    naturalized video instance.
-   `videoBase` and `videoPhotographicBase` — the default base blocks.

The functions that read an MP4 are async, because `parseMp4Info` accepts a
random-access reader. `input` of `createVideoEventSource` is MP4 bytes or
such a reader.

The codec-free image builder (`buildImageDataset`) and the JPEG and H.264
header inspection are in `@dcmjs-org/imaging`.

## Options

The options of `buildVideoDataset`, `encapsulateVideo`, and
`createVideoEventSource` follow CORE-USR-1 in `packages/core/README.md`: the
`createInstance` controls, `overrides`, and these control keys. All of
them are options. `overrides` is a naturalized DICOM provider with the
forms of `baseDicom`, and holds only DICOM attributes. A control key never
goes in `overrides`. An extra option key has no effect (CORE-USR-7).

-   `baseDicom` (default `videoBase`) — base blocks. `videoBase` has no
    `predecessorBase`, so `predecessor: true` needs a custom base
    (VID-USR-8).
-   `fragmentBytes` (default 256 MiB) — the size of each `PixelData`
    fragment. `buildVideoDataset` ignores it.

```js
const video = await encapsulateVideo(mp4Bytes, {
    instance: priorInstanceInSeries,
    dataLevel: "series",
    overrides: { SeriesDescription: "Endoscopy" }
});
```

## Scope and change rule

The shared requirements of `createInstance` (CORE-USR-n, CORE-IMP-n in
`packages/core/README.md`) apply to the video builders. This README lists
only the requirements of this package.

The change rule of the core README applies. Change a user requirement
(VID-USR-n) only when it describes the behaviour wrongly, or when the
intended user-facing behaviour changes, and name the change in the pull
request. The implementation requirements (VID-IMP-n) describe the current
approach, and can change freely. Do not renumber an identifier.

## § User requirements

-   **VID-USR-1** `instance` is where the new video goes (CORE-USR-3). The
    default levels do not copy the identity of `instance` (CORE-USR-4).
    Without a `SOPClassUID` override, and without a custom `levels` that
    lists `SOPClassUID`, `videoBase` sets the Video Photographic Image
    `SOPClassUID`.
-   **VID-USR-2** The stream attributes come from the MP4: `CineRate`,
    `FrameTime`, `NumberOfFrames`, `Rows`, `Columns`,
    `EncapsulatedPixelDataValueTotalLength (7FE0,0003)`, and
    `_meta.TransferSyntaxUID`. `buildVideoDataset` sets them after
    `createInstance`, and replaces an override of them with no warning.
    This rule applies to each form of `overrides`. A field that `mp4Info`
    does not give writes no attribute, so the value of the base, of
    `instance`, or of `overrides` stays. The `_meta` rule of CORE-USR-13
    applies: the builder always sets `_meta.TransferSyntaxUID`, and keeps
    the other `_meta` keys. `encapsulateVideo` and `createVideoEventSource`
    set `PixelData` from the stream. `createVideoEventSource` does not
    change the `_meta` of the dataset that it returns. It makes the file
    meta group of its events in a separate object. The file meta group
    gets each key of the dataset `_meta`, for example
    `ImplementationVersionName`. `createVideoEventSource` always sets
    `TransferSyntaxUID`, `MediaStorageSOPClassUID`, and
    `MediaStorageSOPInstanceUID` from the dataset. It sets
    `FileMetaInformationVersion`, `ImplementationClassUID`, and
    `ImplementationVersionName` only when the dataset `_meta` has no value.
    Thus a caller can set these three keys and other file meta keys in
    `overrides._meta`.
-   **VID-USR-3** A caller can set in `overrides` the Image Pixel values
    that the MPEG-4 AVC transfer syntaxes mandate (`SamplesPerPixel`,
    `PhotometricInterpretation`, `PlanarConfiguration`, `BitsAllocated`,
    `BitsStored`, `HighBit`, `PixelRepresentation`), and
    `LossyImageCompression`. The builder permits this on purpose. A
    conformant reader uses the values of the codec stream, and these values
    take precedence over the dataset values.
-   **VID-USR-4** An MP4 with a codec that no DICOM video transfer syntax
    carries throws an error. The error gives an `ffmpeg` command that makes a
    supported stream (H.264 Baseline, Main, or High, up to Level 4.2).
-   **VID-USR-5** `fragmentBytes` is an even integer from 2 to 2^32-2. Each
    other value throws an error.
-   **VID-USR-6** `extractEncapsulatedVideo` returns the stream that was
    encapsulated, byte for byte. It removes the pad byte of an odd-length
    last fragment through the declared total length. A dataset that is not
    a video throws an error. A video dataset has the Video Photographic
    Image `SOPClassUID` or a video transfer syntax, and has `PixelData`.
-   **VID-USR-7** `parseMp4Info`, and thus `encapsulateVideo` and
    `createVideoEventSource`, throw an error for an MP4 that they cannot
    read (CORE-IMP-11): no `ftyp` box first, a malformed box, no `moov`
    box, no video track, a video track without `mdhd` or a sample
    description, a malformed `stts` box, or no frame rate.
-   **VID-USR-8** `videoBase` does not include `predecessorBase`
    (CORE-USR-9). With the default base, `predecessor: true` has no effect:
    the result has no `PredecessorDocumentsSequence`, and the builder throws
    no predecessor error. For a predecessor, give
    `baseDicom: combineBases(videoBase, predecessorBase)`, with
    `predecessorBase` from `@dcmjs-org/core`.

## § Implementation requirements

-   **VID-IMP-1** `videoBase` is `defaultInstanceBase`,
    `videoPhotographicBase` (SOP class, Modality `XC`, the Image Pixel values
    of VID-USR-3, `LossyImageCompression` `"01"`) (CORE-IMP-3). `videoBase`
    has no `predecessorBase` (VID-USR-8).
-   **VID-IMP-2** `buildVideoDataset` removes its control key `fragmentBytes`
    before it calls `createInstance` (CORE-IMP-9), and passes `overrides`
    and `postProcess` through.
-   **VID-IMP-3** `EncapsulatedPixelDataValueTotalLength` is a BigInt,
    because VR UV is a 64-bit unsigned integer.
-   **VID-IMP-4** `extractEncapsulatedVideo` keeps all of the bytes when the
    dataset has no total length, and returns `declaredLength: null`, so the
    caller can choose a warning.

## Dependencies

The package builds on `@dcmjs-org/core`, `@dcmjs-org/imaging` (the shared
`h264TransferSyntaxUID` map), and `@dcmjs-org/parser`.
