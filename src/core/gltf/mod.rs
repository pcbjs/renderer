// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

mod accessor;
mod scene;
pub use scene::{BaseColorSpace, LoadOptions, Unsupported};
mod images;
mod tangents;

use serde_json::Value;

use crate::color::srgb_to_linear;
use crate::material::{AlphaMode, Material};
use crate::math::{mul_mat, mul_n, mul_point, normal_matrix, trs, Vec3, IDENT};
use crate::model::{Draw, Model, Node, SceneInfo};
use crate::texture::TextureInfo;
use accessor::{read_accessor, read_colors, read_indices};
use images::load_textures;

pub fn load_glb(bytes: &[u8]) -> Result<Model, String> {
    load_glb_with_options(bytes, &LoadOptions::default())
}

pub fn load_glb_with_options(bytes: &[u8], options: &LoadOptions) -> Result<Model, String> {
    let (json, bin) = unpack(bytes)?;
    let root: Value =
        serde_json::from_slice(json).map_err(|e| format!("glTF JSON is not valid: {e}"))?;
    let version = asset_version(&root["asset"]["version"], "version")?;
    if version.0 != 2 {
        return Err("glTF asset.version requires an unsupported major version".into());
    }
    if let Some(value) = root["asset"].get("minVersion") {
        let minimum = asset_version(value, "minVersion")?;
        if minimum > (2, 0) || minimum > version || minimum.0 != 2 {
            return Err("glTF asset.minVersion requires an unsupported version".into());
        }
    }
    if let Some(req) = root.get("extensionsRequired").and_then(|v| v.as_array()) {
        if let Some(ext) = req
            .iter()
            .filter_map(|v| v.as_str())
            .find(|ext| !scene::EXTENSIONS.contains(ext))
        {
            return Err(format!("glTF requires extension {ext}"));
        }
    }
    let bin = resolve_bin(&root, bin)?;
    let texture_count = root
        .get("textures")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let mut materials = load_materials(&root, texture_count, options.base_color_space)?;
    let textures = load_textures(&root, bin, &materials)?;
    materials.push(Material::default());
    let default_mat = materials.len() - 1;
    let diagnostics = scene::diagnostics(&root);
    if options.unsupported == Unsupported::Error && !diagnostics.is_empty() {
        return Err(diagnostics
            .iter()
            .map(|d| format!("{}: {}", d.path, d.message))
            .collect::<Vec<_>>()
            .join("; "));
    }
    let scene_i = options
        .scene
        .or_else(|| {
            root.get("scene")
                .and_then(Value::as_u64)
                .map(|n| n as usize)
        })
        .unwrap_or(0);
    let model = Model {
        draws: Vec::new(),
        materials,
        textures,
        bounds_min: Vec3::ZERO,
        bounds_max: Vec3::ZERO,
        triangles: 0,
        nodes: Vec::new(),
        cameras: Vec::new(),
        lights: Vec::new(),
        diagnostics,
        scenes: root["scenes"]
            .as_array()
            .map(|list| {
                list.iter()
                    .enumerate()
                    .map(|(index, v)| SceneInfo {
                        index,
                        name: v["name"].as_str().map(str::to_owned),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        scene: root["scenes"]
            .as_array()
            .filter(|list| !list.is_empty())
            .map(|_| scene_i),
    };
    let scenes = root.get("scenes").and_then(|v| v.as_array());
    let nodes = match scenes {
        Some(scenes) if !scenes.is_empty() => {
            let scene = scenes
                .get(scene_i)
                .ok_or_else(|| format!("glTF scene {scene_i} is missing"))?;
            scene_nodes(scene, scene_i)?
        }
        _ if options.scene.is_some() => return Err(format!("glTF scene {scene_i} is missing")),
        _ => Vec::new(),
    };
    let mut loader = Loader {
        root: &root,
        bin,
        model,
        default_material: default_mat,
        stack: Vec::new(),
    };
    let identity = NodeState {
        transform: IDENT,
        nodes: Vec::new(),
        names: Vec::new(),
    };
    for index in nodes {
        loader.walk(index, &identity)?;
    }
    finish_bounds(&mut loader.model);
    Ok(loader.model)
}

fn asset_version(value: &Value, field: &str) -> Result<(u64, u64), String> {
    let parse = || {
        let (major, minor) = value.as_str()?.split_once('.')?;
        if major.is_empty()
            || minor.is_empty()
            || !major.bytes().all(|b| b.is_ascii_digit())
            || !minor.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        Some((major.parse().ok()?, minor.parse().ok()?))
    };
    parse().ok_or_else(|| format!("glTF asset.{field} must be a major.minor version"))
}

fn scene_nodes(scene: &Value, scene_i: usize) -> Result<Vec<usize>, String> {
    let Some(v) = scene.get("nodes") else {
        return Ok(Vec::new());
    };
    let arr = v
        .as_array()
        .ok_or_else(|| format!("glTF scene {scene_i} nodes are not an array"))?;
    let mut ids = Vec::with_capacity(arr.len());
    for n in arr {
        ids.push(
            n.as_u64()
                .ok_or_else(|| format!("glTF scene {scene_i} has a node that is not an index"))?
                as usize,
        );
    }
    Ok(ids)
}

fn finish_bounds(model: &mut Model) {
    if model.draws.is_empty() {
        model.bounds_min = Vec3::ZERO;
        model.bounds_max = Vec3::ZERO;
        return;
    }
    let mut min = Vec3::splat(f32::MAX);
    let mut max = Vec3::splat(f32::MIN);
    for d in &model.draws {
        min = min.min(d.bounds_min);
        max = max.max(d.bounds_max);
    }
    model.bounds_min = min;
    model.bounds_max = max;
}

fn unpack(bytes: &[u8]) -> Result<(&[u8], &[u8]), String> {
    if bytes.len() < 12 {
        return Err(format!(
            "GLB is truncated: {} bytes is shorter than a header",
            bytes.len()
        ));
    }
    let magic = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    if magic != 0x4654_6C67 {
        return Err("GLB magic is not glTF".into());
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != 2 {
        return Err(format!("GLB version is {version}; only version 2 is read"));
    }
    let length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if length != bytes.len() {
        return Err(format!(
            "GLB is truncated: header says {length} bytes, the buffer is {}",
            bytes.len()
        ));
    }
    let mut off = 12usize;
    let mut json: Option<&[u8]> = None;
    let mut bin: Option<&[u8]> = None;
    while off + 8 <= length {
        let len = u32::from_le_bytes(bytes[off..off + 4].try_into().unwrap()) as usize;
        let ty = u32::from_le_bytes(bytes[off + 4..off + 8].try_into().unwrap());
        if !len.is_multiple_of(4) {
            return Err(format!(
                "GLB chunk at {off} has length {len}, which is not a multiple of 4"
            ));
        }
        let end = off.saturating_add(8).saturating_add(len);
        if end > length {
            return Err(format!(
                "GLB is truncated: a chunk at {off} extends past the declared length"
            ));
        }
        if off == 12 && ty != 0x4E4F_534A {
            return Err("GLB first chunk must be JSON".into());
        }
        if (ty == 0x4E4F_534A && json.is_some()) || (ty == 0x004E_4942 && bin.is_some()) {
            return Err("GLB has a duplicate JSON or BIN chunk".into());
        }
        if ty == 0x004E_4942 && off != 20 + json.map_or(0, |v| v.len()) {
            return Err("GLB BIN must be the second chunk".into());
        }
        let data = &bytes[off + 8..end];
        if ty == 0x4E4F_534A && json.is_none() {
            json = Some(data);
        } else if ty == 0x004E_4942 && bin.is_none() {
            bin = Some(data);
        }
        off = end;
    }
    if off != length {
        return Err("GLB has an incomplete chunk header".into());
    }
    let json = json.ok_or("GLB has no JSON chunk")?;
    Ok((json, bin.unwrap_or(&[])))
}

fn resolve_bin<'a>(root: &Value, chunk: &'a [u8]) -> Result<&'a [u8], String> {
    let buffers = root.get("buffers").and_then(|v| v.as_array());
    let Some(buffers) = buffers else {
        return Ok(chunk);
    };
    if buffers.len() > 1 {
        return Err("glTF has more than one buffer; only the GLB binary chunk is supported".into());
    }
    if buffers.is_empty() {
        return Ok(chunk);
    }
    let b0 = &buffers[0];
    if b0.get("uri").and_then(|v| v.as_str()).is_some() {
        return Err("glTF buffer 0 is external; only the GLB binary chunk is supported".into());
    }
    let need = b0
        .get("byteLength")
        .and_then(|v| v.as_u64())
        .unwrap_or(chunk.len() as u64) as usize;
    if need > chunk.len() {
        return Err(format!(
            "glTF buffer 0 is {need} bytes but the GLB binary chunk is {}",
            chunk.len()
        ));
    }
    Ok(&chunk[..need])
}

fn load_materials(
    root: &Value,
    texture_count: usize,
    color_space: BaseColorSpace,
) -> Result<Vec<Material>, String> {
    let Some(list) = root.get("materials").and_then(|v| v.as_array()) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::with_capacity(list.len());
    for (i, m) in list.iter().enumerate() {
        let unlit = material_extension(m, "KHR_materials_unlit", i)?.is_some();
        let emissive_extension = material_extension(m, "KHR_materials_emissive_strength", i)?;
        if unlit && emissive_extension.is_some() {
            return Err(format!("glTF material {i} cannot combine KHR_materials_unlit and KHR_materials_emissive_strength"));
        }
        let emissive_strength = material_number(emissive_extension, "emissiveStrength", 1.0, i)?;
        if emissive_strength < 0.0 {
            return Err(format!(
                "glTF material {i} emissiveStrength must be non-negative"
            ));
        }
        let pbr = m.get("pbrMetallicRoughness");
        let factor = pbr
            .and_then(|p| p.get("baseColorFactor"))
            .map(vec_n::<4>)
            .transpose()?
            .unwrap_or([1.0, 1.0, 1.0, 1.0]);
        if factor
            .iter()
            .any(|n| !n.is_finite() || !(0.0..=1.0).contains(n))
        {
            return Err(format!(
                "glTF material {i} baseColorFactor must be four numbers between 0 and 1"
            ));
        }
        let mut base = factor;
        if color_space == BaseColorSpace::Srgb {
            for channel in &mut base[..3] {
                *channel = srgb_to_linear(*channel);
            }
        }
        let metallic = material_number(pbr, "metallicFactor", 1.0, i)?;
        let roughness = material_number(pbr, "roughnessFactor", 1.0, i)?;
        if !(0.0..=1.0).contains(&metallic) || !(0.0..=1.0).contains(&roughness) {
            return Err(format!(
                "glTF material {i} metallicFactor and roughnessFactor must be between 0 and 1"
            ));
        }
        let texture = material_texture(
            pbr.and_then(|p| p.get("baseColorTexture")),
            i,
            texture_count,
        )?;
        let metallic_roughness_texture = material_texture(
            pbr.and_then(|p| p.get("metallicRoughnessTexture")),
            i,
            texture_count,
        )?;
        let normal_texture = material_texture(m.get("normalTexture"), i, texture_count)?;
        let occlusion_texture = material_texture(m.get("occlusionTexture"), i, texture_count)?;
        let normal_scale = material_number(m.get("normalTexture"), "scale", 1.0, i)?;
        let occlusion_strength = material_number(m.get("occlusionTexture"), "strength", 1.0, i)?;
        if !(0.0..=1.0).contains(&occlusion_strength) {
            return Err(format!(
                "glTF material {i} occlusion strength must be between 0 and 1"
            ));
        }
        let emissive_texture = material_texture(m.get("emissiveTexture"), i, texture_count)?;
        let emissive = m
            .get("emissiveFactor")
            .map(vec_n::<3>)
            .transpose()
            .map_err(|_| format!("glTF material {i} emissiveFactor must contain 3 numbers"))?
            .unwrap_or([0.0; 3]);
        if emissive
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
        {
            return Err(format!(
                "glTF material {i} emissiveFactor must contain three numbers between 0 and 1"
            ));
        }
        let mode = m
            .get("alphaMode")
            .and_then(|v| v.as_str())
            .unwrap_or("OPAQUE");
        let alpha_mode = match mode {
            "OPAQUE" => AlphaMode::Opaque,
            "MASK" => AlphaMode::Mask,
            "BLEND" => AlphaMode::Blend,
            _ => {
                return Err(format!(
                    "glTF material {i} has alpha mode {mode}, which is not supported"
                ))
            }
        };
        let cutoff = material_number(Some(m), "alphaCutoff", 0.5, i)?;
        if cutoff < 0.0 {
            return Err(format!(
                "glTF material {i} alphaCutoff must be non-negative"
            ));
        }
        let double_sided = m
            .get("doubleSided")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        out.push(Material {
            base,
            metallic,
            roughness,
            texture,
            emissive: emissive.map(|value| value * emissive_strength),
            unlit,
            emissive_texture,
            metallic_roughness_texture,
            normal_texture,
            normal_scale,
            occlusion_texture,
            occlusion_strength,
            alpha_mode,
            cutoff,
            double_sided,
        });
    }
    Ok(out)
}

fn material_extension<'a>(
    material: &'a Value,
    name: &str,
    index: usize,
) -> Result<Option<&'a Value>, String> {
    let extension = material.get("extensions").and_then(|value| value.get(name));
    if extension.is_some_and(|value| !value.is_object()) {
        return Err(format!("glTF material {index} {name} must be an object"));
    }
    Ok(extension)
}

fn material_number(
    value: Option<&Value>,
    key: &str,
    default: f32,
    material: usize,
) -> Result<f32, String> {
    let Some(value) = value.and_then(|v| v.get(key)) else {
        return Ok(default);
    };
    let number = value
        .as_f64()
        .ok_or_else(|| format!("glTF material {material} {key} must be a number"))?
        as f32;
    if !number.is_finite() {
        return Err(format!("glTF material {material} {key} must be finite"));
    }
    Ok(number)
}

fn material_texture(
    info: Option<&Value>,
    material: usize,
    count: usize,
) -> Result<Option<TextureInfo>, String> {
    let Some(info) = info else { return Ok(None) };
    let index = info
        .get("index")
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("glTF material {material} texture has no index"))?
        as usize;
    if index >= count {
        return Err(format!(
            "glTF material {material} points at missing texture {index}"
        ));
    }
    let transform = info
        .get("extensions")
        .and_then(|v| v.get("KHR_texture_transform"));
    if transform.is_some_and(|value| !value.is_object()) {
        return Err(format!(
            "glTF material {material} KHR_texture_transform must be an object"
        ));
    }
    let coord = transform
        .and_then(|v| v.get("texCoord"))
        .or_else(|| info.get("texCoord"));
    let coord = coord.map_or(Ok(0), |v| {
        v.as_u64()
            .ok_or("texture texCoord must be an unsigned integer")
    })?;
    if coord > 1 {
        return Err(format!("glTF material {material} samples TEXCOORD_{coord}; only TEXCOORD_0 and TEXCOORD_1 are supported"));
    }
    let vector = |key: &str, default| -> Result<[f32; 2], String> {
        let value = transform
            .and_then(|v| v.get(key))
            .map(vec_n::<2>)
            .transpose()
            .map_err(|_| {
                format!("glTF material {material} texture {key} must contain two numbers")
            })?
            .unwrap_or(default);
        if value.iter().any(|v| !v.is_finite()) {
            return Err(format!(
                "glTF material {material} texture {key} must be finite"
            ));
        }
        Ok(value)
    };
    let offset = vector("offset", [0.0; 2])?;
    let scale = vector("scale", [1.0; 2])?;
    let rotation = material_number(transform, "rotation", 0.0, material)?;
    let (sin, cos) = rotation.sin_cos();
    Ok(Some(TextureInfo {
        index,
        tex_coord: coord as usize,
        transform: [
            [cos * scale[0], -sin * scale[1], offset[0]],
            [sin * scale[0], cos * scale[1], offset[1]],
        ],
    }))
}

