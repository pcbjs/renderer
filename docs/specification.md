---
title: Specification
outline: 2
---

# Specification

The renderer implements a documented static glTF 2.0 GLB subset. This section brings supported features, known limits and verification evidence together. It is not a claim of complete glTF conformance or Khronos certification.

## Supported features and limits

Resource loading is self-contained: one GLB binary buffer, embedded PNG/JPEG images or image data URIs, with no network fetching.

| Feature                                                                           | Status                                                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GLB 2.0 container, indexed and non-indexed triangles, strips and fans             | Supported                                                                                                           |
| Node hierarchy, matrix/TRS transforms, negative scale                             | Supported for static geometry                                                                                       |
| Sparse and strided vector/index accessors, normalized integer attributes          | Supported for consumed mesh attributes                                                                              |
| Missing normals                                                                   | Flat per-face normals; provided tangents ignored                                                                    |
| Metallic-roughness material, normal/AO/emissive maps, vertex colour               | Supported; classic and studio lighting are approximations                                                           |
| Colour conventions                                                                | Linear material/vertex factors, sRGB colour textures, linear lighting and alpha; explicit legacy base-factor option |
| Alpha modes                                                                       | Opaque, mask and depth-ordered blend; finite transparent-layer budget                                               |
| Samplers                                                                          | Wrapping, nearest/bilinear and all glTF mip filter combinations                                                     |
| Texture coordinates                                                               | UV0 and UV1; higher referenced sets fail                                                                            |
| `KHR_texture_transform`, `KHR_materials_unlit`, `KHR_materials_emissive_strength` | Supported                                                                                                           |
| `KHR_lights_punctual`                                                             | Directional, point and spot; inverse-square/range/cone attenuation                                                  |
| Authored cameras and scene selection                                              | Supported; camera instances selected by node index                                                                  |
| Animation, skins, morph targets                                                   | Not rendered; structured diagnostics, or errors in strict mode                                                      |
| Points and lines                                                                  | Skipped with diagnostics, or errors in strict mode                                                                  |
| External resources, additional buffers, compressed geometry/textures              | Unsupported; required extensions fail                                                                               |
| Transmission, volume, clearcoat and other material extensions                     | Unsupported; optional extensions use core fallback with diagnostics                                                 |
| Shadows                                                                           | First directional light only; opaque/masked casters; no point/spot or transparent-caster shadows                    |
| HDR environment maps, anisotropic filtering, bloom                                | Unsupported                                                                                                         |

Diagnostics include a stable `code`, JSON-pointer-style `path`, and human-readable `message`. Diagnostics cover the entire asset, including unused scenes. Strict mode rejects any reported unsupported feature. The loader validates consumed data and important structural constraints, but is not a replacement for a full asset validator.

## Coverage and verification

The [detailed checklist](#detailed-checklist) is generated from the inventory checked by CI.

### What the counts mean

- **Implemented + tested:** implementation and a named regression test for the scoped behavior.
- **Partial support:** implementation exists, with a documented limit such as UV0/UV1 only or a finite transparent-layer budget.
- **Unsupported:** the rendering feature is absent. Testing its warning or strict-mode error does not count as rendering support.
- **Needs targeted tests:** implementation exists, but a dedicated correctness assertion is missing.

The [detailed checklist](#detailed-checklist) links every entry to the relevant specification, implementation, targeted tests and reference assets. Entries differ in scope, so their counts are not a conformance percentage or code-coverage measurement.

### Three kinds of evidence

**Targeted regression tests** check specific results: colour-channel arithmetic, camera clipping, transformed normals, alpha compositing, accessor bounds and other individual behaviors. Native Rust tests and Node tests against the built WebAssembly package cover different parts of the implementation.

**Khronos reference assets** exercise real asset layouts offline. The suite validates each fixture before and after repacking it into GLB, then checks visible output, repeatable rendering and expected diagnostics from two views. These smoke tests do not compare pixels with an independent reference renderer. Embedded fixture resources are repacked for the test; they do not imply runtime support for external resources.

**Inventory checks** verify fixture hashes, named test declarations, implementation paths and generated documentation. CI runs these after the executable tests. An inventory check alone does not establish that the tests passed.

## Run the checks

```sh
npm run build
npm test
cargo test
npm run spec:check
```

After updating `test/spec-coverage.json`, run `npm run spec:report` to regenerate the detailed checklist and machine-readable inventory. Reference asset hashes and source provenance live in `test/reference-assets.json`.

<!--@include: ./_generated/spec-checklist.md-->
