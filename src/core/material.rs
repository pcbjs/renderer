// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::lighting::StudioMaterial;
use crate::math::Vec3;
use crate::options::Lighting;
use crate::shadow::ShadowMap;
use crate::texture::{BoundTexture, ColorSpace, Footprint, Texture, TextureInfo};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AlphaMode {
    Opaque,
    Mask,
    Blend,
}

#[derive(Clone, Debug)]
pub struct Material {
    pub base: [f32; 4],
    pub metallic: f32,
    pub roughness: f32,
    pub texture: Option<TextureInfo>,
    pub emissive: [f32; 3],
    pub emissive_texture: Option<TextureInfo>,
    pub metallic_roughness_texture: Option<TextureInfo>,
    pub normal_texture: Option<TextureInfo>,
    pub normal_scale: f32,
    pub occlusion_texture: Option<TextureInfo>,
    pub occlusion_strength: f32,
    pub alpha_mode: AlphaMode,
    pub cutoff: f32,
    pub double_sided: bool,
    pub unlit: bool,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            base: [1.0, 1.0, 1.0, 1.0],
            metallic: 1.0,
            roughness: 1.0,
            texture: None,
            emissive: [0.0; 3],
            emissive_texture: None,
            metallic_roughness_texture: None,
            normal_texture: None,
            normal_scale: 1.0,
            occlusion_texture: None,
            occlusion_strength: 1.0,
            alpha_mode: AlphaMode::Opaque,
            cutoff: 0.5,
            double_sided: false,
            unlit: false,
        }
    }
}

impl Material {
    pub fn textures(&self) -> impl Iterator<Item = (TextureInfo, ColorSpace)> {
        let unlit = self.unlit;
        [
            (self.texture, ColorSpace::Srgb),
            (self.emissive_texture, ColorSpace::Srgb),
            (self.metallic_roughness_texture, ColorSpace::Data),
            (self.normal_texture, ColorSpace::Data),
            (self.occlusion_texture, ColorSpace::Data),
        ]
        .into_iter()
        .enumerate()
        .filter(move |(slot, _)| *slot == 0 || !unlit)
        .filter_map(|(_, (info, space))| info.map(|info| (info, space)))
    }
}

pub(crate) struct Light {
    pub punctual: Option<Vec<crate::punctual::PunctualLight>>,
    pub shadow_light: Option<usize>,
    pub dir: Vec3,
    pub eye: Vec3,
    pub ambient: f32,
    pub hemisphere: f32,
    pub detail: bool,
    pub lighting: Lighting,
    pub view_direction: Option<Vec3>,
    pub shadow: Option<ShadowMap>,
}

fn surface_grain(p: Vec3) -> f32 {
    let n = (p.x * 190.0).sin() * (p.z * 170.0).cos() + (p.y * 230.0).sin() * (p.x * 80.0).cos();
    (n * 0.5 + 0.5).clamp(0.0, 1.0)
}

#[derive(Clone, Copy)]
pub(crate) struct Fragment {
    pub world: Vec3,
    pub normal: Vec3,
    pub uv: [[f32; 2]; 2],
    pub tangent: [f32; 4],
    pub color: [f32; 4],
}

#[derive(Clone, Copy, Default)]
pub(crate) struct FragmentInputs {
    pub uvs: [bool; 2],
    pub tangent: bool,
}

impl Fragment {
    pub fn lerp(self, other: Self, t: f32) -> Self {
        Self {
            world: self.world + (other.world - self.world) * t,
            normal: self.normal + (other.normal - self.normal) * t,
            uv: std::array::from_fn(|set| {
                std::array::from_fn(|i| self.uv[set][i] + (other.uv[set][i] - self.uv[set][i]) * t)
            }),
            tangent: std::array::from_fn(|i| {
                self.tangent[i] + (other.tangent[i] - self.tangent[i]) * t
            }),
            color: std::array::from_fn(|i| self.color[i] + (other.color[i] - self.color[i]) * t),
        }
    }

