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

// ─── Human-Readable Translator (Dual-Layer) ──────────────────────────────────
// Layer 1: getShortSummary() — concise 3-4 word label for the table column.
// Layer 2: translateAuditLog() — full descriptive sentence for the modal view.

const FRIENDLY_TABLE_NAMES = {
    accounts: 'Administrator Account',
    persons: 'User Profile',
    students: 'Student Record',
    employees: 'Employee Record',
    visitors: 'Visitor Record',
    events: 'Event',
    settings: 'System Setting',
    departments: 'Department',
    programs: 'Program',
    scanners: 'Scanner',
};

const FRIENDLY_FIELD_NAMES = {
    system_name: 'System Name',
    system_logo: 'System Logo',
    full_name: 'Full Name',
    first_name: 'First Name',
    last_name: 'Last Name',
    middle_name: 'Middle Name',
    id_number: 'ID Number',
    email: 'Email',
    contact_number: 'Contact Number',
    role: 'Role',
    username: 'Username',
    password_hash: 'Password',
    is_active: 'Active Status',
    is_first_login: 'First Login Status',
    program_id: 'Program',
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
};

const getFriendlyFieldName = (key) => FRIENDLY_FIELD_NAMES[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const getFriendlyTableName = (table) => FRIENDLY_TABLE_NAMES[table] || table.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const formatFieldValue = (key, value) => {
    if (value === null || value === undefined || value === '') return '(empty)';
    if (key === 'password_hash') return '••••••••';
    if (key === 'is_active' || key === 'is_first_login' || key === 'is_enabled') return value ? 'Yes' : 'No';
    if (key === 'system_logo') return value ? '(image data)' : '(empty)';
    return String(value);
};

const safeParseJSON = (val) => {
    if (!val) return null;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return null; }
};

const isValueDifferent = (o, n) => {
    let oVal = o;
    let nVal = n;
    if (typeof oVal === 'boolean') oVal = oVal ? 1 : 0;
    if (typeof nVal === 'boolean') nVal = nVal ? 1 : 0;
    if (oVal == null) oVal = '';
    if (nVal == null) nVal = '';
    return String(oVal) !== String(nVal);
};

const FIELD_ORDER_WEIGHTS = {
    'Role': 1,
    'ID Number': 2,
    'Last Name': 3,
    'First Name': 4,
    'Middle Name': 5,
    'Email': 6,
    'Contact Number': 7
};

