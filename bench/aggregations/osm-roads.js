var flatten = require('lodash.flatten')
var cheapRuler = require('cheap-ruler')

module.exports = {
  aggregations: {
    osm: {
      roads_km: function (memo, feature, _, tile) {
        if (!feature.properties.highway) { return memo }

        memo = memo || 0
        var ruler = getRuler(tile)
        return memo + totalLineDistance(ruler, feature.geometry)
      }
    }
  }
}

function totalLineDistance (ruler, geometry) {
  var lines
  if (geometry.type === 'MultiPolygon') {
    // polygons -> rings -> coordinates
    // [ [ [ [x1, y1], [x2, y2], ... ], [...] ] ]
    lines = flatten(geometry.coordinates)
  } else if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
    // this is what we want
    // [ [ [x1, y1], [x2, y2], ... ], [...] ]
    lines = geometry.coordinates
  } else if (geometry.type === 'LineString') {
    // wrap in an array
    lines = [geometry.coordinates]
  } else {
    return 0
  }

  var sum = 0
  for (var i = 0; i < lines.length; i++) {
    sum += ruler.lineDistance(lines[i])
  }
  return sum
}

var cache = {}
function getRuler (tile) {
  var key = tile[1]
  if (!cache[key]) {
    cache[key] = cheapRuler.fromTile(tile[1], tile[0])
  }
  return cache[key]
}

