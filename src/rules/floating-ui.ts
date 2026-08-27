import type { Rule } from '../types.js'

/**
 * Coordinate math, flipping and scroll repositioning moved into CSS.
 *
 * The umbrella `anchor-positioning` feature is not Baseline yet, so this rule
 * asks only for the parts a tooltip or dropdown actually uses.
 */
const REQUIREMENTS = [
  'bcd:css.properties.anchor-name',
  'bcd:css.properties.position-area',
  'bcd:css.at-rules.position-try',
  'feature:popover',
] as const

/**
 * The exports whose whole job CSS took over.
 *
 * A DROP has to be positively established, and floating-ui's API arrives through
 * named imports, so this list is real evidence rather than the absence of it.
 * Everything else — interaction hooks, focus management, portals, the size and
 * autoUpdate middleware — has no CSS equivalent, and an import of one is enough
 * to stop short of DROP.
 */
const REPLACED_BY_CSS = new Set([
  'useFloating',
  'computePosition',
  'offset',
  'flip',
  'shift',
  'limitShift',
  'arrow',
  'FloatingArrow',
])

// Things CSS cannot express at all, spotted in source rather than in imports.
const ESCAPE_HATCHES: [RegExp, string][] = [
  [/getBoundingClientRect\s*:/, 'virtual elements — the reference is constructed by hand'],
  [/\bautoUpdate\s*\(/, 'autoUpdate — virtual lists and moving anchors do not map to CSS'],
]

const rule: Rule = {
  id: 'floating-ui',
  title: 'Popover positioning → CSS anchor positioning + Popover API',
  packages: [
    '@floating-ui/react', '@floating-ui/react-dom', '@floating-ui/dom', '@floating-ui/core',
    '@popperjs/core', 'popper.js', 'react-popper',
    'tippy.js', '@tippyjs/react',
  ],
  requirements: [...REQUIREMENTS],
  replacement: 'anchor-name / position-area / @position-try + popover',
  docs: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning',

  inspect({ usage }) {
    const hits: { file: string; why: string }[] = []
    for (const [file, meta] of usage.files) {
      for (const [pattern, why] of ESCAPE_HATCHES) {
        if (pattern.test(meta.text)) hits.push({ file, why })
      }
    }

    const beyondCss = [...usage.specifiers].filter((name) => !REPLACED_BY_CSS.has(name))

    if (hits.length && !beyondCss.length) {
      const blocked = new Set(hits.map((h) => h.file))
      // Nothing here could move to CSS, so there is no advice worth giving.
      if (usage.files.size > 0 && blocked.size === usage.files.size) return null
    }

    if (beyondCss.length) {
      return {
        verdict: 'check',
        note: `Also imports ${beyondCss.slice(0, 4).join(', ')}, which CSS does not cover — the positioning part can still move.`,
      }
    }

    if (hits.length) {
      return {
        verdict: 'check',
        note: `Some usage does not map to CSS: ${[...new Set(hits.map((h) => h.why))].join(' · ')}`,
        sites: [...new Set(hits.map((h) => h.file))],
      }
    }

    // require() and dynamic import() hand over no specifiers at all, and an empty
    // set is not evidence that every import is covered — it is the absence of any.
    if (!usage.specifiers.size) {
      return {
        verdict: 'check',
        note: 'Pulled in without named imports (require or a dynamic import), so which parts are in use cannot be seen from here.',
      }
    }

    return {
      verdict: 'drop',
      note: `Only ${[...usage.specifiers].join(', ')} are imported, and CSS covers all of them.`,
    }
  },
}

export default rule
