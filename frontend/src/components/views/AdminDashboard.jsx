import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Users, UserCircle, Briefcase, LogIn, LogOut, TrendingUp, AlertCircle } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export const AdminDashboard = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const data = await invoke('get_dashboard_stats');
                setStats(data);
            } catch (err) {
                console.error("Failed to load dashboard stats", err);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

    if (loading) {
        return <div className="flex-1 flex items-center justify-center text-white/50 animate-pulse text-lg tracking-wide">Synchronizing metrics...</div>;
    }

    if (!stats) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-rose-400 bg-rose-500/10 p-6 rounded-2xl border border-rose-500/20 flex gap-3 shadow-2xl backdrop-blur-md">
                    <AlertCircle className="w-6 h-6" /> <span className="font-semibold text-lg">Dashboard data unavailable. Database connection failed.</span>
                </div>
            </div>
        );
    }

    const { total_students, total_employees, total_visitors, entries_today, exits_today, attendance_trend } = stats;

    const barData = [
        { name: 'Today', Entries: entries_today, Exits: exits_today }
    ];

    const colorMappings = {
        blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-t-blue-500', iconBorder: 'border-blue-100' },
        emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-t-emerald-500', iconBorder: 'border-emerald-100' },
        amber: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-t-amber-500', iconBorder: 'border-amber-100' },
        indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-t-indigo-500', iconBorder: 'border-indigo-100' },
        rose: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-t-rose-500', iconBorder: 'border-rose-100' }
    };

    const StatCard = ({ title, value, icon: Icon, theme }) => {
        const colors = colorMappings[theme] || colorMappings.blue;
        return (
            <div className={`bg-white border-x border-b border-slate-200 border-t-4 ${colors.border} rounded-xl p-6 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-300 hover:shadow-md`}>
                <div className="flex justify-between items-start mb-4">
                    <div className={`p-3 rounded-xl border ${colors.bg} ${colors.text} ${colors.iconBorder}`}>
                        <Icon className="w-6 h-6" />
                    </div>
                </div>
                <div>
                    <p className="text-slate-500 text-sm font-semibold tracking-wide mb-1 uppercase">{title}</p>
                    <h3 className="text-4xl font-black text-slate-900 tracking-tight">{value}</h3>
                </div>
            </div>
        )
    };

    return (
        <div className="w-full h-full flex flex-col gap-8 animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-4xl font-bold text-slate-900 mb-2 tracking-wide">System Overview</h1>
                    <p className="text-slate-500 text-lg">Live operations and attendance analytics.</p>
                </div>
            </div>

            {/* Top Row: Bento Grid Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
                <StatCard title="Total Students" value={total_students} icon={UserCircle} theme="blue" />
                <StatCard title="Total Employees" value={total_employees} icon={Briefcase} theme="emerald" />
                <StatCard title="Total Visitors" value={total_visitors} icon={Users} theme="amber" />
                <StatCard title="Entries Today" value={entries_today} icon={LogIn} theme="indigo" />
                <StatCard title="Exits Today" value={exits_today} icon={LogOut} theme="rose" />
            </div>

            {/* Middle Row: Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[450px]">
                {/* Bar Graph (Entrance vs Exit) */}
                <div className="lg:col-span-1 bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col transition-all duration-300">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl">
                            <TrendingUp className="w-5 h-5" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 tracking-wide">Today's Traffic Flow</h3>
                    </div>
                    <div className="flex-1 w-full relative pl-2" style={{ minHeight: '280px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={barData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                                <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    cursor={{ fill: '#f1f5f9' }}
                                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                    itemStyle={{ color: '#0f172a', fontWeight: 'bold' }}
                                />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                <Bar dataKey="Entries" fill="#4f46e5" radius={[4, 4, 4, 4]} barSize={40} />
                                <Bar dataKey="Exits" fill="#e11d48" radius={[4, 4, 4, 4]} barSize={40} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Line Graph (7-Day Attendance Trend) */}
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col transition-all duration-300">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl">
                            <TrendingUp className="w-5 h-5" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 tracking-wide">7-Day Attendance Trend</h3>
                    </div>
                    <div className="flex-1 w-full relative" style={{ minHeight: '280px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={attendance_trend} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorStudents" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorEmployees" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorVisitors" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                <XAxis dataKey="date" stroke="#94a3b8" tick={{ fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                                <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                    itemStyle={{ fontWeight: 'bold' }}
                                />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                <Area type="monotone" dataKey="students" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorStudents)" />
                                <Area type="monotone" dataKey="employees" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorEmployees)" />
                                <Area type="monotone" dataKey="visitors" stroke="#f59e0b" strokeWidth={3} fillOpacity={1} fill="url(#colorVisitors)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};
