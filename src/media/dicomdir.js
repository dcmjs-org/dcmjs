// src/media/dicomdir.js
//
// DICOMDIR (Media Storage Directory, PS3.10 / PS3.3 F) builder. Turns a flat
// file-set description into the PATIENT -> STUDY -> SERIES -> leaf record
// hierarchy and serializes it with real byte offsets in the three offset
// attributes (OffsetOfTheNextDirectoryRecord, OffsetOfReferencedLowerLevel-
// DirectoryEntity, and the root first/last record offsets).
//
// Offsets are computed by measure-then-write (see directoryOffsets.js): every
// offset attribute is VR UL — fixed four bytes — so a measurement pass with
// placeholder zeros produces the exact final layout, and the file is written
// once. No patch-and-rewrite, no buffer scanning.

import { DicomMetaDictionary } from "../DicomMetaDictionary.js";
import { DicomDict } from "../DicomDict.js";
import { computeDirectoryOffsets } from "./directoryOffsets.js";

const MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID = "1.2.840.10008.1.3.10";
const EXPLICIT_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";

// PS3.10 8.5: each File ID component is 1-8 characters from the ISO 9660
// level 1 repertoire (A-Z, 0-9, underscore), at most 8 components deep.
const FILE_ID_COMPONENT = /^[A-Z0-9_]{1,8}$/;

function assertEntry(entry, index) {
    const where = `buildDicomDirDataset: entries[${index}]`;
    if (!entry || typeof entry !== "object") {
        throw new Error(`${where} is not an object`);
    }
    if (
        !Array.isArray(entry.referencedFileID) ||
        !entry.referencedFileID.length
    ) {
        throw new Error(
            `${where}.referencedFileID must be a non-empty array of path components`
        );
    }
    for (const required of [
        "sopClassUid",
        "sopInstanceUid",
        "transferSyntaxUid"
    ]) {
        if (!entry[required]) {
            throw new Error(`${where}.${required} is required`);
        }
    }
    if (!entry.patient?.PatientID) {
        throw new Error(`${where}.patient.PatientID is required`);
    }
    if (!entry.study?.StudyInstanceUID) {
        throw new Error(`${where}.study.StudyInstanceUID is required`);
    }
    if (!entry.series?.SeriesInstanceUID) {
        throw new Error(`${where}.series.SeriesInstanceUID is required`);
    }
}

function assertFileID(components, index, allowNonConforming) {
    if (components.length > 8) {
        throw new Error(
            `buildDicomDirDataset: entries[${index}].referencedFileID has ` +
                `${components.length} components (max 8)`
        );
    }
    if (allowNonConforming) {
        return;
    }
    for (const component of components) {
        if (!FILE_ID_COMPONENT.test(component)) {
            throw new Error(
                `buildDicomDirDataset: entries[${index}].referencedFileID ` +
                    `component "${component}" is not ISO 9660 level 1 ` +
                    `conformant (A-Z 0-9 _, 1-8 chars) — rename the file or ` +
                    `pass allowNonConformingFileIDs: true`
            );
        }
    }
}

/** The four keys every directory record starts with (PS3.3 F.3). */
function recordCommon(recordType) {
    return {
        OffsetOfTheNextDirectoryRecord: 0,
        RecordInUseFlag: 0xffff,
        OffsetOfReferencedLowerLevelDirectoryEntity: 0,
        DirectoryRecordType: recordType
    };
}

/**
 * Group the flat entries into the PATIENT -> STUDY -> SERIES -> leaf tree,
 * preserving first-seen order at every level.
 */
function groupEntries(entries, options) {
    const patients = new Map();
    entries.forEach((entry, index) => {
        assertEntry(entry, index);
        assertFileID(
            entry.referencedFileID,
            index,
            options.allowNonConformingFileIDs
        );

        const patientKey = entry.patient.PatientID;
        if (!patients.has(patientKey)) {
            patients.set(patientKey, {
                attributes: entry.patient,
                studies: new Map()
            });
        }
        const patient = patients.get(patientKey);

        const studyKey = entry.study.StudyInstanceUID;
        if (!patient.studies.has(studyKey)) {
            patient.studies.set(studyKey, {
                attributes: entry.study,
                series: new Map()
            });
        }
        const study = patient.studies.get(studyKey);

        const seriesKey = entry.series.SeriesInstanceUID;
        if (!study.series.has(seriesKey)) {
            study.series.set(seriesKey, {
                attributes: entry.series,
                leaves: []
            });
        }
        study.series.get(seriesKey).leaves.push(entry);
    });
    return patients;
}

