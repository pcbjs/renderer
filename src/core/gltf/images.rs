// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use std::borrow::Cow;
use std::sync::Arc;

use serde_json::Value;

use super::accessor::view_bytes;
use crate::material::Material;
use crate::texture::{ColorSpace, Filter, Image, Mipmap, Sampler, Texture, Wrap};

pub(super) fn load_textures(
    root: &Value,
    bin: &[u8],
    materials: &[Material],
) -> Result<Vec<Texture>, String> {
    let images = root
        .get("images")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let textures = root
        .get("textures")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut entries = Vec::with_capacity(textures.len());
    for (i, texture) in textures.iter().enumerate() {
        let source = texture
            .get("source")
            .and_then(Value::as_u64)
            .ok_or_else(|| format!("glTF texture {i} has no source"))?
            as usize;
        if source >= images.len() {
            return Err(format!("glTF texture {i} points at missing image {source}"));
        }
        entries.push((source, load_sampler(root, texture)?));
    }
    let mut usage = vec![[None; 2]; images.len()];
    for material in materials {
        for (info, space) in material.textures() {
            let (source, sampler) = entries[info.index];
            let role = if space == ColorSpace::Srgb { 0 } else { 1 };
            usage[source][role] =
                Some(usage[source][role].unwrap_or(false) || sampler.mipmap != Mipmap::None);
        }
    }
    let mut decoded = Vec::with_capacity(images.len());
    for (i, image) in images.iter().enumerate() {
        let bytes = image_bytes(root, bin, image, i)?;
        let rgba = image::load_from_memory(&bytes)
            .map_err(|e| format!("glTF image {i} could not be decoded: {e}"))?
            .to_rgba8();
        let (width, height) = rgba.dimensions();
        if width == 0 || height == 0 {
            return Err(format!("glTF image {i} is empty"));
        }
        let [color, data] = usage[i];
        let color = if color.is_none() && data.is_none() {
            Some(false)
        } else {
            color
        };
        decoded.push(Arc::new(Image::decode(width, height, &rgba, color, data)));
    }
    Ok(entries
        .into_iter()
        .map(|(source, sampler)| Texture {
            image: Arc::clone(&decoded[source]),
            sampler,
        })
        .collect())
}

fn load_sampler(root: &Value, texture: &Value) -> Result<Sampler, String> {
    let Some(index) = texture.get("sampler") else {
        return Ok(Sampler::default());
    };
    let index = index
        .as_u64()
        .ok_or("glTF texture sampler must be an index")? as usize;
    let value = root
        .get("samplers")
        .and_then(Value::as_array)
        .and_then(|a| a.get(index))
        .ok_or_else(|| format!("glTF sampler {index} is missing"))?;
    let code = |key: &str, default| -> Result<u64, String> {
        value.get(key).map_or(Ok(default), |v| {
            v.as_u64()
                .ok_or_else(|| format!("glTF sampler {index} {key} must be an integer"))
        })
    };
    let mag = match code("magFilter", 9729)? {
        9728 => Filter::Nearest,
        9729 => Filter::Linear,
        _ => return Err(format!("glTF sampler {index} has invalid magFilter")),
    };
    let (min, mipmap) = match code("minFilter", 9729)? {
        9728 => (Filter::Nearest, Mipmap::None),
        9729 => (Filter::Linear, Mipmap::None),
        9984 => (Filter::Nearest, Mipmap::Nearest),
        9985 => (Filter::Linear, Mipmap::Nearest),
        9986 => (Filter::Nearest, Mipmap::Linear),
        9987 => (Filter::Linear, Mipmap::Linear),
        _ => return Err(format!("glTF sampler {index} has invalid minFilter")),
    };
    Ok(Sampler {
        wrap_s: wrap_of(value, "wrapS", index)?,
        wrap_t: wrap_of(value, "wrapT", index)?,
        mag,
        min,
        mipmap,
    })
}

