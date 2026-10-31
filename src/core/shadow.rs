// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::camera::{axes, fit_ortho_height, Camera, Proj};
use crate::frame::SceneFrame;
use crate::geometry::{GeometryPass, PreparedDraw};
use crate::material::{AlphaMode, Light, Shader};
use crate::math::Vec3;
use crate::model::Model;
use crate::options::ShadowOptions;
use crate::raster::raster_depth;

pub(crate) struct ShadowMap {
    camera: Camera,
    depth: Vec<f32>,
    size: usize,
    texel: f32,
    strength: f32,
}

impl ShadowMap {
    pub fn new(
        model: &Model,
        shaders: &[Shader<'_>],
        light: &Light,
        frame: &SceneFrame,
        options: ShadowOptions,
    ) -> Result<Self, String> {
        let (min, max) = (frame.bounds_min, frame.bounds_max);
        let up = Vec3::new(0.0, 1.0, 0.0);
        let (back, right, top) = axes(light.dir, up);
        let span = fit_ortho_height(min, max, light.dir, up, 1.0, 1.04);
        let radius = (max - min).length().max(1e-6) * 0.5;
        let camera = Camera {
            offset: [0.0; 2],
            eye: (min + max) * 0.5 + back * (radius * 3.0),
            right,
            up: top,
            forward: -back,
            proj: Proj::Ortho {
                half_w: span * 0.5,
                half_h: span * 0.5,
            },
            near: radius,
            far: radius * 5.0,
        };
        let size = options.resolution as usize;
        let mut depth = vec![f32::INFINITY; size * size];
        let pass = GeometryPass {
            camera: &camera,
            width: options.resolution,
            height: options.resolution,
            light,
            background: [0.0; 4],
            depth_only: true,
        };
        for (i, ((draw, offset), visible)) in model
            .draws
            .iter()
            .zip(&frame.offsets)
            .zip(&frame.visible)
            .enumerate()
        {
            if !visible || frame.styles[i].opacity < 1.0 {
                continue;
            }
            let shader = shaders
                .get(draw.material)
                .ok_or_else(|| format!("draw material {} is missing", draw.material))?;
            if shader.material.alpha_mode == AlphaMode::Blend {
                continue;
            }
            let draw = PreparedDraw::new(draw, *offset, &pass, 0, 0.0)?;
            draw.triangles(&pass, 0..size, shader, |triangle| {
                raster_depth(triangle, &mut depth, size, camera.far, shader);
            });
        }
        Ok(Self {
            camera,
            depth,
            size,
            texel: span / size as f32,
            strength: options.strength,
        })
    }

    pub fn visibility(&self, world: Vec3, normal: Vec3) -> f32 {
        let offset = world - self.camera.eye;
        let x = offset.dot(self.camera.right) / self.texel + self.size as f32 * 0.5;
        let y = -offset.dot(self.camera.up) / self.texel + self.size as f32 * 0.5;
        let z = offset.dot(self.camera.forward);
        if x < 0.0 || y < 0.0 || x >= self.size as f32 || y >= self.size as f32 {
            return 1.0;
        }
        // Compare each tap against the receiver plane to keep filtering from shadowing a surface against itself.
        let nf = normal.dot(self.camera.forward);
        let slope = if nf.abs() > 0.05 {
            self.texel / nf
        } else {
            0.0
        };
        let dzdx = -normal.dot(self.camera.right) * slope;
        let dzdy = normal.dot(self.camera.up) * slope;
        let bias = self.texel * 0.15;
        let mut visible = 0.0;
        for dy in -1..=1 {
            for dx in -1..=1 {
                let sx = x.floor() as i32 + dx;
                let sy = y.floor() as i32 + dy;
                if sx < 0 || sy < 0 || sx >= self.size as i32 || sy >= self.size as i32 {
                    visible += 1.0;
                    continue;
                }
                let receiver = z + dzdx * (sx as f32 + 0.5 - x) + dzdy * (sy as f32 + 0.5 - y);
                if receiver - bias <= self.depth[sy as usize * self.size + sx as usize] {
                    visible += 1.0;
                }
            }
        }
        1.0 - self.strength * (1.0 - visible / 9.0)
    }
}