/**
 * Flatten the tree depth-first into naturalized record objects, tracking the
 * flat index of each record's next sibling and first child so the offset
 * pass can wire the chains. Depth-first order means every link points
 * strictly forward in the file.
 *
 * @returns {{ records: Object[], links: Array<{next: number|null, child: number|null}> }}
 */
function flattenRecords(patients) {
    const records = [];
    const links = [];

    const push = record => {
        records.push(record);
        links.push({ next: null, child: null });
        return records.length - 1;
    };

    const patientList = [...patients.values()];
    let previousPatientIndex = null;

    for (const patient of patientList) {
        const patientIndex = push({
            ...recordCommon("PATIENT"),
            PatientName: patient.attributes.PatientName ?? "",
            PatientID: patient.attributes.PatientID
        });
        if (previousPatientIndex !== null) {
            links[previousPatientIndex].next = patientIndex;
        }
        previousPatientIndex = patientIndex;

        const studyList = [...patient.studies.values()];
        let previousStudyIndex = null;
        for (const study of studyList) {
            const studyIndex = push({
                ...recordCommon("STUDY"),
                StudyDate: study.attributes.StudyDate ?? "",
                StudyTime: study.attributes.StudyTime ?? "",
                StudyDescription: study.attributes.StudyDescription ?? "",
                AccessionNumber: study.attributes.AccessionNumber ?? "",
                StudyInstanceUID: study.attributes.StudyInstanceUID,
                StudyID: study.attributes.StudyID ?? ""
            });
            if (previousStudyIndex === null) {
                links[patientIndex].child = studyIndex;
            } else {
                links[previousStudyIndex].next = studyIndex;
            }
            previousStudyIndex = studyIndex;

            const seriesList = [...study.series.values()];
            let previousSeriesIndex = null;
            for (const series of seriesList) {
                const seriesIndex = push({
                    ...recordCommon("SERIES"),
                    Modality: series.attributes.Modality ?? "OT",
                    SeriesInstanceUID: series.attributes.SeriesInstanceUID,
                    SeriesNumber: series.attributes.SeriesNumber ?? 1
                });
                if (previousSeriesIndex === null) {
                    links[studyIndex].child = seriesIndex;
                } else {
                    links[previousSeriesIndex].next = seriesIndex;
                }
                previousSeriesIndex = seriesIndex;

                let previousLeafIndex = null;
                for (const entry of series.leaves) {
                    const leafIndex = push({
                        ...recordCommon(entry.recordType || "IMAGE"),
                        ReferencedFileID: [...entry.referencedFileID],
                        ReferencedSOPClassUIDInFile: entry.sopClassUid,
                        ReferencedSOPInstanceUIDInFile: entry.sopInstanceUid,
                        ReferencedTransferSyntaxUIDInFile:
                            entry.transferSyntaxUid,
                        InstanceNumber: entry.instance?.InstanceNumber ?? 1,
                        ...entry.instance
                    });
                    if (previousLeafIndex === null) {
                        links[seriesIndex].child = leafIndex;
                    } else {
                        links[previousLeafIndex].next = leafIndex;
                    }
                    previousLeafIndex = leafIndex;
                }
            }
        }
    }

    return { records, links };
}

/**
 * Build the naturalized DICOMDIR dataset (all offsets zero) plus the link
 * table the offset pass needs. Pure and inspectable — no serialization.
 *
 * @param {Array} entries - flat file-set entries; see module JSDoc/typedef
 * @param {Object} [options]
 * @param {string} [options.fileSetID=""]
 * @param {boolean} [options.allowNonConformingFileIDs=false]
 * @returns {{ dataset: Object, links: Array, rootIndices: number[] }}
 */
