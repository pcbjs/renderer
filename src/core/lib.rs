// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

mod camera;
mod color;
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
mod shadow;
mod texture;
mod transparency;

pub use gltf::{load_glb, load_glb_with_options, LoadOptions};
pub use model::Model;
pub use options::{
    options_from_json, Lighting, Options, ShadowOptions, ToneMapping, TransparencyOptions,
};
pub use render::render;

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub struct Scene {
        model: Model,
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
            Ok(Scene { model })
        }

        #[wasm_bindgen(getter)]
        pub fn triangles(&self) -> u32 {
            self.model.triangles
        }

        pub fn info(&self) -> String {
            self.model.info().to_string()
        }

        pub fn render(&self, options_json: &str) -> Result<Vec<u8>, JsError> {
            let opts = options_from_json(options_json).map_err(|e| JsError::new(&e))?;
            render(&self.model, &opts).map_err(|e| JsError::new(&e))
        }
    }
}
