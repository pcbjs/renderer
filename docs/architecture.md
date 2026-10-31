---
title: Architecture
---

# Architecture

The TypeScript API validates and serializes small options, transfers selection coordinates/indices as typed WASM arrays, loads WebAssembly once, and owns each scene's lifetime. Scene ownership lives in `src/renderer.ts`, separate from the Node entry point. The Rust renderer takes a parsed scene and frame options, and returns straight-alpha RGBA. File loading stays in `src/load.ts`; rendering has no filesystem or board-specific dependencies.

| Stage                | Module                 | Responsibility                                                                                                                 |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Import               | `core/gltf/`           | Validate GLB chunks and accessor spans, decode shared colour/data image views, traverse node transforms and build static draws |
| Scene                | `core/model.rs`        | Geometry, material references, names, bounds and node ancestry                                                                 |
| Options              | `core/options.rs`      | Deserialize the wire format and validate native inputs                                                                         |
| Frame preparation    | `core/frame.rs`        | Resolve cameras, node offsets and translated bounds independently of rasterisation                                             |
| Geometry             | `core/geometry.rs`     | Project vertices once per frame, reject offscreen triangles and interpolate attributes at the near plane                       |
| Surface and lighting | `core/material.rs`     | Sample material inputs, apply alpha masking, then light the surface with prepared material constants                           |
| Scene metadata       | `core/gltf/scene.rs`   | Scene choice, compatibility diagnostics, camera instances and punctual light instances                                         |
| Punctual lighting    | `core/punctual.rs`     | Directional, point and spot sampling with physical attenuation                                                                 |
| Studio lighting      | `core/lighting.rs`     | GGX direct lighting and analytic rough environment reflections                                                                 |
| Shadows              | `core/shadow.rs`       | Fit a directional depth map to translated bounds and filter visibility in world space                                          |
| Textures             | `core/texture.rs`      | Share image storage across independent samplers and perform nearest, bilinear and mipmapped sampling                           |
| Rasterisation        | `core/raster.rs`       | Coverage, perspective-correct fragment interpolation, UV derivatives and depth testing                                         |
| Transparency         | `core/transparency.rs` | Bound per-band depth peeling storage and composite linear premultiplied layers                                                 |
| Output               | `core/framebuffer.rs`  | Reuse band buffers, resolve supersamples and draw selection outlines                                                           |
| Orchestration        | `core/render.rs`       | Prepare materials and draws from the shared frame, then render and resolve each band                                           |

Colour and shadow passes share projection, clipping, coverage and depth interpolation. The shadow pass allocates depth only and samples material alpha only for `MASK`. Receiver-plane depth correction from triangle geometry and a texel-scaled bias limit self-shadow artifacts. Ambient, environment and emissive contributions bypass shadow visibility. Canonical double-precision edge equations avoid accumulated coverage error on long, thin triangles; float interpolation and colour buffers retain the existing memory footprint. Flat triangle colour caching covers constant unlit surfaces and classic lighting without shadows or texture-dependent material channels. Transparent materials receive opaque and masked shadows but are excluded from shadow casting.

Projection storage is proportional to vertex count. Images above the direct-render pixel budget use reusable horizontal bands aligned to supersample rows. Resolution writes directly into the output byte buffer, with no full-frame float accumulator. Selection ID buffers are allocated only when highlighting or node-ID output is requested. Identical resolved pixels reuse their sRGB encoding without quantization or approximate colour conversion.

RGBA stays linear during lighting and resolution. Supersample resolution averages premultiplied colour and alpha, then unpremultiplies, applies exposure and optional tone mapping, and encodes sRGB once. This keeps transparent edges valid for PNG and Canvas straight-alpha consumers. `BLEND` composites before resolution, and `MASK` discards below the cutoff. Selection outlines are drawn after output colour conversion.

Tangents are transformed as directions, normals with the inverse transpose, and mirrored nodes reverse triangle winding and tangent handedness. MikkTSpace generates missing tangents in object space from the selected source UVs. Corner storage preserves discontinuities without duplicating all vertex attributes. Missing normals use flat corner normals, including the tangent-generation basis. Sparse accessors expand validated patches over tight or strided base values once at import; index patches retain integer precision. Both UV sets and tangent vectors participate in near clipping and perspective interpolation. Texture derivatives are computed only for samplers that need them, and adjusted by each slot’s UV transform.

## Extending the renderer

Material sampling is separate from lighting. Base colour, emissive, metallic-roughness, normal and occlusion slots each bind a texture, UV set and transform. Colour slots decode sRGB before filtering; data slots retain their numeric channels. Image views and mip chains are prepared according to material usage and shared independently of sampler state. New interpolated attributes must be added to `Fragment` and its clipping and perspective interpolation methods together. Texture images and sampler state are separate so additional filtering and mip levels do not require changes to scene traversal.

