import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ShieldAlert, FileText, Search, RefreshCw, Filter, Calendar, Download, FileSpreadsheet, Loader2, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useToast } from '../toast/ToastProvider';
import { drawInstitutionalHeader, prepareInstitutionalHeaderAssets } from '../../utils/pdfInstitutionalHeader';
import { AdminModal } from '../common/AdminModal';

// ─── Human-Readable Translator ───────────────────────────────────────────────

const FRIENDLY_FIELD_NAMES = {
    system_name: 'System Name',
    system_logo: 'System Logo',
    full_name: 'Full Name',
    first_name: 'First Name',
    last_name: 'Last Name',
    middle_name: 'Middle Name',
    id_number: 'ID Number',
    email: 'Email',
    emails: 'Emails',
    contact_number: 'Contact Number',
    phones: 'Contact Numbers',
    role: 'Role',
    roles: 'Roles',
    username: 'Username',
    password_hash: 'Password',
    is_active: 'Active Status',
    is_first_login: 'First Login Status',
    program: 'Program',
    program_id: 'Program',
    department: 'Department',
    department_id: 'Department',
    year_level: 'Year Level',
    position_title: 'Position Title',
    purpose_of_visit: 'Purpose of Visit',
    person_to_visit: 'Person to Visit',
    event_name: 'Event Name',
    event_date: 'Event Date',
    start_time: 'Start Time',
    end_time: 'End Time',
    required_role: 'Required Role',
    is_enabled: 'Enabled Status',
    location_name: 'Location Name',
    function: 'Function',
    setting_key: 'Setting Key',
    setting_value: 'Setting Value',
    activation_otp: 'Activation OTP',
    activation_otp_expires_at: 'OTP Expiration',
    day_of_week: 'Day of Week',
    start_date: 'Start Date',
    end_date: 'End Date',
    is_irregular: 'Irregular Status',
    purpose_of_visit: 'Purpose of Visit',
    person_to_visit: 'Person to Visit',
};

