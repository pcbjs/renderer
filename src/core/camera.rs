// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use serde::{Deserialize, Serialize};

use crate::math::Vec3;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CamSpec {
    Resolved {
        state: CameraState,
    },
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
    pub offset: [f32; 2],
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum ProjectionState {
    Perspective {
        #[serde(rename = "tanHalfV")]
        tan_half_v: f32,
        #[serde(rename = "tanHalfH")]
        tan_half_h: f32,
    },
    Orthographic {
        #[serde(rename = "halfWidth")]
        half_w: f32,
        #[serde(rename = "halfHeight")]
        half_h: f32,
    },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraState {
    pub position: [f32; 3],
    pub right: [f32; 3],
    pub up: [f32; 3],
    pub forward: [f32; 3],
    pub projection: ProjectionState,
    pub near: f32,
    pub far: Option<f32>,
    pub offset: [f32; 2],
}

impl CameraState {
    pub fn camera(self) -> Result<Camera, String> {
        let right = Vec3::from(self.right);
        let up = Vec3::from(self.up);
        let forward = Vec3::from(self.forward);
        let vectors = [Vec3::from(self.position), right, up, forward];
        if vectors.iter().any(|v| !v.is_finite())
            || [right, up, forward]
                .iter()
                .any(|v| (v.length_squared() - 1.0).abs() > 1e-4)
            || right.dot(up).abs() > 1e-4
            || right.dot(forward).abs() > 1e-4
            || up.dot(forward).abs() > 1e-4
            || right.cross(up).dot(forward) > -0.9999
            || self.offset.iter().any(|v| !v.is_finite())
        {
            return Err(
                "resolved camera needs a finite orthonormal right-handed basis and offset".into(),
            );
        }
        let proj = match self.projection {
            ProjectionState::Perspective {
                tan_half_v,
                tan_half_h,
            } => Proj::Perspective {
                tan_half_v,
                tan_half_h,
            },
            ProjectionState::Orthographic { half_w, half_h } => Proj::Ortho { half_w, half_h },
        };
        let (a, b) = match proj {
            Proj::Perspective {
                tan_half_v,
                tan_half_h,
            } => (tan_half_v, tan_half_h),
            Proj::Ortho { half_w, half_h } => (half_w, half_h),
        };
        if !a.is_finite()
            || !b.is_finite()
            || a <= 0.0
            || b <= 0.0
            || !self.near.is_finite()
            || self.near < 0.0
            || (matches!(proj, Proj::Perspective { .. }) && self.near == 0.0)
            || self
                .far
                .is_some_and(|far| !far.is_finite() || far <= self.near)
        {
            return Err(
                "resolved camera needs positive projection extents and valid clipping planes"
                    .into(),
            );
        }
        Ok(Camera {
            eye: vectors[0],
            right,
            up,
            forward,
            proj,
            near: self.near,
            far: self.far.unwrap_or(f32::INFINITY),
            offset: self.offset,
        })
    }
}

impl Camera {
    pub fn state(self) -> CameraState {
        let array = |v: Vec3| [v.x, v.y, v.z];
        CameraState {
            position: array(self.eye),
            right: array(self.right),
            up: array(self.up),
            forward: array(self.forward),
            projection: match self.proj {
                Proj::Perspective {
                    tan_half_v,
                    tan_half_h,
                } => ProjectionState::Perspective {
                    tan_half_v,
                    tan_half_h,
                },
                Proj::Ortho { half_w, half_h } => ProjectionState::Orthographic { half_w, half_h },
            },
            near: self.near,
            far: self.far.is_finite().then_some(self.far),
            offset: self.offset,
        }
    }

    pub fn view(self, world: Vec3) -> Vec3 {
        let p = world - self.eye;
        Vec3::new(p.dot(self.right), p.dot(self.up), p.dot(self.forward))
    }

    pub fn project(self, position: Vec3, width: u32, height: u32) -> (f32, f32, f32) {
        let z = position.z.max(1e-6);
        let (x, y, inv_w) = match self.proj {
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
        (
            (x + self.offset[0] + 1.0) * 0.5 * width as f32,
            (1.0 - y - self.offset[1]) * 0.5 * height as f32,
            inv_w,
        )
    }
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

pub(crate) fn depth_bounds(min: Vec3, max: Vec3, eye: Vec3, forward: Vec3) -> (f32, f32) {
    let mut z0 = f32::MAX;
    let mut z1 = f32::MIN;
    for c in corners(min, max) {
        let z = (c - eye).dot(forward);
        z0 = z0.min(z);
        z1 = z1.max(z);
    }
    (z0, z1)
}

pub(crate) fn depth_range(min: Vec3, max: Vec3, eye: Vec3, forward: Vec3) -> (f32, f32) {
    let (z0, z1) = depth_bounds(min, max, eye, forward);
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
        CamSpec::Resolved { state } => return state.camera(),
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
        offset: [0.0; 2],
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
