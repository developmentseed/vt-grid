
var fs = require('fs')
var os = require('os')
var spawn = require('child_process').spawn
var path = require('path')
var tmp = require('tmp')
var MBTiles = require('mbtiles')
var tileReduce = require('tile-reduce')
var log = require('single-line-log').stderr

tmp.setGracefulCleanup()

module.exports = vtGrid

/**
 * Build a pyramid of aggregated square-grid features.
 *
 * @param {string} output Path to output aggregated mbtiles data
 * @param {string} input Path to the input mbtiles data
 * @param {Object|Array} options Options OR an array of options objects to allow different aggregations/settings for different zoom levels
 * @param {number} options.basezoom The zoom level at which to find the initial data
 * @param {Array} [options.inputTiles] An array of [z, x, y] tile coordinates to start with
 * @param {number} options.gridsize Number of grid squares per tile
 * @param {Object|string} options.aggregations If an object, then it maps layer names to aggregation objects, which themselves map field names to geojson-polygon-aggregate aggregation function names. Each worker will construct the actual aggregation function from geojson-polygon-aggregate by passing it the field name as an argument.  If a string, then it's the path of a module that exports a layer to aggregation object map (see {@link #grid} for details).
 * @param {string} [options.postAggregations] - Path to a module mapping layer names to postAggregations objects.  See {@link #grid} for details.
 * @param {number} options.jobs The number of jobs to run in parallel.
 * @param {boolean} [options.quiet=false] Disable log output
 * @param {function} callback called with (err) when done
 */
function vtGrid (output, input, options, callback) {
  // allow an array of options, each defining different parts of the pyramid,
  // to allow different aggregations at different parts (often needed for
  // setting up the first aggregation layer)
  var optionStack = Array.isArray(options) ? options : [options]
  optionStack = optionStack.map(function (o) {
    return Object.assign({
      jobs: os.cpus().length,
      basezoom: Infinity
    }, o)
  })
  .sort(function (a, b) { return b.basezoom - a.basezoom })
  // check that the zoom levels covered by each set of options make sense
  optionStack.forEach(function (o, i) {
    if (i > 0 && o.basezoom !== optionStack[i - 1].minzoom) {
      throw new Error('Basezoom of each option set must match minzoom of previous set.')
    }
  })

  var stats = { tiles: 0, zoomLevels: {}, layers: {} }
  var currentOptions = optionStack.shift()
  var currentState = '' // aggregating | tiling
  var currentZoom
  var zoomLevelFiles = [input]

  var timer = setInterval(logProgress, 100)

  function done (err, data) {
    logProgress(true)
    clearInterval(timer)
    if (callback) { callback(err, data) }
  }

  getInfo(input, function (err, info) {
    if (err) { return done(err) }
    if (isNaN(currentOptions.basezoom) || currentOptions.basezoom === Infinity) {
      currentOptions.basezoom = info.minzoom
    }
    currentZoom = currentOptions.basezoom - 1

    // Hack: just use the first layer name from the source data
    // Upstream issue in tippecanoe will allow removing this hack
    // https://github.com/mapbox/tippecanoe/issues/188
    if (!currentOptions.layer) { currentOptions.layer = info.vector_layers[0].id }
    optionStack.forEach(function (o) { o.layer = o.layer || currentOptions.layer })

    tmp.dir({unsafeCleanup: true}, function (err, tmpdir) {
      if (err) { return done(err) }
      buildZoomLevel(tmpdir, input)
    })
  })

  function buildZoomLevel (tmpdir, input) {
    var outputTiles = path.join(tmpdir, 'z' + currentZoom + '.mbtiles')
    var outputGeojson = path.join(tmpdir, 'z' + currentZoom + '.json')
    var outputStream = fs.createWriteStream(outputGeojson)

    var tileReduceOptions = {
      map: path.join(__dirname, 'lib/aggregate.js'),
      sources: [{ name: 'data', mbtiles: input }],
      zoom: currentZoom + 1,
      maxWorkers: currentOptions.jobs,
      mapOptions: currentOptions,
      output: outputStream,
      log: false
    }

    if (currentOptions.inputTiles) {
      tileReduceOptions.tiles = currentOptions.inputTiles
    } else {
      tileReduceOptions.sourceCover = 'data'
    }

    stats.zoomLevels[currentZoom] = { features: 0, tiles: 0 }
    currentState = 'aggregating'

    tileReduce(tileReduceOptions)
    .on('reduce', function (data) {
      stats.tiles++
      stats.zoomLevels[currentZoom].tiles++
      for (var k in data.layers) {
        stats.zoomLevels[currentZoom].features += data.layers[k]
        stats.layers[k] = (stats.layers[k] || 0) + data.layers[k]
      }
    })
    .on('end', function () {
      outputStream.end()

      if (!currentOptions.quiet) {
        logProgress()
        process.stderr.write('\n')
      }
      currentState = 'tiling'

      tippecanoe(outputTiles, currentOptions.layer, outputGeojson, currentZoom)
      .on('exit', function (code) {
        if (code > 0) {
          return done(new Error('Tippecanoe exited nonzero: ' + code))
        }

        zoomLevelFiles.push(outputTiles)
        if (--currentZoom < currentOptions.minzoom) {
          currentOptions = optionStack.shift()
        }
        if (currentOptions) {
          buildZoomLevel(tmpdir, outputTiles)
        } else {
          mergeZoomLevels()
        }
      })
    })
  }

  function mergeZoomLevels () {
    spawn('tile-join', [ '-o', output ].concat(zoomLevelFiles), { stdio: 'inherit' })
    .on('exit', function (code) {
      if (code) {
        return done(new Error('tile-join exited nonzero: ' + code))
      } else {
        return done(null, stats)
      }
    })
  }

  function logProgress (finished) {
    if (!currentOptions || currentOptions.quiet) { return }
    if (currentState === 'aggregating') {
      log('Aggregating z' + (currentZoom + 1) + ', processed ' +
          stats.zoomLevels[currentZoom].features + ' features in ' +
          stats.zoomLevels[currentZoom].tiles + ' tiles.')
    } else if (currentState === 'tiling') {
      log('Writing z' + currentZoom + ' tiles.')
    }
    if (finished) { log.clear() }
  }
}

function tippecanoe (tiles, layerName, data, zoom) {
  return spawn('tippecanoe', [
    '-f',
    '-l', layerName,
    '-o', tiles,
    '-z', zoom,
    '-Z', zoom,
    '-q',
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