const getFriendlyFieldName = (key) => FRIENDLY_FIELD_NAMES[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const formatFieldValue = (key, value) => {
    if (value === null || value === undefined || value === '' || value === 'null' || value === 'N/A') return '---';
    if (key === 'password_hash') return '••••••••';
    if (key === 'is_active' || key === 'is_first_login' || key === 'is_enabled' || key === 'is_archived') {
        if (value === '1' || value === 1 || value === true || value === 'true') return 'Yes';
        if (value === '0' || value === 0 || value === false || value === 'false') return 'No';
    }
    if (key === 'system_logo' || key === 'primary_logo' || key === 'secondary_logo_1' || key === 'secondary_logo_2') return value ? '(image data)' : '---';
    return String(value);
};

const FIELD_ORDER_WEIGHTS = {
    'Role': 1,
    'Roles': 1,
    'Username': 1.1,
    'Full Name': 1.2,
    'ID Number': 2,
    'Last Name': 3,
    'First Name': 4,
    'Middle Name': 5,
    'Email': 6,
    'Emails': 6,
    'Contact Number': 7,
    'Contact Numbers': 7,
    'Department': 8,
    'Program': 9,
    'Year Level': 10,
    'Irregular Status': 11,
    'Position Title': 12,
    'Purpose of Visit': 13,
    'Person to Visit': 14,
    'Event Name': 20,
    'Description': 21,
    'Day of Week': 22,
    'Start Date': 23,
    'End Date': 24,
    'Start Time': 25,
    'End Time': 26,
    'Required Role': 27,
    'Active Status': 30,
    'Status': 30,
    'Enabled Status': 30,
};

// ─── Component ───────────────────────────────────────────────────────────────
export const AuditTrail = ({ branding, adminSession }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionFilter, setActionFilter] = useState('All');

    // Date Filtering State
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Pagination
    const ITEMS_PER_PAGE = 15;
    const [currentPage, setCurrentPage] = useState(1);

    // View Modal
    const [showViewModal, setShowViewModal] = useState(false);
    const [selectedLog, setSelectedLog] = useState(null);

    // Export State & UX
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const exportMenuRef = useRef(null);
    const { showSuccess, showError, showWarning, showProcessing } = useToast();

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

    const clearFilters = () => {
        setSearchTerm('');
        setActionFilter('All');
        setStartDate('');
        setEndDate('');
        setCurrentPage(1);
        invoke('get_audit_logs', { startDate: null, endDate: null })
            .then(data => setLogs(data))
            .catch(err => console.error(err));
    };

    const fetchLogs = async () => {
        // Validation
        if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
            showWarning('Invalid Date Range: End Date must be after Start Date.');
            return;
        }

        setLoading(true);
        try {
            const data = await invoke('get_audit_logs', {
                startDate: startDate || null,
                endDate: endDate || null
            });
            console.log("Audit Logs (Normalized):", data);
            setLogs(data);
        } catch (error) {
            console.error("Failed to fetch audit logs:", error);
            showError("Failed to load audit logs.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const filteredLogs = logs.filter(log => {
        const matchesSearch =
            log.admin_username.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.admin_full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.entity_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.entity_label.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.action_type.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesAction = actionFilter === 'All' || log.action_type === actionFilter;
        return matchesSearch && matchesAction;
    });

    // Pagination - reset to page 1 when filters change
    useEffect(() => { setCurrentPage(1); }, [searchTerm, actionFilter, startDate, endDate]);
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

    const handleViewClick = (log) => {
        setSelectedLog(log);
        setShowViewModal(true);
    };

    const getShortSummary = (log) => {
        const action = log.action_type.toLowerCase();
        const type = log.entity_type;
        const label = log.entity_label;

        // Extract key fields for a more descriptive summary (especially for exports)
        const findValue = (field) => {
            const change = log.changes.find(c => c.field_name === field);
            return change?.new_value || change?.old_value;
        };

        const idNum = findValue('id_number');
        const program = findValue('program');
        const department = findValue('department');

        let meta = "";
        if (idNum) meta += `ID: ${idNum}`;
        if (program) meta += (meta ? " | " : "") + `Prog: ${program}`;
        if (department) meta += (meta ? " | " : "") + `Dept: ${department}`;
        const suffix = meta ? ` (${meta})` : '';

        if (action === 'create') return `Created ${type}: ${label}${suffix}`;
        if (action === 'archive') return `Moved ${type} to Archive: ${label}${suffix}`;
        if (action === 'restore') return `Restored ${type} from Archive: ${label}${suffix}`;
        if (action === 'delete') return `Permanently Deleted ${type}: ${label}${suffix}`;
        if (action === 'update') {
            const changeCount = log.changes.length;
            if (changeCount === 0) return `Updated ${type}: ${label}`;
            if (changeCount === 1) {
                return `Updated ${getFriendlyFieldName(log.changes[0].field_name)} for ${label}`;
            }
            return `Updated ${changeCount} fields for ${label}`;
        }
        return `${log.action_type} action on ${type}: ${label}`;
    };

    const handleExportExcel = async () => {
        if (filteredLogs.length === 0) return;
        setIsExporting(true);
        setShowExportMenu(false);
        showProcessing("Preparing Excel export...");

        try {
            const exportData = filteredLogs.map(log => ({
                'Timestamp': formatDate(log.created_at),
                'Performed By': `${log.admin_full_name} (@${log.admin_username})`,
                'Action': log.action_type,
                'Entity Type': log.entity_type,
                'Entity Label': log.entity_label,
                'Details': getShortSummary(log)
            }));

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Audit Trail");

            let filename = `AuditTrail_${new Date().toISOString().slice(0, 10)}`;
            if (startDate && endDate) filename = `AuditTrail_${startDate}_to_${endDate}`;

            const filePath = await save({
                defaultPath: `${filename}.xlsx`,
                filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
            });

            if (!filePath) {
                showWarning("Export cancelled.");
                return;
            }

            const excelBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
            await writeFile(filePath, new Uint8Array(excelBuffer));

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

            let dateRangeStr = "All Time";
            if (startDate && endDate) dateRangeStr = `${startDate} To ${endDate}`;
            else if (startDate) dateRangeStr = `From ${startDate}`;
            else if (endDate) dateRangeStr = `Up to ${endDate}`;

            const generatedDate = new Date().toLocaleString();

            const drawHeader = () => {
                const layout = drawInstitutionalHeader(doc, {
                    branding,
                    logos: headerAssets.logos,
                    contactIcons: headerAssets.contactIcons,
                    reportTitle: 'Audit Trail',
                    officeName: 'Office of the Human Resource Development',
                });
                layout.setBodyFont?.();
                doc.setFontSize(8.5);
                doc.setTextColor(90, 90, 90);
                doc.text(`Reporting Period: ${dateRangeStr}`, layout.margin, layout.contentStartY - 1.5);
                doc.text(`Generated: ${generatedDate}`, doc.internal.pageSize.getWidth() - layout.margin, layout.contentStartY - 1.5, { align: "right" });
                return layout;
            };
            const headerLayout = drawHeader();

            const tableColumn = ["Timestamp", "Admin", "Action", "Category", "Target", "Details"];
            const tableRows = [];

            filteredLogs.forEach(log => {
                tableRows.push([
                    formatDate(log.created_at),
                    log.admin_username,
                    log.action_type,
                    log.entity_type,
                    log.entity_label,
                    getShortSummary(log)
                ]);
            });

            autoTable(doc, {
                startY: headerLayout.contentStartY + 2,
                margin: { top: headerLayout.contentStartY + 2, left: headerLayout.margin, right: headerLayout.margin },
                head: [tableColumn],
                body: tableRows,
                theme: 'striped',
                headStyles: { fillColor: '#1E293B', textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 9, font: 'helvetica' },
                bodyStyles: { fontSize: 8.5, font: 'helvetica' },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                styles: { cellPadding: 2, overflow: 'linebreak', font: 'helvetica' },
                columnStyles: {
                    0: { cellWidth: 35 }, // Timestamp
                    1: { cellWidth: 25 }, // Admin
                    2: { cellWidth: 20, fontStyle: 'bold' }, // Action
                    3: { cellWidth: 25 }, // Category
                    4: { cellWidth: 35 }, // Target
                    5: { cellWidth: 'auto' }, // Details
                },
                didDrawPage: function (data) {
                    drawHeader();
                },
                didParseCell: function (data) {
                    if (data.section === 'body' && data.column.index === 2) {
                        const action = data.cell.raw;
                        if (action === 'CREATE') {
                            data.cell.styles.textColor = [5, 150, 105]; // Emerald
                        } else if (action === 'UPDATE') {
                            data.cell.styles.textColor = [217, 119, 6]; // Amber
                        } else if (action === 'ARCHIVE') {
                            data.cell.styles.textColor = [249, 115, 22]; // Orange
                        } else if (action === 'RESTORE') {
                            data.cell.styles.textColor = [79, 70, 229]; // Indigo
                        } else if (action === 'DELETE') {
                            data.cell.styles.textColor = [225, 29, 72]; // Rose
                        }
                    }
                }
            });

            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            const formattedTime = `${String(hours).padStart(2, '0')}.${minutes}${ampm}`;
            const filename = `AuditTrail_${yyyy}-${mm}-${dd}_${formattedTime}`;

            const pdfBuffer = doc.output('arraybuffer');
            const filePath = await save({
                defaultPath: `${filename}.pdf`,
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
            });

            if (!filePath) {
                showWarning("Export cancelled.");
                return;
            }

            await writeFile(filePath, new Uint8Array(pdfBuffer));
            showSuccess(`Success: Report saved to ${filePath}`);
        } catch (error) {
            console.error("PDF export failed", error);
            showError("An error occurred during export.");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 gap-6 animate-in slide-in-from-bottom-4 duration-500 relative">

            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <ShieldAlert className="w-8 h-8 text-emerald-500" />
                        Audit Trail
                    </h1>
                    <p className="text-slate-500 mt-1">Normalized, field-level system activity logs.</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative" ref={exportMenuRef}>
                        <button
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            disabled={isExporting}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg border shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-slate-500/50 ${isExporting
                                ? 'bg-slate-700 border-slate-600 text-slate-300 cursor-not-allowed'
                                : 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700'
                                }`}
                        >
                            {isExporting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Download className="w-4 h-4" />
                            )}
                            <span className="font-semibold text-sm">
                                {isExporting ? 'Generating...' : 'Export'}
                            </span>
                        </button>

                        {showExportMenu && !isExporting && (
                            <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
                                <button
                                    onClick={handleExportPDF}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100"
                                >
                                    <FileText className="w-4 h-4 text-red-500" />
                                    Export as PDF
                                </button>
                                <button
                                    onClick={handleExportExcel}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                    <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                                    Export as Excel
                                </button>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={fetchLogs}
                        className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        title="Refresh Logs"
                    >
                        <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Filter Section  */}
            <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col lg:flex-row gap-4">
                <div className="flex flex-col sm:flex-row gap-2 items-center flex-1">
                    <div className="relative w-full sm:w-80">
                        <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            className="block w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-medium"
                            placeholder="Search Admin, Category, or Label..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-48">
                        <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                        <select
                            value={actionFilter}
                            onChange={(e) => setActionFilter(e.target.value)}
                            className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                        >
                            <option value="All">Action: All</option>
                            <option value="CREATE">CREATE</option>
                            <option value="UPDATE">UPDATE</option>
                            <option value="ARCHIVE">ARCHIVE</option>
                            <option value="RESTORE">RESTORE</option>
                            <option value="DELETE">DELETE</option>
                        </select>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 lg:border-l lg:border-slate-200 lg:pl-4">
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-500 font-medium">From</span>
                    </div>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 sm:text-sm font-medium"
                    />
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500 font-medium">To</span>
                    </div>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 sm:text-sm font-medium"
                    />
                    <button
                        onClick={fetchLogs}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-semibold text-sm shadow-sm"
                    >
                        Apply Date
                    </button>
                    <button
                        onClick={clearFilters}
                        className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                    >
                        Clear All
                    </button>
                </div>
            </div>

            {/* Table View */}
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 shadow-sm rounded-xl relative">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
                            <tr className="text-slate-600">
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Timestamp</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Admin</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Action</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Category</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Target</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedLogs.length > 0 ? (
                                paginatedLogs.map((log) => (
                                    <tr key={log.event_id} className="hover:bg-slate-50 transition-colors group">
                                        <td className="px-5 py-3 text-slate-600 whitespace-nowrap font-mono text-xs">
                                            {formatDate(log.created_at)}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-slate-900">{log.admin_full_name}</span>
                                                <span className="text-xs text-slate-400">@{log.admin_username}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3">
                                            <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${log.action_type === 'CREATE' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                                log.action_type === 'UPDATE' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                                    log.action_type === 'ARCHIVE' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                                        log.action_type === 'RESTORE' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' :
                                                            log.action_type === 'DELETE' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                                                                'bg-slate-100 text-slate-700 border-slate-200'
                                                }`}>
                                                {log.action_type}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-slate-600 font-medium">
                                            {log.entity_type}
                                        </td>
                                        <td className="px-5 py-3 text-slate-600 text-sm">
                                            {log.entity_label}
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <button
                                                className="p-2 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors border border-transparent hover:border-indigo-200 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                title="View Details"
                                                onClick={() => handleViewClick(log)}
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="6" className="p-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center justify-center space-y-3">
                                            <FileText className="w-10 h-10 text-slate-300" />
                                            <p className="text-sm">{loading ? "Loading audit logs..." : "No audit logs found."}</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 flex flex-wrap items-center justify-between gap-3 shrink-0 rounded-b-xl">
                    <div>
                        Showing {paginatedLogs.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredLogs.length)} of {filteredLogs.length} (Total: {logs.length})
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

            {/* View Details Modal */}
            {showViewModal && selectedLog && (
                <AdminModal
                    isOpen={showViewModal}
                    onClose={() => setShowViewModal(false)}
                    title="Audit Log Details"
                    subtitle="Normalized record of this system change."
                    icon={<FileText className="w-5 h-5 text-white" />}
                    tone="default"
                    size="lg"
                    bodyClassName="space-y-6"
                >
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Event ID</p>
                                <p className="font-semibold text-white font-mono">{selectedLog.event_id}</p>
                            </div>
                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Performed By</p>
                                <p className="font-semibold text-white">{selectedLog.admin_full_name}</p>
                                <p className="text-white/30 text-xs font-mono">@{selectedLog.admin_username} · ID #{selectedLog.performed_by}</p>
                            </div>
                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Action</p>
                                <span className={`inline-flex px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${selectedLog.action_type === 'CREATE' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30' :
                                    selectedLog.action_type === 'UPDATE' ? 'bg-amber-500/20 text-amber-300 border-amber-400/30' :
                                        selectedLog.action_type === 'ARCHIVE' ? 'bg-orange-500/20 text-orange-300 border-orange-400/30' :
                                            selectedLog.action_type === 'RESTORE' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30' :
                                                selectedLog.action_type === 'DELETE' ? 'bg-rose-500/20 text-rose-300 border-rose-400/30' :
                                                    'bg-white/5 text-white/50 border-white/10'
                                    }`}>
                                    {selectedLog.action_type}
                                </span>
                            </div>
                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Timestamp</p>
                                <p className="font-semibold text-white font-mono text-xs">{formatDate(selectedLog.created_at)}</p>
                            </div>
                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Entity Type</p>
                                <p className="font-semibold text-white">{selectedLog.entity_type}</p>
                            </div>
                            <div>
                                <p className="text-white/40 mb-1 text-xs uppercase tracking-wider font-semibold">Entity Label</p>
                                <p className="font-semibold text-white">{selectedLog.entity_label} <span className="text-white/30 font-mono text-xs">({selectedLog.entity_id})</span></p>
                            </div>
                        </div>

                        <div className="border-t border-white/10 pt-5">
                            <p className="text-white/40 mb-2 text-xs uppercase tracking-wider font-semibold">Summary</p>
                            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                                <p className="text-sm text-white/90 leading-relaxed font-medium italic">
                                    {getShortSummary(selectedLog)}.
                                </p>
                            </div>
                        </div>

                        {selectedLog.changes && selectedLog.changes.length > 0 && (
                            <div className="border-t border-white/10 pt-5">
                                <p className="text-white/40 mb-3 text-xs uppercase tracking-wider font-semibold">
                                    {selectedLog.action_type === 'UPDATE' ? 'Field Changes' : selectedLog.action_type === 'CREATE' ? 'New Values' : 'Removed Values'}
                                </p>
                                <div className="rounded-xl border border-white/10 overflow-x-auto bg-black/20">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-white/5 border-b border-white/10">
                                            <tr className="text-xs uppercase text-white/40">
                                                <th className="px-4 py-2.5 font-semibold tracking-wider">Field</th>
                                                {selectedLog.action_type === 'UPDATE' ? (
                                                    <>
                                                        <th className="px-4 py-2.5 font-semibold tracking-wider">Old Value</th>
                                                        <th className="px-4 py-2.5 font-semibold tracking-wider">New Value</th>
                                                    </>
                                                ) : (
                                                    <th className="px-4 py-2.5 font-semibold tracking-wider">Value</th>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {[...selectedLog.changes]
                                                .filter(change => {
                                                    const val = change.new_value || change.old_value;
                                                    // Requirement 4: Hide "0" schedule counts, "null", "N/A" and non-applicable fields
                                                    if (change.field_name.includes('schedules') && (val === '0' || val === 0)) return false;
                                                    if (val === null || val === undefined || val === '' || val === 'null' || val === 'N/A' || val === '---') return false;
                                                    if (change.field_name === 'is_irregular' && (val === '0' || val === 0 || val === false || val === 'false')) return false;
                                                    if (change.field_name === 'password_hash' || change.field_name === 'password') return false;
                                                    return true;
                                                })
                                                .sort((a, b) => (FIELD_ORDER_WEIGHTS[getFriendlyFieldName(a.field_name)] || 999) - (FIELD_ORDER_WEIGHTS[getFriendlyFieldName(b.field_name)] || 999))
                                                .map((change, idx) => (

                                                    <tr key={idx}>
                                                        <td className="px-4 py-2 font-medium text-white/80 whitespace-nowrap">
                                                            {getFriendlyFieldName(change.field_name)}
                                                        </td>
                                                        {selectedLog.action_type === 'UPDATE' ? (
                                                            <>
                                                                <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-rose-400 line-through">
                                                                    <div className="max-w-[150px] sm:max-w-[220px] overflow-x-auto pb-1 [scrollbar-width:thin]">
                                                                        {formatFieldValue(change.field_name, change.old_value)}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-emerald-400 font-semibold">
                                                                    <div className="max-w-[150px] sm:max-w-[220px] overflow-x-auto pb-1 [scrollbar-width:thin]">
                                                                        {formatFieldValue(change.field_name, change.new_value)}
                                                                    </div>
                                                                </td>
                                                            </>
                                                        ) : (
                                                            <td className="px-4 py-2 font-mono text-xs text-white/70 whitespace-nowrap">
                                                                <div className="max-w-[150px] sm:max-w-[300px] overflow-x-auto pb-1 [scrollbar-width:thin]">
                                                                    {formatFieldValue(change.field_name, change.new_value || change.old_value)}
                                                                </div>
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </AdminModal>
            )}
        </div>
    );
};
