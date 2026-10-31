// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use super::*;
use crate::camera::CamSpec;
use crate::color::byte_srgb;
use crate::framebuffer::OUTLINE;
use crate::material::{AlphaMode, Material};
use crate::model::Draw;
use crate::texture::{sample, Image, Sampler, Texture, Wrap};
use std::sync::Arc;

fn draw_quad(z: f32, scale: f32, name: &str) -> Draw {
    Draw {
        corner_normals: Vec::new(),
        positions: vec![
            [-scale, -scale, z],
            [scale, -scale, z],
            [scale, scale, z],
            [-scale, scale, z],
        ],
        normals: vec![[0.0, 0.0, 1.0]; 4],
        uvs: [
            vec![[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            Vec::new(),
        ],
        corner_tangents: Vec::new(),
        colors: Vec::new(),
        indices: vec![0, 1, 2, 0, 2, 3],
        material: 0,
        names: vec![name.into()],
        nodes: vec![],
        bounds_min: Vec3::new(-scale, -scale, z),
        bounds_max: Vec3::new(scale, scale, z),
    }
}

fn model(mut draws: Vec<Draw>, materials: Vec<Material>, textures: Vec<Texture>) -> Model {
    for (i, draw) in draws.iter_mut().enumerate() {
        draw.nodes = vec![i];
    }
    let nodes = draws
        .iter()
        .enumerate()
        .map(|(index, d)| crate::model::Node {
            index,
            name: d.names.first().cloned(),
            parent: None,
            extras: serde_json::Value::Null,
            camera: None,
            light: None,
        })
        .collect();
    let triangles = draws.iter().map(|d| (d.indices.len() / 3) as u32).sum();
    let mut min = Vec3::splat(f32::MAX);
    let mut max = Vec3::splat(f32::MIN);
    for d in &draws {
        min = min.min(d.bounds_min);
        max = max.max(d.bounds_max);
    }
    Model {
        draws,
        materials,
        textures,
        bounds_min: min,
        bounds_max: max,
        triangles,
        nodes,
        cameras: vec![],
        lights: vec![],
        diagnostics: vec![],
        scenes: vec![],
        scene: None,
    }
}

fn mat(color: [f32; 4], roughness: f32, double_sided: bool, mode: AlphaMode) -> Material {
    Material {
        base: color,
        metallic: 0.0,
        roughness,
        texture: None,
        emissive: [0.0; 3],
        emissive_texture: None,
        alpha_mode: mode,
        cutoff: 0.5,
        double_sided,
        ..Material::default()
    }
}

fn ortho_opts(n: u32) -> Options {
    Options {
        outputs: crate::options::OutputOptions::default(),
        styles: vec![],
        mask_style: None,
        width: n,
        height: n,
        supersample: 1,
        background: [0.0, 0.0, 0.0, 0.0],
        light_dir: [0.0, 0.0, 1.0],
        ambient: 0.0,
        hemisphere: 0.0,
        node_translations: Vec::new(),
        visibility: crate::options::VisibilityOptions::default(),
        fit_nodes: None,
        fit_bounds: None,
        padding: [0.0; 4],
        highlight_indices: Vec::new(),
        lights: None,
        use_asset_lights: true,
        near: None,
        far: None,
        highlight: Vec::new(),
        dim: 0.25,
        detail: false,
        lighting: crate::options::Lighting::Classic,
        shadows: None,
        exposure: 0.0,
        tone_mapping: crate::options::ToneMapping::None,
        transparency: crate::options::TransparencyOptions::default(),
        camera: CamSpec::Ortho {
            position: Vec3::new(0.0, 0.0, 5.0),
            target: Vec3::ZERO,
            up: Vec3::new(0.0, 1.0, 0.0),
            height: 2.0,
        },
    }
}

fn px(img: &[u8], n: u32, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * n + x) * 4) as usize;
    [img[i], img[i + 1], img[i + 2], img[i + 3]]
}

#[test]
fn auto_iso_frames_the_quad_with_a_margin() {
    let m = model(
        vec![draw_quad(0.0, 1.0, "board")],
        vec![mat([1.0, 0.0, 0.0, 1.0], 1.0, false, AlphaMode::Opaque)],
        vec![],
    );
    let mut opts = ortho_opts(32);
    opts.camera = CamSpec::Fit {
        ortho: false,
        direction: Vec3::new(0.55, 0.9, 0.95),
        up: Vec3::new(0.0, 1.0, 0.0),
        margin: 1.08,
        fov_deg: 35.0,
    };
    let img = render(&m, &opts).unwrap();
    assert_eq!(px(&img, 32, 0, 0)[3], 0, "corner stays background");
    let drawn = (0..32)
        .map(|y| (0..32).filter(|x| px(&img, 32, *x, y)[3] == 255).count())
        .sum::<usize>();
    assert!(drawn > 30, "drawn pixels {drawn}");
}

