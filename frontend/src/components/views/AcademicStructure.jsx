import React, { useState, useEffect } from 'react';
import { Building, Plus, Search, Edit2, Trash2, X, Check, AlertTriangle, BookOpen, Filter } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../toast/ToastProvider';

export const AcademicStructure = ({ branding, adminSession }) => {
    const [activeTab, setActiveTab] = useState('department'); // 'department', 'program'
    const [searchQuery, setSearchQuery] = useState('');
    const [departmentFilter, setDepartmentFilter] = useState(''); // '' = All Departments
    const [dataList, setDataList] = useState([]);
    const [departments, setDepartments] = useState([]); // Needed for Program form dropdown
    const [isLoading, setIsLoading] = useState(true);

    // Modal States
    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [status, setStatus] = useState(null);
    const { showSuccess, showError } = useToast();

    // Form State
    const [formData, setFormData] = useState({
        department_name: '',
        department_code: '',
        program_name: '',
        program_code: '',
        department_id: '' // For Program
    });

    const fetchData = async () => {
        setIsLoading(true);
        try {
            // Always fetch departments to populate dropdown if needed
            const deps = await invoke('get_departments');
            setDepartments(deps);

            if (activeTab === 'department') {
                setDataList(deps);
            } else {
                const progs = await invoke('get_programs');
                setDataList(progs);
            }
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: 'Failed to fetch data.' });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [activeTab]);

    useEffect(() => {
        if (!status) {
            return;
        }

        if (status.type === 'success') {
            showSuccess(status.message);
        } else {
            showError(status.message);
        }
        setStatus(null);
    }, [status, showSuccess, showError]);

    const handleRegisterSubmit = async (e) => {
        e.preventDefault();
        try {
            if (activeTab === 'department') {
                await invoke('add_department', {
                    department: {
                        department_id: 0,
                        department_name: formData.department_name,
                        department_code: formData.department_code
                    },
                    activeAdminId: adminSession?.account_id
                });
                setStatus({ type: 'success', message: 'Department added successfully!' });
            } else {
                await invoke('add_program', {
                    program: {
                        program_id: 0,
                        department_id: parseInt(formData.department_id),
                        program_name: formData.program_name,
                        program_code: formData.program_code
                    },
                    activeAdminId: adminSession?.account_id
                });
                setStatus({ type: 'success', message: 'Program added successfully!' });
            }
            setShowRegisterModal(false);
            setFormData({ department_name: '', department_code: '', program_name: '', program_code: '', department_id: '' });
            fetchData();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: typeof error === 'string' ? error : `Failed to add ${activeTab}.` });
        }
    };

    const handleEditClick = (item) => {
        setSelectedItem(item);
        if (activeTab === 'department') {
            setFormData({
                department_name: item.department_name,
                department_code: item.department_code,
                program_name: '', program_code: '', department_id: ''
            });
        } else {
            setFormData({
                program_name: item.program_name,
                program_code: item.program_code,
                department_id: item.department_id,
                department_name: '', department_code: ''
            });
        }
        setShowEditModal(true);
    };

    const handleEditSubmit = async (e) => {
        e.preventDefault();
        try {
            if (activeTab === 'department') {
                await invoke('update_department', {
                    departmentId: selectedItem.department_id,
                    departmentName: formData.department_name,
                    departmentCode: formData.department_code,
                    activeAdminId: adminSession?.account_id
                });
                setStatus({ type: 'success', message: 'Department updated successfully!' });
            } else {
                await invoke('update_program', {
                    programId: selectedItem.program_id,
                    departmentId: parseInt(formData.department_id),
                    programName: formData.program_name,
                    programCode: formData.program_code,
                    activeAdminId: adminSession?.account_id
                });
                setStatus({ type: 'success', message: 'Program updated successfully!' });
            }
            setShowEditModal(false);
            fetchData();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: typeof error === 'string' ? error : `Failed to update ${activeTab}.` });
        }
    };

    const handleDeleteClick = (item) => {
        setSelectedItem(item);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        try {
            if (activeTab === 'department') {
                await invoke('delete_department', { departmentId: selectedItem.department_id, activeAdminId: adminSession?.account_id });
            } else {
                await invoke('delete_program', { programId: selectedItem.program_id, activeAdminId: adminSession?.account_id });
            }
            setStatus({ type: 'success', message: `${activeTab} archived successfully!` });
            setShowDeleteModal(false);
            fetchData();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: typeof error === 'string' ? error : `Failed to archive ${activeTab}.` });
        }
    };

    const handleRegisterClick = () => {
        setFormData({ department_name: '', department_code: '', program_name: '', program_code: '', department_id: departments.length > 0 ? departments[0].department_id : '' });
        setStatus(null);
        setShowRegisterModal(true);
    };

    // Reset department filter when switching away from Programs
    useEffect(() => { if (activeTab === 'department') setDepartmentFilter(''); }, [activeTab]);

    // Filter logic - Programs tab: filter by department first, then search
    const filteredData = dataList.filter(item => {
        if (activeTab === 'program' && departmentFilter) {
            if (item.department_id !== parseInt(departmentFilter)) return false;
        }
        const searchStr = activeTab === 'department'
            ? `${item.department_name} ${item.department_code}`.toLowerCase()
            : `${item.program_name} ${item.program_code}`.toLowerCase();
        return searchStr.includes(searchQuery.toLowerCase());
    });

    return (
        <div className="w-full h-full min-h-0 space-y-6 animate-in slide-in-from-bottom-4 duration-500 relative flex flex-col">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Academic Structure</h1>
                    <p className="text-slate-500">Manage Departments and Programs.</p>
                </div>
                <button
                    onClick={handleRegisterClick}
                    className="flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700 px-5 py-2.5 rounded-xl font-bold shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                >
                    <Plus className="w-5 h-5" /> Add {activeTab === 'department' ? 'Department' : 'Program'}
                </button>
            </div>

            {/* Controls: Tabs, Filter by Department (Programs only), Search */}
            <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl shrink-0">
                    {['department', 'program'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-6 py-2.5 rounded-lg font-medium capitalize transition-all duration-300 ${activeTab === tab
                                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                                }`}
                        >
                            {tab}s
                        </button>
                    ))}
                </div>

                <div className="flex flex-col sm:flex-row gap-2 items-center w-full sm:w-auto justify-end">
                    {activeTab === 'program' && (
                        <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-64">
                            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                            <select
                                value={departmentFilter}
                                onChange={(e) => setDepartmentFilter(e.target.value)}
                                className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                            >
                                <option value="">Department: All</option>
                                {departments.map((d, idx) => (
                                    <option key={`${d.department_id || 'dept'}-${idx}`} value={d.department_id}>
                                        {d.department_code}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="relative w-full sm:w-80">
                        <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder={`Search ${activeTab}s...`}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-2.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium"
                        />
                    </div>
                </div>
            </div>

            {/* Data Table - scroll only, no pagination (Academic Structure) */}
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm relative">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left text-sm text-slate-600">
                        <thead className="text-xs uppercase bg-slate-100 border-b border-slate-200 text-slate-700 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-4 font-semibold tracking-wider">Code</th>
                                <th className="px-6 py-4 font-semibold tracking-wider">Name</th>
                                {activeTab === 'program' && <th className="px-6 py-4 font-semibold tracking-wider">Department Link</th>}
                                <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={activeTab === 'program' ? 4 : 3} className="text-center py-20 text-slate-500">Loading data...</td>
                                </tr>
                            ) : filteredData.length === 0 ? (
                                <tr>
                                    <td colSpan={activeTab === 'program' ? 4 : 3} className="text-center py-20">
                                        <div className="flex flex-col items-center justify-center space-y-3">
                                            {activeTab === 'department' ? <Building className="w-12 h-12 text-slate-300" /> : <BookOpen className="w-12 h-12 text-slate-300" />}
                                            <p className="text-slate-500 text-base">No {activeTab}s found.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredData.map((item, index) => {
                                    const itemId = activeTab === 'department' ? item.department_id : item.program_id;
                                    const code = activeTab === 'department' ? item.department_code : item.program_code;
                                    const name = activeTab === 'department' ? item.department_name : item.program_name;
                                    let deptName = '';
                                    if (activeTab === 'program') {
                                        const dept = departments.find(d => d.department_id === item.department_id);
                                        deptName = dept ? dept.department_code : 'Unknown';
                                    }

                                    return (
                                        <tr key={`${activeTab}-${itemId || 'missing'}-${index}`} className="hover:bg-slate-50 even:bg-slate-50/50 transition-colors group">
                                            <td className="px-6 py-4 font-mono font-medium text-slate-900">{code}</td>
                                            <td className="px-6 py-4 font-medium text-slate-900">{name}</td>
                                            {activeTab === 'program' && <td className="px-6 py-4 text-slate-600">{deptName}</td>}
                                            <td className="px-6 py-4 text-right space-x-2">
                                                <button className="p-2 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors border border-transparent hover:border-amber-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Edit"
                                                    onClick={() => handleEditClick(item)}>
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Archive"
                                                    onClick={() => handleDeleteClick(item)}>
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Registration/Edit Form Component */}
            {(showRegisterModal || showEditModal) && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
                    <div className="bg-black/90 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-xl overflow-y-auto max-h-[90vh] animate-in zoom-in-95 duration-200">
                        <div className="px-8 py-6 border-b border-white/10 flex justify-between items-center sticky top-0 bg-black/50 backdrop-blur-md z-10">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 bg-white/10 rounded-lg border border-white/20 `}>
                                    {showEditModal ? <Edit2 className="w-5 h-5 text-amber-400" /> : <Plus className="w-5 h-5 text-emerald-400" />}
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-wide">{showEditModal ? 'Edit' : 'Add'} {activeTab === 'department' ? 'Department' : 'Program'}</h2>
                            </div>
                            <button onClick={() => { setShowRegisterModal(false); setShowEditModal(false); }} className="text-white/50 hover:text-white transition-colors bg-white/5 p-2 rounded-xl hover:bg-white/10"><X className="w-5 h-5" /></button>
                        </div>

                        <form onSubmit={showEditModal ? handleEditSubmit : handleRegisterSubmit} className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-white/60 mb-1 font-medium">{activeTab === 'department' ? 'Department' : 'Program'} Code <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                    <input required type="text"
                                        value={activeTab === 'department' ? formData.department_code : formData.program_code}
                                        onChange={e => activeTab === 'department' ? setFormData({ ...formData, department_code: e.target.value }) : setFormData({ ...formData, program_code: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:ring-2 focus:ring-white/20 focus:outline-none" placeholder={activeTab === 'department' ? "e.g. CCS" : "e.g. BSCS"} />
                                </div>
                                <div>
                                    <label className="block text-xs text-white/60 mb-1 font-medium">{activeTab === 'department' ? 'Department' : 'Program'} Name <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                    <input required type="text"
                                        value={activeTab === 'department' ? formData.department_name : formData.program_name}
                                        onChange={e => activeTab === 'department' ? setFormData({ ...formData, department_name: e.target.value }) : setFormData({ ...formData, program_name: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" placeholder={activeTab === 'department' ? "e.g. College of Computer Studies" : "e.g. Bachelor of Science in Computer Science"} />
                                </div>

                                {activeTab === 'program' && (
                                    <div>
                                        <label className="block text-xs text-white/60 mb-1 font-medium">Link to Department <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                        <select
                                            required
                                            value={formData.department_id}
                                            onChange={e => setFormData({ ...formData, department_id: e.target.value })}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none appearance-none"
                                        >
                                            <option value="" disabled>Select a Department</option>
                                            {departments.map((d, idx) => (
                                                <option key={`${d.department_id || 'dept'}-${idx}`} value={d.department_id} className="bg-slate-900">{d.department_code} - {d.department_name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="pt-6">
                                <button type="submit" className={`w-full ${showEditModal ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)]' : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.2)]'} font-bold text-lg py-4 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-white/40 flex justify-center items-center gap-2 hover:scale-[1.01]`}>
                                    <Check className="w-6 h-6" /> {showEditModal ? 'Save Changes' : 'Confirm & Add'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && selectedItem && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
                    <div className="bg-rose-950/40 backdrop-blur-2xl border border-rose-500/30 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-8 flex flex-col items-center text-center space-y-6">
                            <div className="w-20 h-20 bg-rose-500/20 rounded-full flex items-center justify-center border-4 border-rose-500/30">
                                <AlertTriangle className="w-10 h-10 text-rose-400" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-2xl font-bold text-white capitalize">Archive {activeTab}?</h2>
                                <p className="text-white/70">Are you sure you want to archive <span className="text-white font-semibold">{activeTab === 'department' ? selectedItem.department_code : selectedItem.program_code}</span>? This record will be moved to the Archive Center.</p>
                            </div>
                            <div className="flex gap-4 w-full pt-4">
                                <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-3 px-4 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl transition-colors border border-white/10 focus:outline-none">Cancel</button>
                                <button onClick={confirmDelete} className="flex-1 py-3 px-4 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(244,63,94,0.3)] hover:shadow-[0_0_30px_rgba(244,63,94,0.5)] border border-rose-400 focus:outline-none">Archive</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
