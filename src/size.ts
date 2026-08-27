import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { directorySize } from './scan.js'
import type { Size } from './types.js'

/** Already present in any app that would install this package. */
const EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'next', 'vue', 'svelte']

type Esbuild = typeof import('esbuild')

// esbuild is only needed to measure. Optional peer: run without it if absent.
let esbuild: Esbuild | null | undefined

async function loadEsbuild(): Promise<Esbuild | null> {
  if (esbuild !== undefined) return esbuild
  try {
    esbuild = (await import('esbuild')) as Esbuild
  } catch {
    esbuild = null
  }
  return esbuild
}

export async function hasEsbuild(): Promise<boolean> {
  return (await loadEsbuild()) !== null
}

/**
 * Measure what the package actually costs in a bundle: bundle it, minify, gzip.
 * Estimates would undermine the one number this tool is built to report, so when
 * measurement is unavailable we fall back to install size and say so.
 */
export async function measure(pkg: string, root: string): Promise<Size> {
  const installed = join(root, 'node_modules', pkg)
  const onDisk = existsSync(installed) ? directorySize(installed) : null

  const mod = await loadEsbuild()
  if (!mod) return { gzip: null, min: null, onDisk, measured: false, reason: 'no-esbuild' }

  try {
    const result = await mod.build({
      stdin: {
        contents: `import * as m from ${JSON.stringify(pkg)}\nglobalThis.__outgrown = m\n`,
        resolveDir: root,
        loader: 'js',
      },
      bundle: true,
      minify: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      external: EXTERNAL,
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    })

    const output = result.outputFiles[0]?.contents
    if (!output) return { gzip: null, min: null, onDisk, measured: false, reason: 'bundle-failed' }

    return { gzip: gzipSync(output).length, min: output.length, onDisk, measured: true }
  } catch {
    return { gzip: null, min: null, onDisk, measured: false, reason: 'bundle-failed' }
  }
}

export function kb(bytes: number | null): string {
  if (bytes == null) return '—'
  return `${(bytes / 1024).toFixed(1)}KB`
}
