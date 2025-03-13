import "regenerator-runtime/runtime.js";

import { jest } from "@jest/globals";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { WriteBufferStream } from "../src/BufferStream";
import dcmjs from "../src/index.js";
import { log } from "./../src/log.js";
import { getTestDataset, getZippedTestDataset } from "./testUtils.js";

import { promisify } from "util";
import arrayItem from "./arrayItem.json";
import minimalDataset from "./mocks/minimal_fields_dataset.json";
import datasetWithNullNumberVRs from "./mocks/null_number_vrs_dataset.json";
import { rawTags } from "./rawTags";
import sampleDicomSR from "./sample-sr.json";

import { ValueRepresentation } from "../src/ValueRepresentation";
import {
    EXPLICIT_LITTLE_ENDIAN,
    IMPLICIT_LITTLE_ENDIAN,
    PADDING_SPACE
} from "./../src/constants/dicom.js";

const { DicomMetaDictionary, DicomDict, DicomMessage, ReadBufferStream } =
    dcmjs.data;

const fileMetaInformationVersionArray = new Uint8Array(2);
fileMetaInformationVersionArray[1] = 1;

// The asset downloads in this file might take some time on a slower connection
jest.setTimeout(60000);

const metadata = {
    "00020001": {
        Value: [fileMetaInformationVersionArray.buffer],
        vr: "OB"
    },
    "00020012": {
        Value: ["1.2.840.113819.7.1.1997.1.0"],
        vr: "UI"
    },
    "00020002": {
        Value: ["1.2.840.10008.5.1.4.1.1.4"],
        vr: "UI"
    },
    "00020003": {
        Value: [DicomMetaDictionary.uid()],
        vr: "UI"
    },
    "00020010": {
        Value: ["1.2.840.10008.1.2"],
        vr: "UI"
    }
};

const sequenceMetadata = {
    "00080081": { vr: "ST", Value: [null] },
    "00081032": {
        vr: "SQ",
        Value: [
            {
                "00080100": {
                    vr: "SH",
                    Value: ["IMG1332"]
                },
                "00080102": {
                    vr: "SH",
                    Value: ["L"]
                },
                "00080104": {
                    vr: "LO",
                    Value: ["MRI SHOULDER WITHOUT IV CONTRAST LEFT"]
                }
            }
        ]
    },

    52009229: {
        vr: "SQ",
        Value: [
            {
                "00289110": {
                    vr: "SQ",
                    Value: [
                        {
                            "00180088": {
                                vr: "DS",
                                Value: [0.12]
                            }
                        }
                    ]
                }
            }
        ]
    }
};

function makeOverlayBitmap({ width, height }) {
    const topBottom = new Array(width).fill(1, 0, width);
    const middle = new Array(width).fill(0, 0, width);
    const bitmap = [];

    middle[0] = 1;
    middle[width - 1] = 1;

    bitmap.push(topBottom);

    for (let i = 0; i < height - 2; i++) {
        bitmap.push(middle);
    }

    bitmap.push(topBottom);

    return bitmap.flat();
}

it("test_array_items", () => {
    const dicomJSON = JSON.stringify(arrayItem);
    const datasets = JSON.parse(dicomJSON);
    const natural0 = DicomMetaDictionary.naturalizeDataset(datasets[0]);
    // Shouldn't throw an exception
    const natural0b = DicomMetaDictionary.naturalizeDataset(datasets[0]);
    // And should be identical to the previous version
    expect(natural0b).toEqual(natural0);
});

it("test_json_1", () => {
    //
    // multiple results example
    // from http://dicom.nema.org/medical/dicom/current/output/html/part18.html#chapter_F
    //
    const dicomJSON = `
[
    {
        "0020000D": {
        "vr": "UI",
        "Value": [ "1.2.392.200036.9116.2.2.2.1762893313.1029997326.945873" ]
    }
    },
    {
    "0020000D" : {
        "vr": "UI",
        "Value": [ "1.2.392.200036.9116.2.2.2.2162893313.1029997326.945876" ]
    }
    }
]
`;
    const datasets = JSON.parse(dicomJSON);
    const firstUID = datasets[0]["0020000D"].Value[0];
    const secondUID = datasets[1]["0020000D"].Value[0];

    //
    // make a natural version of the first study and confirm it has correct value
    //
    const naturalDICOM = DicomMetaDictionary.naturalizeDataset(datasets[0]);

    expect(naturalDICOM.StudyInstanceUID).toEqual(firstUID);

    //
    // make a natural version of a dataset with sequence tags and confirm it has correct values
    //
    const naturalSequence =
        DicomMetaDictionary.naturalizeDataset(sequenceMetadata);

    // The match object needs to be done on the actual element, not the proxied value
    expect(naturalSequence.ProcedureCodeSequence[0]).toMatchObject({
        CodeValue: "IMG1332"
    });

    // tests that single element sequences have been converted
    // from arrays to values.
    // See discussion here for more details: https://github.com/dcmjs-org/dcmjs/commit/74571a4bd6c793af2a679a31cec7e197f93e28cc
    const spacing =
        naturalSequence.SharedFunctionalGroupsSequence.PixelMeasuresSequence
            .SpacingBetweenSlices;
    expect(spacing).toEqual(0.12);
    expect(
        Array.isArray(naturalSequence.SharedFunctionalGroupsSequence)
    ).toEqual(true);

    expect(naturalSequence.ProcedureCodeSequence[0]).toMatchObject({
        CodingSchemeDesignator: "L",
        CodeMeaning: "MRI SHOULDER WITHOUT IV CONTRAST LEFT"
    });

    // expect original data to remain unnaturalized
    expect(sequenceMetadata["00081032"].Value[0]).toHaveProperty("00080100");
    expect(sequenceMetadata["00081032"].Value[0]).toHaveProperty("00080102");
    expect(sequenceMetadata["00081032"].Value[0]).toHaveProperty("00080104");

    //
    // convert to part10 and back
    //
    const dicomDict = new DicomDict(metadata);
    dicomDict.dict = datasets[1];
    const part10Buffer = dicomDict.write();

    const dicomData = dcmjs.data.DicomMessage.readFile(part10Buffer);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomData.dict
    );

    expect(dataset.StudyInstanceUID).toEqual(secondUID);
});

it("test_multiframe_1", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/MRHead/MRHead.zip";
    const unzipPath = await getZippedTestDataset(
        url,
        "MRHead.zip",
        "test_multiframe_1"
    );
    const mrHeadPath = path.join(unzipPath, "MRHead");
    const fileNames = await fsPromises.readdir(mrHeadPath);

    const datasets = [];
    fileNames.forEach(fileName => {
        const arrayBuffer = fs.readFileSync(
            path.join(mrHeadPath, fileName)
        ).buffer;
        const dicomDict = DicomMessage.readFile(arrayBuffer);
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);

        datasets.push(dataset);
    });

    const multiframe =
        dcmjs.normalizers.Normalizer.normalizeToDataset(datasets);
    const spacing =
        multiframe.SharedFunctionalGroupsSequence.PixelMeasuresSequence
            .SpacingBetweenSlices;
    const roundedSpacing = Math.round(100 * spacing) / 100;

    expect(multiframe.NumberOfFrames).toEqual(130);
    expect(roundedSpacing).toEqual(1.3);
});

