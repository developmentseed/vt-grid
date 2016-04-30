var fs = require('fs')
var path = require('path')
var bench = require('./bench')
var aggregate = require('../lib/aggregate')
var readTiles = require('./read-tiles')

var input = 'mbtiles://' + path.join(__dirname, 'data/united_states_of_america.mbtiles')
var tiles = fs.readFileSync(path.join(__dirname, 'data/united_states_of_america.tiles.txt'), 'utf-8')
  .split('\n')
  .slice(0, 10000)

var tileStream = readTiles(input).on('data', runBenchmark)
tiles.forEach(function (tile) {
  tile = tile.split(' ').slice(1)
  tile = [tile[1], tile[2], tile[0]].map(Number)
  tileStream.write(tile)
})

function runBenchmark (tileData) {
  var tile = tileData.tile
  var features = tileData.features
  var data = { data: { layer: { type: 'FeatureCollection', features: features } } }
  var writeData = function () {}

  bench('osm/1024-grid/no-aggregations', function (b, done) {
    aggregate._setup({
      aggregations: { layer: {} },
      gridsize: 1024
    })
    b.start()
    aggregate(data, tile, writeData, done)
  })

  bench('osm/1024-grid/road-length', function (b, done) {
    aggregate._setup({
      aggregations: path.join(__dirname, 'aggregations/osm-roads.js'),
      gridsize: 1024
    })
    b.start()
    aggregate(data, tile, writeData, done)
  })
}