    pub fn interpolate(
        vertices: [Self; 3],
        weights: [f32; 3],
        sum: f32,
        inputs: FragmentInputs,
    ) -> Self {
        let [a, b, c] = vertices;
        let [w0, w1, w2] = weights;
        Self {
            world: (a.world * w0 + b.world * w1 + c.world * w2) * (1.0 / sum),
            normal: (a.normal * w0 + b.normal * w1 + c.normal * w2) * (1.0 / sum),
            uv: std::array::from_fn(|set| {
                if inputs.uvs[set] {
                    std::array::from_fn(|i| {
                        (a.uv[set][i] * w0 + b.uv[set][i] * w1 + c.uv[set][i] * w2) / sum
                    })
                } else {
                    [0.0; 2]
                }
            }),
            tangent: if inputs.tangent {
                std::array::from_fn(|i| {
                    (a.tangent[i] * w0 + b.tangent[i] * w1 + c.tangent[i] * w2) / sum
                })
            } else {
                [0.0; 4]
            },
            color: std::array::from_fn(|i| {
                (a.color[i] * w0 + b.color[i] * w1 + c.color[i] * w2) / sum
            }),
        }
    }
}

struct Surface {
    shading_normal: Vec3,
    albedo: [f32; 4],
    metallic: f32,
    roughness: f32,
    occlusion: f32,
}

struct Reflectance {
    metallic: f32,
    diffuse: f32,
    specular: f32,
    shininess: f32,
    studio: StudioMaterial,
}

impl Reflectance {
    fn new(metallic: f32, roughness: f32) -> Self {
        let smoothness = 1.0 - roughness.clamp(0.0, 1.0);
        Self {
            metallic,
            diffuse: 1.0 - metallic,
            specular: smoothness * (0.04 + 0.96 * metallic),
            shininess: smoothness * smoothness * 128.0,
            studio: StudioMaterial::from_factors(metallic, roughness),
        }
    }
}

pub(crate) struct Shader<'a> {
    pub style: crate::options::SurfaceStyle,
    pub material: &'a Material,
    texture: Option<BoundTexture<'a>>,
    emissive_texture: Option<BoundTexture<'a>>,
    metallic_roughness_texture: Option<BoundTexture<'a>>,
    normal_texture: Option<BoundTexture<'a>>,
    occlusion_texture: Option<BoundTexture<'a>>,
    reflectance: Reflectance,
    pub inputs: FragmentInputs,
    pub shadow_inputs: FragmentInputs,
    pub needs_gradients: bool,
    pub shadow_gradients: bool,
}

impl<'a> Shader<'a> {
    pub fn new(material: &'a Material, textures: &'a [Texture]) -> Self {
        let bind = |info, space| BoundTexture::new(info, textures, space);
        let texture = bind(material.texture, ColorSpace::Srgb);
        let bind_lit = |info, space| {
            if material.unlit {
                None
            } else {
                bind(info, space)
            }
        };
        let emissive_texture = bind_lit(
            material
                .emissive_texture
                .filter(|_| material.emissive.iter().any(|v| *v > 0.0)),
            ColorSpace::Srgb,
        );
        let metallic_roughness_texture =
            bind_lit(material.metallic_roughness_texture, ColorSpace::Data);
        let normal_texture = bind_lit(material.normal_texture, ColorSpace::Data);
        let occlusion_texture = bind_lit(material.occlusion_texture, ColorSpace::Data);
        let mut inputs = FragmentInputs {
            tangent: normal_texture.is_some(),
            ..FragmentInputs::default()
        };
        for texture in [
            &texture,
            &emissive_texture,
            &metallic_roughness_texture,
            &normal_texture,
            &occlusion_texture,
        ]
        .into_iter()
        .flatten()
        {
            inputs.uvs[texture.info.tex_coord] = true;
        }
        let mut shadow_inputs = FragmentInputs::default();
        if let Some(texture) = &texture {
            shadow_inputs.uvs[texture.info.tex_coord] = true;
        }
        let needs_gradients = [
            &texture,
            &emissive_texture,
            &metallic_roughness_texture,
            &normal_texture,
            &occlusion_texture,
        ]
        .into_iter()
        .flatten()
        .any(BoundTexture::needs_gradients);
        let shadow_gradients = material.alpha_mode == AlphaMode::Mask
            && texture.as_ref().is_some_and(BoundTexture::needs_gradients);
        Self {
            material,
            style: crate::options::SurfaceStyle::default(),
            texture,
            emissive_texture,
            metallic_roughness_texture,
            normal_texture,
            occlusion_texture,
            reflectance: Reflectance::new(material.metallic, material.roughness),
            inputs,
            shadow_inputs,
            needs_gradients,
            shadow_gradients,
        }
    }

    pub fn blend(&self) -> bool {
        self.material.alpha_mode == AlphaMode::Blend || self.style.opacity < 1.0
    }

