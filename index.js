
var os = require('os')
var path = require('path')
var fork = require('child_process').fork
var tilelive = require('tilelive')
var xtend = require('xtend')
var waterfall = require('run-waterfall')
var parallel = require('run-parallel')
var series = require('run-series')
var uniq = require('uniq')
var range = require('lodash.range')
var debug = require('debug')('vt-grid:main')
var progress = require('./lib/progress')
var list = require('./lib/list')
var tf = require('./lib/tile-family')

module.exports = vtGrid

/**
 * Build a pyramid of aggregated square-grid features.
 *
 * @param {Object} opts
 * @param {string} opts.input A tilelive uri to the input data
 * @param {Array} [opts.inputTiles] An array of [z, x, y] tile coordinates to start with
 * @param {string} opts.output A tilelive uri to which to output aggregated data
 * @param {number} opts.basezoom The zoom level at which to find the initial data
 * @param {number} opts.gridsize Number of grid squares per tile
 * @param {number} opts.maxzoom Start building the aggregated pyramid at this zoom level.  Defaults to opts.basezoom.
 * @param {number} opts.minzoom Build the aggregated pyramid to this zoom level
 * @param {Object|string} opts.aggregations If an object, then it maps layer names to aggregation objects, which themselves map field names to geojson-polygon-aggregate aggregation function names. Each worker will construct the actual aggregation function from geojson-polygon-aggregate by passing it the field name as an argument.  If a string, then it's the path of a module that exports a layer to aggregation object map (see {@link #grid} for details).
 * @param {string} [opts.postAggregations] - Path to a module mapping layer names to postAggregations objects.  See {@link #grid} for details.
 * @param {number} opts.jobs The number of jobs to try to run in parallel. Note that once the zoom level gets low enough, the degree of parallelization will be reduced.
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

  debug('init', opts)

  tilelive.auto(opts.input)
  tilelive.auto(opts.output)
  waterfall([
    parallel.bind(parallel, [
      tilelive.load.bind(null, opts.input),
      tilelive.load.bind(null, opts.output)
    ]),
    function (results, callback) {
      debug('loaded input and output')
      input = results[0]
      output = results[1]
      input.getInfo(callback)
    },
    function (info, callback) {
      debug('input source metadata', info)
      if (typeof opts.basezoom !== 'number') {
        opts.basezoom = info.minzoom
      }
      callback()
    },
    function (callback) { setJournalMode(output._db, 'WAL', callback) },
    function (callback) {
      if (opts.inputTiles && opts.inputTiles.length) {
        opts.maxzoom = opts.inputTiles[0][0]
        return callback(null, opts.inputTiles)
      }

      list(input, opts.basezoom, callback)
    }
  ], function (err, tiles) {
    if (err) { return cleanup(err) }

    debug('starting level of tiles:', tiles.length)

    // progress bar
    var ancestors = [tiles].concat(tf.getAncestors(tiles, opts.minzoom))

    if (opts.progress) {
      var total = ancestors
        .map(function (l) { return l.length })
        .reduce(function (s, level) { return s + level }, 0)
      updateProgress = progress(total)
    }

    batches = makeBatches(opts, ancestors, opts.jobs)
    run()
  })

  // given a set of tasks (batches), and set of currently running workers (jobs),
  // kick off appropriate number of workers
  function run () {
    var running = Object.keys(jobs).length
    var available = opts.jobs - running
    if (available <= 0) { return }
    if (!batches.length && !running) {
      if (nextLevelTiles.length && nextLevelTiles[0][0] >= opts.minzoom) {
        nextLevelTiles = uniq(nextLevelTiles, function (t1, t2) {
          return t1.join('/') === t2.join('/') ? 0 : 1
        })
        nextLevelTiles = [nextLevelTiles].concat(tf.getAncestors(nextLevelTiles, opts.minzoom))
        batches = makeBatches(opts, nextLevelTiles, opts.jobs)
        nextLevelTiles = []
      } else {
        updateProgress.finish()
        return cleanup(null, nextLevelTiles)
      }
    }

    while (available-- && batches.length) {
      var options = batches.shift()
      start(options, jobs, updateProgress, function (err, next) {
        if (err) { return cleanup(err) }
        if (next && next.length) {
          nextLevelTiles = nextLevelTiles.concat(next)
        }
        run(batches, jobs)
      })
    }
  }

  var _cleanedUp = false
  function cleanup (error, result) {
    if (error) { console.error(error) }
    if (_cleanedUp) { return }
    _cleanedUp = true
    opts.jobs = 0
    debug('cleaning up')
    if (output) {
      series([
        setJournalMode.bind(null, output._db, 'DELETE'),
        output.startWriting.bind(output),
        updateLayerMetadata.bind(null, output, opts),
        output.stopWriting.bind(output),
        function (callback) {
          debug('closing output')
          // if (output.close) { return output.close(callback) }
          callback()
        },
        function (callback) {
          debug('closing input')
          // if (input.close) { return input.close(callback) }
          callback()
        }
      ], function (err) {
        debug('finished', result.length)
        if (err) { return done(err) }
        done(err, result)
      })
    } else {
      done(error, result)
    }
  }
}

// start a single worker
function start (opts, jobs, onProgress, onExit) {
  var nextLevel

  var child = fork(__dirname + '/worker.js')
  jobs[child.pid] = opts

  debug('forked worker', child.pid, xtend(opts, {tiles: opts.tiles.length}))

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
 * Make batches from the given options and list of tiles
 * @private
 * @param opts
 * @param levels
 * @param numBatches
 */
function makeBatches (opts, levels, numBatches) {
  function batchFilter (job) { return function (_, i) { return i % numBatches === job } }
  function nonempty (a) { return a.length }
  var pyramidBatches = levels.map(function (level) {
    return range(numBatches)
      .map(function (b) { return level.filter(batchFilter(b)) })
      .map(function (b) { return levels[0].filter(tf.hasProgeny(b)) })
      .filter(nonempty)
      .map(function (b) {
        return {
          minzoom: level[0][0],
          tiles: b
        }
      })
  })

  // the actual number of batches should be whatever number the base tiles
  // can support
  numBatches = pyramidBatches[0].length

  // filter out pyramid levels that can't support that many batches, and then
  // choose the highest one to make the actual array of batch options
  pyramidBatches = pyramidBatches
    .filter(function (f, i) { return i === 0 || f.length >= numBatches })

  return pyramidBatches[pyramidBatches.length - 1].map(function (batch) {
    return xtend(opts, batch)
  })
}

function updateLayerMetadata (dest, opts, callback) {
  var vectorlayers = []
  var aggregations = opts.aggregations
  if (typeof aggregations === 'string') {
    aggregations = require(path.resolve(aggregations)).aggregations
  }
  for (var layerName in aggregations) {
    var layer = {
      id: layerName,
      description: '',
      fields: {}
    }
    for (var field in aggregations[layerName]) {
      layer.fields[field] = aggregations[layerName][field] + ''
    }
    vectorlayers.push(layer)
  }
  console.log(vectorlayers)
  dest.putInfo({
    vector_layers: vectorlayers,
    minzoom: opts.minzoom
  }, callback)
}

function setJournalMode (db, mode, callback) {
  if (db) {
    db.run('PRAGMA journal_mode=' + mode, callback)
  } else {
    callback()
  }
}

