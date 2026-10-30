// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use serde_json::Value;
use std::borrow::Cow;

pub(super) struct Accessor<'a> {
    data: Option<Cow<'a, [u8]>>,
    pub count: usize,
    pub components: usize,
    component_type: u32,
    width: usize,
    stride: usize,
    normalized: bool,
}

impl<'a> Accessor<'a> {
    pub fn new(root: &Value, bin: &'a [u8], index: usize) -> Result<Self, String> {
        let value = root
            .get("accessors")
            .and_then(Value::as_array)
            .and_then(|a| a.get(index))
            .ok_or_else(|| format!("glTF accessor {index} is missing"))?;
        let components = type_components(value.get("type").and_then(Value::as_str).unwrap_or(""))?;
        let component_type = value
            .get("componentType")
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| format!("glTF accessor {index} has no valid component type"))?;
        let width = component_width(component_type)?;
        let count = value
            .get("count")
            .and_then(Value::as_u64)
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| format!("glTF accessor {index} has no valid count"))?;
        let tight = components * width;
        let mut stride = tight;
        let mut data = if let Some(view) = value.get("bufferView").and_then(Value::as_u64) {
            let view = usize::try_from(view)
                .map_err(|_| format!("glTF accessor {index} bufferView is too large"))?;
            let bytes = view_bytes(root, bin, view)?;
            let offset = optional_offset(value, "byteOffset")?;
            let bytes = bytes.get(offset..).ok_or_else(|| {
                format!("glTF accessor byte offset extends past bufferView {view}")
            })?;
            stride = root["bufferViews"][view]
                .get("byteStride")
                .map(|v| {
                    v.as_u64()
                        .and_then(|n| usize::try_from(n).ok())
                        .ok_or_else(|| format!("glTF bufferView {view} has no valid stride"))
                })
                .transpose()?
                .unwrap_or(tight);
            if stride < tight {
                return Err(format!(
                    "glTF bufferView {view} stride {stride} is shorter than one element"
                ));
            }
            let needed = if count == 0 {
                Some(0)
            } else {
                (count - 1)
                    .checked_mul(stride)
                    .and_then(|n| n.checked_add(tight))
            };
            if needed.is_none_or(|n| n > bytes.len()) {
                return Err(format!(
                    "glTF accessor {index} extends past its buffer view"
                ));
            }
            Some(Cow::Borrowed(bytes))
        } else {
            None
        };
        if let Some(sparse) = value.get("sparse") {
            let patches = sparse
                .get("count")
                .and_then(Value::as_u64)
                .and_then(|n| usize::try_from(n).ok())
                .filter(|n| *n > 0 && *n <= count)
                .ok_or_else(|| format!("glTF accessor {index} sparse count is invalid"))?;
            let index_type = sparse["indices"]["componentType"]
                .as_u64()
                .filter(|v| matches!(v, 5121 | 5123 | 5125))
                .ok_or_else(|| {
                    format!("glTF accessor {index} sparse indices need an unsigned component type")
                })? as u32;
            let index_width = component_width(index_type)?;
            let indices = sparse_bytes(root, bin, &sparse["indices"], patches, index_width)?;
            let values = sparse_bytes(root, bin, &sparse["values"], patches, tight)?;
            let mut offsets = Vec::with_capacity(patches);
            for patch in 0..patches {
                let offset = unsigned(&indices[patch * index_width..], index_type) as usize;
                if offset >= count || offsets.last().is_some_and(|previous| *previous >= offset) {
                    return Err(format!("glTF accessor {index} sparse indices must be strictly increasing and within count"));
                }
                offsets.push(offset);
            }
            let length = count
                .checked_mul(tight)
                .ok_or("glTF sparse accessor is too large")?;
            let mut dense = Vec::new();
            dense
                .try_reserve_exact(length)
                .map_err(|_| "glTF sparse accessor is too large to allocate")?;
            dense.resize(length, 0);
            if let Some(base) = &data {
                for element in 0..count {
                    dense[element * tight..(element + 1) * tight]
                        .copy_from_slice(&base[element * stride..element * stride + tight]);
                }
            }
            for (patch, offset) in offsets.into_iter().enumerate() {
                dense[offset * tight..(offset + 1) * tight]
                    .copy_from_slice(&values[patch * tight..(patch + 1) * tight]);
            }
            data = Some(Cow::Owned(dense));
            stride = tight;
        }
        let normalized = value
            .get("normalized")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(Self {
            data,
            count,
            components,
            component_type,
            width,
            stride,
            normalized,
        })
    }

    pub fn vectors<const N: usize>(&self) -> Result<Vec<[f32; N]>, String> {
        if self.components > N {
            return Err(format!(
                "glTF accessor has {} components, expected at most {N}",
                self.components
            ));
        }
        let mut values = Vec::new();
        values
            .try_reserve_exact(self.count)
            .map_err(|_| "glTF accessor is too large to allocate")?;
        for element in 0..self.count {
            let mut value = [1.0; N];
            for (component, out) in value[..self.components].iter_mut().enumerate() {
                *out = match self.data.as_deref() {
                    Some(data) => read_component(
                        &data[element * self.stride + component * self.width..],
                        self.component_type,
                        self.normalized,
                    )?,
                    None => 0.0,
                };
            }
            values.push(value);
        }
        Ok(values)
    }
}

