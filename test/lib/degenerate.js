var fs = require('fs')
var path = require('path')
var test = require('tap').test

var degenerate = require('../../lib/degenerate')

test('degenerate filter', function (t) {
  var pre = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixture/degenerate-features.geojson')))
  var post = pre.filter(degenerate([ 15, 9393, 12516 ]))
  t.equal(post.length, 4)
  t.end()
})

test('degenerate filter 2', function (t) {
  var pre = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixture/degenerate-features-2.geojson')))
  var post = pre.filter(degenerate([ 15, 9370, 12525 ]))
  t.equal(post.length, 4)
  t.end()
})
