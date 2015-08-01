#!/usr/bin/env node
var path = require('path')
var MBTiles = require('mbtiles')
var aggregate = require('geojson-polygon-aggregate')
var ProgressBar = require('progress')
var grid = require('./grid')

var argv = require('yargs')
  .usage('$0 data.mbtiles --minzoom 7 --basezoom 12 --layer census [--gridsize 4] --fields \'density:areaWeightedMean(density)\' \'zones:count()\'')
  .demand(1)
  .default('minzoom', 1)
  .array('fields')
  .demand('fields')
  .default('gridsize', 1024)
  .describe('basezoom', 'The zoom level *above* which to start building (data should already exist at z-basezoom).')
  .describe('minzoom', 'The lowest zoom level at which to build the grid.')
  .help('h')
  .argv

var input = argv._[0]

input = path.resolve(process.cwd(), input)

var bar
argv.progress = function (tiles, total, features, nextTile) {
  if (!bar || total !== bar.total) {
    bar = new ProgressBar(
      'tile::nextTile [:bar] :percent :elapsed/:etas [:featureavg feats/tile] [:tileRate tiles/min]', {
      width: 20,
      total: total
    })
  }

  bar.update(tiles / total, {
    features: features,
    featureavg: tiles > 0 ? Math.round(features / tiles) : 'n/a',
    nextTile: nextTile.join('/'),
    tileRate: Math.round(100 * 60000 * tiles / (new Date() - bar.start)) / 100
  })
}

var mbtiles = new MBTiles('mbtiles://' + input, function (err) {
  if (err) { throw err }
  mbtiles.getInfo(function (err, info) {
    if (err) { throw err }
    if (!argv.layer) {
      argv.layer = info.vector_layers[0].id
    }
    if (!argv.basezoom) {
      argv.basezoom = info.minzoom
    }
    argv.layers = {}
    argv.layers[argv.layer] = { }
    argv.fields.forEach(function (field) {
      // outField:func(inField)
      var match = /([^:]+):([^\(]+)\((.*)\)/.exec(field)
      var outField = match[1]
      var fn = match[2]
      var inField = match[3]
      argv.layers[argv.layer][outField] = aggregate[fn](inField)
    })

    grid(mbtiles, argv, function (err) {
      bar.terminate()
      if (err) { throw err }
      console.log('Finished!')
    })
  })
})