#[test]
fn a_front_quad_fills_the_frame_red() {
    let m = model(
        vec![draw_quad(0.0, 1.0, "board")],
        vec![mat([1.0, 0.0, 0.0, 1.0], 1.0, false, AlphaMode::Opaque)],
        vec![],
    );
    let img = render(&m, &ortho_opts(4)).unwrap();
    for y in 0..4 {
        for x in 0..4 {
            assert_eq!(px(&img, 4, x, y), [255, 0, 0, 255], "pixel {x},{y}");
        }
    }
}

#[test]
fn a_back_face_is_culled_unless_double_sided() {
    let mut back = draw_quad(0.0, 1.0, "board");
    back.indices = vec![0, 2, 1, 0, 3, 2];
    let culled = model(
        vec![back.clone()],
        vec![mat([1.0, 0.0, 0.0, 1.0], 1.0, false, AlphaMode::Opaque)],
        vec![],
    );
    let img = render(&culled, &ortho_opts(4)).unwrap();
    assert_eq!(px(&img, 4, 2, 2), [0, 0, 0, 0]);
    let kept = model(
        vec![back],
        vec![mat([1.0, 0.0, 0.0, 1.0], 1.0, true, AlphaMode::Opaque)],
        vec![],
    );
    let img = render(&kept, &ortho_opts(4)).unwrap();
    assert_eq!(px(&img, 4, 2, 2)[3], 255);
}

#[test]
fn the_nearer_quad_wins_the_depth_test() {
    let mut red = draw_quad(0.0, 1.0, "far");
    red.material = 0;
    let mut green = draw_quad(2.0, 0.5, "near");
    green.material = 1;
    let m = model(
        vec![red, green],
        vec![
            mat([1.0, 0.0, 0.0, 1.0], 1.0, false, AlphaMode::Opaque),
            mat([0.0, 1.0, 0.0, 1.0], 1.0, false, AlphaMode::Opaque),
        ],
        vec![],
    );
    let img = render(&m, &ortho_opts(8)).unwrap();
    assert_eq!(px(&img, 8, 1, 1), [255, 0, 0, 255], "corner");
    assert_eq!(px(&img, 8, 4, 4), [0, 255, 0, 255], "centre");
}

#[test]
fn two_renders_match_byte_for_byte() {
    let m = model(
        vec![draw_quad(0.0, 1.0, "board")],
        vec![mat([0.2, 0.4, 0.8, 1.0], 0.4, false, AlphaMode::Opaque)],
        vec![],
    );
    let a = render(&m, &ortho_opts(16)).unwrap();
    let b = render(&m, &ortho_opts(16)).unwrap();
    assert_eq!(a, b);
    assert_eq!(px(&a, 16, 8, 8)[3], 255);
}

#[test]
fn mask_discards_a_clear_material() {
    let m = model(
        vec![draw_quad(0.0, 1.0, "board")],
        vec![mat([1.0, 0.0, 0.0, 0.0], 1.0, false, AlphaMode::Mask)],
        vec![],
    );
    let img = render(&m, &ortho_opts(4)).unwrap();
    assert_eq!(px(&img, 4, 2, 2), [0, 0, 0, 0]);
}

#[test]
fn highlight_draws_an_outline_and_dims_the_rest() {
    let mut board = draw_quad(0.0, 1.0, "board");
    board.material = 0;
    let mut part = draw_quad(1.0, 0.35, "part:U1");
    part.material = 1;
    let m = model(
        vec![board, part],
        vec![
            mat([0.2, 0.2, 0.8, 1.0], 1.0, false, AlphaMode::Opaque),
            mat([1.0, 0.0, 0.0, 1.0], 1.0, false, AlphaMode::Opaque),
        ],
        vec![],
    );
    let mut opts = ortho_opts(32);
    opts.highlight = vec!["part:U1".into()];
    opts.dim = 1.0;
    opts.background = [0.0, 0.0, 0.0, 1.0];
    let img = render(&m, &opts).unwrap();
    let mut outline = 0;
    let mut red = 0;
    for y in 0..32 {
        for x in 0..32 {
            let p = px(&img, 32, x, y);
            if p == OUTLINE {
                outline += 1;
            }
            if p[0] > 200 && p[1] < 40 && p[2] < 40 {
                red += 1;
            }
        }
    }
    assert!(outline > 0, "outline pixels {outline}");
    assert!(red > 0, "red pixels {red}");
    assert_eq!(
        px(&img, 32, 0, 0),
        [0, 0, 0, 255],
        "a fully dimmed corner is the background"
    );
}

