// Mock loglevel
const createMockLogger = () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setLevel: jest.fn()
});

const mockLog = createMockLogger();

mockLog.getLogger = jest.fn(name => {
    const namedLogger = createMockLogger();
    namedLogger.name = name;
    return namedLogger;
});

jest.mock("loglevel", () => mockLog);

// Optionally, if you want to make the mock available globally for easier assertions
global.mockLog = mockLog;
