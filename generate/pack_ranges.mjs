/**
 * Extract DICOM tag range entries (e.g. 5000-50FF, 6000-60FF) from dictionary.mjs
 * and write src/dictionary.ranges.data.js for use by dicom.lookup.js / dictionary.fast.js.
 */
import dict from "./dictionary.mjs";
import { writeFile } from "node:fs/promises";

const rangeRe = /^\(([0-9A-Fa-f]{4})-([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4})\)$/;
const entries = [];
for (const [k, v] of Object.entries(dict.default ?? dict)) {
    const m = rangeRe.exec(k);
    if (!m) continue;
    entries.push({
        groupMin: parseInt(m[1], 16),
        groupMax: parseInt(m[2], 16),
        elem: parseInt(m[3], 16),
        vr: v.vr ?? "",
        vm: v.vm ?? "",
        name: v.name ?? "",
    });
}
// Sort by groupMin, then elem for predictable output and possible binary search later
entries.sort((a, b) => a.groupMin - b.groupMin || a.elem - b.elem);

const out = `// AUTO-GENERATED from dictionary.mjs by generate/pack_ranges.mjs
// Repeating group ranges (5000-50FF Curves, 6000-60FF Overlays). Used when exact tag lookup fails.

export const rangeEntries = ${JSON.stringify(entries, null, 0)};
`;

await writeFile(new URL("../src/dictionary.ranges.data.js", import.meta.url), out);
console.log(
    JSON.stringify(
        { rangeCount: entries.length },
        null,
        2
    )
);