// ─── Layer 1: Short Summary (Table Column) ───────────────────────────────────
// Returns a concise 3-4 word label for the main table's "Details" column.
const getShortSummary = (log) => {
    const oldObj = safeParseJSON(log.old_values);
    const newObj = safeParseJSON(log.new_values);

    if (newObj && typeof newObj.summary === 'string' && newObj.summary.trim()) {
        return newObj.summary;
    }

    const getIdNumber = () => (newObj && newObj.id_number) || (oldObj && oldObj.id_number) || 'User';
    const getUsername = () => (newObj && newObj.username) || (oldObj && oldObj.username) || 'Account';
    const getEventName = () => (newObj && newObj.event_name) || (oldObj && oldObj.event_name) || 'Event';
    const getOriginalEventName = () => (oldObj && oldObj.event_name) || (newObj && newObj.event_name) || 'Event';

    if (log.action_type === 'INSERT') {
        if (['persons', 'students', 'employees', 'visitors'].includes(log.target_table)) {
            return `Registered user: ${getIdNumber()}`;
        }
        if (log.target_table === 'accounts') return `Registered account: ${getUsername()}`;
        if (log.target_table === 'events') return `Created event: ${getEventName()}`;
    }

    if (log.action_type === 'DELETE') {
        if (['persons', 'students', 'employees', 'visitors'].includes(log.target_table)) {
            return `Removed user: ${getIdNumber()}`;
        }
        if (log.target_table === 'accounts') return `Removed account: ${getUsername()}`;
        if (log.target_table === 'events') return `Removed event: ${getEventName()}`;
    }

    if (log.action_type === 'UPDATE') {
        let fieldStr = 'Profile';
        let changedFields = [];

        if (oldObj && newObj) {
            const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
            for (const key of allKeys) {
                if (isValueDifferent(oldObj[key], newObj[key])) {
                    changedFields.push(getFriendlyFieldName(key));
                }
            }
            if (changedFields.length === 1) {
                fieldStr = changedFields[0];
            } else if (changedFields.length > 1) {
                const prioritized = changedFields.filter(f => f !== 'Active Status' && f !== 'Enabled Status');
                fieldStr = prioritized.length === 1 ? prioritized[0] : (log.target_table === 'events' ? 'Event Details' : (log.target_table === 'accounts' ? 'Account' : 'Profile'));
            } else {
                fieldStr = 'Details';
            }
        }

        if (['persons', 'students', 'employees', 'visitors'].includes(log.target_table)) {
            return `Updated ${fieldStr} for ${getIdNumber()}`;
        }
        if (log.target_table === 'accounts') {
            return `Updated ${fieldStr} for ${getUsername()}`;
        }
        if (log.target_table === 'events') {
            if (changedFields.includes('Event Name')) return `Updated Event Name for ${getOriginalEventName()}`;
            return `Updated ${fieldStr} for ${getOriginalEventName()}`;
        }
        if (log.target_table === 'departments') {
            const code = (newObj && newObj.department_code) || (oldObj && oldObj.department_code) || 'Dept';
            return `Updated ${changedFields.length === 1 ? changedFields[0] : 'Department'} for ${code}`;
        }
        if (log.target_table === 'programs') {
            const code = (newObj && newObj.program_code) || (oldObj && oldObj.program_code) || 'Program';
            return `Updated ${changedFields.length === 1 ? changedFields[0] : 'Program'} for ${code}`;
        }
        if (log.target_table === 'settings') {
            if (changedFields.includes('System Name')) return 'Updated System Name';
            if (changedFields.includes('System Logo')) return 'Updated System Logo';
            return `Changed System Settings`;
        }
    }

    if (log.action_type === 'EXPORT') {
        const obj = newObj || oldObj;
        if (obj && obj.format) {
            return `Exported ${getFriendlyTableName(log.target_table)} to ${obj.format}`;
        }
    }

    const friendlyTable = getFriendlyTableName(log.target_table).toLowerCase();
    switch (log.action_type) {
        case 'INSERT': return `Created ${friendlyTable}`;
        case 'UPDATE': return `Updated ${friendlyTable}`;
        case 'DELETE': return `Removed ${friendlyTable}`;
        case 'EXPORT': return `Exported ${friendlyTable}`;
        default: return 'System change';
    }
};

// ─── Layer 2: Full Translator (Modal View) ───────────────────────────────────
// Returns a complete, human-readable description for the View Details modal.
// Handles N/A / empty details gracefully with contextual fallback sentences.
const EMPTY_STATE_SENTENCES = {
    accounts: {
        INSERT: 'A new administrative account was successfully created in the system.',
        UPDATE: 'An existing administrator account was modified.',
        DELETE: 'An administrator account was permanently removed from the system.',
    },
    persons: {
        INSERT: 'A new user profile was successfully registered in the database.',
        UPDATE: 'An existing user profile was updated with new information.',
        DELETE: 'A user profile was permanently deleted from the system.',
    },
    students: {
        INSERT: 'A new student record was successfully added to the database.',
        UPDATE: 'An existing student record was updated.',
        DELETE: 'A student record was permanently removed from the system.',
    },
    employees: {
        INSERT: 'A new employee record was successfully added to the database.',
        UPDATE: 'An existing employee record was updated.',
        DELETE: 'An employee record was permanently removed from the system.',
    },
    visitors: {
        INSERT: 'A new visitor was successfully registered in the system.',
        UPDATE: 'An existing visitor record was updated.',
        DELETE: 'A visitor record was removed from the system.',
    },
    events: {
        INSERT: 'A new event was successfully created in the system.',
        UPDATE: 'An existing event configuration was modified.',
        DELETE: 'An event was permanently removed from the system.',
    },
    settings: {
        INSERT: 'A new system setting was added.',
        UPDATE: 'A system configuration setting was changed.',
        DELETE: 'A system setting was removed.',
    },
};

const getEmptyStateSentence = (log) => {
    const tableFallbacks = EMPTY_STATE_SENTENCES[log.target_table];
    if (tableFallbacks && tableFallbacks[log.action_type]) {
        return tableFallbacks[log.action_type];
    }
    const friendlyTable = getFriendlyTableName(log.target_table);
    switch (log.action_type) {
        case 'INSERT': return `A new record was successfully added to ${friendlyTable}.`;
        case 'UPDATE': return `An existing record in ${friendlyTable} was modified.`;
        case 'DELETE': return `A record was permanently removed from ${friendlyTable}.`;
        default: return `A system operation was performed on ${friendlyTable}.`;
    }
};

