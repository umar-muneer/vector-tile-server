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
const { Pool } = require("pg");
const SphericalMercator = require("@mapbox/sphericalmercator");

const pool = new Pool({
  connectionString:
    "postgressql://umar.muneer@conradlabs.com@localhost:5432/staging",
});
const mercator = new SphericalMercator();
const repository = {
  landcover: {},
  hydrography: {},
  soil: {},
};

const getTile = (layerName, z, x, y) => {
  return new Promise((resolve, reject) => {
    repository[layerName].getTile(z, x, y, (err, mbTile, headers) => {
      if (err) {
        return reject(err);
      }
      resolve({ mbTile, headers });
    });
  });
};

const getTileIndex = (layerName) => {
  return new Promise((resolve, reject) => {
    new MbTiles(`./reportParts/${layerName}.mbtiles`, (err, mbTileIndex) => {
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
    repository.landcover = await getTileIndex("landcover");
    repository.soil = await getTileIndex("soil");
    repository.hydrography = await getTileIndex("hydrography");
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
  const layerName = req.query.layer;
  try {
    const { mbTile, headers } = await getTile(layerName, z, x, y);
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
app.get("/db/vt/:z/:x/:y", async (req, res) => {
  try {
    const bbox = mercator.bbox(req.params.x, req.params.y, req.params.z);
    const sql = `
    SELECT ST_AsMVT(q, 'hydrography', 4096, 'geometry')
    FROM (
      SELECT
        ST_AsMVTGeom(
          p.geometry,
          b.geometry,
          4096,
          0,
          true
        ) geometry
      FROM 
      (
        SELECT ST_GeomFROMGeoJSON((json_array_elements(feature_collection->'features'))->>'geometry') geometry
          FROM report_parts where report__id='55b07f66-7c23-4cea-ae09-4febef0bd2e4' and type = 'hydrography'
        ) as p,
        (
          SELECT ST_MakeEnvelope($1, $2, $3, $4, $5) as geometry
        ) as b
      WHERE 
        ST_Intersects(
          p.geometry,
          b.geometry
        )
    ) q`;
    const data = await pool.query(sql, [...bbox, 4326]);
    if (data.rows[0].st_asmvt.length === 0) {
      res.status(404);
    }
    const vectorTile = new VectorTile(new Protobuf(data.rows[0].st_asmvt));
    const fromVectorTile = vtPbf.fromVectorTileJs(vectorTile);
    res.setHeader("Content-Type", "application/x-protobuf");
    return res.send(Buffer.from(fromVectorTile));
  } catch (error) {
    console.log(error);
    res.status(500).end();
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
