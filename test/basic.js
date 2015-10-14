var fs = require('fs-extra')
var path = require('path')
var test = require('tap').test
var tmp = require('tmp')
var vtgeojson = require('vt-geojson')
var aggregations = require('geojson-polygon-aggregate')
var MBTiles = require('mbtiles')
var grid = require('../lib/grid')

test('basic aggregations', function (t) {
  var input = 'mbtiles://' + path.resolve(__dirname, 'fixture', 'dc.mbtiles')
  var output = 'mbtiles://' + path.resolve(tmp.tmpNameSync({postfix: '.mbtiles'}))

  var job = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture/job.json')))
  job.aggregations = { dc: { data: aggregations.sum('data') } }
  job.postAggregations = {}

  load(input, output, function (err, inp, out) {
    t.error(err)
    grid(out, inp, job, function (err, progress, nextlevel) {
      t.error(err)

      var expected = fs.readFileSync(__dirname + '/fixture/dc.z12-grid-quadkeys.txt')
        .toString()
        .split('\n')

      var results = {}
      vtgeojson(output, {
        minzoom: 12,
        bounds: JSON.parse(fs.readFileSync(__dirname + '/fixture/dc.geojson'))
      })
      .on('data', function (feature) {
        results[feature.properties._quadKey] = feature.properties.data
      })
      .on('end', function () {
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
})

function load (input, output, callback) {
  var inp = new MBTiles(input, function (err) {
    if (err) return callback(err)
    var out = new MBTiles(output, function (err) {
      if (err) return callback(err)
      callback(null, inp, out)
    })
  })
}

