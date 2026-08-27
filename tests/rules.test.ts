import { rules } from '../src/rules/index.js'
import type { PackageUsage, Project, Rule } from '../src/types.js'

function usageOf(files: Record<string, string>, specifiers: string[] = []): PackageUsage {
  return {
    files: new Map(Object.entries(files).map(([name, text]) => [name, { lines: [1], text }])),
    specifiers: new Set(specifiers),
  }
}

const EMPTY_PROJECT: Project = { root: '/', fileCount: 0, usage: new Map() }

function ruleById(id: string): Rule {
  const rule = rules.find((r) => r.id === id)
  if (!rule) throw new Error(`no rule ${id}`)
  return rule
}

function inspect(id: string, pkg: string, usage: PackageUsage) {
  return ruleById(id).inspect({ pkg, usage, project: EMPTY_PROJECT })
}

describe('rule wiring', () => {
  it('gives every rule requirements, directly or per package', () => {
    for (const rule of rules) {
      const hasRequirements = rule.requirements?.length || rule.requirementsFor
      expect([rule.id, Boolean(hasRequirements)]).toEqual([rule.id, true])
    }
  })

  it('never lists the same package in two rules', () => {
    const seen = new Set<string>()
    for (const rule of rules) {
      for (const pkg of rule.packages) {
        expect([pkg, seen.has(pkg)]).toEqual([pkg, false])
        seen.add(pkg)
      }
    }
  })

  it('gives per-package rules an answer for every package they claim', () => {
    for (const rule of rules) {
      if (!rule.requirementsFor) continue
      for (const pkg of rule.packages) {
        expect(rule.requirementsFor(pkg).length).toBeGreaterThan(0)
      }
    }
  })
})

describe('floating-ui', () => {
  it('drops when only placement is used', () => {
    const result = inspect('floating-ui', '@floating-ui/react', usageOf({
      'Tooltip.tsx': `useFloating({ placement: 'top', middleware: [offset(8), flip(), shift()] })`,
    }))
    expect(result.verdict).toBe('drop')
  })

  it.each([
    ['size() middleware', `useFloating({ middleware: [size({ apply() {} })] })`],
    ['virtual element', `const ref = { getBoundingClientRect: () => rect }`],
    ['autoUpdate', `autoUpdate(reference, floating, update)`],
  ])('flags %s for review', (_label, source) => {
    const result = inspect('floating-ui', '@floating-ui/react', usageOf({ 'a.tsx': source }))
    expect(result.verdict).toBe('check')
    expect(result.sites).toEqual(['a.tsx'])
  })
})

describe('enter-exit', () => {
  it('drops when only enter/exit transitions are used', () => {
    const result = inspect('enter-exit', 'framer-motion', usageOf({
      'Fade.tsx': `<AnimatePresence><motion.div initial={{ opacity: 0 }} exit={{ opacity: 0 }} /></AnimatePresence>`,
    }))
    expect(result.verdict).toBe('drop')
  })

  it.each([
    ['layoutId', `<motion.img layoutId="hero" />`],
    ['motion values', `const y = useTransform(scrollY, [0, 1], [0, 100])`],
    ['variants', `<motion.li variants={item} />`],
  ])('flags %s for review', (_label, source) => {
    expect(inspect('enter-exit', 'framer-motion', usageOf({ 'a.tsx': source })).verdict).toBe('check')
  })

  it('names the file to look at', () => {
    const result = inspect('enter-exit', 'framer-motion', usageOf({
      'Fade.tsx': `<motion.div exit={{ opacity: 0 }} />`,
      'Gallery.tsx': `<motion.img layoutId="hero" />`,
    }))
    expect(result.sites).toEqual(['Gallery.tsx'])
  })
})

describe('polyfills', () => {
  it('always drops — the replacement is nothing at all', () => {
    const result = inspect('polyfills', 'whatwg-fetch', usageOf({ 'boot.ts': `import 'whatwg-fetch'` }))
    expect(result.verdict).toBe('drop')
    expect(result.note).toContain('window.fetch')
  })
})

describe('dialog', () => {
  it('asks for review rather than deleting markup automatically', () => {
    expect(inspect('dialog', 'react-modal', usageOf({ 'a.tsx': '' })).verdict).toBe('check')
  })

  it('tells helper packages they are covered by <dialog> itself', () => {
    const result = inspect('dialog', 'focus-trap-react', usageOf({ 'a.tsx': '' }))
    expect(result.note).toContain('focus trapping')
  })
})
