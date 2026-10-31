// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::camera::{axes, Camera, Proj};
use crate::math::{mul_point, Vec3};
use crate::model::{AssetCamera, AssetLight, Diagnostic};
use crate::punctual::{LightKind, PunctualLight};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct LoadOptions {
    pub scene: Option<usize>,
    pub base_color_space: BaseColorSpace,
    pub unsupported: Unsupported,
}

#[derive(Clone, Copy, Debug, Default, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BaseColorSpace {
    #[default]
    Linear,
    Srgb,
}

#[derive(Clone, Copy, Debug, Default, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Unsupported {
    #[default]
    Warn,
    Error,
}

pub(super) const EXTENSIONS: [&str; 4] = [
    "KHR_texture_transform",
    "KHR_materials_unlit",
    "KHR_materials_emissive_strength",
    "KHR_lights_punctual",
];

pub(super) fn diagnostics(root: &Value) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    let mut add = |code: &str, path: String, message: String| {
        out.push(Diagnostic {
            code: code.into(),
            path,
            message,
        })
    };
    if let Some(extensions) = root["extensionsUsed"].as_array() {
        for extension in extensions
            .iter()
            .filter_map(Value::as_str)
            .filter(|name| !EXTENSIONS.contains(name))
        {
            add(
                "unsupported-extension",
                "/extensionsUsed".into(),
                format!("Optional {extension} is ignored; its fallback is rendered"),
            );
        }
    }
    if root["animations"].as_array().is_some_and(|v| !v.is_empty()) {
        add(
            "unsupported-animation",
            "/animations".into(),
            "Animation playback is unavailable; authored static transforms are used".into(),
        );
    }
    if let Some(nodes) = root["nodes"].as_array() {
        for (i, node) in nodes.iter().enumerate() {
            if node.get("skin").is_some() {
                add(
                    "unsupported-skin",
                    format!("/nodes/{i}/skin"),
                    "Skin deformation is ignored".into(),
                );
            }
        }
    }
    if let Some(meshes) = root["meshes"].as_array() {
        for (i, mesh) in meshes.iter().enumerate() {
            if let Some(primitives) = mesh["primitives"].as_array() {
                for (j, primitive) in primitives.iter().enumerate() {
                    let path = format!("/meshes/{i}/primitives/{j}");
                    if primitive.get("targets").is_some() {
                        add(
                            "unsupported-morph",
                            format!("{path}/targets"),
                            "Morph target weights and deformation are ignored".into(),
                        );
                    }
                    if primitive["mode"].as_u64().is_some_and(|mode| mode < 4) {
                        add(
                            "unsupported-topology",
                            format!("{path}/mode"),
                            "Point and line primitives are skipped".into(),
                        );
                    }
                }
            }
        }
    }
    out
}

fn number(value: &Value, key: &str, default: Option<f32>) -> Result<f32, String> {
    let n = match value.get(key) {
        Some(v) => v.as_f64().map(|n| n as f32),
        None => default,
    }
    .filter(|n| n.is_finite())
    .ok_or_else(|| format!("glTF {key} must be a finite number"))?;
    Ok(n)
}

pub(super) fn camera(
    root: &Value,
    index: usize,
    node: usize,
    nodes: Vec<usize>,
    world: &[f32; 16],
) -> Result<AssetCamera, String> {
    let value = root["cameras"]
        .get(index)
        .ok_or_else(|| format!("glTF camera {index} is missing"))?;
    let (proj, near, far, dynamic_aspect) = match value["type"].as_str() {
        Some("perspective") => {
            let v = &value["perspective"];
            let fov = number(v, "yfov", None)?;
            let near = number(v, "znear", None)?;
            let far = if v.get("zfar").is_some() {
                number(v, "zfar", None)?
            } else {
                f32::INFINITY
            };
            let aspect = number(v, "aspectRatio", Some(1.0))?;
            if fov <= 0.0
                || fov >= std::f32::consts::PI
                || near <= 0.0
                || far <= near
                || aspect <= 0.0
            {
                return Err(format!(
                    "glTF camera {index} has invalid perspective parameters"
                ));
            }
            let tan_half_v = (fov * 0.5).tan();
            (
                Proj::Perspective {
                    tan_half_v,
                    tan_half_h: tan_half_v * aspect,
                },
                near,
                far,
                v.get("aspectRatio").is_none(),
            )
        }
        Some("orthographic") => {
            let v = &value["orthographic"];
            let half_w = number(v, "xmag", None)?;
            let half_h = number(v, "ymag", None)?;
            let near = number(v, "znear", None)?;
            let far = number(v, "zfar", None)?;
            if half_w <= 0.0 || half_h <= 0.0 || near < 0.0 || far <= near {
                return Err(format!(
                    "glTF camera {index} has invalid orthographic parameters"
                ));
            }
            (Proj::Ortho { half_w, half_h }, near, far, false)
        }
        _ => return Err(format!("glTF camera {index} has an invalid type")),
    };
    let eye = mul_point(world, Vec3::ZERO);
    let back = Vec3::new(world[8], world[9], world[10]);
    let up_hint = Vec3::new(world[4], world[5], world[6]);
    if back.length_squared() < 1e-16 || up_hint.length_squared() < 1e-16 {
        return Err(format!("glTF camera {index} has a degenerate transform"));
    }
    let (back, right, up) = axes(back, up_hint);
    Ok(AssetCamera {
        node,
        nodes,
        camera: Camera {
            offset: [0.0; 2],
            eye,
            right,
            up,
            forward: -back,
            proj,
            near,
            far,
        },
        dynamic_aspect,
    })
}

pub(super) fn light(
    root: &Value,
    index: usize,
    node: usize,
    nodes: Vec<usize>,
    world: &[f32; 16],
) -> Result<AssetLight, String> {
    let value = root["extensions"]["KHR_lights_punctual"]["lights"]
        .get(index)
        .ok_or_else(|| format!("glTF light {index} is missing"))?;
    let kind = match value["type"].as_str() {
        Some("directional") => LightKind::Directional,
        Some("point") => LightKind::Point,
        Some("spot") => LightKind::Spot,
        _ => return Err(format!("glTF light {index} has an invalid type")),
    };
    if kind == LightKind::Spot && !value["spot"].is_object() {
        return Err(format!("glTF spot light {index} needs a spot object"));
    }
    let color = value
        .get("color")
        .map(super::vec_n::<3>)
        .transpose()?
        .unwrap_or([1.0; 3]);
    let light = PunctualLight {
        kind,
        color,
        intensity: number(value, "intensity", Some(1.0))?,
        range: value
            .get("range")
            .map(|_| number(value, "range", None))
            .transpose()?,
        position: mul_point(world, Vec3::ZERO),
        direction: -Vec3::new(world[8], world[9], world[10]).normalize(),
        inner_cone_angle: number(&value["spot"], "innerConeAngle", Some(0.0))?,
        outer_cone_angle: number(
            &value["spot"],
            "outerConeAngle",
            Some(std::f32::consts::FRAC_PI_4),
        )?,
    };
    light.validate()?;
    Ok(AssetLight { node, nodes, light })
}
