// ============================================================================
// Smart Gate — Face Alignment (Affine Warp)
// ============================================================================
//
// Given 5 facial landmarks from SCRFD, compute a 2x3 affine matrix that
// warps the face so the eyes, nose, and mouth always land at fixed pixel
// coordinates.  This normalisation step increases recognition accuracy
// by ~20%.
//
// REFERENCE LANDMARKS:
//   The "canonical" positions below are the standard ArcFace 112x112
//   alignment targets used across all buffalo_l / InsightFace models.
// ============================================================================

use super::FaceLandmarks;

/// Standard ArcFace reference landmarks for 112x112 output.
pub const ARCFACE_REF_LANDMARKS_112: [[f32; 2]; 5] = [
    [38.2946, 51.6963],  // left eye
    [73.5318, 51.5014],  // right eye
    [56.0252, 71.7366],  // nose tip
    [41.5493, 92.3655],  // left mouth corner
    [70.7299, 92.2041],  // right mouth corner
];

/// A 2x3 affine transformation matrix (row-major).
#[derive(Debug, Clone, Copy)]
pub struct AffineMatrix {
    pub data: [[f32; 3]; 2],
}

impl AffineMatrix {
    /// Transform a single `[x, y]` point.
    #[inline]
    pub fn transform_point(&self, point: [f32; 2]) -> [f32; 2] {
        let [x, y] = point;
        [
            self.data[0][0] * x + self.data[0][1] * y + self.data[0][2],
            self.data[1][0] * x + self.data[1][1] * y + self.data[1][2],
        ]
    }
}

/// Computes affine warp matrices to normalise detected faces.
pub struct FaceAligner {
    output_size: u32,
    reference: [[f32; 2]; 5],
}

impl FaceAligner {
    /// Create a new aligner targeting a square `output_size`.
    /// If not 112, reference landmarks are proportionally scaled.
    pub fn new(output_size: u32) -> Self {
        let scale = output_size as f32 / 112.0;
        let mut reference = ARCFACE_REF_LANDMARKS_112;
        if (scale - 1.0).abs() > f32::EPSILON {
            for pt in reference.iter_mut() {
                pt[0] *= scale;
                pt[1] *= scale;
            }
        }
        Self { output_size, reference }
    }

    pub fn output_size(&self) -> u32 {
        self.output_size
    }

    /// Estimate the 2x3 affine matrix that maps `src` landmarks to the
    /// canonical reference positions using least-squares.
    pub fn estimate_transform(&self, src: &FaceLandmarks) -> AffineMatrix {
        let dst = &self.reference;
        let src_pts = &src.points;

        // Build normal equations:  (AtA) * x = Atb
        let mut ata = [[0.0f64; 3]; 3];
        let mut atb_x = [0.0f64; 3];
        let mut atb_y = [0.0f64; 3];

        for i in 0..5 {
            let sx = src_pts[i][0] as f64;
            let sy = src_pts[i][1] as f64;
            let dx = dst[i][0] as f64;
            let dy = dst[i][1] as f64;
            let a_row = [sx, sy, 1.0];

            for r in 0..3 {
                for c in 0..3 {
                    ata[r][c] += a_row[r] * a_row[c];
                }
                atb_x[r] += a_row[r] * dx;
                atb_y[r] += a_row[r] * dy;
            }
        }

        let coeffs_x = solve_3x3(&ata, &atb_x);
        let coeffs_y = solve_3x3(&ata, &atb_y);

        AffineMatrix {
            data: [
                [coeffs_x[0] as f32, coeffs_x[1] as f32, coeffs_x[2] as f32],
                [coeffs_y[0] as f32, coeffs_y[1] as f32, coeffs_y[2] as f32],
            ],
        }
    }

    /// Apply the affine warp to a raw RGB image buffer.
    /// Returns a `Vec<u8>` of size `output_size * output_size * 3`.
    pub fn warp_image(
        &self,
        image_data: &[u8],
        image_width: u32,
        image_height: u32,
        transform: &AffineMatrix,
    ) -> Vec<u8> {
        let size = self.output_size as usize;
        let mut output = vec![0u8; size * size * 3];
        let inv = invert_affine(transform);

        for dst_y in 0..size {
            for dst_x in 0..size {
                let src = inv.transform_point([dst_x as f32, dst_y as f32]);
                let pixel = bilinear_sample(image_data, image_width, image_height, src[0], src[1]);
                let idx = (dst_y * size + dst_x) * 3;
                output[idx] = pixel[0];
                output[idx + 1] = pixel[1];
                output[idx + 2] = pixel[2];
            }
        }
        output
    }
}

// ---------------------------------------------------------------------------
// Linear algebra helpers (pure Rust, no external crate needed for 3x3)
// ---------------------------------------------------------------------------

