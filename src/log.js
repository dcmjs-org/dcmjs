import log from "loglevel";

/**
 * A validation log shows issues with data validation, and not internal issues itself.
 * This is validation.dcmjs to group the validation issues into a single validation set to allow
 * turning validation on/off.
 */
const validationLog = log.create("validation.dcmjs");

log.setLevel(process.env.LOG_LEVEL || "warn");

export { log, validationLog };
export default log;