#[test]
fn oversize_images_fail_clearly() {
    let m = model(vec![], vec![], vec![]);
    let mut opts = ortho_opts(4);
    opts.width = 4097;
    let err = render(&m, &opts).unwrap_err();
    assert!(err.contains("4096"), "{err}");
}

#[test]
fn bilinear_sample_hits_texel_centres_and_blends() {
    let tex = Texture {
        image: Arc::new(Image::linear(
            2,
            2,
            vec![
                [1.0, 0.0, 0.0, 1.0],
                [0.0, 1.0, 0.0, 1.0],
                [0.0, 0.0, 1.0, 1.0],
                [1.0, 1.0, 1.0, 1.0],
            ],
        )),
        sampler: Sampler {
            wrap_s: Wrap::Clamp,
            wrap_t: Wrap::Clamp,
            ..Sampler::default()
        },
    };
    let c = sample(&tex, [0.25, 0.25]);
    assert!((c[0] - 1.0).abs() < 1e-4 && c[1].abs() < 1e-4, "{c:?}");
    let c = sample(&tex, [0.5, 0.5]);
    assert!(
        (c[0] - 0.5).abs() < 1e-4 && (c[1] - 0.5).abs() < 1e-4 && (c[2] - 0.5).abs() < 1e-4,
        "{c:?}"
    );
    let rep = Texture {
        sampler: Sampler {
            wrap_s: Wrap::Repeat,
            wrap_t: Wrap::Repeat,
            ..Sampler::default()
        },
        ..tex
    };
    let a = sample(&rep, [0.25, 0.25]);
    let b = sample(&rep, [1.25, 0.25]);
    assert!((a[0] - b[0]).abs() < 1e-4 && (a[1] - b[1]).abs() < 1e-4);
}

#[test]
fn a_textured_quad_shows_the_texel() {
    let mut d = draw_quad(0.0, 1.0, "board");
    d.material = 0;
    let mut material = mat([1.0, 1.0, 1.0, 1.0], 1.0, false, AlphaMode::Opaque);
    material.texture = Some(0.into());
    let tex = Texture {
        image: Arc::new(Image::linear(1, 1, vec![[0.0, 0.0, 1.0, 1.0]])),
        sampler: Sampler {
            wrap_s: Wrap::Clamp,
            wrap_t: Wrap::Clamp,
            ..Sampler::default()
        },
    };
    let mut opts = ortho_opts(4);
    opts.ambient = 1.0;
    let m = model(vec![d], vec![material], vec![tex]);
    let img = render(&m, &opts).unwrap();
    let p = px(&img, 4, 2, 2);
    assert_eq!(p, [0, 0, 255, 255], "{p:?}");
}
#[test]
fn bands_match_a_full_frame_with_textures_masks_and_highlights() {
    let back = draw_quad(0.0, 1.0, "back");
    let mut front = draw_quad(1.0, 0.63, "front");
    front.material = 1;
    let mut masked = mat([1.0; 4], 0.3, true, AlphaMode::Mask);
    masked.texture = Some(0.into());
    let texture = Texture {
        image: Arc::new(Image::linear(
            2,
            1,
            vec![[1.0, 0.2, 0.0, 0.0], [0.0, 0.3, 1.0, 1.0]],
        )),
        sampler: Sampler {
            wrap_s: Wrap::Clamp,
            wrap_t: Wrap::Clamp,
            ..Sampler::default()
        },
    };
    let scene = model(
        vec![back, front],
        vec![
            mat([0.8, 0.3, 0.1, 1.0], 1.0, false, AlphaMode::Opaque),
            masked,
        ],
        vec![texture],
    );
    for samples in [1, 2, 3] {
        for detail in [false, true] {
            let mut options = ortho_opts(13);
            options.supersample = samples;
            options.detail = detail;
            options.highlight = vec!["front".into()];
            options.dim = 0.65;
            options.background = [0.2, 0.4, 0.7, 0.3];
            assert_eq!(
                render(&scene, &options).unwrap(),
                render_bands(&scene, &options, samples * 2).unwrap()
            );
        }
    }
}

