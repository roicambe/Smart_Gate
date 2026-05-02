import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Search, Edit2, Trash2, Check, AlertTriangle, Eye, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../toast/ToastProvider';
import { AdminModal } from '../common/AdminModal';

const EVENT_ROLE_OPTIONS = [
    { value: 'all', label: 'All Roles' },
    { value: 'student', label: 'Student' },
    { value: 'staff', label: 'Staff' },
    { value: 'professor', label: 'Professor' },
    { value: 'visitor', label: 'Visitor' },
];

const YEAR_LEVEL_OPTIONS = [
    { value: 1, label: '1st Year' },
    { value: 2, label: '2nd Year' },
    { value: 3, label: '3rd Year' },
    { value: 4, label: '4th Year' },
];

const parseRequiredRoles = (requiredRole) => {
    if (!requiredRole) return ['all'];
    const normalized = requiredRole
        .split(',')
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean);
    if (normalized.length === 0 || normalized.includes('all')) {
        return ['all'];
    }
    return Array.from(new Set(normalized));
};

const rolesToRequiredRoleValue = (roles) => {
    if (!roles || roles.length === 0 || roles.includes('all')) {
        return 'all';
    }
    return roles.join(',');
};

const formatRequiredRoleLabel = (requiredRole) => {
    const roles = parseRequiredRoles(requiredRole);
    if (roles.includes('all')) return 'All Roles';
    
    // If all defined roles are selected, show "All Roles"
    const validRoles = EVENT_ROLE_OPTIONS.filter(o => o.value !== 'all').map(o => o.value);
    if (validRoles.length > 0 && validRoles.every(r => roles.includes(r))) {
        return 'All Roles';
    }

    return roles
        .map((role) => EVENT_ROLE_OPTIONS.find((option) => option.value === role)?.label || role)
        .join(', ');
};

const getEventDateTimeLabel = (event) => {
    const scheduleType = event.schedule_type || 'weekly';
    const startTime = event.start_time || 'N/A';
    const endTime = event.end_time || 'N/A';
    const timeLabel = `${startTime} - ${endTime}`;

    if (scheduleType === 'date_range') {
        const startDate = event.start_date || 'N/A';
        const endDate = event.end_date || 'N/A';
        return `${startDate} to ${endDate} | ${timeLabel}`;
    }

    const weeklyDays = event.event_date || 'N/A';
    return `${weeklyDays} | ${timeLabel}`;
};

const formatScheduleLabel = (event) => (
    event.schedule_type === 'date_range'
        ? `${event.start_date} to ${event.end_date}`
        : (event.event_date || 'N/A')
);

const formatRequiredPrograms = (programsStr, programsList) => {
    if (!programsStr) return 'All Programs';
    const ids = programsStr.split(',');
    return ids.map(id => {
        const prog = programsList.find(p => p.program_id.toString() === id);
        return prog ? prog.program_code : id;
    }).join(', ');
};

const formatRequiredYearLevels = (yearLevelsStr) => {
    if (!yearLevelsStr) return 'All Year Levels';
    return yearLevelsStr.split(',').map(y => {
        const option = YEAR_LEVEL_OPTIONS.find(o => o.value.toString() === y.trim());
        return option ? option.label : y;
    }).join(', ');
};