The transparent pass peels nearest fragments using a depth and authored triangle-order key, tests against opaque depth, and accumulates premultiplied colour front to back. Exclusive shared-edge coverage prevents double alpha on triangulated surfaces. Bands cap extra peeling storage at 14 MiB; a configurable layer limit throws on overflow. The nearest contributing fragment supplies the selection ID. Opaque draws keep their original coverage and depth path. Future transmission needs access to scene colour and a separate refraction policy; changing alpha alone cannot provide it.

Node translations are supplied explicitly at render time and accumulated through stored ancestry; application extras remain metadata. Camera and light instances use the same offsets as geometry. Authored camera projection and clipping parameters are preserved; directional shadow maps follow the first active directional light.

Frame preparation resolves visibility and highlight selectors against the selected scene's nodes and applies them through draw ancestry. Hidden geometry is excluded from projection, transparency passes, shadow casting and scene bounds. A fit target has separate bounds from the visible context: the former sets the image framing and the latter preserves clipping and shadow coverage. Filtering leaves the loaded scene immutable and keeps authored lights and cameras available.

Bounds queries share draw filtering and translated bounds with frame preparation, without allocating raster buffers. Resolved frames serialize the exact camera basis, both projection extents, clipping and normalized projection offset; an infinite far plane becomes JSON null. Replay validates this state and uses it directly without refitting or applying node translations again. Point projection and triangle projection call the same camera functions. Optional frame metadata is prepared through the same deterministic path as the image; default results do not include it.

Fit padding uses the remaining viewport's aspect and effective vertical field of view, then scales the projection extents back to the full image and offsets its center. It changes neither camera orientation nor shadow framing. The resolved projection carries that offset through replay, clipping and output-pixel projection. Visibility and translations remain per-request scene state, separate from the camera snapshot.

The importer currently bakes node transforms into static world-space geometry. Skinning, morph targets and dynamic instancing require preserving their source geometry and deformation data, then supplying transformed vertices before projection. The loader and geometry stage are separate so those additions do not need to change material sampling, PNG encoding or the public scene lifetime API.

Transmission, skins, morph targets and compressed geometry remain unimplemented. Studio reflections approximate a fixed environment; HDR environments and image-based lighting prefilters remain future work.

## Verification

Build before running the Node tests, which import `dist/`. Run `cargo test` for native coverage of clipping, texture sharing, accessor validation and equivalence between banded and direct rendering. The package smoke test packs and installs the actual npm tarball before rendering a generated scene. Docs can build from the checked-in models without a sibling pcbjs checkout.

## Inspection passes

Per-draw style resolution lives beside visibility in frame preparation. Surface shaders apply saturation, tint and rim in linear space and route reduced opacity through bounded depth peeling. Opaque frames retain their original material-shader sharing. The nearest contributing transparent fragment also records camera depth, while the depth-peeling acceptance test continues to use the opaque depth buffer until compositing finishes.

The TypeScript inspection compositor consumes output-resolution depth and the exact resolved camera. It batches world-point projection through Rust, draws analytic pixel-width annotation primitives, and composites caller-rasterized labels. Configurable silhouettes render one selected mask at a time and resolve coverage before colouring to avoid repeated blending at edge junctions. Each active pass retains at most one depth mask and one coverage buffer in addition to the main image/depth; costs scale with output resolution rather than supersampled resolution. Masks currently run the ordinary raster path and allocate its RGBA output too, even though only mask depth is consumed.

Separate selection geometry lives in its own runtime model with copied node ancestry, one unlit double-sided material and private synthetic nodes. Synthetic indices are never exposed as public node IDs. Only mask and selected-bound queries access this scene. Reusing the same frame, rasterizer and visibility rules avoids a second depth convention and prevents hidden proxy triangles from leaking into ordinary colour or shadow passes. Optional sharp-edge extraction welds positions within each draw, compares adjacent geometric normals and feeds the shared line compositor. It does not modify mesh tessellation.

The `@pcbjs/renderer/worker` entry ships a typed client and Node worker runtime. It serializes operations, replaces scenes transactionally and transfers output buffers; callers can opt into input transfer too. Fatal WASM errors invalidate scene handles and require terminating the worker. Scheduling and recovery remain outside the package: the example wrapper adds queue limits, timeouts and one restart/reload/retry. Tests exercise the packaged transport and inject trap reports to verify the example recovery policy without corrupting the allocator.

Horizontal mirroring swaps resolved RGBA, depth/ID and selection-mask pixels in place before TypeScript overlays. Projection reflects X coordinates without changing the right-handed camera basis, so label images remain readable. Frame metadata retains the mirror flag for replay. Texture import checks decoder dimensions and budgets all retained float RGBA views, mip levels and decode scratch before decoding pixels.
