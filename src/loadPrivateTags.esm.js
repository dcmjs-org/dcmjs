import { registerPrivatesModule } from "./dictionary.fast.js";

/**
 * ESM-only: dynamically import private tag data and register with dictionary.fast.
 */
export async function loadPrivateTags() {
    const privateData = await import("./dictionary.private.data.js");
    registerPrivatesModule(privateData);
}
