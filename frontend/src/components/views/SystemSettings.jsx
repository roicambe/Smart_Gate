import React, { useState } from 'react';
import { MyAccount } from './MyAccount';
import { AdminAccounts } from './AdminAccounts';
import { SystemBrandingPanel } from './SystemBrandingPanel';
import { useToast } from '../toast/ToastProvider';

export const SystemSettings = ({ setIsAdminLoggedIn, setView, adminSession, branding, fetchBranding }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';
    const [activeTab, setActiveTab] = useState('my_account');
    const { showToast } = useToast();

    const notify = (message, type = 'success') => {
        showToast({ type, message });
    };

    return (
        <div className="mx-auto flex h-full w-full max-w-7xl flex-col space-y-6 py-4 animate-in slide-in-from-bottom-4 duration-500">

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
                        <MyAccount adminSession={adminSession} setIsAdminLoggedIn={setIsAdminLoggedIn} setView={setView} showToast={notify} />
                    </div>
                )}
                {activeTab === 'system_branding' && isSystemAdministrator && (
                    <SystemBrandingPanel branding={branding} fetchBranding={fetchBranding} adminSession={adminSession} showToast={notify} />
                )}
                {activeTab === 'admin_accounts' && isSystemAdministrator && (
                    <AdminAccounts adminSession={adminSession} showToast={notify} />
                )}
            </div>
        </div>
    );
};
