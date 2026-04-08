import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera } from 'lucide-react';
import { extractScanId } from '../utils/patternHunter';

export const QRScannerOverlay = ({ onScan, onClose, scannerFunction }) => {
    const [status, setStatus] = useState("Initializing camera...");
    const [isSuccess, setIsSuccess] = useState(false);
    
    // Camera selection state
    const [cameras, setCameras] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);
    
    const scannerRef = useRef(null);
    const lockedRef = useRef(false);
    
    // Stable reference to onScan to avoid infinite re-renders
    const onScanRef = useRef(onScan);
    useEffect(() => {
        onScanRef.current = onScan;
    }, [onScan]);

    // Fetch available cameras on mount
    useEffect(() => {
        let isMounted = true;
        Html5Qrcode.getCameras().then(devices => {
            if (isMounted && devices && devices.length > 0) {
                setCameras(devices);
                // Prefer 'back' or 'environment' camera if available
                const envCam = devices.find(c => 
                    c.label.toLowerCase().includes('back') || 
                    c.label.toLowerCase().includes('environment')
                );
                setSelectedCamera(envCam ? envCam.id : devices[0].id);
            } else if (isMounted) {
                setStatus("No cameras found.");
            }
        }).catch(err => {
            console.error("Error getting cameras", err);
            if (isMounted) setStatus("Camera permission denied.");
        });

        return () => { isMounted = false; };
    }, []);

    // Main initialization logic
    const startScanner = useCallback(async (cameraId) => {
        // Prevent concurrent setup
        if (scannerRef.current && scannerRef.current.isScanning) {
            await scannerRef.current.stop().catch(console.error);
            scannerRef.current.clear();
        } else if (scannerRef.current && scannerRef.current.getState && scannerRef.current.getState() !== 1) {
            scannerRef.current.clear();
        }

        lockedRef.current = false;
        const html5QrCode = new Html5Qrcode("qr-reader");
        scannerRef.current = html5QrCode;

        const config = {
            fps: 25,
            qrbox: { width: 340, height: 340 }, // Increased from 280 to 340
            aspectRatio: 1.0,
            useBarCodeDetectorIfSupported: false,
        };

        try {
            await html5QrCode.start(
                cameraId, 
                config,
                (decodedText) => {
                    if (lockedRef.current) return;

                    // Regex Extraction Logic through Pattern Hunter
                    const extractedId = extractScanId(decodedText);

                    if (extractedId) {
                        lockedRef.current = true;
                        setIsSuccess(true);
                        setStatus("QR Code detected!");

                        setTimeout(() => {
                            if (onScanRef.current) {
                                onScanRef.current(extractedId);
                            }
                            setIsSuccess(false);
                        }, 500);
                    } else {
                        // Invalid match
                        lockedRef.current = true;
                        if (onScanRef.current) {
                            onScanRef.current(null, "Invalid ID Format: No University ID detected.");
                        }
                    }
                },
                (errorMessage) => {
                    // Ignore generic scanning errors
                }
            );
            setStatus("Align QR code within the frame");
        } catch(err) {
            console.error("Camera start failed:", err);
            setStatus("Failed to start camera feed.");
            scannerRef.current = null;
        }
    }, []);

    // Re-run scanner when selectedCamera changes
    useEffect(() => {
        if (!selectedCamera) return;
        
        let isMounted = true;
        
        const init = async () => {
            if (isMounted) {
                setStatus("Starting camera feed...");
                await startScanner(selectedCamera);
            }
        };
        
        init();

        return () => {
            isMounted = false;
        };
    }, [selectedCamera, startScanner]);

    // Complete teardown on unmount
    useEffect(() => {
        return () => {
             if (scannerRef.current) {
                 if (scannerRef.current.isScanning) {
                     scannerRef.current.stop().then(() => {
                         scannerRef.current.clear();
                     }).catch(console.error);
                 } else if (scannerRef.current.getState && scannerRef.current.getState() !== 1) {
                     scannerRef.current.clear();
                 }
             }
        };
    }, []);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="relative flex flex-col items-center w-full max-w-xl mt-4 px-4">
                <button
                    onClick={onClose}
                    className="absolute -top-16 right-4 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors border border-white/20 shadow-xl"
                >
                    <X className="w-6 h-6" />
                </button>

                {/* Camera Selector (Glassmorphism) */}
                {cameras.length > 1 && (
                    <div className="mb-6 flex items-center bg-black/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 w-full max-w-[420px] shadow-lg">
                        <Camera className="w-5 h-5 text-white/70 mr-3" />
                        <select 
                            className="bg-transparent text-white w-full outline-none focus:ring-0 appearance-none font-medium cursor-pointer"
                            value={selectedCamera || ''}
                            onChange={(e) => setSelectedCamera(e.target.value)}
                        >
                            {cameras.map(cam => (
                                <option key={cam.id} value={cam.id} className="bg-slate-900 text-white">
                                    {cam.label || `Camera ${cam.id.substring(0, 5)}...`}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Video container overrides html5-qrcode default styling to have nice borders */}
                {/* Increased max-width from 360px to 420px */}
                <div 
                    id="qr-reader" 
                    className={`w-full max-w-[420px] overflow-hidden rounded-[2rem] bg-black border-[4px] transition-all duration-300 shadow-2xl relative ${
                        isSuccess ? 'border-emerald-500 shadow-[0_0_40px_rgba(16,185,129,0.5)] scale-[1.02]' : 'border-white/20'
                    }`}
                ></div>

                <div className="mt-8 text-center animate-in slide-in-from-bottom-4 bg-black/40 px-8 py-4 rounded-3xl border border-white/10 backdrop-blur-md w-full max-w-[420px]">
                    <h2 className="text-2xl font-bold text-white tracking-wide mb-2">
                        {scannerFunction === 'entrance' ? 'Incoming Registration' : 'Outgoing Registration'}
                    </h2>
                    <p className={`text-lg transition-colors ${
                        isSuccess ? 'text-emerald-400 font-bold' : 'text-white/70 font-medium'
                    }`}>
                        {status}
                    </p>
                </div>
            </div>
            
            <style jsx="true">{`
                /* Hide the default HTML5-QRCode HTML overlays as we want a cleaner look */
                #qr-reader img {
                    display: none !important;
                }
                #qr-reader video {
                    object-fit: cover !important;
                    border-radius: 1.75rem !important;
                }
                #qr-reader__dashboard_section_csr span,
                #qr-reader__dashboard_section_csr button {
                    display: none !important;
                }
            `}</style>
        </div>
    );
};
