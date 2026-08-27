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

describe('size reporting', () => {
  // The number is the whole package, not what this build would actually save.
  it('labels the total as an upper bound', async () => {
    const output = render(await analyze(join(FIXTURES, 'fixable'), { measure: true }))

    if (!output.includes('gzip if all of those go')) return // esbuild not installed
    expect(output).toContain('Up to')
    expect(output).toContain('upper bound')
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

describe('projects with no browserslist', () => {
  const NO_CONFIG = join(FIXTURES, 'no-browserslist')

  it('stands a stated policy in for the browserslist it does not have', async () => {
    const report = await analyze(NO_CONFIG, { measure: false })
    expect(report.targets.source).toBe('assumed')
    expect(report.assumed?.query).toBe('baseline widely available')
  })

  // browserslist' own defaults are market-share based: they carry op_mini and
  // kaios, which web-features cannot judge, so every verdict would be capped.
  it('does not fall back to a query full of unjudgeable browsers', async () => {
    const report = await analyze(NO_CONFIG, { measure: false })
    expect(report.targets.noData).toEqual([])
    expect(report.targets.derivative).toEqual([])
  })

  it('offers both ends of the policy trade, with what each opens', async () => {
    const report = await analyze(NO_CONFIG, { measure: false })
    const queries = report.assumed?.alternatives.map((a) => a.query)

    expect(queries).toEqual(['baseline newly available', 'defaults'])
    for (const alternative of report.assumed?.alternatives ?? []) {
      expect(alternative.floor).toContain('chrome')
      expect(alternative.wouldOpen).toBeGreaterThanOrEqual(0)
    }
  })

  it('warns before the verdicts, not after', async () => {
    const output = render(await analyze(NO_CONFIG, { measure: false }))
    expect(output).toContain('This project has no browserslist')
    expect(output).toContain('an assumption, not your policy')

    // The arrow only appears inside a finding, so it marks where the verdicts start.
    expect(output.indexOf('no browserslist')).toBeLessThan(output.indexOf('→'))
  })

  it('says nothing about assumptions when the project has its own config', async () => {
    const report = await analyze(APP, { measure: false })
    expect(report.assumed).toBeUndefined()
  })
})

describe('unjudgeable targets', () => {
  const R1 = join(FIXTURES, 'no-browserslist')

  // Left alone, every requirement passes vacuously and the whole report reads DROP.
  it('refuses to judge when nothing judgeable is left', async () => {
    await expect(analyze(R1, { measure: false, targets: 'ie 11' })).rejects.toThrow(/no judgeable browsers/)
    await expect(analyze(R1, { measure: false, targets: 'safari TP' })).rejects.toThrow(/no judgeable browsers/)
  })

  // "ie 11 will never support this" was a claim with no data behind it — IE has
  // requestAnimationFrame. Unverified is not unsupported.
  it('withholds drop without claiming a feature is unsupported', async () => {
    const report = await analyze(R1, { measure: false, targets: 'ie 11, chrome 145, firefox 152, safari 26.2' })

    expect(report.findings.some((f) => f.verdict === 'drop')).toBe(false)
    expect(report.findings.some((f) => f.verdict === 'check')).toBe(true)
    expect(report.findings.find((f) => f.verdict === 'check')?.note).toContain('ie 11')
  })

  it('treats an unparseable version the same as an unjudgeable browser', async () => {
    const clean = await analyze(R1, { measure: false, targets: 'chrome 145, firefox 152, safari 26.2' })
    expect(clean.findings.some((f) => f.verdict === 'drop')).toBe(true)

    const withUnknown = await analyze(R1, { measure: false, targets: 'chrome 145, firefox 152, safari 26.2, samsung 27' })
    expect(withUnknown.findings.some((f) => f.verdict === 'drop')).toBe(false)
  })

  it('lets safari TP through when a stable Safari is judged alongside it', async () => {
    const report = await analyze(R1, { measure: false, targets: 'safari TP, chrome 145, firefox 152, safari 26.2' })
    expect(report.findings.some((f) => f.verdict === 'drop')).toBe(true)
  })

  // Without a stable Safari, TP is the only thing constraining Safari — skipping
  // it would judge Safari not at all.
  it('withholds drop when a preview is the only version of its browser', async () => {
    const report = await analyze(R1, { measure: false, targets: 'safari TP, chrome 145, firefox 152' })
    expect(report.findings.some((f) => f.verdict === 'drop')).toBe(false)
  })

  // Samsung Internet trails Chrome by an unknown amount and web-features has no
  // data for it: enough to withhold a DROP, not enough to say unsupported.
  it('downgrades drop to check when an engine derivative is in the query', async () => {
    const clean = await analyze(R1, { measure: false, targets: 'chrome 145, firefox 152, safari 26.2' })
    const withSamsung = await analyze(R1, { measure: false, targets: 'chrome 145, firefox 152, safari 26.2, samsung 27' })

    expect(clean.findings.some((f) => f.verdict === 'drop')).toBe(true)
    expect(withSamsung.findings.some((f) => f.verdict === 'drop')).toBe(false)
    expect(withSamsung.findings.some((f) => f.verdict === 'check')).toBe(true)
  })

  it('says which targets it could not judge, above the verdicts', async () => {
    const output = render(await analyze(R1, { measure: false, targets: 'ie 11, chrome 145, firefox 152, safari 26.2' }))
    expect(output).toContain('unverified for ie 11')
    expect(output).toContain('nothing here can be a DROP')
  })
})

describe('projects the browser targets may not apply to', () => {
  it('assumes a Baseline policy rather than browserslist defaults', async () => {
    const report = await analyze(join(FIXTURES, 'nodeish'), { measure: false })

    expect(report.targets.source).toBe('assumed')
    expect(report.targets.assumedQuery).toBe('baseline widely available')
    // browserslist' own defaults carry op_mini and kaios, which would cap
    // every verdict and leave the report empty.
    expect(report.targets.noData).toEqual([])
  })

  it('says so when the source reads like it runs on Node', async () => {
    const output = render(await analyze(join(FIXTURES, 'nodeish'), { measure: false }))
    expect(output).toContain('if this runs on Node, browser targets do not apply')
  })
})

describe('workspaces', () => {
  const WORKSPACE = join(FIXTURES, 'workspace')

  // A clean report at a workspace root says nothing about the packages under it.
  it('reports the packages the scan stopped at', async () => {
    const report = await analyze(WORKSPACE, { measure: false })

    expect(report.skipped.sort()).toEqual(['packages/one', 'packages/two'])
    expect(report.findings).toHaveLength(0)
  })

  it('says they were not scanned rather than implying a clean sweep', async () => {
    const output = render(await analyze(WORKSPACE, { measure: false }))
    expect(output).toContain('nested packages not scanned')
    expect(output).toContain('--workspaces')
  })

  it('finds what the root could not, once pointed at a package', async () => {
    const report = await analyze(join(WORKSPACE, 'packages/one'), { measure: false })
    expect(report.findings.some((f) => f.pkg === 'whatwg-fetch' && f.verdict === 'drop')).toBe(true)
  })
})
