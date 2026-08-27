import type { Rule } from '../types.js'

/**
 * Scroll-linked animation is heading for CSS, but not every browser is there yet.
 * This rule exists as much to report "not yet" accurately as to suggest the move.
 */
const rule: Rule = {
  id: 'scroll-animations',
  title: 'Scroll animation → CSS scroll-driven animations',
  packages: ['aos', 'scrollreveal', 'wow.js', 'react-reveal', 'react-awesome-reveal', 'react-scroll-parallax'],
  requirements: ['feature:scroll-driven-animations'],
  replacement: 'animation-timeline: view() / scroll()',
  docs: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations',

  inspect() {
    return { verdict: 'drop', note: 'Runs in CSS alone, with no IntersectionObserver.' }
  },
}

export default rule
