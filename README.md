# @pcbjs/renderer

CPU rasteriser, compiled to WebAssembly. A glTF 2.0 binary in, an RGBA image out.

Node 22 or later. ESM only. No runtime dependencies.

## Install

```sh
npm install @pcbjs/renderer
```

## Example

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { encodePng, render } from '@pcbjs/renderer'

const glb = await readFile('model.glb')
const { rgba, width, height } = await render(glb, {
  width: 1600,
  height: 1000,
  camera: { type: 'fit', direction: [1, 1, 1] },
  highlight: { nodes: [0], dim: 0.25 },
})
await writeFile('model.png', await encodePng(rgba, width, height))
```

`rgba` is straight alpha, top row first. `encodePng` uses `node:zlib` in Node, and stored blocks where that module is missing.

`createRenderer(glb)` parses once. Call `render` again, then `dispose()`.

For focused inspection, a fit camera accepts `nodes: [0]` or explicit world-space `bounds: { min, max }`. `visibility: { only: [0], hidden: [1] }` filters geometry and shadow casters per frame; hidden nodes take precedence. Selectors include descendants, and names match every occurrence. Unknown selectors throw. The [API guide](https://github.com/pcbjs/renderer/blob/main/docs/api.md) describes framing, visibility and structured option errors.

Use `lighting: 'studio'` for GGX highlights and rough studio reflections, and `shadows: true` for filtered directional shadows. Both are opt-in. Shadows also accept `{ resolution: 1024, strength: 1 }`, with resolution limited to 256–2048 (at most 16 MiB of depth storage). Core glTF base-colour, metallic-roughness, normal, occlusion and emissive textures work in both lighting modes, with two UV sets, `KHR_texture_transform`, and authored sampler filtering including mipmaps. See [the API guide](https://github.com/pcbjs/renderer/blob/main/docs/api.md) for controls and limits.

Use `exposure` (EV stops) and `toneMapping: 'reinhard' | 'aces'` to control output; defaults use zero exposure adjustment and no tone mapping. `KHR_materials_emissive_strength` and `KHR_materials_unlit` are supported. Transparency adds at most 14 MiB of peeling buffers; `transparency.maxLayers` defaults to 32 and throws on overflow.

## Generic scene API

`createRenderer(glb, { scene: 0 })` selects an authored scene. `renderer.info` exposes nodes, names, extras, camera/light node indices and compatibility diagnostics. Select an authored camera with `{ type: 'asset', node: cameraNode }`, or use explicit perspective, orthographic or fit cameras. `nodeTranslations` provides non-destructive world-space offsets; node names and numeric indices work for highlighting. The renderer never interprets application extras.

`KHR_lights_punctual` supports directional, point and spot lights. Authored lights are used automatically when present, and can be replaced with `lights: [...]`. Base-colour factors use glTF's linear convention; load option `baseColorSpace: 'srgb'` accepts assets with sRGB-encoded factors. Sparse accessors and flat normals for meshes without `NORMAL` are supported.

Coordinates are metres, Y up, right-handed. See [API](https://github.com/pcbjs/renderer/blob/main/docs/api.md) and [specification](https://github.com/pcbjs/renderer/blob/main/docs/specification.md). This is a documented static GLB subset, not a claim of complete glTF conformance.

`width` and `height` throw above 4096 by 4096, before supersampling. `supersample` defaults to 2. A supersampled edge past 8192 throws before drawing.

`dim` 0 leaves a node. `dim` 1 is the background. The outline is `#ffcc33`, one output pixel, after downsample. `BLEND` composites per pixel, with a configurable layer limit; transparent materials receive but do not cast shadows. `MASK` discards below `alphaCutoff`. Lighting is linear. Base-colour textures are decoded from sRGB and the image is encoded once.
