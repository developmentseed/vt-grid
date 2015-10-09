var fs = require('fs-extra')
var path = require('path')
var test = require('tap').test
var tmp = require('tmp')
var vtgeojson = require('vt-geojson')
var MBTiles = require('mbtiles')
var vtgrid = require('../')

test('basic aggregations', function (t) {
  var output = tmp.tmpNameSync({postfix: '.mbtiles'})
  vtgrid({
    input: 'mbtiles://' + path.resolve(__dirname, 'fixture', 'dc.mbtiles'),
    output: 'mbtiles://' + path.resolve(output),
    minzoom: 1,
    gridsize: 64,
    aggregations: {
      'dc': {
        'data': 'sum'
      }
    }
  }, function (err) {
    t.error(err)

    var expected = fs.readFileSync(__dirname + '/fixture/dc.z12-grid-quadkeys.txt')
      .toString()
      .split('\n')

    var results = {}
    vtgeojson('mbtiles://' + output, {
      minzoom: 12,
      bounds: JSON.parse(fs.readFileSync(__dirname + '/fixture/dc.geojson'))
    })
    .on('data', function (feature) {
      results[feature.properties._quadKey] = feature.properties.data
    })
    .on('end', function () {
      console.log(output)
      for (var key in results) {
        if (expected.indexOf(key) >= 0) {
          t.ok(results[key] > 0)
        } else {
          t.ok(results[key] === 0 || !results[key])
        }
      }

      getInfo(output, function (err, info) {
        t.error(err)
        var expectedJSON = fs.readFileSync(__dirname + '/fixture/dc.tilejson.json')
        expectedJSON = JSON.parse(expectedJSON)
        delete info.id
        delete info.basename
        delete info.filesize
        t.same(info, expectedJSON, 'tilejson metadata')
        t.end()
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
