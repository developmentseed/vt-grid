var fs = require('fs')
var path = require('path')
var tmp = require('tmp')
var MBTiles = require('mbtiles')
var range = require('lodash.range')
var series = require('run-series')

var tt = require('../lib/tile-family')
var grid = require('../lib/grid')
var aggregations = require('./aggregations')

var gridsize = 1024

var alltiles = fs.readFileSync('tiles.txt', 'utf-8')
  .split('\n')

var allproperties = Object.keys(aggregations.aggregations.footprints)

var tasks = range(1, 9).map(function (lim) {
  lim = Math.pow(2, lim)
  return range(0, 30, 5).map(function (m) {
    var keys = allproperties.slice(0, m)
    var aggs = {}
    var postAggs = {}
    keys.forEach(function (k) {
      aggs[k] = aggregations.aggregations.footprints[k]
      postAggs[k + '_count'] = aggregations.postAggregations.footprints[k + '_count']
    })
    return {
      limit: lim,
      properties: m,
      aggregations: { footprints: aggs },
      postAggregations: { footprints: postAggs }
    }
  })
})
.reduce(function (memo, arr) { return memo.concat(arr) }, [])

series(tasks.map(function (task) { return run.bind(null, task) }))

console.log('basezoom_tiles,tiles_built,features_built,properties,time')
function run (task, callback) {
  var input = 'mbtiles://' + path.resolve('footprints.z10.mbtiles')
  var output = 'mbtiles://' + path.resolve(tmp.tmpNameSync({postfix: '.mbtiles'}))

  var limit = task.limit

  var tiles = alltiles
  .slice(0, limit)
  .filter(function (f) { return f.trim().length })
  .map(function (m) { return m.trim().split(' ').map(Number) })
  .map(tt.toZXY)

  // console.log(output)

  load(input, output, function (err, inp, out) {
    if (err) { throw err }
    var start = Date.now()
    grid(out, inp, {
      minzoom: 9,
      basezoom: 10,
      gridsize: gridsize,
      tiles: tiles,
      aggregations: task.aggregations,
      postAggregations: task.postAggregations
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

