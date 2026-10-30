// ---------------------------------------------------------
// Copyright (c) 2026-present Yuxuan Zhang, web-dev@z-yx.cc
// This source code is licensed under the MIT license.
// You may find the full license in project root directory.
// ------------------------------------------------------

use crate::math::Vec3;

struct Mesh<'a> {
    positions: &'a [[f32; 3]],
    normals: &'a [[f32; 3]],
    flat: bool,
    uv: &'a [[f32; 2]],
    indices: &'a [u32],
    tangents: Vec<[f32; 4]>,
}

impl Mesh<'_> {
    fn index(&self, face: usize, vertex: usize) -> usize {
        self.indices[face * 3 + vertex] as usize
    }
}

impl mikktspace::Geometry for Mesh<'_> {
    fn num_faces(&self) -> usize {
        self.indices.len() / 3
    }
    fn num_vertices_of_face(&self, _: usize) -> usize {
        3
    }
    fn position(&self, face: usize, vertex: usize) -> [f32; 3] {
        self.positions[self.index(face, vertex)]
    }
    fn normal(&self, face: usize, vertex: usize) -> [f32; 3] {
        self.normals[if self.flat {
            face * 3 + vertex
        } else {
            self.index(face, vertex)
        }]
    }
    fn tex_coord(&self, face: usize, vertex: usize) -> [f32; 2] {
        self.uv[self.index(face, vertex)]
    }
    fn set_tangent_encoded(&mut self, tangent: [f32; 4], face: usize, vertex: usize) {
        self.tangents[face * 3 + vertex] = tangent;
    }
}

pub(super) fn generate(
    positions: &[[f32; 3]],
    normals: &[[f32; 3]],
    uv: &[[f32; 2]],
    indices: &[u32],
    flat: bool,
) -> Vec<[f32; 4]> {
    let mut mesh = Mesh {
        positions,
        normals,
        flat,
        uv,
        indices,
        tangents: vec![[0.0; 4]; indices.len()],
    };
    mikktspace::generate_tangents(&mut mesh);
    for tangent in &mut mesh.tangents {
        if tangent.iter().any(|v| !v.is_finite()) {
            *tangent = [0.0; 4];
        }
    }
    mesh.tangents
}

pub(super) fn mirrored(matrix: &[f32; 16]) -> bool {
    let x = Vec3::new(matrix[0], matrix[1], matrix[2]);
    let y = Vec3::new(matrix[4], matrix[5], matrix[6]);
    let z = Vec3::new(matrix[8], matrix[9], matrix[10]);
    x.cross(y).dot(z) < 0.0
}

pub(super) fn transform(tangents: &mut [[f32; 4]], matrix: &[f32; 16]) {
    let sign = if mirrored(matrix) { -1.0 } else { 1.0 };
    for tangent in tangents {
        let [x, y, z, w] = *tangent;
        let t = Vec3::new(
            matrix[0] * x + matrix[4] * y + matrix[8] * z,
            matrix[1] * x + matrix[5] * y + matrix[9] * z,
            matrix[2] * x + matrix[6] * y + matrix[10] * z,
        )
        .normalize();
        *tangent = [t.x, t.y, t.z, w * sign];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mikktspace_keeps_opposite_handedness_at_shared_corners() {
        let positions = [
            [-1.0, -1.0, 0.0],
            [1.0, -1.0, 0.0],
            [1.0, 1.0, 0.0],
            [-1.0, 1.0, 0.0],
        ];
        let uv = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 0.0]];
        let tangents = generate(
            &positions,
            &[[0.0, 0.0, 1.0]; 4],
            &uv,
            &[0, 1, 2, 0, 2, 3],
            false,
        );
        assert_eq!(tangents[0][3], -tangents[3][3]);
        assert!(tangents
            .iter()
            .all(|t| t.iter().all(|v| v.is_finite()) && t[3].abs() == 1.0));
    }
}
