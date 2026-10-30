// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::framebuffer::Framebuffer;
use crate::material::{mix_bg, AlphaMode, Fragment, FragmentInputs, Light, Shader};
use crate::math::Vec3;
use crate::texture::Footprint;
use crate::transparency::PeelBuffer;

pub(crate) struct ScreenVertex {
    pub x: f32,
    pub y: f32,
    pub inv_w: f32,
    pub z: f32,
    pub fragment: Fragment,
}

pub(crate) struct ScreenTriangle {
    pub vertices: [ScreenVertex; 3],
    pub area: f32,
    pub min_x: i32,
    pub max_x: i32,
    pub min_y: i32,
    pub max_y: i32,
    pub id: u32,
    pub order: u64,
    pub flip: bool,
    pub dim: f32,
    pub solid: Option<[f32; 4]>,
}

pub(crate) fn raster_tri(
    tri: &ScreenTriangle,
    target: &mut Framebuffer,
    far: f32,
    shader: &Shader<'_>,
    light: &Light,
    bg: [f32; 4],
) {
    let receiver_normal = receiver_normal(tri, light);
    let derivatives = shader.needs_gradients.then(|| TextureDerivatives::new(tri));
    coverage::<false>(tri, target.y, target.height, |x, y, weights, sum| {
        let z = depth(tri, weights, sum);
        let di = (y - target.y) * target.width + x;
        if z.is_finite() && z <= far && z < target.depth[di] {
            let shaded = if let Some(solid) = tri.solid {
                Some(solid)
            } else {
                let fragment = interpolate(tri, weights, sum, shader.inputs);
                shader
                    .shade(
                        fragment,
                        &derivatives
                            .as_ref()
                            .map_or_else(Footprint::default, |d| d.at(fragment.uv, sum)),
                        light,
                        tri.flip,
                        receiver_normal,
                    )
                    .map(|c| mix_bg(c, tri.dim, bg))
            };
            if let Some(c) = shaded {
                target.depth[di] = z;
                target.color[di] = c;
                if !target.ids.is_empty() {
                    target.ids[di] = tri.id;
                }
            }
        }
    });
}

pub(crate) fn raster_transparent(
    tri: &ScreenTriangle,
    target: &Framebuffer,
    peel: &mut PeelBuffer,
    far: f32,
    shader: &Shader<'_>,
    light: &Light,
    bg: [f32; 4],
) {
    let receiver_normal = receiver_normal(tri, light);
    let derivatives = shader.needs_gradients.then(|| TextureDerivatives::new(tri));
    coverage::<true>(tri, target.y, target.height, |x, y, weights, sum| {
        let z = depth(tri, weights, sum);
        let index = (y - target.y) * target.width + x;
        if !z.is_finite() || z > far || !peel.accepts(index, z, tri.order, target.depth[index]) {
            return;
        }
        let shaded = if let Some(solid) = tri.solid {
            Some(solid)
        } else {
            let fragment = interpolate(tri, weights, sum, shader.inputs);
            let footprint = derivatives
                .as_ref()
                .map_or_else(Footprint::default, |d| d.at(fragment.uv, sum));
            shader
                .shade(fragment, &footprint, light, tri.flip, receiver_normal)
                .map(|c| mix_bg(c, tri.dim, bg))
        };
        if let Some(color) = shaded.filter(|color| color[3] > 0.0) {
            peel.write(index, z, tri.order, color);
        }
    });
}

fn receiver_normal(tri: &ScreenTriangle, light: &Light) -> Vec3 {
    if light.shadow.is_some() {
        let [a, b, c] = &tri.vertices;
        (b.fragment.world - a.fragment.world)
            .cross(c.fragment.world - a.fragment.world)
            .normalize()
    } else {
        Vec3::ZERO
    }
}

pub(crate) fn raster_depth(
    tri: &ScreenTriangle,
    target: &mut [f32],
    size: usize,
    far: f32,
    shader: &Shader<'_>,
) {
    let derivatives = shader
        .shadow_gradients
        .then(|| TextureDerivatives::new(tri));
    coverage::<false>(tri, 0, size, |x, y, weights, sum| {
        let z = depth(tri, weights, sum);
        let di = y * size + x;
        if z.is_finite()
            && z <= far
            && z < target[di]
            && (shader.material.alpha_mode != AlphaMode::Mask || {
                let fragment = interpolate(tri, weights, sum, shader.shadow_inputs);
                shader.casts_shadow(
                    fragment,
                    &derivatives
                        .as_ref()
                        .map_or_else(Footprint::default, |d| d.at(fragment.uv, sum)),
                )
            })
        {
            target[di] = z;
        }
    });
}

