import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import HeaderBar from "./components/HeaderBar";
import { MainMenu } from "./components/MainMenu";
import { ActionMenu } from "./components/ActionMenu";
import { EventActionMenu } from "./components/EventActionMenu";
import { AdminLayout } from "./components/AdminLayout";
import bgImage from "../imgs/plp-background.jpg";

function App() {
    const [view, setView] = useState("main"); // 'main', 'action_entrance', 'action_exit', 'admin_dashboard', etc.
    const [adminSession, setAdminSession] = useState(null); // stores { account_id, username, full_name, role }
    
    // System Branding State
    const [branding, setBranding] = useState({
        system_name: "Pamantasan ng Lungsod ni Roi",
        system_logo: "" // Default empty, HeaderBar will handle fallback to default logo
    });

    const fetchBranding = async () => {
        try {
            const result = await invoke("get_system_branding");
            if (result) {
                setBranding(result);
            }
        } catch (error) {
            console.error("Failed to load system branding:", error);
        }
    };

    useEffect(() => {
        fetchBranding();
    }, []);

    return (
        <div className="relative flex flex-col h-screen text-slate-50 overflow-hidden font-sans">
            {/* Background Image & Overlay */}
            <div
                className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
                style={{ backgroundImage: `url(${bgImage})` }}
            >
                <div className="absolute inset-0 bg-[#001c0c]/70 backdrop-blur-[2px]"></div>
            </div>

            <div className="relative z-10 flex flex-col h-full w-full">
                <HeaderBar 
                    setView={setView} 
                    isAdminLoggedIn={adminSession} 
                    setIsAdminLoggedIn={setAdminSession}
                    branding={branding}
                />

                {/* Main Content Area - min-h-0 ensures flex child can shrink for scroll containment */}
                <main className="flex-1 min-h-0 w-full overflow-hidden">
                    {view === "main" && <MainMenu setView={setView} branding={branding} />}
                    {(view === "action_entrance" || view === "action_exit") && (
                        <ActionMenu view={view} setView={setView} />
                    )}
                    {view === "action_event" && <EventActionMenu setView={setView} />}
                    {view.startsWith("admin_") && adminSession && (
                        <AdminLayout 
                            view={view} 
                            setView={setView} 
                            setIsAdminLoggedIn={setAdminSession} 
                            adminSession={adminSession}
                            branding={branding}
                            fetchBranding={fetchBranding}
                        />
                    )}
                </main>

                {/* Footer Section - Hidden on Admin Pages */}
                {!view.startsWith("admin_") && (
                    <footer className="w-full py-4 px-8 flex justify-center items-center text-white/70 text-sm bg-black/20 backdrop-blur-md border-t border-white/10 mt-auto">
                        <div>&copy; {new Date().getFullYear()} {branding.system_name} | Made by Roi</div>
                    </footer>
                )}
            </div>
        </div>
    );
}

export default App;