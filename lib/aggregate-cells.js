'use strict'

var geojsonvt = require('geojson-vt')
var filterDegenerate = require('./degenerate')
var aggregate = require('geojson-polygon-aggregate').all
var tilebelt = require('tilebelt')
var tileUtil = require('./tile-util')
var GeoJSONWrapper = require('./geojson-wrapper')

module.exports = aggregateCells

function aggregateCells (features, tile, gridZoom, aggregations, postAggregations) {
  var boxes
  tile = tileUtil.toZXY(tile)
  if (features && features[0] && features[0].properties._quadKey) {
    boxes = aggregateFromGrid(features, tile, gridZoom, aggregations, postAggregations)
  } else {
    boxes = aggregateFromRaw(features, tile, gridZoom, aggregations, postAggregations)
  }
  return boxes
}

// Aggregate *grid* input data--that is, features that are already themselves
// grid squares from a higher zoom.  Much faster than aggregating raw data, becase
// we don't have to do any clipping.
function aggregateFromGrid (inputFeatures, currentTile, gridZoom, aggregations, postAggregations) {
  var children = {}
  var numfeatures = inputFeatures.length
  for (var i = 0; i < numfeatures; i++) {
    var f = inputFeatures[i]
    var parentcell = tilebelt.getParent(tilebelt.quadkeyToTile(f.properties._quadKey))
    var parentkey = tilebelt.tileToQuadkey(parentcell)
    if (!children[parentkey]) {
      children[parentkey] = []
    }
    children[parentkey].push(f)
  }

  var cells = tileUtil.getProgeny(currentTile, gridZoom)
  var numcells = cells.length
  var boxes = []
  for (var c = 0; c < numcells; c++) {
    var cell = cells[c]
    var cellkey = tilebelt.tileToQuadkey([cell[1], cell[2], cell[0]])
    var features = children[cellkey] || []
    boxes.push(makeCell(cell, features, aggregations, postAggregations, currentTile))
  }

  return boxes
}

// Aggregate "raw" input data, using geojson-vt to slice it up into grid cells
// first.
function aggregateFromRaw (inputFeatures, currentTile, gridZoom, aggregations, postAggregations) {
  var tileIndex = geojsonvt({
    type: 'FeatureCollection',
    features: inputFeatures
  }, {
    maxZoom: gridZoom,
    tolerance: 0,
    buffer: 0,
    indexMaxZoom: gridZoom
  })

  var cells = tileUtil.getProgeny(currentTile, gridZoom)
  var numcells = cells.length
  var boxes = []

  for (var i = 0; i < numcells; i++) {
    var t = tileIndex.getTile.apply(tileIndex, cells[i])
    if (!t) { continue }
    var vt = new GeoJSONWrapper(t.features)
    var features = []
    for (var j = 0; j < vt.length; j++) {
      var feat = vt.feature(j)
        .toGeoJSON(cells[i][1], cells[i][2], cells[i][0])
      features.push(feat)
    }
    boxes.push(makeCell(cells[i], features, aggregations, postAggregations, currentTile))
  }

  return boxes
}

function makeCell (cell, features, aggregations, postAggregations, tile) {
  // filter out features that are exactly on the tile boundary and not
  // properly within the tile
  features = features.filter(filterDegenerate(cell))

  var box = {
    type: 'Feature',
    properties: aggregate(features, aggregations, null, [tile]),
    geometry: tilebelt.tileToGeoJSON(tileUtil.toXYZ(cell))
  }

  if (postAggregations) {
    for (var field in postAggregations) {
      var fn = postAggregations[field]
      box.properties[field] = fn(box, tile)
    }
  }
  box.properties._quadKey = tilebelt.tileToQuadkey(tileUtil.toXYZ(cell))
  return box
}
