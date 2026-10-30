// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use serde::Deserialize;

use crate::camera::CamSpec;
use crate::math::Vec3;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lighting {
    #[default]
    Classic,
    Studio,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct ShadowOptions {
    pub resolution: u32,
    pub strength: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToneMapping {
    #[default]
    None,
    Reinhard,
    Aces,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TransparencyOptions {
    pub max_layers: u32,
}

impl Default for TransparencyOptions {
    fn default() -> Self {
        Self { max_layers: 32 }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct NodeTranslation {
    pub node: usize,
    pub translation: Vec3,
}

/// `background` is sRGB for rgb and linear for alpha, each 0 to 1.
/// `dim` is how far nodes that are not named move toward the background: 0 leaves them, 1 is the background.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub width: u32,
    pub height: u32,
    pub supersample: u32,
    pub background: [f32; 4],
    pub light_dir: [f32; 3],
    pub ambient: f32,
    pub hemisphere: f32,
    #[serde(default)]
    pub node_translations: Vec<NodeTranslation>,
    #[serde(default)]
    pub highlight_indices: Vec<usize>,
    #[serde(default)]
    pub lights: Option<Vec<crate::punctual::PunctualLight>>,
    #[serde(default = "yes")]
    pub use_asset_lights: bool,
    #[serde(default)]
    pub near: Option<f32>,
    #[serde(default)]
    pub far: Option<f32>,
    pub highlight: Vec<String>,
    pub dim: f32,
    #[serde(default)]
    pub detail: bool,
    #[serde(default)]
    pub lighting: Lighting,
    #[serde(default)]
    pub shadows: Option<ShadowOptions>,
    #[serde(default)]
    pub exposure: f32,
    #[serde(default)]
    pub tone_mapping: ToneMapping,
    #[serde(default)]
    pub transparency: TransparencyOptions,
    pub camera: CamSpec,
}

impl Options {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            supersample: 1,
            background: [0.0, 0.0, 0.0, 0.0],
            light_dir: [-30.0, 100.0, 60.0],
            ambient: 0.25,
            hemisphere: 0.0,
            node_translations: Vec::new(),
            highlight_indices: Vec::new(),
            lights: None,
            use_asset_lights: true,
            near: None,
            far: None,
            highlight: Vec::new(),
            dim: 0.25,
            detail: false,
            lighting: Lighting::Classic,
            shadows: None,
            exposure: 0.0,
            tone_mapping: ToneMapping::None,
            transparency: TransparencyOptions::default(),
            camera: CamSpec::Fit {
                ortho: false,
                direction: Vec3::new(1.0, 1.0, 1.0),
                up: Vec3::new(0.0, 1.0, 0.0),
                margin: 1.08,
                fov_deg: 35.0,
            },
        }
    }
}

pub fn options_from_json(text: &str) -> Result<Options, String> {
    let opts = serde_json::from_str(text)
        .map_err(|error| format!("render options are not valid: {error}"))?;
    validate(&opts)?;
    Ok(opts)
}

pub(crate) fn validate(opts: &Options) -> Result<(), String> {
    if opts.width == 0 || opts.height == 0 || opts.width > 4096 || opts.height > 4096 {
        return Err(format!(
            "image is {} by {} before supersampling; the limit is 4096 by 4096",
            opts.width, opts.height
        ));
    }
    if opts.supersample == 0 || opts.supersample > 8 {
        return Err(format!(
            "supersample {} is outside 1 to 8",
            opts.supersample
        ));
    }
    let sw = opts.width as u64 * opts.supersample as u64;
    let sh = opts.height as u64 * opts.supersample as u64;
    if sw > 8192 || sh > 8192 {
        return Err(format!(
            "supersampled image is {sw} by {sh}; the limit is 8192 along an edge"
        ));
    }
    if !opts.light_dir.iter().all(|c| c.is_finite())
        || Vec3::from(opts.light_dir).length_squared() < 1e-16
    {
        return Err("light direction must be a non-zero finite vector".into());
    }
    if !opts.ambient.is_finite() || !opts.hemisphere.is_finite() || !opts.dim.is_finite() {
        return Err("light and dim must be finite numbers".into());
    }
    if !opts.background.iter().all(|c| c.is_finite()) {
        return Err("background must be four finite numbers".into());
    }
    if let Some(shadows) = opts.shadows {
        if !(256..=2048).contains(&shadows.resolution) {
            return Err("shadows.resolution must be between 256 and 2048".into());
        }
        if !shadows.strength.is_finite() || !(0.0..=1.0).contains(&shadows.strength) {
            return Err("shadows.strength must be between 0 and 1".into());
        }
    }
    if !opts.exposure.is_finite() || !(-20.0..=20.0).contains(&opts.exposure) {
        return Err("exposure must be between -20 and 20 stops".into());
    }
    if !(1..=128).contains(&opts.transparency.max_layers) {
        return Err("transparency.maxLayers must be between 1 and 128".into());
    }
    if opts
        .node_translations
        .iter()
        .any(|t| !t.translation.is_finite())
    {
        return Err("node translations must be finite".into());
    }
    if let Some(lights) = &opts.lights {
        for light in lights {
            light.validate()?;
        }
    }
    if opts.near.is_some_and(|n| !n.is_finite() || n < 0.0)
        || opts
            .far
            .is_some_and(|n| !n.is_finite() || n <= opts.near.unwrap_or(0.0))
    {
        return Err("camera clipping planes must be finite with 0 <= near < far".into());
    }
    if let CamSpec::Fit {
        direction,
        up,
        margin,
        ..
    } = opts.camera
    {
        if !direction.is_finite()
            || direction.length_squared() < 1e-16
            || !up.is_finite()
            || up.length_squared() < 1e-16
            || !margin.is_finite()
            || margin < 1.0
        {
            return Err("camera fit needs non-zero finite direction/up and margin >= 1".into());
        }
    }
    match opts.camera {
        CamSpec::Fit { fov_deg, .. } | CamSpec::Perspective { fov_deg, .. } => {
            if !(1.0..179.0).contains(&fov_deg) {
                return Err(format!("fov {fov_deg} degrees is outside 1 to 179"));
            }
        }
        CamSpec::Asset { .. } => {}
        CamSpec::Ortho { height, .. } => {
            if !(height.is_finite() && height > 0.0) {
                return Err("orthographic height must be a positive finite number".into());
            }
        }
    }
    if let CamSpec::Perspective {
        position,
        target,
        up,
        ..
    }
    | CamSpec::Ortho {
        position,
        target,
        up,
        ..
    } = opts.camera
    {
        if !position.is_finite() || !target.is_finite() || !up.is_finite() {
            return Err("camera vectors must be finite".into());
        }
        if (position - target).length_squared() < 1e-16 {
            return Err("camera position and target are the same point".into());
        }
        if up.length_squared() < 1e-16 {
            return Err("camera up must be a non-zero vector".into());
        }
    }
    Ok(())
}

fn yes() -> bool {
    true
}
