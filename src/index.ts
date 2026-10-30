/* ---------------------------------------------------------
 * Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
 * This source code is licensed under the MIT license.
 * You may find the full license in project root directory.
 * ------------------------------------------------------ */
import { loadWasm, Scene } from './load.js'
import { wire, loadWire, type LoadOptions, type AssetInfo, type RenderOptions, type Renderer, type RenderResult } from './options.js'
import { encodePng } from './png.js'

export { encodePng }
export type {
  AssetInfo,
  Camera,
  Diagnostic,
  FitCamera,
  LoadOptions,
  NodeInfo,
  NodeSelector,
  PunctualLight,
  SceneInfo,
  ToneMapping,
  TransparencyOptions,
  Lighting,
  ShadowOptions,
  OrthographicCamera,
  PerspectiveCamera,
  RenderOptions,
  RenderResult,
  Renderer,
  Vec3,
} from './options.js'

function glbBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  throw new Error('GLB must be a Uint8Array or an ArrayBuffer')
}

export async function createRenderer(glb: Uint8Array | ArrayBuffer, options?: LoadOptions): Promise<Renderer> {
  const bytes = glbBytes(glb)
  const loadOptions = loadWire(options)
  await loadWasm()
  let scene: Scene | undefined = new Scene(bytes, JSON.stringify(loadOptions))
  const info: AssetInfo = JSON.parse(scene.info())
  const active = () => {
    if (!scene) throw new Error('renderer has been disposed')
    return scene
  }
  return {
    get info() {
      active()
      return structuredClone(info)
    },
    get triangles() {
      return active().triangles
    },
    async render(opts: RenderOptions) {
      const body = wire(opts)
      return { rgba: active().render(JSON.stringify(body)), width: body.width, height: body.height, diagnostics: structuredClone(info.diagnostics) }
    },
    dispose() {
      scene?.free()
      scene = undefined
    },
  }
}

export async function render(glb: Uint8Array | ArrayBuffer, opts: RenderOptions, loadOptions?: LoadOptions): Promise<RenderResult> {
  const renderer = await createRenderer(glb, loadOptions)
  try {
    return await renderer.render(opts)
  } finally {
    renderer.dispose()
  }
}
