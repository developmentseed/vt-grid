#!/usr/bin/env node
var path = require('path')
var MBTiles = require('mbtiles')
var aggregate = require('geojson-polygon-aggregate')
var ProgressBar = require('progress')
var grid = require('./grid')

var validAggregations = Object.keys(aggregate)

var argv = require('yargs')
  .usage('$0 data.mbtiles [--minzoom 7] [--basezoom 12] [--gridsize 1024] --fields \'layerName:areaWeightedMean(fieldName)\' \'layerName:count()\'')
  .demand(1)
  .array('fields')
  .demand('fields')
  .describe('fields', 'The aggregations to perform, in the form \'layerName:aggregationFunction(fieldName)\',  aggregationFunction is one of: ' + validAggregations.join(', '))
  .default('minzoom', 1)
  .describe('minzoom', 'The lowest zoom level at which to build the grid.')
  .default('gridsize', 1024)
  .describe('gridsize', 'The number of grid squares per tile. Must be a power of 4.')
  .default('basezoom', 'minzoom of data.mbtiles')
  .describe('basezoom', 'The zoom level *above* which to start building (data should already exist at z-basezoom).')
  .help('h')
  .argv

var input = argv._[0]

input = path.resolve(process.cwd(), input)

var bar
argv.progress = function (tiles, total, features, nextTile) {
  if (!bar || total !== bar.total) {
    bar = new ProgressBar(
      'tile::nextTile [:bar] :percent ETA :etas [:featureavg feats/tile] [:tileRate tiles/s]', {
      width: 20,
      total: total
    })
  }

  bar.update(tiles / total, {
    features: features,
    featureavg: tiles > 0 ? Math.round(features / tiles) : 'n/a',
    nextTile: nextTile.join('/'),
    tileRate: Math.round(100 * 1000 * tiles / (new Date() - bar.start)) / 100
  })
}

var mbtiles = new MBTiles('mbtiles://' + input, function (err) {
  if (err) { throw err }
  mbtiles.getInfo(function (err, info) {
    if (err) { throw err }
    if (typeof argv.basezoom !== 'number') {
      argv.basezoom = info.minzoom
    }
    argv.layers = {}
    argv.fields.forEach(function (field) {
      // layer:func(inField)
      var match = /([^:]+):([^\(]+)\((.*)\)/.exec(field)
      var layer = match[1]
      var fn = match[2]
      var fieldName = match[3]
      if (!argv.layers[layer]) { argv.layers[layer] = {} }
      argv.layers[layer][fieldName] = aggregate[fn](fieldName)
    })

    grid(mbtiles, argv, function (err) {
      bar.terminate()
      if (err) { throw err }
      console.log('Finished!')
    })
  })
})
