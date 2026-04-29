use super::{DetectedFace, FaceBoundingBox, FaceLandmarks};
use ndarray::ArrayViewD;

/// Strides and anchor settings for the SCRFD 10G model.
const STRIDES: [usize; 3] = [8, 16, 32];
const ANCHORS_PER_STRIDE: usize = 2;

/// Decodes raw SCRFD tensors into human-readable face detections.
pub struct ScrfdDecoder {
    input_width: u32,
    input_height: u32,
    score_threshold: f32,
}

impl ScrfdDecoder {
    pub fn new(width: u32, height: u32, score_threshold: f32) -> Self {
        Self {
            input_width: width,
            input_height: height,
            score_threshold,
        }
    }

    /// Decodes the multi-scale outputs from the SCRFD model.
    pub fn decode(&self, outputs: Vec<ArrayViewD<f32>>) -> Vec<DetectedFace> {
        let mut candidates = Vec::new();

        // Helper to get value from 2D or 3D tensor
        let get_val = |tensor: &ArrayViewD<f32>, idx: usize, c: usize| -> f32 {
            match tensor.ndim() {
                3 => tensor[[0, idx, c]],
                2 => tensor[[idx, c]],
                _ => 0.0
            }
        };

        // SCRFD models typically return 6 or 9 outputs grouped by stride (8, 16, 32)
        // [Score_8, Score_16, Score_32, BBox_8, BBox_16, BBox_32, (optional KPS_8, KPS_16, KPS_32)]
        for (idx, &stride) in STRIDES.iter().enumerate() {
            if outputs.len() <= idx + 3 { break; }
            
            let score_tensor = &outputs[idx];
            let bbox_tensor = &outputs[idx + 3];
            let kps_tensor = if outputs.len() >= 9 { Some(&outputs[idx + 6]) } else { None };

            let feat_h = self.input_height as usize / stride;
            let feat_w = self.input_width as usize / stride;

            let mut anchor_idx = 0;
            for y in 0..feat_h {
                for x in 0..feat_w {
                    for _ in 0..ANCHORS_PER_STRIDE {
                        // Check bounds to be safe
                        let max_idx = score_tensor.shape()[if score_tensor.ndim() == 3 { 1 } else { 0 }];
                        if anchor_idx >= max_idx { break; }

                        let score = get_val(score_tensor, anchor_idx, 0);

                        if score > self.score_threshold {
                            // 1. Decode Bounding Box
                            let dx1 = get_val(bbox_tensor, anchor_idx, 0) * stride as f32;
                            let dy1 = get_val(bbox_tensor, anchor_idx, 1) * stride as f32;
                            let dx2 = get_val(bbox_tensor, anchor_idx, 2) * stride as f32;
                            let dy2 = get_val(bbox_tensor, anchor_idx, 3) * stride as f32;

                            let cx = x as f32 * stride as f32;
                            let cy = y as f32 * stride as f32;

                            let x1 = cx - dx1;
                            let y1 = cy - dy1;
                            let x2 = cx + dx2;
                            let y2 = cy + dy2;

                            // 2. Decode 5-point Landmarks (KPS) if available
                            let mut points = [[0.0f32; 2]; 5];
                            if let Some(kt) = kps_tensor {
                                for p in 0..5 {
                                    let px = get_val(kt, anchor_idx, p * 2) * stride as f32 + cx;
                                    let py = get_val(kt, anchor_idx, p * 2 + 1) * stride as f32 + cy;
                                    points[p] = [px, py];
                                }
                            } else {
                                // Mock landmarks (not ideal for alignment, but better than crashing)
                                points = [
                                    [x1 + (x2-x1)*0.3, y1 + (y2-y1)*0.4],
                                    [x1 + (x2-x1)*0.7, y1 + (y2-y1)*0.4],
                                    [x1 + (x2-x1)*0.5, y1 + (y2-y1)*0.6],
                                    [x1 + (x2-x1)*0.3, y1 + (y2-y1)*0.8],
                                    [x1 + (x2-x1)*0.7, y1 + (y2-y1)*0.8],
                                ];
                            }

                            candidates.push(DetectedFace {
                                bbox: FaceBoundingBox {
                                    x: x1,
                                    y: y1,
                                    w: x2 - x1,
                                    h: y2 - y1,
                                    confidence: score,
                                },
                                landmarks: FaceLandmarks { points },
                            });
                        }
                        anchor_idx += 1;
                    }
                }
            }
        }

        self.non_maximum_suppression(candidates)
    }

    /// Filters overlapping boxes so we don't detect the same face twice.
    fn non_maximum_suppression(&self, mut candidates: Vec<DetectedFace>) -> Vec<DetectedFace> {
        candidates.sort_by(|a, b| b.bbox.confidence.partial_cmp(&a.bbox.confidence).unwrap());
        
        let mut result = Vec::new();
        let mut suppressed = vec![false; candidates.len()];

        for i in 0..candidates.len() {
            if suppressed[i] { continue; }
            
            let master = &candidates[i];
            result.push(master.clone());

            for j in (i + 1)..candidates.len() {
                if suppressed[j] { continue; }
                
                if self.iou(&master.bbox, &candidates[j].bbox) > 0.45 {
                    suppressed[j] = true;
                }
            }
        }

        result
    }

    /// Intersection over Union calculation.
    fn iou(&self, a: &FaceBoundingBox, b: &FaceBoundingBox) -> f32 {
        let x1 = a.x.max(b.x);
        let y1 = a.y.max(b.y);
        let x2 = (a.x + a.w).min(b.x + b.w);
        let y2 = (a.y + a.h).min(b.y + b.h);

        let intersection = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
        let area_a = a.w * a.h;
        let area_b = b.w * b.h;

        intersection / (area_a + area_b - intersection)
    }
}
