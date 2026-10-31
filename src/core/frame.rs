// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use std::collections::HashSet;

use crate::camera::{depth_bounds, depth_range, frame, CamSpec, Camera, Proj};
use crate::math::Vec3;
use crate::model::Model;
use crate::options::{NodeSelector, Options};

pub(crate) struct SceneFrame {
    pub camera: Camera,
    pub offsets: Vec<Vec3>,
    pub visible: Vec<bool>,
    pub highlighted: Vec<bool>,
    pub styles: Vec<crate::options::SurfaceStyle>,
    pub bounds_min: Vec3,
    pub bounds_max: Vec3,
}

pub(crate) fn node_offset(nodes: &[usize], opts: &Options) -> Vec3 {
    opts.node_translations
        .iter()
        .filter(|t| nodes.contains(&t.node))
        .fold(Vec3::ZERO, |sum, t| sum + t.translation)
}

pub(crate) fn prepare(model: &Model, opts: &Options) -> Result<SceneFrame, String> {
    let (offsets, mut visible) = geometry(model, opts)?;
    let mut styles = vec![crate::options::SurfaceStyle::default(); model.draws.len()];
    let mut owners = vec![None; model.draws.len()];
    for (i, style) in opts.styles.iter().enumerate() {
        let nodes = style
            .nodes
            .as_ref()
            .map(|nodes| resolve(model, nodes, &format!("styles[{i}].nodes")))
            .transpose()?;
        let mut surface = style.surface;
        for c in 0..3 {
            surface.tint[c] = crate::color::srgb_to_linear(surface.tint[c]);
            surface.rim[c] = crate::color::srgb_to_linear(surface.rim[c]);
        }
        for ((draw, result), owner) in model.draws.iter().zip(&mut styles).zip(&mut owners) {
            if nodes
                .as_ref()
                .is_none_or(|nodes| matches(&draw.nodes, nodes))
            {
                *result = surface;
                *owner = Some(i);
            }
        }
    }
    if let Some(index) = opts.mask_style {
        for (visible, owner) in visible.iter_mut().zip(owners) {
            *visible &= owner == Some(index);
        }
        styles.fill(crate::options::SurfaceStyle::default());
    }
    let highlight: Vec<_> = opts
        .highlight
        .iter()
        .cloned()
        .map(NodeSelector::Name)
        .chain(
            opts.highlight_indices
                .iter()
                .copied()
                .map(NodeSelector::Index),
        )
        .collect();
    let selected = resolve(model, &highlight, "highlight.nodes")?;
    let highlighted = model
        .draws
        .iter()
        .map(|draw| matches(&draw.nodes, &selected))
        .collect();
    let bounds = translated_bounds(model, &offsets, &visible);
    let (bmin, bmax) = bounds.unwrap_or((Vec3::ZERO, Vec3::ZERO));
    let focused = if let Some(nodes) = &opts.fit_nodes {
        let nodes = resolve(model, nodes, "camera.nodes")?;
        let included: Vec<_> = model
            .draws
            .iter()
            .zip(&visible)
            .map(|(draw, visible)| *visible && matches(&draw.nodes, &nodes))
            .collect();
        Some(
            translated_bounds(model, &offsets, &included)
                .ok_or("camera.nodes must select visible geometry")?,
        )
    } else {
        opts.fit_bounds.map(|bounds| (bounds.min, bounds.max))
    };
    let (mut fit_min, mut fit_max) = focused.unwrap_or((bmin, bmax));
    if focused.is_some() && (fit_max - fit_min).length_squared() < 1e-12 {
        let centre = (fit_min + fit_max) * 0.5;
        fit_min = centre - Vec3::splat(0.0005);
        fit_max = centre + Vec3::splat(0.0005);
    }
    let [top, right, bottom, left] = opts.padding;
    let width = opts.width as f32;
    let height = opts.height as f32;
    let rx = 1.0 - (left + right) / width;
    let ry = 1.0 - (top + bottom) / height;
    let padded = opts.padding != [0.0; 4];
    let aspect = if padded {
        (width - left - right) / (height - top - bottom)
    } else {
        width / height
    };
    let mut spec = opts.camera;
    if padded {
        if let CamSpec::Fit {
            ref mut fov_deg, ..
        } = spec
        {
            *fov_deg = (2.0 * ((fov_deg.to_radians() * 0.5).tan() * ry).atan()).to_degrees();
        }
    }
    let mut camera = if let CamSpec::Asset { node } = opts.camera {
        let asset = model
            .cameras
            .iter()
            .find(|c| c.node == node)
            .ok_or_else(|| format!("camera node {node} is not in the selected scene"))?;
        let mut camera = asset.camera;
        camera.eye = camera.eye + node_offset(&asset.nodes, opts);
        if asset.dynamic_aspect {
            if let Proj::Perspective { tan_half_v, .. } = camera.proj {
                camera.proj = Proj::Perspective {
                    tan_half_v,
                    tan_half_h: tan_half_v * aspect,
                };
            }
        }
        camera
    } else {
        frame(spec, fit_min, fit_max, aspect)?
    };
    if padded {
        camera.proj = match camera.proj {
            Proj::Perspective {
                tan_half_v,
                tan_half_h,
            } => Proj::Perspective {
                tan_half_v: tan_half_v / ry,
                tan_half_h: tan_half_h / rx,
            },
            Proj::Ortho { half_w, half_h } => Proj::Ortho {
                half_w: half_w / rx,
                half_h: half_h / ry,
            },
        };
        camera.offset = [(left - right) / width, (bottom - top) / height];
    }
    if focused.is_some() && bounds.is_some() {
        if matches!(camera.proj, Proj::Ortho { .. }) {
            let (front, _) = depth_bounds(bmin, bmax, camera.eye, camera.forward);
            camera.eye = camera.eye - camera.forward * (1e-3 - front).max(0.0);
            camera.near = 0.0;
        }
        let (near, far) = depth_range(
            bmin.min(fit_min),
            bmax.max(fit_max),
            camera.eye,
            camera.forward,
        );
        camera.near = camera.near.min(near);
        camera.far = camera.far.max(far);
    }
    if let Some(near) = opts.near {
        camera.near = near;
    }
    if let Some(far) = opts.far {
        camera.far = far;
    }
    if camera.far <= camera.near
        || (matches!(camera.proj, Proj::Perspective { .. }) && camera.near <= 0.0)
    {
        return Err(
            "camera needs 0 < near < far for perspective, or 0 <= near < far for orthographic"
                .into(),
        );
    }
    Ok(SceneFrame {
        camera,
        offsets,
        visible,
        highlighted,
        styles,
        bounds_min: bmin,
        bounds_max: bmax,
    })
}

