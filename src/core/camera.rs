// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use serde::Deserialize;

use crate::math::Vec3;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CamSpec {
    Asset {
        node: usize,
    },
    Fit {
        ortho: bool,
        direction: Vec3,
        up: Vec3,
        margin: f32,
        #[serde(rename = "fov")]
        fov_deg: f32,
    },
    Perspective {
        position: Vec3,
        target: Vec3,
        up: Vec3,
        #[serde(rename = "fov")]
        fov_deg: f32,
    },
    Ortho {
        position: Vec3,
        target: Vec3,
        up: Vec3,
        height: f32,
    },
}

#[derive(Clone, Copy, Debug)]
pub enum Proj {
    Perspective { tan_half_v: f32, tan_half_h: f32 },
    Ortho { half_w: f32, half_h: f32 },
}

#[derive(Clone, Copy, Debug)]
pub struct Camera {
    pub eye: Vec3,
    pub right: Vec3,
    pub up: Vec3,
    pub forward: Vec3,
    pub proj: Proj,
    pub near: f32,
    pub far: f32,
}

/// `dir` points from the target toward the camera. `right = up × back`, then screen-up is `back × right`.
pub fn axes(dir: Vec3, up: Vec3) -> (Vec3, Vec3, Vec3) {
    let back = dir.normalize();
    let mut right = up.cross(back);
    if right.length_squared() < 1e-12 {
        right = if up.y.abs() > 0.9 {
            Vec3::new(1.0, 0.0, 0.0)
        } else {
            Vec3::new(0.0, 1.0, 0.0)
        };
    }
    right = right.normalize();
    let top = back.cross(right).normalize();
    (back, right, top)
}

fn corners(min: Vec3, max: Vec3) -> [Vec3; 8] {
    let xs = [min.x, max.x];
    let ys = [min.y, max.y];
    let zs = [min.z, max.z];
    let mut out = [Vec3::ZERO; 8];
    let mut i = 0;
    for x in xs {
        for y in ys {
            for z in zs {
                out[i] = Vec3::new(x, y, z);
                i += 1;
            }
        }
    }
    out
}

pub fn fit_distance(
    min: Vec3,
    max: Vec3,
    dir: Vec3,
    up: Vec3,
    vfov: f32,
    aspect: f32,
    margin: f32,
) -> f32 {
    let (back, right, top) = axes(dir, up);
    let centre = (min + max) * 0.5;
    let tv = (vfov * 0.5).tan().max(1e-4);
    let th = (tv * aspect).max(1e-4);
    let mut d = 0.0f32;
    for c in corners(min, max) {
        let p = c - centre;
        let toward = p.dot(back);
        d = d.max(toward + p.dot(right).abs() / th);
        d = d.max(toward + p.dot(top).abs() / tv);
    }
    if d < 1e-4 {
        d = (max - min).length().max(1e-3);
    }
    d * margin
}

pub fn fit_ortho_height(
    min: Vec3,
    max: Vec3,
    dir: Vec3,
    up: Vec3,
    aspect: f32,
    margin: f32,
) -> f32 {
    let (_, right, top) = axes(dir, up);
    let centre = (min + max) * 0.5;
    let mut half_w = 0.0f32;
    let mut half_h = 0.0f32;
    for c in corners(min, max) {
        let p = c - centre;
        half_w = half_w.max(p.dot(right).abs());
        half_h = half_h.max(p.dot(top).abs());
    }
    (2.0 * half_h.max(half_w / aspect.max(1e-4)) * margin).max(1e-6)
}

fn depth_range(min: Vec3, max: Vec3, eye: Vec3, forward: Vec3) -> (f32, f32) {
    let mut z0 = f32::MAX;
    let mut z1 = f32::MIN;
    for c in corners(min, max) {
        let z = (c - eye).dot(forward);
        z0 = z0.min(z);
        z1 = z1.max(z);
    }
    let near = if z0 > 1e-3 {
        (z0 * 0.25).max(1e-4)
    } else {
        1e-3
    };
    let far = (z1 * 1.05 + 1e-3).max(near + 1e-2);
    (near, far)
}

pub fn frame(spec: CamSpec, min: Vec3, max: Vec3, aspect: f32) -> Result<Camera, String> {
    let (eye, target, up_hint, proj) = match spec {
        CamSpec::Asset { .. } => {
            return Err("asset cameras must be resolved from the loaded scene".into())
        }
        CamSpec::Perspective {
            position,
            target,
            up,
            fov_deg,
        } => {
            let fov = fov_deg.to_radians();
            let tan_half_v = (fov * 0.5).tan();
            let proj = Proj::Perspective {
                tan_half_v,
                tan_half_h: tan_half_v * aspect,
            };
            (position, target, up, proj)
        }
        CamSpec::Ortho {
            position,
            target,
            up,
            height,
        } => {
            let half_h = height * 0.5;
            let proj = Proj::Ortho {
                half_h,
                half_w: half_h * aspect,
            };
            (position, target, up, proj)
        }
        CamSpec::Fit {
            ortho,
            direction: dir,
            up,
            margin,
            fov_deg,
        } => {
            let centre = (min + max) * 0.5;
            if ortho {
                let height = fit_ortho_height(min, max, dir, up, aspect, margin);
                let (back, _, _) = axes(dir, up);
                let radius = (max - min).length() * 0.5;
                let eye = centre + back * (radius * 4.0 + 1e-3);
                let half_h = height * 0.5;
                let proj = Proj::Ortho {
                    half_h,
                    half_w: half_h * aspect,
                };
                (eye, centre, up, proj)
            } else {
                let fov = fov_deg.to_radians();
                let dist = fit_distance(min, max, dir, up, fov, aspect, margin);
                let (back, _, _) = axes(dir, up);
                let eye = centre + back * dist;
                let tan_half_v = (fov * 0.5).tan();
                let proj = Proj::Perspective {
                    tan_half_v,
                    tan_half_h: tan_half_v * aspect,
                };
                (eye, centre, up, proj)
            }
        }
    };
    let forward_raw = target - eye;
    if forward_raw.length_squared() < 1e-16 {
        return Err("camera position and target are the same point".into());
    }
    let forward = forward_raw.normalize();
    let (_, right, up) = axes(-forward, up_hint);
    let (near, far) = depth_range(min, max, eye, forward);
    Ok(Camera {
        eye,
        right,
        up,
        forward,
        proj,
        near,
        far,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_distance_is_outside_the_box() {
        let min = Vec3::new(-1.0, -1.0, -1.0);
        let max = Vec3::new(1.0, 1.0, 1.0);
        let d = fit_distance(
            min,
            max,
            Vec3::new(0.55, 0.9, 0.95),
            Vec3::new(0.0, 1.0, 0.0),
            35f32.to_radians(),
            1.6,
            1.08,
        );
        assert!(d > 2.0, "{d}");
    }

    #[test]
    fn top_view_looks_down() {
        let cam = frame(
            CamSpec::Fit {
                ortho: false,
                direction: Vec3::new(0.0, 1.0, 1e-3),
                up: Vec3::new(0.0, 1.0, 0.0),
                margin: 1.08,
                fov_deg: 35.0,
            },
            Vec3::new(-1.0, 0.0, -1.0),
            Vec3::new(1.0, 0.0, 1.0),
            1.0,
        )
        .unwrap();
        assert!(cam.eye.y > 0.5, "{:?}", cam.eye);
        assert!(cam.forward.y < -0.5, "{:?}", cam.forward);
    }
}
