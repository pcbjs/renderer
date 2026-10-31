// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

mod camera;
mod color;
#[cfg(target_arch = "wasm32")]
mod edges;
mod frame;
mod framebuffer;
mod geometry;
mod gltf;
mod lighting;
mod material;
mod math;
mod model;
mod options;
mod punctual;
mod raster;
mod render;
#[cfg(target_arch = "wasm32")]
mod selection;
mod shadow;
mod texture;
mod transparency;

pub use frame::{bounds as query_bounds, describe as prepare_frame, project as project_points};
pub use gltf::{load_glb, load_glb_with_options, LoadOptions};
pub use model::Model;
pub use options::{
    options_from_json, Bounds, Lighting, NodeSelector, Options, ShadowOptions, ToneMapping,
    TransparencyOptions, VisibilityOptions,
};
pub use render::{render, render_output, RenderOutput};

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub struct Image {
        output: RenderOutput,
    }

    #[wasm_bindgen]
    impl Image {
        pub fn take_rgba(&mut self) -> Vec<u8> {
            std::mem::take(&mut self.output.rgba)
        }
        pub fn take_depth(&mut self) -> Vec<f32> {
            std::mem::take(&mut self.output.depth)
        }
        pub fn take_node_ids(&mut self) -> Vec<u32> {
            std::mem::take(&mut self.output.node_ids)
        }
    }

    #[wasm_bindgen]
    pub struct Scene {
        model: Model,
        selection_bytes: usize,
    }

    #[wasm_bindgen]
    impl Scene {
        #[wasm_bindgen(constructor)]
        pub fn new(bytes: &[u8], options_json: Option<String>) -> Result<Scene, JsError> {
            console_error_panic_hook::set_once();
            let options: LoadOptions =
                serde_json::from_str(options_json.as_deref().unwrap_or("{}"))
                    .map_err(|e| JsError::new(&format!("load options are not valid: {e}")))?;
            let model = load_glb_with_options(bytes, &options).map_err(|e| JsError::new(&e))?;
            Ok(Scene {
                model,
                selection_bytes: 0,
            })
        }

        #[wasm_bindgen(getter)]
        pub fn triangles(&self) -> u32 {
            self.model.triangles
        }

        pub fn selection_geometry(&self) -> Scene {
            Scene {
                model: selection::empty(&self.model),
                selection_bytes: 0,
            }
        }

        pub fn add_selection(
            &mut self,
            id: &str,
            node: Option<u32>,
            positions: &[f32],
            indices: Vec<u32>,
        ) -> Result<(), JsError> {
            selection::append(
                &mut self.model,
                id,
                node.map(|n| n as usize),
                positions,
                indices,
                &mut self.selection_bytes,
            )
            .map_err(|e| JsError::new(&e))
        }

        pub fn info(&self) -> String {
            self.model.info().to_string()
        }

        pub fn bounds(&self, options_json: &str, nodes_json: &str) -> Result<String, JsError> {
            let opts = options_from_json(options_json).map_err(|e| JsError::new(&e))?;
            let nodes: Option<Vec<NodeSelector>> =
                serde_json::from_str(nodes_json).map_err(|e| JsError::new(&e.to_string()))?;
            frame::bounds(&self.model, &opts, nodes.as_deref())
                .map(|v| v.to_string())
                .map_err(|e| JsError::new(&e))
        }

        pub fn edges(
            &self,
            options_json: &str,
            angle: f32,
            nodes_json: &str,
        ) -> Result<String, JsError> {
            let opts = options_from_json(options_json).map_err(|e| JsError::new(&e))?;
            let nodes: Option<Vec<NodeSelector>> =
                serde_json::from_str(nodes_json).map_err(|e| JsError::new(&e.to_string()))?;
            edges::segments(&self.model, &opts, angle, nodes.as_deref())
                .map(|v| v.to_string())
                .map_err(|e| JsError::new(&e))
        }

        pub fn prepare(&self, options_json: &str) -> Result<String, JsError> {
            let opts = options_from_json(options_json).map_err(|e| JsError::new(&e))?;
            frame::describe(&self.model, &opts)
                .map(|v| v.to_string())
                .map_err(|e| JsError::new(&e))
        }

        pub fn project(&self, options_json: &str, points_json: &str) -> Result<String, JsError> {
            let opts = options_from_json(options_json).map_err(|e| JsError::new(&e))?;
            let points: Vec<math::Vec3> =
                serde_json::from_str(points_json).map_err(|e| JsError::new(&e.to_string()))?;
            frame::project(&opts, &points)
                .map(|v| v.to_string())
                .map_err(|e| JsError::new(&e))
        }

        pub fn render_style_mask(
            &self,
            options_json: &str,
            index: usize,
        ) -> Result<Image, JsError> {
            let mut opts = options_from_json(options_json).map_err(|e| JsError::new(&e))?;
            if index >= opts.styles.len() {
                return Err(JsError::new("style index out of range"));
            }
            opts.mask_style = Some(index);
            opts.outputs.depth = true;
            opts.outputs.node_ids = false;
            opts.shadows = None;
            render_output(&self.model, &opts)
                .map(|output| Image { output })
                .map_err(|e| JsError::new(&e))
        }

        pub fn render_outputs(&self, options_json: &str) -> Result<Image, JsError> {
            let opts = options_from_json(options_json).map_err(|e| JsError::new(&e))?;
            render_output(&self.model, &opts)
                .map(|output| Image { output })
                .map_err(|e| JsError::new(&e))
        }

        pub fn render(&self, options_json: &str) -> Result<Vec<u8>, JsError> {
            let opts = options_from_json(options_json).map_err(|e| JsError::new(&e))?;
            render(&self.model, &opts).map_err(|e| JsError::new(&e))
        }
    }
}
