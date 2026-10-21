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
-   `parseJpegInfo(bytes)` — gets the geometry, the photometric
    interpretation, and the matching DICOM transfer syntax from the frame
    header of a JPEG (IMG-USR-11). It does not decode the pixels.
-   `h264TransferSyntaxUID(profileIdc, levelIdc)` — gives the DICOM transfer
    syntax that can carry an AVC profile and level (Supplement 225), or
    `null`.

`@dcmjs-org/video` puts compressed streams into DICOM. It also reads MP4
headers, and encapsulates and streams video. That package uses the shared
`h264TransferSyntaxUID` map of this package.

## Options of `buildImageDataset`

The options follow CORE-USR-1 in `packages/core/README.md`: the
`createInstance` controls, `overrides`, and these control keys. All of
them are options. `overrides` is a naturalized DICOM provider with the
forms of `baseDicom`, and holds only DICOM attributes. A control key never
goes in `overrides`. An extra option key has no effect (CORE-USR-7).

-   `baseDicom` (default `imageBase`) — base blocks. `imageBase` has no
    `predecessorBase`, so `predecessor: true` needs a custom base
    (IMG-USR-10).
-   `derivedFrom` — a naturalized instance, or an array of them, that the
    image is derived from. Each needs `SOPClassUID` and `SOPInstanceUID`. An
    empty array is the same as no `derivedFrom`.
-   `lossy` (default `true`) — `false`, or `{ method, ratio }`. It has an
    effect only with `derivedFrom` (IMG-USR-8).
-   `encapsulated` — `{ transferSyntaxUID, frames }`: pre-encoded frames, in
    place of `decodedImage.pixels`.

The geometry fields of `decodedImage` (`rows`, `columns`, `samplesPerPixel`,
and the others of IMG-USR-2) have no default. A decoded value replaces the
value from the base, from `instance`, or from `overrides`. A field that the
decoded image does not give writes nothing, and that value stays. Give the
photometric attributes in `overrides` when the decoder does not give them.

