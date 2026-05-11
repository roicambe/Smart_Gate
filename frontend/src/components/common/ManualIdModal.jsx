import React, { useState, useRef, useEffect } from "react";
import { Keyboard, Lock, Unlock, ArrowRight } from "lucide-react";
import { formatIdNumber } from "../../utils/formatters";

export const ManualIdModal = ({ 
    isOpen, 
    onClose, 
    onSubmit, 
    isLocked, 
    onToggleLock, 
    title = "Enter ID Number", 
    subtitle = "Manual entry for identification",
    placeholder = "e.g. 23-00123",
    error = null
}) => {
    const [manualId, setManualId] = useState("");
    const isDeletingRef = useRef(false);

    // Reset ID when modal is closed (if not locked)
    useEffect(() => {
        if (!isOpen && !isLocked) {
            setManualId("");
        }
    }, [isOpen, isLocked]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(manualId);
        setManualId("");
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-black/80 backdrop-blur-2xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-8">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="h-14 w-14 bg-white/10 rounded-2xl flex items-center justify-center text-white border border-white/20 shadow-inner">
                            <Keyboard className="w-7 h-7" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-white tracking-wide">{title}</h2>
                            <p className="text-white/60 text-sm">{subtitle}</p>
                        </div>
                        {onToggleLock && (
                            <button
                                type="button"
                                onClick={onToggleLock}
                                className={`ml-auto p-2 rounded-xl border transition-all ${
                                    isLocked 
                                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' 
                                        : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'
                                }`}
                                title={isLocked ? "Unlock Modal" : "Lock Modal"}
                            >
                                {isLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
                            </button>
                        )}
                    </div>
                    <form onSubmit={handleSubmit}>
                        <input
                            type="text"
                            placeholder={placeholder}
                            value={manualId}
                            onKeyDown={(e) => {
                                isDeletingRef.current = (e.key === 'Backspace' || e.key === 'Delete');
                            }}
                            onChange={(e) => setManualId(formatIdNumber(e.target.value, isDeletingRef.current))}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/50 mb-3 text-center tracking-widest uppercase transition-all"
                            autoFocus
                            required
                            maxLength={9}
                        />

                        {error && (
                            <div className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 mb-4">
                                <span className="shrink-0">⚠️</span>
                                <p className="font-medium leading-tight">{error}</p>
                            </div>
                        )}

                        <div className="text-white/40 text-xs space-y-1.5 mb-6 max-w-[240px] mx-auto font-medium uppercase tracking-tighter">
                            <div className="flex justify-between items-center">
                                <span>Student</span>
                                <span className="text-white/70 font-mono font-bold tracking-wider">00-00000</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span>Employee</span>
                                <span className="text-white/70 font-mono font-bold tracking-wider">000000000</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span>Visitor</span>
                                <span className="text-white/70 font-mono font-bold tracking-wider">VIS-00000</span>
                            </div>
                        </div>
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
                                Submit <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
