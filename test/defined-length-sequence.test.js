import dcmjs from "../src/index.js";
import { WriteBufferStream } from "../src/BufferStream.js";
import { TagHex, UNDEFINED_LENGTH } from "../src/constants/dicom.js";

const { DicomDict, DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;
const { DicomMetadataListener } = dcmjs.utilities;

DicomDict.setDicomMessageClass(DicomMessage);

const EXPLICIT_LE = "1.2.840.10008.1.2.1";

/**
 * Build a DICOM Part 10 buffer with a Content Sequence (0040,A730) whose
 * items use defined lengths.
 *
 * Uses DicomMessage.writeTagObject for the meta header and individual tag
 * values; only the sequence/item framing is written manually because the
 * built-in SQ writer always emits undefined lengths.
 */
function buildDefinedLengthSQBuffer(itemCodeValues, opts = {}) {
    const { undefinedSeqLength = false, undefinedItemLengths = false } = opts;

    // --- Meta header ---
    const metaBody = new WriteBufferStream(256, true);
    DicomMessage.writeTagObject(
        metaBody,
        TagHex.TransferSyntaxUID,
        "UI",
        [EXPLICIT_LE],
        EXPLICIT_LE,
        {}
    );

    // --- Sequence body: item headers + item content ---
    const seqBody = new WriteBufferStream(4096, true);
    for (const val of itemCodeValues) {
        // Write item content using the standard writer
        const itemBody = new WriteBufferStream(256, true);
        DicomMessage.writeTagObject(
            itemBody,
            "00080100",
            "SH",
            [val],
            EXPLICIT_LE,
            {}
        );

        // Item tag (FFFE,E000) + length
        seqBody.writeUint16(0xfffe);
        seqBody.writeUint16(0xe000);
        seqBody.writeUint32(
            undefinedItemLengths ? UNDEFINED_LENGTH : itemBody.size
        );
        seqBody.concat(itemBody);

        if (undefinedItemLengths) {
            // Item Delimitation Item (FFFE,E00D) + 0
            seqBody.writeUint16(0xfffe);
            seqBody.writeUint16(0xe00d);
            seqBody.writeUint32(0);
        }
    }
    if (undefinedSeqLength) {
        // Sequence Delimitation Item (FFFE,E0DD) + 0
        seqBody.writeUint16(0xfffe);
        seqBody.writeUint16(0xe0dd);
        seqBody.writeUint32(0);
    }

    // --- Assemble Part 10 ---
    const file = new WriteBufferStream(8192, true);
    file.writeUint8Repeat(0, 128);
    file.writeAsciiString("DICM");
    DicomMessage.writeTagObject(
        file,
        TagHex.FileMetaInformationGroupLength,
        "UL",
        metaBody.size,
        EXPLICIT_LE,
        {}
    );
    file.concat(metaBody);

    // SQ header (Explicit LE: tag 4 + VR 2 + reserved 2 + length 4 = 12)
    file.writeUint16(0x0040);
    file.writeUint16(0xa730);
    file.writeAsciiString("SQ");
    file.writeUint16(0);
    file.writeUint32(undefinedSeqLength ? UNDEFINED_LENGTH : seqBody.size);
    file.concat(seqBody);

    return file.getBuffer();
}

async function parseBuffer(buffer) {
    const reader = new AsyncDicomReader();
    const listener = new DicomMetadataListener();
    reader.stream.addBuffer(buffer);
    reader.stream.setComplete();
    return reader.readFile({ listener });
}

describe("AsyncDicomReader defined-length sequence items", () => {
    test("preserves all items in a defined-length sequence", async () => {
        const values = Array.from({ length: 30 }, (_, i) => `ITEM_${i}`);
        const { dict } = await parseBuffer(buildDefinedLengthSQBuffer(values));

        expect(dict["0040A730"].Value).toHaveLength(30);
        for (let i = 0; i < 30; i++) {
            expect(dict["0040A730"].Value[i]["00080100"].Value[0]).toBe(
                `ITEM_${i}`
            );
        }
    });

    test("handles undefined-length items in a defined-length sequence", async () => {
        const values = ["UND_A", "UND_B"];
        const { dict } = await parseBuffer(
            buildDefinedLengthSQBuffer(values, { undefinedItemLengths: true })
        );

        expect(dict["0040A730"].Value).toHaveLength(2);
        expect(dict["0040A730"].Value[0]["00080100"].Value[0]).toBe("UND_A");
        expect(dict["0040A730"].Value[1]["00080100"].Value[0]).toBe("UND_B");
    });

    test("handles defined-length items in an undefined-length sequence", async () => {
        const values = ["CODE1", "CODE2", "CODE3"];
        const { dict } = await parseBuffer(
            buildDefinedLengthSQBuffer(values, { undefinedSeqLength: true })
        );

        expect(dict["0040A730"].Value).toHaveLength(3);
        expect(dict["0040A730"].Value[2]["00080100"].Value[0]).toBe("CODE3");
    });

    test("streams defined-length sequence in small chunks", async () => {
        const values = ["STREAM_A", "STREAM_B", "STREAM_C", "STREAM_D"];
        const buffer = buildDefinedLengthSQBuffer(values);

        const reader = new AsyncDicomReader();
        const listener = new DicomMetadataListener();
        const bytes = new Uint8Array(buffer);
        const chunkSize = 13; // odd prime to stress buffer boundaries
        for (let i = 0; i < bytes.length; i += chunkSize) {
            reader.stream.addBuffer(
                bytes.slice(i, Math.min(i + chunkSize, bytes.length)).buffer
            );
        }
        reader.stream.setComplete();

        const { dict } = await reader.readFile({ listener });
        expect(dict["0040A730"].Value).toHaveLength(4);
        expect(dict["0040A730"].Value[3]["00080100"].Value[0]).toBe("STREAM_D");
    });
});
