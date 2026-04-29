// ============================================================================
// Smart Gate — Face Recognition Module
// ============================================================================
//
// Architecture Overview:
//   1. Detection  (SCRFD)     → finds faces + 5-point landmarks in a frame
//   2. Alignment  (Affine)    → warps the face so eyes are at fixed coordinates
//   3. Embedding  (ArcFace)   → produces a 512-dim vector from the aligned face
//   4. Search     (HNSW)      → finds the nearest known vector in < 5 ms
//
// This module is intentionally **model-agnostic** at this stage.
// All ONNX loading is deferred to `pipeline.rs`.
// The math in `alignment.rs` works with any 5-point landmark detector.
// ============================================================================

pub mod alignment;
pub mod pipeline;
pub mod detector;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Core types shared across submodules
// ---------------------------------------------------------------------------

/// The 5 canonical facial landmarks produced by SCRFD (or any compatible
/// detector).  Coordinates are in **pixel space** of the source image.
///
/// ```text
///   0: left eye center
///   1: right eye center
///   2: nose tip
///   3: left mouth corner
///   4: right mouth corner
/// ```
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FaceLandmarks {
    /// `[x, y]` pairs for each of the 5 landmarks.
    pub points: [[f32; 2]; 5],
}

/// Axis-aligned bounding box around a detected face.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FaceBoundingBox {
    /// Top-left x (pixels).
    pub x: f32,
    /// Top-left y (pixels).
    pub y: f32,
    /// Width (pixels).
    pub w: f32,
    /// Height (pixels).
    pub h: f32,
    /// Detection confidence in `[0.0, 1.0]`.
    pub confidence: f32,
}

/// A single detected face in a frame — everything you need before alignment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedFace {
    pub bbox: FaceBoundingBox,
    pub landmarks: FaceLandmarks,
}

/// A 512-dimensional ArcFace embedding.  
/// Stored as a fixed-size array so it can live on the stack and be copied
/// cheaply between the alignment and search stages.
pub type FaceEmbedding = [f32; 512];

/// Result of a face recognition search against the HNSW index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecognitionResult {
    /// The `person_id` from the `persons` table, if a match was found.
    pub person_id: Option<i64>,
    /// Euclidean distance to the closest vector.  Lower = more similar.
    /// Typical ArcFace threshold: **0.4** (cosine) or **1.1** (L2).
    pub distance: f32,
    /// Whether the distance passed the configured threshold.
    pub is_match: bool,
    /// The bounding box of the detected face (pixels relative to original image).
    pub bbox: Option<FaceBoundingBox>,
}

/// Configuration knobs for the full pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineConfig {
    /// Path to the SCRFD `.onnx` model file.
    pub scrfd_model_path: String,
    /// Path to the ArcFace `.onnx` model file.
    pub arcface_model_path: String,
    /// L2 distance threshold.  Pairs below this value are considered a match.
    /// Recommended starting point: **1.1** for L2, **0.4** for cosine.
    pub match_threshold: f32,
    /// Minimum detection confidence to accept a face from SCRFD.
    pub min_detection_confidence: f32,
    /// Output size of the aligned face crop (width = height).
    /// ArcFace expects **112×112**.
    pub aligned_face_size: u32,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            scrfd_model_path: String::from("models/det_2.5g.onnx"),
            arcface_model_path: String::from("models/w600k_r50.onnx"),
            match_threshold: 1.1,
            min_detection_confidence: 0.3,
            aligned_face_size: 112,
        }
    }
}