fn wrap_of(sampler: &Value, key: &str, index: usize) -> Result<Wrap, String> {
    let code = sampler.get(key).map_or(Ok(10497), |v| {
        v.as_u64()
            .ok_or_else(|| format!("glTF sampler {index} {key} must be an integer"))
    })?;
    match code {
        10497 => Ok(Wrap::Repeat),
        33071 => Ok(Wrap::Clamp),
        33648 => Ok(Wrap::Mirror),
        _ => Err(format!(
            "glTF sampler {index} has wrap mode {code}, which is not supported"
        )),
    }
}

fn image_bytes<'a>(
    root: &Value,
    bin: &'a [u8],
    image: &Value,
    index: usize,
) -> Result<Cow<'a, [u8]>, String> {
    if let Some(view) = image.get("bufferView").and_then(|v| v.as_u64()) {
        return view_bytes(root, bin, view as usize).map(Cow::Borrowed);
    }
    if let Some(uri) = image.get("uri").and_then(|v| v.as_str()) {
        return decode_data_uri(uri, index).map(Cow::Owned);
    }
    Err(format!(
        "glTF image {index} has neither a bufferView nor a data URI"
    ))
}

fn decode_data_uri(uri: &str, index: usize) -> Result<Vec<u8>, String> {
    let rest = uri
        .strip_prefix("data:")
        .ok_or_else(|| format!("glTF image {index} URI is not a data URI"))?;
    let (head, body) = rest
        .split_once(',')
        .ok_or_else(|| format!("glTF image {index} data URI has no payload"))?;
    if !head.contains(";base64") {
        return Err(format!("glTF image {index} data URI is not base64"));
    }
    b64(body).map_err(|e| format!("glTF image {index} base64 is not valid: {e}"))
}

fn b64(s: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let clean: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace()).collect();
    if !clean.len().is_multiple_of(4) {
        return Err("length is not a multiple of 4".into());
    }
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.chunks(4) {
        let pads = chunk.iter().rev().take_while(|c| **c == b'=').count();
        let mut n = [0u8; 4];
        for i in 0..(4 - pads) {
            n[i] = val(chunk[i]).ok_or("a character is not base64")?;
        }
        let v = ((n[0] as u32) << 18) | ((n[1] as u32) << 12) | ((n[2] as u32) << 6) | n[3] as u32;
        out.push((v >> 16) as u8);
        if pads < 2 {
            out.push((v >> 8) as u8);
        }
        if pads < 1 {
            out.push(v as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;

    #[test]
    fn jpeg_textures_decode_to_linear_colour_with_opaque_alpha() {
        let source = image::RgbImage::from_pixel(8, 4, image::Rgb([64, 128, 192]));
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 100)
            .encode_image(&source)
            .unwrap();
        let root = json!({
            "images": [{ "bufferView": 0, "mimeType": "image/jpeg" }],
            "bufferViews": [{ "buffer": 0, "byteLength": bytes.len() }],
            "textures": [{ "source": 0 }]
        });
        let textures = load_textures(&root, &bytes, &[]).unwrap();
        let level = &textures[0].image.color.as_ref().unwrap().levels[0];
        assert_eq!((level.width, level.height), (8, 4));
        let pixel = crate::texture::sample(&textures[0], [0.5, 0.5]);
        for (actual, expected) in pixel[..3].iter().zip([64.0, 128.0, 192.0]) {
            assert!((actual - crate::color::srgb_to_linear(expected / 255.0)).abs() < 0.01);
        }
        assert_eq!(pixel[3], 1.0);
    }

    #[test]
    fn texture_samplers_share_the_decoded_image() {
        let mut png = Cursor::new(Vec::new());
        image::RgbaImage::from_raw(1, 1, vec![255, 0, 0, 255])
            .unwrap()
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let bytes = png.into_inner();
        let root = json!({
            "images": [{ "bufferView": 0 }],
            "bufferViews": [{ "buffer": 0, "byteLength": bytes.len() }],
            "samplers": [{ "wrapS": 33071 }],
            "textures": [{ "source": 0 }, { "source": 0, "sampler": 0 }]
        });
        let textures = load_textures(&root, &bytes, &[]).unwrap();
        assert!(Arc::ptr_eq(&textures[0].image, &textures[1].image));
        assert_eq!(textures[0].sampler.wrap_s, Wrap::Repeat);
        assert_eq!(textures[1].sampler.wrap_s, Wrap::Clamp);
    }
}
