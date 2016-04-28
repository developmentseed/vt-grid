var fs = require('fs-extra')
var path = require('path')
var test = require('tap').test
var tmp = require('tmp')
var vtgeojson = require('vt-geojson')
var MBTiles = require('mbtiles')
var vtgrid = require('../')
var tilebelt = require('tilebelt')

test('main module', function (t) {
  tmp.file({postfix: '.mbtiles'}, function (err, output) {
    t.error(err)
    vtgrid(path.resolve(output), path.resolve(__dirname, 'fixture', 'dc.mbtiles'), {
      minzoom: 12,
      gridsize: 64,
      jobs: 1,
      aggregations: {
        'dc': {
          'data': 'sum'
        }
      }
    }, function (err) {
      t.error(err)

      var expected = fs.readFileSync(path.join(__dirname, '/fixture/dc.z12-grid-quadkeys.txt'), 'utf-8')
        .split('\n')
        .filter(Boolean)

      var results = {}
      vtgeojson('mbtiles://' + output, {
        minzoom: 12,
        maxzoom: 12,
        bounds: JSON.parse(fs.readFileSync(path.join(__dirname, '/fixture/dc.geojson')))
      })
      .on('data', function (feature) {
        results[feature.properties._quadKey] = feature.properties.data
      })
      .on('end', function () {
        expected.forEach(function (key) {
          var tile = tilebelt.quadkeyToTile(key)
          t.ok(results[key] > 0, results[key] + ' > 0 for tile ' + tile)
          delete results[key]
        })

        for (var key in results) {
          t.ok(results[key] === 0 || !results[key], 'no value for tile ' + key)
        }

        getInfo(output, function (err, info) {
          t.error(err)
          t.ok(info.vector_layers && info.vector_layers[0], 'vector_layers')
          t.same(info.vector_layers[0].id, 'dc', 'layer id')
          t.ok(info.vector_layers[0].fields['data'], '"data" field')
          t.same(info.minzoom, 12)
          t.same(info.maxzoom, 13)
          t.end()
        })
      })
    })
  })
})

function getInfo (file, callback) {
  var mbtiles = new MBTiles('mbtiles://' + file, function (err) {
    if (err) return callback(err)
    mbtiles.getInfo(callback)
  })
}
