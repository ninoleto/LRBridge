const http = require("http");

const DEFAULT_UPSTREAM_HOST = "127.0.0.1";
const DEFAULT_UPSTREAM_PORT = 17891;
const DEFAULT_TIMEOUT_MS = 10000;

function validateTimeoutMs(timeoutMs) {
    if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError("timeoutMs must be a positive finite integer");
    }
}

function isResponseUsable(response) {
    return !response.destroyed && !response.writableEnded;
}

function proxyControllerRequest(incomingRequest, downstreamResponse, pathAndQuery, options = {}) {
    const upstreamHost = options.upstreamHost === undefined ? DEFAULT_UPSTREAM_HOST : options.upstreamHost;
    const upstreamPort = options.upstreamPort === undefined ? DEFAULT_UPSTREAM_PORT : options.upstreamPort;
    const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
    const httpRequest = options.httpRequest || http.request;

    validateTimeoutMs(timeoutMs);

    return new Promise(function (resolve) {
        let terminal = false;
        let upstreamRequest = null;
        let upstreamResponse = null;

        function finish() {
            if (terminal) {
                return false;
            }

            terminal = true;
            incomingRequest.removeListener("aborted", handleDownstreamDisconnect);
            downstreamResponse.removeListener("close", handleDownstreamClose);
            resolve();
            return true;
        }

        function cancelUpstream() {
            if (!finish()) {
                return;
            }

            if (upstreamResponse !== null && !upstreamResponse.destroyed) {
                upstreamResponse.destroy();
            }

            if (upstreamRequest !== null && !upstreamRequest.destroyed) {
                upstreamRequest.destroy();
            }
        }

        function handleDownstreamDisconnect() {
            cancelUpstream();
        }

        function handleDownstreamClose() {
            if (!downstreamResponse.writableEnded) {
                cancelUpstream();
            }
        }

        function sendResponse(statusCode, body) {
            if (terminal || !isResponseUsable(downstreamResponse) || downstreamResponse.headersSent) {
                cancelUpstream();
                return;
            }

            terminal = true;
            incomingRequest.removeListener("aborted", handleDownstreamDisconnect);
            downstreamResponse.removeListener("close", handleDownstreamClose);

            downstreamResponse.writeHead(statusCode || 500, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            });

            if (isResponseUsable(downstreamResponse)) {
                downstreamResponse.end(body || "{}");
            }

            resolve();
        }

        incomingRequest.once("aborted", handleDownstreamDisconnect);
        downstreamResponse.once("close", handleDownstreamClose);

        if (incomingRequest.aborted || !isResponseUsable(downstreamResponse)) {
            cancelUpstream();
            return;
        }

        upstreamRequest = httpRequest(
            {
                hostname: upstreamHost,
                port: upstreamPort,
                path: pathAndQuery,
                method: "GET",
                timeout: timeoutMs
            },
            function (response) {
                upstreamResponse = response;

                if (terminal) {
                    response.destroy();
                    return;
                }

                let body = "";
                response.setEncoding("utf8");

                response.on("data", function (chunk) {
                    if (!terminal) {
                        body += chunk;
                    }
                });

                response.on("end", function () {
                    if (!terminal) {
                        sendResponse(response.statusCode, body);
                    }
                });
            }
        );

        upstreamRequest.on("error", function (err) {
            if (terminal) {
                return;
            }

            sendResponse(
                500,
                JSON.stringify({
                    ok: false,
                    error: err.message
                })
            );
        });

        upstreamRequest.on("timeout", function () {
            if (!terminal) {
                upstreamRequest.destroy(new Error("Request timed out"));
            }
        });

        if (terminal) {
            upstreamRequest.destroy();
            return;
        }

        upstreamRequest.end();
    });
}

module.exports = {
    DEFAULT_UPSTREAM_HOST,
    DEFAULT_UPSTREAM_PORT,
    DEFAULT_TIMEOUT_MS,
    proxyControllerRequest
};
