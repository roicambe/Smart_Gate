import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback } from "react";

/**
 * Custom hook for face recognition operations.
 * Wraps the Tauri IPC commands into clean, reusable functions.
 */
export const useFaceRecognition = () => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);

    /**
     * Identifies a person from a single base64 image frame.
     * Used at the gate for real-time scanning.
     */
    const identifyFace = useCallback(async (base64Image) => {
        setIsProcessing(true);
        setError(null);
        try {
            // Remove data:image/...;base64, prefix if present
            const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, "");
            const results = await invoke("identify_person_face", {
                imageBase64: cleanBase64,
            });
            return results;
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Face identification failed.');
            return [];
        } finally {
            setIsProcessing(false);
        }
    }, []);

    /**
     * Enrolls a person using multiple captured images (centroid method).
     * @param {number} personId - The person's database ID.
     * @param {string[]} images - Array of base64-encoded images.
     */
    const enrollPerson = useCallback(async (personId, images) => {
        setIsProcessing(true);
        setError(null);
        try {
            const cleanImages = images.map(img =>
                img.replace(/^data:image\/[a-z]+;base64,/, "")
            );
            await invoke("enroll_person_face", {
                personId,
                imagesBase64: cleanImages,
            });
            return true;
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Face enrollment failed.');
            return false;
        } finally {
            setIsProcessing(false);
        }
    }, []);

    return { identifyFace, enrollPerson, isProcessing, error };
};
