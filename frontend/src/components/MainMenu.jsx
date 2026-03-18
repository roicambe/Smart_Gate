import React from "react";
import { LogIn, LogOut, Flag } from "lucide-react";
import logoImage from "../../imgs/plp-logo.png";

export const MainMenu = ({ setView }) => {
    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 h-full">
            {/* Hero Section */}
            <div className="flex flex-col items-center mb-16 text-white animate-in slide-in-from-bottom-5 fade-in duration-700">
                <div className="h-48 w-48 mb-6 flex items-center justify-center drop-shadow-2xl">
                    <img src={logoImage} alt="University Logo" className="w-full h-full object-contain filter drop-shadow-[0_10px_15px_rgba(0,0,0,0.5)]" />
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-7xl font-extrabold text-center tracking-tight text-white drop-shadow-xl font-serif">
                    Smart Gate
                </h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl animate-in slide-in-from-bottom-10 fade-in duration-700 delay-150 fill-mode-both">
                {/* Entrance Card */}
                <button
                    onClick={() => setView('action_entrance')}
                    className="group relative flex flex-col items-center justify-center p-10 bg-blue-500/10 backdrop-blur-md rounded-3xl border border-blue-500/30 shadow-2xl hover:scale-[1.02] hover:bg-blue-500/20 hover:shadow-blue-500/20 hover:border-blue-500/50 transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-blue-500/30 text-left w-full h-full"
                >
                    <div className="h-20 w-20 bg-blue-500/20 text-blue-300 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-blue-500 group-hover:text-white transition-all duration-300 shadow-lg border border-blue-500/30">
                        <LogIn className="w-10 h-10" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-3">Campus Entrance</h2>
                    <p className="text-white/70 text-center m-0">Register entry and health clearance.</p>
                </button>

                {/* Exit Card */}
                <button
                    onClick={() => setView('action_exit')}
                    className="group relative flex flex-col items-center justify-center p-10 bg-rose-500/10 backdrop-blur-md rounded-3xl border border-rose-500/30 shadow-2xl hover:scale-[1.02] hover:bg-rose-500/20 hover:shadow-rose-500/20 hover:border-rose-500/50 transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-rose-500/30 text-left w-full h-full"
                >
                    <div className="h-20 w-20 bg-rose-500/20 text-rose-300 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-rose-500 group-hover:text-white transition-all duration-300 shadow-lg border border-rose-500/30">
                        <LogOut className="w-10 h-10" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-3">Campus Exit</h2>
                    <p className="text-white/70 text-center m-0">Log departure from university grounds.</p>
                </button>

                {/* Flag Ceremony Card */}
                <button
                    onClick={() => setView('action_event')}
                    className="group relative flex flex-col items-center justify-center p-10 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 shadow-2xl hover:scale-[1.02] hover:bg-white/15 hover:shadow-white/20 hover:border-white/30 transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-white/30 text-left w-full h-full"
                >
                    <div className="h-20 w-20 bg-slate-500/20 text-slate-300 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-slate-500 group-hover:text-white transition-all duration-300 shadow-lg border border-slate-500/30">
                        <Flag className="w-10 h-10" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-3">Event & Ceremony</h2>
                    <p className="text-white/70 text-center m-0">Check-in for official university assemblies and flag ceremonies.</p>
                </button>
            </div>
        </div>
    );
};
