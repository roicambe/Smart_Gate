import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Users, Search, Edit2, Trash2, UserPlus, Eye, Check, AlertTriangle, ChevronLeft, ChevronRight, Mail, Filter, Upload, FileSpreadsheet, Download, GraduationCap, BookOpen, Loader2, Building, UserCircle2, FileUp, AlertCircle, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import * as XLSX from 'xlsx';
import { useToast } from '../toast/ToastProvider';
import { AdminModal } from '../common/AdminModal';
import { Pagination } from '../common/Pagination';
import { SuffixCombobox } from '../common/SuffixCombobox';
import { SortableHeader, useTableSort } from '../common/SortableHeader';

const visitorYearCode = new Date().getFullYear().toString().slice(-2);

const ID_NUMBER_RULES = {
    student: {
        placeholder: '00-00000',
        pattern: /^\d{2}-\d{5}$/,
        hint: 'Student IDs must follow the 00-00000 format.',
        maxLength: 8,
    },
    employee: {
        placeholder: '000000000',
        pattern: /^\d{9}$/,
        hint: 'Employee IDs must be exactly 9 digits.',
        maxLength: 9,
    },
    visitor: {
        placeholder: 'VIS-00000',
        pattern: /^VIS-\d{5,6}$/,
        hint: 'Visitor IDs must follow the VIS-00000 format.',
        maxLength: 10,
    },
};