it("test_oneslice_seg", async () => {
    const ctPelvisURL =
        "https://github.com/dcmjs-org/data/releases/download/CTPelvis/CTPelvis.zip";
    const segURL =
        "https://github.com/dcmjs-org/data/releases/download/CTPelvis/Lesion1_onesliceSEG.dcm";
    const unzipPath = await getZippedTestDataset(
        ctPelvisURL,
        "CTPelvis.zip",
        "test_oneslice_seg"
    );
    const segFileName = "Lesion1_onesliceSEG.dcm";

    const ctPelvisPath = path.join(
        unzipPath,
        "Series-1.2.840.113704.1.111.1916.1223562191.15"
    );

    const fileNames = await fsPromises.readdir(ctPelvisPath);

    const datasets = [];
    fileNames.forEach(fileName => {
        const arrayBuffer = fs.readFileSync(
            path.join(ctPelvisPath, fileName)
        ).buffer;
        const dicomDict = DicomMessage.readFile(arrayBuffer);
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        datasets.push(dataset);
    });

    let multiframe = dcmjs.normalizers.Normalizer.normalizeToDataset(datasets);
    const spacing =
        multiframe.SharedFunctionalGroupsSequence.PixelMeasuresSequence
            .SpacingBetweenSlices;
    const roundedSpacing = Math.round(100 * spacing) / 100;

    expect(multiframe.NumberOfFrames).toEqual(60);
    expect(roundedSpacing).toEqual(5);

    var segFilePath = await getTestDataset(segURL, segFileName);
    const arrayBuffer = fs.readFileSync(segFilePath).buffer;
    const dicomDict = DicomMessage.readFile(arrayBuffer);
    const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);

    multiframe = dcmjs.normalizers.Normalizer.normalizeToDataset([dataset]);
    expect(dataset.NumberOfFrames).toEqual(1);
    expect(multiframe.NumberOfFrames).toEqual(1);
});

it("test_normalizer_smaller", () => {
    const naturalizedTags =
        dcmjs.data.DicomMetaDictionary.naturalizeDataset(rawTags);

    const rawTagsLen = JSON.stringify(rawTags).length;
    const naturalizedTagsLen = JSON.stringify(naturalizedTags).length;
    expect(naturalizedTagsLen).toBeLessThan(rawTagsLen);
});

it("test_multiframe_us", () => {
    const file = fs.readFileSync("test/cine-test.dcm");
    const dicomData = dcmjs.data.DicomMessage.readFile(file.buffer, {
        // ignoreErrors: true,
    });
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomData.dict
    );
    // eslint-disable-next-line no-underscore-dangle
    dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(
        dicomData.meta
    );
    expect(dataset.NumberOfFrames).toEqual(8);
});

it("test_fragment_multiframe", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/encapsulation/encapsulation-fragment-multiframe.dcm";
    const dcmPath = await getTestDataset(
        url,
        "encapsulation-fragment-multiframe.dcm"
    );
    const file = fs.readFileSync(dcmPath);
    const dicomData = dcmjs.data.DicomMessage.readFile(file.buffer, {
        // ignoreErrors: true,
    });
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomData.dict
    );
    // eslint-disable-next-line no-underscore-dangle
    dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(
        dicomData.meta
    );
    expect(dataset.NumberOfFrames).toEqual(2);
});

it("test_null_number_vrs", () => {
    const dicomDict = new DicomDict({
        TransferSynxtaxUID: "1.2.840.10008.1.2.1"
    });
    dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(
        datasetWithNullNumberVRs
    );
    const part10Buffer = dicomDict.write();
    const dicomData = dcmjs.data.DicomMessage.readFile(part10Buffer);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomData.dict
    );

    expect(dataset.ImageAndFluoroscopyAreaDoseProduct).toEqual(null);
    expect(dataset.InstanceNumber).toEqual(null);
});

it("test_exponential_notation", () => {
    const file = fs.readFileSync("test/sample-dicom.dcm");
    const data = dcmjs.data.DicomMessage.readFile(file.buffer, {
        // ignoreErrors: true,
    });
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(data.dict);
    dataset.ImagePositionPatient[2] = 7.1945578383e-5;
    const buffer = data.write();
    const copy = dcmjs.data.DicomMessage.readFile(buffer);
    const datasetCopy = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        copy.dict
    );

    expect(dataset.ImagePositionPatient).toEqual(
        datasetCopy.ImagePositionPatient
    );
});

it("test_output_equality", () => {
    const file = fs.readFileSync("test/cine-test.dcm");
    const dicomData1 = dcmjs.data.DicomMessage.readFile(file.buffer, {
        // ignoreErrors: true,
    });

    const buffer = dicomData1.write();
    const dicomData2 = dcmjs.data.DicomMessage.readFile(buffer, {
        // ignoreErrors: true,
    });

    check_equality(dicomData1.meta, dicomData2.meta);
    check_equality(dicomData1.dict, dicomData2.dict);

    function check_equality(dict1, dict2) {
        Object.keys(dict1).forEach(key => {
            const elem1 = dict1[key];
            const elem2 = dict2[key];

            expect(JSON.stringify(elem1)).toEqual(JSON.stringify(elem2));
        });
    }
});

it("test_performance", async () => {
    const file = fs.readFileSync("test/cine-test.dcm");
    let buffer = file.buffer;
    let json;
    const start = Date.now();

    for (let i = 0; i < 100; ++i) {
        let old = json;
        json = DicomMessage.readFile(buffer);
        buffer = json.write();

        if (i > 0) {
            check_equality(old.meta, json.meta);
            check_equality(old.dict, json.dict);
        }
    }

    function check_equality(dict1, dict2) {
        Object.keys(dict1).forEach(key => {
            const elem1 = dict1[key];
            const elem2 = dict2[key];

            expect(JSON.stringify(elem1)).toEqual(JSON.stringify(elem2));
        });
    }

    console.log(`Finished. Total Time elapsed: ${Date.now() - start} ms`);
});

it("test_invalid_vr_length", () => {
    const file = fs.readFileSync("test/invalid-vr-length-test.dcm");
    const dicomDict = dcmjs.data.DicomMessage.readFile(file.buffer);

    expect(() =>
        writeToBuffer(dicomDict, { allowInvalidVRLength: false })
    ).toThrow();
    expect(() =>
        writeToBuffer(dicomDict, { allowInvalidVRLength: true })
    ).not.toThrow();

    function writeToBuffer(dicomDict, options) {
        return dicomDict.write(options);
    }
});

