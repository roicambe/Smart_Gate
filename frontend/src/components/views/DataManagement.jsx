import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
    Database, HardDrive, RefreshCw, Archive, Search, Filter, 
    AlertTriangle, ShieldAlert, History, ShieldCheck, Check, 
    Trash2, RotateCcw, Users, Building, Calendar, Download
} from 'lucide-react';
import { useToast } from '../toast/ToastProvider';
import { save, open } from '@tauri-apps/plugin-dialog';
import { AdminModal } from '../common/AdminModal';

export const DataManagement = ({ adminSession }) => {
    const [activeTab, setActiveTab] = useState('archive_center');
    const [activeSubTab, setActiveSubTab] = useState('users');
    const { showToast } = useToast();

    // Data states
    const [archivedUsers, setArchivedUsers] = useState([]);
    const [archivedEvents, setArchivedEvents] = useState([]);
    const [archivedAcademic, setArchivedAcademic] = useState({ departments: [], programs: [] });
    const [dbStats, setDbStats] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    // Modal state
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null); // { type: 'restore'|'delete'|'restore_db', target: ..., function: ... }
    const [confirmInput, setConfirmInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const activeAdminId = adminSession?.account_id;

    useEffect(() => {
        loadAllData();
    }, []);

    const loadAllData = async () => {
        setIsLoading(true);
        try {
            const [users, events, academic, stats] = await Promise.all([
                invoke('get_archived_users'),
                invoke('get_archived_events'),
                invoke('get_archived_academic'),
                invoke('get_database_stats')
            ]);
            setArchivedUsers(users || []);
            setArchivedEvents(events || []);
            setArchivedAcademic(academic || { departments: [], programs: [] });
            setDbStats(stats);
        } catch (error) {
            console.error("Failed to load data:", error);
            showToast({ type: 'error', message: "Failed to load database information." });
        } finally {
            setIsLoading(false);
        }
    };

    const handleBackup = async () => {
        try {
            const defaultDate = new Date().toISOString().split('T')[0];
            const savePath = await save({
                filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
                defaultPath: `smart_gate_backup_${defaultDate}.sqlite`
            });

            if (!savePath) return;

            setIsProcessing(true);
            const result = await invoke('backup_database', { destinationPath: savePath });
            showToast({ type: 'success', message: result });
        } catch (error) {
            showToast({ type: 'error', message: error.toString() });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRestoreDatabase = async () => {
        try {
            const selectedPath = await open({
                filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
                multiple: false
            });

            if (!selectedPath) return;

            // Open confirmation modal
            setConfirmAction({
                type: 'restore_db',
                title: 'RESTORE DATABASE',
                message: 'This will completely overwrite the current database with the selected backup file. The system will need to be restarted after this operation.',
                targetName: 'SYSTEM DATABASE',
                requiredText: 'RESTORE',
                execute: async () => {
                    const result = await invoke('restore_database', { sourcePath: selectedPath });
                    showToast({ type: 'success', message: result });
                    setTimeout(() => window.location.reload(), 3000);
                }
            });
            setIsConfirmModalOpen(true);
        } catch (error) {
            showToast({ type: 'error', message: error.toString() });
        }
    };

    const openConfirmModal = (type, itemType, item, idField, nameField) => {
        const isDelete = type === 'delete';
        setConfirmAction({
            type,
            title: isDelete ? 'PERMANENT DELETE' : 'RESTORE RECORD',
            message: isDelete 
                ? 'This action cannot be undone. All logs associated with this record will also be destroyed.'
                : 'This record will be moved back to the active system.',
            targetName: item[nameField] || `ID ${item[idField]}`,
            requiredText: isDelete ? 'DELETE' : 'RESTORE',
            execute: async () => {
                let commandStr = isDelete ? `permanent_delete_${itemType}` : `restore_${itemType}`;
                let payload = { activeAdminId };
                payload[`${itemType}Id`] = item[idField];
                
                // Rust uses snake_case, JS uses camelCase for the property.
                // The invoke function automatically converts camelCase payload keys to snake_case.
                let rustPayload = { activeAdminId };
                if (itemType === 'user') rustPayload.personId = item[idField];
                else if (itemType === 'event') rustPayload.eventId = item[idField];
                else if (itemType === 'department') rustPayload.departmentId = item[idField];
                else if (itemType === 'program') rustPayload.programId = item[idField];

                await invoke(commandStr, rustPayload);
                showToast({ 
                    type: 'success', 
                    message: `Record successfully ${isDelete ? 'deleted' : 'restored'}.` 
                });
                loadAllData();
            }
        });
        setIsConfirmModalOpen(true);
        setConfirmInput('');
    };

    const executeConfirmAction = async () => {
        if (!confirmAction) return;
        setIsProcessing(true);
        try {
            await confirmAction.execute();
            setIsConfirmModalOpen(false);
        } catch (error) {
            showToast({ type: 'error', message: error.toString() });
        } finally {
            setIsProcessing(false);
        }
    };

    const formatBytes = (bytes) => {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Rendering Sub-tabs for Archive Center
    const renderArchiveTable = () => {
        if (activeSubTab === 'users') {
            return (
                <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 shadow-sm bg-white mt-4">
                    <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
                            <tr className="text-slate-600">
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">ID Number</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Full Name</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Program and Year</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Archived Date</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {archivedUsers.length === 0 ? (
                                <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400">No archived users found.</td></tr>
                            ) : archivedUsers.map(u => (
                                <tr key={u.person_id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-5 py-3 font-mono font-medium text-slate-900">{u.id_number}</td>
                                    <td className="px-5 py-3 font-medium text-slate-900">{u.first_name} {u.last_name}</td>
                                    <td className="px-5 py-3">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-slate-900">{u.affiliation}</span>
                                            {u.role === 'student' && u.year_level && (
                                                <span className="text-xs text-slate-500 font-medium">Year {u.year_level}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 text-slate-500 font-medium">{new Date(u.archived_at).toLocaleString()}</td>
                                    <td className="px-5 py-3 text-right space-x-2">
                                        <button onClick={() => openConfirmModal('restore', 'user', u, 'person_id', 'first_name')} className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors border border-transparent hover:border-emerald-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Restore User">
                                            <RotateCcw className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => openConfirmModal('delete', 'user', u, 'person_id', 'first_name')} className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Purge User Permanently">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        } else if (activeSubTab === 'academic') {
            return (
                <div className="space-y-6 mt-4">
                    <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 shadow-sm bg-white">
                        <table className="w-full text-sm text-left border-collapse">
                            <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
                                <tr className="text-slate-600">
                                    <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Code</th>
                                    <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Name</th>
                                    <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Type</th>
                                    <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Archived Date</th>
                                    <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {archivedAcademic.departments.length === 0 && archivedAcademic.programs.length === 0 ? (
                                    <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400">No archived academic structures found.</td></tr>
                                ) : (
                                    <>
                                        {archivedAcademic.departments.map(d => (
                                            <tr key={`dept-${d.id}`} className="hover:bg-slate-50 transition-colors group">
                                                <td className="px-5 py-3 font-medium text-slate-900">{d.code}</td>
                                                <td className="px-5 py-3">{d.name}</td>
                                                <td className="px-5 py-3"><span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-md text-xs font-bold">Department</span></td>
                                                <td className="px-5 py-3 text-slate-500">{new Date(d.archived_at).toLocaleString()}</td>
                                                <td className="px-5 py-3 text-right space-x-2">
                                                    <button onClick={() => openConfirmModal('restore', 'department', d, 'id', 'name')} className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors border border-transparent hover:border-emerald-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Restore Department">
                                                        <RotateCcw className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => openConfirmModal('delete', 'department', d, 'id', 'name')} className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Purge Department Permanently">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {archivedAcademic.programs.map(p => (
                                            <tr key={`prog-${p.id}`} className="hover:bg-slate-50 transition-colors group">
                                                <td className="px-5 py-3 font-medium text-slate-900">{p.code}</td>
                                                <td className="px-5 py-3">
                                                    <div className="flex flex-col">
                                                        <span>{p.name}</span>
                                                        <span className="text-xs text-slate-500">{p.department_name}</span>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3"><span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-bold">Program</span></td>
                                                <td className="px-5 py-3 text-slate-500">{new Date(p.archived_at).toLocaleString()}</td>
                                                <td className="px-5 py-3 text-right space-x-2">
                                                    <button onClick={() => openConfirmModal('restore', 'program', p, 'id', 'name')} className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors border border-transparent hover:border-emerald-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Restore Program">
                                                        <RotateCcw className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => openConfirmModal('delete', 'program', p, 'id', 'name')} className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Purge Program Permanently">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        } else if (activeSubTab === 'events') {
            return (
                <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 shadow-sm bg-white mt-4">
                    <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
                            <tr className="text-slate-600">
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Event Name</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Date & Time</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Required Role</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Archived Date</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {archivedEvents.length === 0 ? (
                                <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400">No archived events found.</td></tr>
                            ) : archivedEvents.map(e => (
                                <tr key={e.event_id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-5 py-3 font-medium text-slate-900">{e.event_name}</td>
                                    <td className="px-5 py-3">{e.event_date} ({e.start_time} - {e.end_time})</td>
                                    <td className="px-5 py-3 capitalize">{e.required_role}</td>
                                    <td className="px-5 py-3 text-slate-500">{new Date(e.archived_at).toLocaleString()}</td>
                                    <td className="px-5 py-3 text-right space-x-2">
                                        <button onClick={() => openConfirmModal('restore', 'event', e, 'event_id', 'event_name')} className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors border border-transparent hover:border-emerald-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Restore Event">
                                            <RotateCcw className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => openConfirmModal('delete', 'event', e, 'event_id', 'event_name')} className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Purge Event Permanently">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 animate-in slide-in-from-bottom-4 duration-500 relative">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Data Management</h1>
                    <p className="text-slate-500">Manage archived records, system backups, and database integrity.</p>
                </div>
                <button onClick={loadAllData} className="p-2 bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg shadow-sm transition-colors">
                    <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Main Tabs */}
            <div className="p-2 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4 mb-0">
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit">
                    <button
                        onClick={() => setActiveTab('archive_center')}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-300 ${activeTab === 'archive_center'
                            ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                            }`}
                    >
                        <Archive className="w-4 h-4" />
                        Archive Center
                    </button>
                    <button
                        onClick={() => setActiveTab('backup_recovery')}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-300 ${activeTab === 'backup_recovery'
                            ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                            }`}
                    >
                        <Database className="w-4 h-4" />
                        Backup & Recovery
                    </button>
                </div>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-8">
                {activeTab === 'archive_center' && (
                    <div className="space-y-2">
                        <div className="flex border-b border-slate-200">
                            {[
                                { id: 'users', label: 'User Registry', icon: Users },
                                { id: 'academic', label: 'Academic Structure', icon: Building },
                                { id: 'events', label: 'Event Management', icon: Calendar }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveSubTab(tab.id)}
                                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                                        activeSubTab === tab.id
                                            ? 'border-blue-600 text-blue-600'
                                            : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                                    }`}
                                >
                                    <tab.icon className="w-4 h-4" />
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        {renderArchiveTable()}
                    </div>
                )}

                {activeTab === 'backup_recovery' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        {/* Backup Card */}
                        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-start gap-4">
                            <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                                <Download className="w-7 h-7" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-slate-900">Create System Backup</h3>
                                <p className="text-slate-500 mt-2 leading-relaxed">
                                    Generate a full snapshot of the database including all active and archived users, access logs, event attendance, and system settings.
                                </p>
                            </div>
                            <button
                                onClick={handleBackup}
                                disabled={isProcessing}
                                className="mt-auto px-6 py-3 bg-blue-600 text-white hover:bg-blue-700 rounded-xl font-semibold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                <Download className="w-5 h-5" />
                                {isProcessing ? 'Exporting...' : 'Export .sqlite Backup File'}
                            </button>
                        </div>

                        {/* Restore Card */}
                        <div className="bg-white p-8 rounded-2xl border border-rose-200 shadow-sm flex flex-col items-start gap-4 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-rose-500"></div>
                            <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center">
                                <RotateCcw className="w-7 h-7" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-slate-900">System Restoration</h3>
                                <p className="text-slate-500 mt-2 leading-relaxed">
                                    Upload a previously saved backup file to restore the system. <strong className="text-rose-600 font-semibold">WARNING:</strong> This will permanently overwrite all current system data.
                                </p>
                            </div>
                            <button
                                onClick={handleRestoreDatabase}
                                disabled={isProcessing}
                                className="mt-auto px-6 py-3 bg-white text-rose-600 border-2 border-rose-200 hover:bg-rose-50 hover:border-rose-300 rounded-xl font-semibold transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                <RotateCcw className="w-5 h-5" />
                                {isProcessing ? 'Processing...' : 'Select & Restore File'}
                            </button>
                        </div>

                        {/* Database Health Card */}
                        <div className="bg-slate-900 p-8 rounded-2xl text-white shadow-xl flex flex-col md:col-span-2">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-3">
                                <Database className="w-6 h-6 text-emerald-400" />
                                Database Health & Statistics
                            </h3>
                            {dbStats ? (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-slate-400 text-sm font-medium">Database Size</span>
                                        <span className="text-2xl font-bold font-mono">{formatBytes(dbStats.file_size_bytes)}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-slate-400 text-sm font-medium">Total Registered Profiles</span>
                                        <span className="text-2xl font-bold font-mono">{dbStats.total_persons}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-slate-400 text-sm font-medium">Total Entry/Exit Logs</span>
                                        <span className="text-2xl font-bold font-mono">{dbStats.total_entry_logs}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-slate-400 text-sm font-medium">Archived Records</span>
                                        <span className="text-2xl font-bold font-mono text-amber-400">{dbStats.archived_persons + dbStats.archived_events}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-slate-400">Loading statistics...</div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Confirmation Modal */}
            {isConfirmModalOpen && confirmAction && (
                <AdminModal
                    isOpen={isConfirmModalOpen}
                    onClose={() => setIsConfirmModalOpen(false)}
                    title={confirmAction.title}
                    tone={confirmAction.type === 'restore' ? 'default' : 'danger'}
                    icon={confirmAction.type === 'restore'
                        ? <RefreshCw className="w-5 h-5 text-emerald-300" />
                        : <AlertTriangle className="w-5 h-5 text-rose-300" />}
                    size="md"
                    footer={(
                        <div className="flex w-full items-center gap-3">
                            <button
                                onClick={() => setIsConfirmModalOpen(false)}
                                disabled={isProcessing}
                                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeConfirmAction}
                                disabled={confirmInput !== confirmAction.requiredText || isProcessing}
                                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                                    confirmAction.type === 'restore'
                                        ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                                        : 'bg-rose-500 text-white hover:bg-rose-400'
                                }`}
                            >
                                {isProcessing ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                                {isProcessing ? 'Processing Action...' : `Confirm ${confirmAction.requiredText}`}
                            </button>
                        </div>
                    )}
                >
                    <div className="space-y-8">
                            <div className="text-center space-y-4">
                                <p className="text-white/70 leading-relaxed text-lg">{confirmAction.message}</p>
                                <div className="py-3 px-6 bg-white/5 border border-white/10 rounded-2xl inline-block">
                                    <p className="text-xl font-bold text-white tracking-wide">
                                        {confirmAction.targetName}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <label className="block text-xs font-semibold text-white/40 text-center uppercase tracking-widest">
                                    To confirm, type <span className={`font-mono font-bold px-2 py-0.5 rounded ${confirmAction.type === 'restore' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>{confirmAction.requiredText}</span> below
                                </label>
                                <input
                                    type="text"
                                    value={confirmInput}
                                    onChange={(e) => setConfirmInput(e.target.value)}
                                    placeholder={confirmAction.requiredText}
                                    className={`w-full text-center text-base tracking-widest font-mono px-4 py-3 bg-black/40 border-2 ${confirmAction.type === 'restore' ? 'border-emerald-500/30 focus:border-emerald-500' : 'border-rose-500/30 focus:border-rose-500'} rounded-2xl text-white placeholder-white/5 focus:outline-none focus:ring-4 ${confirmAction.type === 'restore' ? 'focus:ring-emerald-500/10' : 'focus:ring-rose-500/10'} transition-all shadow-inner`}
                                    autoFocus
                                />
                            </div>

                    </div>
                </AdminModal>
            )}
        </div>
    );
};
