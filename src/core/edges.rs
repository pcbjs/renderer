// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::{math::Vec3, model::Model, options::Options};
use std::collections::BTreeMap;

pub fn segments(
    model: &Model,
    opts: &Options,
    angle: f32,
    nodes: Option<&[crate::options::NodeSelector]>,
) -> Result<serde_json::Value, String> {
    if !angle.is_finite() || !(0.0..=180.0).contains(&angle) {
        return Err("edge angle must be between zero and 180 degrees".into());
    }
    let selected = nodes
        .map(|n| crate::frame::resolve(model, n, "edges.nodes"))
        .transpose()?;
    let frame = crate::frame::prepare(model, opts)?;
    let mut output = vec![];
    let threshold = angle.to_radians().cos();
    for ((draw, visible), offset) in model.draws.iter().zip(&frame.visible).zip(&frame.offsets) {
        if !visible
            || selected
                .as_ref()
                .is_some_and(|s| !crate::frame::matches(&draw.nodes, s))
        {
            continue;
        }
        let mut edges: BTreeMap<([u32; 3], [u32; 3]), Vec<Vec3>> = BTreeMap::new();
        for tri in draw.indices.as_chunks::<3>().0 {
            let p = [tri[0], tri[1], tri[2]].map(|i| Vec3::from(draw.positions[i as usize]));
            let n = (p[1] - p[0]).cross(p[2] - p[0]);
            if n.length_squared() < 1e-20 {
                continue;
            }
            let n = n.normalize();
            for (a, b) in [(0, 1), (1, 2), (2, 0)] {
                let key = |v: Vec3| [v.x, v.y, v.z].map(|f| if f == 0.0 { 0 } else { f.to_bits() });
                let mut a = key(p[a]);
                let mut b = key(p[b]);
                if a > b {
                    std::mem::swap(&mut a, &mut b);
                }
                edges.entry((a, b)).or_default().push(n);
            }
        }
        for ((a, b), normals) in edges {
            if normals.len() == 2 && normals[0].dot(normals[1]) >= threshold {
                continue;
            }
            if output.len() == 131072 {
                return Err(
                    "sharp edges exceed 131072 segments; filter nodes or increase angle".into(),
                );
            }
            let point = |bits: [u32; 3]| {
                let v = Vec3::from(bits.map(f32::from_bits)) + *offset;
                [v.x, v.y, v.z]
            };
            output.push(
                serde_json::json!({"start": point(a), "end": point(b), "node": draw.nodes.last()}),
            );
        }
    }
    Ok(output.into())
}
