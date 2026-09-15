// @ts-check
import { themes as prismThemes } from "prism-react-renderer";

/** @type {import('@docusaurus/types').Config} */
const config = {
    title: "dcmjs",
    tagline:
        "JavaScript DICOM reading, writing, and manipulation - lazy offset-based parsing with a byte-faithful writer",
    favicon: "img/favicon.ico",

    future: {
        v4: true
    },

    url: "https://dcmjs.org",
    baseUrl: "/",

    organizationName: "dcmjs-org",
    projectName: "dcmjs",

    onBrokenLinks: "throw",

    i18n: {
        defaultLocale: "en",
        locales: ["en"]
    },

    presets: [
        [
            "classic",
            /** @type {import('@docusaurus/preset-classic').Options} */
            ({
                docs: {
                    sidebarPath: "./sidebars.js",
                    editUrl:
                        "https://github.com/dcmjs-org/dcmjs/tree/master/packages/docs/"
                },
                blog: false,
                theme: {
                    customCss: "./src/css/custom.css"
                }
            })
        ]
    ],

    themeConfig:
        /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
        ({
            navbar: {
                title: "dcmjs",
                items: [
                    {
                        type: "docSidebar",
                        sidebarId: "docs",
                        position: "left",
                        label: "Documentation"
                    },
                    {
                        href: "https://github.com/dcmjs-org/dcmjs",
                        label: "GitHub",
                        position: "right"
                    }
                ]
            },
            footer: {
                style: "dark",
                links: [
                    {
                        title: "Docs",
                        items: [
                            { label: "Introduction", to: "/docs/intro" },
                            {
                                label: "Getting started",
                                to: "/docs/getting-started"
                            },
                            {
                                label: "Migration from 0.x",
                                to: "/docs/migration/from-0x"
                            }
                        ]
                    },
                    {
                        title: "Project",
                        items: [
                            {
                                label: "GitHub",
                                href: "https://github.com/dcmjs-org/dcmjs"
                            },
                            {
                                label: "Issues",
                                href: "https://github.com/dcmjs-org/dcmjs/issues"
                            }
                        ]
                    }
                ],
                copyright: `Copyright (c) ${new Date().getFullYear()} dcmjs contributors. MIT licensed.`
            },
            prism: {
                theme: prismThemes.github,
                darkTheme: prismThemes.dracula
            }
        })
};

export default config;
