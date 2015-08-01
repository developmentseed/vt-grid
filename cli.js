#!/usr/bin/env node
var path = require('path')
var MBTiles = require('mbtiles')
var aggregate = require('geojson-polygon-aggregate')
var ProgressBar = require('progress')
var xtend = require('xtend')
var grid = require('./grid')
var list = require('./lib/list')
var tf = require('./lib/tile-family')

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

var input = path.resolve(process.cwd(), argv._[0])

var options = xtend({}, argv)

var mbtiles = new MBTiles('mbtiles://' + input, function (err) {
  if (err) { throw err }
  mbtiles.getInfo(function (err, info) {
    if (err) { throw err }
    if (typeof options.basezoom !== 'number') {
      options.basezoom = info.minzoom
    }
    list(mbtiles, options.basezoom, function (err, tiles) {
      if (err) { throw err }
      options.tiles = tiles

      var total = tf.getAncestors(tiles, options.minzoom)
        .map(function (l) { return l.length })
        .reduce(function (s, level) { return (s || 0) + level })
      console.log('total', total)

      var bar = new ProgressBar(
        '[:bar] :percent ETA :etas [:featureavg feats/tile] [:tileRate tiles/s]', {
        width: 20,
        total: total
      })
      var totalFeatures = 0
      options.progress = function (tiles, features) {
        totalFeatures += features
        var totalTiles = bar.curr
        var deltaT = (new Date() - bar.start) / 1000
        bar.tick(tiles, {
          features: features,
          featureavg: totalTiles > 0 ? Math.round(totalFeatures / totalTiles) : 'n/a',
          tileRate: Math.round(100 * totalTiles / deltaT) / 100
        })
      }

      run(options)
      mbtiles = null
    })
  })
})

function run (options) {
  options.layers = {}
  argv.fields.forEach(function (field) {
    // layer:func(inField)
    var match = /([^:]+):([^\(]+)\((.*)\)/.exec(field)
    var layer = match[1]
    var fn = match[2]
    var fieldName = match[3]
    if (!options.layers[layer]) { options.layers[layer] = {} }
    options.layers[layer][fieldName] = aggregate[fn](fieldName)
  })

  console.log(JSON.stringify(options, 2))

  grid(mbtiles, options, function (err) {
    if (err) { throw err }
    console.log('Finished!')
  })
}
