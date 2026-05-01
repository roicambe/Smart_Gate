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

export const AccessLogs = ({ branding, adminSession }) => {
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
    const [departmentFilter, setDepartmentFilter] = useState('All');
    const [programFilter, setProgramFilter] = useState('All');
    const [yearFilter, setYearFilter] = useState('All');
    const [eventFilter, setEventFilter] = useState('All');

    // Pagination
    const ITEMS_PER_PAGE = 15;
    const [currentPage, setCurrentPage] = useState(1);

    // Export State & UX
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const exportMenuRef = useRef(null);
    const { showSuccess, showError, showWarning, showProcessing } = useToast();

    // Fetch academic structure for filters
    useEffect(() => {
        const loadAcademicData = async () => {
            try {
                const [depts, progs] = await Promise.all([
                    invoke('get_departments'),
                    invoke('get_programs')
                ]);
                setDepartments(depts || []);
                setAllPrograms(progs || []);
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
                    roleFilter: roleFilter === 'All' ? null : roleFilter.toLowerCase(),
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

        setLoading(true);
        try {
            if (activeTab === 'gateLogs') {
                const data = await invoke('get_access_logs', {
                    roleFilter: null, actionType: null, locationName: null, searchTerm: null, startDate: null, endDate: null
                });
                setLogs(data);
            } else {
                const data = await invoke('get_event_attendance_logs', {
                    startDate: null,
                    endDate: null,
                    departmentId: null,
                    programId: null,
                    yearLevel: null
                });
                setEventLogs(data);
            }
        } catch (error) {
            console.error("Failed to clear filters:", error);
            showError("Failed to clear filters.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [activeTab]);

    // Filter logic based on active tab
    const currentData = activeTab === 'gateLogs' ? logs : eventLogs;

    // Gate logs are already filtered on backend. Event logs still rely on simple frontend filters for now.
    const filteredLogs = activeTab === 'gateLogs' ? currentData : currentData.filter(log => {
        const roleStr = log.roles?.join(', ') || '';
        const matchesSearch = log.person_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.id_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.event_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
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

    // Pagination - reset to page 1 when filters change
    useEffect(() => { setCurrentPage(1); }, [searchTerm, roleFilter, actionFilter, startDate, endDate, departmentFilter, programFilter, yearFilter, eventFilter, activeTab]);

    // Filter programs based on selected department
    const filteredPrograms = useMemo(() => {
        if (departmentFilter === 'All') return [];
        return allPrograms.filter(p => p.department_id === parseInt(departmentFilter));
    }, [departmentFilter, allPrograms]);

    const totalPages = Math.ceil(filteredLogs.length / ITEMS_PER_PAGE);
    const paginatedLogs = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredLogs.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredLogs, currentPage]);
    const showPagination = filteredLogs.length > ITEMS_PER_PAGE;

    const formatDate = (dateString) => {
        if (!dateString) return "-";
        const date = new Date(dateString);
        return date.toLocaleString();
    };

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

    const handleExportPDF = async () => {
        if (filteredLogs.length === 0) return;
        setIsExporting(true);
        setShowExportMenu(false);
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

            const reportTitle = activeTab === 'gateLogs' ? 'Access Logs' : 'Event Attendance';
            const drawHeader = () => {
                const layout = drawInstitutionalHeader(doc, {
                    branding,
                    logos: headerAssets.logos,
                    contactIcons: headerAssets.contactIcons,
                    reportTitle,
                    officeName: 'Office of Campus Security',
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
            const tableColumn = activeTab === 'gateLogs'
                ? ["Timestamp", "Name", "ID Number", "Role", "Department", "Action"]
                : ["Timestamp", "Name", "ID Number", "Role", "Event Name", "Status"];

            const tableRows = [];

            filteredLogs.forEach(log => {
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
                    tableRows.push([
                        formatDate(log.scanned_at),
                        log.person_name,
                        log.id_number,
                        log.roles?.join(', ') || 'N/A',
                        log.event_name,
                        log.status || 'On Time'
                    ]);
                }
            });

            // --- STEP 1: Generate Statistics on the first page ---
            const stats = getStatistics(filteredLogs, activeTab);
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
                didDrawPage: function (data) {
                    drawHeader();
                },
                margin: { top: headerLayout.contentStartY + 2, left: headerLayout.margin, right: headerLayout.margin }
            });

            // --- STEP 2: Add a new page to securely separate stats from logs ---
            doc.addPage();

            // --- STEP 3: Generate the main logs table ---
            autoTable(doc, {
                startY: headerLayout.contentStartY + 2,
                margin: { top: headerLayout.contentStartY + 2, left: headerLayout.margin, right: headerLayout.margin },
                head: [tableColumn],
                body: tableRows,
                theme: 'striped',
                headStyles: { fillColor: '#1E293B', textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 9 }, // Charcoal
                bodyStyles: { fontSize: 10 },
                alternateRowStyles: { fillColor: [248, 250, 252] }, // slate-50
                styles: { cellPadding: 3, overflow: 'linebreak' },
                columnStyles: {
                    0: { cellWidth: 'auto' }, // Timestamp
                    1: { cellWidth: 'auto' }, // Name
                    2: { cellWidth: 'auto' }, // ID
                    3: { cellWidth: 'auto' }, // Role
                    4: { cellWidth: 'auto' }, // Location
                    5: { cellWidth: 'auto' }, // Action
                },
                didDrawPage: function (data) {
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
                entityLabel: `PDF Export (${filteredLogs.length} records)`,
                oldValues: null,
                newValues: JSON.stringify({ format: 'PDF', filename, record_count: filteredLogs.length })
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
                        {/* Export Dropdown */}
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
                                        onClick={handleExportPDF}
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
            <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col lg:flex-row items-center justify-between mb-6">

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

                <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto flex-wrap lg:justify-end">
                    {/* Academic filters and other selectors will be here */}

                    {/* Role Filter */}
                    <select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 text-slate-700 sm:text-sm rounded-lg focus:ring-slate-500 focus:border-slate-500 block w-full sm:w-auto p-2 outline-none"
                    >
                        <option value="All">All Roles</option>
                        <option value="student">Student</option>
                        <option value="professor">Professor</option>
                        <option value="staff">Staff</option>
                        <option value="visitor">Visitor</option>
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
                    <div className="flex items-center gap-2 border border-slate-200 rounded-lg p-1 bg-slate-50 w-full xl:w-auto shrink-0 flex-wrap xl:flex-nowrap justify-center">
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

                    {/* Apply & Clear buttons */}
                    <div className="flex gap-2 w-full sm:w-auto pt-1 sm:pt-0 shrink-0">
                        <button
                            onClick={fetchLogs}
                            className="flex-1 sm:flex-none bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus:outline-none shadow-sm"
                        >
                            APPLY
                        </button>
                        <button
                            onClick={clearFilters}
                            className="flex-1 sm:flex-none bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus:outline-none shadow-sm"
                        >
                            CLEAR
                        </button>
                    </div>

                </div>
            </div>


            {/* Solid Table View - scroll container with sticky headers */}
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 shadow-sm rounded-xl relative">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
                            <tr className="text-slate-700">
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">Timestamp</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">User Info</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">Roles</th>
                                {activeTab === 'gateLogs' ? (
                                    <>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">Department</th>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px] text-center">Action</th>
                                    </>
                                ) : (
                                    <>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">Academic Info</th>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">Event Name</th>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">Status</th>
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
                                                <td className="px-3 py-1.5 text-slate-600 text-xs font-semibold">
                                                    {log.department_name || (log.roles?.some(r => r.toLowerCase() === 'visitor') ? "N/A" : "-")}
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
                                                            {log.department_name || (log.roles?.some(r => r.toLowerCase() === 'visitor') ? "N/A" : "-")}
                                                        </span>
                                                        <span className="text-[10px] text-slate-500 uppercase tracking-tight">
                                                            {log.program_name ? `${log.program_name} ${log.year_level ? `- Year ${log.year_level}` : ""}` : (log.roles?.some(r => r.toLowerCase() === 'visitor') ? "Visitor" : (log.roles?.every(r => r.toLowerCase() !== 'student') ? (log.department_name ? "Faculty/Staff" : "-") : "-"))}
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
                                    <td colSpan="5" className="p-8 text-center text-slate-500">
                                        {loading ? "Loading logs..." : "No access logs found matching your criteria."}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer: counts + pagination (only when records > items per page) */}
                <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 flex flex-wrap items-center justify-between gap-3 shrink-0">
                    <div>
                        Showing {paginatedLogs.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredLogs.length)} of {filteredLogs.length} (Total: {currentData.length})
                    </div>
                    {showPagination && (
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
                                        ? 'bg-slate-800 text-white border-slate-800'
                                        : 'border-slate-200 bg-white hover:bg-slate-50'
                                        }`}
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
                    )}
                </div>
            </div>
        </div>
    );
};
