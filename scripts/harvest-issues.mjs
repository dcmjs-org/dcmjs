// scripts/harvest-issues.mjs
//
// Harvest the upstream dcmjs-org/dcmjs issue tracker into
// test/issues/catalog.json — the machine-readable side of
// ISSUE_TEST_PLAN.md. Each catalog entry carries the issue's metadata
// (fetched) plus OUR triage fields (authored, preserved across
// refreshes):
//
//   node scripts/harvest-issues.mjs            # fetch/refresh the catalog
//   node scripts/harvest-issues.mjs --table    # print the markdown triage
//                                              # table for ISSUE_TEST_PLAN.md
//
// Fetching uses the gh CLI (authenticated, paginated). A refresh merges:
// new issues get empty triage fields; existing issues keep their triage
// verbatim and only the fetched metadata is updated.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(
    __dirname,
    "..",
    "test",
    "issues",
    "catalog.json"
);
const REPO = "dcmjs-org/dcmjs";
const EXCERPT_LENGTH = 1500;

const CATEGORY_ORDER = ["A", "B", "C", "covered", "D", "E", ""];
const CATEGORY_LABELS = {
    A: "A — synthetic reproducer",
    B: "B — needs fixture",
    C: "C — contract assertion",
    covered: "already covered by the existing suite",
    D: "D — wave 2 (adapters / SR / SEG)",
    E: "E — not testable (docs / CI / demos / questions)",
    "": "untriaged"
};

function fetchIssues() {
    const raw = execFileSync(
        "gh",
        [
            "api",
            "--paginate",
            `repos/${REPO}/issues?state=all&per_page=100`,
            "--jq",
            // issues only (the endpoint also returns PRs), emitted as
            // NDJSON — one compact JSON object per line, safe to split
            ".[] | select(.pull_request == null) | " +
                "{number, title, state, url: .html_url, " +
                "labels: [.labels[].name], created_at, closed_at, body}"
        ],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    return raw
        .split("\n")
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
}

function toExcerpt(body) {
    if (!body) {
        return "";
    }
    const collapsed = body.replace(/\r\n/g, "\n").trim();
    return collapsed.length > EXCERPT_LENGTH
        ? collapsed.slice(0, EXCERPT_LENGTH) + " …[truncated]"
        : collapsed;
}

const EMPTY_TRIAGE = {
    category: "", // A | B | C | covered | D | E
    area: "", // charset | values | reader | writer | naturalizer | stream | anonymizer | uid | sr-seg-adapters | infra | ...
    disposition: "", // one-line: what the test asserts, or why untestable
    testFile: "", // test/issues/... once written ("existing:" prefix for covered)
    status: "", // triaged | test-written | green | gap | n/a
    notes: ""
};

function loadCatalog() {
    if (!fs.existsSync(CATALOG_PATH)) {
        return [];
    }
    return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
}

function refresh() {
    const existing = new Map(loadCatalog().map(entry => [entry.number, entry]));
    const fetched = fetchIssues();
    const merged = fetched
        .map(issue => {
            const prior = existing.get(issue.number);
            return {
                number: issue.number,
                title: issue.title,
                state: issue.state,
                url: issue.url,
                labels: issue.labels,
                createdAt: issue.created_at,
                closedAt: issue.closed_at,
                excerpt: toExcerpt(issue.body),
                triage: prior ? prior.triage : { ...EMPTY_TRIAGE }
            };
        })
        .sort((a, b) => a.number - b.number);

    fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(merged, null, 2) + "\n");
    const untriaged = merged.filter(entry => !entry.triage.category).length;
    console.log(
        `catalog: ${merged.length} issues → ${path.relative(
            process.cwd(),
            CATALOG_PATH
        )}` + (untriaged ? ` (${untriaged} untriaged)` : "")
    );
}

function table() {
    const catalog = loadCatalog();
    if (!catalog.length) {
        console.error("catalog is empty — run without --table first");
        process.exit(1);
    }
    const lines = [];
    for (const category of CATEGORY_ORDER) {
        const rows = catalog.filter(
            entry => (entry.triage.category || "") === category
        );
        if (!rows.length) {
            continue;
        }
        lines.push(`### ${CATEGORY_LABELS[category]} (${rows.length})`);
        lines.push("");
        lines.push(
            "| # | Title | State | Area | Disposition | Test | Status |"
        );
        lines.push("|---|---|---|---|---|---|---|");
        for (const entry of rows) {
            const title = entry.title.replace(/\|/g, "\\|");
            const disposition = (entry.triage.disposition || "").replace(
                /\|/g,
                "\\|"
            );
            lines.push(
                `| [${entry.number}](${entry.url}) | ${title} | ${entry.state} | ` +
                    `${entry.triage.area || ""} | ${disposition} | ` +
                    `${entry.triage.testFile || ""} | ${
                        entry.triage.status || ""
                    } |`
            );
        }
        lines.push("");
    }
    console.log(lines.join("\n"));
}

if (process.argv.includes("--table")) {
    table();
} else {
    refresh();
}
