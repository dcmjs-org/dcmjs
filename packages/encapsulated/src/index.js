// The public surface of @dcmjs-org/encapsulated: the generic Encapsulated
// Document builder, its base blocks, and the Encapsulated PDF builder and
// extractor. The other document types (CDA, STL, OBJ, MTL) share this package.
export { encapsulate, extractEncapsulated } from "./encapsulate.js";
export {
    encapsulatedDocumentBase,
    encapsulatedBase
} from "./defaults/encapsulatedDocumentBase.js";
export { pdfBase, encapsulatedPdfBase } from "./defaults/pdfBase.js";
export {
    encapsulatePdf,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID,
    PDF_MIME_TYPE
} from "./encapsulatedPdf.js";
