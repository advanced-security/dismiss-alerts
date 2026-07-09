export const id = 653;
export const ids = [653];
export const modules = {

/***/ 9653:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {



var util = __webpack_require__(9023)

var levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
var noop = function () {}

module.exports = function (opts) {
  opts = opts || {}
  opts.level = opts.level || 'info'

  var logger = {}

  var shouldLog = function (level) {
    return levels.indexOf(level) >= levels.indexOf(opts.level)
  }

  levels.forEach(function (level) {
    logger[level] = shouldLog(level) ? log : noop

    function log () {
      var prefix = opts.prefix
      var normalizedLevel

      if (opts.stderr) {
        normalizedLevel = 'error'
      } else {
        switch (level) {
          case 'trace': normalizedLevel = 'info'; break
          case 'debug': normalizedLevel = 'info'; break
          case 'fatal': normalizedLevel = 'error'; break
          default: normalizedLevel = level
        }
      }

      if (prefix) {
        if (typeof prefix === 'function') prefix = prefix(level)
        arguments[0] = util.format(prefix, arguments[0])
      }

      console[normalizedLevel](util.format.apply(util, arguments))
    }
  })

  return logger
}


/***/ })

};

//# sourceMappingURL=653.index.js.map