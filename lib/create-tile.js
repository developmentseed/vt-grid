var convert = require('geojson-vt/src/convert')
var wrap = require('geojson-vt/src/wrap')
var transform = require('geojson-vt/src/transform')
var clip = require('geojson-vt/src/clip')

var options = {
  extent: 4096,
  buffer: 0
}

module.exports = createSingleTile

function createSingleTile (data, tile) {
  var z = tile[0]
  var x = tile[1]
  var y = tile[2]
  var z2 = 1 << z
  var features = convert(data, options.tolerance / (z2 * options.extent))
  features = wrap(features, options.buffer / options.extent, intersectX)
  tile = createTile(features, z2, x, y)
  var buf = 0.5 * options.buffer / options.extent
  tile.features = clip(tile.features, z2, x - buf, x + 1 + buf, 0, intersectX, tile.min[0], tile.max[0])
  tile.features = clip(tile.features, z2, y - buf, y + 1 + buf, 1, intersectY, tile.min[1], tile.max[1])
  return transform.tile(tile, options.extent)
}

// From https://github.com/mapbox/geojson-vt/blob/master/src/index.js
function intersectX (a, b, x) {
  return [x, (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0]) + a[1], 1]
}
function intersectY (a, b, y) {
  return [(y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) + a[0], y, 1]
}

// Modified from https://github.com/mapbox/geojson-vt/blob/master/src/tile.js
function createTile (features, z2, tx, ty) {
  var tile = {
    features: features,
    source: null,
    x: tx,
    y: ty,
    z2: z2,
    transformed: false,
    min: [2, 1],
    max: [-1, 0]
  }
  for (var i = 0; i < features.length; i++) {
    tile.numFeatures++

    var min = features[i].min
    var max = features[i].max

    if (min[0] < tile.min[0]) tile.min[0] = min[0]
    if (min[1] < tile.min[1]) tile.min[1] = min[1]
    if (max[0] > tile.max[0]) tile.max[0] = max[0]
    if (max[1] > tile.max[1]) tile.max[1] = max[1]
  }
  return tile
}

