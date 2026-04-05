import React, { useState } from "react";
import { ArrowLeft, Keyboard, QrCode, ScanFace, Users, LogIn, LogOut, ChevronLeft, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import { QRScannerOverlay } from "./QRScannerOverlay";

export const ActionMenu = ({ view, setView }) => {
    const isEntrance = view === 'action_entrance';
    const [showManualModal, setShowManualModal] = useState(false);
    const [showVisitorModal, setShowVisitorModal] = useState(false);
    const [manualId, setManualId] = useState("");
    const [status, setStatus] = useState(null);
    const [successVisitor, setSuccessVisitor] = useState(null);
    const [showHardwareModal, setShowHardwareModal] = useState(false);
    const [showQRScanner, setShowQRScanner] = useState(false);

    const [visitorForm, setVisitorForm] = useState({
        firstName: '',
        middleName: '',
        lastName: '',
        email: '',
        contactNumber: '',
        purpose: '',
        personToVisit: ''
    });

    const handleVisitorSubmit = async (e) => {
        e.preventDefault();
        setStatus(null);
        try {
            const yearPart = new Date().getFullYear().toString().slice(-2);
            const randomPart = Math.floor(1000 + Math.random() * 9000).toString().padStart(4, '0');
            const generatedId = `VIS-${yearPart}${randomPart}`;
            
            const personId = await invoke('register_user', {
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
                idPresented: generatedId
            });
            
            const result = await invoke('manual_id_entry', {
                idNumber: generatedId,
                scannerFunction: 'entrance'
            });
            
            if (result.success) {
                setSuccessVisitor({ id: generatedId, name: `${visitorForm.firstName} ${visitorForm.lastName}`, email: visitorForm.email });
                
                if (visitorForm.email) {
                    invoke("send_visitor_qr", { idNumber: generatedId })
                        .catch(qrErr => console.error("Failed to send QR email:", qrErr));
                }
            } else {
                setStatus({ type: 'error', message: result.message });
            }
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: typeof error === 'string' ? error : "Failed to register visitor." });
        } finally {
            setShowVisitorModal(false);
            setVisitorForm({ firstName: '', middleName: '', lastName: '', email: '', contactNumber: '', purpose: '', personToVisit: '' });
        }
    };

    const handleManualSubmit = async (e) => {
        e.preventDefault();
        setStatus(null);
        try {
            const scannerFunction = isEntrance ? 'entrance' : 'exit';
            const result = await invoke('manual_id_entry', {
                idNumber: manualId,
                scannerFunction
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

            {/* Status Toast Container (Visible upon submission) */}
            {status && (
                <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-lg px-4 animate-in slide-in-from-top-4 fade-in duration-300">
                    <div className={`p-4 rounded-xl flex items-center justify-between gap-4 backdrop-blur-xl border shadow-2xl ${status.type === 'success' ? 'bg-emerald-500/20 text-emerald-100 border-emerald-500/30' : 'bg-rose-500/20 text-rose-100 border-rose-500/30'
                        }`}>
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

            {/* Grid of Enlarged Action Cards (Glassmorphism) */}
            {isEntrance ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 flex-1 place-content-center items-center">
                    {/* Manually Input ID */}
                    <button
                        onClick={() => { setStatus(null); setShowManualModal(true); }}
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
                        onClick={() => setShowHardwareModal(true)}
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
                            setStatus(null); 
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
                                onClick={() => { setStatus(null); setShowManualModal(true); }}
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
                            onClick={() => setShowHardwareModal(true)}
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
            {/* Hardware Placeholder Modal */}
            {showHardwareModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md">
                    <div className="bg-black/80 backdrop-blur-2xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                        <div className="p-8 text-center flex flex-col items-center">
                            <AlertCircle className="w-16 h-16 text-blue-400 mb-4" />
                            <h2 className="text-2xl font-bold text-white tracking-wide mb-2">Hardware Integration in Progress</h2>
                            <p className="text-white/70 mb-8">Please use Manual ID for now to register entry or exit.</p>
                            <button
                                onClick={() => setShowHardwareModal(false)}
                                className="px-8 py-3 bg-white text-black font-bold rounded-xl hover:bg-slate-200 transition-all focus:outline-none focus:ring-4 focus:ring-white/30"
                            >
                                Understood
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* QR Scanner Modal */}
            {showQRScanner && (
                <QRScannerOverlay
                    scannerFunction={isEntrance ? 'entrance' : 'exit'}
                    onClose={() => setShowQRScanner(false)}
                    onScan={async (scannedId) => {
                        setShowQRScanner(false);
                        setStatus(null);
                        try {
                            const result = await invoke('manual_id_entry', {
                                idNumber: scannedId,
                                scannerFunction: isEntrance ? 'entrance' : 'exit'
                            });

                            if (result.success) {
                                setStatus({ type: 'success', message: `${result.message} - ${result.person_name} (${result.role})` });
                            } else {
                                setStatus({ type: 'error', message: result.message });
                            }
                        } catch (error) {
                            console.error(error);
                            setStatus({ type: 'error', message: "System Error. Failed to process ID." });
                        }
                    }}
                />
            )}

            {/* Success Visitor Modal */}
            {successVisitor && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md">
                    <div className="bg-emerald-950/80 backdrop-blur-2xl border border-emerald-500/30 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                        <div className="p-8 text-center flex flex-col items-center">
                            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center border-4 border-emerald-500/30 mb-6">
                                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                            </div>
                            <h2 className="text-3xl font-bold text-white tracking-wide mb-2">Registration Successful!</h2>
                            <p className="text-emerald-100/70 mb-6">Temporary Visitor Registration Complete</p>
                            
                            <div className="flex gap-6 items-stretch w-full justify-center mb-8">
                                <div className="bg-white p-4 rounded-xl shadow-[0_0_20px_rgba(255,255,255,0.2)] flex items-center justify-center shrink-0">
                                    <QRCodeSVG value={successVisitor.id} size={150} />
                                </div>
                                <div className="bg-black/50 border border-emerald-500/30 p-6 rounded-2xl flex-1 relative overflow-hidden flex flex-col justify-center text-left">
                                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent"></div>
                                    <p className="text-emerald-200/60 text-sm font-semibold uppercase tracking-wider mb-2">Temporary Visitor ID</p>
                                    <p className="text-4xl sm:text-5xl font-mono font-bold text-white tracking-widest relative z-10">{successVisitor.id}</p>
                                    <p className="text-white/80 mt-4 text-xl relative z-10">{successVisitor.name}</p>
                                </div>
                            </div>
                            
                            <div className="w-full text-center space-y-3 mb-8">
                                {successVisitor.email && (
                                    <p className="text-emerald-200/90 font-medium text-lg border-b border-emerald-500/20 pb-4">
                                        A digital copy of this pass has been sent to <span className="text-white font-bold">{successVisitor.email}</span>. You can also take a picture.
                                    </p>
                                )}
                                <p className="text-emerald-200/80 font-medium italic pt-2">
                                    Please use this ID for logging your Departure (Exit) later.
                                </p>
                            </div>
                            
                            <button
                                onClick={() => setSuccessVisitor(null)}
                                className="w-full px-6 py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] focus:outline-none focus:ring-4 focus:ring-emerald-500/30 text-lg"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
