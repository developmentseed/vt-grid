#!/usr/bin/env node
var path = require('path')
var os = require('os')
var vtGrid = require('./')

var validAggregations = Object.keys(require('geojson-polygon-aggregate'))

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
  .default('jobs', os.cpus().length)
  .describe('jobs', 'The number of concurrent processes to run')
  .boolean('no-progress')
  .describe('no-progress', 'Don\'t show progress bar')
  .help('h')
  .argv

argv.input = 'mbtiles://' + path.resolve(process.cwd(), argv._[0])
argv.layers = {}
argv.fields.forEach(function (field) {
  // layer:func(inField)
  var match = /([^:]+):([^\(]+)\((.*)\)/.exec(field)
  var layer = match[1]
  var fn = match[2]
  var fieldName = match[3]
  if (!argv.layers[layer]) { argv.layers[layer] = {} }
  argv.layers[layer][fieldName] = fn
  if (validAggregations.indexOf(fn) < 0) {
    throw new Error('Unknown aggregation function: ' + fn)
  }
})

vtGrid(argv)
