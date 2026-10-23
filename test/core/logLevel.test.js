/**
 * The log level of @dcmjs-org/core comes from LOG_LEVEL when that is a
 * loglevel level, and is "warn" otherwise (WRAP-IMP-8).
 */
const LOG_MODULE = "../../packages/core/src/log.js";

function loadWith(level) {
    const saved = process.env.LOG_LEVEL;
    if (level === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = level;
    try {
        let log;
        jest.isolateModules(() => {
            // jest.setup.js mocks loglevel; this test needs the real one
            jest.doMock("loglevel", () => jest.requireActual("loglevel"));
            log = require(LOG_MODULE).log;
        });
        return log;
    } finally {
        if (saved === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = saved;
    }
}

describe("the LOG_LEVEL environment variable", () => {
    it("a level of another logging library does not stop the import", () => {
        // "verbose" (winston) and "fatal" (pino) are not loglevel levels
        for (const level of ["verbose", "fatal"]) {
            expect(loadWith(level).getLevel()).toBe(3); // warn
        }
    });

    it("a loglevel level applies, and no level gives warn", () => {
        expect(loadWith("debug").getLevel()).toBe(1);
        expect(loadWith(undefined).getLevel()).toBe(3);
    });
});