it("test_encapsulation", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/encapsulation/encapsulation.dcm";
    const dcmPath = await getTestDataset(url, "encapsulation.dcm");

    // given
    const arrayBuffer = fs.readFileSync(dcmPath).buffer;
    const dicomDict = DicomMessage.readFile(arrayBuffer);

    dicomDict.upsertTag("60000010", "US", 30); // Overlay Rows
    dicomDict.upsertTag("60000011", "US", 30); // Overlay Columns
    dicomDict.upsertTag("60000040", "CS", "G"); // Overlay Type
    dicomDict.upsertTag("60000045", "LO", "AUTOMATED"); // Overlay Subtype
    dicomDict.upsertTag("60000050", "SS", [1 + 50, 1 + 50]); // Overlay Origin

    let overlay = dcmjs.data.BitArray.pack(
        makeOverlayBitmap({ width: 30, height: 30 })
    );

    if (overlay.length % 2 !== 0) {
        const newOverlay = new Uint8Array(overlay.length + 1);

        newOverlay.set(overlay);
        newOverlay.set([0], overlay.length);

        overlay = newOverlay;
    }

    dicomDict.upsertTag("60003000", "OB", [overlay.buffer]);

    // when
    const lengths = [];
    const stream = new ReadBufferStream(
            dicomDict.write({ fragmentMultiframe: false })
        ),
        useSyntax = EXPLICIT_LITTLE_ENDIAN;

    stream.reset();
    stream.increment(128);

    if (stream.readAsciiString(4) !== "DICM") {
        throw new Error("Invalid a dicom file");
    }

    const el = DicomMessage._readTag(stream, useSyntax),
        metaLength = el.values[0]; //read header buffer
    const metaStream = stream.more(metaLength);
    const metaHeader = DicomMessage._read(metaStream, useSyntax); //get the syntax
    let mainSyntax = metaHeader["00020010"].Value[0];

    mainSyntax = DicomMessage._normalizeSyntax(mainSyntax);

    while (!stream.end()) {
        const group = new Uint16Array(stream.buffer, stream.offset, 1)[0]
            .toString(16)
            .padStart(4, "0");
        const element = new Uint16Array(stream.buffer, stream.offset + 2, 1)[0]
            .toString(16)
            .padStart(4, "0");

        if (group.concat(element) === "60003000") {
            // Overlay Data
            const length = Buffer.from(
                new Uint8Array(stream.buffer, stream.offset + 8, 4)
            ).readUInt32LE(0);

            lengths.push(length);
        }

        if (group.concat(element) === "7fe00010") {
            // Pixel Data
            const length = Buffer.from(
                new Uint8Array(stream.buffer, stream.offset + 8, 4)
            ).readUInt32LE(0);

            lengths.push(length);
        }

        DicomMessage._readTag(stream, mainSyntax);
    }

    // then
    expect(lengths[0]).not.toEqual(0xffffffff);
    expect(lengths[1]).toEqual(0xffffffff);
});

it("test_custom_dictionary", () => {
    const customDictionary = DicomMetaDictionary.dictionary;

    customDictionary["(0013,1010)"] = {
        tag: "(0013,1010)",
        vr: "LO",
        name: "TrialName",
        vm: "1",
        version: "Custom"
    };

    const dicomMetaDictionary = new DicomMetaDictionary(customDictionary);
    const dicomDict = new DicomDict(metadata);
    minimalDataset["TrialName"] = "Test Trial";
    dicomDict.dict = dicomMetaDictionary.denaturalizeDataset(minimalDataset);
    const part10Buffer = dicomDict.write();
    const dicomData = DicomMessage.readFile(part10Buffer);
    const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict);

    expect(dataset.TrialName).toEqual("Test Trial");
    //check that all other fields were preserved, 15 original + 1 for _vr and +1 for "TrialName"
    expect(Object.keys(dataset).length).toEqual(17);
});

it("Reads DICOM with multiplicity", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/multiplicity/multiplicity.dcm";
    const dcmPath = await getTestDataset(url, "multiplicity.dcm");
    const file = await promisify(fs.readFile)(dcmPath);
    const dicomDict = DicomMessage.readFile(file.buffer);

    expect(dicomDict.dict["00101020"].Value).toEqual([1, 2]);
    expect(dicomDict.dict["0018100B"].Value).toEqual(["1.2", "3.4"]);
});

it("Reads DICOM with PersonName multiplicity", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/multiplicity2/multiplicity.2.dcm";
    const dcmPath = await getTestDataset(url, "multiplicity.2.dcm");
    const file = await promisify(fs.readFile)(dcmPath);
    const dicomDict = DicomMessage.readFile(file.buffer);

    expect(dicomDict.dict["00081070"].Value).toEqual([
        { Alphabetic: "Doe^John" },
        { Alphabetic: "Doe^Jane" }
    ]);
});

it("Reads binary data into an ArrayBuffer", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/binary-tag/binary-tag.dcm";
    const dcmPath = await getTestDataset(url, "binary-tag.dcm");

    const file = await promisify(fs.readFile)(dcmPath);
    const dicomDict = DicomMessage.readFile(file.buffer);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomDict.dict
    );

    expect(dataset.PixelData).toBeInstanceOf(Array);
    expect(dataset.PixelData[0]).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(dataset.PixelData[0])]).toEqual([2, 3, 4, 5, 6]);
});

it("Reads a multiframe DICOM which has trailing padding", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/binary-parsing-stressors/multiframe-ultrasound.dcm";
    const dcmPath = await getTestDataset(url, "multiframe-ultrasound.dcm");
    const dicomDict = DicomMessage.readFile(fs.readFileSync(dcmPath).buffer);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomDict.dict
    );

    expect(dataset.PixelData.length).toEqual(29);
    expect(dataset.PixelData[0]).toBeInstanceOf(ArrayBuffer);
    expect(dataset.PixelData[0].byteLength).toEqual(104976);
    expect(dataset.PixelData[1].byteLength).toEqual(104920);
    expect(dataset.PixelData[27].byteLength).toEqual(103168);
    expect(dataset.PixelData[28].byteLength).toEqual(103194);
});

it("Reads a multiframe DICOM with large private tags before and after the image data", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/binary-parsing-stressors/large-private-tags.dcm";
    const dcmPath = await getTestDataset(url, "large-private-tags.dcm");
    const dicomDict = DicomMessage.readFile(fs.readFileSync(dcmPath).buffer);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomDict.dict
    );

    expect(dataset.PixelData).toBeInstanceOf(Array);
    expect(dataset.PixelData.length).toEqual(130);
    expect(dataset.PixelData[0]).toBeInstanceOf(ArrayBuffer);
    expect(dataset.PixelData[0].byteLength).toEqual(61518);
    expect(dataset.PixelData[1].byteLength).toEqual(61482);
    expect(dataset.PixelData[128].byteLength).toEqual(62144);
    expect(dataset.PixelData[129].byteLength).toEqual(62148);
});

