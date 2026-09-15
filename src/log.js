import loglevel from "loglevel";

// Use a named child logger so importing dcmjs never reconfigures the host
// application's root loglevel logger (R7: the old module-level
// `log.setLevel(...)` on the root logger clobbered host app log levels).
const log = loglevel.getLogger("dcmjs");
log.setLevel(process.env.LOG_LEVEL || "warn");

// Callers (e.g. AsyncDicomReader) create named sub-loggers via
// log.getLogger; delegate to loglevel's global registry so the names and
// instances match the pre-1.0 behavior, without exposing the root logger.
log.getLogger = (...args) => loglevel.getLogger(...args);

const validationLog = loglevel.getLogger("validation.dcmjs");

export { log, validationLog };
export default log;
