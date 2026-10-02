import log from "loglevel";

log.setLevel(process.env.LOG_LEVEL || "warn");

const validationLog = log.getLogger("validation.dcmjs");

export { log, validationLog };
export default log;
