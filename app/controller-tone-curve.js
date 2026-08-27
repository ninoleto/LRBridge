(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.LRBridgeToneCurve = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const CHANNELS = Object.freeze(["rgb", "red", "green", "blue"]);
    const CHANNEL_LABELS = Object.freeze({ rgb: "RGB", red: "Red", green: "Green", blue: "Blue" });
    const REFINE_SATURATION_FIELD = "CurveRefineSaturation";
    const PRESET_CURVES = Object.freeze({
        Linear: Object.freeze([0, 0, 255, 255]),
        "Medium Contrast": Object.freeze([0, 0, 32, 22, 64, 56, 128, 128, 192, 196, 255, 255]),
        "Strong Contrast": Object.freeze([0, 0, 32, 16, 64, 50, 128, 128, 192, 202, 255, 255])
    });
    const MIN_COORDINATE = 0;
    const MAX_COORDINATE = 255;
    const VISUAL_POINT_RADIUS = 2.6;
    const TOUCH_TARGET_RADIUS = 12;
    const POINTER_DRAG_THRESHOLD_PX = 2;
    const POINT_CURVE_REQUEST_TIMEOUT_MS = 15_000;
    const POINT_CURVE_FEEDBACK_TIMEOUT_MS = 15_000;

    function isDenseArray(value) {
        if (!Array.isArray(value) || Object.keys(value).length !== value.length) return false;
        for (let index = 0; index < value.length; index += 1) {
            if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
        }
        return true;
    }

    function validCurveArray(value) {
        if (!isDenseArray(value) || value.length < 4 || value.length > 512 || value.length % 2 !== 0) return false;
        let previousX = null;
        for (let index = 0; index < value.length; index += 2) {
            const x = value[index];
            const y = value[index + 1];
            if (!Number.isFinite(x) || !Number.isInteger(x) || x < 0 || x > 255 ||
                !Number.isFinite(y) || !Number.isInteger(y) || y < 0 || y > 255 ||
                (previousX !== null && x <= previousX)) return false;
            previousX = x;
        }
        return value[0] === 0 && value[value.length - 2] === 255;
    }

    function serializeCurve(points) {
        return validCurveArray(points) ? points.join(",") : null;
    }

    function clampCoordinate(value) {
        return Math.min(MAX_COORDINATE, Math.max(MIN_COORDINATE, Math.round(value)));
    }

    function graphCoordinates(clientX, clientY, bounds) {
        if (!bounds || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.top) ||
            !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
            return null;
        }
        return {
            x: clampCoordinate((clientX - bounds.left) * 255 / bounds.width),
            y: clampCoordinate((bounds.top + bounds.height - clientY) * 255 / bounds.height)
        };
    }

    // Adobe's public DNG SDK dng_spline_solver computes the unique natural
    // cubic spline (C0/C1/C2 continuous, zero second derivative at both ends).
    // Point Curve metadata uses the same ordered tone-coordinate model, so the
    // solver is the closest public Adobe reference for rendering these points.
    function adobeSplineSlopes(points) {
        if (!validCurveArray(points)) return null;
        const count = points.length / 2;
        const x = [];
        const y = [];
        for (let index = 0; index < count; index += 1) {
            x.push(points[index * 2]);
            y.push(points[index * 2 + 1]);
        }

        let interval = x[1] - x[0];
        let secant = (y[1] - y[0]) / interval;
        const slopes = new Array(count);
        slopes[0] = secant;
        for (let index = 2; index < count; index += 1) {
            const nextInterval = x[index] - x[index - 1];
            const nextSecant = (y[index] - y[index - 1]) / nextInterval;
            slopes[index - 1] = (secant * nextInterval + nextSecant * interval) /
                (interval + nextInterval);
            interval = nextInterval;
            secant = nextSecant;
        }
        slopes[count - 1] = 2 * secant - slopes[count - 2];
        slopes[0] = 2 * slopes[0] - slopes[1];

        if (count > 2) {
            const upper = new Array(count).fill(0);
            const lower = new Array(count).fill(0);
            const solved = new Array(count).fill(0);
            lower[0] = 0.5;
            upper[count - 1] = 0.5;
            solved[0] = 0.75 * (slopes[0] + slopes[1]);
            solved[count - 1] = 0.75 * (slopes[count - 2] + slopes[count - 1]);

            for (let index = 1; index < count - 1; index += 1) {
                const span = (x[index + 1] - x[index - 1]) * 2;
                upper[index] = (x[index + 1] - x[index]) / span;
                lower[index] = (x[index] - x[index - 1]) / span;
                solved[index] = 1.5 * slopes[index];
            }
            for (let index = 1; index < count; index += 1) {
                const divisor = 1 - lower[index - 1] * upper[index];
                if (index !== count - 1) lower[index] /= divisor;
                solved[index] = (solved[index] - solved[index - 1] * upper[index]) / divisor;
            }
            for (let index = count - 2; index >= 0; index -= 1) {
                solved[index] -= lower[index] * solved[index + 1];
            }
            return solved;
        }
        return slopes;
    }

    function curveSegments(points) {
        const slopes = adobeSplineSlopes(points);
        if (!slopes) return null;
        const segments = [];
        for (let index = 0; index < slopes.length - 1; index += 1) {
            const x0 = points[index * 2];
            const y0 = points[index * 2 + 1];
            const x1 = points[(index + 1) * 2];
            const y1 = points[(index + 1) * 2 + 1];
            const width = x1 - x0;
            segments.push(Object.freeze({
                x0: x0,
                y0: y0,
                c1x: x0 + width / 3,
                c1y: y0 + slopes[index] * width / 3,
                c2x: x1 - width / 3,
                c2y: y1 - slopes[index + 1] * width / 3,
                x1: x1,
                y1: y1
            }));
        }
        return segments;
    }

    function pathNumber(value) {
        const rounded = Math.round(value * 1000000) / 1000000;
        return String(Object.is(rounded, -0) ? 0 : rounded);
    }

    function curvePathData(points) {
        const segments = curveSegments(points);
        if (!segments || segments.length === 0) return "";
        const commands = ["M " + pathNumber(segments[0].x0) + " " + pathNumber(255 - segments[0].y0)];
        segments.forEach(function (segment) {
            commands.push("C " + pathNumber(segment.c1x) + " " + pathNumber(255 - segment.c1y) + " " +
                pathNumber(segment.c2x) + " " + pathNumber(255 - segment.c2y) + " " +
                pathNumber(segment.x1) + " " + pathNumber(255 - segment.y1));
        });
        return commands.join(" ");
    }

    function selectedPointValues(points, pointIndex) {
        if (!validCurveArray(points) || !Number.isSafeInteger(pointIndex) || pointIndex < 0 ||
            pointIndex >= points.length / 2) return null;
        return Object.freeze({ input: points[pointIndex * 2], output: points[pointIndex * 2 + 1] });
    }

    function addPoint(points, x, y) {
        if (!validCurveArray(points)) return null;
        const nextX = clampCoordinate(x);
        const nextY = clampCoordinate(y);
        if (nextX <= 0 || nextX >= 255) return null;
        const result = points.slice();
        for (let index = 0; index < result.length; index += 2) {
            if (result[index] === nextX) return null;
            if (result[index] > nextX) {
                result.splice(index, 0, nextX, nextY);
                return { points: result, pointIndex: index / 2 };
            }
        }
        return null;
    }

    function createInsertionIdentity(points, pointIndex) {
        if (!validCurveArray(points) || !Number.isSafeInteger(pointIndex) || pointIndex <= 0 ||
            pointIndex >= points.length / 2) return null;
        return Object.freeze({
            originalLength: points.length,
            insertionIndex: pointIndex,
            left: Object.freeze([points[(pointIndex - 1) * 2], points[(pointIndex - 1) * 2 + 1]]),
            right: Object.freeze([points[pointIndex * 2], points[pointIndex * 2 + 1]])
        });
    }

    function insertionBaselineMatches(points, identity) {
        if (!validCurveArray(points) || !identity || points.length !== identity.originalLength ||
            !Number.isSafeInteger(identity.insertionIndex)) return false;
        const index = identity.insertionIndex;
        return index > 0 && index < points.length / 2 && Array.isArray(identity.left) &&
            Array.isArray(identity.right) && points[(index - 1) * 2] === identity.left[0] &&
            points[(index - 1) * 2 + 1] === identity.left[1] &&
            points[index * 2] === identity.right[0] && points[index * 2 + 1] === identity.right[1];
    }

    function locateInsertedPoint(points, identity) {
        if (!validCurveArray(points) || !identity || points.length !== identity.originalLength + 2 ||
            !Number.isSafeInteger(identity.insertionIndex)) return null;
        const index = identity.insertionIndex;
        if (index <= 0 || index >= points.length / 2 - 1 || !Array.isArray(identity.left) ||
            !Array.isArray(identity.right)) return null;
        return points[(index - 1) * 2] === identity.left[0] &&
            points[(index - 1) * 2 + 1] === identity.left[1] &&
            points[(index + 1) * 2] === identity.right[0] &&
            points[(index + 1) * 2 + 1] === identity.right[1] ? index : null;
    }

    function movePoint(points, pointIndex, x, y) {
        if (!validCurveArray(points) || !Number.isSafeInteger(pointIndex) || pointIndex < 0 || pointIndex >= points.length / 2) {
            return null;
        }
        const result = points.slice();
        const lastPointIndex = points.length / 2 - 1;
        const constrainedY = clampCoordinate(y);
        let constrainedX;
        if (pointIndex === 0) constrainedX = 0;
        else if (pointIndex === lastPointIndex) constrainedX = 255;
        else {
            const previousX = points[(pointIndex - 1) * 2];
            const nextX = points[(pointIndex + 1) * 2];
            constrainedX = Math.min(nextX - 1, Math.max(previousX + 1, clampCoordinate(x)));
        }
        result[pointIndex * 2] = constrainedX;
        result[pointIndex * 2 + 1] = constrainedY;
        return validCurveArray(result) ? result : null;
    }

    function deletePoint(points, pointIndex) {
        if (!validCurveArray(points) || !Number.isSafeInteger(pointIndex) || pointIndex <= 0 ||
            pointIndex >= points.length / 2 - 1) return null;
        const result = points.slice();
        result.splice(pointIndex * 2, 2);
        return validCurveArray(result) ? result : null;
    }

    function curvesEqual(left, right) {
        return serializeCurve(left) !== null && serializeCurve(left) === serializeCurve(right);
    }

    function validRefineSaturation(value) {
        return value && typeof value === "object" && Number.isFinite(value.value) &&
            Number.isFinite(value.min) && Number.isFinite(value.max) && value.min < value.max &&
            value.value >= value.min && value.value <= value.max;
    }

    function parseRefineEditorValue(text, range) {
        if (!validRefineSaturation(range) || typeof text !== "string") return null;
        const trimmed = text.trim();
        if (trimmed === "" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) return null;
        return Math.min(range.max, Math.max(range.min, Math.round(numeric)));
    }

    function presetCurve(name) {
        return typeof name === "string" && Object.prototype.hasOwnProperty.call(PRESET_CURVES, name)
            ? PRESET_CURVES[name].slice() : null;
    }

    function validBinding(value) {
        return value && typeof value.selectedPhotoUuid === "string" && value.selectedPhotoUuid.length > 0 &&
            Number.isSafeInteger(value.contextCounter) && value.contextCounter >= 0 &&
            Number.isSafeInteger(value.developCounter) && value.developCounter >= 0;
    }

    function sameIdentity(left, right) {
        return validBinding(left) && validBinding(right) && left.selectedPhotoUuid === right.selectedPhotoUuid &&
            left.contextCounter === right.contextCounter;
    }

    function bindingsEqual(left, right) {
        return sameIdentity(left, right) && left.developCounter === right.developCounter;
    }

    function normalizeSnapshot(value) {
        if (!value || value.available !== true || !validBinding(value) || typeof value.name !== "string" ||
            !validRefineSaturation(value.refineSaturation) ||
            !value.curves || typeof value.curves !== "object") return null;
        const curves = {};
        for (const channel of CHANNELS) {
            if (!validCurveArray(value.curves[channel])) return null;
            curves[channel] = value.curves[channel].slice();
        }
        return {
            available: true,
            selectedPhotoUuid: value.selectedPhotoUuid,
            contextCounter: value.contextCounter,
            developCounter: value.developCounter,
            revision: Number.isSafeInteger(value.revision) ? value.revision : 0,
            updatedAt: Number.isFinite(value.updatedAt) && value.updatedAt >= 0 ? value.updatedAt : 0,
            name: value.name,
            refineSaturation: Object.assign({}, value.refineSaturation),
            curves: curves
        };
    }

    function createAwaitingScalar(value, snapshot, submittedAt, gestureId) {
        if (!Number.isFinite(value) || !normalizeSnapshot(snapshot)) return null;
        return {
            gestureId: gestureId || null,
            selectedPhotoUuid: snapshot.selectedPhotoUuid,
            contextCounter: snapshot.contextCounter,
            developCounter: snapshot.developCounter,
            submittedDevelopCounter: snapshot.developCounter,
            submittedRevision: snapshot.revision,
            submittedUpdatedAt: snapshot.updatedAt,
            value: value,
            submittedAt: submittedAt
        };
    }

    function resolveAwaitingScalar(transaction, snapshot) {
        if (!transaction || !snapshot || !validBinding(snapshot) || !validRefineSaturation(snapshot.refineSaturation) ||
            transaction.selectedPhotoUuid !== snapshot.selectedPhotoUuid ||
            transaction.contextCounter !== snapshot.contextCounter) return null;
        if (snapshot.refineSaturation.value === transaction.value) return "matched";
        return authoritativeSnapshotIsNewer(snapshot, transaction) ? "superseded" : null;
    }

    function createAwaitingPreset(name, points, snapshot, submittedAt) {
        if (!presetCurve(name) || !validCurveArray(points) || !normalizeSnapshot(snapshot)) return null;
        return {
            name: name,
            points: points.slice(),
            selectedPhotoUuid: snapshot.selectedPhotoUuid,
            contextCounter: snapshot.contextCounter,
            submittedDevelopCounter: snapshot.developCounter,
            submittedRevision: snapshot.revision,
            submittedUpdatedAt: snapshot.updatedAt,
            submittedAt: submittedAt
        };
    }

    function resolveAwaitingPreset(transaction, snapshot) {
        if (!transaction || !snapshot || !validBinding(snapshot) ||
            transaction.selectedPhotoUuid !== snapshot.selectedPhotoUuid ||
            transaction.contextCounter !== snapshot.contextCounter) return null;
        if (curvesEqual(snapshot.curves.rgb, transaction.points) && snapshot.name === transaction.name) return "matched";
        return authoritativeSnapshotIsNewer(snapshot, transaction) ? "superseded" : null;
    }

    function authoritativeSnapshotIsNewer(snapshot, transaction) {
        return !!snapshot && !!transaction && validBinding(snapshot) &&
            snapshot.selectedPhotoUuid === transaction.selectedPhotoUuid &&
            snapshot.contextCounter === transaction.contextCounter &&
            (snapshot.developCounter > transaction.submittedDevelopCounter ||
                snapshot.revision > transaction.submittedRevision ||
                (Number.isFinite(transaction.submittedAt) && snapshot.updatedAt > transaction.submittedAt));
    }

    function createAwaitingTarget(session, points, snapshot, submittedAt) {
        if (!session || typeof session.id !== "string" || !validCurveArray(points) ||
            !normalizeSnapshot(snapshot)) return null;
        const transaction = {
            channel: session.channel,
            gestureId: session.id,
            operation: session.operation || "change",
            selectedPhotoUuid: snapshot.selectedPhotoUuid,
            contextCounter: snapshot.contextCounter,
            submittedDevelopCounter: snapshot.developCounter,
            submittedRevision: snapshot.revision,
            submittedUpdatedAt: snapshot.updatedAt,
            points: points.slice(),
            submittedAt: submittedAt
        };
        if (session.insertion) {
            transaction.insertion = {
                originalLength: session.insertion.originalLength,
                insertionIndex: session.insertion.insertionIndex,
                left: session.insertion.left.slice(),
                right: session.insertion.right.slice()
            };
        }
        return transaction;
    }

    function resolveAwaitingTarget(transaction, snapshot) {
        if (!transaction || !snapshot || !validBinding(snapshot) ||
            transaction.selectedPhotoUuid !== snapshot.selectedPhotoUuid ||
            transaction.contextCounter !== snapshot.contextCounter ||
            !Object.prototype.hasOwnProperty.call(snapshot.curves, transaction.channel)) return null;
        if (curvesEqual(snapshot.curves[transaction.channel], transaction.points)) return "matched";
        return authoritativeSnapshotIsNewer(snapshot, transaction) ? "superseded" : null;
    }

    function remapSelectedPointIndex(previousPoints, nextPoints, pointIndex) {
        if (!Number.isSafeInteger(pointIndex) || !validCurveArray(nextPoints)) return null;
        const nextCount = nextPoints.length / 2;
        if (!validCurveArray(previousPoints)) return pointIndex >= 0 && pointIndex < nextCount ? pointIndex : null;
        if (previousPoints.length === nextPoints.length) return pointIndex >= 0 && pointIndex < nextCount ? pointIndex : null;
        if (pointIndex < 0 || pointIndex >= previousPoints.length / 2) return null;
        const previousX = previousPoints[pointIndex * 2];
        const previousY = previousPoints[pointIndex * 2 + 1];
        for (let index = 0; index < nextCount; index += 1) {
            if (nextPoints[index * 2] === previousX && nextPoints[index * 2 + 1] === previousY) return index;
        }
        for (let index = 0; index < nextCount; index += 1) {
            if (nextPoints[index * 2] === previousX) return index;
        }
        return null;
    }

    function queryForBinding(binding) {
        return "selectedPhotoUuid=" + encodeURIComponent(binding.selectedPhotoUuid) +
            "&contextCounter=" + encodeURIComponent(binding.contextCounter) +
            "&developCounter=" + encodeURIComponent(binding.developCounter);
    }

    function createController(options) {
        options = options || {};
        const documentObject = options.document || (typeof document !== "undefined" ? document : null);
        const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
        const setStatus = typeof options.setStatus === "function" ? options.setStatus : function () {};
        const setIntervalImpl = options.setInterval || setInterval;
        const clearIntervalImpl = options.clearInterval || clearInterval;
        const setTimeoutImpl = options.setTimeout || setTimeout;
        const clearTimeoutImpl = options.clearTimeout || clearTimeout;
        const now = typeof options.now === "function" ? options.now : Date.now;
        const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
            ? options.requestTimeoutMs : POINT_CURVE_REQUEST_TIMEOUT_MS;
        const feedbackTimeoutMs = Number.isFinite(options.feedbackTimeoutMs) && options.feedbackTimeoutMs > 0
            ? options.feedbackTimeoutMs : POINT_CURVE_FEEDBACK_TIMEOUT_MS;
        const createAbortController = options.createAbortController ||
            (typeof AbortController === "function" ? function () { return new AbortController(); } : null);
        const windowObject = options.window || (typeof window !== "undefined" ? window : null);
        if (!documentObject || !fetchImpl) throw new TypeError("Point Curve controller requires document and fetch");

        let rootElement = null;
        let svg = null;
        let curvePath = null;
        let previewPath = null;
        let previewMarker = null;
        let handlesGroup = null;
        let overlay = null;
        let inputValueElement = null;
        let outputValueElement = null;
        let refineRow = null;
        let refineRange = null;
        let refineNumber = null;
        let refineResetButton = null;
        let presetSelect = null;
        let addPointButton = null;
        let addPointInstruction = null;
        let deleteButton = null;
        let resetButton = null;
        let channelButtons = {};
        let active = false;
        let pollTimer = null;
        let requestInFlight = false;
        let stateRequestController = null;
        let stateRequestToken = 0;
        let recoveryListenersInstalled = false;
        let expectedBinding = null;
        let authoritative = null;
        let selectedChannel = "rgb";
        let selectedPointIndex = null;
        let gesture = null;
        let gestureCounter = 0;
        let awaitingTarget = null;
        let awaitingReset = null;
        let refineGesture = null;
        let awaitingRefine = null;
        let awaitingRefineReset = null;
        let awaitingPreset = null;
        let presetRequestInFlight = false;
        let presetRequestToken = 0;
        let refineNumberEditing = false;
        let ignoreNextRefineChange = false;
        let presetOptionsSignature = "";
        let addPointArmed = false;

        function abortStateRequest() {
            stateRequestToken += 1;
            requestInFlight = false;
            const controller = stateRequestController;
            stateRequestController = null;
            if (controller && typeof controller.abort === "function") controller.abort();
        }

        function immediateRefresh() {
            if (!active) return;
            if (requestInFlight) abortStateRequest();
            refresh();
        }

        function cancelAddPointMode(message) {
            const addingSession = gesture && gesture.adding ? gesture : null;
            if (!addPointArmed && !addingSession) return false;
            addPointArmed = false;
            if (addingSession) retireActiveGesture(addingSession, message || "Add Point cancelled");
            else if (message) setStatus(message);
            render();
            return true;
        }

        function handleRecoverySignal(event) {
            cancelAddPointMode("Add Point mode cancelled by controller state change");
            if (event && event.type === "offline") return;
            if (documentObject.visibilityState && documentObject.visibilityState !== "visible") return;
            immediateRefresh();
        }

        function handleControllerKeydown(event) {
            if (event.key !== "Escape" || (!addPointArmed && !(gesture && gesture.adding))) return;
            event.preventDefault();
            cancelAddPointMode("Add Point mode cancelled");
        }

        function installRecoveryListeners() {
            if (recoveryListenersInstalled) return;
            if (windowObject && typeof windowObject.addEventListener === "function") {
                windowObject.addEventListener("focus", handleRecoverySignal);
                windowObject.addEventListener("online", handleRecoverySignal);
                windowObject.addEventListener("offline", handleRecoverySignal);
            }
            if (typeof documentObject.addEventListener === "function") {
                documentObject.addEventListener("visibilitychange", handleRecoverySignal);
                documentObject.addEventListener("keydown", handleControllerKeydown);
            }
            recoveryListenersInstalled = true;
        }

        function removeRecoveryListeners() {
            if (!recoveryListenersInstalled) return;
            if (windowObject && typeof windowObject.removeEventListener === "function") {
                windowObject.removeEventListener("focus", handleRecoverySignal);
                windowObject.removeEventListener("online", handleRecoverySignal);
                windowObject.removeEventListener("offline", handleRecoverySignal);
            }
            if (typeof documentObject.removeEventListener === "function") {
                documentObject.removeEventListener("visibilitychange", handleRecoverySignal);
                documentObject.removeEventListener("keydown", handleControllerKeydown);
            }
            recoveryListenersInstalled = false;
        }

        function svgElement(name, attributes) {
            const element = documentObject.createElementNS("http://www.w3.org/2000/svg", name);
            Object.keys(attributes || {}).forEach(function (key) { element.setAttribute(key, attributes[key]); });
            return element;
        }

        function setUpdating(message) {
            overlay.hidden = false;
            overlay.textContent = message || "Updating Point Curve…";
        }

        function currentPoints() {
            return authoritative && authoritative.curves[selectedChannel]
                ? authoritative.curves[selectedChannel].slice()
                : null;
        }

        function activePreview(points) {
            if (!gesture || !points || gesture.channel !== selectedChannel || !authoritative ||
                !sameIdentity(gesture.identity, authoritative) || (!gesture.adding && !gesture.dragStarted)) return null;
            const previewPoints = gestureTarget(gesture, points);
            if (!previewPoints || !Number.isSafeInteger(gesture.pointIndex) ||
                gesture.pointIndex < 0 || gesture.pointIndex >= previewPoints.length / 2) return null;
            return { points: previewPoints, pointIndex: gesture.pointIndex };
        }

        function updatePresetOptions(name) {
            if (!presetSelect) return;
            const names = Object.keys(PRESET_CURVES);
            if (typeof name === "string" && name !== "" && names.indexOf(name) < 0) names.push(name);
            const signature = names.join("\u0000");
            if (signature !== presetOptionsSignature) {
                presetSelect.replaceChildren();
                names.forEach(function (presetName) {
                    const option = documentObject.createElement("option");
                    option.value = presetName;
                    option.textContent = presetName;
                    option.disabled = !Object.prototype.hasOwnProperty.call(PRESET_CURVES, presetName);
                    presetSelect.appendChild(option);
                });
                presetOptionsSignature = signature;
            }
            const selectedName = typeof name === "string" ? name : "";
            if (presetSelect.value !== selectedName) presetSelect.value = selectedName;
        }

        function interactionBusy() {
            return gesture !== null || refineGesture !== null || awaitingTarget !== null || awaitingReset !== null ||
                awaitingRefine !== null || awaitingRefineReset !== null || awaitingPreset !== null || presetRequestInFlight;
        }

        function render() {
            if (!rootElement) return;
            const points = currentPoints();
            const available = !!points && expectedBinding && bindingsEqual(authoritative, expectedBinding);
            const preview = available ? activePreview(points) : null;
            if (!available) {
                curvePath.setAttribute("d", "");
                curvePath.classList.toggle("previewing", false);
                previewPath.setAttribute("d", "");
                previewPath.setAttribute("display", "none");
                previewMarker.setAttribute("display", "none");
                handlesGroup.replaceChildren();
                inputValueElement.textContent = "—";
                outputValueElement.textContent = "—";
                refineRange.disabled = true;
                refineNumber.disabled = true;
                refineResetButton.disabled = true;
                updatePresetOptions("");
                presetSelect.disabled = true;
                setUpdating();
            } else {
                curvePath.setAttribute("d", curvePathData(points));
                curvePath.setAttribute("data-channel", selectedChannel);
                curvePath.classList.toggle("previewing", !!preview);
                if (preview) {
                    previewPath.setAttribute("d", curvePathData(preview.points));
                    previewPath.setAttribute("data-channel", selectedChannel);
                    previewPath.setAttribute("display", "inline");
                    previewMarker.setAttribute("cx", preview.points[preview.pointIndex * 2]);
                    previewMarker.setAttribute("cy", 255 - preview.points[preview.pointIndex * 2 + 1]);
                    previewMarker.setAttribute("data-channel", selectedChannel);
                    previewMarker.setAttribute("display", "inline");
                } else {
                    previewPath.setAttribute("d", "");
                    previewPath.setAttribute("display", "none");
                    previewMarker.setAttribute("display", "none");
                }
                handlesGroup.replaceChildren();
                for (let pointIndex = 0; pointIndex < points.length / 2; pointIndex += 1) {
                    const point = svgElement("g", {
                        class: "point-curve-point",
                        "data-point-index": String(pointIndex)
                    });
                    const hitTarget = svgElement("circle", {
                        cx: points[pointIndex * 2],
                        cy: 255 - points[pointIndex * 2 + 1],
                        r: String(TOUCH_TARGET_RADIUS),
                        tabindex: "0",
                        role: "button",
                        "aria-label": CHANNEL_LABELS[selectedChannel] + " curve point " + (pointIndex + 1),
                        "data-point-index": String(pointIndex)
                    });
                    hitTarget.classList.add("point-curve-hit-target");
                    hitTarget.addEventListener("pointerdown", function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (gesture) return;
                        if (addPointArmed) {
                            addPointArmed = false;
                            setStatus("Add Point mode cancelled; existing point selected");
                        }
                        beginPointerGesture(event, pointIndex, false);
                    });
                    hitTarget.addEventListener("click", function () {
                        selectedPointIndex = pointIndex;
                        render();
                    });
                    const marker = svgElement("circle", {
                        cx: points[pointIndex * 2],
                        cy: 255 - points[pointIndex * 2 + 1],
                        r: String(VISUAL_POINT_RADIUS),
                        "aria-hidden": "true"
                    });
                    marker.classList.add("point-curve-marker");
                    if (preview && pointIndex === preview.pointIndex) marker.classList.add("preview-source");
                    if (pointIndex === selectedPointIndex) marker.classList.add("selected");
                    point.appendChild(hitTarget);
                    point.appendChild(marker);
                    handlesGroup.appendChild(point);
                }
                const selectedValues = selectedPointValues(points, selectedPointIndex);
                inputValueElement.textContent = selectedValues ? String(selectedValues.input) : "—";
                outputValueElement.textContent = selectedValues ? String(selectedValues.output) : "—";
                const refine = authoritative.refineSaturation;
                const presentedRefineValue = refineGesture && Number.isFinite(refineGesture.desired)
                    ? refineGesture.desired : refine.value;
                refineRange.min = String(refine.min);
                refineRange.max = String(refine.max);
                refineRange.step = "1";
                refineRange.value = String(presentedRefineValue);
                refineRange.style.setProperty("--slider-progress",
                    (100 * (presentedRefineValue - refine.min) / (refine.max - refine.min)) + "%");
                if (!refineNumberEditing) refineNumber.value = String(refine.value);
                updatePresetOptions(authoritative.name);
                if (awaitingTarget || awaitingReset || awaitingPreset) {
                    setUpdating("Awaiting authoritative Lightroom feedback…");
                }
                else overlay.hidden = true;
            }
            const busy = interactionBusy();
            addPointButton.classList.toggle("active", addPointArmed);
            addPointButton.setAttribute("aria-pressed", String(addPointArmed));
            addPointButton.disabled = !available || busy;
            addPointInstruction.hidden = !addPointArmed;
            Object.keys(channelButtons).forEach(function (channel) {
                const button = channelButtons[channel];
                const selected = channel === selectedChannel;
                button.classList.toggle("active", selected);
                button.setAttribute("aria-pressed", String(selected));
                button.disabled = gesture !== null || refineGesture !== null;
            });
            refineRow.hidden = selectedChannel !== "rgb";
            const refineChannelAvailable = available && selectedChannel === "rgb";
            refineRange.disabled = !refineChannelAvailable || (busy && refineGesture === null);
            refineNumber.disabled = !refineChannelAvailable || busy;
            refineNumber.classList.toggle("pending", !!(refineGesture || awaitingRefine || awaitingRefineReset));
            refineNumber.setAttribute("aria-busy", String(!!(refineGesture || awaitingRefine || awaitingRefineReset)));
            refineResetButton.disabled = !refineChannelAvailable || busy;
            presetSelect.disabled = !available || busy;
            const interiorSelected = available && Number.isSafeInteger(selectedPointIndex) && selectedPointIndex > 0 &&
                selectedPointIndex < points.length / 2 - 1;
            deleteButton.disabled = !interiorSelected || busy;
            resetButton.disabled = !available || busy;
        }

        async function requestJson(path, requestOptions) {
            requestOptions = requestOptions || {};
            const controller = createAbortController ? createAbortController() : null;
            let timedOut = false;
            let timeout = null;
            if (typeof requestOptions.onController === "function") requestOptions.onController(controller);
            if (controller) {
                timeout = setTimeoutImpl(function () {
                    timedOut = true;
                    controller.abort();
                }, requestTimeoutMs);
            }
            try {
                const fetchOptions = { cache: "no-store" };
                if (controller) fetchOptions.signal = controller.signal;
                const response = await fetchImpl(path, fetchOptions);
                const data = await response.json();
                if (!response.ok || !data || data.ok !== true) {
                    throw new Error((data && data.error) || "Point Curve request failed");
                }
                return data;
            } catch (error) {
                if (timedOut) throw new Error("Point Curve request timed out");
                throw error;
            } finally {
                if (timeout !== null) clearTimeoutImpl(timeout);
                if (typeof requestOptions.onController === "function") requestOptions.onController(null);
            }
        }

        function remoteGestureBinding(session) {
            if (!session) return null;
            const identity = session.identity || session;
            const developCounter = Number.isSafeInteger(session.submittedDevelopCounter)
                ? session.submittedDevelopCounter
                : (Number.isSafeInteger(session.lastSubmittedDevelopCounter)
                    ? session.lastSubmittedDevelopCounter : identity.developCounter);
            if (!identity || typeof identity.selectedPhotoUuid !== "string" ||
                !Number.isSafeInteger(identity.contextCounter) || !Number.isSafeInteger(developCounter)) return null;
            return {
                selectedPhotoUuid: identity.selectedPhotoUuid,
                contextCounter: identity.contextCounter,
                developCounter: developCounter
            };
        }

        function releaseRemoteGesture(session) {
            const binding = remoteGestureBinding(session);
            if (!session || session.admissionStarted === false || session.cancelSent || !binding ||
                (typeof session.gestureId !== "string" && typeof session.id !== "string") ||
                typeof session.channel !== "string") return Promise.resolve(false);
            session.cancelSent = true;
            const gestureId = session.gestureId || session.id;
            const path = "/api/tone-curve/gesture/cancel?channel=" + encodeURIComponent(session.channel) +
                "&gestureId=" + encodeURIComponent(gestureId) + "&" + queryForBinding(binding);
            return requestJson(path).then(function () { return true; }).catch(function () { return false; });
        }

        function retireActiveGesture(session, message) {
            if (!session) return;
            releaseRemoteGesture(session);
            if (session.adding) addPointArmed = false;
            if (gesture === session) gesture = null;
            if (message) setStatus(message);
        }

        function gestureTarget(session, baseline) {
            if (session.adding && baseline.length === session.initialLength) {
                if (!insertionBaselineMatches(baseline, session.insertion)) return null;
                const constrainedX = Math.min(session.insertion.right[0] - 1,
                    Math.max(session.insertion.left[0] + 1, clampCoordinate(session.desired.x)));
                const added = addPoint(baseline, constrainedX, session.desired.y);
                if (!added || added.pointIndex !== session.insertion.insertionIndex) return null;
                session.pointIndex = added.pointIndex;
                return added.points;
            }
            if (session.adding) {
                const insertedIndex = locateInsertedPoint(baseline, session.insertion);
                if (insertedIndex === null) return null;
                session.additionObserved = true;
                session.pointIndex = insertedIndex;
                return movePoint(baseline, insertedIndex, session.desired.x, session.desired.y);
            }
            return movePoint(baseline, session.pointIndex, session.desired.x, session.desired.y);
        }

        async function pumpGesture() {
            const session = gesture;
            if (!session || session.transportInFlight || !session.begun || !authoritative ||
                session.awaitingAuthoritative || !sameIdentity(session.identity, authoritative) ||
                !bindingsEqual(authoritative, expectedBinding)) return;
            const baseline = authoritative.curves[session.channel];
            const target = gestureTarget(session, baseline);
            if (!target) {
                if (session.finishing) {
                    retireActiveGesture(session, "Point Curve gesture cancelled because its final point position was invalid");
                    render();
                }
                return;
            }
            const phase = session.finishing ? "end" : "update";
            if (phase === "update" && curvesEqual(target, baseline)) return;
            session.transportInFlight = true;
            session.lastTarget = target.slice();
            session.lastSubmittedDevelopCounter = authoritative.developCounter;
            session.lastSubmittedRevision = authoritative.revision;
            session.lastSubmittedUpdatedAt = authoritative.updatedAt;
            session.lastSubmittedAt = now();
            const submittedSnapshot = normalizeSnapshot(authoritative);
            const path = "/api/tone-curve/gesture/" + phase + "?channel=" + encodeURIComponent(session.channel) +
                "&gestureId=" + encodeURIComponent(session.id) + "&" + queryForBinding(authoritative) +
                "&baseline=" + encodeURIComponent(serializeCurve(baseline)) +
                "&points=" + encodeURIComponent(serializeCurve(target));
            try {
                await requestJson(path);
                if (gesture !== session) return;
                if (phase === "end") {
                    awaitingTarget = createAwaitingTarget(session, target, submittedSnapshot, session.lastSubmittedAt);
                    gesture = null;
                    if (!session.adding) selectedPointIndex = session.pointIndex;
                    setStatus("Point Curve gesture committed; awaiting authoritative Lightroom feedback");
                } else {
                    session.awaitingAuthoritative = true;
                    setStatus("Point Curve update queued; awaiting authoritative Lightroom feedback");
                }
            } catch (error) {
                if (gesture === session) {
                    retireActiveGesture(session, "ERROR: " + error.message);
                }
            } finally {
                if (gesture === session) {
                    session.transportInFlight = false;
                    if (session.finishing && phase !== "end") pumpGesture();
                }
                render();
            }
        }

        async function startGesture(session) {
            if (!session || !authoritative || !sameIdentity(session.identity, authoritative) ||
                !bindingsEqual(authoritative, expectedBinding)) return;
            session.identity.developCounter = authoritative.developCounter;
            const baseline = authoritative.curves[session.channel];
            const path = "/api/tone-curve/gesture/begin?channel=" + encodeURIComponent(session.channel) +
                "&gestureId=" + encodeURIComponent(session.id) + "&" + queryForBinding(authoritative) +
                "&baseline=" + encodeURIComponent(serializeCurve(baseline));
            session.transportInFlight = true;
            session.admissionStarted = true;
            try {
                await requestJson(path);
                if (gesture !== session) return;
                session.begun = true;
                session.transportInFlight = false;
                pumpGesture();
            } catch (error) {
                if (gesture === session) retireActiveGesture(session, "ERROR: " + error.message);
                render();
            }
        }

        function beginPointerGesture(event, pointIndex, adding, insertion) {
            const points = currentPoints();
            if (interactionBusy() || !points || !authoritative || !bindingsEqual(authoritative, expectedBinding)) return;
            if (adding && (!insertion || !insertionBaselineMatches(points, insertion))) return;
            const coordinates = graphCoordinates(event.clientX, event.clientY, svg.getBoundingClientRect());
            if (!coordinates) return;
            gestureCounter += 1;
            selectedPointIndex = adding ? null : pointIndex;
            gesture = {
                id: "curve_" + now().toString(36) + "_" + gestureCounter.toString(36),
                channel: selectedChannel,
                identity: {
                    selectedPhotoUuid: authoritative.selectedPhotoUuid,
                    contextCounter: authoritative.contextCounter,
                    developCounter: authoritative.developCounter
                },
                pointIndex: pointIndex,
                initialLength: points.length,
                adding: adding,
                operation: adding ? "add" : "change",
                insertion: insertion || null,
                additionObserved: false,
                desired: coordinates,
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                dragStarted: adding,
                begun: false,
                finishing: false,
                transportInFlight: false,
                awaitingAuthoritative: false,
                lastTarget: null,
                lastSubmittedDevelopCounter: null,
                lastSubmittedRevision: null,
                lastSubmittedUpdatedAt: null,
                lastSubmittedAt: null,
                cancelSent: false,
                admissionStarted: false
            };
            if (svg.setPointerCapture && event.pointerId !== undefined) svg.setPointerCapture(event.pointerId);
            if (adding) startGesture(gesture);
            render();
        }

        function handlePointerMove(event) {
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            const coordinates = graphCoordinates(event.clientX, event.clientY, svg.getBoundingClientRect());
            if (!coordinates) return;
            event.preventDefault();
            if (!gesture.dragStarted) {
                const deltaX = event.clientX - gesture.startClientX;
                const deltaY = event.clientY - gesture.startClientY;
                if (Math.hypot(deltaX, deltaY) < POINTER_DRAG_THRESHOLD_PX) return;
                gesture.dragStarted = true;
                gesture.desired = coordinates;
                startGesture(gesture);
                render();
                return;
            }
            gesture.desired = coordinates;
            render();
            if (!gesture.awaitingAuthoritative) pumpGesture();
        }

        function handlePointerEnd(event) {
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            if (!gesture.dragStarted) {
                gesture = null;
                render();
                return;
            }
            const coordinates = graphCoordinates(event.clientX, event.clientY, svg.getBoundingClientRect());
            if (coordinates) gesture.desired = coordinates;
            if (gesture.adding) addPointArmed = false;
            gesture.finishing = true;
            pumpGesture();
            render();
        }

        function handlePointerCancel(event) {
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            if (!gesture.dragStarted) {
                gesture = null;
                render();
                return;
            }
            if (gesture.adding) addPointArmed = false;
            retireActiveGesture(gesture, "Point Curve gesture cancelled");
            render();
        }

        function refineRemoteBinding(session) {
            if (!session) return null;
            const identity = session.identity || session;
            const developCounter = Number.isSafeInteger(session.submittedDevelopCounter)
                ? session.submittedDevelopCounter
                : (Number.isSafeInteger(session.lastSubmittedDevelopCounter)
                    ? session.lastSubmittedDevelopCounter : identity.developCounter);
            if (!identity || typeof identity.selectedPhotoUuid !== "string" ||
                !Number.isSafeInteger(identity.contextCounter) || !Number.isSafeInteger(developCounter)) return null;
            return {
                selectedPhotoUuid: identity.selectedPhotoUuid,
                contextCounter: identity.contextCounter,
                developCounter: developCounter
            };
        }

        function releaseRemoteRefineGesture(session) {
            const binding = refineRemoteBinding(session);
            if (!session || session.cancelSent || !binding ||
                (typeof session.gestureId !== "string" && typeof session.id !== "string")) return Promise.resolve(false);
            session.cancelSent = true;
            const path = "/api/tone-curve/refine-saturation/gesture/cancel?gestureId=" +
                encodeURIComponent(session.gestureId || session.id) + "&" + queryForBinding(binding);
            return requestJson(path).then(function () { return true; }).catch(function () { return false; });
        }

        function retireRefineGesture(session, message) {
            if (!session) return;
            releaseRemoteRefineGesture(session);
            if (refineGesture === session) refineGesture = null;
            if (message) setStatus(message);
        }

        async function pumpRefineGesture() {
            const session = refineGesture;
            if (!session || session.transportInFlight || !session.begun || !authoritative ||
                session.awaitingAuthoritative || !sameIdentity(session.identity, authoritative) ||
                !bindingsEqual(authoritative, expectedBinding)) return;
            const refine = authoritative.refineSaturation;
            if (!validRefineSaturation(refine) || !Number.isFinite(session.desired) ||
                session.desired < refine.min || session.desired > refine.max) {
                retireRefineGesture(session, "Refine Saturation gesture cancelled because its value is outside Lightroom's current range");
                render();
                return;
            }
            const phase = session.finishing ? "end" : "update";
            if (phase === "update" && session.desired === refine.value) return;
            session.transportInFlight = true;
            session.lastTarget = session.desired;
            session.lastSubmittedDevelopCounter = authoritative.developCounter;
            session.lastSubmittedRevision = authoritative.revision;
            session.lastSubmittedUpdatedAt = authoritative.updatedAt;
            session.lastSubmittedAt = now();
            const submittedSnapshot = normalizeSnapshot(authoritative);
            const path = "/api/tone-curve/refine-saturation/gesture/" + phase + "?gestureId=" +
                encodeURIComponent(session.id) + "&" + queryForBinding(authoritative) +
                "&baseline=" + encodeURIComponent(String(refine.value)) +
                "&value=" + encodeURIComponent(String(session.desired));
            try {
                await requestJson(path);
                if (refineGesture !== session) return;
                if (phase === "end") {
                    awaitingRefine = createAwaitingScalar(
                        session.desired, submittedSnapshot, session.lastSubmittedAt, session.id
                    );
                    refineGesture = null;
                    setStatus("Refine Saturation committed; awaiting authoritative Lightroom feedback");
                } else {
                    session.awaitingAuthoritative = true;
                    setStatus("Refine Saturation update queued; awaiting authoritative Lightroom feedback");
                }
            } catch (error) {
                if (refineGesture === session) retireRefineGesture(session, "ERROR: " + error.message);
            } finally {
                if (refineGesture === session) {
                    session.transportInFlight = false;
                    if (session.finishing && phase !== "end") pumpRefineGesture();
                }
                render();
            }
        }

        async function startRefineGesture(session) {
            const baseline = authoritative.refineSaturation.value;
            const path = "/api/tone-curve/refine-saturation/gesture/begin?gestureId=" +
                encodeURIComponent(session.id) + "&" + queryForBinding(authoritative) +
                "&baseline=" + encodeURIComponent(String(baseline));
            session.transportInFlight = true;
            try {
                await requestJson(path);
                if (refineGesture !== session) return;
                session.begun = true;
                session.transportInFlight = false;
                pumpRefineGesture();
            } catch (error) {
                if (refineGesture === session) retireRefineGesture(session, "ERROR: " + error.message);
                render();
            }
        }

        function beginRefineGesture(pointerId, desired, finishing) {
            if (interactionBusy() || selectedChannel !== "rgb" || !authoritative ||
                !bindingsEqual(authoritative, expectedBinding) || !validRefineSaturation(authoritative.refineSaturation) ||
                !Number.isFinite(desired) || desired < authoritative.refineSaturation.min ||
                desired > authoritative.refineSaturation.max) return false;
            gestureCounter += 1;
            refineGesture = {
                id: "refine_" + now().toString(36) + "_" + gestureCounter.toString(36),
                identity: {
                    selectedPhotoUuid: authoritative.selectedPhotoUuid,
                    contextCounter: authoritative.contextCounter,
                    developCounter: authoritative.developCounter
                },
                pointerId: pointerId,
                desired: desired,
                begun: false,
                finishing: finishing === true,
                transportInFlight: false,
                awaitingAuthoritative: false,
                lastTarget: null,
                lastSubmittedDevelopCounter: null,
                lastSubmittedRevision: null,
                lastSubmittedUpdatedAt: null,
                lastSubmittedAt: null,
                cancelSent: false
            };
            startRefineGesture(refineGesture);
            render();
            return true;
        }

        function commitRefineEditor() {
            if (!refineNumberEditing) return false;
            refineNumberEditing = false;
            if (!authoritative || !bindingsEqual(authoritative, expectedBinding) ||
                !validRefineSaturation(authoritative.refineSaturation)) {
                render();
                return false;
            }
            const value = parseRefineEditorValue(refineNumber.value, authoritative.refineSaturation);
            if (value === null) {
                setStatus("ERROR: Refine Saturation must be a numeric value in Lightroom's current range");
                render();
                return false;
            }
            if (value === authoritative.refineSaturation.value) {
                render();
                return true;
            }
            if (!beginRefineGesture(null, value, true)) render();
            return refineGesture !== null;
        }

        function cancelRefineEditor() {
            refineNumberEditing = false;
            if (authoritative && validRefineSaturation(authoritative.refineSaturation)) {
                refineNumber.value = String(authoritative.refineSaturation.value);
            }
            render();
        }

        async function applyPreset(name) {
            const target = presetCurve(name);
            if (!target || interactionBusy() || !authoritative || !bindingsEqual(authoritative, expectedBinding)) return false;
            addPointArmed = false;
            selectedChannel = "rgb";
            selectedPointIndex = null;
            const submittedSnapshot = normalizeSnapshot(authoritative);
            const token = presetRequestToken + 1;
            presetRequestToken = token;
            const path = "/api/tone-curve/preset?preset=" + encodeURIComponent(name) + "&" +
                queryForBinding(authoritative) + "&baseline=" +
                encodeURIComponent(serializeCurve(authoritative.curves.rgb));
            try {
                presetRequestInFlight = true;
                render();
                await requestJson(path);
                if (!active || token !== presetRequestToken || !expectedBinding ||
                    !sameIdentity(submittedSnapshot, expectedBinding)) return false;
                awaitingPreset = createAwaitingPreset(name, target, submittedSnapshot, now());
                setStatus("Point Curve preset queued; awaiting authoritative Lightroom feedback");
                return true;
            } catch (error) {
                awaitingPreset = null;
                setStatus("ERROR: " + error.message);
                return false;
            } finally {
                if (token === presetRequestToken) presetRequestInFlight = false;
                render();
            }
        }

        function applyAuthoritative(value) {
            const normalized = normalizeSnapshot(value);
            if (!normalized || !expectedBinding || !bindingsEqual(normalized, expectedBinding)) return false;
            const previous = authoritative;
            authoritative = normalized;

            const previousSelectedPoints = previous && previous.curves ? previous.curves[selectedChannel] : null;
            if (!(gesture && gesture.adding && gesture.channel === selectedChannel)) {
                selectedPointIndex = remapSelectedPointIndex(
                    previousSelectedPoints,
                    normalized.curves[selectedChannel],
                    selectedPointIndex
                );
            }

            if (awaitingTarget) {
                const resolution = resolveAwaitingTarget(awaitingTarget, normalized);
                if (resolution) {
                    const completed = awaitingTarget;
                    awaitingTarget = null;
                    releaseRemoteGesture(completed);
                    if (completed.operation === "delete" && resolution === "matched") selectedPointIndex = null;
                    if (completed.operation === "add") {
                        selectedPointIndex = locateInsertedPoint(
                            normalized.curves[completed.channel], completed.insertion
                        );
                    }
                    setStatus(resolution === "matched"
                        ? (completed.operation === "delete"
                            ? "Point Curve point deletion confirmed by Lightroom"
                            : (completed.operation === "add"
                                ? "Point Curve point addition confirmed by Lightroom"
                                : "Point Curve change confirmed by Lightroom"))
                        : "Point Curve request was superseded or normalized; Lightroom's authoritative curve was adopted");
                }
            }
            if (awaitingReset && sameIdentity(awaitingReset, normalized) &&
                (normalized.developCounter > awaitingReset.submittedDevelopCounter ||
                    normalized.revision > awaitingReset.submittedRevision ||
                    normalized.updatedAt > awaitingReset.submittedAt)) {
                awaitingReset = null;
                setStatus("Point Curve reset feedback received from Lightroom");
            }
            if (awaitingRefine) {
                const resolution = resolveAwaitingScalar(awaitingRefine, normalized);
                if (resolution) {
                    const completed = awaitingRefine;
                    awaitingRefine = null;
                    releaseRemoteRefineGesture(completed);
                    setStatus(resolution === "matched"
                        ? "Refine Saturation confirmed by Lightroom"
                        : "Refine Saturation was superseded or normalized; Lightroom's authoritative value was adopted");
                }
            }
            if (awaitingRefineReset && sameIdentity(awaitingRefineReset, normalized) &&
                (normalized.developCounter > awaitingRefineReset.submittedDevelopCounter ||
                    normalized.revision > awaitingRefineReset.submittedRevision ||
                    normalized.updatedAt > awaitingRefineReset.submittedAt)) {
                awaitingRefineReset = null;
                setStatus("Refine Saturation reset feedback received from Lightroom");
            }
            if (awaitingPreset) {
                const resolution = resolveAwaitingPreset(awaitingPreset, normalized);
                if (resolution) {
                    awaitingPreset = null;
                    setStatus(resolution === "matched"
                        ? "Point Curve preset confirmed by Lightroom"
                        : "Point Curve preset was superseded or normalized; Lightroom's authoritative curve and name were adopted");
                }
            }

            if (gesture && sameIdentity(gesture.identity, normalized)) {
                const previousGesturePoints = previous && previous.curves ? previous.curves[gesture.channel] : null;
                let remappedIndex;
                if (gesture.adding) {
                    if (insertionBaselineMatches(normalized.curves[gesture.channel], gesture.insertion)) {
                        remappedIndex = gesture.insertion.insertionIndex;
                    } else {
                        remappedIndex = locateInsertedPoint(normalized.curves[gesture.channel], gesture.insertion);
                        if (remappedIndex !== null) {
                            gesture.additionObserved = true;
                            selectedPointIndex = remappedIndex;
                        }
                    }
                } else {
                    remappedIndex = remapSelectedPointIndex(
                        previousGesturePoints,
                        normalized.curves[gesture.channel],
                        gesture.pointIndex
                    );
                }
                if (remappedIndex === null) {
                    retireActiveGesture(gesture, "Point Curve gesture cancelled because Lightroom changed the point structure");
                } else {
                    gesture.pointIndex = remappedIndex;
                    const targetMatched = validCurveArray(gesture.lastTarget) &&
                        curvesEqual(normalized.curves[gesture.channel], gesture.lastTarget);
                    const authorityAdvanced = Number.isSafeInteger(gesture.lastSubmittedDevelopCounter) &&
                        (normalized.developCounter > gesture.lastSubmittedDevelopCounter ||
                            normalized.revision > gesture.lastSubmittedRevision ||
                            (Number.isFinite(gesture.lastSubmittedAt) && normalized.updatedAt > gesture.lastSubmittedAt));
                    if (targetMatched || authorityAdvanced) {
                        gesture.awaitingAuthoritative = false;
                        if (authorityAdvanced && !targetMatched) {
                            setStatus("Lightroom's newer authoritative curve superseded the pending update; drag rebased");
                        }
                        pumpGesture();
                    }
                }
            }
            if (refineGesture && sameIdentity(refineGesture.identity, normalized)) {
                const targetMatched = Number.isFinite(refineGesture.lastTarget) &&
                    normalized.refineSaturation.value === refineGesture.lastTarget;
                const authorityAdvanced = Number.isSafeInteger(refineGesture.lastSubmittedDevelopCounter) &&
                    (normalized.developCounter > refineGesture.lastSubmittedDevelopCounter ||
                        normalized.revision > refineGesture.lastSubmittedRevision ||
                        (Number.isFinite(refineGesture.lastSubmittedAt) &&
                            normalized.updatedAt > refineGesture.lastSubmittedAt));
                if (targetMatched || authorityAdvanced) {
                    refineGesture.awaitingAuthoritative = false;
                    if (authorityAdvanced && !targetMatched) {
                        setStatus("Lightroom's newer Refine Saturation value superseded the pending update; drag rebased");
                    }
                    pumpRefineGesture();
                }
            }
            render();
            return true;
        }

        function expirePendingTransactions() {
            const currentTime = now();
            if (awaitingTarget && Number.isFinite(awaitingTarget.submittedAt) &&
                currentTime - awaitingTarget.submittedAt >= feedbackTimeoutMs) {
                const expired = awaitingTarget;
                awaitingTarget = null;
                releaseRemoteGesture(expired);
                setStatus("Point Curve feedback timed out; the controller returned to Lightroom authority");
            }
            if (awaitingReset && Number.isFinite(awaitingReset.submittedAt) &&
                currentTime - awaitingReset.submittedAt >= feedbackTimeoutMs) {
                awaitingReset = null;
                setStatus("Point Curve reset feedback timed out; refreshing Lightroom authority");
            }
            if (awaitingRefine && Number.isFinite(awaitingRefine.submittedAt) &&
                currentTime - awaitingRefine.submittedAt >= feedbackTimeoutMs) {
                const expired = awaitingRefine;
                awaitingRefine = null;
                releaseRemoteRefineGesture(expired);
                setStatus("Refine Saturation feedback timed out; Lightroom authority was restored");
            }
            if (awaitingRefineReset && Number.isFinite(awaitingRefineReset.submittedAt) &&
                currentTime - awaitingRefineReset.submittedAt >= feedbackTimeoutMs) {
                awaitingRefineReset = null;
                setStatus("Refine Saturation reset feedback timed out; refreshing Lightroom authority");
            }
            if (awaitingPreset && Number.isFinite(awaitingPreset.submittedAt) &&
                currentTime - awaitingPreset.submittedAt >= feedbackTimeoutMs) {
                awaitingPreset = null;
                setStatus("Point Curve preset feedback timed out; Lightroom authority was restored");
            }
            if (gesture && gesture.awaitingAuthoritative && Number.isFinite(gesture.lastSubmittedAt) &&
                currentTime - gesture.lastSubmittedAt >= feedbackTimeoutMs) {
                retireActiveGesture(gesture, "Point Curve gesture feedback timed out; interaction unlocked");
            }
            if (refineGesture && refineGesture.awaitingAuthoritative &&
                Number.isFinite(refineGesture.lastSubmittedAt) &&
                currentTime - refineGesture.lastSubmittedAt >= feedbackTimeoutMs) {
                retireRefineGesture(refineGesture, "Refine Saturation feedback timed out; interaction unlocked");
            }
        }

        async function refresh() {
            if (!active || requestInFlight) return;
            expirePendingTransactions();
            const token = stateRequestToken + 1;
            stateRequestToken = token;
            requestInFlight = true;
            try {
                const data = await requestJson("/api/tone-curve/state", {
                    onController: function (controller) {
                        if (token === stateRequestToken) stateRequestController = controller;
                    }
                });
                if (!active || token !== stateRequestToken) return;
                if (!applyAuthoritative(data.pointCurve) && data.pointCurve && data.pointCurve.available === false) {
                    if (!authoritative || !expectedBinding || !sameIdentity(authoritative, expectedBinding)) {
                        authoritative = null;
                        selectedPointIndex = null;
                    }
                    render();
                }
            } catch (error) {
                if (active && token === stateRequestToken) {
                    setUpdating(error.message === "Point Curve request timed out"
                        ? "Point Curve feedback timed out; retrying…"
                        : "Point Curve feedback unavailable; retrying…");
                }
            } finally {
                if (token === stateRequestToken) {
                    requestInFlight = false;
                    stateRequestController = null;
                }
            }
        }

        async function commitOneShot(target, operation) {
            if (!validCurveArray(target) || interactionBusy() || !authoritative ||
                !bindingsEqual(authoritative, expectedBinding)) return false;
            gestureCounter += 1;
            const id = "curve_" + now().toString(36) + "_" + gestureCounter.toString(36);
            const baseline = authoritative.curves[selectedChannel];
            const submittedSnapshot = normalizeSnapshot(authoritative);
            const baseQuery = "channel=" + encodeURIComponent(selectedChannel) + "&gestureId=" + encodeURIComponent(id) +
                "&" + queryForBinding(authoritative) + "&baseline=" + encodeURIComponent(serializeCurve(baseline));
            const session = {
                id: id,
                gestureId: id,
                channel: selectedChannel,
                identity: {
                    selectedPhotoUuid: authoritative.selectedPhotoUuid,
                    contextCounter: authoritative.contextCounter,
                    developCounter: authoritative.developCounter
                },
                operation: operation || "change",
                cancelSent: false
            };
            gesture = session;
            render();
            try {
                await requestJson("/api/tone-curve/gesture/begin?" + baseQuery);
                session.begun = true;
                await requestJson("/api/tone-curve/gesture/end?" + baseQuery + "&points=" + encodeURIComponent(serializeCurve(target)));
                awaitingTarget = createAwaitingTarget(session, target, submittedSnapshot, now());
                setStatus("Point Curve change committed; awaiting authoritative Lightroom feedback");
                return true;
            } catch (error) {
                releaseRemoteGesture(session);
                setStatus("ERROR: " + error.message);
                return false;
            } finally {
                if (gesture === session) gesture = null;
                render();
            }
        }

        function createInterface() {
            rootElement = documentObject.createElement("section");
            rootElement.className = "group point-curve-group";
            const heading = documentObject.createElement("div");
            heading.className = "group-title";
            heading.textContent = "POINT CURVE";
            rootElement.appendChild(heading);

            const toolbar = documentObject.createElement("div");
            toolbar.className = "point-curve-toolbar";
            const adjustLabel = documentObject.createElement("span");
            adjustLabel.className = "point-curve-adjust-label";
            adjustLabel.textContent = "Adjust:";
            toolbar.appendChild(adjustLabel);
            const channels = documentObject.createElement("div");
            channels.className = "point-curve-channels";
            channels.setAttribute("role", "group");
            channels.setAttribute("aria-label", "Point Curve channel");
            CHANNELS.forEach(function (channel) {
                const button = documentObject.createElement("button");
                button.type = "button";
                button.className = "point-curve-channel point-curve-channel-" + channel;
                button.textContent = channel === "rgb" ? "RGB" : CHANNEL_LABELS[channel].slice(0, 1);
                button.title = CHANNEL_LABELS[channel];
                button.setAttribute("aria-label", "Adjust " + CHANNEL_LABELS[channel] + " Point Curve");
                button.addEventListener("click", function () {
                    if (gesture) return;
                    addPointArmed = false;
                    selectedChannel = channel;
                    selectedPointIndex = null;
                    render();
                });
                channelButtons[channel] = button;
                channels.appendChild(button);
            });
            toolbar.appendChild(channels);
            addPointButton = documentObject.createElement("button");
            addPointButton.type = "button";
            addPointButton.className = "point-curve-add-button";
            addPointButton.textContent = "+";
            addPointButton.setAttribute("aria-label", "Add point");
            addPointButton.setAttribute("aria-pressed", "false");
            addPointButton.addEventListener("click", function () {
                if (interactionBusy() || !authoritative || !bindingsEqual(authoritative, expectedBinding)) return;
                addPointArmed = !addPointArmed;
                setStatus(addPointArmed ? "Tap graph to add point" : "Add Point mode cancelled");
                render();
            });
            toolbar.appendChild(addPointButton);
            addPointInstruction = documentObject.createElement("span");
            addPointInstruction.className = "point-curve-add-instruction";
            addPointInstruction.textContent = "Tap graph to add point";
            addPointInstruction.setAttribute("role", "status");
            addPointInstruction.hidden = true;
            toolbar.appendChild(addPointInstruction);
            rootElement.appendChild(toolbar);

            const graphShell = documentObject.createElement("div");
            graphShell.className = "point-curve-graph-shell";
            svg = svgElement("svg", {
                class: "point-curve-graph",
                viewBox: "0 0 255 255",
                role: "application",
                "aria-label": "Point Curve graph. Tap empty space to add a point, or drag a point to adjust it."
            });
            const grid = svgElement("g", { class: "point-curve-grid", "aria-hidden": "true" });
            const gridCoordinates = [];
            for (let coordinate = 0; coordinate < 255; coordinate += 16) gridCoordinates.push(coordinate);
            gridCoordinates.push(255);
            gridCoordinates.forEach(function (coordinate) {
                const kind = coordinate === 0 || coordinate === 255 ? "boundary" :
                    (coordinate % 64 === 0 ? "major" : "minor");
                grid.appendChild(svgElement("line", {
                    class: "point-curve-grid-" + kind,
                    x1: coordinate, y1: 0, x2: coordinate, y2: 255
                }));
                grid.appendChild(svgElement("line", {
                    class: "point-curve-grid-" + kind,
                    x1: 0, y1: coordinate, x2: 255, y2: coordinate
                }));
            });
            svg.appendChild(grid);
            const clipDefinitions = svgElement("defs");
            const graphClip = svgElement("clipPath", {
                id: "point-curve-domain-clip",
                clipPathUnits: "userSpaceOnUse"
            });
            graphClip.appendChild(svgElement("rect", { x: 0, y: 0, width: 255, height: 255 }));
            clipDefinitions.appendChild(graphClip);
            svg.appendChild(clipDefinitions);
            svg.appendChild(svgElement("line", {
                class: "point-curve-reference",
                x1: 0,
                y1: 255,
                x2: 255,
                y2: 0,
                "aria-hidden": "true"
            }));
            curvePath = svgElement("path", {
                class: "point-curve-line",
                d: "",
                "clip-path": "url(#point-curve-domain-clip)"
            });
            svg.appendChild(curvePath);
            handlesGroup = svgElement("g", { class: "point-curve-handles" });
            svg.appendChild(handlesGroup);
            previewPath = svgElement("path", {
                class: "point-curve-preview-line",
                d: "",
                "clip-path": "url(#point-curve-domain-clip)",
                "aria-hidden": "true"
            });
            previewPath.setAttribute("display", "none");
            svg.appendChild(previewPath);
            previewMarker = svgElement("circle", {
                class: "point-curve-marker point-curve-preview-marker selected",
                r: String(VISUAL_POINT_RADIUS),
                "aria-hidden": "true"
            });
            previewMarker.setAttribute("display", "none");
            svg.appendChild(previewMarker);
            svg.addEventListener("pointerdown", function (event) {
                if (!addPointArmed || gesture) return;
                event.preventDefault();
                const points = currentPoints();
                const coordinates = graphCoordinates(event.clientX, event.clientY, svg.getBoundingClientRect());
                if (!points || !coordinates) return;
                const added = addPoint(points, coordinates.x, coordinates.y);
                if (!added) {
                    addPointArmed = false;
                    setStatus("Add Point rejected because no valid integer input position is available there");
                    render();
                    return;
                }
                const insertion = createInsertionIdentity(points, added.pointIndex);
                if (!insertion) {
                    addPointArmed = false;
                    render();
                    return;
                }
                beginPointerGesture(event, added.pointIndex, true, insertion);
            });
            svg.addEventListener("pointermove", handlePointerMove);
            svg.addEventListener("pointerup", handlePointerEnd);
            svg.addEventListener("pointercancel", handlePointerCancel);
            graphShell.appendChild(svg);
            overlay = documentObject.createElement("div");
            overlay.className = "point-curve-updating";
            overlay.setAttribute("role", "status");
            overlay.textContent = "Updating Point Curve…";
            graphShell.appendChild(overlay);
            rootElement.appendChild(graphShell);

            const values = documentObject.createElement("div");
            values.className = "point-curve-values";
            const inputLabel = documentObject.createElement("span");
            inputLabel.className = "point-curve-value";
            inputLabel.appendChild(documentObject.createTextNode("Input "));
            inputValueElement = documentObject.createElement("output");
            inputValueElement.className = "point-curve-value-number";
            inputValueElement.setAttribute("aria-label", "Selected point input");
            inputValueElement.textContent = "—";
            inputLabel.appendChild(inputValueElement);
            values.appendChild(inputLabel);
            const outputLabel = documentObject.createElement("span");
            outputLabel.className = "point-curve-value";
            outputLabel.appendChild(documentObject.createTextNode("Output "));
            outputValueElement = documentObject.createElement("output");
            outputValueElement.className = "point-curve-value-number";
            outputValueElement.setAttribute("aria-label", "Selected point output");
            outputValueElement.textContent = "—";
            outputLabel.appendChild(outputValueElement);
            values.appendChild(outputLabel);
            rootElement.appendChild(values);

            refineRow = documentObject.createElement("div");
            refineRow.className = "point-curve-refine-row";
            const refineLabel = documentObject.createElement("label");
            refineLabel.className = "point-curve-row-label";
            refineLabel.textContent = "Refine Sat.";
            refineRange = documentObject.createElement("input");
            refineRange.type = "range";
            refineRange.setAttribute("aria-label", "Refine Saturation");
            refineRange.disabled = true;
            refineNumber = documentObject.createElement("input");
            refineNumber.type = "text";
            refineNumber.inputMode = "numeric";
            refineNumber.autocomplete = "off";
            refineNumber.setAttribute("autocomplete", "off");
            refineNumber.setAttribute("autocapitalize", "off");
            refineNumber.spellcheck = false;
            refineNumber.setAttribute("spellcheck", "false");
            refineNumber.id = "lrbridge-tone-curve-refine-editor";
            refineNumber.setAttribute("id", "lrbridge-tone-curve-refine-editor");
            refineNumber.setAttribute("aria-label", "Edit Refine Saturation value");
            refineNumber.disabled = true;
            refineResetButton = documentObject.createElement("button");
            refineResetButton.type = "button";
            refineResetButton.className = "point-curve-refine-reset";
            refineResetButton.textContent = "Reset";
            refineResetButton.disabled = true;
            refineRange.addEventListener("pointerdown", function (event) {
                if (beginRefineGesture(event.pointerId, Number(refineRange.value), false) &&
                    refineRange.setPointerCapture && event.pointerId !== undefined) {
                    refineRange.setPointerCapture(event.pointerId);
                }
            });
            refineRange.addEventListener("input", function () {
                if (!refineGesture) return;
                refineGesture.desired = Number(refineRange.value);
                render();
                if (!refineGesture.awaitingAuthoritative) pumpRefineGesture();
            });
            refineRange.addEventListener("pointerup", function (event) {
                if (!refineGesture || refineGesture.pointerId !== event.pointerId) return;
                refineGesture.desired = Number(refineRange.value);
                refineGesture.finishing = true;
                ignoreNextRefineChange = true;
                pumpRefineGesture();
                render();
            });
            refineRange.addEventListener("pointercancel", function (event) {
                if (!refineGesture || refineGesture.pointerId !== event.pointerId) return;
                ignoreNextRefineChange = true;
                retireRefineGesture(refineGesture, "Refine Saturation gesture cancelled");
                render();
            });
            refineRange.addEventListener("change", function () {
                if (ignoreNextRefineChange) {
                    ignoreNextRefineChange = false;
                    return;
                }
                if (!refineGesture) beginRefineGesture(null, Number(refineRange.value), true);
            });
            refineNumber.addEventListener("focus", function () { refineNumberEditing = true; });
            refineNumber.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    commitRefineEditor();
                    if (typeof refineNumber.blur === "function") refineNumber.blur();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRefineEditor();
                    if (typeof refineNumber.blur === "function") refineNumber.blur();
                }
            });
            refineNumber.addEventListener("blur", function () { commitRefineEditor(); });
            refineResetButton.addEventListener("click", async function () {
                if (interactionBusy() || selectedChannel !== "rgb" || !authoritative ||
                    !bindingsEqual(authoritative, expectedBinding)) return;
                const submitted = createAwaitingScalar(
                    authoritative.refineSaturation.value, authoritative, now(), null
                );
                const path = "/api/tone-curve/refine-saturation/reset?" + queryForBinding(authoritative) +
                    "&baseline=" + encodeURIComponent(String(authoritative.refineSaturation.value));
                awaitingRefineReset = submitted;
                render();
                try {
                    await requestJson(path);
                    setStatus("Refine Saturation reset queued; awaiting authoritative Lightroom feedback");
                } catch (error) {
                    awaitingRefineReset = null;
                    setStatus("ERROR: " + error.message);
                } finally {
                    render();
                }
            });
            refineRow.appendChild(refineLabel);
            refineRow.appendChild(refineRange);
            refineRow.appendChild(refineNumber);
            refineRow.appendChild(refineResetButton);
            rootElement.appendChild(refineRow);

            const presetRow = documentObject.createElement("div");
            presetRow.className = "point-curve-preset-row";
            const presetLabel = documentObject.createElement("label");
            presetLabel.className = "point-curve-row-label";
            presetLabel.textContent = "Point Curve:";
            presetSelect = documentObject.createElement("select");
            presetSelect.className = "point-curve-preset-select";
            presetSelect.setAttribute("aria-label", "Point Curve preset");
            presetSelect.disabled = true;
            presetSelect.addEventListener("change", function () {
                const name = presetSelect.value;
                if (!presetCurve(name)) {
                    render();
                    return;
                }
                applyPreset(name);
            });
            presetRow.appendChild(presetLabel);
            presetRow.appendChild(presetSelect);
            rootElement.appendChild(presetRow);

            const actions = documentObject.createElement("div");
            actions.className = "point-curve-actions";
            deleteButton = documentObject.createElement("button");
            deleteButton.type = "button";
            deleteButton.textContent = "Delete selected point";
            deleteButton.addEventListener("click", function () {
                const target = deletePoint(currentPoints(), selectedPointIndex);
                if (!target) return;
                commitOneShot(target, "delete");
            });
            actions.appendChild(deleteButton);
            resetButton = documentObject.createElement("button");
            resetButton.type = "button";
            resetButton.className = "command-danger";
            resetButton.textContent = "Reset selected channel";
            resetButton.addEventListener("click", async function () {
                if (!authoritative || !bindingsEqual(authoritative, expectedBinding) || gesture) return;
                const baseline = authoritative.curves[selectedChannel];
                const resetBinding = {
                    selectedPhotoUuid: authoritative.selectedPhotoUuid,
                    contextCounter: authoritative.contextCounter,
                    developCounter: authoritative.developCounter,
                    submittedDevelopCounter: authoritative.developCounter,
                    submittedRevision: authoritative.revision,
                    submittedUpdatedAt: authoritative.updatedAt,
                    submittedAt: now()
                };
                const path = "/api/tone-curve/reset?channel=" + encodeURIComponent(selectedChannel) + "&" +
                    queryForBinding(authoritative) + "&baseline=" + encodeURIComponent(serializeCurve(baseline));
                resetButton.disabled = true;
                try {
                    await requestJson(path);
                    awaitingTarget = null;
                    awaitingReset = resetBinding;
                    setUpdating("Reset queued; awaiting authoritative Lightroom feedback…");
                    setStatus("Point Curve reset queued; awaiting authoritative Lightroom feedback");
                } catch (error) {
                    awaitingReset = null;
                    setStatus("ERROR: " + error.message);
                } finally {
                    render();
                }
            });
            actions.appendChild(resetButton);
            rootElement.appendChild(actions);
            render();
            return rootElement;
        }

        return Object.freeze({
            element: createInterface(),
            activate: function (binding) {
                active = true;
                installRecoveryListeners();
                this.applyContext(binding);
                if (pollTimer === null) pollTimer = setIntervalImpl(refresh, 200);
                if (!requestInFlight) refresh();
            },
            deactivate: function () {
                active = false;
                addPointArmed = false;
                if (pollTimer !== null) clearIntervalImpl(pollTimer);
                pollTimer = null;
                removeRecoveryListeners();
                abortStateRequest();
                if (gesture) retireActiveGesture(gesture);
                if (awaitingTarget) releaseRemoteGesture(awaitingTarget);
                if (refineGesture) retireRefineGesture(refineGesture);
                if (awaitingRefine) releaseRemoteRefineGesture(awaitingRefine);
                presetRequestToken += 1;
                presetRequestInFlight = false;
                authoritative = null;
                expectedBinding = null;
                selectedPointIndex = null;
                awaitingTarget = null;
                awaitingReset = null;
                refineGesture = null;
                awaitingRefine = null;
                awaitingRefineReset = null;
                awaitingPreset = null;
                refineNumberEditing = false;
                render();
            },
            applyContext: function (binding) {
                const normalized = validBinding(binding) && binding.activeModule === "develop" ? {
                    selectedPhotoUuid: binding.selectedPhotoUuid,
                    contextCounter: binding.contextCounter,
                    developCounter: binding.developCounter
                } : null;
                const navigationChanged = !!expectedBinding && (!normalized || !sameIdentity(expectedBinding, normalized));
                if (!bindingsEqual(expectedBinding, normalized)) {
                    addPointArmed = false;
                    if (navigationChanged) {
                        if (gesture) retireActiveGesture(gesture, "Point Curve gesture cancelled by navigation");
                        if (awaitingTarget) releaseRemoteGesture(awaitingTarget);
                        if (refineGesture) retireRefineGesture(refineGesture, "Refine Saturation gesture cancelled by navigation");
                        if (awaitingRefine) releaseRemoteRefineGesture(awaitingRefine);
                        presetRequestToken += 1;
                        presetRequestInFlight = false;
                        selectedPointIndex = null;
                        awaitingTarget = null;
                        awaitingReset = null;
                        refineGesture = null;
                        awaitingRefine = null;
                        awaitingRefineReset = null;
                        awaitingPreset = null;
                        refineNumberEditing = false;
                        authoritative = null;
                    }
                    expectedBinding = normalized;
                    if (!normalized) {
                        if (gesture) retireActiveGesture(gesture, "Point Curve gesture cancelled outside Develop");
                        if (awaitingTarget) releaseRemoteGesture(awaitingTarget);
                        if (refineGesture) retireRefineGesture(refineGesture, "Refine Saturation gesture cancelled outside Develop");
                        if (awaitingRefine) releaseRemoteRefineGesture(awaitingRefine);
                        presetRequestToken += 1;
                        presetRequestInFlight = false;
                        authoritative = null;
                        selectedPointIndex = null;
                        awaitingTarget = null;
                        awaitingReset = null;
                        refineGesture = null;
                        awaitingRefine = null;
                        awaitingRefineReset = null;
                        awaitingPreset = null;
                        refineNumberEditing = false;
                    }
                    render();
                    immediateRefresh();
                }
            },
            refresh: refresh,
            applyAuthoritative: applyAuthoritative,
            getState: function () {
                return {
                    active: active,
                    addPointArmed: addPointArmed,
                    selectedChannel: selectedChannel,
                    selectedPointIndex: selectedPointIndex,
                    expectedBinding: expectedBinding && Object.assign({}, expectedBinding),
                    authoritative: authoritative && normalizeSnapshot(authoritative),
                    gestureActive: gesture !== null,
                    gesture: gesture && {
                        id: gesture.id,
                        channel: gesture.channel,
                        adding: !!gesture.adding,
                        pointIndex: gesture.pointIndex,
                        finishing: !!gesture.finishing,
                        awaitingAuthoritative: !!gesture.awaitingAuthoritative
                    },
                    awaitingTarget: awaitingTarget && {
                        operation: awaitingTarget.operation || "change",
                        channel: awaitingTarget.channel,
                        gestureId: awaitingTarget.gestureId,
                        selectedPhotoUuid: awaitingTarget.selectedPhotoUuid,
                        contextCounter: awaitingTarget.contextCounter,
                        submittedDevelopCounter: awaitingTarget.submittedDevelopCounter,
                        submittedRevision: awaitingTarget.submittedRevision,
                        submittedUpdatedAt: awaitingTarget.submittedUpdatedAt,
                        points: awaitingTarget.points.slice(),
                        insertion: awaitingTarget.insertion && {
                            originalLength: awaitingTarget.insertion.originalLength,
                            insertionIndex: awaitingTarget.insertion.insertionIndex,
                            left: awaitingTarget.insertion.left.slice(),
                            right: awaitingTarget.insertion.right.slice()
                        }
                    },
                    awaitingReset: awaitingReset && Object.assign({}, awaitingReset),
                    refineGestureActive: refineGesture !== null,
                    refineGesture: refineGesture && {
                        id: refineGesture.id,
                        finishing: !!refineGesture.finishing,
                        awaitingAuthoritative: !!refineGesture.awaitingAuthoritative,
                        desired: refineGesture.desired
                    },
                    awaitingRefine: awaitingRefine && Object.assign({}, awaitingRefine),
                    awaitingRefineReset: awaitingRefineReset && Object.assign({}, awaitingRefineReset),
                    awaitingPreset: awaitingPreset && {
                        name: awaitingPreset.name,
                        points: awaitingPreset.points.slice(),
                        selectedPhotoUuid: awaitingPreset.selectedPhotoUuid,
                        contextCounter: awaitingPreset.contextCounter,
                        submittedDevelopCounter: awaitingPreset.submittedDevelopCounter,
                        submittedRevision: awaitingPreset.submittedRevision,
                        submittedAt: awaitingPreset.submittedAt
                    },
                    presetRequestInFlight: presetRequestInFlight,
                    requestInFlight: requestInFlight
                };
            }
        });
    }

    return Object.freeze({
        CHANNELS,
        CHANNEL_LABELS,
        REFINE_SATURATION_FIELD,
        PRESET_CURVES,
        MIN_COORDINATE,
        MAX_COORDINATE,
        VISUAL_POINT_RADIUS,
        TOUCH_TARGET_RADIUS,
        POINTER_DRAG_THRESHOLD_PX,
        POINT_CURVE_REQUEST_TIMEOUT_MS,
        POINT_CURVE_FEEDBACK_TIMEOUT_MS,
        validCurveArray,
        serializeCurve,
        graphCoordinates,
        adobeSplineSlopes,
        curveSegments,
        curvePathData,
        selectedPointValues,
        addPoint,
        createInsertionIdentity,
        insertionBaselineMatches,
        locateInsertedPoint,
        movePoint,
        deletePoint,
        curvesEqual,
        validRefineSaturation,
        parseRefineEditorValue,
        presetCurve,
        validBinding,
        bindingsEqual,
        normalizeSnapshot,
        authoritativeSnapshotIsNewer,
        createAwaitingTarget,
        resolveAwaitingTarget,
        createAwaitingScalar,
        resolveAwaitingScalar,
        createAwaitingPreset,
        resolveAwaitingPreset,
        remapSelectedPointIndex,
        createController
    });
});