```js
const image = buildImageDataset(decodedImage, {
    instance: priorInstanceInSeries,
    dataLevel: "series",
    derivedFrom: [sourceA, sourceB],
    overrides: { BodyPartExamined: "CHEST" }
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
-   **IMG-USR-2** The geometry attributes are `Rows`, `Columns`,
    `SamplesPerPixel`, `PhotometricInterpretation`, `BitsAllocated`,
    `BitsStored`, `HighBit`, `PixelRepresentation`, `PlanarConfiguration`,
    and `NumberOfFrames`. The builder sets the geometry that the decoded
    input gives, and `PixelData`, after `createInstance`.
    -   The decoded input gives a value in these cases:
        -   A field of `decodedImage` (`rows`, `columns`, `samplesPerPixel`,
            `photometricInterpretation`, `bitsAllocated`, `bitsStored`,
            `highBit`, `pixelRepresentation`, `planarConfiguration`,
            `numberOfFrames`) that is not `undefined`, `null`, or `""`.
        -   `BitsAllocated` always comes from the typed-array width of
            `pixels`.
        -   `PixelRepresentation` is 1 for an `Int8Array`, an `Int16Array`,
            or an `Int32Array` when `decodedImage` has no
            `pixelRepresentation`.
        -   `NumberOfFrames` always comes from `encapsulated.frames.length`.
        -   `HighBit` is `bitsStored` - 1 when `decodedImage` has
            `bitsStored` and has no `highBit`.
        -   The builder calculates no other value. For example, it does not
            calculate `HighBit` from `BitsAllocated`, or from a `BitsStored`
            of the base, of `instance`, or of `overrides`. It does not
            calculate `BitsStored` from `BitsAllocated`.
    -   A decoded value replaces the base value, the inherited value, and the
        override, with no warning. This rule applies to each form of
        `overrides`, also to a function and to an array.
    -   The builder does not write a geometry attribute that the decoded
        input does not give, and does not remove it. The value from the
        base, from `instance`, or from `overrides` stays. Without one of
        these, the result does not have the attribute. The builder writes
        no default.
    -   The builder writes `PlanarConfiguration` only when the effective
        `SamplesPerPixel` is more than 1. The builder writes `NumberOfFrames`
        in three cases: the decoded count is more than 1,
        `decodedImage.numberOfFrames` gives the count, or the dataset
        already has a `NumberOfFrames`. Thus a count of 1 from
        `encapsulated.frames.length` alone does not add `NumberOfFrames`.
    -   The builder checks the effective geometry before it writes the
        geometry (IMG-USR-9).
    -   `_vrMap.PixelData` is `OW` for 16-bit native pixels, else `OB`.
        Encapsulated frames always use `OB`.
    -   The `_meta` rule of CORE-USR-13 applies. For `encapsulated`, the
        builder sets `_meta.TransferSyntaxUID` to the transfer syntax of the
        frames. Without `encapsulated`, the builder sets Explicit VR Little
        Endian only when the merged `_meta` has no `TransferSyntaxUID`. Thus
        a `TransferSyntaxUID` override in `_meta` stays.
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
    replace it, in the order of CORE-USR-6. The default `ConversionType`
    `WSD` is also a base value of `secondaryCaptureImageBase`. An override
    replaces it, and an `undefined` override removes it (CORE-USR-8). A
    custom base without `secondaryCaptureImageBase` gives no
    `ConversionType`.
-   **IMG-USR-6** The result never gets the `SOPInstanceUID` of
    `derivedFrom`. With the default levels, the result does not get the
    `SOPInstanceUID` of `instance` (CORE-USR-4). `overrides.SOPInstanceUID`
    always wins.
-   **IMG-USR-7** A caller can add `derivedImageBase(derivedFrom, { lossy })`
    to a custom `baseDicom` (CORE-USR-11). The result is the same as with the
    `derivedFrom` option. `derivedImageBase` and `derivedImageAttributes`
    need at least one instance: an empty `derivedFrom` throws an error.
-   **IMG-USR-8** `lossy` without `derivedFrom`, or with an empty
    `derivedFrom`, has no effect.
-   **IMG-USR-9** The functions throw an error for these input values
    (CORE-IMP-11). `buildImageDataset` uses the effective values: the
    decoded value, else the value of the merged dataset.

    -   `decodedImage.pixels` and `options.encapsulated` together.
    -   An `encapsulated` without `transferSyntaxUID`, or without frames.
    -   `Rows` or `Columns` that is not a positive integer. The decoded
        input or the merged dataset must give them.
    -   `MONOCHROME1` or `MONOCHROME2` with a `SamplesPerPixel` that is not
        1.
    -   `RGB` or `YBR_*` with a `SamplesPerPixel` that is not 3.
    -   A `pixels` that is a `Float32Array` or a `Float64Array`. DICOM
        integer pixel data needs an integer typed array.
    -   A `bitsAllocated` that is not the typed-array width of `pixels`.
    -   A `numberOfFrames` that is not `encapsulated.frames.length`.
    -   A byte length of `pixels` that is not `Rows` x `Columns` x
        `SamplesPerPixel` x `NumberOfFrames` x `BitsAllocated` / 8.
    -   `parseJpegInfo`: bytes without the JPEG SOI marker, a JPEG without
        a frame header (SOF), or a truncated SOF segment.

    When a value that a check needs is absent from the decoded input and
    from the merged dataset, the check uses a default. An absent
    `SamplesPerPixel` is 1, and an absent `NumberOfFrames` is 1. The builder
    does not write these defaults. Without a `PhotometricInterpretation`,
    the builder skips the photometric check. IMG-USR-4 and IMG-USR-7 give
    the errors of `derivedFrom`. The input type of `pixels` is a typed array
    (CORE-USR-7).

-   **IMG-USR-10** `imageBase` does not include `predecessorBase`
    (CORE-USR-9). With the default base, `predecessor: true` has no effect:
    the result has no `PredecessorDocumentsSequence`, and the builder throws
    no predecessor error. For a predecessor, give
    `baseDicom: combineBases(imageBase, predecessorBase)`, with
    `predecessorBase` from `@dcmjs-org/core`.
-   **IMG-USR-11** `parseJpegInfo` gives DICOM values that go directly into
    the `decodedImage` of `buildImageDataset`:
    -   `bitsAllocated` is 8 for a sample precision of 8 or less, else 16.
        `bitsStored` is the sample precision. (Before this rule,
        `bitsAllocated` was the sample precision.)
    -   `photometricInterpretation` follows PS3.5 8.2.1: `MONOCHROME2` for
        1 component; for 3 components `RGB` when the data has no colour
        transform (Adobe APP14 transform 0, the component IDs R, G, B, or a
        lossless process), else `YBR_FULL` without chroma subsampling and
        `YBR_FULL_422` with it. Another component count gives `null`.
    -   `transferSyntaxUID` is the baseline (SOF0), extended (SOF1), or
        lossless (SOF3) transfer syntax, else `null`.

## § Implementation requirements

-   **IMG-IMP-1** `buildImageDataset` calls `createInstance`. For a non-empty
    `derivedFrom`, the base is
    `combineBases(baseDicom, derivedImageBase(derivedFrom, { lossy }))`, so
    the merge stays base < inherited < overrides (CORE-IMP-4).
    `buildImageDataset` removes its control keys `derivedFrom`, `lossy`, and
    `encapsulated` before it calls `createInstance` (CORE-IMP-9), and passes
    `overrides` and `postProcess` through without a change. Then
    `buildImageDataset` checks the effective geometry, writes only the
    decoded geometry of IMG-USR-2, and sets the pixel encoding. It removes
    no geometry attribute.
-   **IMG-IMP-2** `derivedImageAttributes` is the plain function under
    `derivedImageBase`. The block calls it for each context, so each result
    gets its own `SourceImageSequence`.
-   **IMG-IMP-3** `imageBase` is `defaultInstanceBase`,
    `secondaryCaptureImageBase` (SOP class, Modality `OT`, `ConversionType`
    `WSD`, `ImageType`, `ContentDate`, `ContentTime`). `imageBase` has no
    `predecessorBase` (IMG-USR-10). The builder writes no default after
    `createInstance`.
-   **IMG-IMP-4** NumberOfFrames: a single-frame IOD, for example Secondary
    Capture, has no `NumberOfFrames`. For this reason a count of 1 from
    `encapsulated.frames.length` alone is not written. A count that
    `decodedImage` states is written, because the caller asks for it.

## Dependencies

Builds only on `@dcmjs-org/core` (`createInstance`). The datasets it
produces are naturalized and serialize through the event-stream writers
(`@dcmjs-org/generator`) like any other.
