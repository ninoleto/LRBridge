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

function exists(sliderId) {
    return sliderMap[sliderId] !== undefined;
}

module.exports = {
    getAll,
    getIds,
    exists
};