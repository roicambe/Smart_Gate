import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { MyAccount } from './MyAccount';
import { AdminAccounts } from './AdminAccounts';

export const SystemSettings = ({ setIsAdminLoggedIn, setView, adminSession }) => {
    const isSuperAdmin = adminSession?.role === 'Super Admin';
    const [activeTab, setActiveTab] = useState('my_account');

    return (
        <div className="max-w-5xl mx-auto w-full space-y-6 animate-in slide-in-from-bottom-4 duration-500 flex flex-col h-full py-4">
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
                    {isSuperAdmin && (
                        <button
                            onClick={() => setActiveTab('admin_accounts')}
                            className={`px-6 py-2.5 rounded-lg font-medium transition-all duration-300 ${activeTab === 'admin_accounts'
                                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                                }`}
                        >
                            Administrative Registry
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 relative">
                {activeTab === 'my_account' && (
                    <div className="space-y-6">
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex gap-4 text-amber-800 shadow-sm">
                            <AlertCircle className="w-8 h-8 flex-shrink-0 mt-1 text-amber-600" />
                            <div>
                                <h2 className="text-xl font-bold text-amber-900 mb-1">System Maintenance</h2>
                                <p className="text-amber-700 leading-relaxed">
                                    General system settings are currently under development. You may securely update your master administrator credentials below.
                                </p>
                            </div>
                        </div>
                        <MyAccount adminSession={adminSession} setIsAdminLoggedIn={setIsAdminLoggedIn} setView={setView} />
                    </div>
                )}
                {activeTab === 'admin_accounts' && isSuperAdmin && (
                    <AdminAccounts adminSession={adminSession} />
                )}
            </div>
        </div>
    );
};