struct TextureDerivatives {
    numerator: Footprint,
    denominator: [f32; 2],
}

impl TextureDerivatives {
    fn new(tri: &ScreenTriangle) -> Self {
        let [a, b, c] = &tri.vertices;
        let dx = [b.y - c.y, c.y - a.y, a.y - b.y];
        let dy = [c.x - b.x, a.x - c.x, b.x - a.x];
        let derivative = |axis: [f32; 3], values: [f32; 3]| {
            (axis[0] * a.inv_w * values[0]
                + axis[1] * b.inv_w * values[1]
                + axis[2] * c.inv_w * values[2])
                / tri.area
        };
        let uv = |axis| {
            std::array::from_fn(|set| {
                std::array::from_fn(|i| {
                    derivative(
                        axis,
                        [
                            a.fragment.uv[set][i],
                            b.fragment.uv[set][i],
                            c.fragment.uv[set][i],
                        ],
                    )
                })
            })
        };
        Self {
            numerator: Footprint {
                dx: uv(dx),
                dy: uv(dy),
            },
            denominator: [derivative(dx, [1.0; 3]), derivative(dy, [1.0; 3])],
        }
    }

    fn at(&self, uv: [[f32; 2]; 2], inv_w: f32) -> Footprint {
        let axis = |values: [[f32; 2]; 2], denominator| {
            std::array::from_fn(|set| {
                std::array::from_fn(|i| (values[set][i] - uv[set][i] * denominator) / inv_w)
            })
        };
        Footprint {
            dx: axis(self.numerator.dx, self.denominator[0]),
            dy: axis(self.numerator.dy, self.denominator[1]),
        }
    }
}

fn depth(tri: &ScreenTriangle, weights: [f32; 3], sum: f32) -> f32 {
    (weights[0] * tri.vertices[0].z
        + weights[1] * tri.vertices[1].z
        + weights[2] * tri.vertices[2].z)
        / sum
}

fn interpolate(
    tri: &ScreenTriangle,
    weights: [f32; 3],
    sum: f32,
    inputs: FragmentInputs,
) -> Fragment {
    Fragment::interpolate(
        [
            tri.vertices[0].fragment,
            tri.vertices[1].fragment,
            tri.vertices[2].fragment,
        ],
        weights,
        sum,
        inputs,
    )
}

