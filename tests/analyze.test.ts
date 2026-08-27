import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { analyze } from '../src/index.js'
import { rules } from '../src/rules/index.js'
import { render } from '../src/report.js'
import type { Finding, Report } from '../src/types.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const APP = join(FIXTURES, 'app')

function verdictOf(report: Report, pkg: string): Finding['verdict'] | undefined {
  return report.findings.find((f) => f.pkg === pkg)?.verdict
}

describe('analyze', () => {
  let report: Report

  beforeAll(async () => {
    report = await analyze(APP, { measure: false })
  })

  it('judges each package against the project browserslist', () => {
    expect(verdictOf(report, 'whatwg-fetch')).toBe('drop')
    expect(verdictOf(report, '@floating-ui/react')).toBe('drop')
    expect(verdictOf(report, 'framer-motion')).toBe('check')
    expect(verdictOf(report, 'react-modal')).toBe('check')
    expect(verdictOf(report, 'aos')).toBe('not-yet')
  })

  it('ignores packages no rule claims', () => {
    expect(report.findings.some((f) => f.pkg === 'left-behind')).toBe(false)
  })

  it('reports a declared dependency even with no import in the source', () => {
    const finding = report.findings.find((f) => f.pkg === 'intersection-observer')
    expect(finding).toMatchObject({ declared: true, files: [] })
  })

  it('sorts drop first and not-yet last', () => {
    const order = report.findings.map((f) => f.verdict)
    expect(order).toEqual([...order].sort((a, b) => {
      const rank = { drop: 0, check: 1, 'not-yet': 2 } as const
      return rank[a] - rank[b]
    }))
  })

  it('explains a not-yet verdict with the browser that falls short', () => {
    const aos = report.findings.find((f) => f.pkg === 'aos')
    expect(aos?.note).toContain('firefox')
    expect(aos?.support.blockers.length).toBeGreaterThan(0)
  })

  it('points at the file that blocks a check verdict', () => {
    expect(report.findings.find((f) => f.pkg === 'framer-motion')?.sites).toEqual(['src/Gallery.jsx'])
  })

  // The whole premise: same code, different targets, different answer.
  it('flips a verdict when the targets change', async () => {
    const old = await analyze(APP, { measure: false, targets: 'safari >= 18, chrome >= 130, firefox >= 132' })
    expect(verdictOf(old, '@floating-ui/react')).toBe('not-yet')

    const modern = await analyze(APP, { measure: false, targets: 'safari >= 26.2, chrome >= 145, firefox >= 148' })
    expect(verdictOf(modern, '@floating-ui/react')).toBe('drop')
  })

  it('finds nothing in a project with no outgrown dependencies', async () => {
    const clean = await analyze(join(FIXTURES, 'clean'), { measure: false })
    expect(clean.findings).toHaveLength(0)
  })

  it('skips sizing when measure is false', () => {
    expect(report.findings.every((f) => f.size === null)).toBe(true)
  })
})

describe('render', () => {
  it('shows verdict badges, targets and the biggest blocker', async () => {
    const output = render(await analyze(APP, { measure: false }))

    expect(output).toContain('DROP')
    expect(output).toContain('NOT YET')
    expect(output).toContain('targets (browserslist project config)')
    expect(output).toContain('Biggest blocker')
  })

  it('says so plainly when there is nothing to drop', async () => {
    const output = render(await analyze(join(FIXTURES, 'clean'), { measure: false }))
    expect(output).toContain('Nothing to drop.')
  })
})

describe('data source', () => {
  it('reports which dataset answered', async () => {
    const report = await analyze(APP, { measure: false })
    expect(report.data.source).toBe('web-features')
    expect(report.data.version).toMatch(/^\d+\./)
  })

  it('shows the dataset in the rendered output', async () => {
    const output = render(await analyze(APP, { measure: false }))
    expect(output).toContain('data: web-features@')
  })
})

describe('coverage disclosure', () => {
  it('counts the rules and packages that were actually checked', async () => {
    const report = await analyze(APP, { measure: false })

    expect(report.coverage.rules).toBe(rules.length)
    expect(report.coverage.packages).toBe(new Set(rules.flatMap((r) => r.packages)).size)
  })

  // A clean report must never read as "your project is clean".
  it('states the scope even when nothing was found', async () => {
    const output = render(await analyze(join(FIXTURES, 'clean'), { measure: false }))

    expect(output).toContain('Nothing to drop.')
    expect(output).toMatch(/checked \d+ known packages across \d+ rules/)
    expect(output).toContain('a curated set, not every dependency you have')
    expect(output).toContain('not the same as your dependencies being clean')
  })

  it('states the scope alongside findings too', async () => {
    const output = render(await analyze(APP, { measure: false }))
    expect(output).toMatch(/checked \d+ known packages across \d+ rules/)
  })

  // A verdict is advice, not a decision — the reader has to stay in the loop.
  it('says it advises rather than decides', async () => {
    const output = render(await analyze(APP, { measure: false }))
    expect(output).toContain('outgrown advises, it does not decide')
    expect(output).toContain('run your tests')
  })
})