fn shadow_scene() -> Model {
    let mut occluder = draw_quad(0.5, 0.2, "occluder");
    occluder.material = 1;
    model(
        vec![draw_quad(0.0, 1.0, "receiver"), occluder],
        vec![
            mat([1.0; 4], 1.0, true, AlphaMode::Opaque),
            mat([1.0; 4], 1.0, true, AlphaMode::Opaque),
        ],
        vec![],
    )
}

#[test]
fn hidden_geometry_neither_occludes_nor_casts_shadows_and_matches_bands() {
    let scene = shadow_scene();
    let receiver = model(
        vec![scene.draws[0].clone()],
        scene.materials.clone(),
        vec![],
    );
    let mut opts = ortho_opts(64);
    opts.light_dir = [1.0, 0.0, 1.0];
    opts.ambient = 0.2;
    opts.supersample = 2;
    opts.shadows = Some(crate::options::ShadowOptions {
        resolution: 256,
        strength: 1.0,
    });
    let expected = render(&receiver, &opts).unwrap();
    let all = render(&scene, &opts).unwrap();
    assert_ne!(all, expected);
    opts.visibility.hidden = vec![crate::options::NodeSelector::Index(1)];
    let hidden = render(&scene, &opts).unwrap();
    assert_eq!(hidden, expected);
    assert_eq!(hidden, render_bands(&scene, &opts, 4).unwrap());
    opts.visibility.hidden.clear();
    assert_eq!(render(&scene, &opts).unwrap(), all);
}

#[test]
fn native_selection_and_fit_validation_reject_unknown_or_invisible_targets() {
    use crate::options::{Bounds, NodeSelector};
    let scene = shadow_scene();
    let mut opts = Options::new(8, 8);
    opts.visibility.hidden = vec![NodeSelector::Name("missing".into())];
    assert!(render(&scene, &opts)
        .unwrap_err()
        .contains("visibility.hidden"));
    opts.visibility.hidden.clear();
    opts.highlight_indices = vec![999];
    assert!(render(&scene, &opts)
        .unwrap_err()
        .contains("highlight.nodes"));
    opts.highlight_indices.clear();
    opts.fit_nodes = Some(vec![]);
    assert!(render(&scene, &opts)
        .unwrap_err()
        .contains("visible geometry"));
    opts.fit_nodes = Some(vec![NodeSelector::Index(0)]);
    opts.visibility.hidden = vec![NodeSelector::Index(0)];
    assert!(render(&scene, &opts)
        .unwrap_err()
        .contains("visible geometry"));
    opts.fit_nodes = None;
    opts.fit_bounds = Some(Bounds {
        min: Vec3::splat(1.0),
        max: Vec3::ZERO,
    });
    assert!(render(&scene, &opts).unwrap_err().contains("camera.bounds"));
    opts.fit_bounds = Some(Bounds {
        min: Vec3::ZERO,
        max: Vec3::splat(f32::NAN),
    });
    assert!(render(&scene, &opts).unwrap_err().contains("camera.bounds"));
}

#[test]
fn directional_shadows_preserve_ambient_and_emission_and_respect_mask() {
    let mut m = shadow_scene();
    let mut opts = ortho_opts(64);
    opts.light_dir = [1.0, 0.0, 1.0];
    opts.ambient = 0.2;
    let plain = render(&m, &opts).unwrap();
    opts.shadows = Some(crate::options::ShadowOptions {
        resolution: 256,
        strength: 1.0,
    });
    let shadowed = render(&m, &opts).unwrap();
    assert!(px(&shadowed, 64, 16, 32)[0] + 80 < px(&plain, 64, 16, 32)[0]);
    assert_eq!(px(&shadowed, 64, 16, 32)[0], byte_srgb(0.2));
    assert_eq!(px(&shadowed, 64, 54, 32), px(&plain, 64, 54, 32));
    m.materials[0].emissive = [0.3, 0.0, 0.0];
    let emissive = render(&m, &opts).unwrap();
    assert_eq!(
        px(&emissive, 64, 16, 32),
        [byte_srgb(0.5), byte_srgb(0.2), byte_srgb(0.2), 255]
    );
    m.materials[0].emissive = [0.0; 3];
    m.materials[1].alpha_mode = AlphaMode::Mask;
    m.materials[1].base[3] = 0.0;
    let masked = render(&m, &opts).unwrap();
    assert_eq!(px(&masked, 64, 16, 32), px(&plain, 64, 16, 32));
    m.materials[1].alpha_mode = AlphaMode::Blend;
    let blended = render(&m, &opts).unwrap();
    assert_eq!(masked, blended);
}

