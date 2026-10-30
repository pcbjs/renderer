// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::math::Vec3;

#[derive(Clone, Copy, Debug, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LightKind {
    Directional,
    Point,
    Spot,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PunctualLight {
    #[serde(rename = "type")]
    pub kind: LightKind,
    pub position: Vec3,
    pub direction: Vec3,
    pub color: [f32; 3],
    pub intensity: f32,
    pub range: Option<f32>,
    pub inner_cone_angle: f32,
    pub outer_cone_angle: f32,
}

impl PunctualLight {
    pub fn validate(&self) -> Result<(), String> {
        if !self.position.is_finite()
            || !self.direction.is_finite()
            || (self.kind != LightKind::Point && self.direction.length_squared() < 1e-16)
        {
            return Err("light position/direction must be finite and direction non-zero".into());
        }
        if self
            .color
            .iter()
            .any(|n| !n.is_finite() || !(0.0..=1.0).contains(n))
            || !self.intensity.is_finite()
            || self.intensity < 0.0
        {
            return Err(
                "light color must be between 0 and 1 and intensity finite and non-negative".into(),
            );
        }
        if self.range.is_some_and(|n| !n.is_finite() || n <= 0.0)
            || (self.kind == LightKind::Directional && self.range.is_some())
        {
            return Err(
                "light range must be positive and only applies to point/spot lights".into(),
            );
        }
        if !self.inner_cone_angle.is_finite()
            || !self.outer_cone_angle.is_finite()
            || self.inner_cone_angle < 0.0
            || self.inner_cone_angle >= self.outer_cone_angle
            || self.outer_cone_angle > std::f32::consts::FRAC_PI_2
        {
            return Err(
                "spot angles must satisfy 0 <= innerConeAngle < outerConeAngle <= PI/2".into(),
            );
        }
        Ok(())
    }

    pub fn sample(&self, world: Vec3) -> (Vec3, [f32; 3]) {
        let (direction, mut attenuation) = if self.kind == LightKind::Directional {
            (-self.direction, 1.0)
        } else {
            let delta = self.position - world;
            let squared = delta.length_squared();
            let cutoff = self.range.map_or(1.0, |range| {
                (1.0 - (squared / (range * range)).powi(2)).clamp(0.0, 1.0)
            });
            (delta.normalize(), cutoff / squared.max(1e-8))
        };
        if self.kind == LightKind::Spot {
            let inner = self.inner_cone_angle.cos();
            let outer = self.outer_cone_angle.cos();
            let cone = ((-direction.dot(self.direction) - outer) / (inner - outer).max(0.001))
                .clamp(0.0, 1.0);
            attenuation *= cone * cone;
        }
        (
            direction,
            self.color.map(|c| c * self.intensity * attenuation),
        )
    }
}
