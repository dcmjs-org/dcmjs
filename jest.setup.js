// Mock loglevel
const createMockLogger = () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        setLevel: jest.fn(),
    };

    // Modify warn to print directly to stdout instead of console.warn
    logger.warn.mockImplementation((...args) => {
        // Directly write to stdout to avoid Jest stack traces
        process.stdout.write('[warn] ' + args.join(' ') + '\n');
    });

    return logger;
};

const mockLog = createMockLogger();

mockLog.getLogger = jest.fn(name => {
    const namedLogger = createMockLogger();
    namedLogger.name = name;
    return namedLogger;
});

jest.mock('loglevel', () => mockLog);

// Optional global access for assertions
global.mockLog = mockLog;

const originalConsoleWarn = console.warn;

// Override console.warn to remove stack traces
console.warn = (...args) => {
    // Print message only
    process.stdout.write('[warn] ' + args.map(arg => {
        // Stringify objects nicely
        if (typeof arg === 'object' && arg !== null) {
            try {
                return JSON.stringify(arg, null, 2);
            } catch {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ') + '\n');
};
