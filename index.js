
var os = require('os')
var fork = require('child_process').fork
var MBTiles = require('mbtiles')
var xtend = require('xtend')
var ProgressBar = require('progress')
var list = require('./lib/list')
var tf = require('./lib/tile-family')

module.exports = vtGrid

/**
 * Build a pyramid of aggregated square-grid features.
 *
 * @param {Object} opts
 * @param {string} opts.input An 'mbtiles://' uri to the input data
 * @param {string} opts.putput An 'mbtiles://' uri to which to output aggregated data
 * @param {number} opts.basezoom The zoom level at which to find the initial data
 * @param {number} opts.gridsize Number of grid squares per tile
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

  var input
  var output = new MBTiles(opts.output, function (err) {
    if (err) { return done(err) }
    input = new MBTiles(opts.input, function (err) {
      if (err) { return done(err) }
      // WAL mode allows writers not to block readers
      // https://www.sqlite.org/wal.html
      output._db.run('PRAGMA journal_mode=WAL', function (err) {
        if (err) { return done(err) }
        input.getInfo(function (err, info) {
          if (err) { return cleanup(err) }
          if (typeof opts.basezoom !== 'number') {
            opts.basezoom = info.minzoom
          }
          list(input, opts.basezoom, function (err, tiles) {
            if (err) { return cleanup(err) }
            run(tiles)
          })
        })
      })
    })
  })

  var bar

  // Run opts.jobs parallel processes, tracking progress and, once we've
  // reached high enough in the pyramid, drop down the parallelization (see
  // notes below)
  function run (tiles) {
    // levels is an array of arrays of parent tiles, starting with
    // levels[0] = parents of `tiles`.
    var levels = tf.getAncestors(tiles, opts.minzoom)
    var basezoom = tiles[0][0]

    // How far up can we go while keeping a clean separation of minzoom
    // tiles among the different parallel jobs we're running?
    // (they're aggregating, so we don't want different jobs to overlap as
    // they go up the pyramid)
    var depth = -1
    while (depth < levels.length - 1 &&
      levels[depth + 1].length >= opts.jobs) {
      depth++
    }

    // progress bar
    if (!bar && opts.progress) {
      var total = levels.map(function (l) { return l.length })
      total = total.reduce(function (s, level) { return s + level }, 0)
      total += tiles.length
      bar = new ProgressBar([
        '[:bar] :percent',
        'ETA :etas',
        '[:featureavg feats/tile]',
        '[:tileRate tiles/s]',
        '[:jobs jobs]',
        '[ :lastTile ]'
      ].join(' '), { width: 20, total: total })
    }

    // progress callback
    var totalFeatures = 0
    function progress (jobs, tiles, features, lastTile) {
      totalFeatures += features
      var totalTiles = bar.curr + tiles
      var deltaT = (new Date() - bar.start) / 1000
      bar.tick(tiles, {
        jobs: jobs,
        features: features,
        featureavg: totalTiles > 0 ? Math.round(totalFeatures / totalTiles) : 'n/a',
        tileRate: Math.round(100 * totalTiles / deltaT) / 100,
        lastTile: lastTile
      })
    }

    var options = {
      tiles: tiles,
      aggregations: opts.aggregations,
      postAggregations: opts.postAggregations,
      minzoom: basezoom - 1 - depth,
      basezoom: opts.basezoom,
      gridsize: opts.gridsize,
      input: opts.input,
      output: opts.output
    }

    // kick off the workers
    var activeJobs = 0
    for (var i = 0; i < opts.jobs; i++) {
      activeJobs++
      var child = fork(__dirname + '/worker.js')
      child.on('exit', function (e) {
        if (e !== 0) {
          return cleanup(new Error('Worker exited with nonzero status ' + e))
        }

        if (--activeJobs <= 0) {
          if (options.minzoom === opts.minzoom) {
            if (bar) { bar.terminate() }
            return cleanup()
          }

          opts.jobs = Math.max(Math.floor(opts.jobs / 4), 1)
          run(levels[depth])
        }
      })

      if (!opts['no-progress']) {
        child.on('message', function (m) {
          progress.apply(null, [activeJobs].concat(m.progress))
        })
      }

      child.on('error', function (e) {
        activeJobs = 0
        return cleanup(e)
      })

      // start the work by sending options
      child.send(job(options, levels[depth], i, opts.jobs))
    }
  }

  var _cleanedUp = false
  function cleanup (error) {
    if (error) { console.error(error) }
    if (_cleanedUp) { return }
    _cleanedUp = true
    output._db.run('PRAGMA journal_mode=DELETE', function (err) {
      if (err) { return done(err) }
      // if there's a minzoom set in the db, we need to update it, since we've
      // added lower-zoom tiles
      output._db.run('UPDATE metadata SET value=? WHERE name=?', opts.minzoom,
        'minzoom', function (err) {
          if (err) { return done(err) }
          output.stopWriting(function (err) {
            if (err) { return done(err) }
            input.close(function (err) {
              if (err) { return done(err) }
              output.close(done)
            })
          })
        })
    })
  }
}

// set up the options object for a single worker
// important thing here is that we choose a 'batch' (aka a set of ancestor
// tiles), and then filter the tiles processed by this job to be the
// descendants of the batch.  that way, we can go up the pyramid in parallel
// TODO: explain this clearly
function job (baseOptions, batches, index, jobs) {
  function batchFilter (b, i) { return i % jobs === index }
  var tiles
  if (batches) {
    var batch = batches.filter(batchFilter)
    tiles = baseOptions.tiles.filter(tf.hasProgeny(batch))
  } else {
    tiles = baseOptions.tiles.filter(batchFilter)
  }
  return xtend(baseOptions, { tiles: tiles })
}
