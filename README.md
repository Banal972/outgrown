# outgrown

**Find the dependencies your project has outgrown.**

`knip` and `depcheck` find dependencies you *don't use*. `outgrown` finds the ones you **do** use — still imported, still working — where the browser has quietly taken over the job.

```bash
npx outgrown
```

```
 DROP  @floating-ui/react (32.0KB gzip · 89.6KB min)
  → anchor-name / position-area / @position-try + popover
  Only placement, flipping and offsets are used. This maps to CSS as-is.

 CHECK  framer-motion (48.7KB gzip · 142.7KB min)
  → @starting-style + transition-behavior: allow-discrete
  Uses features CSS cannot express: layoutId (shared element transition)
  look at: src/Gallery.jsx

 NOT YET  aos (5.3KB gzip · 14.8KB min)
  → animation-timeline: view() / scroll()
  firefox unsupported · safari 18.0 < 26

drop 2 · check 1 · not yet 1
Delete now to save 35.4KB (gzip)
```

## How it decides

**`browserslist` × `web-features` (Baseline).** That intersection is the whole tool.

- `browserslist` — the browsers *your* project still has to support
- `web-features` — the browser and version each web feature landed in

Cross them and you get the only answer that matters: **what is safe to delete from this project, today.** Every other tool looks the other way. `css/use-baseline` and `eslint-plugin-baseline-js` tell you what you *can't use yet*; `knip` and `depcheck` only find what you never imported.

The same code gets a different verdict depending on who you support:

```bash
outgrown --targets "safari >= 18"     # @floating-ui/react → NOT YET (safari 18 < 26)
outgrown --targets "safari >= 26.2"   # @floating-ui/react → DROP    (-32KB)
```

Which also means verdicts change over time without you touching a line of code. This is a tool worth re-running every few months.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| **DROP** | Supported by every target, and the way you use it maps over as-is |
| **CHECK** | Supported, but some usage goes beyond CSS (`layoutId`, virtual anchors) — the files are named |
| **NOT YET** | A target falls short. Says which browser and by how many versions |

Sizes are measured, not estimated: the package is bundled with esbuild, minified and gzipped.

## If your project has no browserslist

Plenty do not, and it matters here more than anywhere: without a browserslist there
is no answer to "who do you still support", and every verdict rests on a guess.

browserslist has its own defaults, and `outgrown` uses them — the same ones your
bundler and autoprefixer already use, so at least the guess is consistent with your
build. But they are market-share based, which produces odd shapes: today they still
carry **chrome 109** (the last version for Windows 7/8) alongside a very recent
Safari. So `outgrown` says so before showing any verdict:

```
This project has no browserslist, so these are browserslist's own defaults
— still carrying chrome 109. That is a guess, not your policy.

  Pick a policy and the verdicts change with it:
  "baseline widely available"
      chrome 121, firefox 123, safari 17.2 — no change here
  "baseline newly available"
      chrome 148, firefox 154, safari 26.5 — 3 more open

  Set it in package.json "browserslist", or try one with --targets.
```

Two queries rather than one recommendation, because picking a support policy is a
trade: *widely available* means 30+ months of support in every core browser,
*newly available* means whatever the slowest browser shipped most recently. The
numbers next to each are what that choice is worth **in this project**.

## What outgrown is not

**It does not check every package you depend on.** It checks a curated set — 317
at the time of writing — chosen two ways: by working backwards from features that
recently reached Baseline, and by download weight, because the long tail is very
long and the head is very fat (the top 50 polyfill packages account for 92% of all
downloads in that category). Everything outside that set is simply not looked at,
and every run says so:

```
checked 317 known packages across 7 rules — a curated set, not every dependency you have
```

A clean report means nothing matched the rules that exist today. It is not proof
your dependencies are clean.

**It advises; it does not decide.** Three things underneath a verdict are
judgement, not fact:

- usage is matched with regexes, so an unusual import shape can be missed
- "does this usage map onto the platform" is a call a person wrote into a rule
- rules get added, corrected, and occasionally proved wrong — this README is one
  commit after a rule was reporting an animation library for doing animation work

