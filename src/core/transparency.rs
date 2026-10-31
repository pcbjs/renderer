// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::framebuffer::Framebuffer;

pub(crate) const BAND_PIXELS: u64 = 244_667;

pub(crate) struct PeelBuffer {
    nearest_depth: Vec<f32>,
    previous_depth: Vec<f32>,
    previous_order: Vec<u64>,
    depth: Vec<f32>,
    order: Vec<u64>,
    color: Vec<[f32; 4]>,
    accumulated: Vec<[f32; 4]>,
    active: usize,
}

impl PeelBuffer {
    pub fn new(pixels: usize) -> Self {
        Self {
            nearest_depth: vec![f32::INFINITY; pixels],
            previous_depth: vec![f32::NEG_INFINITY; pixels],
            previous_order: vec![0; pixels],
            depth: vec![f32::INFINITY; pixels],
            order: vec![u64::MAX; pixels],
            color: vec![[0.0; 4]; pixels],
            accumulated: vec![[0.0; 4]; pixels],
            active: pixels,
        }
    }

    pub fn clear(&mut self, pixels: usize) {
        self.active = pixels;
        self.nearest_depth[..pixels].fill(f32::INFINITY);
        self.previous_depth[..pixels].fill(f32::NEG_INFINITY);
        self.previous_order[..pixels].fill(0);
        self.accumulated[..pixels].fill([0.0; 4]);
    }

    pub fn begin_layer(&mut self) {
        self.depth[..self.active].fill(f32::INFINITY);
        self.order[..self.active].fill(u64::MAX);
    }

    pub fn accepts(&self, index: usize, depth: f32, order: u64, opaque_depth: f32) -> bool {
        self.accumulated[index][3] < 1.0
            && depth < opaque_depth
            && (depth > self.previous_depth[index]
                || (depth == self.previous_depth[index] && order > self.previous_order[index]))
            && (depth < self.depth[index]
                || (depth == self.depth[index] && order < self.order[index]))
    }

    pub fn write(&mut self, index: usize, depth: f32, order: u64, color: [f32; 4]) {
        self.depth[index] = depth;
        self.order[index] = order;
        self.color[index] = color;
    }

    pub fn has_layer(&self) -> bool {
        self.depth[..self.active]
            .iter()
            .any(|depth| depth.is_finite())
    }

    pub fn accumulate(&mut self, target: &mut Framebuffer) {
        for i in 0..self.active {
            self.previous_depth[i] = self.depth[i];
            self.previous_order[i] = self.order[i];
            if !self.depth[i].is_finite() {
                continue;
            }
            let color = self.color[i];
            let accumulated = &mut self.accumulated[i];
            if accumulated[3] == 0.0 {
                self.nearest_depth[i] = self.depth[i];
                if !target.ids.is_empty() {
                    target.ids[i] = (self.order[i] >> 32) as u32;
                }
            }
            let contribution = (1.0 - accumulated[3]) * color[3];
            for channel in 0..3 {
                accumulated[channel] += color[channel] * contribution;
            }
            accumulated[3] += contribution;
        }
    }

    pub fn composite(&self, target: &mut Framebuffer) {
        for i in 0..self.active {
            let front = self.accumulated[i];
            if front[3] == 0.0 {
                continue;
            }
            target.depth[i] = self.nearest_depth[i];
            let back = target.color[i];
            let remaining = (1.0 - front[3]) * back[3];
            let alpha = front[3] + remaining;
            target.color[i] = [
                (front[0] + back[0] * remaining) / alpha,
                (front[1] + back[1] * remaining) / alpha,
                (front[2] + back[2] * remaining) / alpha,
                alpha,
            ];
        }
    }
}