pub(super) fn read_accessor<const N: usize>(
    root: &Value,
    bin: &[u8],
    index: usize,
) -> Result<Vec<[f32; N]>, String> {
    let accessor = Accessor::new(root, bin, index)?;
    if accessor.components != N {
        return Err(format!(
            "glTF accessor {index} has {} components, expected {N}",
            accessor.components
        ));
    }
    accessor.vectors()
}

pub(super) fn read_colors(
    root: &Value,
    bin: &[u8],
    index: usize,
    count: usize,
    mesh: usize,
    prim: usize,
) -> Result<Vec<[f32; 4]>, String> {
    let accessor = Accessor::new(root, bin, index)?;
    if accessor.components != 3 && accessor.components != 4 {
        return Err(format!(
            "glTF accessor {index} for COLOR_0 is not VEC3 or VEC4"
        ));
    }
    if accessor.count != count {
        return Err(format!(
            "glTF mesh {mesh} primitive {prim} COLOR_0 does not match POSITION"
        ));
    }
    accessor.vectors()
}

pub(super) fn read_indices(root: &Value, bin: &[u8], index: usize) -> Result<Vec<u32>, String> {
    let accessor = Accessor::new(root, bin, index)?;
    if accessor.components != 1 {
        return Err(format!("glTF accessor {index} for indices is not SCALAR"));
    }
    if !matches!(accessor.component_type, 5121 | 5123 | 5125) {
        return Err(format!(
            "glTF accessor {index} index component type {} is not an unsigned integer",
            accessor.component_type
        ));
    }
    let mut indices = Vec::new();
    indices
        .try_reserve_exact(accessor.count)
        .map_err(|_| "glTF index accessor is too large to allocate")?;
    for element in 0..accessor.count {
        let index = match accessor.data.as_deref() {
            None => 0,
            Some(data) => {
                let offset = element * accessor.stride;
                unsigned(&data[offset..], accessor.component_type)
            }
        };
        indices.push(index);
    }
    Ok(indices)
}

fn unsigned(bytes: &[u8], ty: u32) -> u32 {
    match ty {
        5121 => bytes[0] as u32,
        5123 => u16::from_le_bytes(bytes[..2].try_into().unwrap()) as u32,
        _ => u32::from_le_bytes(bytes[..4].try_into().unwrap()),
    }
}

