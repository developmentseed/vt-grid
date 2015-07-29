#!/usr/bin/env node

var path = require('path')
var MBTiles = require('mbtiles')
var list = require('./list')

var argv = require('yargs')
  .alias('output', 'o')
  .alias('zoom', 'z')
  .demand(['o', 'z'])
  .demand(1)
  .argv

var input = argv._[0]
var output = argv.output
var zoom = argv.zoom

input = path.resolve(process.cwd(), input)
output = path.resolve(process.cwd(), output)

var mbtiles = new MBTiles('mbtiles://' + input, function (err) {
  if (err) { throw err }
  list(mbtiles, zoom, function (err, tiles) {
    if (err) { throw err }
    copy(tiles, function (err) {
      if (err) { throw err }
      console.log('Done.')
    })
  })
})

function copy (tiles, callback) {
  var out = new MBTiles('mbtiles://' + output, function (err) {
    if (err) return callback(err)

    out.startWriting(info)

    function info (err) {
      if (err) { throw err }
      mbtiles.getInfo(function (err, info) {
        if (err) { throw err }
        out.putInfo({ vector_layers: info.vector_layers }, next)
      })
    }

    function next (err) {
      if (err) { console.error(err) }
      if (!tiles.length) { return done() }

      var tile = tiles.shift()
      mbtiles.getTile(tile[0], tile[1], tile[2], function (err, data) {
        if (err) {
          console.error(tile.join('/'))
          return next(err)
        }
        out.putTile(tile[0], tile[1], tile[2], data, next)
      })
    }

    function done () {
      out.stopWriting(function (err) {
        if (err) { return callback(err) }
        callback(null, out)
      })
    }
  })
}
