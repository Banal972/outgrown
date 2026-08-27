import type { Requirement, Rule } from '../types.js'

/**
 * Libraries the platform absorbed.
 *
 * Unlike the `polyfills` rule, these cannot be found by searching npm — none of
 * them carry "polyfill" in the name, and nothing about `uuid` announces that
 * `crypto.randomUUID()` exists now. They come from asking, feature by feature,
 * "what job is this, and who used to do it".
 *
 * The verdict is always `check`: the feature is there, but call sites have to be
 * rewritten. That is a human's job, not a `--write` flag.
 */
interface Absorbed {
  requirements: Requirement[]
  to: string
  note: string
}

const ABSORBED: Record<string, Absorbed> = {
  // ID generation
  'uuid': {
    requirements: ['bcd:api.Crypto.randomUUID'],
    to: 'crypto.randomUUID()',
    note: 'v4 ids are one built-in call now. Other versions (v1, v5) still need the library.',
  },
  'uuidv4': {
    requirements: ['bcd:api.Crypto.randomUUID'],
    to: 'crypto.randomUUID()',
    note: 'Direct swap: crypto.randomUUID() returns the same shape.',
  },

  // Clipboard
  'copy-to-clipboard': {
    requirements: ['bcd:api.Clipboard.writeText'],
    to: 'navigator.clipboard.writeText()',
    note: 'The hidden-textarea trick this wraps is no longer needed.',
  },
  'clipboard': {
    requirements: ['bcd:api.Clipboard.writeText'],
    to: 'navigator.clipboard.writeText()',
    note: 'clipboard.js predates the async clipboard API.',
  },
  'react-copy-to-clipboard': {
    requirements: ['bcd:api.Clipboard.writeText'],
    to: 'navigator.clipboard.writeText()',
    note: 'A component wrapper around a one-line call.',
  },

  // Lazy loading
  'lazysizes': {
    requirements: ['feature:loading-lazy'],
    to: 'loading="lazy"',
    note: 'Covers images and iframes. Custom breakpoints and effects do not carry over.',
  },
  'vanilla-lazyload': {
    requirements: ['feature:loading-lazy'],
    to: 'loading="lazy"',
    note: 'Covers images and iframes.',
  },
  'react-lazyload': {
    requirements: ['feature:loading-lazy'],
    to: 'loading="lazy"',
    note: 'For images and iframes. Lazy-rendering arbitrary components still needs a library.',
  },
  'react-lazy-load-image-component': {
    requirements: ['feature:loading-lazy'],
    to: 'loading="lazy"',
    note: 'The placeholder and blur effects do not have a platform equivalent.',
  },

  // Auto-growing textareas
  'react-textarea-autosize': {
    requirements: ['bcd:css.properties.field-sizing'],
    to: 'field-sizing: content',
    note: 'One CSS declaration replaces the measure-and-resize loop.',
  },
  'autosize': {
    requirements: ['bcd:css.properties.field-sizing'],
    to: 'field-sizing: content',
    note: 'One CSS declaration replaces the measure-and-resize loop.',
  },

  // Focus containment
  'wicg-inert': {
    requirements: ['feature:inert'],
    to: 'the inert attribute',
    note: 'Native inert also removes the subtree from the accessibility tree.',
  },

  // Element observation
  'element-resize-detector': {
    requirements: ['feature:resize-observer'],
    to: 'ResizeObserver',
    note: 'The iframe and scroll-based detection tricks are no longer needed.',
  },
  'resize-detector': {
    requirements: ['feature:resize-observer'],
    to: 'ResizeObserver',
    note: 'The iframe and scroll-based detection tricks are no longer needed.',
  },
}

const rule: Rule = {
  id: 'absorbed',
  title: 'Libraries the platform absorbed',
  packages: Object.keys(ABSORBED),
  requirementsFor: (pkg) => ABSORBED[pkg]?.requirements ?? [],
  replacementFor: (pkg) => ABSORBED[pkg]?.to ?? 'a platform feature',
  docs: 'https://web.dev/baseline',

  inspect({ pkg }) {
    return {
      verdict: 'check',
      note: ABSORBED[pkg]?.note ?? 'The platform covers this now, but call sites need rewriting.',
    }
  },
}

export default rule
