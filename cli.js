#!/usr/bin/env node
var path = require('path')
var os = require('os')
var vtGrid = require('./')

var validAggregations = Object.keys(require('geojson-polygon-aggregate'))

var argv = require('yargs')
  .usage('$0 input.mbtiles output.mbtiles [--minzoom 7] [--basezoom 12] [--gridsize 1024] --aggregations \'layerName:areaWeightedMean(fieldName)\' \'layerName:count()\'')
  .demand(2)
  .array('aggregations')
  .demand('aggregations')
  .describe('aggregations', 'The aggregations to perform, either as a js module (see docs), or in the form \'layerName:aggregationFunction(fieldName)\',  aggregationFunction is one of: ' + validAggregations.join(', '))
  .describe('postAggregations', 'Module exporting post-aggregation functions to apply (see docs for details).')
  .default('minzoom', 1)
  .describe('minzoom', 'The lowest zoom level at which to build the grid.')
  .default('gridsize', 1024)
  .describe('gridsize', 'The number of grid squares per tile. Must be a power of 4.')
  .default('basezoom', 'minzoom of data.mbtiles')
  .describe('basezoom', 'The zoom level at which to start building (initial data should exist at z-basezoom in input.mbtiles).')
  .default('jobs', os.cpus().length)
  .describe('jobs', 'The number of concurrent processes to run')
  .boolean('no-progress')
  .describe('no-progress', 'Don\'t show progress bar')
  .help('h')
  .argv

argv.input = 'mbtiles://' + path.resolve(process.cwd(), argv._[0])
argv.output = 'mbtiles://' + path.resolve(process.cwd(), argv._[1])
if (argv.aggregations.length === 1 && /\.js/.test(argv.aggregations[0])) {
  argv.aggregations = argv.aggregations[0]
} else {
  var aggregations = {}
  argv.aggregations.forEach(function (field) {
    // layer:func(inField)
    var match = /([^:]+):([^\(]+)\((.*)\)/.exec(field)
    var layer = match[1]
    var fn = match[2]
    var fieldName = match[3]
    if (!aggregations[layer]) { aggregations[layer] = {} }
    aggregations[layer][fieldName] = fn
    if (validAggregations.indexOf(fn) < 0) {
      throw new Error('Unknown aggregation function: ' + fn)
    }
  })

  argv.aggregations = aggregations
}

vtGrid(argv)