And verdicts move on their own. Browsers ship, `web-features` updates, your
browserslist changes: the same code can be `NOT YET` this year and `DROP` the
next, without anyone touching it. A verdict is a snapshot of today's rules against
today's data, for today's targets.

So read the diff and run your tests — `outgrown fix` says the same thing after it
writes. `CHECK` always needs a human by definition; `DROP` is a strong suggestion,
not a guarantee.

## Rules

| Rule | Packages | Replacement |
| --- | --- | --- |
| `floating-ui` | @floating-ui/\* · popper · tippy | CSS anchor positioning + Popover API |
| `polyfills` | 40+ packages: whatwg-fetch · urlpattern-polyfill · dialog-polyfill · @oddbird/popover-polyfill · container-query-polyfill … | native |
| `absorbed` | uuid · copy-to-clipboard · lazysizes · react-textarea-autosize · element-resize-detector … | `crypto.randomUUID()` · `navigator.clipboard` · `loading="lazy"` · `field-sizing` |
| `enter-exit` | framer-motion · motion · react-transition-group | `@starting-style` + `allow-discrete` |
| `dialog` | react-modal · body-scroll-lock · focus-trap-react | `<dialog>` + Popover |
| `scroll-animations` | aos · scrollreveal · wow.js | scroll-driven animations |
| `e18e-native` | 236 packages from e18e's `native` manifest: abort-controller · queue-microtask · escape-string-regexp … | the native API |

## Deleting them

Reporting is only half of it — a tool that only tells you things ends at "thanks,
good to know". `outgrown fix` removes the imports for you, but **only for dead
polyfills**: that is the one rule where the replacement is *nothing at all*, so
deletion is the entire migration. Every other rule needs code written, and that is
not something to automate behind a flag.

```bash
outgrown fix           # dry run — shows exactly which lines would go
outgrown fix --write   # apply
```

```
src/observe.js
     1 - import ResizeObserver from 'resize-observer-polyfill'
src/boot.js
     1 - import 'whatwg-fetch'
     2 - import 'urlpattern-polyfill'

Left alone:
  src/modal.js:1 dialog-polyfill — `dialogPolyfill` is used 1 time in this file
  src/lazy.js:3 intersection-observer — nested in a conditional or function

Would remove 3 imports from 2 files.

Then, once you are happy with the diff:
  npm uninstall resize-observer-polyfill urlpattern-polyfill whatwg-fetch
```

### What it will and will not remove

| Case | Action |
| --- | --- |
| `import 'whatwg-fetch'` | removed — nothing references it |
| `import ResizeObserver from 'resize-observer-polyfill'`, used as `new ResizeObserver()` | removed — the binding name matches the native global, so the global takes over |
| `import dialogPolyfill from 'dialog-polyfill'`, used as `dialogPolyfill.registerDialog()` | **kept** — that binding is not a global |
| `if (!window.x) await import('polyfill')` | **kept** — nested, so removing it changes behaviour |
| `const x = require('polyfill')` with `x` referenced | **kept** |

It never edits `package.json` or runs a package manager; it prints the `npm
uninstall` line and leaves that to you.

`fix` needs `@babel/parser` (an optional peer). Regexes cannot tell an import inside
an `if` from one at the top of a file, and a codemod that gets that wrong breaks
builds rather than merely giving bad advice.

## Where the rules come from

Three sources, in decreasing order of hand-holding:

1. **Hand-written rules** (`floating-ui`, `polyfills`, `absorbed`, …) — a specific
   verdict, a specific note, and for polyfills a codemod.
