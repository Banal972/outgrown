import { COMPAT_KEYS, FEATURES, GENERATED_AT } from './data/baseline.generated.js'
import { compareVersions } from './targets.js'
import type { BrowserKey, Blocker, FeatureResolver, Minimums, Requirement, Support } from './types.js'

interface SupportEntry {
  label: string
  support: Partial<Record<BrowserKey, string>>
}

/**
 * The shape we actually read, declared here rather than inferred.
 *
 * web-features' own union resolves differently under NodeNext and Bundler, which
 * made the same code compile in one config and fail in the other. One structural
 * type keeps both honest.
 */
interface RawFeature {
  name?: string
  kind?: string
  redirect_target?: string
  status?: {
    support?: Record<string, string>
    by_compat_key?: Record<string, { support?: Record<string, string> } | undefined>
  }
}

type RealFeature = RawFeature & { status: NonNullable<RawFeature['status']> }

function isRealFeature(entry: RawFeature | undefined): entry is RealFeature {
  return entry?.status !== undefined
}

function splitRequirement(requirement: Requirement): { kind: string; id: string } {
  const separator = requirement.indexOf(':')
  return { kind: requirement.slice(0, separator), id: requirement.slice(separator + 1) }
}

/**
 * Resolver over the slice generated from the rules.
 *
 * Enough to answer every requirement the built-in rules declare, and nothing else
 * — the full dataset is 4.5MB, this is a few kilobytes.
 */
export function bundledResolver(): FeatureResolver {
  return {
    source: 'bundled',
    version: GENERATED_AT,
    lookup(requirement) {
      const { kind, id } = splitRequirement(requirement)
      if (kind === 'feature') {
        const feature = FEATURES[id]
        return feature ? { label: feature.name, support: feature.support } : null
      }
      const key = COMPAT_KEYS[id]
      return key ? { label: id, support: key.support } : null
    },
  }
}

/**
 * Resolver over the installed `web-features` package.
 *
 * Answers requirements the slice never saw — custom rules, or a feature id added
 * after this release — and tracks browser support as it lands rather than as of
 * the last publish.
 */
function liveResolver(features: Record<string, RawFeature | undefined>, version: string): FeatureResolver {
  /** Tombstones: `moved` redirects to one successor, `split` to several (no single answer). */
  function resolveFeature(id: string, depth = 0): RealFeature | null {
    const entry = features[id]
    if (isRealFeature(entry)) return entry
    if (!entry || depth > 3) return null
    if (entry.kind === 'moved' && entry.redirect_target) return resolveFeature(entry.redirect_target, depth + 1)
    return null
  }

  return {
    source: 'web-features',
    version,
    lookup(requirement) {
      const { kind, id } = splitRequirement(requirement)

      if (kind === 'feature') {
        const feature = resolveFeature(id)
        if (!feature) return null
        return {
          label: feature.name ?? id,
          support: (feature.status.support ?? {}) as SupportEntry['support'],
        }
      }

      for (const feature of Object.values(features)) {
        if (!isRealFeature(feature)) continue
        const entry = feature.status.by_compat_key?.[id]
        if (entry) return { label: id, support: (entry.support ?? {}) as SupportEntry['support'] }
      }
      return null
    },
  }
}

let cached: FeatureResolver | undefined

/**
 * Prefer the installed `web-features` (optional peer, always current), fall back
 * to the bundled slice. Which one answered is reported, never guessed at.
 */
export async function createResolver(): Promise<FeatureResolver> {
  if (cached) return cached

  try {
    const mod = (await import('web-features')) as { features: Record<string, RawFeature | undefined> }
    const version = await readWebFeaturesVersion()
    cached = liveResolver(mod.features, version)
  } catch {
    cached = bundledResolver()
  }

  return cached
}

/**
 * web-features' `exports` map does not expose ./package.json, so resolve the
 * entry point and read the manifest sitting next to it.
 */
async function readWebFeaturesVersion(): Promise<string> {
  try {
    const [{ createRequire }, { readFileSync }, { dirname, join }] = await Promise.all([
      import('node:module'),
      import('node:fs'),
      import('node:path'),
    ])

    const require = createRequire(import.meta.url)
    const entry = require.resolve('web-features')
    const manifest = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as {
      version?: string
    }
    return manifest.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Does every target browser support every requirement?
 * When it does not, record who falls short and by how much — a verdict without
 * a number is the kind of advice this tool exists to replace.
 */
export function evaluate(
  requirements: Requirement[],
  minimums: Minimums,
  resolver: FeatureResolver = bundledResolver(),
): Support {
  const blockers: Blocker[] = []
  const missing: Requirement[] = []

  for (const requirement of requirements) {
    const entry = resolver.lookup(requirement)
    if (!entry) {
      missing.push(requirement)
      continue
    }

    for (const [browser, mine] of Object.entries(minimums) as [BrowserKey, string][]) {
      const needed = entry.support[browser]
      if (!needed) {
        blockers.push({ requirement, label: entry.label, browser, mine, needed: null })
      } else if (compareVersions(mine, needed) < 0) {
        blockers.push({ requirement, label: entry.label, browser, mine, needed })
      }
    }
  }

  return { supported: blockers.length === 0 && missing.length === 0, blockers, missing }
}
