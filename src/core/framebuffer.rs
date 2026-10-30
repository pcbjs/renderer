// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::color::{byte_lin, OutputTransform};

pub(crate) const OUTLINE: [u8; 4] = [255, 204, 51, 255];

pub(crate) struct Framebuffer {
    pub width: usize,
    pub height: usize,
    pub y: usize,
    pub color: Vec<[f32; 4]>,
    pub depth: Vec<f32>,
    pub ids: Vec<u32>,
}

impl Framebuffer {
    pub fn new(width: usize, height: usize, track_ids: bool) -> Self {
        let pixels = width * height;
        Self {
            width,
            height,
            y: 0,
            color: vec![[0.0; 4]; pixels],
            depth: vec![f32::INFINITY; pixels],
            ids: if track_ids {
                vec![0; pixels]
            } else {
                Vec::new()
            },
        }
    }

    pub fn clear(&mut self, y: usize, height: usize, background: [f32; 4]) {
        self.y = y;
        self.height = height;
        let pixels = self.width * height;
        self.color[..pixels].fill(background);
        self.depth[..pixels].fill(f32::INFINITY);
        if !self.ids.is_empty() {
            self.ids[..pixels].fill(0);
        }
    }

    pub fn resolve(
        &self,
        samples: usize,
        rgba: &mut [u8],
        ids: &mut [u32],
        transform: OutputTransform,
    ) {
        let width = self.width / samples;
        let scale = 1.0 / (samples * samples) as f32;
        let mut previous = [f32::NAN; 4];
        let mut encoded = [0; 4];
        for y in 0..self.height / samples {
            for x in 0..width {
                let mut sum = [0.0; 4];
                for sy in 0..samples {
                    let row = (y * samples + sy) * self.width + x * samples;
                    for color in &self.color[row..row + samples] {
                        for channel in 0..3 {
                            sum[channel] += color[channel] * color[3];
                        }
                        sum[3] += color[3];
                    }
                }
                let output = (self.y / samples + y) * width + x;
                if sum != previous {
                    let rgb_scale = if sum[3] > 0.0 { 1.0 / sum[3] } else { 0.0 };
                    encoded = [
                        transform.encode(sum[0] * rgb_scale),
                        transform.encode(sum[1] * rgb_scale),
                        transform.encode(sum[2] * rgb_scale),
                        byte_lin(sum[3] * scale),
                    ];
                    previous = sum;
                }
                rgba[output * 4..output * 4 + 4].copy_from_slice(&encoded);
                if !ids.is_empty() {
                    let center =
                        (y * samples + samples / 2) * self.width + x * samples + samples / 2;
                    ids[output] = self.ids[center];
                }
            }
        }
    }
}

pub(crate) fn paint_outline(rgba: &mut [u8], ids: &[u32], hi: &[bool], w: u32, h: u32) {
    let mut mark = vec![false; ids.len()];
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) as usize;
            let id = ids[i];
            if id == 0 || hi.get(id as usize).copied() != Some(true) {
                continue;
            }
            let left = if x == 0 { 0 } else { ids[i - 1] };
            let right = if x + 1 == w { 0 } else { ids[i + 1] };
            let up = if y == 0 { 0 } else { ids[i - w as usize] };
            let down = if y + 1 == h { 0 } else { ids[i + w as usize] };
            if left != id || right != id || up != id || down != id {
                mark[i] = true;
            }
        }
    }
    for (i, on) in mark.iter().enumerate() {
        if *on {
            rgba[i * 4..i * 4 + 4].copy_from_slice(&OUTLINE);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tone_mapping_runs_after_linear_resolve_and_preserves_alpha() {
        let mut target = Framebuffer::new(2, 2, false);
        target.clear(0, 2, [0.0, 0.0, 0.0, 1.0]);
        target.color[0] = [4.0, 0.0, 0.0, 1.0];
        let mut rgba = [0; 4];
        let transform = OutputTransform::new(0.0, crate::options::ToneMapping::Reinhard);
        target.resolve(2, &mut rgba, &mut [], transform);
        assert_eq!(rgba, [188, 0, 0, 255]);
        target.clear(0, 2, [0.0; 4]);
        target.color[0] = [4.0, 0.0, 0.0, 0.5];
        target.resolve(2, &mut rgba, &mut [], transform);
        assert_eq!(rgba, [231, 0, 0, 32]);
    }

    #[test]
    fn resolve_returns_straight_alpha_and_ignores_invisible_rgb() {
        let mut target = Framebuffer::new(2, 2, false);
        target.clear(0, 2, [1.0, 0.0, 0.0, 0.0]);
        target.color[0] = [1.0; 4];
        let mut rgba = [0; 4];
        target.resolve(2, &mut rgba, &mut [], OutputTransform::default());
        assert_eq!(rgba, [255, 255, 255, 64]);
        target.clear(0, 2, [0.0, 1.0, 0.0, 0.0]);
        target.resolve(2, &mut rgba, &mut [], OutputTransform::default());
        assert_eq!(rgba, [0; 4]);
    }
}
