const compression = require("compression");
const geoJsonVt = require("geojson-vt");
const vtPbf = require("vt-pbf");
const express = require("express");
const landcover = require("./reportParts/landcover.json");
const { featureCollection } = require("./all-features");
const path = require("path");

const tileIndex = geoJsonVt(featureCollection);
const app = express();
app.use(compression());
app.get("/vt/:z/:x/:y", (req, res) => {
  const { z, x, y } = req.params;
  const zNumber = parseInt(z, 10);
  const xNumber = parseInt(x, 10);
  const YNumber = parseInt(y, 10);
  const tile = tileIndex.getTile(zNumber, xNumber, YNumber);
  if (!tile) {
    res.status(404).end();
    return;
  }
  const pbfFormat = vtPbf.fromGeojsonVt({ geojsonLayer: tile });
  const buffer = Buffer.from(pbfFormat);
  res.set("Content-Type", "application/protobuf");

  res.send(buffer);
});

app.get("/", (req, res) => {
  const filePath = path.resolve(__dirname, "./client/index.html");
  res.sendFile(filePath);
});

app.listen(3005, () => console.log("listening to server now"));

app.get("/landcover", (req, res) => {
  res.json(landcover);
});

/**
 * Observations
 * 1. If we go by this approach, we will probably need a very performant vector tile server
 * 2. Does the calls to load vector data for the base layer impact pricing and by how much?
 */
