const compression = require("compression");
const { DateTime } = require("luxon");
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

const dataCache = {};
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
const getReportPartFromDb = async (reportPartId) => {
  try {
    const sql = `select feature_collection from report_parts where _id='${reportPartId}'`;
    const data = await pool.query(sql);
    return data.rows[0].feature_collection;
  } catch (err) {
    throw err;
  }
};
const app = express();
app.use(async (req, res, next) => {
  try {
    console.time("time to build tileindex for landcover");
    repository.landcover = await getTileIndex("landcover");
    console.timeEnd("time to build tileindex for landcover");
    console.time("time to build tileindex for soil");
    repository.soil = await getTileIndex("soil");
    console.timeEnd("time to build tileindex for soil");
    console.time("time to build tileIndex for hydro");
    repository.hydrography = await getTileIndex("hydrography");
    console.timeEnd("time to build tileIndex for hydro");
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
app.get("/in-mem/vt/:z/:x/:y", async (req, res) => {
  const { z, x, y } = req.params;
  const { reportPartId } = req.query;

  const featureCollection = dataCache[reportPartId]
    ? dataCache[reportPartId]
    : await getReportPartFromDb(reportPartId);

  if (!dataCache[reportPartId]) {
    dataCache[reportPartId] = featureCollection;
  }
  console.time("time to generate index");
  const tileRepository = geoJsonVt(featureCollection);
  console.timeEnd("time to generate index");
  const zNumber = parseInt(z, 10);
  const xNumber = parseInt(x, 10);
  const YNumber = parseInt(y, 10);
  const tile = tileRepository.getTile(zNumber, xNumber, YNumber);
  if (!tile) {
    res.status(404).end();
    return;
  }
  const pbfFormat = vtPbf.fromGeojsonVt({ geojsonLayer: tile });
  const buffer = Buffer.from(pbfFormat);
  res.set("Content-Type", "application/protobuf");
  res.send(buffer);
});
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
    const { reportPartId, layer } = req.query;
    const { z, x, y } = req.params;
    const sql = `WITH 
    bounds AS ( 
        SELECT ST_Transform(ST_TileEnvelope(${z}, ${x}, ${y}), 3857) AS geom
    ), 
    geometries AS (
        SELECT ST_GeomFROMGeoJSON((json_array_elements(feature_collection->'features'))->>'geometry') geometry
       FROM report_parts where _id='${reportPartId}'
    ), 
    mvtgeom AS ( 
        SELECT ST_AsMVTGeom(ST_Transform(g.geometry, 3857),  bounds.geom) AS geom
        FROM geometries g, bounds 
        WHERE ST_Transform(g.geometry, 3857) && bounds.geom
    ) 
    SELECT ST_AsMVT(mvtgeom.*, '${layer}') FROM mvtgeom
      `;
    const time = DateTime.now().toUnixInteger();
    console.time(`query-time:${time}`);
    const data = await pool.query(sql);
    console.timeEnd(`query-time:${time}`);
    if (data.rows[0].st_asmvt.length === 0) {
      res.status(404);
    }
    res.setHeader("Content-Type", "application/x-protobuf");
    res.send(data.rows[0].st_asmvt);
  } catch (error) {
    console.log(error);
    res.status(500).end();
  }
});
app.get("/db/project/vt/:z/:x/:y", async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const sql = ` WITH 
    bounds AS ( 
        SELECT ST_Transform(ST_TileEnvelope(${z}, ${x}, ${y}), 3857) AS geom
    ), 
    mvtgeom AS ( 
        SELECT ST_AsMVTGeom(ST_Transform(p.geometry, 3857),  bounds.geom) AS geom, _id, p.name
        FROM projects p, bounds 
        WHERE ST_Transform(p.geometry, 3857) && bounds.geom
        AND p.deleted_at is null
    ) 
    SELECT ST_AsMVT(mvtgeom.*, 'source-layer') FROM mvtgeom
      `;
    const data = await pool.query(sql);
    if (data.rows[0].st_asmvt.length === 0) {
      res.status(404);
    }
    res.setHeader("Content-Type", "application/x-protobuf");
    res.send(data.rows[0].st_asmvt);
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
