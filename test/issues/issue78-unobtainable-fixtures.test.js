/**
 * BLOCKED fixture placeholders — inventory markers, NOT known-gaps.
 *
 * Issue #78 — "Some RLE encoded segmentations cannot be read with
 * readFile"
 * https://github.com/dcmjs-org/dcmjs/issues/78
 * Symptom: SEG objects written with RLE Lossless
 * (1.2.840.10008.1.2.5) failed readFile with "RangeError: Source is too
 * large" on SOME segmentations — the reader reportedly treated the RLE
 * transfer syntax as EXPLICIT_LITTLE_ENDIAN and copied encapsulated
 * bytes into an undersized destination.
 *
 * Issue #86 — "readFile failing on (some?) images with palette color
 * LUTs"
 * https://github.com/dcmjs-org/dcmjs/issues/86
 * Symptom: the file from OHIF/Viewers#1350 (palette color LUT image,
 * 8-bit LUT data / descriptor quirks) failed dcmjs readFile while
 * dicomParser read it fine.
 *
 * Triage: B — needs a real fixture, and both upstream fixtures are
 * unobtainable:
 *  - #78: Google Drive link
 *    https://drive.google.com/open?id=1YQIBARbvUwy9Rp0ekbDs04RS0VHowdZN
 *    (access-controlled / dead).
 *  - #86: the OHIF/Viewers#1350 attachment link is dead; no copy in
 *    dcmjs-org/data.
 *
 * The skips below are BLOCKED placeholders: they document exactly what
 * will be asserted the day a fixture (or a PHI-vetted equivalent — e.g.
 * an RLE SEG produced by another toolkit, or a palette-color US/CT
 * export) lands in the network-fixture cache ($TMPDIR/dcmjs-test,
 * gated by itIfNetworkFixture per the plan). They are NOT entries for
 * the known-gap table — no failing behavior has been reproduced in 1.0.
 */

describe("issues #78/#86 — fixtures unobtainable (BLOCKED placeholders)", () => {
    // BLOCKED: fixture unobtainable — RLE Lossless SEG (multi-segment,
    // multiframe, 1.2.840.10008.1.2.5) from the issue's Google Drive
    // link. When a fixture arrives, this becomes:
    //   const dicomDict = DicomMessage.readFile(fixtureBuffer);
    //   - expect no throw (the reported "RangeError: Source is too
    //     large" must not occur);
    //   - expect meta TransferSyntaxUID === "1.2.840.10008.1.2.5";
    //   - expect dict["7FE00010"].Value.length === NumberOfFrames (one
    //     RLE fragment per frame — RLE forbids fragmenting frames);
    //   - expect every frame's first 64 bytes to be a plausible RLE
    //     header (first uint32 = number of segments, 1..15);
    //   - round trip: DicomDict.write() then readFile again yields the
    //     same fragment count and byte-identical frame contents.
    it.skip("BLOCKED: fixture unobtainable — #78 RLE SEG readFile succeeds", () => {
        throw new Error("unreachable placeholder");
    });

    // BLOCKED: fixture unobtainable — palette color LUT image from
    // OHIF/Viewers#1350. When a fixture arrives, this becomes:
    //   const dicomDict = DicomMessage.readFile(fixtureBuffer);
    //   - expect no throw;
    //   - expect dict PhotometricInterpretation === "PALETTE COLOR";
    //   - naturalizeDataset(dicomDict.dict):
    //     - Red/Green/BluePaletteColorLookupTableDescriptor naturalize
    //       to 3-element numeric arrays (US-vs-SS descriptor quirk: the
    //       first entry may be 0 meaning 2^16 entries — value preserved
    //       as stored, not "corrected");
    //     - Red/Green/BluePaletteColorLookupTableData remain unpacked
    //       bulk (ArrayBuffer) with byteLength consistent with the
    //       descriptor (entries × bytes-per-entry);
    //   - denaturalize + write + re-read keeps LUT data byte-identical.
    it.skip("BLOCKED: fixture unobtainable — #86 palette-color-LUT readFile succeeds and LUT descriptors naturalize", () => {
        throw new Error("unreachable placeholder");
    });

    // BLOCKED: fixture FAILED PHI VETTING — issue #363 ("Invalid tag in
    // sequence : Unable to parse MR Dicom file"). The upstream GitHub
    // attachment (907375E7.zip) DOES reproduce: eager readFile throws
    // "Invalid tag in sequence" on a JPEG Lossless SV1
    // (1.2.840.10008.1.2.4.70) MR instance that dicomParser reads fine.
    // But the file carries real patient identity (name, birth date, MRN,
    // institution), so under the synthetic+vetted-attachments policy it
    // was deleted, not cached. Needs an anonymized reproducer from
    // upstream (asking the reporter, or re-creating the sequence quirk
    // synthetically once the failing tag pattern is known). When one
    // lands: readFile must parse it (or fail with a corrective message
    // naming the offending tag), and eager/stream paths must agree.
    // Issue #347 ("saved image inconsistent with source" — positioning
    // lines lost) is also fixture-dead: self-hosted link is gone.
    it.skip("BLOCKED: fixture failed PHI vetting — #363 'Invalid tag in sequence' MR file parses", () => {
        throw new Error("unreachable placeholder");
    });
});
