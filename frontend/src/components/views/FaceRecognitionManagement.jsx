import React, { useState, useEffect, useMemo } from 'react';
import { ScanFace, Search, Eye, RotateCcw, Trash2, ChevronLeft, ChevronRight, Filter, AlertTriangle, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../toast/ToastProvider';
import { AdminModal } from '../common/AdminModal';

const formatRoleLabel = (role) =>
    role ? role.charAt(0).toUpperCase() + role.slice(1) : 'N/A';

const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
};

export const FaceRecognitionManagement = ({ adminSession, branding }) => {
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterRole, setFilterRole] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'registered', 'not_registered'
    const [selectedUser, setSelectedUser] = useState(null);
    const [showViewModal, setShowViewModal] = useState(false);
    const [showResetModal, setShowResetModal] = useState(false);
    const { showSuccess, showError } = useToast();

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const data = await invoke('get_face_registration_status');
            setUsers(data);
        } catch (err) {
            console.error(err);
            showError('Failed to load face registration data.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleResetFace = async () => {
        if (!selectedUser) return;
        try {
            await invoke('reset_face_data', { personId: selectedUser.person_id });
            showSuccess(`Face data for ${selectedUser.full_name} has been reset.`);
            setShowResetModal(false);
            fetchData();
        } catch (err) {
            console.error(err);
            showError(typeof err === 'string' ? err : 'Failed to reset face data.');
        }
    };

    // Filter logic
    const filteredUsers = useMemo(() => {
        return users.filter(user => {
            const matchesSearch =
                user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                user.id_number.toLowerCase().includes(searchQuery.toLowerCase());

            const matchesRole = filterRole === 'all' || user.role === filterRole;

            const matchesFaceStatus =
                filterStatus === 'all' ||
                (filterStatus === 'registered' && user.face_registered) ||
                (filterStatus === 'not_registered' && !user.face_registered);

            return matchesSearch && matchesRole && matchesFaceStatus;
        });
    }, [users, searchQuery, filterRole, filterStatus]);

    // Pagination
    const ITEMS_PER_PAGE = 15;
    const [currentPage, setCurrentPage] = useState(1);
    useEffect(() => { setCurrentPage(1); }, [searchQuery, filterRole, filterStatus]);
    const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
    const paginatedUsers = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredUsers.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredUsers, currentPage]);
    const showPagination = filteredUsers.length > ITEMS_PER_PAGE;

    // Stats
    const totalRegistered = users.filter(u => u.face_registered).length;
    const totalNotRegistered = users.filter(u => !u.face_registered).length;

    return (
        <div className="w-full h-full min-h-0 space-y-6 animate-in slide-in-from-bottom-4 duration-500 relative flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                        <ScanFace className="w-8 h-8 text-blue-500" />
                        Face Recognition
                    </h1>
                    <p className="text-slate-500">Monitor and manage biometric face data for all university members.</p>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-slate-100 rounded-lg">
                            <ScanFace className="w-5 h-5 text-slate-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-slate-900">{users.length}</p>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Members</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white border border-emerald-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-100 rounded-lg">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-emerald-700">{totalRegistered}</p>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Face Registered</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-amber-100 rounded-lg">
                            <XCircle className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-amber-700">{totalNotRegistered}</p>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Not Registered</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex gap-2 items-center">
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-44">
                        <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                        <select
                            value={filterRole}
                            onChange={(e) => setFilterRole(e.target.value)}
                            className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                        >
                            <option value="all">Role: All</option>
                            <option value="student">Students</option>
                            <option value="professor">Professors</option>
                            <option value="staff">Staff</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-52">
                        <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                        >
                            <option value="all">Face: All Status</option>
                            <option value="registered">Registered</option>
                            <option value="not_registered">Not Registered</option>
                        </select>
                    </div>
                </div>
                <div className="relative w-full sm:w-80">
                    <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by ID or Name..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-2.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium"
                    />
                </div>
            </div>

            {/* Data Table */}
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm relative">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm text-slate-600">
                        <thead className="text-xs uppercase bg-slate-100 border-b border-slate-200 text-slate-700 sticky top-0 z-10">
                            <tr>
                                <th className="px-4 py-3 font-semibold tracking-wider">ID Number</th>
                                <th className="px-4 py-3 font-semibold tracking-wider">Full Name</th>
                                <th className="px-4 py-3 font-semibold tracking-wider">Role</th>
                                <th className="px-4 py-3 font-semibold tracking-wider">Face Status</th>
                                <th className="px-4 py-3 font-semibold tracking-wider">Last Updated</th>
                                <th className="px-4 py-3 font-semibold tracking-wider text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-20 text-slate-500">Loading data...</td>
                                </tr>
                            ) : paginatedUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-20">
                                        <div className="flex flex-col items-center justify-center space-y-3">
                                            <ScanFace className="w-12 h-12 text-slate-300" />
                                            <p className="text-slate-500 text-base">No matching records found.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedUsers.map((user) => (
                                    <tr key={user.person_id} className="hover:bg-slate-50 even:bg-slate-50/50 transition-colors group">
                                        <td className="px-4 py-2.5 font-mono font-medium text-slate-900">{user.id_number}</td>
                                        <td className="px-4 py-2.5 font-medium text-slate-900">{user.full_name}</td>
                                        <td className="px-4 py-2.5">
                                            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-700 border border-slate-200 capitalize">
                                                {formatRoleLabel(user.role)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {user.face_registered ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                                                    <CheckCircle2 className="w-3.5 h-3.5" /> Registered
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                                    <XCircle className="w-3.5 h-3.5" /> Not Registered
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-slate-500 text-xs">
                                            {formatDate(user.enrolled_at)}
                                        </td>
                                        <td className="px-4 py-2.5 text-right space-x-1">
                                            <button
                                                className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors border border-transparent hover:border-blue-200 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                title="View Details"
                                                onClick={() => { setSelectedUser(user); setShowViewModal(true); }}
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            {user.face_registered && (
                                                <button
                                                    className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                    title="Reset Face Data"
                                                    onClick={() => { setSelectedUser(user); setShowResetModal(true); }}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {showPagination && (
                    <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 flex flex-wrap items-center justify-between gap-3 shrink-0 rounded-b-xl">
                        <div>
                            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredUsers.length)} of {filteredUsers.length}
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-2 py-1 rounded border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
                            >
                                <ChevronLeft className="w-4 h-4" /> Previous
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                                <button
                                    key={p}
                                    onClick={() => setCurrentPage(p)}
                                    className={`min-w-[28px] px-2 py-1 rounded border transition-colors ${currentPage === p
                                        ? 'border-blue-500 bg-blue-600 text-white'
                                        : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                                >
                                    {p}
                                </button>
                            ))}
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-2 py-1 rounded border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
                            >
                                Next <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* View Details Modal */}
            <AdminModal
                isOpen={showViewModal}
                onClose={() => setShowViewModal(false)}
                title="Profile Details"
                icon={<Eye className="w-5 h-5 text-white" />}
                tone="default"
                size="md"
            >
                {selectedUser && (
                    <div className="space-y-6">
                        <div className="flex items-center gap-4 border-b border-white/10 pb-6">
                            <div className="w-16 h-16 bg-blue-500/20 rounded-full border border-blue-400/30 flex items-center justify-center text-blue-300 text-2xl font-bold">
                                {selectedUser.first_name?.charAt(0)}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">
                                    {selectedUser.first_name} {selectedUser.middle_name} {selectedUser.last_name}
                                </h3>
                                <p className="text-sm font-mono text-white/50">{selectedUser.id_number}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Role</p>
                                <p className="font-semibold text-white capitalize">{selectedUser.role}</p>
                            </div>
                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Face Status</p>
                                {selectedUser.face_registered ? (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                                        <CheckCircle2 className="w-3 h-3" /> Registered
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-400/30">
                                        <XCircle className="w-3 h-3" /> Not Registered
                                    </span>
                                )}
                            </div>

                            {selectedUser.role === 'student' && (
                                <>
                                    <div>
                                        <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Program</p>
                                        <p className="font-semibold text-white">{selectedUser.program_name || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Year Level</p>
                                        <p className="font-semibold text-white">{selectedUser.year_level || 'N/A'}</p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Classification</p>
                                        <p className={`font-bold ${selectedUser.is_irregular ? 'text-amber-400' : 'text-white'}`}>
                                            {selectedUser.is_irregular ? 'Irregular' : 'Regular'}
                                        </p>
                                    </div>
                                </>
                            )}

                            {(selectedUser.role === 'professor' || selectedUser.role === 'staff') && (
                                <>
                                    <div className="col-span-2">
                                        <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Department</p>
                                        <p className="font-semibold text-white">{selectedUser.department_name || 'N/A'}</p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Position/Title</p>
                                        <p className="font-semibold text-white">{selectedUser.position_title || 'N/A'}</p>
                                    </div>
                                </>
                            )}

                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Email</p>
                                <p className="font-semibold text-white truncate max-w-[150px]">{selectedUser.email || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Status</p>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${selectedUser.is_active ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-rose-500/20 text-rose-300 border border-rose-400/30'}`}>
                                    {selectedUser.is_active ? 'Active' : 'Inactive'}
                                </span>
                            </div>

                            {selectedUser.enrolled_at && (
                                <div className="col-span-2 pt-3 border-t border-white/10">
                                    <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Last Enrollment</p>
                                    <p className="text-white font-medium">{formatDate(selectedUser.enrolled_at)}</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </AdminModal>

            {/* Reset Confirmation Modal */}
            <AdminModal
                isOpen={showResetModal}
                onClose={() => setShowResetModal(false)}
                title="Reset Face Data"
                subtitle={`This will permanently remove the biometric face data for ${selectedUser?.full_name}.`}
                icon={<ShieldAlert className="w-5 h-5 text-rose-300" />}
                tone="danger"
                closeOnBackdrop={false}
                footer={
                    <div className="flex gap-3">
                        <button
                            onClick={() => setShowResetModal(false)}
                            className="flex-1 px-4 py-2.5 rounded-xl border border-white/15 bg-white/5 font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all focus:outline-none"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleResetFace}
                            className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 font-semibold text-white hover:bg-rose-500 transition-all focus:outline-none focus:ring-4 focus:ring-rose-500/30 shadow-lg shadow-rose-600/25 flex items-center justify-center gap-2"
                        >
                            <Trash2 className="w-4 h-4" /> Reset Face Data
                        </button>
                    </div>
                }
            >
                <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold mb-1">This action cannot be undone.</p>
                            <p className="text-rose-100/80">The user will need to re-register their face through their account panel to use face recognition again.</p>
                        </div>
                    </div>
                </div>
            </AdminModal>
        </div>
    );
};