#[test]
fn shadows_follow_translated_geometry_and_work_across_bands() {
    let m = shadow_scene();
    let mut opts = ortho_opts(64);
    opts.light_dir = [1.0, 0.0, 1.0];
    opts.ambient = 0.2;
    opts.shadows = Some(crate::options::ShadowOptions {
        resolution: 256,
        strength: 1.0,
    });
    let before = render(&m, &opts).unwrap();
    opts.node_translations = vec![crate::options::NodeTranslation {
        node: 1,
        translation: Vec3::new(0.5, 0.0, 0.0),
    }];
    let after = render(&m, &opts).unwrap();
    assert!(px(&after, 64, 16, 32)[0] > px(&before, 64, 16, 32)[0] + 80);
    assert!(px(&after, 64, 32, 32)[0] + 80 < px(&after, 64, 16, 32)[0]);
    opts.lighting = crate::options::Lighting::Studio;
    opts.supersample = 2;
    opts.highlight = vec!["occluder".into()];
    assert_eq!(
        render_bands(&m, &opts, 128).unwrap(),
        render_bands(&m, &opts, 8).unwrap()
    );
}

#[test]
fn a_sloping_receiver_does_not_shadow_itself() {
    let m = model(
        vec![draw_quad(0.0, 1.0, "plane")],
        vec![mat([1.0; 4], 1.0, false, AlphaMode::Opaque)],
        vec![],
    );
    for direction in [[0.0, 0.0, 1.0], [1.0, 0.5, 1.0], [8.0, 1.0, 1.0]] {
        let mut opts = ortho_opts(64);
        opts.light_dir = direction;
        let plain = render(&m, &opts).unwrap();
        opts.shadows = Some(crate::options::ShadowOptions {
            resolution: 256,
            strength: 1.0,
        });
        assert_eq!(render(&m, &opts).unwrap(), plain, "direction {direction:?}");
    }
}

#[test]
fn shadow_strength_zero_is_identical_and_invalid_native_options_fail() {
    let m = shadow_scene();
    let mut opts = ortho_opts(32);
    let plain = render(&m, &opts).unwrap();
    opts.shadows = Some(crate::options::ShadowOptions {
        resolution: 256,
        strength: 0.0,
    });
    assert_eq!(render(&m, &opts).unwrap(), plain);
    for (resolution, strength) in [(1, 1.0), (4096, 1.0), (256, f32::NAN), (256, -1.0)] {
        opts.shadows = Some(crate::options::ShadowOptions {
            resolution,
            strength,
        });
        assert!(render(&m, &opts).is_err());
    }
}

#[test]
fn shadow_masks_sample_texture_alpha_and_vertex_alpha() {
    let mut m = shadow_scene();
    m.materials[1].alpha_mode = AlphaMode::Mask;
    m.materials[1].texture = Some(0.into());
    m.textures.push(Texture {
        image: Arc::new(Image::linear(2, 1, vec![[1.0, 1.0, 1.0, 0.0], [1.0; 4]])),
        sampler: Sampler {
            wrap_s: Wrap::Clamp,
            wrap_t: Wrap::Clamp,
            ..Sampler::default()
        },
    });
    let mut opts = ortho_opts(64);
    opts.light_dir = [1.0, 0.0, 1.0];
    opts.ambient = 0.2;
    opts.shadows = Some(crate::options::ShadowOptions {
        resolution: 512,
        strength: 1.0,
    });
    let image = render(&m, &opts).unwrap();
    assert!(px(&image, 64, 12, 32)[0] > px(&image, 64, 19, 32)[0] + 80);
    m.draws[1].colors = vec![[1.0, 1.0, 1.0, 0.0]; 4];
    let image = render(&m, &opts).unwrap();
    assert_eq!(px(&image, 64, 12, 32), px(&image, 64, 19, 32));
}

