// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

pub fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

pub fn linear_to_srgb(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

pub(crate) fn byte_srgb(c: f32) -> u8 {
    (linear_to_srgb(c) * 255.0).round().clamp(0.0, 255.0) as u8
}

pub(crate) fn byte_lin(c: f32) -> u8 {
    (c.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[derive(Clone, Copy)]
pub(crate) struct OutputTransform {
    exposure: f32,
    tone_mapping: crate::options::ToneMapping,
}

impl OutputTransform {
    pub fn new(exposure: f32, tone_mapping: crate::options::ToneMapping) -> Self {
        Self {
            exposure: exposure.exp2(),
            tone_mapping,
        }
    }

    pub fn encode(self, linear: f32) -> u8 {
        use crate::options::ToneMapping;
        let value = linear * self.exposure;
        let mapped = match self.tone_mapping {
            ToneMapping::None => value,
            ToneMapping::Reinhard => {
                let value = value.max(0.0);
                if value > 1.0 {
                    1.0 - 1.0 / (1.0 + value)
                } else {
                    value / (1.0 + value)
                }
            }
            ToneMapping::Aces => {
                let value = value.clamp(0.0, 1e10);
                (value * (2.51 * value + 0.03)) / (value * (2.43 * value + 0.59) + 0.14)
            }
        };
        byte_srgb(mapped)
    }
}

impl Default for OutputTransform {
    fn default() -> Self {
        Self::new(0.0, crate::options::ToneMapping::None)
    }
}

#[cfg(test)]
mod output_tests {
    use super::*;
    use crate::options::ToneMapping;

    #[test]
    fn exposure_and_tone_mapping_are_finite_monotonic_and_neutral_by_default() {
        for mapping in [ToneMapping::None, ToneMapping::Reinhard, ToneMapping::Aces] {
            let transform = OutputTransform::new(0.0, mapping);
            let values: Vec<_> = [0.0, 0.01, 0.18, 1.0, 2.0, 10.0, f32::MAX, f32::INFINITY]
                .map(|v| transform.encode(v))
                .into();
            assert!(values.windows(2).all(|pair| pair[0] <= pair[1]));
            assert_eq!(*values.last().unwrap(), 255);
        }
        assert_eq!(
            OutputTransform::new(1.0, ToneMapping::None).encode(0.25),
            byte_srgb(0.5)
        );
        assert_eq!(
            OutputTransform::new(-1.0, ToneMapping::None).encode(0.5),
            byte_srgb(0.25)
        );
        assert_eq!(
            OutputTransform::new(0.0, ToneMapping::Reinhard).encode(1.0),
            byte_srgb(0.5)
        );
        assert_eq!(
            OutputTransform::new(0.0, ToneMapping::Aces).encode(1.0),
            232
        );
        for value in [0.0, 0.1, 0.5, 1.0, 2.0] {
            assert_eq!(OutputTransform::default().encode(value), byte_srgb(value));
        }
    }
}
