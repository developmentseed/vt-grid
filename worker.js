var grid = require('./lib/grid')
var tilelive = require('tilelive')
var aggregate = require('geojson-polygon-aggregate')
var throttle = require('lodash.throttle')
var parallel = require('run-parallel')

process.on('message', function (options) {
  options.progress = throttle(function workerProgress () {
    try {
      process.send({ progress: Array.prototype.slice.call(arguments) })
    } catch (e) {
      process.exit(1)
    }
  }, 100)

  // aggregation functions were passed in as names.  look up the actual functions.
  if (typeof options.aggregations !== 'string') {
    for (var layer in options.aggregations) {
      for (var field in options.aggregations[layer]) {
        var fn = aggregate[options.aggregations[layer][field]]
        options.aggregations[layer][field] = fn(field)
      }
    }
  }

  tilelive.auto(options.input)
  tilelive.auto(options.output)
  parallel([
    tilelive.load.bind(null, options.input),
    tilelive.load.bind(null, options.output)
  ], function (err, results) {
    if (err) { throw err }
    var input = results[0]
    var output = results[1]

    if (output._db) {
      // set a busy timeout to avoid SQLITE_BUSY
      output._db.configure('busyTimeout', 30000)
    }

    grid(output, input, options, function (err, finalProgress, nextLevel) {
      if (err) { throw err }
      parallel([
        output.close.bind(output),
        input.close.bind(input)
      ], function (err) {
        if (err) { throw err }
        try {
          process.send({
            progress: finalProgress,
            nextLevel: nextLevel
          })
          process.exit()
        } catch (e) {
          process.exit(1)
        }
      })
    })
  })
})
