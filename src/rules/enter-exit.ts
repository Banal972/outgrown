import type { Rule } from '../types.js'

/**
 * Carrying a whole animation library for a fade in and out.
 * `@starting-style` plus `transition-behavior: allow-discrete` covers that in CSS.
 */
const BEYOND_CSS: [RegExp, string][] = [
  [/\blayoutId\b/, 'layoutId (shared element transition)'],
  [/\blayout\s*(=\{?true|\}|\s|>)/, 'layout animation'],
  [/\bdrag\b/, 'drag gestures'],
  [/useScroll|useTransform|useSpring|useMotionValue|useMotionTemplate/, 'motion values / scroll linkage'],
  [/\bvariants\b|\bstagger\b/, 'variants and stagger'],
  [/useAnimate|useAnimation\b/, 'imperative animation control'],
  [/\bReorder\b/, 'Reorder component'],
]

const rule: Rule = {
  id: 'enter-exit',
  title: 'Enter/exit animation → @starting-style + allow-discrete',
  packages: ['framer-motion', 'motion', 'react-transition-group', 'react-spring', '@react-spring/web'],
  requirements: ['feature:starting-style', 'feature:transition-behavior'],
  replacement: '@starting-style + transition-behavior: allow-discrete',
  docs: 'https://developer.chrome.com/blog/entry-exit-animations',

  inspect({ usage }) {
    const found = new Map<string, string[]>()

    for (const [file, meta] of usage.files) {
      for (const [pattern, why] of BEYOND_CSS) {
        if (!pattern.test(meta.text)) continue
        const files = found.get(why) ?? []
        files.push(file)
        found.set(why, files)
      }
    }

    if (found.size) {
      return {
        verdict: 'check',
        note: `Uses features CSS cannot express: ${[...found.keys()].join(' · ')}`,
        sites: [...new Set([...found.values()].flat())],
      }
    }

    return { verdict: 'drop', note: 'Only enter and exit transitions are used. Two lines of CSS replace this.' }
  },
}

export default rule
