import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    Search, Filter, RefreshCw, Calendar, ArrowUpRight, ArrowDownLeft, Download, FileText, FileSpreadsheet, AlertTriangle, CheckCircle, XCircle, Loader2, ChevronLeft, ChevronRight
} from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import logoUrl from '../../../imgs/plp-logo.png';

export const AccessLogs = () => {
    const [activeTab, setActiveTab] = useState('gateLogs'); // 'gateLogs' | 'eventLogs'
    
    // Gate Logs state
    const [logs, setLogs] = useState([]);
    
    // Event Logs state
    const [eventLogs, setEventLogs] = useState([]);

    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState('All');

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

    // Fetch logs from backend based on active tab
    const fetchLogs = async () => {
        if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
            setDateError('Invalid Date Range: End Date must be after Start Date.');
            return;
        }
        setDateError('');
        setLoading(true);
        try {
            if (activeTab === 'gateLogs') {
                const data = await invoke('get_access_logs', { startDate: startDate || null, endDate: endDate || null });
                setLogs(data);
            } else {
                const data = await invoke('get_event_attendance_logs', { startDate: startDate || null, endDate: endDate || null });
                setEventLogs(data);
            }
        } catch (error) {
            console.error("Failed to fetch logs:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [activeTab]);

    // Filter logic based on active tab
    const currentData = activeTab === 'gateLogs' ? logs : eventLogs;
    
    const filteredLogs = currentData.filter(log => {
        const matchesSearch = log.person_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.school_id_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (activeTab === 'eventLogs' && log.event_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
            log.role.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesRole = roleFilter === 'All' || log.role.toLowerCase() === roleFilter.toLowerCase();
        return matchesSearch && matchesRole;
    });

    // Pagination - reset to page 1 when filters change
    useEffect(() => { setCurrentPage(1); }, [searchTerm, roleFilter, startDate, endDate, activeTab]);
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
            const exportData = filteredLogs.map(log => {
                if (activeTab === 'gateLogs') {
                    return {
                        'Timestamp': formatDate(log.scanned_at),
                        'Name': log.person_name,
                        'ID Number': log.school_id_number,
                        'Role': log.role,
                        'Location': log.scanner_location,
                        'Action': log.scanner_function.toUpperCase()
                    };
                } else {
                    return {
                        'Timestamp': formatDate(log.scanned_at),
                        'Name': log.person_name,
                        'ID Number': log.school_id_number,
                        'Role': log.role,
                        'Event Name': log.event_name,
                    };
                }
            });

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Access Logs");

            // Format default filename
            let filename = `PLP_SmartGate_AccessLogs_${new Date().toISOString().slice(0, 10)}`;
            if (startDate && endDate) filename = `PLP_SmartGate_AccessLogs_${startDate}_to_${endDate}`;

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
            const doc = new jsPDF();

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
                doc.text("Official Campus Access Report", pageWidth / 2, 34, { align: "center" });

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
            const tableColumn = activeTab === 'gateLogs' 
                ? ["Timestamp", "Name", "ID Number", "Role", "Location", "Action"]
                : ["Timestamp", "Name", "ID Number", "Role", "Event Name"];
                
            const tableRows = [];

            filteredLogs.forEach(log => {
                if (activeTab === 'gateLogs') {
                    tableRows.push([
                        formatDate(log.scanned_at),
                        log.person_name,
                        log.school_id_number,
                        log.role,
                        log.scanner_location,
                        log.scanner_function.toUpperCase()
                    ]);
                } else {
                    tableRows.push([
                        formatDate(log.scanned_at),
                        log.person_name,
                        log.school_id_number,
                        log.role,
                        log.event_name
                    ]);
                }
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
                    1: { cellWidth: 'auto' }, // Name
                    2: { cellWidth: 'auto' }, // ID
                    3: { cellWidth: 'auto' }, // Role
                    4: { cellWidth: 'auto' }, // Location
                    5: { cellWidth: 'auto' }, // Action
                },
                didDrawPage: function (data) {
                    // Repeat Header on new pages
                    if (data.pageNumber > 1) {
                        drawHeader(data);
                    }
                }
            });

            // Format default filename
            let filename = `PLP_SmartGate_AccessLogs_${new Date().toISOString().slice(0, 10)}`;
            if (startDate && endDate) filename = `PLP_SmartGate_AccessLogs_${startDate}_to_${endDate}`;

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
        <div className="flex flex-col h-full min-h-0 gap-6 relative">

            {/* Loading Overlay */}
            {isExporting && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4 max-w-sm w-full mx-4">
                        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
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

            {/* Header Title Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">
                        {activeTab === 'gateLogs' ? 'General Gate Logs' : 'Event Attendance'}
                    </h1>
                    <p className="text-slate-500 mt-1">
                        {activeTab === 'gateLogs' ? 'Real-time entry and exit monitoring.' : 'Tracking attendance for events and ceremonies.'}
                    </p>
                </div>
                <button
                    onClick={fetchLogs}
                    className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 shadow-sm transition-all"
                    title="Refresh Logs"
                >
                    <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Error Message */}
            {dateError && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4 rounded-md flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    <p className="text-red-700 text-sm font-medium">{dateError}</p>
                </div>
            )}

            {/* Enterprise Control Bar */}
            <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col lg:flex-row items-center justify-between gap-4 mb-6">
                
                {/* Left Section (Navigation) */}
                <div className="flex p-1 bg-slate-100 rounded-xl space-x-1 w-full lg:w-auto overflow-x-auto shrink-0">
                    <button
                        onClick={() => setActiveTab('gateLogs')}
                        className={`flex-1 lg:flex-none px-6 py-2 rounded-lg font-semibold text-sm transition-all whitespace-nowrap focus:outline-none ${activeTab === 'gateLogs' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                    >
                        General Gate Logs
                    </button>
                    <button
                        onClick={() => setActiveTab('eventLogs')}
                        className={`flex-1 lg:flex-none px-6 py-2 rounded-lg font-semibold text-sm transition-all whitespace-nowrap focus:outline-none ${activeTab === 'eventLogs' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                    >
                        Event Attendance
                    </button>
                </div>

                {/* Right Section (Filters & Export) */}
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto flex-wrap lg:justify-end">
                    
                    {/* Search Input */}
                    <div className="relative w-full sm:w-56 shrink-0">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-4 w-4 text-slate-400" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500 sm:text-sm transition-all"
                            placeholder={activeTab === 'gateLogs' ? "Search Name or ID..." : "Search Event or Name..."}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {/* Date Filters */}
                    <div className="flex items-center gap-2 border border-slate-200 rounded-lg p-1 bg-slate-50 w-full sm:w-auto shrink-0 flex-wrap sm:flex-nowrap justify-center">
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
                        <button
                            onClick={fetchLogs}
                            className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ml-1 focus:outline-none focus:ring-2 focus:ring-slate-400"
                        >
                            Apply
                        </button>
                    </div>

                    {/* Export Dropdown */}
                    <div className="relative w-full sm:w-auto shrink-0" ref={exportMenuRef}>
                        <button
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            disabled={isExporting}
                            className={`flex items-center justify-center gap-2 px-4 py-2 w-full sm:w-auto rounded-lg border transition-all focus:outline-none ${isExporting
                                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-sm'
                                }`}
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
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">Role</th>
                                {activeTab === 'gateLogs' ? (
                                    <>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">Location</th>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px] text-center">Action</th>
                                    </>
                                ) : (
                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">Event Name</th>
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
                                                    {log.school_id_number}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${log.role === 'student' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                                log.role === 'professor' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                                                    log.role === 'visitor' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                                        'bg-slate-100 text-slate-700 border-slate-200'
                                                }`}>
                                                {log.role}
                                            </span>
                                        </td>
                                        {activeTab === 'gateLogs' ? (
                                            <>
                                                <td className="px-3 py-1.5 text-slate-600 text-xs">
                                                    {log.scanner_location}
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
                                            <td className="px-3 py-1.5 text-slate-600 text-xs font-semibold">
                                                {log.event_name}
                                            </td>
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