it("Writes encapsulated OB data which has an odd length with a padding byte in its last fragment", async () => {
    const pixelData = [1, 2, 3];

    const dataset = DicomMetaDictionary.denaturalizeDataset({
        PixelData: [new Uint8Array(pixelData).buffer],
        _vrMap: { PixelData: "OB" }
    });

    const stream = new WriteBufferStream(1024);
    const bytesWritten = DicomMessage.write(
        dataset,
        stream,
        "1.2.840.10008.1.2.4.50" // JPEG baseline (an encapsulated format)
    );

    expect(bytesWritten).toEqual(44);
    expect([...new Uint32Array(stream.view.buffer, 0, 11)]).toEqual([
        0x00107fe0, // PixelData tag's group & element
        0x0000424f, // VR type "OB"
        0xffffffff, // Value length (0xffffffff here indicates an undefined length)
        0xe000fffe, // SequenceItemTag for the BOT (basic offset table)
        0x00000004, // Size in bytes of the BOT
        0x00000000, // First (and only) offset in the BOT
        0xe000fffe, // SequenceItemTag
        0x00000004, // SequenceItemTag's length in bytes
        0x00030201, // The actual data for this fragment (specified above), with padding
        0xe0ddfffe, // SequenceDelimiterTag
        0x00000000 // SequenceDelimiterTag value (always zero)
    ]);
});

it("test_deflated", async () => {
    const url =
        "https://github.com/dcmjs-org/data/releases/download/deflate-transfer-syntax/deflate_tests.zip";
    const unzipPath = await getZippedTestDataset(
        url,
        "deflate_tests.zip",
        "deflate_tests"
    );
    const deflatedPath = path.join(unzipPath, "deflate_tests");

    const expected = [
        {
            file: "image_dfl",
            tags: { Modality: "OT", Rows: 512, Columns: 512 }
        },
        {
            file: "report_dfl",
            tags: {
                Modality: "SR",
                VerificationFlag: "UNVERIFIED",
                ContentDate: "20001110"
            }
        },
        {
            file: "wave_dfl",
            tags: {
                Modality: "ECG",
                SynchronizationTrigger: "NO TRIGGER",
                ContentDate: "19991223"
            }
        }
    ];

    expected.forEach(e => {
        const buffer = fs.readFileSync(path.join(deflatedPath, e.file));
        const dicomDict = DicomMessage.readFile(
            buffer.buffer.slice(
                buffer.byteOffset,
                buffer.byteOffset + buffer.byteLength
            )
        );
        const dataset = DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
        Object.keys(e.tags).forEach(t => {
            expect(dataset[t]).toEqual(e.tags[t]);
        });
    });
});

describe("With a SpecificCharacterSet tag", () => {
    it("Reads a long string in the '' character set", async () => {
        expect(readEncodedLongString("", [0x68, 0x69])).toEqual("hi");
    });

    it("Reads a long string in the ISO_IR 6 (default) character set", async () => {
        expect(readEncodedLongString("ISO_IR 6", [0x68, 0x69])).toEqual("hi");
    });

    it("Reads a long string in the ISO_IR 13 (shift-jis) character set", async () => {
        expect(readEncodedLongString("ISO_IR 13", [0x83, 0x8b])).toEqual("ル");
    });

    it("Reads a long string in the ISO_IR 166 (tis-620) character set", async () => {
        expect(readEncodedLongString("ISO_IR 166", [0xb9, 0xf7])).toEqual("น๗");
    });

    it("Reads a long string in the ISO_IR 192 (utf-8) character set", async () => {
        expect(readEncodedLongString("ISO_IR 192", [0xed, 0x95, 0x9c])).toEqual(
            "한"
        );
    });

    it("Throws an exception on an unsupported character set", async () => {
        log.setLevel(5);
        expect(() => readEncodedLongString("nope", [])).toThrow(
            new Error("Unsupported character set: nope")
        );
    });

    it("Doesn't throw an exception on an unsupported character set when ignoring errors", async () => {
        log.setLevel(5);
        expect(
            readEncodedLongString("nope", [0x68, 0x69], { ignoreErrors: true })
        ).toEqual("hi");
    });

    it("Throws an exception on multiple character sets", async () => {
        expect(() =>
            readEncodedLongString("ISO_IR 13\\ISO_IR 166", [])
        ).toThrow(
            /Using multiple character sets is not supported: ISO_IR 13,ISO_IR 166/
        );
    });

    it("Doesn't throw an exception on multiple character sets when ignoring errors", async () => {
        expect(
            readEncodedLongString("ISO_IR 13\\ISO_IR 166", [0x68, 0x69], {
                ignoreErrors: true
            })
        ).toEqual("hi");
    });

    function readEncodedLongString(
        specificCharacterSet,
        encodedBytes,
        readOptions = { ignoreErrors: false }
    ) {
        // Pad to even lengths with spaces if needed
        if (specificCharacterSet.length & 1) {
            specificCharacterSet += " ";
        }
        if (encodedBytes.length & 1) {
            encodedBytes.push(PADDING_SPACE);
        }

        // Manually construct the binary representation for the following two tags:
        // - Tag #1: SpecificCharacterSet specifying the character set
        // - Tag #2: InstitutionName which is a long string tag that will have its value
        //           set to the encoded bytes
        const stream = new WriteBufferStream(
            16 + specificCharacterSet.length + encodedBytes.length
        );
        stream.isLittleEndian = true;

        // Write SpecificCharacterSet tag
        stream.writeUint32(0x00050008);
        stream.writeUint32(specificCharacterSet.length);
        stream.writeAsciiString(specificCharacterSet);

        // Write InstitutionName tag
        stream.writeUint32(0x00800008);
        stream.writeUint32(encodedBytes.length);
        for (const encodedByte of encodedBytes) {
            stream.writeUint8(encodedByte);
        }

        // Read the stream back to get the value of the InstitutionName tag
        const readResult = DicomMessage._read(
            new ReadBufferStream(stream.buffer),
            IMPLICIT_LITTLE_ENDIAN,
            readOptions
        );

        // Return the resulting UTF-8 string value for InstitutionName
        return readResult["00080080"].Value[0];
    }
});

it("Reads and writes numbers with NaN and Infinity values of tags with type FD (double float)", () => {
    const dicomDict = new DicomDict({
        TransferSynxtaxUID: EXPLICIT_LITTLE_ENDIAN
    });

    dicomDict.dict = DicomMetaDictionary.denaturalizeDataset({
        LongitudinalTemporalOffsetFromEvent: NaN,
        SequenceOfUltrasoundRegions: [{ PhysicalDeltaX: Infinity }]
    });

    const part10Buffer = dicomDict.write();
    const dicomData = dcmjs.data.DicomMessage.readFile(part10Buffer);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomData.dict
    );

    expect(dataset.LongitudinalTemporalOffsetFromEvent).toEqual(NaN);
    expect(dataset.SequenceOfUltrasoundRegions[0].PhysicalDeltaX).toEqual(
        Infinity
    );
});

it("Tests that reading fails on a DICOM without a meta length tag", () => {
    const rawFile = fs.readFileSync("test/no-meta-length-test.dcm");

    let arrayBuffer = rawFile.buffer;
    if (
        rawFile.byteOffset !== 0 ||
        rawFile.byteLength !== arrayBuffer.byteLength
    ) {
        arrayBuffer = arrayBuffer.slice(
            rawFile.byteOffset,
            rawFile.byteOffset + rawFile.byteLength
        );
    }

    expect(() => {
        dcmjs.data.DicomMessage.readFile(arrayBuffer, {
            ignoreErrors: false,
            untilTag: "0020000E",
            includeUntilTagValue: true
        });
    }).toThrow(
        "Invalid DICOM file, meta length tag is malformed or not present."
    );
});