    fn finish(&self, mut color: [f32; 4], fragment: Fragment, light: &Light) -> [f32; 4] {
        let s = self.style;
        if s.saturation != 1.0 {
            let gray = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
            for value in &mut color[..3] {
                *value = gray + (*value - gray) * s.saturation;
            }
        }
        if s.tint[3] > 0.0 {
            for (i, value) in color[..3].iter_mut().enumerate() {
                *value = *value * (1.0 - s.tint[3]) + s.tint[i] * s.tint[3];
            }
        }
        if s.rim[3] > 0.0 {
            let view = light
                .view_direction
                .unwrap_or_else(|| (light.eye - fragment.world).normalize());
            let rim = (1.0 - fragment.normal.normalize().dot(view).abs())
                .clamp(0.0, 1.0)
                .powi(3)
                * s.rim[3];
            for (i, value) in color[..3].iter_mut().enumerate() {
                *value += s.rim[i] * rim;
            }
        }
        color[3] *= s.opacity;
        color
    }

    pub fn casts_shadow(&self, fragment: Fragment, footprint: &Footprint) -> bool {
        self.material.alpha_mode != AlphaMode::Mask
            || fragment.color[3]
                * self.material.base[3]
                * self
                    .texture
                    .as_ref()
                    .map_or(1.0, |texture| texture.sample(fragment.uv, footprint)[3])
                >= self.material.cutoff
    }

    fn albedo(&self, fragment: Fragment, footprint: &Footprint) -> Option<[f32; 4]> {
        let mat = self.material;
        let mut albedo = std::array::from_fn(|i| fragment.color[i] * mat.base[i]);
        if let Some(tex) = &self.texture {
            let t = tex.sample(fragment.uv, footprint);
            for i in 0..4 {
                albedo[i] *= t[i];
            }
        }
        if mat.alpha_mode == AlphaMode::Mask && albedo[3] < mat.cutoff {
            return None;
        }
        albedo[3] = if mat.alpha_mode == AlphaMode::Blend {
            albedo[3].clamp(0.0, 1.0)
        } else {
            1.0
        };
        if albedo[3] <= 0.0 {
            return None;
        }
        Some(albedo)
    }

    fn surface(
        &self,
        fragment: Fragment,
        footprint: &Footprint,
        detail: bool,
        flip: bool,
    ) -> Option<Surface> {
        let mat = self.material;
        let mut n = fragment.normal;
        n = if n.length_squared() < 1e-12 {
            Vec3::new(0.0, 1.0, 0.0)
        } else {
            n.normalize()
        };
        let mut albedo = self.albedo(fragment, footprint)?;
        let (metallic, roughness) = self.metallic_roughness_texture.as_ref().map_or(
            (mat.metallic, mat.roughness),
            |texture| {
                let t = texture.sample(fragment.uv, footprint);
                (mat.metallic * t[2], mat.roughness * t[1])
            },
        );
        if detail {
            let amp = 0.06 + 0.05 * (1.0 - metallic);
            let scale = 1.0 + amp * (surface_grain(fragment.world) - 0.5);
            for value in &mut albedo[..3] {
                *value *= scale;
            }
        }
        let mut shading_normal = n;
        if let Some(texture) = &self.normal_texture {
            let t = Vec3::new(
                fragment.tangent[0],
                fragment.tangent[1],
                fragment.tangent[2],
            );
            let t = t - n * n.dot(t);
            if t.length_squared() > 1e-12 {
                let t = t.normalize();
                let b = n.cross(t) * if fragment.tangent[3] < 0.0 { -1.0 } else { 1.0 };
                let texel = texture.sample(fragment.uv, footprint);
                let mapped = t * ((2.0 * texel[0] - 1.0) * mat.normal_scale)
                    + b * ((2.0 * texel[1] - 1.0) * mat.normal_scale)
                    + n * (2.0 * texel[2] - 1.0);
                if mapped.length_squared() > 1e-12 {
                    shading_normal = mapped.normalize();
                }
            }
        }
        let occlusion = self.occlusion_texture.as_ref().map_or(1.0, |texture| {
            1.0 + mat.occlusion_strength * (texture.sample(fragment.uv, footprint)[0] - 1.0)
        });
        if flip {
            shading_normal = -shading_normal;
        }
        Some(Surface {
            shading_normal,
            albedo,
            metallic,
            roughness,
            occlusion,
        })
    }

