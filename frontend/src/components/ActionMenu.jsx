import React, { useState, useEffect, useRef, useCallback } from "react";
import { Keyboard, QrCode, ScanFace, Users, LogIn, LogOut, ChevronLeft, ArrowRight, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QRScannerOverlay } from "./QRScannerOverlay";
import { VisitorPassPrinter } from "./VisitorPassPrinter";
import { FaceScannerModal } from "./FaceScannerModal";
import { extractScanId } from "../utils/patternHunter";
import { useGhostScannerListener } from "../hooks/useGhostScannerListener";
import { useToast } from "./toast/ToastProvider";

const ID_CARD_DURATION_MS = 1000;
const DETAILED_TOAST_ROLES = new Set(["student", "professor", "staff"]);

const formatRoleLabel = (role) => {
    if (Array.isArray(role)) {
        return role.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', ');
    }
    return role ? role.charAt(0).toUpperCase() + role.slice(1) : "---";
};

const getFullNameLabel = (person) => {
    if (!person) return "---";
    const middle = person.middle_name ? ` ${person.middle_name} ` : " ";
    return `${person.first_name}${middle}${person.last_name}`;
};

const getProgramYearLabel = (person) => {
    if (!person) return null;
    const program = person.program_name || person.program || "";
    const year = person.year_level ? ` Yr ${person.year_level}` : "";
    return program || year ? `${program}${year}` : null;
};

const getDetailedToastMessage = (scanDetails) => {
    if (!scanDetails) return "Scan processed.";
    const name = scanDetails.first_name ? `${scanDetails.first_name} ${scanDetails.last_name}` : "Unknown Person";
    const role = formatRoleLabel(scanDetails.role || scanDetails.roles);
    const context = scanDetails.department_name || scanDetails.program_name || "";
    return `${name} (${role})${context ? ` - ${context}` : ""}`;
};

