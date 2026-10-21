# @dcmjs-org/imaging

The codec-free image builder of dcmjs. This package is the image counterpart
of `@dcmjs-org/video`. It puts decoded pixels into a conformant DICOM image
instance. It also reads the headers of compressed streams. It does not decode
pixels, and it does not read MP4 containers. A consumer that builds only
image instances uses this package, and does not need the larger video
package.

-   `buildImageDataset(decodedImage, options)` — wrap decoded pixels into a
    naturalized image instance. The default is Secondary Capture (`OT`).
    `SECONDARY_CAPTURE_SOP_CLASS_UID` and `imageBase` are exported with it.
-   `derivedImageBase(derivedFrom, { lossy })` — a base block that marks the
    image as derived. `buildImageDataset` adds it for `derivedFrom`, and a
    caller can add it to a custom `baseDicom`.
-   `derivedImageAttributes(derivedFrom, { lossy })` — the plain function
    under `derivedImageBase`: `ImageType`, `SourceImageSequence`, and the
    Lossy Image Compression attributes.
-   `parseJpegInfo(bytes)` — gets the geometry and the matching DICOM
    transfer syntax from the SOF segment of a JPEG. It does not decode the
    pixels.
-   `h264TransferSyntaxUID(profileIdc, levelIdc)` — gives the DICOM transfer
    syntax that can carry an AVC profile and level (Supplement 225), or
    `null`.

`@dcmjs-org/video` puts compressed streams into DICOM. It also reads MP4
headers, and encapsulates and streams video. That package uses the shared
`h264TransferSyntaxUID` map of this package.

## Options of `buildImageDataset`

The options follow CORE-USR-1 in `packages/core/README.md`: the
`createInstance` options, DICOM attribute overrides, and these control keys.

-   `baseDicom` (default `imageBase`) — base blocks.
-   `derivedFrom` — a naturalized instance, or an array of them, that the image
    is derived from. Each needs `SOPClassUID` and `SOPInstanceUID`. An empty
    array is the same as no `derivedFrom`.
-   `lossy` (default `true`) — `false`, or `{ method, ratio }`. It applies only
    with `derivedFrom`.
-   `encapsulated` — `{ transferSyntaxUID, frames }`: pre-encoded frames, in
    place of `decodedImage.pixels`.

```js
const image = buildImageDataset(decodedImage, {
    instance: priorInstanceInSeries,
    dataLevel: "series",
    derivedFrom: [sourceA, sourceB],
    BodyPartExamined: "CHEST"
});

// The same derivation in a custom base:
const base = combineBases(imageBase, { Modality: "MR" });
const derived = buildImageDataset(decodedImage, {
    baseDicom: combineBases(base, derivedImageBase(sourceA, { lossy: false }))
});
```

## Scope and change rule

The shared requirements of `createInstance` (CORE-USR-n, CORE-IMP-n in
`packages/core/README.md`) apply to `buildImageDataset`. This README lists
only the requirements of this package.

The change rule of the core README applies. Change a user requirement
(IMG-USR-n) only when it describes the behaviour wrongly, or when the
intended user-facing behaviour changes, and name the change in the pull
request. The implementation requirements (IMG-IMP-n) describe the current
approach, and can change freely. Do not renumber an identifier.

## § User requirements

-   **IMG-USR-1** `instance` is where the new image goes (CORE-USR-3). It is
    not the source of a derivation. `derivedFrom` is the source of a
    derivation, and it is a separate option.
-   **IMG-USR-2** The payload attributes come from the pixels or the frames:
    `Rows`, `Columns`, `SamplesPerPixel`, `PhotometricInterpretation`,
    `BitsAllocated`, `BitsStored`, `HighBit`, `PixelRepresentation`,
    `PlanarConfiguration` (color only), `NumberOfFrames` (more than one frame
    only), and `PixelData`. The builder sets them after `createInstance`.
    -   An override of one of these keywords throws an error.
    -   A base value of these keywords, or a value that a custom `levels`
        inherits, does not go into the result.
    -   `_vrMap.PixelData` is `OW` for 16-bit pixels, else `OB`.
    -   For `encapsulated`, `_meta.TransferSyntaxUID` is the transfer syntax
        of the frames. Without `encapsulated`, an override `_meta` stays.
    -   A Secondary Capture result without `ConversionType` gets `WSD`.
