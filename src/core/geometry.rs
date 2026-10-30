// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::camera::{Camera, Proj};
use crate::material::{mix_bg, Fragment, Light, Material, Shader};
use crate::math::Vec3;
use crate::model::Draw;
use crate::options::Lighting;
use crate::raster::{ScreenTriangle, ScreenVertex};
use crate::texture::Footprint;

#[derive(Clone, Copy)]
struct ClipVertex {
    position: Vec3,
    fragment: Fragment,
}

pub(crate) struct GeometryPass<'a> {
    pub camera: &'a Camera,
    pub width: u32,
    pub height: u32,
    pub light: &'a Light,
    pub background: [f32; 4],
    pub depth_only: bool,
}

pub(crate) struct PreparedDraw<'a> {
    draw: &'a Draw,
    offset: Vec3,
    projected: Vec<ProjectedPosition>,
    id: u32,
    dim: f32,
}

#[derive(Clone, Copy)]
struct ProjectedPosition {
    x: f32,
    y: f32,
    z: f32,
    inv_w: f32,
}

impl<'a> PreparedDraw<'a> {
    pub fn new(
        draw: &'a Draw,
        offset: Vec3,
        pass: &GeometryPass<'_>,
        id: u32,
        dim: f32,
    ) -> Result<Self, String> {
        if let Some(index) = draw
            .indices
            .iter()
            .find(|index| **index as usize >= draw.positions.len())
        {
            return Err(format!(
                "triangle index {index} is past the {} positions",
                draw.positions.len()
            ));
        }
        let projected = draw
            .positions
            .iter()
            .map(|position| {
                project(
                    view_position(Vec3::from(*position) + offset, pass.camera),
                    pass,
                )
            })
            .collect();
        Ok(Self {
            draw,
            offset,
            projected,
            id,
            dim,
        })
    }

    pub fn triangles(
        &self,
        pass: &GeometryPass<'_>,
        rows: std::ops::Range<usize>,
        shader: &Shader<'_>,
        mut emit: impl FnMut(&ScreenTriangle),
    ) {
        let material = shader.material;
        let camera = pass.camera;
        for (triangle, indices) in self.draw.indices.as_chunks::<3>().0.iter().enumerate() {
            let indices = [
                indices[0] as usize,
                indices[1] as usize,
                indices[2] as usize,
            ];
            let positions = indices.map(|i| self.projected[i]);
            if positions.iter().all(|v| v.z > camera.far)
                || positions.iter().all(|v| v.z < camera.near)
            {
                continue;
            }
            let inside = positions.iter().all(|v| v.z >= camera.near);
            if inside
                && (positions.iter().all(|v| v.y < rows.start as f32)
                    || positions.iter().all(|v| v.y >= rows.end as f32))
            {
                continue;
            }
            let fragments = std::array::from_fn(|i| {
                fragment(self.draw, indices[i], triangle * 3 + i, self.offset)
            });
            let normals = fragments.map(|f| f.normal);
            let colors = fragments.map(|f| f.color);
            let flat = !pass.depth_only
                && (material.unlit
                    || (!pass.light.detail
                        && pass.light.lighting == Lighting::Classic
                        && pass.light.shadow.is_none()
                        && pass.light.punctual.is_none()))
                && can_solid(material, &normals, &colors);
            let flat_fragment = fragments[0];
            let mut project = |vertices| {
                let Some((vertices, area, flip)) = orient(vertices, material.double_sided) else {
                    return;
                };
                let Some((min_x, max_x, min_y, max_y)) =
                    bbox(&vertices, pass.width as i32, pass.height as i32)
                else {
                    return;
                };
                if max_y < rows.start as i32 || min_y >= rows.end as i32 {
                    return;
                }
                let solid = if flat {
                    let Some(color) = shader.shade(
                        flat_fragment,
                        &Footprint::default(),
                        pass.light,
                        flip,
                        Vec3::ZERO,
                    ) else {
                        return;
                    };
                    Some(mix_bg(color, self.dim, pass.background))
                } else {
                    None
                };
                emit(&ScreenTriangle {
                    vertices,
                    area,
                    min_x,
                    max_x,
                    min_y,
                    max_y,
                    id: self.id,
                    order: ((self.id as u64) << 32) | triangle as u64,
                    flip,
                    dim: self.dim,
                    solid,
                });
            };
            if inside {
                project(std::array::from_fn(|i| ScreenVertex {
                    x: positions[i].x,
                    y: positions[i].y,
                    z: positions[i].z.max(1e-6),
                    inv_w: positions[i].inv_w,
                    fragment: fragments[i],
                }));
            } else {
                let vertices = fragments.map(|fragment| ClipVertex {
                    position: view_position(fragment.world, camera),
                    fragment,
                });
                let mut clipped = [vertices[0]; 8];
                let count = clip_near(&vertices, camera.near, &mut clipped);
                for i in 1..count.saturating_sub(1) {
                    let triangle = [clipped[0], clipped[i], clipped[i + 1]];
                    project(triangle.map(|vertex| to_screen(vertex, pass)));
                }
            }
        }
    }
}

