var fs = require('fs')
var path = require('path')
var tmp = require('tmp')
var MBTiles = require('mbtiles')

var tt = require('../lib/tile-family')
var aggsBase = require('./aggregations-base')
var aggsGrid = require('./aggregations-grid')
var grid = require('../lib/grid')

module.exports = run

var allproperties = Object.keys(aggsBase.aggregations.footprints)
var alltiles = fs.readFileSync('tiles.txt', 'utf-8')
  .split('\n')
var gridsize = 1024

/*
 * a task is {limit (num base tiles), properties (num properties) }
 */
function run (task, callback) {
  var input = 'mbtiles://' + path.resolve('footprints.z10.mbtiles')
  var output = 'mbtiles://' + path.resolve(tmp.tmpNameSync({postfix: '.mbtiles'}))

  var baseaggs
  var basepostAggs
  var gridaggs
  var gridpostAggs
  if (typeof task.properties === 'number') {
    var keys = allproperties.slice(0, task.properties)
    baseaggs = { footprints: {} }
    basepostAggs = { footprints: {} }
    gridaggs = { footprints: {} }
    gridpostAggs = { footprints: {} }
    keys.forEach(function (k) {
      baseaggs.footprints[k] = aggsBase.aggregations.footprints[k]
      basepostAggs.footprints[k + '_count'] = aggsBase.postAggregations.footprints[k + '_count']
      gridaggs.footprints[k] = aggsGrid.aggregations.footprints[k]
      gridpostAggs.footprints[k] = aggsGrid.postAggregations.footprints[k]
    })
  } else {
    task.properties = allproperties.length
    baseaggs = aggsBase.aggregations
    basepostAggs = aggsBase.postAggregations
    gridaggs = aggsGrid.aggregations
    gridpostAggs = aggsGrid.postAggregations
  }

  var limit = task.limit
  var tiles = alltiles
  .slice(0, limit)
  .filter(function (f) { return f.trim().length })
  .map(function (m) { return m.trim().split(' ').map(Number) })
  .map(tt.toZXY)

  task.stats = {
    tiles: 0,
    features: 0
  }
  function progress (tiles, features, tile) {
    task.stats.tiles += tiles
    task.stats.features += features
  }

  load(input, output, function (err, inp, out) {
    if (err) { throw err }
    var start = Date.now()
    grid(out, inp, {
      minzoom: 9,
      basezoom: 10,
      gridsize: gridsize,
      tiles: tiles,
      aggregations: baseaggs,
      postAggregations: basepostAggs,
      progress: progress
    }, function (err, _, nextTiles) {
      if (err) { throw err }
      grid(out, inp, {
        minzoom: 1,
        basezoom: 9,
        gridsize: gridsize,
        tiles: nextTiles,
        aggregations: gridaggs,
        postAggregations: gridpostAggs,
        progress: progress
      }, function (err, finalProgress, nextTiles) {
        if (err) { throw err }
        console.log([limit, task.stats.tiles, task.stats.features, task.properties, Date.now() - start].join(','))
        callback()
      })
    })
  })
}

function load (input, output, callback) {
  var inp = new MBTiles(input, function (err) {
    if (err) return callback(err)
    var out = new MBTiles(output, function (err) {
      if (err) return callback(err)
      callback(null, inp, out)
    })
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
