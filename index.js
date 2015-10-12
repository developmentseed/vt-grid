
var os = require('os')
var fork = require('child_process').fork
var tilelive = require('tilelive')
var xtend = require('xtend')
var waterfall = require('run-waterfall')
var parallel = require('run-parallel')
var series = require('run-series')
var uniq = require('uniq')
var progress = require('./lib/progress')
var list = require('./lib/list')
var tf = require('./lib/tile-family')

module.exports = vtGrid

/**
 * Build a pyramid of aggregated square-grid features.
 *
 * @param {Object} opts
 * @param {string} opts.input A tilelive uri to the input data
 * @param {string} opts.output A tilelive uri to which to output aggregated data
 * @param {number} opts.basezoom The zoom level at which to find the initial data
 * @param {number} opts.gridsize Number of grid squares per tile
 * @param {number} opts.minzoom Build the aggregated pyramid to this zoom level
 * @param {Object|string} opts.aggregations If an object, then it maps layer names to aggregation objects, which themselves map field names to geojson-polygon-aggregate aggregation function names. Each worker will construct the actual aggregation function from geojson-polygon-aggregate by passing it the field name as an argument.  If a string, then it's the path of a module that exports a layer to aggregation object map (see {@link #grid} for details).
 * @param {string} [opts.postAggregations] - Path to a module mapping layer names to postAggregations objects.  See {@link #grid} for details.
 * @param {number} opts.jobs The number of jobs to try to run in parallel. Note that once the zoom level gets low enough, the degree of parallelization will be reduced.
 * @param {number} opts.batches The number of tiles to process in each batch.
 * @param {boolean} opts.progress Display a progress bar (uses stderr)
 * @param {function} done called with (err) when done
 */
function vtGrid (opts, done) {
  if (!done) {
    done = function (err) { if (err) { throw err } }
  }

  if (!opts.jobs) { opts.jobs = os.cpus().length }
  if (typeof opts.progress === 'undefined') {
    opts.progress = true
  }

  // input & output tilelive sources
  var input
  var output
  // progress bar update function
  var updateProgress
  // current and next task queues (we have two because we want to build one
  // zoom level at a time, and we use the output of, e.g., z10 to determine
  // the list of tiles to build at z9, etc.)
  var batches = []
  var nextLevelTiles = []
  // map of worker pid -> task options
  var jobs = {}

  tilelive.auto(opts.input)
  tilelive.auto(opts.output)
  waterfall([
    parallel.bind(parallel, [
      tilelive.load.bind(null, opts.input),
      tilelive.load.bind(null, opts.output)
    ]),
    function (results, callback) {
      input = results[0]
      output = results[1]
      input.getInfo(callback)
    },
    function (info, callback) {
      if (typeof opts.basezoom !== 'number') {
        opts.basezoom = info.minzoom
      }
      callback()
    },
    function (callback) { setJournalMode(output._db, 'WAL', callback) },
    function (callback) { list(input, opts.basezoom, callback) }
  ], function (err, tiles) {
    if (err) { return cleanup(err) }

    if (opts.jobs > 1 && !opts.batches) {
      opts.batches = tiles.length / opts.jobs
    }

    // progress bar
    if (opts.progress) {
      var total = [tiles].concat(tf.getAncestors(tiles, opts.minzoom))
        .map(function (l) { return l.length })
        .reduce(function (s, level) { return s + level }, 0)
      updateProgress = progress(total)
    }

    batches = makeBatches(opts, tiles, opts.batches)
    run()
  })

  // given a set of tasks (batches), and set of currently running workers (jobs),
  // kick off appropriate number of workers
  function run () {
    var running = Object.keys(jobs).length
    var available = opts.jobs - running
    if (available <= 0) { return }
    if (!batches.length && !running) {
      if (nextLevelTiles.length) {
        batches = makeBatches(opts, nextLevelTiles, opts.batches)
        nextLevelTiles = []
      } else {
        updateProgress.finish()
        return cleanup()
      }
    }

    while (available-- && batches.length) {
      var options = batches.shift()
      start(options, jobs, updateProgress, function (err, next) {
        if (err) { return cleanup(err) }
        if (next && next.length && next[0][0] >= opts.minzoom) {
          nextLevelTiles = nextLevelTiles.concat(next)
        }
        run(batches, jobs)
      })
    }
  }

  var _cleanedUp = false
  function cleanup (error) {
    if (error) { console.error(error) }
    if (_cleanedUp) { return }
    _cleanedUp = true
    if (output) {
      series([
        setJournalMode.bind(null, output._db, 'DELETE'),
        output.startWriting.bind(output),
        updateLayerMetadata.bind(null, output, opts),
        output.stopWriting.bind(output),
        output.close.bind(output),
        input.close.bind(input)
      ], done)
    }
  }
}

// start a single worker
function start (opts, jobs, onProgress, onExit) {
  var nextLevel

  var child = fork(__dirname + '/worker.js')
  jobs[child.pid] = opts

  child.on('exit', function (e) {
    delete jobs[child.pid]
    if (e !== 0) {
      return onExit(new Error('Worker exited with nonzero status ' + e))
    }
    onExit(null, nextLevel)
  })

  child.on('message', function (m) {
    if (m.nextLevel) { nextLevel = m.nextLevel }
    if (m.progress && opts.progress) {
      onProgress.apply(null, [Object.keys(jobs).length].concat(m.progress))
    }
  })

  child.on('error', function (e) { return onExit(e) })

  // start the work by sending options to the worker
  child.send(opts)
}

/**
 * @private
 * @param opts
 * @param tiles
 * @param numBatches
 */
function makeBatches (opts, tiles, numBatches) {
  tiles = uniq(tiles, function (t1, t2) {
    return t1.join('/') === t2.join('/') ? 0 : 1
  })
  var size = Math.ceil(tiles.length / numBatches)
  var batched = []
  for (var i = 0; i < tiles.length; i += size) {
    var batchTiles = tiles.slice(i, i + size)
    var options = xtend(opts, {
      tiles: batchTiles,
      minzoom: tiles[0][0]
    })
    batched.push(options)
  }
  return batched
}

function updateLayerMetadata (dest, opts, callback) {
  var vectorlayers = []
  for (var layerName in opts.aggregations) {
    var layer = {
      id: layerName,
      description: '',
      fields: {}
    }
    for (var field in opts.aggregations[layerName]) {
      layer.fields[field] = opts.aggregations[layerName][field] + ''
    }
    vectorlayers.push(layer)
  }
  dest.putInfo({
    vector_layers: vectorlayers,
    minzoom: opts.minzoom
  }, callback)
}

function setJournalMode (db, mode, callback) {
  if (db) {
    db.run('PRAGMA journal_mode=' + mode, callback)
  }
}

