import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { KeyRound, Save, User, Mail, UserCircle, ShieldCheck } from 'lucide-react';
import { SettingsSectionHeader } from '../common/SettingsSectionHeader';

export const MyAccount = ({ adminSession, setIsAdminLoggedIn, setView, showToast }) => {
    // Profile State
    const [fullName, setFullName] = useState(adminSession?.full_name || '');
    const [username, setUsername] = useState(adminSession?.username || '');
    const [email, setEmail] = useState(adminSession?.email || '');
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

    // Password State
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        setIsUpdatingProfile(true);
        try {
            await invoke('update_admin_info', {
                accountId: adminSession.account_id,
                username: username.trim(),
                fullName: fullName.trim(),
                email: email.trim(),
                activeAdminId: adminSession.account_id,
            });
            showToast('Profile Updated: Personal information saved successfully.', 'success');
            // Note: In a real app, we'd update the global adminSession state here too.
        } catch (err) {
            showToast(typeof err === 'string' ? err : 'Failed to update profile.', 'error');
        } finally {
            setIsUpdatingProfile(false);
        }
    };

    const handleUpdateCredentials = async (e) => {
        e.preventDefault();
        setIsUpdatingPassword(true);
        try {
            const success = await invoke('update_admin_credentials', {
                accountId: adminSession.account_id,
                currentPassword,
                newPassword
            });
            if (success) {
                showToast('Password changed. Please log in again.', 'success');
                setTimeout(() => {
                    setIsAdminLoggedIn(false);
                    setView('main');
                }, 2000);
            } else {
                showToast('Current password incorrect.', 'error');
            }
        } catch (err) {
            showToast(typeof err === 'string' ? err : 'Failed to update credentials.', 'error');
        } finally {
            setIsUpdatingPassword(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                <SettingsSectionHeader
                    icon={UserCircle}
                    title="My Profile Defaults"
                    description="Manage your personal information and security settings."
                    iconWrapperClassName="border-sky-200 bg-sky-50 text-sky-600"
                />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mt-8">
                    {/* Left Column: Personal Information */}
                    <div className="space-y-6">
                        <div className="flex items-center gap-2 mb-2">
                            <User className="w-4 h-4 text-slate-400" />
                            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Personal Information</h3>
                        </div>
                        
                        <form onSubmit={handleUpdateProfile} className="space-y-5">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">Full Name</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        required
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm transition-all font-medium pl-11"
                                    />
                                    <User className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">Username</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        required
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm transition-all font-medium pl-11"
                                    />
                                    <UserCircle className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">Email Address</label>
                                <div className="relative">
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm transition-all font-medium pl-11"
                                    />
                                    <Mail className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                                </div>
                            </div>

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={isUpdatingProfile}
                                    className="w-full py-3.5 px-4 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-slate-500/30 flex justify-center items-center gap-2 disabled:opacity-70"
                                >
                                    <Save className="w-5 h-5" />
                                    {isUpdatingProfile ? 'Updating Profile...' : 'Save Profile Changes'}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* Right Column: Security & Access */}
                    <div className="space-y-6">
                        <div className="flex items-center gap-2 mb-2">
                            <ShieldCheck className="w-4 h-4 text-slate-400" />
                            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Security & Access</h3>
                        </div>

                        <form onSubmit={handleUpdateCredentials} className="space-y-5">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">Current Passcode</label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        required
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm transition-all font-medium pl-11"
                                    />
                                    <KeyRound className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">New Passcode</label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        required
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm transition-all font-medium pl-11"
                                    />
                                    <KeyRound className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                                </div>
                            </div>

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={isUpdatingPassword}
                                    className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 flex justify-center items-center gap-2 disabled:opacity-70"
                                >
                                    <Save className="w-5 h-5" />
                                    {isUpdatingPassword ? 'Updating Password...' : 'Overwrite Passcode'}
                                </button>
                            </div>
                        </form>

                        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mt-4">
                            <p className="text-xs text-amber-700 leading-relaxed font-medium">
                                <span className="font-bold uppercase tracking-wider block mb-1">Important Note:</span>
                                Changing your passcode will end your current session. You will be required to log in again with your new credentials for security purposes.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
