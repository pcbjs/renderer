// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::math::Vec3;
use crate::model::{Draw, Model, Node};

pub fn empty(source: &Model) -> Model {
    let mut nodes = source.nodes.clone();
    nodes.sort_unstable_by_key(|node| node.index);
    Model {
        draws: vec![],
        materials: vec![crate::material::Material {
            unlit: true,
            double_sided: true,
            ..Default::default()
        }],
        textures: vec![],
        bounds_min: Vec3::splat(f32::MAX),
        bounds_max: Vec3::splat(f32::MIN),
        triangles: 0,
        nodes,
        cameras: vec![],
        lights: vec![],
        diagnostics: vec![],
        scenes: vec![],
        scene: None,
    }
}

pub fn append(
    model: &mut Model,
    id: &str,
    node: Option<usize>,
    positions: &[f32],
    indices: Vec<u32>,
    bytes: &mut usize,
) -> Result<(), String> {
    let size = (positions.len() + indices.len()) * 4;
    if *bytes + size > 64 * 1024 * 1024 || model.draws.len() >= 65536 {
        return Err("selection geometry exceeds its load budget".into());
    }
    let index = model.nodes.last().map_or(0, |n| n.index + 1);
    if positions.is_empty()
        || !positions.len().is_multiple_of(3)
        || positions.iter().any(|v| !v.is_finite())
        || indices.is_empty()
        || !indices.len().is_multiple_of(3)
        || indices.iter().any(|v| *v as usize >= positions.len() / 3)
    {
        return Err(format!("invalid selection geometry: {}", id));
    }
    let mut nodes = vec![index];
    let mut parent = node;
    while let Some(index) = parent {
        let node = model
            .nodes
            .iter()
            .find(|n| n.index == index)
            .ok_or("selection anchor outside selected scene")?;
        nodes.push(index);
        parent = node.parent;
    }
    nodes.reverse();
    let positions: Vec<[f32; 3]> = positions.as_chunks::<3>().0.to_vec();
    let mut min = Vec3::splat(f32::MAX);
    let mut max = Vec3::splat(f32::MIN);
    for p in &positions {
        let p = Vec3::new(p[0], p[1], p[2]);
        min = min.min(p);
        max = max.max(p);
    }
    model.bounds_min = model.bounds_min.min(min);
    model.bounds_max = model.bounds_max.max(max);
    model.triangles += (indices.len() / 3) as u32;
    model.nodes.push(Node {
        index,
        name: None,
        parent: node,
        extras: serde_json::json!({"selection": id}),
        camera: None,
        light: None,
    });
    model.draws.push(Draw {
        positions,
        indices,
        material: 0,
        names: vec![],
        nodes,
        bounds_min: min,
        bounds_max: max,
        normals: vec![],
        corner_normals: vec![],
        corner_tangents: vec![],
        colors: vec![],
        uvs: [vec![], vec![]],
    });
    *bytes += size;
    Ok(())
}
