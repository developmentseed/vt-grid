var split = require('split')
var cover = require('tile-cover')
var bboxpoly = require('turf-bbox-polygon')
var tiletree = require('./tile-family')

module.exports = function (source, zoom, callback) {
  // Special case for mbtiles, which can give us an actual list of tiles; much
  // more efficient at high zooms than covering the entire bounds
  if (typeof source.createZXYStream === 'function') {
    var pattern = RegExp('^' + zoom + '\\/')
    var tiles = []
    var stream = source.createZXYStream()
    .pipe(split())

    stream
    .on('data', function (data) {
      data = data.toString()
      if (pattern.test(data)) {
        tiles.push(data.split('/').map(Number))
      }
    })
    .on('end', function () {
      callback(null, tiles)
    })
  } else {
    // This is likely to crash on memory usage at high zooms with large bounds
    source.getInfo(function (err, info) {
      if (err) { return callback(err) }
      var bounds = info.bounds || [-180, -85, 180, 85]
      callback(null, cover.tiles(bboxpoly(bounds).geometry, {
        min_zoom: zoom,
        max_zoom: zoom
      })
      .map(tiletree.toZXY))
    })
  }
}
