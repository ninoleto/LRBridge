const bridgeModule = require("./server/bridge");

const defaultBridge = bridgeModule.createBridge();
const startPromise = defaultBridge.start();

module.exports = Object.assign({}, bridgeModule, {
    defaultBridge: defaultBridge,
    startPromise: startPromise,
    ready: startPromise
});

if (require.main === module) {
    startPromise.catch(async function (err) {
        console.error("Failed to start LRBridge:", err && err.message ? err.message : err);
        try {
            await defaultBridge.stop();
        } catch (stopErr) {
            console.error("Failed to clean up LRBridge startup:", stopErr && stopErr.message ? stopErr.message : stopErr);
        }
        process.exitCode = 1;
    });
}
