---
title: API
description: render, createRenderer, encodePng.
outline: [2, 3]
---

# API

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

`rgba` is straight alpha, top row first. `glb` is a `Uint8Array` or an `ArrayBuffer`.

`createRenderer(glb, loadOptions?)` keeps the parsed scene. Load options are `{ scene?: number, baseColorSpace?: 'linear' | 'srgb', unsupported?: 'warn' | 'error' }`. Scene selection uses the authored default or scene 0 when omitted. Colour factors default to linear; `'srgb'` is an explicit override for assets with sRGB-encoded base-colour factors. Unsupported features produce structured diagnostics by default, or throw with `'error'`. Unsupported required extensions always throw. `render(glb, renderOptions, loadOptions?)` accepts the same options as its third argument and returns diagnostics alongside pixels.

`renderer.info` returns metadata for available scenes, the selected scene, its nodes (index, name, parent, extras, camera and light references), camera/light node indices, and diagnostics. Node extras are application-owned and never interpreted by the renderer. Metadata is returned as a detached snapshot.

`renderer.triangles` is the triangle count. `render` again for another frame, then `dispose()`. Disposal is idempotent; further rendering or triangle-count access throws a clear error.

`encodePng(rgba, width, height)` returns a PNG. Node deflates with `node:zlib`. Elsewhere the blocks are stored.

## Options

`width` and `height` throw above 4096 by 4096, before supersampling. `supersample` defaults to 2. A supersampled edge past 8192 throws before drawing.

`camera` is a discriminated union:

| Type             | Parameters                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'fit'`          | Optional `direction` from target toward camera (default `[1, 1, 1]`), `up` (default `[0, 1, 0]`), `projection` (`'perspective'` or `'orthographic'`), vertical `fov` in degrees (35), and `margin` (1.08, at least 1) |
| `'perspective'`  | `position`, `target`, optional `up`, vertical `fov` in degrees, `near` and `far`                                                                                                                                      |
| `'orthographic'` | `position`, `target`, `height` in metres, optional `up`, `near` and `far`                                                                                                                                             |
| `'asset'`        | `node`: index of a camera-bearing node in the selected scene                                                                                                                                                          |

Omitting the camera uses a perspective fit. Explicit cameras derive clipping planes from scene bounds unless provided. Perspective near must be positive; orthographic near can be zero; far must exceed near. Authored cameras use glTF clipping planes, FOV and aspect ratio. A perspective camera without `aspectRatio` follows the output aspect; an omitted `zfar` is infinite. Orthographic `xmag` and `ymag` are preserved. An explicit authored aspect fills the requested viewport; no letterboxing is added.

```ts
await render(glb, {
  width: 800,
  height: 600,
  camera: { type: 'perspective', position: [3, 2, 3], target: [0, 0, 0], fov: 35 },
})
```

`background` is sRGB red, green, blue and linear alpha, or `'transparent'`. Default `[0.93, 0.94, 0.95, 1]`.

`light.direction` controls the fallback rig and points toward the light. Default `[-30, 100, 60]`. `light.ambient` defaults to 0.25. `light.hemisphere` defaults to 0 and adds light from +Y when set.

`lighting` defaults to `'classic'`, preserving the existing appearance. Set `'studio'` for GGX metallic highlights and a procedural studio environment with roughness-dependent reflections. `light.ambient` also controls the studio environment intensity; zero ambient and hemisphere leave only the directional light. The environment is an approximation with fixed soft lights in world space, not a loaded HDR image. Output clips to the display range without tone mapping.

`lights` is `'asset'` (default), `'default'`, or an array of explicit punctual lights. Asset mode uses selected-scene lights, falling back to the default rig if none are present. An explicit array replaces both; `[]` disables direct lighting. `light.ambient` and `light.hemisphere` remain independent indirect contributions; set both to zero to isolate punctual lighting.

```ts
await render(glb, {
  width: 800, height: 600,
  lighting: 'studio',
  light: { ambient: 0, hemisphere: 0 },
  lights: [
    { type: 'directional', direction: [-1, -1, -1], color: [1, 0.9, 0.8], intensity: 3 },
    { type: 'point', position: [2, 3, 1], intensity: 20, range: 10 },
    { type: 'spot', position: [0, 3, 0], direction: [0, -1, 0], intensity: 10, innerConeAngle: 0.2, outerConeAngle: 0.6 },
  ],
})
```

Punctual directions follow emitted rays, opposite the fallback rig's target-to-light direction. Colours are linear RGB, default white; intensity defaults to 1 and uses glTF units (lux for directional, candela for point/spot). Point and spot lights use inverse-square attenuation, optionally fading to zero at `range` in metres. Spot angles are radians, default 0 and π/4, with `0 <= inner < outer <= π/2`. Authored lights inherit node transforms; scale does not change intensity, range or cone angles.

`shadows` defaults to `false`. Set `true` for a 1024 × 1024 directional shadow map, or `{ resolution: 512, strength: 0.8 }`. Resolution is an integer from 256 to 2048, independent of output supersampling; strength is 0 to 1. The depth buffer uses 4 MiB at 1024 and at most 16 MiB at 2048, plus temporary vertex projections. A 3 × 3 filter softens shadow edges. Shadows affect directional light only, respect `MASK`, and follow `nodeTranslations`. They fall on scene geometry; no ground plane is inserted. The map fits the entire scene, so widely separated objects reduce shadow detail. With multiple lights, only the first directional light casts shadows; point and spot lights currently do not. A map is rebuilt for each render; larger maps and more geometry cost more time.

```ts
await render(glb, {
  width: 1600,
  height: 1000,
  lighting: 'studio',
  shadows: { resolution: 1024, strength: 1 },
})
```

`highlight.nodes` accepts node indices or names and includes descendants. Names match every occurrence; numeric indices disambiguate duplicate names. Other nodes mix toward the background by `dim`: 0 leaves them, 1 is the background. Default `dim` is 0.25. Named nodes get a 1 pixel `#ffcc33` outline after downsampling.

