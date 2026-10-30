// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::material::Light;
use crate::math::Vec3;

pub(crate) struct StudioMaterial {
    metallic: f32,
    roughness: f32,
    alpha2: f32,
    environment_exponent: f32,
    environment_energy: f32,
}

impl StudioMaterial {
    pub fn from_factors(metallic: f32, roughness: f32) -> Self {
        let roughness = roughness.clamp(0.045, 1.0);
        let environment_exponent = 2.0 + 62.0 * (1.0 - roughness).powi(2);
        Self {
            metallic: metallic.clamp(0.0, 1.0),
            roughness,
            alpha2: roughness.powi(4),
            environment_exponent,
            environment_energy: (environment_exponent + 1.0) * 0.16,
        }
    }

    pub fn shade(
        &self,
        albedo: [f32; 4],
        normal: Vec3,
        world: Vec3,
        light: &Light,
        visibility: f32,
        occlusion: f32,
    ) -> [f32; 3] {
        let Self {
            metallic,
            roughness,
            ..
        } = *self;
        let view = light
            .view_direction
            .unwrap_or_else(|| (light.eye - world).normalize());
        let nv = normal.dot(view).clamp(1e-4, 1.0);
        let direct = if light.punctual.is_none() {
            self.direct(albedo, normal, view, light.dir)
                .map(|c| c * std::f32::consts::PI * (1.0 - light.ambient).max(0.0) * visibility)
        } else {
            [0.0; 3]
        };
        let reflection = normal * (2.0 * nv) - view;
        let environment = self.environment(reflection);
        let ambient = light.ambient.max(0.0);
        let hemisphere = light.hemisphere.max(0.0) * (0.5 + 0.5 * normal.y);
        let grazing = (1.0 - nv).powi(5);
        std::array::from_fn(|i| {
            let f0 = 0.04 * (1.0 - metallic) + albedo[i] * metallic;
            let environment_f = f0 + ((1.0 - roughness).max(f0) - f0) * grazing;
            let diffuse = albedo[i] * (1.0 - metallic);
            direct[i]
                + (1.0 - environment_f) * diffuse * (ambient + hemisphere) * occlusion
                + environment_f * (ambient * environment[i] + hemisphere) * occlusion
        })
    }

    pub fn direct(&self, albedo: [f32; 4], normal: Vec3, view: Vec3, direction: Vec3) -> [f32; 3] {
        let nv = normal.dot(view).clamp(1e-4, 1.0);
        let nl = normal.dot(direction).clamp(0.0, 1.0);
        let half = (view + direction).normalize();
        let nh = normal.dot(half).clamp(0.0, 1.0);
        let vh = view.dot(half).clamp(0.0, 1.0);
        let denominator = nh * nh * (self.alpha2 - 1.0) + 1.0;
        let distribution = self.alpha2 / (std::f32::consts::PI * denominator * denominator);
        let smith = 0.5
            / (nv * (self.alpha2 + (1.0 - self.alpha2) * nl * nl).sqrt()
                + nl * (self.alpha2 + (1.0 - self.alpha2) * nv * nv).sqrt())
            .max(1e-6);
        std::array::from_fn(|i| {
            let f0 = 0.04 * (1.0 - self.metallic) + albedo[i] * self.metallic;
            let f = f0 + (1.0 - f0) * (1.0 - vh).powi(5);
            nl * ((1.0 - f) * albedo[i] * (1.0 - self.metallic) / std::f32::consts::PI
                + f * distribution * smith)
        })
    }

    // Broadening these spherical lobes approximates rough reflections without an environment texture or per-pixel sampling loop.
    fn environment(&self, direction: Vec3) -> [f32; 3] {
        let exponent = self.environment_exponent;
        let energy = self.environment_energy;
        let key = direction
            .dot(Vec3::new(-0.48, 0.8, 0.36))
            .max(0.0)
            .powf(exponent)
            * energy;
        let fill = direction
            .dot(Vec3::new(0.8, 0.36, -0.48))
            .max(0.0)
            .powf(exponent)
            * energy
            * 0.65;
        let sky = 0.35 + 0.65 * (0.5 + 0.5 * direction.y.clamp(-1.0, 1.0));
        [
            sky + key + fill * 0.85,
            sky + key * 0.95 + fill * 0.92,
            sky + key * 0.85 + fill,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::material::Material;
    use crate::options::Lighting;

    #[test]
    fn ggx_normal_incidence_and_grazing_limits_are_finite() {
        let mut light = Light {
            punctual: None,
            shadow_light: None,
            dir: Vec3::new(0.0, 0.0, 1.0),
            eye: Vec3::new(0.0, 0.0, 2.0),
            ambient: 0.0,
            hemisphere: 0.0,
            detail: false,
            lighting: Lighting::Studio,
            view_direction: None,
            shadow: None,
        };
        for (metallic, expected) in [(0.0, 0.25), (1.0, 0.0625)] {
            let material = Material {
                metallic,
                roughness: 1.0,
                ..Material::default()
            };
            let shader = StudioMaterial::from_factors(material.metallic, material.roughness);
            let rgb = shader.shade(
                [0.25; 4],
                Vec3::new(0.0, 0.0, 1.0),
                Vec3::ZERO,
                &light,
                1.0,
                1.0,
            );
            assert!(rgb.iter().all(|v| (v - expected).abs() < 1e-6), "{rgb:?}");
        }
        for roughness in [0.0, 0.001, 0.5, 1.0] {
            for direction in [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 0.0, -1.0]] {
                light.dir = Vec3::from(direction);
                let material = Material {
                    roughness,
                    ..Material::default()
                };
                let rgb = StudioMaterial::from_factors(material.metallic, material.roughness)
                    .shade(
                        [1.0; 4],
                        Vec3::new(0.0, 0.0, 1.0),
                        Vec3::ZERO,
                        &light,
                        1.0,
                        1.0,
                    );
                assert!(rgb.iter().all(|v| v.is_finite() && *v >= 0.0), "{rgb:?}");
            }
        }
    }
}