fn fragment(draw: &Draw, index: usize, corner: usize, offset: Vec3) -> Fragment {
    Fragment {
        world: Vec3::from(draw.positions[index]) + offset,
        normal: draw
            .corner_normals
            .get(corner)
            .or_else(|| draw.normals.get(index))
            .copied()
            .map(Vec3::from)
            .unwrap_or(Vec3::new(0.0, 1.0, 0.0)),
        uv: std::array::from_fn(|set| draw.uvs[set].get(index).copied().unwrap_or([0.0; 2])),
        tangent: draw
            .corner_tangents
            .get(corner)
            .copied()
            .unwrap_or([0.0; 4]),
        color: draw.colors.get(index).copied().unwrap_or([1.0; 4]),
    }
}

fn view_position(world: Vec3, camera: &Camera) -> Vec3 {
    let offset = world - camera.eye;
    Vec3::new(
        offset.dot(camera.right),
        offset.dot(camera.up),
        offset.dot(camera.forward),
    )
}

fn project(position: Vec3, pass: &GeometryPass<'_>) -> ProjectedPosition {
    let z = position.z.max(1e-6);
    let (ndc_x, ndc_y, inv_w) = match pass.camera.proj {
        Proj::Perspective {
            tan_half_v,
            tan_half_h,
        } => {
            let inv_w = 1.0 / z;
            (
                position.x * inv_w / tan_half_h.max(1e-8),
                position.y * inv_w / tan_half_v.max(1e-8),
                inv_w,
            )
        }
        Proj::Ortho { half_w, half_h } => (
            position.x / half_w.max(1e-8),
            position.y / half_h.max(1e-8),
            1.0,
        ),
    };
    ProjectedPosition {
        x: (ndc_x + 1.0) * 0.5 * pass.width as f32,
        y: (1.0 - ndc_y) * 0.5 * pass.height as f32,
        inv_w,
        z: position.z,
    }
}

fn to_screen(vertex: ClipVertex, pass: &GeometryPass<'_>) -> ScreenVertex {
    let position = project(vertex.position, pass);
    ScreenVertex {
        x: position.x,
        y: position.y,
        z: position.z.max(1e-6),
        inv_w: position.inv_w,
        fragment: vertex.fragment,
    }
}

fn clip_near(input: &[ClipVertex], near: f32, out: &mut [ClipVertex; 8]) -> usize {
    if input.is_empty() {
        return 0;
    }
    let mut count = 0;
    let mut prev = input[input.len() - 1];
    let mut prev_in = prev.position.z >= near;
    for &curr in input {
        let curr_in = curr.position.z >= near;
        if curr_in != prev_in && count < out.len() {
            let denom = curr.position.z - prev.position.z;
            let t = if denom.abs() < 1e-20 {
                0.0
            } else {
                ((near - prev.position.z) / denom).clamp(0.0, 1.0)
            };
            out[count] = lerp_vertex(prev, curr, t);
            count += 1;
        }
        if curr_in && count < out.len() {
            out[count] = curr;
            count += 1;
        }
        prev = curr;
        prev_in = curr_in;
    }
    count
}

