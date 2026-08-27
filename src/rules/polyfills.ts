import type { Requirement, Rule } from '../types.js'

/**
 * The cleanest verdicts in the tool: if the feature ships, the polyfill goes.
 * Nothing has to be rewritten — deletion *is* the migration.
 *
 * Candidates come from `scripts/find-candidates.mjs`, which works backwards from
 * features that reached Baseline recently. Every entry here has had its feature id
 * checked by hand — the script's guess at which feature a package replaces is
 * often wrong even when the package itself is a good find.
 */
interface Polyfill {
  requirements: Requirement[]
  /** How the replacement reads in the report. */
  to: string
  /**
   * The global that takes over when the import goes. Deleting
   * `import ResizeObserver from 'resize-observer-polyfill'` is safe precisely
   * because `ResizeObserver` then resolves to this. Absent means a used binding
   * has nothing to fall back on, so the verdict stops at CHECK.
   */
  global?: string
  /** Set when the package cannot be judged as a whole, with the reason. */
  conservative?: string
}

const POLYFILLS: Record<string, Polyfill> = {
  // Network and platform APIs
  'whatwg-fetch': { requirements: ['feature:fetch'], to: 'window.fetch', global: 'fetch' },
  'isomorphic-fetch': {
    requirements: ['feature:fetch'],
    to: 'window.fetch',
    global: 'fetch',
    conservative: 'isomorphic-fetch also covers Node, and browserslist says nothing about your server runtime.',
  },
  'unfetch': { requirements: ['feature:fetch'], to: 'window.fetch', global: 'fetch' },
  'abortcontroller-polyfill': { requirements: ['feature:aborting'], to: 'AbortController', global: 'AbortController' },
  'abort-signal-polyfill': { requirements: ['feature:abortsignal-timeout'], to: 'AbortSignal.timeout()' },
  'urlpattern-polyfill': { requirements: ['feature:urlpattern'], to: 'URLPattern', global: 'URLPattern' },
  'url-polyfill': { requirements: ['feature:url'], to: 'URL / URLSearchParams', global: 'URL' },
  'url-search-params-polyfill': { requirements: ['feature:url'], to: 'URLSearchParams', global: 'URLSearchParams' },
  'promise-polyfill': { requirements: ['feature:promise'], to: 'Promise', global: 'Promise' },
  'es6-promise': { requirements: ['feature:promise'], to: 'Promise', global: 'Promise' },
  'raf': { requirements: ['feature:request-animation-frame'], to: 'requestAnimationFrame()', global: 'requestAnimationFrame' },
  'event-target-polyfill': { requirements: ['feature:events'], to: 'new EventTarget()', global: 'EventTarget' },
  'broadcastchannel-polyfill': { requirements: ['feature:broadcast-channel'], to: 'BroadcastChannel', global: 'BroadcastChannel' },
  'clipboard-polyfill': { requirements: ['feature:async-clipboard'], to: 'navigator.clipboard' },
  'web-streams-polyfill': { requirements: ['feature:streams'], to: 'ReadableStream / WritableStream', global: 'ReadableStream' },
  '@stardazed/streams-polyfill': { requirements: ['feature:streams'], to: 'ReadableStream / WritableStream', global: 'ReadableStream' },
  'compression-streams-polyfill': { requirements: ['feature:compression-streams'], to: 'CompressionStream', global: 'CompressionStream' },

  // Observers
  'intersection-observer': { requirements: ['feature:intersection-observer'], to: 'IntersectionObserver', global: 'IntersectionObserver' },
  'resize-observer-polyfill': { requirements: ['feature:resize-observer'], to: 'ResizeObserver', global: 'ResizeObserver' },
  '@juggle/resize-observer': { requirements: ['feature:resize-observer'], to: 'ResizeObserver', global: 'ResizeObserver' },

  // Elements and interaction
  'dialog-polyfill': { requirements: ['feature:dialog'], to: '<dialog>' },
  '@oddbird/popover-polyfill': { requirements: ['feature:popover'], to: 'the popover attribute' },
  'invokers-polyfill': { requirements: ['feature:invoker-commands'], to: 'command / commandfor' },
  'loading-attribute-polyfill': { requirements: ['feature:loading-lazy'], to: 'loading="lazy"' },

  // Scrolling
  'smoothscroll-polyfill': { requirements: ['feature:scroll-behavior'], to: 'scroll-behavior: smooth' },
  'seamless-scroll-polyfill': { requirements: ['feature:scroll-behavior'], to: 'scroll-behavior: smooth' },
  'scroll-behavior-polyfill': { requirements: ['feature:scroll-behavior'], to: 'scroll-behavior: smooth' },
  '@af-utils/scrollend-polyfill': { requirements: ['feature:scrollend'], to: 'the scrollend event' },
  'text-fragments-polyfill': { requirements: ['feature:scroll-to-text-fragment'], to: 'text fragment URLs (#:~:text=)' },

  // CSS
  'container-query-polyfill': { requirements: ['feature:container-queries'], to: '@container' },
  'construct-style-sheets-polyfill': { requirements: ['feature:constructed-stylesheets'], to: 'new CSSStyleSheet()' },
  'postcss-aspect-ratio-polyfill': { requirements: ['feature:aspect-ratio'], to: 'aspect-ratio' },
  'postcss-image-set-polyfill': { requirements: ['feature:image-set'], to: 'image-set()' },
  'large-small-dynamic-viewport-units-polyfill': { requirements: ['feature:viewport-unit-variants'], to: 'svh / lvh / dvh' },
  'object-fit-images': { requirements: ['feature:object-fit'], to: 'object-fit' },
  'focus-visible': { requirements: ['feature:focus-visible'], to: ':focus-visible' },

  // Canvas
  'canvas-roundrect-polyfill': { requirements: ['feature:canvas-roundrect'], to: 'ctx.roundRect()' },

  // ECMAScript and Intl
  'iterator-helpers-polyfill': { requirements: ['feature:iterator-methods'], to: 'Iterator.prototype methods' },
  'intl-segmenter-polyfill': { requirements: ['feature:intl-segmenter'], to: 'Intl.Segmenter' },
  'intl-locale-textinfo-polyfill': { requirements: ['feature:intl-locale-info'], to: 'Intl.Locale' },
  'core-js-pure': {
    requirements: ['feature:array-flat', 'feature:promise-finally'],
    to: 'native',
    conservative:
      'core-js-pure is imported per feature (core-js-pure/actual/…), so the package as a whole cannot be judged. Check which entry points you import.',
  },
}

