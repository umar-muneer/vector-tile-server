const contour = require("./reportParts/contour.json");
const eco = require("./reportParts/ecoregion.json");
const environmental = require("./reportParts/environmental.json");
const firm = require("./reportParts/firm.json");
const geography = require("./reportParts/geography.json");
const geology = require("./reportParts/geology.json");
const hydrography = require("./reportParts/hydrography.json");
const landcover = require("./reportParts/landcover.json");
const protected = require("./reportParts/protected.json");
const slope = require("./reportParts/slope.json");
const soil = require("./reportParts/soil.json");
const species = require("./reportParts/species.json");
const watershed = require("./reportParts/watershed.json");
const wetland = require("./reportParts/wetland.json");

const features = [
  //   ...contour.features,
  // ...eco.features,
  // ...environmental.features,
  // ...firm.features,
  // ...geography.features,
  // ...geology.features,
  ...hydrography.features,
  ...landcover.features,
  // ...protected.features,
  // ...slope.features,
  ...soil.features,
  // ...species.features,
  // ...watershed.features,
  // ...wetland.features,
];

const featureCollection = {
  type: "FeatureCollection",
  features,
};

module.exports = { featureCollection };
