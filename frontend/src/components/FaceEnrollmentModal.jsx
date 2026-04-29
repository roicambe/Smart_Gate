import React, { useState, useEffect, useRef } from "react";
import { Camera, X, Loader2, UserPlus, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { useFaceRecognition } from "../hooks/useFaceRecognition";
import { invoke } from "@tauri-apps/api/core";

const REQUIRED_CAPTURES = 5;

export const FaceEnrollmentModal = ({ onClose }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [isCameraReady, setIsCameraReady] = useState(false);

    // Camera selection
    const [cameras, setCameras] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);

    // Flow state: 'id_entry' -> 'capturing' -> 'enrolling' -> 'done'
    const [step, setStep] = useState('id_entry');
    const [idNumber, setIdNumber] = useState('');
    const [personId, setPersonId] = useState(null);
    const [personName, setPersonName] = useState('');
    const [captures, setCaptures] = useState([]);
    const [error, setError] = useState(null);
    const [isLocalProcessing, setIsLocalProcessing] = useState(false);

    const { enrollPerson, isProcessing: isHookProcessing } = useFaceRecognition();
    const isProcessing = isLocalProcessing || isHookProcessing;

    // Fetch cameras on mount
    useEffect(() => {
        const getCameras = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(d => d.kind === 'videoinput');
                setCameras(videoDevices);
                if (videoDevices.length > 0) setSelectedCamera(videoDevices[0].deviceId);
            } catch (err) {
                console.error("Error fetching cameras:", err);
            }
        };
        getCameras();
    }, []);

    // Start camera when entering capture step
    useEffect(() => {
        let stream = null;
        if (step !== 'capturing' && step !== 'enrolling') return;
        if (!selectedCamera) return;

        const startCamera = async () => {
            try {
                setIsCameraReady(false);
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: selectedCamera }, width: 640, height: 480 }
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    setIsCameraReady(true);
                }
            } catch (err) {
                console.error("Camera error:", err);
                setError("Could not access webcam.");
            }
        };
        startCamera();

        return () => {
            if (stream) stream.getTracks().forEach(t => t.stop());
        };
    }, [step, selectedCamera]);

    const handleIdLookup = async (e) => {
        e.preventDefault();
        setError(null);
        try {
            const details = await invoke('get_scan_person_details', { idNumber: idNumber.trim() });
            if (details) {
                setPersonId(details.person_id);
                setPersonName(`${details.first_name} ${details.last_name}`);
                setStep('capturing');
            } else {
                setError("No person found with that ID number. Please check and try again.");
            }
        } catch (err) {
            console.error(err);
            setError(typeof err === 'string' ? err : "Failed to look up ID.");
        }
    };

    const captureFrame = () => {
        if (!videoRef.current || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const video = videoRef.current;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", 0.9);
        setCaptures(prev => [...prev, base64]);
    };

    const handleEnroll = async () => {
        setIsLocalProcessing(true);
        setStep('enrolling');
        setError(null);
        try {
            const cleanImages = captures.map(img =>
                img.replace(/^data:image\/[a-z]+;base64,/, "")
            );
            await invoke("enroll_person_face", {
                personId,
                imagesBase64: cleanImages,
            });
            setStep('done');
        } catch (err) {
            console.error("Enrollment error:", err);
            setError(typeof err === 'string' ? err : "Enrollment failed. Please try again.");
            setStep('capturing');
        } finally {
            setIsLocalProcessing(false);
        }
    };

    // Keyboard shortcut for Enter key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                if (step === 'capturing' && captures.length < REQUIRED_CAPTURES && isCameraReady) {
                    e.preventDefault();
                    captureFrame();
                } else if (step === 'capturing' && captures.length === REQUIRED_CAPTURES && !isProcessing) {
                    e.preventDefault();
                    handleEnroll();
                } else if (step === 'done') {
                    onClose();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [step, captures.length, isCameraReady, isProcessing, onClose]);

    const removeCapture = (index) => {
        setCaptures(prev => prev.filter((_, i) => i !== index));
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
            <div className="relative flex flex-col items-center w-full max-w-[850px] px-4">
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-0 -right-16 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors border border-white/20 shadow-xl"
                >
                    <X className="w-6 h-6" />
                </button>

                {/* ===== STEP 1: ID Entry (Matching Manual ID Modal) ===== */}
                {step === 'id_entry' && (
                    <div className="w-full max-w-md animate-in zoom-in-95 fade-in duration-200">
                        <div className="bg-black/80 backdrop-blur-2xl border border-white/20 rounded-3xl shadow-2xl overflow-hidden">
                            <div className="p-8">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="h-14 w-14 bg-white/10 rounded-2xl flex items-center justify-center text-white border border-white/20 shadow-inner">
                                        <UserPlus className="w-7 h-7" />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-white tracking-wide">Register Your Face</h2>
                                        <p className="text-white/60 text-sm">Enter your University ID to begin</p>
                                    </div>
                                </div>
                                <form onSubmit={handleIdLookup}>
                                    <input
                                        type="text"
                                        placeholder="e.g. 2026-00123"
                                        value={idNumber}
                                        onChange={(e) => setIdNumber(e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/50 mb-4 text-center tracking-widest uppercase transition-all"
                                        autoFocus
                                        required
                                    />

                                    {error && (
                                        <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 mb-4">
                                            <AlertTriangle className="w-4 h-4 shrink-0" />
                                            <span>{error}</span>
                                        </div>
                                    )}

                                    <div className="flex gap-3">
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            className="flex-1 px-4 py-3 bg-white/5 border border-white/10 text-white/80 font-medium rounded-xl hover:bg-white/10 hover:text-white transition-all focus:outline-none"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            className="flex-[2] px-4 py-3 bg-white text-black font-bold rounded-xl hover:bg-slate-200 transition-all focus:outline-none focus:ring-4 focus:ring-white/30 flex items-center justify-center gap-2 text-lg shadow-lg"
                                        >
                                            Continue <ArrowRight className="w-5 h-5" />
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                )}

                {/* ===== STEP 2: Capture Photos ===== */}
                {(step === 'capturing' || step === 'enrolling') && (
                    <div className="w-full flex flex-col items-center animate-in slide-in-from-bottom-6 duration-300 max-h-[90vh] overflow-y-auto no-scrollbar">
                        {/* Compact Floating Guidance */}
                        <div className="mb-4 flex items-center gap-3 bg-blue-600/20 backdrop-blur-md px-6 py-2 rounded-full border border-blue-500/30 shadow-lg animate-in fade-in zoom-in duration-500">
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                            <p className="text-blue-100 text-sm font-black uppercase tracking-[0.2em]">
                                {captures.length === 0 && "Look straight"}
                                {captures.length === 1 && "Turn slightly left"}
                                {captures.length === 2 && "Turn slightly right"}
                                {captures.length >= 3 && captures.length < REQUIRED_CAPTURES && "Stay in frame"}
                                {captures.length === REQUIRED_CAPTURES && "Perfect! Registering..."}
                            </p>
                        </div>

                        {/* Person Info (Compact) */}
                        <div className="mb-4 flex flex-col items-center">
                            <h2 className="text-white text-2xl font-black tracking-tight leading-none mb-1">{personName}</h2>
                            <div className="flex items-center gap-2">
                                <span className="text-white/30 text-[10px] uppercase font-bold tracking-[0.2em]">University ID</span>
                                <span className="text-white/60 font-mono text-xs bg-white/5 px-2 py-0.5 rounded-md border border-white/5">{idNumber}</span>
                            </div>
                        </div>

                        {/* Camera Selector (Styled like Scanner) */}
                        {cameras.length > 1 && (
                            <div className="mb-4 flex items-center bg-black/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 w-full max-w-[400px] shadow-lg">
                                <Camera className="w-4 h-4 text-white/50 mr-3" />
                                <select
                                    className="bg-transparent text-white text-sm w-full outline-none focus:ring-0 appearance-none font-medium cursor-pointer"
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

                        {/* Camera Feed */}
                        <div className="w-full max-w-[800px] aspect-[4/3] overflow-hidden rounded-[3rem] bg-black border-[4px] border-white/20 shadow-2xl relative">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className={`w-full h-full object-cover transition-opacity duration-500 ${isCameraReady ? 'opacity-100' : 'opacity-0'}`}
                            />

                            {!isCameraReady && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 gap-3">
                                    <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                                    <p className="text-zinc-400 animate-pulse">Starting camera...</p>
                                </div>
                            )}
                        </div>

                        {/* Progress Indicators */}
                        <div className="mt-5 flex items-center gap-2">
                            {Array.from({ length: REQUIRED_CAPTURES }).map((_, i) => (
                                <div
                                    key={i}
                                    className={`group relative w-12 h-12 rounded-xl border-2 overflow-hidden transition-all duration-300 ${
                                        i < captures.length
                                            ? 'border-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.4)]'
                                            : 'border-white/10'
                                    }`}
                                >
                                    {captures[i] ? (
                                        <>
                                            <img src={captures[i]} alt="" className="w-full h-full object-cover" />
                                            {/* Individual Delete Button on Hover */}
                                            <button
                                                onClick={() => removeCapture(i)}
                                                className="absolute inset-0 bg-rose-500/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Remove this photo"
                                            >
                                                <X className="w-5 h-5 text-white" />
                                            </button>
                                        </>
                                    ) : (
                                        <div className="w-full h-full bg-white/5 flex items-center justify-center">
                                            <span className="text-white/20 text-xs font-bold">{i + 1}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        <p className="text-white/50 text-sm mt-2 font-medium">
                            {captures.length} / {REQUIRED_CAPTURES} photos captured
                        </p>

                        {/* Action Buttons */}
                        <div className="mt-4 flex gap-3 w-full max-w-[800px]">
                            {captures.length < REQUIRED_CAPTURES ? (
                                <button
                                    onClick={captureFrame}
                                    disabled={!isCameraReady}
                                    className="flex-1 flex flex-col items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-white/10 disabled:text-white/30 text-white font-bold py-2.5 rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 shadow-lg shadow-blue-600/25"
                                >
                                    <div className="flex items-center gap-2">
                                        <Camera className="w-4 h-4" />
                                        <span className="text-base uppercase tracking-tight">Capture ({captures.length + 1}/{REQUIRED_CAPTURES})</span>
                                    </div>
                                    <span className="text-[9px] opacity-60 font-black uppercase tracking-widest">Press Enter</span>
                                </button>
                            ) : (
                                <button
                                    onClick={handleEnroll}
                                    disabled={isProcessing}
                                    className="flex-1 flex flex-col items-center justify-center bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/10 disabled:text-white/30 text-white font-bold py-2.5 rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-emerald-500/30 shadow-lg shadow-emerald-600/25"
                                >
                                    {isProcessing ? (
                                        <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Processing...</div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2"><UserPlus className="w-4 h-4" /> <span className="text-base uppercase tracking-tight">Register Face</span></div>
                                            <span className="text-[9px] opacity-60 font-black uppercase tracking-widest">Confirm Enrollment</span>
                                        </>
                                    )}
                                </button>
                            )}
                        </div>

                        {/* Error Message Area (Compact) */}
                        <div className="mt-4 min-h-[40px] w-full max-w-[800px] flex items-center justify-center">
                            {error && (
                                <div className="flex items-center gap-3 text-rose-400 text-[11px] bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-2 w-full animate-in zoom-in-95 duration-200">
                                    <AlertTriangle className="w-4 h-4 shrink-0" />
                                    <span className="font-bold uppercase tracking-wide">
                                        {error.includes("ONNX models") 
                                            ? "System Configuration Required (Missing Models)" 
                                            : error}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ===== STEP 3: Done ===== */}
                {step === 'done' && (
                    <div className="w-full max-w-md animate-in zoom-in-95 duration-300">
                        <div className="bg-black/50 backdrop-blur-xl rounded-[2rem] border border-emerald-500/30 p-10 shadow-2xl text-center">
                            <div className="mx-auto w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6">
                                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">Face Registered!</h2>
                            <p className="text-white/60 mb-2">
                                <span className="font-semibold text-white">{personName}</span>'s face has been enrolled successfully.
                            </p>
                            <p className="text-white/40 text-sm mb-8">
                                You can now use Face Scan for entry and exit.
                            </p>
                            <button
                                onClick={onClose}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-emerald-500/30 shadow-lg"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Hidden canvas */}
            <canvas ref={canvasRef} width="640" height="480" className="hidden" />
        </div>
    );
};