export const EventManagement = ({ branding, adminSession }) => {
    const [eventDetails, setEventDetails] = useState([]); // Raw EventDetails from backend
    const [events, setEvents] = useState([]); // Flattened events for UI
    const [programs, setPrograms] = useState([]);
    const [roles, setRoles] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 15;

    // Filter states
    const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'enabled', 'disabled'
    const [filterScheduleType, setFilterScheduleType] = useState('all'); // 'all', 'weekly', 'date_range'

    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showViewModal, setShowViewModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [selectedRoles, setSelectedRoles] = useState(['all']);
    const [selectedPrograms, setSelectedPrograms] = useState(['all']);
    const [selectedYearLevels, setSelectedYearLevels] = useState([1, 2, 3, 4]);
    const { showSuccess, showError } = useToast();

    const [formData, setFormData] = useState({
        event_name: '',
        description: '',
        schedule_type: 'weekly',
        event_date: '',
        start_date: '',
        end_date: '',
        start_time: '',
        end_time: '',
        required_role: 'all',
        required_programs: null,
        required_year_levels: null,
        is_enabled: true
    });

    const flattenEvent = (item) => {
        const { event, weekly_schedules, date_range_schedules, required_roles } = item;
        const schedule_type = weekly_schedules && weekly_schedules.length > 0 ? 'weekly' : 'date_range';
        
        let event_date = '';
        let start_date = '';
        let end_date = '';
        let start_time = '';
        let end_time = '';

        if (schedule_type === 'weekly' && weekly_schedules) {
            event_date = weekly_schedules.map(s => s.day_of_week).join(', ');
            start_time = weekly_schedules[0]?.start_time || '';
            end_time = weekly_schedules[0]?.end_time || '';
        } else if (date_range_schedules && date_range_schedules.length > 0) {
            start_date = date_range_schedules[0].start_date || '';
            end_date = date_range_schedules[0].end_date || '';
            start_time = date_range_schedules[0].start_time || '';
            end_time = date_range_schedules[0].end_time || '';
        }

        return {
            ...event,
            schedule_type,
            event_date,
            start_date,
            end_date,
            start_time,
            end_time,
            required_role: required_roles && required_roles.length > 0 ? required_roles.map(r => r.role_name).join(',') : 'all'
        };
    };

    const unflattenEvent = (data) => {
        const { event_name, description, is_enabled, schedule_type, event_date, start_date, end_date, start_time, end_time, required_role } = data;
        
        const event = {
            event_id: selectedEvent?.event_id || 0,
            event_name,
            description,
            is_enabled
        };

        const weekly_schedules = [];
        const date_range_schedules = [];

        if (schedule_type === 'weekly') {
            const days = event_date.split(',').map(d => d.trim()).filter(Boolean);
            days.forEach(day => {
                weekly_schedules.push({
                    schedule_id: 0,
                    event_id: event.event_id,
                    day_of_week: day,
                    start_time,
                    end_time
                });
            });
        } else {
            date_range_schedules.push({
                schedule_id: 0,
                event_id: event.event_id,
                start_date,
                end_date,
                start_time,
                end_time
            });
        }

        const required_role_names = required_role === 'all' ? [] : required_role.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
        const required_roles = roles.filter(r => required_role_names.includes(r.role_name.toLowerCase()));

        return {
            event,
            weekly_schedules,
            date_range_schedules,
            required_roles
        };
    };

    const fetchEvents = async () => {
        setIsLoading(true);
        try {
            const data = await invoke('get_events');
            setEventDetails(data);
            setEvents(data.map(flattenEvent));
        } catch (error) {
            console.error(error);
            showError('Failed to fetch events.');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchPrograms = async () => {
        try {
            const data = await invoke('get_programs');
            setPrograms(data);
        } catch (error) {
            console.error(error);
            showError('Failed to fetch programs.');
        }
    };

    const fetchRoles = async () => {
        try {
            const data = await invoke('get_roles');
            setRoles(data);
        } catch (error) {
            console.error(error);
        }
    };

    useEffect(() => {
        fetchEvents();
        fetchPrograms();
        fetchRoles();
    }, []);

    const handleRegisterSubmit = async (e) => {
        e.preventDefault();
        try {
            const requiredRole = rolesToRequiredRoleValue(selectedRoles);
            const requiredPrograms = selectedPrograms.includes('all') ? null : selectedPrograms.join(',');
            const requiredYearLevels = selectedYearLevels.length === 4 ? null : selectedYearLevels.join(',');
            
            const payload = unflattenEvent({
                ...formData,
                required_role: requiredRole,
                required_programs: requiredPrograms,
                required_year_levels: requiredYearLevels
            });

            await invoke('add_event', {
                event: payload,
                activeAdminId: adminSession?.account_id
            });
            showSuccess('Event Created: Event added successfully!');
            setShowRegisterModal(false);
            resetForm();
            fetchEvents();
        } catch (error) {
            console.error(error);
            showError(typeof error === 'string' ? error : 'Failed to add event.');
        }
    };

    const handleEditClick = (event) => {
        setSelectedEvent(event);
        setFormData({
            event_name: event.event_name || '',
            description: event.description || '',
            schedule_type: event.schedule_type || 'weekly',
            event_date: event.event_date || '',
            start_date: event.start_date || '',
            end_date: event.end_date || '',
            start_time: event.start_time || '',
            end_time: event.end_time || '',
            required_role: event.required_role || 'all',
            required_programs: event.required_programs || null,
            required_year_levels: event.required_year_levels || null,
            is_enabled: event.is_enabled
        });
        setSelectedRoles(parseRequiredRoles(event.required_role));
        setSelectedPrograms(event.required_programs ? event.required_programs.split(',') : ['all']);
        setSelectedYearLevels(event.required_year_levels ? event.required_year_levels.split(',').map(Number) : [1, 2, 3, 4]);
        setShowEditModal(true);
    };

    const handleEditSubmit = async (e) => {
        e.preventDefault();
        try {
            const requiredRole = rolesToRequiredRoleValue(selectedRoles);
            const requiredPrograms = selectedPrograms.includes('all') ? null : selectedPrograms.join(',');
            const requiredYearLevels = selectedYearLevels.length === 4 ? null : selectedYearLevels.join(',');

            const payload = unflattenEvent({
                ...formData,
                required_role: requiredRole,
                required_programs: requiredPrograms,
                required_year_levels: requiredYearLevels
            });

            await invoke('update_event', {
                eventId: selectedEvent.event_id,
                event: payload,
                activeAdminId: adminSession?.account_id
            });
            showSuccess('Settings Updated: Event updated successfully!');
            setShowEditModal(false);
            fetchEvents();
        } catch (error) {
            console.error(error);
            showError(typeof error === 'string' ? error : 'Failed to update event.');
        }
    };

    const handleDeleteClick = (event) => {
        setSelectedEvent(event);
        setShowDeleteModal(true);
    };

    const handleViewClick = (event) => {
        setSelectedEvent(event);
        setShowViewModal(true);
    };

    const confirmDelete = async () => {
        try {
            await invoke('delete_event', { eventId: selectedEvent.event_id, activeAdminId: adminSession?.account_id });
            showSuccess('Event archived successfully!');
            setShowDeleteModal(false);
            fetchEvents();
        } catch (error) {
            console.error(error);
            showError(typeof error === 'string' ? error : 'Failed to archive event.');
        }
    };

    const resetForm = () => {
        setFormData({ event_name: '', description: '', schedule_type: 'weekly', event_date: '', start_date: '', end_date: '', start_time: '', end_time: '', required_role: 'all', required_programs: null, required_year_levels: null, is_enabled: true });
        setSelectedEvent(null);
        setSelectedRoles(['all']);
        setSelectedPrograms(['all']);
        setSelectedYearLevels([1, 2, 3, 4]);
    };

    const handleRegisterClick = () => {
        resetForm();
        setShowRegisterModal(true);
    };

    const toggleRole = (role) => {
        if (role === 'all') {
            setSelectedRoles(['all']);
            return;
        }

        const current = selectedRoles.filter((item) => item !== 'all');
        if (current.includes(role)) {
            const next = current.filter((item) => item !== role);
            setSelectedRoles(next.length > 0 ? next : ['all']);
            return;
        }

        setSelectedRoles([...current, role]);
    };

    const filteredEvents = events.filter(event => {
        const matchSearch = event.event_name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchStatus = filterStatus === 'all' ? true : filterStatus === 'enabled' ? event.is_enabled : !event.is_enabled;
        const matchType = filterScheduleType === 'all' ? true : event.schedule_type === filterScheduleType;
        return matchSearch && matchStatus && matchType;
    });

    const totalPages = Math.ceil(filteredEvents.length / ITEMS_PER_PAGE);
    const paginatedEvents = filteredEvents.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    const clearFilters = () => {
        setSearchQuery('');
        setFilterStatus('all');
        setFilterScheduleType('all');
        setCurrentPage(1);
    };

    const toggleProgram = (val) => {
        if (val === 'all') {
            setSelectedPrograms(['all']);
            return;
        }
        const current = selectedPrograms.filter(p => p !== 'all');
        if (current.includes(val)) {
            const next = current.filter(p => p !== val);
            setSelectedPrograms(next.length > 0 ? next : ['all']);
        } else {
            setSelectedPrograms([...current, val]);
        }
    };

    const toggleYearLevel = (val) => {
        if (selectedYearLevels.includes(val)) {
            const next = selectedYearLevels.filter(y => y !== val);
            setSelectedYearLevels(next.length > 0 ? next : [1, 2, 3, 4]);
        } else {
            setSelectedYearLevels([...selectedYearLevels, val].sort());
        }
    };

    return (
        <div className="w-full h-full min-h-0 space-y-6 animate-in slide-in-from-bottom-4 duration-500 relative flex flex-col">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                        <Calendar className="w-8 h-8 text-emerald-500" />
                        Event Management
                    </h1>
                    <p className="text-slate-500">Manage campus events and required roles.</p>
                </div>
                <button
                    onClick={handleRegisterClick}
                    className="flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700 px-5 py-2.5 rounded-xl font-bold shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                >
                    <Plus className="w-5 h-5" /> Add Event
                </button>
            </div>

            <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-end items-center gap-4">
                <div className="flex flex-col sm:flex-row gap-2 items-center w-full sm:w-auto">
                    {/* Filtering: Left side of search bar */}
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-48">
                        <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                        >
                            <option value="all">Status: All</option>
                            <option value="enabled">Status: Enabled</option>
                            <option value="disabled">Status: Disabled</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200 w-full sm:w-48">
                        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                        <select
                            value={filterScheduleType}
                            onChange={(e) => setFilterScheduleType(e.target.value)}
                            className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer w-full"
                        >
                            <option value="all">Type: All</option>
                            <option value="weekly">Type: Weekly</option>
                            <option value="date_range">Type: Date Range</option>
                        </select>
                    </div>

                    {/* Search Bar: Right side */}
                    <div className="relative w-full sm:w-80">
                        <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search Events..."
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCurrentPage(1);
                            }}
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

            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm relative">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left text-sm text-slate-600">
                        <thead className="text-xs uppercase bg-slate-100 border-b border-slate-200 text-slate-700 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-4 font-semibold tracking-wider">Event Name</th>
                                <th className="px-6 py-4 font-semibold tracking-wider">Description</th>
                                <th className="px-6 py-4 font-semibold tracking-wider">Date & Time</th>
                                <th className="px-6 py-4 font-semibold tracking-wider">Required Role</th>
                                <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
                                <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-20 text-slate-500">Loading data...</td>
                                </tr>
                            ) : paginatedEvents.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-20">
                                        <div className="flex flex-col items-center justify-center space-y-3">
                                            <Calendar className="w-12 h-12 text-slate-300" />
                                            <p className="text-slate-500 text-base">No events found.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedEvents.map((event) => (
                                    <tr key={event.event_id} className="hover:bg-slate-50 even:bg-slate-50/50 transition-colors group">
                                        <td className="px-6 py-4 font-medium text-slate-900">{event.event_name}</td>
                                        <td className="px-6 py-4 text-slate-500 max-w-xs truncate" title={event.description || 'No description'}>
                                            {event.description || 'No description'}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500">{getEventDateTimeLabel(event)}</td>
                                        <td className="px-6 py-4 text-slate-500">{formatRequiredRoleLabel(event.required_role)}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${event.is_enabled ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-rose-100 text-rose-700 border border-rose-200'}`}>
                                                {event.is_enabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-2">
                                            <button className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors border border-transparent hover:border-blue-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="View"
                                                onClick={() => handleViewClick(event)}>
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            <button className="p-2 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors border border-transparent hover:border-amber-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Edit"
                                                onClick={() => handleEditClick(event)}>
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Archive"
                                                onClick={() => handleDeleteClick(event)}>
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {totalPages > 1 && (
                    <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 flex items-center justify-between shrink-0 rounded-b-xl">
                        <div>
                            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredEvents.length)} of {filteredEvents.length}
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

            {(showRegisterModal || showEditModal) && (
                <AdminModal
                    isOpen={showRegisterModal || showEditModal}
                    onClose={() => { setShowRegisterModal(false); setShowEditModal(false); }}
                    title={showEditModal ? 'Edit Event' : 'Add Event'}
                    icon={showEditModal ? <Edit2 className="w-5 h-5 text-amber-300" /> : <Plus className="w-5 h-5 text-emerald-300" />}
                    size="xl"
                    bodyClassName="p-0"
                >
                    <form onSubmit={showEditModal ? handleEditSubmit : handleRegisterSubmit} className="flex flex-col flex-1 overflow-hidden">
                            <div className="flex-1">
                                <div className="grid grid-cols-1 gap-6 pb-8 lg:grid-cols-2">
                                    {/* Left Column: Basic Info & Schedule */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-1 h-4 bg-emerald-500 rounded-full"></div>
                                            <h3 className="text-sm font-bold text-white/90 uppercase tracking-wider">Basic Information</h3>
                                        </div>

                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Event Name <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <input required type="text" value={formData.event_name} onChange={e => setFormData({ ...formData, event_name: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:ring-2 focus:ring-white/20 focus:outline-none" placeholder="e.g. Flag Ceremony" />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1 font-medium">Description</label>
                                            <textarea rows={2} value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:ring-2 focus:ring-white/20 focus:outline-none resize-none" placeholder="Describe what the event is about." />
                                        </div>

                                        <div className="pt-2">
                                            <label className="block text-xs text-white/60 mb-2 font-medium">Schedule Logic</label>
                                            <div className="flex gap-3 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
                                                <button type="button" onClick={() => setFormData({ ...formData, schedule_type: 'weekly' })} className={`px-4 py-2 rounded-lg font-medium transition-all text-sm ${formData.schedule_type === 'weekly' ? 'bg-white text-black shadow-sm' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>Weekly Recurrence</button>
                                                <button type="button" onClick={() => setFormData({ ...formData, schedule_type: 'date_range' })} className={`px-4 py-2 rounded-lg font-medium transition-all text-sm ${formData.schedule_type === 'date_range' ? 'bg-white text-black shadow-sm' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>Date Range</button>
                                            </div>
                                        </div>

                                        {formData.schedule_type === 'weekly' ? (
                                            <div>
                                                <label className="block text-xs text-white/60 mb-2 font-medium">Select Days <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                                <div className="flex flex-wrap gap-2 p-3 bg-black/40 border border-white/10 rounded-xl">
                                                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                                                        const currentDays = formData.event_date ? formData.event_date.split(',').map(d => d.trim()) : [];
                                                        const isChecked = currentDays.includes(day);
                                                        return (
                                                            <label key={day} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all ${isChecked ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-100' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white'}`}>
                                                                <input
                                                                    type="checkbox"
                                                                    className="hidden"
                                                                    checked={isChecked}
                                                                    onChange={(e) => {
                                                                        let newDays = [...currentDays];
                                                                        if (e.target.checked && !newDays.includes(day)) {
                                                                            newDays.push(day);
                                                                        } else if (!e.target.checked) {
                                                                            newDays = newDays.filter((d) => d !== day);
                                                                        }
                                                                        setFormData({ ...formData, event_date: newDays.join(', ') });
                                                                    }}
                                                                />
                                                                <span className="text-sm font-semibold">{day.substr(0, 3)}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs text-white/60 mb-1 font-medium">Start Date <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                                    <input required={formData.schedule_type === 'date_range'} type="date" value={formData.start_date || ''} onChange={e => setFormData({ ...formData, start_date: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" style={{ colorScheme: 'dark' }} />
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-white/60 mb-1 font-medium">End Date <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                                    <input required={formData.schedule_type === 'date_range'} type="date" value={formData.end_date || ''} onChange={e => setFormData({ ...formData, end_date: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" style={{ colorScheme: 'dark' }} />
                                                </div>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs text-white/60 mb-1 font-medium">Start Time <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                                <input required type="time" value={formData.start_time} onChange={e => setFormData({ ...formData, start_time: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" style={{ colorScheme: 'dark' }} />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-white/60 mb-1 font-medium">End Time <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                                <input required type="time" value={formData.end_time} onChange={e => setFormData({ ...formData, end_time: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" style={{ colorScheme: 'dark' }} />
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                                            <input type="checkbox" id="isEnabled" checked={formData.is_enabled} onChange={e => setFormData({ ...formData, is_enabled: e.target.checked })} className="w-5 h-5 text-emerald-500 bg-black/50 border-white/20 rounded focus:ring-emerald-500/50" />
                                            <label htmlFor="isEnabled" className="text-sm font-medium text-white">Event Is Enabled</label>
                                        </div>
                                    </div>

                                    {/* Right Column: Targeting & Requirements */}
                                    <div className="space-y-4 lg:pl-6">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                                            <h3 className="text-sm font-bold text-white/90 uppercase tracking-wider">Targeting & Requirements</h3>
                                        </div>

                                        <div>
                                            <label className="block text-xs text-white/60 mb-2 font-medium">Required Role <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <div className="grid grid-cols-2 gap-2 p-3 bg-black/40 border border-white/10 rounded-xl">
                                                {EVENT_ROLE_OPTIONS.map((option) => {
                                                    const active = selectedRoles.includes(option.value);
                                                    return (
                                                        <button
                                                            key={option.value}
                                                            type="button"
                                                            onClick={() => toggleRole(option.value)}
                                                            className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${active ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
                                                        >
                                                            {option.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <p className="mt-2 text-[10px] text-white/40 leading-relaxed italic">
                                                * Select 'All Roles' to bypass strict role checking.
                                            </p>
                                        </div>

                                        {(selectedRoles.includes('all') || selectedRoles.includes('student')) && (
                                            <>
                                                <div>
                                                    <label className="block text-xs text-white/60 mb-2 font-medium">Specific Programs</label>
                                                    <div className="flex flex-wrap gap-2 p-3 bg-black/40 border border-white/10 rounded-xl max-h-48 overflow-y-auto custom-scrollbar">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleProgram('all')}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${selectedPrograms.includes('all') ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
                                                        >
                                                            All Programs
                                                        </button>
                                                        {programs.map((prog) => {
                                                            const active = selectedPrograms.includes(prog.program_id.toString());
                                                            return (
                                                                <button
                                                                    key={prog.program_id}
                                                                    type="button"
                                                                    onClick={() => toggleProgram(prog.program_id.toString())}
                                                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all truncate max-w-[150px] ${active ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
                                                                    title={prog.program_name}
                                                                >
                                                                    {prog.program_code}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="block text-xs text-white/60 mb-2 font-medium">Specific Year Levels</label>
                                                    <div className="grid grid-cols-2 gap-2 p-3 bg-black/40 border border-white/10 rounded-xl">
                                                        {YEAR_LEVEL_OPTIONS.map((option) => {
                                                            const active = selectedYearLevels.includes(option.value);
                                                            return (
                                                                <button
                                                                    key={option.value}
                                                                    type="button"
                                                                    onClick={() => toggleYearLevel(option.value)}
                                                                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${active ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-100' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'}`}
                                                                >
                                                                    {option.label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="shrink-0 border-t border-white/10 px-5 pt-3">
                                <button type="submit" className={`w-full ${showEditModal ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)]' : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.2)]'} font-bold text-lg py-4 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-white/40 flex justify-center items-center gap-2 hover:scale-[1.01]`}>
                                    <Check className="w-6 h-6" /> {showEditModal ? 'Save Event Configuration' : 'Create New Event'}
                                </button>
                            </div>
                        </form>
                </AdminModal>
            )}

            {showViewModal && selectedEvent && (
                <AdminModal
                    isOpen={showViewModal}
                    onClose={() => setShowViewModal(false)}
                    title="Event Details"
                    icon={<Eye className="w-5 h-5 text-white" />}
                    tone="default"
                    size="lg"
                >
                    <div className="space-y-6">
                            <div className="flex items-center gap-4 border-b border-white/10 pb-6">
                                <div className="w-12 h-12 bg-emerald-500/20 rounded-xl border border-emerald-400/30 flex items-center justify-center text-emerald-300">
                                    <Calendar className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white">{selectedEvent.event_name}</h3>
                                    <p className="text-sm text-white/50">{selectedEvent.schedule_type === 'date_range' ? 'Special Event' : 'Recurring Event'}</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <p className="text-xs uppercase tracking-wider text-white/40 mb-2 font-semibold">Description</p>
                                    <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap bg-white/5 p-4 rounded-xl border border-white/10">{selectedEvent.description || 'No description provided.'}</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                                    <div>
                                        <p className="text-xs uppercase tracking-wider text-white/40 mb-1 font-semibold">Schedule</p>
                                        <p className="text-white font-medium">{formatScheduleLabel(selectedEvent)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase tracking-wider text-white/40 mb-1 font-semibold">Time</p>
                                        <p className="text-white font-medium font-mono bg-white/5 px-2 py-1 rounded w-fit">{selectedEvent.start_time} - {selectedEvent.end_time}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase tracking-wider text-white/40 mb-1 font-semibold">Allowed Roles</p>
                                        <p className="text-white font-medium capitalize">{formatRequiredRoleLabel(selectedEvent.required_role)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase tracking-wider text-white/40 mb-1 font-semibold">Status</p>
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${selectedEvent.is_enabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-rose-500/20 text-rose-300 border border-rose-400/30'}`}>
                                            {selectedEvent.is_enabled ? 'Active' : 'Disabled'}
                                        </span>
                                    </div>

                                    {(selectedEvent.required_role.includes('all') || selectedEvent.required_role.includes('student')) && (
                                        <>
                                            <div className="col-span-1 md:col-span-2 border-t border-white/5 pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div>
                                                    <p className="text-xs uppercase tracking-wider text-white/40 mb-1 font-semibold">Target Programs</p>
                                                    <p className="text-white font-medium text-sm">{formatRequiredPrograms(selectedEvent.required_programs, programs)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs uppercase tracking-wider text-white/40 mb-1 font-semibold">Target Year Levels</p>
                                                    <p className="text-white font-medium text-sm">{formatRequiredYearLevels(selectedEvent.required_year_levels)}</p>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                    </div>
                </AdminModal>
            )}

            {showDeleteModal && selectedEvent && (
                <AdminModal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    title="Archive Event?"
                    tone="danger"
                    icon={<AlertTriangle className="w-5 h-5 text-rose-300" />}
                    size="md"
                    footer={(
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteModal(false)} className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">
                                Cancel
                            </button>
                            <button onClick={confirmDelete} className="flex-1 rounded-xl border border-rose-300/40 bg-rose-500 px-4 py-3 text-sm font-bold text-white hover:bg-rose-400">
                                Archive
                            </button>
                        </div>
                    )}
                >
                    <p className="text-center text-sm text-rose-100/85">
                        Are you sure you want to archive <span className="font-semibold text-rose-50">{selectedEvent.event_name}</span>? This record will be moved to the Archive Center.
                    </p>
                </AdminModal>
            )}
        </div>
    );
};
