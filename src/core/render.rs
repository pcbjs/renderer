// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use std::collections::HashSet;

use crate::camera::{frame, CamSpec, Proj};
use crate::color::{byte_lin, srgb_to_linear, OutputTransform};
use crate::framebuffer::{paint_outline, Framebuffer};
use crate::geometry::{GeometryPass, PreparedDraw};
use crate::material::{AlphaMode, Light, Shader};
use crate::math::Vec3;
use crate::model::Model;
use crate::options::{validate, Options};
use crate::punctual::LightKind;
use crate::raster::{raster_transparent, raster_tri};
use crate::shadow::ShadowMap;
use crate::transparency::{self, PeelBuffer};

const DIRECT_PIXELS: u64 = 8_000_000;
const BAND_PIXELS: u64 = 2_000_000;

pub fn render(model: &Model, opts: &Options) -> Result<Vec<u8>, String> {
    validate(opts)?;
    let band = band_height(
        opts.width * opts.supersample,
        opts.height * opts.supersample,
        opts.supersample,
    );
    render_bands(model, opts, band)
}

fn render_bands(model: &Model, opts: &Options, band_rows: u32) -> Result<Vec<u8>, String> {
    let width = opts.width;
    let height = opts.height;
    let samples = opts.supersample;
    let sample_width = width * samples;
    let sample_height = height * samples;
    let background = [
        srgb_to_linear(opts.background[0].clamp(0.0, 1.0)),
        srgb_to_linear(opts.background[1].clamp(0.0, 1.0)),
        srgb_to_linear(opts.background[2].clamp(0.0, 1.0)),
        opts.background[3].clamp(0.0, 1.0),
    ];
    let transform = OutputTransform::new(opts.exposure, opts.tone_mapping);
    let transparent = model.draws.iter().any(|draw| {
        model
            .materials
            .get(draw.material)
            .is_some_and(|m| m.alpha_mode == AlphaMode::Blend)
    });
    let band_rows = if transparent {
        let rows = (transparency::BAND_PIXELS / sample_width as u64) as u32;
        band_rows.min((rows / samples).max(1) * samples)
    } else {
        band_rows
    };
    let pixels = (width as usize) * (height as usize);
    for offset in &opts.node_translations {
        if !model.nodes.iter().any(|node| node.index == offset.node) {
            return Err(format!(
                "node translation references node {} outside the selected scene",
                offset.node
            ));
        }
    }
    let offset = |nodes: &[usize]| {
        opts.node_translations
            .iter()
            .filter(|t| nodes.contains(&t.node))
            .fold(Vec3::ZERO, |sum, t| sum + t.translation)
    };
    let offsets: Vec<_> = model.draws.iter().map(|draw| offset(&draw.nodes)).collect();
    let (bmin, bmax) = translated_bounds(model, &offsets);
    let aspect = width as f32 / height as f32;
    let mut camera = if let CamSpec::Asset { node } = opts.camera {
        let asset = model
            .cameras
            .iter()
            .find(|c| c.node == node)
            .ok_or_else(|| format!("camera node {node} is not in the selected scene"))?;
        let mut camera = asset.camera;
        camera.eye = camera.eye + offset(&asset.nodes);
        if asset.dynamic_aspect {
            if let Proj::Perspective { tan_half_v, .. } = camera.proj {
                camera.proj = Proj::Perspective {
                    tan_half_v,
                    tan_half_h: tan_half_v * aspect,
                };
            }
        }
        camera
    } else {
        frame(opts.camera, bmin, bmax, aspect)?
    };
    if let Some(near) = opts.near {
        camera.near = near;
    }
    if let Some(far) = opts.far {
        camera.far = far;
    }
    if camera.far <= camera.near
        || (matches!(camera.proj, Proj::Perspective { .. }) && camera.near <= 0.0)
    {
        return Err(
            "camera needs 0 < near < far for perspective, or 0 <= near < far for orthographic"
                .into(),
        );
    }
    if model.triangles == 0 {
        return Ok(fill_background(width, height, &background, transform));
    }
    let mut punctual = opts.lights.clone().or_else(|| {
        if opts.use_asset_lights && !model.lights.is_empty() {
            Some(
                model
                    .lights
                    .iter()
                    .map(|asset| {
                        let mut light = asset.light.clone();
                        light.position = light.position + offset(&asset.nodes);
                        light
                    })
                    .collect(),
            )
        } else {
            None
        }
    });
    if let Some(lights) = &mut punctual {
        for light in lights {
            light.direction = light.direction.normalize();
        }
    }
    let shadow_light = punctual
        .as_ref()
        .and_then(|lights| lights.iter().position(|l| l.kind == LightKind::Directional));
    let mut light = Light {
        dir: shadow_light.map_or_else(
            || Vec3::from(opts.light_dir).normalize(),
            |i| -punctual.as_ref().unwrap()[i].direction,
        ),
        punctual,
        shadow_light,
        eye: camera.eye,
        ambient: opts.ambient,
        hemisphere: opts.hemisphere,
        detail: opts.detail,
        lighting: opts.lighting,
        view_direction: match camera.proj {
            Proj::Ortho { .. } => Some(-camera.forward),
            _ => None,
        },
        shadow: None,
    };
    let shaders: Vec<_> = model
        .materials
        .iter()
        .map(|material| Shader::new(material, &model.textures))
        .collect();
    if let Some(shadows) = opts.shadows.filter(|shadows| {
        shadows.strength > 0.0 && (light.punctual.is_none() || light.shadow_light.is_some())
    }) {
        light.shadow = Some(ShadowMap::new(
            model, &shaders, &light, bmin, bmax, &offsets, shadows,
        )?);
    }
    let pass = GeometryPass {
        camera: &camera,
        width: sample_width,
        height: sample_height,
        light: &light,
        background,
        depth_only: false,
    };
    let highlight_names: HashSet<&str> = opts.highlight.iter().map(|s| s.as_str()).collect();
    let dim = opts.dim.clamp(0.0, 1.0);
    let mut highlighted = vec![false; model.draws.len() + 1];
    let mut draws = Vec::with_capacity(model.draws.len());
    for (i, draw) in model.draws.iter().enumerate() {
        if draw.material >= shaders.len() {
            return Err(format!(
                "draw material {} is missing from the {} materials",
                draw.material,
                shaders.len()
            ));
        }
        highlighted[i + 1] = draw
            .names
            .iter()
            .any(|name| highlight_names.contains(name.as_str()))
            || draw
                .nodes
                .iter()
                .any(|node| opts.highlight_indices.contains(node));
        let dim = if (highlight_names.is_empty() && opts.highlight_indices.is_empty())
            || highlighted[i + 1]
        {
            0.0
        } else {
            dim
        };
        let offset = offsets[i];
        let prepared = PreparedDraw::new(draw, offset, &pass, (i + 1) as u32, dim)?;
        draws.push((prepared, &shaders[draw.material]));
    }
    let track_ids = highlighted.iter().any(|highlighted| *highlighted);
    let mut rgba = vec![0; pixels * 4];
    let mut output_ids = if track_ids {
        vec![0; pixels]
    } else {
        Vec::new()
    };
    let mut target = Framebuffer::new(sample_width as usize, band_rows as usize, track_ids);
    let mut peel = transparent.then(|| PeelBuffer::new(sample_width as usize * band_rows as usize));
    for y in (0..sample_height).step_by(band_rows as usize) {
        target.clear(
            y as usize,
            band_rows.min(sample_height - y) as usize,
            background,
        );
        for (draw, shader) in &draws {
            if shader.material.alpha_mode == AlphaMode::Blend {
                continue;
            }
            let rows = target.y..target.y + target.height;
            draw.triangles(&pass, rows, shader, |triangle| {
                raster_tri(
                    triangle,
                    &mut target,
                    camera.far,
                    shader,
                    &light,
                    background,
                );
            });
        }
        if let Some(peel) = &mut peel {
            peel.clear(target.width * target.height);
            for layer in 0..=opts.transparency.max_layers {
                peel.begin_layer();
                for (draw, shader) in &draws {
                    if shader.material.alpha_mode != AlphaMode::Blend {
                        continue;
                    }
                    draw.triangles(
                        &pass,
                        target.y..target.y + target.height,
                        shader,
                        |triangle| {
                            raster_transparent(
                                triangle, &target, peel, camera.far, shader, &light, background,
                            );
                        },
                    );
                }
                if !peel.has_layer() {
                    break;
                }
                if layer == opts.transparency.max_layers {
                    return Err(format!("transparent depth exceeds transparency.maxLayers ({}); increase the limit up to 128", opts.transparency.max_layers));
                }
                peel.accumulate(&mut target);
            }
            peel.composite(&mut target);
        }
        target.resolve(samples as usize, &mut rgba, &mut output_ids, transform);
    }
    if track_ids {
        paint_outline(&mut rgba, &output_ids, &highlighted, width, height);
    }
    Ok(rgba)
}

