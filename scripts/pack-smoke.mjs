/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cubeGlb } from './scene.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const keep = process.argv.includes('--keep')
const node = process.execPath
const npm = join(dirname(node), 'npm')
const env = { ...process.env, PATH: `${dirname(node)}:${process.env.PATH ?? ''}` }
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
const glb = readFileSync(process.argv[2])
const { rgba, width, height } = await render(glb, { width: 64, height: 48, supersample: 1, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] } })
const png = await encodePng(rgba, width, height)
if (width !== 64 || height !== 48 || png[0] !== 137 || png.length < 32) process.exit(1)
console.log('rendered', width, height, 'png', png.length)
`,
  )
  const glb = join(dir, 'cube.glb')
  writeFileSync(glb, cubeGlb())
  env.npm_config_cache = join(dir, 'npm-cache')
  const packed = JSON.parse(run(npm, ['pack', resolve(root, 'dist'), '--json', '--pack-destination', dir]).stdout)
  assert.deepEqual(packed[0].files.map(file => file.path).sort(), ['LICENSE', 'README.md', 'index.d.ts', 'index.mjs', 'package.json', 'renderer_bg.wasm'])
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error', join(dir, packed[0].filename)])
  run(node, [join(dir, 'smoke.mjs'), glb])
  console.log('pack smoke ok')
} finally {
  if (!keep) rmSync(dir, { recursive: true, force: true })
}
