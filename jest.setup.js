// Jest setup - uses real loglevel, writing to stdout to avoid stack traces from console.warn/error.
// Format: loggerName [LEVEL] message
// Log level is controlled by LOG_LEVEL env (default "warn" in src/log.js).

const loglevel = require("loglevel");
const { inspect } = require("util");

loglevel.methodFactory = function (methodName, _level, loggerName) {
    return function (...args) {
        const message = args
            .map((a) => (typeof a === "string" ? a : inspect(a)))
            .join(" ");
        const name =
            loggerName != null && loggerName !== ""
                ? String(loggerName)
                : "log";
        process.stdout.write(`${name} [${methodName.toUpperCase()}] ${message}\n`);
    };
};
loglevel.rebuild();
