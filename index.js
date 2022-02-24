const compression = require("compression");
const geoJsonVt = require("geojson-vt");
const vtPbf = require("vt-pbf");
const express = require("express");
const landcover = require("./reportParts/landcover.json");
const { featureCollection } = require("./all-features");
const path = require("path");
const MbTiles = require("@mapbox/mbtiles");
const { VectorTile } = require("@mapbox/vector-tile");
const zlib = require("zlib");
const Protobuf = require("pbf");

let tileIndex = {};

const getTile = (z, x, y) => {
  return new Promise((resolve, reject) => {
    tileIndex.getTile(z, x, y, (err, mbTile, headers) => {
      if (err) {
        return reject(err);
      }
      resolve({ mbTile, headers });
    });
  });
};

const getTileIndex = () => {
  return new Promise((resolve, reject) => {
    new MbTiles("./reportParts/repository.mbtiles", (err, mbTileIndex) => {
      if (err) {
        return reject(err);
      }
      resolve(mbTileIndex);
    });
  });
};
const app = express();
app.use(async (req, res, next) => {
  try {
    tileIndex = await getTileIndex();
    next();
  } catch (err) {
    console.log(err);
    res.status(500).json("sth went wrong while loading the tile index");
  }
});
app.use(
  compression({
    filter: (req, res) => {
      if (res.getHeader("Content-Type") === "application/protobuf") {
        return true;
      }
      return compression.filter(req, res);
    },
  })
);
app.get("/vt/:z/:x/:y", async (req, res) => {
  const { z, x, y } = req.params;
  try {
    const { mbTile, headers } = await getTile(z, x, y);
    if (!mbTile) {
      res.status(404).end();
      return;
    }
    const unzipped = zlib.gunzipSync(mbTile);
    const vectorTile = new VectorTile(new Protobuf(unzipped));
    const fromVectorTile = vtPbf.fromVectorTileJs(vectorTile);
    res.set("Content-Type", "application/protobuf");
    res.send(Buffer.from(fromVectorTile));
  } catch (error) {
    console.log(error);
    res.status(500).json("sth went wrong while loading the tile");
  }
});

app.get("/", (req, res) => {
  const filePath = path.resolve(__dirname, "./client/index.html");
  res.sendFile(filePath);
});

app.listen(3005, () => console.log("listening to server now"));

app.get("/landcover", (req, res) => {
  res.json(landcover);
});

app.get("/health", (req, res) => {
  res.json("OK");
});

/**
 * Observations
 * 1. If we go by this approach, we will probably need a very performant vector tile server
 * 2. Does the calls to load vector data for the base layer impact pricing and by how much?
 */
