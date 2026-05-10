import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Keyboard, QrCode, ScanFace, ChevronLeft, ArrowRight, Calendar, X, Lock, Unlock, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QRScannerOverlay } from "./QRScannerOverlay";
import { extractScanId } from "../utils/patternHunter";
import { useToast } from "./toast/ToastProvider";
import { useIdCard } from "./IdCardProvider";
import { FaceScannerModal } from "./FaceScannerModal";
import { useGhostScannerListener } from "../hooks/useGhostScannerListener";
import { 
    formatRoleLabel, 
    getFullNameLabel, 
    formatIdNumber, 
    getProgramYearLabel 
} from "../utils/formatters";
import { ManualIdModal } from "./common/ManualIdModal";

const getDetailedToastMessage = (scanDetails) => {
    if (!scanDetails) return "Scan processed.";
    const name = scanDetails.first_name ? `${scanDetails.first_name} ${scanDetails.last_name}` : "Unknown Person";
    const role = formatRoleLabel(scanDetails.role || scanDetails.roles);
    const context = scanDetails.department_name || scanDetails.program_name || "";
    return `${name} (${role})${context ? ` - ${context}` : ""}`;
};

export const EventActionMenu = ({ setView, branding }) => {
    const [showManualModal, setShowManualModal] = useState(false);
    const [showQrScanner, setShowQrScanner] = useState(false);
    const [events, setEvents] = useState([]);
    const [programs, setPrograms] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [selectedEventId, setSelectedEventId] = useState(null);
    const [allRoles, setAllRoles] = useState([]);
    const [isProcessingScanner, setIsProcessingScanner] = useState(false);
    const [showFaceScanner, setShowFaceScanner] = useState(false);
    const [flashGreen, setFlashGreen] = useState(false);
    const [currentTimeState, setCurrentTimeState] = useState(new Date());
    const [isManualLocked, setIsManualLocked] = useState(false);
    const [isScannerLocked, setIsScannerLocked] = useState(false);
    const scanCardRequestIdRef = useRef(0);
    const { showSuccess, showError, showWarning, showProcessing } = useToast();
    const { showIdCard, dismissIdCard } = useIdCard();
    const currentEvent = events.find(e => e.event_id === selectedEventId);

    const showScanSuccessFeedback = useCallback(async ({
        result,
        scannedId,
        fallbackMessage,
        modalActive
    }) => {
        const roleLabel = result.role || (result.roles && result.roles.length > 0 ? result.roles[0] : "User");
        const successMessage = fallbackMessage || `${result.message} - ${result.person_name} (${roleLabel})`;
        const normalizedRole = (result.role || "").toString().trim().toLowerCase();
        const DETAILED_TOAST_ROLES = new Set(["student", "professor", "staff"]);
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

                showIdCard(details);
                return;
            }
        } catch (error) {
            console.error("Failed to fetch scan person details:", error);
        }

        if (requestId === scanCardRequestIdRef.current) {
            showSuccess(successMessage);
        }
    }, [showSuccess, showIdCard]);

    const isModalOpen = showManualModal || showQrScanner || showFaceScanner;

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

    const flattenEvent = (item) => {
        const { event, weekly_schedules, date_range_schedules, required_roles } = item;
        const schedule_type = (weekly_schedules && weekly_schedules.length > 0) ? 'weekly' : 'date_range';
        
        let event_date = '';
        let start_date = '';
        let end_date = '';
        let start_time = '';
        let end_time = '';

        if (schedule_type === 'weekly' && weekly_schedules && weekly_schedules.length > 0) {
            event_date = weekly_schedules.map(s => s.day_of_week).join(', ');
            start_time = weekly_schedules[0].start_time;
            end_time = weekly_schedules[0].end_time;
        } else if (date_range_schedules && date_range_schedules.length > 0) {
            start_date = date_range_schedules[0].start_date;
            end_date = date_range_schedules[0].end_date;
            start_time = date_range_schedules[0].start_time;
            end_time = date_range_schedules[0].end_time;
        }

        return {
            ...event,
            schedule_type,
            event_date,
            start_date,
            end_date,
            start_time,
            end_time,
            required_role: required_roles && required_roles.length > 0 ? required_roles.map(r => r.role_name).join(',') : 'all'
        };
    };

    useEffect(() => {
        const fetchEvents = async () => {
            try {
                const data = await invoke('get_events');
                const flattenedData = data.map(flattenEvent);
                
                const now = new Date();
                const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
                const currentDate = getLocalDateKey(now);
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const currentTime = `${hours}:${minutes}`;
                const currentDateObj = toDateOnly(currentDate);

                const activeEvents = flattenedData.filter(e => {
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
        const fetchDepartments = async () => {
            try {
                const data = await invoke('get_departments');
                setDepartments(data);
            } catch (error) {
                console.error(error);
            }
        };
        const fetchRoles = async () => {
            try {
                const data = await invoke('get_roles');
                setAllRoles(data);
            } catch (error) {
                console.error(error);
            }
        };
        fetchEvents();
        fetchPrograms();
        fetchDepartments();
        fetchRoles();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTimeState(new Date());
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    const isLate = useMemo(() => {
        if (!currentEvent || !currentEvent.start_time) return false;
        
        const now = currentTimeState;
        const [h, m] = currentEvent.start_time.split(':').map(Number);
        const startTime = new Date(now);
        startTime.setHours(h, m, 0, 0);
        
        const threshold = currentEvent.late_threshold || 0;
        const lateLimit = new Date(startTime.getTime() + (threshold * 60000));
        
        return now > lateLimit;
    }, [currentEvent, currentTimeState]);

    const handleManualSubmit = async (submittedId) => {

        if (!selectedEventId) {
            showWarning("No active event selected.");
            return;
        }

        try {
            const result = await invoke('log_event_attendance', {
                eventId: parseInt(selectedEventId, 10),
                idNumber: submittedId,
                scannerId: 1
            });

            if (result.success) {
                // Determine if we are staying in modal mode (locked) or closing to show ID card
                const isStillActive = isManualLocked || showQrScanner || showFaceScanner;

                if (!isManualLocked) {
                    setShowManualModal(false);
                }

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

    const handleQrScan = useCallback(async (scannedId, modalActiveOverride = null) => {
        const modalActive = modalActiveOverride !== null ? modalActiveOverride : isModalOpen;
        if (!selectedEventId) {
            showWarning("No active event selected.");
            return;
        }

        try {
            const result = await invoke('log_event_attendance', {
                eventId: parseInt(selectedEventId, 10),
                idNumber: scannedId,
                scannerId: 1
            });

            if (result.success) {
                const eventName = events.find(e => e.event_id === parseInt(selectedEventId, 10))?.event_name || 'Event';
                
                await showScanSuccessFeedback({
                    result,
                    scannedId,
                    fallbackMessage: `Attendance Recorded: ${eventName} - ${result.person_name} (${result.role})`,
                    modalActive
                });
                
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
    }, [selectedEventId, events, showScanSuccessFeedback, isModalOpen, showError, showWarning, playSuccessBeep]);

    const processWedgeInput = useCallback(async (rawString) => {
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
        
        // Use a short timeout to allow state synchronization if needed
        const isStillActive = isModalOpen;

        await handleQrScan(scannedId, isStillActive);

        setTimeout(() => setIsProcessingScanner(false), 500); 
    }, [selectedEventId, handleQrScan, showError, showWarning, showProcessing, isModalOpen, showManualModal]);

    useGhostScannerListener({
        enabled: true,
        onScanBuffer: processWedgeInput
    });



    const getFormatRoleList = (roleStr) => {
        if (!roleStr || roleStr.toLowerCase().includes('all')) return ['All Roles'];
        const roles = roleStr.split(',').map(r => r.trim()).filter(Boolean);
        
        // If the number of selected roles matches all roles in DB, say "All Roles"
        if (allRoles.length > 0 && roles.length >= allRoles.length) {
            return ['All Roles'];
        }
        
        return roles.map(r => r.charAt(0).toUpperCase() + r.slice(1));
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
        if (!ylStr || ylStr.trim() === '') return 'All Year Levels';
        return ylStr.split(',').map(y => {
            const val = y.trim();
            return `${val}${['st', 'nd', 'rd', 'th'][parseInt(val, 10) - 1] || 'th'} Year`;
        }).join(', ');
    };

    const getFormatDepartments = (deptStr) => {
        if (!deptStr || deptStr.toLowerCase().includes('all')) return 'All Departments';
        const ids = deptStr.split(',').map(id => id.trim());
        return ids.map(id => {
            const dept = departments.find(d => d.department_id.toString() === id);
            return dept ? dept.department_code : id;
        }).join(', ');
    };

    return (
        <div className="flex-1 flex flex-col w-full h-full p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
            
            {/* Green Flash Overlay - Only show if NO active ID card is shown */}
            {flashGreen && (
                <div className="absolute inset-0 z-[200] bg-emerald-500/30 pointer-events-none animate-in fade-in duration-75 fade-out duration-300"></div>
            )}

            {/* Top Navigation */}
            <div className="flex flex-col items-center justify-center mb-4 relative w-full pt-4">
                <button
                    onClick={() => setView('main')}
                    className="flex items-center gap-3 px-6 py-3 bg-black/30 backdrop-blur-md border border-white/20 text-white rounded-xl hover:bg-black/40 hover:scale-[1.02] transition-all focus:outline-none focus:ring-2 focus:ring-white/20 shadow-lg group absolute left-0 top-0 z-10"
                >
                    <ChevronLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
                    <span className="font-semibold text-base tracking-wide">Main Menu</span>
                </button>

                <div className="flex flex-col items-center justify-center w-full pointer-events-none mt-8 gap-3">
                    <div className="p-3 bg-black/20 backdrop-blur-md rounded-full border border-white/10 shadow-inner drop-shadow-xl">
                        <Calendar className="w-10 h-10 text-slate-300" />
                    </div>
                    <h2 className="text-4xl md:text-5xl font-extrabold text-white tracking-wide drop-shadow-2xl text-center">
                        Event Check-in
                    </h2>
                </div>
            </div>

            {/* Event Selection Dropdown & Card */}
            {events.length > 0 ? (
                <div className="w-full flex flex-col items-center mb-4 pointer-events-auto space-y-4">
                    {/* Dropdown Container - Kept at max-w-xl */}
                    <div className="w-full max-w-xl space-y-1.5">
                        <label className="block text-xs font-bold text-white mb-2 pl-1 drop-shadow-sm uppercase tracking-widest opacity-60">Select Active Event</label>
                        <div className="relative">
                            <select
                                value={selectedEventId || ''}
                                onChange={(e) => setSelectedEventId(e.target.value ? parseInt(e.target.value, 10) : null)}
                                className="w-full appearance-none bg-white border-2 border-slate-300 text-slate-900 rounded-xl px-6 py-3.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 hover:border-slate-400 transition-all text-lg font-bold shadow-sm cursor-pointer"
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
                    
                    {/* Event Details Card - Wider and More Detailed */}
                    {currentEvent && (
                        <div className="w-full max-w-fit min-w-[min(100%,896px)] bg-black/40 backdrop-blur-xl border border-white/10 rounded-[2rem] p-4 md:p-6 animate-in zoom-in-95 slide-in-from-top-4 duration-500 shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden relative group mx-auto">
                            {/* Decorative accent */}
                            <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-blue-500 to-indigo-600"></div>
                            
                            <div className="flex flex-col gap-3 md:gap-4">
                                {/* Header: Name & Description */}
                                <div className="space-y-1">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                                        <div className="space-y-0.5">
                                            <h3 className="text-3xl md:text-4xl font-black text-white tracking-tighter drop-shadow-lg leading-tight">
                                                {currentEvent.event_name}
                                            </h3>
                                            <p className="text-base md:text-lg text-white/50 font-medium leading-tight max-w-2xl italic">
                                                {currentEvent.description || "No description provided for this event."}
                                            </p>
                                        </div>
                                        {/* Status Badge */}
                                        <div className={`px-4 py-1.5 rounded-full border-2 font-black text-[10px] uppercase tracking-[0.2em] shadow-lg inline-flex items-center gap-2 ${
                                            isLate ? 'bg-rose-500/20 border-rose-500/40 text-rose-300' : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                        }`}>
                                            <div className={`h-2 w-2 rounded-full ${isLate ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'}`}></div>
                                            {isLate ? 'Late Entry Mode' : 'On-Time Mode'}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
                                    {/* Left Side: Schedule & Configuration */}
                                    <div className="flex-1 min-w-[320px] space-y-4">
                                        <div className="space-y-4 bg-white/5 rounded-3xl p-5 border border-white/10 shadow-inner">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2 text-blue-300 opacity-60">
                                                    <Calendar className="w-3 h-3" />
                                                    <p className="text-[10px] font-black uppercase tracking-[0.2em]">Schedule Details</p>
                                                </div>
                                                <div className="space-y-0.5">
                                                    <p className="text-xl font-bold text-white tracking-tight leading-none">
                                                        {currentEvent.schedule_type === 'date_range' 
                                                            ? `${new Date(currentEvent.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(currentEvent.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                                                            : currentEvent.event_date
                                                        }
                                                    </p>
                                                    <p className="text-2xl font-black text-white/90 leading-tight">
                                                        {currentEvent.start_time} <span className="text-white/30 text-lg font-medium mx-1">to</span> {currentEvent.end_time}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="h-px bg-white/10 w-full"></div>

                                            <div className="space-y-1">
                                                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Late Configuration</p>
                                                <div className="flex flex-col gap-1">
                                                    <p className="text-2xl font-black text-emerald-400 tracking-tight leading-tight">
                                                        {currentEvent.late_threshold || 0} <span className="text-base font-bold opacity-60">Minutes</span>
                                                    </p>
                                                    {isLate && (
                                                        <div className="flex items-center gap-1.5 text-rose-500 animate-pulse">
                                                            <AlertCircle className="w-3.5 h-3.5" />
                                                            <span className="text-[9px] font-black uppercase tracking-widest">Entry Threshold Reached</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Side: Requirements */}
                                    <div className="flex-initial min-w-[320px] bg-indigo-500/10 rounded-3xl p-5 border border-indigo-500/20 space-y-4">
                                        <div className="flex items-center gap-2 text-indigo-300 opacity-60">
                                            <Lock className="w-3 h-3" />
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em]">Requirement Filters</p>
                                        </div>
                                        
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                                            <div className="space-y-1 sm:col-span-2">
                                                <p className="text-[9px] font-bold text-indigo-300/60 uppercase tracking-widest">Required Roles</p>
                                                <div className={`text-base font-black text-white leading-tight ${getFormatRoleList(currentEvent.required_role).length > 3 ? 'grid grid-flow-col grid-rows-3 gap-x-8' : ''}`}>
                                                    {getFormatRoleList(currentEvent.required_role).map((role, idx) => (
                                                        <div key={idx} className="whitespace-nowrap">• {role}</div>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-[9px] font-bold text-indigo-300/60 uppercase tracking-widest">Departments</p>
                                                <p className="text-base font-black text-white leading-tight">{getFormatDepartments(currentEvent.required_departments)}</p>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-[9px] font-bold text-indigo-300/60 uppercase tracking-widest">Target Programs</p>
                                                <p className="text-base font-black text-white leading-tight">{getFormatPrograms(currentEvent.required_programs)}</p>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-[9px] font-bold text-indigo-300/60 uppercase tracking-widest">Year Levels</p>
                                                <p className="text-base font-black text-white leading-tight">{getFormatYearLevels(currentEvent.required_year_levels)}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="w-full max-w-xl mx-auto mb-10 text-center p-8 bg-rose-500/10 border border-rose-500/30 rounded-3xl backdrop-blur-md shadow-2xl">
                    <p className="text-xl text-rose-200 font-bold tracking-tight">No active events found.</p>
                    <p className="text-rose-200/60 text-sm mt-1">Please enable or schedule an event in the Admin Panel.</p>
                </div>
            )}

            {/* Actions Grid */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 items-center w-full max-w-6xl mx-auto mt-2 mb-6 ${(!selectedEventId || events.length === 0) ? 'opacity-50 pointer-events-none grayscale-[0.5]' : ''}`}>
                <button
                    disabled={!selectedEventId || events.length === 0}
                    onClick={() => { setShowManualModal(true); }}
                    className="group relative flex flex-col justify-center items-center p-8 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-center focus:outline-none focus:ring-4 focus:ring-white/30 h-[180px]"
                >
                    <div className="h-16 w-16 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300 shadow-lg border border-white/20">
                        <Keyboard className="w-8 h-8 drop-shadow-md" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-1 drop-shadow-sm">Manual ID</h3>
                    <p className="text-white/60 text-sm">Type in ID</p>
                </button>

                <button 
                    disabled={!selectedEventId || events.length === 0}
                    onClick={() => { setShowQrScanner(true); }} 
                    className="group relative flex flex-col justify-center items-center p-8 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-center focus:outline-none focus:ring-4 focus:ring-white/30 h-[180px]">
                    <div className="h-16 w-16 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300 shadow-lg border border-white/20">
                        <QrCode className="w-8 h-8 drop-shadow-md" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-1 drop-shadow-sm">QR Scanner</h3>
                    <p className="text-white/60 text-sm">Scan Digital ID</p>
                </button>

                <button 
                    disabled={!selectedEventId || events.length === 0}
                    onClick={() => {
                        if (branding?.enable_face_recognition) {
                            setShowFaceScanner(true);
                        } else {
                            showWarning("Biometric verification is currently unavailable. Please contact the system administrator for support.");
                        }
                    }}
                    className="group relative flex flex-col justify-center items-center p-8 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-center focus:outline-none focus:ring-4 focus:ring-white/30 h-[180px]"
                >
                    <div className="h-16 w-16 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300 shadow-lg border border-white/20">
                        <ScanFace className="w-8 h-8 drop-shadow-md" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-1 drop-shadow-sm">Face Scan</h3>
                    <p className="text-white/60 text-sm">Automatic scanning</p>
                </button>
            </div>
            {/* Global ID Card is now managed by IdCardProvider */}

            {/* Manual ID Modal */}
            <ManualIdModal
                isOpen={showManualModal}
                onClose={() => setShowManualModal(false)}
                onSubmit={handleManualSubmit}
                isLocked={isManualLocked}
                onToggleLock={() => setIsManualLocked(!isManualLocked)}
                subtitle="Logging Check-in to Event"
            />

            {showQrScanner && (
                <QRScannerOverlay 
                    onScan={(scannedId, error) => {
                        if (!isScannerLocked) {
                            setShowQrScanner(false);
                        }
                        if (error || !scannedId) {
                            showError(error || "Invalid scan target.");
                            return;
                        }
                        const isStillActive = isScannerLocked || showManualModal || showFaceScanner;
                        handleQrScan(scannedId, isStillActive);
                    }} 
                    onClose={() => setShowQrScanner(false)} 
                    isLocked={isScannerLocked}
                    onToggleLock={() => setIsScannerLocked(!isScannerLocked)}
                    scannerFunction="event" 
                />
            )}

            {showFaceScanner && (
                <FaceScannerModal 
                    scannerFunction="event"
                    isLocked={isScannerLocked}
                    onToggleLock={() => setIsScannerLocked(!isScannerLocked)}
                    onClose={() => setShowFaceScanner(false)}
                    isPaused={showManualModal || showQrScanner}
                    onIdentify={(scannedId) => {
                        if (!isScannerLocked) {
                            setShowFaceScanner(false);
                        }
                        const isStillActive = isScannerLocked || showManualModal || showQrScanner;
                        handleQrScan(scannedId, isStillActive);
                    }}
                />
            )}
        </div>
    );
};
