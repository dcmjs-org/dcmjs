// The public surface of @dcmjs-org/encapsulated: the Encapsulated PDF builder
// and extractor. PDF is the first encapsulated-document IOD to land here; the
// other document types (CDA, STL, OBJ, MTL) share this package. The video
// half of the v2 encapsulated module is encapsulated *pixel data*, not a
// document, and belongs to the media wave, not here.
export {
    encapsulatePdf,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID
} from "./encapsulatedPdf.js";
