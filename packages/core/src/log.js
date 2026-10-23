import log from "loglevel";

// The root rollup build replaces the read below with the build-time level;
// elsewhere a browser has no `process`, so the read can throw.
let level;
try {
    level = process.env.LOG_LEVEL;
} catch {
    level = undefined;
}
log.setLevel(toLogLevel(level) ?? "warn");

/**
 * The loglevel level of a value: a level name (case-insensitive), or a
 * number from 0 to 5, also as a string ("1"), because an environment
 * variable is a string. Undefined for any other value, for example
 * "verbose" (winston) or "fatal" (pino), for which loglevel 1.9 throws
 * (pimterry/loglevel#210 proposes log.parseLevel for this check).
 */
function toLogLevel(value) {
    if (typeof value === "string" && /^[0-5]$/.test(value)) {
        return Number(value);
    }
    if (typeof value === "string") {
        return log.levels?.[value.toUpperCase()] !== undefined
            ? value
            : undefined;
    }
    return typeof value === "number" && value >= 0 && value <= 5
        ? value
        : undefined;
}

const validationLog = log.getLogger("validation.dcmjs");

export { log, validationLog };
export default log;
