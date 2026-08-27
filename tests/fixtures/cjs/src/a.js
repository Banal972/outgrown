const RO = require('resize-observer-polyfill')
require('whatwg-fetch')
register(require('intersection-observer'))

export const r = new RO(() => {})
