import log from "loglevel";

// A browser has no `process`; the root rollup build replaces the expression.
log.setLevel(
    (typeof process !== "undefined" && process.env.LOG_LEVEL) || "warn"
);

const validationLog = log.getLogger("validation.dcmjs");

export { log, validationLog };
export default log;