/// Solve 3x3 system `A * x = b` via Cramer's rule.
fn solve_3x3(a: &[[f64; 3]; 3], b: &[f64; 3]) -> [f64; 3] {
    let det_a = det3(a);
    if det_a.abs() < 1e-12 {
        log::warn!("FaceAligner: singular matrix in solve_3x3");
        return [0.0; 3];
    }
    let mut result = [0.0f64; 3];
    for col in 0..3 {
        let mut modified = *a;
        for row in 0..3 {
            modified[row][col] = b[row];
        }
        result[col] = det3(&modified) / det_a;
    }
    result
}

/// Determinant of a 3x3 matrix.
fn det3(m: &[[f64; 3]; 3]) -> f64 {
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}

/// Invert a 2x3 affine matrix (implicit [0,0,1] bottom row).
fn invert_affine(m: &AffineMatrix) -> AffineMatrix {
    let (a, b, tx) = (m.data[0][0] as f64, m.data[0][1] as f64, m.data[0][2] as f64);
    let (c, d, ty) = (m.data[1][0] as f64, m.data[1][1] as f64, m.data[1][2] as f64);

    let det = a * d - b * c;
    if det.abs() < 1e-12 {
        log::warn!("FaceAligner: singular affine matrix");
        return AffineMatrix { data: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]] };
    }

    let inv_det = 1.0 / det;
    let (ia, ib) = (d * inv_det, -b * inv_det);
    let (ic, id) = (-c * inv_det, a * inv_det);
    let itx = -(ia * tx + ib * ty);
    let ity = -(ic * tx + id * ty);

    AffineMatrix {
        data: [
            [ia as f32, ib as f32, itx as f32],
            [ic as f32, id as f32, ity as f32],
        ],
    }
}

/// Bilinear interpolation at sub-pixel coordinates. Returns [R, G, B].
fn bilinear_sample(data: &[u8], width: u32, height: u32, sx: f32, sy: f32) -> [u8; 3] {
    let (w, h) = (width as i32, height as i32);
    let (x0, y0) = (sx.floor() as i32, sy.floor() as i32);
    let (x1, y1) = (x0 + 1, y0 + 1);
    let (fx, fy) = (sx - x0 as f32, sy - y0 as f32);

    let sample = |x: i32, y: i32| -> [f32; 3] {
        if x < 0 || x >= w || y < 0 || y >= h {
            return [0.0; 3];
        }
        let idx = ((y * w + x) * 3) as usize;
        [data[idx] as f32, data[idx + 1] as f32, data[idx + 2] as f32]
    };

    let (p00, p10) = (sample(x0, y0), sample(x1, y0));
    let (p01, p11) = (sample(x0, y1), sample(x1, y1));

    let mut result = [0u8; 3];
    for c in 0..3 {
        let v = p00[c] * (1.0 - fx) * (1.0 - fy)
            + p10[c] * fx * (1.0 - fy)
            + p01[c] * (1.0 - fx) * fy
            + p11[c] * fx * fy;
        result[c] = v.round().clamp(0.0, 255.0) as u8;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_transform_when_landmarks_match_reference() {
        let aligner = FaceAligner::new(112);
        let src = FaceLandmarks { points: ARCFACE_REF_LANDMARKS_112 };
        let m = aligner.estimate_transform(&src);

        assert!((m.data[0][0] - 1.0).abs() < 1e-4, "a should be ~1");
        assert!((m.data[0][1]).abs() < 1e-4, "b should be ~0");
        assert!((m.data[0][2]).abs() < 1e-3, "tx should be ~0");
        assert!((m.data[1][0]).abs() < 1e-4, "c should be ~0");
        assert!((m.data[1][1] - 1.0).abs() < 1e-4, "d should be ~1");
        assert!((m.data[1][2]).abs() < 1e-3, "ty should be ~0");
    }

    #[test]
    fn scaled_landmarks_produce_correct_transform() {
        let aligner = FaceAligner::new(112);
        let mut pts = ARCFACE_REF_LANDMARKS_112;
        for pt in pts.iter_mut() {
            pt[0] *= 2.0;
            pt[1] *= 2.0;
        }
        let src = FaceLandmarks { points: pts };
        let m = aligner.estimate_transform(&src);

        assert!((m.data[0][0] - 0.5).abs() < 1e-3, "a should be ~0.5");
        assert!((m.data[1][1] - 0.5).abs() < 1e-3, "d should be ~0.5");
    }

    #[test]
    fn affine_inverse_roundtrip() {
        let aligner = FaceAligner::new(112);
        let src = FaceLandmarks {
            points: [
                [100.0, 120.0], [180.0, 118.0], [140.0, 160.0],
                [110.0, 200.0], [170.0, 198.0],
            ],
        };
        let m = aligner.estimate_transform(&src);
        let inv = invert_affine(&m);

        let warped = m.transform_point(src.points[0]);
        let recovered = inv.transform_point(warped);

        assert!((recovered[0] - src.points[0][0]).abs() < 0.1);
        assert!((recovered[1] - src.points[0][1]).abs() < 0.1);
    }
}
