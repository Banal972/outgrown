import { bundledResolver, createResolver, evaluate } from '../src/support.js'
import { rules } from '../src/rules/index.js'
import type { FeatureResolver, Minimums, Requirement } from '../src/types.js'

const MODERN: Minimums = { chrome: '145', firefox: '148', safari: '26.2', safari_ios: '26.2', edge: '145' }
const OLD: Minimums = { chrome: '100', firefox: '100', safari: '15', safari_ios: '15', edge: '100' }

/** Every requirement the built-in rules can ask for. */
function allRequirements(): Requirement[] {
  const seen = new Set<Requirement>()
  for (const rule of rules) {
    for (const requirement of rule.requirements ?? []) seen.add(requirement)
    if (!rule.requirementsFor) continue
    for (const pkg of rule.packages) {
      for (const requirement of rule.requirementsFor(pkg)) seen.add(requirement)
    }
  }
  return [...seen]
}

describe('evaluate', () => {
  let live: FeatureResolver

  beforeAll(async () => {
    live = await createResolver()
  })

  it('passes a feature every target supports', () => {
    const result = evaluate(['feature:fetch'], MODERN, live)
    expect(result.supported).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it('names the browser and the version it falls short by', () => {
    const result = evaluate(['feature:starting-style'], { safari: '17.0' }, live)

    expect(result.supported).toBe(false)
    expect(result.blockers).toEqual([
      expect.objectContaining({ browser: 'safari', mine: '17.0', needed: '17.5' }),
    ])
  })

  it('marks a browser with no support at all as needed: null', () => {
    // Firefox has not shipped scroll-driven animations.
    const result = evaluate(['feature:scroll-driven-animations'], { firefox: '148' }, live)

    expect(result.supported).toBe(false)
    expect(result.blockers[0]).toMatchObject({ browser: 'firefox', needed: null })
  })

  it('never treats an unknown requirement as supported', () => {
    const result = evaluate(['feature:definitely-not-a-real-feature'], MODERN, live)

    expect(result.supported).toBe(false)
    expect(result.missing).toEqual(['feature:definitely-not-a-real-feature'])
    expect(result.blockers).toHaveLength(0)
  })

  it('fails when any single target falls short', () => {
    expect(evaluate(['feature:popover'], OLD, live).supported).toBe(false)
    expect(evaluate(['feature:popover'], { ...MODERN, safari_ios: '17.0' }, live).supported).toBe(false)
  })

  it('collects blockers across every requirement', () => {
    const result = evaluate(['feature:starting-style', 'feature:popover'], { safari: '15' }, live)
    expect(result.blockers).toHaveLength(2)
  })
})

describe('live resolver', () => {
  let live: FeatureResolver

  beforeAll(async () => {
    live = await createResolver()
  })

  it('is used when web-features is installed', () => {
    expect(live.source).toBe('web-features')
  })

  it('resolves BCD keys, not just whole features', () => {
    // `anchor-positioning` as a feature is not Baseline, but these parts are.
    expect(evaluate(['bcd:css.properties.anchor-name', 'bcd:css.at-rules.position-try'], MODERN, live).supported).toBe(true)
    expect(evaluate(['feature:anchor-positioning'], MODERN, live).supported).toBe(false)
  })

  // web-features keeps entries for ids that moved or were split. Reading
  // `.status` off one of those throws — they must resolve or be reported as
  // missing, never crash.
  it('follows a moved feature id to its successor', () => {
    expect(evaluate(['feature:grid-lanes'], MODERN, live).missing).toHaveLength(0)
  })

  it('treats a split feature id as unknown rather than guessing', () => {
    const split = evaluate(['feature:text-wrap-style'], MODERN, live)
    expect(split.supported).toBe(false)
    expect(split.missing).toEqual(['feature:text-wrap-style'])
  })
})

describe('bundled slice', () => {
  const bundled = bundledResolver()

  it('answers every requirement the built-in rules declare', () => {
    for (const requirement of allRequirements()) {
      expect([requirement, bundled.lookup(requirement) !== null]).toEqual([requirement, true])
    }
  })

  it('agrees with web-features on everything it covers', async () => {
    const live = await createResolver()
    for (const requirement of allRequirements()) {
      expect([requirement, bundled.lookup(requirement)?.support])
        .toEqual([requirement, live.lookup(requirement)?.support])
    }
  })

  it('reports anything outside the slice as missing rather than supported', () => {
    expect(bundled.lookup('feature:anchor-positioning')).toBeNull()
    expect(evaluate(['feature:anchor-positioning'], MODERN, bundled).supported).toBe(false)
  })

  it('carries the date it was generated', () => {
    expect(bundled.version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
