const CONTROLLER_HTTP_REQUEST_TIMEOUT_MS = 15_000;
const CONTROLLER_HTTP_HEADERS_TIMEOUT_MS = 10_000;
const CONTROLLER_HTTP_KEEP_ALIVE_TIMEOUT_MS = 5_000;
const CONTROLLER_HTTP_MAX_HEADERS_COUNT = 64;

function validatePositiveFiniteInteger(name, value) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
        throw new TypeError(name + " must be a positive finite integer");
    }
}

function applyControllerHttpSettings(server, options = {}) {
    const requestTimeoutMs = options.requestTimeoutMs === undefined
        ? CONTROLLER_HTTP_REQUEST_TIMEOUT_MS
        : options.requestTimeoutMs;
    const headersTimeoutMs = options.headersTimeoutMs === undefined
        ? CONTROLLER_HTTP_HEADERS_TIMEOUT_MS
        : options.headersTimeoutMs;
    const keepAliveTimeoutMs = options.keepAliveTimeoutMs === undefined
        ? CONTROLLER_HTTP_KEEP_ALIVE_TIMEOUT_MS
        : options.keepAliveTimeoutMs;
    const maxHeadersCount = options.maxHeadersCount === undefined
        ? CONTROLLER_HTTP_MAX_HEADERS_COUNT
        : options.maxHeadersCount;

    validatePositiveFiniteInteger("requestTimeoutMs", requestTimeoutMs);
    validatePositiveFiniteInteger("headersTimeoutMs", headersTimeoutMs);
    validatePositiveFiniteInteger("keepAliveTimeoutMs", keepAliveTimeoutMs);
    validatePositiveFiniteInteger("maxHeadersCount", maxHeadersCount);

    if (headersTimeoutMs > requestTimeoutMs) {
        throw new RangeError("headersTimeoutMs must not exceed requestTimeoutMs");
    }

    server.requestTimeout = requestTimeoutMs;
    server.headersTimeout = headersTimeoutMs;
    server.keepAliveTimeout = keepAliveTimeoutMs;
    server.maxHeadersCount = maxHeadersCount;

    return server;
}

module.exports = {
    CONTROLLER_HTTP_REQUEST_TIMEOUT_MS,
    CONTROLLER_HTTP_HEADERS_TIMEOUT_MS,
    CONTROLLER_HTTP_KEEP_ALIVE_TIMEOUT_MS,
    CONTROLLER_HTTP_MAX_HEADERS_COUNT,
    applyControllerHttpSettings
};
