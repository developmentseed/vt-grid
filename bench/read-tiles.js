var zlib = require('zlib')
var Pbf = require('pbf')
var VectorTile = require('vector-tile').VectorTile
var MBTiles = require('mbtiles')
var through = require('through2')

module.exports = function (mbtiles) {
  var db

  return through.obj(write)

  function write (tile, _, next) {
    var self = this
    if (!db) {
      db = new MBTiles(mbtiles, function (err) {
        if (err) { return next(err) }
        writeTile.call(self, tile, next)
      })
    } else {
      writeTile.call(self, tile, next)
    }
  }

  function writeTile (tile, next) {
    var self = this
    var x = tile[0]
    var y = tile[1]
    var z = tile[2]
    db.getTile(z, x, y, function (err, tiledata) {
      if (err) { return next(err) }
      zlib.gunzip(tiledata, function (err, pbfdata) {
        if (err) { return next(err) }
        var vt = new VectorTile(new Pbf(pbfdata))
        var features = []
        for (var l in vt.layers) {
          var layer = vt.layers[l]
          for (var j = 0; j < layer.length; j++) {
            features.push(layer.feature(j).toGeoJSON(x, y, z))
          }
        }
        self.push({ tile: tile, features: features })
        next()
      })
    })
  }
}

