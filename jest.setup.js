const { Console } = require("console");
const nodeConsole = new Console(process.stdout, process.stderr);

// Mock loglevel
const createMockLogger = () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        setLevel: jest.fn()
    };

    // Modify warn to print directly to stdout instead of console.warn
    logger.warn.mockImplementation((...args) => {
        // This uses Node's real util.inspect internally
        nodeConsole.warn("[warn]", ...args);
    });

    return logger;
};

const mockLog = createMockLogger();

mockLog.getLogger = jest.fn(name => {
    const namedLogger = createMockLogger();
    namedLogger.name = name;
    return namedLogger;
});

jest.mock("loglevel", () => mockLog);

// Optional global access for assertions
global.mockLog = mockLog;

// Override console.warn to remove stack traces
console.warn = nodeConsole.warn;
console.time = nodeConsole.time;
console.timeEnd = nodeConsole.timeEnd;
