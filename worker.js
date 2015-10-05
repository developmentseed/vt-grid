var grid = require('./grid')
var MBTiles = require('mbtiles')
var aggregate = require('geojson-polygon-aggregate')
process.on('message', function (options) {
  options.progress = function workerProgress () {
    process.send({ progress: Array.prototype.slice.call(arguments) })
  }
  // aggregation functions were passed in as names.  look up the actual functions.
  if (typeof options.aggregations !== 'string') {
    for (var layer in options.aggregations) {
      for (var field in options.aggregations[layer]) {
        var fn = aggregate[options.aggregations[layer][field]]
        options.aggregations[layer][field] = fn(field)
      }
    }
  }

  var input = new MBTiles(options.input, function (err) {
    if (err) { throw err }
    var output = new MBTiles(options.output, function (err) {
      if (err) { throw err }
      // set a busy timeout to avoid SQLITE_BUSY
      output._db.configure('busyTimeout', 30000)
      grid(output, input, options, function (err) {
        if (err) { throw err }
        process.exit()
      })
    })
  })
})
