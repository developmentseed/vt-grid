var grid = require('./grid')
var MBTiles = require('mbtiles')
var aggregate = require('geojson-polygon-aggregate')
process.on('message', function (options) {
  options.progress = function workerProgress () {
    process.send({ progress: Array.prototype.slice.call(arguments) })
  }
  // aggregation functions were passed in as names.  look up the actual functions.
  if (typeof options.layers !== 'string') {
    for (var layer in options.layers) {
      for (var field in options.layers[layer]) {
        var fn = aggregate[options.layers[layer][field]]
        options.layers[layer][field] = fn(field)
      }
    }
  }

  var mbtiles = new MBTiles(options.input, function (err) {
    if (err) { throw err }
    // set a busy timeout to avoid SQLITE_BUSY
    mbtiles._db.configure('busyTimeout', 30000)
    grid(mbtiles, options, function (err) {
      if (err) { throw err }
      process.exit()
    })
  })
})