const trimToNull = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const formatName = (val) => {
    if (!val) return '';
    
    // Only allow letters, spaces, dots, hyphens, and single quotes
    let cleaned = val.replace(/[^a-zA-Z\s.\-']/g, '');

    // List of suffixes to preserve/handle
    const suffixes = ['Jr', 'Sr', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

    // Split by spaces and hyphens while keeping the delimiters to correctly title case each segment
    return cleaned.split(/(\s|-)/).map(part => {
        if (!part) return '';
        if (part === ' ' || part === '-') return part;
        
        const cleanWord = part.replace(/[.,]/g, '');
        const upperWord = cleanWord.toUpperCase();
        
        // Special handling for suffixes
        if (suffixes.includes(upperWord)) {
            const hasDot = part.endsWith('.');
            return upperWord + (hasDot ? '.' : '');
        }

        // Handle specific cases like "Jr." if typed manually with dot
        if (upperWord === 'JR' || upperWord === 'SR') {
             return upperWord.charAt(0).toUpperCase() + upperWord.slice(1).toLowerCase() + (part.endsWith('.') ? '.' : '');
        }

        // Standard Title Case
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join('');
};

const buildUserPayload = (mainRole, subRoles, data, roleBehavior) => {
    const roles = [mainRole, ...subRoles];
    const behavior = roleBehavior || mainRole;
    const isEmployee = behavior === 'employee';
    const isStudent = behavior === 'student';
    const isVisitor = behavior === 'visitor';

    return {
        roles,
        idNumber: (data.id_number || '').trim(),
        firstName: formatName(data.first_name),
        middleName: trimToNull(formatName(data.middle_name)),
        lastName: formatName(data.last_name),
        suffix: trimToNull(data.suffix),
        email: trimToNull(data.email),
        contactNumber: trimToNull(data.contact_number),
        programId: isStudent && data.program_id ? parseInt(data.program_id, 10) : null,
        yearLevel: isStudent && data.year_level ? parseInt(data.year_level, 10) : null,
        departmentId: isEmployee && data.department_id ? parseInt(data.department_id, 10) : null,
        positionTitle: isEmployee ? trimToNull(data.position_title) : null,
        purpose: isVisitor ? trimToNull(data.purpose_of_visit) : null,
        personToVisit: isVisitor ? trimToNull(data.person_to_visit) : null,
        isIrregular: isStudent ? !!data.is_irregular : false,
        isPartTime: isEmployee ? !!data.is_part_time : false,
        isActive: !!data.is_active,
    };
};

export const UserManagement = ({ adminSession, branding }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';
    const [mainTab, setMainTab] = useState('members'); // 'members', 'visitors'
    const [subTab, setSubTab] = useState('student'); // 'student', 'employee'
    const activeRole = mainTab === 'visitors' ? 'visitor' : subTab;

    const [searchQuery, setSearchQuery] = useState('');
    const [visitorSortOrder, setVisitorSortOrder] = useState('desc');
    const [filterDepartmentId, setFilterDepartmentId] = useState('all');
    const [filterProgramId, setFilterProgramId] = useState('all');
    const [filterYearLevel, setFilterYearLevel] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [users, setUsers] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [programs, setPrograms] = useState([]);
    const [availableRoles, setAvailableRoles] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    // Modal States
    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showViewModal, setShowViewModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [status, setStatus] = useState(null);
    const [isEmailAutoGenerated, setIsEmailAutoGenerated] = useState(true);
    const [importRoleIds, setImportRoleIds] = useState([]);
    const [importFilePath, setImportFilePath] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [importResult, setImportResult] = useState(null);
    const emailRef = useRef(null);
    const { showSuccess, showError } = useToast();

    // Form State
    const [formData, setFormData] = useState({
        mainRole: 'student',
        subRoles: [],
        id_number: '',
        first_name: '',
        middle_name: '',
        last_name: '',
        suffix: '',
        program_id: '',
        department_id: '',
        year_level: '',
        position_title: '',
        email: '',
        contact_number: '',
        purpose_of_visit: '',
        person_to_visit: '',
        is_active: true,
        is_irregular: false,
        is_part_time: false,
    });

    // Auto-generate email when name changes and isEmailAutoGenerated is true
    useEffect(() => {
        const isAcademic = formData.mainRole !== 'visitor';
        // Also check role_behavior for non-standard role names
        const currentRoleObj = availableRoles.find(r => r.role_name.toLowerCase() === formData.mainRole);
        const behavior = currentRoleObj?.role_behavior || formData.mainRole;
        const isVisitorBehavior = behavior === 'visitor';
        if (isEmailAutoGenerated && !isVisitorBehavior) {
            const first = (formData.first_name || '').trim().toLowerCase().replace(/\s+/g, '');
            const last = (formData.last_name || '').trim().toLowerCase().replace(/\s+/g, '');
            if (first || last) {
                let generated = '';
                if (first && last) generated = `${last}_${first}@plpasig.edu.ph`;
                else if (first) generated = `${first}@plpasig.edu.ph`;
                else generated = `${last}@plpasig.edu.ph`;
                setFormData(prev => ({ ...prev, email: generated }));
            } else {
                setFormData(prev => ({ ...prev, email: '' }));
            }
        }
    }, [formData.first_name, formData.last_name, isEmailAutoGenerated, formData.roles]);

    const flattenUserData = (data, role) => {
        if (!data) return [];
        return data.map(item => {
            // Extraction of primary contacts from the contacts array
            const email = item.contacts?.find(c => c.contact_type.toLowerCase() === 'email')?.contact_value || '';
            const contact_number = item.contacts?.find(c => c.contact_type.toLowerCase() === 'phone')?.contact_value || '';

            return {
                ...item,
                email,
                contact_number,
                role: item.roles?.join(', ') || role, // Display joined roles or fallback to current tab role
            };
        });
    };

    const fetchUsers = async () => {
        setIsLoading(true);
        try {
            if (mainTab === 'visitors') {
                const data = await invoke('get_visitors', { sortOrder: visitorSortOrder });
                setUsers(flattenUserData(data, 'visitor'));
            } else if (subTab === 'student') {
                const data = await invoke('get_students');
                setUsers(flattenUserData(data, 'student'));
            } else {
                const data = await invoke('get_employees');
                setUsers(flattenUserData(data, 'employee'));
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const [depts, progs, roles] = await Promise.all([
                    invoke('get_departments'),
                    invoke('get_programs'),
                    invoke('get_roles')
                ]);
                setDepartments(depts);
                setPrograms(progs);
                setAvailableRoles(roles);
            } catch (err) {
                console.error("Failed to load organizational data:", err);
            }
        };
        loadInitialData();
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [mainTab, subTab, visitorSortOrder]);

    useEffect(() => {
        if (!status) {
            return;
        }

        if (status.type === 'success') {
            showSuccess(status.message);
        } else {
            showError(status.message);
        }
    }, [status]);

    // Email Domain Validation Logic (Inline)
    useEffect(() => {
        if (!emailRef.current) return;
        
        const email = formData.email || '';
        const roleObj = availableRoles.find(r => r.role_name.toLowerCase() === formData.mainRole);
        const behavior = roleObj?.role_behavior || formData.mainRole;
        const isVisitorBehavior = behavior === 'visitor';
        const isStrict = branding?.strict_email_domain;

        if (isStrict && !isVisitorBehavior && email) {
            if (!email.toLowerCase().endsWith('@plpasig.edu.ph')) {
                emailRef.current.setCustomValidity('Email must use @plpasig.edu.ph');
            } else {
                emailRef.current.setCustomValidity('');
            }
        } else {
            emailRef.current.setCustomValidity('');
        }
    }, [formData.email, formData.mainRole, branding?.strict_email_domain, availableRoles]);

    // Resolve role behavior from the selected main role
    const currentRoleObj = availableRoles.find(r => r.role_name.toLowerCase() === formData.mainRole);
    const roleBehavior = currentRoleObj?.role_behavior || formData.mainRole;

    const activeIdRule = ID_NUMBER_RULES[roleBehavior] || {
        placeholder: 'Enter ID Number',
        pattern: /.+/,
        hint: 'Enter a valid ID number.',
        maxLength: 50,
    };
    const trimmedIdNumber = (formData.id_number || '').trim();
    const isIdNumberValid = activeIdRule.pattern.test(trimmedIdNumber);
    const idNumberValidationMessage = trimmedIdNumber && !isIdNumberValid ? activeIdRule.hint : '';

    const handleRegisterSubmit = async (e) => {
        e.preventDefault();

        try {
            const currentRoleObj = availableRoles.find(r => r.role_name.toLowerCase() === formData.mainRole);
            const resolvedBehavior = currentRoleObj?.role_behavior || formData.mainRole;
            const payload = buildUserPayload(formData.mainRole, formData.subRoles, formData, resolvedBehavior);
            await invoke('register_user', { ...payload, isActive: formData.is_active, activeAdminId: adminSession?.account_id });

            if (resolvedBehavior === 'visitor' && formData.email) {
                handleSendVisitorEmail(formData.id_number);
            }

            setStatus({ type: 'success', message: 'User registered successfully!' });
            setShowRegisterModal(false);
            fetchUsers();
        } catch (error) {
            console.error(error);
            const errorMsg = typeof error === 'string' ? error : 'Failed to register user.';
            if (errorMsg.includes('UNIQUE constraint failed: persons.id_number')) {
                setStatus({ type: 'error', message: `ID Number "${formData.id_number}" is already registered. Please use a different ID.` });
            } else {
                setStatus({ type: 'error', message: errorMsg });
            }
        }
    };

    const handleEditClick = (user) => {
        const roles = user.roles || [];
        const mainRoleObj = roles.map(r => availableRoles.find(ar => ar.role_name.toLowerCase() === r.trim().toLowerCase()))
            .find(r => r && r.is_main_role);
        
        const mainRole = mainRoleObj ? mainRoleObj.role_name.toLowerCase() : (mainTab === 'visitors' ? 'visitor' : subTab);
        const subRoles = roles.filter(r => {
            const roleObj = availableRoles.find(ar => ar.role_name.toLowerCase() === r.trim().toLowerCase());
            return !roleObj || !roleObj.is_main_role;
        });

        setSelectedUser(user);
        setFormData({
            mainRole,
            subRoles,
            id_number: user.id_number || '',
            first_name: user.first_name || '',
            middle_name: user.middle_name || '',
            last_name: user.last_name || '',
            suffix: user.suffix || '',
            program_id: user.program_id || '',
            department_id: user.department_id || '',
            year_level: user.year_level || '',
            position_title: user.position_title || '',
            email: user.email || '',
            contact_number: user.contact_number || '',
            purpose_of_visit: user.purpose_of_visit || '',
            person_to_visit: user.person_to_visit || '',
            is_active: user.is_active,
            is_irregular: user.is_irregular || false,
            is_part_time: user.is_part_time || false,
        });
        setIsEmailAutoGenerated(false);
        setShowEditModal(true);
    };

    const handleEditSubmit = async (e) => {
        e.preventDefault();

        try {
            const currentRoleObj = availableRoles.find(r => r.role_name.toLowerCase() === formData.mainRole);
            const resolvedBehavior = currentRoleObj?.role_behavior || formData.mainRole;
            const payload = buildUserPayload(formData.mainRole, formData.subRoles, formData, resolvedBehavior);

            await invoke('update_user', {
                personId: selectedUser.person_id,
                ...payload,
                isActive: formData.is_active,
                activeAdminId: adminSession?.account_id
            });

            if (
                activeRole === 'visitor' &&
                (selectedUser?.purpose_of_visit || '') !== (formData.purpose_of_visit || '')
            ) {
                await invoke('log_frontend_action', {
                    adminId: adminSession?.account_id,
                    actionType: 'UPDATE',
                    entityType: 'Visitor',
                    entityId: selectedUser.person_id,
                    entityLabel: `${selectedUser.first_name} ${selectedUser.last_name}`,
                    oldValues: JSON.stringify({
                        id_number: selectedUser.id_number,
                        purpose_of_visit: selectedUser.purpose_of_visit || '',
                    }),
                    newValues: JSON.stringify({
                        id_number: selectedUser.id_number,
                        purpose_of_visit: formData.purpose_of_visit || '',
                    }),
                }).catch((auditError) => {
                    console.error('Failed to persist purpose edit audit log:', auditError);
                });
            }

            setStatus({ type: 'success', message: 'User updated successfully!' });
            setShowEditModal(false);
            fetchUsers();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: typeof error === 'string' ? error : 'Failed to update user.' });
        }
    };

    const handleDeleteClick = (user) => {
        setSelectedUser(user);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        try {
            await invoke('delete_user', {
                personId: selectedUser.person_id,
                role: activeRole,
                activeAdminId: adminSession?.account_id
            });
            setStatus({ type: 'success', message: 'User archived successfully!' });
            setShowDeleteModal(false);
            fetchUsers();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: typeof error === 'string' ? error : 'Failed to archive user.' });
        }
    };

    const handleSendVisitorEmail = async (idNumber) => {
        try {
            await invoke("send_visitor_qr", { idNumber });
            setStatus({ type: 'success', message: 'Visitor QR Pass sent successfully to their email!' });
        } catch (error) {
            console.error("Failed to send QR email:", error);
            setStatus({ type: 'error', message: `Email failed: ${error}` });
        }
    };

    const visitorYearCode = new Date().getFullYear().toString().slice(-2);
    const handleRegisterClick = () => {
        setFormData({
            mainRole: (() => {
                const targetBehavior = mainTab === 'visitors' ? 'visitor' : subTab;
                const role = availableRoles.find(r => r.is_main_role && (r.role_behavior === targetBehavior || r.role_name.toLowerCase() === targetBehavior));
                return role ? role.role_name.toLowerCase() : targetBehavior;
            })(),
            subRoles: [],
            id_number: activeRole === 'visitor' ? `VIS-${Math.floor(10000 + Math.random() * 90000)}` : '',
            first_name: '',
            middle_name: '',
            last_name: '',
            suffix: '',
            program_id: programs.length > 0 ? programs[0].program_id.toString() : '',
            department_id: departments.length > 0 ? departments[0].department_id.toString() : '',
            year_level: '',
            position_title: '',
            email: '',
            contact_number: '',
            purpose_of_visit: '',
            person_to_visit: '',
            is_active: true,
            is_irregular: false,
            is_part_time: false,
        });
        setStatus(null);
        setIsEmailAutoGenerated(true);
        setShowRegisterModal(true);
    };

    const handleViewClick = (user) => {
        setSelectedUser(user);
        setShowViewModal(true);
    };

    const getContextAwareImportRole = () => {
        if (mainTab === 'members') {
            return subTab;
        }
        return 'student';
    };

    const handleOpenImportModal = () => {
        const targetBehavior = mainTab === 'members' ? subTab : 'student';
        const defaultMainRole = availableRoles.find(r => r.is_main_role && r.role_behavior === targetBehavior);
        
        setImportRoleIds(defaultMainRole ? [defaultMainRole.role_id] : []);
        setImportFilePath('');
        setImportResult(null);
        setShowImportModal(true);
    };

    const handleDownloadExcelTemplate = async () => {
        const finalRoleId = importRoleIds[0];
        const roleObj = availableRoles.find(r => r.role_id === finalRoleId);
        const behavior = roleObj?.role_behavior || 
                         availableRoles.find(r => r.role_id === roleObj?.parent_role_id)?.role_behavior ||
                         (mainTab === 'members' ? subTab : 'student');

        const baseHeaders = ['id_number', 'first_name', 'middle_name', 'last_name', 'email', 'contact_number'];
        const isStudent = behavior === 'student';
        
        const roleSpecificHeaders = isStudent
            ? ['program_name', 'program_code', 'year_level']
            : ['department_name', 'department_code', 'position_title'];
        
        const headers = [...baseHeaders, ...roleSpecificHeaders];

        const sampleRow = isStudent
            ? ['00-00000', 'Juan', 'Santos', 'Dela Cruz', 'delacruz_juan@plpasig.edu.ph', '09171234567', 'Bachelor of Science in Computer Science', 'BSCS', 1]
            : ['000000000', 'Maria', 'Lopez', 'Reyes', 'reyes_maria@plpasig.edu.ph', '09179998888', 'College of Computer Studies', 'CCS', 'Professor'];

        const worksheet = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `import_template`);
        const fileBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

        const path = await save({
            defaultPath: `${roleObj?.role_name || 'user'}_import_template.xlsx`,
            filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
        });

        if (!path) return;

        await writeFile(path, new Uint8Array(fileBuffer));
        showSuccess('Excel template downloaded successfully.');
    };

    const handleChooseImportFile = async () => {
        const selected = await open({
            multiple: false,
            filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
        });

        if (typeof selected === 'string') {
            setImportFilePath(selected);
        }
    };

    const handleImportSubmit = async () => {
        const finalRoleIds = importRoleIds;
        if (!importFilePath || !adminSession?.account_id || finalRoleIds.length === 0) {
            showError('Please select at least one role and an Excel file before importing.');
            return;
        }

        setIsImporting(true);
        try {
            const result = await invoke('bulk_import_users_from_excel', {
                filePath: importFilePath,
                roleIds: finalRoleIds,
                activeAdminId: adminSession.account_id,
            });

            setImportResult(result);
            const successCount = result?.success_count || 0;
            const failedCount = result?.failed_count || 0;

            if (failedCount > 0) {
                const logs = result.error_logs || [];
                const firstError = logs.length > 0 ? logs[0] : "Check the error log for details.";
                showError(`Import Complete: ${successCount} Success, ${failedCount} Failed. Error: ${firstError}`);
            } else {
                showSuccess(`Successfully imported ${successCount} profiles.`);
            }

            fetchUsers();
        } catch (error) {
            console.error(error);
            showError(typeof error === 'string' ? error : 'Failed to import Excel file.');
        } finally {
            setIsImporting(false);
        }
    };

    const clearAllFilters = () => {
        setSearchQuery('');
        setFilterDepartmentId('all');
        setFilterProgramId('all');
        setFilterYearLevel('all');
        setFilterStatus('all');
        setCurrentPage(1);
    };

    useEffect(() => {
        clearAllFilters();
    }, [mainTab, subTab]);

    // Filter logic
    const filteredUsers = users.filter(user => {
        const matchesSearch = (user.first_name + ' ' + (user.last_name || '')).toLowerCase().includes(searchQuery.toLowerCase()) ||
            (user.id_number || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (user.email || '').toLowerCase().includes(searchQuery.toLowerCase());

        // Visitor specific: only search matters
        if (mainTab === 'visitors') {
            return matchesSearch;
        }

        // Student-specific filters
        if (subTab === 'student' && mainTab === 'members') {
            const matchesProgram = filterProgramId === 'all' || user.program_id?.toString() === filterProgramId;
            const matchesYear = filterYearLevel === 'all' || user.year_level?.toString() === filterYearLevel;
            let matchesStatus = true;
            if (filterStatus === 'active') matchesStatus = user.is_active === true;
            else if (filterStatus === 'inactive') matchesStatus = user.is_active === false;
            else if (filterStatus === 'irregular') matchesStatus = user.is_irregular === true;
            return matchesSearch && matchesProgram && matchesYear && matchesStatus;
        }

        // Behavior-based filtering (Safeguard)
        // Only filter if roles are actually loaded to prevent empty states during initialization
        if (availableRoles && availableRoles.length > 0) {
            const userRoles = user.roles || [];
            const hasMatchingBehavior = userRoles.some(roleName => {
                const roleObj = availableRoles.find(r => r.role_name.toLowerCase() === roleName.toLowerCase());
                if (!roleObj) return false;
                
                // Check direct behavior or inherited behavior
                const behavior = roleObj.role_behavior || 
                               (availableRoles.find(ar => ar.role_id === roleObj.parent_role_id)?.role_behavior);
                
                const targetBehavior = mainTab === 'visitors' ? 'visitor' : subTab;
                return behavior && behavior.toLowerCase() === targetBehavior.toLowerCase();
            });

            if (!hasMatchingBehavior) {
                return false;
            }
        }

        // Dept filter for prof/staff
        let matchesDepartment = true;
        if (mainTab === 'members' && subTab !== 'student' && filterDepartmentId !== 'all') {
            matchesDepartment = user.department_id?.toString() === filterDepartmentId;
        }

        return matchesSearch && matchesDepartment;
    });

    // Sorting
    const { sortConfig, requestSort, sortedData: sortedUsers } = useTableSort(filteredUsers, null, 'asc', 'user_management');

    // Pagination
    const ITEMS_PER_PAGE = 15;
    const [currentPage, setCurrentPage] = useState(1);
    useEffect(() => { setCurrentPage(1); }, [searchQuery, mainTab, subTab, visitorSortOrder, filterProgramId, filterYearLevel, filterStatus, filterDepartmentId, sortConfig]);
    const totalPages = Math.ceil(sortedUsers.length / ITEMS_PER_PAGE);
    const paginatedUsers = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return sortedUsers.slice(start, start + ITEMS_PER_PAGE);
    }, [sortedUsers, currentPage]);
    const showPagination = sortedUsers.length > ITEMS_PER_PAGE;

    return (
        <div className="w-full h-full min-h-0 space-y-6 animate-in slide-in-from-bottom-4 duration-500 relative flex flex-col">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                        <Users className="w-8 h-8 text-emerald-500" />
                        User Registry
                    </h1>
                    <p className="text-slate-500">Manage students, professors, staff, and visitors.</p>
                </div>
                {isSystemAdministrator && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleOpenImportModal}
                            className="flex items-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 px-5 py-2.5 rounded-xl font-bold shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-indigo-500/30"
                        >
                            <Upload className="w-5 h-5" /> Import via Excel
                        </button>
                        <button
                            onClick={handleRegisterClick}
                            className="flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700 px-5 py-2.5 rounded-xl font-bold shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                        >
                            <UserPlus className="w-5 h-5" /> Register Profile
                        </button>
                    </div>
                )}
            </div>

            {/* Controls: Tabs & Search */}
            <div className={`p-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4 ${mainTab === 'members' ? 'mb-0' : ''}`}>
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                        {['members', 'visitors'].map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setMainTab(tab)}
                                className={`px-6 py-2.5 rounded-lg font-medium capitalize transition-all duration-300 ${mainTab === tab
                                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                                    }`}
                            >
                                {tab === 'members' ? 'University Members' : 'Visitors'}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 items-center w-full sm:w-auto">
                        {mainTab === 'visitors' && (
                            <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-48">
                                <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                                <select
                                    value={visitorSortOrder}
                                    onChange={(e) => setVisitorSortOrder(e.target.value)}
                                    className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                                >
                                    <option value="desc">Order: Newest First</option>
                                    <option value="asc">Order: Oldest First</option>
                                </select>
                            </div>
                        )}

                        {mainTab === 'members' && subTab === 'student' && (
                            <>
                                <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-48">
                                    <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                                    <select
                                        value={filterProgramId}
                                        onChange={(e) => setFilterProgramId(e.target.value)}
                                        className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                                    >
                                        <option value="all">Program: All</option>
                                        {programs.map(p => (
                                            <option key={p.program_id} value={p.program_id.toString()}>{p.program_code}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-48">
                                    <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                                    <select
                                        value={filterYearLevel}
                                        onChange={(e) => setFilterYearLevel(e.target.value)}
                                        className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                                    >
                                        <option value="all">Year Level: All</option>
                                        <option value="1">1st Year</option>
                                        <option value="2">2nd Year</option>
                                        <option value="3">3rd Year</option>
                                        <option value="4">4th Year</option>
                                    </select>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-48">
                                    <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                                    <select
                                        value={filterStatus}
                                        onChange={(e) => setFilterStatus(e.target.value)}
                                        className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                                    >
                                        <option value="all">Status: All</option>
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                        <option value="irregular">Irregular</option>
                                    </select>
                                </div>
                            </>
                        )}

                        {mainTab === 'members' && subTab === 'employee' && (
                            <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-48">
                                <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                                <select
                                    value={filterDepartmentId}
                                    onChange={(e) => setFilterDepartmentId(e.target.value)}
                                    className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                                >
                                    <option value="all">Department: All</option>
                                    {departments.map(d => (
                                        <option key={d.department_id} value={d.department_id.toString()}>{d.department_code}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="relative w-full sm:w-80">
                            <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search by ID, Name, or Email..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-2.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium"
                            />
                        </div>
                        <button
                            onClick={clearAllFilters}
                            className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors shrink-0"
                        >
                            Clear All
                        </button>
                    </div>
                </div>
            </div>

            {mainTab === 'members' && (
                <div className="flex border-b border-slate-200 px-2 mb-2">
                    {[
                        { id: 'student', label: 'Students', icon: GraduationCap },
                        { id: 'employee', label: 'Employees', icon: Users },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setSubTab(tab.id)}
                            className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-all duration-300 border-b-2 ${subTab === tab.id
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                                }`}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Data Table - scroll container with sticky headers */}
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm relative">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm text-slate-600 table-fixed">
                        <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
                            <tr>
                                <SortableHeader label="ID Number" sortKey="id_number" sortConfig={sortConfig} onSort={requestSort} width="140px" />
                                <SortableHeader label="Full Name" sortKey="last_name" sortConfig={sortConfig} onSort={requestSort} width={mainTab === 'visitors' ? "200px" : "250px"} />
                                {mainTab === 'visitors' ? (
                                    <>
                                        <SortableHeader label="Purpose" sortKey="purpose_of_visit" sortConfig={sortConfig} onSort={requestSort} width="180px" />
                                        <SortableHeader label="Person to Visit" sortKey="person_to_visit" sortConfig={sortConfig} onSort={requestSort} width="180px" />
                                        <SortableHeader label="Registration Info" sortKey="created_at" sortConfig={sortConfig} onSort={requestSort} width="180px" />
                                        <SortableHeader label="Status" sortKey="is_active" sortConfig={sortConfig} onSort={requestSort} width="100px" />
                                    </>
                                ) : (
                                    <>
                                        <SortableHeader 
                                            label={subTab === 'student' ? 'Program / Year' : 'Department / Roles'} 
                                            sortKey={subTab === 'student' ? 'program_name' : 'department_name'} 
                                            sortConfig={sortConfig} onSort={requestSort} width="300px" 
                                        />
                                        <SortableHeader label="Status" sortKey="is_active" sortConfig={sortConfig} onSort={requestSort} width="120px" />
                                    </>
                                )}
                                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-700 text-right" style={{ width: '120px' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={mainTab === 'visitors' ? 7 : 5} className="text-center py-20 text-slate-500">
                                        <div className="flex flex-col items-center justify-center space-y-3">
                                            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                                            <p className="text-slate-500 font-medium">Synchronizing profile data...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={mainTab === 'visitors' ? 7 : 5} className="p-12 text-center">
                                        <div className="flex flex-col items-center justify-center space-y-4">
                                            <div className="p-4 bg-slate-50 rounded-full border border-slate-100">
                                                <Users className="w-10 h-10 text-slate-300" />
                                            </div>
                                            <div>
                                                <p className="text-slate-900 font-bold text-lg">No Profiles Found</p>
                                                <p className="text-slate-500 text-sm max-w-xs mx-auto">
                                                    We couldn't find any {mainTab === 'visitors' ? 'visitors' : 'members'} matching your current search or filter criteria.
                                                </p>
                                            </div>
                                            <button
                                                onClick={clearAllFilters}
                                                className="text-blue-600 font-semibold text-sm hover:underline"
                                            >
                                                Clear all filters
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedUsers.map((user, index) => (
                                    <tr key={`${user.person_id || 'user'}-${index}`} className="hover:bg-slate-50 even:bg-slate-50/50 transition-colors group">
                                        <td className="px-3 py-1.5 font-mono font-medium text-slate-900">{user.id_number}</td>
                                        <td className="px-3 py-1.5 font-medium text-slate-900">
                                            {user.last_name || ''}{user.last_name ? ',' : ''} {user.first_name}{user.middle_name ? ' ' + user.middle_name.charAt(0) + '.' : ''}{user.suffix ? ' ' + user.suffix : ''}
                                        </td>
                                        {mainTab === 'visitors' ? (
                                            <>
                                                <td className="px-3 py-1.5 text-slate-600">{user.purpose_of_visit}</td>
                                                <td className="px-3 py-1.5 text-slate-600">{user.person_to_visit || 'N/A'}</td>
                                                <td className="px-3 py-1.5 text-slate-600">
                                                    <div className="flex flex-col">
                                                        <span className="font-medium text-slate-900">{user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</span>
                                                        <span className="text-[10px] text-slate-500 font-mono">{user.created_at ? new Date(user.created_at).toLocaleTimeString([], { timeStyle: 'short' }) : 'N/A'}</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-1.5">
                                                    <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${(user.time_out || (user.time_in && new Date(user.time_in).toDateString() !== new Date().toDateString())) ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                                                        {(user.time_out || (user.time_in && new Date(user.time_in).toDateString() !== new Date().toDateString())) ? 'Expired' : 'Active'}
                                                    </span>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="px-3 py-1.5 text-slate-600">
                                                    {subTab === 'student'
                                                        ? (
                                                            <div className="flex flex-col">
                                                                <span>{user.program_name} - Yr {user.year_level}</span>
                                                            </div>
                                                        )
                                                        : (
                                                            <div className="flex flex-col">
                                                                <span className="font-semibold text-slate-800">{user.department_name || 'N/A'}</span>
                                                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                                                    <span className="text-xs text-slate-500 uppercase tracking-wide">{user.role}</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                </td>
                                                <td className="px-3 py-1.5 text-left">
                                                    <div className="flex items-center gap-2 -ml-1.5">
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full border ${user.is_active ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-rose-100 text-rose-700 border-rose-200'
                                                            }`}>
                                                            {user.is_active ? 'Active' : 'Inactive'}
                                                        </span>
                                                        {user.is_irregular && (
                                                            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                                                Irregular
                                                            </span>
                                                        )}
                                                        {user.is_part_time && (
                                                            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                                                                Part-Time
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            </>
                                        )}
                                        <td className="px-3 py-1.5 text-right space-x-2">
                                            <button
                                                className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors border border-transparent hover:border-blue-200 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                title="View Details"
                                                onClick={() => handleViewClick(user)}>
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            {isSystemAdministrator && (
                                                <>
                                                    <button className="p-2 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors border border-transparent hover:border-amber-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Edit"
                                                        onClick={() => handleEditClick(user)}>
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Archive"
                                                        onClick={() => handleDeleteClick(user)}>
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                    totalItems={filteredUsers.length}
                    itemsPerPage={ITEMS_PER_PAGE}
                    currentItemsCount={paginatedUsers.length}
                />
            </div>

            {/* Smart Registration / Edit Form Component */}
            {(showRegisterModal || showEditModal) && (
                <AdminModal
                    isOpen={showRegisterModal || showEditModal}
                    onClose={() => { setShowRegisterModal(false); setShowEditModal(false); }}
                    title={showEditModal ? 'Edit Profile' : 'Register New Profile'}
                    icon={showEditModal ? <Edit2 className="w-5 h-5 text-amber-300" /> : <UserPlus className="w-5 h-5 text-emerald-300" />}
                    subtitle="Use this shared admin modal pattern for a consistent profile workflow."
                    size="lg"
                >
                    <form onSubmit={showEditModal ? handleEditSubmit : handleRegisterSubmit} className="space-y-6">
                            {/* Role Selector */}
                            <div className="space-y-4">
                                <label className="block text-xs font-semibold text-white/60 uppercase tracking-widest">Main Role Assignment</label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                     {availableRoles.filter(r => r.is_main_role)
                                         .sort((a, b) => {
                                             // Sort visitor-behavior roles to the bottom
                                             const aIsVisitor = a.role_behavior === 'visitor' ? 1 : 0;
                                             const bIsVisitor = b.role_behavior === 'visitor' ? 1 : 0;
                                             if (aIsVisitor !== bIsVisitor) return aIsVisitor - bIsVisitor;
                                             return a.role_id - b.role_id;
                                         })
                                         .map((r) => {
                                         const isSelected = formData.mainRole === r.role_name.toLowerCase();
                                         const behavior = r.role_behavior || r.role_name.toLowerCase();
                                         const colorMap = {
                                             student: { color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-500/30' },
                                             employee: { color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-500/30' },
                                             visitor: { color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-500/30' }
                                         };
                                         const theme = colorMap[behavior] || { color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-500/30' };
                                         
                                         return (
                                             <label key={r.role_id} className={`relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border cursor-pointer transition-all duration-300 ${isSelected ? `${theme.bg} ${theme.border} ring-1 ring-white/20` : 'bg-white/[0.03] border-white/5 text-white/40 hover:bg-white/[0.06] hover:border-white/10'}`}>
                                                 <input 
                                                     type="radio" 
                                                     name="mainRole" 
                                                     value={r.role_name.toLowerCase()} 
                                                     checked={isSelected} 
                                                     onChange={(e) => {
                                                         const newRole = e.target.value;
                                                         const roleObj = availableRoles.find(r => r.role_name.toLowerCase() === newRole);
                                                         const behavior = roleObj?.role_behavior || newRole;
                                                         
                                                         setFormData({ 
                                                             ...formData, 
                                                             mainRole: newRole, 
                                                             subRoles: [],
                                                             is_irregular: behavior === 'student' ? formData.is_irregular : false,
                                                             is_part_time: behavior === 'employee' ? formData.is_part_time : false,
                                                             program_id: behavior === 'student' ? formData.program_id : (programs.length > 0 ? programs[0].program_id.toString() : ''),
                                                             department_id: behavior === 'employee' ? formData.department_id : (departments.length > 0 ? departments[0].department_id.toString() : ''),
                                                             year_level: behavior === 'student' ? formData.year_level : '',
                                                             position_title: behavior === 'employee' ? formData.position_title : '',
                                                             purpose_of_visit: behavior === 'visitor' ? formData.purpose_of_visit : '',
                                                             person_to_visit: behavior === 'visitor' ? formData.person_to_visit : ''
                                                         });
                                                     }} 
                                                     className="sr-only" 
                                                 />
                                                 <span className={`text-[13px] font-bold tracking-wide text-center ${isSelected ? 'text-white' : ''}`}>{r.role_name}</span>
                                                 {isSelected && <div className={`absolute -top-1 -right-1 p-0.5 rounded-full ${theme.bg} border ${theme.border} shadow-lg`}><Check className="w-2.5 h-2.5 text-white" /></div>}
                                             </label>
                                         );
                                     })}
                                </div>
                            </div>

                             {(() => {
                                 const currentMainRole = availableRoles.find(r => r.role_name.toLowerCase() === formData.mainRole);
                                 if (!currentMainRole) return null;
                                 
                                 const subRolesForCurrentMain = availableRoles.filter(r => !r.is_main_role && r.parent_role_id === currentMainRole.role_id);
                                 if (subRolesForCurrentMain.length === 0) return null;

                                 const themeMap = {
                                     student: { color: 'text-blue-200', bg: 'bg-blue-500/20', border: 'border-blue-500/50', ring: 'shadow-[0_0_15px_rgba(59,130,246,0.1)]' },
                                     employee: { color: 'text-amber-200', bg: 'bg-amber-500/20', border: 'border-amber-500/50', ring: 'shadow-[0_0_15px_rgba(245,158,11,0.1)]' },
                                     visitor: { color: 'text-emerald-200', bg: 'bg-emerald-500/20', border: 'border-emerald-500/50', ring: 'shadow-[0_0_15px_rgba(16,185,129,0.1)]' }
                                 };
                                 const currentBehavior = currentMainRole.role_behavior || formData.mainRole;
                                 const theme = themeMap[currentBehavior] || { color: 'text-slate-200', bg: 'bg-slate-500/20', border: 'border-slate-500/50', ring: 'shadow-[0_0_15px_rgba(100,116,139,0.1)]' };

                                 return (
                                     <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2">
                                         <div className="flex items-center justify-between">
                                             <label className="block text-xs text-white/60 font-semibold uppercase tracking-wider">Sub-Role Assignment</label>
                                             <span className={`text-[10px] ${theme.bg} ${theme.color} px-2 py-0.5 rounded-full border ${theme.border} font-bold uppercase`}>Options</span>
                                         </div>
                                         <div className="flex flex-wrap gap-2.5">
                                             {subRolesForCurrentMain.map(role => {
                                                 const isActive = formData.subRoles.includes(role.role_name);
                                                 return (
                                                     <label key={role.role_id} className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border cursor-pointer transition-all duration-200 ${isActive ? `${theme.bg} ${theme.border} ${theme.color} ${theme.ring}` : 'bg-black/40 border-white/10 text-white/50 hover:border-white/30'}`}>
                                                         <input 
                                                             type="checkbox" 
                                                             className="hidden" 
                                                             checked={isActive}
                                                             onChange={(e) => {
                                                                 const newSubRoles = e.target.checked 
                                                                     ? [...formData.subRoles, role.role_name]
                                                                     : formData.subRoles.filter(r => r !== role.role_name);
                                                                 setFormData({ ...formData, subRoles: newSubRoles });
                                                             }}
                                                         />
                                                         <span className="text-sm font-bold capitalize">{role.role_name}</span>
                                                         <div className={`w-4 h-4 rounded flex items-center justify-center transition-all ${isActive ? (roleBehavior === 'employee' ? 'bg-amber-500' : roleBehavior === 'student' ? 'bg-blue-500' : 'bg-emerald-500') + ' scale-110' : 'bg-white/10'}`}>
                                                             {isActive && <Check className="w-2.5 h-2.5 text-black stroke-[4]" />}
                                                         </div>
                                                     </label>
                                                 );
                                             })}
                                         </div>
                                     </div>
                                 );
                             })()}

                            <div className="space-y-5">
                                <div className="space-y-4">


                                    <div>
                                        <label className="block text-xs text-white/60 mb-1 font-medium">
                                            {roleBehavior === 'student' ? 'Student ID Number' : roleBehavior === 'visitor' ? 'Visitor ID Number' : 'Employee ID Number'} <span className="text-rose-500 text-base font-bold ml-0.5">*</span>
                                        </label>
                                        <input
                                            required
                                            type="text"
                                            inputMode={roleBehavior === 'visitor' ? 'text' : 'numeric'}
                                            value={formData.id_number}
                                            maxLength={activeIdRule.maxLength}
                                            onChange={e => setFormData({
                                                ...formData,
                                                id_number: roleBehavior === 'visitor' ? e.target.value.toUpperCase() : e.target.value,
                                            })}
                                            className={`w-full bg-black/40 border rounded-xl px-4 py-3 text-white font-mono placeholder-white/20 focus:ring-2 focus:outline-none transition-all ${idNumberValidationMessage ? 'border-rose-400/70 focus:ring-rose-500/40 focus:border-rose-400' : 'border-white/10 focus:ring-blue-500/50 focus:border-blue-500/50'}`}
                                            placeholder={activeIdRule.placeholder}
                                        />
                                        <p className={`mt-2 text-xs font-medium transition-colors ${idNumberValidationMessage ? 'text-rose-300' : 'text-white/45'}`}>
                                            {idNumberValidationMessage || activeIdRule.hint}
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 items-start gap-4 md:grid-cols-4">
                                        <div className="flex min-w-0 w-full flex-col">
                                            <label className="mb-1 flex min-h-[20px] items-end text-xs font-medium text-white/60">First Name <span className="ml-0.5 text-base font-bold text-rose-500">*</span></label>
                                            <input 
                                                required 
                                                type="text" 
                                                value={formData.first_name} 
                                                onChange={e => setFormData({ ...formData, first_name: formatName(e.target.value) })} 
                                                placeholder="e.g. Juan"
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" 
                                            />
                                        </div>
                                        <div className="flex min-w-0 w-full flex-col">
                                            <label className="mb-1 flex min-h-[24px] items-end text-xs font-medium text-white/60">Middle Name</label>
                                            <input 
                                                type="text" 
                                                value={formData.middle_name} 
                                                onChange={e => setFormData({ ...formData, middle_name: formatName(e.target.value) })} 
                                                placeholder="Optional"
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" 
                                            />
                                        </div>
                                        <div className="flex min-w-0 w-full flex-col">
                                            <label className="mb-1 flex min-h-[20px] items-end text-xs font-medium text-white/60">Last Name <span className="ml-0.5 text-base font-bold text-rose-500">*</span></label>
                                            <input 
                                                required 
                                                type="text" 
                                                value={formData.last_name} 
                                                onChange={e => setFormData({ ...formData, last_name: formatName(e.target.value) })} 
                                                placeholder="e.g. Dela Cruz"
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" 
                                            />
                                        </div>
                                        <div className="flex min-w-0 w-full flex-col">
                                            <label className="mb-1 flex min-h-[24px] items-end text-xs font-medium text-white/60">Suffix</label>
                                            <SuffixCombobox
                                                value={formData.suffix}
                                                onChange={val => setFormData({ ...formData, suffix: val })}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:ring-2 focus:ring-white/20 focus:outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <div>
                                            <label className="mb-1 flex min-h-[24px] items-end text-xs font-medium text-white/60">Email Address {roleBehavior === 'visitor' && <span className="ml-0.5 text-base font-bold text-rose-500">*</span>}</label>
                                            <input 
                                                ref={emailRef}
                                                required={roleBehavior === 'visitor' || (branding?.strict_email_domain && roleBehavior !== 'visitor')} 
                                                type="email" 
                                                value={formData.email} 
                                                onChange={e => { setIsEmailAutoGenerated(false); setFormData({ ...formData, email: e.target.value }); }} 
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" 
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1 flex min-h-[24px] items-end text-xs font-medium text-white/60">Contact Number</label>
                                            <input type="text" value={formData.contact_number} onChange={e => setFormData({ ...formData, contact_number: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white font-mono focus:ring-2 focus:ring-white/20 focus:outline-none" />
                                        </div>
                                    </div>
                                </div>

                                <div className="my-4 h-px w-full bg-white/5"></div>

                                {roleBehavior === 'student' && (
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 animate-in fade-in">
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Program <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <select required={roleBehavior === 'student'} value={formData.program_id} onChange={e => setFormData({ ...formData, program_id: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none appearance-none">
                                                {programs.length === 0 && <option value="" disabled>No Programs Available</option>}
                                                {programs.map((p, idx) => (
                                                    <option key={`${p.program_id || 'prog'}-${idx}`} value={p.program_id} className="bg-slate-900">{p.program_code} - {p.program_name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Year Level <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <select required={roleBehavior === 'student'} value={formData.year_level} onChange={e => setFormData({ ...formData, year_level: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none appearance-none">
                                                <option value="" disabled className="bg-slate-900">Select Year Level</option>
                                                <option value="1" className="bg-slate-900">1st Year</option>
                                                <option value="2" className="bg-slate-900">2nd Year</option>
                                                <option value="3" className="bg-slate-900">3rd Year</option>
                                                <option value="4" className="bg-slate-900">4th Year</option>
                                            </select>
                                        </div>
                                        <div className="md:col-span-2 flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                                            <input type="checkbox" id="isIrregular" checked={formData.is_irregular} onChange={e => setFormData({ ...formData, is_irregular: e.target.checked })} className="w-5 h-5 text-amber-500 bg-black/50 border-white/20 rounded focus:ring-amber-500/50" />
                                            <label htmlFor="isIrregular" className="text-sm font-medium text-white">Student is Irregular (No Automated Penalty)</label>
                                        </div>
                                    </div>
                                )}

                                {roleBehavior === 'employee' && (
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 animate-in fade-in">
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Department <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <select required value={formData.department_id} onChange={e => setFormData({ ...formData, department_id: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none appearance-none">
                                                {departments.length === 0 && <option value="" disabled>No Departments Available</option>}
                                                {departments.map((d, idx) => (
                                                    <option key={`${d.department_id || 'dept'}-${idx}`} value={d.department_id} className="bg-slate-900">{d.department_code} - {d.department_name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Designation / Title <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <input required type="text" value={formData.position_title} onChange={e => setFormData({ ...formData, position_title: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" placeholder="e.g. Associate Professor" />
                                        </div>
                                        <div className="md:col-span-2 flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                                            <input type="checkbox" id="isPartTime" checked={formData.is_part_time} onChange={e => setFormData({ ...formData, is_part_time: e.target.checked })} className="w-5 h-5 text-amber-500 bg-black/50 border-white/20 rounded focus:ring-amber-500/50" />
                                            <label htmlFor="isPartTime" className="text-sm font-medium text-white">Part Time Employee</label>
                                        </div>
                                    </div>
                                )}

                                {roleBehavior === 'visitor' && (
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 animate-in fade-in">
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Purpose of Visit <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <input required={roleBehavior === 'visitor'} type="text" value={formData.purpose_of_visit} onChange={e => setFormData({ ...formData, purpose_of_visit: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Person to Visit <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <input required={roleBehavior === 'visitor'} type="text" value={formData.person_to_visit} onChange={e => setFormData({ ...formData, person_to_visit: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" />
                                        </div>
                                    </div>
                                )}

                                {roleBehavior !== 'visitor' && (
                                    <div className="flex items-center gap-3 mt-4 p-4 bg-white/5 border border-white/10 rounded-xl">
                                        <input type="checkbox" id="isActive" checked={formData.is_active} onChange={e => setFormData({ ...formData, is_active: e.target.checked })} className="w-5 h-5 text-emerald-500 bg-black/50 border-white/20 rounded focus:ring-emerald-500/50" />
                                        <label htmlFor="isActive" className="text-sm font-medium text-white">ID Card Active (Allowed Entry)</label>
                                    </div>
                                )}
                            </div>

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={!isIdNumberValid}
                                    className={`w-full ${showEditModal ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)] hover:shadow-[0_0_30px_rgba(245,158,11,0.4)]' : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)]'} font-bold text-lg py-4 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-white/40 flex justify-center items-center gap-2 hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 disabled:shadow-none`}
                                >
                                    <Check className="w-6 h-6" /> {showEditModal ? 'Save Changes' : 'Confirm & Register'}
                                </button>
                            </div>
                    </form>
                </AdminModal>
            )}

            {/* Bulk Import Modal */}
            {showImportModal && (
                <AdminModal
                    isOpen={showImportModal}
                    onClose={() => setShowImportModal(false)}
                    title="Bulk Import via Excel"
                    icon={<FileSpreadsheet className="w-5 h-5 text-indigo-300" />}
                    subtitle="Upload standardized spreadsheets to register users in bulk."
                    size="lg"
                >
                    <div className="space-y-6">
                        {/* Explanatory Note */}
                        <div className="bg-white/5 border border-white/5 rounded-2xl p-4">
                            <p className="text-xs text-white/50 leading-relaxed">
                                <span className="text-indigo-400 font-bold">Note:</span> Select the roles to be assigned to the users in your file. These roles will be applied globally to the entire batch, allowing you to import any Excel file without needing a dedicated "Role" column.
                            </p>
                        </div>

                        {/* Main Roles Section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-[12px] font-bold text-white/40 uppercase tracking-wider">Main Roles</label>
                                <button 
                                    type="button"
                                    onClick={() => {
                                        const mainRoleIds = availableRoles.filter(r => r.is_main_role && r.role_behavior !== 'visitor').map(r => r.role_id);
                                        setImportRoleIds(prev => [...new Set([...prev, ...mainRoleIds])]);
                                    }}
                                    className="text-[12px] font-bold text-emerald-400/70 hover:text-emerald-400 transition-colors"
                                >
                                    Select All
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2 border border-white/10 rounded-2xl p-4 bg-black/20">
                                {availableRoles.filter(r => r.is_main_role && r.role_behavior !== 'visitor').map(role => {
                                    const isSelected = importRoleIds.includes(role.role_id);
                                    return (
                                        <button
                                            key={role.role_id}
                                            type="button"
                                            onClick={() => {
                                                if (isSelected) {
                                                    setImportRoleIds(prev => prev.filter(id => id !== role.role_id));
                                                } else {
                                                    setImportRoleIds(prev => [...prev, role.role_id]);
                                                }
                                            }}
                                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 border ${
                                                isSelected 
                                                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                                                    : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/60'
                                            }`}
                                        >
                                            {role.role_name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Sub Roles Section */}
                        {availableRoles.some(r => !r.is_main_role && importRoleIds.includes(r.parent_role_id)) && (
                            <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="flex items-center justify-between px-1">
                                    <label className="text-[12px] font-bold text-white/40 uppercase tracking-wider">Sub-Roles / Designations</label>
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            const selectedMainIds = availableRoles.filter(r => r.is_main_role && importRoleIds.includes(r.role_id)).map(r => r.role_id);
                                            const subRoleIds = availableRoles.filter(r => !r.is_main_role && selectedMainIds.includes(r.parent_role_id)).map(r => r.role_id);
                                            setImportRoleIds(prev => [...new Set([...prev, ...subRoleIds])]);
                                        }}
                                        className="text-[12px] font-bold text-blue-400/70 hover:text-blue-400 transition-colors"
                                    >
                                        Select All
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2 border border-white/10 rounded-2xl p-4 bg-black/20">
                                    {availableRoles
                                        .filter(r => !r.is_main_role && importRoleIds.includes(r.parent_role_id))
                                        .map(role => {
                                            const isSelected = importRoleIds.includes(role.role_id);
                                            return (
                                                <button
                                                    key={role.role_id}
                                                    type="button"
                                                    onClick={() => {
                                                        if (isSelected) {
                                                            setImportRoleIds(prev => prev.filter(id => id !== role.role_id));
                                                        } else {
                                                            setImportRoleIds(prev => [...prev, role.role_id]);
                                                        }
                                                    }}
                                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 border ${
                                                        isSelected 
                                                            ? 'bg-blue-600/20 border-blue-500 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                                                            : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/60'
                                                    }`}
                                                >
                                                    {role.role_name}
                                                </button>
                                            );
                                        })}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-between items-center pt-2">
                            <p className="text-[11px] text-white/30 italic px-1">
                                * Every user in the Excel file will be assigned all selected roles above.
                            </p>
                            <button 
                                type="button"
                                onClick={() => setImportRoleIds([])}
                                className="text-[12px] font-bold text-white/30 hover:text-white/60 transition-colors flex items-center gap-2"
                            >
                                <RefreshCw className="w-3 h-3" /> Clear All Roles
                            </button>
                        </div>

                        {/* Import Guidelines */}
                        <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 p-4 text-xs">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="p-1 rounded-lg bg-blue-500/20 text-blue-400">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                </div>
                                <p className="font-bold text-blue-200 uppercase tracking-tight">Import Guidelines</p>
                            </div>
                            <ul className="space-y-1.5 text-blue-100/60 pl-6 list-disc font-medium">
                                <li>Use the standardized template provided below. Do not rename column headers.</li>
                                <li>Required fields: <span className="text-blue-200">id_number, first_name, last_name</span>.</li>
                                <li>Existing <span className="text-blue-200">id_number</span> records will be skipped during processing.</li>
                                <li>Unresolved departments or programs will be logged in the error summary.</li>
                            </ul>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
                            <div className="space-y-3">
                                <label className="block text-xs font-bold text-white/50 uppercase">Step 2: Template</label>
                                <button
                                    onClick={handleDownloadExcelTemplate}
                                    disabled={importRoleIds.length === 0}
                                    className="w-full flex items-center justify-between gap-3 p-4 rounded-2xl border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-all disabled:opacity-50 group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
                                            <FileSpreadsheet className="w-5 h-5" />
                                        </div>
                                        <div className="text-left">
                                            <p className="text-sm font-bold">Download Format</p>
                                            <p className="text-[10px] text-white/40">Standardized Excel Template</p>
                                        </div>
                                    </div>
                                    <Download className="w-4 h-4 text-white/20" />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <label className="block text-xs font-bold text-white/50 uppercase">Step 3: Upload</label>
                                <button
                                    onClick={handleChooseImportFile}
                                    className={`w-full flex items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
                                        importFilePath 
                                            ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-100' 
                                            : 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${importFilePath ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white/40'}`}>
                                            <FileUp className="w-5 h-5" />
                                        </div>
                                        <div className="text-left overflow-hidden">
                                            <p className="text-sm font-bold truncate">
                                                {importFilePath ? importFilePath.split('\\').pop().split('/').pop() : 'Select Excel File'}
                                            </p>
                                            <p className="text-[10px] text-white/40">Supported formats: .xlsx, .xls</p>
                                        </div>
                                    </div>
                                </button>
                            </div>
                        </div>

                        {importResult && (
                            <div className={`p-4 rounded-2xl border animate-in fade-in slide-in-from-top-2 duration-300 ${
                                importResult.failed_count === 0 
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100' 
                                    : 'bg-rose-500/10 border-rose-500/30 text-rose-100'
                            }`}>
                                <div className="flex items-center gap-3 mb-2">
                                    <div className={`p-1.5 rounded-lg ${importResult.failed_count === 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                                        {importResult.failed_count === 0 ? <Check className="w-4 h-4 text-white" /> : <AlertCircle className="w-4 h-4 text-white" />}
                                    </div>
                                    <p className="font-bold text-sm">Import Summary</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-xs font-medium pl-9">
                                    <p>Successfully Imported: <span className="text-white font-bold">{importResult.success_count}</span></p>
                                    <p>Failed Records: <span className="text-white font-bold">{importResult.failed_count}</span></p>
                                </div>
                                {importResult.error_logs.length > 0 && (
                                    <div className="mt-3 pl-9 space-y-1">
                                        <p className="text-[10px] uppercase font-bold text-white/30">Error Details</p>
                                        <div className="max-h-24 overflow-y-auto text-[11px] space-y-1 scrollbar-thin scrollbar-thumb-white/10">
                                            {importResult.error_logs.map((err, i) => (
                                                <p key={i} className="text-rose-200/70">• {err}</p>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                            <button
                                onClick={() => setShowImportModal(false)}
                                className="px-5 py-2.5 text-sm font-bold rounded-xl border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleImportSubmit}
                                disabled={isImporting || importRoleIds.length === 0 || !importFilePath}
                                className="px-5 py-2.5 text-sm font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2"
                            >
                                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                                {isImporting ? 'Importing...' : 'Start Import'}
                            </button>
                        </div>
                    </div>
                </AdminModal>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && selectedUser && (
                <AdminModal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    title="Archive Profile?"
                    tone="danger"
                    icon={<AlertTriangle className="w-5 h-5 text-rose-300" />}
                    size="md"
                    footer={(
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowDeleteModal(false)}
                                className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 rounded-xl border border-rose-300/40 bg-rose-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-rose-400"
                            >
                                Archive
                            </button>
                        </div>
                    )}
                >
                    <p className="text-center text-sm leading-relaxed text-rose-100/85">
                        Are you sure you want to archive <span className="font-semibold text-rose-50">{selectedUser.first_name} {selectedUser.last_name}</span>? This record will be moved to the Archive Center.
                    </p>
                </AdminModal>
            )}

            {/* View Details Modal */}
            {showViewModal && selectedUser && (
                <AdminModal
                    isOpen={showViewModal}
                    onClose={() => setShowViewModal(false)}
                    title="Profile Details"
                    icon={<Eye className="w-5 h-5 text-white" />}
                    tone="default"
                    size="md"
                >
                    <div className="space-y-6">
                            <div className="flex items-center gap-4 border-b border-white/10 pb-6">
                                <div className="w-16 h-16 bg-blue-500/20 rounded-full border border-blue-400/30 flex items-center justify-center text-blue-300 text-2xl font-bold">
                                    {selectedUser.first_name.charAt(0)}
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white break-words">{selectedUser.first_name} {selectedUser.middle_name} {selectedUser.last_name || ''}</h3>
                                    <p className="text-sm font-mono text-white/50">{selectedUser.id_number}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                             <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                                <div><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Role</p><p className="font-semibold text-white capitalize">{selectedUser.role || activeRole}</p></div>
                                {(() => {
                                    const userRoles = Array.isArray(selectedUser.roles) ? selectedUser.roles : (selectedUser.roles?.split(',') || []);
                                    const behaviors = userRoles.map(roleName => {
                                        const roleObj = availableRoles.find(r => r.role_name.toLowerCase() === roleName.trim().toLowerCase());
                                        return roleObj?.role_behavior || (roleName.trim().toLowerCase() === 'visitor' ? 'visitor' : roleName.trim().toLowerCase() === 'student' ? 'student' : roleName.trim().toLowerCase() === 'employee' ? 'employee' : null);
                                    }).filter(Boolean);

                                    const isStudentBehavior = behaviors.includes('student');
                                    const isEmployeeBehavior = behaviors.includes('employee');
                                    const isVisitorBehavior = behaviors.includes('visitor') || activeRole === 'visitor';

                                    if (isVisitorBehavior) {
                                        return (
                                            <>
                                                <div><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Contact Number</p><p className="font-semibold text-white break-all">{selectedUser.contact_number || 'N/A'}</p></div>
                                                <div><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Email</p><p className="font-semibold text-white break-all">{selectedUser.email || 'N/A'}</p></div>
                                                <div className="col-span-2"><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Purpose</p><p className="font-semibold text-white break-words">{selectedUser.purpose_of_visit}</p></div>
                                                <div className="col-span-2"><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Person to Visit</p><p className="font-semibold text-white break-words">{selectedUser.person_to_visit || 'N/A'}</p></div>
                                                <div><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Reg. Date/Time</p><p className="font-semibold text-white">{selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleString() : '--'}</p></div>
                                                <div><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Exit Time</p><p className="font-semibold text-white">{selectedUser.time_out ? new Date(selectedUser.time_out).toLocaleString() : '--'}</p></div>
                                                {selectedUser.email && (
                                                    <div className="col-span-2 mt-4 pt-4 border-t border-white/10 flex justify-center">
                                                        <button
                                                            onClick={() => handleSendVisitorEmail(selectedUser.id_number)}
                                                            className="flex items-center gap-2 bg-emerald-600 text-white hover:bg-emerald-500 px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all active:scale-95 shadow-emerald-600/20"
                                                        >
                                                            <Mail className="w-5 h-5" /> Send QR Digital Pass
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    }

                                    return (
                                        <>
                                            {isStudentBehavior && (
                                                <>
                                                    <div className="col-span-2"><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Program</p><p className="font-semibold text-white break-words">{selectedUser.program_name}</p></div>
                                                    <div><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Year Level</p><p className="font-semibold text-white">{selectedUser.year_level}</p></div>
                                                    <div><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Classification</p><p className={`font-bold ${selectedUser.is_irregular ? 'text-amber-400' : 'text-white'}`}>{selectedUser.is_irregular ? 'Irregular Student' : 'Regular Student'}</p></div>
                                                </>
                                            )}
                                            {isEmployeeBehavior && (
                                                <>
                                                    <div className="col-span-2"><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Department</p><p className="font-semibold text-white break-words">{selectedUser.department_name}</p></div>
                                                    <div className="col-span-2"><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Position/Title</p><p className="font-semibold text-white break-words">{selectedUser.position_title}</p></div>
                                                    <div><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Employment Status</p><p className={`font-bold ${selectedUser.is_part_time ? 'text-amber-400' : 'text-white'}`}>{selectedUser.is_part_time ? 'Part Time' : 'Full Time'}</p></div>
                                                </>
                                            )}
                                            <div className="col-span-2"><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Email Address</p><p className="font-semibold text-white break-all">{selectedUser.email || 'N/A'}</p></div>
                                            <div className="col-span-2"><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Contact Number</p><p className="font-semibold text-white break-all">{selectedUser.contact_number || 'N/A'}</p></div>
                                            <div><p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Profile Status</p>
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${selectedUser.is_active ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-rose-500/20 text-rose-300 border border-rose-400/30'}`}>
                                                    {selectedUser.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                            </div>
                    </div>
                </AdminModal>
            )}
        </div>
    );
};
