// @dcmjs-org/dcmjs/media: the DICOMDIR builder (PS3.10), with the names of
// the dcmjs v2 `media` namespace.
import { media } from "@dcmjs-org/media";

export const {
    buildDicomDirDataset,
    writeDicomDir,
    MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID
} = media;

export default media;
