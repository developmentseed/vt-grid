var fs = require('fs-extra')
var path = require('path')
var test = require('tap').test
var tmp = require('tmp')
var vtgeojson = require('vt-geojson')
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
      t.end()
    })
  })
})
