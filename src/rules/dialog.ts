import type { Rule } from '../types.js'

/** <dialog> took top-layer, focus trapping, scroll locking and ESC-to-close into the browser. */
const HELPERS = ['body-scroll-lock', 'body-scroll-lock-upgrade', 'focus-trap-react', 'react-focus-lock']

const rule: Rule = {
  id: 'dialog',
  title: 'Modal stack → <dialog> + Popover API',
  packages: ['react-modal', '@reach/dialog', ...HELPERS],
  requirements: ['feature:dialog'],
  replacement: '<dialog>.showModal() + the popover attribute',
  docs: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog',

  inspect({ pkg }) {
    return {
      verdict: 'check',
      note: HELPERS.includes(pkg)
        ? '<dialog>.showModal() handles focus trapping and background scroll locking. Delete this once the modal moves to <dialog>.'
        : 'Moving the markup to <dialog> is manual work. Not something to delete automatically.',
    }
  },
}

export default rule
