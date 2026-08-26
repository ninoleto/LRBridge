const CHANNEL_FIELDS = Object.freeze({
    rgb: "ToneCurvePV2012",
    red: "ToneCurvePV2012Red",
    green: "ToneCurvePV2012Green",
    blue: "ToneCurvePV2012Blue"
});

const CHANNELS = Object.freeze(Object.keys(CHANNEL_FIELDS));
const MIN_COORDINATE = 0;
const MAX_COORDINATE = 255;
const MAX_ARRAY_LENGTH = 512;
const GESTURE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isDenseArray(value) {
    if (!Array.isArray(value)) return false;
    if (Object.keys(value).length !== value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
    }
    return true;
}

function validCurveArray(value) {
    if (!isDenseArray(value) || value.length < 4 || value.length > MAX_ARRAY_LENGTH || value.length % 2 !== 0) {
        return false;
    }

    let previousX = null;
    for (let index = 0; index < value.length; index += 2) {
        const x = value[index];
        const y = value[index + 1];
        if (!Number.isFinite(x) || !Number.isInteger(x) || x < MIN_COORDINATE || x > MAX_COORDINATE ||
            !Number.isFinite(y) || !Number.isInteger(y) || y < MIN_COORDINATE || y > MAX_COORDINATE) {
            return false;
        }
        if (previousX !== null && x <= previousX) return false;
        previousX = x;
    }

    return value[0] === MIN_COORDINATE && value[value.length - 2] === MAX_COORDINATE;
}

function serializeCurve(value) {
    if (!validCurveArray(value)) return null;
    return value.join(",");
}

function parseCurve(value) {
    if (typeof value !== "string" || value === "" || value.trim() !== value || !/^\d+(?:,\d+)+$/.test(value)) {
        return null;
    }
    const parsed = value.split(",").map(Number);
    return validCurveArray(parsed) ? parsed : null;
}

function validChannel(channel) {
    return typeof channel === "string" && Object.prototype.hasOwnProperty.call(CHANNEL_FIELDS, channel);
}

function fieldForChannel(channel) {
    return validChannel(channel) ? CHANNEL_FIELDS[channel] : null;
}

function validBinding(binding) {
    return binding && typeof binding === "object" && !Array.isArray(binding) &&
        typeof binding.selectedPhotoUuid === "string" && binding.selectedPhotoUuid.length >= 1 &&
        binding.selectedPhotoUuid.length <= 160 &&
        Number.isSafeInteger(binding.contextCounter) && binding.contextCounter >= 0 &&
        Number.isSafeInteger(binding.developCounter) && binding.developCounter >= 0;
}

function bindingFromContext(fields) {
    return {
        selectedPhotoUuid: fields && typeof fields.selectedPhotoUuid === "string" ? fields.selectedPhotoUuid : null,
        contextCounter: fields ? fields.contextCounter : null,
        developCounter: fields ? fields.developCounter : null
    };
}

function bindingsEqual(left, right) {
    return validBinding(left) && validBinding(right) &&
        left.selectedPhotoUuid === right.selectedPhotoUuid &&
        left.contextCounter === right.contextCounter &&
        left.developCounter === right.developCounter;
}

function cloneCurves(curves) {
    const result = {};
    for (const channel of CHANNELS) result[channel] = curves[channel].slice();
    return result;
}