#[test]
fn mapped_materials_match_across_bands_with_perspective_clipping_and_shadows() {
    use crate::texture::{Filter, Mipmap};
    let mut front = draw_quad(0.6, 0.6, "front");
    front.positions[2][2] = 2.1;
    front.bounds_max.z = 2.1;
    front.material = 1;
    front.uvs[1] = front.uvs[0]
        .iter()
        .map(|uv| [uv[0] * 5.0, uv[1] * 3.0])
        .collect();
    front.corner_tangents = vec![[1.0, 0.0, 0.0, -1.0]; 6];
    let mut mapped = mat([0.7, 0.8, 0.9, 1.0], 0.8, true, AlphaMode::Mask);
    mapped.texture = Some(0.into());
    mapped.metallic = 0.8;
    mapped.metallic_roughness_texture = Some(crate::texture::TextureInfo {
        tex_coord: 1,
        ..0.into()
    });
    mapped.normal_texture = Some(0.into());
    mapped.occlusion_texture = Some(0.into());
    mapped.emissive_texture = Some(0.into());
    mapped.emissive = [0.1; 3];
    let rgba: Vec<u8> = (0..64)
        .flat_map(|i| {
            [
                128,
                if i % 2 == 0 { 64 } else { 255 },
                200,
                if i % 3 == 0 { 0 } else { 255 },
            ]
        })
        .collect();
    let texture = Texture {
        image: Arc::new(Image::decode(8, 8, &rgba, Some(true), Some(true))),
        sampler: Sampler {
            mag: Filter::Nearest,
            mipmap: Mipmap::Linear,
            ..Sampler::default()
        },
    };
    let m = model(
        vec![draw_quad(0.0, 1.0, "receiver"), front],
        vec![mat([1.0; 4], 1.0, true, AlphaMode::Opaque), mapped],
        vec![texture],
    );
    let mut opts = ortho_opts(17);
    opts.camera = CamSpec::Perspective {
        position: Vec3::new(0.0, 0.0, 2.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 1.0, 0.0),
        fov_deg: 60.0,
    };
    opts.supersample = 3;
    opts.lighting = crate::options::Lighting::Studio;
    opts.shadows = Some(crate::options::ShadowOptions {
        resolution: 256,
        strength: 1.0,
    });
    opts.highlight = vec!["front".into()];
    assert_eq!(
        render_bands(&m, &opts, 51).unwrap(),
        render_bands(&m, &opts, 6).unwrap()
    );
}

#[test]
fn smooth_normals_do_not_change_shadow_receiver_depth() {
    let mut quad = draw_quad(0.0, 1.0, "smooth");
    quad.normals = vec![[0.8, 0.0, 0.6]; 4];
    let m = model(
        vec![quad],
        vec![mat([1.0; 4], 1.0, false, AlphaMode::Opaque)],
        vec![],
    );
    let mut opts = ortho_opts(32);
    opts.light_dir = [1.0, 0.0, 1.0];
    let plain = render(&m, &opts).unwrap();
    opts.shadows = Some(crate::options::ShadowOptions {
        resolution: 256,
        strength: 1.0,
    });
    assert!(
        render(&m, &opts).unwrap() == plain,
        "a smooth shading normal must not change the receiver plane"
    );
}

fn translucent(color: [f32; 4]) -> Material {
    Material {
        unlit: true,
        ..mat(color, 1.0, true, AlphaMode::Blend)
    }
}

#[test]
fn transparent_layers_are_depth_ordered_without_shared_edge_seams() {
    let mut back = draw_quad(0.0, 1.0, "blue");
    back.material = 1;
    let front = draw_quad(0.5, 1.0, "red");
    let mut m = model(
        vec![back, front],
        vec![
            translucent([1.0, 0.0, 0.0, 0.5]),
            translucent([0.0, 0.0, 1.0, 0.5]),
        ],
        vec![],
    );
    let opts = ortho_opts(8);
    let expected = [byte_srgb(2.0 / 3.0), 0, byte_srgb(1.0 / 3.0), 191];
    let first = render(&m, &opts).unwrap();
    assert!(
        first.as_chunks::<4>().0.iter().all(|p| *p == expected),
        "quads must blend once per sample, including the diagonal"
    );
    m.draws.reverse();
    assert_eq!(render(&m, &opts).unwrap(), first);
}

#[test]
fn intersecting_transparent_surfaces_sort_at_each_pixel() {
    let mut red = draw_quad(0.0, 1.0, "red");
    for p in &mut red.positions {
        p[2] = p[0] * 0.5;
    }
    red.bounds_min.z = -0.5;
    red.bounds_max.z = 0.5;
    let mut blue = draw_quad(0.0, 1.0, "blue");
    blue.material = 1;
    let mut m = model(
        vec![red, blue],
        vec![
            translucent([1.0, 0.0, 0.0, 0.5]),
            translucent([0.0, 0.0, 1.0, 0.5]),
        ],
        vec![],
    );
    let opts = ortho_opts(16);
    let image = render(&m, &opts).unwrap();
    let left = px(&image, 16, 2, 8);
    let right = px(&image, 16, 13, 8);
    assert!(left[2] > left[0] && right[0] > right[2]);
    m.draws.reverse();
    assert_eq!(render(&m, &opts).unwrap(), image);
}

