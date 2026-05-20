import React, { useState, useEffect, useRef, useCallback } from "react";
import { Keyboard, QrCode, ScanFace, Users, LogIn, LogOut, ChevronLeft, ArrowRight, X, Lock, Unlock } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QRScannerOverlay } from "./QRScannerOverlay";
import { VisitorPassPrinter } from "./VisitorPassPrinter";
import { FaceScannerModal } from "./FaceScannerModal";
import { extractScanId } from "../utils/patternHunter";
import { useGhostScannerListener } from "../hooks/useGhostScannerListener";
import { useToast } from "./toast/ToastProvider";
import { useIdCard } from "./IdCardProvider";
import { SuffixCombobox } from "./common/SuffixCombobox";
import { 
    formatRoleLabel, 
    getFullNameLabel, 
    formatIdNumber, 
    formatName, 
    getProgramYearLabel 
} from "../utils/formatters";
import { ManualIdModal } from "./common/ManualIdModal";
import { PersonCombobox } from "./common/PersonCombobox";

const getDetailedToastMessage = (scanDetails) => {
    if (!scanDetails) return "Scan processed.";
    const name = scanDetails.first_name ? `${scanDetails.first_name} ${scanDetails.last_name}` : "Unknown Person";
    const role = formatRoleLabel(scanDetails.role || scanDetails.roles);
    const context = scanDetails.department_name || scanDetails.program_name || "";
    return `${name} (${role})${context ? ` - ${context}` : ""}`;
};

