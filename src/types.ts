/** A browser key as used by web-features / BCD. */
export type BrowserKey =
  | 'chrome'
  | 'chrome_android'
  | 'edge'
  | 'firefox'
  | 'firefox_android'
  | 'safari'
  | 'safari_ios'

/** Lowest version of each core browser the project must still support. */
export type Minimums = Partial<Record<BrowserKey, string>>

export interface Targets {
  minimums: Minimums
  /** browserslist entries outside the Baseline core set, excluded from judgement. */
  ignored: string[]
  /** Of those, the ones web-features has no data for at all (ie, op_mini …). */
  noData: string[]
  /** Of those, engine derivatives whose lag is unknown (samsung, opera, baidu …). */
  derivative: string[]
  /** Versions that are strictly ahead of stable, so they constrain nothing (safari TP). */
  aheadOfStable: string[]
  /** Entries whose version could not be parsed (e.g. "safari TP"). */
  unknownVersions: string[]
  source: 'override' | 'project' | 'assumed'
  /** The query used when the project had none of its own. */
  assumedQuery?: string
  raw: string[]
}

/**
 * What a rule needs from the platform.
 *   `feature:starting-style`            — a whole web-features feature
 *   `bcd:css.properties.anchor-name`    — a single BCD key, for when the
 *                                         umbrella feature is not Baseline yet
 */
export type Requirement = `feature:${string}` | `bcd:${string}`

export interface Blocker {
  requirement: Requirement
  label: string
  browser: BrowserKey
  /** The version the project still supports. */
  mine: string
  /** The version the feature needs, or null when the browser has no support at all. */
  needed: string | null
}

export interface FeatureSupportTable {
  label: string
  support: Partial<Record<BrowserKey, string>>
}

export interface FeatureResolver {
  /** Where the answers came from — reported, never assumed. */
  source: 'web-features' | 'bundled'
  /** Package version, or the date the bundled slice was generated. */
  version: string
  lookup: (requirement: Requirement) => FeatureSupportTable | null
}

export interface Support {
  supported: boolean
  blockers: Blocker[]
  /** Requirements with no data in web-features — never treated as supported. */
  missing: Requirement[]
}

export interface FileUsage {
  lines: number[]
  text: string
}

export interface PackageUsage {
  files: Map<string, FileUsage>
  /** What was imported from the package, e.g. `useFloating`, `AnimatePresence`. */
  specifiers: Set<string>
  /**
   * The local names those imports are bound to. Usually the same, but
   * `{ ResizeObserver as RO }` binds `RO` — and it is the local name that has to
   * survive deleting the import, so safety checks read this and not `specifiers`.
   */
  bindings: Set<string>
  /**
   * True when the package arrives in a form whose bindings cannot be read —
   * `foo(require('x'))`, `await import('x')`. Not knowing what a name is bound to
   * is not the same as knowing nothing is.
   */
  opaque: boolean
}

export interface Project {
  root: string
  fileCount: number
  usage: Map<string, PackageUsage>
  /**
   * Directories the walk stopped at because they carry their own package.json.
   * In a workspace these are the project — reporting a clean sweep of the root
   * while silently skipping a hundred packages would be the same lie as any
   * other silent omission.
   */
  skipped: string[]
}

export type Verdict = 'drop' | 'check' | 'not-yet'

export interface Inspection {
  verdict: Exclude<Verdict, 'not-yet'>
  note: string
  /** Files the user should look at before deleting anything. */
  sites?: string[]
}

export interface Rule {
  id: string
  title: string
  packages: string[]
  docs: string
  /** Fixed requirements, or per-package ones via `requirementsFor`. */
  requirements?: Requirement[]
  requirementsFor?: (pkg: string) => Requirement[]
  /** Per-package documentation link, when one rule spans many different APIs. */
  docsFor?: (pkg: string) => string | undefined
  /** The global that takes over once the import goes, when there is one. */
  nativeGlobalFor?: (pkg: string) => string | undefined
  replacement?: string
  replacementFor?: (pkg: string) => string
  /** Returns null when the package is doing work the platform still cannot do. */
  inspect: (context: { pkg: string; usage: PackageUsage; project: Project }) => Inspection | null
}

export interface Size {
  gzip: number | null
  min: number | null
  onDisk: number | null
  measured: boolean
  reason?: 'no-esbuild' | 'bundle-failed'
}

export interface Finding {
  rule: string
  title: string
  pkg: string
  verdict: Verdict
  note: string
  sites?: string[]
  replacement: string
  /** The global the codemod can safely leave a binding resolving to. */
  nativeGlobal?: string
  docs: string
  files: string[]
  imports: string[]
  declared: boolean
  size: Size | null
  support: Support
}

export interface Report {
  targets: Targets
  project: { name?: string; fileCount: number }
  data: { source: FeatureResolver['source']; version: string }
  /** What was looked for. A clean report means nothing outside this was checked. */
  coverage: { rules: number; packages: number }
  /** Nested packages the scan stopped at, relative to the root. */
  skipped: string[]
  /**
   * Node builtins seen in the source of a project that declares no browserslist.
   * Browser targets may simply not apply to it.
   */
  nodeSignals: string[]
  /**
   * Set only when the project has no browserslist of its own: what a real target
   * would open up, so the fallback is visibly a guess rather than a policy.
   */
  assumed?: {
    /** The query that stood in for a browserslist the project does not have. */
    query: string
    alternatives: { query: string; floor: string; wouldOpen: number }[]
  }
  findings: Finding[]
}

export interface AnalyzeOptions {
  /** browserslist query to judge against instead of the project's own. */
  targets?: string
  /** Set false to skip bundle measurement (faster). */
  measure?: boolean
}
