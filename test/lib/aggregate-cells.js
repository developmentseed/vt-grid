var fs = require('fs')
var path = require('path')
var test = require('tap').test
var reducers = require('geojson-polygon-aggregate/reducers')
var tilebelt = require('tilebelt')

var aggregateCells = require('../../lib/aggregate-cells')

test('aggregate cells: raw features', function (t) {
  var input = fs.readFileSync(path.join(__dirname, '../fixture/aggregate-cells.input.geojson'))
  var aggs = {
    'densitypph': reducers.areaWeightedMean('densitypph'),
    'tile': function (memo, feature, _, tile) { return memo || tile.join(',') }
  }
  var postAggs = {}
  var currentTile = [ 9631, 8139, 14 ]
  var gridZoom = 14 + 5 // 4 ^ 5 = 1024
  var result = aggregateCells(JSON.parse(input).features, currentTile, gridZoom, aggs, postAggs)
  t.equal(result.length, 1024)
  var valid = result.filter(function (feat) {
    return feat.properties.densitypph <= 2 && feat.properties.densitypph >= 0
  })
  t.same(result, valid)
  t.same(result[0].properties.tile, '14,9631,8139', 'pass tile coordinates to reducer')
  t.end()
})

test('aggregate cells: grid features', function (t) {
  var raw = fs.readFileSync(path.join(__dirname, '../fixture/aggregate-cells.input.geojson'))
  var aggs = { 'densitypph': reducers.areaWeightedMean('densitypph') }
  var postAggs = {}
  var currentTile = [ 9631, 8139, 14 ]
  var gridZoom = 14 + 5 // 4 ^ 5 = 1024
  // aggregate the raw features into a grid
  var grid = aggregateCells(JSON.parse(raw).features, currentTile, gridZoom, aggs, postAggs)
  // now do it again, with gridzoom being one less, so that we can treat the
  // grid features we just made the 'incoming' features to be aggregated on the
  // same tile
  aggs = {
    'densitypph': reducers.sum('densitypph'),
    'tile': function (memo, feature, _, tile) { return memo || tile.join(',') }
  }
  var result = aggregateCells(grid, [ 9631, 8139, 14 ], gridZoom - 1, aggs, postAggs)
  result.forEach(function (feat) {
    var parentkey = feat.properties._quadKey
    var gridsum = grid.filter(function (child) {
      var parent = tilebelt.getParent(tilebelt.quadkeyToTile(child.properties._quadKey))
      return parentkey === tilebelt.tileToQuadkey(parent)
    })
    .map(function (f) { return f.properties.densitypph || 0 })
    .reduce(function (a, b) { return a + b }, 0)
    t.equal(round(feat.properties.densitypph), round(gridsum), parentkey)
  })
  t.same(result[0].properties.tile, '14,9631,8139', 'pass tile coordinates to reducer')
  t.end()
})

function round (x) {
  return Math.round(x * 1e6) / 1e6
}

