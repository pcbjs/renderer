/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { fileURLToPath } from 'node:url'

export const pcbjsRoot = process.env.PCBJS_ROOT ?? fileURLToPath(new URL('../../../pcbjs/', import.meta.url))
