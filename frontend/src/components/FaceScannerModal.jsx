import React, { useState, useEffect, useRef } from "react";
import { Camera, X, Loader2, UserCheck, ShieldAlert, UserPlus } from "lucide-react";
import { useFaceRecognition } from "../hooks/useFaceRecognition";
import { FaceEnrollmentModal } from "./FaceEnrollmentModal";
import { invoke } from "@tauri-apps/api/core";

export const FaceScannerModal = ({ onClose, onIdentify, scannerFunction }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [status, setStatus] = useState("Initializing camera...");
    const [faceBbox, setFaceBbox] = useState(null);
    const [showEnrollment, setShowEnrollment] = useState(false);
    
    // Camera selection state
    const [cameras, setCameras] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);

    const { identifyFace, isProcessing } = useFaceRecognition();
    const scanIntervalRef = useRef(null);

    // Fetch cameras on mount
    useEffect(() => {
        const getCameras = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(device => device.kind === 'videoinput');
                setCameras(videoDevices);
                if (videoDevices.length > 0) {
                    setSelectedCamera(videoDevices[0].deviceId);
                }
            } catch (err) {
                console.error("Error fetching cameras:", err);
            }
        };
        getCameras();
    }, []);

    useEffect(() => {
        let stream = null;

        const startCamera = async () => {
            if (!selectedCamera) return;
            
            try {
                setIsCameraReady(false);
                stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { 
                        deviceId: { exact: selectedCamera },
                        width: 640, 
                        height: 480 
                    } 
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    setIsCameraReady(true);
                    setStatus("Align your face within the frame");
                }
            } catch (err) {
                console.error("Error accessing webcam:", err);
                setStatus("Error: Webcam not found or access denied.");
            }
        };

        startCamera();

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [selectedCamera]);

    useEffect(() => {
        if (isCameraReady && !isProcessing) {
            // Start periodic scanning every 2.5 seconds
            scanIntervalRef.current = setInterval(performScan, 2500);
        } else {
            if (scanIntervalRef.current) {
                clearInterval(scanIntervalRef.current);
                scanIntervalRef.current = null;
            }
        }

        return () => {
            if (scanIntervalRef.current) {
                clearInterval(scanIntervalRef.current);
                scanIntervalRef.current = null;
            }
        };
    }, [isCameraReady, isProcessing]);

    const performScan = async () => {
        if (!videoRef.current || !canvasRef.current || isProcessing) return;

        const canvas = canvasRef.current;
        const video = videoRef.current;
        const context = canvas.getContext("2d");

        // Draw current frame to canvas
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to base64
        const base64Image = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];

        try {
            setStatus("Scanning...");
            const results = await identifyFace(base64Image);
            
            if (results && results.length > 0) {
                // Find the best match OR just the first face detected
                const match = results.find(r => r.is_match) || results[0];
                
                if (match && match.bbox) {
                    setFaceBbox(match.bbox);
                } else {
                    setFaceBbox(null);
                }

                if (match && match.is_match && match.person_id) {
                    setStatus("Face recognized! Logged in successfully.");
                    
                    // Stop scanning permanently for this session
                    if (scanIntervalRef.current) {
                        clearInterval(scanIntervalRef.current);
                        scanIntervalRef.current = null;
                    }
                    
                    // Get ID number and call onIdentify
                    try {
                        const idNumber = await invoke("get_id_number_from_person_id", { personId: match.person_id });
                        // Small delay for user to see the "Success" state
                        setTimeout(() => onIdentify(idNumber), 1500);
                    } catch (err) {
                        console.error("Failed to bridge person_id to id_number:", err);
                        setStatus("Error processing recognition result.");
                    }
                } else if (results.length > 0) {
                    setStatus("No match found. Keep looking at the camera.");
                } else {
                    setStatus("No face detected.");
                    setFaceBbox(null);
                }
            } else {
                setStatus("No face detected.");
                setFaceBbox(null);
            }
        } catch (err) {
            console.error("Identification error:", err);
            setStatus(err.toString().includes("ONNX models") 
                ? "Biometric system is being configured (Models missing). Please contact administrator." 
                : "Scanning error. Retrying...");
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
            <div className="relative flex flex-col items-center w-full max-w-[850px] px-4">
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-0 -right-12 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors border border-white/20 shadow-xl"
                >
                    <X className="w-6 h-6" />
                </button>

                {/* Camera Selector (Glassmorphism - Matching QR style) */}
                {cameras.length > 1 && (
                    <div className="mb-6 flex items-center bg-black/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 w-full max-w-[480px] shadow-lg animate-in slide-in-from-top-4 duration-300">
                        <Camera className="w-5 h-5 text-white/70 mr-3" />
                        <select 
                            className="bg-transparent text-white w-full outline-none focus:ring-0 appearance-none font-medium cursor-pointer"
                            value={selectedCamera || ''}
                            onChange={(e) => setSelectedCamera(e.target.value)}
                        >
                            {cameras.map(cam => (
                                <option key={cam.deviceId} value={cam.deviceId} className="bg-slate-900 text-white">
                                    {cam.label || `Camera ${cam.deviceId.substring(0, 5)}...`}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Video Container (Matching QR Overlay style) */}
                <div 
                    className={`w-full max-w-[800px] aspect-[4/3] overflow-hidden rounded-[3rem] bg-black border-[4px] transition-all duration-500 shadow-2xl relative ${
                        status.includes("recognized") 
                            ? 'border-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.6)] scale-[1.01]' 
                            : status.includes("Error") 
                                ? 'border-rose-500 shadow-[0_0_80px_rgba(244,63,94,0.5)]' 
                                : 'border-white/20'
                    }`}
                >
                    <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                        className={`w-full h-full object-cover transition-opacity duration-700 ${isCameraReady ? 'opacity-100' : 'opacity-0'}`}
                    />
                    
                    {/* Face Detection Frame Overlay */}
                    <div className="absolute inset-0 pointer-events-none">
                        {/* Rectangular Frame optimized for Face - Horizontal 4:3 (Dynamic) */}
                        <div 
                            style={{
                                position: 'absolute',
                                left: faceBbox ? `${(faceBbox.x / 640) * 100}%` : '50%',
                                top: faceBbox ? `${(faceBbox.y / 480) * 100}%` : '50%',
                                width: faceBbox ? `${(faceBbox.w / 640) * 100}%` : '480px',
                                height: faceBbox ? `${(faceBbox.h / 480) * 100}%` : '360px',
                                transform: faceBbox ? 'none' : 'translate(-50%, -50%)',
                                transition: 'all 0.3s ease-out',
                            }}
                            className={`border-2 rounded-[2rem] relative ${
                                status.includes("recognized") ? "border-emerald-400" : "border-white/30"
                            } ${!faceBbox ? 'opacity-20 animate-pulse' : 'opacity-100'}`}
                        >
                            {/* Corner Accents */}
                            <div className={`absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 -translate-x-1 -translate-y-1 rounded-tl-xl transition-colors ${status.includes("recognized") ? "border-emerald-400" : "border-blue-500"}`}></div>
                            <div className={`absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 translate-x-1 -translate-y-1 rounded-tr-xl transition-colors ${status.includes("recognized") ? "border-emerald-400" : "border-blue-500"}`}></div>
                            <div className={`absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 -translate-x-1 translate-y-1 rounded-bl-xl transition-colors ${status.includes("recognized") ? "border-emerald-400" : "border-blue-500"}`}></div>
                            <div className={`absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 translate-x-1 translate-y-1 rounded-br-xl transition-colors ${status.includes("recognized") ? "border-emerald-400" : "border-blue-500"}`}></div>
                            
                            {/* Scanning Animation */}
                            {!status.includes("recognized") && (
                                <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_20px_rgba(96,165,250,1)] animate-scan-move opacity-80"></div>
                            )}
                        </div>
                    </div>

                    {/* Camera Loading Overlay */}
                    {!isCameraReady && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 gap-4">
                            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                            <p className="text-zinc-400 font-medium animate-pulse">Initializing Biometrics...</p>
                        </div>
                    )}
                    
                    {/* Identification Badge */}
                    {isProcessing && (
                        <div className="absolute top-6 right-6 flex items-center gap-2 bg-blue-600/90 backdrop-blur-md px-4 py-2 rounded-full shadow-lg border border-white/20 animate-in fade-in zoom-in">
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                            <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Analyzing</span>
                        </div>
                    )}
                </div>

                {/* Status Card (Matching QR Overlay style) */}
                <div className="mt-8 text-center animate-in slide-in-from-bottom-6 bg-black/40 px-10 py-5 rounded-[2rem] border border-white/10 backdrop-blur-xl w-full max-w-[500px] shadow-2xl relative overflow-hidden min-h-[140px] flex flex-col justify-center">
                    {/* Success/Error Background Glows */}
                    {status.includes("recognized") && <div className="absolute inset-0 bg-emerald-500/10 animate-pulse pointer-events-none" />}
                    {status.includes("contact administrator") && <div className="absolute inset-0 bg-rose-500/10 animate-pulse pointer-events-none" />}
                    
                    <div className="relative z-10">
                        <h2 className="text-xl font-black text-white/40 uppercase tracking-[0.3em] mb-3">
                            Face ID Mode: {scannerFunction}
                        </h2>
                        
                        <div className="flex flex-col items-center gap-2">
                            <div className="flex items-center gap-3 justify-center">
                                {status.includes("contact administrator") ? (
                                    <ShieldAlert className="w-6 h-6 text-rose-400" />
                                ) : status.includes("recognized") ? (
                                    <UserCheck className="w-6 h-6 text-emerald-400 animate-bounce" />
                                ) : (
                                    <Camera className={`w-6 h-6 ${isProcessing ? 'text-blue-400' : 'text-white/60'}`} />
                                )}{" "}
                                <p className={`text-lg font-bold transition-all duration-300 ${
                                    status.includes("recognized") ? 'text-emerald-400' : 
                                    status.includes("contact administrator") ? 'text-rose-400 text-base leading-tight' : 'text-white'
                                }`}>
                                    {status}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Register Face Link */}
                <button
                    onClick={() => setShowEnrollment(true)}
                    className="mt-4 flex items-center gap-2 text-white/40 hover:text-blue-400 transition-colors text-sm font-medium group"
                >
                    <UserPlus className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span>Not registered? <span className="underline underline-offset-2">Register your face here</span></span>
                </button>
            </div>

            {/* Hidden capture canvas */}
            <canvas ref={canvasRef} width="640" height="480" className="hidden" />

            <style>{`
                @keyframes scan-move {
                    0% { top: 0%; opacity: 0.2; }
                    50% { opacity: 1; }
                    100% { top: 100%; opacity: 0.2; }
                }
                .animate-scan-move {
                    position: absolute;
                    animation: scan-move 3s ease-in-out infinite;
                }
            `}</style>

            {/* Face Enrollment Modal */}
            {showEnrollment && (
                <FaceEnrollmentModal 
                    onClose={() => setShowEnrollment(false)} 
                />
            )}
        </div>
    );
};