function buildDicomDirDataset(entries = [], options = {}) {
    const patients = groupEntries(entries, options);
    const { records, links } = flattenRecords(patients);

    const rootIndices = [];
    records.forEach((record, index) => {
        if (record.DirectoryRecordType === "PATIENT") {
            rootIndices.push(index);
        }
    });

    const dataset = {
        FileSetID: options.fileSetID ?? "",
        OffsetOfTheFirstDirectoryRecordOfTheRootDirectoryEntity: 0,
        OffsetOfTheLastDirectoryRecordOfTheRootDirectoryEntity: 0,
        FileSetConsistencyFlag: 0,
        DirectoryRecordSequence: records
    };

    return { dataset, links, rootIndices };
}

/** Mint the DICOMDIR file meta group (SOP identity lives here, not the body). */
function buildDicomDirMeta(options = {}) {
    const fileMetaInformationVersion = new Uint8Array(2);
    fileMetaInformationVersion[1] = 1;
    return DicomMetaDictionary.denaturalizeDataset({
        FileMetaInformationVersion: fileMetaInformationVersion.buffer,
        MediaStorageSOPClassUID: MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID,
        MediaStorageSOPInstanceUID:
            options.fileSetUID || DicomMetaDictionary.uid(),
        TransferSyntaxUID: EXPLICIT_LITTLE_ENDIAN,
        ImplementationClassUID:
            "2.25.80302813137786398554742050926734630921603366648225212145404",
        ImplementationVersionName: "dcmjs-0.0"
    });
}

/**
 * Build and serialize a complete DICOMDIR: build the record tree,
 * denaturalize it, measure the layout, wire the offset chains, write once.
 *
 * @param {Array} entries - flat file-set entries
 * @param {Object} [options] - buildDicomDirDataset options plus
 *   {string} [options.fileSetUID] fixed MediaStorageSOPInstanceUID
 * @returns {ArrayBuffer} the DICOMDIR file bytes
 */
/**
 * The DICOM data dictionary gives the directory offset attributes the
 * special VR "up" (byte offset); the dcmjs writer has no "up" representation
 * and would fall back to UN. They are four-byte unsigned offsets — pin them
 * to UL so they serialize (and measure) as the fixed-width values the
 * offset algorithm depends on.
 */
function pinOffsetVRs(dict) {
    for (const tag of ["00041200", "00041202"]) {
        if (dict[tag]) {
            dict[tag].vr = "UL";
        }
    }
    const items = dict["00041220"]?.Value || [];
    for (const item of items) {
        for (const tag of ["00041400", "00041420"]) {
            if (item[tag]) {
                item[tag].vr = "UL";
            }
        }
    }
}

function writeDicomDir(entries = [], options = {}) {
    const { dataset, links, rootIndices } = buildDicomDirDataset(
        entries,
        options
    );

    const dicomDict = new DicomDict(buildDicomDirMeta(options));
    dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
    pinOffsetVRs(dicomDict.dict);

    const writeOptions = { allowInvalidVRLength: false };
    const recordOffsets = computeDirectoryOffsets(dicomDict, writeOptions);

    const sequence = dicomDict.dict["00041220"];
    const items = (sequence && sequence.Value) || [];
    items.forEach((item, index) => {
        const { next, child } = links[index];
        item["00041400"].Value = [next === null ? 0 : recordOffsets[next]];
        item["00041420"].Value = [child === null ? 0 : recordOffsets[child]];
    });

    const first = rootIndices.length ? recordOffsets[rootIndices[0]] : 0;
    const last = rootIndices.length
        ? recordOffsets[rootIndices[rootIndices.length - 1]]
        : 0;
    dicomDict.dict["00041200"].Value = [first];
    dicomDict.dict["00041202"].Value = [last];

    return dicomDict.write(writeOptions);
}

export {
    buildDicomDirDataset,
    writeDicomDir,
    MEDIA_STORAGE_DIRECTORY_SOP_CLASS_UID
};
