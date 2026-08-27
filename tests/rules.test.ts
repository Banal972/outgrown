import { rules } from '../src/rules/index.js'
import type { PackageUsage, Project, Rule } from '../src/types.js'

function usageOf(
  files: Record<string, string>,
  specifiers: string[] = [],
  bindings: string[] = specifiers,
  opaque = false,
): PackageUsage {
  return {
    files: new Map(Object.entries(files).map(([name, text]) => [name, { lines: [1], text }])),
    specifiers: new Set(specifiers),
    bindings: new Set(bindings),
    opaque,
  }
}

const EMPTY_PROJECT: Project = { root: '/', fileCount: 0, usage: new Map(), skipped: [] }

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
  // A DROP has to be established, not merely un-contradicted: the imports say
  // exactly which parts of the API are in play.
  it('drops only when every import is something CSS replaced', () => {
    const result = inspect('floating-ui', '@floating-ui/react', usageOf(
      { 'Tooltip.tsx': `useFloating({ placement: 'top', middleware: [offset(8), flip(), shift()] })` },
      ['useFloating', 'offset', 'flip', 'shift'],
    ))
    expect(result?.verdict).toBe('drop')
  })

  it.each([
    ['interaction hooks', ['useFloating', 'useInteractions', 'useDismiss']],
    ['focus management', ['useFloating', 'FloatingFocusManager']],
    ['size middleware', ['useFloating', 'size']],
    ['autoPlacement', ['useFloating', 'autoPlacement']],
  ])('stops short of drop when it also imports %s', (_label, specifiers) => {
    const result = inspect('floating-ui', '@floating-ui/react', usageOf(
      { 'a.tsx': `useFloating({ placement: 'top' })` },
      specifiers,
    ))
    expect(result?.verdict).toBe('check')
  })

  it.each([
    ['virtual element', `const ref = { getBoundingClientRect: () => rect }`],
    ['autoUpdate', `autoUpdate(reference, floating, update)`],
  ])('flags %s for review when other files could still move', (_label, source) => {
    const result = inspect('floating-ui', '@floating-ui/react', usageOf(
      { 'a.tsx': source, 'b.tsx': `useFloating({ placement: 'top' })` },
      ['useFloating'],
    ))
    expect(result?.verdict).toBe('check')
    expect(result?.sites).toEqual(['a.tsx'])
  })

  // Advice nobody can act on is noise, and noise is how a linter loses its reader.
  it('says nothing when every usage is beyond CSS', () => {
    const result = inspect('floating-ui', '@floating-ui/react', usageOf(
      { 'a.tsx': `autoUpdate(reference, floating, update)` },
      ['useFloating'],
    ))
    expect(result).toBeNull()
  })
})

describe('enter-exit', () => {
  // The whole API arrives through one `motion` import, so nothing distinguishes a
  // fade from `animate={{ x: 100 }}`. Never DROP on the absence of evidence.
  it('never drops, even when nothing suspicious is found', () => {
    const result = inspect('enter-exit', 'framer-motion', usageOf({
      'Fade.tsx': `<AnimatePresence><motion.div initial={{ opacity: 0 }} exit={{ opacity: 0 }} /></AnimatePresence>`,
    }))
    expect(result?.verdict).toBe('check')
  })

  it('catches gesture props the old denylist missed', () => {
    const result = inspect('enter-exit', 'framer-motion', usageOf({
      'a.tsx': `<motion.button whileHover={{ scale: 1.1 }} />`,
      'Fade.tsx': `<motion.div exit={{ opacity: 0 }} />`,
    }))
    expect(result?.verdict).toBe('check')
    expect(result?.note).toContain('gesture')
  })

  it.each([
    ['layoutId', `<motion.img layoutId="hero" />`],
    ['motion values', `const y = useTransform(scrollY, [0, 1], [0, 100])`],
    ['variants', `<motion.li variants={item} />`],
  ])('flags %s for review when other files only fade', (_label, source) => {
    const result = inspect('enter-exit', 'framer-motion', usageOf({
      'a.tsx': source,
      'Fade.tsx': `<motion.div exit={{ opacity: 0 }} />`,
    }))
    expect(result?.verdict).toBe('check')
  })

  // An animation library doing animation work is not a finding.
  it('says nothing when every file needs more than CSS', () => {
    const result = inspect('enter-exit', 'framer-motion', usageOf({
      'Gallery.tsx': `<motion.img layoutId="hero" />`,
      'Drag.tsx': `<motion.div drag />`,
    }))
    expect(result).toBeNull()
  })

  it('names the file to look at', () => {
    const result = inspect('enter-exit', 'framer-motion', usageOf({
      'Fade.tsx': `<motion.div exit={{ opacity: 0 }} />`,
      'Gallery.tsx': `<motion.img layoutId="hero" />`,
    }))
    expect(result?.sites).toEqual(['Gallery.tsx'])
  })
})

