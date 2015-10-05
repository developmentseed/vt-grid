var path = require('path')
var zlib = require('zlib')
var vtpbf = require('vt-pbf')
var geojsonvt = require('geojson-vt')
var VectorTile = require('vector-tile').VectorTile
var Pbf = require('pbf')
var tilebelt = require('tilebelt')
var queue = require('queue-async')
var aggregate = require('geojson-polygon-aggregate')
var tiletree = require('./lib/tile-family')
var GeoJSONWrapper = require('./lib/geojson-wrapper')

module.exports = grid

/**
 * @param {MBTiles} dest
 * @param {MBTiles} source
 * @param {Object} opts
 * @param {Array<Array<number>>} opts.tiles - the data tiles upon which to build the grid
 * @param {Object|string} opts.aggregations - If an object, maps layer names to aggregation objects, which themselves map field names to geojson-polygon-aggregate style aggregation functions. If a string, then it should be the path of a module that exports such an object under the key `aggregations`.
 * @param {string} [opts.postAggregations] - An object mapping layer names to { field1: fn1, field2: fn2 } objects, where fn1, fn2 are functions that are called on with the aggregated grid square features, and yield property values that will be set on those features, or else the path to a module exporting such an object under the key `postAggregations`.
 * @param {number} opts.minzoom
 * @param {number} opts.basezoom
 * @param {number} [opts.gridsize]
 * @param {Function} callback
 */
function grid (dest, source, opts, callback) {
  if (!callback) { callback = function () {} }

  if (typeof opts.aggregations === 'string') {
    var mod = path.resolve(process.cwd(), opts.aggregations)
    opts.aggregations = require(mod).aggregations
  }

  if (typeof opts.postAggregations === 'string') {
    mod = path.resolve(process.cwd(), opts.postAggregations)
    opts.postAggregations = require(mod).postAggregations
  }

  opts.minzoom = Math.max(0, opts.minzoom)
  opts.gridsize = +(opts.gridsize || 1024)
  opts._depth = Math.log2(opts.gridsize) / 2
  if (opts._depth !== (opts._depth | 0)) {
    throw new Error('Gridsize must be a power of 4')
  }

  var pyramid = tiletree.getAncestors(opts.tiles, opts.minzoom)

  if (opts.tiles[0][0] !== opts.basezoom) {
    source = dest
  } else {
    pyramid.unshift(opts.tiles)
  }

  // console.log(pyramid.map(function (l) { return l[0][0] + ':' + l.length }))
  aggregateTiles(dest, source, opts, pyramid, callback)
}

/**
 * @param {Array} levels An array of pyramid levels, where each pyramid level is itself an array of coordinates of tiles that we want to build.
 * @private
 */
function aggregateTiles (dest, src, options, levels, callback) {
  if (levels.length === 0) { return callback() }
  dest.startWriting(next)

  var featureCount = 0
  var tileCount = 0
  var tiles = levels[0]

  function next (err, featuresRead) {
    if (err) { return callback(err) }
    if (!tiles.length) { return done() }

    tileCount++
    featureCount += featuresRead || 0
    if (options.progress && tileCount % 10 === 0) {
      options.progress(tileCount, featureCount, tiles[0].join('/'))
      tileCount = 0
      featureCount = 0
    }

    var tile = tiles.shift()
    var children = tile[0] === options.basezoom ? [tile] : tiletree.getChildren(tile)
    var q = queue()
    children.forEach(function (t) {
      q.defer(readTileFeatures, src, t, options.aggregations)
    })
    q.awaitAll(function (err, tileFeatures) {
      if (err) { return next(err) }
      writeAggregatedTile(dest, options, tile, tileFeatures, next)
    })
  }

  function done () {
    dest._commit(function (err) {
      if (err) { return callback(err) }
      // we've built the lowest layer of the pyramid we were given. now recurse
      // with the rest.  Use `dest` as the source too, since after the first
      // level is built, we want to read from dest, not source
      aggregateTiles(dest, dest, options, levels.slice(1), callback)
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
  var layerCount = 0
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

    var progeny = tiletree.getProgeny(tile, gz)
    var boxes = []
    for (var i = 0; i < progeny.length; i++) {
      var t = tileIndex.getTile.apply(tileIndex, progeny[i])
      if (!t) { continue }

      var vt = new GeoJSONWrapper(t.features)
      var features = new Array(vt.length)
      for (var j = 0; j < vt.length; j++) {
        var feat = vt.feature(j)
        features[j] = feat.toGeoJSON.apply(feat, tiletree.toXYZ(progeny[i]))
      }

      var box = {
        type: 'Feature',
        properties: aggregate(features, options.aggregations[layer]),
        geometry: tilebelt.tileToGeoJSON(tiletree.toXYZ(progeny[i]))
      }

      if (options.postAggregations && options.postAggregations[layer]) {
        for (var field in options.postAggregations[layer]) {
          var fn = options.postAggregations[layer][field]
          box.properties[field] = fn(box)
        }
      }

      box.properties._quadKey = tilebelt.tileToQuadkey(tiletree.toXYZ(progeny[i]))
      boxes.push(box)
    }

    if (boxes.length) {
      aggregatedLayers[layer] = geojsonvt({
        type: 'FeatureCollection',
        features: boxes
      }, {
        maxZoom: z,
        tolerance: 0,
        buffer: 0,
        indexMaxZoom: z
      }).getTile(tile[0], tile[1], tile[2])

      layerCount++
    }
  }

  // serialize, compress, and save the tile
  if (layerCount) {
    var buff = vtpbf.fromGeojsonVt(aggregatedLayers)
    zlib.gzip(buff, function (err, zipped) {
      if (err) { return next(err) }
      db.putTile(tile[0], tile[1], tile[2], zipped, function (err) {
        if (err) { return next(err) }
        next(null, featuresRead)
      })
    })
  } else {
    next(null, featuresRead)
  }
}

function readTileFeatures (db, tile, layers, callback) {
  db.getTile(tile[0], tile[1], tile[2], function (err, data) {
    if (err) return callback(null, [])

    zlib.gunzip(data, function (err, buff) {
      if (err) return callback(err)
      var result = {}
      var vt = new VectorTile(new Pbf(buff))

      var count = 0
      for (var layerName in layers) {
        var layer = vt.layers[layerName]
        if (!layer) { continue }

        var features = []
        count += layer.length
        for (var i = 0; i < layer.length; i++) {
          features.push(layer.feature(i).toGeoJSON(tile[1], tile[2], tile[0]))
        }

        result[layerName] = features
      }
      callback(null, result)
    })
  })
}

