var range = require('lodash.range')
var series = require('run-series')

var run = require('./')

var tasks = range(1, 9).map(function (lim) {
  lim = Math.pow(2, lim)
  return range(0, 30, 5).map(function (m) {
    return { limit: lim, properties: m }
  })
})
.reduce(function (memo, arr) { return memo.concat(arr) }, [])

console.log('basezoom_tiles,tiles_built,features_built,properties,time')
series(tasks.map(function (task) { return run.bind(null, task) }))

