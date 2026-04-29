use super::alignment::FaceAligner;
use super::{DetectedFace, FaceEmbedding, PipelineConfig, RecognitionResult};
use ort::session::Session;
use ort::value::Value;
use hnsw_rs::prelude::*;

/// The main recognition pipeline.
pub struct RecognitionPipeline {
    config: PipelineConfig,
    aligner: FaceAligner,
    scrfd_session: Session,
    arcface_session: Session,
    // HNSW index for fast vector search. 
    // We use L2 distance for ArcFace (buffalo_l).
    hnsw: Hnsw<'static, f32, DistL2>,
    // Maps HNSW internal IDs -> person_id from the database.
    enrolled_ids: Vec<i64>,
}

impl RecognitionPipeline {
    /// Initialize the pipeline with the given config and load models.
    pub fn new(config: PipelineConfig) -> Result<Self, String> {
        let aligner = FaceAligner::new(config.aligned_face_size);

        // 1. Load SCRFD (Detection)
        log::info!("Loading SCRFD model from: {:?}", std::path::PathBuf::from(&config.scrfd_model_path).canonicalize().unwrap_or_else(|_| std::path::PathBuf::from(&config.scrfd_model_path)));
        let scrfd_session = Session::builder()
            .map_err(|e: ort::Error| e.to_string())?
            .commit_from_file(&config.scrfd_model_path)
            .map_err(|e: ort::Error| format!("Failed to load SCRFD model at {}: {}", config.scrfd_model_path, e))?;

        // 2. Load ArcFace (Recognition)
        log::info!("Loading ArcFace model from: {:?}", std::path::PathBuf::from(&config.arcface_model_path).canonicalize().unwrap_or_else(|_| std::path::PathBuf::from(&config.arcface_model_path)));
        let arcface_session = Session::builder()
            .map_err(|e: ort::Error| e.to_string())?
            .commit_from_file(&config.arcface_model_path)
            .map_err(|e: ort::Error| format!("Failed to load ArcFace model at {}: {}", config.arcface_model_path, e))?;

        // 3. Initialize HNSW Index
        // 512 dimensions, max 16 connections per node, ef_construction 200
        let hnsw = Hnsw::new(16, 15000, 16, 200, DistL2 {});

        log::info!("RecognitionPipeline engine started successfully.");

        Ok(Self {
            config,
            aligner,
            scrfd_session,
            arcface_session,
            hnsw,
            enrolled_ids: Vec::new(),
        })
    }

    /// Enroll a face into the fast search index.
    pub fn enroll(&mut self, person_id: i64, embedding: FaceEmbedding) {
        let internal_id = self.enrolled_ids.len();
        self.hnsw.insert((&embedding as &[f32], internal_id));
        self.enrolled_ids.push(person_id);
    }

    /// Load embeddings from DB into the search index.
    pub fn enroll_batch(&mut self, entries: Vec<(i64, FaceEmbedding)>) {
        for (pid, emb) in entries {
            self.enroll(pid, emb);
        }
    }

    /// Rebuild the whole search index from scratch with a fresh batch of embeddings.
    /// This is used when face data is deleted or reset to ensure the in-memory state matches the DB.
    pub fn refresh_index(&mut self, entries: Vec<(i64, FaceEmbedding)>) {
        // We can't easily remove individual items from HNSW, so we create a new one.
        self.hnsw = Hnsw::new(16, 15000, 16, 200, DistL2 {});
        self.enrolled_ids.clear();
        self.enroll_batch(entries);
        log::info!("Face recognition index refreshed. {} active embeddings.", self.enrolled_ids.len());
    }

    /// Extract raw 512-dim embeddings for all faces found in a frame.
    pub fn extract_embeddings(&self, frame_rgb: &[u8], width: u32, height: u32) -> Result<Vec<FaceEmbedding>, String> {
        let detections = self.detect_faces(frame_rgb, width, height)?;
        let mut embeddings = Vec::new();

        for face in detections {
            let transform = self.aligner.estimate_transform(&face.landmarks);
            let aligned = self.aligner.warp_image(frame_rgb, width, height, &transform);
            embeddings.push(self.extract_embedding(&aligned)?);
        }

        Ok(embeddings)
    }

    /// Compute a single 'Golden Embedding' from multiple captures of the same person.
    /// This uses the 'Centroid' method: average all vectors and re-normalize.
    pub fn compute_centroid(embeddings: &[FaceEmbedding]) -> FaceEmbedding {
        let mut centroid = [0.0f32; 512];
        let count = embeddings.len() as f32;

        if count == 0.0 { return centroid; }

        for emb in embeddings {
            for i in 0..512 {
                centroid[i] += emb[i];
            }
        }

        // Divide by count and compute norm for re-normalization
        let mut norm = 0.0f32;
        for i in 0..512 {
            centroid[i] /= count;
            norm += centroid[i] * centroid[i];
        }
        
        norm = norm.sqrt();
        if norm > 0.0 {
            for i in 0..512 { centroid[i] /= norm; }
        }

        centroid
    }

    /// Get a reference to the aligner.
    pub fn aligner(&self) -> &FaceAligner {
        &self.aligner
    }

