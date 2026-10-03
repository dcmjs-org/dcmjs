# Breaking changes in 1.0

dcmjs 1.0 changes a small number of behaviors on purpose. Each change in
this file moves the library closer to the DICOM standard, and each was
evaluated during the review of the 1.0 rewrite with the same verdict:
keep the new behavior, document it, and give
anyone who depended on the old behavior a way forward. These are not
regressions to be fixed — reverting any of them would reintroduce
non-conformant output.

Each entry states what changed, which part of the standard governs it,
and what to do if your code relied on the old behavior. For everything
else a 0.x project needs to know about 1.0, see
[MIGRATION.md](MIGRATION.md).

## `uid()` generates UUID-derived UIDs

**What changed.** A UID is the permanent globally-unique identifier that
DICOM assigns to studies, series, and images — once an archive stores
one, it is never corrected. `DicomMetaDictionary.uid()` used to build one
by concatenating 39 random decimal digits after the `2.25.` prefix. It
now generates a fresh RFC 4122 version 4 UUID (the standard 128-bit
random identifier most software ecosystems use) and encodes it as a
decimal number, using `globalThis.crypto.getRandomValues` where available
and a `Math.random` fallback (format-preserving, not cryptographically
strong) elsewhere.

**Why.** DICOM PS3.5 Annex B.2 permits the `2.25` root only when the
digits after it are the decimal form of a single 128-bit UUID (ITU-T
X.667 / RFC 4122). A 128-bit value cannot exceed about 3.4 × 10³⁸, but
the old generator produced values up to 10³⁹ − 1 — out of range roughly
73% of the time — and even its in-range outputs lacked the version and
variant bits a UUID must carry. Every UID the old generator produced was
formally invalid.

**If you depended on the old behavior.** The integer part is now *at
most* 39 digits rather than always 39, so code that assumed a fixed
44-character UID needs to accept shorter ones. UIDs that 0.x generated
and an archive already stored are invalid and cannot be corrected after
the fact. There is deliberately no opt-out: an option to generate
invalid identifiers helps nobody. The UUID-derivation contract is pinned
by `test/issues/issue61-uuid-uids.test.js` (issue #61).

## Private creators live only in elements 0x0010–0x00FF

**What changed.** Vendors store private data in odd-numbered DICOM
groups, and claim a block of such a group by writing a *private creator*
element — a short text label like `"ACME 1.0"`. `Tag.isPrivateCreator()`
used to answer true for any odd-group element from 0x0001 through
0x00FF. It now answers true only for 0x0010 through 0x00FF. This matters
when reading files that do not carry type codes inline (implicit VR):
there, `isPrivateCreator()` is what makes the reader decode an unknown
odd-group element as text. An element in the 0x0001–0x000F range now
reads as UN — type unknown, raw bytes preserved — instead of being
decoded as a text label.

**Why.** PS3.5 section 7.8.1 assigns private creator elements to
(gggg,0010-00FF) and reserves (gggg,0001-000F): they "shall not be
used". Master's more permissive check (accepting 0x0001 and up) has no
basis in the standard.

**If you depended on the old behavior.** The parse is lossless — the
bytes of a reserved-range element survive intact inside the UN element —
so code that knows a particular legacy file really stores text there can
re-decode those bytes downstream, for example in an event-stream
listener. Pinned by `test/issues/issue356-private-creator-range.test.js`
(issue #356).

## Fix anonymizer keywords so `cleanTags()` empties previously skipped attributes

**What changed.** The anonymizer's default `tagNamesToEmpty` list
carried 103 entries that did not match any dictionary keyword, so
`cleanTags` silently skipped them — the data those entries were meant to
scrub stayed in the file (issue #345). The corrected list resolves every
name, which means `cleanTags` now actually empties attributes it
previously left untouched. The most visible newcomers are six sequences
that can carry diagnostic content: `ContentSequence` (0040,A730),
`SourceImageSequence` (0008,2112), `ReferencedImageSequence`
(0008,1140), `AcquisitionContextSequence` (0040,0555),
`RequestAttributesSequence` (0040,0275), and `IconImageSequence`
(0088,0200).

*Status:* landed. The corrected list was ported from the rewrite line
in PR [#590](https://github.com/dcmjs-org/dcmjs/pull/590); every one of
the 103 non-resolving entries was mapped 1:1 to its real dictionary
keyword (retired attributes use the dictionary's `RETIRED_` prefix),
and `test/issues/issue345-anonymizer-names.test.js` pins both the
structural contract (every name resolves) and the behavior (a
previously-skipped `ContentSequence` is now emptied).

**Why.** PS3.15 Table E.1-1 (the Basic Application Level Confidentiality
Profile — the standard's checklist of what de-identification must
remove) assigns removal actions to these attributes. Leaving them
untouched, which is what the misspelled list silently did, is the
behavior that departs from the profile.

**If you depended on the old behavior.** The opt-out already exists as a
parameter: `cleanTags` accepts a custom list, and `getTagsNameToEmpty()`
returns a copy of the default one. To keep a sequence the new list would
empty:

```js
import dcmjs from "dcmjs";

const { cleanTags, getTagsNameToEmpty } = dcmjs.anonymizer;
const keep = new Set(["ContentSequence", "SourceImageSequence"]);
const names = getTagsNameToEmpty().filter(name => !keep.has(name));
cleanTags(dicomDict.dict, undefined, names);
```
