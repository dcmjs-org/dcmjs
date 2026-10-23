import log from "loglevel";

// The root rollup build replaces the read below with the build-time level;
// elsewhere a browser has no `process`, so the read can throw.
let level;
try {
    level = process.env.LOG_LEVEL;
} catch {
    level = undefined;
}
log.setLevel(isLogLevel(level) ? level : "warn");

/**
 * True for a level that loglevel accepts: a level name (case-insensitive) or
 * a number from 0 to 5. Another library's level name, for example "verbose"
 * (winston) or "fatal" (pino), is not one, and loglevel 1.9 throws for it
 * (pimterry/loglevel#210 proposes log.parseLevel for this check).
 */
function isLogLevel(value) {
    if (typeof value === "string") {
        return log.levels?.[value.toUpperCase()] !== undefined;
    }
    return typeof value === "number" && value >= 0 && value <= 5;
}

const validationLog = log.getLogger("validation.dcmjs");

export { log, validationLog };
export default log;
