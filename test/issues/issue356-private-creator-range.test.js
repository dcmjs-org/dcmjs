/**
 * Upstream issue: https://github.com/dcmjs-org/dcmjs/issues/356
 *
 * Symptom: Tag.isPrivateCreator checks only `element > 0x00 && element <
 * 0x100`, but per PS3.5 7.8.1 private creator data elements occupy elements
 * (gggg,0010-00FF) in odd groups; elements (gggg,0001-000F) of an odd group
 * are NOT private creators (PS3.5 reserves them — "shall not be used").
 * Misclassifying 0x0001-0x000F matters on the implicit-VR read path, where
 * isPrivateCreator() promotes unknown tags to VR LO.
 *
 * Triage category: A (synthetic reproducer).
 */
import { Tag } from "../../src/Tag.js";

describe("issue #356 — Tag.isPrivateCreator range per PS3.5 7.8", () => {
    const t = (group, element) => Tag.fromNumbers(group, element);

    it("classifies (0009,0010) — first creator slot — as a private creator", () => {
        expect(t(0x0009, 0x0010).isPrivateCreator()).toBe(true);
    });

    it("classifies (0009,00FF) — last creator slot — as a private creator", () => {
        expect(t(0x0009, 0x00ff).isPrivateCreator()).toBe(true);
    });

    it("rejects (0009,0100) — first private DATA element block — as a creator", () => {
        expect(t(0x0009, 0x0100).isPrivateCreator()).toBe(false);
    });

    it("rejects even-group (0008,0010) — standard tags are never private creators", () => {
        expect(t(0x0008, 0x0010).isPrivateCreator()).toBe(false);
    });

    it("rejects (0009,0000) — the group length element", () => {
        expect(t(0x0009, 0x0000).isPrivateCreator()).toBe(false);
    });

    // Fixed in this arc: Tag.isPrivateCreator now requires element
    // 0x0010-0x00FF per PS3.5 7.8.1, so the reserved odd-group elements
    // 0x0001-0x000F are no longer classified as private creators.
    it("#356: reserved odd-group elements 0x0001-0x000F are not private creators", () => {
        expect(t(0x0009, 0x0001).isPrivateCreator()).toBe(false);
        expect(t(0x0009, 0x000f).isPrivateCreator()).toBe(false);
    });
});
