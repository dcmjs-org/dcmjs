import { ValueRepresentation as CoreValueRepresentation } from "@dcmjs-org/core";
import { addTagAccessors } from "./tagAccessors.js";

/**
 * Core's ValueRepresentation, plus the 0.x static addTagAccessors, which is
 * now a no-op (see tagAccessors.js). Core has no such method, so the 0.x
 * surface takes this class instead.
 */
export class ValueRepresentation extends CoreValueRepresentation {
    static addTagAccessors(tag) {
        return addTagAccessors(tag);
    }
}