export const ActionMenu = ({ view, setView, isGhostScannerDisabled = false, branding, adminSession }) => {
    const isEntrance = view === 'action_entrance';
    const [showManualModal, setShowManualModal] = useState(false);
    const [showVisitorModal, setShowVisitorModal] = useState(false);
    const [showQrScanner, setShowQrScanner] = useState(false);
    const [showFaceScanner, setShowFaceScanner] = useState(false);
    const [showPrintModal, setShowPrintModal] = useState(false);
    const [printPassData, setPrintPassData] = useState(null);
    const [isManualLocked, setIsManualLocked] = useState(false);
    const [isScannerLocked, setIsScannerLocked] = useState(false);
    const audioContextRef = useRef(null);
    const isBackgroundScanRunningRef = useRef(false);
    const scanCardRequestIdRef = useRef(0);
    const { showSuccess, showError, showWarning } = useToast();
    const { showIdCard, dismissIdCard } = useIdCard();
    const isAnyModalOpen = showManualModal || showVisitorModal || showQrScanner || showFaceScanner || showPrintModal;

    const [visitorForm, setVisitorForm] = useState({
        firstName: '',
        middleName: '',
        lastName: '',
        suffix: '',
        email: '',
        contactNumber: '',
        purpose: '',
        personToVisit: ''
    });

    const showScanSuccessFeedback = useCallback(async ({
        result,
        scannedId,
        fallbackMessage,
        modalActive
    }) => {
        const roleLabel = result.role || (result.roles && result.roles.length > 0 ? result.roles[0] : "User");
        const successMessage = fallbackMessage || `${result.message} - ${result.person_name} (${roleLabel})`;
        const normalizedRole = (result.role || "").toString().trim().toLowerCase();


        const requestId = ++scanCardRequestIdRef.current;
        try {
            const details = await invoke("get_scan_person_details", { idNumber: scannedId });
            if (requestId !== scanCardRequestIdRef.current) {
                return;
            }

            if (details) {
                if (modalActive) {
                    const messageText = fallbackMessage || `${result.message} - ${getDetailedToastMessage(details)}`;
                    showSuccess(messageText);
                } else {
                    showIdCard(details);
                }
                return;
            }
        } catch (error) {
            console.error("Failed to fetch scan person details:", error);
        }

        if (requestId === scanCardRequestIdRef.current) {
            showSuccess(successMessage);
        }
    }, [showSuccess, showIdCard]);

    const handleVisitorSubmit = async (e) => {
        e.preventDefault();
        try {
            const randomPart = Math.floor(10000 + Math.random() * 90000).toString();
            const generatedId = `VIS-${randomPart}`;
            
            await invoke('register_user', {
                roles: ["visitor"],
                idNumber: generatedId,
                firstName: visitorForm.firstName,
                middleName: visitorForm.middleName || null,
                lastName: visitorForm.lastName,
                suffix: visitorForm.suffix || null,
                email: visitorForm.email?.trim() || null,
                contactNumber: visitorForm.contactNumber?.trim() || null,
                programId: null,
                yearLevel: null,
                isIrregular: false,
                departmentId: null,
                positionTitle: null,
                isPartTime: false,
                purpose: visitorForm.purpose,
                personToVisit: visitorForm.personToVisit,
                isActive: true,
                activeAdminId: adminSession?.account_id || null
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
                    email: visitorForm.email?.trim() || null,
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
            if (!isManualLocked) {
                setShowVisitorModal(false);
                setVisitorForm({ firstName: '', middleName: '', lastName: '', suffix: '', email: '', contactNumber: '', purpose: '', personToVisit: '' });
            }
        }
    };

    const handleManualSubmit = async (submittedId) => {

        try {
            const scannerFunction = isEntrance ? 'entrance' : 'exit';
            const result = await invoke('manual_id_entry', {
                idNumber: submittedId,
                scannerFunction
            });

            if (result.success) {
                // Determine if we are staying in modal mode (locked) or closing to show ID card
                const isStillActive = isManualLocked || showVisitorModal || showQrScanner || showFaceScanner || showPrintModal;

                if (!isManualLocked) {
                    setShowManualModal(false);
                }
                
                // Use a short timeout to allow the modal state change to propagate
                setTimeout(() => {
                    showScanSuccessFeedback({
                        result,
                        scannedId: submittedId,
                        modalActive: isStillActive
                    });
                }, isManualLocked ? 0 : 300);
            } else {
                showError(result.message);
            }
        } catch (error) {
            console.error(error);
            showError("System Error. Failed to process ID.");
        } finally {
            if (!isManualLocked) {
                setShowManualModal(false);
            }
        }
    };

    useEffect(() => () => {
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => {});
        }
    }, []);

    useEffect(() => () => {
        dismissIdCard();
    }, [dismissIdCard]);

    useEffect(() => {
        if (!isAnyModalOpen) {
            return;
        }

        scanCardRequestIdRef.current += 1;
        dismissIdCard();
    }, [dismissIdCard, isAnyModalOpen]);

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
                        onClick={() => setShowQrScanner(true)}
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
                                onClick={() => setShowQrScanner(true)}
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

            {/* Global ID Card is now managed by IdCardProvider */}

            {/* Manual ID Modal */}
            <ManualIdModal
                isOpen={showManualModal}
                onClose={() => setShowManualModal(false)}
                onSubmit={handleManualSubmit}
                isLocked={isManualLocked}
                onToggleLock={() => setIsManualLocked(!isManualLocked)}
                subtitle={isEntrance ? "Logging Incoming Request" : "Logging Outgoing Request"}
            />

            {/* Visitor Registration Modal */}
            {showVisitorModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md">
                    <div className="bg-black/90 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-4xl overflow-y-auto max-h-[90vh] animate-in zoom-in-95 fade-in duration-200">
                        <div className="p-8">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="h-14 w-14 bg-white/10 rounded-2xl flex items-center justify-center text-white border border-white/20 shadow-inner">
                                    <Users className="w-7 h-7" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-white tracking-wide">Visitor Registration</h2>
                                    <p className="text-white/60 text-sm">Logging incoming guest to campus.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsManualLocked(!isManualLocked)}
                                    className={`ml-auto p-2 rounded-xl border transition-all ${
                                        isManualLocked 
                                            ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' 
                                            : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'
                                    }`}
                                    title={isManualLocked ? "Unlock Modal" : "Lock Modal"}
                                >
                                    {isManualLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
                                </button>
                            </div>
                            <form onSubmit={handleVisitorSubmit} className="space-y-5">
                                <div className="grid grid-cols-11 gap-5">
                                    <div className="col-span-11 sm:col-span-3">
                                        <label className="block text-sm font-medium text-white/70 mb-1">First Name <span className="text-rose-500">*</span></label>
                                        <input 
                                            required 
                                            type="text" 
                                            value={visitorForm.firstName} 
                                            onChange={e => setVisitorForm({...visitorForm, firstName: formatName(e.target.value)})} 
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" 
                                            placeholder="Juan" 
                                        />
                                    </div>
                                    <div className="col-span-11 sm:col-span-3">
                                        <label className="block text-sm font-medium text-white/70 mb-1">Middle Name</label>
                                        <input 
                                            type="text" 
                                            value={visitorForm.middleName} 
                                            onChange={e => setVisitorForm({...visitorForm, middleName: formatName(e.target.value)})} 
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" 
                                            placeholder="Optional" 
                                        />
                                    </div>
                                    <div className="col-span-11 sm:col-span-3">
                                        <label className="block text-sm font-medium text-white/70 mb-1">Last Name <span className="text-rose-500">*</span></label>
                                        <input 
                                            required 
                                            type="text" 
                                            value={visitorForm.lastName} 
                                            onChange={e => setVisitorForm({...visitorForm, lastName: formatName(e.target.value)})} 
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50" 
                                            placeholder="Dela Cruz" 
                                        />
                                    </div>
                                    <div className="col-span-11 sm:col-span-2">
                                        <label className="block text-sm font-medium text-white/70 mb-1">Suffix</label>
                                        <SuffixCombobox
                                            value={visitorForm.suffix}
                                            onChange={val => setVisitorForm({...visitorForm, suffix: val})}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50"
                                        />
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
                                        <PersonCombobox
                                            required
                                            value={visitorForm.personToVisit}
                                            onChange={val => setVisitorForm({...visitorForm, personToVisit: val})}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-slate-400/50"
                                            placeholder="Type a name to search..."
                                        />
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
            {showQrScanner && (
                <QRScannerOverlay 
                    isOpen={showQrScanner}
                    onClose={() => setShowQrScanner(false)}
                    onScanSuccess={(scannedId) => {
                        setShowQrScanner(false);
                    }}
                    scannerFunction={isEntrance ? 'entrance' : 'exit'}
                    isLocked={isScannerLocked}
                    onToggleLock={() => setIsScannerLocked(!isScannerLocked)}
                    onScan={async (scannedId, error) => {
                        if (!isScannerLocked) {
                            setShowQrScanner(false);
                        }
                        
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
                                const isStillActive = isScannerLocked || showManualModal || showVisitorModal || showFaceScanner || showPrintModal;
                                await showScanSuccessFeedback({
                                    result,
                                    scannedId,
                                    modalActive: isStillActive
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
                    isLocked={isScannerLocked}
                    onToggleLock={() => setIsScannerLocked(!isScannerLocked)}
                    onClose={() => setShowFaceScanner(false)}
                    isPaused={showManualModal || showVisitorModal || showQrScanner || showPrintModal}
                    onIdentify={async (scannedId) => {
                        if (!isScannerLocked) {
                            setShowFaceScanner(false);
                        }
                        try {
                            const result = await invoke('manual_id_entry', {
                                idNumber: scannedId,
                                scannerFunction: isEntrance ? 'entrance' : 'exit'
                            });

                            if (result.success) {
                                const isStillActive = isScannerLocked || showManualModal || showVisitorModal || showQrScanner || showPrintModal;
                                await showScanSuccessFeedback({
                                    result,
                                    scannedId,
                                    modalActive: isStillActive
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
