var grid = require('./grid')
var MBTiles = require('mbtiles')
process.on('message', function (options) {
  options.progress = function workerProgress () {
    process.send({ progress: Array.prototype.slice.call(arguments) })
  }
  var mbtiles = new MBTiles(options.input, function (err) {
    if (err) { throw err }
    grid(mbtiles, options, function (err) {
      if (err) { throw err }
      process.exit()
    })
  })
})
