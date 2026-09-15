describe("dcmjs/schema subpath", () => {
    test("package.json maps ./schema with runtime and types", () => {
        const pkg = require("../../package.json");
        expect(pkg.exports["./schema"]).toEqual({
            types: "./types/dcmjs-schema.d.ts",
            import: "./src/schema/naturalizedRules.js"
        });
    });
});
