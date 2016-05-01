'use strict'

var tilebelt = require('tilebelt')
var tileUtil = require('./tile-util.js')

/**
 * Return a filter that only passes features that have at least one point in
 * the strict interior of the given tile.
 */
module.exports = function (tile) {
  var bbox = tilebelt.tileToBBOX(tileUtil.toXYZ(tile))
  // z0: 360 / 4096 = 0.087 degrees / 'pixel' ~ 2 decimal places
  // divide by an additional 4 for each zoom level
  var precision = 0.087 / Math.pow(4, tile[0])

  function lte (left, right) {
    return left - right <= precision
  }

  return function filterDegenerate (feature) {
    var geom = feature.geometry
    var coords
    if (geom.type === 'Polygon') {
      coords = geom.coordinates[0]
    } else if (geom.type === 'LineString') {
      coords = geom.coordinates
    } else if (geom.type === 'Point') {
      coords = [geom.coordinates]
    } else if (geom.type === 'MultiLineString') {
      coords = [].concat.apply([], geom.coordinates)
    } else if (geom.type === 'MultiPolygon') {
      return geom.coordinates.every(function (rings) {
        return filterDegenerate({ geometry: { type: 'Polygon', coordinates: rings } })
      })
    } else {
      throw new Error('Unknown geometry type: ' + geom.type)
    }

    var left = !coords.every(function (point) { return lte(point[0], bbox[0]) })
    var right = !coords.every(function (point) { return lte(bbox[2], point[0]) })
    var top = !coords.every(function (point) { return lte(point[1], bbox[1]) })
    var bottom = !coords.every(function (point) { return lte(bbox[3], point[1]) })
    var okay = left && right && top && bottom

    return okay
  }
}
