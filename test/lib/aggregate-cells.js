var fs = require('fs')
var path = require('path')
var test = require('tap').test
var aggregate = require('geojson-polygon-aggregate')

var aggregateCells = require('../../lib/aggregate-cells')

test('aggregate cells', function (t) {
  var input = fs.readFileSync(path.join(__dirname, '../fixture/aggregate-cells.input.geojson'))
  var aggs = { 'densitypph': aggregate.areaWeightedMean('densitypph') }
  var postAggs = {}
  var currentTile = [ 14, 9631, 8139 ]
  var gridZoom = 14 + 5 // 4 ^ 5 = 1024
  var result = aggregateCells(JSON.parse(input).features, currentTile, gridZoom, aggs, postAggs)
  t.equal(result.features.length, 1024)
  result.features.forEach(function (feat) {
    t.ok(feat.properties.densitypph <= 2)
    t.ok(feat.properties.densitypph >= 0)
  })
  t.end()
})
