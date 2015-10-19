var uniq = require('uniq')
var comma = ','.charAt(0)

exports.union = union
exports.count = count

function union (property) {
  function collect (memo, feature) {
    memo = (memo || [])
    if (!('FID' in feature.properties)) { return memo }
    var value = feature.properties[property]
    memo.push(value)
    return memo
  }

  collect.finish = function (memo) {
    return memo ? uniq(memo).join(',') : ''
  }

  return collect
}

function count (property) {
  return function (feature) {
    var val = feature.properties[property]
    if (!val) { return 0 }
    var items = 1
    for (var i = val.length - 1; i >= 0; i--) {
      if (val.charAt(i) === comma) {
        items++
      }
    }
    return items
  }
}
