# @dcmjs-org/schemas

The machine-readable catalog of DICOM attributes: for each standard
attribute, its keyword, value representation, and value multiplicity,
generated from the repository's packed data dictionary.

`generate/` holds the generator toolchain; run `pnpm run generate-schema`
from the repository root to rebuild the committed artifacts
(`src/schema/naturalizedRules.js`, `schema/naturalized.schema.json`,
`types/dcmjs-schema.d.ts`). Regeneration is deterministic — CI checks that
the committed artifacts match what the generator produces.

The package is private until its package-merge review flips it; the
IOD catalog half of the schema work lands later with the validation
package that consumes it.
