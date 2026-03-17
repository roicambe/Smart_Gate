import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileText, Search, RefreshCw, Filter, Calendar, Download, FileSpreadsheet, AlertTriangle, CheckCircle, XCircle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import logoUrl from '../../../imgs/plp-logo.png';

export const AuditTrail = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionFilter, setActionFilter] = useState('All');

    // Date Filtering State
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [dateError, setDateError] = useState('');

    // Pagination
    const ITEMS_PER_PAGE = 15;
    const [currentPage, setCurrentPage] = useState(1);

    // Export State & UX
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [toastMessage, setToastMessage] = useState(null);
    const [toastType, setToastType] = useState('success'); // 'success' or 'error'
    const exportMenuRef = useRef(null);

    // Auto-hide toast after 3 seconds
    useEffect(() => {
        if (toastMessage) {
            const timer = setTimeout(() => setToastMessage(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toastMessage]);

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
            setDateError('Invalid Date Range: End Date must be after Start Date.');
            return;
        }
        setDateError('');

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

    const handleExportExcel = async () => {
        if (filteredLogs.length === 0) return;
        setIsExporting(true);
        setShowExportMenu(false);

        try {
            const exportData = filteredLogs.map(log => ({
                'Timestamp': formatDate(log.created_at),
                'Admin': log.admin_username,
                'Action': log.action_type,
                'Target Table': log.target_table,
                'Target ID': log.target_id || '-',
                'Details': log.new_values || log.old_values || 'N/A'
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
                // User cancelled the dialog
                setToastType('error');
                setToastMessage("Export cancelled.");
                return;
            }

            // Write via xlsx to buffer, then to Tauri fs
            const excelBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
            await writeFile(filePath, new Uint8Array(excelBuffer));

            setToastType('success');
            setToastMessage(`Success: Report saved to ${filePath}`);
        } catch (error) {
            console.error("Excel export failed", error);
            setToastType('error');
            setToastMessage("An error occurred during export.");
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPDF = async () => {
        if (filteredLogs.length === 0) return;
        setIsExporting(true);
        setShowExportMenu(false);

        try {
            const doc = new jsPDF('landscape'); // Use landscape for more columns

            // Load logo image as base64 or draw directly
            const img = new Image();
            img.src = logoUrl;

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
                const uniName = "Pamantasan ng Lungsod ng Pasig";
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
                    log.new_values || log.old_values || 'N/A'
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
                setToastType('error');
                setToastMessage("Export cancelled.");
                return;
            }

            // Write File via Tauri
            await writeFile(filePath, new Uint8Array(pdfBuffer));

            setToastType('success');
            setToastMessage(`Success: Report saved to ${filePath}`);
        } catch (error) {
            console.error("PDF export failed", error);
            setToastType('error');
            setToastMessage("An error occurred during export.");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 gap-6 animate-in slide-in-from-bottom-4 duration-500 relative">

            {/* Loading Overlay */}
            {isExporting && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4 max-w-sm w-full mx-4">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                        <div className="text-center">
                            <h3 className="text-lg font-bold text-slate-900">Preparing Document</h3>
                            <p className="text-sm text-slate-500 mt-1">Please wait while we generate your report...</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notification */}
            {toastMessage && (
                <div className="absolute top-0 right-4 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className={`px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 border ${toastType === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-rose-50 border-rose-200 text-rose-700'
                        }`}>
                        {toastType === 'success' ? (
                            <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                        ) : (
                            <XCircle className="w-5 h-5 text-rose-500 shrink-0" />
                        )}
                        <p className="text-sm font-medium">{toastMessage}</p>
                    </div>
                </div>
            )}

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

            {/* Error Message */}
            {dateError && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4 rounded-md flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    <p className="text-red-700 text-sm font-medium">{dateError}</p>
                </div>
            )}

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
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Target ID</th>
                                <th className="px-5 py-4 font-semibold uppercase tracking-wider text-xs">Details</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedLogs.length > 0 ? (
                                paginatedLogs.map((log) => (
                                    <tr key={log.audit_id} className="hover:bg-slate-50 transition-colors">
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
                                            {log.target_table}
                                        </td>
                                        <td className="px-5 py-3 text-slate-600 font-mono text-xs">
                                            {log.target_id || '-'}
                                        </td>
                                        <td className="px-5 py-3 text-slate-500 text-xs font-mono max-w-xs truncate" title={log.new_values || log.old_values || 'No details'}>
                                            {log.new_values || log.old_values || 'N/A'}
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
        </div>
    );
};