pub(crate) fn resolve(
    model: &Model,
    selectors: &[NodeSelector],
    path: &str,
) -> Result<HashSet<usize>, String> {
    let mut selected = HashSet::new();
    for (i, selector) in selectors.iter().enumerate() {
        let mut found = false;
        for node in &model.nodes {
            if match selector {
                NodeSelector::Name(name) => node.name.as_ref() == Some(name),
                NodeSelector::Index(index) => node.index == *index,
            } {
                selected.insert(node.index);
                found = true;
            }
        }
        if !found {
            return Err(format!(
                "{path}[{i}] references an unknown node in the selected scene: {selector:?}"
            ));
        }
    }
    Ok(selected)
}

pub(crate) fn matches(ancestry: &[usize], selected: &HashSet<usize>) -> bool {
    ancestry.iter().any(|node| selected.contains(node))
}

fn translated_bounds(model: &Model, offsets: &[Vec3], included: &[bool]) -> Option<(Vec3, Vec3)> {
    if !included.iter().any(|v| *v) {
        return None;
    }
    if included.iter().all(|v| *v) && offsets.iter().all(|v| *v == Vec3::ZERO) {
        return Some((model.bounds_min, model.bounds_max));
    }
    let mut min = Vec3::splat(f32::MAX);
    let mut max = Vec3::splat(f32::MIN);
    for ((d, off), included) in model.draws.iter().zip(offsets).zip(included) {
        if *included {
            min = min.min(d.bounds_min + *off);
            max = max.max(d.bounds_max + *off);
        }
    }
    Some((min, max))
}

fn geometry(model: &Model, opts: &Options) -> Result<(Vec<Vec3>, Vec<bool>), String> {
    for offset in &opts.node_translations {
        if !model.nodes.iter().any(|node| node.index == offset.node) {
            return Err(format!(
                "node translation references node {} outside the selected scene",
                offset.node
            ));
        }
    }
    let offset = |nodes: &[usize]| node_offset(nodes, opts);
    let offsets: Vec<_> = model.draws.iter().map(|draw| offset(&draw.nodes)).collect();
    let only = opts
        .visibility
        .only
        .as_ref()
        .map(|nodes| resolve(model, nodes, "visibility.only"))
        .transpose()?;
    let hidden = resolve(model, &opts.visibility.hidden, "visibility.hidden")?;
    let visible: Vec<_> = model
        .draws
        .iter()
        .map(|draw| {
            only.as_ref()
                .is_none_or(|nodes| matches(&draw.nodes, nodes))
                && !matches(&draw.nodes, &hidden)
        })
        .collect();
    Ok((offsets, visible))
}

pub fn bounds(
    model: &Model,
    opts: &Options,
    nodes: Option<&[NodeSelector]>,
) -> Result<serde_json::Value, String> {
    crate::options::validate(opts)?;
    let (offsets, mut visible) = geometry(model, opts)?;
    if let Some(nodes) = nodes {
        let selected = resolve(model, nodes, "nodes")?;
        for (draw, included) in model.draws.iter().zip(&mut visible) {
            *included &= matches(&draw.nodes, &selected);
        }
    }
    Ok(match translated_bounds(model, &offsets, &visible) {
        Some((min, max)) => {
            serde_json::json!({ "min": [min.x, min.y, min.z], "max": [max.x, max.y, max.z] })
        }
        None => serde_json::Value::Null,
    })
}

pub fn describe(model: &Model, opts: &Options) -> Result<serde_json::Value, String> {
    crate::options::validate(opts)?;
    let frame = prepare(model, opts)?;
    Ok(
        serde_json::json!({ "width": opts.width, "height": opts.height,
        "camera": { "type": "resolved", "state": frame.camera.state() } }),
    )
}

pub fn project(opts: &Options, points: &[Vec3]) -> Result<serde_json::Value, String> {
    crate::options::validate(opts)?;
    let CamSpec::Resolved { state } = opts.camera else {
        return Err("projection requires a resolved frame".into());
    };
    let camera = state.camera()?;
    points.iter().map(|p| {
        if !p.is_finite() { return Err("projection points must be finite".into()); }
        let view = camera.view(*p);
        let (x, y, _) = camera.project(view, opts.width, opts.height);
        let behind = matches!(camera.proj, Proj::Perspective { .. }) && view.z <= 0.0;
        let finite = x.is_finite() && y.is_finite() && !behind;
        let clipped = !finite || view.z < camera.near || view.z > camera.far
            || x < 0.0 || x > opts.width as f32 || y < 0.0 || y > opts.height as f32;
        Ok(serde_json::json!({ "x": finite.then_some(x), "y": finite.then_some(y), "depth": view.z,
            "behind": behind, "clipped": clipped }))
    }).collect::<Result<Vec<_>, String>>().map(serde_json::Value::from)
}
