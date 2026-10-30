/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'rollup-plugin-esbuild'
import { dts } from 'rollup-plugin-dts'
import type { RollupOptions } from 'rollup'
import { distPackage } from './dist-package.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const r = (...p: string[]) => resolve(root, ...p)
const external = [/^node:/]

const config: RollupOptions[] = [
  {
    input: r('src', 'index.ts'),
    external,
    output: { format: 'esm', file: r('dist', 'index.mjs'), sourcemap: true },
    plugins: [esbuild({ target: 'node22' })],
  },
  {
    input: r('src', 'index.ts'),
    external,
    output: { format: 'esm', file: r('dist', 'index.d.ts') },
    plugins: [dts(), distPackage({ copy: ['README.md', 'LICENSE'], ignore: ['*.map'] })],
  },
]

export default config
