import React, { useState } from "react";
import { X, Minus, ShieldCheck, AlertTriangle, Lock } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import logoImage from "../../imgs/plp-logo.png";

const appWindow = getCurrentWindow();

const HeaderBar = ({ setView, isAdminLoggedIn, setIsAdminLoggedIn }) => {
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [showAdminModal, setShowAdminModal] = useState(false);
    const [password, setPassword] = useState("");
    const [loginError, setLoginError] = useState("");

    const handleMinimize = () => {
        appWindow.minimize();
    };

    const attemptClose = () => {
        setShowCloseModal(true);
    };

    const confirmClose = () => {
        appWindow.close();
    };

    const cancelClose = () => {
        setShowCloseModal(false);
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoginError("");
        try {
            const success = await invoke('admin_login', { password });
            if (success) {
                setIsAdminLoggedIn(true);
                setView('admin_dashboard');
                setShowAdminModal(false);
                setPassword("");
            } else {
                setLoginError("Invalid passcode.");
            }
        } catch (error) {
            console.error(error);
            setLoginError("Authentication failed.");
        }
    };

    return (
        <>
            {/* Glassmorphic Header */}
            <div
                className="flex justify-between items-center bg-black/20 backdrop-blur-md border-b border-white/10 text-white h-16 px-6 select-none w-full"
            >
                {/* Top-Left: High-resolution University Logo */}
                <div className="flex items-center gap-4 pointer-events-none">
                    <img src={logoImage} alt="University Logo" className="w-12 h-12 object-contain drop-shadow-md" />
                    <span className="font-bold tracking-wide text-xl drop-shadow-sm">Pamantasan ng Lungsod ni Roi</span>
                </div>

                {/* Top-Right: Admin Login & Window Controls */}
                <div className="flex items-center space-x-6">
                    {!isAdminLoggedIn ? (
                        <button
                            onClick={() => setShowAdminModal(true)}
                            className="text-sm font-medium text-white/80 hover:text-white transition-colors flex items-center gap-1.5 focus:outline-none"
                        >
                            <Lock className="w-4 h-4" />
                            Administrator Login
                        </button>
                    ) : (
                        <button
                            onClick={() => {
                                setIsAdminLoggedIn(false);
                                setView('main');
                            }}
                            className="text-sm font-medium text-white/80 hover:text-rose-400 transition-colors flex items-center gap-1.5 focus:outline-none"
                        >
                            <Lock className="w-4 h-4" />
                            Logout Admin
                        </button>
                    )}

                    {/* Divider */}
                    <div className="h-6 w-px bg-white/20"></div>

                    <div className="flex items-center space-x-2">
                        <button
                            onClick={handleMinimize}
                            className="p-1.5 rounded hover:bg-white/10 transition-colors focus:outline-none"
                        >
                            <Minus className="w-4 h-4 text-white/80 hover:text-white" />
                        </button>
                        <button
                            onClick={attemptClose}
                            className="p-1.5 rounded hover:bg-red-500/80 transition-colors focus:outline-none"
                        >
                            <X className="w-4 h-4 text-white/80 hover:text-white" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Admin Login Modal (Glassmorphic) */}
            {showAdminModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900/80 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 flex flex-col items-center border-b border-white/10">
                            <div className="h-14 w-14 bg-brand-500/20 rounded-full flex items-center justify-center mb-4 text-brand-400 border border-brand-500/30">
                                <Lock className="h-7 w-7" />
                            </div>
                            <h2 className="text-xl font-bold text-white text-center tracking-wide">Administrator Access</h2>
                            <p className="text-white/60 text-center mt-2 text-sm">
                                Enter your secure passcode to proceed.
                            </p>
                        </div>
                        <form onSubmit={handleLogin} className="p-6">
                            <input
                                type="password"
                                placeholder="Enter passcode..."
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50 mb-2 text-center tracking-widest"
                                autoFocus
                            />
                            {loginError && <div className="text-rose-400 text-sm text-center mb-4">{loginError}</div>}
                            <div className="flex gap-3 mt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowAdminModal(false)}
                                    className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 text-white/80 font-medium rounded-lg hover:bg-white/10 hover:text-white transition-all focus:outline-none"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2.5 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-500 shadow-lg shadow-brand-500/25 transition-all focus:outline-none"
                                >
                                    Login
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Exit Confirmation Modal (Glassmorphic) */}
            {showCloseModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900/80 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 flex flex-col items-center border-b border-white/10">
                            <div className="h-14 w-14 bg-red-500/20 rounded-full flex items-center justify-center mb-4 text-red-500 border border-red-500/30">
                                <AlertTriangle className="h-7 w-7" />
                            </div>
                            <h2 className="text-xl font-bold text-white text-center tracking-wide">Exit System?</h2>
                            <p className="text-white/60 text-center mt-2 text-sm leading-relaxed">
                                Are you sure you want to close the application? This will disconnect active scanners.
                            </p>
                        </div>
                        <div className="flex bg-white/5 p-4 gap-3">
                            <button
                                onClick={cancelClose}
                                className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 text-white/80 font-medium rounded-lg hover:bg-white/10 hover:text-white transition-all focus:outline-none"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmClose}
                                className="flex-1 px-4 py-2.5 bg-red-600 text-white font-medium rounded-lg hover:bg-red-500 shadow-lg shadow-red-500/25 transition-all focus:outline-none"
                            >
                                Confirm Exit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default HeaderBar;
