import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import styles from "./index.module.css";

const features = [
    {
        title: "Lazy by default",
        description:
            "Parsing records element offsets only; values decode on first access. " +
            "Header-only reads of large studies cost almost nothing, and the read " +
            "core is faster than the standalone dicom-parser on every benchmark fixture."
    },
    {
        title: "Byte-faithful writing",
        description:
            "Untouched elements are written back as verbatim source bytes. A " +
            "read-then-write round trip without edits reproduces the original body " +
            "byte for byte, including undefined-length sequences and encapsulated pixel data."
    },
    {
        title: "Whole-stack DICOM",
        description:
            "Naturalized keyword datasets, a packed data dictionary, anonymization, " +
            "structured reports, segmentation derivations, character sets, deflate, " +
            "and streaming - one library, one repository."
    }
];

function HomepageHeader() {
    const { siteConfig } = useDocusaurusContext();
    return (
        <header className={clsx("hero hero--primary", styles.heroBanner)}>
            <div className="container">
                <Heading as="h1" className="hero__title">
                    {siteConfig.title}
                </Heading>
                <p className="hero__subtitle">{siteConfig.tagline}</p>
                <div className={styles.buttons}>
                    <Link
                        className="button button--secondary button--lg"
                        to="/docs/intro"
                    >
                        Read the documentation
                    </Link>
                </div>
            </div>
        </header>
    );
}

export default function Home() {
    const { siteConfig } = useDocusaurusContext();
    return (
        <Layout
            title={siteConfig.title}
            description="JavaScript DICOM reading, writing, and manipulation"
        >
            <HomepageHeader />
            <main>
                <section className="container margin-vert--lg">
                    <div className="row">
                        {features.map(f => (
                            <div className="col col--4" key={f.title}>
                                <Heading as="h3">{f.title}</Heading>
                                <p>{f.description}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </main>
        </Layout>
    );
}
