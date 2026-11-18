import dcmjs from "../src/index.js";
import { EXPLICIT_LITTLE_ENDIAN } from "../src/constants/dicom.js";

const { DicomMetaDictionary, DicomMessage, datasetToDict, registerTag } =
    dcmjs.data;

const META = {
    TransferSyntaxUID: { Value: [EXPLICIT_LITTLE_ENDIAN], vr: "UI" },
    MediaStorageSOPClassUID: {
        Value: ["1.2.840.10008.5.1.4.1.1.7"],
        vr: "UI"
    },
    MediaStorageSOPInstanceUID: { Value: ["1.2.3"], vr: "UI" }
};

describe("registerTag", () => {
    it("is reachable from the package entry point", () => {
        expect(typeof registerTag).toEqual("function");
        expect(dcmjs.data.dictionary).toBeDefined();
    });

    it("makes the tag available by name, so it can be written and read back", () => {
        // A private block: creator at (gggg,0010) reserving (gggg,10xx).
        registerTag("(4d43,0010)", {
            name: "TestPrivateCreator",
            vr: "LO",
            vm: "1"
        });
        registerTag("4d431001", {
            name: "TestPrivateMode",
            vr: "CS",
            vm: "1"
        });

        // Without the name in nameMap, denaturalizeDataset drops the value and
        // only warns - the failure is silent, which is what made it worth a test.
        expect(DicomMetaDictionary.nameMap["TestPrivateCreator"]).toBeDefined();
        expect(DicomMetaDictionary.nameMap["TestPrivateMode"]).toBeDefined();

        const denaturalized = DicomMetaDictionary.denaturalizeDataset({
            TestPrivateCreator: "DCMJS.TEST.1",
            TestPrivateMode: "HYBRID"
        });
        expect(denaturalized["4D430010"].Value).toEqual(["DCMJS.TEST.1"]);
        expect(denaturalized["4D430010"].vr).toEqual("LO");
        expect(denaturalized["4D431001"].Value).toEqual(["HYBRID"]);
        expect(denaturalized["4D431001"].vr).toEqual("CS");

        // and all the way through a file
        const buffer = datasetToDict({
            SOPClassUID: "1.2.840.10008.5.1.4.1.1.7",
            SOPInstanceUID: "1.2.3",
            TestPrivateCreator: "DCMJS.TEST.1",
            TestPrivateMode: "HYBRID",
            _meta: META
        }).write();

        const dict = DicomMessage.readFile(buffer).dict;
        expect(dict["4D430010"].Value).toEqual(["DCMJS.TEST.1"]);
        expect(dict["4D431001"].Value).toEqual(["HYBRID"]);
    });

    it("normalizes the tag to upper case, the form a reader produces", () => {
        // Registered in lower case on purpose: Tag.toCleanString() upper-cases
        // when reading a file, so without normalization the written key and the
        // read key would differ and nothing would line up.
        registerTag("(4d46,1001)", { name: "TestLowerRegistered", vr: "SH" });

        expect(DicomMetaDictionary.dictionary["(4d46,1001)"].tag).toEqual(
            "(4D46,1001)"
        );

        const denaturalized = DicomMetaDictionary.denaturalizeDataset({
            TestLowerRegistered: "ok"
        });
        expect(Object.keys(denaturalized)).toEqual(["4D461001"]);

        const buffer = datasetToDict({
            SOPClassUID: "1.2.840.10008.5.1.4.1.1.7",
            SOPInstanceUID: "1.2.3",
            TestLowerRegistered: "ok",
            _meta: META
        }).write();
        expect(DicomMessage.readFile(buffer).dict["4D461001"].Value).toEqual([
            "ok"
        ]);
    });

    it("accepts either tag spelling and reports the entry back", () => {
        registerTag("(4d45,1002)", { name: "TestParenSpelling", vr: "SH" });
        registerTag("4d451003", { name: "TestHexSpelling", vr: "SH" });

        for (const key of [
            "(4d45,1002)",
            "(4D45,1002)",
            "4d451002",
            "4D451002"
        ]) {
            expect(DicomMetaDictionary.dictionary[key].name).toEqual(
                "TestParenSpelling"
            );
        }
        for (const key of [
            "(4d45,1003)",
            "(4D45,1003)",
            "4d451003",
            "4D451003"
        ]) {
            expect(DicomMetaDictionary.dictionary[key].name).toEqual(
                "TestHexSpelling"
            );
        }
        // version defaults to "User", which is what keeps these in nameMap while
        // the shipped private dictionary ("PrivateTag") stays out of it
        expect(DicomMetaDictionary.dictionary["4d451002"].version).toEqual(
            "User"
        );
    });

    it("does not pull the shipped private dictionary into nameMap", () => {
        // Those names are vendor-specific and collide; writing one because a
        // caller's field happened to match the name would be wrong.
        const philips =
            DicomMetaDictionary.dictionary[
                '(2005,"Philips MR Imaging DD 005",14)'
            ];
        if (philips) {
            expect(philips.version).toEqual("PrivateTag");
            expect(DicomMetaDictionary.nameMap[philips.name]).toBeUndefined();
        }
    });

    it("ignores malformed input", () => {
        const before = Object.keys(DicomMetaDictionary.nameMap).length;
        registerTag("not-a-tag", { name: "Nope", vr: "LO" });
        registerTag("(4d47,1001)", { name: "NoVr" });
        registerTag("(4d47,1002)", null);
        expect(Object.keys(DicomMetaDictionary.nameMap).length).toEqual(before);
    });
});