describe('polyfills', () => {
  it('always drops — the replacement is nothing at all', () => {
    const result = inspect('polyfills', 'whatwg-fetch', usageOf({ 'boot.ts': `import 'whatwg-fetch'` }))
    expect(result?.verdict).toBe('drop')
    expect(result?.note).toContain('window.fetch')
  })
})

describe('dialog', () => {
  it('asks for review rather than deleting markup automatically', () => {
    expect(inspect('dialog', 'react-modal', usageOf({ 'a.tsx': '' }))?.verdict).toBe('check')
  })

  it('tells helper packages they are covered by <dialog> itself', () => {
    const result = inspect('dialog', 'focus-trap-react', usageOf({ 'a.tsx': '' }))
    expect(result?.note).toContain('focus trapping')
  })
})

describe('polyfills — bindings and packages that cannot be judged', () => {
  // `{ ResizeObserver as RO }` binds RO; the global answers to ResizeObserver.
  it('reads the local binding, not the name it was imported under', () => {
    const result = inspect(
      'polyfills',
      'resize-observer-polyfill',
      usageOf({ 'a.js': `new RO(cb)` }, ['ResizeObserver'], ['RO']),
    )
    expect(result?.verdict).toBe('check')
    expect(result?.note).toContain('`RO` is bound to the import')
  })

  // Deleting the import leaves `fetch` resolving to the global of the same name.
  it('drops when the binding matches the native global', () => {
    const result = inspect('polyfills', 'unfetch', usageOf({ 'a.js': `fetch(url)` }, ['fetch']))
    expect(result?.verdict).toBe('drop')
  })

  // `dialogPolyfill.registerDialog()` has nothing to fall back on.
  it('stops at check when a bound name has no global to inherit', () => {
    const result = inspect('polyfills', 'dialog-polyfill', usageOf({ 'a.js': '' }, ['dialogPolyfill']))
    expect(result?.verdict).toBe('check')
    expect(result?.note).toContain('swap the call sites first')
  })

  // core-js-pure is imported per feature, so the package name says nothing about
  // which features are actually in play.
  it('refuses to judge a package that is imported feature by feature', () => {
    const result = inspect('polyfills', 'core-js-pure', usageOf({ 'a.js': '' }, ['structuredClone']))
    expect(result?.verdict).toBe('check')
    expect(result?.note).toContain('cannot be judged')
  })

  it('refuses to judge a polyfill that also serves the server runtime', () => {
    const result = inspect('polyfills', 'isomorphic-fetch', usageOf({ 'a.js': '' }))
    expect(result?.verdict).toBe('check')
    expect(result?.note).toContain('Node')
  })
})

describe('imports the scanner cannot see into', () => {
  // `foo(require('x'))` may be feeding a name that has to survive the deletion.
  it('stops a polyfill at check when the binding cannot be read', () => {
    const result = inspect(
      'polyfills',
      'resize-observer-polyfill',
      usageOf({ 'a.js': `register(require('resize-observer-polyfill'))` }, [], [], true),
    )
    expect(result?.verdict).toBe('check')
    expect(result?.note).toContain('binding cannot be read')
  })

  // require() and dynamic import() carry no specifiers. An empty set is the
  // absence of evidence, not evidence that every import is covered.
  it('does not read "no specifiers" as "all specifiers are safe"', () => {
    const result = inspect('floating-ui', '@floating-ui/dom', usageOf({ 'a.js': `require('@floating-ui/dom')` }))
    expect(result?.verdict).toBe('check')
    expect(result?.note).toContain('without named imports')
  })
})