    /// Run detection and recognition on a frame.
    pub fn recognize_frame(
        &self,
        frame_rgb: &[u8],
        width: u32,
        height: u32,
    ) -> Result<Vec<RecognitionResult>, String> {
        // 1. Detect faces using SCRFD
        let detected = self.detect_faces(frame_rgb, width, height)?;

        let mut results = Vec::new();

        for face in detected {
            // 2. Align face (The Secret Sauce)
            let transform = self.aligner.estimate_transform(&face.landmarks);
            let aligned_rgb = self.aligner.warp_image(frame_rgb, width, height, &transform);

            // 3. Extract embedding using ArcFace
            let embedding = self.extract_embedding(&aligned_rgb)?;

            // 4. Vector Search using HNSW
            let neighbors = self.hnsw.search(&embedding, 1, 16);
            
            if let Some(best) = neighbors.first() {
                let person_id = self.enrolled_ids.get(best.d_id).copied();
                results.push(RecognitionResult {
                    person_id,
                    distance: best.distance,
                    is_match: best.distance < self.config.match_threshold,
                    bbox: Some(face.bbox),
                });
            } else {
                results.push(RecognitionResult {
                    person_id: None,
                    distance: f32::MAX,
                    is_match: false,
                    bbox: Some(face.bbox),
                });
            }
        }

        Ok(results)
    }

    /// Internal: Extract 512-dim vector from an aligned 112x112 RGB crop.
    /// Uses ort's built-in ndarray (which may differ from the workspace ndarray version)
    /// so we pass input via (shape, data) tuple and read output as a flat slice.
    pub fn extract_embedding(&self, aligned_rgb: &[u8]) -> Result<FaceEmbedding, String> {
        let size = self.config.aligned_face_size as usize;
        
        // Preprocessing: ArcFace expects (pixel - 127.5) / 128.0
        // Input shape: [1, 3, 112, 112]
        let total = 1 * 3 * size * size;
        let mut flat_data = Vec::with_capacity(total);
        
        // Build CHW layout: channel-first
        for c in 0..3usize {
            for y in 0..size {
                for x in 0..size {
                    let idx = (y * size + x) * 3 + c;
                    flat_data.push((aligned_rgb[idx] as f32 - 127.5) / 128.0);
                }
            }
        }

        let shape = vec![1usize, 3, size, size];
        let input_value = Value::from_array(
            (shape.as_slice(), flat_data.as_slice())
        ).map_err(|e: ort::Error| e.to_string())?;
        
        let input_map = ort::inputs![input_value]
            .map_err(|e: ort::Error| e.to_string())?;
        let outputs = self.arcface_session.run(input_map)
            .map_err(|e: ort::Error| e.to_string())?;
        
        // try_extract_tensor returns ArrayViewD<f32> in this ort version
        let output_view = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e: ort::Error| e.to_string())?;
        
        let mut embedding = [0.0f32; 512];
        let raw_iter = output_view.iter();
        for (i, &val) in raw_iter.enumerate() {
            if i >= 512 { break; }
            embedding[i] = val;
        }

        // L2 Normalization (Important for ArcFace distance consistency)
        let norm = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for i in 0..512 { embedding[i] /= norm; }
        }

        Ok(embedding)
    }

    /// Internal: Detect faces and landmarks.
    fn detect_faces(&self, frame_rgb: &[u8], width: u32, height: u32) -> Result<Vec<DetectedFace>, String> {
        // SCRFD 10G is usually exported with a fixed 640x640 input
        let det_size: usize = 640; 
        
        // Simple resize (nearest neighbor for speed) to 640x640
        let scale_x = width as f32 / det_size as f32;
        let scale_y = height as f32 / det_size as f32;

        // Build the input tensor as a flat Vec in CHW order
        let total = 1 * 3 * det_size * det_size;
        let mut flat_data = Vec::with_capacity(total);

        for c in 0..3usize {
            for y in 0..det_size {
                let py = (y as f32 * scale_y) as usize;
                let row_start = py * width as usize;
                for x in 0..det_size {
                    let px = (x as f32 * scale_x) as usize;
                    let idx = (row_start + px) * 3 + c;
                    flat_data.push((frame_rgb[idx] as f32 - 127.5) / 128.0);
                }
            }
        }

        let shape = vec![1usize, 3, det_size, det_size];
        let input_value = Value::from_array(
            (shape.as_slice(), flat_data.as_slice())
        ).map_err(|e: ort::Error| e.to_string())?;
        
        let input_map = ort::inputs![input_value]
            .map_err(|e: ort::Error| e.to_string())?;
        let outputs = self.scrfd_session.run(input_map)
            .map_err(|e: ort::Error| e.to_string())?;
        
        // Convert the 9 outputs (scores, bboxes, kps) to owned ndarray arrays.
        // We need owned data because try_extract_tensor returns views borrowing
        // from ValueRef which is short-lived in the iterator.
        let mut owned_arrays = Vec::new();
        for (idx, (_name, value)) in outputs.iter().enumerate() {
            let tensor_view = value
                .try_extract_tensor::<f32>()
                .map_err(|e: ort::Error| e.to_string())?;
            let shape = tensor_view.shape();
            log::info!("Output {} shape: {:?}", idx, shape);
            owned_arrays.push(tensor_view.into_dyn().to_owned());
        }

        // Create views from owned data for the decoder
        let output_views: Vec<ndarray::ArrayViewD<f32>> = owned_arrays.iter()
            .map(|a| a.view())
            .collect();

        log::info!("SCRFD model returned {} outputs", output_views.len());

        let decoder = super::detector::ScrfdDecoder::new(det_size as u32, det_size as u32, self.config.min_detection_confidence);
        let mut faces = decoder.decode(output_views);

        // Scale coordinates back to original frame size
        for face in &mut faces {
            face.bbox.x *= scale_x;
            face.bbox.y *= scale_y;
            face.bbox.w *= scale_x;
            face.bbox.h *= scale_y;
            for pt in &mut face.landmarks.points {
                pt[0] *= scale_x;
                pt[1] *= scale_y;
            }
        }

        Ok(faces)
    }
}
