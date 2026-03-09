import loglevel from "loglevel";

/** Root logger: use noConflict() in browser to restore window.log, then use same logger */
const log =
    typeof loglevel.noConflict === "function"
        ? loglevel.noConflict()
        : loglevel;

log.setLevel(process.env.LOG_LEVEL || "warn");

/**
 * DICOM validation logger.
 * - error: something is an error and can't be recovered from
 * - warn: serious issue but execution can continue
 * - info: something not quite right but won't cause immediate problems
 */
const validationLog = log.getLogger("validation.dcmjs");
const dcmjsLog = log.getLogger("dcmjs");

export { log, validationLog, dcmjsLog };
export default log;
