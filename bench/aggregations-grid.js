var filters = require('oam-browser-filters')
var aggregate = require('./union')

var d
module.exports = d = {
  aggregations: {
    footprints: {}
  },
  postAggregations: {
    footprints: {}
  }
}

filters.getAllCombinations().forEach(function (combo) {
  d.aggregations.footprints[combo.key] = aggregate.union(combo.key)
  d.postAggregations.footprints[combo.key + '_count'] = aggregate.count(combo.key)
})