fn sparse_bytes<'a>(
    root: &Value,
    bin: &'a [u8],
    value: &Value,
    count: usize,
    size: usize,
) -> Result<&'a [u8], String> {
    let view = value
        .get("bufferView")
        .and_then(Value::as_u64)
        .and_then(|n| usize::try_from(n).ok())
        .ok_or("glTF sparse storage needs a bufferView")?;
    if root["bufferViews"][view].get("byteStride").is_some() {
        return Err("glTF sparse bufferViews must not have byteStride".into());
    }
    let bytes = view_bytes(root, bin, view)?;
    let offset = optional_offset(value, "byteOffset")?;
    count
        .checked_mul(size)
        .and_then(|length| offset.checked_add(length))
        .and_then(|end| bytes.get(offset..end))
        .ok_or_else(|| "glTF sparse storage extends past its bufferView".into())
}

fn optional_offset(value: &Value, key: &str) -> Result<usize, String> {
    value
        .get(key)
        .map(|v| {
            v.as_u64()
                .and_then(|n| usize::try_from(n).ok())
                .ok_or_else(|| format!("glTF {key} is not a valid offset"))
        })
        .transpose()
        .map(|v| v.unwrap_or(0))
}

pub(super) fn view_bytes<'a>(
    root: &Value,
    bin: &'a [u8],
    index: usize,
) -> Result<&'a [u8], String> {
    let view = root
        .get("bufferViews")
        .and_then(Value::as_array)
        .and_then(|views| views.get(index))
        .ok_or_else(|| format!("glTF bufferView {index} is missing"))?;
    let buffer = view.get("buffer").and_then(Value::as_u64).unwrap_or(0);
    if buffer != 0 {
        return Err(format!(
            "glTF bufferView {index} uses buffer {buffer}; only buffer 0 is supported"
        ));
    }
    let offset = optional_offset(view, "byteOffset")?;
    let length = view
        .get("byteLength")
        .and_then(Value::as_u64)
        .and_then(|n| usize::try_from(n).ok())
        .ok_or_else(|| format!("glTF bufferView {index} has no valid byteLength"))?;
    offset
        .checked_add(length)
        .and_then(|end| bin.get(offset..end))
        .ok_or_else(|| format!("glTF bufferView {index} extends past the binary chunk"))
}

fn component_width(ty: u32) -> Result<usize, String> {
    match ty {
        5120 | 5121 => Ok(1),
        5122 | 5123 => Ok(2),
        5125 | 5126 => Ok(4),
        _ => Err(format!(
            "glTF accessor has component type {ty}, which is not supported"
        )),
    }
}

fn type_components(t: &str) -> Result<usize, String> {
    match t {
        "SCALAR" => Ok(1),
        "VEC2" => Ok(2),
        "VEC3" => Ok(3),
        "VEC4" => Ok(4),
        "MAT4" => Ok(16),
        _ => Err(format!("glTF accessor type {t} is not supported")),
    }
}

