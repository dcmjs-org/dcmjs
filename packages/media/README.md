# @dcmjs-org/media

The dcmjs bulk-data bundle. One dependency that re-exports the three
bulk-data packages under the namespace shapes dcmjs v2 consumers already
know:

| Namespace | Backed by | Contents |
| --- | --- | --- |
| `media` | `@dcmjs-org/dicomdir` | `buildDicomDirDataset`, `writeDicomDir`, `MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID` |
| `encapsulated` | `@dcmjs-org/pdfs` + `@dcmjs-org/video` | `encapsulatePdf`, `extractEncapsulatedPdf`, `buildVideoDataset`, `encapsulateVideo`, `extractEncapsulatedVideo`, `normalizeFragmentBytes`, the SOP class UIDs, `DEFAULT_FRAGMENT_BYTES` |
| `image` | `@dcmjs-org/video` | `buildImageDataset`, `parseJpegInfo`, `parseMp4Info`, `h264TransferSyntaxUID`, `SECONDARY_CAPTURE_SOP_CLASS_UID` |

`createVideoEventSource` (the streaming MP4 → event-stream source) is a
top-level named export.

```js
import { media, encapsulated, image } from "@dcmjs-org/media";

const dataset = encapsulated.encapsulatePdf(pdfBytes, { PatientName: "DOE^JANE" });
const dicomdir = media.buildDicomDirDataset(fileSetDescription);
const info = image.parseMp4Info(mp4Bytes);
```

Every export here is the same function object as the underlying package's
export — this bundle adds no behavior, only a single install surface.