fn lerp_vertex(a: ClipVertex, b: ClipVertex, t: f32) -> ClipVertex {
    ClipVertex {
        position: a.position + (b.position - a.position) * t,
        fragment: a.fragment.lerp(b.fragment, t),
    }
}

fn orient(mut v: [ScreenVertex; 3], double_sided: bool) -> Option<([ScreenVertex; 3], f32, bool)> {
    let area = edge(&v[0], &v[1], v[2].x, v[2].y);
    if !area.is_finite() || area.abs() < 1e-8 {
        return None;
    }
    let front = area < 0.0;
    if !front && !double_sided {
        return None;
    }
    let area = if front {
        v.swap(1, 2);
        -area
    } else {
        area
    };
    Some((v, area, !front))
}

fn edge(a: &ScreenVertex, b: &ScreenVertex, px: f32, py: f32) -> f32 {
    (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)
}

fn bbox(v: &[ScreenVertex; 3], sw: i32, sh: i32) -> Option<(i32, i32, i32, i32)> {
    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for p in v {
        if !p.x.is_finite() || !p.y.is_finite() {
            return None;
        }
        min_x = min_x.min(p.x);
        max_x = max_x.max(p.x);
        min_y = min_y.min(p.y);
        max_y = max_y.max(p.y);
    }
    let x0 = min_x.floor().max(0.0) as i32;
    let y0 = min_y.floor().max(0.0) as i32;
    let x1 = (max_x.ceil() - 1.0).clamp(-1.0, (sw - 1) as f32) as i32;
    let y1 = (max_y.ceil() - 1.0).clamp(-1.0, (sh - 1) as f32) as i32;
    if x1 < x0 || y1 < y0 {
        None
    } else {
        Some((x0, x1, y0, y1))
    }
}

fn can_solid(mat: &Material, n: &[Vec3; 3], c: &[[f32; 4]; 3]) -> bool {
    mat.textures().next().is_none()
        && (mat.unlit
            || (mat.roughness >= 0.999
                && (n[0] - n[1]).length_squared() < 1e-8
                && (n[1] - n[2]).length_squared() < 1e-8))
        && close4(c[0], c[1])
        && close4(c[1], c[2])
}

fn close4(a: [f32; 4], b: [f32; 4]) -> bool {
    (a[0] - b[0]).abs() < 1e-5
        && (a[1] - b[1]).abs() < 1e-5
        && (a[2] - b[2]).abs() < 1e-5
        && (a[3] - b[3]).abs() < 1e-5
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn near_clipping_interpolates_all_fragment_attributes() {
        let vertex = |z, uv, color| ClipVertex {
            position: Vec3::new(0.0, 0.0, z),
            fragment: Fragment {
                world: Vec3::new(0.0, 0.0, z),
                normal: Vec3::new(0.0, 0.0, 1.0),
                uv: [uv, uv],
                tangent: [1.0, 0.0, 0.0, 1.0],
                color,
            },
        };
        let vertices = [
            vertex(0.0, [0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
            vertex(2.0, [1.0, 0.0], [0.0, 1.0, 0.0, 1.0]),
            vertex(2.0, [0.0, 1.0], [0.0, 0.0, 1.0, 1.0]),
        ];
        let mut clipped = [vertices[0]; 8];
        let count = clip_near(&vertices, 1.0, &mut clipped);
        assert_eq!(count, 4);
        assert!(clipped[..count].iter().all(|v| v.position.z >= 1.0));
        assert_eq!(clipped[1].fragment.uv, [[0.5, 0.0]; 2]);
        assert_eq!(clipped[1].fragment.color, [0.5, 0.5, 0.0, 0.5]);
        assert_eq!(clipped[1].fragment.world.z, 1.0);
    }
}
