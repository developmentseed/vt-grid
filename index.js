
var fs = require('fs')
var os = require('os')
var spawn = require('child_process').spawn
var path = require('path')
var tmp = require('tmp')
var MBTiles = require('mbtiles')
var tileReduce = require('tile-reduce')

tmp.setGracefulCleanup()

module.exports = vtGrid

/**
 * Build a pyramid of aggregated square-grid features.
 *
 * @param {string} output Path to output aggregated mbtiles data
 * @param {string} input Path to the input mbtiles data
 * @param {Object|Array} opts Options OR an array of options objects to allow different aggregations/settings for different zoom levels
 * @param {number} opts.basezoom The zoom level at which to find the initial data
 * @param {Array} [opts.inputTiles] An array of [z, x, y] tile coordinates to start with
 * @param {number} opts.gridsize Number of grid squares per tile
 * @param {Object|string} opts.aggregations If an object, then it maps layer names to aggregation objects, which themselves map field names to geojson-polygon-aggregate aggregation function names. Each worker will construct the actual aggregation function from geojson-polygon-aggregate by passing it the field name as an argument.  If a string, then it's the path of a module that exports a layer to aggregation object map (see {@link #grid} for details).
 * @param {string} [opts.postAggregations] - Path to a module mapping layer names to postAggregations objects.  See {@link #grid} for details.
 * @param {number} opts.jobs The number of jobs to run in parallel.
 * @param {function} done called with (err) when done
 */
function vtGrid (output, input, opts, done) {
  if (!done) { done = function (err) { if (err) { throw err } } }

  tmp.dir({unsafeCleanup: true}, function (err, tmpdir) {
    if (err) { return done(err) }

    var stats = { tiles: 0, features: {} }

    // allow an array of options, each defining different parts of the pyramid,
    // to allow different aggregations at different parts (often needed for
    // setting up the first aggregation layer)
    var optionStack = Array.isArray(opts) ? opts : [opts]
    optionStack = optionStack.map(function (o) {
      return Object.assign({
        jobs: os.cpus().length,
        basezoom: Infinity,
        _stats: stats
      }, o)
    })
    .sort(function (a, b) { return b.basezoom - a.basezoom })

    optionStack.forEach(function (o, i) {
      if (i > 0 && o.basezoom !== opts[i - 1].minzoom) {
        throw new Error('Basezoom of each option set must match minzoom of previous set.')
      }
    })

    getInfo(input, function (err, info) {
      if (err) { return done(err) }
      var opts = optionStack.shift()
      if (opts.basezoom === Infinity) { opts.basezoom = info.minzoom }

      // Hack: just use the first layer name from the source data
      // Upstream issue in tippecanoe will allow removing this hack
      // https://github.com/mapbox/tippecanoe/issues/188
      if (!opts.layer) { opts.layer = info.vector_layers[0].id }
      optionStack.forEach(function (o) { o.layer = o.layer || opts.layer })

      var zoom = opts.basezoom - 1
      var zoomLevelFiles = [input]
      buildZoomLevel(tmpdir, input, zoom, opts, next)

      function next (err, tiles) {
        if (err) { return done(err) }
        zoomLevelFiles.push(tiles)
        if (--zoom < opts.minzoom) { opts = optionStack.shift() }
        if (opts) {
          input = path.join(tmpdir, 'z' + (zoom + 1) + '.mbtiles')
          buildZoomLevel(tmpdir, input, zoom, opts, next)
        } else {
          mergeZoomLevels(output, zoomLevelFiles, function (err) {
            done(err, stats)
          })
        }
      }
    })
  })
}

function buildZoomLevel (tmpdir, input, zoom, opts, cb) {
  var outputTiles = path.join(tmpdir, 'z' + zoom + '.mbtiles')
  var outputGeojson = path.join(tmpdir, 'z' + zoom + '.json')
  var outputStream = fs.createWriteStream(outputGeojson)

  var tileReduceOptions = {
    map: path.join(__dirname, 'lib/aggregate.js'),
    sources: [{ name: 'data', mbtiles: input }],
    zoom: zoom + 1,
    maxWorkers: opts.jobs,
    mapOptions: opts,
    output: outputStream
  }

  if (opts.inputTiles) {
    tileReduceOptions.tiles = opts.inputTiles
  } else {
    tileReduceOptions.sourceCover = 'data'
  }

  tileReduce(tileReduceOptions)
  .on('reduce', function (data) {
    if (!opts._stats) { return }
    opts._stats.tiles++
    for (var k in data) {
      opts._stats.features[k] = (opts._stats.features[k] || 0) + data[k]
    }
  })
  .on('end', function () {
    outputStream.end()
    tippecanoe(outputTiles, opts.layer, outputGeojson, zoom)
    .on('exit', function (code) {
      if (code) { return cb(new Error('Tippecanoe exited nonzero: ' + code)) }
      cb(null, outputTiles)
    })
  })
}

function mergeZoomLevels (output, levels, cb) {
  spawn('tile-join', [ '-o', output ].concat(levels), { stdio: 'inherit' })
  .on('exit', function (code) {
    if (code) {
      return cb(new Error('tile-join exited nonzero: ' + code))
    } else {
      return cb()
    }
  })
}

function tippecanoe (tiles, layerName, data, zoom) {
  return spawn('tippecanoe', [
    '-f',
    '-l', layerName,
    '-o', tiles,
    '-z', zoom,
    '-Z', zoom,
    '-b', 0,
    data
  ], { stdio: 'inherit' })
}

function getInfo (input, cb) {
  var db = new MBTiles(input, function (err) {
    if (err) { return cb(err) }
    db.getInfo(cb)
  })
}

