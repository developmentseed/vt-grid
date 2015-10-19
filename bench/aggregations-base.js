var filters = require('oam-browser-filters')
var aggregate = require('./union')

var aggs = {}
var postAggs = {}

var union = aggregate.union('FID')

filters.getAllCombinations().forEach(function (combo) {
  var params = combo.searchParameters
  var d = new Date('2015-9-21')
  if (params.acquisition_from) {
    if (combo.date.key === 'week') {
      d.setDate(d.getDate() - 7)
    } else if (combo.date.key === 'month') {
      d.setMonth(d.getMonth() - 1)
    } else if (combo.date.key === 'year') {
      d.setFullYear(d.getFullYear() - 1)
    }

    params.acquisition_from = new Date([
      d.getFullYear(),
      d.getMonth() + 1,
      d.getDate()
    ].join('-'))
  }

  if (Object.keys(params).length === 0) {
    aggs[combo.key] = union
  } else {
    aggs[combo.key] = function (memo, feature) {
      var props = feature.properties

      var passesFilter = true
      for (var criterion in params) {
        if (criterion === 'gsd_from') {
          passesFilter = passesFilter && props.gsd >= params[criterion]
        } else if (criterion === 'gsd_to') {
          passesFilter = passesFilter && props.gsd <= params[criterion]
        } else if (criterion === 'acquisition_from') {
          passesFilter = passesFilter && (new Date(props.acquisition_end) > params[criterion])
        } else if (criterion === 'has_tiled') {
          passesFilter = passesFilter && props.tms
        }
      }

      if (passesFilter) {
        return union(memo, feature)
      } else {
        return memo
      }
    }

    aggs[combo.key].finish = union.finish
  }

  postAggs[combo.key + '_count'] = aggregate.count(combo.key)
})

module.exports = {
  aggregations: {
    footprints: aggs
  },
  postAggregations: {
    footprints: postAggs
  }
}