-   **IMG-USR-3** With a non-empty `derivedFrom`, the result is a derived
    image:
    -   `ImageType` is `DERIVED\SECONDARY`.
    -   `SourceImageSequence` has one item for each source, in order.
    -   `LossyImageCompression` is `"01"`. For `lossy: false` it is `"00"`,
        but when a source has `"01"`, the result keeps `"01"`, because a lossy
        image stays lossy (PS3.3 C.7.6.1.1.5).
    -   `LossyImageCompressionMethod` and `LossyImageCompressionRatio` keep
        the history of the lossy steps (PS3.3 C.7.6.1.1.5). The values of each
        lossy source come first, in `derivedFrom` order. Then come `method`
        and `ratio` of a `lossy` object. One value is a plain value, and more
        values are an array.
    -   PS3.3 C.7.6.1.1.5 pairs each ratio with the method at the same
        position. When the result has ratios, and the number of ratios is not
        the number of methods, the result has no `LossyImageCompressionRatio`.
        The builder then logs one warning.
    -   `SOPClassUID` stays the value of the base (Secondary Capture for
        `imageBase`).
    -   These values are base values (IMG-IMP-1). An inherited value or an
        override replaces them (CORE-USR-6). For example, a custom `levels`
        that inherits `ImageType` or `LossyImageCompression` gives the value
        of `instance`, and not the derived value.
    -   An empty `derivedFrom` array is the same as no `derivedFrom`.
-   **IMG-USR-4** Each `derivedFrom` item is a naturalized instance, full or
    partial. The builder reads the DICOM keywords `SOPClassUID`,
    `SOPInstanceUID`, and `LossyImageCompression`. An item without
    `SOPClassUID` or `SOPInstanceUID` throws an error that names the absent
    keyword.
-   **IMG-USR-5** The default `ImageType` `ORIGINAL\PRIMARY` is a base value.
    A custom base, the derivation, an inherited value, and an override each
    replace it, in the order of CORE-USR-6.
-   **IMG-USR-6** The result never gets the `SOPInstanceUID` of `instance`
    (CORE-USR-4) or of `derivedFrom`. An override `SOPInstanceUID` always
    wins.
-   **IMG-USR-7** A caller can add `derivedImageBase(derivedFrom, { lossy })`
    to a custom `baseDicom` (CORE-USR-11). The result is the same as with the
    `derivedFrom` option. `derivedImageBase` and `derivedImageAttributes`
    need at least one instance: an empty `derivedFrom` throws an error.
-   **IMG-USR-8** `lossy` without `derivedFrom`, or with an empty
    `derivedFrom`, has no effect, and the builder logs a warning.

## § Implementation requirements

-   **IMG-IMP-1** `buildImageDataset` calls `createInstance`. For a non-empty
    `derivedFrom`, the base is
    `combineBases(baseDicom, derivedImageBase(derivedFrom, { lossy }))`, so
    the merge stays base < inherited < overrides (CORE-IMP-4).
    `buildImageDataset` removes its control keys `derivedFrom`, `lossy`, and
    `encapsulated` before it calls `createInstance` (CORE-IMP-9). Then it
    removes the payload keywords of IMG-USR-2 from the result, and sets the
    geometry and the pixel encoding.
-   **IMG-IMP-2** `derivedImageAttributes` is the plain function under
    `derivedImageBase`. The block calls it for each context, so each result
    gets its own `SourceImageSequence`.
-   **IMG-IMP-3** `imageBase` is `defaultInstanceBase`,
    `secondaryCaptureImageBase` (SOP class, Modality `OT`, `ImageType`,
    `ContentDate`, `ContentTime`), and `predecessorBase`.

## Dependencies

Builds only on `@dcmjs-org/core` (`createInstance`). The datasets it
produces are naturalized and serialize through the event-stream writers
(`@dcmjs-org/generator`) like any other.