describe("The same DICOM file loaded from both DCM and JSON", () => {
    let dicomData;
    let jsonData;

    beforeEach(() => {
        const file = fs.readFileSync("test/sample-sr.dcm");
        dicomData = dcmjs.data.DicomMessage.readFile(file.buffer, {
            // ignoreErrors: true,
        });
        jsonData = JSON.parse(JSON.stringify(sampleDicomSR));
    });

    describe("naturalized datasets", () => {
        let dcmDataset;
        let jsonDataset;

        beforeEach(() => {
            dcmDataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
                dicomData.dict
            );
            jsonDataset =
                dcmjs.data.DicomMetaDictionary.naturalizeDataset(jsonData);
        });

        it("Compares denaturalized PersonName values and accessors", () => {
            const jsonDenaturalized =
                dcmjs.data.DicomMetaDictionary.denaturalizeDataset(jsonDataset);
            const dcmDenaturalized =
                dcmjs.data.DicomMetaDictionary.denaturalizeDataset(dcmDataset);

            // These check to ensure when new denaturalized tags are created we're adding
            // accessors to them, as well as the value accessors.
            // This is specific to PN VRs.
            expect(jsonDataset.OperatorsName.__hasValueAccessors).toBe(true);
            expect(dcmDataset.OperatorsName.__hasValueAccessors).toBe(true);
            expect(
                jsonDenaturalized["00081070"].Value.__hasValueAccessors
            ).toBe(true);
            expect(dcmDenaturalized["00081070"].Value.__hasValueAccessors).toBe(
                true
            );
            expect(jsonDataset.__hasTagAccessors).toBe(true);
            expect(dcmDataset.__hasTagAccessors).toBe(true);
            expect(jsonDenaturalized["00081070"].__hasTagAccessors).toBe(true);
            expect(dcmDenaturalized["00081070"].__hasTagAccessors).toBe(true);
            expect(jsonDenaturalized["00081070"]).not.toBe(
                jsonDataset.OperatorsName
            );
            expect(dcmDenaturalized["00081070"]).not.toBe(
                dcmDataset.OperatorsName
            );
        });

        it("Compares dcm rebuilt from json with original", () => {
            const dicomDict = new dcmjs.data.DicomDict(dicomData.meta);
            dicomDict.dict =
                dcmjs.data.DicomMetaDictionary.denaturalizeDataset(jsonDataset);

            const buffer = dicomDict.write();

            const rebuiltData = dcmjs.data.DicomMessage.readFile(buffer);

            expect(JSON.stringify(rebuiltData)).toEqual(
                JSON.stringify(dicomData)
            );
        });

        it("Adds a new PN tag", () => {
            jsonDataset.PerformingPhysicianName = { Alphabetic: "Doe^John" };

            expect(String(jsonDataset.PerformingPhysicianName)).toEqual(
                "Doe^John"
            );
            expect(JSON.stringify(jsonDataset.PerformingPhysicianName)).toEqual(
                '[{"Alphabetic":"Doe^John"}]'
            );
        });

        // Multiplicity
        describe("multiplicity", () => {
            it("Compares naturalized values", () => {
                expect(JSON.stringify(jsonDataset.OtherPatientNames)).toEqual(
                    JSON.stringify(dcmDataset.OtherPatientNames)
                );
                expect(jsonDataset.OtherPatientNames.toString()).toEqual(
                    dcmDataset.OtherPatientNames.toString()
                );
            });

            it("Checks dicom output string", () => {
                expect(String(jsonDataset.OtherPatientNames)).toEqual(
                    "Doe^John=Johnny=Jonny\\Doe^Jane=Janie=Jayne"
                );
                expect(String(dcmDataset.OtherPatientNames)).toEqual(
                    "Doe^John=Johnny=Jonny\\Doe^Jane=Janie=Jayne"
                );
            });

            it("Adds additional names", () => {
                jsonDataset.OtherPatientNames.push("Test==Name");
                expect(JSON.stringify(jsonDataset.OtherPatientNames)).toContain(
                    `,{"Alphabetic":"Test","Phonetic":"Name"}]`
                );

                jsonDataset.OtherPatientNames.push({ Alphabetic: "Test2" });
                expect(JSON.stringify(jsonDataset.OtherPatientNames)).toContain(
                    `,{"Alphabetic":"Test2"}]`
                );

                dcmDataset.OtherPatientNames.push("Test==Name");
                expect(JSON.stringify(dcmDataset.OtherPatientNames)).toContain(
                    `,{"Alphabetic":"Test","Phonetic":"Name"}]`
                );

                dcmDataset.OtherPatientNames.push({
                    Alphabetic: "Test2"
                });
                expect(JSON.stringify(dcmDataset.OtherPatientNames)).toContain(
                    `,{"Alphabetic":"Test2"}]`
                );
            });
        });

        // OperatorName is three-component name
        describe("multiple-component name", () => {
            it("Compares denaturalized values", () => {
                const jsonDenaturalized =
                    dcmjs.data.DicomMetaDictionary.denaturalizeDataset(
                        jsonDataset
                    );
                const dcmDenaturalized =
                    dcmjs.data.DicomMetaDictionary.denaturalizeDataset(
                        dcmDataset
                    );

                expect(jsonDenaturalized["00081070"].Value).toEqual([
                    {
                        Alphabetic: "Operator^John^^Mr.^Sr.",
                        Ideographic: "John Operator",
                        Phonetic: "O-per-a-tor"
                    }
                ]);
                expect(jsonDenaturalized["00081070"].Value).toEqual(
                    dcmDenaturalized["00081070"].Value
                );
                expect(jsonDenaturalized["00081070"].Value).toEqual(
                    jsonDataset.OperatorsName
                );
                expect(String(jsonDenaturalized["00081070"].Value)).toEqual(
                    String(jsonDataset.OperatorsName)
                );
                expect(
                    JSON.stringify(jsonDenaturalized["00081070"].Value)
                ).toEqual(JSON.stringify(jsonDataset.OperatorsName));
            });

            it("Compares changed values", () => {
                jsonDataset.OperatorsName.Alphabetic =
                    dcmDataset.OperatorsName.Alphabetic = "Doe^John";
                jsonDataset.OperatorsName.Ideographic =
                    dcmDataset.OperatorsName.Ideographic = undefined;
                jsonDataset.OperatorsName.Phonetic =
                    dcmDataset.OperatorsName.Phonetic = undefined;

                expect(JSON.stringify(jsonDataset.OperatorsName)).toEqual(
                    JSON.stringify(dcmDataset.OperatorsName)
                );
                expect(jsonDataset.OperatorsName.toString()).toEqual(
                    dcmDataset.OperatorsName.toString()
                );

                const jsonDenaturalized =
                    dcmjs.data.DicomMetaDictionary.denaturalizeDataset(
                        jsonDataset
                    );
                const dcmDenaturalized =
                    dcmjs.data.DicomMetaDictionary.denaturalizeDataset(
                        dcmDataset
                    );

                expect(jsonDenaturalized["00081070"].Value).toEqual([
                    { Alphabetic: "Doe^John" }
                ]);
                expect(jsonDenaturalized["00081070"].Value).toEqual(
                    dcmDenaturalized["00081070"].Value
                );
            });
        });
    });

    describe("unnaturalized datasets", () => {
        it("Upserting a name", () => {
            // PerformingPhysicianName
            dicomData.upsertTag("00081050", "PN", "Test^Name=Upsert\\Test");
            expect(String(dicomData.dict["00081050"].Value)).toEqual(
                "Test^Name=Upsert\\Test"
            );
            expect(dicomData.dict["00081050"].Value).toBeInstanceOf(String);
            expect(JSON.stringify(dicomData.dict["00081050"].Value)).toEqual(
                '[{"Alphabetic":"Test^Name","Ideographic":"Upsert"},{"Alphabetic":"Test"}]'
            );

            // Upsert a second time on the same tag to overwrite it.
            dicomData.upsertTag("00081050", "PN", "Another=Upsert\\Testing");

            expect(String(dicomData.dict["00081050"].Value)).toEqual(
                "Another=Upsert\\Testing"
            );
            expect(dicomData.dict["00081050"].Value).toBeInstanceOf(String);
            expect(JSON.stringify(dicomData.dict["00081050"].Value)).toEqual(
                '[{"Alphabetic":"Another","Ideographic":"Upsert"},{"Alphabetic":"Testing"}]'
            );

            // Upsert a third time on the same tag, with a naked object.
            dicomData.upsertTag("00081050", "PN", {
                Alphabetic: "Object^Testing"
            });
            expect(dicomData.dict["00081050"].Value).toEqual({
                Alphabetic: "Object^Testing"
            });
            expect(JSON.stringify(dicomData.dict["00081050"].Value)).toEqual(
                '[{"Alphabetic":"Object^Testing"}]'
            );

            // Upsert a fourth time on the same tag, with a full object.
            dicomData.upsertTag("00081050", "PN", [
                {
                    Alphabetic: "Object^Testing^Complete"
                }
            ]);
            expect(dicomData.dict["00081050"].Value).toEqual([
                {
                    Alphabetic: "Object^Testing^Complete"
                }
            ]);
            expect(JSON.stringify(dicomData.dict["00081050"].Value)).toEqual(
                '[{"Alphabetic":"Object^Testing^Complete"}]'
            );
        });

        describe("Multiplicity", () => {
            it("Checks raw output string", () => {
                expect(String(dicomData.dict["00101001"].Value)).toEqual(
                    "Doe^John=Johnny=Jonny\\Doe^Jane=Janie=Jayne"
                );
                expect(dicomData.dict["00101001"].Value).toEqual([
                    {
                        Alphabetic: "Doe^John",
                        Ideographic: "Johnny",
                        Phonetic: "Jonny"
                    },
                    {
                        Alphabetic: "Doe^Jane",
                        Ideographic: "Janie",
                        Phonetic: "Jayne"
                    }
                ]);
                expect(
                    JSON.stringify(dicomData.dict["00101001"].Value)
                ).toEqual(
                    '[{"Alphabetic":"Doe^John","Ideographic":"Johnny","Phonetic":"Jonny"},{"Alphabetic":"Doe^Jane","Ideographic":"Janie","Phonetic":"Jayne"}]'
                );
            });
        });
    });
});

