import dcmjs from "../src/index.js";

const { DicomMessage } = dcmjs.data;
const { AsyncDicomReader } = dcmjs.async;
const { DicomMetadataListener } = dcmjs.utilities;

// A file with an Icon Image Sequence (0088,0200). The icon has its own Pixel
// Data inside the sequence item, which is valid (PS3.3 C.7.6.1.1.6).
describe("AsyncDicomReader with Pixel Data inside a sequence item", () => {
    const cat = (...parts) => {
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const part of parts) {
            out.set(part, at);
            at += part.length;
        }
        return out;
    };
    const u16 = n => new Uint8Array(new Uint16Array([n]).buffer);
    const u32 = n => new Uint8Array(new Uint32Array([n]).buffer);
    const str = (s, pad = "\0") =>
        new TextEncoder().encode(s.length % 2 ? s + pad : s);
    const tag = (g, e) => cat(u16(g), u16(e));
    const short = (g, e, vr, v) => cat(tag(g, e), str(vr), u16(v.length), v);
    const long = (g, e, vr, v) =>
        cat(tag(g, e), str(vr), u16(0), u32(v.length), v);

    const image = frames =>
        cat(
            short(0x0028, 0x0002, "US", u16(1)),
            ...(frames
                ? [short(0x0028, 0x0008, "IS", str(String(frames), " "))]
                : []),
            short(0x0028, 0x0010, "US", u16(2)),
            short(0x0028, 0x0011, "US", u16(2)),
            short(0x0028, 0x0100, "US", u16(8))
        );

    // The icon is one 2x2 frame, whatever the NumberOfFrames of the file
    const iconPixels = [1, 2, 3, 4];

    function buildFile(numberOfFrames) {
        const item = cat(
            image(),
            long(0x7fe0, 0x0010, "OB", new Uint8Array(iconPixels))
        );
        const meta = cat(
            long(0x0002, 0x0001, "OB", new Uint8Array([0, 1])),
            short(0x0002, 0x0002, "UI", str("1.2.840.10008.5.1.4.1.1.7")),
            short(0x0002, 0x0003, "UI", str("1.2.3.4")),
            short(0x0002, 0x0010, "UI", str("1.2.840.10008.1.2.1"))
        );
        return cat(
            new Uint8Array(128),
            str("DICM"),
            short(0x0002, 0x0000, "UL", u32(meta.length)),
            meta,
            image(numberOfFrames),
            long(
                0x0088,
                0x0200,
                "SQ",
                cat(tag(0xfffe, 0xe000), u32(item.length), item)
            ),
            long(
                0x7fe0,
                0x0010,
                "OB",
                new Uint8Array(4 * (numberOfFrames ?? 1))
            )
        ).buffer;
    }

    async function readAsync(buffer, options) {
        const reader = new AsyncDicomReader();
        reader.stream.addBuffer(buffer);
        reader.stream.setComplete();
        await reader.readFile({
            listener: new DicomMetadataListener(),
            ...options
        });
        return reader.dict;
    }

    const bytes = value => Array.from(new Uint8Array(value));
    const iconFrames = dict =>
        dict["00880200"].Value[0]["7FE00010"].Value.map(frame =>
            frame.map(bytes)
        );

    it("reads the icon whole when untilTag is the Pixel Data tag", async () => {
        const dict = await readAsync(buildFile(), { untilTag: "7FE00010" });

        expect(iconFrames(dict)).toEqual([[iconPixels]]);
        // The read still stops before the Pixel Data of the data set
        expect(dict["7FE00010"]).toBeUndefined();
        // The sync reader gives the same icon
        const sync = DicomMessage.readFile(buildFile(), {
            untilTag: "7FE00010"
        }).dict;
        expect(sync["00880200"].Value[0]["7FE00010"].Value.map(bytes)).toEqual([
            iconPixels
        ]);
    });

    it("reads the icon as one frame whatever NumberOfFrames the file has", async () => {
        const reference = iconFrames(await readAsync(buildFile()));
        expect(reference).toEqual([[iconPixels]]);

        // 2 splits the 4 bytes in two frames, 3 does not divide them
        for (const frames of [2, 3]) {
            const dict = await readAsync(buildFile(frames));
            expect(iconFrames(dict)).toEqual(reference);
            // The Pixel Data of the data set is still split by its frames
            expect(dict["7FE00010"].Value).toHaveLength(frames);
        }
    });
});