struct NodeState {
    transform: [f32; 16],
    nodes: Vec<usize>,
    names: Vec<String>,
}

struct Loader<'a> {
    root: &'a Value,
    bin: &'a [u8],
    model: Model,
    default_material: usize,
    stack: Vec<usize>,
}

impl Loader<'_> {
    fn walk(&mut self, index: usize, parent: &NodeState) -> Result<(), String> {
        let root = self.root;
        if self.stack.len() > 64 {
            return Err(format!("glTF node graph is deeper than 64 at node {index}"));
        }
        if self.stack.contains(&index) {
            return Err(format!("glTF node graph has a cycle at node {index}"));
        }
        let (local, name, mesh_i, children, camera_i, light_i, extras) = {
            let nodes = root
                .get("nodes")
                .and_then(|v| v.as_array())
                .ok_or("glTF has no nodes")?;
            let node = nodes
                .get(index)
                .ok_or_else(|| format!("glTF node {index} is missing"))?;
            let local = node_matrix(node, index)?;
            let name = node
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let mesh_i = node
                .get("mesh")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize);
            let children = match node.get("children") {
                None => Vec::new(),
                Some(v) => {
                    let arr = v
                        .as_array()
                        .ok_or_else(|| format!("glTF node {index} children are not an array"))?;
                    let mut ids = Vec::with_capacity(arr.len());
                    for c in arr {
                        ids.push(c.as_u64().ok_or_else(|| {
                            format!("glTF node {index} has a child that is not an index")
                        })? as usize);
                    }
                    ids
                }
            };
            let reference = |v: Option<&Value>| {
                v.map(|v| {
                    v.as_u64()
                        .map(|n| n as usize)
                        .ok_or("glTF node camera/light must be an index")
                })
                .transpose()
            };
            let camera_i = reference(node.get("camera"))?;
            let light_i = reference(
                node.get("extensions")
                    .and_then(|v| v.get("KHR_lights_punctual"))
                    .and_then(|v| v.get("light")),
            )?;
            (
                local,
                name,
                mesh_i,
                children,
                camera_i,
                light_i,
                node.get("extras").cloned().unwrap_or(Value::Null),
            )
        };
        let world = mul_mat(&parent.transform, &local);
        if self.model.nodes.iter().any(|node| node.index == index) {
            return Err(format!("glTF node {index} has multiple parents or roots"));
        }
        let mut nodes = parent.nodes.clone();
        nodes.push(index);
        self.model.nodes.push(Node {
            index,
            name: name.clone(),
            parent: parent.nodes.last().copied(),
            extras,
            camera: camera_i,
            light: light_i,
        });
        if let Some(camera) = camera_i {
            self.model
                .cameras
                .push(scene::camera(root, camera, index, nodes.clone(), &world)?);
        }
        if let Some(light) = light_i {
            self.model
                .lights
                .push(scene::light(root, light, index, nodes.clone(), &world)?);
        }
        let mut names = parent.names.to_vec();
        if let Some(name) = name {
            names.push(name);
        }
        let state = NodeState {
            transform: world,
            nodes,
            names,
        };
        if let Some(mesh) = mesh_i {
            self.add_mesh(mesh, &state)?;
        }
        self.stack.push(index);
        for child in children {
            self.walk(child, &state)?;
        }
        self.stack.pop();
        Ok(())
    }

    fn add_mesh(&mut self, index: usize, state: &NodeState) -> Result<(), String> {
        let root = self.root;
        let bin = self.bin;
        let world = &state.transform;
        let names = &state.names;
        let default_mat = self.default_material;
        let model = &mut self.model;
        let meshes = root
            .get("meshes")
            .and_then(|v| v.as_array())
            .ok_or("glTF has no meshes")?;
        let mesh = meshes
            .get(index)
            .ok_or_else(|| format!("glTF mesh {index} is missing"))?;
        let prims = mesh
            .get("primitives")
            .and_then(|v| v.as_array())
            .ok_or_else(|| format!("glTF mesh {index} has no primitives"))?;
        let nm = normal_matrix(world);
        for (pi, prim) in prims.iter().enumerate() {
            let attrs = prim
                .get("attributes")
                .and_then(|v| v.as_object())
                .ok_or_else(|| format!("glTF mesh {index} primitive {pi} has no attributes"))?;
            let pos_i = attrs
                .get("POSITION")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| format!("glTF mesh {index} primitive {pi} has no POSITION"))?
                as usize;
            let mut positions = read_accessor::<3>(root, bin, pos_i)?;
            let count = positions.len();
            let normals_raw = if let Some(ni) = attrs.get("NORMAL").and_then(|v| v.as_u64()) {
                let n = read_accessor::<3>(root, bin, ni as usize)?;
                if n.len() != count || n.iter().flatten().any(|v| !v.is_finite()) {
                    return Err(format!(
                        "glTF mesh {index} primitive {pi} NORMAL does not match POSITION"
                    ));
                }
                Some(n)
            } else {
                None
            };
            let mut uvs = [Vec::new(), Vec::new()];
            for (set, uv) in uvs.iter_mut().enumerate() {
                let semantic = format!("TEXCOORD_{set}");
                if let Some(accessor) = attrs.get(&semantic).and_then(Value::as_u64) {
                    *uv = read_accessor::<2>(root, bin, accessor as usize)?;
                    if uv.len() != count || uv.iter().flatten().any(|v| !v.is_finite()) {
                        return Err(format!("glTF mesh {index} primitive {pi} {semantic} must contain one finite UV per POSITION"));
                    }
                }
            }
            let authored_tangents = if let Some(accessor) =
                attrs.get("TANGENT").and_then(Value::as_u64)
            {
                let tangents = read_accessor::<4>(root, bin, accessor as usize)?;
                if tangents.len() != count
                    || tangents
                        .iter()
                        .any(|t| t.iter().any(|v| !v.is_finite()) || (t[3] != 1.0 && t[3] != -1.0))
                {
                    return Err(format!("glTF mesh {index} primitive {pi} TANGENT must contain finite XYZW vectors with W equal to -1 or 1"));
                }
                Some(tangents)
            } else {
                None
            };
            let colors = if let Some(ci) = attrs.get("COLOR_0").and_then(|v| v.as_u64()) {
                read_colors(root, bin, ci as usize, count, index, pi)?
            } else {
                Vec::new()
            };
            let mode = prim.get("mode").and_then(|v| v.as_u64()).unwrap_or(4) as u32;
            let raw_ix = if let Some(ii) = prim.get("indices").and_then(|v| v.as_u64()) {
                read_indices(root, bin, ii as usize)?
            } else {
                (0..count as u32).collect()
            };
            let mut indices = expand_mode(mode, raw_ix, index, pi)?;
            if indices.is_empty() {
                continue;
            }
            for i in &indices {
                if *i as usize >= count {
                    return Err(format!(
                        "glTF mesh {index} primitive {pi} index {i} is past its {count} vertices"
                    ));
                }
            }
            let mat_i = match prim.get("material").and_then(|v| v.as_u64()) {
                None => default_mat,
                Some(n) => {
                    let mat_i = n as usize;
                    if mat_i >= default_mat {
                        return Err(format!(
                            "glTF mesh {index} primitive {pi} points at missing material {mat_i}"
                        ));
                    }
                    mat_i
                }
            };
            let material = &model.materials[mat_i];
            for (info, _) in material.textures() {
                if uvs[info.tex_coord].is_empty() {
                    return Err(format!("glTF mesh {index} primitive {pi} material {mat_i} needs missing TEXCOORD_{}", info.tex_coord));
                }
            }
            let mut tangents =
                if let Some(normal_texture) = material.normal_texture.filter(|_| !material.unlit) {
                    if let Some(authored) = authored_tangents.filter(|_| normals_raw.is_some()) {
                        indices.iter().map(|i| authored[*i as usize]).collect()
                    } else {
                        let generated;
                        let normals = if let Some(normals) = &normals_raw {
                            normals
                        } else {
                            generated = generate_normals(&positions, &indices);
                            &generated
                        };
                        tangents::generate(
                            &positions,
                            normals,
                            &uvs[normal_texture.tex_coord],
                            &indices,
                            normals_raw.is_none(),
                        )
                    }
                } else {
                    Vec::new()
                };
            tangents::transform(&mut tangents, world);
            if tangents::mirrored(world) {
                for triangle in indices.as_chunks_mut::<3>().0 {
                    triangle.swap(1, 2);
                }
                for triangle in tangents.as_chunks_mut::<3>().0 {
                    triangle.swap(1, 2);
                }
            }
            let mut bounds_min = Vec3::splat(f32::MAX);
            let mut bounds_max = Vec3::splat(f32::MIN);
            for position in &mut positions {
                let p = mul_point(world, Vec3::from(*position));
                if !p.is_finite() {
                    return Err(format!(
                        "glTF node of mesh {index} has a non-finite transform"
                    ));
                }
                bounds_min = bounds_min.min(p);
                bounds_max = bounds_max.max(p);
                *position = p.to_array();
            }
            let flat = normals_raw.is_none();
            let normals = if let Some(mut normals) = normals_raw {
                for normal in &mut normals {
                    let n = mul_n(&nm, Vec3::from(*normal)).normalize();
                    *normal = if n.length_squared() < 1e-12 {
                        [0.0, 1.0, 0.0]
                    } else {
                        n.to_array()
                    };
                }
                normals
            } else {
                generate_normals(&positions, &indices)
            };
            let (normals, corner_normals) = if flat {
                (Vec::new(), normals)
            } else {
                (normals, Vec::new())
            };
            model.triangles += (indices.len() / 3) as u32;
            model.draws.push(Draw {
                positions,
                normals,
                corner_normals,
                uvs,
                corner_tangents: tangents,
                colors,
                indices,
                material: mat_i,
                names: names.to_vec(),
                nodes: state.nodes.clone(),
                bounds_min,
                bounds_max,
            });
        }
        Ok(())
    }
}

