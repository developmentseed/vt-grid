var uniq = require('uniq')
var filters = require('oam-browser-filters')

var aggs = {}
var postAggs = {}

function union (memo, feature) {
  memo = (memo || [])
  if (!('FID' in feature.properties)) { return memo }
  var value = feature.properties['FID']
  memo.push(value)
  return memo
}

union.finish = function (memo) {
  return memo ? uniq(memo).join(',') : ''
}

var comma = ','.charAt(0)

filters.getAllCombinations().forEach(function (combo) {
  var params = combo.searchParameters
  if (params.acquisition_from) {
    params.acquisition_from = new Date(params.acquisition_from)
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
          passesFilter = passesFilter && new Date(props.acquisition_end) > params[criterion]
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

  postAggs[combo.key + '_count'] = function (feature) {
    var val = feature.properties[combo.key]
    if (!val) { return 0 }
    var items = 1
    for (var i = val.length - 1; i >= 0; i--) {
      if (val.charAt(i) === comma) {
        items++
      }
    }
    return items
  }
})

module.exports = {
  aggregations: {
    footprints: aggs
  },
  postAggregations: {
    footprints: postAggs
  }
}
