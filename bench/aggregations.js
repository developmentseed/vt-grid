var filters = require('oam-browser-filters')
var aggregate = require('geojson-polygon-aggregate')

var aggs = {}
var postAggs = {}
var union = aggregate.union('FID')

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

      var passesFilter = Object.keys(params)
      .every(function (criterion) {
        switch (criterion) {
          case 'gsd_from':
            return props.gsd >= params[criterion]

          case 'gsd_to':
            return props.gsd <= params[criterion]

          case 'acquisition_from':
            return new Date(props.acquisition_end) > params[criterion]

          case 'has_tiled':
            return props.tms
        }
      })

      if (passesFilter) {
        return union(memo, feature)
      } else {
        return memo
      }
    }

    aggs[combo.key].finish = union.finish
    postAggs[combo.key + '_count'] = function (feature) {
      var val = feature.properties[combo.key]
      try {
        return val ? JSON.parse(val).length : 0
      } catch (e) { return 0 }
    }
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