fn node_matrix(node: &Value, index: usize) -> Result<[f32; 16], String> {
    if let Some(m) = node.get("matrix") {
        let nums =
            vec_n::<16>(m).map_err(|_| format!("glTF node {index} matrix is not 16 numbers"))?;
        return Ok(nums);
    }
    let t = optional_vector::<3>(node, "translation")?.unwrap_or([0.0, 0.0, 0.0]);
    let r = optional_vector::<4>(node, "rotation")?.unwrap_or([0.0, 0.0, 0.0, 1.0]);
    let s = optional_vector::<3>(node, "scale")?.unwrap_or([1.0, 1.0, 1.0]);
    Ok(trs(t, r, s))
}

fn generate_normals(positions: &[[f32; 3]], indices: &[u32]) -> Vec<[f32; 3]> {
    indices
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|tri| {
            let a = Vec3::from(positions[tri[0] as usize]);
            let b = Vec3::from(positions[tri[1] as usize]);
            let c = Vec3::from(positions[tri[2] as usize]);
            let n = (b - a).cross(c - a).normalize().to_array();
            [n; 3]
        })
        .collect()
}

fn expand_mode(mode: u32, ix: Vec<u32>, mesh: usize, prim: usize) -> Result<Vec<u32>, String> {
    match mode {
        0..=3 => Ok(Vec::new()),
        4 => {
            if !ix.len().is_multiple_of(3) {
                return Err(format!("glTF mesh {mesh} primitive {prim} has an index count that is not a multiple of 3"));
            }
            Ok(ix)
        }
        5 => {
            let mut o = Vec::new();
            for i in 2..ix.len() {
                if i % 2 == 0 {
                    o.extend([ix[i - 2], ix[i - 1], ix[i]]);
                } else {
                    o.extend([ix[i - 1], ix[i - 2], ix[i]]);
                }
            }
            Ok(o)
        }
        6 => {
            let mut o = Vec::new();
            for i in 2..ix.len() {
                o.extend([ix[0], ix[i - 1], ix[i]]);
            }
            Ok(o)
        }
        _ => Err(format!(
            "glTF primitive mode {mode} is not a triangle list, strip or fan"
        )),
    }
}

