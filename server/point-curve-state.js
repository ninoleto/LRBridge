const CHANNEL_FIELDS = Object.freeze({
    rgb: "ToneCurvePV2012",
    red: "ToneCurvePV2012Red",
    green: "ToneCurvePV2012Green",
    blue: "ToneCurvePV2012Blue"
});

const CHANNELS = Object.freeze(Object.keys(CHANNEL_FIELDS));
const REFINE_SATURATION_FIELD = "CurveRefineSaturation";
const PRESET_CURVES = Object.freeze({
    Linear: Object.freeze([0, 0, 255, 255]),
    "Medium Contrast": Object.freeze([0, 0, 32, 22, 64, 56, 128, 128, 192, 196, 255, 255]),
    "Strong Contrast": Object.freeze([0, 0, 32, 16, 64, 50, 128, 128, 192, 202, 255, 255])
});
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

function validRefineSaturation(value, minimum, maximum) {
    return Number.isFinite(value) && Number.isFinite(minimum) && Number.isFinite(maximum) &&
        minimum < maximum && value >= minimum && value <= maximum;
}

function presetCurve(name) {
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(PRESET_CURVES, name)
        ? PRESET_CURVES[name].slice() : null;
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
    const admittedRefineGestures = new Map();

    function gestureKey(binding, channel, gestureId) {
        return [binding.selectedPhotoUuid, binding.contextCounter, channel, gestureId].join("|");
    }

    function refineGestureKey(binding, gestureId) {
        return [binding.selectedPhotoUuid, binding.contextCounter, REFINE_SATURATION_FIELD, gestureId].join("|");
    }

    function invalidateSnapshot() {
        snapshot = null;
    }

    function invalidate() {
        invalidateSnapshot();
        admittedGestures.clear();
        admittedRefineGestures.clear();
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
            !feedback.refineSaturation || typeof feedback.refineSaturation !== "object" ||
            !validRefineSaturation(feedback.refineSaturation.value, feedback.refineSaturation.min,
                feedback.refineSaturation.max) ||
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
            refineSaturation: {
                value: feedback.refineSaturation.value,
                min: feedback.refineSaturation.min,
                max: feedback.refineSaturation.max
            },
            curves: cloneCurves(feedback.curves),
            updatedAt: Date.now()
        };
        const previousCanonical = snapshot && JSON.stringify({
            selectedPhotoUuid: snapshot.selectedPhotoUuid,
            contextCounter: snapshot.contextCounter,
            developCounter: snapshot.developCounter,
            name: snapshot.name,
            refineSaturation: snapshot.refineSaturation,
            curves: snapshot.curves
        });
        const nextCanonical = JSON.stringify({
            selectedPhotoUuid: next.selectedPhotoUuid,
            contextCounter: next.contextCounter,
            developCounter: next.developCounter,
            name: next.name,
            refineSaturation: next.refineSaturation,
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
            return Object.assign({
                available: false,
                revision: revision,
                name: null,
                refineSaturation: null,
                curves: null
            }, binding);
        }
        return {
            available: true,
            revision: revision,
            selectedPhotoUuid: snapshot.selectedPhotoUuid,
            contextCounter: snapshot.contextCounter,
            developCounter: snapshot.developCounter,
            name: snapshot.name,
            refineSaturation: Object.assign({}, snapshot.refineSaturation),
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
        for (const admitted of admittedRefineGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter) return false;
        }
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
                kind: "curve",
                binding: Object.assign({}, admitted.binding),
                channel: admitted.channel,
                gestureId: admitted.gestureId
            };
        });
        for (const admitted of admittedRefineGestures.values()) {
            drained.push({
                kind: "refineSaturation",
                binding: Object.assign({}, admitted.binding),
                field: REFINE_SATURATION_FIELD,
                gestureId: admitted.gestureId
            });
        }
        admittedGestures.clear();
        admittedRefineGestures.clear();
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
            count: admittedGestures.size + admittedRefineGestures.size,
            admitted: Array.from(admittedGestures.values(), function (admitted) {
                return {
                    selectedPhotoUuid: admitted.binding.selectedPhotoUuid,
                    contextCounter: admitted.binding.contextCounter,
                    developCounter: admitted.binding.developCounter,
                    channel: admitted.channel,
                    gestureId: admitted.gestureId
                };
            }).concat(Array.from(admittedRefineGestures.values(), function (admitted) {
                return {
                    kind: "refineSaturation",
                    selectedPhotoUuid: admitted.binding.selectedPhotoUuid,
                    contextCounter: admitted.binding.contextCounter,
                    developCounter: admitted.binding.developCounter,
                    field: REFINE_SATURATION_FIELD,
                    gestureId: admitted.gestureId
                };
            }))
        };
    }

    function admitReset(binding, channel, baseline, fields) {
        if (!admitBinding(binding, fields) || !validChannel(channel) || !validCurveArray(baseline) ||
            serializeCurve(snapshot.curves[channel]) !== serializeCurve(baseline)) return false;
        for (const admitted of admittedGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter && admitted.channel === channel) return false;
        }
        for (const admitted of admittedRefineGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter) return false;
        }
        return true;
    }

    function refineBaselineMatches(baseline) {
        return Number.isFinite(baseline) && snapshot && snapshot.refineSaturation &&
            baseline === snapshot.refineSaturation.value;
    }

    function beginRefineGesture(binding, gestureId, baseline, fields) {
        if (!admitBinding(binding, fields) || !GESTURE_ID_PATTERN.test(gestureId || "") ||
            !refineBaselineMatches(baseline)) return false;
        const key = refineGestureKey(binding, gestureId);
        if (admittedRefineGestures.has(key)) return true;
        for (const admitted of admittedGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter) return false;
        }
        for (const admitted of admittedRefineGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter) return false;
        }
        admittedRefineGestures.set(key, {
            binding: Object.assign({}, binding),
            field: REFINE_SATURATION_FIELD,
            gestureId: gestureId
        });
        return true;
    }

    function updateRefineGesture(binding, gestureId, baseline, value, fields) {
        const key = validBinding(binding) ? refineGestureKey(binding, gestureId) : "";
        return admittedRefineGestures.has(key) && admitBinding(binding, fields) &&
            refineBaselineMatches(baseline) && validRefineSaturation(
                value, snapshot.refineSaturation.min, snapshot.refineSaturation.max
            );
    }

    function endRefineGesture(binding, gestureId, baseline, value, fields) {
        const key = validBinding(binding) ? refineGestureKey(binding, gestureId) : "";
        if (!admittedRefineGestures.has(key)) return false;
        return admitBinding(binding, fields) && refineBaselineMatches(baseline) &&
            validRefineSaturation(value, snapshot.refineSaturation.min, snapshot.refineSaturation.max);
    }

    function finishRefineGesture(binding, gestureId) {
        if (!validBinding(binding)) return false;
        return admittedRefineGestures.delete(refineGestureKey(binding, gestureId));
    }

    function takeRefineGestureConflicts(binding, gestureId) {
        if (!validBinding(binding)) return [];
        const removed = [];
        for (const [key, admitted] of admittedRefineGestures.entries()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter && admitted.gestureId !== gestureId) {
                removed.push({
                    kind: "refineSaturation",
                    binding: Object.assign({}, admitted.binding),
                    field: REFINE_SATURATION_FIELD,
                    gestureId: admitted.gestureId
                });
                admittedRefineGestures.delete(key);
            }
        }
        return removed;
    }

    function admitRefineReset(binding, baseline, fields) {
        if (!admitBinding(binding, fields) || !refineBaselineMatches(baseline)) return false;
        for (const admitted of admittedRefineGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter) return false;
        }
        for (const admitted of admittedGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter) return false;
        }
        return true;
    }

    function admitPreset(binding, name, baseline, fields) {
        if (!admitBinding(binding, fields) || !presetCurve(name) || !validCurveArray(baseline) ||
            serializeCurve(snapshot.curves.rgb) !== serializeCurve(baseline)) return false;
        for (const admitted of admittedGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter) return false;
        }
        for (const admitted of admittedRefineGestures.values()) {
            if (admitted.binding.selectedPhotoUuid === binding.selectedPhotoUuid &&
                admitted.binding.contextCounter === binding.contextCounter) return false;
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
        beginRefineGesture,
        updateRefineGesture,
        endRefineGesture,
        finishRefineGesture,
        takeRefineGestureConflicts,
        admitRefineReset,
        admitPreset,
        invalidate
    };
}

module.exports = {
    CHANNEL_FIELDS,
    CHANNELS,
    REFINE_SATURATION_FIELD,
    PRESET_CURVES,
    MIN_COORDINATE,
    MAX_COORDINATE,
    MAX_ARRAY_LENGTH,
    GESTURE_ID_PATTERN,
    validCurveArray,
    serializeCurve,
    parseCurve,
    validChannel,
    fieldForChannel,
    validRefineSaturation,
    presetCurve,
    validBinding,
    bindingsEqual,
    createPointCurveState
};
