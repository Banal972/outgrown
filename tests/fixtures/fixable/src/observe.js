import ResizeObserver from 'resize-observer-polyfill'

export function watch(el, cb) {
  const ro = new ResizeObserver(cb)
  ro.observe(el)
  return ro
}
