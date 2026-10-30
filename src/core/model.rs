// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::material::Material;
use crate::math::Vec3;
use crate::texture::Texture;

#[derive(Clone, Debug)]
pub struct Draw {
    pub positions: Vec<[f32; 3]>,
    pub corner_normals: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: [Vec<[f32; 2]>; 2],
    pub corner_tangents: Vec<[f32; 4]>,
    pub colors: Vec<[f32; 4]>,
    pub indices: Vec<u32>,
    pub material: usize,
    pub names: Vec<String>,
    pub nodes: Vec<usize>,
    pub bounds_min: Vec3,
    pub bounds_max: Vec3,
}

#[derive(Clone, Debug)]
pub struct Model {
    pub draws: Vec<Draw>,
    pub materials: Vec<Material>,
    pub textures: Vec<Texture>,
    pub bounds_min: Vec3,
    pub bounds_max: Vec3,
    pub triangles: u32,
    pub nodes: Vec<Node>,
    pub cameras: Vec<AssetCamera>,
    pub lights: Vec<AssetLight>,
    pub diagnostics: Vec<Diagnostic>,
    pub scenes: Vec<SceneInfo>,
    pub scene: Option<usize>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Diagnostic {
    pub code: String,
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct SceneInfo {
    pub index: usize,
    pub name: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Node {
    pub index: usize,
    pub name: Option<String>,
    pub parent: Option<usize>,
    pub extras: serde_json::Value,
    pub camera: Option<usize>,
    pub light: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct AssetCamera {
    pub node: usize,
    pub nodes: Vec<usize>,
    pub camera: crate::camera::Camera,
    pub dynamic_aspect: bool,
}

#[derive(Clone, Debug)]
pub struct AssetLight {
    pub node: usize,
    pub nodes: Vec<usize>,
    pub light: crate::punctual::PunctualLight,
}

impl Model {
    pub fn info(&self) -> serde_json::Value {
        serde_json::json!({ "scenes": self.scenes, "scene": self.scene, "nodes": self.nodes,
            "cameras": self.cameras.iter().map(|c| c.node).collect::<Vec<_>>(),
            "lights": self.lights.iter().map(|l| l.node).collect::<Vec<_>>(), "diagnostics": self.diagnostics })
    }
}
