import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { compareVersions, resolveTargets } from '../src/targets.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('compareVersions', () => {
  it('orders by numeric segment, not string', () => {
    expect(compareVersions('9', '10')).toBeLessThan(0)
    expect(compareVersions('26.10', '26.9')).toBeGreaterThan(0)
  })

  it('treats missing segments as zero', () => {
    expect(compareVersions('18', '18.0')).toBe(0)
    expect(compareVersions('18', '18.3')).toBeLessThan(0)
  })
})

describe('resolveTargets', () => {
  it('reads the project browserslist and maps to core browser keys', () => {
    const targets = resolveTargets(join(FIXTURES, 'app'))

    expect(targets.source).toBe('project')
    expect(targets.minimums).toMatchObject({
      chrome: '145',
      firefox: '148',
      safari: '26.2',
      safari_ios: '26.2',
      edge: '145',
    })
  })

  it('keeps the lowest version when a browser appears more than once', () => {
    const targets = resolveTargets(FIXTURES, 'chrome 120, chrome 100, chrome 130')
    expect(targets.minimums.chrome).toBe('100')
  })

  it('takes the low end of a version range', () => {
    const targets = resolveTargets(FIXTURES, 'ios_saf 16.0-16.3')
    expect(targets.minimums.safari_ios).toBe('16.0')
  })

  it('reports non-core browsers instead of silently dropping them', () => {
    const targets = resolveTargets(FIXTURES, 'chrome 130, samsung 27, op_mini all')

    expect(targets.minimums.chrome).toBe('130')
    expect(targets.ignored).toEqual(expect.arrayContaining(['samsung', 'op_mini']))
    expect(targets.minimums).not.toHaveProperty('samsung')
  })

  it('sets source to override when a query is passed', () => {
    expect(resolveTargets(join(FIXTURES, 'app'), 'chrome 130').source).toBe('override')
  })
})

describe('browsers that cannot be judged', () => {
  it('separates browsers with no data from engine derivatives', () => {
    const targets = resolveTargets(FIXTURES, 'ie 11, samsung 27, chrome 145')

    expect(targets.noData).toEqual(['ie 11'])
    expect(targets.derivative).toEqual(['samsung'])
    expect(targets.minimums.chrome).toBe('145')
  })

  // Baidu Browser is Chromium — it does get these features, unlike IE.
  it('does not treat a Chromium derivative as having no data', () => {
    const targets = resolveTargets(FIXTURES, 'baidu 13, chrome 145')
    expect(targets.noData).toEqual([])
    expect(targets.derivative).toContain('baidu')
  })

  // Technology Preview only becomes redundant once a stable Safari is in the
  // query too. Alone, it is the only thing constraining Safari.
  it('ignores a preview version only when a stable one is also present', () => {
    const withStable = resolveTargets(FIXTURES, 'safari TP, safari 26.2, chrome 145')
    expect(withStable.aheadOfStable).toEqual(['safari TP'])
    expect(withStable.unknownVersions).toEqual([])

    const alone = resolveTargets(FIXTURES, 'safari TP, chrome 145')
    expect(alone.aheadOfStable).toEqual([])
    expect(alone.unknownVersions).toEqual(['safari TP'])
  })
})
