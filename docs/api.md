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

`createRenderer(glb, loadOptions?)` keeps the parsed scene. Load options are `{ scene?: number, baseColorSpace?: 'linear' | 'srgb', unsupported?: 'warn' | 'error', selectionGeometry?: SelectionGeometry[] }`. Scene selection uses the authored default or scene 0 when omitted. Colour factors default to linear; `'srgb'` is an explicit override for assets with sRGB-encoded base-colour factors. Unsupported features produce structured diagnostics by default, or throw with `'error'`. Unsupported required extensions always throw. `render(glb, renderOptions, loadOptions?)` accepts the same options as its third argument and returns diagnostics alongside pixels.

`renderer.info` returns metadata for available scenes, the selected scene, its nodes (index, name, parent, extras, camera and light references), camera/light node indices, and diagnostics. Node extras are application-owned and never interpreted by the renderer. Metadata is returned as a detached snapshot.

`renderer.triangles` is the triangle count. `render` again for another frame, then `dispose()`. Disposal is idempotent; all queries, rendering and metadata access then throw. Rendering runs synchronously inside WebAssembly on the calling thread despite its Promise return; service callers should isolate it in a worker.

`encodePng(rgba, width, height, text?)` returns a PNG. `text` is a `Record<string, string>`; each entry becomes a separate `tEXt` chunk before image data. For example, `encodePng(rgba, width, height, { Snapshot: revisionId, Legend: 'Red: selected\nBlue: context' })`. Keywords are 1–79 printable Latin-1 characters, with no leading, trailing or consecutive spaces. Values accept printable Latin-1 and linefeeds; unsupported characters and NUL bytes throw rather than silently changing the text. These restrictions follow the [PNG text specification](https://www.w3.org/TR/png/#11textinfo). Node deflates with `node:zlib`; elsewhere the blocks are stored.

## Bounds and resolved frames

`renderer.bounds({ nodes?, visibility?, nodeTranslations? })` returns `{ min, max }` in world-space metres, or `null` when no geometry matches. Omit the argument to query the whole scene. Names/indices, descendants, visibility and accumulated translations have the same semantics as rendering. The query returns actual geometry bounds, without the minimum extent used for point fitting, and allocates no image buffer. Empty selections return `null`; unknown selectors throw.

`renderer.prepare({ width, height, camera?, visibility?, nodeTranslations?, mirror? })` returns a detached `ResolvedFrame` containing `width`, `height` and a resolved camera, without rasterizing. `render({ ..., includeFrame: true })` also returns this description as `result.frame`. Frame preparation uses the same Rust code as rendering. These methods and `project` are synchronous on a loaded renderer.

```ts
const frame = renderer.prepare({
  width: 800,
  height: 600,
  camera: { type: 'fit', nodes: [0], padding: { right: 160 } },
})
const points = renderer.project(frame, [[0, 0, 0]])
const saved = JSON.parse(JSON.stringify(frame))
const image = await renderer.render({ ...saved, highlight: { nodes: [0] } })
```

Replay by spreading the complete frame into `render`. Keep the scene, visibility, translations, lighting, supersampling and other image options unchanged for byte-identical output; the frame captures camera, dimensions and optional mirroring. A resolved camera is fixed in world space and is not translated again by `nodeTranslations`. Reusing it after geometry changes keeps the same view and clipping. Changing output dimensions stretches the stored projection to the new viewport; prepare a new fit when you want to reframe instead.

`ResolvedCamera` has `{ type: 'resolved', state }`. The state contains `position`, the orthonormal `right`, `up` and `forward` vectors, `near`, `far`, `offset` and `projection`. `far: null` represents infinity and survives JSON serialization. `offset` is the two-component normalized device-coordinate projection shift. Perspective projections store `{ type: 'perspective', tanHalfV, tanHalfH }`; orthographic projections store `{ type: 'orthographic', halfWidth, halfHeight }` in metres. Keeping both extents preserves authored aspect ratios without reconstructing a target/FOV. Prefer replaying returned state to constructing it; invalid bases, extents and clipping planes throw.

`renderer.project(frame, worldPoints)` returns `{ x, y, depth, behind, clipped }` per point. Coordinates are in output pixels with the top-left image edge at `(0, 0)` and pixel centers at half-integers. Depth is signed distance along camera forward in metres, not normalized device depth. `clipped` indicates a point outside the inclusive viewport edges or near/far planes. For perspective points at or behind the eye, `behind` is true, `x` and `y` are null and `clipped` is true. Projection does not test scene occlusion. It uses the same projection as rasterization and is independent of supersampling; rounding a projected landmark to a pixel introduces up to half a pixel per axis.

## Options

`width` and `height` throw above 4096 by 4096, before supersampling. `supersample` defaults to 2. A supersampled edge past 8192 throws before drawing.

`mirror: true` reflects the view horizontally before annotation composition. Geometry colour, selection masks, depth and node IDs agree; projected annotation anchors and sharp edges follow the reflected geometry, while label pixels and pixel offsets remain upright. The camera basis remains right-handed. Prepared and returned frames retain `mirror: true`, and `project` returns reflected pixel coordinates. Fit padding always refers to the final output edges, including mirrored views. Mirroring defaults to false.

`camera` is a discriminated union:

| Type             | Parameters                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'fit'`          | Optional `direction` from target toward camera (default `[1, 1, 1]`), `up` (default `[0, 1, 0]`), `projection` (`'perspective'` or `'orthographic'`), vertical `fov` in degrees (35), and `margin` (1.08, at least 1) |
| `'perspective'`  | `position`, `target`, optional `up`, vertical `fov` in degrees, `near` and `far`                                                                                                                                      |
| `'orthographic'` | `position`, `target`, `height` in metres, optional `up`, `near` and `far`                                                                                                                                             |
| `'resolved'`     | `state`: exact camera state returned by `prepare` or `includeFrame`, including projection offset                                                                                                                      |
| `'asset'`        | `node`: index of a camera-bearing node in the selected scene                                                                                                                                                          |

Omitting the camera uses a perspective fit. Explicit cameras derive clipping planes from scene bounds unless provided. Perspective near must be positive; orthographic near can be zero; far must exceed near. Authored cameras use glTF clipping planes, FOV and aspect ratio. A perspective camera without `aspectRatio` follows the output aspect; an omitted `zfar` is infinite. Orthographic `xmag` and `ymag` are preserved. An explicit authored aspect fills the requested viewport; no letterboxing is added.

A fit camera also accepts `nodes: NodeSelector[]` or `bounds: { min: Vec3, max: Vec3 }`, mutually exclusive. Node targets include descendants and use visible geometry after `nodeTranslations`. An empty node list, or a target with no visible geometry, throws. Bounds are world-space metres with `min <= max` on every axis; flat bounds are valid. A target whose diagonal is less than one micrometre uses a 1 mm cube around its centre to keep point close-ups finite. Omit both to fit all visible geometry. Changing the fit target changes framing without hiding other objects. Clipping retains visible surrounding geometry in front of the camera; orthographic fitting moves the camera back when necessary without changing its image scale. Perspective focus can place the camera inside surrounding geometry; use visibility filtering when context obstructs the target.

Fit cameras also accept `padding: { top?, right?, bottom?, left? }` in output pixels. Edges default to zero, must be finite and non-negative, and must leave a positive viewport. The target is fitted inside that rectangle with the existing multiplicative `margin`; surrounding geometry can still appear in the reserved area. Asymmetric padding shifts the projection center without rotating the view. Padding is independent of supersampling and is preserved in resolved-camera replay. It does not apply to explicit or authored cameras.

```ts
import { createRenderer } from '@pcbjs/renderer'

const renderer = await createRenderer(glb)
try {
  const image = await renderer.render({
    width: 800,
    height: 600,
    camera: { type: 'fit', nodes: [0], direction: [1, 1, 1] },
    visibility: { only: [0] },
    highlight: { nodes: [0] },
  })
} finally {
  renderer.dispose()
}
```

`visibility: { only?: NodeSelector[], hidden?: NodeSelector[] }` filters geometry for one frame, including shadow casters. Both selectors include descendants. `hidden` wins over `only`, including a hidden ancestor of an explicitly included child. Omit `only` to include all geometry; `only: []` draws only the background. Default fitting and shadow bounds exclude hidden geometry. Visibility does not disable authored lights or cameras, mutate scene metadata, or change `renderer.triangles`, which remains the loaded count. Calls without visibility options restore the complete scene.

Node selectors in visibility, fitting and highlighting accept names or numeric indices in the selected scene. Names match every node with that name; indices disambiguate duplicates. Unknown names and indices throw instead of silently selecting nothing. A known node without geometry is valid for visibility/highlighting but cannot be a fit target by itself.

Public TypeScript option validation throws `OptionError` with `code: 'INVALID_OPTION'` and `path`, including nested unknown keys and incorrect types. Node lookups through rendering, preparation and bounds queries use `code: 'UNKNOWN_NODE'` and the selector's path, such as `visibility.hidden[0]`. `OptionError` extends `Error` and is exported from the package. Asset loading and core failures use `RendererError`; see the error and worker contract below.

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

PNG and JPEG dimensions are checked before pixel decoding. The maximum edge is 4096 pixels. Each scene has a 512 MiB decoded-texture budget covering retained float RGBA colour/data views, their mip chains and conservative temporary decode/RGBA storage; the decoder also has a 128 MiB allocation budget. Shared samplers count one image, but separate colour and data views count independently. These fixed limits return recoverable `RendererError` code `TEXTURE_LIMIT` instead of attempting the oversized pixel allocation. A 4096-square float RGBA view with all mipmaps occupies about 341 MiB, so multiple such views can exceed the scene budget. This is a texture allocation guard, not a limit on total scene or process memory.

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

## Inspection styles and annotations

`styles` accepts at most 32 ordered groups. A node group has `{ nodes?, opacity?, saturation?, tint?, rim?, outline? }`. Omitted nodes match all visible draws; an empty list matches none. Names and indices include descendants. The last matching group replaces the complete earlier style. Omitted properties then use their defaults, rather than inheriting an earlier group.

Opacity and saturation range from 0 to 1 and default to 1. Opacity changes compositing, independently of `highlight.dim`; faded surfaces receive shadows but do not cast them. Opacity zero does not remove geometry from bounds or fitting; use visibility for that. Saturation uses linear luminance. Tint and Fresnel rim are sRGB RGBA colours whose alpha controls strength. Rim colour adds a faint contribution at grazing angles. Material alpha masking still happens before style opacity.

`outline: { color?, width?, occludedAlpha?, depthBias? }` draws an antialiased silhouette after supersampling. Colour defaults to opaque white, width to 1.5 output pixels (maximum 32), occluded alpha to zero, and depth bias to zero metres. Bias must be finite and between 0 and 1000 metres. A separate mask uses the same resolved camera, visibility and translations, but ignores style opacity so invisible selections can still be outlined. Reduced-alpha occluded outlines are explicitly enabled by `occludedAlpha`.

```ts
const image = await renderer.render({
  width: 800, height: 600,
  styles: [
    { saturation: 0.2 },
    { nodes: [selectedNode], tint: [1, 0.7, 0, 0.1], rim: [1, 0.7, 0, 0.08], outline: { color: [1, 0.7, 0, 1], occludedAlpha: 0.2 } },
  ],
  annotations: [{ id: 'finding-1', type: 'ring', position: worldPosition, node: selectedNode, radius: 8, width: 1.5, color: [1, 0.2, 0.1, 1], depth: 'always' }],
})
```

Annotations have unique nonempty opaque IDs, an optional sRGB RGBA colour, `depth: 'test' | 'always'` (default test), and optional `depthBias` in metres with the same bounds as outlines. Both depth modes obey camera near/far clipping. Array order determines compositing order. Positions are world-space metres after authored transforms. An optional `node` adds accumulated per-frame translations only; `selection` instead uses a selection item's anchor node. Node and selection anchors are mutually exclusive. Annotations remain present when an anchor's geometry is hidden; their depth mode determines occlusion. They never change fitting, bounds or auxiliary images.

| Type     | Geometry                                          | Appearance                                                                                    |
| -------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `marker` | `position: Vec3`                                  | Filled disc; `radius` defaults to 4 output pixels                                             |
| `ring`   | `position: Vec3`                                  | Required `radius`; `width` defaults to 1.5 output pixels                                      |
| `line`   | `start: Vec3`, `end: Vec3`                        | `width` defaults to 1.5 output pixels; clipped and depth-interpolated along the segment       |
| `label`  | `position: Vec3`, optional pixel `offset: [x, y]` | Caller-rasterized `image: { width, height, rgba: Uint8Array }`; anchor is its top-left corner |

At most 4096 annotations are accepted. Radii are at most 256 output pixels and widths at most 32. Label edges are at most 2048 pixels, with at most 16 MiB of label RGBA per request. Labels use straight-alpha sRGB pixels, their own colours unless `color` replaces RGB, and the supplied colour alpha multiplies image alpha. The caller owns text layout, fonts and Unicode shaping. Label pixels test against scene depth at the anchor's camera depth; this is a billboard compositor, not a surface decal. Scene colour is already tone mapped; overlay colours are composited in linear light and re-encoded to sRGB.

## Separate selection geometry

Supply `selectionGeometry` in load options as an array of `{ id, node?, positions, indices }`. Positions are flat XYZ values in a `Float32Array` or `number[]`, in world-space metres after authored transforms; indices are triangle triples in a `Uint32Array` or `number[]`. Typed subarrays are supported. One ID can cover disconnected surfaces in the same indexed geometry. IDs must be nonempty and unique within the loaded scene. Indices, finite float32 coordinates and anchors are validated before retaining the geometry. Limits are 65536 items and 64 MiB total float32 positions plus uint32 indices. Typed inputs pass directly through wasm-bindgen into linear memory, without JSON serialization or expansion into JavaScript number arrays. Plain arrays are validated and converted per item. Inputs are copied during loading; subsequent caller mutation does not affect the scene, and the caller retains ownership.

These triangles are separate from ordinary GLB draws. They never affect ordinary pixels, shadows, scene bounds, default fitting, node-ID outputs or `renderer.triangles`. `renderer.info.selections` lists `{ id, node?, triangles }`. An optional node anchor adds that node's accumulated per-frame translations and subjects the proxy to host visibility. Unanchored items have no node ancestry and therefore do not match `visibility.only` selectors.

Use `bounds({ selections: ['item-id'], ... })` or a fit camera's `selections` to target these shapes. Selection IDs, node selectors and explicit fit bounds are mutually exclusive. Empty selected bounds return null; empty fit targets throw. A style with `selections` accepts `tint` as an overlay fill and `outline`; node opacity, saturation and rim properties cannot be combined with selection IDs. Later styles own repeated IDs, and later fills composite over earlier overlapping IDs. Selection depth accepts exact coplanar ties against the visible image. Fill occlusion uses the outline's `occludedAlpha` and `depthBias`, or zero defaults when no outline is supplied. Geometry is never displaced toward the camera.

The exporter owns semantic-ID mapping and rebuilding it when a revision changes. This API does not prescribe a GLB extension or decode application reference strings. It preserves merged visible surfaces while retaining overlapping original item shapes for inspection.

## Depth, IDs and sharp edges

`outputs: { depth: true, nodeIds: true }` opts into `Float32Array depth` and `Uint32Array nodeIds`. Both have `width * height` elements, top row first. Depth is camera-forward distance in metres, with `Infinity` for no hit. IDs are glTF leaf-node indices, with `0xffffffff` for no hit. They are scene-local geometry identifiers, not semantic item IDs.

Each output pixel uses the supersample at `(floor(supersample / 2), floor(supersample / 2))`, so even sample counts choose the lower/right central sample. Values are not averaged over coverage. The nearest positive-alpha blended fragment owns depth and ID; fully transparent fragments and discarded MASK fragments do not. A faded surface therefore still occludes depth-tested annotations. Use always-visible annotations or reduced-alpha occluded outlines when that is unwanted. These buffers describe geometry before overlays and highlights. They each cost four bytes per output pixel and are retained only when requested; annotation and outline passes obtain depth internally as needed.

`edges: { nodes?, angle?, color?, width?, depthBias? }` renders geometric sharp edges using the same line compositor. `renderer.edges({ nodes?, angle?, visibility?, nodeTranslations? })` returns `{ start, end, node }` segments for caller composition. The angle threshold defaults to 30 degrees and accepts 0 through 180. Boundary and nonmanifold edges are included; adjacent triangles below the threshold are excluded. Exactly coincident vertices are welded within each draw, including duplicated vertices with different normals. Draw/material boundaries are not welded across draws. Queries are deterministic and recompute topology; cache their results per scene revision if needed. At most 131072 returned segments are accepted. Rendered edges default to opaque black and one output pixel, with zero depth bias.

## Errors and worker ownership

`RendererError` exposes `code`, `operation` and `recoverable`. Codes are `TEXTURE_LIMIT`, `ASSET_INVALID`, `INITIALIZATION_FAILED`, `RENDER_FAILED`, `WASM_TRAP` and `DISPOSED`. Option errors retain their more precise path and code. Invalid requests, invalid replacement assets and ordinary rendering failures can leave an existing scene usable; WASM traps invalidate the affected handle. A trap requires discarding the entire worker/runtime, including other handles in that runtime. `serializeError(error)` produces a plain transport record without a stack; unknown exceptions are conservatively marked unrecoverable. Do not parse human-readable messages as codes.

Import `RendererWorker` from `@pcbjs/renderer/worker` for the packaged Node worker and typed client:

```ts
import { RendererWorker } from '@pcbjs/renderer/worker'

const worker = new RendererWorker()
try {
  const { info, triangles } = await worker.load(glb, { selectionGeometry })
  const image = await worker.render({ width: 800, height: 600, mirror: true })
  await worker.replace(nextGlb)
} finally {
  await worker.terminate()
}
```

`load` requires an empty worker; `replace` also accepts an empty worker and installs a fully loaded scene before disposing the previous one. Both resolve to `{ info, triangles }`. `render`, `bounds`, `prepare`, `project` and `edges` accept the renderer method arguments and return Promises. Calls run in message order, so a render sent immediately after load waits for that load. Failed requests return serialized error fields (`code`, `path` or `operation`, `recoverable`) on an Error. A rejected replacement leaves the previous scene usable. Fatal WASM traps require terminating the worker and creating a new one.

The typed protocol is `WorkerRequest { id, method, args }` with a matching `WorkerResponse { id, result }` or `{ id, error }`. `request(method, args, transfer?)` exposes that transport with correlation IDs managed by the client. Inputs use structured cloning by default. `load(glb, options?, transfer?)` and `replace(glb, options?, transfer?)` optionally accept an array of `ArrayBuffer`s to transfer ownership, including typed selection buffers; transferred buffers detach in the caller. Completed RGBA/depth/ID buffers always transfer back. `terminate()` is idempotent, stops the worker immediately and rejects outstanding calls with `DISPOSED`; it is the cancellation mechanism for synchronous WASM work. There is no in-band terminate message that waits behind a long render.

The package imposes no queue limit, timeout, retry or scene-cache policy. `examples/worker-client.mjs` wraps this package entry to demonstrate bounded scheduling, request timeouts, cached-scene reload and one retry after a trap. pcbjs owns revision checks, cache keys, scheduling, fonts, MCP/CLI transport and production recovery policy.
