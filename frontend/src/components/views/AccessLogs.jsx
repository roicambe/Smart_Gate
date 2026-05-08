import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    History, Search, Filter, RefreshCw, Calendar, ArrowUpRight, ArrowDownLeft, Download, FileText, FileSpreadsheet, Loader2, ChevronLeft, ChevronRight
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

    const EVENT_EXPORT_COLUMNS = useMemo(() => ([
        { id: 'name', label: 'Name', value: (log) => log.person_name || 'N/A' },
        { id: 'timestamp', label: 'Timestamp', value: (log) => formatDate(log.scanned_at) },
        { id: 'idNumber', label: 'ID Number', value: (log) => log.id_number || 'N/A' },
        { id: 'status', label: 'Status', value: (log) => log.status || 'On Time' },
        { id: 'department', label: 'Department', value: (log) => log.department_name || 'N/A' },
        { id: 'program', label: 'Program', value: (log) => log.program_name || 'N/A' },
        { id: 'yearLevel', label: 'Year Level', value: (log) => log.year_level ? `Year ${log.year_level}` : 'N/A' },
        { id: 'role', label: 'Role', value: (log) => (log.roles || []).join(', ') || 'N/A' },
        { id: 'subRole', label: 'Sub Role', value: (log) => log.position_title || (log.roles || []).filter(r => !['student', 'visitor'].includes(String(r).toLowerCase())).join(', ') || 'N/A' },
        { id: 'eventName', label: 'Event', value: (log) => log.event_name || 'N/A' },
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
    const [manualSelectedColumns, setManualSelectedColumns] = useState(['name', 'timestamp', 'idNumber', 'status', 'department', 'role']);
    const [manualSelectedRoles, setManualSelectedRoles] = useState([]);
    const [manualDepartment, setManualDepartment] = useState('All');
    const [manualProgram, setManualProgram] = useState('All');
    const [manualYearLevel, setManualYearLevel] = useState('All');
    const [manualReportTitle, setManualReportTitle] = useState('');
    const exportMenuRef = useRef(null);
    const { showSuccess, showError, showWarning, showProcessing } = useToast();

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

    const exportRoleAwareOptions = useMemo(() => {
        const source = filteredLogs;
        
        const mainRoles = allRoles.filter(r => r.is_main_role || ['student', 'employee', 'visitor'].includes(r.role_name.toLowerCase()));
        const subRoles = allRoles.filter(r => !mainRoles.some(mr => mr.role_id === r.role_id));

        return {
            departments: [...new Set(source.map(log => log.department_name).filter(Boolean))].sort(),
            programs: [...new Set(source.map(log => log.program_name).filter(Boolean))].sort(),
            yearLevels: [...new Set(source.map(log => log.year_level).filter(Boolean))].sort((a, b) => a - b),
            mainRoles,
            subRoles,
            visitorStatuses: [...new Set(source
                .filter(log => getRoleType(log) === 'visitor')
                .map(log => log.status || 'On Time')
                .filter(Boolean))].sort(),
        };
    }, [filteredLogs, allRoles]);

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
            if (typeof prefs.department === 'string') setManualDepartment(prefs.department);
            if (typeof prefs.program === 'string') setManualProgram(prefs.program);
            if (typeof prefs.yearLevel === 'string') setManualYearLevel(prefs.yearLevel);
            if (typeof prefs.visitorStatus === 'string') setManualVisitorStatus(prefs.visitorStatus);
            if (typeof prefs.reportTitle === 'string') setManualReportTitle(prefs.reportTitle);
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
                    department: manualDepartment,
                    program: manualProgram,
                    yearLevel: manualYearLevel,
                    reportTitle: manualReportTitle,
                })
            );
        } catch (error) {
            console.warn('Failed to save manual export preferences', error);
        }
    }, [
        manualSelectedColumns,
        manualSelectedRoles,
        manualDepartment,
        manualProgram,
        manualYearLevel,
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

            if (manualDepartment !== 'All' && (log.department_name || 'N/A') !== manualDepartment) return false;
            
            // Program/Year filter for any student role
            if (selectedLower.includes('student') || manualSelectedRoles.length === 0) {
                if (manualProgram !== 'All' && (log.program_name || 'N/A') !== manualProgram) return false;
                if (manualYearLevel !== 'All' && String(log.year_level || '') !== String(manualYearLevel)) return false;
            }
            
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
            includeStatsPage: false,
            entityLabelPrefix: 'Quick PDF Export',
        });
    };

    const handleManualExportPDF = async () => {
        const selectedLogs = applyManualEventExportFilters(filteredLogs);
        if (!manualSelectedColumns.length) {
            showWarning('Select at least one column to export.');
            return;
        }
        await handleExportPDF({
            logsForExport: selectedLogs,
            selectedColumnIds: manualSelectedColumns,
            reportTitleOverride: manualReportTitle.trim() || generateEventAttendanceTitle(selectedLogs),
            includeStatsPage: false,
            entityLabelPrefix: 'Manual PDF Export',
        });
    };

    const handleExportPDF = async ({
        logsForExport = filteredLogs,
        selectedColumnIds = [],
        reportTitleOverride = '',
        includeStatsPage = true,
        entityLabelPrefix = 'PDF Export',
    } = {}) => {
        if (logsForExport.length === 0) {
            showWarning('No records match the selected export criteria.');
            return;
        }
        setIsExporting(true);
        setShowExportMenu(false);
        setShowManualExportModal(false);
        showProcessing("Preparing PDF export...");

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
            const tableColumn = selectedColumns.map(col => col.label);

            const tableRows = [];

            logsForExport.forEach(log => {
                if (activeTab === 'gateLogs') {
                    tableRows.push([
                        formatDate(log.scanned_at),
                        log.person_name,
                        log.id_number,
                        log.roles?.join(', ') || 'N/A',
                        log.department_name,
                        log.scanner_function.toUpperCase()
                    ]);
                } else {
                    tableRows.push(selectedColumns.map(col => col.value(log)));
                }
            });

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
                headStyles: { fillColor: '#1E293B', textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 9 },
                bodyStyles: { fontSize: 10 },
                styles: { cellPadding: 3, overflow: 'linebreak', lineColor: [203, 213, 225], lineWidth: 0.2 },
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
                                    onClick={handleQuickExportPDF}
                                    disabled={isExporting}
                                    className={`flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors focus:outline-none shadow-sm ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                                    <span className="font-semibold text-sm">{isExporting ? 'Wait' : 'Quick Export'}</span>
                                </button>
                                <button
                                    onClick={() => setShowManualExportModal(true)}
                                    disabled={isExporting}
                                    className={`flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors focus:outline-none shadow-sm ${isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <Download className="w-4 h-4" />
                                    <span className="font-semibold text-sm">Manual Export</span>
                                </button>
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
                                                {log.roles?.map(role => (
                                                    <span key={role} className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${role.toLowerCase() === 'student' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                                        role.toLowerCase() === 'professor' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                                                            role.toLowerCase() === 'visitor' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                                                'bg-slate-100 text-slate-700 border-slate-200'
                                                        }`}>
                                                        {role}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        {activeTab === 'gateLogs' ? (
                                            <>
                                                <td className="px-3 py-1.5">
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-900 font-medium text-xs">
                                                            {log.roles?.some(r => r.toLowerCase() === 'visitor') ? "VISITOR" : (log.department_name || "-")}
                                                        </span>
                                                        <span className="text-[10px] text-slate-500 tracking-tight">
                                                            {log.roles?.some(r => r.toLowerCase() === 'student')
                                                                ? (log.program_name ? `${log.program_name} ${log.year_level ? `- Yr ${log.year_level}` : ""}` : "-")
                                                                : log.roles?.some(r => r.toLowerCase() === 'professor' || r.toLowerCase() === 'staff')
                                                                    ? (log.position_title || "Faculty/Staff")
                                                                    : log.roles?.some(r => r.toLowerCase() === 'visitor')
                                                                        ? "N/A"
                                                                        : "-"
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
                                                            {log.roles?.some(r => r.toLowerCase() === 'visitor') ? "VISITOR" : (log.department_name || "-")}
                                                        </span>
                                                        <span className="text-[10px] text-slate-500 uppercase tracking-tight">
                                                            {log.roles?.some(r => r.toLowerCase() === 'student')
                                                                ? (log.program_name ? `${log.program_name} ${log.year_level ? `- Year ${log.year_level}` : ""}` : "-")
                                                                : log.roles?.some(r => r.toLowerCase() === 'professor' || r.toLowerCase() === 'staff')
                                                                    ? (log.position_title || "Faculty/Staff")
                                                                    : log.roles?.some(r => r.toLowerCase() === 'visitor')
                                                                        ? "N/A"
                                                                        : "-"
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
                        <div className="flex justify-end gap-3">
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
                                <FileText className="w-4 h-4" /> Generate PDF Report
                            </button>
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

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                {(manualSelectedRoles.length > 0 && 
                                  manualSelectedRoles.some(r => r.toLowerCase() === 'employee' || r.toLowerCase() === 'student' || r.toLowerCase() === 'professor' || r.toLowerCase() === 'staff')) && (
                                    <div>
                                        <label className="block text-xs font-bold text-white/50 mb-2">Department</label>
                                        <select value={manualDepartment} onChange={(e) => setManualDepartment(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none transition-all cursor-pointer">
                                            <option value="All" className="bg-slate-900">All Departments</option>
                                            {exportRoleAwareOptions.departments.map(value => <option key={value} value={value} className="bg-slate-900">{value}</option>)}
                                        </select>
                                    </div>
                                )}

                                {(manualSelectedRoles.length > 0 && manualSelectedRoles.some(r => r.toLowerCase() === 'student')) && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-bold text-white/50 mb-2">Academic Program</label>
                                            <select value={manualProgram} onChange={(e) => setManualProgram(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none transition-all cursor-pointer">
                                                <option value="All" className="bg-slate-900">All Programs</option>
                                                {exportRoleAwareOptions.programs.map(value => <option key={value} value={value} className="bg-slate-900">{value}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-white/50 mb-2">Year Level</label>
                                            <select value={manualYearLevel} onChange={(e) => setManualYearLevel(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none transition-all cursor-pointer">
                                                <option value="All" className="bg-slate-900">All Year Levels</option>
                                                {exportRoleAwareOptions.yearLevels.map(value => <option key={value} value={String(value)} className="bg-slate-900">{`Year ${value}`}</option>)}
                                            </select>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-white/50 mb-3">Visible Columns</label>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 border border-white/10 rounded-2xl p-5 bg-black/20">
                                    {EVENT_EXPORT_COLUMNS.filter(col => col.id !== 'eventName' || uniqueEvents.length > 1).map(col => (
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
                                            <span className="font-medium">{col.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                </AdminModal>
            )}
        </div>
    );
};
