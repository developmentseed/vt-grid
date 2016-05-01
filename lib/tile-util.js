'use strict'

var tilebelt = require('tilebelt')
var uniq = require('uniq')

module.exports = {
  getChildren: getChildren,
  getProgeny: getProgeny,
  getAncestors: getAncestors,
  hasProgeny: hasProgeny,
  toXYZ: toXYZ,
  toZXY: toZXY
}

function getAncestors (tiles, minzoom) {
  var ancestors = []
  tiles = tiles.map(toXYZ)
  minzoom = minzoom || 0

  while (tiles.length > 0) {
    tiles = tiles
      .map(tilebelt.getParent.bind(tilebelt))
      .filter(function (tile) { return tile[2] >= minzoom })
    // remove duplicates
    tiles = uniq(tiles.map(join).sort()).map(split)
    if (tiles.length > 0) { ancestors.push(tiles.map(toZXY)) }
  }

  return ancestors

  function join (t) { return t.join('/') }
  function split (t) { return t.split('/').map(Number) }
}

function getChildren (tile) {
  return tilebelt.getChildren(toXYZ(tile)).map(toZXY)
}

function getProgeny (tile, zoom) {
  var z = tile[0]
  var tiles = [toXYZ(tile)]
  while (z < zoom) {
    var c = 0
    var nextTiles = new Array(tiles.length * 4)
    for (var i = 0; i < tiles.length; i++) {
      var children = tilebelt.getChildren(tiles[i])
      for (var j = 0; j < 4; j++) {
        nextTiles[c++] = children[j]
      }
    }
    tiles = nextTiles
    z++
  }
  return tiles.map(toZXY)
}

// assumes all ancestors are the same zoom level
function hasProgeny (ancestors) {
  if (!ancestors[0] || !ancestors[0][0]) {
    return function () { return false }
  }
  var zoom = ancestors[0][0]
  var map = {}
  ancestors.forEach(function (a) {
    map[toXYZ(a).join('/')] = true
  })

  return function (child) {
    child = toXYZ(child)
    while (child[2] > zoom) {
      child = tilebelt.getParent(child)
    }
    return map[child.join('/')]
  }
}

function toZXY (tile) {
  return [tile[2], tile[0], tile[1]]
}

function toXYZ (tile) {
  return [tile[1], tile[2], tile[0]]
}