fn coverage<const TOP_LEFT: bool>(
    tri: &ScreenTriangle,
    row: usize,
    height: usize,
    mut visit: impl FnMut(usize, usize, [f32; 3], f32),
) {
    let y_start = tri.min_y.max(row as i32);
    let y_end = tri.max_y.min((row + height) as i32 - 1);
    if y_end < y_start {
        return;
    }
    let v0 = &tri.vertices[0];
    let v1 = &tri.vertices[1];
    let v2 = &tri.vertices[2];
    // Canonical double-precision edge equations give shared edges opposite signs without scanline drift.
    let edge = |a: &ScreenVertex, b: &ScreenVertex| {
        let (ax, ay, bx, by) = (a.x as f64, a.y as f64, b.x as f64, b.y as f64);
        [ay - by, bx - ax, ax * by - ay * bx]
    };
    let [edge0, edge1, edge2] = [edge(v1, v2), edge(v2, v0), edge(v0, v1)];
    let [de0, de1, de2] = [edge0[0], edge1[0], edge2[0]];
    let inv_area = 1.0 / tri.area as f64;
    let inclusive = |a: &ScreenVertex, b: &ScreenVertex| b.y < a.y || (b.y == a.y && b.x > a.x);
    let edges = [inclusive(v1, v2), inclusive(v2, v0), inclusive(v0, v1)];
    for y in y_start..=y_end {
        let py = y as f64 + 0.5;
        let px0 = tri.min_x as f64 + 0.5;
        let evaluate = |edge: [f64; 3]| edge[0] * px0 + edge[1] * py + edge[2];
        let [mut e0, mut e1, mut e2] = [evaluate(edge0), evaluate(edge1), evaluate(edge2)];
        let mut x = tri.min_x;
        while x <= tri.max_x && (e0 < 0.0 || e1 < 0.0 || e2 < 0.0) {
            e0 += de0;
            e1 += de1;
            e2 += de2;
            x += 1;
        }
        while x <= tri.max_x && e0 >= 0.0 && e1 >= 0.0 && e2 >= 0.0 {
            let b0 = (e0 * inv_area) as f32;
            let b1 = (e1 * inv_area) as f32;
            let b2 = (e2 * inv_area) as f32;
            let w0 = b0 * v0.inv_w;
            let w1 = b1 * v1.inv_w;
            let w2 = b2 * v2.inv_w;
            let inv_w = w0 + w1 + w2;
            if x >= 0
                && inv_w > 1e-20
                && (!TOP_LEFT
                    || ((e0 > 0.0 || edges[0]) && (e1 > 0.0 || edges[1]) && (e2 > 0.0 || edges[2])))
            {
                visit(x as usize, y as usize, [w0, w1, w2], inv_w);
            }
            e0 += de0;
            e1 += de1;
            e2 += de2;
            x += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::Vec3;

    #[test]
    fn uv_gradients_match_perspective_interpolation_in_both_sets() {
        let vertex = |x, y, inv_w, uv| ScreenVertex {
            x,
            y,
            inv_w,
            z: 1.0 / inv_w,
            fragment: Fragment {
                world: Vec3::ZERO,
                normal: Vec3::new(0.0, 0.0, 1.0),
                uv,
                tangent: [0.0; 4],
                color: [1.0; 4],
            },
        };
        let tri = ScreenTriangle {
            vertices: [
                vertex(0.0, 0.0, 1.0, [[0.0, 0.0], [0.2, 0.4]]),
                vertex(4.0, 0.0, 0.5, [[1.0, 0.0], [0.8, 0.5]]),
                vertex(0.0, 4.0, 0.25, [[0.0, 1.0], [0.0, 2.0]]),
            ],
            area: 16.0,
            min_x: 0,
            max_x: 3,
            min_y: 0,
            max_y: 3,
            id: 0,
            order: 0,
            flip: false,
            dim: 0.0,
            solid: None,
        };
        let at = |x: f32, y: f32| {
            let weights = [1.0 - x / 4.0 - y / 4.0, x / 8.0, y / 16.0];
            let sum = weights.iter().sum();
            (
                interpolate(
                    &tri,
                    weights,
                    sum,
                    FragmentInputs {
                        uvs: [true; 2],
                        tangent: false,
                    },
                )
                .uv,
                sum,
            )
        };
        let (uv, q) = at(1.0, 1.0);
        let gradient = TextureDerivatives::new(&tri).at(uv, q);
        for (actual, (dx, dy)) in [(gradient.dx, (0.001, 0.0)), (gradient.dy, (0.0, 0.001))] {
            let next = at(1.0 + dx, 1.0 + dy).0;
            for set in 0..2 {
                for i in 0..2 {
                    assert!((actual[set][i] - (next[set][i] - uv[set][i]) / 0.001).abs() < 0.001);
                }
            }
        }
    }
}

#[cfg(test)]
mod coverage_tests {
    use super::*;

    fn triangle(points: [[f32; 2]; 3]) -> ScreenTriangle {
        let vertices = points.map(|[x, y]| ScreenVertex {
            x,
            y,
            z: 1.0,
            inv_w: 1.0,
            fragment: Fragment {
                world: Vec3::ZERO,
                normal: Vec3::new(0.0, 0.0, 1.0),
                uv: [[0.0; 2]; 2],
                tangent: [0.0; 4],
                color: [1.0; 4],
            },
        });
        let [a, b, c] = &vertices;
        let area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        ScreenTriangle {
            vertices,
            area,
            min_x: 0,
            max_x: 1023,
            min_y: 0,
            max_y: 63,
            id: 0,
            order: 0,
            flip: false,
            dim: 0.0,
            solid: None,
        }
    }

    #[test]
    fn long_shared_edges_have_no_cracks_or_duplicate_transparent_samples() {
        for shift in [0.13, 0.371, 0.733] {
            let a = [-10.0 + shift, -10.0];
            let b = [1040.0 + shift, -10.0];
            let c = [1040.0 + shift, 80.0];
            let d = [-10.0 + shift, 80.0];
            let middle = [813.731 + shift, 31.271];
            let mut count = vec![0u8; 1024 * 64];
            for [start, end] in [[a, b], [b, c], [c, d], [d, a]] {
                for segment in 0..127 {
                    let point = |i: usize| {
                        std::array::from_fn(|axis| {
                            start[axis] + (end[axis] - start[axis]) * i as f32 / 127.0
                        })
                    };
                    let tri = triangle([point(segment), point(segment + 1), middle]);
                    coverage::<true>(&tri, 0, 64, |x, y, _, _| count[y * 1024 + x] += 1);
                }
            }
            assert!(
                count.iter().all(|n| *n == 1),
                "shift {shift}: {} holes, {} overlaps",
                count.iter().filter(|n| **n == 0).count(),
                count.iter().filter(|n| **n > 1).count()
            );
        }
    }
}
