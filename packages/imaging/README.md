# @dcmjs-org/imaging

Lightweight, codec-free image building for dcmjs. This is the slice-based,
SOP-specific counterpart to `@dcmjs-org/video`: it turns already-decoded
pixels into a conformant DICOM image instance and inspects compressed-stream
headers, without any MP4 container handling, decoding, or video machinery. A
consumer that only needs to build image instances depends on this and not on
the heavier video package.

-   `buildImageDataset(decodedImage, options)` — wrap decoded pixels into a
    naturalized image instance. Defaults to Secondary Capture (`OT`); the actual
    pixel geometry always wins over any metadata claims, and identifying a source
    instance yields a `DERIVED\SECONDARY` result with a fresh `SOPInstanceUID`
    (original UIDs are never reused for rebuilt pixels). `SECONDARY_CAPTURE_SOP_CLASS_UID`
    is exported alongside it.
-   `parseJpegInfo(bytes)` — recover geometry and the matching DICOM transfer
    syntax from a JPEG's SOF segment without decoding any pixels.
-   `h264TransferSyntaxUID(profileIdc, levelIdc)` — map an AVC profile/level pair
    to the DICOM transfer syntax that can carry it (Supplement 225), or `null`.

Reading compressed streams into DICOM, and MP4 header inspection / video
encapsulation / streaming, live in `@dcmjs-org/video`, which depends on this
package for the shared `h264TransferSyntaxUID` mapping.

## Dependencies

Builds only on `@dcmjs-org/core` (`DicomMetaDictionary`). The datasets it
produces are naturalized and serialize through the event-stream writers
(`@dcmjs-org/generator`) like any other.
