import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { KeyRound, AlertCircle, CheckCircle2, Save } from 'lucide-react';

export const SystemSettings = ({ setIsAdminLoggedIn, setView }) => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [status, setStatus] = useState(null);

    const handleUpdateCredentials = async (e) => {
        e.preventDefault();
        setStatus(null);
        try {
            const success = await invoke('update_admin_credentials', {
                currentPassword,
                newPassword
            });
            if (success) {
                setStatus({ type: 'success', message: 'Credentials updated. Please log in again.' });
                setTimeout(() => {
                    setIsAdminLoggedIn(false);
                    setView('main');
                }, 2000);
            } else {
                setStatus({ type: 'error', message: 'Current password incorrect.' });
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Failed to update credentials.' });
        }
    };

    return (
        <div className="max-w-4xl mx-auto w-full space-y-8 animate-in slide-in-from-bottom-4 duration-500 flex flex-col h-full py-4">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">System Settings</h1>
                    <p className="text-slate-500">Manage administrator credentials and system configurations.</p>
                </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex gap-4 text-amber-800 shadow-sm">
                <AlertCircle className="w-8 h-8 flex-shrink-0 mt-1 text-amber-600" />
                <div>
                    <h2 className="text-xl font-bold text-amber-900 mb-1">System Maintenance</h2>
                    <p className="text-amber-700 leading-relaxed">
                        General system settings are currently under development. You may securely update your master administrator credentials below.
                    </p>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                <div className="flex items-center gap-4 mb-8 pb-4 border-b border-slate-100">
                    <div className="h-12 w-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 border border-blue-100 shadow-sm">
                        <KeyRound className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900 tracking-wide">Admin Credentials</h2>
                        <p className="text-slate-500 text-sm">Update your secure access passphrase.</p>
                    </div>
                </div>

                <form onSubmit={handleUpdateCredentials} className="space-y-6 max-w-md">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">Current Passcode <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                        <input
                            type="password"
                            required
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm transition-all font-medium"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">New Passcode <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                        <input
                            type="password"
                            required
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm transition-all font-medium"
                        />
                    </div>

                    {status && (
                        <div className={`p-4 rounded-xl flex items-center gap-3 animate-in fade-in duration-300 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                            {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
                            <span className="text-sm font-medium">{status.message}</span>
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            type="submit"
                            className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 flex justify-center items-center gap-2"
                        >
                            <Save className="w-5 h-5" />
                            Save Credentials
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