describe("test_un_vr", () => {
    it("Tag with UN vr should be parsed according VR in dictionary", async () => {
        const expectedExposureIndex = 662;
        const expectedDeviationIndex = -1.835;

        const url =
            "https://github.com/dcmjs-org/data/releases/download/unknown-VR/sample-dicom-with-un-vr.dcm";
        const dcmPath = await getTestDataset(
            url,
            "sample-dicom-with-un-vr.dcm"
        );

        const file = await promisify(fs.readFile)(dcmPath);
        const dicomData = dcmjs.data.DicomMessage.readFile(file.buffer, {
            ignoreErrors: false,
            untilTag: null,
            includeUntilTagValue: false,
            noCopy: false
        });
        const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
            dicomData.dict
        );

        expect(dataset.ExposureIndex).toEqual(expectedExposureIndex);
        expect(dataset.DeviationIndex).toEqual(expectedDeviationIndex);
    });

    describe("Test other VRs encoded as UN", () => {
        test.each([
            [
                "00000600",
                "AE",
                new Uint8Array([
                    0x20, 0x20, 0x54, 0x45, 0x53, 0x54, 0x5f, 0x41, 0x45, 0x20
                ]).buffer,
                ["  TEST_AE "],
                ["TEST_AE"]
            ],
            [
                "00101010",
                "AS",
                new Uint8Array([0x30, 0x34, 0x35, 0x59]).buffer,
                ["045Y"],
                ["045Y"]
            ],
            [
                "00280009",
                "AT",
                new Uint8Array([0x63, 0x10, 0x18, 0x00]).buffer,
                [0x10630018],
                [0x10630018]
            ],
            [
                "00041130",
                "CS",
                new Uint8Array([
                    0x4f, 0x52, 0x49, 0x47, 0x49, 0x4e, 0x41, 0x4c, 0x20, 0x20,
                    0x5c, 0x20, 0x50, 0x52, 0x49, 0x4d, 0x41, 0x52, 0x59, 0x20
                ]).buffer,
                ["ORIGINAL  ", " PRIMARY"],
                ["ORIGINAL", "PRIMARY"]
            ],
            [
                "00181012",
                "DA",
                new Uint8Array([0x32, 0x30, 0x32, 0x34, 0x30, 0x31, 0x30, 0x31])
                    .buffer,
                ["20240101"],
                ["20240101"]
            ],
            [
                "00181041",
                "DS",
                new Uint8Array([
                    0x30, 0x30, 0x30, 0x30, 0x31, 0x32, 0x33, 0x2e, 0x34, 0x35
                ]).buffer,
                ["0000123.45"],
                [123.45]
            ],
            [
                "00181078",
                "DT",
                new Uint8Array([
                    0x32, 0x30, 0x32, 0x34, 0x30, 0x31, 0x30, 0x31, 0x31, 0x32,
                    0x33, 0x30, 0x34, 0x35, 0x2e, 0x31, 0x20, 0x20
                ]).buffer,
                ["20240101123045.1  "],
                ["20240101123045.1  "]
            ],
            [
                "00182043",
                "FL",
                new Uint8Array([0x66, 0x66, 0xa6, 0x3f, 0x66, 0x66, 0xa6, 0x3f])
                    .buffer,
                [1.2999999523162842, 1.2999999523162842],
                [1.2999999523162842, 1.2999999523162842]
            ],
            [
                "00186028",
                "FD",
                new Uint8Array([0x11, 0x2d, 0x44, 0x54, 0xfb, 0x21, 0x09, 0x40])
                    .buffer,
                [3.14159265358979],
                [3.14159265358979]
            ],
            [
                "00200012",
                "IS",
                new Uint8Array([0x20, 0x2b, 0x32, 0x37, 0x38, 0x39, 0x33, 0x20])
                    .buffer,
                [" +27893 "],
                [27893]
            ],
            [
                "0018702A",
                "LO",
                new Uint8Array([
                    0x20, 0x20, 0x46, 0x65, 0x65, 0x6c, 0x69, 0x6e, 0x67, 0x20,
                    0x6e, 0x61, 0x75, 0x73, 0x65, 0x6f, 0x75, 0x73, 0x20, 0x20
                ]).buffer,
                ["  Feeling nauseous  "],
                ["Feeling nauseous"]
            ],
            [
                "00187040",
                "LT",
                new Uint8Array([
                    0x20, 0x20, 0x46, 0x65, 0x65, 0x6c, 0x69, 0x6e, 0x67, 0x20,
                    0x6e, 0x61, 0x75, 0x73, 0x65, 0x6f, 0x75, 0x73, 0x20, 0x20
                ]).buffer,
                ["  Feeling nauseous  "],
                ["  Feeling nauseous"]
            ],
            [
                "00282000",
                "OB",
                new Uint8Array([0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88])
                    .buffer,
                [
                    new Uint8Array([
                        0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88
                    ]).buffer
                ],
                [
                    new Uint8Array([
                        0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88
                    ]).buffer
                ]
            ],
            [
                "00701A07",
                "OD",
                new Uint8Array([0x00, 0x00, 0x00, 0x54, 0x34, 0x6f, 0x9d, 0x41])
                    .buffer,
                [
                    new Uint8Array([
                        0x00, 0x00, 0x00, 0x54, 0x34, 0x6f, 0x9d, 0x41
                    ]).buffer
                ],
                [
                    new Uint8Array([
                        0x00, 0x00, 0x00, 0x54, 0x34, 0x6f, 0x9d, 0x41
                    ]).buffer
                ]
            ],
            [
                "00720067",
                "OF",
                new Uint8Array([
                    0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0x30, 0xc0, 0x00, 0x00,
                    0xf6, 0x42
                ]).buffer,
                [
                    new Uint8Array([
                        0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0x30, 0xc0, 0x00,
                        0x00, 0xf6, 0x42
                    ]).buffer
                ],
                [
                    new Uint8Array([
                        0x00, 0x00, 0x28, 0x41, 0x00, 0x00, 0x30, 0xc0, 0x00,
                        0x00, 0xf6, 0x42
                    ]).buffer
                ]
            ],
            [
                "00281224",
                "OW",
                new Uint8Array([0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88])
                    .buffer,
                [
                    new Uint8Array([
                        0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88
                    ]).buffer
                ],
                [
                    new Uint8Array([
                        0x13, 0x40, 0x80, 0x88, 0x88, 0x90, 0x88, 0x88
                    ]).buffer
                ]
            ],
            [
                "00080090",
                "PN",
                new Uint8Array([
                    0x44, 0x6f, 0x65, 0x5e, 0x4a, 0x6f, 0x68, 0x6e, 0x5e, 0x41,
                    0x5e, 0x4a, 0x72, 0x2e, 0x5e, 0x4d, 0x44, 0x3d, 0x44, 0x6f,
                    0x65, 0x5e, 0x4a, 0x61, 0x79, 0x5e, 0x41, 0x5e, 0x4a, 0x72,
                    0x2e, 0x20
                ]).buffer,
                ["Doe^John^A^Jr.^MD=Doe^Jay^A^Jr."],
                [
                    {
                        Alphabetic: "Doe^John^A^Jr.^MD",
                        Ideographic: "Doe^Jay^A^Jr."
                    }
                ]
            ],
            [
                "00080094",
                "SH",
                new Uint8Array([
                    0x43, 0x54, 0x5f, 0x53, 0x43, 0x41, 0x4e, 0x5f, 0x30, 0x31
                ]).buffer,
                ["CT_SCAN_01"],
                ["CT_SCAN_01"]
            ],
            [
                "00186020",
                "SL",
                new Uint8Array([0x40, 0xe2, 0x01, 0x00, 0x40, 0xe2, 0x01, 0x00])
                    .buffer,
                [123456, 123456],
                [123456, 123456]
            ],
            [
                "00189219",
                "SS",
                new Uint8Array([0xd2, 0x04, 0xd2, 0x04, 0xd2, 0x04]).buffer,
                [1234, 1234, 1234],
                [1234, 1234, 1234]
            ],
            [
                "00189373",
                "ST",
                new Uint8Array([
                    0x20, 0x20, 0x46, 0x65, 0x65, 0x6c, 0x69, 0x6e, 0x67, 0x20,
                    0x6e, 0x61, 0x75, 0x73, 0x65, 0x6f, 0x75, 0x73, 0x20, 0x20
                ]).buffer,
                ["  Feeling nauseous  "],
                ["  Feeling nauseous"]
            ],
            [
                "21000050",
                "TM",
                new Uint8Array([
                    0x34, 0x32, 0x35, 0x33, 0x30, 0x2e, 0x31, 0x32, 0x33, 0x34,
                    0x35, 0x36
                ]).buffer,
                ["42530.123456"],
                ["42530.123456"]
            ],
            [
                "3010001B",
                "UC",
                new Uint8Array([
                    0x54, 0x72, 0x61, 0x69, 0x6c, 0x69, 0x6e, 0x67, 0x20, 0x73,
                    0x70, 0x61, 0x63, 0x65, 0x73, 0x20, 0x61, 0x6c, 0x6c, 0x6f,
                    0x77, 0x65, 0x64, 0x20, 0x20, 0x20
                ]).buffer,
                ["Trailing spaces allowed   "],
                ["Trailing spaces allowed"]
            ],
            [
                "00041510",
                "UI",
                new Uint8Array([
                    0x31, 0x2e, 0x32, 0x2e, 0x38, 0x34, 0x30, 0x2e, 0x31, 0x30,
                    0x30, 0x30, 0x38, 0x2e, 0x31, 0x2e, 0x32, 0x2e, 0x31
                ]).buffer,
                ["1.2.840.10008.1.2.1"],
                ["1.2.840.10008.1.2.1"]
            ],
            [
                "30100092",
                "UL",
                new Uint8Array([0x40, 0xe2, 0x01, 0x00]).buffer,
                [123456],
                [123456]
            ],
            [
                "0008010E",
                "UR",
                new Uint8Array([
                    0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x64, 0x69, 0x63,
                    0x6f, 0x6d, 0x2e, 0x6e, 0x65, 0x6d, 0x61, 0x2e, 0x6f, 0x72,
                    0x67, 0x20
                ]).buffer,
                ["http://dicom.nema.org "],
                ["http://dicom.nema.org "]
            ],
            [
                "00080301",
                "US",
                new Uint8Array([0xd2, 0x04]).buffer,
                [1234],
                [1234]
            ],
            [
                "0008030E",
                "UT",
                new Uint8Array([
                    0x20, 0x20, 0x46, 0x65, 0x65, 0x6c, 0x69, 0x6e, 0x67, 0x20,
                    0x6e, 0x61, 0x75, 0x73, 0x65, 0x6f, 0x75, 0x73, 0x20, 0x20
                ]).buffer,
                ["  Feeling nauseous  "],
                ["  Feeling nauseous"]
            ]
        ])(
            "for tag %s with expected VR %p",
            (tag, vr, byteArray, expectedRawValue, expectedValue) => {
                // setup input tag as UN
                const dataset = {
                    [tag]: {
                        vr: "UN",
                        _rawValue: [byteArray],
                        Value: [byteArray]
                    }
                };

                const dicomDict = new DicomDict({});
                dicomDict.dict = dataset;

                // Write and re-read
                const outputDicomDict = DicomMessage.readFile(
                    dicomDict.write(),
                    { forceStoreRaw: true }
                );

                // Expect tag to be parsed correctly based on meta dictionary vr lookup
                expect(outputDicomDict.dict[tag].vr).toEqual(vr);
                expect(outputDicomDict.dict[tag]._rawValue).toEqual(
                    expectedRawValue
                );
                expect(outputDicomDict.dict[tag].Value).toEqual(expectedValue);
            }
        );
    });
});

