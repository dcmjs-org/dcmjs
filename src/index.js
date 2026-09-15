// Data
import { BitArray } from "./bitArray.js";
import { ReadBufferStream } from "./BufferStream.js";
import { DeflatedReadBufferStream } from "./BufferStream.js";
import { WriteBufferStream } from "./BufferStream.js";
import { DicomDict } from "./DicomDict.js";
import { DicomMessage } from "./DicomMessage.js";
import { DicomMetaDictionary } from "./DicomMetaDictionary.js";
import { registerPrivatesModule } from "./dictionary.fast.js";
import * as privateData from "./dictionary.private.data.js";

// R7: register the privates as a lazy wrapper - importing dcmjs does no
// private-dictionary work. The packed module's base64 index decode
// (initPackedPrivate) only runs on the first private-tag lookup.
registerPrivatesModule({
    lookupPrivateTag: keyStr => privateData.lookupPrivateTag(keyStr)
});
import { Tag } from "./Tag.js";
import { ValueRepresentation } from "./ValueRepresentation.js";
import { Colors } from "./colors.js";
import log from "./log.js";

import { AsyncDicomReader } from "./AsyncDicomReader.js";

import {
    datasetToDict,
    datasetToBuffer,
    datasetToBlob
} from "./datasetToBlob.js";
// Derivations
import {
    DerivedDataset,
    DerivedPixels,
    DerivedImage,
    Segmentation,
    StructuredReport,
    ParametricMap
} from "./derivations/index.js";
// Encapsulated payloads (PDF and video, in and out)
import {
    encapsulatePdf,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID,
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
} from "./encapsulated/index.js";
// Image instances from decoded pixels (codec-free)
import {
    buildImageDataset,
    SECONDARY_CAPTURE_SOP_CLASS_UID,
    parseJpegInfo,
    parseMp4Info,
    h264TransferSyntaxUID
} from "./image/index.js";
// Normalizers

import { Normalizer } from "./normalizers.js";
import { ImageNormalizer } from "./normalizers.js";
import { MRImageNormalizer } from "./normalizers.js";
import { EnhancedMRImageNormalizer } from "./normalizers.js";
import { EnhancedUSVolumeNormalizer } from "./normalizers.js";
import { CTImageNormalizer } from "./normalizers.js";
import { PETImageNormalizer } from "./normalizers.js";
import { SEGImageNormalizer } from "./normalizers.js";
import { DSRNormalizer } from "./normalizers.js";

import adapters from "./adapters/index.js";
import utilities from "./utilities/index.js";
import eventStream from "./eventStream/index.js";
// Media storage (PS3.10): DICOMDIR builder
import media from "./media/index.js";
import sr from "./sr/index.js";
import * as constants from "./constants/dicom.js";
import * as fhirSink from "@dcmjs/fhir";

import { cleanTags, getTagsNameToEmpty } from "./anonymizer.js";

const data = {
    BitArray,
    ReadBufferStream,
    DeflatedReadBufferStream,
    WriteBufferStream,
    DicomDict,
    DicomMessage,
    DicomMetaDictionary,
    Tag,
    ValueRepresentation,
    Colors,
    datasetToDict,
    datasetToBuffer,
    datasetToBlob
};

const async = {
    AsyncDicomReader
};

const derivations = {
    DerivedDataset,
    DerivedPixels,
    DerivedImage,
    Segmentation,
    StructuredReport,
    ParametricMap
};

const normalizers = {
    Normalizer,
    ImageNormalizer,
    MRImageNormalizer,
    EnhancedMRImageNormalizer,
    EnhancedUSVolumeNormalizer,
    CTImageNormalizer,
    PETImageNormalizer,
    SEGImageNormalizer,
    DSRNormalizer
};

const anonymizer = {
    cleanTags,
    getTagsNameToEmpty
};

const encapsulated = {
    encapsulatePdf,
    extractEncapsulatedPdf,
    ENCAPSULATED_PDF_SOP_CLASS_UID,
    buildVideoDataset,
    encapsulateVideo,
    extractEncapsulatedVideo,
    normalizeFragmentBytes,
    VIDEO_PHOTOGRAPHIC_SOP_CLASS_UID,
    DEFAULT_FRAGMENT_BYTES
};

const image = {
    buildImageDataset,
    SECONDARY_CAPTURE_SOP_CLASS_UID,
    parseJpegInfo,
    parseMp4Info,
    h264TransferSyntaxUID
};

// FHIR sink (@dcmjs/fhir) plus a Part 10 convenience that composes the
// parser and naturalizer — turns a .dcm ArrayBuffer straight into FHIR.
const fhir = {
    ...fhirSink,
    /**
     * Parse a DICOM Part 10 ArrayBuffer and map it to FHIR resources.
     * @param {ArrayBuffer} arrayBuffer
     * @param {Object} [options] - toFhir options; options.readOptions is
     *   passed through to DicomMessage.readFile
     * @returns {{ patient: Object|null, imagingStudy: Object|null }}
     */
    fromPart10(arrayBuffer, options = {}) {
        const dicomDict = DicomMessage.readFile(
            arrayBuffer,
            options.readOptions || {}
        );
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        return fhirSink.toFhir(dataset, options);
    }
};

const dcmjs = {
    adapters,
    constants,
    data,
    derivations,
    encapsulated,
    eventStream,
    fhir,
    image,
    media,
    normalizers,
    sr,
    utilities,
    log,
    anonymizer,
    async
};

DicomDict.setDicomMessageClass(DicomMessage);
ValueRepresentation.setDicomMessageClass(DicomMessage);
ValueRepresentation.setTagClass(Tag);
Tag.setDicomMessageClass(DicomMessage);

export {
    adapters,
    anonymizer,
    async,
    constants,
    data,
    derivations,
    encapsulated,
    eventStream,
    fhir,
    image,
    media,
    normalizers,
    sr,
    utilities,
    log
};

export { dcmjs as default };
