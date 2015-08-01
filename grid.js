var zlib = require('zlib')
var vtpbf = require('vt-pbf')
var geojsonvt = require('geojson-vt')
var VectorTile = require('vector-tile').VectorTile
var Pbf = require('pbf')
var tilebelt = require('tilebelt')
var uniq = require('uniq')
var queue = require('queue-async')
var rectangleGrid = require('turf-rectangle-grid')
var aggregate = require('geojson-polygon-aggregate')
var list = require('./list')
var GeoJSONWrapper = require('./lib/geojson-wrapper')

module.exports = grid

function grid (source, opts, callback) {
  if (!callback) { callback = function () {} }
  opts.minzoom = Math.max(0, opts.minzoom)
  opts.basezoom = Math.max(opts.minzoom, opts.basezoom)
  opts.gridsize = +(opts.gridsize || 64)
  opts._depth = Math.log2(opts.gridsize) / 2
  if (opts._depth !== (opts._depth | 0)) {
    throw new Error('Gridsize must be a power of 4')
  }
  buildLevel(source, opts, opts.basezoom - 1, callback)
}

function buildLevel (db, opts, z, callback) {
  if (z < opts.minzoom || z >= opts.basezoom) { return callback() }
  list(db, z + 1, function (err, tiles) {
    if (err) { return callback(err) }
    var parents = tiles.map(getParentTile)
    // remove duplicates
    parents = uniq(parents.map(join).sort()).map(split)
    aggregateLevel(db, opts, parents, function (err) {
      if (err) { return callback(err) }
      buildLevel(db, opts, z - 1, callback)
    })
  })
}

function aggregateLevel (db, options, tiles, callback) {
  db.startWriting(next)

  var featureCount = 0
  var tileCount = -1
  var total = tiles.length

  function next (err, featuresRead) {
    if (err) { callback(err) }
    if (!tiles.length) { return done() }

    tileCount++
    featureCount += featuresRead || 0
    if (options.progress) {
      options.progress(tileCount, total, featureCount, tiles[0])
    }

    var tile = tiles.shift()
    var children = getTileChildren(tile)
    var q = queue()
    children.forEach(function (t) {
      q.defer(readTileFeatures, db, t, options.layers)
    })
    q.awaitAll(function (err, tileFeatures) {
      if (err) { return next(err) }
      writeAggregatedTile(db, options, tile, tileFeatures, next)
    })
  }

  function done () {
    db.stopWriting(function (err) {
      if (err) { callback(err) }
      callback()
    })
  }
}

function writeAggregatedTile (db, options, tile, tileFeatures, next) {
  var z = tile[0]
  var gz = z + options._depth

  // for each tile, we get a map of layer name -> geojson features
  // so, first, combine these into a single such map
  var featuresRead = 0
  var featuresByLayer = tileFeatures.reduce(function (memo, layers) {
    for (var l in layers) {
      memo[l] = (memo[l] || []).concat(layers[l])
      featuresRead += layers[l].length
    }
    return memo
  }, {})

  // now, for each layer, aggregate whatever data properties were specified
  // in the options, and then use geojson-vt to make the result into a
  // vector tile object.
  var aggregatedLayers = {}
  for (var layer in featuresByLayer) {
    var tileIndex = geojsonvt({
      type: 'FeatureCollection',
      features: featuresByLayer[layer]
    }, {
      maxZoom: gz,
      tolerance: 0,
      buffer: 0,
      indexMaxZoom: gz
    })

    var progeny = getTileProgeny(tile, gz)
    var boxes = new Array(progeny.length)
    for (var i = 0; i < progeny.length; i++) {
      var t = tileIndex.getTile.apply(tileIndex, progeny[i])
      var features
      if (t) {
        var vt = new GeoJSONWrapper(t.features)
        features = new Array(vt.length)
        for (var j = 0; j < vt.length; j++) {
          var feat = vt.feature(j)
          features[j] = feat.toGeoJSON.apply(feat, toXYZ(progeny[i]))
        }
      } else {
        features = []
      }

      boxes[i] = {
        type: 'Feature',
        properties: aggregate(features, options.layers[layer]),
        geometry: tilebelt.tileToGeoJSON(toXYZ(progeny[i]))
      }
    }

    aggregatedLayers[layer] = geojsonvt({
      type: 'FeatureCollection',
      features: boxes
    }, {maxZoom: z}).getTile(tile[0], tile[1], tile[2])
  }

  // serialize, compress, and save the tile
  var buff = vtpbf.fromGeojsonVt(aggregatedLayers)
  zlib.gzip(buff, function (err, zipped) {
    if (err) { return next(err) }
    db.putTile(tile[0], tile[1], tile[2], zipped, function (err) {
      if (err) { return next(err) }
      next(null, featuresRead)
    })
  })
}

function readTileFeatures (db, tile, layers, callback) {
  db.getTile(tile[0], tile[1], tile[2], function (err, data) {
    if (err) return callback(null, [])

    zlib.gunzip(data, function (err, buff) {
      if (err) return callback(err)
      var result = {}
      var vt = new VectorTile(new Pbf(buff))

      for (var layerName in layers) {
        var layer = vt.layers[layerName]
        if (!layer) {
          var message = 'Layer ' + layerName + ' missing in ' + tile
          message += '\nExisting layers: ' + Object.keys(vt.layers).join(',')
          return callback(new Error(message))
        }

        var features = []
        for (var i = 0; i < layer.length; i++) {
          features.push(layer.feature(i).toGeoJSON(tile[1], tile[2], tile[0]))
        }

        result[layerName] = features
      }
      callback(null, result)
    })
  })
}

function join (t) { return t.join('/') }
function split (t) { return t.split('/').map(Number) }

function getParentTile (tile) {
  return toZXY(tilebelt.getParent(toXYZ(tile)))
}

function getTileChildren (tile) {
  return tilebelt.getChildren(toXYZ(tile)).map(toZXY)
}

function getTileProgeny (tile, zoom) {
  var z = tile[0]
  var tiles = [toXYZ(tile)]
  while (z < zoom) {
    var c = 0
    var nextTiles = new Array(tiles.length * 4)
    for (var i = 0; i < tiles.length; i++) {
      var children = tilebelt.getChildren(tiles[i])
      for (var j = 0; j < 4; j++) {
        nextTiles[c++] = children[j]
      }
    }
    tiles = nextTiles
    z++
  }
  return tiles.map(toZXY)
}

function toZXY (tile) {
  return [tile[2], tile[0], tile[1]]
}

function toXYZ (tile) {
  return [tile[1], tile[2], tile[0]]
}

function tileGrid (tile, gridsize) {
  tile = [tile[1], tile[2], tile[0]]
  var boxes = rectangleGrid(tilebelt.tileToBBOX(tile), [gridsize, gridsize])
  return boxes.features
}
