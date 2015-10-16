var path = require('path')
var zlib = require('zlib')
var vtpbf = require('vt-pbf')
var VectorTile = require('vector-tile').VectorTile
var Pbf = require('pbf')
var queue = require('queue-async')
var tiletree = require('./tile-family')
var aggregateCells = require('./aggregate-cells')
var tileFromFeatureCollection = require('./create-tile')

var debug = require('debug')('vt-grid:grid')

module.exports = grid

/**
 * @private
 * Build up a pyramid of aggregated tiles starting with base data in `source`
 *
 * @param {MBTiles} dest
 * @param {MBTiles} source
 * @param {Object} opts
 * @param {Array<Array<number>>} opts.tiles - The first (hightest zoom) level of tiles to build.
 * @param {Object|string} opts.aggregations - If an object, maps layer names to aggregation objects, which themselves map field names to geojson-polygon-aggregate style aggregation functions. If a string, then it should be the path of a module that exports such an object under the key `aggregations`.
 * @param {string} [opts.postAggregations] - An object mapping layer names to { field1: fn1, field2: fn2 } objects, where fn1, fn2 are functions that are called on with the aggregated grid square features, and yield property values that will be set on those features, or else the path to a module exporting such an object under the key `postAggregations`.
 * @param {number} opts.minzoom
 * @param {number} [opts.maxzoom] defaults to opts.basezoom
 * @param {number} opts.basezoom
 * @param {number} [opts.gridsize]
 * @param {Function} callback called with (err, finalProgress[], nextLevel[])
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
  } else if (!opts.postAggregations) {
    opts.postAggregations = {}
  }

  opts.minzoom = Math.max(0, opts.minzoom)
  if (typeof opts.maxzoom !== 'number') {
    opts.maxzoom = opts.basezoom
  }
  opts.gridsize = +(opts.gridsize || 1024)
  opts._depth = Math.log2(opts.gridsize) / 2
  if (opts._depth !== (opts._depth | 0)) {
    throw new Error('Gridsize must be a power of 4')
  }

  if (opts.tiles[0][0] !== opts.maxzoom) {
    source = dest
  }

  debug(JSON.stringify(opts))

  // console.log(pyramid.map(function (l) { return l[0][0] + ':' + l.length }))
  buildZoomLevel(dest, source, opts, opts.tiles, callback)
}

function buildZoomLevel (dest, src, options, tilesToBuild, callback) {
  dest.startWriting(function () { setImmediate(next) })

  var zoom = tilesToBuild[0][0]
  var featureCount = 0
  var tileCount = 0

  var tiles = [].concat(tilesToBuild)
  var tilesBuilt = []

  function next (err) {
    if (err) { return callback(err) }
    if (!tiles.length) { return done() }

    tileCount++
    if (options.progress) {
      options.progress(tileCount, featureCount, tiles[0].join('/'))
      featureCount = 0
      tileCount = 0
    }

    var tile = tiles.shift()
    var children = zoom === options.maxzoom
      ? tiletree.getProgeny(tile, options.basezoom)
      : tiletree.getChildren(tile)
    var q = queue()
    children.forEach(function (t) {
      q.defer(readTileFeatures, src, t, options.aggregations)
    })
    q.awaitAll(function (err, tileFeatures) {
      if (err) { return next(err) }
      tileFeatures = tileFeatures.filter(function (f) { return f })
      if (tileFeatures.length) {
        // for each tile, we get a map of layer name -> geojson features
        // so, first, combine these into a single such map
        var featuresByLayer = tileFeatures.reduce(function (memo, layers) {
          for (var l in layers) {
            memo[l] = (memo[l] || []).concat(layers[l])
            featureCount += layers[l].length
          }
          return memo
        }, {})

        tilesBuilt.push(tile)
        writeAggregatedTile(dest, options, tile, featuresByLayer, next)
      } else {
        next()
      }
    })
  }

  function done () {
    if (typeof dest._commit === 'function') {
      dest._commit(postCommit)
    } else {
      setImmediate(postCommit)
    }

    function postCommit (err) {
      if (err) { return callback(err) }
      // we've built a zoom layer of the pyramid we were given. now recurse.
      // Use `dest` as the source too, since after the first level is built, we
      // definitely want to read from dest, not source
      var nextLevel = tiletree.getAncestors(tilesBuilt, zoom - 1)[0]
      if (zoom > options.minzoom) {
        buildZoomLevel(dest, dest, options, nextLevel, callback)
      } else {
        var lastTile = tilesBuilt[tilesBuilt.length - 1]
        callback(null, [tileCount, featureCount, lastTile], nextLevel)
      }
    }
  }
}

function writeAggregatedTile (db, options, tile, featuresByLayer, next) {
  var z = tile[0]

  // for each layer, aggregate whatever data properties were specified in the
  // options
  var aggregatedLayers = {}
  var layerCount = 0
  for (var layer in featuresByLayer) {
    var gridFeatures = aggregateCells(
      featuresByLayer[layer],
      tile,
      z + options._depth,
      options.aggregations[layer],
      options.postAggregations[layer])

    aggregatedLayers[layer] = tileFromFeatureCollection(gridFeatures, tile)
    layerCount++
  }

  // serialize, compress, and save the tile
  if (layerCount) {
    var buff = vtpbf.fromGeojsonVt(aggregatedLayers)
    zlib.gzip(buff, function (err, zipped) {
      if (err) { return next(err) }
      // console.log('putting', tile)
      db.putTile(tile[0], tile[1], tile[2], zipped, next)
    })
  } else {
    next()
  }
}

function readTileFeatures (db, tile, layers, callback) {
  db.getTile(tile[0], tile[1], tile[2], function (err, data) {
    if (err) {
      // there's no good way in tilelive to distinguish between real errors and
      // simply missing tiles, so we're just swallowing this error
      return callback()
    }

    zlib.gunzip(data, function (err, buff) {
      if (err) return callback(err)
      var result = {}
      var vt = new VectorTile(new Pbf(buff))

      for (var layerName in layers) {
        var layer = vt.layers[layerName]
        if (!layer) { continue }

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

