import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { MyAccount } from './MyAccount';
import { AdminAccounts } from './AdminAccounts';
import { SystemBrandingPanel } from './SystemBrandingPanel';

export const SystemSettings = ({ setIsAdminLoggedIn, setView, adminSession, branding, fetchBranding }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';
    const [activeTab, setActiveTab] = useState('my_account');
    const [toastMessage, setToastMessage] = useState(null);

    const showToast = (message) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(null), 3000);
    };

    return (
        <div className="max-w-5xl mx-auto w-full space-y-6 animate-in slide-in-from-bottom-4 duration-500 flex flex-col h-full py-4">
            
            {toastMessage && (
                <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 flex items-center justify-between gap-4 px-5 py-3 pr-4 bg-[#ecfdf5] text-[#065f46] border border-[#a7f3d0] shadow-xl rounded-2xl min-w-[350px] animate-in slide-in-from-top-6 duration-300">
                    <div className="flex items-center gap-3">
                        <div className="h-6 w-6 rounded-full bg-white border flex items-center justify-center border-[#34d399]">
                            <CheckCircle2 className="w-4 h-4 text-[#059669]" />
                        </div>
                        <span className="font-semibold text-[15px]">{toastMessage}</span>
                    </div>
                    <button onClick={() => setToastMessage(null)} className="text-[#047857] hover:bg-[#d1fae5] p-1 rounded-lg transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            <div className="flex justify-between items-center mb-2">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">System Settings</h1>
                    <p className="text-slate-500">Manage administrator credentials and system configurations.</p>
                </div>
            </div>

            {/* Controls: Tabs */}
            <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4">
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit">
                    <button
                        onClick={() => setActiveTab('my_account')}
                        className={`px-6 py-2.5 rounded-lg font-medium transition-all duration-300 ${activeTab === 'my_account'
                            ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                            }`}
                    >
                        My Profile
                    </button>
                    {isSystemAdministrator && (
                        <>
                            <button
                                onClick={() => setActiveTab('system_branding')}
                                className={`px-6 py-2.5 rounded-lg font-medium transition-all duration-300 ${activeTab === 'system_branding'
                                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                                    }`}
                            >
                                System Branding
                            </button>
                            <button
                                onClick={() => setActiveTab('admin_accounts')}
                                className={`px-6 py-2.5 rounded-lg font-medium transition-all duration-300 ${activeTab === 'admin_accounts'
                                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                                    }`}
                            >
                                Administrative Registry
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 relative">
                {activeTab === 'my_account' && (
                    <div className="space-y-6">
                        <MyAccount adminSession={adminSession} setIsAdminLoggedIn={setIsAdminLoggedIn} setView={setView} showToast={showToast} />
                    </div>
                )}
                {activeTab === 'system_branding' && isSystemAdministrator && (
                    <SystemBrandingPanel branding={branding} fetchBranding={fetchBranding} adminSession={adminSession} showToast={showToast} />
                )}
                {activeTab === 'admin_accounts' && isSystemAdministrator && (
                    <AdminAccounts adminSession={adminSession} showToast={showToast} />
                )}
            </div>
        </div>
    );
};