function createPointCurveState() {
    let snapshot = null;
    let revision = 0;
    let syncedBinding = null;
    const admittedGestures = new Map();

    function gestureKey(binding, channel, gestureId) {
        return [binding.selectedPhotoUuid, binding.contextCounter, channel, gestureId].join("|");
    }

    function invalidateSnapshot() {
        snapshot = null;
    }

    function invalidate() {
        invalidateSnapshot();
        admittedGestures.clear();
    }

    function syncContext(fields) {
        const binding = bindingFromContext(fields);
        if (!fields || fields.activeModule !== "develop" || !validBinding(binding)) {
            invalidate();
            syncedBinding = null;
            return true;
        }
        if (!bindingsEqual(syncedBinding, binding)) {
            const navigationChanged = !validBinding(syncedBinding) ||
                syncedBinding.selectedPhotoUuid !== binding.selectedPhotoUuid ||
                syncedBinding.contextCounter !== binding.contextCounter;
            if (navigationChanged) invalidate();
            else invalidateSnapshot();
            syncedBinding = binding;
            return true;
        }
        return false;
    }

    function acceptFeedback(feedback, fields) {
        const currentBinding = bindingFromContext(fields);
        if (!fields || fields.activeModule !== "develop" || !validBinding(feedback) ||
            !bindingsEqual(feedback, currentBinding) || typeof feedback.name !== "string" ||
            feedback.name.length < 1 || feedback.name.length > 80 ||
            !feedback.curves || typeof feedback.curves !== "object" || Array.isArray(feedback.curves)) {
            return false;
        }
        for (const channel of CHANNELS) {
            if (!validCurveArray(feedback.curves[channel])) return false;
        }

        const next = {
            selectedPhotoUuid: feedback.selectedPhotoUuid,
            contextCounter: feedback.contextCounter,
            developCounter: feedback.developCounter,
            name: feedback.name,
            curves: cloneCurves(feedback.curves),
            updatedAt: Date.now()
        };
        const previousCanonical = snapshot && JSON.stringify({
            selectedPhotoUuid: snapshot.selectedPhotoUuid,
            contextCounter: snapshot.contextCounter,
            developCounter: snapshot.developCounter,
            name: snapshot.name,
            curves: snapshot.curves
        });
        const nextCanonical = JSON.stringify({
            selectedPhotoUuid: next.selectedPhotoUuid,
            contextCounter: next.contextCounter,
            developCounter: next.developCounter,
            name: next.name,
            curves: next.curves
        });
        if (previousCanonical !== nextCanonical) revision += 1;
        snapshot = next;
        return true;
    }

    function get(fields) {
        const binding = bindingFromContext(fields);
        const available = !!snapshot && fields && fields.activeModule === "develop" && bindingsEqual(snapshot, binding);
        if (!available) {
            return Object.assign({ available: false, revision: revision, name: null, curves: null }, binding);
        }
        return {
            available: true,
            revision: revision,
            selectedPhotoUuid: snapshot.selectedPhotoUuid,
            contextCounter: snapshot.contextCounter,
            developCounter: snapshot.developCounter,
            name: snapshot.name,
            curves: cloneCurves(snapshot.curves),
            updatedAt: snapshot.updatedAt
        };
    }

    function admitBinding(binding, fields) {
        return fields && fields.activeModule === "develop" && bindingsEqual(binding, bindingFromContext(fields)) &&
            snapshot && bindingsEqual(binding, snapshot);
    }

    function beginGesture(binding, channel, gestureId, baseline, fields) {
        if (!admitBinding(binding, fields) || !validChannel(channel) || !GESTURE_ID_PATTERN.test(gestureId || "") ||
            !validCurveArray(baseline) || serializeCurve(snapshot.curves[channel]) !== serializeCurve(baseline)) {
            return false;
        }
        const key = gestureKey(binding, channel, gestureId);
        if (admittedGestures.has(key)) return true;
        for (const admitted of admittedGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter && admitted.channel === channel) return false;
        }
        admittedGestures.set(key, { binding: Object.assign({}, binding), channel: channel, gestureId: gestureId });
        return true;
    }

    function updateGesture(binding, channel, gestureId, baseline, points, fields) {
        const key = validBinding(binding) ? gestureKey(binding, channel, gestureId) : "";
        return admittedGestures.has(key) && admitBinding(binding, fields) && validCurveArray(baseline) &&
            validCurveArray(points) && serializeCurve(snapshot.curves[channel]) === serializeCurve(baseline);
    }

    function endGesture(binding, channel, gestureId, baseline, points, fields) {
        const key = validBinding(binding) ? gestureKey(binding, channel, gestureId) : "";
        if (!admittedGestures.has(key)) return false;
        return admitBinding(binding, fields) && validCurveArray(baseline) && validCurveArray(points) &&
            serializeCurve(snapshot.curves[channel]) === serializeCurve(baseline);
    }

    function finishGesture(binding, channel, gestureId) {
        if (!validBinding(binding)) return false;
        return admittedGestures.delete(gestureKey(binding, channel, gestureId));
    }

    function drainGestures() {
        const drained = Array.from(admittedGestures.values(), function (admitted) {
            return {
                binding: Object.assign({}, admitted.binding),
                channel: admitted.channel,
                gestureId: admitted.gestureId
            };
        });
        admittedGestures.clear();
        return drained;
    }

    function takeGestureConflicts(binding, channel, gestureId) {
        if (!validBinding(binding) || !validChannel(channel)) return [];
        const removed = [];
        for (const [key, admitted] of admittedGestures.entries()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter && admitted.channel === channel &&
                admitted.gestureId !== gestureId) {
                removed.push({
                    binding: Object.assign({}, admitted.binding),
                    channel: admitted.channel,
                    gestureId: admitted.gestureId
                });
                admittedGestures.delete(key);
            }
        }
        return removed;
    }

    function getGestureDiagnostics() {
        return {
            count: admittedGestures.size,
            admitted: Array.from(admittedGestures.values(), function (admitted) {
                return {
                    selectedPhotoUuid: admitted.binding.selectedPhotoUuid,
                    contextCounter: admitted.binding.contextCounter,
                    developCounter: admitted.binding.developCounter,
                    channel: admitted.channel,
                    gestureId: admitted.gestureId
                };
            })
        };
    }

    function admitReset(binding, channel, baseline, fields) {
        if (!admitBinding(binding, fields) || !validChannel(channel) || !validCurveArray(baseline) ||
            serializeCurve(snapshot.curves[channel]) !== serializeCurve(baseline)) return false;
        for (const admitted of admittedGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter && admitted.channel === channel) return false;
        }
        return true;
    }

    return {
        syncContext,
        acceptFeedback,
        get,
        beginGesture,
        updateGesture,
        endGesture,
        finishGesture,
        drainGestures,
        takeGestureConflicts,
        getGestureDiagnostics,
        admitReset,
        invalidate
    };
}

module.exports = {
    CHANNEL_FIELDS,
    CHANNELS,
    MIN_COORDINATE,
    MAX_COORDINATE,
    MAX_ARRAY_LENGTH,
    GESTURE_ID_PATTERN,
    validCurveArray,
    serializeCurve,
    parseCurve,
    validChannel,
    fieldForChannel,
    validBinding,
    bindingsEqual,
    createPointCurveState
};
