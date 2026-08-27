#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { planPolyfillFix, renderPlan } from './codemod/index.js'
import { analyze } from './index.js'
import { render } from './report.js'

const HELP = `outgrown — find dependencies your project has outgrown

Usage
  outgrown [path]              report what could go
  outgrown fix [path]          remove dead polyfill imports (dry run)

Options
  --targets <query>   judge against this browserslist query instead of the project's
  --json              machine-readable output
  --no-measure        skip bundle measurement (faster)
  --workspaces        also scan nested packages, each as its own project
  --write             fix only: actually edit the files
  -h, --help          show this help

Examples
  outgrown
  outgrown packages/web
  outgrown --targets "chrome >= 130, firefox >= 132, safari >= 18"
  outgrown --workspaces
  outgrown fix --write
`

async function main(): Promise<number> {
  const args = process.argv.slice(2)

  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP)
    return 0
  }

  const targetsIndex = args.indexOf('--targets')
  const targetsQuery = targetsIndex === -1 ? undefined : args[targetsIndex + 1]
  if (targetsIndex !== -1 && !targetsQuery) {
    console.error('outgrown: --targets needs a browserslist query')
    return 1
  }

  const valueIndex = targetsIndex === -1 ? -1 : targetsIndex + 1
  const positional = args.filter((arg, index) => !arg.startsWith('--') && index !== valueIndex)
  const fixing = positional[0] === 'fix'
  const root = resolve((fixing ? positional[1] : positional[0]) ?? process.cwd())

  try {
    const report = await analyze(root, {
      // Sizes are irrelevant to `fix`; skipping them keeps it fast.
      measure: !fixing && !args.includes('--no-measure'),
      ...(targetsQuery ? { targets: targetsQuery } : {}),
    })

    if (!fixing) {
      const json = args.includes('--json')

      // A workspace root has almost no source of its own. Each package carries
      // its own browserslist and its own dependencies, so they are judged
      // separately rather than merged into one misleading verdict.
      if (args.includes('--workspaces') && report.skipped.length) {
        const reports = [{ path: '.', report }]
        for (const nested of report.skipped) {
          try {
            reports.push({
              path: nested,
              report: await analyze(join(root, nested), {
                measure: !args.includes('--no-measure'),
                ...(targetsQuery ? { targets: targetsQuery } : {}),
              }),
            })
          } catch (error) {
            console.error(`outgrown: ${nested}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

        if (json) {
          console.log(JSON.stringify(reports, null, 2))
        } else {
          for (const entry of reports) {
            if (entry.path !== '.' && !entry.report.findings.length) continue
            console.log(`\n${'═'.repeat(20)} ${entry.path} ${'═'.repeat(20)}`)
            console.log(render(entry.report))
          }
          const silent = reports.filter((e) => e.path !== '.' && !e.report.findings.length).length
          if (silent) console.log(`(${silent} nested package${silent === 1 ? '' : 's'} had nothing to report)`)
        }
        return 0
      }

      console.log(json ? JSON.stringify(report, null, 2) : render(report))
      return 0
    }

    const plan = await planPolyfillFix(root, report)
    const write = args.includes('--write')

    if (write && !plan.error) {
      for (const [file, contents] of plan.contents) writeFileSync(join(root, file), contents)
    }

    if (args.includes('--json')) {
      console.log(JSON.stringify({ ...plan, contents: undefined, written: write }, null, 2))
    } else {
      console.log(renderPlan(plan, write))
    }

    return plan.error ? 1 : 0
  } catch (error) {
    console.error(`outgrown: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

process.exitCode = await main()
