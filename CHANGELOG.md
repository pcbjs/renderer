# Changelog

## 0.1.0

Initial release of the Node ESM package for rendering static glTF 2.0 binary scenes to straight-alpha RGBA and PNG with a CPU WebAssembly rasteriser.

- Reusable scene instances, authored and fitted cameras, scene selection, node metadata, highlighting and world-space node translations.
- Metallic-roughness materials, colour and data textures, normal mapping, two UV sets, mip filtering, and opaque, masked and blended surfaces.
- Classic and studio lighting, directional shadows, exposure and tone mapping.
- `KHR_texture_transform`, `KHR_materials_unlit`, `KHR_materials_emissive_strength` and `KHR_lights_punctual`.
- Structured diagnostics and strict loading for unsupported content, with a traceable specification checklist and pinned Khronos reference assets.

Requires Node 22 or later. The published package has no runtime npm dependencies. Animation, skinning, morph evaluation, points, lines, external resources and additional extensions are outside this release's supported subset. See the [specification](https://github.com/pcbjs/renderer/blob/main/docs/specification.md) for limits and verification evidence.
