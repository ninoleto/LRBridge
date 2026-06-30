const sliderMetadata = require("../config/sliders.json");

const sliderMap = {};

for (const slider of sliderMetadata) {
    sliderMap[slider.id] = slider;
}

function getAll() {
    return sliderMetadata;
}

function getIds() {
    return sliderMetadata.map(function (slider) {
        return slider.id;
    });
}

function getGroups() {
    const groups = [];

    for (const slider of sliderMetadata) {
        if (!groups.includes(slider.group)) {
            groups.push(slider.group);
        }
    }

    return groups;
}

function exists(sliderId) {
    return sliderMap[sliderId] !== undefined;
}

function getById(sliderId) {
    return sliderMap[sliderId] || null;
}

function getDefaultValue(sliderId) {
    const slider = getById(sliderId);

    if (slider === null) {
        return null;
    }

    return slider.default;
}

module.exports = {
    getAll,
    getIds,
    getGroups,
    exists,
    getById,
    getDefaultValue
};