import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = join(root, 'packages/dsh-pocket')
const outDir = join(pkg, 'lib')

/** Packages the browser shell seeds into `window.__ModuleLoader__`'s baseline table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const MODULE_ID = '@awbuilds/dsh-pocket'

function indent(text, prefix = '\t\t') {
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : prefix + line))
    .join('\n')
}

async function buildHost() {
  await build({
    entryPoints: [join(pkg, 'src/host/index.ts')],
    outfile: join(outDir, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node22'],
    sourcemap: true,
    external: ['@deepseek-ai/*'],
    banner: {
      js: "import { createRequire as __dshPocketCreateRequire } from 'node:module';\nconst require = __dshPocketCreateRequire(import.meta.url);",
    },
    logLevel: 'warning',
    legalComments: 'none',
  })
  const text = await readFile(join(outDir, 'index.js'), 'utf8')
  for (const marker of ['export {', 'apply', 'Config']) {
    if (!text.includes(marker)) throw new Error(`host bundle is missing ${marker}`)
  }
}

async function buildClient() {
  const result = await build({
    entryPoints: [join(pkg, 'src/client/index.tsx')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    target: ['es2020'],
    jsx: 'automatic',
    sourcemap: false,
    external: CLIENT_EXTERNALS,
    logLevel: 'warning',
    legalComments: 'none',
  })
  const js = result.outputFiles[0]
  if (!js) throw new Error('client build produced no JavaScript output')
  const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(MODULE_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${indent(js.text)}
\t\treturn module.exports;
\t}
});
`
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'client.js'), wrapped, 'utf8')
  if (!wrapped.includes(`id: ${JSON.stringify(MODULE_ID)}`) || !wrapped.includes('function apply(')) {
    throw new Error('client bundle wrapper or exports are missing')
  }
}

await mkdir(outDir, { recursive: true })
await buildHost()
await buildClient()
console.log('built packages/dsh-pocket/lib/index.js and lib/client.js')
