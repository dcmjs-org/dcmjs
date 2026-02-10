/**
 * No-op when private tags are already registered (e.g. UMD bundle).
 * ESM build aliases this to loadPrivateTags.esm.js for async loading.
 */
export function loadPrivateTags() {
    return Promise.resolve();
}
