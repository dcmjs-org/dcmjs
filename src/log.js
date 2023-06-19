import loglevelnext from "loglevelnext";

const log = loglevelnext.create("dcmjs");

/**
 * A validation log shows issues with data validation, and not internal issues itself.
 * This is validation.dcmjs to group the validation issues into a single validation set to allow
 * turning validation on/off.
 */
const validationLog = loglevelnext.create("validation.dcmjs");

export { log, validationLog };
export default log;
