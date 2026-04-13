import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileText, Search, RefreshCw, Filter, Calendar, Download, FileSpreadsheet, Loader2, ChevronLeft, ChevronRight, Eye, X } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import logoUrl from '../../../imgs/plp-logo.png';
import { useToast } from '../toast/ToastProvider';

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
const SHORT_SUMMARIES = {
    accounts: { INSERT: 'Created new account', UPDATE: 'Updated an account', DELETE: 'Removed an account' },
    persons:  { INSERT: 'Registered new user', UPDATE: 'Updated user profile', DELETE: 'Removed a user' },
    students: { INSERT: 'Enrolled a student', UPDATE: 'Updated student record', DELETE: 'Removed a student' },
    employees:{ INSERT: 'Added an employee', UPDATE: 'Updated employee record', DELETE: 'Removed an employee' },
    visitors: { INSERT: 'Registered a visitor', UPDATE: 'Updated visitor info', DELETE: 'Removed a visitor' },
    events:   { INSERT: 'Created new event', UPDATE: 'Updated an event', DELETE: 'Removed an event' },
    departments: { INSERT: 'Added department', UPDATE: 'Updated department', DELETE: 'Removed department' },
    programs: { INSERT: 'Added program', UPDATE: 'Updated program', DELETE: 'Removed program' },
    scanners: { INSERT: 'Added scanner', UPDATE: 'Updated scanner', DELETE: 'Removed scanner' },
};

