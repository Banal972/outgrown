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
const POLYFILLS: Record<string, { requirements: Requirement[]; to: string }> = {
  // Network and platform APIs
  'whatwg-fetch': { requirements: ['feature:fetch'], to: 'window.fetch' },
  'isomorphic-fetch': { requirements: ['feature:fetch'], to: 'window.fetch' },
  'unfetch': { requirements: ['feature:fetch'], to: 'window.fetch' },
  'abortcontroller-polyfill': { requirements: ['feature:aborting'], to: 'AbortController' },
  'abort-signal-polyfill': { requirements: ['feature:abortsignal-timeout'], to: 'AbortSignal.timeout()' },
  'urlpattern-polyfill': { requirements: ['feature:urlpattern'], to: 'URLPattern' },
  'url-polyfill': { requirements: ['feature:url'], to: 'URL / URLSearchParams' },
  'url-search-params-polyfill': { requirements: ['feature:url'], to: 'URLSearchParams' },
  'promise-polyfill': { requirements: ['feature:promise'], to: 'Promise' },
  'es6-promise': { requirements: ['feature:promise'], to: 'Promise' },
  'raf': { requirements: ['feature:request-animation-frame'], to: 'requestAnimationFrame()' },
  'event-target-polyfill': { requirements: ['feature:events'], to: 'new EventTarget()' },
  'broadcastchannel-polyfill': { requirements: ['feature:broadcast-channel'], to: 'BroadcastChannel' },
  'clipboard-polyfill': { requirements: ['feature:async-clipboard'], to: 'navigator.clipboard' },
  'web-streams-polyfill': { requirements: ['feature:streams'], to: 'ReadableStream / WritableStream' },
  '@stardazed/streams-polyfill': { requirements: ['feature:streams'], to: 'ReadableStream / WritableStream' },
  'compression-streams-polyfill': { requirements: ['feature:compression-streams'], to: 'CompressionStream' },

  // Observers
  'intersection-observer': { requirements: ['feature:intersection-observer'], to: 'IntersectionObserver' },
  'resize-observer-polyfill': { requirements: ['feature:resize-observer'], to: 'ResizeObserver' },
  '@juggle/resize-observer': { requirements: ['feature:resize-observer'], to: 'ResizeObserver' },

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
  'core-js-pure': { requirements: ['feature:array-flat', 'feature:promise-finally'], to: 'native' },
}

const rule: Rule = {
  id: 'polyfills',
  title: 'Dead polyfills → native',
  packages: Object.keys(POLYFILLS),
  requirementsFor: (pkg) => POLYFILLS[pkg]?.requirements ?? [],
  replacementFor: (pkg) => POLYFILLS[pkg]?.to ?? 'native',
  docs: 'https://web.dev/baseline',

  inspect({ pkg }) {
    const to = POLYFILLS[pkg]?.to ?? 'the native API'
    return { verdict: 'drop', note: `${to} is available in every target browser. Delete the import.` }
  },
}

export default rule
