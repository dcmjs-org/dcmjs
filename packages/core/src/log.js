import log from "loglevel";

// The root rollup build replaces process.env.LOG_LEVEL with the build-time
// level; elsewhere a browser has no `process`, so the read can throw.
let level;
try {
    level = process.env.LOG_LEVEL;
} catch {
    level = undefined;
}
log.setLevel(level || "warn");

const validationLog = log.getLogger("validation.dcmjs");

export { log, validationLog };
export default log;
