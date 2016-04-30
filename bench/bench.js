var flat = require('flat')
var queue = require('queue-async')

var q

module.exports = function bench (label, fn) {
  if (!q) {
    q = queue(1)
    setImmediate(function () {
      q.awaitAll(function (err) { if (err) { console.error(err) } })
      q = null
    })
  }

  q.defer(function (done) {
    var start
    var b = {
      start: function () {
        start = Date.now()
      },
      result: function (err, data) {
        report({
          label: label,
          elapsed: Date.now() - start,
          error: err,
          data: data
        })
        start = Date.now()
      },
      end: function (err, data) {
        b.result(err, data)
        done()
      }
    }

    try {
      b.start()
      fn(b, b.end.bind(b))
    } catch (e) {
      b.end(e.message || e)
      done()
    }
  })
}

function report (result, data) {
  console.log(JSON.stringify(flat(result)))
}
