import { rules } from './rules/index.js'
import { readManifest, scanProject } from './scan.js'
import { measure } from './size.js'
import { createResolver, evaluate } from './support.js'
import { resolveTargets } from './targets.js'
import type { AnalyzeOptions, Finding, Report, Support, Verdict } from './types.js'

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
        const seen = usage ?? { files: new Map(), specifiers: new Set<string>() }
        const inspection = rule.inspect({ pkg, usage: seen, project })
        verdict = inspection.verdict
        note = inspection.note
        sites = inspection.sites
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

  return {
    targets,
    project: { fileCount: project.fileCount, ...(manifest?.name ? { name: manifest.name } : {}) },
    data: { source: resolver.source, version: resolver.version },
    coverage: {
      rules: rules.length,
      packages: new Set(rules.flatMap((rule) => rule.packages)).size,
    },
    findings,
  }
}

function describeBlockers({ blockers, missing }: Support): string {
  if (missing.length) return `No support data found for: ${missing.join(', ')}`

  const seen = new Set<string>()
  for (const blocker of blockers) {
    seen.add(blocker.needed ? `${blocker.browser} ${blocker.mine} < ${blocker.needed}` : `${blocker.browser} unsupported`)
  }
  return [...seen].join(' · ')
}
