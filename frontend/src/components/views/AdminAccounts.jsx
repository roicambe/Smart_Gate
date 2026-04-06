import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ShieldCheck, UserPlus, KeyRound, Edit2, X, AlertCircle, CheckCircle2 } from 'lucide-react';

export const AdminAccounts = ({ adminSession, showToast }) => {
    const ROLE_OPTIONS = ['System Administrator', 'Gate Supervisor'];
    const [accounts, setAccounts] = useState([]);
    const [status, setStatus] = useState(null);

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showResetModal, setShowResetModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState(null);

    // Forms
    const [addForm, setAddForm] = useState({ username: '', password: '', full_name: '', role: 'System Administrator' });
    const [resetPass, setResetPass] = useState('');
    const [editForm, setEditForm] = useState({ username: '', full_name: '' });

    const fetchAccounts = async () => {
        try {
            const data = await invoke('get_admin_accounts');
            setAccounts(data);
        } catch (e) {
            setStatus({ type: 'error', message: 'Failed to fetch accounts.' });
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    const handleAdd = async (e) => {
        e.preventDefault();
        try {
            await invoke('add_admin_account', {
                username: addForm.username,
                password: addForm.password,
                fullName: addForm.full_name,
                role: addForm.role,
                activeAdminId: adminSession.account_id
            });
            showToast('Administrator account created successfully.');
            setShowAddModal(false);
            setAddForm({ username: '', password: '', full_name: '', role: 'System Administrator' });
            fetchAccounts();
        } catch (e) {
            setStatus({ type: 'error', message: typeof e === 'string' ? e : 'Failed to create.' });
        }
    };

    const handleUpdateRole = async (accountId, newRole) => {
        if (accountId === adminSession.account_id) {
            setStatus({ type: 'error', message: 'Cannot demote your own account.' });
            return;
        }
        try {
            await invoke('update_admin_role', {
                accountId,
                newRole,
                activeAdminId: adminSession.account_id
            });
            showToast('Role updated successfully.');
            fetchAccounts();
        } catch (e) {
            setStatus({ type: 'error', message: 'Failed to update role.' });
        }
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        try {
            await invoke('reset_admin_password', {
                accountId: selectedAccount.account_id,
                newPassword: resetPass,
                activeAdminId: adminSession.account_id
            });
            showToast(`Password reset for ${selectedAccount.username}.`);
            setShowResetModal(false);
            setResetPass('');
        } catch (e) {
            setStatus({ type: 'error', message: 'Failed to reset password.' });
        }
    };

    const handleEditInfo = async (e) => {
        e.preventDefault();
        try {
            await invoke('update_admin_info', {
                accountId: selectedAccount.account_id,
                username: editForm.username,
                fullName: editForm.full_name,
                activeAdminId: adminSession.account_id
            });
            showToast(`Account updated for ${editForm.username}.`);
            setShowEditModal(false);
            fetchAccounts();
        } catch (e) {
            setStatus({ type: 'error', message: typeof e === 'string' ? e : 'Failed to update account.' });
        }
    };

    return (
        <div className="w-full space-y-6 relative flex flex-col min-h-0 bg-white border border-slate-200 shadow-sm rounded-2xl p-6">
            {status && status.type === 'error' && (
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4 pointer-events-none">
                    <div className={`pointer-events-auto p-4 rounded-xl flex items-center justify-between gap-4 shadow-lg border ${status.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
                        <div className="flex items-center gap-3">
                            {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
                            <span className="font-medium text-sm">{status.message}</span>
                        </div>
                        <button onClick={() => setStatus(null)}><X className="w-5 h-5 hover:text-slate-500" /></button>
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 border border-indigo-100 mb-1">
                        <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 tracking-wide">Administrator Registry</h2>
                        <p className="text-slate-500 text-sm">Oversee platform supervisors and configure role assignments.</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-lg font-bold shadow-sm transition-all focus:outline-none"
                >
                    <UserPlus className="w-4 h-4" /> New Account
                </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden min-h-0 overflow-y-auto w-full">
                <table className="w-full text-left text-sm text-slate-600">
                    <thead className="text-xs uppercase bg-slate-50 border-b border-slate-200 text-slate-700 sticky top-0">
                        <tr>
                            <th className="px-6 py-4 font-semibold tracking-wider">Username</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">Name</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">System Role</th>
                            <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {accounts.map(acc => (
                            <tr key={acc.account_id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-medium text-slate-900">{acc.username}</td>
                                <td className="px-6 py-4">{acc.full_name} {acc.account_id === adminSession.account_id && <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">You</span>}</td>
                                <td className="px-6 py-4">
                                    <select
                                        value={acc.role}
                                        onChange={(e) => handleUpdateRole(acc.account_id, e.target.value)}
                                        disabled={acc.account_id === adminSession.account_id}
                                        className="bg-slate-100 border-none text-sm font-semibold text-slate-700 rounded-lg px-2 py-1 outline-none min-w-[120px] focus:ring-2 focus:ring-indigo-500/50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {ROLE_OPTIONS.map(role => (
                                            <option key={role} value={role}>{role}</option>
                                        ))}
                                    </select>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => {
                                                setSelectedAccount(acc);
                                                setEditForm({ username: acc.username, full_name: acc.full_name });
                                                setShowEditModal(true);
                                            }}
                                            className="text-xs font-semibold px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-600 border border-amber-200 rounded-lg transition-colors flex items-center gap-1"
                                        >
                                            <Edit2 className="w-3.5 h-3.5" /> Edit Info
                                        </button>
                                        <button
                                            onClick={() => { setSelectedAccount(acc); setShowResetModal(true); }}
                                            className="text-xs font-semibold px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg transition-colors flex items-center gap-1"
                                        >
                                            <KeyRound className="w-3.5 h-3.5" /> Force Reset
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Add Administrator Modal - Dark Theme */}
            {showAddModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
                    <div className="bg-black/90 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-lg overflow-y-auto max-h-[90vh] animate-in zoom-in-95 duration-200">
                        <div className="px-8 py-6 border-b border-white/10 flex justify-between items-center sticky top-0 bg-black/50 backdrop-blur-md z-10">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white/10 rounded-lg border border-white/20">
                                    <UserPlus className="w-5 h-5 text-indigo-400" />
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-wide">Register New Administrator</h2>
                            </div>
                            <button onClick={() => setShowAddModal(false)} className="text-white/50 hover:text-white transition-colors bg-white/5 p-2 rounded-xl hover:bg-white/10"><X className="w-5 h-5" /></button>
                        </div>

                        <form onSubmit={handleAdd} className="p-8 space-y-6">
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-xs text-white/60 mb-1 font-medium">Username <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                    <input required type="text" value={addForm.username} onChange={e => setAddForm({ ...addForm, username: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none placeholder-white/20" placeholder="e.g. admin_juan" />
                                </div>
                                <div>
                                    <label className="block text-xs text-white/60 mb-1 font-medium">Name <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                    <input required type="text" value={addForm.full_name} onChange={e => setAddForm({ ...addForm, full_name: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none placeholder-white/20" placeholder="Juan Dela Cruz" />
                                </div>
                                <div>
                                    <label className="block text-xs text-white/60 mb-1 font-medium">Initial Passcode <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                    <input required type="text" value={addForm.password} onChange={e => setAddForm({ ...addForm, password: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white font-mono focus:ring-2 focus:ring-white/20 focus:outline-none placeholder-white/20" placeholder="password123" />
                                </div>
                                
                                <div className="space-y-3">
                                    <label className="block text-sm font-semibold text-white/80">Role Allocation</label>
                                    <div className="flex gap-3">
                                        <label className={`flex-1 flex flex-col items-center justify-center p-4 rounded-xl border cursor-pointer transition-all ${addForm.role === 'System Administrator' ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' : 'bg-black/40 border-white/10 text-white/50 hover:border-white/30'}`}>
                                            <input type="radio" name="role" value="System Administrator" checked={addForm.role === 'System Administrator'} onChange={(e) => setAddForm({ ...addForm, role: e.target.value })} className="sr-only" />
                                            <span className="font-bold text-lg mb-1">System Administrator</span>
                                            <span className="text-xs text-center leading-tight opacity-70">Full system access</span>
                                        </label>
                                        <label className={`flex-1 flex flex-col items-center justify-center p-4 rounded-xl border cursor-pointer transition-all ${addForm.role === 'Gate Supervisor' ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' : 'bg-black/40 border-white/10 text-white/50 hover:border-white/30'}`}>
                                            <input type="radio" name="role" value="Gate Supervisor" checked={addForm.role === 'Gate Supervisor'} onChange={(e) => setAddForm({ ...addForm, role: e.target.value })} className="sr-only" />
                                            <span className="font-bold text-lg mb-1">Gate Supervisor</span>
                                            <span className="text-xs text-center leading-tight opacity-70">Gate operations access</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="pt-6">
                                <button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_20px_rgba(99,102,241,0.2)] hover:shadow-[0_0_30px_rgba(99,102,241,0.4)] font-bold text-lg py-4 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-white/40 flex justify-center items-center gap-2 hover:scale-[1.01]">
                                    <CheckCircle2 className="w-6 h-6" /> Confirm & Register Account
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Reset Password Modal - Dark Theme */}
            {showResetModal && selectedAccount && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-black/90 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-black/50">
                            <h2 className="text-xl font-bold text-white tracking-wide">Force Password Reset</h2>
                            <button onClick={() => setShowResetModal(false)} className="text-white/50 hover:text-white transition-colors bg-white/5 p-2 rounded-xl hover:bg-white/10"><X className="w-5 h-5" /></button>
                        </div>
                        <form onSubmit={handleResetPassword} className="p-8 space-y-6">
                            <p className="text-sm text-white/70 mb-4 leading-relaxed">
                                Set a temporary passcode for <span className="font-bold text-white tracking-wide">{selectedAccount.username}</span>.
                            </p>
                            <div>
                                <label className="block text-xs text-white/60 mb-1 font-medium">New Passcode <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                <input required type="text" value={resetPass} onChange={e => setResetPass(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white font-mono focus:ring-2 focus:ring-rose-500/50 focus:outline-none placeholder-white/20" />
                            </div>
                            <div className="pt-2">
                                <button type="submit" className="w-full bg-rose-500 hover:bg-rose-400 text-white shadow-[0_0_20px_rgba(244,63,94,0.2)] hover:shadow-[0_0_30px_rgba(244,63,94,0.4)] font-bold py-3.5 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-white/40 flex justify-center items-center gap-2">
                                    <KeyRound className="w-5 h-5" /> Overwrite Passcode
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Edit Account Info Modal - Dark Theme */}
            {showEditModal && selectedAccount && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
                    <div className="bg-black/90 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-8 py-6 border-b border-white/10 flex justify-between items-center bg-black/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white/10 rounded-lg border border-white/20">
                                    <Edit2 className="w-5 h-5 text-amber-400" />
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-wide">Edit Account Info</h2>
                            </div>
                            <button onClick={() => setShowEditModal(false)} className="text-white/50 hover:text-white transition-colors bg-white/5 p-2 rounded-xl hover:bg-white/10"><X className="w-5 h-5" /></button>
                        </div>
                        <form onSubmit={handleEditInfo} className="p-8 space-y-5">
                            <p className="text-sm text-white/50 -mt-2 mb-2">Password is not editable here.</p>
                            <div>
                                <label className="block text-xs text-white/60 mb-1 font-medium">Username <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                <input required type="text" value={editForm.username} onChange={e => setEditForm({ ...editForm, username: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-amber-500/50 focus:outline-none" />
                            </div>
                            <div>
                                <label className="block text-xs text-white/60 mb-1 font-medium">Name <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                <input required type="text" value={editForm.full_name} onChange={e => setEditForm({ ...editForm, full_name: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-amber-500/50 focus:outline-none" />
                            </div>
                            <div className="pt-4">
                                <button type="submit" className="w-full bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)] hover:shadow-[0_0_30px_rgba(245,158,11,0.4)] font-bold py-3.5 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-white/40 flex justify-center items-center gap-2">
                                    <CheckCircle2 className="w-5 h-5" /> Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
