import 'whatwg-fetch'
import 'urlpattern-polyfill'

export const ping = () => fetch('/ping')