const rule: Rule = {
  id: 'polyfills',
  title: 'Dead polyfills → native',
  packages: Object.keys(POLYFILLS),
  requirementsFor: (pkg) => POLYFILLS[pkg]?.requirements ?? [],
  replacementFor: (pkg) => POLYFILLS[pkg]?.to ?? 'native',
  nativeGlobalFor: (pkg) => POLYFILLS[pkg]?.global,
  docs: 'https://web.dev/baseline',

  inspect({ pkg, usage }) {
    const entry = POLYFILLS[pkg]
    const to = entry?.to ?? 'the native API'

    if (entry?.conservative) {
      return { verdict: 'check', note: `${to} covers most of this. ${entry.conservative}` }
    }

    if (usage.opaque) {
      return {
        verdict: 'check',
        note: `${to} is available in every target browser, but this is pulled in where the binding cannot be read — check the call sites yourself.`,
      }
    }

    // A used binding only survives deletion when the global answers to the same
    // name. What matters is the *local* name — `{ ResizeObserver as RO }` leaves
    // `RO` behind, which no global answers to.
    const orphaned = [...usage.bindings].filter((name) => name !== entry?.global)

    if (orphaned.length) {
      return {
        verdict: 'check',
        note: `${to} is available in every target browser, but \`${orphaned[0]}\` is bound to the import — swap the call sites first.`,
      }
    }

    return { verdict: 'drop', note: `${to} is available in every target browser. Delete the import.` }
  },
}

export default rule