describe("Save original non-standard VR and check dataset after denaturalized", () => {
    const dicomTagsWithNonStandardVr = {
        dict: {
            "00283010": {
                vr: "SQ",
                Value: [
                    {
                        "00283002": {
                            vr: "US",
                            Value: [0, 0, 16]
                        },
                        "00283003": {
                            vr: "LO",
                            Value: ["NORMAL"]
                        },
                        "00283006": {
                            vr: "OW", // US by standard
                            Value: [new ArrayBuffer()]
                        }
                    },
                    {
                        "00283002": {
                            vr: "US",
                            Value: [0, 0, 16]
                        },
                        "00283003": {
                            vr: "LO",
                            Value: ["HARDER"]
                        },
                        "00283006": {
                            vr: "OW", // US by standard
                            Value: [new ArrayBuffer()]
                        }
                    },
                    {
                        "00283002": {
                            vr: "US",
                            Value: [0, 0, 16]
                        },
                        "00283003": {
                            vr: "LO",
                            Value: ["SOFTER"]
                        },
                        "00283006": {
                            vr: "OW", // US by standard
                            Value: [new ArrayBuffer()]
                        }
                    }
                ]
            },
            "00180015": {
                vr: "CS",
                Value: ["CHEST"]
            },
            "00080060": {
                vr: "CS",
                Value: ["DX"]
            },
            "00100010": {
                vr: "PN",
                Value: [
                    {
                        Alphabetic: "Qure Two"
                    }
                ]
            },
            "00100020": {
                vr: "LO",
                Value: ["ENM1-M0012260"]
            },
            "00100040": {
                vr: "CS",
                Value: ["M"]
            },
            "00104000": {
                vr: "LO", // LT by standard
                Value: ["Patient comment"]
            }
        }
    };

    const addedCustomDictionaryNameMap = {
        LUTData: {
            tag: "(0028,3006)",
            vr: "US",
            name: "LUTData",
            vm: "1-n",
            version: "DICOM"
        },
        LUTDescriptor: {
            tag: "(0028,3002)",
            vr: "US",
            name: "LUTDescriptor",
            vm: "3",
            version: "DICOM"
        }
    };

    for (const key in addedCustomDictionaryNameMap) {
        const element = addedCustomDictionaryNameMap[key];
        DicomMetaDictionary.dictionary[element.tag] = element;
    }
    DicomMetaDictionary._generateNameMap();

    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
        dicomTagsWithNonStandardVr.dict
    );

    expect(Object.keys(dataset._vrMap)).toContain("PatientComments");
    expect(dataset._vrMap.PatientComments).not.toEqual(
        DicomMetaDictionary.nameMap.PatientComments.vr
    );
    expect(dataset._vrMap.PatientComments).toEqual("LO");

    dataset.VOILUTSequence.forEach(sequenceItem => {
        expect(sequenceItem._vrMap).toBeDefined();
        expect(Object.keys(sequenceItem._vrMap).length).toBe(1);
        expect(sequenceItem._vrMap.LUTData).toBe("OW"); // saved origin vr in _vrMap (by standard in addedCustomDictionaryNameMap is US)
    });

    const denaturalizedDataset =
        dcmjs.data.DicomMetaDictionary.denaturalizeDataset(dataset);

    expect(denaturalizedDataset["00104000"].vr).toBe("LO");

    denaturalizedDataset["00283010"].Value.forEach(sequenceItem => {
        expect(sequenceItem["00283006"].vr).toBe("OW");
    });
});

