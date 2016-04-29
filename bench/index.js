var fs = require('fs')
var path = require('path')
var tmp = require('tmp')

var vtGrid = require('../')

module.exports = run

var alltiles = fs.readFileSync(path.join(__dirname, '/tiles.txt'), 'utf-8')
  .split('\n')
var gridsize = 1024

/*
 * a task is {limit (num base tiles), properties (num properties) }
 */
function run (task, callback) {
  var input = path.join(__dirname, 'footprints.z10.mbtiles')
  var output = tmp.tmpNameSync({postfix: '.mbtiles'})

  var limit = task.limit
  var tiles = alltiles
  .slice(0, limit)
  .filter(function (f) { return f.trim().length })
  .map(function (m) { return m.trim().split(' ').map(Number) })

  var aggregationsBase = path.join(__dirname, 'aggregations-base.js')
  var aggregationsGrid = path.join(__dirname, 'aggregations-grid.js')

  var start = Date.now()
  vtGrid(output, input, [{
    minzoom: 9,
    basezoom: 10,
    gridsize: gridsize,
    inputTiles: tiles,
    aggregations: aggregationsBase,
    postAggregations: aggregationsBase
  }, {
    minzoom: 1,
    basezoom: 9,
    gridsize: gridsize,
    aggregations: aggregationsGrid,
    postAggregations: aggregationsGrid
  }], function (err, stats) {
    if (err) { throw err }
    var features = 0
    for (var l in stats.features) {
      features += stats.features[l]
    }
    console.log([limit, stats.tiles, features, task.properties, Date.now() - start].join(','))
    callback()
  })
}

if (require.main === module) {
  console.time()
  run({
    limit: +(process.argv[2] || 64),
    properties: process.argv[3] ? +process.argv[3] : null
  }, function (err) {
    if (err) { throw err }
    console.timeEnd()
  })
}
