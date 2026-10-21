# @dcmjs-org/video

MP4-to-DICOM video encapsulation for dcmjs (Supplement 225). The package
reads the MP4 header without a decode, and puts the H.264 stream of the MP4
into a Video Photographic Image instance. The stream goes into the pixel data
fragments without a change, so the round trip is byte-identical.

-   `parseMp4Info(bytes | reader)` — the geometry, the timing, and the
    transfer syntax of an MP4, without a decode.
-   `buildVideoDataset(mp4Info, options)` — the dataset without
    `PixelData`. It calls `createInstance` from `@dcmjs-org/core`, then sets
    the stream attributes.
-   `encapsulateVideo(mp4Bytes, options)` — the buffered path: the dataset
    plus `PixelData` as fragments.
-   `createVideoEventSource(input, options)` — the streaming path: the
    dataset and the fragments as events, with one fragment in memory at a
    time.
-   `extractEncapsulatedVideo(dataset)` — gets the MP4 stream back from a
    naturalized video instance.
-   `videoBase` and `videoPhotographicBase` — the default base blocks.

The codec-free image builder (`buildImageDataset`) and the JPEG and H.264
header inspection are in `@dcmjs-org/imaging`.

## Options

The options of `buildVideoDataset`, `encapsulateVideo`, and
`createVideoEventSource` follow CORE-USR-1 in `packages/core/README.md`: the
`createInstance` options, DICOM attribute overrides, and these control keys.

-   `baseDicom` (default `videoBase`) — base blocks.
-   `fragmentBytes` (default 256 MiB) — the size of each `PixelData`
    fragment. `buildVideoDataset` ignores it.

```js
const video = await encapsulateVideo(mp4Bytes, {
    instance: priorInstanceInSeries,
    dataLevel: "series",
    SeriesDescription: "Endoscopy"
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
    result never gets the identity of `instance` (CORE-USR-4). Without an
    override, `videoBase` sets the Video Photographic Image `SOPClassUID`.
-   **VID-USR-2** The stream attributes come from the MP4: `CineRate`,
    `FrameTime`, `NumberOfFrames`, `Rows`, `Columns`,
    `EncapsulatedPixelDataValueTotalLength (7FE0,0003)`, and
    `_meta.TransferSyntaxUID`. `buildVideoDataset` sets them after
    `createInstance`, and replaces an override of them with no warning. The
    builder replaces all of `_meta`, so an override `_meta` does not stay.
    `encapsulateVideo` and `createVideoEventSource` set `PixelData` from the
    stream.
-   **VID-USR-3** A caller can override the Image Pixel values that the
    MPEG-4 AVC transfer syntaxes mandate (`SamplesPerPixel`,
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
    last fragment through the declared total length.

## § Implementation requirements

-   **VID-IMP-1** `videoBase` is `defaultInstanceBase`,
    `videoPhotographicBase` (SOP class, Modality `XC`, the Image Pixel values
    of VID-USR-3, `LossyImageCompression` `"01"`), and `predecessorBase`
    (CORE-IMP-3).
-   **VID-IMP-2** `buildVideoDataset` removes its control key `fragmentBytes`
    before it calls `createInstance` (CORE-IMP-9).
-   **VID-IMP-3** `EncapsulatedPixelDataValueTotalLength` is a BigInt,
    because VR UV is a 64-bit unsigned integer.
-   **VID-IMP-4** `extractEncapsulatedVideo` keeps all of the bytes when the
    dataset has no total length, and returns `declaredLength: null`, so the
    caller can choose a warning.

## Dependencies

The package builds on `@dcmjs-org/core`, `@dcmjs-org/imaging` (the shared
`h264TransferSyntaxUID` map), and `@dcmjs-org/parser`.
