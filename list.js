var lines = require('split')

module.exports = function (mbtiles, zoom, callback) {
  var tiles = []
  mbtiles.createZXYStream()
  .pipe(lines())
  .on('data', function (data) {
    data = data.toString()
    if (RegExp('^' + zoom + '\\/').test(data)) {
      tiles.push(data.split('/').map(Number))
    }
  })
  .on('end', function () {
    callback(null, tiles)
  })
}