it.each([
    [1.0, "1"],
    [0.0, "0"],
    [-0.0, "0"],
    [0.123, "0.123"],
    [-0.321, "-0.321"],
    [0.00001, "0.00001"],
    [3.14159265358979323846, "3.14159265358979"],
    [-3.14159265358979323846, "-3.1415926535898"],
    [5.3859401928763739403e-7, "5.38594019288e-7"],
    [-5.3859401928763739403e-7, "-5.3859401929e-7"],
    [1.2342534378125532912998323e10, "12342534378.1255"],
    [6.40708699858767842501238e13, "64070869985876.8"],
    [1.7976931348623157e308, "1.797693135e+308"],
    [0.99990081787109, "0.99990081787109"]
])(
    "A converted decimal string should not exceed 16 bytes in length",
    (a, expected) => {
        const decimalString = ValueRepresentation.createByTypeString("DS");
        let value = decimalString.convertToString(a);
        expect(value.length).toBeLessThanOrEqual(16);
        expect(value).toBe(expected);
    }
);

describe("test OtherDouble ValueRepresentation", () => {
    it("Treat OD as explicit VR with correct length", async () => {
        const url =
            "https://github.com/dcmjs-org/data/releases/download/od-encoding-data/OD-single-word-example.dcm";
        const dcmPath = await getTestDataset(url, "OD-single-word-example");
        const file = fs.readFileSync(dcmPath);
        const data = dcmjs.data.DicomMessage.readFile(
            new Uint8Array(file).buffer
        );

        // expect OD VR data element (VolumetricCurveUpDirections) to be read with expected value
        expect(data.dict["00701A07"]).toBeTruthy();
        const odBuffer = data.dict["00701A07"].Value[0];
        expect(new Uint8Array(odBuffer)).toEqual(
            new Uint8Array([0, 0, 0, 0, 0, 0, 0, 64])
        );

        // expect arbitrary tag (BlendingInputNumber, US VR) after OD VR to be read without issue
        expect(data.dict["00701B02"]).toBeTruthy();
        expect(data.dict["00701B02"].Value[0]).toBe(1);
    });
});
