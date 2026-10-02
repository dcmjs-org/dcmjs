# @dcmjs/core

The shared building blocks every other dcmjs package uses: the DICOM value
types (`ValueRepresentation`), tags (`Tag`), buffer machinery (`BufferStream`,
`SplitDataView`), character-set handling (`src/charset/`), the DICOM constants,
the runtime data dictionary, and the naturalization rules
(`DicomMetaDictionary`). No readers or writers live here.

The package deliberately has no dependency on any other dcmjs package: the
legacy engines, the streaming reader, and the writers all build on top of it,
never the other way around. Its only runtime dependencies are `pako` and
`loglevel`.

`src/index.js` exports the public surface. The packed dictionary data files
(`dicom.packed.js`, `dictionary.private.data.js`, `dictionary.ranges.data.js`)
are internal: their export names collide by design (each is a module-shaped
data blob), so they are reachable by direct module path but are not re-exported
from the index.

During the 1.0 beta this package is marked private; the publish flag flips when
the workspace layout settles, per RELEASE_PLAN.md.
