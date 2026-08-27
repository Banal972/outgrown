import pc from 'picocolors'
import { kb } from './size.js'
import type { Finding, Report, Size, Verdict } from './types.js'

const BADGE: Record<Verdict, () => string> = {
  drop: () => pc.bgGreen(pc.black(' DROP ')),
  check: () => pc.bgYellow(pc.black(' CHECK ')),
  'not-yet': () => pc.bgRed(pc.white(' NOT YET ')),
}

const SOURCE_LABEL = {
  override: '--targets',
  project: 'project config',
  default: 'defaults',
} as const

export function render({ targets, project, data, coverage, assumed, findings }: Report): string {
  const lines: string[] = []
  const write = (line = '') => lines.push(line)

  write()
  write(pc.bold('outgrown') + pc.dim(` — ${project.name ?? '(unnamed)'} · ${project.fileCount} files`))

  const list = Object.entries(targets.minimums)
    .map(([browser, version]) => `${browser} ${version}`)
    .join(', ')
  write(pc.dim(`targets (browserslist ${SOURCE_LABEL[targets.source]}): ${list || 'none'}`))

  const dataLabel = data.source === 'web-features'
    ? `web-features@${data.version}`
    : `bundled slice (${data.version}) — install web-features for live data`
  write(pc.dim(`data: ${dataLabel}`))

  if (targets.legacy.length) {
    write(pc.red(`${targets.legacy.join(', ')} will never support these features — nothing can be dropped`))
  }
  if (targets.derivative.length) {
    write(pc.dim(`unverified for ${targets.derivative.join(', ')} — engine derivatives web-features does not cover`))
  }
  if (targets.unknownVersions.length) {
    write(pc.dim(`no version to judge: ${targets.unknownVersions.join(', ')} — left out`))
  }

  // No browserslist means every verdict rests on a guess. Make the guess visible
  // before the verdicts, not after.
  if (assumed) {
    write()
    write(pc.yellow('This project has no browserslist, so these are browserslist\'s own defaults'))
    write(
      assumed.oldest
        ? pc.yellow(`— still carrying ${pc.bold(assumed.oldest)}. That is a guess, not your policy.`)
        : pc.yellow('— a guess, not your policy.'),
    )
    if (assumed.alternatives.length) {
      write()
      write(pc.dim('  Pick a policy and the verdicts change with it:'))
      for (const alternative of assumed.alternatives) {
        const opens = alternative.wouldOpen > 0 ? `${alternative.wouldOpen} more open` : 'no change here'
        write(`  ${pc.bold(`"${alternative.query}"`)}`)
        write(pc.dim(`      ${alternative.floor} — ${opens}`))
      }
      write()
      write(pc.dim('  Set it in package.json "browserslist", or try one with --targets.'))
    }
  }

  // Two things a reader can get wrong on their own: assuming a clean report means
  // a clean project, and treating a verdict as a decision. Say both out loud.
  const scope =
    `checked ${coverage.packages} known packages across ${coverage.rules} rules` +
    ' — a curated set, not every dependency you have'
  const advisory = 'outgrown advises, it does not decide. Read the diff and run your tests.'

  if (!findings.length) {
    write()
    write(pc.green('Nothing to drop.'))
    write(pc.dim(`${scope}.`))
    write(pc.dim('That is not the same as your dependencies being clean.'))
    write()
    return lines.join('\n')
  }

  let savedGzip = 0

  for (const finding of findings) {
    write()
    write(`${BADGE[finding.verdict]()} ${pc.bold(finding.pkg)} ${sizeLabel(finding.size)}`)
    write(`  ${pc.dim('→')} ${finding.replacement}`)
    write(`  ${finding.note}`)

    if (finding.imports.length) {
      const shown = finding.imports.slice(0, 6).join(', ')
      write(pc.dim(`  imports: ${shown}${finding.imports.length > 6 ? ' …' : ''}`))
    }

    if (finding.sites?.length) {
      write(pc.dim(`  look at: ${summarise(finding.sites)}`))
    } else if (finding.files.length) {
      write(pc.dim(`  used in: ${summarise(finding.files)}`))
    } else if (finding.declared) {
      write(pc.dim('  declared in package.json but no import found in the source'))
    }

    write(pc.dim(`  ${finding.docs}`))

    if (finding.verdict === 'drop' && finding.size?.gzip) savedGzip += finding.size.gzip
  }

  write()
  write(pc.dim('─'.repeat(52)))

  const counts = {
    drop: findings.filter((f) => f.verdict === 'drop').length,
    check: findings.filter((f) => f.verdict === 'check').length,
    notYet: findings.filter((f) => f.verdict === 'not-yet').length,
  }
  write(`drop ${pc.bold(counts.drop)} · check ${counts.check} · not yet ${counts.notYet}`)

  if (savedGzip > 0) write(pc.green(pc.bold(`Delete now to save ${kb(savedGzip)} (gzip)`)))

  // What raising the floor would buy — the call stays with the reader.
  const locked = findings
    .filter((f) => f.verdict === 'not-yet' && f.size?.gzip)
    .reduce((sum, f) => sum + (f.size?.gzip ?? 0), 0)
  if (locked > 0) write(pc.dim(`Raising your targets would unlock another ${kb(locked)}`))

  write()
  write(pc.dim(scope))
  write(pc.dim(advisory))

  // A legacy browser in the query outranks any version gap: it is why nothing
  // can be dropped, and naming a Firefox version instead would send the reader
  // after the wrong thing.
  const worst = targets.legacy.length
    ? { key: targets.legacy.join(', '), count: findings.filter((f) => f.verdict === 'not-yet').length }
    : topBlocker(findings)

  if (worst) {
    write()
    write(pc.yellow(`Biggest blocker: ${pc.bold(worst.key)} — ${worst.count} finding${worst.count > 1 ? 's' : ''}`))
    write(pc.dim('  Check whether that browser belongs in your browserslist at all.'))
    write(pc.dim('  Try another assumption: outgrown --targets "chrome >= 130, firefox >= 132, safari >= 18"'))
  }

  write()
  return lines.join('\n')
}

function summarise(files: string[]): string {
  const shown = files.slice(0, 3).join(', ')
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown
}

function sizeLabel(size: Size | null): string {
  if (!size) return ''
  if (size.gzip != null) return pc.dim(`(${kb(size.gzip)} gzip · ${kb(size.min)} min)`)
  if (size.onDisk != null) {
    const why = size.reason === 'no-esbuild' ? 'esbuild not installed' : 'bundle measurement failed'
    return pc.dim(`(${kb(size.onDisk)} on disk · ${why})`)
  }
  return pc.dim('(not installed)')
}

/** The one browser holding back the most verdicts — usually the whole story. */
function topBlocker(findings: Finding[]): { key: string; count: number } | null {
  const tally = new Map<string, number>()

  for (const finding of findings) {
    if (finding.verdict !== 'not-yet') continue
    const seen = new Set<string>()
    for (const blocker of finding.support.blockers) {
      const key = blocker.needed ? `${blocker.browser} ${blocker.mine}` : `${blocker.browser} (unsupported)`
      if (seen.has(key)) continue
      seen.add(key)
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
  }

  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  return top ? { key: top[0], count: top[1] } : null
}
