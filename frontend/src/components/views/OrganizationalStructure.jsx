import React, { useState, useEffect, useMemo } from 'react';
import { Building, Plus, Search, Edit2, Trash2, Check, AlertTriangle, BookOpen, Filter, ChevronLeft, ChevronRight, UserCircle2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../toast/ToastProvider';
import { AdminModal } from '../common/AdminModal';
import { SortableHeader, useTableSort } from '../common/SortableHeader';

export const OrganizationalStructure = ({ branding, adminSession }) => {
    const [mainTab, setMainTab] = useState('units'); // 'units', 'roles'
    const [activeSubTab, setActiveSubTab] = useState('department'); // units: department/program, roles: main_role/sub_role
    const [searchQuery, setSearchQuery] = useState('');
    const [departmentFilter, setDepartmentFilter] = useState(''); // '' = All Departments
    const [mainRoleFilter, setMainRoleFilter] = useState(''); // '' = All Main Roles
    const [dataList, setDataList] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [allRoles, setAllRoles] = useState([]); // All roles for filtering/parent selection
    const [isLoading, setIsLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 15;

    // Modal States
    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const { showSuccess, showError } = useToast();

    // Form State
    const [formData, setFormData] = useState({
        department_name: '',
        department_code: '',
        program_name: '',
        program_code: '',
        department_id: '', // For Program
        role_name: '',
        role_description: '',
        role_behavior: 'student',
        is_main_role: true,
        parent_role_id: ''
    });

    const fetchData = async () => {
        setIsLoading(true);
        try {
            // Always fetch departments to populate dropdown if needed
            const deps = await invoke('get_departments');
            setDepartments(deps);

            // Fetch all roles for parent selection and filtering
            const roles = await invoke('get_roles');
            setAllRoles(roles);

            if (mainTab === 'units') {
                if (activeSubTab === 'department') {
                    setDataList(deps);
                } else {
                    const progs = await invoke('get_programs');
                    setDataList(progs);
                }
            } else {
                if (activeSubTab === 'main_role') {
                    setDataList(roles.filter(r => r.is_main_role));
                } else {
                    setDataList(roles.filter(r => !r.is_main_role));
                }
            }
        } catch (error) {
            console.error(error);
            showError('Failed to fetch data.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        setCurrentPage(1);
        setSearchQuery('');
        setDepartmentFilter('');
    }, [mainTab, activeSubTab]);

    const handleRegisterSubmit = async (e) => {
        e.preventDefault();
        try {
            if (mainTab === 'units') {
                if (activeSubTab === 'department') {
                    await invoke('add_department', {
                        department: {
                            department_id: 0,
                            department_name: formData.department_name,
                            department_code: formData.department_code
                        },
                        activeAdminId: adminSession?.account_id
                    });
                    showSuccess('Department added successfully!');
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
                    showSuccess('Program added successfully!');
                }
            } else {
                await invoke('add_role', {
                    roleName: formData.role_name,
                    description: formData.role_description || null,
                    isMainRole: activeSubTab === 'main_role',
                    parentRoleId: activeSubTab === 'sub_role' ? parseInt(formData.parent_role_id) : null,
                    roleBehavior: activeSubTab === 'main_role' ? formData.role_behavior : null,
                    activeAdminId: adminSession?.account_id
                });
                showSuccess('Role added successfully!');
            }
            setShowRegisterModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            console.error(error);
            showError(typeof error === 'string' ? error : `Failed to add ${mainTab === 'units' ? activeSubTab : 'role'}.`);
        }
    };

    const handleEditClick = (item) => {
        setSelectedItem(item);
        if (mainTab === 'units') {
            if (activeSubTab === 'department') {
                setFormData({
                    ...formData,
                    department_name: item.department_name,
                    department_code: item.department_code
                });
            } else {
                setFormData({
                    ...formData,
                    program_name: item.program_name,
                    program_code: item.program_code,
                    department_id: item.department_id
                });
            }
        } else {
            setFormData({
                ...formData,
                role_name: item.role_name,
                role_description: item.description || '',
                role_behavior: item.role_behavior || 'student',
                is_main_role: item.is_main_role,
                parent_role_id: item.parent_role_id || ''
            });
        }
        setShowEditModal(true);
    };

    const handleEditSubmit = async (e) => {
        e.preventDefault();
        try {
            if (mainTab === 'units') {
                if (activeSubTab === 'department') {
                    await invoke('update_department', {
                        departmentId: selectedItem.department_id,
                        departmentName: formData.department_name,
                        departmentCode: formData.department_code,
                        activeAdminId: adminSession?.account_id
                    });
                    showSuccess('Department updated successfully!');
                } else {
                    await invoke('update_program', {
                        programId: selectedItem.program_id,
                        departmentId: parseInt(formData.department_id),
                        programName: formData.program_name,
                        programCode: formData.program_code,
                        activeAdminId: adminSession?.account_id
                    });
                    showSuccess('Program updated successfully!');
                }
            } else {
                await invoke('update_role', {
                    roleId: selectedItem.role_id,
                    roleName: formData.role_name,
                    description: formData.role_description || null,
                    isMainRole: formData.is_main_role,
                    parentRoleId: formData.parent_role_id ? parseInt(formData.parent_role_id) : null,
                    roleBehavior: formData.is_main_role ? formData.role_behavior : null,
                    activeAdminId: adminSession?.account_id
                });
                showSuccess('Role updated successfully!');
            }
            setShowEditModal(false);
            fetchData();
        } catch (error) {
            console.error(error);
            showError(typeof error === 'string' ? error : `Failed to update ${mainTab === 'units' ? activeSubTab : 'role'}.`);
        }
    };

    const handleDeleteClick = (item) => {
        setSelectedItem(item);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        try {
            if (mainTab === 'units') {
                if (activeSubTab === 'department') {
                    await invoke('delete_department', { departmentId: selectedItem.department_id, activeAdminId: adminSession?.account_id });
                } else {
                    await invoke('delete_program', { programId: selectedItem.program_id, activeAdminId: adminSession?.account_id });
                }
                showSuccess(`${activeSubTab} archived successfully!`);
            } else {
                await invoke('delete_role', { roleId: selectedItem.role_id, activeAdminId: adminSession?.account_id });
                showSuccess(`Role deleted successfully!`);
            }
            setShowDeleteModal(false);
            fetchData();
        } catch (error) {
            console.error(error);
            showError(typeof error === 'string' ? error : `Failed to delete/archive.`);
        }
    };

    const resetForm = () => {
        setFormData({
            department_name: '',
            department_code: '',
            program_name: '',
            program_code: '',
            department_id: departments.length > 0 ? departments[0].department_id : '',
            role_name: '',
            role_description: '',
            role_behavior: 'student',
            is_main_role: activeSubTab === 'main_role',
            parent_role_id: allRoles.filter(r => r.is_main_role).length > 0 ? allRoles.filter(r => r.is_main_role)[0].role_id : ''
        });
        setSelectedItem(null);
    };

    const handleRegisterClick = () => {
        resetForm();
        setShowRegisterModal(true);
    };

    const clearFilters = () => {
        setSearchQuery('');
        setDepartmentFilter('');
        setMainRoleFilter('');
        setCurrentPage(1);
    };

    // Filter logic
    const filteredData = dataList.filter(item => {
        if (mainTab === 'units' && activeSubTab === 'program' && departmentFilter) {
            if (item.department_id !== parseInt(departmentFilter)) return false;
        }
        
        if (mainTab === 'roles' && activeSubTab === 'sub_role' && mainRoleFilter) {
            if (item.parent_role_id !== parseInt(mainRoleFilter)) return false;
        }
        
        let searchStr = '';
        if (mainTab === 'units') {
            searchStr = activeSubTab === 'department'
                ? `${item.department_name} ${item.department_code}`.toLowerCase()
                : `${item.program_name} ${item.program_code}`.toLowerCase();
        } else {
            searchStr = `${item.role_name} ${item.description || ''}`.toLowerCase();
        }
        
        return searchStr.includes(searchQuery.toLowerCase());
    });

    // Sorting
    const sortKey = mainTab === 'units' 
        ? (activeSubTab === 'department' ? 'department_code' : 'program_code')
        : 'role_name';
    const { sortConfig, requestSort, sortedData } = useTableSort(filteredData, sortKey, 'asc', `org_structure_${mainTab}_${activeSubTab}`);

    const totalPages = Math.ceil(sortedData.length / ITEMS_PER_PAGE);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return sortedData.slice(start, start + ITEMS_PER_PAGE);
    }, [sortedData, currentPage]);

    return (
        <div className="w-full h-full min-h-0 space-y-6 animate-in slide-in-from-bottom-4 duration-500 relative flex flex-col">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                        <Building className="w-8 h-8 text-emerald-500" />
                        Organizational Structure
                    </h1>
                    <p className="text-slate-500">Manage Units, Roles, and Institutional Hierarchy.</p>
                </div>
                <button
                    onClick={handleRegisterClick}
                    className="flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700 px-5 py-2.5 rounded-xl font-bold shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                >
                    <Plus className="w-5 h-5" /> Add {mainTab === 'units' ? (activeSubTab === 'department' ? 'Department' : 'Program') : 'Role'}
                </button>
            </div>

            {/* Controls & Navigation Group */}
            <div className="space-y-0 flex-1 flex flex-col min-h-0">
                {/* Controls: Main Tabs & Search */}
                <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4 relative z-20">
                    <div className="flex gap-2 p-1 bg-slate-100 rounded-xl shrink-0">
                        {[
                            { id: 'units', label: 'Organizational Units' },
                            { id: 'roles', label: 'Person Roles' }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    setMainTab(tab.id);
                                    setActiveSubTab(tab.id === 'units' ? 'department' : 'main_role');
                                }}
                                className={`px-6 py-2.5 rounded-lg font-medium transition-all duration-300 ${mainTab === tab.id
                                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 items-center w-full sm:w-auto justify-end">
                        {mainTab === 'units' && activeSubTab === 'program' && (
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
                        {mainTab === 'roles' && activeSubTab === 'sub_role' && (
                            <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-64">
                                <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                                <select
                                    value={mainRoleFilter}
                                    onChange={(e) => setMainRoleFilter(e.target.value)}
                                    className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full capitalize"
                                >
                                    <option value="">Main Role: All</option>
                                    {allRoles.filter(r => r.is_main_role).map((r, idx) => (
                                        <option key={`${r.role_id || 'role'}-${idx}`} value={r.role_id}>
                                            {r.role_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="relative w-full sm:w-80">
                            <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder={`Search ${mainTab === 'units' ? activeSubTab + 's' : 'roles'}...`}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-2.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium"
                            />
                        </div>
                        <button
                            onClick={clearFilters}
                            className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors shrink-0"
                        >
                            Clear All
                        </button>
                    </div>
                </div>

                {/* Sub Navigation */}
                <div className="flex border-b border-slate-200 px-2 mb-2">
                    {(mainTab === 'units' ? [
                        { id: 'department', label: 'Departments', icon: Building },
                        { id: 'program', label: 'Programs', icon: BookOpen },
                    ] : [
                        { id: 'main_role', label: 'Main Roles', icon: UserCircle2 },
                        { id: 'sub_role', label: 'Sub Roles', icon: Filter },
                    ]).map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveSubTab(tab.id)}
                            className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-all duration-300 border-b-2 ${activeSubTab === tab.id
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                                }`}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Data Table */}
                <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm relative">
                    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                        <table className="w-full text-left text-sm text-slate-600 table-fixed">
                            <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
                                {mainTab === 'units' ? (
                                    <tr>
                                        <SortableHeader label="Code" sortKey={activeSubTab === 'department' ? 'department_code' : 'program_code'} sortConfig={sortConfig} onSort={requestSort} width="150px" />
                                        <SortableHeader label="Name" sortKey={activeSubTab === 'department' ? 'department_name' : 'program_name'} sortConfig={sortConfig} onSort={requestSort} width="300px" />
                                        {activeSubTab === 'program' && <SortableHeader label="Department Link" sortKey="department_id" sortConfig={sortConfig} onSort={requestSort} width="200px" />}
                                        <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-700 text-right" style={{ width: '150px' }}>Actions</th>
                                    </tr>
                                ) : (
                                    <tr>
                                        <SortableHeader label="Role Name" sortKey="role_name" sortConfig={sortConfig} onSort={requestSort} width="200px" />
                                        <SortableHeader label="Description" sortKey="description" sortConfig={sortConfig} onSort={requestSort} width={activeSubTab === 'sub_role' ? "250px" : "350px"} />
                                        {activeSubTab === 'main_role' && <SortableHeader label="Behavior" sortKey="role_behavior" sortConfig={sortConfig} onSort={requestSort} width="150px" />}
                                        {activeSubTab === 'sub_role' && <SortableHeader label="Parent Role" sortKey="parent_role_id" sortConfig={sortConfig} onSort={requestSort} width="200px" />}
                                        <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-700 text-right" style={{ width: '150px' }}>Actions</th>
                                    </tr>
                                )}
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={mainTab === 'units' ? (activeSubTab === 'program' ? 4 : 3) : (activeSubTab === 'sub_role' ? 4 : 3)} className="text-center py-20 text-slate-500">Loading data...</td>
                                    </tr>
                                ) : paginatedData.length === 0 ? (
                                    <tr>
                                        <td colSpan={mainTab === 'units' ? (activeSubTab === 'program' ? 4 : 3) : (activeSubTab === 'sub_role' ? 4 : 3)} className="text-center py-20">
                                            <div className="flex flex-col items-center justify-center space-y-3">
                                                {mainTab === 'units' ? (activeSubTab === 'department' ? <Building className="w-12 h-12 text-slate-300" /> : <BookOpen className="w-12 h-12 text-slate-300" />) : <UserCircle2 className="w-12 h-12 text-slate-300" />}
                                                <p className="text-slate-500 text-base">No {mainTab === 'units' ? activeSubTab : 'role'}s found.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedData.map((item, index) => {
                                        if (mainTab === 'units') {
                                            const itemId = activeSubTab === 'department' ? item.department_id : item.program_id;
                                            const code = activeSubTab === 'department' ? item.department_code : item.program_code;
                                            const name = activeSubTab === 'department' ? item.department_name : item.program_name;
                                            let deptName = '';
                                            if (activeSubTab === 'program') {
                                                const dept = departments.find(d => d.department_id === item.department_id);
                                                deptName = dept ? dept.department_code : 'Unknown';
                                            }

                                            return (
                                                <tr key={`${activeSubTab}-${itemId || 'missing'}-${index}`} className="hover:bg-slate-50 even:bg-slate-50/50 transition-colors group">
                                                    <td className="px-6 py-4 font-mono font-medium text-slate-900">{code}</td>
                                                    <td className="px-6 py-4 font-medium text-slate-900">{name}</td>
                                                    {activeSubTab === 'program' && <td className="px-6 py-4 text-slate-600">{deptName}</td>}
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
                                        } else {
                                            let parentRoleName = '';
                                            if (activeSubTab === 'sub_role') {
                                                const parent = allRoles.find(r => r.role_id === item.parent_role_id);
                                                parentRoleName = parent ? parent.role_name : 'Unknown';
                                            }

                                            return (
                                                <tr key={`role-${item.role_id}-${index}`} className="hover:bg-slate-50 even:bg-slate-50/50 transition-colors group">
                                                    <td className="px-6 py-4 font-bold text-slate-900 capitalize">{item.role_name}</td>
                                                    <td className="px-6 py-4 text-slate-500 italic">{item.description || 'No description provided.'}</td>
                                                    {activeSubTab === 'main_role' && (
                                                        <td className="px-6 py-4">
                                                            {item.role_behavior ? (
                                                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wide rounded-full border ${
                                                                    item.role_behavior === 'student' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                                    item.role_behavior === 'employee' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                                    'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                }`}>
                                                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                                                        item.role_behavior === 'student' ? 'bg-blue-500' :
                                                                        item.role_behavior === 'employee' ? 'bg-amber-500' :
                                                                        'bg-emerald-500'
                                                                    }`} />
                                                                    {item.role_behavior}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400 text-xs italic">Not set</span>
                                                            )}
                                                        </td>
                                                    )}
                                                    {activeSubTab === 'sub_role' && <td className="px-6 py-4 text-slate-600 capitalize font-medium">{parentRoleName}</td>}
                                                    <td className="px-6 py-4 text-right space-x-2">
                                                        <button className="p-2 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors border border-transparent hover:border-amber-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Edit"
                                                            onClick={() => handleEditClick(item)}>
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        <button className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Delete"
                                                            onClick={() => handleDeleteClick(item)}>
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        }
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {totalPages > 1 && (
                        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 flex items-center justify-between shrink-0 rounded-b-xl">
                            <div>
                                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, sortedData.length)} of {sortedData.length}
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="p-1 rounded-md hover:bg-slate-200 disabled:opacity-30 transition-colors"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <div className="flex items-center gap-1 px-2">
                                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                                        <button
                                            key={page}
                                            onClick={() => setCurrentPage(page)}
                                            className={`w-6 h-6 rounded-md transition-all ${currentPage === page ? 'bg-slate-800 text-white' : 'hover:bg-slate-200'}`}
                                        >
                                            {page}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="p-1 rounded-md hover:bg-slate-200 disabled:opacity-30 transition-colors"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Registration/Edit Form Modal */}
            {(showRegisterModal || showEditModal) && (
                <AdminModal
                    isOpen={showRegisterModal || showEditModal}
                    onClose={() => { setShowRegisterModal(false); setShowEditModal(false); }}
                    title={`${showEditModal ? 'Edit' : 'Add'} ${mainTab === 'units' ? (activeSubTab === 'department' ? 'Department' : 'Program') : 'Role'}`}
                    icon={showEditModal ? <Edit2 className="w-5 h-5 text-amber-300" /> : <Plus className="w-5 h-5 text-emerald-300" />}
                    size="lg"
                >
                    <form onSubmit={showEditModal ? handleEditSubmit : handleRegisterSubmit} className="space-y-6">
                            <div className="space-y-4">
                                {mainTab === 'units' ? (
                                    <>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">{activeSubTab === 'department' ? 'Department' : 'Program'} Code <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <input required type="text"
                                                value={activeSubTab === 'department' ? formData.department_code : formData.program_code}
                                                onChange={e => activeSubTab === 'department' ? setFormData({ ...formData, department_code: e.target.value }) : setFormData({ ...formData, program_code: e.target.value })}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:ring-2 focus:ring-white/20 focus:outline-none" placeholder={activeSubTab === 'department' ? "e.g. CCS" : "e.g. BSCS"} />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">{activeSubTab === 'department' ? 'Department' : 'Program'} Name <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <input required type="text"
                                                value={activeSubTab === 'department' ? formData.department_name : formData.program_name}
                                                onChange={e => activeSubTab === 'department' ? setFormData({ ...formData, department_name: e.target.value }) : setFormData({ ...formData, program_name: e.target.value })}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" placeholder={activeSubTab === 'department' ? "e.g. College of Computer Studies" : "e.g. Bachelor of Science in Computer Science"} />
                                        </div>

                                        {activeSubTab === 'program' && (
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
                                    </>
                                ) : (
                                    <>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Role Name <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <input required type="text"
                                                value={formData.role_name}
                                                onChange={e => setFormData({ ...formData, role_name: e.target.value })}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:ring-2 focus:ring-white/20 focus:outline-none" placeholder="e.g. Security Officer" />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Description</label>
                                            <textarea rows={3}
                                                value={formData.role_description}
                                                onChange={e => setFormData({ ...formData, role_description: e.target.value })}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:ring-2 focus:ring-white/20 focus:outline-none resize-none" placeholder="Briefly describe the purpose or permissions of this role." />
                                        </div>

                                        {(activeSubTab === 'main_role' || (showEditModal && formData.is_main_role)) && (
                                            <div>
                                                <label className="block text-xs text-white/60 mb-2 font-semibold uppercase tracking-wider">Role Behavior <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                                <p className="text-[11px] text-white/40 mb-3 leading-relaxed">This determines which registration fields, ID format, and modal behavior are used when registering or editing profiles with this role.</p>
                                                <div className="grid grid-cols-3 gap-2.5">
                                                    {[
                                                        { value: 'student', label: 'Student', color: 'blue', desc: 'Program, Year Level' },
                                                        { value: 'employee', label: 'Employee', color: 'amber', desc: 'Department, Position' },
                                                        { value: 'visitor', label: 'Visitor', color: 'emerald', desc: 'Purpose, Person to Visit' }
                                                    ].map(opt => {
                                                        const isSelected = formData.role_behavior === opt.value;
                                                        const colorMap = {
                                                            blue: { bg: 'bg-blue-500/15', border: 'border-blue-500/40', text: 'text-blue-300', dot: 'bg-blue-400' },
                                                            amber: { bg: 'bg-amber-500/15', border: 'border-amber-500/40', text: 'text-amber-300', dot: 'bg-amber-400' },
                                                            emerald: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', text: 'text-emerald-300', dot: 'bg-emerald-400' }
                                                        };
                                                        const c = colorMap[opt.color];
                                                        return (
                                                            <label key={opt.value} className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${isSelected ? `${c.bg} ${c.border} ring-1 ring-white/15` : 'bg-white/[0.03] border-white/5 text-white/40 hover:bg-white/[0.06] hover:border-white/10'}`}>
                                                                <input type="radio" name="roleBehavior" value={opt.value} checked={isSelected} onChange={e => setFormData({ ...formData, role_behavior: e.target.value })} className="sr-only" />
                                                                <span className={`text-[13px] font-bold tracking-wide ${isSelected ? 'text-white' : ''}`}>{opt.label}</span>
                                                                <span className={`text-[10px] ${isSelected ? c.text : 'text-white/30'}`}>{opt.desc}</span>
                                                                {isSelected && <div className={`absolute -top-1 -right-1 p-0.5 rounded-full ${c.bg} border ${c.border} shadow-lg`}><Check className="w-2.5 h-2.5 text-white" /></div>}
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {(activeSubTab === 'sub_role' || (showEditModal && !formData.is_main_role)) && (
                                            <div>
                                                <label className="block text-xs text-white/60 mb-1 font-medium">Parent Main Role <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                                <select
                                                    required
                                                    value={formData.parent_role_id}
                                                    onChange={e => setFormData({ ...formData, parent_role_id: e.target.value })}
                                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none appearance-none"
                                                >
                                                    <option value="" disabled>Select a Main Role</option>
                                                    {allRoles.filter(r => r.is_main_role).map((r, idx) => (
                                                        <option key={`${r.role_id || 'role'}-${idx}`} value={r.role_id} className="bg-slate-900 capitalize">{r.role_name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            <div className="pt-6">
                                <button type="submit" className={`w-full ${showEditModal ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)]' : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.2)]'} font-bold text-lg py-4 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-white/40 flex justify-center items-center gap-2 hover:scale-[1.01]`}>
                                    <Check className="w-6 h-6" /> {showEditModal ? 'Save Changes' : 'Confirm & Add'}
                                </button>
                            </div>
                    </form>
                </AdminModal>
            )}

            {/* Delete/Archive Confirmation Modal */}
            {showDeleteModal && selectedItem && (
                <AdminModal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    title={`${mainTab === 'units' ? 'Archive' : 'Delete'} ${mainTab === 'units' ? activeSubTab : 'Role'}?`}
                    tone="danger"
                    icon={<AlertTriangle className="w-5 h-5 text-rose-300" />}
                    size="md"
                    footer={(
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteModal(false)} className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">
                                Cancel
                            </button>
                            <button onClick={confirmDelete} className="flex-1 rounded-xl border border-rose-300/40 bg-rose-500 px-4 py-3 text-sm font-bold text-white hover:bg-rose-400">
                                {mainTab === 'units' ? 'Archive' : 'Delete Permanently'}
                            </button>
                        </div>
                    )}
                >
                    <p className="text-center text-sm text-rose-100/85 leading-relaxed">
                        Are you sure you want to {mainTab === 'units' ? 'archive' : 'delete'} <span className="font-bold text-rose-50 underline decoration-rose-500/50 underline-offset-4">{mainTab === 'units' ? (activeSubTab === 'department' ? selectedItem.department_code : selectedItem.program_code) : selectedItem.role_name}</span>? 
                        {mainTab === 'units' 
                            ? " This record will be moved to the Archive Center and can be restored later." 
                            : " This action is permanent and can only be performed if no users are currently assigned to this role."
                        }
                    </p>
                </AdminModal>
            )}
        </div>
    );
};