fn read_component(data: &[u8], ty: u32, normalized: bool) -> Result<f32, String> {
    let v = match ty {
        5120 => {
            let s = data[0] as i8 as f32;
            if normalized {
                (s / 127.0).max(-1.0)
            } else {
                s
            }
        }
        5121 => {
            let s = data[0] as f32;
            if normalized {
                s / 255.0
            } else {
                s
            }
        }
        5122 => {
            let s = i16::from_le_bytes(data[..2].try_into().unwrap()) as f32;
            if normalized {
                (s / 32767.0).max(-1.0)
            } else {
                s
            }
        }
        5123 => {
            let s = u16::from_le_bytes(data[..2].try_into().unwrap()) as f32;
            if normalized {
                s / 65535.0
            } else {
                s
            }
        }
        5125 => {
            let s = u32::from_le_bytes(data[..4].try_into().unwrap()) as f32;
            if normalized {
                s / 4294967295.0
            } else {
                s
            }
        }
        5126 => f32::from_le_bytes(data[..4].try_into().unwrap()),
        _ => {
            return Err(format!(
                "glTF accessor has component type {ty}, which is not supported"
            ))
        }
    };
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn interleaved_normalized_colors_keep_their_stride_and_default_alpha() {
        let root = json!({
            "accessors": [{ "bufferView": 0, "componentType": 5121, "type": "VEC3", "count": 2, "normalized": true }],
            "bufferViews": [{ "buffer": 0, "byteLength": 8, "byteStride": 4 }]
        });
        let colors = read_colors(&root, &[255, 128, 0, 99, 0, 255, 64, 99], 0, 2, 0, 0).unwrap();
        assert_eq!(
            colors,
            vec![
                [1.0, 128.0 / 255.0, 0.0, 1.0],
                [0.0, 1.0, 64.0 / 255.0, 1.0]
            ]
        );
    }

    #[test]
    fn an_oversized_accessor_fails_before_allocation() {
        let root = json!({
            "accessors": [{ "bufferView": 0, "componentType": 5126, "type": "VEC3", "count": 4294967295u64 }],
            "bufferViews": [{ "buffer": 0, "byteLength": 12 }]
        });
        let error = read_accessor::<3>(&root, &[0; 12], 0).unwrap_err();
        assert!(error.contains("extends past its buffer view"), "{error}");
    }

    #[test]
    fn an_accessor_without_a_view_is_zero_initialized() {
        let root = json!({ "accessors": [{ "componentType": 5126, "type": "VEC2", "count": 2 }] });
        assert_eq!(
            read_accessor::<2>(&root, &[], 0).unwrap(),
            vec![[0.0; 2]; 2]
        );
    }
}

#[cfg(test)]
mod sparse_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sparse_zero_base_normalized_colors_and_strided_overrides() {
        let mut root = json!({ "accessors": [{ "componentType": 5121, "type": "VEC3", "count": 2, "normalized": true,
            "sparse": { "count": 1, "indices": { "bufferView": 0, "componentType": 5121 }, "values": { "bufferView": 1 } } }],
            "bufferViews": [{ "buffer": 0, "byteLength": 1 }, { "buffer": 0, "byteOffset": 1, "byteLength": 3 }, { "buffer": 0, "byteOffset": 4, "byteLength": 8, "byteStride": 4 }] });
        let bin = [1, 255, 128, 0, 0, 255, 0, 99, 0, 0, 255, 99];
        assert_eq!(
            read_colors(&root, &bin, 0, 2, 0, 0).unwrap(),
            [[0.0, 0.0, 0.0, 1.0], [1.0, 128.0 / 255.0, 0.0, 1.0]]
        );
        root["accessors"][0]["bufferView"] = json!(2);
        assert_eq!(
            read_colors(&root, &bin, 0, 2, 0, 0).unwrap()[0],
            [0.0, 1.0, 0.0, 1.0]
        );
    }

    #[test]
    fn sparse_indices_preserve_u32_precision_and_validate_order_and_bounds() {
        let mut bin = vec![0, 2, 0, 0];
        bin.extend_from_slice(&16_777_217u32.to_le_bytes());
        bin.extend_from_slice(&7u32.to_le_bytes());
        let mut root = json!({ "accessors": [{ "componentType": 5125, "type": "SCALAR", "count": 3,
            "sparse": { "count": 2, "indices": { "bufferView": 0, "componentType": 5121 }, "values": { "bufferView": 1 } } }],
            "bufferViews": [{ "buffer": 0, "byteLength": 2 }, { "buffer": 0, "byteOffset": 4, "byteLength": 8 }] });
        assert_eq!(read_indices(&root, &bin, 0).unwrap(), [16_777_217, 0, 7]);
        for invalid in [[0, 0], [2, 0], [0, 3]] {
            bin[..2].copy_from_slice(&invalid);
            assert!(read_indices(&root, &bin, 0)
                .unwrap_err()
                .contains("strictly increasing"));
        }
        bin[..2].copy_from_slice(&[0, 2]);
        root["bufferViews"][1]["byteLength"] = json!(4);
        assert!(read_indices(&root, &bin, 0)
            .unwrap_err()
            .contains("extends past"));
    }
}
