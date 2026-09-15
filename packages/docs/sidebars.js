// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
    docs: [
        "intro",
        "getting-started",
        {
            type: "category",
            label: "Architecture",
            collapsed: false,
            items: [
                "architecture/overview",
                "architecture/parser-package",
                "architecture/lazy-core",
                "architecture/event-stream",
                "architecture/writer",
                "architecture/dictionary",
                "architecture/streaming"
            ]
        },
        {
            type: "category",
            label: "Guides",
            collapsed: false,
            items: [
                "guides/reading",
                "guides/writing-and-editing",
                "guides/naturalized-datasets",
                "guides/schema",
                "guides/fhir",
                "guides/event-streams",
                "guides/character-sets",
                "guides/deflate"
            ]
        },
        {
            type: "category",
            label: "Migration",
            items: [
                "migration/before-and-after",
                "migration/from-0x",
                "migration/from-dicom-parser"
            ]
        },
        "performance",
        {
            type: "category",
            label: "Development",
            items: ["development/monorepo", "development/roadmap"]
        }
    ]
};

export default sidebars;
