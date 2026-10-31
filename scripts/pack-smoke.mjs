/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cubeGlb } from './scene.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const keep = process.argv.includes('--keep')
const node = process.execPath
const npm = process.env.npm_execpath ?? realpathSync(join(dirname(node), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'npm'))
const env = { ...process.env, PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}` }
for (const key of Object.keys(env)) if (/^npm_/.test(key)) delete env[key]

const sourcePkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const distPkg = JSON.parse(readFileSync(resolve(root, 'dist/package.json'), 'utf8'))
assert.equal(distPkg.name, sourcePkg.name)
assert.equal(distPkg.version, sourcePkg.version)
assert.equal(distPkg.private, undefined)
assert.equal(distPkg.scripts, undefined)
assert.equal(distPkg.devDependencies, undefined)
const crate = readFileSync(resolve(root, 'Cargo.toml'), 'utf8')
assert.equal(crate.match(/^version = "([^"]+)"/m)?.[1], sourcePkg.version, 'Rust and npm versions must match')

const dir = mkdtempSync(join(tmpdir(), 'pcbjs-renderer-pack-'))
console.log(`pack smoke in ${dir}`)
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(r.stdout)
    console.error(r.stderr)
    throw new Error(`${cmd} exited with status ${r.status}: ${r.error?.message ?? ''}`)
  }
  return r
}

try {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pack-smoke', private: true, type: 'module' }))
  writeFileSync(
    join(dir, 'smoke.mjs'),
    `import { readFileSync } from 'node:fs'
import { encodePng, render } from '@pcbjs/renderer'
import { RendererWorker } from '@pcbjs/renderer/worker'
const glb = readFileSync(process.argv[2])
const { rgba, width, height } = await render(glb, { width: 64, height: 48, supersample: 1, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] } })
const png = await encodePng(rgba, width, height)
if (width !== 64 || height !== 48 || png[0] !== 137 || png.length < 32) process.exit(1)
console.log('rendered', width, height, 'png', png.length)
const worker = new RendererWorker()
try {
  await worker.load(glb)
  const image = await worker.render({ width: 32, height: 24, mirror: true })
  if (image.rgba.length !== 32 * 24 * 4) throw new Error('invalid worker image')
  await worker.replace(glb)
} finally { await worker.terminate() }
`,
  )
  const glb = join(dir, 'cube.glb')
  writeFileSync(glb, cubeGlb())
  env.npm_config_cache = join(dir, 'npm-cache')
  const packed = JSON.parse(run(node, [npm, 'pack', resolve(root, 'dist'), '--json', '--pack-destination', dir]).stdout)
  assert.deepEqual(packed[0].files.map(file => file.path).sort(), [
    'LICENSE',
    'README.md',
    'index.d.ts',
    'index.mjs',
    'package.json',
    'renderer_bg.wasm',
    'worker-runtime.mjs',
    'worker.d.ts',
    'worker.mjs',
  ])
  run(node, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error', join(dir, packed[0].filename)])
  run(node, [join(dir, 'smoke.mjs'), glb])
  writeFileSync(
    join(dir, 'consumer.ts'),
    `import { createRenderer, encodePng } from '@pcbjs/renderer'
import { RendererWorker } from '@pcbjs/renderer/worker'
async function inspect(glb: Uint8Array) {
  const options = { selectionGeometry: [{ id: 'item', positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) }] }
  const renderer = await createRenderer(glb, options)
  const frame = renderer.prepare({ width: 32, height: 24, mirror: true })
  const worker = new RendererWorker()
  await worker.load(glb, options)
  const image = await worker.render(frame)
  const png: Uint8Array = await encodePng(image.rgba, image.width, image.height, { Snapshot: '123' })
  // @ts-expect-error Invalid method arguments must remain typed across the package boundary.
  await worker.request('render', [42])
  await worker.terminate()
  renderer.dispose()
  return png
}
void inspect
`,
  )
  run(node, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', join(dir, 'consumer.ts')])
  console.log('pack smoke ok')
} finally {
  if (!keep) rmSync(dir, { recursive: true, force: true })
}
