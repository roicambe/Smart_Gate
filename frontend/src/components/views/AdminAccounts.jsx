import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, Edit2, KeyRound, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { AdminModal } from '../common/AdminModal';
import { SettingsSectionHeader } from '../common/SettingsSectionHeader';

const ROLE_OPTIONS = ['System Administrator', 'Gate Supervisor'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generateGateSupervisorPassword = (fullName) => {
    const firstToken = (fullName || '')
        .trim()
        .split(/\s+/)
        .find(Boolean);

    const cleaned = (firstToken || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();

    return cleaned ? `${cleaned}123` : 'gatesupervisor123';
};

const getSuggestedPassword = (fullName, role) => (
    role === 'Gate Supervisor' ? generateGateSupervisorPassword(fullName) : ''
);

export const AdminAccounts = ({ adminSession, showToast }) => {
    const [accounts, setAccounts] = useState([]);

    const [showAddModal, setShowAddModal] = useState(false);
    const [showResetModal, setShowResetModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState(null);

    const [addForm, setAddForm] = useState({
        username: '',
        password: '',
        full_name: '',
        email: '',
        role: 'System Administrator',
    });
    const [hasCustomizedPassword, setHasCustomizedPassword] = useState(false);
    const [resetPass, setResetPass] = useState('');
    const [editForm, setEditForm] = useState({
        username: '',
        full_name: '',
        email: '',
    });

    const fetchAccounts = async () => {
        try {
            const data = await invoke('get_admin_accounts');
            setAccounts(data);
        } catch (error) {
            showToast('Failed to fetch accounts.', 'error');
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    useEffect(() => {
        if (addForm.role === 'Gate Supervisor' && !hasCustomizedPassword) {
            setAddForm((current) => ({
                ...current,
                password: generateGateSupervisorPassword(current.full_name),
            }));
        }
    }, [addForm.role, addForm.full_name, hasCustomizedPassword]);

    const validateEmail = (value) => EMAIL_PATTERN.test(value.trim());

    const handleAdd = async (event) => {
        event.preventDefault();

        if (!validateEmail(addForm.email)) {
            showToast('Enter a valid contact/notification email address.', 'error');
            return;
        }

        try {
            await invoke('create_admin_account', {
                username: addForm.username.trim(),
                password: addForm.password,
                fullName: addForm.full_name.trim(),
                email: addForm.email.trim(),
                role: addForm.role,
                activeAdminId: adminSession.account_id,
            });
            showToast('Admin Created: Administrator account created successfully.', 'success');
            setShowAddModal(false);
            setAddForm({
                username: '',
                password: '',
                full_name: '',
                email: '',
                role: 'System Administrator',
            });
            setHasCustomizedPassword(false);
            fetchAccounts();
        } catch (error) {
            showToast(typeof error === 'string' ? error : 'Failed to create account.', 'error');
        }
    };

    const handleUpdateRole = async (accountId, newRole) => {
        if (accountId === adminSession.account_id) {
            showToast('Cannot change your own role.', 'warning');
            return;
        }

        try {
            await invoke('update_admin_role', {
                accountId,
                newRole,
                activeAdminId: adminSession.account_id,
            });
            showToast('Settings Updated: Role updated successfully.', 'success');
            fetchAccounts();
        } catch (error) {
            showToast('Failed to update role.', 'error');
        }
    };

    const handleResetPassword = async (event) => {
        event.preventDefault();

        try {
            await invoke('reset_admin_password', {
                accountId: selectedAccount.account_id,
                newPassword: resetPass,
                activeAdminId: adminSession.account_id,
            });
            showToast(`Password Changed: Temporary password reset for ${selectedAccount.username}.`, 'success');
            setShowResetModal(false);
            setResetPass('');
            fetchAccounts();
        } catch (error) {
            showToast(typeof error === 'string' ? error : 'Failed to reset password.', 'error');
        }
    };

    const handleEditInfo = async (event) => {
        event.preventDefault();

        if (!validateEmail(editForm.email)) {
            showToast('Enter a valid contact/notification email address.', 'error');
            return;
        }

        try {
            await invoke('update_admin_info', {
                accountId: selectedAccount.account_id,
                username: editForm.username.trim(),
                fullName: editForm.full_name.trim(),
                email: editForm.email.trim(),
                activeAdminId: adminSession.account_id,
            });
            showToast(`Settings Updated: Account updated for ${editForm.username.trim()}.`, 'success');
            setShowEditModal(false);
            fetchAccounts();
        } catch (error) {
            showToast(typeof error === 'string' ? error : 'Failed to update account.', 'error');
        }
    };

    const handleDeleteAccount = async () => {
        if (!selectedAccount) {
            return;
        }

        try {
            await invoke('delete_admin_account', {
                accountId: selectedAccount.account_id,
                activeAdminId: adminSession.account_id,
            });
            showToast(`Administrator account deleted for ${selectedAccount.username}.`);
            setShowDeleteModal(false);
            setSelectedAccount(null);
            fetchAccounts();
        } catch (error) {
            showToast(typeof error === 'string' ? error : 'Failed to delete account.', 'error');
            setShowDeleteModal(false);
        }
    };

    return (
        <div className="relative flex min-h-0 w-full flex-col space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <SettingsSectionHeader
                icon={UserPlus}
                title="Administrative Registry"
                description="Oversee platform supervisors and configure role assignments."
                iconWrapperClassName="border-emerald-200 bg-emerald-50 text-emerald-600"
                action={(
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-indigo-700 focus:outline-none"
                    >
                        <UserPlus className="h-5 w-5" /> New Account
                    </button>
                )}
            />

            <div className="min-h-0 w-full overflow-y-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm text-slate-600">
                    <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-700">
                        <tr>
                            <th className="px-6 py-4 font-semibold tracking-wider">Username</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">Name</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">Contact Email</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">System Role</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
                            <th className="px-6 py-4 text-right font-semibold tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {accounts.map((account) => (
                            <tr key={account.account_id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-medium text-slate-900">{account.username}</td>
                                <td className="px-6 py-4">
                                    {account.full_name}
                                    {account.account_id === adminSession.account_id && (
                                        <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">You</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-slate-700">{account.email || 'Not set'}</td>
                                <td className="px-6 py-4">
                                    <select
                                        value={account.role}
                                        onChange={(event) => handleUpdateRole(account.account_id, event.target.value)}
                                        disabled={account.account_id === adminSession.account_id}
                                        className="min-w-[150px] cursor-pointer rounded-lg bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {ROLE_OPTIONS.map((role) => (
                                            <option key={role} value={role}>{role}</option>
                                        ))}
                                    </select>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${account.is_first_login ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                                        {account.is_first_login ? 'Pending Activation' : 'Active'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => {
                                                setSelectedAccount(account);
                                                setEditForm({
                                                    username: account.username,
                                                    full_name: account.full_name,
                                                    email: account.email || '',
                                                });
                                                setShowEditModal(true);
                                            }}
                                            className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-100"
                                        >
                                            <Edit2 className="h-3.5 w-3.5" /> Edit Info
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSelectedAccount(account);
                                                setShowResetModal(true);
                                            }}
                                            className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100"
                                        >
                                            <KeyRound className="h-3.5 w-3.5" /> Force Reset
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSelectedAccount(account);
                                                setShowDeleteModal(true);
                                            }}
                                            disabled={account.account_id === adminSession.account_id}
                                            className="flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" /> Delete
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {showAddModal && (
                <AdminModal
                    isOpen={showAddModal}
                    onClose={() => setShowAddModal(false)}
                    title="Add New Admin/Account"
                    subtitle="Issue a temporary password and a verified notification email."
                    icon={<UserPlus className="h-5 w-5 text-indigo-300" />}
                    size="lg"
                >
                    <form onSubmit={handleAdd} className="space-y-6">
                            <div className="grid gap-5">
                                <div className="space-y-3">
                                    <label className="block text-sm font-semibold text-white/80">Role Allocation</label>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {ROLE_OPTIONS.map((role) => {
                                            const active = addForm.role === role;
                                            return (
                                                <label
                                                    key={role}
                                                    className={`flex cursor-pointer flex-col justify-center rounded-2xl border px-4 py-4 transition-all ${active ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' : 'bg-black/40 border-white/10 text-white/50 hover:border-white/30'}`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="role"
                                                        value={role}
                                                        checked={active}
                                                        onChange={(event) => {
                                                            const nextRole = event.target.value;
                                                            setHasCustomizedPassword(false);
                                                            setAddForm((current) => ({
                                                                ...current,
                                                                role: nextRole,
                                                                password: getSuggestedPassword(current.full_name, nextRole),
                                                            }));
                                                        }}
                                                        className="sr-only"
                                                    />
                                                    <span className="mb-1 font-bold">{role}</span>
                                                    <span className="text-xs leading-tight opacity-70">
                                                        {role === 'System Administrator' ? 'Full system access' : 'Gate operations access'}
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-white/60">
                                        Username <span className="ml-0.5 text-rose-500">*</span>
                                    </label>
                                    <input
                                        required
                                        type="text"
                                        value={addForm.username}
                                        onChange={(event) => setAddForm({ ...addForm, username: event.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none placeholder-white/20"
                                        placeholder="e.g. admin_juan"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-white/60">
                                        Name <span className="ml-0.5 text-rose-500">*</span>
                                    </label>
                                    <input
                                        required
                                        type="text"
                                        value={addForm.full_name}
                                        onChange={(event) => {
                                            const nextFullName = event.target.value;
                                            setAddForm((current) => ({
                                                ...current,
                                                full_name: nextFullName,
                                                password: current.role === 'Gate Supervisor' && !hasCustomizedPassword
                                                    ? generateGateSupervisorPassword(nextFullName)
                                                    : current.password,
                                            }));
                                        }}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none placeholder-white/20"
                                        placeholder="Juan Dela Cruz"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-white/60">
                                        Contact/Notification Email <span className="ml-0.5 text-rose-500">*</span>
                                    </label>
                                    <input
                                        required
                                        type="email"
                                        value={addForm.email}
                                        onChange={(event) => setAddForm({ ...addForm, email: event.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none placeholder-white/20"
                                        placeholder="security.officer@plp.edu.ph"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-white/60">
                                        Temporary Password <span className="ml-0.5 text-rose-500">*</span>
                                    </label>
                                    <input
                                        required
                                        type="text"
                                        value={addForm.password}
                                        onChange={(event) => {
                                            setHasCustomizedPassword(true);
                                            setAddForm({ ...addForm, password: event.target.value });
                                        }}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white font-mono focus:ring-2 focus:ring-white/20 focus:outline-none placeholder-white/20"
                                        placeholder={addForm.role === 'Gate Supervisor' ? 'Suggested from the supervisor name' : 'Create a temporary password'}
                                    />
                                    {addForm.role === 'Gate Supervisor' && (
                                        <p className="mt-2 text-xs text-white/45">
                                            Auto-filled from the provided name to keep first-login credentials easy, but you can still edit it.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    className="w-full bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_20px_rgba(99,102,241,0.2)] hover:shadow-[0_0_30px_rgba(99,102,241,0.4)] font-bold text-lg py-4 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-white/40 flex justify-center items-center gap-2 hover:scale-[1.01]"
                                >
                                    <CheckCircle2 className="h-6 w-6" /> Confirm & Register Account
                                </button>
                            </div>
                    </form>
                </AdminModal>
            )}

            {showResetModal && selectedAccount && (
                <AdminModal
                    isOpen={showResetModal}
                    onClose={() => setShowResetModal(false)}
                    title="Force Password Reset"
                    icon={<KeyRound className="h-5 w-5 text-rose-300" />}
                    size="md"
                >
                    <form onSubmit={handleResetPassword} className="space-y-6">
                            <p className="mb-4 text-sm leading-relaxed text-white/70">
                                Set a new temporary passcode for <span className="font-bold tracking-wide text-white">{selectedAccount.username}</span>. The next sign-in will require OTP activation.
                            </p>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-white/60">Temporary Password <span className="ml-0.5 text-rose-500">*</span></label>
                                <input
                                    required
                                    type="text"
                                    value={resetPass}
                                    onChange={(event) => setResetPass(event.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                                />
                            </div>
                            <div className="pt-2">
                                <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 py-3.5 font-bold text-white transition-all hover:bg-rose-400 focus:outline-none focus:ring-4 focus:ring-white/40">
                                    <KeyRound className="h-5 w-5" /> Overwrite Passcode
                                </button>
                            </div>
                    </form>
                </AdminModal>
            )}

            {showEditModal && selectedAccount && (
                <AdminModal
                    isOpen={showEditModal}
                    onClose={() => setShowEditModal(false)}
                    title="Edit Account Info"
                    subtitle="Update identity and notification details."
                    icon={<Edit2 className="h-5 w-5 text-amber-300" />}
                    size="md"
                >
                    <form onSubmit={handleEditInfo} className="space-y-6">
                            <p className="-mt-2 mb-2 text-sm text-white/50">Password is not editable here.</p>
                            <div className="grid gap-5">
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-white/60">
                                        Username <span className="ml-0.5 text-rose-500">*</span>
                                    </label>
                                    <input
                                        required
                                        type="text"
                                        value={editForm.username}
                                        onChange={(event) => setEditForm({ ...editForm, username: event.target.value })}
                                        className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-white/20"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-white/60">
                                        Name <span className="ml-0.5 text-rose-500">*</span>
                                    </label>
                                    <input
                                        required
                                        type="text"
                                        value={editForm.full_name}
                                        onChange={(event) => setEditForm({ ...editForm, full_name: event.target.value })}
                                        className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-white/20"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-white/60">
                                        Contact/Notification Email <span className="ml-0.5 text-rose-500">*</span>
                                    </label>
                                    <input
                                        required
                                        type="email"
                                        value={editForm.email}
                                        onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                                        className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-white/20"
                                        placeholder="security.officer@plp.edu.ph"
                                    />
                                </div>
                            </div>
                            <div className="pt-2">
                                <button
                                    type="submit"
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3.5 font-bold text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.2)] transition-all hover:bg-amber-400 hover:shadow-[0_0_30px_rgba(245,158,11,0.4)] focus:outline-none focus:ring-4 focus:ring-white/40 hover:scale-[1.01]"
                                >
                                    <CheckCircle2 className="h-5 w-5" /> Save Changes
                                </button>
                            </div>
                    </form>
                </AdminModal>
            )}

            {showDeleteModal && selectedAccount && (
                <AdminModal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    title="Delete Administrator Account"
                    subtitle="This action permanently removes the selected account."
                    icon={<Trash2 className="h-5 w-5 text-rose-300" />}
                    tone="danger"
                    size="md"
                >
                    <div className="space-y-5">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                                <p className="font-semibold text-slate-900">{selectedAccount.full_name}</p>
                                <p>{selectedAccount.username}</p>
                                <p>{selectedAccount.email || 'No contact email set'}</p>
                                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">{selectedAccount.role}</p>
                            </div>

                            <p className="text-sm leading-relaxed text-slate-600">
                                Only a System Administrator can perform this action. This account will lose access immediately and cannot be restored automatically.
                            </p>

                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteModal(false)}
                                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-100 focus:outline-none"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDeleteAccount}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 font-bold text-white transition hover:bg-rose-700 focus:outline-none"
                                >
                                    <Trash2 className="h-4 w-4" /> Delete Account
                                </button>
                            </div>
                    </div>
                </AdminModal>
            )}
        </div>
    );
};
