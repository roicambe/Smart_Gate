import React, { useState, useEffect } from "react";
import { ArrowLeft, Keyboard, QrCode, ScanFace, ChevronLeft, ArrowRight, CheckCircle2, AlertCircle, Calendar } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

export const EventActionMenu = ({ setView }) => {
    const [showManualModal, setShowManualModal] = useState(false);
    const [manualId, setManualId] = useState("");
    const [status, setStatus] = useState(null);
    const [events, setEvents] = useState([]);
    const [selectedEventId, setSelectedEventId] = useState(null);

    useEffect(() => {
        const fetchEvents = async () => {
            try {
                const data = await invoke('get_events');
                const now = new Date();
                const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
                const currentDate = now.toISOString().split('T')[0];
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const currentTime = `${hours}:${minutes}`;

                const activeEvents = data.filter(e => {
                    if (!e.is_enabled) return false;
                    const eventDateLower = e.event_date.toLowerCase();
                    const isCorrectDay = 
                        e.event_date === currentDate ||
                        eventDateLower === currentDay.toLowerCase() ||
                        eventDateLower === `every ${currentDay.toLowerCase()}` ||
                        eventDateLower === 'everyday';
                    
                    const isCorrectTime = currentTime >= e.start_time && currentTime <= e.end_time;
                    return isCorrectDay && isCorrectTime;
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
        fetchEvents();
    }, []);

    const handleManualSubmit = async (e) => {
        e.preventDefault();
        setStatus(null);

        if (!selectedEventId) {
            setStatus({ type: 'error', message: "No active event selected." });
            return;
        }

        try {
            const result = await invoke('log_event_attendance', {
                eventId: parseInt(selectedEventId, 10),
                schoolId: manualId
            });

            if (result.success) {
                setStatus({ type: 'success', message: `${result.message} - ${result.person_name} (${result.role})` });
            } else {
                setStatus({ type: 'error', message: result.message });
            }
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: "System Error. Failed to process ID." });
        } finally {
            setShowManualModal(false);
            setManualId("");
        }
    };

    return (
        <div className="flex-1 flex flex-col w-full h-full p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
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
                <div className="w-full max-w-xl mx-auto mb-10 pointer-events-auto">
                    <label className="block text-sm font-semibold text-white mb-2 pl-1 drop-shadow-sm">Select Active Event</label>
                    <div className="relative">
                        <select
                            value={selectedEventId || ''}
                            onChange={(e) => setSelectedEventId(e.target.value ? parseInt(e.target.value, 10) : null)}
                            className="w-full appearance-none bg-white border-2 border-slate-300 text-slate-900 rounded-xl px-6 py-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 hover:border-slate-400 transition-all text-lg font-bold shadow-sm cursor-pointer"
                        >
                            {events.map(ev => (
                                <option key={ev.event_id} value={ev.event_id} className="bg-white text-slate-900 font-medium py-2">
                                    {ev.event_name}
                                </option>
                            ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center px-6 pointer-events-none">
                            <ArrowRight className="w-6 h-6 rotate-90 text-slate-400" />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="w-full max-w-xl mx-auto mb-10 text-center p-4 bg-rose-500/20 border border-rose-500/30 rounded-2xl backdrop-blur-sm shadow-xl">
                    <p className="text-rose-200 font-medium">No active events found. Please enable an event in Admin Panel.</p>
                </div>
            )}

            {/* Status Toast */}
            {status && (
                <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-lg px-4 animate-in slide-in-from-top-4 fade-in duration-300">
                    <div className={`p-4 rounded-xl flex items-center justify-between gap-4 backdrop-blur-xl border shadow-2xl ${status.type === 'success' ? 'bg-emerald-500/20 text-emerald-100 border-emerald-500/30' : 'bg-rose-500/20 text-rose-100 border-rose-500/30'}`}>
                        <div className="flex items-center gap-3">
                            {status.type === 'success' ? <CheckCircle2 className="w-6 h-6 text-emerald-400" /> : <AlertCircle className="w-6 h-6 text-rose-400" />}
                            <span className="font-medium text-lg text-white drop-shadow-sm">{status.message}</span>
                        </div>
                        <button onClick={() => setStatus(null)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                            <ArrowLeft className="w-5 h-5 text-white/50 hover:text-white" />
                        </button>
                    </div>
                </div>
            )}

            {/* Actions Grid */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8 flex-1 place-content-center items-center ${events.length === 0 ? 'opacity-50 pointer-events-none' : ''}`}>
                <button
                    onClick={() => { setStatus(null); setShowManualModal(true); }}
                    className="group relative flex flex-col justify-center items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-center focus:outline-none focus:ring-4 focus:ring-white/30 h-[220px]"
                >
                    <div className="h-20 w-20 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300 shadow-lg border border-white/20">
                        <Keyboard className="w-10 h-10 drop-shadow-md" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2 drop-shadow-sm">Manual ID</h3>
                    <p className="text-white/70 text-base">Type in ID</p>
                </button>

                <button className="group relative flex flex-col justify-center items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-center focus:outline-none focus:ring-4 focus:ring-white/30 h-[220px]">
                    <div className="h-20 w-20 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-white/20 transition-all duration-300 shadow-lg border border-white/20">
                        <QrCode className="w-10 h-10 drop-shadow-md" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2 drop-shadow-sm">QR Scanner</h3>
                    <p className="text-white/70 text-base">Scan Digital ID</p>
                </button>

                <button className="group relative flex flex-col justify-center items-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/40 transition-all duration-300 text-center focus:outline-none focus:ring-4 focus:ring-white/30 h-[220px]">
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
        </div>
    );
};