fn vec_n<const N: usize>(v: &Value) -> Result<[f32; N], String> {
    let arr = v.as_array().ok_or("not an array")?;
    if arr.len() != N {
        return Err("length".into());
    }
    let mut o = [0.0; N];
    for (i, item) in arr.iter().enumerate() {
        o[i] = item.as_f64().ok_or("not a number")? as f32;
    }
    Ok(o)
}

fn optional_vector<const N: usize>(node: &Value, key: &str) -> Result<Option<[f32; N]>, String> {
    node.get(key)
        .map(|v| vec_n(v).map_err(|_| format!("glTF node {key} is not a {N}-vector")))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn pack_glb(json: &str, bin: &[u8]) -> Vec<u8> {
        let jb = json.as_bytes();
        let jpad = (4 - jb.len() % 4) % 4;
        let bpad = (4 - bin.len() % 4) % 4;
        let total = 12 + 8 + jb.len() + jpad + 8 + bin.len() + bpad;
        let mut o = Vec::with_capacity(total);
        o.extend_from_slice(&0x46546C67u32.to_le_bytes());
        o.extend_from_slice(&2u32.to_le_bytes());
        o.extend_from_slice(&(total as u32).to_le_bytes());
        o.extend_from_slice(&((jb.len() + jpad) as u32).to_le_bytes());
        o.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
        o.extend_from_slice(jb);
        o.extend(std::iter::repeat_n(b' ', jpad));
        o.extend_from_slice(&((bin.len() + bpad) as u32).to_le_bytes());
        o.extend_from_slice(&0x004E4942u32.to_le_bytes());
        o.extend_from_slice(bin);
        o.extend(std::iter::repeat_n(0u8, bpad));
        o
    }

    fn quad_bin() -> (String, Vec<u8>) {
        let mut bin = Vec::new();
        for p in [
            [-1f32, -1.0, 0.0],
            [1.0, -1.0, 0.0],
            [1.0, 1.0, 0.0],
            [-1.0, 1.0, 0.0],
        ] {
            for c in p {
                bin.extend_from_slice(&c.to_le_bytes());
            }
        }
        for _ in 0..4 {
            for c in [0f32, 0.0, 1.0] {
                bin.extend_from_slice(&c.to_le_bytes());
            }
        }
        for i in [0u16, 1, 2, 0, 2, 3] {
            bin.extend_from_slice(&i.to_le_bytes());
        }
        let json = r#"{
          "asset":{"version":"2.0"},
          "scene":0,
          "scenes":[{"nodes":[0]}],
          "nodes":[{"name":"board","mesh":0}],
          "meshes":[{"primitives":[{"attributes":{"POSITION":0,"NORMAL":1},"indices":2,"material":0}]}],
          "materials":[{"pbrMetallicRoughness":{"baseColorFactor":[1,0,0,1],"metallicFactor":0,"roughnessFactor":1}}],
          "accessors":[
            {"bufferView":0,"componentType":5126,"count":4,"type":"VEC3"},
            {"bufferView":1,"componentType":5126,"count":4,"type":"VEC3"},
            {"bufferView":2,"componentType":5123,"count":6,"type":"SCALAR"}
          ],
          "bufferViews":[
            {"buffer":0,"byteOffset":0,"byteLength":48},
            {"buffer":0,"byteOffset":48,"byteLength":48},
            {"buffer":0,"byteOffset":96,"byteLength":12}
          ],
          "buffers":[{"byteLength":108}]
        }"#;
        (json.to_string(), bin)
    }

    #[test]
    fn loads_a_quad() {
        let (json, bin) = quad_bin();
        let model = load_glb(&pack_glb(&json, &bin)).unwrap();
        assert_eq!(model.triangles, 2);
        assert_eq!(model.draws[0].names, vec!["board".to_string()]);
        assert!((model.draws[0].positions[1][0] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn truncated_glb_names_the_problem() {
        let err = load_glb(b"glTF").unwrap_err();
        assert!(err.contains("truncated"), "{err}");
    }

    #[test]
    fn missing_accessor_names_the_index() {
        let json = r#"{"asset":{"version":"2.0"},"scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0}],"meshes":[{"primitives":[{"attributes":{"POSITION":5}}]}]}"#;
        let err = load_glb(&pack_glb(json, &[])).unwrap_err();
        assert!(err.contains("accessor 5"), "{err}");
    }

    #[test]
    fn required_extension_is_rejected() {
        let json = r#"{"asset":{"version":"2.0"},"extensionsRequired":["KHR_draco_mesh_compression"],"scenes":[{"nodes":[]}]}"#;
        let err = load_glb(&pack_glb(json, &[])).unwrap_err();
        assert!(err.contains("KHR_draco_mesh_compression"), "{err}");
    }
}

#[cfg(test)]
mod flat_normal_tests {
    use super::*;
    #[test]
    fn missing_normals_keep_a_shared_edge_hard() {
        let positions = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ];
        let normals = generate_normals(&positions, &[0, 1, 2, 0, 3, 1]);
        assert_eq!(
            normals,
            [
                [0.0, 0.0, 1.0],
                [0.0, 0.0, 1.0],
                [0.0, 0.0, 1.0],
                [0.0, 1.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 1.0, 0.0]
            ]
        );
    }
}
