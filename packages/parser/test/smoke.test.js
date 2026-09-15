import * as dicomParser from "../src/index";

describe("parser package smoke", () => {
    it("exposes the public surface", () => {
        expect(dicomParser).toBeDefined();
        expect(typeof dicomParser.parseDicom).toBe("function");
        expect(typeof dicomParser.DataSet).toBe("function");
        expect(typeof dicomParser.readPart10Header).toBe("function");
    });

    it("is importable as a workspace package", async () => {
        const pkg = await import("@dcmjs/parser");
        expect(typeof pkg.parseDicom).toBe("function");
    });
});