`exposure` is an EV adjustment from -20 to 20, default 0; +1 doubles linear RGB. `toneMapping` is `'none'` (default, clips to display range), `'reinhard'` or `'aces'`. The ACES option uses the [Narkowicz fitted curve](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/), not the full ACES colour pipeline. Exposure and tone mapping run after linear compositing and supersample resolution, before sRGB encoding. They affect background and unlit colour too, preserve alpha, and leave selection outlines unchanged.

```ts
await render(glb, {
  width: 1600,
  height: 1000,
  lighting: 'studio',
  exposure: -0.5,
  toneMapping: 'aces',
  transparency: { maxLayers: 32 },
})
```

`nodeTranslations` is an array of `{ node: number, translation: [x, y, z] }`, in world-space metres. Ancestor and duplicate entries accumulate. These offsets affect geometry, framing, authored cameras, lights and shadows without mutating the asset. Unknown or inactive node indices throw. Applications can implement exploded views by mapping their own metadata to these translations.

## Coordinates

Metres, Y up, right-handed. Camera positions, targets, light positions and node translations use that space. Fit directions point from the target toward the camera. Application coordinate conversions belong in the caller or exporter. For example, use `[0, 0, 1]` for a front view, `[0, 1, 0.001]` for a top view, or `[0.55, 0.9, 0.95]` for the docs viewer’s isometric view.

## Shading

Base colour factors are linear; base colour textures are sRGB. Vertex colours are linear. Lighting is linear. The image is encoded to sRGB once. Metallic factor drops the directional diffuse colour and tints the specular. Ambient and hemisphere light retain the base colour on metals as an approximation of environment reflections. Textures are PNG or JPEG with repeat, clamp or mirrored repeat wrapping.

`MASK` discards below `alphaCutoff`. `OPAQUE` writes opaque fragments. `BLEND` composites base-factor, texture and vertex alpha in linear colour space, ordered per pixel even for intersecting surfaces. See the transparency limits below.

A truncated GLB, a missing accessor, or an unsupported required extension throws and names the problem. The same input returns the same bytes.

Core glTF `emissiveFactor` and `emissiveTexture` work in either lighting mode. The factor is linear RGB and defaults to zero. The texture is decoded from sRGB, uses its selected UV set, and ignores its alpha channel. Emission is added after lighting and before highlight dimming. `KHR_materials_emissive_strength` multiplies emission by its finite, non-negative `emissiveStrength` (default 1), retaining values above 1 until output conversion. It does not illuminate neighbours or add bloom.

`KHR_materials_unlit` displays base colour, texture and vertex colour without lighting, emission, normal maps or occlusion. Alpha mode, face culling, highlighting and output transforms still apply. Unlit and emissive-strength extensions are accepted in `extensionsRequired`; combining them on one material is invalid.

