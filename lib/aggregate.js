var path = require('path')
var reducers = require('geojson-polygon-aggregate/reducers')
var aggregateCells = require('./aggregate-cells')

var options
setup(global.mapOptions)

module.exports = aggregateTile
// for testing/benchmarking use
module.exports._setup = setup

function setup (opts) {
  options = opts
  if (!opts) { return }
  // aggregation functions were passed in as names.  look up the actual functions.
  if (typeof options.aggregations !== 'string') {
    for (var layer in options.aggregations) {
      for (var field in options.aggregations[layer]) {
        var fn = reducers[options.aggregations[layer][field]]
        options.aggregations[layer][field] = fn(field)
      }
    }
  }
  if (typeof options.aggregations === 'string') {
    var mod = path.resolve(process.cwd(), options.aggregations)
    options.aggregations = require(mod).aggregations
  }

  if (typeof options.postAggregations === 'string') {
    mod = path.resolve(process.cwd(), options.postAggregations)
    options.postAggregations = require(mod).postAggregations
  } else if (!options.postAggregations) {
    options.postAggregations = {}
  }

  options._depth = Math.log2(options.gridsize) / 2 - 1
  if (options._depth !== (options._depth | 0)) {
    throw new Error('Gridsize must be a power of 4')
  }

  return options
}

function aggregateTile (data, tile, writeData, done) {
  var counts = {}
  for (var layer in data.data) {
    counts[layer] = data.data[layer].features.length
    var gridFeatures = aggregateCells(
      data.data[layer].features,
      tile,
      tile[2] + options._depth,
      options.aggregations[layer],
      options.postAggregations[layer])

    gridFeatures.forEach(function (feature) {
      feature.properties.layer = layer
      writeData(JSON.stringify(feature) + '\n')
    })
  }
  done(null, { tile: tile, layers: counts })
}

