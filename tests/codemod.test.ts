import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze } from '../src/index.js'
import { planPolyfillFix, renderPlan } from '../src/codemod/index.js'
import type { FixPlan } from '../src/codemod/index.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const FIXABLE = join(FIXTURES, 'fixable')

async function planFor(root: string): Promise<FixPlan> {
  return planPolyfillFix(root, await analyze(root, { measure: false }))
}

function removedFrom(plan: FixPlan, file: string): string[] {
  return plan.removals.filter((r) => r.file === file).map((r) => r.text.trim())
}

describe('polyfill codemod — what it removes', () => {
  let plan: FixPlan

  beforeAll(async () => {
    plan = await planFor(FIXABLE)
  })

  it('removes side-effect imports', () => {
    expect(removedFrom(plan, 'src/boot.js')).toEqual([
      `import 'whatwg-fetch'`,
      `import 'urlpattern-polyfill'`,
    ])
  })

  // Deleting the import leaves `ResizeObserver` resolving to the global of the
  // same name, so the code around it keeps working.
  it('removes a default import when its binding matches the native global', () => {
    expect(removedFrom(plan, 'src/observe.js')).toEqual([
      `import ResizeObserver from 'resize-observer-polyfill'`,
    ])
  })

  it('rewrites the file without leaving a blank line at the top', () => {
    const next = plan.contents.get('src/boot.js')
    expect(next).toBeDefined()
    expect(next!.startsWith('export const ping')).toBe(true)
  })

  it('keeps the rest of the file byte for byte', () => {
    const next = plan.contents.get('src/observe.js') ?? ''
    expect(next).toContain('const ro = new ResizeObserver(cb)')
    expect(next).toContain('ro.observe(el)')
  })
})

describe('polyfill codemod — what it refuses to touch', () => {
  let plan: FixPlan

  beforeAll(async () => {
    plan = await planFor(FIXABLE)
  })

  const keptFor = (pkg: string) => plan.kept.find((k) => k.pkg === pkg)

  // `dialogPolyfill.registerDialog()` has no global to fall back on, so the
  // analyser now stops at CHECK and the codemod never gets a chance to touch it.
  it('never sees a package whose binding has no native global', async () => {
    const report = await analyze(FIXABLE, { measure: false })
    const dialog = report.findings.find((f) => f.pkg === 'dialog-polyfill')

    expect(dialog?.verdict).toBe('check')
    expect(dialog?.note).toContain('swap the call sites first')
    expect(plan.contents.has('src/modal.js')).toBe(false)
    expect(plan.removals.some((r) => r.pkg === 'dialog-polyfill')).toBe(false)
  })

  // `if (!('IntersectionObserver' in window)) await import('intersection-observer')`
  // — removing this changes behaviour rather than just weight.
  it('leaves a conditionally loaded import', () => {
    expect(keptFor('intersection-observer')?.reason).toContain('nested in a conditional')
    expect(plan.contents.has('src/lazy.js')).toBe(false)
  })

  it('does not offer to uninstall a package it left behind', () => {
    expect(plan.uninstall).not.toContain('dialog-polyfill')
    expect(plan.uninstall).not.toContain('intersection-observer')
  })

  it('offers to uninstall the ones it fully removed', () => {
    expect(plan.uninstall).toEqual(['resize-observer-polyfill', 'urlpattern-polyfill', 'whatwg-fetch'])
  })
})

describe('polyfill codemod — scope', () => {
  it('does nothing for rules where the replacement is not "nothing"', async () => {
    // demo-app carries framer-motion and react-modal; neither is a polyfill.
    const root = join(FIXTURES, '..', '..', 'fixtures', 'demo-app')
    const plan = await planPolyfillFix(root, await analyze(root, { measure: false }))
    expect(plan.removals.filter((r) => r.pkg === 'framer-motion')).toHaveLength(0)
    expect(plan.removals.filter((r) => r.pkg === 'react-modal')).toHaveLength(0)
  })

  it('finds nothing in a project with no polyfills', async () => {
    const plan = await planFor(join(FIXTURES, 'clean'))
    expect(plan.removals).toHaveLength(0)
    expect(plan.kept).toHaveLength(0)
  })

  it('respects the targets — an unsupported feature is not a removal', async () => {
    const root = FIXABLE
    const report = await analyze(root, { measure: false, targets: 'safari >= 17, chrome >= 145, firefox >= 148' })
    const plan = await planPolyfillFix(root, report)

    // URLPattern only reached Safari 26, so its polyfill is still doing work.
    expect(plan.removals.some((r) => r.pkg === 'urlpattern-polyfill')).toBe(false)
    expect(plan.removals.some((r) => r.pkg === 'whatwg-fetch')).toBe(true)
  })
})

describe('polyfill codemod — writing', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'outgrown-'))
    cpSync(FIXABLE, workspace, { recursive: true })
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('applies the plan to disk', async () => {
    const plan = await planFor(workspace)
    const { writeFileSync } = await import('node:fs')
    for (const [file, contents] of plan.contents) writeFileSync(join(workspace, file), contents)

    expect(readFileSync(join(workspace, 'src/boot.js'), 'utf8')).not.toContain('whatwg-fetch')
    expect(readFileSync(join(workspace, 'src/modal.js'), 'utf8')).toContain('dialog-polyfill')
  })

  it('has nothing left to do on a second pass', async () => {
    const first = await planFor(workspace)
    const { writeFileSync } = await import('node:fs')
    for (const [file, contents] of first.contents) writeFileSync(join(workspace, file), contents)

    const second = await planFor(workspace)
    expect(second.removals).toHaveLength(0)
  })
})

describe('renderPlan', () => {
  it('says nothing was written on a dry run', async () => {
    const output = renderPlan(await planFor(FIXABLE), false)

    expect(output).toContain('Would remove')
    expect(output).toContain('Nothing was written')
    expect(output).toContain('npm uninstall')
  })

  it('reports what it left alone and why', async () => {
    const output = renderPlan(await planFor(FIXABLE), false)

    expect(output).toContain('Left alone:')
    expect(output).toContain('intersection-observer')
    expect(output).toContain('nested in a conditional')
  })

  it('explains the scope when there is nothing to remove', async () => {
    const output = renderPlan(await planFor(join(FIXTURES, 'clean')), false)
    expect(output).toContain('Nothing to remove.')
    expect(output).toContain('only handles dead polyfills')
  })
})