## Transparency

The viewer’s Transparency scene includes intersecting translucent shells, a bright emitter inside, and an unlit marker. Use its exposure and tone-mapping controls to inspect output conversion.

`BLEND` uses front-to-back depth peeling against the opaque and masked depth buffer. Exact depth ties prefer opaque surfaces; ties between transparent triangles follow authored draw and triangle order. Shared triangle edges use exclusive coverage to avoid counting alpha twice. Zero-alpha fragments contribute neither colour nor selection IDs. The nearest contributing transparent fragment owns the selection outline; highlight dimming happens before composition.

`transparency.maxLayers` limits contributing transparent layers per sample, default 32, integer 1–128. Exceeding it throws an error instead of silently dropping surfaces. Fully opaque accumulation stops traversal behind that sample. Extra transparency storage is bounded to 14 MiB using horizontal bands; rendering cost grows with visible layer count and geometry. Opaque-only scenes allocate no peeling buffers and run no transparent passes.

Transparent materials receive shadows from opaque and masked geometry but do not cast shadows, including `BLEND` materials with alpha 1. Coloured shadows, refraction and physically based transmission are not implemented. Use `OPAQUE` for solid surfaces and `MASK` for cutouts.

## Material textures

The viewer’s Materials scene shows mapped roughness on copper, a normal-mapped blue surface, and transformed colour with occlusion on a second UV set. Enable Studio light and Shadows to inspect the result.

The core metallic-roughness material supports these glTF inputs in both lighting modes:

| Input                      | Interpretation                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseColorTexture`         | sRGB colour, linear alpha; multiplied by the existing base factor and linear vertex colour                                                       |
| `metallicRoughnessTexture` | Linear data: green multiplies roughness, blue multiplies metallic; red and alpha are ignored                                                     |
| `normalTexture`            | Linear tangent-space XYZ mapped from [0, 1] to [-1, 1]; `scale` multiplies X and Y before normalization                                          |
| `occlusionTexture`         | Linear red channel; `strength` mixes between no occlusion and the sampled value, affecting ambient, hemisphere and studio environment light only |
| `emissiveTexture`          | sRGB colour multiplied by the linear emissive factor                                                                                             |

A shared image can supply both colour and data channels. Each interpretation is decoded and filtered separately. Use load option `baseColorSpace: 'srgb'` only for assets authored for the earlier nonstandard factor convention.

Each texture slot independently selects `TEXCOORD_0` or `TEXCOORD_1`. Missing referenced UV attributes and higher UV indices throw. `KHR_texture_transform` supports offset, rotation in radians, scale and a UV-set override, including when listed in `extensionsRequired`. The transform applies scale, then rotation, then offset.

Normal maps use authored `TANGENT` vectors when normals are present, or MikkTSpace tangents generated from the selected UV set. Tangents use the source UV basis; texture transforms affect texture lookup. Mirrored node transforms preserve winding and tangent handedness. Generated tangents are stored per triangle corner to preserve seams. Missing normals generate flat per-face normals; authored tangents are ignored in that case. Degenerate tangent frames fall back to the unperturbed normal. Normal maps affect shading, not geometry silhouettes or shadow depth.

## Texture filtering

Both magnification filters and all six glTF minification filters are supported: nearest, linear, and the four combinations of nearest/linear texels with nearest/linear mip levels. Unspecified filters retain bilinear sampling without mipmaps for compatibility. Export a mipmapped `minFilter`, such as `9987` (`LINEAR_MIPMAP_LINEAR`), to enable mipmaps.

Mipmaps are generated once at load time for each needed colour/data view. Non-power-of-two images retain the contribution of every source texel. Mip selection uses perspective-correct screen-space UV derivatives, including UV transforms and the shadow pass. Supersampling uses the actual sample resolution. Filtering is isotropic; anisotropic filtering and alpha-coverage-preserving mask mipmaps are not implemented.

A full mip chain adds about one third to texel storage for square power-of-two images. Images used as both colour and data need two decoded views; views and their mip chains are shared across texture samplers. Tangent generation adds load-time work only for normal-mapped geometry without authored tangents.

Sparse vector and index accessors are supported, including zero-filled bases, strided base data and normalized values. Transmission, skins, morph targets, animation playback, lines, points, Draco, Meshopt, and additional/external buffers remain unsupported. See the [specification](./specification) for diagnostics and validation coverage.
