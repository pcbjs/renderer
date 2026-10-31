# Changelog

## 0.1.1 - 2026-10-31

- Accept typed selection positions/indices through direct WASM array arguments without JSON expansion.
- Mirror geometry and auxiliary outputs before overlays, preserving readable labels and replayable frames.
- Embed PNG text metadata and reject oversized decoded textures with structured errors.
- Ship the typed Node worker client and runtime as `@pcbjs/renderer/worker`, leaving scheduling and recovery policy to callers.

- Add depth-tested markers, lines, rings and caller-rasterized labels with world-space node or selection anchors.
- Add per-node opacity, saturation, tint, Fresnel rim and configurable silhouettes, including occluded outlines.
- Load separate opaque-ID selection geometry for merged-item masks, fills, bounds and framing without changing ordinary geometry.
- Return opt-in camera-depth and glTF node-ID images; extract and render sharp mesh edges.
- Export structured renderer failures and transport-safe error records, with a tested worker integration reference and single-retry recovery.
- Add representative pcbjs inspection benchmarks and Linux/macOS/Windows Node 22/24 runtime CI jobs.
- Query visible or selected geometry bounds without rasterizing, using the same ancestry and translation rules as rendering.
- Prepare serializable camera frames, replay their exact projection and project world points to output pixels. Optionally include frame metadata with rendered images.
- Reserve asymmetric output-pixel padding for fit cameras without rotating the view, with matching supersampled rendering and replay.
- Fit selected nodes or world-space bounds without reloading the scene, including translated descendants and surrounding depth.
- Filter geometry and shadow casters per frame with `visibility.only` and `visibility.hidden`.
- Reject unknown node selectors, nested option typos and invalid boolean inputs. Export `OptionError` with a code and option path for TypeScript-side validation and selector lookup.

## 0.1.0

Initial release of the Node ESM package for rendering static glTF 2.0 binary scenes to straight-alpha RGBA and PNG with a CPU WebAssembly rasteriser.

- Reusable scene instances, authored and fitted cameras, scene selection, node metadata, highlighting and world-space node translations.
- Metallic-roughness materials, colour and data textures, normal mapping, two UV sets, mip filtering, and opaque, masked and blended surfaces.
- Classic and studio lighting, directional shadows, exposure and tone mapping.
- `KHR_texture_transform`, `KHR_materials_unlit`, `KHR_materials_emissive_strength` and `KHR_lights_punctual`.
- Structured diagnostics and strict loading for unsupported content, with a traceable specification checklist and pinned Khronos reference assets.

Requires Node 22 or later. The published package has no runtime npm dependencies. Animation, skinning, morph evaluation, points, lines, external resources and additional extensions are outside this release's supported subset. See the [specification](https://github.com/pcbjs/renderer/blob/main/docs/specification.md) for limits and verification evidence.