export const ActionMenu = ({ view, setView, isGhostScannerDisabled = false, branding }) => {
    const isEntrance = view === 'action_entrance';
    const [showManualModal, setShowManualModal] = useState(false);
    const [showVisitorModal, setShowVisitorModal] = useState(false);
    const [manualId, setManualId] = useState("");
    const [showQRScanner, setShowQRScanner] = useState(false);
    const [showFaceScanner, setShowFaceScanner] = useState(false);
    const [showPrintModal, setShowPrintModal] = useState(false);
    const [printPassData, setPrintPassData] = useState(null);
    const [activeScanCard, setActiveScanCard] = useState(null);
    const audioContextRef = useRef(null);
    const isBackgroundScanRunningRef = useRef(false);
    const scanCardTimerRef = useRef(null);
    const scanCardRequestIdRef = useRef(0);
    const { showSuccess, showError, showWarning } = useToast();
    const isAnyModalOpen = showManualModal || showVisitorModal || showQRScanner || showFaceScanner || showPrintModal;

    const [visitorForm, setVisitorForm] = useState({
        firstName: '',
        middleName: '',
        lastName: '',
        email: '',
        contactNumber: '',
        purpose: '',
        personToVisit: ''
    });

    const clearScanCardTimer = useCallback(() => {
        if (scanCardTimerRef.current) {
            window.clearTimeout(scanCardTimerRef.current);
            scanCardTimerRef.current = null;
        }
    }, []);

    const showScanCard = useCallback((scanDetails) => {
        clearScanCardTimer();
        setActiveScanCard(scanDetails);
        scanCardTimerRef.current = window.setTimeout(() => {
            setActiveScanCard(null);
        }, ID_CARD_DURATION_MS);
    }, [clearScanCardTimer]);

    const dismissScanCard = useCallback(() => {
        clearScanCardTimer();
        setActiveScanCard(null);
    }, [clearScanCardTimer]);

    const showScanSuccessFeedback = useCallback(async ({
        result,
        scannedId,
        fallbackMessage,
        modalActive
    }) => {
        const roleLabel = result.role || (result.roles && result.roles.length > 0 ? result.roles[0] : "User");
        const successMessage = fallbackMessage || `${result.message} - ${result.person_name} (${roleLabel})`;
        const normalizedRole = (result.role || "").toString().trim().toLowerCase();
        const shouldShowDetailedToast = modalActive && DETAILED_TOAST_ROLES.has(normalizedRole);

        if (modalActive && !shouldShowDetailedToast) {
            showSuccess(successMessage);
            return;
        }

        const requestId = ++scanCardRequestIdRef.current;
        try {
            const details = await invoke("get_scan_person_details", { idNumber: scannedId });
            if (requestId !== scanCardRequestIdRef.current) {
                return;
            }

            if (details) {
                if (modalActive) {
                    showSuccess(getDetailedToastMessage(details));
                    return;
                }

                showScanCard(details);
                return;
            }
        } catch (error) {
            console.error("Failed to fetch scan person details:", error);
        }

        if (requestId === scanCardRequestIdRef.current) {
            showSuccess(successMessage);
        }
    }, [showSuccess, showScanCard]);

    const handleVisitorSubmit = async (e) => {
        e.preventDefault();
        try {
            const yearPart = new Date().getFullYear().toString().slice(-2);
            const randomPart = Math.floor(1000 + Math.random() * 9000).toString().padStart(4, '0');
            const generatedId = `VIS-${yearPart}${randomPart}`;
            
            await invoke('register_user', {
                role: "visitor",
                idNumber: generatedId,
                firstName: visitorForm.firstName,
                middleName: visitorForm.middleName || null,
                lastName: visitorForm.lastName,
                email: visitorForm.email,
                contactNumber: visitorForm.contactNumber,
                purpose: visitorForm.purpose,
                personToVisit: visitorForm.personToVisit,
                programId: null,
                yearLevel: null,
                departmentId: null,
                positionTitle: null,
                purpose: visitorForm.purpose,
                personToVisit: visitorForm.personToVisit
            });
            
            const result = await invoke('manual_id_entry', {
                idNumber: generatedId,
                scannerFunction: 'entrance'
            });
            
            if (result.success) {
                const normalizedVisitorName = `${visitorForm.firstName} ${visitorForm.lastName}`.replace(/\s+/g, " ").trim();
                const normalizedVisitorId = generatedId.trim().toUpperCase();
                const visitorData = {
                    id: normalizedVisitorId,
                    name: normalizedVisitorName,
                    visitor_id: normalizedVisitorId,
                    visitor_name: normalizedVisitorName,
                    email: visitorForm.email,
                    purpose: visitorForm.purpose,
                    person_to_visit: visitorForm.personToVisit
                };
                showSuccess(`Registration Successful: ${visitorData.name} (${generatedId}).`);
                setPrintPassData(visitorData);
                setShowPrintModal(true);
                
                if (visitorForm.email) {
                    invoke("send_visitor_qr", { idNumber: generatedId })
                        .catch(qrErr => console.error("Failed to send QR email:", qrErr));
                }
            } else {
                showError(result.message);
            }
        } catch (error) {
            console.error(error);
            showError(typeof error === 'string' ? error : "Failed to register visitor.");
        } finally {
            setShowVisitorModal(false);
            setVisitorForm({ firstName: '', middleName: '', lastName: '', email: '', contactNumber: '', purpose: '', personToVisit: '' });
        }
    };

    const handleManualSubmit = async (e) => {
        e.preventDefault();
        const submittedId = manualId;

        try {
            const scannerFunction = isEntrance ? 'entrance' : 'exit';
            const result = await invoke('manual_id_entry', {
                idNumber: submittedId,
                scannerFunction
            });

            if (result.success) {
                setShowManualModal(false);
                setManualId("");
                await showScanSuccessFeedback({
                    result,
                    scannedId: submittedId,
                    modalActive: false
                });
            } else {
                showError(result.message);
            }
        } catch (error) {
            console.error(error);
            showError("System Error. Failed to process ID.");
        } finally {
            setShowManualModal(false);
            setManualId("");
        }
    };

    useEffect(() => () => {
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => {});
        }
    }, []);

    useEffect(() => () => {
        clearScanCardTimer();
    }, [clearScanCardTimer]);

    useEffect(() => {
        if (!isAnyModalOpen) {
            return;
        }

        scanCardRequestIdRef.current += 1;
        clearScanCardTimer();
        setActiveScanCard(null);
    }, [clearScanCardTimer, isAnyModalOpen]);

    const playBackgroundBeep = useCallback(() => {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                return;
            }

            if (!audioContextRef.current) {
                audioContextRef.current = new AudioContextClass();
            }

            const ctx = audioContextRef.current;
            if (ctx.state === "suspended") {
                ctx.resume().catch(() => {});
            }

            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.type = "square";
            oscillator.frequency.setValueAtTime(1046, ctx.currentTime);

            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.start();
            oscillator.stop(ctx.currentTime + 0.14);
        } catch (error) {
            console.error("Failed to play background scanner beep:", error);
        }
    }, []);

    const processBackgroundScan = useCallback(async (rawString) => {
        if (isGhostScannerDisabled || isBackgroundScanRunningRef.current) {
            return;
        }

        const scannedId = extractScanId(rawString);
        if (!scannedId) {
            return;
        }

        isBackgroundScanRunningRef.current = true;
        try {
            const scannerFunction = isEntrance ? "entrance" : "exit";
            const result = await invoke("manual_id_entry", {
                idNumber: scannedId,
                scannerFunction
            });

            if (!result.success) {
                showError(result.message);
                return;
            }

            const actionWord = isEntrance ? "Logged In" : "Logged Out";
            const personName = result.person_name || scannedId;
            await showScanSuccessFeedback({
                result,
                scannedId,
                fallbackMessage: `Background Scan Success: ${personName} ${actionWord}.`,
                modalActive: isAnyModalOpen
            });
            playBackgroundBeep();

            if (manualId.trim().toUpperCase() === scannedId.toUpperCase()) {
                setManualId("");
            }
        } catch (error) {
            console.error("Background scanner processing failed:", error);
            showError("Background scanner failed. Please try scanning again.");
        } finally {
            isBackgroundScanRunningRef.current = false;
        }
    }, [
        isEntrance,
        isGhostScannerDisabled,
        isAnyModalOpen,
        manualId,
        playBackgroundBeep,
        showScanSuccessFeedback,
        showError
    ]);

    useGhostScannerListener({
        enabled: !isGhostScannerDisabled,
        onScanBuffer: processBackgroundScan
    });

    return (
        <div className="flex-1 flex flex-col w-full h-full p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Top Navigation */}
            <div className="flex flex-col items-center justify-center mb-12 relative w-full pt-4">
                {/* Enlarged Back Button */}
                <button
                    onClick={() => setView('main')}
                    className="flex items-center gap-3 px-6 py-3 bg-black/30 backdrop-blur-md border border-white/20 text-white rounded-xl hover:bg-black/40 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-white/20 shadow-lg group absolute left-0 top-0 z-10"
                >
                    <ChevronLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
                    <span className="font-semibold text-base tracking-wide">Main Menu</span>
                </button>

                {/* Centered Action Label (Pushed Down & Enlarged) */}
                <div className="flex flex-col items-center justify-center w-full pointer-events-none mt-16 gap-5">
                    <div className="p-5 bg-black/20 backdrop-blur-md rounded-full border border-white/10 shadow-inner drop-shadow-xl">
                        {isEntrance ? (
                            <LogIn className="w-16 h-16 text-blue-300" />
                        ) : (
                            <LogOut className="w-16 h-16 text-rose-300" />
                        )}
                    </div>
                    <h2 className="text-4xl md:text-5xl font-extrabold text-white tracking-wide drop-shadow-2xl text-center">
                        {isEntrance ? 'Incoming Registration' : 'Outgoing Registration'}
                    </h2>
                </div>
            </div>

            {/* Grid of Enlarged Action Cards (Glassmorphism) */}
            {isEntrance ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 flex-1 place-content-center items-center">
                    {/* Manually Input ID */}
                    <button
                        onClick={() => { setShowManualModal(true); }}
                        className="group relative flex items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-left focus:outline-none focus:ring-4 focus:ring-white/30 w-full h-full min-h-[160px]"
                    >
                        <div className="h-24 w-24 bg-white/10 text-white rounded-2xl flex items-center justify-center mr-8 group-hover:scale-110 group-hover:bg-white/20 group-hover:text-white transition-all duration-300 shadow-lg border border-white/20 flex-shrink-0">
                            <Keyboard className="w-12 h-12 drop-shadow-md" />
                        </div>
                        <div>
                            <h3 className="text-3xl font-bold text-white mb-2 drop-shadow-sm">Manual ID</h3>
                            <p className="text-white/70 text-lg">Type in a student or employee ID.</p>
                        </div>
                    </button>

                    {/* QR Scanner */}
                    <button 
                        onClick={() => setShowQRScanner(true)}
                        className="group relative flex items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-left focus:outline-none focus:ring-4 focus:ring-white/30 w-full h-full min-h-[160px]">
                        <div className="h-24 w-24 bg-white/10 text-white rounded-2xl flex items-center justify-center mr-8 group-hover:scale-110 group-hover:bg-white/20 group-hover:text-white transition-all duration-300 shadow-lg border border-white/20 flex-shrink-0">
                            <QrCode className="w-12 h-12 drop-shadow-md" />
                        </div>
                        <div>
                            <h3 className="text-3xl font-bold text-white mb-2 drop-shadow-sm">QR Scanner</h3>
                            <p className="text-white/70 text-lg">Scan digital ID codes.</p>
                        </div>
                    </button>

                    {/* Face Recognition */}
                    <button 
                        onClick={() => {
                            if (branding?.enable_face_recognition) {
                                setShowFaceScanner(true);
                            } else {
                                showWarning("Biometric verification is currently unavailable. Please contact the system administrator for support.");
                            }
                        }}
                        className="group relative flex items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-left focus:outline-none focus:ring-4 focus:ring-white/30 w-full h-full min-h-[160px]">
                        <div className="h-24 w-24 bg-white/10 text-white rounded-2xl flex items-center justify-center mr-8 group-hover:scale-110 group-hover:bg-white/20 group-hover:text-white transition-all duration-300 shadow-lg border border-white/20 flex-shrink-0">
                            <ScanFace className="w-12 h-12 drop-shadow-md" />
                        </div>
                        <div>
                            <h3 className="text-3xl font-bold text-white mb-2 drop-shadow-sm">Face Scan</h3>
                            <p className="text-white/70 text-lg">Automatically scan incoming faces.</p>
                        </div>
                    </button>

                    {/* Visitors */}
                    <button 
                        onClick={() => { 
                            setShowVisitorModal(true); 
                        }}
                        className="group relative flex items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-left focus:outline-none focus:ring-4 focus:ring-white/30 w-full h-full min-h-[160px]"
                    >
                        <div className="h-24 w-24 bg-white/10 text-white rounded-2xl flex items-center justify-center mr-8 group-hover:scale-110 group-hover:bg-white/20 group-hover:text-white transition-all duration-300 shadow-lg border border-white/20 flex-shrink-0">
                            <Users className="w-12 h-12 drop-shadow-md" />
                        </div>
                        <div>
                            <h3 className="text-3xl font-bold text-white mb-2 drop-shadow-sm">Visitors</h3>
                            <p className="text-white/70 text-lg">Register external guests temporarily.</p>
                        </div>
                    </button>
                </div>
            ) : (
                <div className="flex flex-col items-center gap-6 flex-1 justify-center w-full max-w-4xl mx-auto z-10">
                    <div className="flex flex-col sm:flex-row gap-6 w-full justify-center">
                        <div className="flex-1">
                            {/* Manually Input ID */}
                            <button
                                onClick={() => { setShowManualModal(true); }}
                                className="group relative flex items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-left focus:outline-none focus:ring-4 focus:ring-white/30 w-full h-full min-h-[160px]"
                            >
                                <div className="h-24 w-24 bg-white/10 text-white rounded-2xl flex items-center justify-center mr-8 group-hover:scale-110 group-hover:bg-white/20 group-hover:text-white transition-all duration-300 shadow-lg border border-white/20 flex-shrink-0">
                                    <Keyboard className="w-12 h-12 drop-shadow-md" />
                                </div>
                                <div>
                                    <h3 className="text-3xl font-bold text-white mb-2 drop-shadow-sm">Manual ID</h3>
                                    <p className="text-white/70 text-lg">Type in a student or employee ID.</p>
                                </div>
                            </button>
                        </div>
                        <div className="flex-1">
                            {/* QR Scanner */}
                            <button 
                                onClick={() => setShowQRScanner(true)}
                                className="group relative flex items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-left focus:outline-none focus:ring-4 focus:ring-white/30 w-full h-full min-h-[160px]">
                                <div className="h-24 w-24 bg-white/10 text-white rounded-2xl flex items-center justify-center mr-8 group-hover:scale-110 group-hover:bg-white/20 group-hover:text-white transition-all duration-300 shadow-lg border border-white/20 flex-shrink-0">
                                    <QrCode className="w-12 h-12 drop-shadow-md" />
                                </div>
                                <div>
                                    <h3 className="text-3xl font-bold text-white mb-2 drop-shadow-sm">QR Scanner</h3>
                                    <p className="text-white/70 text-lg">Scan digital ID codes.</p>
                                </div>
                            </button>
                        </div>
                    </div>
                    {/* Face Recognition (Bottom Row) */}
                    <div className="w-full sm:w-1/2 mx-auto justify-self-center">
                        <button 
                            onClick={() => {
                                if (branding?.enable_face_recognition) {
                                    setShowFaceScanner(true);
                                } else {
                                    showWarning("Biometric verification is currently unavailable. Please contact the system administrator for support.");
                                }
                            }}
                            className="group relative flex items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-left focus:outline-none focus:ring-4 focus:ring-white/30 w-full h-full min-h-[160px]">
                            <div className="h-24 w-24 bg-white/10 text-white rounded-2xl flex items-center justify-center mr-8 group-hover:scale-110 group-hover:bg-white/20 group-hover:text-white transition-all duration-300 shadow-lg border border-white/20 flex-shrink-0">
                                <ScanFace className="w-12 h-12 drop-shadow-md" />
                            </div>
                            <div>
                                <h3 className="text-3xl font-bold text-white mb-2 drop-shadow-sm">Face Scan</h3>
                                <p className="text-white/70 text-lg">Automatically scan incoming faces.</p>
                            </div>
                        </button>
                    </div>
                </div>
            )}

            {activeScanCard && (
                <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-4">
                    <div className="pointer-events-auto relative w-full max-w-2xl rounded-3xl border border-white/20 bg-black/80 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
                        <button
                            type="button"
                            onClick={dismissScanCard}
                            className="absolute right-4 top-4 rounded-lg p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                            aria-label="Close ID card"
                        >
                            <X className="h-5 w-5" />
                        </button>
                        <div className="mb-6">
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/85">
                                ID Card
                            </p>
                            <h3 className="mt-2 text-4xl font-extrabold text-white">
                                {getFullNameLabel(activeScanCard)}
                            </h3>
                        </div>
                        <div className="grid grid-cols-1 gap-4 text-base text-slate-100 sm:grid-cols-2">
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">Role</p>
                                <p className="mt-1 text-xl font-semibold">{formatRoleLabel(activeScanCard.role || activeScanCard.roles?.[0])}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">ID Number</p>
                                <p className="mt-1 text-xl font-semibold">{activeScanCard.id_number}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">Department</p>
                                <p className="mt-1 font-semibold">{activeScanCard.department_name || "---"}</p>
                            </div>
                            {getProgramYearLabel(activeScanCard) && (
                                <div>
                                    <p className="text-xs uppercase tracking-widest text-slate-300/80">Program & Year</p>
                                    <p className="mt-1 font-semibold text-cyan-200">
                                        {getProgramYearLabel(activeScanCard)}
                                    </p>
                                </div>
                            )}
                            {activeScanCard.position_title && (
                                <div>
                                    <p className="text-xs uppercase tracking-widest text-slate-300/80">Position Title</p>
                                    <p className="mt-1 font-semibold text-cyan-200">
                                        {activeScanCard.position_title}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Manual ID Modal */}
            {showManualModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md">
                    <div className="bg-black/80 backdrop-blur-2xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                        <div className="p-8">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="h-14 w-14 bg-white/10 rounded-2xl flex items-center justify-center text-white border border-white/20 shadow-inner">
                                    <Keyboard className="w-7 h-7" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-white tracking-wide">Enter ID Number</h2>
                                    <p className="text-white/60 text-sm">{isEntrance ? "Logging Incoming Request" : "Logging Outgoing Request"}</p>
                                </div>
                            </div>
                            <form onSubmit={handleManualSubmit}>
                                <input
                                    type="text"
                                    placeholder="e.g. 2026-00123"
                                    value={manualId}
                                    onChange={(e) => setManualId(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/50 mb-8 text-center tracking-widest uppercase transition-all"
                                    autoFocus
                                    required
                                />
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowManualModal(false)}
                                        className="flex-1 px-4 py-3 bg-white/5 border border-white/10 text-white/80 font-medium rounded-xl hover:bg-white/10 hover:text-white transition-all focus:outline-none"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="flex-[2] px-4 py-3 bg-white text-black font-bold rounded-xl hover:bg-slate-200 transition-all focus:outline-none focus:ring-4 focus:ring-white/30 flex items-center justify-center gap-2 text-lg shadow-lg"
                                    >
                                        Submit <ArrowRight className="w-5 h-5" />
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Visitor Registration Modal */}
            {showVisitorModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md">
                    <div className="bg-black/90 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-2xl overflow-y-auto max-h-[90vh] animate-in zoom-in-95 fade-in duration-200">
                        <div className="p-8">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="h-14 w-14 bg-white/10 rounded-2xl flex items-center justify-center text-white border border-white/20 shadow-inner">
                                    <Users className="w-7 h-7" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-white tracking-wide">Visitor Registration</h2>
                                    <p className="text-white/60 text-sm">Logging incoming guest to campus.</p>
                                </div>
                            </div>
                            <form onSubmit={handleVisitorSubmit} className="space-y-5">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                                    <div>
                                        <label className="block text-sm font-medium text-white/70 mb-1">First Name <span className="text-rose-500">*</span></label>
                                        <input required type="text" value={visitorForm.firstName} onChange={e => setVisitorForm({...visitorForm, firstName: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" placeholder="Juan" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-white/70 mb-1">Middle Name</label>
                                        <input type="text" value={visitorForm.middleName} onChange={e => setVisitorForm({...visitorForm, middleName: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" placeholder="Optional" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-white/70 mb-1">Last Name <span className="text-rose-500">*</span></label>
                                        <input required type="text" value={visitorForm.lastName} onChange={e => setVisitorForm({...visitorForm, lastName: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" placeholder="Dela Cruz" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-5">
                                    <div>
                                        <label className="block text-sm font-medium text-white/70 mb-1">Email <span className="text-rose-500">*</span></label>
                                        <input required type="email" value={visitorForm.email} onChange={e => setVisitorForm({...visitorForm, email: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" placeholder="juan@example.com" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-white/70 mb-1">Contact Number</label>
                                        <input type="text" value={visitorForm.contactNumber} onChange={e => setVisitorForm({...visitorForm, contactNumber: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" placeholder="09xxxxxxxxx" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-5">
                                    <div>
                                        <label className="block text-sm font-medium text-white/70 mb-1">Person to Visit <span className="text-rose-500">*</span></label>
                                        <input required type="text" value={visitorForm.personToVisit} onChange={e => setVisitorForm({...visitorForm, personToVisit: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" placeholder="Prof. Smith" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-white/70 mb-1">Purpose of Visit <span className="text-rose-500">*</span></label>
                                        <input required type="text" value={visitorForm.purpose} onChange={e => setVisitorForm({...visitorForm, purpose: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" placeholder="Meeting / Delivery" />
                                    </div>
                                </div>
                                
                                <div className="flex gap-4 pt-6 mt-4 border-t border-white/10">
                                    <button type="button" onClick={() => setShowVisitorModal(false)} className="flex-1 px-4 py-3 bg-white/5 border border-white/10 text-white/80 font-medium rounded-xl hover:bg-white/10 hover:text-white transition-all focus:outline-none">Cancel</button>
                                    <button type="submit" className="flex-[2] px-4 py-3 bg-white text-black font-bold rounded-xl hover:bg-slate-200 transition-all focus:outline-none focus:ring-4 focus:ring-white/30 flex items-center justify-center gap-2 text-lg shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_30px_rgba(255,255,255,0.4)]">Complete Registration <ArrowRight className="w-5 h-5" /></button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
            {/* QR Scanner Modal */}
            {showQRScanner && (
                <QRScannerOverlay
                    scannerFunction={isEntrance ? 'entrance' : 'exit'}
                    onClose={() => setShowQRScanner(false)}
                    onScan={async (scannedId, error) => {
                        setShowQRScanner(false);
                        
                        if (error || !scannedId) {
                            showError(error || "Invalid scan target.");
                            return;
                        }

                        try {
                            const result = await invoke('manual_id_entry', {
                                idNumber: scannedId,
                                scannerFunction: isEntrance ? 'entrance' : 'exit'
                            });

                            if (result.success) {
                                await showScanSuccessFeedback({
                                    result,
                                    scannedId,
                                    modalActive: false
                                });
                            } else {
                                showError(result.message);
                            }
                        } catch (error) {
                            console.error(error);
                            showError("System Error. Failed to process ID.");
                        }
                    }}
                />
            )}

            {/* Face Scanner Modal */}
            {showFaceScanner && (
                <FaceScannerModal
                    scannerFunction={isEntrance ? 'entrance' : 'exit'}
                    onClose={() => setShowFaceScanner(false)}
                    onIdentify={async (scannedId) => {
                        setShowFaceScanner(false);
                        try {
                            const result = await invoke('manual_id_entry', {
                                idNumber: scannedId,
                                scannerFunction: isEntrance ? 'entrance' : 'exit'
                            });

                            if (result.success) {
                                await showScanSuccessFeedback({
                                    result,
                                    scannedId,
                                    modalActive: false
                                });
                            } else {
                                showError(result.message);
                            }
                        } catch (error) {
                            console.error(error);
                            showError("System Error. Failed to process identified face.");
                        }
                    }}
                />
            )}

            {/* Print Visitor Pass Modal */}
            {showPrintModal && printPassData && (
                <VisitorPassPrinter
                    visitorData={printPassData}
                    onClose={() => {
                        setShowPrintModal(false);
                        setPrintPassData(null);
                    }}
                />
            )}

        </div>
    );
};
