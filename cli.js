#!/usr/bin/env node
var path = require('path')
var MBTiles = require('mbtiles')
var aggregate = require('geojson-polygon-aggregate')
var multimeter = require('multimeter')
var grid = require('./grid')

var argv = require('yargs')
  .usage('$0 data.mbtiles --minzoom 7 --basezoom 12 --layer census [--gridsize 4] --fields \'density:areaWeightedMean(density)\' \'zones:count()\'')
  .demand(1)
  .default('minzoom', 1)
  .demand('basezoom')
  .demand('layer')
  .array('fields')
  .demand('fields')
  .default('gridsize', 4)
  .describe('basezoom', 'The zoom level *above* which to start building (data should already exist at z-basezoom).')
  .describe('minzoom', 'The lowest zoom level at which to build the grid.')
  .help('h')
  .argv

var input = argv._[0]

input = path.resolve(process.cwd(), input)

var multi = multimeter(process)
multi.drop({ width: 40 }, function (bar) {
  argv.progress = function (p) { bar.percent(100 * p) }
  var mbtiles = new MBTiles('mbtiles://' + input, function (err) {
    if (err) { throw err }
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
      multi.destroy()
      if (err) { throw err }
      console.log('Finished!')
    })
  })

})
