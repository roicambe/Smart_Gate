import React from 'react';
import { LayoutDashboard, Users, BookOpen, ScanFace, FileBarChart, History, Settings, Building, Calendar, ShieldAlert, Database } from 'lucide-react';
import { AdminDashboard } from './views/AdminDashboard';
import { SystemSettings } from './views/SystemSettings';
import { UserManagement } from './views/UserManagement';

import { AccessLogs } from './views/AccessLogs';
import { AcademicStructure } from './views/AcademicStructure';
import { EventManagement } from './views/EventManagement';
import { AuditTrail } from './views/AuditTrail';
import { DataManagement } from './views/DataManagement';

export const AdminLayout = ({ view, setView, setIsAdminLoggedIn, adminSession, branding, fetchBranding }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';

    const rawNavItems = [
        { id: 'admin_dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'admin_access_logs', label: 'Access Logs', icon: History },
        { id: 'admin_users', label: 'User Registry', icon: Users },
        { id: 'admin_academic', label: 'Academic Structure', icon: Building, reqSuper: true },
        { id: 'admin_events', label: 'Event Management', icon: Calendar, reqSuper: true },
        { id: 'admin_face', label: 'Face Recognition', icon: ScanFace, reqSuper: true },
        { id: 'admin_audit', label: 'Audit Trail', icon: ShieldAlert, reqSuper: true },
        { id: 'admin_data', label: 'Data Management', icon: Database, reqSuper: true },
        { id: 'admin_settings', label: 'System Settings', icon: Settings },
    ];

    const navItems = rawNavItems.filter(item => !item.reqSuper || isSystemAdministrator);

    const renderView = () => {
        switch (view) {
            case 'admin_dashboard': return <AdminDashboard branding={branding} adminSession={adminSession} />;
            case 'admin_access_logs': return <AccessLogs branding={branding} adminSession={adminSession} />;
            case 'admin_settings': return <SystemSettings setIsAdminLoggedIn={setIsAdminLoggedIn} setView={setView} adminSession={adminSession} branding={branding} fetchBranding={fetchBranding} />;
            case 'admin_users': return <UserManagement adminSession={adminSession} branding={branding} />;

            case 'admin_academic': return <AcademicStructure branding={branding} adminSession={adminSession} />;
            case 'admin_events': return <EventManagement branding={branding} adminSession={adminSession} />;
            case 'admin_audit': return <AuditTrail branding={branding} adminSession={adminSession} />;
            case 'admin_data': return <DataManagement adminSession={adminSession} />;
            default:
                return (
                    <div className="flex-1 flex items-center justify-center p-8">
                        <div className="bg-black/20 backdrop-blur-md rounded-2xl border border-white/10 p-12 text-center text-white/50 w-full max-w-lg shadow-2xl">
                            <h2 className="text-2xl font-bold text-white mb-2">Module Under Construction</h2>
                            <p>This administrative module is currently being built.</p>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="flex w-full h-full min-h-0 bg-slate-50 z-20">
            {/* Sidebar - fixed width, no flex-shrink */}
            <div className="w-72 flex-shrink-0 flex flex-col bg-[#1E293B] border-r border-[#0f172a] shadow-xl p-6 overflow-y-auto z-20">
                <div className="mb-8 px-2 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Admin Navigation</h3>
                </div>
                <nav className="flex flex-col gap-2">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = view === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setView(item.id)}
                                className={`flex items-center gap-4 w-full px-4 py-3 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${isActive
                                    ? 'bg-blue-600/20 text-white border-l-4 border-blue-500'
                                    : 'text-white/70 hover:bg-slate-800 hover:text-white border-l-4 border-transparent'
                                    }`}
                            >
                                <Icon className={`w-5 h-5 text-white ${isActive ? 'text-blue-400 opacity-100' : 'opacity-80'}`} />
                                <span className="font-semibold">{item.label}</span>
                            </button>
                        );
                    })}
                </nav>
            </div>

            {/* Main Content Area - flex min-h-0 ensures tables scroll inside, not the whole layout */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-10 animate-in fade-in duration-300 w-full">
                {renderView()}
            </div>
        </div>
    );
};
