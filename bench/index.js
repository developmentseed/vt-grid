var fs = require('fs')
var path = require('path')
var tmp = require('tmp')
var MBTiles = require('mbtiles')

var tt = require('../lib/tile-family')
var aggregations = require('./aggregations')
var grid = require('../lib/grid')

module.exports = run

var allproperties = Object.keys(aggregations.aggregations.footprints)
var alltiles = fs.readFileSync('tiles.txt', 'utf-8')
  .split('\n')
var gridsize = 1024

/*
 * a task is {limit (num base tiles), properties (num properties) }
 */
function run (task, callback) {
  var input = 'mbtiles://' + path.resolve('footprints.z10.mbtiles')
  var output = 'mbtiles://' + path.resolve(tmp.tmpNameSync({postfix: '.mbtiles'}))

  var aggs
  var postAggs
  if (typeof task.properties === 'number') {
    var keys = allproperties.slice(0, task.properties)
    aggs = { footprints: {} }
    postAggs = { footprints: {} }
    keys.forEach(function (k) {
      aggs.footprints[k] = aggregations.aggregations.footprints[k]
      postAggs.footprints[k + '_count'] = aggregations.postAggregations.footprints[k + '_count']
    })
  } else {
    task.properties = allproperties.length
    aggs = aggregations.aggregations
    postAggs = aggregations.postAggregations
  }

  var limit = task.limit
  var tiles = alltiles
  .slice(0, limit)
  .filter(function (f) { return f.trim().length })
  .map(function (m) { return m.trim().split(' ').map(Number) })
  .map(tt.toZXY)

  load(input, output, function (err, inp, out) {
    if (err) { throw err }
    var start = Date.now()
    grid(out, inp, {
      minzoom: 9,
      basezoom: 10,
      gridsize: gridsize,
      tiles: tiles,
      aggregations: aggs,
      postAggregations: postAggs
    }, function (err, finalProgress, nextTiles) {
      if (err) { throw err }
      console.log([limit, finalProgress[0], finalProgress[1], task.properties, Date.now() - start].join(','))
      callback()
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
