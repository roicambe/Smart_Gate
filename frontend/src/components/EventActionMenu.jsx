import React, { useState, useEffect } from "react";
import { Keyboard, QrCode, ScanFace, ChevronLeft, ArrowRight, Calendar } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QRScannerOverlay } from "./QRScannerOverlay";
import { extractScanId } from "../utils/patternHunter";
import { useToast } from "./toast/ToastProvider";

export const EventActionMenu = ({ setView }) => {
    const [showManualModal, setShowManualModal] = useState(false);
    const [showQrScanner, setShowQrScanner] = useState(false);
    const [manualId, setManualId] = useState("");
    const [events, setEvents] = useState([]);
    const [programs, setPrograms] = useState([]);
    const [selectedEventId, setSelectedEventId] = useState(null);
    const [isProcessingScanner, setIsProcessingScanner] = useState(false);
    const [flashGreen, setFlashGreen] = useState(false);
    const { showSuccess, showError, showWarning, showProcessing } = useToast();

    const isModalOpen = showManualModal || showQrScanner;

    const getLocalDateKey = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const toDateOnly = (dateText) => {
        if (!dateText || typeof dateText !== 'string') return null;
        const [year, month, day] = dateText.split('-').map((part) => parseInt(part, 10));
        if (!year || !month || !day) return null;
        return new Date(year, month - 1, day);
    };

    const playSuccessBeep = () => {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.1);
        } catch(e) { console.error("Audio beep failed", e); }
    };

    useEffect(() => {
        const fetchEvents = async () => {
            try {
                const data = await invoke('get_events');
                const now = new Date();
                const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
                const currentDate = getLocalDateKey(now);
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const currentTime = `${hours}:${minutes}`;
                const currentDateObj = toDateOnly(currentDate);

                const activeEvents = data.filter(e => {
                    if (!e.is_enabled) return false;
                    
                    let isCorrectDay = false;
                    if (e.schedule_type === 'date_range') {
                        const startDateObj = toDateOnly(e.start_date);
                        const endDateObj = toDateOnly(e.end_date);
                        isCorrectDay = Boolean(
                            currentDateObj &&
                            startDateObj &&
                            endDateObj &&
                            currentDateObj >= startDateObj &&
                            currentDateObj <= endDateObj
                        );
                    } else {
                        const days = e.event_date ? e.event_date.split(',').map(d => d.trim().toLowerCase()) : [];
                        isCorrectDay = 
                            days.includes(currentDate.toLowerCase()) ||
                            days.includes(currentDay.toLowerCase()) ||
                            days.includes(`every ${currentDay.toLowerCase()}`) ||
                            days.includes('everyday');
                    }
                    
                    const isToday = isCorrectDay;
                    const hasEnded = currentTime > e.end_time;
                    
                    // Show all events that are for today and haven't ended yet
                    return isToday && !hasEnded;
                });
                
                setEvents(activeEvents);
                
                // Default to Flag Ceremony or first active event
                const defaultEvent = activeEvents.find(e => e.event_name.toLowerCase().includes('flag ceremony')) || activeEvents[0];
                if (defaultEvent) {
                    setSelectedEventId(defaultEvent.event_id);
                }
            } catch (error) {
                console.error("Failed to fetch events", error);
            }
        };
        const fetchPrograms = async () => {
            try {
                const data = await invoke('get_programs');
                setPrograms(data);
            } catch (error) {
                console.error(error);
            }
        };
        fetchEvents();
        fetchPrograms();
    }, []);

    const handleManualSubmit = async (e) => {
        e.preventDefault();

        if (!selectedEventId) {
            showWarning("No active event selected.");
            return;
        }

        try {
            const result = await invoke('log_event_attendance', {
                eventId: parseInt(selectedEventId, 10),
                idNumber: manualId
            });

            if (result.success) {
                showSuccess(`Attendance Recorded: ${result.message} - ${result.person_name} (${result.role})`);
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

    const handleQrScan = async (scannedId) => {
        if (!selectedEventId) {
            showWarning("No active event selected.");
            return;
        }

        try {
            const result = await invoke('log_event_attendance', {
                eventId: parseInt(selectedEventId, 10),
                idNumber: scannedId
            });

            if (result.success) {
                const eventName = events.find(e => e.event_id === parseInt(selectedEventId, 10))?.event_name || 'Event';
                showSuccess(`Attendance Recorded: ${eventName} - ${result.person_name} (${result.role})`);
                
                playSuccessBeep();
                setFlashGreen(true);
                setTimeout(() => setFlashGreen(false), 300);
            } else {
                showError(result.message);
            }
        } catch (error) {
            console.error(error);
            showError("System Error. Failed to process ID.");
        }
    };

    // --- Keyboard Wedge Listener Logic ---
    useEffect(() => {
        let buffer = "";
        let lastKeyTime = Date.now();
        let timeoutId = null;

        const handleFocusIn = () => {
            buffer = "";
        };
        window.addEventListener("focusin", handleFocusIn);

        const processWedgeInput = async (rawString) => {
            const scannedId = extractScanId(rawString);

            if (!scannedId) {
                showError("Invalid ID Format: No University ID detected.");
                return;
            }

            if (!selectedEventId) {
                showWarning("Please select an event first.");
                return;
            }

            setIsProcessingScanner(true);
            showProcessing("Processing event scan...");
            
            // Clean up any stray input in case the manual modal was open
            setManualId("");
            setShowManualModal(false);

            await handleQrScan(scannedId);

            setTimeout(() => setIsProcessingScanner(false), 500); 
        };

        const handleKeyDown = (e) => {
            if (isProcessingScanner) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const activeEl = document.activeElement;
            const isInputActive = activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName);

            if (isModalOpen || isInputActive) {
                buffer = "";
                return;
            }

            const currentTime = Date.now();
            const timeDiff = currentTime - lastKeyTime;
            lastKeyTime = currentTime;

            if (timeDiff > 30 && buffer.length > 0) {
                buffer = "";
            }

            if (e.key === "Enter") {
                if (buffer.length >= 5) { 
                    e.preventDefault();
                    e.stopPropagation();
                    processWedgeInput(buffer);
                }
                buffer = "";
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                buffer += e.key;
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    buffer = "";
                }, 500);
            }
        };

        window.addEventListener("keydown", handleKeyDown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleKeyDown, { capture: true });
            window.removeEventListener("focusin", handleFocusIn);
            clearTimeout(timeoutId);
        };
    }, [isProcessingScanner, isModalOpen, selectedEventId, events]);

    const currentEvent = events.find(e => e.event_id === parseInt(selectedEventId, 10));

    const getFormatRole = (role) => {
        if (!role || role.toLowerCase().includes('all')) return 'All Roles';
        return role.split(',').map(r => r.trim().charAt(0).toUpperCase() + r.trim().slice(1)).join(', ');
    };

    const getFormatPrograms = (programsStr) => {
        if (!programsStr || programsStr.toLowerCase().includes('all')) return 'All Programs';
        const ids = programsStr.split(',').map(id => id.trim());
        return ids.map(id => {
            const prog = programs.find(p => p.program_id.toString() === id);
            return prog ? prog.program_code : id;
        }).join(', ');
    };

    const getFormatYearLevels = (ylStr) => {
        if (!ylStr || ylStr.toLowerCase().includes('all')) return 'All Year Levels';
        return ylStr.split(',').map(y => {
            const val = y.trim();
            return `${val}${['st', 'nd', 'rd', 'th'][parseInt(val, 10) - 1] || 'th'} Year`;
        }).join(', ');
    };

    return (
        <div className="flex-1 flex flex-col w-full h-full p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
            
            {/* Green Flash Overlay */}
            {flashGreen && (
                <div className="absolute inset-0 z-[200] bg-emerald-500/30 pointer-events-none animate-in fade-in duration-75 fade-out duration-300"></div>
            )}

            {/* Top Navigation */}
            <div className="flex flex-col items-center justify-center mb-12 relative w-full pt-4">
                <button
                    onClick={() => setView('main')}
                    className="flex items-center gap-3 px-6 py-3 bg-black/30 backdrop-blur-md border border-white/20 text-white rounded-xl hover:bg-black/40 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-white/20 shadow-lg group absolute left-0 top-0 z-10"
                >
                    <ChevronLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
                    <span className="font-semibold text-base tracking-wide">Main Menu</span>
                </button>

                <div className="flex flex-col items-center justify-center w-full pointer-events-none mt-16 gap-5">
                    <div className="p-5 bg-black/20 backdrop-blur-md rounded-full border border-white/10 shadow-inner drop-shadow-xl">
                        <Calendar className="w-16 h-16 text-slate-300" />
                    </div>
                    <h2 className="text-4xl md:text-5xl font-extrabold text-white tracking-wide drop-shadow-2xl text-center">
                        Event Check-in
                    </h2>
                </div>
            </div>

            {/* Event Selection Dropdown */}
            {events.length > 0 ? (
                <div className="w-full max-w-xl mx-auto mb-10 pointer-events-auto space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-white mb-2 pl-1 drop-shadow-sm">Select Active Event</label>
                        <div className="relative">
                            <select
                                value={selectedEventId || ''}
                                onChange={(e) => setSelectedEventId(e.target.value ? parseInt(e.target.value, 10) : null)}
                                className="w-full appearance-none bg-white border-2 border-slate-300 text-slate-900 rounded-xl px-6 py-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 hover:border-slate-400 transition-all text-lg font-bold shadow-sm cursor-pointer"
                            >
                                {events.map(ev => {
                                    const now = new Date();
                                    const hours = String(now.getHours()).padStart(2, '0');
                                    const minutes = String(now.getMinutes()).padStart(2, '0');
                                    const currentTime = `${hours}:${minutes}`;
                                    const isActive = currentTime >= ev.start_time && currentTime <= ev.end_time;
                                    
                                    return (
                                        <option key={ev.event_id} value={ev.event_id} className="bg-white text-slate-900 font-medium py-2">
                                            {isActive ? '🟢 [ACTIVE] ' : '🕒 [UPCOMING] '} {ev.event_name} ({ev.start_time} - {ev.end_time})
                                        </option>
                                    );
                                })}
                            </select>
                            <div className="absolute inset-y-0 right-0 flex items-center px-6 pointer-events-none">
                                <ArrowRight className="w-6 h-6 rotate-90 text-slate-400" />
                            </div>
                        </div>
                    </div>
                    
                    {currentEvent && (
                        <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-2xl p-5 animate-in slide-in-from-top-2 duration-300">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                <div className="space-y-1">
                                    <p className="text-white/50 font-medium uppercase tracking-wider text-[10px]">Required Roles</p>
                                    <p className="text-white font-bold">{getFormatRole(currentEvent.required_role)}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-white/50 font-medium uppercase tracking-wider text-[10px]">Schedule</p>
                                    <p className="text-white font-bold">{currentEvent.start_time} - {currentEvent.end_time}</p>
                                </div>
                                {(currentEvent.required_role.includes('all') || currentEvent.required_role.includes('student')) && (
                                    <>
                                        <div className="space-y-1">
                                            <p className="text-white/50 font-medium uppercase tracking-wider text-[10px]">Target Programs</p>
                                            <p className="text-white font-medium text-xs bg-white/5 px-2 py-1 rounded inline-block">{getFormatPrograms(currentEvent.required_programs)}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-white/50 font-medium uppercase tracking-wider text-[10px]">Target Year Levels</p>
                                            <p className="text-white font-medium text-xs bg-white/5 px-2 py-1 rounded inline-block">{getFormatYearLevels(currentEvent.required_year_levels)}</p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="w-full max-w-xl mx-auto mb-10 text-center p-4 bg-rose-500/20 border border-rose-500/30 rounded-2xl backdrop-blur-sm shadow-xl">
                    <p className="text-rose-200 font-medium">No active events found. Please enable an event in Admin Panel.</p>
                </div>
            )}

            {/* Actions Grid */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8 flex-1 place-content-center items-center ${events.length === 0 ? 'opacity-50 pointer-events-none' : ''}`}>
                <button
                    onClick={() => { setShowManualModal(true); }}
                    className="group relative flex flex-col justify-center items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-center focus:outline-none focus:ring-4 focus:ring-white/30 h-[220px]"
                >
                    <div className="h-20 w-20 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300 shadow-lg border border-white/20">
                        <Keyboard className="w-10 h-10 drop-shadow-md" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2 drop-shadow-sm">Manual ID</h3>
                    <p className="text-white/70 text-base">Type in ID</p>
                </button>

                <button onClick={() => { setShowQrScanner(true); }} className="group relative flex flex-col justify-center items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-center focus:outline-none focus:ring-4 focus:ring-white/30 h-[220px]">
                    <div className="h-20 w-20 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300 shadow-lg border border-white/20">
                        <QrCode className="w-10 h-10 drop-shadow-md" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2 drop-shadow-sm">QR Scanner</h3>
                    <p className="text-white/70 text-base">Scan Digital ID</p>
                </button>

                <button onClick={() => showWarning("Hardware Integration Pending: Face Recognition is currently unavailable for Event Attendance.")} className="group relative flex flex-col justify-center items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-center focus:outline-none focus:ring-4 focus:ring-white/30 h-[220px]">
                    <div className="h-20 w-20 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300 shadow-lg border border-white/20">
                        <ScanFace className="w-10 h-10 drop-shadow-md" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2 drop-shadow-sm">Face Scan</h3>
                    <p className="text-white/70 text-base">Automatic scanning</p>
                </button>
            </div>

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
                                    <p className="text-white/60 text-sm">Logging Check-in to Event</p>
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
                                    <button type="button" onClick={() => setShowManualModal(false)} className="flex-1 px-4 py-3 bg-white/5 border border-white/10 text-white/80 font-medium rounded-xl hover:bg-white/10 hover:text-white transition-all focus:outline-none">Cancel</button>
                                    <button type="submit" className="flex-[2] px-4 py-3 bg-white text-black font-bold rounded-xl hover:bg-slate-200 transition-all focus:outline-none focus:ring-4 focus:ring-white/30 flex items-center justify-center gap-2 text-lg shadow-lg">Submit <ArrowRight className="w-5 h-5" /></button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {showQrScanner && (
                <QRScannerOverlay 
                    onScan={(scannedId, error) => {
                        setShowQrScanner(false);
                        if (error || !scannedId) {
                            showError(error || "Invalid scan target.");
                            return;
                        }
                        handleQrScan(scannedId);
                    }} 
                    onClose={() => setShowQrScanner(false)} 
                    scannerFunction="event" 
                />
            )}
        </div>
    );
};
