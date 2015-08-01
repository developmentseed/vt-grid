#!/usr/bin/env node
var os = require('os')
var path = require('path')
var fork = require('child_process').fork
var MBTiles = require('mbtiles')
var aggregate = require('geojson-polygon-aggregate')
var ProgressBar = require('progress')
var xtend = require('xtend')
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
  .default('jobs', os.cpus().length)
  .describe('jobs', 'The number of concurrent processes to run')
  .help('h')
  .argv

var input = 'mbtiles://' + path.resolve(process.cwd(), argv._[0])
var layers = {}
argv.fields.forEach(function (field) {
  // layer:func(inField)
  var match = /([^:]+):([^\(]+)\((.*)\)/.exec(field)
  var layer = match[1]
  var fn = match[2]
  var fieldName = match[3]
  if (!layers[layer]) { layers[layer] = {} }
  layers[layer][fieldName] = aggregate[fn](fieldName)
})

var mbtiles = new MBTiles(input, function (err) {
  if (err) { throw err }
  mbtiles.getInfo(function (err, info) {
    if (err) { throw err }
    if (typeof argv.basezoom !== 'number') {
      argv.basezoom = info.minzoom
    }
    list(mbtiles, argv.basezoom, function (err, tiles) {
      if (err) { throw err }
      run(tiles)
      mbtiles = null
    })
  })
})

var bar
// Run argv.jobs parallel processes, tracking progress and, once we've
// reached high enough in the pyramid, drop down the parallelization (see
// notes below)
function run (tiles) {
  // ancestors is an array of arrays of parent tiles, starting with
  // ancestors[0] = parents of `tiles`.
  var ancestors = tf.getAncestors(tiles, argv.minzoom)
  var basezoom = tiles[0][0]

  // How far up can we go while keeping a clean separation of minzoom
  // tiles among the different parallel jobs we're running?
  // (they're aggregating, so we don't want different jobs to overlap as
  // they go up the pyramid)
  var serial = -1
  while (serial < ancestors.length - 1 &&
    ancestors[serial + 1].length >= argv.jobs) {
    serial++
  }

  var options = {
    tiles: tiles,
    layers: layers,
    minzoom: basezoom - 1 - serial,
    gridsize: argv.gridsize,
    input: input
  }

  // progress bar
  if (!bar) {
    var total = ancestors.map(function (l) { return l.length })
      .reduce(function (s, level) { return (s || 0) + level })
    bar = new ProgressBar([
        '[:bar] :percent',
        'ETA :etas',
        '[:featureavg feats/tile]',
        '[:tileRate tiles/s]',
        '[:jobs jobs]'
      ].join(' '), { width: 20, total: total })
  }

  // progress callback
  var totalFeatures = 0
  function progress (jobs, tiles, features) {
    totalFeatures += features
    var totalTiles = bar.curr
    var deltaT = (new Date() - bar.start) / 1000
    bar.tick(tiles, {
      jobs: jobs,
      features: features,
      featureavg: totalTiles > 0 ? Math.round(totalFeatures / totalTiles) : 'n/a',
      tileRate: Math.round(100 * totalTiles / deltaT) / 100
    })
  }

  var activeJobs = 0
  for (var i = 0; i < argv.jobs; i++) {
    activeJobs++
    var child = fork(__dirname + '/worker.js')
    child.on('exit', function (e) {
      if (e !== 0) {
        throw new Error('Worker exited with nonzero status ' + e)
      }

      if (--activeJobs === 0) {
        if (options.minzoom === argv.minzoom) {
          console.log('Finished!')
          bar.terminate()
          process.exit()
        }
        argv.jobs = Math.max(Math.floor(argv.jobs / 4), 1)
        run(ancestors[serial])
      }
    })
    child.on('message', function (m) {
      progress.apply(null, [activeJobs].concat(m.progress))
    })
    child.on('error', function (e) { throw e })
    child.send(job(options, ancestors[serial], i, argv.jobs))
  }
}

function job (baseOptions, batches, index, jobs) {
  var batch = batches.filter(function (b, i) { return i % jobs === index })
  var tiles = baseOptions.tiles.filter(tf.hasProgeny.bind(null, batch))
  return xtend(baseOptions, { tiles: tiles })
}
