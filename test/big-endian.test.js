import dcmjs from "../src/index.js";
import {
    EXPLICIT_BIG_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    TagHex,
    UNDEFINED_LENGTH
} from "../src/constants/dicom.js";

const { DicomDict, DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;

// VRs whose explicit encoding is VR (2) + reserved (2) + length (4)
const LENGTH_32_VRS = [
    "OB",
    "OD",
    "OF",
    "OL",
    "OV",
    "OW",
    "SQ",
    "UC",
    "UN",
    "UR",
    "UT",
    "UV"
];

// Values of the synthetic dataset, chosen to be asymmetric byte wise and, for
// the floating point ones, exactly representable at both 32 and 64 bits.
const pixelValues = [0x0102, 0x0304, 2, 512, 0xfffe, 0x00ff, 0xff00, 0x1234];
const lutValues = [0x0000, 0x7fff, 0x8000, 0xffff];
const documentBytes = [0xde, 0xad, 0xbe, 0xef];
const pointValues = [1.5, -2.5, 0.75, 1024.5];
const doublePointValues = [1.5, -2.5];
const overlayValues = [0x1122, 0x3344];

/*
 * A minimal explicit VR encoder and parser, written independently of the
 * library, so that the bytes the tests expect on either side of a read or a
 * write don't come from the code under test.
 */

const setterNames = {
    Uint16Array: "setUint16",
    Float32Array: "setFloat32",
    Float64Array: "setFloat64"
};

/** Encodes values as words of the given type, in the given byte order */
function encodeWords(values, ArrayType, littleEndian) {
    const width = ArrayType.BYTES_PER_ELEMENT;
    const buffer = new ArrayBuffer(values.length * width);
    const view = new DataView(buffer);
    values.forEach((value, i) =>
        view[setterNames[ArrayType.name]](i * width, value, littleEndian)
    );
    return Array.from(new Uint8Array(buffer));
}

const encodeUint16 = (value, littleEndian) =>
    encodeWords([value], Uint16Array, littleEndian);

const encodeUint32 = (value, littleEndian) =>
    littleEndian
        ? [
              value & 0xff,
              (value >>> 8) & 0xff,
              (value >>> 16) & 0xff,
              value >>> 24
          ]
        : [
              value >>> 24,
              (value >>> 16) & 0xff,
              (value >>> 8) & 0xff,
              value & 0xff
          ];

const asciiBytes = text =>
    Array.from(text, character => character.charCodeAt(0));

/** Ascii value field, padded to an even length with a null, as UI requires */
const paddedAsciiBytes = text =>
    text.length & 1 ? asciiBytes(text).concat(0) : asciiBytes(text);

/** One data element: tag, VR, length and value field */
function encodeElement(tag, vr, valueBytes, littleEndian) {
    const header = [
        ...encodeUint16(parseInt(tag.slice(0, 4), 16), littleEndian),
        ...encodeUint16(parseInt(tag.slice(4), 16), littleEndian),
        ...asciiBytes(vr)
    ];
    if (LENGTH_32_VRS.includes(vr)) {
        return [
            ...header,
            0,
            0, // reserved
            ...encodeUint32(valueBytes.length, littleEndian),
            ...valueBytes
        ];
    }
    return [
        ...header,
        ...encodeUint16(valueBytes.length, littleEndian),
        ...valueBytes
    ];
}

/** An (fffe,xxxx) item, item delimiter or sequence delimiter tag */
const encodeItemTag = (element, length, littleEndian) => [
    ...encodeUint16(0xfffe, littleEndian),
    ...encodeUint16(element, littleEndian),
    ...encodeUint32(length, littleEndian)
];

/**
 * The dataset of the synthetic file: one element of every binary VR with
 * multi-byte words (OW, OF, OD), an OB element, string and scalar elements as
 * controls, and an OW element nested in a sequence, in tag order.
 */
function encodeDataset(littleEndian) {
    return [
        // Modality
        ...encodeElement("00080060", "CS", asciiBytes("MR"), littleEndian),
        // ReferencedOverlaySequence, with undefined lengths, as dcmjs writes
        ...encodeElement("00081130", "SQ", [], littleEndian).slice(0, 8),
        ...encodeUint32(UNDEFINED_LENGTH, littleEndian),
        ...encodeItemTag(0xe000, UNDEFINED_LENGTH, littleEndian),
        // OverlayData
        ...encodeElement(
            "60003000",
            "OW",
            encodeWords(overlayValues, Uint16Array, littleEndian),
            littleEndian
        ),
        ...encodeItemTag(0xe00d, 0, littleEndian),
        ...encodeItemTag(0xe0dd, 0, littleEndian),
        // SamplesPerPixel, Rows, Columns, BitsAllocated, BitsStored,
        // PixelRepresentation
        ...encodeElement(
            "00280002",
            "US",
            encodeUint16(1, littleEndian),
            littleEndian
        ),
        ...encodeElement(
            "00280010",
            "US",
            encodeUint16(2, littleEndian),
            littleEndian
        ),
        ...encodeElement(
            "00280011",
            "US",
            encodeUint16(4, littleEndian),
            littleEndian
        ),
        ...encodeElement(
            "00280100",
            "US",
            encodeUint16(16, littleEndian),
            littleEndian
        ),
        ...encodeElement(
            "00280101",
            "US",
            encodeUint16(16, littleEndian),
            littleEndian
        ),
        ...encodeElement(
            "00280103",
            "US",
            encodeUint16(0, littleEndian),
            littleEndian
        ),
        // RedPaletteColorLookupTableData
        ...encodeElement(
            "00281201",
            "OW",
            encodeWords(lutValues, Uint16Array, littleEndian),
            littleEndian
        ),
        // EncapsulatedDocument
        ...encodeElement("00420011", "OB", documentBytes, littleEndian),
        // PointCoordinatesData
        ...encodeElement(
            "00660016",
            "OF",
            encodeWords(pointValues, Float32Array, littleEndian),
            littleEndian
        ),
        // DoublePointCoordinatesData
        ...encodeElement(
            "00660022",
            "OD",
            encodeWords(doublePointValues, Float64Array, littleEndian),
            littleEndian
        ),
        // PixelData
        ...encodeElement(
            "7FE00010",
            "OW",
            encodeWords(pixelValues, Uint16Array, littleEndian),
            littleEndian
        )
    ];
}

/** The whole part 10 file: preamble, DICM, meta group and dataset */
function encodeFile(syntax) {
    const littleEndian = syntax !== EXPLICIT_BIG_ENDIAN;
    // The meta group is always explicit VR little endian
    const meta = encodeElement(
        TagHex.TransferSyntaxUID,
        "UI",
        paddedAsciiBytes(syntax),
        true
    );
    return new Uint8Array([
        ...new Array(128).fill(0),
        ...asciiBytes("DICM"),
        ...encodeElement(
            TagHex.FileMetaInformationGroupLength,
            "UL",
            encodeUint32(meta.length, true),
            true
        ),
        ...meta,
        ...encodeDataset(littleEndian)
    ]);
}

/** Offset of the dataset, past the preamble, DICM and the meta group */
function datasetOffset(buffer) {
    const view = new DataView(buffer);
    // (0002,0000) UL 4 comes first: tag (4) + VR (2) + length (2) + value (4)
    const metaLength = view.getUint32(128 + 4 + 8, true);
    return 128 + 4 + 12 + metaLength;
}

/** The VR and raw value field bytes of each top level element, keyed by tag */
function parseExplicitElements(buffer, offset, littleEndian) {
    const view = new DataView(buffer);
    const elements = {};
    while (offset + 8 <= buffer.byteLength) {
        const group = view.getUint16(offset, littleEndian);
        const element = view.getUint16(offset + 2, littleEndian);
        const tag = (
            group.toString(16).padStart(4, "0") +
            element.toString(16).padStart(4, "0")
        ).toUpperCase();
        if (group === 0xfffe) {
            // item or delimiter: tag (4) + length (4), no VR and no value
            offset += 8;
            continue;
        }
        const vr = String.fromCharCode(
            view.getUint8(offset + 4),
            view.getUint8(offset + 5)
        );
        let length;
        if (LENGTH_32_VRS.includes(vr)) {
            length = view.getUint32(offset + 8, littleEndian);
            offset += 12;
        } else {
            length = view.getUint16(offset + 6, littleEndian);
            offset += 8;
        }
        if (length === UNDEFINED_LENGTH) {
            // a sequence, whose items are walked as part of this same loop
            elements[tag] = { vr, bytes: [] };
            continue;
        }
        elements[tag] = {
            vr,
            bytes: Array.from(new Uint8Array(buffer, offset, length))
        };
        offset += length;
    }
    return elements;
}

/** The same dataset as encodeDataset, as a DicomDict in host byte order */
function makeDicomDict(syntax) {
    const dicomDict = new DicomDict({
        [TagHex.TransferSyntaxUID]: { vr: "UI", Value: [syntax] }
    });
    dicomDict.dict = {
        "00080060": { vr: "CS", Value: ["MR"] },
        "00081130": {
            vr: "SQ",
            Value: [
                {
                    60003000: {
                        vr: "OW",
                        Value: [new Uint16Array(overlayValues).buffer]
                    }
                }
            ]
        },
        "00280002": { vr: "US", Value: [1] },
        "00280010": { vr: "US", Value: [2] },
        "00280011": { vr: "US", Value: [4] },
        "00280100": { vr: "US", Value: [16] },
        "00280101": { vr: "US", Value: [16] },
        "00280103": { vr: "US", Value: [0] },
        "00281201": { vr: "OW", Value: [new Uint16Array(lutValues).buffer] },
        "00420011": { vr: "OB", Value: [new Uint8Array(documentBytes).buffer] },
        "00660016": { vr: "OF", Value: [new Float32Array(pointValues).buffer] },
        "00660022": {
            vr: "OD",
            Value: [new Float64Array(doublePointValues).buffer]
        },
        "7FE00010": { vr: "OW", Value: [new Uint16Array(pixelValues).buffer] }
    };
    return dicomDict;
}

/**
 * Pixel data as the async reader delivers it, one array of fragments per frame,
 * viewed in the host's byte order
 */
function hostFrameWords(element, ArrayType) {
    const [frames] = element.Value;
    expect(frames).toHaveLength(1); // a single frame, in a single fragment
    return Array.from(new ArrayType(frames[0]));
}

/** The value of a binary element, viewed in the host's byte order */
function hostWords(element, ArrayType) {
    const value = element.Value[0];
    return Array.from(
        new ArrayType(ArrayBuffer.isView(value) ? value.buffer : value)
    );
}

const syntaxes = [
    ["Explicit VR Little Endian", EXPLICIT_LITTLE_ENDIAN],
    ["Explicit VR Big Endian", EXPLICIT_BIG_ENDIAN]
];

describe("binary value fields and the transfer syntax byte order", () => {
    describe.each(syntaxes)("%s", (_name, syntax) => {
        const littleEndian = syntax === EXPLICIT_LITTLE_ENDIAN;

        test("writes the words of the value field in the transfer syntax byte order", () => {
            const buffer = makeDicomDict(syntax).write();
            const elements = parseExplicitElements(
                buffer,
                datasetOffset(buffer),
                littleEndian
            );

            expect(elements["7FE00010"].vr).toEqual("OW");
            expect(elements["7FE00010"].bytes).toEqual(
                encodeWords(pixelValues, Uint16Array, littleEndian)
            );
            expect(elements["00281201"].bytes).toEqual(
                encodeWords(lutValues, Uint16Array, littleEndian)
            );
            expect(elements["00660016"].bytes).toEqual(
                encodeWords(pointValues, Float32Array, littleEndian)
            );
            expect(elements["00660022"].bytes).toEqual(
                encodeWords(doublePointValues, Float64Array, littleEndian)
            );
            expect(elements["60003000"].bytes).toEqual(
                encodeWords(overlayValues, Uint16Array, littleEndian)
            );

            // OB is a byte stream, the same in either byte order
            expect(elements["00420011"].bytes).toEqual(documentBytes);

            // controls: a scalar and a string VR
            expect(elements["00280100"].bytes).toEqual(
                encodeUint16(16, littleEndian)
            );
            expect(elements["00080060"].bytes).toEqual(asciiBytes("MR"));

            // and the file as a whole is encoded as the standard describes
            expect(new Uint8Array(buffer)).toEqual(encodeFile(syntax));
        });

        test("reads the words of the value field into the host's byte order", () => {
            const dict = DicomMessage.readFile(encodeFile(syntax).buffer).dict;

            expect(hostWords(dict["7FE00010"], Uint16Array)).toEqual(
                pixelValues
            );
            expect(hostWords(dict["00281201"], Uint16Array)).toEqual(lutValues);
            expect(hostWords(dict["00660016"], Float32Array)).toEqual(
                pointValues
            );
            expect(hostWords(dict["00660022"], Float64Array)).toEqual(
                doublePointValues
            );
            expect(
                hostWords(dict["00081130"].Value[0]["60003000"], Uint16Array)
            ).toEqual(overlayValues);

            // OB is a byte stream, and the controls are unaffected
            expect(hostWords(dict["00420011"], Uint8Array)).toEqual(
                documentBytes
            );
            expect(dict["00280100"].Value).toEqual([16]);
            expect(dict["00080060"].Value).toEqual(["MR"]);
        });

        test("reads the words of the value field into the host's byte order asynchronously", async () => {
            const reader = new AsyncDicomReader();
            reader.stream.addBuffer(encodeFile(syntax).buffer);
            reader.stream.setComplete();
            const { dict } = await reader.readFile();

            expect(hostFrameWords(dict["7FE00010"], Uint16Array)).toEqual(
                pixelValues
            );
            expect(hostWords(dict["00281201"], Uint16Array)).toEqual(lutValues);
            expect(hostWords(dict["00660016"], Float32Array)).toEqual(
                pointValues
            );
            expect(hostWords(dict["00660022"], Float64Array)).toEqual(
                doublePointValues
            );
            expect(hostWords(dict["00420011"], Uint8Array)).toEqual(
                documentBytes
            );
            expect(dict["00280100"].Value).toEqual([16]);
        });

        test("round trips read and write losslessly", () => {
            const original = encodeFile(syntax);
            const rewritten = DicomMessage.readFile(original.buffer).write();

            expect(new Uint8Array(rewritten)).toEqual(original);
        });

        test("leaves the value passed in untouched when writing", () => {
            const dicomDict = makeDicomDict(syntax);
            const pixelData = dicomDict.dict["7FE00010"].Value[0];
            dicomDict.write();

            expect(Array.from(new Uint16Array(pixelData))).toEqual(pixelValues);
        });
    });

    test.each([
        [
            "big endian to little endian",
            EXPLICIT_BIG_ENDIAN,
            EXPLICIT_LITTLE_ENDIAN
        ],
        [
            "little endian to big endian",
            EXPLICIT_LITTLE_ENDIAN,
            EXPLICIT_BIG_ENDIAN
        ]
    ])("transcodes %s", (_name, fromSyntax, toSyntax) => {
        const dicomDict = DicomMessage.readFile(encodeFile(fromSyntax).buffer);
        dicomDict.meta[TagHex.TransferSyntaxUID].Value = [toSyntax];

        expect(new Uint8Array(dicomDict.write())).toEqual(encodeFile(toSyntax));
    });
});