fn band_height(width: u32, height: u32, samples: u32) -> u32 {
    if width as u64 * height as u64 <= DIRECT_PIXELS {
        return height;
    }
    let rows = (BAND_PIXELS / width as u64) as u32;
    (rows / samples).max(1) * samples
}

fn fill_background(
    width: u32,
    height: u32,
    background: &[f32; 4],
    transform: OutputTransform,
) -> Vec<u8> {
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    let px = [
        transform.encode(background[0]),
        transform.encode(background[1]),
        transform.encode(background[2]),
        byte_lin(background[3]),
    ];
    for pixel in rgba.as_chunks_mut::<4>().0 {
        pixel.copy_from_slice(&px);
    }
    rgba
}

fn translated_bounds(model: &Model, offsets: &[Vec3]) -> (Vec3, Vec3) {
    if offsets.iter().all(|v| *v == Vec3::ZERO) {
        return (model.bounds_min, model.bounds_max);
    }
    let mut min = Vec3::splat(f32::MAX);
    let mut max = Vec3::splat(f32::MIN);
    for (d, off) in model.draws.iter().zip(offsets) {
        let off = *off;
        min = min.min(d.bounds_min + off);
        max = max.max(d.bounds_max + off);
    }
    (min, max)
}

#[cfg(test)]
mod tests;
