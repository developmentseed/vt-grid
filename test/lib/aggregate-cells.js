var fs = require('fs')
var path = require('path')
var test = require('tap').test
var aggregate = require('geojson-polygon-aggregate')
var tilebelt = require('tilebelt')

var aggregateCells = require('../../lib/aggregate-cells')

test('aggregate cells: raw features', function (t) {
  var input = fs.readFileSync(path.join(__dirname, '../fixture/aggregate-cells.input.geojson'))
  var aggs = { 'densitypph': aggregate.areaWeightedMean('densitypph') }
  var postAggs = {}
  var currentTile = [ 14, 9631, 8139 ]
  var gridZoom = 14 + 5 // 4 ^ 5 = 1024
  var result = aggregateCells(JSON.parse(input).features, currentTile, gridZoom, aggs, postAggs)
  t.equal(result.features.length, 1024)
  var valid = result.features.filter(function (feat) {
    return feat.properties.densitypph <= 2 && feat.properties.densitypph >= 0
  })
  t.same(result.features, valid)
  t.end()
})

test('aggregate cells: grid features', function (t) {
  var raw = fs.readFileSync(path.join(__dirname, '../fixture/aggregate-cells.input.geojson'))
  var aggs = { 'densitypph': aggregate.areaWeightedMean('densitypph') }
  var postAggs = {}
  var currentTile = [ 14, 9631, 8139 ]
  var gridZoom = 14 + 5 // 4 ^ 5 = 1024
  // aggregate the raw features into a grid
  var grid = aggregateCells(JSON.parse(raw).features, currentTile, gridZoom, aggs, postAggs)
  // now do it again, with gridzoom being one less, so that we can treat the
  // grid features we just made the 'incoming' features to be aggregated on the
  // same tile
  aggs = { 'densitypph': aggregate.sum('densitypph') }
  var result = aggregateCells(grid.features, [ 14, 9631, 8139 ], gridZoom - 1, aggs, postAggs)
  result.features.forEach(function (feat) {
    var parentkey = feat.properties._quadKey
    var gridsum = grid.features.filter(function (child) {
      var parent = tilebelt.getParent(tilebelt.quadkeyToTile(child.properties._quadKey))
      return parentkey === tilebelt.tileToQuadkey(parent)
    })
    .map(function (f) { return f.properties.densitypph || 0 })
    .reduce(function (a, b) { return a + b }, 0)
    t.equal(round(feat.properties.densitypph), round(gridsum), parentkey)
  })
  t.end()
})

function round (x) {
  return Math.round(x * 1e6) / 1e6
}

