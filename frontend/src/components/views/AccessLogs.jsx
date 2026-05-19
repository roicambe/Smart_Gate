import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    History, Search, Filter, RefreshCw, Calendar, ArrowUpRight, ArrowDownLeft, Download, FileText, FileSpreadsheet, Loader2, ChevronLeft, ChevronRight, Plus, Trash2, Table, PanelRightClose, Sun, Moon
} from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useToast } from '../toast/ToastProvider';
import { drawInstitutionalHeader, prepareInstitutionalHeaderAssets } from '../../utils/pdfInstitutionalHeader';
import { Pagination } from '../common/Pagination';
import { SortableHeader, useTableSort } from '../common/SortableHeader';
import { AdminModal } from '../common/AdminModal';

export const AccessLogs = ({ branding, adminSession }) => {
    const MANUAL_EXPORT_PREFS_KEY = 'accessLogs.eventAttendance.manualExportPrefs.v1';
    function formatDate(dateString) {
        if (!dateString) return "-";
        const date = new Date(dateString);
        return date.toLocaleString();
    }

    const getRoleStyle = (behavior) => {
        switch (behavior?.toLowerCase()) {
            case 'student':
                return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'employee':
                return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'visitor':
                return 'bg-orange-100 text-orange-700 border-orange-200';
            default:
                return 'bg-slate-100 text-slate-700 border-slate-200';
        }
    };

    const EVENT_EXPORT_COLUMNS = useMemo(() => ([
        { id: 'timestamp', label: 'Timestamp', value: (log) => formatDate(log.scanned_at) },
        { id: 'idNumber', label: 'ID Number', value: (log) => log.id_number || 'N/A' },
        { id: 'name', label: 'Name', value: (log) => log.person_name || 'N/A' },
        { id: 'department', label: 'Department', value: (log) => log.department_name || 'N/A' },
        { id: 'program', label: 'Program', value: (log) => log.program_name || 'N/A' },
        { id: 'yearLevel', label: 'Year Level', value: (log) => log.year_level ? `Year ${log.year_level}` : 'N/A' },
        { id: 'role', label: 'Role', value: (log) => (log.roles || []).join(', ') || 'N/A' },
        { id: 'subRole', label: 'Sub Role', value: (log) => log.position_title || (log.roles || []).filter(r => !['student', 'visitor'].includes(String(r).toLowerCase())).join(', ') || 'N/A' },
        { id: 'status', label: 'Status', value: (log) => log.status || 'On Time' },
        { id: 'eventName', label: 'Event', value: (log) => log.event_name || 'N/A' },
        { id: 'signature', label: 'Signature', value: () => '' },
    ]), []);

    const [activeTab, setActiveTab] = useState('gateLogs'); // 'gateLogs' | 'eventLogs'

    // Gate Logs state
    const [logs, setLogs] = useState([]);

    // Event Logs state
    const [eventLogs, setEventLogs] = useState([]);

    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState('All');
    const [actionFilter, setActionFilter] = useState('All');

    // Date Filtering State
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Academic Filtering State (For Event Attendance)
    const [departments, setDepartments] = useState([]);
    const [allPrograms, setAllPrograms] = useState([]);
    const [allRoles, setAllRoles] = useState([]);
    const [departmentFilter, setDepartmentFilter] = useState('All');
    const [programFilter, setProgramFilter] = useState('All');
    const [yearFilter, setYearFilter] = useState('All');
    const [eventFilter, setEventFilter] = useState('All');

    // Pagination
    const ITEMS_PER_PAGE = 15;
    const [currentPage, setCurrentPage] = useState(1);

    // Export State & UX
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showManualExportModal, setShowManualExportModal] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [manualSelectedColumns, setManualSelectedColumns] = useState(['timestamp', 'name', 'department', 'status']);
    const [manualSelectedRoles, setManualSelectedRoles] = useState([]);
    const [manualSelectedDepartments, setManualSelectedDepartments] = useState([]);
    const [manualSelectedPrograms, setManualSelectedPrograms] = useState([]);
    const [manualSelectedYears, setManualSelectedYears] = useState([]);
    const [manualReportTitle, setManualReportTitle] = useState('');
    const [manualIncludeNumbering, setManualIncludeNumbering] = useState(true);
    const [manualIncludeAbsent, setManualIncludeAbsent] = useState(false);
    const [manualIncludeStats, setManualIncludeStats] = useState(false);
    const [manualIncludePartTime, setManualIncludePartTime] = useState(false);
    const [manualExportAsTemplate, setManualExportAsTemplate] = useState(false);
    const [showTemplateBuilder, setShowTemplateBuilder] = useState(false);
    const [templateRows, setTemplateRows] = useState(() => Array.from({ length: 5 }, () => ({})));
    const [templateExtraColumns, setTemplateExtraColumns] = useState([]);
    const [editingCell, setEditingCell] = useState(null);
    const [templatePersons, setTemplatePersons] = useState([]);
    const [templateDarkMode, setTemplateDarkMode] = useState(true);
    const exportMenuRef = useRef(null);
    const { showSuccess, showError, showWarning, showProcessing } = useToast();

    // Fetch persons for template autocomplete when builder opens
    useEffect(() => {
        if (!showTemplateBuilder || templatePersons.length > 0) return;
        const fetchPersons = async () => {
            try {
                const persons = await invoke('get_persons');
                const names = persons
                    .filter(p => !p.id_number.startsWith('VIS-') && p.is_active)
                    .map(p => {
                        const rest = [p.first_name, p.middle_name, p.suffix].filter(Boolean).join(' ');
                        return `${p.last_name}, ${rest}`;
                    });
                setTemplatePersons([...new Set(names)]);
            } catch (err) {
                console.error("Failed to fetch persons for template autocomplete:", err);
            }
        };
        fetchPersons();
    }, [showTemplateBuilder]);

    const getSuggestionsForColumn = useCallback((colId, inputValue) => {
        if (!inputValue || inputValue.length < 1) return [];
        const lower = inputValue.toLowerCase();
        let pool = [];
        switch (colId) {
            case 'name':
                pool = templatePersons;
                break;
            case 'department':
                pool = departments.map(d => d.department_name);
                break;
            case 'program':
                pool = allPrograms.map(p => p.program_name);
                break;
            case 'role':
            case 'subRole':
                pool = allRoles.map(r => r.role_name);
                break;
            case 'yearLevel':
                pool = ['Year 1', 'Year 2', 'Year 3', 'Year 4'];
                break;
            case 'idNumber':
                pool = templatePersons.length > 0 ? [] : []; // ID numbers not easily autocompleted
                break;
            default:
                return [];
        }
        return pool.filter(item => item.toLowerCase().includes(lower)).slice(0, 8);
    }, [templatePersons, departments, allPrograms, allRoles]);

    const handleCellNavigation = (rowIdx, colId, e) => {
        const visiblePredefined = EVENT_EXPORT_COLUMNS.filter(col => manualSelectedColumns.includes(col.id)).map(col => col.id);
        const extraColKeys = templateExtraColumns.map((_, idx) => `extra_${idx}`);
        const allColKeys = [...visiblePredefined, ...extraColKeys];
        
        if (allColKeys.length === 0) return;
        
        const colIdx = allColKeys.indexOf(colId);
        if (colIdx === -1) return;
        
        let newRow = rowIdx;
        let newColIdx = colIdx;
        
        if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                newColIdx = colIdx - 1;
                if (newColIdx < 0) {
                    newColIdx = allColKeys.length - 1;
                    newRow = rowIdx - 1;
                }
            } else {
                newColIdx = colIdx + 1;
                if (newColIdx >= allColKeys.length) {
                    newColIdx = 0;
                    newRow = rowIdx + 1;
                }
            }
        } else if (e.key === 'ArrowRight') {
            const cursorPosition = e.target.selectionStart;
            if (cursorPosition !== e.target.value.length) return;
            newColIdx = colIdx + 1;
            if (newColIdx >= allColKeys.length) {
                newColIdx = 0;
                newRow = rowIdx + 1;
            }
        } else if (e.key === 'ArrowLeft') {
            const cursorPosition = e.target.selectionStart;
            if (cursorPosition !== 0) return;
            newColIdx = colIdx - 1;
            if (newColIdx < 0) {
                newColIdx = allColKeys.length - 1;
                newRow = rowIdx - 1;
            }
        } else if (e.key === 'ArrowUp') {
            newRow = rowIdx - 1;
        } else if (e.key === 'ArrowDown') {
            newRow = rowIdx + 1;
        } else {
            return;
        }
        
        if (newRow >= 0 && newRow < templateRows.length) {
            const nextColId = allColKeys[newColIdx];
            setEditingCell({ type: 'cell', row: newRow, col: nextColId });
        }
    };

    // Fetch academic structure for filters
    useEffect(() => {
        const loadAcademicData = async () => {
            try {
                const [depts, progs, roles] = await Promise.all([
                    invoke('get_departments'),
                    invoke('get_programs'),
                    invoke('get_roles')
                ]);
                setDepartments(depts || []);
                setAllPrograms(progs || []);
                setAllRoles(roles || []);
            } catch (err) {
                console.error("Failed to load academic data:", err);
            }
        };
        loadAcademicData();
    }, []);

    // Close export menu when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
                setShowExportMenu(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Fetch logs from backend based on active tab
    const fetchLogs = async () => {
        if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
            showWarning('Invalid Date Range: End Date must be after Start Date.');
            return;
        }
        setLoading(true);
        try {
            if (activeTab === 'gateLogs') {
                const data = await invoke('get_access_logs', {
                    roleFilter: roleFilter === 'All' ? null : roleFilter,
                    actionType: actionFilter === 'All' ? null : actionFilter.toLowerCase(),
                    departmentId: departmentFilter === 'All' ? null : parseInt(departmentFilter),
                    searchTerm: searchTerm.trim() === '' ? null : searchTerm.trim(),
                    startDate: startDate || null,
                    endDate: endDate || null
                });
                setLogs(data);
            } else {
                const data = await invoke('get_event_attendance_logs', {
                    startDate: startDate || null,
                    endDate: endDate || null,
                    departmentId: departmentFilter === 'All' ? null : parseInt(departmentFilter),
                    programId: programFilter === 'All' ? null : parseInt(programFilter),
                    yearLevel: yearFilter === 'All' ? null : parseInt(yearFilter)
                });
                setEventLogs(data);
            }
        } catch (error) {
            console.error("Failed to fetch logs:", error);
        } finally {
            setLoading(false);
        }
    };

    const clearFilters = async () => {
        setSearchTerm('');
        setRoleFilter('All');
        setActionFilter('All');
        setStartDate('');
        setEndDate('');
        setDepartmentFilter('All');
        setProgramFilter('All');
        setYearFilter('All');
        setEventFilter('All');
    };

    useEffect(() => {
        fetchLogs();
    }, [activeTab, searchTerm, roleFilter, actionFilter, startDate, endDate, departmentFilter, programFilter, yearFilter]);

    // Filter logic based on active tab
    const currentData = activeTab === 'gateLogs' ? logs : eventLogs;

    // Gate logs are already filtered on backend. Event logs still rely on simple frontend filters for now.
    const filteredLogs = activeTab === 'gateLogs' ? currentData : currentData.filter(log => {
        const roleStr = log.roles?.join(', ') || '';
        const matchesSearch =
            log.person_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.id_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.event_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (log.department_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (log.program_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            roleStr.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesRole = roleFilter === 'All' || log.roles?.some(r => r.toLowerCase() === roleFilter.toLowerCase());
        const matchesEvent = eventFilter === 'All' || log.event_name === eventFilter;
        return matchesSearch && matchesRole && matchesEvent;
    });

    // Extract unique events for the filter
    const uniqueEvents = useMemo(() => {
        if (!eventLogs || eventLogs.length === 0) return [];
        const events = [...new Set(eventLogs.map(log => log.event_name).filter(Boolean))];
        return events.sort();
    }, [eventLogs]);

    const manualHasStudentBehavior = useMemo(() => {
        if (manualSelectedRoles.length === 0) return false;
        return allRoles.some(r => 
            manualSelectedRoles.includes(r.role_name.toLowerCase()) && 
            (r.role_behavior === 'student' || r.role_name.toLowerCase() === 'student')
        );
    }, [manualSelectedRoles, allRoles]);

    const manualHasEmployeeBehavior = useMemo(() => {
        if (manualSelectedRoles.length === 0) return false;
        return allRoles.some(r => 
            manualSelectedRoles.includes(r.role_name.toLowerCase()) && 
            (r.role_behavior === 'employee' || r.role_name.toLowerCase() === 'employee')
        );
    }, [manualSelectedRoles, allRoles]);

    const manualAvailablePrograms = useMemo(() => {
        if (manualSelectedDepartments.length === 0) {
            return [...new Set(allPrograms.map(p => p.program_name).filter(Boolean))].sort();
        }
        const selectedDeptIds = departments
            .filter(d => manualSelectedDepartments.includes(d.department_name))
            .map(d => d.department_id);
        return [...new Set(allPrograms
            .filter(p => selectedDeptIds.includes(p.department_id))
            .map(p => p.program_name)
            .filter(Boolean))].sort();
    }, [manualSelectedDepartments, departments, allPrograms]);

    useEffect(() => {
        if (manualSelectedPrograms.length === 0) return;
        setManualSelectedPrograms(prev => prev.filter(p => manualAvailablePrograms.includes(p)));
    }, [manualAvailablePrograms]);

    const exportRoleAwareOptions = useMemo(() => {
        const mainRoles = allRoles.filter(r => r.is_main_role || ['student', 'employee', 'visitor'].includes(r.role_name.toLowerCase()));
        const subRoles = allRoles.filter(r => !mainRoles.some(mr => mr.role_id === r.role_id));

        const deptNames = [...new Set(departments.map(d => d.department_name).filter(Boolean))].sort();
        const progNames = [...new Set(allPrograms.map(p => p.program_name).filter(Boolean))].sort();

        return {
            departments: deptNames,
            programs: progNames,
            yearLevels: [1, 2, 3, 4],
            mainRoles,
            subRoles,
            visitorStatuses: ['On Time', 'Late', 'Excused'],
        };
    }, [departments, allPrograms, allRoles]);

    useEffect(() => {
        if (!showManualExportModal || activeTab !== 'eventLogs') return;
        setManualReportTitle(generateEventAttendanceTitle(filteredLogs));
    }, [showManualExportModal, activeTab, filteredLogs]);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(MANUAL_EXPORT_PREFS_KEY);
            if (!raw) return;
            const prefs = JSON.parse(raw);
            if (Array.isArray(prefs.columns) && prefs.columns.length) {
                setManualSelectedColumns(prefs.columns);
            }
            if (Array.isArray(prefs.selectedRoles)) {
                setManualSelectedRoles(prefs.selectedRoles);
            }
            if (Array.isArray(prefs.manualSelectedDepartments)) setManualSelectedDepartments(prefs.manualSelectedDepartments);
            if (Array.isArray(prefs.manualSelectedPrograms)) setManualSelectedPrograms(prefs.manualSelectedPrograms);
            if (Array.isArray(prefs.manualSelectedYears)) setManualSelectedYears(prefs.manualSelectedYears);
            if (typeof prefs.reportTitle === 'string') setManualReportTitle(prefs.reportTitle);
            if (typeof prefs.includeNumbering === 'boolean') setManualIncludeNumbering(prefs.includeNumbering);
            if (typeof prefs.includeAbsent === 'boolean') setManualIncludeAbsent(prefs.includeAbsent);
            if (typeof prefs.includeStats === 'boolean') setManualIncludeStats(prefs.includeStats);
            if (typeof prefs.includePartTime === 'boolean') setManualIncludePartTime(prefs.includePartTime);
        } catch (error) {
            console.warn('Failed to load manual export preferences', error);
        }
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem(
                MANUAL_EXPORT_PREFS_KEY,
                JSON.stringify({
                    columns: manualSelectedColumns,
                    selectedRoles: manualSelectedRoles,
                    manualSelectedDepartments: manualSelectedDepartments,
                    manualSelectedPrograms: manualSelectedPrograms,
                    manualSelectedYears: manualSelectedYears,
                    reportTitle: manualReportTitle,
                    includeNumbering: manualIncludeNumbering,
                    includeAbsent: manualIncludeAbsent,
                    includeStats: manualIncludeStats,
                    includePartTime: manualIncludePartTime,
                })
            );
        } catch (error) {
            console.warn('Failed to save manual export preferences', error);
        }
    }, [
        manualSelectedColumns,
        manualSelectedRoles,
        manualSelectedDepartments,
        manualSelectedPrograms,
        manualSelectedYears,
        manualReportTitle,
    ]);

    // Sorting
    const { sortConfig, requestSort, sortedData: sortedLogs } = useTableSort(filteredLogs, 'scanned_at', 'desc', 'access_logs');

    // Pagination - reset to page 1 when filters change
    useEffect(() => { setCurrentPage(1); }, [searchTerm, roleFilter, actionFilter, startDate, endDate, departmentFilter, programFilter, yearFilter, eventFilter, activeTab, sortConfig]);

    // Filter programs based on selected department
    const filteredPrograms = useMemo(() => {
        if (departmentFilter === 'All') return [];
        return allPrograms.filter(p => p.department_id === parseInt(departmentFilter));
    }, [departmentFilter, allPrograms]);

    const totalPages = Math.ceil(sortedLogs.length / ITEMS_PER_PAGE);
    const paginatedLogs = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return sortedLogs.slice(start, start + ITEMS_PER_PAGE);
    }, [sortedLogs, currentPage]);
    const showPagination = sortedLogs.length > ITEMS_PER_PAGE;

    function generateEventAttendanceTitle(logs) {
        if (!logs || logs.length === 0) return "Event Attendance Report";
        const events = [...new Set(logs.map(log => log.event_name).filter(Boolean))];
        if (events.length === 1) return `${events[0]} Attendance Report`;
        if (events.length > 1) return `Multi-Event Attendance Report (${events.length} Events)`;
        return "Event Attendance Report";
    }

    function getRoleType(log) {
        const lowerRoles = (log.roles || []).map(r => String(r).toLowerCase());
        if (lowerRoles.includes('visitor')) return 'visitor';
        if (lowerRoles.includes('student')) return 'student';
        if (lowerRoles.some(r => r === 'professor' || r === 'staff' || r === 'employee')) return 'employee';
        return 'other';
    }

    function generateEventAttendanceTitle(logsToTitle) {
        const events = [...new Set((logsToTitle || []).map(log => log.event_name).filter(Boolean))];
        if (events.length === 1) return `${events[0]} Attendance Report`;
        if (events.length === 2) return `${events[0]} and ${events[1]} Attendance Report`;
        if (events.length > 2) return `${events[0]} and ${events.length - 1} More Attendance Report`;
        return 'Event Attendance Report';
    }

    const getStatistics = (logsToProcess, activeTab) => {
        const stats = {
            totalRows: logsToProcess.length,
            uniqueIndividuals: new Set(logsToProcess.map(log => log.id_number || log.person_name)).size,
            startDate: logsToProcess.length ? new Date(Math.min(...logsToProcess.map(l => new Date(l.scanned_at)))).toLocaleString() : 'N/A',
            endDate: logsToProcess.length ? new Date(Math.max(...logsToProcess.map(l => new Date(l.scanned_at)))).toLocaleString() : 'N/A',
            roleStudent: 0,
            roleProfessor: 0,
            roleStaff: 0,
            roleVisitor: 0,
            totalEntrance: 0,
            totalExit: 0,
            entranceAM: 0,
            entrancePM: 0,
            exitAM: 0,
            exitPM: 0,
            hourlyActivity: {}, // hour (0-23) -> count
            dailyActivity: {}, // Date string -> count
            departmentActivity: {}, // department_name -> count
        };

        logsToProcess.forEach(log => {
            const roles = log.roles?.join(', ') || '';
            const role = roles.toLowerCase();
            if (role.includes('student')) stats.roleStudent++;
            else if (role.includes('professor')) stats.roleProfessor++;
            else if (role.includes('staff')) stats.roleStaff++;
            else if (role.includes('visitor')) stats.roleVisitor++;

            const dateObj = new Date(log.scanned_at);
            const hour = dateObj.getHours();
            const dateStr = dateObj.toLocaleDateString();

            if (activeTab === 'gateLogs') {
                const action = (log.scanner_function || '').toLowerCase();
                if (action === 'entrance') {
                    stats.totalEntrance++;
                    if (hour < 12) stats.entranceAM++;
                    else stats.entrancePM++;
                } else if (action === 'exit') {
                    stats.totalExit++;
                    if (hour < 12) stats.exitAM++;
                    else stats.exitPM++;
                }
            } else {
                if (hour < 12) stats.entranceAM++;
                else stats.entrancePM++;
            }

            stats.hourlyActivity[hour] = (stats.hourlyActivity[hour] || 0) + 1;
            stats.dailyActivity[dateStr] = (stats.dailyActivity[dateStr] || 0) + 1;

            const dept = log.department_name && log.department_name !== 'N/A' && log.department_name !== '-' ? log.department_name : 'No Department';
            stats.departmentActivity[dept] = (stats.departmentActivity[dept] || 0) + 1;
        });

        let busiestHour = -1;
        let maxHourCount = -1;
        for (const [h, count] of Object.entries(stats.hourlyActivity)) {
            if (count > maxHourCount) {
                maxHourCount = count;
                busiestHour = parseInt(h);
            }
        }
        stats.busiestHourLabel = busiestHour === -1 ? 'None' : `${busiestHour % 12 || 12}:00 ${busiestHour < 12 ? 'AM' : 'PM'} - ${(busiestHour + 1) % 12 || 12}:00 ${busiestHour + 1 < 12 ? 'AM' : 'PM'} (${maxHourCount} logs)`;

        let busiestDay = 'None';
        let maxDayCount = -1;
        for (const [d, count] of Object.entries(stats.dailyActivity)) {
            if (count > maxDayCount) {
                maxDayCount = count;
                busiestDay = d;
            }
        }
        stats.busiestDayLabel = maxDayCount === -1 ? 'None' : `${busiestDay} (${maxDayCount} logs)`;

        let busiestDept = 'None';
        let maxDeptCount = -1;
        for (const [dept, count] of Object.entries(stats.departmentActivity)) {
            if (dept !== 'No Department' && count > maxDeptCount) {
                maxDeptCount = count;
                busiestDept = dept;
            }
        }
        stats.busiestDeptLabel = maxDeptCount === -1 ? 'None' : `${busiestDept} (${maxDeptCount} logs)`;

        return stats;
    };

    const handleExportExcel = async () => {
        if (filteredLogs.length === 0) return;
        setIsExporting(true);
        setShowExportMenu(false);
        showProcessing("Preparing Excel export...");

        try {
            const uniName = (branding && branding.system_name) ? branding.system_name : "Pamantasan ng Lungsod ng Pasig";
            const sysName = activeTab === 'gateLogs' ? "Smart Gate - General Gate Logs" : "Smart Gate - Event Attendance";

            let dateRangeStr = "All Time";
            if (startDate && endDate) dateRangeStr = `${startDate} To ${endDate}`;
            else if (startDate) dateRangeStr = `From ${startDate}`;
            else if (endDate) dateRangeStr = `Up to ${endDate}`;
            const generatedDate = new Date().toLocaleString();

            // 1. Sheet: Statistics
            const stats = getStatistics(filteredLogs, activeTab);
            const statsWsData = [];
            statsWsData.push([uniName]);
            statsWsData.push([sysName]);
            statsWsData.push([`Reporting Period: ${dateRangeStr}`]);
            statsWsData.push([`Document generated on: ${generatedDate}`]);
            statsWsData.push([]);
            statsWsData.push(['--- REPORT STATISTICS ---']);
            statsWsData.push([]);
            statsWsData.push(['Overall Summary Statistics:']);
            statsWsData.push(['Total Rows Exported', stats.totalRows]);
            statsWsData.push(['Total Unique Individuals', stats.uniqueIndividuals]);
            statsWsData.push(['Reporting Start Date/Time', stats.startDate]);
            statsWsData.push(['Reporting End Date/Time', stats.endDate]);
            statsWsData.push([]);
            statsWsData.push(['Breakdown by Role:']);
            statsWsData.push(['Total Student Logs', stats.roleStudent]);
            statsWsData.push(['Total Professor Logs', stats.roleProfessor]);
            statsWsData.push(['Total Staff Logs', stats.roleStaff]);
            statsWsData.push(['Total Visitor Logs', stats.roleVisitor]);
            if (activeTab === 'gateLogs') {
                statsWsData.push(['Total Entrance Logs', stats.totalEntrance]);
                statsWsData.push(['Total Exit Logs', stats.totalExit]);
            }
            statsWsData.push([]);
            statsWsData.push(['Time-Based Statistics:']);
            if (activeTab === 'gateLogs') {
                statsWsData.push(['Total Entrance in AM', stats.entranceAM]);
                statsWsData.push(['Total Entrance in PM', stats.entrancePM]);
                statsWsData.push(['Total Exit in AM', stats.exitAM]);
                statsWsData.push(['Total Exit in PM', stats.exitPM]);
            } else {
                statsWsData.push(['Total Logs in AM', stats.entranceAM]);
                statsWsData.push(['Total Logs in PM', stats.entrancePM]);
            }
            statsWsData.push(['Busiest Hour', stats.busiestHourLabel]);
            statsWsData.push(['Most Active Day', stats.busiestDayLabel]);
            statsWsData.push([]);
            statsWsData.push(['Department-Based Statistics:']);
            statsWsData.push(['Most Active Department', stats.busiestDeptLabel]);
            statsWsData.push(['Total Logs per Department:']);
            for (const [dept, count] of Object.entries(stats.departmentActivity)) {
                if (dept !== 'No Department') {
                    statsWsData.push([` - ${dept}`, count]);
                }
            }

            const statsWs = XLSX.utils.aoa_to_sheet(statsWsData);

            // 2. Sheet: Access Logs
            const wsData = [];
            wsData.push([uniName]);
            wsData.push([sysName]);
            wsData.push([`Reporting Period: ${dateRangeStr}`]);
            wsData.push([`Document generated on: ${generatedDate}`]);
            wsData.push([]);

            if (activeTab === 'gateLogs') {
                wsData.push(['Timestamp', 'Name', 'ID Number', 'Role', 'Department', 'Action']);
            } else {
                wsData.push(['Timestamp', 'Name', 'ID Number', 'Role', 'Event Name', 'Status']);
            }

            filteredLogs.forEach(log => {
                if (activeTab === 'gateLogs') {
                    wsData.push([
                        formatDate(log.scanned_at),
                        log.person_name,
                        log.id_number,
                        log.roles?.join(', ') || 'N/A',
                        log.department_name,
                        log.scanner_function.toUpperCase()
                    ]);
                } else {
                    wsData.push([
                        formatDate(log.scanned_at),
                        log.person_name,
                        log.id_number,
                        log.roles?.join(', ') || 'N/A',
                        log.event_name,
                        log.status || 'On Time'
                    ]);
                }
            });

            const ws = XLSX.utils.aoa_to_sheet(wsData);

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, statsWs, "Statistics");
            XLSX.utils.book_append_sheet(wb, ws, "Access Logs");

            // Formatted dynamic filename
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            const formattedTime = `${String(hours).padStart(2, '0')}.${minutes}${ampm}`;
            const logType = activeTab === 'gateLogs' ? 'General Logs' : 'Event Attendance';
            let filename = `AccessLogs_${logType}_${yyyy}-${mm}-${dd}_${formattedTime}`;

            // Native Save Dialog for Excel
            const filePath = await save({
                defaultPath: `${filename}.xlsx`,
                filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
            });

            if (!filePath) {
                showWarning("Export cancelled.");
                return;
            }

            // Write via xlsx to buffer, then to Tauri fs
            const excelBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
            await writeFile(filePath, new Uint8Array(excelBuffer));

            await invoke('log_frontend_action', {
                adminId: adminSession?.account_id,
                actionType: 'EXPORT',
                entityType: activeTab === 'gateLogs' ? 'Entry Logs' : 'Event Attendance',
                entityId: null,
                entityLabel: `Excel Export (${filteredLogs.length} records)`,
                oldValues: null,
                newValues: JSON.stringify({ format: 'Excel', filename, record_count: filteredLogs.length })
            }).catch(e => console.error("Audit log failed for export", e));

            showSuccess(`Success: Report saved to ${filePath}`);
        } catch (error) {
            console.error("Excel export failed", error);
            showError("An error occurred during export.");
        } finally {
            setIsExporting(false);
        }
    };

    const applyManualEventExportFilters = (sourceLogs) => {
        return sourceLogs.filter((log) => {
            const logRoles = (log.roles || []).map(r => String(r).toLowerCase());
            const selectedLower = manualSelectedRoles.map(r => r.toLowerCase());
            
            // If no roles selected, include all. If selected, check for intersection.
            if (manualSelectedRoles.length > 0) {
                const hasMatch = selectedLower.some(r => logRoles.includes(r));
                if (!hasMatch) return false;
            }

            if (manualSelectedDepartments.length > 0 && !manualSelectedDepartments.includes(log.department_name || 'N/A')) return false;
            
            // Program/Year filter for any student role
            if (selectedLower.includes('student') || manualSelectedRoles.length === 0) {
                if (manualSelectedPrograms.length > 0 && !manualSelectedPrograms.includes(log.program_name || 'N/A')) return false;
                if (manualSelectedYears.length > 0 && !manualSelectedYears.map(String).includes(String(log.year_level || ''))) return false;
            }
            
            if (!manualIncludePartTime && log.is_part_time) return false;

            return true;
        });
    };

    const handleQuickExportPDF = async () => {
        const defaultColumns = ['timestamp', 'name', 'idNumber', 'status', 'department', 'role', 'eventName'];
        const defaultTitle = generateEventAttendanceTitle(filteredLogs);
        await handleExportPDF({
            logsForExport: filteredLogs,
            selectedColumnIds: defaultColumns,
            reportTitleOverride: defaultTitle,
            includeStatsPage: true,
            entityLabelPrefix: 'Quick PDF Export',
        });
    };

    const handleManualExportPDF = async () => {
        let selectedLogs = [...applyManualEventExportFilters(filteredLogs)];
        
        if (manualIncludeAbsent) {
            try {
                setIsExporting(true);
                showProcessing("Fetching master list for absent people...");
                const [students, employees] = await Promise.all([
                    invoke('get_students'),
                    invoke('get_employees')
                ]);

                // Filter master list by selected filters
                const selectedLowerRoles = manualSelectedRoles.map(r => r.toLowerCase());
                const masterList = [];

                if (selectedLowerRoles.length === 0 || selectedLowerRoles.includes('student')) {
                    students.forEach(s => {
                        if (manualSelectedDepartments.length > 0 && !manualSelectedDepartments.includes(s.department_name || 'N/A')) return;
                        if (manualSelectedPrograms.length > 0 && !manualSelectedPrograms.includes(s.program_name || 'N/A')) return;
                        if (manualSelectedYears.length > 0 && !manualSelectedYears.map(String).includes(String(s.year_level || ''))) return;
                        
                        const middleInitial = s.middle_name ? s.middle_name.trim().charAt(0) + '.' : '';
                        const formattedName = `${s.last_name}, ${s.first_name}${middleInitial ? ' ' + middleInitial : ''}${s.suffix ? ' ' + s.suffix : ''}`;
                        
                        masterList.push({
                            person_name: formattedName,
                            id_number: s.id_number,
                            roles: s.roles,
                            department_name: s.department_name,
                            program_name: s.program_name,
                            year_level: s.year_level,
                            position_title: null,
                        });
                    });
                }

                if (selectedLowerRoles.length === 0 || selectedLowerRoles.some(r => !['student', 'visitor'].includes(r))) {
                    employees.forEach(e => {
                        if (manualSelectedDepartments.length > 0 && !manualSelectedDepartments.includes(e.department_name || 'N/A')) return;
                        if (selectedLowerRoles.length > 0) {
                             const hasMatch = selectedLowerRoles.some(r => (e.roles || []).some(er => er.toLowerCase() === r));
                             if (!hasMatch) return;
                        }
                        
                        if (!manualIncludePartTime && e.is_part_time) return;

                        const middleInitial = e.middle_name ? e.middle_name.trim().charAt(0) + '.' : '';
                        const formattedName = `${e.last_name}, ${e.first_name}${middleInitial ? ' ' + middleInitial : ''}${e.suffix ? ' ' + e.suffix : ''}`;

                        masterList.push({
                            person_name: formattedName,
                            id_number: e.id_number,
                            roles: e.roles,
                            department_name: e.department_name,
                            program_name: null,
                            year_level: null,
                            position_title: e.position_title,
                            is_part_time: e.is_part_time,
                        });
                    });
                }

                // Identify who attended
                const attendedIds = new Set(selectedLogs.map(l => l.id_number));
                
                // Determine event name for absent entries
                const eventName = eventFilter !== 'All' ? eventFilter : (selectedLogs[0]?.event_name || 'N/A');

                // Add absent people
                masterList.forEach(p => {
                    if (!attendedIds.has(p.id_number)) {
                        selectedLogs.push({
                            ...p,
                            scanned_at: null,
                            status: 'Absent',
                            event_name: eventName,
                            scanner_location: 'N/A',
                            scanner_function: 'N/A',
                            log_id: -1
                        });
                    }
                });
                
                // Sort them alphabetically by name
                selectedLogs.sort((a, b) => a.person_name.localeCompare(b.person_name));

            } catch (err) {
                console.error("Failed to fetch master list for absent people", err);
                showError("Failed to include absent people.");
            } finally {
                setIsExporting(false);
            }
        }

        const totalColumns = manualSelectedColumns.length + (manualExportAsTemplate ? templateExtraColumns.length : 0);
        if (!totalColumns) {
            showWarning('Select at least one column to export.');
            return;
        }
        await handleExportPDF({
            logsForExport: manualExportAsTemplate ? [] : selectedLogs,
            selectedColumnIds: manualSelectedColumns,
            reportTitleOverride: manualReportTitle.trim() || generateEventAttendanceTitle(selectedLogs),
            includeStatsPage: manualExportAsTemplate ? false : manualIncludeStats,
            entityLabelPrefix: manualExportAsTemplate ? 'Template PDF Export' : 'Manual PDF Export',
            includeNumbering: manualIncludeNumbering,
            isTemplateMode: manualExportAsTemplate,
            templateData: manualExportAsTemplate ? { rows: templateRows, extraColumns: templateExtraColumns } : null,
        });
    };

    const handleExportPDF = async ({
        logsForExport = filteredLogs,
        selectedColumnIds = [],
        reportTitleOverride = '',
        includeStatsPage = true,
        entityLabelPrefix = 'PDF Export',
        includeNumbering = false,
        isTemplateMode = false,
        templateData = null,
    } = {}) => {
        if (!isTemplateMode && logsForExport.length === 0) {
            showWarning('No records match the selected export criteria.');
            return;
        }
        setIsExporting(true);
        setShowExportMenu(false);
        setShowManualExportModal(false);
        setShowTemplateBuilder(false);
        showProcessing(isTemplateMode ? "Preparing template export..." : "Preparing PDF export...");

        try {
            const doc = new jsPDF();
            const headerAssets = await prepareInstitutionalHeaderAssets(branding);

            // Store metadata string upfront
            let dateRangeStr = "All Time";
            if (startDate && endDate) dateRangeStr = `${startDate} To ${endDate}`;
            else if (startDate) dateRangeStr = `From ${startDate}`;
            else if (endDate) dateRangeStr = `Up to ${endDate}`;

            const generatedDate = new Date().toLocaleString();

            const reportTitle = reportTitleOverride || (activeTab === 'gateLogs' ? 'Access Logs Report' : generateEventAttendanceTitle(logsForExport));
            const drawHeader = () => {
                const layout = drawInstitutionalHeader(doc, {
                    branding,
                    logos: headerAssets.logos,
                    contactIcons: headerAssets.contactIcons,
                    reportTitle,
                    officeName: 'Office of Campus Security',
                    showSystemTitle: activeTab === 'gateLogs',
                });
                layout.setBodyFont?.();
                doc.setFontSize(8.5);
                doc.setTextColor(90, 90, 90);
                doc.text(`Reporting Period: ${dateRangeStr}`, layout.margin, layout.contentStartY - 1.5);
                doc.text(`Generated: ${generatedDate}`, doc.internal.pageSize.getWidth() - layout.margin, layout.contentStartY - 1.5, { align: "right" });
                return layout;
            };
            const headerLayout = drawHeader();

            // Remove the initial manual `drawHeader()`. autoTable will call it inside `didDrawPage` for all pages.

            // Table Data
            const selectedColumns = activeTab === 'gateLogs'
                ? [
                    { id: 'timestamp', label: 'Timestamp', value: (log) => formatDate(log.scanned_at) },
                    { id: 'name', label: 'Name', value: (log) => log.person_name },
                    { id: 'idNumber', label: 'ID Number', value: (log) => log.id_number },
                    { id: 'role', label: 'Role', value: (log) => log.roles?.join(', ') || 'N/A' },
                    { id: 'department', label: 'Department', value: (log) => log.department_name },
                    { id: 'action', label: 'Action', value: (log) => log.scanner_function?.toUpperCase() || 'N/A' },
                ]
                : EVENT_EXPORT_COLUMNS.filter(col => selectedColumnIds.includes(col.id));
            
            let tableColumn = selectedColumns.map(col => col.label);
            if (isTemplateMode && templateData?.extraColumns?.length) {
                tableColumn = [...tableColumn, ...templateData.extraColumns];
            }
            if (includeNumbering) {
                tableColumn = ['#', ...tableColumn];
            }

            const tableRows = [];

            if (isTemplateMode) {
                const rows = templateData?.rows || Array.from({ length: 20 }, () => ({}));
                rows.forEach((rowData, index) => {
                    const totalCols = tableColumn.length - (includeNumbering ? 1 : 0);
                    const row = [];
                    for (let i = 0; i < totalCols; i++) {
                        const colKey = i < selectedColumns.length ? selectedColumns[i].id : `extra_${i - selectedColumns.length}`;
                        row.push(rowData[colKey] || '');
                    }
                    if (includeNumbering) {
                        tableRows.push([(index + 1).toString(), ...row]);
                    } else {
                        tableRows.push(row);
                    }
                });
            } else {
                logsForExport.forEach((log, index) => {
                    let row = [];
                    if (activeTab === 'gateLogs') {
                        row = [
                            formatDate(log.scanned_at),
                            log.person_name,
                            log.id_number,
                            log.roles?.join(', ') || 'N/A',
                            log.department_name,
                            log.scanner_function.toUpperCase()
                        ];
                    } else {
                        row = selectedColumns.map(col => col.value(log));
                    }

                    if (includeNumbering) {
                        tableRows.push([(index + 1).toString(), ...row]);
                    } else {
                        tableRows.push(row);
                    }
                });
            }

            // --- STEP 1: Generate Statistics on the first page ---
            const stats = getStatistics(logsForExport, activeTab);
            const statsData = [];

            statsData.push([{ content: 'Overview Statistics', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42] } }]);
            statsData.push(['Total Rows Exported', stats.totalRows]);
            statsData.push(['Total Unique Individuals', stats.uniqueIndividuals]);
            statsData.push(['Reporting Start Date/Time', stats.startDate]);
            statsData.push(['Reporting End Date/Time', stats.endDate]);

            statsData.push([{ content: 'Breakdown by Role', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42] } }]);
            statsData.push(['Total Student Logs', stats.roleStudent]);
            statsData.push(['Total Professor Logs', stats.roleProfessor]);
            statsData.push(['Total Staff Logs', stats.roleStaff]);
            statsData.push(['Total Visitor Logs', stats.roleVisitor]);
            if (activeTab === 'gateLogs') {
                statsData.push(['Total Entrance Logs', stats.totalEntrance]);
                statsData.push(['Total Exit Logs', stats.totalExit]);
            }

            statsData.push([{ content: 'Time-Based Statistics', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42] } }]);
            if (activeTab === 'gateLogs') {
                statsData.push(['Total Entrance in AM', stats.entranceAM]);
                statsData.push(['Total Entrance in PM', stats.entrancePM]);
                statsData.push(['Total Exit in AM', stats.exitAM]);
                statsData.push(['Total Exit in PM', stats.exitPM]);
            } else {
                statsData.push(['Total Logs in AM', stats.entranceAM]);
                statsData.push(['Total Logs in PM', stats.entrancePM]);
            }
            statsData.push(['Busiest Hour', stats.busiestHourLabel]);
            statsData.push(['Most Active Day', stats.busiestDayLabel]);

            statsData.push([{ content: 'Department-Based Statistics', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42] } }]);
            statsData.push(['Most Active Department', stats.busiestDeptLabel]);
            for (const [dept, count] of Object.entries(stats.departmentActivity)) {
                if (dept !== 'No Department') {
                    statsData.push([`Total Logs: ${dept}`, count]);
                }
            }

            if (includeStatsPage) {
                autoTable(doc, {
                    startY: headerLayout.contentStartY + 2,
                    head: [[{ content: 'REPORT STATISTICS', colSpan: 2, styles: { halign: 'center' } }]],
                    body: statsData,
                    theme: 'grid',
                    headStyles: { fillColor: '#1E293B', textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 10 },
                    bodyStyles: { fontSize: 10 },
                    columnStyles: {
                        0: { cellWidth: '50%', fontStyle: 'bold' },
                        1: { cellWidth: '50%' }
                    },
                    didDrawPage: function () {
                        drawHeader();
                    },
                    margin: { top: headerLayout.contentStartY + 2, left: headerLayout.margin, right: headerLayout.margin }
                });
                doc.addPage();
            }

            // --- STEP 3: Generate the main logs table ---
            autoTable(doc, {
                startY: headerLayout.contentStartY + 2,
                margin: { top: headerLayout.contentStartY + 2, left: headerLayout.margin, right: headerLayout.margin },
                head: [tableColumn],
                body: tableRows,
                theme: 'grid',
                headStyles: { fillColor: '#1E293B', textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 8.5 },
                bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
                styles: { 
                    cellPadding: 1.5, 
                    overflow: 'linebreak', 
                    lineColor: [203, 213, 225], 
                    lineWidth: 0.1,
                    valign: 'middle'
                },
                columnStyles: {
                    // Row Numbering (#)
                    0: includeNumbering ? { cellWidth: 8, halign: 'center' } : {},
                    // Adjust other column widths based on their headers
                    ...(() => {
                        const styles = {};
                        tableColumn.forEach((label, idx) => {
                            if (label === 'Timestamp') styles[idx] = { cellWidth: 32 };
                            if (label === 'ID Number') styles[idx] = { cellWidth: 22 };
                            if (label === 'Status') styles[idx] = { cellWidth: 18, halign: 'center', fontStyle: 'bold' };
                            if (label === 'Year Level') styles[idx] = { cellWidth: 18, halign: 'center' };
                            if (label === 'Role' || label === 'Sub Role') styles[idx] = { cellWidth: 25 };
                            if (label === 'Signature') styles[idx] = { cellWidth: 30 };
                        });
                        return styles;
                    })()
                },
                didParseCell: function(data) {
                    if (data.section === 'body') {
                        const colLabel = tableColumn[data.column.index];
                        if (colLabel === 'Status') {
                            const val = String(data.cell.raw || '').toLowerCase();
                            if (val.includes('late')) {
                                data.cell.styles.textColor = [249, 115, 22]; // Orange-500
                            } else if (val.includes('absent')) {
                                data.cell.styles.textColor = [225, 29, 72]; // Rose-600
                            } else if (val.includes('on time') || val.includes('present')) {
                                data.cell.styles.textColor = [5, 150, 105]; // Emerald-600
                            }
                        }
                    }
                },
                didDrawPage: function () {
                    drawHeader();
                }
            });

            // Formatted dynamic filename
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            const formattedTime = `${String(hours).padStart(2, '0')}.${minutes}${ampm}`;
            const logType = activeTab === 'gateLogs' ? 'General Logs' : 'Event Attendance';
            let filename = `AccessLogs_${logType}_${yyyy}-${mm}-${dd}_${formattedTime}`;

            // Generate ArrayBuffer from jsPDF
            const pdfBuffer = doc.output('arraybuffer');

            // Native Save Dialog for PDF
            const filePath = await save({
                defaultPath: `${filename}.pdf`,
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
            });

            if (!filePath) {
                showWarning("Export cancelled.");
                return;
            }

            // Write File via Tauri
            await writeFile(filePath, new Uint8Array(pdfBuffer));

            await invoke('log_frontend_action', {
                adminId: adminSession?.account_id,
                actionType: 'EXPORT',
                entityType: activeTab === 'gateLogs' ? 'Entry Logs' : 'Event Attendance',
                entityId: null,
                entityLabel: `${entityLabelPrefix} (${logsForExport.length} records)`,
                oldValues: null,
                newValues: JSON.stringify({ format: 'PDF', filename, record_count: logsForExport.length, title: reportTitle, columns: tableColumn })
            }).catch(e => console.error("Audit log failed for PDF export", e));

            showSuccess(`Success: Report saved to ${filePath}`);
        } catch (error) {
            console.error("PDF export failed", error);
            showError("An error occurred during export.");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 relative">

            {/* Header Title Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                        <History className="w-8 h-8 text-emerald-500" />
                        {activeTab === 'gateLogs' ? 'General Gate Logs' : 'Event Attendance'}
                    </h1>
                    <p className="text-slate-500 mt-1">
                        {activeTab === 'gateLogs' ? 'Real-time entry and exit monitoring.' : 'Tracking attendance for events and ceremonies.'}
                    </p>
                </div>
                <div className="flex flex-col items-end gap-3">
                    <div className="flex items-center gap-3">
                        {activeTab === 'eventLogs' ? (
                            <>
                                <button
                                    onClick={() => setShowManualExportModal(true)}
                                    disabled={isExporting}
                                    className={`flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors focus:outline-none shadow-sm ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <Download className="w-4 h-4" />
                                    <span className="font-semibold text-sm">Manual Export</span>
                                </button>
                                
                                <div className="relative shrink-0" ref={exportMenuRef}>
                                    <button
                                        onClick={() => setShowExportMenu(!showExportMenu)}
                                        disabled={isExporting}
                                        className={`flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors focus:outline-none shadow-sm ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                        <span className="font-semibold text-sm">
                                            {isExporting ? 'Wait' : 'Quick Export'}
                                        </span>
                                    </button>

                                    {showExportMenu && !isExporting && (
                                        <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
                                            <button
                                                onClick={handleQuickExportPDF}
                                                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100"
                                            >
                                                <FileText className="w-4 h-4 text-red-500" />
                                                Export PDF
                                            </button>
                                            <button
                                                onClick={handleExportExcel}
                                                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                            >
                                                <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                                                Export Excel
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="relative shrink-0" ref={exportMenuRef}>
                                <button
                                    onClick={() => setShowExportMenu(!showExportMenu)}
                                    disabled={isExporting}
                                    className={`flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors focus:outline-none shadow-sm ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                    <span className="font-semibold text-sm">
                                        {isExporting ? 'Wait' : 'Export'}
                                    </span>
                                </button>

                                {showExportMenu && !isExporting && (
                                    <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
                                        <button
                                            onClick={() => handleExportPDF()}
                                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100"
                                        >
                                            <FileText className="w-4 h-4 text-red-500" />
                                            Export PDF
                                        </button>
                                        <button
                                            onClick={handleExportExcel}
                                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                        >
                                            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                                            Export Excel
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            onClick={fetchLogs}
                            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 shadow-sm transition-all"
                            title="Refresh Logs"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    {/* Search Input - Relocated here */}
                    <div className="relative w-full sm:w-64 shrink-0">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-4 w-4 text-slate-400" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500 sm:text-sm shadow-sm transition-all"
                            placeholder={activeTab === 'gateLogs' ? "Search Name or ID..." : "Search Event or Name..."}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Filter Bar (Action Bar) Cleanup */}
            <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow- flex flex-col lg:flex-row items-center justify-between mb-6">

                {/* Sub-Tab Navigation inside Filter Bar */}
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-full lg:w-auto overflow-x-auto shrink-0">
                    <button
                        onClick={() => setActiveTab('gateLogs')}
                        className={`px-6 py-2.5 rounded-lg font-medium transition-all duration-300 whitespace-nowrap focus:outline-none ${activeTab === 'gateLogs' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'}`}
                    >
                        General Gate Logs
                    </button>
                    <button
                        onClick={() => setActiveTab('eventLogs')}
                        className={`px-6 py-2.5 rounded-lg font-medium transition-all duration-300 whitespace-nowrap focus:outline-none ${activeTab === 'eventLogs' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'}`}
                    >
                        Event Attendance
                    </button>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-2 w-full lg:w-auto flex-wrap lg:justify-end">
                    {/* Academic filters and other selectors will be here */}

                    {/* Role Filter */}
                    <select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 text-slate-700 sm:text-sm rounded-lg focus:ring-slate-500 focus:border-slate-500 block w-full sm:w-auto p-2 outline-none"
                    >
                        <option value="All">All Roles</option>
                        {allRoles.filter(r => r.is_main_role || ['student', 'employee', 'visitor'].includes(r.role_name.toLowerCase())).map(role => (
                            <option key={role.role_id} value={role.role_name}>
                                {role.role_name.charAt(0).toUpperCase() + role.role_name.slice(1)}
                            </option>
                        ))}
                    </select>

                    {/* Department Filter (Applicable for both Gate Logs and Event Logs) */}
                    <select
                        value={departmentFilter}
                        onChange={(e) => {
                            setDepartmentFilter(e.target.value);
                            setProgramFilter('All'); // Reset program when department changes
                        }}
                        className="bg-slate-50 border border-slate-200 text-slate-700 sm:text-sm rounded-lg focus:ring-slate-500 focus:border-slate-500 block w-full sm:w-auto p-2 outline-none"
                    >
                        <option value="All">All Departments</option>
                        {departments.map(dept => (
                            <option key={dept.department_id} value={dept.department_id}>
                                {dept.department_code}
                            </option>
                        ))}
                    </select>

                    {/* Academic Filters & Event Filter (Only for Event Logs) */}
                    {activeTab === 'eventLogs' && (
                        <>
                            {/* Program Filter */}
                            <select
                                value={programFilter}
                                onChange={(e) => setProgramFilter(e.target.value)}
                                className="bg-slate-50 border border-slate-200 text-slate-700 sm:text-sm rounded-lg focus:ring-slate-500 focus:border-slate-500 block w-full sm:w-auto p-2 outline-none"
                                disabled={departmentFilter === 'All'}
                            >
                                <option value="All">All Programs</option>
                                {filteredPrograms.map(prog => (
                                    <option key={prog.program_id} value={prog.program_id}>
                                        {prog.program_code}
                                    </option>
                                ))}
                            </select>

                            {/* Event Filter */}
                            <select
                                value={eventFilter}
                                onChange={(e) => setEventFilter(e.target.value)}
                                className="bg-slate-50 border border-slate-200 text-slate-700 sm:text-sm rounded-lg focus:ring-slate-500 focus:border-slate-500 block w-full sm:w-auto p-2 outline-none"
                            >
                                <option value="All">All Events</option>
                                {uniqueEvents.map(eventName => (
                                    <option key={eventName} value={eventName}>
                                        {eventName}
                                    </option>
                                ))}
                            </select>

                            {/* Year Filter */}
                            <select
                                value={yearFilter}
                                onChange={(e) => setYearFilter(e.target.value)}
                                className="bg-slate-50 border border-slate-200 text-slate-700 sm:text-sm rounded-lg focus:ring-slate-500 focus:border-slate-500 block w-full sm:w-auto p-2 outline-none"
                            >
                                <option value="All">All Years</option>
                                <option value="1">1st Year</option>
                                <option value="2">2nd Year</option>
                                <option value="3">3rd Year</option>
                                <option value="4">4th Year</option>
                            </select>
                        </>
                    )}

                    {/* Action Filter (Only for Gate Logs) */}
                    {activeTab === 'gateLogs' && (
                        <select
                            value={actionFilter}
                            onChange={(e) => setActionFilter(e.target.value)}
                            className="bg-slate-50 border border-slate-200 text-slate-700 sm:text-sm rounded-lg focus:ring-slate-500 focus:border-slate-500 block w-full sm:w-auto p-2 outline-none"
                        >
                            <option value="All">All Actions</option>
                            <option value="entrance">Entry</option>
                            <option value="exit">Exit</option>
                        </select>
                    )}

                    {/* Date Filters */}
                    <div className="flex items-center gap-2 border border-slate-200 rounded-lg p-1 bg-slate-50 w-full xl:w-auto h-[39px] shrink-0 flex-wrap xl:flex-nowrap justify-center">
                        <div className="flex items-center gap-2 px-2">
                            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="bg-transparent text-slate-900 focus:outline-none sm:text-sm font-medium w-[110px]"
                            />
                        </div>
                        <span className="text-slate-300">|</span>
                        <div className="flex items-center gap-2 px-2">
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="bg-transparent text-slate-900 focus:outline-none sm:text-sm font-medium w-[110px]"
                            />
                        </div>
                    </div>

                    {/* Clear button */}
                    <div className="flex gap-2 w-full sm:w-auto pt-1 sm:pt-0 shrink-0">
                        <button
                            onClick={clearFilters}
                            className="flex-1 sm:flex-none bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus:outline-none shadow-sm"
                        >
                            CLEAR ALL
                        </button>
                    </div>

                </div>
            </div>


            {/* Solid Table View - scroll container with sticky headers */}
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 shadow-sm rounded-xl relative">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm table-fixed">
                        <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
                            <tr>
                                <SortableHeader label="Timestamp" sortKey="scanned_at" sortConfig={sortConfig} onSort={requestSort} width="180px" />
                                <SortableHeader label="User Info" sortKey="person_name" sortConfig={sortConfig} onSort={requestSort} width="250px" />
                                <SortableHeader label="Roles" sortKey="roles" sortConfig={sortConfig} onSort={requestSort} width="150px" />
                                {activeTab === 'gateLogs' ? (
                                    <>
                                        <SortableHeader label="Department" sortKey="department_name" sortConfig={sortConfig} onSort={requestSort} width="250px" />
                                        <SortableHeader label="Action" sortKey="scanner_function" sortConfig={sortConfig} onSort={requestSort} align="center" width="120px" />
                                    </>
                                ) : (
                                    <>
                                        <SortableHeader label="Academic Info" sortKey="program_name" sortConfig={sortConfig} onSort={requestSort} width="250px" />
                                        <SortableHeader label="Event Name" sortKey="event_name" sortConfig={sortConfig} onSort={requestSort} width="200px" />
                                        <SortableHeader label="Status" sortKey="status" sortConfig={sortConfig} onSort={requestSort} width="120px" />
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedLogs.length > 0 ? (
                                paginatedLogs.map((log) => (
                                    <tr key={log.log_id || log.attendance_id} className="hover:bg-slate-50 even:bg-slate-50/50 transition-colors">
                                        <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap font-mono text-xs">
                                            {formatDate(log.scanned_at)}
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-slate-900 text-sm">
                                                    {log.person_name}
                                                </span>
                                                <span className="text-[11px] text-slate-500 font-mono">
                                                    {log.id_number}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <div className="flex flex-wrap gap-1">
                                                {(log.roles_with_behavior || log.roles?.map(r => ({ name: r, behavior: r })) || []).map((roleObj, idx) => (
                                                    <span 
                                                        key={`${roleObj.name}-${idx}`} 
                                                        className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${getRoleStyle(roleObj.behavior)}`}
                                                    >
                                                        {roleObj.name}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        {activeTab === 'gateLogs' ? (
                                            <>
                                                <td className="px-3 py-1.5">
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-900 font-medium text-xs">
                                                            {log.role_behaviors?.includes('visitor') ? "VISITOR" : (log.department_name || "N/A")}
                                                        </span>
                                                        <span className="text-[10px] text-slate-500 tracking-tight">
                                                            {log.role_behaviors?.includes('student')
                                                                ? (log.program_name ? `${log.program_name} ${log.year_level ? `- Yr ${log.year_level}` : ""}` : "-")
                                                                : log.role_behaviors?.includes('employee')
                                                                    ? (log.position_title || "Faculty/Staff")
                                                                    : "---"
                                                            }
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-1.5 text-center">
                                                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded shadow-sm text-xs font-bold ${log.scanner_function === 'entrance'
                                                        ? 'bg-blue-600 text-white border-blue-700'
                                                        : 'bg-rose-600 text-white border-rose-700'
                                                        }`}>
                                                        {log.scanner_function === 'entrance' ? (
                                                            <ArrowDownLeft className="w-3.5 h-3.5" />
                                                        ) : (
                                                            <ArrowUpRight className="w-3.5 h-3.5" />
                                                        )}
                                                        <span>{log.scanner_function === 'entrance' ? 'ENTRY' : 'EXIT'}</span>
                                                    </div>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="px-3 py-1.5">
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-900 font-medium text-xs">
                                                            {log.role_behaviors?.includes('student') 
                                                                ? (log.program_name || "No Program") 
                                                                : (log.role_behaviors?.includes('visitor') ? "VISITOR" : (log.department_name || "N/A"))}
                                                        </span>
                                                        <span className="text-[10px] text-slate-500 uppercase tracking-tight">
                                                            {log.role_behaviors?.includes('student')
                                                                ? (log.year_level ? `Year ${log.year_level} - ${log.department_name}` : log.department_name)
                                                                : (log.position_title || "---")
                                                            }
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-1.5 text-slate-600 text-xs font-semibold">
                                                    {log.event_name}
                                                </td>
                                                <td className="px-3 py-1.5">
                                                    <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${(log.status || 'On Time') === 'Late'
                                                        ? 'bg-rose-100 text-rose-700 border-rose-200'
                                                        : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                                        }`}>
                                                        {log.status || 'On Time'}
                                                    </span>
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={activeTab === 'gateLogs' ? 5 : 6} className="p-12 text-center">
                                        <div className="flex flex-col items-center justify-center space-y-4">
                                            <div className="p-4 bg-slate-50 rounded-full border border-slate-100">
                                                <History className="w-10 h-10 text-slate-300" />
                                            </div>
                                            <div>
                                                <p className="text-slate-900 font-bold text-lg">
                                                    {loading ? "Searching Logs..." : "No Logs Found"}
                                                </p>
                                                <p className="text-slate-500 text-sm max-w-xs mx-auto">
                                                    {loading
                                                        ? "We are retrieving the access records from the database."
                                                        : "We couldn't find any records matching your current filter criteria."}
                                                </p>
                                            </div>
                                            {!loading && (
                                                <button
                                                    onClick={clearFilters}
                                                    className="text-blue-600 font-semibold text-sm hover:underline"
                                                >
                                                    Clear all filters
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                    totalItems={filteredLogs.length}
                    itemsPerPage={ITEMS_PER_PAGE}
                    currentItemsCount={paginatedLogs.length}
                />
            </div>

            {activeTab === 'eventLogs' && (
                <AdminModal
                    isOpen={showManualExportModal}
                    onClose={() => setShowManualExportModal(false)}
                    title="Manual Export"
                    subtitle="Customize columns, title, and role-based filters for Event Attendance."
                    icon={<Download className="h-5 w-5 text-emerald-400" />}
                    tone="default"
                    size="lg"
                    bodyClassName="space-y-6"
                    footer={
                        <div className="flex justify-between items-center gap-3">
                            {manualExportAsTemplate && (
                                <button
                                    onClick={() => setShowTemplateBuilder(true)}
                                    className="px-5 py-2.5 text-sm font-bold rounded-xl border border-blue-500/30 bg-blue-600/15 text-blue-400 hover:bg-blue-600/25 hover:text-blue-300 transition-all flex items-center gap-2"
                                >
                                    <Table className="w-4 h-4" /> Configure Template Table
                                </button>
                            )}
                            <div className="flex justify-end gap-3 ml-auto">
                                <button
                                    onClick={() => setShowManualExportModal(false)}
                                    className="px-5 py-2.5 text-sm font-bold rounded-xl border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleManualExportPDF}
                                    disabled={isExporting}
                                    className="px-5 py-2.5 text-sm font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2"
                                >
                                    <FileText className="w-4 h-4" /> {manualExportAsTemplate ? 'Export Template' : 'Generate PDF Report'}
                                </button>
                            </div>
                        </div>
                    }
                >
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-white/50 mb-2">Report Title</label>
                                    <input
                                        type="text"
                                        value={manualReportTitle}
                                        onChange={(e) => setManualReportTitle(e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none placeholder-white/20 transition-all"
                                        placeholder="Event Attendance Report"
                                    />
                                </div>

                            <div className="space-y-6">
                                {/* Main Roles Section */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between px-1">
                                        <div className="flex items-center gap-2">
                                            <label className="text-[12px] font-bold text-white/40">Main Roles</label>
                                        </div>
                                        <button 
                                            onClick={() => {
                                                const mainRoleNames = exportRoleAwareOptions.mainRoles.map(r => r.role_name);
                                                setManualSelectedRoles(prev => [...new Set([...prev, ...mainRoleNames])]);
                                            }}
                                            className="text-[12px] font-bold text-emerald-400/70 hover:text-emerald-400 transition-colors"
                                        >
                                            Select All
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-2 border border-white/10 rounded-2xl p-4 bg-black/20">
                                        {exportRoleAwareOptions.mainRoles.map(role => {
                                            const isSelected = manualSelectedRoles.includes(role.role_name);
                                            return (
                                                <button
                                                    key={role.role_id}
                                                    onClick={() => {
                                                        const relatedSubRoles = allRoles.filter(r => r.parent_role_id === role.role_id).map(r => r.role_name);
                                                        if (isSelected) {
                                                            setManualSelectedRoles(prev => prev.filter(r => r !== role.role_name && !relatedSubRoles.includes(r)));
                                                        } else {
                                                            setManualSelectedRoles(prev => [...new Set([...prev, role.role_name, ...relatedSubRoles])]);
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
                                {exportRoleAwareOptions.subRoles.length > 0 && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between px-1">
                                            <div className="flex items-center gap-2">
                                                <label className="text-[12px] font-bold text-white/40">Sub-Roles / Designations</label>
                                            </div>
                                            <button 
                                                onClick={() => {
                                                    const subRoleNames = exportRoleAwareOptions.subRoles.map(r => r.role_name);
                                                    setManualSelectedRoles(prev => [...new Set([...prev, ...subRoleNames])]);
                                                }}
                                                className="text-[12px] font-bold text-blue-400/70 hover:text-blue-400 transition-colors"
                                            >
                                                Select All
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-2 border border-white/10 rounded-2xl p-4 bg-black/20">
                                            {exportRoleAwareOptions.subRoles.map(role => {
                                                const isSelected = manualSelectedRoles.includes(role.role_name);
                                                return (
                                                    <button
                                                        key={role.role_id}
                                                        onClick={() => {
                                                            if (isSelected) {
                                                                setManualSelectedRoles(prev => prev.filter(r => r !== role.role_name));
                                                            } else {
                                                                setManualSelectedRoles(prev => [...new Set([...prev, role.role_name])]);
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

                                <div className="flex justify-end">
                                    <button 
                                        onClick={() => setManualSelectedRoles([])}
                                        className="text-[12px] font-bold text-white/30 hover:text-white/60 transition-colors flex items-center gap-2"
                                    >
                                        <RefreshCw className="w-3 h-3" /> Clear All Roles
                                    </button>
                                </div>
                            </div>

                            {(manualHasStudentBehavior || manualHasEmployeeBehavior) && (
                                <div className="space-y-5 border border-white/10 rounded-2xl p-5 bg-black/20">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div>
                                            <label className="block text-xs font-bold text-white/50 mb-2">Specific Departments</label>
                                            <div className="flex flex-wrap gap-2 p-3 bg-black/40 border border-white/10 rounded-xl max-h-48 overflow-y-auto custom-scrollbar">
                                                <button
                                                    type="button"
                                                    onClick={() => setManualSelectedDepartments([])}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${manualSelectedDepartments.length === 0 ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.15)]' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
                                                >
                                                    All Departments
                                                </button>
                                                {departments.map((dept) => {
                                                    const active = manualSelectedDepartments.includes(dept.department_name);
                                                    return (
                                                        <button
                                                            key={dept.department_id}
                                                            type="button"
                                                            onClick={() => {
                                                                if (active) {
                                                                    setManualSelectedDepartments(prev => prev.filter(d => d !== dept.department_name));
                                                                } else {
                                                                    setManualSelectedDepartments(prev => [...prev, dept.department_name]);
                                                                }
                                                            }}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all truncate max-w-[150px] ${active ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.15)]' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
                                                            title={dept.department_name}
                                                        >
                                                            {dept.department_code}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {manualHasStudentBehavior && (
                                            <div>
                                                <label className="block text-xs font-bold text-white/50 mb-2">Specific Year Levels</label>
                                                <div className="grid grid-cols-2 gap-2 p-3 bg-black/40 border border-white/10 rounded-xl">
                                                    {[1, 2, 3, 4].map((year) => {
                                                        const active = manualSelectedYears.includes(year);
                                                        const ordinal = year === 1 ? '1st' : year === 2 ? '2nd' : year === 3 ? '3rd' : '4th';
                                                        return (
                                                            <button
                                                                key={year}
                                                                type="button"
                                                                onClick={() => {
                                                                    if (active) {
                                                                        setManualSelectedYears(prev => prev.filter(y => y !== year));
                                                                    } else {
                                                                        setManualSelectedYears(prev => [...prev, year].sort());
                                                                    }
                                                                }}
                                                                className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${active ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.15)]' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
                                                            >
                                                                {ordinal} Year
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {manualHasStudentBehavior && (
                                        <div>
                                            <label className="block text-xs font-bold text-white/50 mb-2">Specific Programs</label>
                                            <div className="flex flex-wrap gap-2 p-3 bg-black/40 border border-white/10 rounded-xl max-h-48 overflow-y-auto custom-scrollbar">
                                                <button
                                                    type="button"
                                                    onClick={() => setManualSelectedPrograms([])}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${manualSelectedPrograms.length === 0 ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.15)]' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
                                                >
                                                    All Programs
                                                </button>
                                                {allPrograms
                                                    .filter(prog => {
                                                        if (manualSelectedDepartments.length === 0) return true;
                                                        const dept = departments.find(d => d.department_id === prog.department_id);
                                                        return dept && manualSelectedDepartments.includes(dept.department_name);
                                                    })
                                                    .map((prog) => {
                                                        const active = manualSelectedPrograms.includes(prog.program_name);
                                                        return (
                                                            <button
                                                                key={prog.program_id}
                                                                type="button"
                                                                onClick={() => {
                                                                    if (active) {
                                                                        setManualSelectedPrograms(prev => prev.filter(p => p !== prog.program_name));
                                                                    } else {
                                                                        setManualSelectedPrograms(prev => [...prev, prog.program_name]);
                                                                    }
                                                                }}
                                                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all truncate max-w-[150px] ${active ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.15)]' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
                                                                title={prog.program_name}
                                                            >
                                                                {prog.program_code}
                                                            </button>
                                                        );
                                                    })
                                                }
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-white/50 mb-3">Report Options</label>
                                <div className="flex flex-wrap gap-6 border border-white/10 rounded-2xl p-5 bg-black/20">
                                    <label className="inline-flex items-center gap-3 text-sm text-white/70 hover:text-white transition-colors cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={manualIncludeNumbering}
                                            onChange={(e) => setManualIncludeNumbering(e.target.checked)}
                                            className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30 accent-emerald-500 transition-all"
                                        />
                                        <span className="font-medium">Include Row Numbering</span>
                                    </label>
                                    <label className="inline-flex items-center gap-3 text-sm text-white/70 hover:text-white transition-colors cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={manualIncludeAbsent}
                                            onChange={(e) => setManualIncludeAbsent(e.target.checked)}
                                            className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30 accent-emerald-500 transition-all"
                                        />
                                        <span className="font-medium">Include People Without Attendance (Mark as Absent)</span>
                                    </label>
                                    <label className="inline-flex items-center gap-3 text-sm text-white/70 hover:text-white transition-colors cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={manualIncludeStats}
                                            onChange={(e) => setManualIncludeStats(e.target.checked)}
                                            className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30 accent-emerald-500 transition-all"
                                        />
                                        <span className="font-medium">Include Statistics Page</span>
                                    </label>
                                    <label className="inline-flex items-center gap-3 text-sm text-white/70 hover:text-white transition-colors cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={manualIncludePartTime}
                                            onChange={(e) => setManualIncludePartTime(e.target.checked)}
                                            className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30 accent-emerald-500 transition-all"
                                        />
                                        <span className="font-medium">Include Part-Time Employees</span>
                                    </label>
                                    <div className="w-full border-t border-white/10 my-1"></div>
                                    <label className="inline-flex items-center gap-3 text-sm text-amber-400/80 hover:text-amber-300 transition-colors cursor-pointer group w-full">
                                        <input
                                            type="checkbox"
                                            checked={manualExportAsTemplate}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setManualExportAsTemplate(checked);
                                                if (!checked) {
                                                    setManualSelectedColumns(prev => prev.filter(id => id !== 'signature'));
                                                }
                                            }}
                                            className="w-4 h-4 rounded border-amber-500/30 bg-white/5 text-amber-500 focus:ring-amber-500/30 accent-amber-500 transition-all"
                                        />
                                        <span className="font-medium">Export as Blank Template (Headers Only)</span>
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-white/50 mb-3">Visible Columns</label>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 border border-white/10 rounded-2xl p-5 bg-black/20">
                                    {EVENT_EXPORT_COLUMNS.filter(col => {
                                        if (col.id === 'eventName' && uniqueEvents.length <= 1) return false;
                                        if (col.id === 'signature' && !manualExportAsTemplate) return false;
                                        return true;
                                    }).map(col => (
                                        <label key={col.id} className="inline-flex items-center gap-3 text-sm text-white/70 hover:text-white transition-colors cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={manualSelectedColumns.includes(col.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setManualSelectedColumns(prev => [...new Set([...prev, col.id])]);
                                                    } else {
                                                        setManualSelectedColumns(prev => prev.filter(id => id !== col.id));
                                                    }
                                                }}
                                                className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30 accent-emerald-500 transition-all"
                                            />
                                            <span className="font-medium">
                                                {col.label}
                                                {col.id === 'signature' && (
                                                    <span className="text-[10px] text-amber-400 block font-normal mt-0.5">
                                                        (Only for blank template)
                                                    </span>
                                                )}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                </AdminModal>
            )}

            {/* Template Builder Drawer */}
            {showTemplateBuilder && (
                <div className="fixed inset-0 z-[110] flex">
                    {/* Backdrop */}
                    <button
                        type="button"
                        onClick={() => setShowTemplateBuilder(false)}
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
                        aria-label="Close template builder"
                    />

                    {/* Main modal preview (left side) */}
                    <div className="relative w-[30%] flex items-center justify-center p-6 animate-in slide-in-from-right-4 duration-300">
                        <div className="bg-slate-950/90 border border-white/15 rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto backdrop-blur-xl shadow-2xl">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30">
                                    <FileText className="w-5 h-5 text-emerald-400" />
                                </div>
                                <div>
                                    <h3 className="text-white font-semibold text-sm">Export Preview</h3>
                                    <p className="text-white/50 text-xs">Template mode active</p>
                                </div>
                            </div>
                            <div className="space-y-2 text-xs text-white/50">
                                <p><span className="text-white/70 font-semibold">Title:</span> {manualReportTitle || 'Untitled Report'}</p>
                                <p><span className="text-white/70 font-semibold">Columns:</span> {manualSelectedColumns.length + templateExtraColumns.length}</p>
                                <p><span className="text-white/70 font-semibold">Rows:</span> {templateRows.length}</p>
                                <p><span className="text-white/70 font-semibold">Numbering:</span> {manualIncludeNumbering ? 'Yes' : 'No'}</p>
                            </div>
                        </div>
                    </div>

                    {/* Template Builder Drawer (right side) */}
                    <div className={`relative w-[70%] border-l shadow-2xl flex flex-col animate-in slide-in-from-right-8 duration-300 overflow-hidden ${
                        templateDarkMode ? 'bg-slate-950/95 border-white/15 backdrop-blur-xl' : 'bg-slate-50 border-slate-200'
                    }`}>
                        {/* Drawer Header */}
                        <div className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${
                            templateDarkMode ? 'border-white/10 bg-black/20 text-white' : 'border-slate-200 bg-slate-100 text-slate-900'
                        }`}>
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-xl border ${
                                    templateDarkMode ? 'bg-blue-500/15 border-blue-500/30' : 'bg-blue-50 border-blue-200'
                                }`}>
                                    <Table className={`w-5 h-5 ${templateDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-base">Template Builder</h3>
                                    <p className={`text-xs ${templateDarkMode ? 'text-white/50' : 'text-slate-500'}`}>Customize rows, columns, and cell content</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setTemplateDarkMode(!templateDarkMode)}
                                    className={`p-2 rounded-xl border transition-all ${
                                        templateDarkMode 
                                            ? 'border-white/15 bg-white/5 text-amber-400 hover:bg-white/10' 
                                            : 'border-slate-200 bg-slate-200/50 text-amber-600 hover:bg-slate-200'
                                    }`}
                                    title={templateDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                                >
                                    {templateDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={() => setShowTemplateBuilder(false)}
                                    className={`p-2 rounded-xl border transition-all ${
                                        templateDarkMode
                                            ? 'border-white/15 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                                            : 'border-slate-200 bg-slate-200/50 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                                    }`}
                                >
                                    <PanelRightClose className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Structural Controls */}
                        <div className={`flex items-center gap-3 px-6 py-3 border-b shrink-0 ${
                            templateDarkMode ? 'border-white/10 bg-black/10 text-white/40' : 'border-slate-200 bg-slate-50/50 text-slate-600'
                        }`}>
                            <button
                                onClick={() => {
                                    const colName = `Column ${templateExtraColumns.length + 1}`;
                                    setTemplateExtraColumns(prev => [...prev, colName]);
                                }}
                                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                    templateDarkMode
                                        ? 'border-blue-500/30 bg-blue-600/15 text-blue-400 hover:bg-blue-600/25'
                                        : 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100'
                                }`}
                            >
                                <Plus className="w-3.5 h-3.5" /> Add Column
                            </button>
                            <button
                                onClick={() => setTemplateRows(prev => [...prev, {}])}
                                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                    templateDarkMode
                                        ? 'border-emerald-500/30 bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25'
                                        : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                                }`}
                            >
                                <Plus className="w-3.5 h-3.5" /> Add Row
                            </button>
                            <div className={`ml-auto text-xs ${templateDarkMode ? 'text-white/40' : 'text-slate-400'}`}>
                                {templateRows.length} rows × {manualSelectedColumns.length + templateExtraColumns.length} columns
                            </div>
                        </div>

                        {/* Mini-Spreadsheet */}
                        <div className="flex-1 overflow-auto min-h-0 p-4">
                            <div className={`overflow-auto rounded-xl border ${templateDarkMode ? 'border-white/10' : 'border-slate-200 bg-white'}`}>
                                <table className="w-full text-xs border-collapse">
                                    <thead className="sticky top-0 z-10">
                                        <tr className={templateDarkMode ? 'bg-slate-800/90 backdrop-blur-sm' : 'bg-slate-100/95 backdrop-blur-sm'}>
                                            {manualIncludeNumbering && (
                                                <th className={`px-3 py-2.5 text-left font-bold border-b border-r whitespace-nowrap w-12 ${
                                                    templateDarkMode ? 'border-white/10 text-white/60' : 'border-slate-200 text-slate-500'
                                                }`}>#</th>
                                            )}
                                            {EVENT_EXPORT_COLUMNS.filter(col => manualSelectedColumns.includes(col.id)).map(col => (
                                                <th key={col.id} className={`px-3 py-2.5 text-left font-bold border-b border-r whitespace-nowrap ${
                                                    templateDarkMode ? 'border-white/10 text-white/80' : 'border-slate-200 text-slate-800'
                                                }`}>
                                                    {col.label}
                                                </th>
                                            ))}
                                            {templateExtraColumns.map((colName, colIdx) => (
                                                <th key={`extra-${colIdx}`} className={`px-2 py-1.5 text-left border-b border-r whitespace-nowrap group ${
                                                     templateDarkMode ? 'border-white/10' : 'border-slate-200'
                                                 }`}>
                                                    <div className="flex items-center gap-1">
                                                        {editingCell?.type === 'header' && editingCell?.col === colIdx ? (
                                                            <input
                                                                autoFocus
                                                                type="text"
                                                                value={colName}
                                                                onChange={(e) => {
                                                                    setTemplateExtraColumns(prev => {
                                                                        const updated = [...prev];
                                                                        updated[colIdx] = e.target.value;
                                                                        return updated;
                                                                    });
                                                                }}
                                                                onBlur={() => setEditingCell(null)}
                                                                onKeyDown={(e) => e.key === 'Enter' && setEditingCell(null)}
                                                                className={`rounded px-1.5 py-0.5 text-xs font-bold w-full focus:outline-none focus:ring-1 ${
                                                                     templateDarkMode 
                                                                         ? 'bg-blue-500/20 border border-blue-500/40 text-blue-300 focus:ring-blue-500/50' 
                                                                         : 'bg-blue-50 border border-blue-300 text-blue-600 focus:ring-blue-400'
                                                                 }`}
                                                            />
                                                        ) : (
                                                            <span
                                                                className={`font-bold cursor-pointer transition-colors ${
                                                                     templateDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
                                                                 }`}
                                                                onDoubleClick={() => setEditingCell({ type: 'header', col: colIdx })}
                                                                title="Double-click to rename"
                                                            >
                                                                {colName}
                                                            </span>
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                setTemplateExtraColumns(prev => prev.filter((_, i) => i !== colIdx));
                                                                setTemplateRows(prev => prev.map(row => {
                                                                    const updated = { ...row };
                                                                    delete updated[`extra_${colIdx}`];
                                                                    return updated;
                                                                }));
                                                            }}
                                                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-rose-400/60 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                                                            title="Remove column"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {templateRows.map((row, rowIdx) => (
                                            <tr key={rowIdx} className={`group transition-colors ${
                                                 templateDarkMode ? 'hover:bg-white/[0.03]' : 'hover:bg-slate-100/50'
                                             }`}>
                                                {manualIncludeNumbering && (
                                                    <td className={`px-3 py-2 font-mono border-b border-r text-center ${
                                                         templateDarkMode ? 'border-white/5 text-white/30' : 'border-slate-100 text-slate-400'
                                                     }`}>{rowIdx + 1}</td>
                                                )}
                                                {EVENT_EXPORT_COLUMNS.filter(col => manualSelectedColumns.includes(col.id)).map(col => (
                                                    <td key={col.id} className={`px-1 py-1 border-b border-r ${
                                                         templateDarkMode ? 'border-white/5' : 'border-slate-100'
                                                     }`}>
                                                        {editingCell?.type === 'cell' && editingCell?.row === rowIdx && editingCell?.col === col.id ? (
                                                            <div className="relative">
                                                                <input
                                                                    autoFocus
                                                                    type="text"
                                                                    value={row[col.id] || ''}
                                                                    onChange={(e) => {
                                                                        setTemplateRows(prev => {
                                                                            const updated = [...prev];
                                                                            updated[rowIdx] = { ...updated[rowIdx], [col.id]: e.target.value };
                                                                            return updated;
                                                                        });
                                                                    }}
                                                                    onBlur={() => setTimeout(() => setEditingCell(null), 150)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') setEditingCell(null);
                                                                        if (e.key === 'Escape') setEditingCell(null);
                                                                        if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                                                                            handleCellNavigation(rowIdx, col.id, e);
                                                                        }
                                                                    }}
                                                                    className={`w-full rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 ${
                                                                         templateDarkMode 
                                                                             ? 'bg-blue-500/10 border border-blue-500/30 text-white focus:ring-blue-500/40' 
                                                                             : 'bg-blue-50 border border-blue-300 text-slate-800 focus:ring-blue-400'
                                                                     }`}
                                                                />
                                                                {getSuggestionsForColumn(col.id, row[col.id]).length > 0 && (
                                                                    <ul className={`absolute z-50 left-0 right-0 mt-0.5 max-h-32 overflow-y-auto rounded-lg border py-0.5 animate-in fade-in duration-100 ${
                                                                         templateDarkMode 
                                                                             ? 'border-white/15 bg-slate-900/98 shadow-2xl' 
                                                                             : 'border-slate-200 bg-white shadow-lg'
                                                                     }`}>
                                                                        {getSuggestionsForColumn(col.id, row[col.id]).map((suggestion, sIdx) => (
                                                                            <li key={sIdx}>
                                                                                <button
                                                                                    type="button"
                                                                                    onMouseDown={(e) => {
                                                                                        e.preventDefault();
                                                                                        setTemplateRows(prev => {
                                                                                            const updated = [...prev];
                                                                                            updated[rowIdx] = { ...updated[rowIdx], [col.id]: suggestion };
                                                                                            return updated;
                                                                                        });
                                                                                        setEditingCell(null);
                                                                                    }}
                                                                                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                                                                         templateDarkMode 
                                                                                             ? 'text-white/70 hover:bg-white/10 hover:text-white' 
                                                                                             : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                                                                                     }`}
                                                                                >
                                                                                    {suggestion}
                                                                                </button>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div
                                                                className={`px-2 py-1.5 cursor-text min-h-[28px] rounded transition-colors ${
                                                                     templateDarkMode 
                                                                         ? 'text-white/50 hover:bg-white/5' 
                                                                         : 'text-slate-700 hover:bg-slate-100'
                                                                 }`}
                                                                onClick={() => setEditingCell({ type: 'cell', row: rowIdx, col: col.id })}
                                                                title="Click to edit"
                                                            >
                                                                {row[col.id] || ''}
                                                            </div>
                                                        )}
                                                    </td>
                                                ))}
                                                {templateExtraColumns.map((_, colIdx) => (
                                                    <td key={`extra-${colIdx}`} className={`px-1 py-1 border-b border-r ${
                                                         templateDarkMode ? 'border-white/5' : 'border-slate-100'
                                                     }`}>
                                                        {editingCell?.type === 'cell' && editingCell?.row === rowIdx && editingCell?.col === `extra_${colIdx}` ? (
                                                            <input
                                                                autoFocus
                                                                type="text"
                                                                value={row[`extra_${colIdx}`] || ''}
                                                                onChange={(e) => {
                                                                    setTemplateRows(prev => {
                                                                        const updated = [...prev];
                                                                        updated[rowIdx] = { ...updated[rowIdx], [`extra_${colIdx}`]: e.target.value };
                                                                        return updated;
                                                                    });
                                                                }}
                                                                onBlur={() => setEditingCell(null)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') setEditingCell(null);
                                                                    if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                                                                        handleCellNavigation(rowIdx, `extra_${colIdx}`, e);
                                                                    }
                                                                }}
                                                                className="w-full bg-blue-500/10 border border-blue-500/30 rounded px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                                                            />
                                                        ) : (
                                                            <div
                                                                className="px-2 py-1.5 text-white/50 cursor-text min-h-[28px] rounded hover:bg-white/5 transition-colors"
                                                                onClick={() => setEditingCell({ type: 'cell', row: rowIdx, col: `extra_${colIdx}` })}
                                                                title="Click to edit"
                                                            >
                                                                {row[`extra_${colIdx}`] || ''}
                                                            </div>
                                                        )}
                                                    </td>
                                                ))}
                                                {/* Delete row button */}
                                                <td className={`px-1 py-1 border-b ${
                                                     templateDarkMode ? 'border-white/5' : 'border-slate-100'
                                                 }`}>
                                                    <button
                                                        onClick={() => setTemplateRows(prev => prev.filter((_, i) => i !== rowIdx))}
                                                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                                                        title="Delete row"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Drawer Footer */}
                        <div className={`flex items-center justify-between px-6 py-4 border-t shrink-0 ${
                            templateDarkMode ? 'border-white/10 bg-black/20' : 'border-slate-200 bg-slate-100'
                        }`}>
                            <button
                                onClick={() => {
                                    setTemplateRows(Array.from({ length: 5 }, () => ({})));
                                    setTemplateExtraColumns([]);
                                }}
                                className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all flex items-center gap-2 ${
                                    templateDarkMode 
                                        ? 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80' 
                                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                }`}
                            >
                                <RefreshCw className="w-3.5 h-3.5" /> Reset Table
                            </button>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowTemplateBuilder(false)}
                                    className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all ${
                                        templateDarkMode 
                                            ? 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white' 
                                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                                    }`}
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
