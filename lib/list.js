var cover = require('tile-cover')
var bboxpoly = require('turf-bbox-polygon')
var tiletree = require('./tile-family')

module.exports = function (source, zoom, callback) {
  source.getInfo(function (err, info) {
    if (err) { return callback(err) }
    var bounds = info.bounds || [-180, -85, 180, 85]
    callback(null, cover.tiles(bboxpoly(bounds).geometry, {min_zoom: zoom, max_zoom: zoom})
    .map(tiletree.toZXY))
  })
}
