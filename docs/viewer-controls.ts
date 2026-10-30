/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import type { Lighting, ToneMapping } from '../src/options'

export type ViewPreset = 'fit' | 'top' | 'bottom' | 'iso' | 'front'
export interface ViewerSettings {
  orthographic: boolean
  lighting: Lighting
  shadows: boolean
  transparent: boolean
  exposure: number
  toneMapping: ToneMapping
  focusNode: number | null
  dim: number
  separation: number
}
export const defaultSettings: ViewerSettings = {
  orthographic: false,
  lighting: 'classic',
  shadows: false,
  transparent: true,
  exposure: 0,
  toneMapping: 'none',
  focusNode: null,
  dim: 0.75,
  separation: 0,
}
