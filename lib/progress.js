var ProgressBar = require('progress')

module.exports = function (total) {
  var bar
  bar = new ProgressBar([
    '[:bar] :percent',
    'ETA :etas',
    '[:featureavg feats/tile]',
    '[:tileRate tiles/s]',
    '[:jobs jobs]',
    '[ :lastTile ]'
  ].join(' '), { width: 20, total: total })

  var totalFeatures = 0
  function updateProgress (jobs, tiles, features, lastTile) {
    totalFeatures += features
    var totalTiles = bar.curr + tiles
    var deltaT = (new Date() - bar.start) / 1000
    bar.tick(tiles, {
      jobs: jobs,
      features: features,
      featureavg: totalTiles > 0 ? Math.round(totalFeatures / totalTiles) : 'n/a',
      tileRate: Math.round(100 * totalTiles / deltaT) / 100,
      lastTile: lastTile
    })
  }

  updateProgress.finish = function () {
    updateProgress(0, total, 0, 'finished')
  }

  return updateProgress
}
