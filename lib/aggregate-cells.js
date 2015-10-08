var geojsonvt = require('geojson-vt')
var filterDegenerate = require('./degenerate')
var aggregate = require('geojson-polygon-aggregate')
var tilebelt = require('tilebelt')
var tiletree = require('./tile-family')
var GeoJSONWrapper = require('./geojson-wrapper')

module.exports = aggregateCells

function aggregateCells (inputFeatures, currentTile, gridZoom, aggregations, postAggregations) {
  var tileIndex = geojsonvt({
    type: 'FeatureCollection',
    features: inputFeatures
  }, {
    maxZoom: gridZoom,
    tolerance: 0,
    buffer: 0,
    indexMaxZoom: gridZoom
  })

  var cellTiles = tiletree.getProgeny(currentTile, gridZoom)
  var boxes = []

  for (var i = 0; i < cellTiles.length; i++) {
    var t = tileIndex.getTile.apply(tileIndex, cellTiles[i])
    if (!t) { continue }

    var vt = new GeoJSONWrapper(t.features)
    var features = new Array(vt.length)
    for (var j = 0; j < vt.length; j++) {
      var feat = vt.feature(j)
      features[j] = feat.toGeoJSON.apply(feat, tiletree.toXYZ(cellTiles[i]))
    }

    // filter out features that are exactly on the tile boundary and not
    // properly within the tile
    features = features.filter(filterDegenerate(cellTiles[i]))

    var box = {
      type: 'Feature',
      properties: aggregate(features, aggregations),
      geometry: tilebelt.tileToGeoJSON(tiletree.toXYZ(cellTiles[i]))
    }

    if (postAggregations) {
      for (var field in postAggregations) {
        var fn = postAggregations[field]
        box.properties[field] = fn(box)
      }
    }

    box.properties._quadKey = tilebelt.tileToQuadkey(tiletree.toXYZ(cellTiles[i]))
    boxes.push(box)
  }

  return {
    type: 'FeatureCollection',
    features: boxes
  }
}
