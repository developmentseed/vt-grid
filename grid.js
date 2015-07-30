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

module.exports = grid

function grid (source, opts, callback) {
  if (!callback) { callback = function () {} }
  opts.gridsize = +(opts.gridsize || 2)
  buildLevel(source, opts, opts.basezoom - 1, callback)
}

function buildLevel (db, opts, z, callback) {
  if (z < opts.minzoom || z >= opts.basezoom) { return callback() }
  list(db, z + 1, function (err, tiles) {
    if (err) { return callback(err) }
    var parents = tiles.map(getParentTile)
    // remove duplicates
    parents = uniq(parents.map(join).sort()).map(split)
    console.log('Building %s tiles at zoom level %s', parents.length, z)
    aggregateLevel(db, opts, parents, function (err) {
      if (err) { return callback(err) }
      console.log('\nFinished building zoom %s', z)
      buildLevel(db, opts, z - 1, callback)
    })
  })
}

function aggregateLevel (db, options, tiles, callback) {
  db.startWriting(next)

  var count = -1
  var total = tiles.length

  function next (err) {
    if (err) { callback(err) }
    if (!tiles.length) { return done() }

    count++
    if (options.progress) { options.progress(count / total) }

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
  // for each tile, we get a map of layer name -> geojson features
  // so, first, combine these into a single such map
  var featuresByLayer = tileFeatures.reduce(function (memo, layers) {
    for (var l in layers) {
      memo[l] = (memo[l] || []).concat(layers[l])
    }
    return memo
  }, {})

  // now, for each layer, aggregate whatever data properties were specified
  // in the options, and then use geojson-vt to make the result into a
  // vector tile object.
  var aggregatedLayers = {}
  for (var layer in featuresByLayer) {
    var fc = aggregate(
      tileGrid(tile, options.gridsize),
      featuresByLayer[layer],
      options.layers[layer]
    )
    aggregatedLayers[layer] = geojsonvt(fc, { maxZoom: tile[0] })
      .getTile(tile[0], tile[1], tile[2])
  }

  // serialize, compress, and save the tile
  var buff = vtpbf.fromGeojsonVt(aggregatedLayers)
  zlib.gzip(buff, function (err, zipped) {
    if (err) { return next(err) }
    db.putTile(tile[0], tile[1], tile[2], zipped, function (err) {
      if (err) { return next(err) }
      next()
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
  var parent = tilebelt.getParent([tile[1], tile[2], tile[0]])
  parent.unshift(parent.pop())
  return parent
}

function getTileChildren (tile) {
  var parent = [tile[1], tile[2], tile[0]]
  var children = tilebelt.getChildren(parent)
  children.forEach(function (t) { t.unshift(t.pop()) })
  return children
}

function tileGrid (tile, gridsize) {
  tile = [tile[1], tile[2], tile[0]]
  var boxes = rectangleGrid(tilebelt.tileToBBOX(tile), [gridsize, gridsize])
  return boxes.features
}