#[test]
fn transparency_handles_coplanar_ties_opaque_depth_and_layer_limits() {
    let mut second = draw_quad(0.0, 1.0, "second");
    second.material = 1;
    let mut m = model(
        vec![draw_quad(0.0, 1.0, "first"), second],
        vec![
            translucent([1.0, 0.0, 0.0, 0.5]),
            translucent([0.0, 0.0, 1.0, 0.5]),
        ],
        vec![],
    );
    let mut opts = ortho_opts(8);
    opts.transparency.max_layers = 1;
    assert!(render(&m, &opts).unwrap_err().contains("maxLayers"));
    opts.transparency.max_layers = 2;
    let image = render(&m, &opts).unwrap();
    assert_eq!(
        px(&image, 8, 4, 4),
        [byte_srgb(2.0 / 3.0), 0, byte_srgb(1.0 / 3.0), 191]
    );
    opts.transparency.max_layers = 1;
    m.materials[0].base[3] = 0.0;
    assert_eq!(px(&render(&m, &opts).unwrap(), 8, 4, 4), [0, 0, 255, 128]);
    m.materials[0].base[3] = 1.0;
    assert_eq!(px(&render(&m, &opts).unwrap(), 8, 4, 4), [255, 0, 0, 255]);
    m.materials[0].alpha_mode = AlphaMode::Opaque;
    assert_eq!(px(&render(&m, &opts).unwrap(), 8, 4, 4), [255, 0, 0, 255]);
}

#[test]
fn transparent_highlights_use_the_nearest_nonzero_alpha_fragment() {
    let mut front = draw_quad(0.5, 0.5, "front");
    front.material = 1;
    let mut m = model(
        vec![draw_quad(0.0, 1.0, "back"), front],
        vec![
            Material {
                unlit: true,
                ..mat([0.0, 0.0, 1.0, 1.0], 1.0, false, AlphaMode::Opaque)
            },
            translucent([1.0, 0.0, 0.0, 0.5]),
        ],
        vec![],
    );
    let mut opts = ortho_opts(16);
    opts.highlight = vec!["front".into()];
    opts.dim = 0.0;
    let image = render(&m, &opts).unwrap();
    assert!(image.as_chunks::<4>().0.contains(&OUTLINE));
    m.materials[1].base[3] = 0.0;
    assert!(!render(&m, &opts)
        .unwrap()
        .as_chunks::<4>()
        .0
        .contains(&OUTLINE));
}

#[test]
fn transparent_pass_matches_bands_with_clipping_maps_and_tone_mapping() {
    let mut front = draw_quad(0.5, 0.8, "front");
    front.positions[2][2] = 2.1;
    front.bounds_max.z = 2.1;
    front.material = 1;
    let mut material = translucent([1.0, 0.5, 0.5, 0.7]);
    material.texture = Some(0.into());
    let image = Image::linear(2, 1, vec![[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 1.0, 1.0]]);
    let m = model(
        vec![draw_quad(0.0, 1.0, "back"), front],
        vec![translucent([0.1, 0.2, 0.9, 0.5]), material],
        vec![Texture {
            image: Arc::new(image),
            sampler: Sampler::default(),
        }],
    );
    let mut opts = ortho_opts(17);
    opts.camera = CamSpec::Perspective {
        position: Vec3::new(0.0, 0.0, 2.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 1.0, 0.0),
        fov_deg: 60.0,
    };
    opts.supersample = 3;
    opts.background = [0.2, 0.3, 0.4, 0.2];
    opts.highlight = vec!["front".into()];
    opts.tone_mapping = crate::options::ToneMapping::Aces;
    opts.exposure = 1.0;
    assert_eq!(
        render_bands(&m, &opts, 51).unwrap(),
        render_bands(&m, &opts, 6).unwrap()
    );
}

#[test]
fn blend_receives_shadows_but_does_not_cast_them() {
    let mut m = shadow_scene();
    let mut opts = ortho_opts(64);
    opts.light_dir = [1.0, 0.0, 1.0];
    opts.ambient = 0.2;
    opts.shadows = Some(crate::options::ShadowOptions {
        resolution: 256,
        strength: 1.0,
    });
    m.materials[0].alpha_mode = AlphaMode::Blend;
    m.materials[0].base[3] = 0.5;
    let image = render(&m, &opts).unwrap();
    assert!(px(&image, 64, 16, 32)[0] + 80 < px(&image, 64, 54, 32)[0]);
    m.materials[1].alpha_mode = AlphaMode::Blend;
    let image = render(&m, &opts).unwrap();
    assert_eq!(px(&image, 64, 16, 32), px(&image, 64, 54, 32));
}

