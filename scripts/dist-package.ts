/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'rollup'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const keep = [
  'name',
  'version',
  'description',
  'type',
  'keywords',
  'author',
  'license',
  'repository',
  'bugs',
  'homepage',
  'engines',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
] as const

const entries = ['main', 'module', 'types', 'bin', 'exports'] as const

function stripDist(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/^(?:\.\/)?dist\//, './')
  if (Array.isArray(value)) return value.map(stripDist)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripDist(v)]))
  return value
}

export function distPackage({ copy = ['README.md', 'LICENSE'], ignore = [] }: { copy?: string[]; ignore?: string[] } = {}): Plugin {
  return {
    name: 'dist-package',
    closeBundle() {
      const out = resolve(root, 'dist')
      mkdirSync(out, { recursive: true })
      const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>
      const clean: Record<string, unknown> = {}
      for (const key of keep) if (key in pkg) clean[key] = pkg[key]
      for (const key of entries) if (key in pkg) clean[key] = stripDist(pkg[key])
      writeFileSync(resolve(out, 'package.json'), JSON.stringify(clean, null, 2) + '\n')
      if (ignore.length) writeFileSync(resolve(out, '.npmignore'), ignore.join('\n') + '\n')
      for (const file of copy) copyFileSync(resolve(root, file), resolve(out, file))
      copyFileSync(resolve(root, 'build/pkg/renderer_bg.wasm'), resolve(out, 'renderer_bg.wasm'))
    },
  }
}
