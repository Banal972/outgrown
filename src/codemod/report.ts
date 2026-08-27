import pc from 'picocolors'
import type { FixPlan } from './polyfill.js'

/** Dry-run output: show the exact lines that would go, and what would not. */
export function renderPlan(plan: FixPlan, write: boolean): string {
  const lines: string[] = []
  const out = (line = '') => lines.push(line)

  out()

  if (plan.error) {
    out(pc.red(plan.error))
    out()
    return lines.join('\n')
  }

  if (!plan.removals.length && !plan.kept.length) {
    out(pc.green('Nothing to remove.'))
    out(pc.dim('`fix` only handles dead polyfills — the rules where the replacement is nothing at all.'))
    out()
    return lines.join('\n')
  }

  let currentFile = ''
  for (const removal of plan.removals) {
    if (removal.file !== currentFile) {
      currentFile = removal.file
      out(pc.bold(currentFile))
    }
    out(`  ${pc.dim(String(removal.line).padStart(4))} ${pc.red('-')} ${pc.red(removal.text.trim())}`)
  }

  if (plan.kept.length) {
    out()
    out(pc.yellow('Left alone:'))
    for (const kept of plan.kept) {
      out(`  ${pc.dim(`${kept.file}:${kept.line}`)} ${kept.pkg} — ${kept.reason}`)
    }
  }

  out()
  out(pc.dim('─'.repeat(52)))
  out(
    write
      ? pc.green(`Removed ${plan.removals.length} import${plan.removals.length === 1 ? '' : 's'} from ${plan.contents.size} file${plan.contents.size === 1 ? '' : 's'}.`)
      : `Would remove ${pc.bold(plan.removals.length)} import${plan.removals.length === 1 ? '' : 's'} from ${plan.contents.size} file${plan.contents.size === 1 ? '' : 's'}.`,
  )

  if (plan.uninstall.length) {
    out()
    out(pc.dim('Then, once you are happy with the diff:'))
    out(`  npm uninstall ${plan.uninstall.join(' ')}`)
  }

  if (!write) {
    out()
    out(pc.dim('Nothing was written. Re-run with --write to apply.'))
  }

  out()
  return lines.join('\n')
}
