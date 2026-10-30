// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(from = "[f32; 3]")]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub const ZERO: Self = Self::new(0.0, 0.0, 0.0);

    pub fn splat(v: f32) -> Self {
        Self::new(v, v, v)
    }

    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    pub fn cross(self, o: Self) -> Self {
        Self::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }

    pub fn length_squared(self) -> f32 {
        self.dot(self)
    }

    pub fn length(self) -> f32 {
        self.length_squared().sqrt()
    }

    pub fn normalize(self) -> Self {
        let len = self.length();
        if len < 1e-20 {
            self
        } else {
            self * (1.0 / len)
        }
    }

    pub fn min(self, o: Self) -> Self {
        Self::new(self.x.min(o.x), self.y.min(o.y), self.z.min(o.z))
    }

    pub fn max(self, o: Self) -> Self {
        Self::new(self.x.max(o.x), self.y.max(o.y), self.z.max(o.z))
    }

    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }

    pub fn to_array(self) -> [f32; 3] {
        [self.x, self.y, self.z]
    }
}

impl From<[f32; 3]> for Vec3 {
    fn from(v: [f32; 3]) -> Self {
        Self::new(v[0], v[1], v[2])
    }
}

impl std::ops::Add for Vec3 {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}

impl std::ops::Sub for Vec3 {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}

impl std::ops::Mul<f32> for Vec3 {
    type Output = Self;
    fn mul(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }
}

impl std::ops::Neg for Vec3 {
    type Output = Self;
    fn neg(self) -> Self {
        Self::new(-self.x, -self.y, -self.z)
    }
}

pub const IDENT: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// Column-major product `a * b`. `b` applies first.
pub fn mul_mat(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    let mut o = [0.0; 16];
    for c in 0..4 {
        for r in 0..4 {
            o[c * 4 + r] = a[r] * b[c * 4]
                + a[4 + r] * b[c * 4 + 1]
                + a[8 + r] * b[c * 4 + 2]
                + a[12 + r] * b[c * 4 + 3];
        }
    }
    o
}

pub fn mul_point(m: &[f32; 16], p: Vec3) -> Vec3 {
    let x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
    let y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
    let z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
    let w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if w != 0.0 && (w - 1.0).abs() > 1e-8 {
        Vec3::new(x / w, y / w, z / w)
    } else {
        Vec3::new(x, y, z)
    }
}

/// glTF quaternion `xyzw` with column-major translation, rotation and scale.
pub fn trs(t: [f32; 3], q: [f32; 4], s: [f32; 3]) -> [f32; 16] {
    let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
    let r = [
        1.0 - 2.0 * (y * y + z * z),
        2.0 * (x * y + z * w),
        2.0 * (x * z - y * w),
        2.0 * (x * y - z * w),
        1.0 - 2.0 * (x * x + z * z),
        2.0 * (y * z + x * w),
        2.0 * (x * z + y * w),
        2.0 * (y * z - x * w),
        1.0 - 2.0 * (x * x + y * y),
    ];
    [
        r[0] * s[0],
        r[1] * s[0],
        r[2] * s[0],
        0.0,
        r[3] * s[1],
        r[4] * s[1],
        r[5] * s[1],
        0.0,
        r[6] * s[2],
        r[7] * s[2],
        r[8] * s[2],
        0.0,
        t[0],
        t[1],
        t[2],
        1.0,
    ]
}

/// Inverse-transpose of the upper 3×3, column-major, for normals.
pub fn normal_matrix(m: &[f32; 16]) -> [f32; 9] {
    let a = m[0];
    let b = m[4];
    let c = m[8];
    let d = m[1];
    let e = m[5];
    let f = m[9];
    let g = m[2];
    let h = m[6];
    let i = m[10];
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if det.abs() < 1e-20 {
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    }
    let inv = 1.0 / det;
    let i00 = (e * i - f * h) * inv;
    let i01 = (c * h - b * i) * inv;
    let i02 = (b * f - c * e) * inv;
    let i10 = (f * g - d * i) * inv;
    let i11 = (a * i - c * g) * inv;
    let i12 = (c * d - a * f) * inv;
    let i20 = (d * h - e * g) * inv;
    let i21 = (b * g - a * h) * inv;
    let i22 = (a * e - b * d) * inv;
    [i00, i01, i02, i10, i11, i12, i20, i21, i22]
}

pub fn mul_n(m: &[f32; 9], n: Vec3) -> Vec3 {
    Vec3::new(
        m[0] * n.x + m[3] * n.y + m[6] * n.z,
        m[1] * n.x + m[4] * n.y + m[7] * n.z,
        m[2] * n.x + m[5] * n.y + m[8] * n.z,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translation_moves_the_origin() {
        let m = trs([1.0, 2.0, 3.0], [0.0, 0.0, 0.0, 1.0], [1.0, 1.0, 1.0]);
        let p = mul_point(&m, Vec3::ZERO);
        assert!((p.x - 1.0).abs() < 1e-6 && (p.y - 2.0).abs() < 1e-6 && (p.z - 3.0).abs() < 1e-6);
    }

    #[test]
    fn y_rotation_is_right_handed() {
        let s = (0.5f32).sqrt();
        let m = trs([0.0, 0.0, 0.0], [0.0, s, 0.0, s], [1.0, 1.0, 1.0]);
        let p = mul_point(&m, Vec3::new(1.0, 0.0, 0.0));
        assert!(
            p.x.abs() < 1e-5 && p.y.abs() < 1e-5 && (p.z + 1.0).abs() < 1e-5,
            "{p:?}"
        );
    }

    #[test]
    fn normal_matrix_inverts_scale() {
        let mut m = IDENT;
        m[0] = 2.0;
        let n = mul_n(&normal_matrix(&m), Vec3::new(1.0, 1.0, 0.0));
        assert!(
            (n.x - 0.5).abs() < 1e-5 && (n.y - 1.0).abs() < 1e-5 && n.z.abs() < 1e-5,
            "{n:?}"
        );
    }
}
