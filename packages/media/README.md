# @dcmjs-org/media

The dcmjs bulk-data bundle. One dependency that re-exports the bulk-data
packages under the namespace shapes dcmjs v2 consumers already know:

| Namespace      | Backed by                                      | Contents                                                                                                                                                                                                                                                              |
| -------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media`        | `@dcmjs-org/dicomdir`                          | `buildDicomDirDataset`, `writeDicomDir`, `MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID`                                                                                                                                                                                      |
| `encapsulated` | `@dcmjs-org/encapsulated` + `@dcmjs-org/video` | `encapsulate`, `encapsulatePdf`, `extractEncapsulatedPdf`, `buildVideoDataset`, `encapsulateVideo`, `extractEncapsulatedVideo`, the base blocks `encapsulatedBase`, `encapsulatedPdfBase`, `videoBase`, `PDF_MIME_TYPE`, the SOP class UIDs, `DEFAULT_FRAGMENT_BYTES` |
| `image`        | `@dcmjs-org/imaging` + `@dcmjs-org/video`      | `buildImageDataset`, the base blocks `imageBase` and `derivedImageBase`, `parseJpegInfo`, `parseMp4Info`, `h264TransferSyntaxUID`, `SECONDARY_CAPTURE_SOP_CLASS_UID`                                                                                                  |

`createVideoEventSource` (the streaming MP4 → event-stream source) is a
top-level named export.

The builders take the `createInstance` options of `@dcmjs-org/core`
(`instance`, `dataLevel`, `levels`, `predecessor`, `postProcess`,
`baseDicom`, `overrides`). The DICOM attributes go in `overrides`; a
top-level attribute key has no effect (CORE-USR-7).

```js
import { media, encapsulated, image } from "@dcmjs-org/media";

const dataset = encapsulated.encapsulatePdf(pdfBytes, {
    instance: existingNaturalizedInstance,
    overrides: { DocumentTitle: "Discharge Summary" }
});
const dicomdir = media.buildDicomDirDataset(fileSetDescription);
const info = image.parseMp4Info(mp4Bytes);
```

Every export here is the same object as the underlying package's export —
this bundle adds no behavior, only a single install surface.
