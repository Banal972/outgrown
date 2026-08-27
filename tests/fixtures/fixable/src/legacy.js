export function ensureFetch() {
  if (!window.fetch) {
    require('whatwg-fetch')
  }
}