const translateAuditLog = (log) => {
    const oldObj = safeParseJSON(log.old_values);
    const newObj = safeParseJSON(log.new_values);

    // If no structured data is available, return a contextual empty-state sentence
    if (!oldObj && !newObj) {
        return getEmptyStateSentence(log);
    }

    const summary = getShortSummary(log);
    return summary.endsWith('.') ? summary : `${summary}.`;
};

// Produces an array of { field, oldValue, newValue } change items for the modal
const getDetailedChanges = (log) => {
    const oldObj = safeParseJSON(log.old_values);
    const newObj = safeParseJSON(log.new_values);

    let changes = [];

    if (log.action_type === 'UPDATE' && oldObj && newObj) {
        const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
        for (const key of allKeys) {
            changes.push({
                field: getFriendlyFieldName(key),
                oldValue: formatFieldValue(key, oldObj[key]),
                newValue: formatFieldValue(key, newObj[key]),
                changed: isValueDifferent(oldObj[key], newObj[key]),
            });
        }
    } else if (log.action_type === 'INSERT' && newObj) {
        changes = Object.entries(newObj).map(([key, val]) => ({
            field: getFriendlyFieldName(key),
            oldValue: null,
            newValue: formatFieldValue(key, val),
            changed: true,
        }));
    } else if (log.action_type === 'DELETE' && oldObj) {
        changes = Object.entries(oldObj).map(([key, val]) => ({
            field: getFriendlyFieldName(key),
            oldValue: formatFieldValue(key, val),
            newValue: null,
            changed: true,
        }));
    }

    changes.sort((a, b) => {
        const orderA = FIELD_ORDER_WEIGHTS[a.field] || 99;
        const orderB = FIELD_ORDER_WEIGHTS[b.field] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.field.localeCompare(b.field);
    });

    return changes;
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
            console.log("Audit Logs:", data);
            setLogs(data);
        } catch (error) {
            console.error("Failed to fetch audit logs:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const filteredLogs = logs.filter(log => {
        const matchesSearch = log.admin_username.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.target_table.toLowerCase().includes(searchTerm.toLowerCase()) ||
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

    const handleExportExcel = async () => {
        if (filteredLogs.length === 0) return;
        setIsExporting(true);
        setShowExportMenu(false);
        showProcessing("Preparing Excel export...");

        try {
            const exportData = filteredLogs.map(log => ({
                'Timestamp': formatDate(log.created_at),
                'Admin': log.admin_username,
                'Action': log.action_type,
                'Target Table': log.target_table,
                'Target ID': log.target_id || '-',
                'Details': getShortSummary(log)
            }));

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Audit Trail");

            // Format default filename
            let filename = `AuditTrail_${new Date().toISOString().slice(0, 10)}`;
            if (startDate && endDate) filename = `AuditTrail_${startDate}_to_${endDate}`;

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
                targetTable: 'audit_logs',
                targetId: null,
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

    // ─── Resolve target_id to a human-readable name ────────────────────────────
    const resolveTargetName = (log) => {
        const oldObj = safeParseJSON(log.old_values);
        const newObj = safeParseJSON(log.new_values);
        const obj = newObj || oldObj;
        if (!obj) return '-';

        // Try the most descriptive identifiers in order of priority
        if (obj.full_name) return obj.full_name;
        if (obj.first_name && obj.last_name) return `${obj.first_name} ${obj.last_name}`;
        if (obj.username) return obj.username;
        if (obj.event_name) return obj.event_name;
        if (obj.id_number) return obj.id_number;
        if (obj.department_code) return obj.department_code;
        if (obj.department_name) return obj.department_name;
        if (obj.program_code) return obj.program_code;
        if (obj.program_name) return obj.program_name;
        if (obj.location_name) return obj.location_name;
        if (obj.setting_key) return obj.setting_key;
        if (obj.system_name) return obj.system_name;

        // For EXPORT actions, show format info
        if (log.action_type === 'EXPORT' && obj.format) return `${obj.format} Export`;

        return '-';
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

            // Table Data — human-readable columns
            const tableColumn = ["Timestamp", "Admin", "Action", "Category", "Target", "Details"];
            const tableRows = [];

            filteredLogs.forEach(log => {
                tableRows.push([
                    formatDate(log.created_at),
                    log.admin_username,
                    log.action_type,
                    getFriendlyTableName(log.target_table),
                    resolveTargetName(log),
                    getShortSummary(log)
                ]);
            });

            // Generate Table — matches Access Logs formatting
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
                    0: { cellWidth: 'auto' }, // Timestamp
                    1: { cellWidth: 'auto' }, // Admin
                    2: { cellWidth: 'auto', fontStyle: 'bold' }, // Action
                    3: { cellWidth: 'auto' }, // Category
                    4: { cellWidth: 'auto' }, // Target
                    5: { cellWidth: 'auto' }, // Details
                },
                didDrawPage: function (data) {
                    drawHeader();
                },
                didParseCell: function (data) {
                    if (data.section === 'body' && data.column.index === 2) {
                        if (data.cell.raw === 'INSERT') {
                            data.cell.styles.textColor = [5, 150, 105];
                        } else if (data.cell.raw === 'UPDATE') {
                            data.cell.styles.textColor = [217, 119, 6];
                        } else if (data.cell.raw === 'DELETE') {
                            data.cell.styles.textColor = [225, 29, 72];
                        }
                    }
                }
            });

            // Formatted dynamic filename — matches Access Logs naming convention
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
                targetTable: 'audit_logs',
                targetId: null,
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
        <div className="flex flex-col h-full min-h-0 gap-6 animate-in slide-in-from-bottom-4 duration-500 relative">

            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <ShieldAlert className="w-8 h-8 text-emerald-500" />
                        Audit Trail
                    </h1>
                    <p className="text-slate-500 mt-1">Read-only log of all system configuration changes.</p>
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
                {/* Search & Action (Upper row on small screens) */}
                <div className="flex flex-col sm:flex-row gap-2 items-center flex-1">
                    <div className="relative w-full sm:w-80">
                        <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            className="block w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-medium"
                            placeholder="Search Admin, Table, or Action..."
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
                            <option value="INSERT">INSERT</option>
                            <option value="UPDATE">UPDATE</option>
                            <option value="DELETE">DELETE</option>
                        </select>
                    </div>
                </div>

                {/* Date Filters (Lower row on small screens) */}
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
                        className="px-4 py-2 bg-indigo-50 text-indigo-600 font-medium rounded-lg border border-indigo-100 hover:bg-indigo-100 transition-colors text-sm whitespace-nowrap"
                    >
                        Apply Date
                    </button>
                </div>
            </div>

            {/* Table View - scroll container with sticky headers (solid enterprise) */}
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 shadow-sm rounded-xl relative">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
                            <tr className="text-slate-600">
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Timestamp</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Admin</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Action</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Target Table</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Details</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedLogs.length > 0 ? (
                                paginatedLogs.map((log) => (
                                    <tr key={log.audit_id} className="hover:bg-slate-50 transition-colors group">
                                        <td className="px-5 py-3 text-slate-600 whitespace-nowrap font-mono text-xs">
                                            {formatDate(log.created_at)}
                                        </td>
                                        <td className="px-5 py-3 font-semibold text-slate-900">
                                            {log.admin_username}
                                        </td>
                                        <td className="px-5 py-3">
                                            <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${log.action_type === 'INSERT' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                                log.action_type === 'UPDATE' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                                    log.action_type === 'DELETE' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                                                        'bg-slate-100 text-slate-700 border-slate-200'
                                                }`}>
                                                {log.action_type}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-slate-600 font-medium">
                                            {getFriendlyTableName(log.target_table)}
                                        </td>
                                        <td className="px-5 py-3 text-slate-600 text-sm">
                                            {getShortSummary(log)}
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

                {/* Footer: counts + pagination (only when records > items per page) */}
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
                    subtitle="Full record of this system change."
                    icon={<FileText className="w-5 h-5 text-slate-300" />}
                    tone="light"
                    size="lg"
                    bodyClassName="space-y-6"
                >
                    <div className="space-y-6">
                            {/* Meta Info Grid */}
                            <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                                <div>
                                    <p className="text-slate-500 mb-1 text-xs uppercase tracking-wider font-semibold">Log ID</p>
                                    <p className="font-semibold text-slate-900 font-mono">{selectedLog.audit_id}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 mb-1 text-xs uppercase tracking-wider font-semibold">Performed By</p>
                                    <p className="font-semibold text-slate-900">{selectedLog.admin_full_name}</p>
                                    <p className="text-slate-400 text-xs font-mono">@{selectedLog.admin_username} · ID #{selectedLog.admin_id}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 mb-1 text-xs uppercase tracking-wider font-semibold">Action</p>
                                    <span className={`inline-flex px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${selectedLog.action_type === 'INSERT' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                        selectedLog.action_type === 'UPDATE' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                            selectedLog.action_type === 'DELETE' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                                                'bg-slate-100 text-slate-700 border-slate-200'
                                        }`}>
                                        {selectedLog.action_type}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-slate-500 mb-1 text-xs uppercase tracking-wider font-semibold">Timestamp</p>
                                    <p className="font-semibold text-slate-900 font-mono text-xs">{formatDate(selectedLog.created_at)}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 mb-1 text-xs uppercase tracking-wider font-semibold">Target Table</p>
                                    <p className="font-semibold text-slate-900">{getFriendlyTableName(selectedLog.target_table)} <span className="text-slate-400 font-mono text-xs">({selectedLog.target_table})</span></p>
                                </div>
                                <div>
                                    <p className="text-slate-500 mb-1 text-xs uppercase tracking-wider font-semibold">Target ID</p>
                                    <p className="font-semibold text-slate-900 font-mono">{selectedLog.target_id || '-'}</p>
                                </div>
                            </div>

                            {/* Human-Readable Summary */}
                            <div className="border-t border-slate-100 pt-5">
                                <p className="text-slate-500 mb-2 text-xs uppercase tracking-wider font-semibold">Summary</p>
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                                    <p className="text-sm text-slate-800 leading-relaxed font-medium">
                                        {translateAuditLog(selectedLog)}
                                    </p>
                                </div>
                            </div>

                            {/* Detailed Changes Table */}
                            {(() => {
                                const changes = getDetailedChanges(selectedLog);
                                if (changes.length === 0) return null;
                                return (
                                    <div className="border-t border-slate-100 pt-5">
                                        <p className="text-slate-500 mb-3 text-xs uppercase tracking-wider font-semibold">
                                            {selectedLog.action_type === 'UPDATE' ? 'Field Changes' : selectedLog.action_type === 'INSERT' ? 'New Values' : 'Removed Values'}
                                        </p>
                                        <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-slate-50 border-b border-slate-200">
                                                    <tr className="text-xs uppercase text-slate-500">
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
                                                <tbody className="divide-y divide-slate-100">
                                                    {changes.map((change, idx) => (
                                                        <tr key={idx} className={change.changed ? 'bg-amber-50/40' : ''}>
                                                            <td className="px-4 py-2 font-medium text-slate-700 whitespace-nowrap">{change.field}</td>
                                                            {selectedLog.action_type === 'UPDATE' ? (
                                                                <>
                                                                    <td className={`px-4 py-2 font-mono text-xs whitespace-nowrap ${change.changed ? 'text-rose-600 line-through' : 'text-slate-500'}`}>
                                                                        <div className="max-w-[150px] sm:max-w-[220px] overflow-x-auto pb-1 [scrollbar-width:thin]">
                                                                            {change.oldValue || '-'}
                                                                        </div>
                                                                    </td>
                                                                    <td className={`px-4 py-2 font-mono text-xs whitespace-nowrap ${change.changed ? 'text-emerald-600 font-semibold' : 'text-slate-500'}`}>
                                                                        <div className="max-w-[150px] sm:max-w-[220px] overflow-x-auto pb-1 [scrollbar-width:thin]">
                                                                            {change.newValue || '-'}
                                                                        </div>
                                                                    </td>
                                                                </>
                                                            ) : (
                                                                <td className="px-4 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">
                                                                    <div className="max-w-[150px] sm:max-w-[300px] overflow-x-auto pb-1 [scrollbar-width:thin]">
                                                                        {change.newValue || change.oldValue || '-'}
                                                                    </div>
                                                                </td>
                                                            )}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })()}
                    </div>
                </AdminModal>
            )}
        </div>
    );
};