#[test]
fn punctual_shadows_affect_only_the_first_directional_light_and_match_bands() {
    use crate::punctual::{LightKind, PunctualLight};
    let m = shadow_scene();
    let mut opts = ortho_opts(64);
    let source = PunctualLight {
        kind: LightKind::Directional,
        position: Vec3::ZERO,
        direction: Vec3::new(-1.0, 0.0, -1.0),
        color: [1.0, 0.0, 0.0],
        intensity: 1.0,
        range: None,
        inner_cone_angle: 0.0,
        outer_cone_angle: std::f32::consts::FRAC_PI_4,
    };
    opts.lights = Some(vec![
        source.clone(),
        PunctualLight {
            color: [0.0, 1.0, 0.0],
            ..source
        },
    ]);
    let plain = render(&m, &opts).unwrap();
    opts.shadows = Some(crate::options::ShadowOptions {
        resolution: 256,
        strength: 1.0,
    });
    let shadowed = render(&m, &opts).unwrap();
    assert!(px(&shadowed, 64, 16, 32)[0] < px(&plain, 64, 16, 32)[0]);
    assert_eq!(px(&shadowed, 64, 16, 32)[1], px(&plain, 64, 16, 32)[1]);
    assert_eq!(shadowed, render_bands(&m, &opts, 8).unwrap());
}

#[test]
fn padded_frames_replay_across_bands_and_query_without_mutation() {
    let m = model(
        vec![
            draw_quad(0.0, 0.7, "target"),
            draw_quad(-2.0, 1.0, "context"),
        ],
        vec![mat([1.0, 0.0, 0.0, 1.0], 1.0, true, AlphaMode::Opaque)],
        vec![],
    );
    for ortho in [false, true] {
        let mut opts = ortho_opts(80);
        opts.supersample = 2;
        opts.camera = CamSpec::Fit {
            ortho,
            direction: Vec3::new(0.0, 0.0, 1.0),
            up: Vec3::new(0.0, 1.0, 0.0),
            margin: 1.08,
            fov_deg: 35.0,
        };
        opts.fit_nodes = Some(vec![crate::NodeSelector::Index(0)]);
        opts.padding = [5.0, 7.0, 11.0, 19.0];
        let baseline = render(&m, &opts).unwrap();
        assert_eq!(baseline, render_bands(&m, &opts, 6).unwrap());
        let desc = crate::prepare_frame(&m, &opts).unwrap();
        let state = serde_json::from_value(desc["camera"]["state"].clone()).unwrap();
        let bounds =
            crate::query_bounds(&m, &opts, Some(&[crate::NodeSelector::Index(0)])).unwrap();
        assert!((bounds["min"][0].as_f64().unwrap() + 0.7).abs() < 1e-6);
        opts.camera = CamSpec::Resolved { state };
        opts.fit_nodes = None;
        opts.padding = [0.0; 4];
        assert_eq!(baseline, render(&m, &opts).unwrap());
        let points = crate::project_points(&opts, &[Vec3::ZERO]).unwrap();
        assert!((points[0]["x"].as_f64().unwrap() - 46.0).abs() < 1e-5);
        assert!((points[0]["y"].as_f64().unwrap() - 37.0).abs() < 1e-5);
        opts.visibility.only = Some(vec![]);
        assert!(crate::query_bounds(&m, &opts, None).unwrap().is_null());
    }
}

#[test]
fn styled_auxiliary_images_match_across_bands_and_restore_default_rendering() {
    let m = model(
        vec![draw_quad(0.0, 1.0, "back"), draw_quad(0.3, 0.5, "front")],
        vec![mat([0.2, 0.4, 0.8, 1.0], 0.5, true, AlphaMode::Opaque)],
        vec![],
    );
    let mut opts = ortho_opts(32);
    opts.supersample = 3;
    let base = render(&m, &opts).unwrap();
    opts.outputs.depth = true;
    opts.outputs.node_ids = true;
    opts.styles.push(crate::options::NodeStyle {
        nodes: Some(vec![crate::options::NodeSelector::Index(1)]),
        surface: crate::options::SurfaceStyle {
            opacity: 0.4,
            saturation: 0.1,
            tint: [0.1, 0.6, 0.1, 0.2],
            rim: [0.0; 4],
        },
    });
    let a = render_output_bands(&m, &opts, 96).unwrap();
    let b = render_output_bands(&m, &opts, 6).unwrap();
    assert_eq!(a.rgba, b.rgba);
    assert_eq!(a.depth, b.depth);
    assert_eq!(a.node_ids, b.node_ids);
    assert_eq!(a.node_ids[16 * 32 + 16], 1);
    opts.styles.clear();
    assert_eq!(render(&m, &opts).unwrap(), base);
}