2. **[e18e's `native` manifest](https://github.com/es-tooling/module-replacements)**
   — 236 packages that have a native equivalent, generated into a rule. e18e
   curates the pairs and already maps each to a web-features id; what they do not
   do is check it against *your* browserslist. That part is this tool's whole job:

   ```
   outgrown --targets "safari >= 26.2"   # escape-string-regexp → CHECK  (RegExp.escape is there)
   outgrown --targets "safari >= 18"     # escape-string-regexp → NOT YET
   ```
3. **`scripts/find-candidates.mjs`** — a review queue, never a rule.

## Coverage

`outgrown` only knows what its rules cover, so every run says what it looked at:

```
Nothing to drop.
checked 67 packages across 5 rules. Anything outside those rules was not looked at.
```

A clean report is not proof your project is clean. It means nothing matched the
rules that exist today.

Rules are found by working **backwards from the platform**, not forwards from npm.
Enumerating npm is hopeless — over 6,000 packages carry a `polyfill` keyword alone.
Enumerating features is not: a bounded number reach Baseline each year, and
`web-features` dates every one of them.

```bash
node scripts/find-candidates.mjs --years 5 --min-downloads 3000
```

That script asks "what did the browser absorb recently, and which package existed
to do that job", then ranks the answers by weekly downloads. It only finds
*polyfills* — nothing about `uuid` announces that `crypto.randomUUID()` exists now,
so the `absorbed` rule is curated by hand, feature by feature. Its output is a review
queue ([docs/rule-candidates.md](docs/rule-candidates.md)) — never a rule. npm's
search ranks by popularity rather than relevance, so roughly half of what it returns
is mis-paired, and the feature id always gets checked by hand before it lands.

## Usage

```bash
outgrown [path]
outgrown --targets "chrome >= 130, firefox >= 132, safari >= 18"   # what-if
outgrown --json
outgrown --no-measure                                              # skip sizing
```

Programmatic:

```ts
import { analyze } from 'outgrown'

const report = await analyze(process.cwd(), { targets: 'chrome >= 130' })
const droppable = report.findings.filter((f) => f.verdict === 'drop')
```

## Install size

Two dependencies are **optional peers**, because a tool that complains about bundle
weight should not be heavy itself.

```bash
npm i -D web-features   # live browser support data, updated weekly upstream
npm i -D esbuild        # exact gzip numbers instead of install size on disk
npm i -D @babel/parser  # required by `outgrown fix`
```

| Installed | Size | What you get |
| --- | --- | --- |
| neither | **5.1MB** | bundled data slice, sizes read from `node_modules` |
| `web-features` | +4.5MB | support data as current as the package you installed |
| `esbuild` | +9.6MB | bundled + gzipped measurements |
| `@babel/parser` | +1.8MB | `outgrown fix` |

Without `web-features`, verdicts come from a slice generated at release time from
the rules themselves — a few kilobytes instead of 4.5MB. Every run prints which
dataset answered:

```
data: web-features@3.35.1
data: bundled slice (2026-08-26) — install web-features for live data
```

The slice can only answer what the built-in rules ask for. Anything outside it is
reported as unknown, never as supported.

`browserslist` stays a real dependency. It brings `caniuse-lite` (4.2MB) with it,
and that is deliberate: reimplementing browserslist queries to save weight would
mean reading your targets *slightly* wrong, and wrong targets mean wrong verdicts
with no visible symptom.

## Development

```bash
npm run build       # tsc → generate data slice → tsc
npm run build:data  # regenerate src/data/baseline.generated.ts
npm test            # jest (ESM via ts-jest)
npm run typecheck   # strict pass over src + tests
```

The data slice is generated from the rules, so adding a rule cannot leave it
behind — and the test suite fails if the slice and `web-features` ever disagree.

Tests run against fixture projects under `tests/fixtures`, so nothing depends on
what happens to be installed in `node_modules`. The suite pins the verdicts the
analyser produces today — it exists to catch the AST rewrite breaking them.

## Known limits

- Imports are matched with regexes. Dynamic paths and tsconfig aliases are missed; `outgrown fix` uses a real parser, the report does not
- Sizes are per-package. After tree shaking your real saving may be smaller
- Only the seven Baseline core browsers are judged. Everything else (samsung, op_mob, …) is excluded and reported
- `fix` covers the `polyfills` rule only. The other four still need hands

## License

MIT