const getShortSummary = (log) => {
    const oldObj = safeParseJSON(log.old_values);
    const newObj = safeParseJSON(log.new_values);

    if (log.action_type === 'UPDATE' && oldObj && newObj) {
        let changedFields = [];
        const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
        for (const key of allKeys) {
            if (isValueDifferent(oldObj[key], newObj[key])) {
                changedFields.push(getFriendlyFieldName(key));
            }
        }
        
        // Clean Summaries: If multiple fields changed, prioritize data over status
        if (changedFields.length > 1) {
            const prioritized = changedFields.filter(f => f !== 'Active Status' && f !== 'Enabled Status');
            if (prioritized.length > 0) changedFields = prioritized;
        }
        
        const fieldStr = changedFields.length > 0 ? changedFields.join(', ') : 'Details';
        
        if (log.target_table === 'persons' || log.target_table === 'students' || log.target_table === 'employees' || log.target_table === 'visitors') {
            const idNum = newObj.id_number || oldObj.id_number || 'User';
            return `Updated ${fieldStr} for ${idNum}`;
        }
        if (log.target_table === 'departments') {
            const code = newObj.department_code || oldObj.department_code || 'Dept';
            return `Changed ${fieldStr} for ${code}`;
        }
        if (log.target_table === 'programs') {
            const code = newObj.program_code || oldObj.program_code || 'Program';
            return `Changed ${fieldStr} for ${code}`;
        }
        if (log.target_table === 'events') {
            const title = newObj.event_name || oldObj.event_name || 'Event';
            return `Changed ${fieldStr} for ${title}`;
        }
        if (log.target_table === 'settings') {
            return `Changed ${fieldStr}`;
        }
    }

    if (log.action_type === 'EXPORT') {
        const obj = newObj || oldObj;
        if (obj && obj.format) {
            return `Exported ${getFriendlyTableName(log.target_table)} to ${obj.format}`;
        }
    }

    // Settings fallback
    if (log.target_table === 'settings') {
        const obj = newObj || oldObj;
        if (obj) {
            if (obj.setting_key === 'system_name' || obj.system_name !== undefined) return 'Changed system name';
            if (obj.setting_key === 'system_logo' || obj.system_logo !== undefined) return 'Changed system logo';
        }
        return log.action_type === 'UPDATE' ? 'Changed a setting' : 'Modified settings';
    }

    const tableSummaries = SHORT_SUMMARIES[log.target_table];
    if (tableSummaries && tableSummaries[log.action_type]) {
        return tableSummaries[log.action_type];
    }

    // Fallback
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
    const friendlyTable = getFriendlyTableName(log.target_table);
    const oldObj = safeParseJSON(log.old_values);
    const newObj = safeParseJSON(log.new_values);

    // If no structured data is available, return a contextual empty-state sentence
    if (!oldObj && !newObj) {
        return getEmptyStateSentence(log);
    }

    switch (log.action_type) {
        case 'UPDATE': {
            if (oldObj && newObj) {
                const changes = [];
                const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
                for (const key of allKeys) {
                    const oldVal = oldObj[key];
                    const newVal = newObj[key];
                    if (isValueDifferent(oldVal, newVal)) {
                        changes.push(
                            `Changed ${getFriendlyFieldName(key)} from '${formatFieldValue(key, oldVal)}' to '${formatFieldValue(key, newVal)}'`
                        );
                    }
                }
                if (changes.length > 0) return changes.join('. ') + '.';
            }
            if (newObj) {
                const entries = Object.entries(newObj).filter(([k]) => k !== 'password_hash');
                if (entries.length > 0) {
                    const summary = entries.map(([k, v]) => `${getFriendlyFieldName(k)}: '${formatFieldValue(k, v)}'`).join(', ');
                    return `Updated ${friendlyTable} — ${summary}.`;
                }
            }
            return getEmptyStateSentence(log);
        }
        case 'INSERT': {
            if (newObj) {
                const nameField = newObj.full_name || newObj.event_name || newObj.username || newObj.setting_key
                    || (newObj.first_name && newObj.last_name ? `${newObj.first_name} ${newObj.last_name}` : null)
                    || newObj.id_number || newObj.department_name || newObj.program_name || newObj.location_name;
                if (nameField) return `Created new ${friendlyTable}: '${nameField}'.`;
            }
            return getEmptyStateSentence(log);
        }
        case 'DELETE': {
            if (oldObj) {
                const nameField = oldObj.full_name || oldObj.event_name || oldObj.username || oldObj.setting_key
                    || (oldObj.first_name && oldObj.last_name ? `${oldObj.first_name} ${oldObj.last_name}` : null)
                    || oldObj.id_number || oldObj.department_name || oldObj.program_name || oldObj.location_name;
                if (nameField) return `Removed ${friendlyTable}: '${nameField}'.`;
            }
            return getEmptyStateSentence(log);
        }
        default:
            return getEmptyStateSentence(log);
    }
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

    const handleExportPDF = async () => {
        if (filteredLogs.length === 0) return;
        setIsExporting(true);
        setShowExportMenu(false);
        showProcessing("Preparing PDF export...");

        try {
            const doc = new jsPDF('landscape'); // Use landscape for more columns

            // Load logo image as base64 or draw directly
            const img = new Image();
            img.src = (branding && branding.system_logo && branding.system_logo !== "") ? branding.system_logo : logoUrl;

            // We use a promise to ensure image loads before drawing it
            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = reject;
            });

            doc.addImage(img, 'PNG', 14, 10, 24, 24); // x, y, width, height

            const pageWidth = doc.internal.pageSize.getWidth();

            // Store metadata string upfront
            let dateRangeStr = "All Time";
            if (startDate && endDate) dateRangeStr = `${startDate} To ${endDate}`;
            else if (startDate) dateRangeStr = `From ${startDate}`;
            else if (endDate) dateRangeStr = `Up to ${endDate}`;

            const generatedDate = new Date().toLocaleString();

            const drawHeader = (data) => {
                // University Name
                doc.setFont("helvetica", "bold");
                doc.setFontSize(18);
                doc.setTextColor(15, 23, 42); // slate-900
                const uniName = (branding && branding.system_name) ? branding.system_name : "Pamantasan ng Lungsod ni Roi";
                doc.text(uniName, pageWidth / 2, 18, { align: "center" });

                // System Name
                doc.setFontSize(14);
                const sysName = "Smart Gate";
                doc.text(sysName, pageWidth / 2, 26, { align: "center" });

                // Report Type
                doc.setFontSize(12);
                doc.setTextColor(71, 85, 105); // slate-600
                doc.text("System Audit Report", pageWidth / 2, 34, { align: "center" });

                // Left-aligned Metadata below header
                doc.setFont("helvetica", "normal");
                doc.setFontSize(10);
                doc.setTextColor(100, 116, 139); // slate-500
                doc.text(`Reporting Period: ${dateRangeStr}`, 14, 44);
                doc.text(`Document generated on: ${generatedDate}`, 14, 50);

                // Horizontal Line Divider
                doc.setDrawColor(203, 213, 225); // slate-300
                doc.setLineWidth(0.5);
                doc.line(14, 54, pageWidth - 14, 54);
            };

            // Draw header manually for the very first page before table generation
            drawHeader();

            // Table Data
            const tableColumn = ["Timestamp", "Admin", "Action", "Target Table", "Target ID", "Details"];
            const tableRows = [];

            filteredLogs.forEach(log => {
                tableRows.push([
                    formatDate(log.created_at),
                    log.admin_username,
                    log.action_type,
                    log.target_table,
                    log.target_id || '-',
                    getShortSummary(log)
                ]);
            });

            // Generate Table
            autoTable(doc, {
                startY: 60, // Starts below the initial header
                margin: { top: 60 }, // Leaves space for repeated header on multi-page exports
                head: [tableColumn],
                body: tableRows,
                theme: 'striped',
                headStyles: { fillColor: '#1E293B', textColor: '#FFFFFF', fontStyle: 'bold' }, // Charcoal
                bodyStyles: { fontSize: 10 },
                alternateRowStyles: { fillColor: [248, 250, 252] }, // slate-50
                styles: { cellPadding: 3, overflow: 'linebreak' },
                columnStyles: {
                    0: { cellWidth: 'auto' }, // Timestamp
                    1: { cellWidth: 'auto' }, // Admin
                    2: { cellWidth: 'auto', fontStyle: 'bold' }, // Action
                    3: { cellWidth: 'auto' }, // Target Table
                    4: { cellWidth: 'auto' }, // Target ID
                    5: { cellWidth: 80 },     // Details
                },
                didDrawPage: function (data) {
                    // Repeat Header on new pages
                    if (data.pageNumber > 1) {
                        drawHeader(data);
                    }
                },
                didParseCell: function (data) {
                    if (data.section === 'body' && data.column.index === 2) {
                        // Customize action column text colors based on action_type
                        if (data.cell.raw === 'INSERT') {
                            data.cell.styles.textColor = [5, 150, 105]; // emerald-600
                        } else if (data.cell.raw === 'UPDATE') {
                            data.cell.styles.textColor = [217, 119, 6]; // amber-600
                        } else if (data.cell.raw === 'DELETE') {
                            data.cell.styles.textColor = [225, 29, 72]; // rose-600
                        }
                    }
                }
            });

            // Format default filename
            let filename = `PLP_SmartGate_AuditTrail_${new Date().toISOString().slice(0, 10)}`;
            if (startDate && endDate) filename = `PLP_SmartGate_AuditTrail_${startDate}_to_${endDate}`;

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
                        <FileText className="w-8 h-8 text-indigo-600" />
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
            <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col lg:flex-row gap-4">
                {/* Search & Action (Upper row on small screens) */}
                <div className="flex flex-col sm:flex-row gap-4 flex-1">
                    <div className="relative w-full sm:max-w-xs">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-slate-400" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 sm:text-sm transition-all font-medium"
                            placeholder="Search Admin, Table, or Action..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="relative w-full sm:w-48">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Filter className="h-4 w-4 text-slate-400" />
                        </div>
                        <select
                            value={actionFilter}
                            onChange={(e) => setActionFilter(e.target.value)}
                            className="block w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 sm:text-sm transition-all appearance-none cursor-pointer font-medium"
                        >
                            <option value="All">All Actions</option>
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
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="bg-slate-50 border-b border-slate-200 p-6 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-50 rounded-xl border border-indigo-100 text-indigo-600">
                                    <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900">Audit Log Details</h2>
                                    <p className="text-sm text-slate-500">Full record of this system change.</p>
                                </div>
                            </div>
                            <button onClick={() => setShowViewModal(false)} className="text-slate-400 hover:bg-slate-200 hover:text-slate-600 p-2 rounded-xl transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
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
                                                                        {change.oldValue || '-'}
                                                                    </td>
                                                                    <td className={`px-4 py-2 font-mono text-xs whitespace-nowrap ${change.changed ? 'text-emerald-600 font-semibold' : 'text-slate-500'}`}>
                                                                        {change.newValue || '-'}
                                                                    </td>
                                                                </>
                                                            ) : (
                                                                <td className="px-4 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">
                                                                    {change.newValue || change.oldValue || '-'}
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
                    </div>
                </div>
            )}
        </div>
    );
};