    pub fn shade(
        &self,
        fragment: Fragment,
        footprint: &Footprint,
        light: &Light,
        flip: bool,
        receiver_normal: Vec3,
    ) -> Option<[f32; 4]> {
        if self.material.unlit {
            return self
                .albedo(fragment, footprint)
                .map(|color| self.finish(color, fragment, light));
        }
        let surface = self.surface(fragment, footprint, light.detail, flip)?;
        let n = surface.shading_normal;
        let albedo = surface.albedo;
        let textured;
        let reflectance = if self.metallic_roughness_texture.is_some() {
            textured = Reflectance::new(surface.metallic, surface.roughness);
            &textured
        } else {
            &self.reflectance
        };
        let n_dot_l = if light.punctual.is_some() {
            0.0
        } else {
            n.dot(light.dir).max(0.0)
        };
        let visibility = if n_dot_l > 0.0 {
            light.shadow.as_ref().map_or(1.0, |shadow| {
                shadow.visibility(fragment.world, receiver_normal)
            })
        } else {
            1.0
        };
        let mut rgb = if light.lighting == Lighting::Studio {
            reflectance.studio.shade(
                albedo,
                n,
                fragment.world,
                light,
                visibility,
                surface.occlusion,
            )
        } else {
            let hemi = light.hemisphere * (0.5 + 0.5 * n.y.clamp(-1.0, 1.0));
            let lit = (light.ambient + hemi) * surface.occlusion
                + reflectance.diffuse * (1.0 - light.ambient) * n_dot_l * visibility;
            let mut rgb = [albedo[0] * lit, albedo[1] * lit, albedo[2] * lit];
            if reflectance.specular > 1e-4 && n_dot_l > 0.0 {
                let view = light.eye - fragment.world;
                let vlen = view.length();
                if vlen > 1e-8 {
                    let v = view * (1.0 / vlen);
                    let h = (light.dir + v).normalize();
                    let ndh = n.dot(h).max(0.0);
                    let spec = if reflectance.shininess < 1.0 {
                        ndh
                    } else {
                        ndh.powf(reflectance.shininess)
                    } * reflectance.specular
                        * n_dot_l
                        * visibility;
                    for i in 0..3 {
                        rgb[i] += (albedo[i] * reflectance.metallic + (1.0 - reflectance.metallic))
                            * spec;
                    }
                }
            }
            rgb
        };
        if let Some(lights) = &light.punctual {
            let view = light
                .view_direction
                .unwrap_or_else(|| (light.eye - fragment.world).normalize());
            for (index, source) in lights.iter().enumerate() {
                let (direction, radiance) = source.sample(fragment.world);
                let nl = n.dot(direction).max(0.0);
                if nl <= 0.0 || radiance.iter().all(|v| *v == 0.0) {
                    continue;
                }
                let visibility = if light.shadow_light == Some(index) {
                    light
                        .shadow
                        .as_ref()
                        .map_or(1.0, |s| s.visibility(fragment.world, receiver_normal))
                } else {
                    1.0
                };
                let contribution = if light.lighting == Lighting::Studio {
                    reflectance.studio.direct(albedo, n, view, direction)
                } else {
                    let nh = n.dot((direction + view).normalize()).max(0.0);
                    let spec = nh.powf(reflectance.shininess.max(1.0)) * reflectance.specular;
                    std::array::from_fn(|i| {
                        nl / std::f32::consts::PI
                            * (albedo[i] * reflectance.diffuse
                                + (albedo[i] * reflectance.metallic + 1.0 - reflectance.metallic)
                                    * spec)
                    })
                };
                for i in 0..3 {
                    rgb[i] += contribution[i] * radiance[i] * visibility;
                }
            }
        }
        let emission = self
            .emissive_texture
            .as_ref()
            .map_or([1.0; 4], |tex| tex.sample(fragment.uv, footprint));
        for i in 0..3 {
            rgb[i] += self.material.emissive[i] * emission[i];
        }
        Some(self.finish([rgb[0], rgb[1], rgb[2], albedo[3]], fragment, light))
    }
}

pub(crate) fn mix_bg(c: [f32; 4], dim: f32, bg: [f32; 4]) -> [f32; 4] {
    if dim <= 0.0 {
        return c;
    }
    let k = 1.0 - dim;
    [
        c[0] * k + bg[0] * dim,
        c[1] * k + bg[1] * dim,
        c[2] * k + bg[2] * dim,
        c[3] * k + bg[3] * dim,
    ]
}
