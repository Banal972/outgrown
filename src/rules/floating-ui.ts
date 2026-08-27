import type { Rule } from '../types.js'

/**
 * Coordinate math, flipping and scroll repositioning moved into CSS.
 *
 * The umbrella `anchor-positioning` feature is not Baseline yet, so this rule
 * asks only for the parts a tooltip or dropdown actually uses.
 */
const ESCAPE_HATCHES: [RegExp, string][] = [
  [/\bsize\s*\(/, 'size() middleware — CSS has no equivalent for measuring the floating element'],
  [/getBoundingClientRect\s*:/, 'virtual elements — the reference is constructed by hand'],
  [/\bautoUpdate\s*\(/, 'autoUpdate — virtual lists and moving anchors do not map to CSS'],
  [/\binline\s*\(\)/, 'inline() middleware — anchors that wrap across lines'],
]

const rule: Rule = {
  id: 'floating-ui',
  title: 'Popover positioning → CSS anchor positioning + Popover API',
  packages: [
    '@floating-ui/react', '@floating-ui/react-dom', '@floating-ui/dom', '@floating-ui/core',
    '@popperjs/core', 'popper.js', 'react-popper',
    'tippy.js', '@tippyjs/react',
  ],
  requirements: [
    'bcd:css.properties.anchor-name',
    'bcd:css.properties.position-area',
    'bcd:css.at-rules.position-try',
    'feature:popover',
  ],
  replacement: 'anchor-name / position-area / @position-try + popover',
  docs: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning',

  inspect({ usage }) {
    const hits: { file: string; why: string }[] = []
    for (const [file, meta] of usage.files) {
      for (const [pattern, why] of ESCAPE_HATCHES) {
        if (pattern.test(meta.text)) hits.push({ file, why })
      }
    }

    if (!hits.length) {
      return { verdict: 'drop', note: 'Only placement, flipping and offsets are used. This maps to CSS as-is.' }
    }

    const blocked = new Set(hits.map((h) => h.file))

    // Nothing here could move to CSS, so there is no advice worth giving.
    if (usage.files.size > 0 && blocked.size === usage.files.size) return null

    return {
      verdict: 'check',
      note: `Some usage does not map to CSS: ${[...new Set(hits.map((h) => h.why))].join(' · ')}`,
      sites: [...blocked],
    }
  },
}

export default rule
