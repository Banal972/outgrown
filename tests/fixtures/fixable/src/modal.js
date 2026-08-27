import dialogPolyfill from 'dialog-polyfill'

export function openModal(el) {
  dialogPolyfill.registerDialog(el)
  el.showModal()
}
