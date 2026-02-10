import { registerPrivatesModule } from "./dictionary.fast.js";
import * as privateData from "./dictionary.private.data.js";

registerPrivatesModule(privateData);

export * from "./index.js";
export { default } from "./index.js";
