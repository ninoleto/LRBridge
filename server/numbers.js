function parseFiniteNumber(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim().length === 0) return null;

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function parseFiniteInteger(value) {
    const number = parseFiniteNumber(value);
    return number !== null && Number.isInteger(number) ? number : null;
}

function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

module.exports = {
    parseFiniteNumber,
    parseFiniteInteger,
    isFiniteNumber
};
