// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use std::sync::Arc;

use crate::color::srgb_to_linear;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wrap {
    Repeat,
    Clamp,
    Mirror,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    Nearest,
    Linear,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mipmap {
    None,
    Nearest,
    Linear,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColorSpace {
    Srgb,
    Data,
}

#[derive(Debug)]
pub struct ImageLevel {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<[f32; 4]>,
}

#[derive(Debug)]
pub struct Pyramid {
    pub levels: Vec<ImageLevel>,
}

impl Pyramid {
    pub fn new(width: u32, height: u32, pixels: Vec<[f32; 4]>, mipmaps: bool) -> Self {
        let mut levels = vec![ImageLevel {
            width,
            height,
            pixels,
        }];
        while mipmaps
            && levels
                .last()
                .is_some_and(|level| level.width > 1 || level.height > 1)
        {
            let source = levels.last().unwrap();
            let width = (source.width / 2).max(1);
            let height = (source.height / 2).max(1);
            let sx = source.width as f32 / width as f32;
            let sy = source.height as f32 / height as f32;
            let mut pixels = Vec::with_capacity((width * height) as usize);
            for y in 0..height {
                for x in 0..width {
                    let (x0, x1) = (x as f32 * sx, (x + 1) as f32 * sx);
                    let (y0, y1) = (y as f32 * sy, (y + 1) as f32 * sy);
                    let mut pixel = [0.0; 4];
                    for iy in y0.floor() as u32..(y1.ceil() as u32).min(source.height) {
                        for ix in x0.floor() as u32..(x1.ceil() as u32).min(source.width) {
                            let weight = ((ix + 1) as f32).min(x1) - (ix as f32).max(x0);
                            let weight = weight * (((iy + 1) as f32).min(y1) - (iy as f32).max(y0))
                                / (sx * sy);
                            let texel = source.pixels[(iy * source.width + ix) as usize];
                            for i in 0..4 {
                                pixel[i] += texel[i] * weight;
                            }
                        }
                    }
                    pixels.push(pixel);
                }
            }
            levels.push(ImageLevel {
                width,
                height,
                pixels,
            });
        }
        Self { levels }
    }
}

#[derive(Debug)]
pub struct Image {
    pub color: Option<Pyramid>,
    pub data: Option<Pyramid>,
}

impl Image {
    pub fn decode(
        width: u32,
        height: u32,
        rgba: &[u8],
        color: Option<bool>,
        data: Option<bool>,
    ) -> Self {
        let decode = |srgb, mipmaps| {
            let pixels = rgba
                .as_chunks::<4>()
                .0
                .iter()
                .map(|p| {
                    std::array::from_fn(|i| {
                        let value = p[i] as f32 / 255.0;
                        if srgb && i < 3 {
                            srgb_to_linear(value)
                        } else {
                            value
                        }
                    })
                })
                .collect();
            Pyramid::new(width, height, pixels, mipmaps)
        };
        Self {
            color: color.map(|mips| decode(true, mips)),
            data: data.map(|mips| decode(false, mips)),
        }
    }

    pub fn view(&self, space: ColorSpace) -> Option<&Pyramid> {
        match space {
            ColorSpace::Srgb => self.color.as_ref(),
            ColorSpace::Data => self.data.as_ref(),
        }
    }

    #[cfg(test)]
    pub fn linear(width: u32, height: u32, pixels: Vec<[f32; 4]>) -> Self {
        Self {
            color: Some(Pyramid::new(width, height, pixels, false)),
            data: None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Sampler {
    pub wrap_s: Wrap,
    pub wrap_t: Wrap,
    pub mag: Filter,
    pub min: Filter,
    pub mipmap: Mipmap,
}

impl Default for Sampler {
    fn default() -> Self {
        Self {
            wrap_s: Wrap::Repeat,
            wrap_t: Wrap::Repeat,
            mag: Filter::Linear,
            min: Filter::Linear,
            mipmap: Mipmap::None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Texture {
    pub image: Arc<Image>,
    pub sampler: Sampler,
}

#[derive(Clone, Copy, Debug)]
pub struct TextureInfo {
    pub index: usize,
    pub tex_coord: usize,
    pub transform: [[f32; 3]; 2],
}

impl From<usize> for TextureInfo {
    fn from(index: usize) -> Self {
        Self {
            index,
            tex_coord: 0,
            transform: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        }
    }
}

impl TextureInfo {
    pub fn uv(self, uv: [f32; 2]) -> [f32; 2] {
        let gradient = self.gradient(uv);
        [
            gradient[0] + self.transform[0][2],
            gradient[1] + self.transform[1][2],
        ]
    }

    pub fn gradient(self, uv: [f32; 2]) -> [f32; 2] {
        std::array::from_fn(|i| self.transform[i][0] * uv[0] + self.transform[i][1] * uv[1])
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Footprint {
    pub dx: [[f32; 2]; 2],
    pub dy: [[f32; 2]; 2],
}

pub(crate) struct BoundTexture<'a> {
    pub info: TextureInfo,
    image: &'a Pyramid,
    sampler: Sampler,
    identity: bool,
}

impl<'a> BoundTexture<'a> {
    pub fn new(
        info: Option<TextureInfo>,
        textures: &'a [Texture],
        space: ColorSpace,
    ) -> Option<Self> {
        let info = info?;
        let texture = textures.get(info.index)?;
        Some(Self {
            info,
            image: texture.image.view(space)?,
            sampler: texture.sampler,
            identity: info.transform == [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        })
    }

    pub fn needs_gradients(&self) -> bool {
        self.sampler.mipmap != Mipmap::None || self.sampler.mag != self.sampler.min
    }

    pub fn sample(&self, uvs: [[f32; 2]; 2], footprint: &Footprint) -> [f32; 4] {
        let uv = uvs[self.info.tex_coord];
        let uv = if self.identity { uv } else { self.info.uv(uv) };
        let lod = if self.needs_gradients() {
            let base = &self.image.levels[0];
            let dx = self.info.gradient(footprint.dx[self.info.tex_coord]);
            let dy = self.info.gradient(footprint.dy[self.info.tex_coord]);
            let length = |d: [f32; 2]| {
                (d[0] * base.width as f32).powi(2) + (d[1] * base.height as f32).powi(2)
            };
            0.5 * length(dx).max(length(dy)).max(1e-20).log2()
        } else {
            0.0
        };
        sample_lod(self.image, self.sampler, uv, lod)
    }
}

#[cfg(test)]
pub(crate) fn sample(tex: &Texture, uv: [f32; 2]) -> [f32; 4] {
    sample_lod(tex.image.color.as_ref().unwrap(), tex.sampler, uv, 0.0)
}

fn sample_lod(image: &Pyramid, sampler: Sampler, uv: [f32; 2], lod: f32) -> [f32; 4] {
    if lod <= 0.0 {
        return sample_level(&image.levels[0], sampler, uv, sampler.mag);
    }
    let lod = lod.clamp(0.0, (image.levels.len() - 1) as f32);
    match sampler.mipmap {
        Mipmap::None => sample_level(&image.levels[0], sampler, uv, sampler.min),
        Mipmap::Nearest => sample_level(
            &image.levels[lod.round() as usize],
            sampler,
            uv,
            sampler.min,
        ),
        Mipmap::Linear => {
            let lower = lod.floor() as usize;
            let upper = (lower + 1).min(image.levels.len() - 1);
            lerp4(
                sample_level(&image.levels[lower], sampler, uv, sampler.min),
                sample_level(&image.levels[upper], sampler, uv, sampler.min),
                lod - lower as f32,
            )
        }
    }
}

fn sample_level(image: &ImageLevel, sampler: Sampler, uv: [f32; 2], filter: Filter) -> [f32; 4] {
    let u = wrap_uv(uv[0], sampler.wrap_s);
    let v = wrap_uv(uv[1], sampler.wrap_t);
    let texel = |x, y| {
        let x = index_wrap(x, image.width as i32, sampler.wrap_s);
        let y = index_wrap(y, image.height as i32, sampler.wrap_t);
        image.pixels[y * image.width as usize + x]
    };
    if filter == Filter::Nearest {
        return texel(
            (u * image.width as f32).floor() as i32,
            (v * image.height as f32).floor() as i32,
        );
    }
    let x = u * image.width as f32 - 0.5;
    let y = v * image.height as f32 - 0.5;
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let tx = (x - x0 as f32).clamp(0.0, 1.0);
    let ty = (y - y0 as f32).clamp(0.0, 1.0);
    lerp4(
        lerp4(texel(x0, y0), texel(x0 + 1, y0), tx),
        lerp4(texel(x0, y0 + 1), texel(x0 + 1, y0 + 1), tx),
        ty,
    )
}

fn wrap_uv(u: f32, mode: Wrap) -> f32 {
    if !u.is_finite() {
        return 0.0;
    }
    match mode {
        Wrap::Clamp => u.clamp(0.0, 1.0),
        Wrap::Repeat => u - u.floor(),
        Wrap::Mirror => {
            let x = u.abs();
            let i = x.floor();
            let f = x - i;
            if (i as i64) & 1 == 1 {
                1.0 - f
            } else {
                f
            }
        }
    }
}

fn index_wrap(i: i32, n: i32, mode: Wrap) -> usize {
    if n <= 0 {
        return 0;
    }
    match mode {
        Wrap::Clamp => i.clamp(0, n - 1) as usize,
        Wrap::Repeat => {
            let m = i.rem_euclid(n);
            m as usize
        }
        Wrap::Mirror => {
            let period = n.saturating_mul(2).max(1);
            let m = i.rem_euclid(period);
            (if m < n { m } else { period - 1 - m }) as usize
        }
    }
}

fn lerp4(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_and_data_views_filter_in_their_own_space() {
        let image = Image::decode(
            2,
            1,
            &[0, 128, 255, 0, 255, 128, 0, 255],
            Some(true),
            Some(true),
        );
        let color = image.color.unwrap();
        let data = image.data.unwrap();
        assert!((color.levels[0].pixels[0][1] - 0.21586).abs() < 1e-5);
        assert!((data.levels[0].pixels[0][1] - 128.0 / 255.0).abs() < 1e-6);
        assert_eq!(color.levels[1].pixels[0][0], 0.5);
        assert_eq!(data.levels[1].pixels[0][0], 0.5);
        assert_eq!(color.levels[1].pixels[0][3], 0.5);
    }

    #[test]
    fn odd_sized_mipmaps_preserve_the_full_image_average() {
        let pixels: Vec<_> = (0..15).map(|i| [i as f32 / 14.0; 4]).collect();
        let pyramid = Pyramid::new(5, 3, pixels, true);
        assert_eq!(
            pyramid
                .levels
                .iter()
                .map(|l| (l.width, l.height))
                .collect::<Vec<_>>(),
            [(5, 3), (2, 1), (1, 1)]
        );
        assert!((pyramid.levels[2].pixels[0][0] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn sampler_filters_select_and_interpolate_levels_and_texels() {
        let pyramid = Pyramid::new(4, 1, vec![[0.0; 4], [1.0; 4], [0.0; 4], [1.0; 4]], true);
        for filter in [Filter::Nearest, Filter::Linear] {
            let sampler = Sampler {
                mag: filter,
                min: filter,
                ..Sampler::default()
            };
            let expected = if filter == Filter::Nearest { 0.0 } else { 0.3 };
            assert!((sample_lod(&pyramid, sampler, [0.2, 0.5], 0.0)[0] - expected).abs() < 1e-6);
            assert!((sample_lod(&pyramid, sampler, [0.2, 0.5], 2.0)[0] - expected).abs() < 1e-6);
            for mipmap in [Mipmap::Nearest, Mipmap::Linear] {
                let sampler = Sampler { mipmap, ..sampler };
                assert_eq!(sample_lod(&pyramid, sampler, [0.125, 0.5], 1.0)[0], 0.5);
                let expected = if mipmap == Mipmap::Nearest {
                    0.0
                } else {
                    0.125
                };
                assert!(
                    (sample_lod(&pyramid, sampler, [0.125, 0.5], 0.25)[0] - expected).abs() < 1e-6
                );
            }
        }
        let sampler = Sampler {
            mag: Filter::Nearest,
            min: Filter::Linear,
            ..Sampler::default()
        };
        assert_eq!(sample_lod(&pyramid, sampler, [0.2, 0.5], -1.0)[0], 0.0);
        assert!((sample_lod(&pyramid, sampler, [0.2, 0.5], 1.0)[0] - 0.3).abs() < 1e-6);
    }

    #[test]
    fn wrapping_handles_signed_boundaries_in_both_axes() {
        let image = ImageLevel {
            width: 2,
            height: 2,
            pixels: vec![
                [0.0, 0.0, 0.0, 1.0],
                [1.0, 0.0, 0.0, 1.0],
                [0.0, 1.0, 0.0, 1.0],
                [1.0, 1.0, 0.0, 1.0],
            ],
        };
        let coordinates = [-1.25, -0.25, 0.0, 0.25, 0.75, 1.0, 1.25, 1.75, 2.25];
        for (wrap, nearest, linear) in [
            (
                Wrap::Repeat,
                [1.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0],
                [0.5; 4],
            ),
            (
                Wrap::Clamp,
                [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0],
                [0.0, 0.0, 1.0, 1.0],
            ),
            (
                Wrap::Mirror,
                [1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0],
                [1.0, 0.0, 1.0, 0.0],
            ),
        ] {
            let sampler = Sampler {
                wrap_s: wrap,
                wrap_t: wrap,
                ..Sampler::default()
            };
            for (uv, expected) in coordinates.into_iter().zip(nearest) {
                let pixel = sample_level(&image, sampler, [uv; 2], Filter::Nearest);
                assert_eq!(&pixel[..2], &[expected; 2], "{wrap:?} at {uv}");
            }
            for (uv, expected) in [-1.0, 0.0, 1.0, 2.0].into_iter().zip(linear) {
                let pixel = sample_level(&image, sampler, [uv; 2], Filter::Linear);
                assert_eq!(&pixel[..2], &[expected; 2], "{wrap:?} at {uv}");
            }
        }
    }

    #[test]
    fn transforms_affect_the_selected_uv_and_its_footprint() {
        let image = Image::decode(
            4,
            1,
            &[
                0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
            ],
            Some(true),
            None,
        );
        let textures = [Texture {
            image: Arc::new(image),
            sampler: Sampler {
                mipmap: Mipmap::Linear,
                ..Sampler::default()
            },
        }];
        let info = TextureInfo {
            index: 0,
            tex_coord: 1,
            transform: [[8.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        };
        let texture = BoundTexture::new(Some(info), &textures, ColorSpace::Srgb).unwrap();
        let footprint = Footprint {
            dx: [[0.0; 2], [0.125, 0.0]],
            ..Footprint::default()
        };
        assert_eq!(
            texture.sample([[0.0; 2], [0.015625, 0.5]], &footprint)[0],
            0.5
        );
    }
}
