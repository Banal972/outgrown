import { rules } from './rules/index.js'
import { readManifest, scanProject } from './scan.js'
import { measure } from './size.js'
import { createResolver, evaluate } from './support.js'
import { resolveTargets } from './targets.js'
import type { AnalyzeOptions, FeatureResolver, Finding, Report, Support, Targets, Verdict } from './types.js'

export type * from './types.js'
export { resolveTargets } from './targets.js'
export { createResolver, bundledResolver, evaluate } from './support.js'
export { rules } from './rules/index.js'

const ORDER: Record<Verdict, number> = { drop: 0, check: 1, 'not-yet': 2 }

/**
 * browserslist × Baseline.
 *
 * Not "which dependencies are unused" — that is what knip and depcheck answer.
 * This asks which dependencies are still imported and working, while the browser
 * has quietly taken over the job.
 */
export async function analyze(root: string, options: AnalyzeOptions = {}): Promise<Report> {
  const targets = resolveTargets(root, options.targets)

  // With nothing judgeable left, every requirement would pass vacuously and the
  // whole report would read DROP. Refuse instead.
  if (!Object.keys(targets.minimums).length) {
    throw new Error(
      'no judgeable browsers in these targets' +
        (targets.ignored.length ? ` (only ${targets.ignored.join(', ')})` : '') +
        '. web-features covers the Baseline core browsers; give it at least one of those.',
    )
  }

  const manifest = readManifest(root)

  const declared = new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ])

  const resolver = await createResolver()
  const project = scanProject(root)
  const findings: Finding[] = []

  for (const rule of rules) {
    for (const pkg of rule.packages) {
      const usage = project.usage.get(pkg)
      const isDeclared = declared.has(pkg)
      if (!usage && !isDeclared) continue

      const requirements = rule.requirementsFor?.(pkg) ?? rule.requirements ?? []
      const support = evaluate(requirements, targets.minimums, resolver)

      let verdict: Verdict
      let note: string
      let sites: string[] | undefined

      if (support.supported) {
        const seen = usage ?? { files: new Map(), specifiers: new Set<string>(), bindings: new Set<string>(), opaque: false }
        const inspection = rule.inspect({ pkg, usage: seen, project })
        // Nothing to say: the feature exists, but this project uses the library
        // for things the platform still cannot do.
        if (!inspection) continue
        verdict = inspection.verdict
        note = inspection.note
        sites = inspection.sites

        // One rule for every target that could not be judged, whatever the
        // reason: unverified is not the same as unsupported, and a DROP has to be
        // established against all of them, not most of them.
        const unjudged = unjudgedTargets(targets)
        if (unjudged.length && verdict === 'drop') {
          verdict = 'check'
          note = `${note} Unverified for ${unjudged.join(', ')} — web-features has no data for them.`
        }
      } else {
        verdict = 'not-yet'
        note = describeBlockers(support)
      }

      findings.push({
        rule: rule.id,
        title: rule.title,
        pkg,
        verdict,
        note,
        sites,
        replacement: rule.replacementFor?.(pkg) ?? rule.replacement ?? '',
        ...(rule.nativeGlobalFor?.(pkg) ? { nativeGlobal: rule.nativeGlobalFor(pkg) } : {}),
        docs: rule.docsFor?.(pkg) ?? rule.docs,
        files: usage ? [...usage.files.keys()] : [],
        imports: usage ? [...usage.specifiers] : [],
        declared: isDeclared,
        size: options.measure === false ? null : await measure(pkg, root),
        support,
      })
    }
  }

  findings.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.pkg.localeCompare(b.pkg))

  const assumed =
    targets.source === 'default' ? measureAssumption(root, findings, targets, resolver) : undefined

  return {
    targets,
    project: { fileCount: project.fileCount, ...(manifest?.name ? { name: manifest.name } : {}) },
    data: { source: resolver.source, version: resolver.version },
    ...(assumed ? { assumed } : {}),
    coverage: {
      rules: rules.length,
      packages: new Set(rules.flatMap((rule) => rule.packages)).size,
    },
    findings,
  }
}

/**
 * Two queries browserslist understands, deliberately not one.
 *
 * Picking a support policy is a trade, and showing both ends of it is more honest
 * than recommending a number: "widely available" is 30+ months of support in every
 * core browser, "newly available" is however new the slowest browser is today.
 */
const ALTERNATIVES = ['baseline widely available', 'baseline newly available'] as const

/**
 * Without a browserslist, the fallback is browserslist's own defaults — which
 * still carry chrome 109, the last version for Windows 7/8. Re-judging the
 * blocked findings against a real modern target turns that from an invisible
 * assumption into a number.
 */
function measureAssumption(
  root: string,
  findings: Finding[],
  targets: Targets,
  resolver: FeatureResolver,
) {
  const blocked = findings.filter((finding) => finding.verdict === 'not-yet')

  // "Oldest" only means something within one browser — chrome 109 and safari 18
  // are not comparable numbers. Measure each against its own latest release and
  // take the one furthest behind.
  const latest = resolveTargets(root, 'last 1 version').minimums
  let oldest = ''
  let widestGap = 0
  for (const [browser, version] of Object.entries(targets.minimums)) {
    const current = latest[browser as keyof typeof latest]
    if (!current) continue
    const gap = Number(current.split('.')[0]) - Number(version.split('.')[0])
    if (gap > widestGap) {
      widestGap = gap
      oldest = `${browser} ${version}`
    }
  }

  const alternatives = []

  for (const query of ALTERNATIVES) {
    let resolved
    try {
      resolved = resolveTargets(root, query)
    } catch {
      continue
    }

    const wouldOpen = blocked.filter((finding) => {
      const rule = rules.find((candidate) => candidate.id === finding.rule)
      if (!rule) return false
      const requirements = rule.requirementsFor?.(finding.pkg) ?? rule.requirements ?? []
      return evaluate(requirements, resolved.minimums, resolver).supported
    }).length

    const floor = (['chrome', 'firefox', 'safari'] as const)
      .map((browser) => (resolved.minimums[browser] ? `${browser} ${resolved.minimums[browser]}` : null))
      .filter(Boolean)
      .join(', ')

    alternatives.push({ query, floor, wouldOpen })
  }

  return { oldest, alternatives }
}

/**
 * Everything in the query no verdict can be established against.
 *
 * Deliberately one list. "ie 11 will never support this" was a claim with no data
 * behind it — IE has requestAnimationFrame — and Samsung Internet's lag is just as
 * unmeasurable. Unverified is not unsupported, and neither is a DROP.
 */
export function unjudgedTargets(targets: Targets): string[] {
  return [...targets.noData, ...targets.derivative, ...targets.unknownVersions]
}

function describeBlockers({ blockers, missing }: Support): string {
  if (missing.length) return `No support data found for: ${missing.join(', ')}`

  const seen = new Set<string>()
  for (const blocker of blockers) {
    seen.add(blocker.needed ? `${blocker.browser} ${blocker.mine} < ${blocker.needed}` : `${blocker.browser} unsupported`)
  }
  return [...seen].join(' · ')
}
