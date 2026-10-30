---
title: Architecture
---

# Architecture

The TypeScript API validates and serializes options, loads WebAssembly once, and owns each scene's lifetime. The Rust renderer takes a parsed scene and frame options, and returns straight-alpha RGBA. File loading stays in `src/load.ts`; rendering has no filesystem or board-specific dependencies.

| Stage                | Module                 | Responsibility                                                                                                                 |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Import               | `core/gltf/`           | Validate GLB chunks and accessor spans, decode shared colour/data image views, traverse node transforms and build static draws |
| Scene                | `core/model.rs`        | Geometry, material references, names, bounds and node ancestry                                                                 |
| Options              | `core/options.rs`      | Deserialize the wire format and validate native inputs                                                                         |
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
| Orchestration        | `core/render.rs`       | Prepare the camera, materials and draws, then render and resolve each band                                                     |

Colour and shadow passes share projection, clipping, coverage and depth interpolation. The shadow pass allocates depth only and samples material alpha only for `MASK`. Receiver-plane depth correction from triangle geometry and a texel-scaled bias limit self-shadow artifacts. Ambient, environment and emissive contributions bypass shadow visibility. Canonical double-precision edge equations avoid accumulated coverage error on long, thin triangles; float interpolation and colour buffers retain the existing memory footprint. Flat triangle colour caching covers constant unlit surfaces and classic lighting without shadows or texture-dependent material channels. Transparent materials receive opaque and masked shadows but are excluded from shadow casting.

Projection storage is proportional to vertex count. Images above the direct-render pixel budget use reusable horizontal bands aligned to supersample rows. Resolution writes directly into the output byte buffer, with no full-frame float accumulator. Selection ID buffers are allocated only when highlighting is requested. Identical resolved pixels reuse their sRGB encoding without quantization or approximate colour conversion.

RGBA stays linear during lighting and resolution. Supersample resolution averages premultiplied colour and alpha, then unpremultiplies, applies exposure and optional tone mapping, and encodes sRGB once. This keeps transparent edges valid for PNG and Canvas straight-alpha consumers. `BLEND` composites before resolution, and `MASK` discards below the cutoff. Selection outlines are drawn after output colour conversion.

Tangents are transformed as directions, normals with the inverse transpose, and mirrored nodes reverse triangle winding and tangent handedness. MikkTSpace generates missing tangents in object space from the selected source UVs. Corner storage preserves discontinuities without duplicating all vertex attributes. Missing normals use flat corner normals, including the tangent-generation basis. Sparse accessors expand validated patches over tight or strided base values once at import; index patches retain integer precision. Both UV sets and tangent vectors participate in near clipping and perspective interpolation. Texture derivatives are computed only for samplers that need them, and adjusted by each slot’s UV transform.

## Extending the renderer

Material sampling is separate from lighting. Base colour, emissive, metallic-roughness, normal and occlusion slots each bind a texture, UV set and transform. Colour slots decode sRGB before filtering; data slots retain their numeric channels. Image views and mip chains are prepared according to material usage and shared independently of sampler state. New interpolated attributes must be added to `Fragment` and its clipping and perspective interpolation methods together. Texture images and sampler state are separate so additional filtering and mip levels do not require changes to scene traversal.

The transparent pass peels nearest fragments using a depth and authored triangle-order key, tests against opaque depth, and accumulates premultiplied colour front to back. Exclusive shared-edge coverage prevents double alpha on triangulated surfaces. Bands cap extra peeling storage at 14 MiB; a configurable layer limit throws on overflow. The nearest contributing fragment supplies the selection ID. Opaque draws keep their original coverage and depth path. Future transmission needs access to scene colour and a separate refraction policy; changing alpha alone cannot provide it.

Node translations are supplied explicitly at render time and accumulated through stored ancestry; application extras remain metadata. Camera and light instances use the same offsets as geometry. Authored camera projection and clipping parameters are preserved; directional shadow maps follow the first active directional light.

The importer currently bakes node transforms into static world-space geometry. Skinning, morph targets and dynamic instancing require preserving their source geometry and deformation data, then supplying transformed vertices before projection. The loader and geometry stage are separate so those additions do not need to change material sampling, PNG encoding or the public scene lifetime API.

Transmission, skins, morph targets and compressed geometry remain unimplemented. Studio reflections approximate a fixed environment; HDR environments and image-based lighting prefilters remain future work.

## Verification

Build before running the Node tests, which import `dist/`. Run `cargo test` for native coverage of clipping, texture sharing, accessor validation and equivalence between banded and direct rendering. The package smoke test packs and installs the actual npm tarball before rendering a generated scene. Docs can build from the checked-in models without a sibling pcbjs checkout.
