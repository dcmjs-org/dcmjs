import loglevel from "loglevel";

// Use global loglevel instance when present, otherwise use imported one
const dcmjsLog =
    typeof globalThis !== "undefined" &&
    globalThis.log &&
    typeof globalThis.log.getLogger === "function"
        ? globalThis.log
        : loglevel;

const log = dcmjsLog.getLogger("dcmjs");
log.setLevel(process.env.LOG_LEVEL || "warn");

const validationLog = dcmjsLog.getLogger("validation.dcmjs");

export { log, validationLog, dcmjsLog, loglevel };
export default log;
