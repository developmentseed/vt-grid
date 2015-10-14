var fs = require('fs')
var path = require('path')
var tmp = require('tmp')
var MBTiles = require('mbtiles')
var tt = require('../lib/tile-family')
var grid = require('../lib/grid')

var basezoom = 10
var gridsize = 1024

var input = 'mbtiles://' + path.resolve('footprints.z10.mbtiles')
var output = 'mbtiles://' + path.resolve(tmp.tmpNameSync({postfix: '.mbtiles'}))

var tiles = fs.readFileSync('tiles.txt', 'utf-8')
  .split('\n')
  .filter(function (f) { return f.trim().length })
  .map(function (m) { return m.trim().split(' ').map(Number) })
  .map(tt.toZXY)

load(input, output, function (err, inp, out) {
  if (err) { throw err }
  grid(out, inp, {
    minzoom: basezoom - 1,
    basezoom: basezoom,
    gridsize: gridsize,
    tiles: tiles,
    aggregations: __dirname + '/aggregations.js',
    postAggregations: __dirname + '/aggregations.js'
  }, function (err, finalProgress, nextTiles) {
    if (err) { throw err }
    console.log('Finished')
  })
})

function load (input, output, callback) {
  var inp = new MBTiles(input, function (err) {
    if (err) return callback(err)
    var out = new MBTiles(output, function (err) {
      if (err) return callback(err)
      callback(null, inp, out)
    })
  })
}

