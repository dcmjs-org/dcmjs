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
import { DICOMWEB } from "./dicomweb.js";

registerPrivatesModule(privateData);
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
import sr from "./sr/index.js";
import eventStream from "./eventStream/index.js";
import * as constants from "./constants/dicom.js";

// Media storage (PS3.10) and encapsulated payloads: the DICOMDIR builder,
// the PDF/video wrappers, and the codec-free image builders, re-exported
// from @dcmjs-org/media under the same namespace shapes v2's src/index.js
// used (`media`, `encapsulated`, `image`).
import { media, encapsulated, image } from "@dcmjs-org/media";

// FHIR sink (@dcmjs-org/fhir): naturalized DICOM datasets → FHIR R4B
// resources, plus a Part 10 convenience composed below.
import * as fhirSink from "@dcmjs-org/fhir";

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

// The @dcmjs-org/fhir sink spread onto a namespace, plus a Part 10
// convenience that composes the classic reader and naturalizer — turns a
// .dcm ArrayBuffer straight into FHIR.
const fhir = {
    ...fhirSink,
    /**
     * Parse a DICOM Part 10 ArrayBuffer and map it to FHIR resources.
     * @param {ArrayBuffer} arrayBuffer
     * @param {Object} [options] - toFhir options; options.readOptions is
     *   passed through to DicomMessage.readFile
     * @returns {{ patient: Object|null, imagingStudy: Object|null,
     *   documentReference: Object|null }}
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
    DICOMWEB,
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
    DICOMWEB,
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
