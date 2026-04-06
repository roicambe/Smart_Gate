import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Search, Edit2, Trash2, X, AlertCircle, CheckCircle2, Check, AlertTriangle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export const EventManagement = () => {
    const [events, setEvents] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [status, setStatus] = useState(null);

    const [formData, setFormData] = useState({
        event_name: '',
        schedule_type: 'weekly',
        event_date: '',
        start_date: '',
        end_date: '',
        start_time: '',
        end_time: '',
        required_role: 'all',
        is_enabled: true
    });

    const fetchEvents = async () => {
        setIsLoading(true);
        try {
            const data = await invoke('get_events');
            setEvents(data);
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: 'Failed to fetch events.' });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchEvents();
    }, []);

    const handleRegisterSubmit = async (e) => {
        e.preventDefault();
        try {
            await invoke('add_event', {
                event: {
                    event_id: 0,
                    ...formData
                }
            });
            setStatus({ type: 'success', message: 'Event added successfully!' });
            setShowRegisterModal(false);
            setFormData({ event_name: '', schedule_type: 'weekly', event_date: '', start_date: '', end_date: '', start_time: '', end_time: '', required_role: 'all', is_enabled: true });
            fetchEvents();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: typeof error === 'string' ? error : 'Failed to add event.' });
        }
    };

    const handleEditClick = (event) => {
        setSelectedEvent(event);
        setFormData({
            event_name: event.event_name || '',
            schedule_type: event.schedule_type || 'weekly',
            event_date: event.event_date || '',
            start_date: event.start_date || '',
            end_date: event.end_date || '',
            start_time: event.start_time || '',
            end_time: event.end_time || '',
            required_role: event.required_role || 'all',
            is_enabled: event.is_enabled
        });
        setShowEditModal(true);
    };

    const handleEditSubmit = async (e) => {
        e.preventDefault();
        try {
            await invoke('update_event', {
                eventId: selectedEvent.event_id,
                event: {
                    event_id: selectedEvent.event_id,
                    ...formData
                }
            });
            setStatus({ type: 'success', message: 'Event updated successfully!' });
            setShowEditModal(false);
            fetchEvents();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: typeof error === 'string' ? error : 'Failed to update event.' });
        }
    };

    const handleDeleteClick = (event) => {
        setSelectedEvent(event);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        try {
            await invoke('delete_event', { eventId: selectedEvent.event_id });
            setStatus({ type: 'success', message: 'Event deleted successfully!' });
            setShowDeleteModal(false);
            fetchEvents();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: typeof error === 'string' ? error : 'Failed to delete event.' });
        }
    };

    const handleRegisterClick = () => {
        setFormData({ event_name: '', schedule_type: 'weekly', event_date: '', start_date: '', end_date: '', start_time: '', end_time: '', required_role: 'all', is_enabled: true });
        setStatus(null);
        setShowRegisterModal(true);
    };

    const filteredEvents = events.filter(event =>
        event.event_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="w-full h-full min-h-0 space-y-6 animate-in slide-in-from-bottom-4 duration-500 relative flex flex-col">
            {status && (
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4">
                    <div className={`p-4 rounded-xl flex items-center justify-between gap-4 shadow-lg border ${status.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
                        <div className="flex items-center gap-3">
                            {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
                            <span className="font-medium text-sm">{status.message}</span>
                        </div>
                        <button onClick={() => setStatus(null)}><X className="w-5 h-5 hover:text-slate-500" /></button>
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Event Management</h1>
                    <p className="text-slate-500">Manage campus events and required roles.</p>
                </div>
                <button
                    onClick={handleRegisterClick}
                    className="flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700 px-5 py-2.5 rounded-xl font-bold shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                >
                    <Plus className="w-5 h-5" /> Add Event
                </button>
            </div>

            <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row justify-between items-center gap-4">
                <div className="relative w-full lg:w-1/3">
                    <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search Events..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-2.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium"
                    />
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm relative">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left text-sm text-slate-600">
                        <thead className="text-xs uppercase bg-slate-100 border-b border-slate-200 text-slate-700 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-4 font-semibold tracking-wider">Event Name</th>
                                <th className="px-6 py-4 font-semibold tracking-wider">Date & Time</th>
                                <th className="px-6 py-4 font-semibold tracking-wider">Required Role</th>
                                <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
                                <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-20 text-slate-500">Loading data...</td>
                                </tr>
                            ) : filteredEvents.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-20">
                                        <div className="flex flex-col items-center justify-center space-y-3">
                                            <Calendar className="w-12 h-12 text-slate-300" />
                                            <p className="text-slate-500 text-base">No events found.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredEvents.map((event) => (
                                    <tr key={event.event_id} className="hover:bg-slate-50 even:bg-slate-50/50 transition-colors group">
                                        <td className="px-6 py-4 font-medium text-slate-900">{event.event_name}</td>
                                        <td className="px-6 py-4 text-slate-600">{event.schedule_type === 'date_range' ? `${event.start_date} to ${event.end_date}` : (event.event_date || 'N/A')} | {event.start_time} - {event.end_time}</td>
                                        <td className="px-6 py-4 text-slate-600 capitalize">{event.required_role}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${event.is_enabled ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-rose-100 text-rose-700 border border-rose-200'}`}>
                                                {event.is_enabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-2">
                                            <button className="p-2 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors border border-transparent hover:border-amber-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Edit"
                                                onClick={() => handleEditClick(event)}>
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button className="p-2 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-transparent hover:border-rose-200 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Delete"
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
            </div>

            {(showRegisterModal || showEditModal) && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
                    <div className="bg-black/90 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-xl overflow-y-auto max-h-[90vh] animate-in zoom-in-95 duration-200">
                        <div className="px-8 py-6 border-b border-white/10 flex justify-between items-center sticky top-0 bg-black/50 backdrop-blur-md z-10">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 bg-white/10 rounded-lg border border-white/20 `}>
                                    {showEditModal ? <Edit2 className="w-5 h-5 text-amber-400" /> : <Plus className="w-5 h-5 text-emerald-400" />}
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-wide">{showEditModal ? 'Edit Event' : 'Add Event'}</h2>
                            </div>
                            <button onClick={() => { setShowRegisterModal(false); setShowEditModal(false); }} className="text-white/50 hover:text-white transition-colors bg-white/5 p-2 rounded-xl hover:bg-white/10"><X className="w-5 h-5" /></button>
                        </div>

                        <form onSubmit={showEditModal ? handleEditSubmit : handleRegisterSubmit} className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-white/60 mb-1 font-medium">Event Name <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                    <input required type="text" value={formData.event_name} onChange={e => setFormData({ ...formData, event_name: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:ring-2 focus:ring-white/20 focus:outline-none" placeholder="e.g. Flag Ceremony" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2 flex gap-4 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
                                        <button type="button" onClick={() => setFormData({ ...formData, schedule_type: 'weekly' })} className={`px-4 py-2 rounded-lg font-medium transition-all text-sm ${formData.schedule_type === 'weekly' ? 'bg-white text-black shadow-sm' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>Weekly Recurrence</button>
                                        <button type="button" onClick={() => setFormData({ ...formData, schedule_type: 'date_range' })} className={`px-4 py-2 rounded-lg font-medium transition-all text-sm ${formData.schedule_type === 'date_range' ? 'bg-white text-black shadow-sm' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>Date Range</button>
                                    </div>

                                    {formData.schedule_type === 'weekly' ? (
                                        <div className="col-span-2">
                                            <label className="block text-xs text-white/60 mb-2 font-medium">Select Days <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                            <div className="flex flex-wrap gap-3 p-4 bg-black/40 border border-white/10 rounded-xl">
                                                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                                                    const currentDays = formData.event_date ? formData.event_date.split(',').map(d => d.trim()) : [];
                                                    const isChecked = currentDays.includes(day);
                                                    return (
                                                        <label key={day} className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${isChecked ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-100' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white'}`}>
                                                            <input type="checkbox" className="hidden" checked={isChecked} onChange={(e) => {
                                                                let newDays = [...currentDays];
                                                                if (e.target.checked && !newDays.includes(day)) {
                                                                    newDays.push(day);
                                                                } else if (!e.target.checked) {
                                                                    newDays = newDays.filter(d => d !== day);
                                                                }
                                                                setFormData({ ...formData, event_date: newDays.join(', ') });
                                                            }} />
                                                            <span className="text-sm font-semibold">{day.substr(0, 3)}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block text-xs text-white/60 mb-1 font-medium">Start Date <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                                <input required={formData.schedule_type === 'date_range'} type="date" value={formData.start_date || ''} onChange={e => setFormData({ ...formData, start_date: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" style={{ colorScheme: 'dark' }} />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-white/60 mb-1 font-medium">End Date <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                                <input required={formData.schedule_type === 'date_range'} type="date" value={formData.end_date || ''} onChange={e => setFormData({ ...formData, end_date: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" style={{ colorScheme: 'dark' }} />
                                            </div>
                                        </>
                                    )}

                                    <div className="col-span-2">
                                        <label className="block text-xs text-white/60 mb-1 font-medium">Required Role <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                        <select required value={formData.required_role} onChange={e => setFormData({ ...formData, required_role: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none appearance-none">
                                            <option value="all" className="bg-slate-900">All</option>
                                            <option value="student" className="bg-slate-900">Student</option>
                                            <option value="staff" className="bg-slate-900">Staff</option>
                                            <option value="professor" className="bg-slate-900">Professor</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-white/60 mb-1 font-medium">Start Time <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                        <input required type="time" value={formData.start_time} onChange={e => setFormData({ ...formData, start_time: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" style={{ colorScheme: 'dark' }} />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-white/60 mb-1 font-medium">End Time <span className="text-rose-500 text-base font-bold ml-0.5">*</span></label>
                                        <input required type="time" value={formData.end_time} onChange={e => setFormData({ ...formData, end_time: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/20 focus:outline-none" style={{ colorScheme: 'dark' }} />
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 mt-4 p-4 bg-white/5 disabled border border-white/10 rounded-xl">
                                    <input type="checkbox" id="isEnabled" checked={formData.is_enabled} onChange={e => setFormData({ ...formData, is_enabled: e.target.checked })} className="w-5 h-5 text-emerald-500 bg-black/50 border-white/20 rounded focus:ring-emerald-500/50" />
                                    <label htmlFor="isEnabled" className="text-sm font-medium text-white">Event Is Enabled</label>
                                </div>
                            </div>

                            <div className="pt-6">
                                <button type="submit" className={`w-full ${showEditModal ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)]' : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.2)]'} font-bold text-lg py-4 rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-white/40 flex justify-center items-center gap-2 hover:scale-[1.01]`}>
                                    <Check className="w-6 h-6" /> {showEditModal ? 'Save Event' : 'Add Event'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showDeleteModal && selectedEvent && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
                    <div className="bg-rose-950/40 backdrop-blur-2xl border border-rose-500/30 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-8 flex flex-col items-center text-center space-y-6">
                            <div className="w-20 h-20 bg-rose-500/20 rounded-full flex items-center justify-center border-4 border-rose-500/30">
                                <AlertTriangle className="w-10 h-10 text-rose-400" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-2xl font-bold text-white">Delete Event?</h2>
                                <p className="text-white/70">Are you sure you want to delete <span className="text-white font-semibold">{selectedEvent.event_name}</span>? This action cannot be undone.</p>
                            </div>
                            <div className="flex gap-4 w-full pt-4">
                                <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-3 px-4 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl transition-colors border border-white/10 focus:outline-none">Cancel</button>
                                <button onClick={confirmDelete} className="flex-1 py-3 px-4 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(244,63,94,0.3)] hover:shadow-[0_0_30px_rgba(244,63,94,0.5)] border border-rose-400 focus:outline-none">Delete</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
