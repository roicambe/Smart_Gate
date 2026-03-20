import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    Activity,
    AlertCircle,
    Briefcase,
    LogIn,
    LogOut,
    TrendingUp,
    UserCircle,
    Users,
} from 'lucide-react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

const colorMappings = {
    blue: {
        panelBg: 'bg-[linear-gradient(180deg,#ffffff_0%,#eff6ff_100%)]',
        panelBorder: 'border-blue-100',
        iconWrap: 'border-blue-200 bg-blue-500/10 text-blue-600',
        accent: 'from-blue-500/20 via-blue-500/5 to-transparent',
    },
    emerald: {
        panelBg: 'bg-[linear-gradient(180deg,#ffffff_0%,#ecfdf5_100%)]',
        panelBorder: 'border-emerald-100',
        iconWrap: 'border-emerald-200 bg-emerald-500/10 text-emerald-600',
        accent: 'from-emerald-500/20 via-emerald-500/5 to-transparent',
    },
    amber: {
        panelBg: 'bg-[linear-gradient(180deg,#ffffff_0%,#fffbeb_100%)]',
        panelBorder: 'border-amber-100',
        iconWrap: 'border-amber-200 bg-amber-500/10 text-amber-600',
        accent: 'from-amber-500/20 via-amber-500/5 to-transparent',
    },
    indigo: {
        panelBg: 'bg-[linear-gradient(180deg,#ffffff_0%,#eef2ff_100%)]',
        panelBorder: 'border-indigo-100',
        iconWrap: 'border-indigo-200 bg-indigo-500/10 text-indigo-600',
        accent: 'from-indigo-500/20 via-indigo-500/5 to-transparent',
    },
    rose: {
        panelBg: 'bg-[linear-gradient(180deg,#ffffff_0%,#fff1f2_100%)]',
        panelBorder: 'border-rose-100',
        iconWrap: 'border-rose-200 bg-rose-500/10 text-rose-600',
        accent: 'from-rose-500/20 via-rose-500/5 to-transparent',
    },
};

const formatNumber = (value) => new Intl.NumberFormat().format(value ?? 0);

const DashboardTooltip = ({ active, label, payload }) => {
    if (!active || !payload?.length) {
        return null;
    }

    return (
        <div className="min-w-[170px] rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-xl shadow-slate-900/10 backdrop-blur">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
            <div className="space-y-1.5">
                {payload.map((item) => (
                    <div key={item.dataKey} className="flex items-center justify-between gap-6 text-sm">
                        <div className="flex items-center gap-2 text-slate-600">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                            <span className="font-medium">{item.name}</span>
                        </div>
                        <span className="font-bold text-slate-900">{formatNumber(item.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const StatCard = ({ title, value, description, icon: Icon, theme }) => {
    const colors = colorMappings[theme] || colorMappings.blue;

    return (
        <div className={`relative overflow-hidden rounded-[24px] border ${colors.panelBorder} ${colors.panelBg} p-4 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.4)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_28px_64px_-34px_rgba(15,23,42,0.45)]`}>
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-br ${colors.accent}`} />
            <div className="relative flex items-start justify-between gap-4">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">{title}</p>
                    <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{formatNumber(value)}</h3>
                    <p className="mt-1.5 text-xs leading-5 text-slate-600">{description}</p>
                </div>
                <div className={`rounded-xl border p-2.5 ${colors.iconWrap} shadow-sm`}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
        </div>
    );
};

const ChartCard = ({ title, description, icon: Icon, iconClassName, children }) => (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_22px_60px_-38px_rgba(15,23,42,0.4)]">
        <div className="mb-4 flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
                <div className={`rounded-xl border p-2.5 ${iconClassName}`}>
                    <Icon className="h-4 w-4" />
                </div>
                <div>
                    <h3 className="text-lg font-bold tracking-tight text-slate-950">{title}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
                </div>
            </div>
        </div>
        <div className="flex-1 min-h-0">
            {children}
        </div>
    </section>
);

const EmptyChartState = ({ title, message }) => (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-slate-50/80 px-6 text-center">
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 text-slate-400 shadow-sm">
            <AlertCircle className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">{message}</p>
    </div>
);

const ChartSkeleton = () => (
    <div className="h-full min-h-[220px] w-full animate-pulse rounded-[22px] bg-slate-100" />
);

const ChartSurface = ({ children }) => {
    const containerRef = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const node = containerRef.current;
        if (!node) {
            return undefined;
        }

        const updateSize = (width, height) => {
            setSize((current) => {
                const nextWidth = Math.round(width);
                const nextHeight = Math.round(height);

                if (current.width === nextWidth && current.height === nextHeight) {
                    return current;
                }

                return { width: nextWidth, height: nextHeight };
            });
        };

        const syncFromNode = () => {
            const { width, height } = node.getBoundingClientRect();
            updateSize(width, height);
        };

        syncFromNode();

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) {
                return;
            }

            updateSize(entry.contentRect.width, entry.contentRect.height);
        });

        observer.observe(node);

        return () => observer.disconnect();
    }, []);

    const isReady = size.width > 0 && size.height > 0;

    return (
        <div ref={containerRef} className="h-full min-h-[220px] w-full min-w-0">
            {isReady ? children(size) : <ChartSkeleton />}
        </div>
    );
};

export const AdminDashboard = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const data = await invoke('get_dashboard_stats');
                setStats(data);
            } catch (err) {
                console.error('Failed to load dashboard stats', err);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    if (loading) {
        return <div className="flex flex-1 items-center justify-center text-lg tracking-wide text-slate-500 animate-pulse">Synchronizing metrics...</div>;
    }

    if (!stats) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-600 shadow-lg">
                    <AlertCircle className="h-6 w-6" />
                    <span className="text-lg font-semibold">Dashboard data unavailable. Database connection failed.</span>
                </div>
            </div>
        );
    }

    const {
        total_students,
        total_employees,
        total_visitors,
        entries_today,
        exits_today,
        attendance_trend = [],
    } = stats;

    const trafficData = [
        { name: 'Today', entries: entries_today, exits: exits_today },
    ];

    const hasTrafficData = entries_today > 0 || exits_today > 0;
    const hasTrendData = attendance_trend.some(
        (day) => day.students > 0 || day.employees > 0 || day.visitors > 0,
    );

    return (
        <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
            <div className="mx-auto flex h-full min-w-0 max-w-[1600px] flex-1 flex-col gap-4 overflow-hidden">
                <section className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#17355d_42%,#0f766e_100%)] p-6 text-white shadow-[0_34px_80px_-42px_rgba(15,23,42,0.75)]">
                    <div className="pointer-events-none absolute -top-20 right-10 h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl" />
                    <div className="pointer-events-none absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-blue-400/20 blur-3xl" />
                    <div className="relative max-w-3xl">
                        <div className="mb-3 flex flex-wrap gap-2.5">
                            <span className="rounded-full border border-white/15 bg-white/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/75">
                                Admin Dashboard
                            </span>
                            <span className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-100">
                                Live local-date analytics
                            </span>
                        </div>
                        <h1 className="max-w-3xl text-2xl font-black tracking-tight text-white md:text-3xl">
                            System overview built for quick gate decisions.
                        </h1>
                        <p className="mt-2.5 max-w-2xl text-xs leading-5 text-slate-200 md:text-sm">
                            Monitor gate activity, attendance movement, and profile totals from one cleaner admin workspace without the oversized dead space from the previous layout.
                        </p>
                    </div>
                </section>

                <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <StatCard
                        title="Total Students"
                        value={total_students}
                        description="Registered student profiles in the system."
                        icon={UserCircle}
                        theme="blue"
                    />
                    <StatCard
                        title="Total Employees"
                        value={total_employees}
                        description="Faculty and staff records available for scanning."
                        icon={Briefcase}
                        theme="emerald"
                    />
                    <StatCard
                        title="Total Visitors"
                        value={total_visitors}
                        description="Visitor records created for access management."
                        icon={Users}
                        theme="amber"
                    />
                    <StatCard
                        title="Entries Today"
                        value={entries_today}
                        description="Entrance scans accepted on the current local date."
                        icon={LogIn}
                        theme="indigo"
                    />
                    <StatCard
                        title="Exits Today"
                        value={exits_today}
                        description="Exit scans completed on the current local date."
                        icon={LogOut}
                        theme="rose"
                    />
                </section>

                <section className="grid flex-1 min-h-0 items-stretch gap-4 xl:grid-cols-[minmax(300px,0.92fr)_minmax(0,1.48fr)]">
                    <ChartCard
                        title="Today's Traffic Flow"
                        description="Compare accepted entrance and exit scans for the current day."
                        icon={Activity}
                        iconClassName="border-indigo-200 bg-indigo-50 text-indigo-600"
                    >
                        {hasTrafficData ? (
                            <ChartSurface>
                                {({ width, height }) => (
                                    <BarChart width={width} height={height} data={trafficData} margin={{ top: 12, right: 8, left: 8, bottom: 0 }} barGap={12}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                        <XAxis
                                            dataKey="name"
                                            tick={{ fill: '#64748b', fontWeight: 600 }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickMargin={10}
                                        />
                                        <YAxis
                                            allowDecimals={false}
                                            tickCount={5}
                                            tick={{ fill: '#64748b', fontWeight: 600 }}
                                            axisLine={false}
                                            tickLine={false}
                                            width={40}
                                        />
                                        <Tooltip content={<DashboardTooltip />} cursor={{ fill: '#f8fafc' }} />
                                        <Legend wrapperStyle={{ paddingTop: '18px' }} iconType="circle" />
                                        <Bar dataKey="entries" name="Entries" fill="#4f46e5" radius={[10, 10, 4, 4]} maxBarSize={56} />
                                        <Bar dataKey="exits" name="Exits" fill="#e11d48" radius={[10, 10, 4, 4]} maxBarSize={56} />
                                    </BarChart>
                                )}
                            </ChartSurface>
                        ) : (
                            <EmptyChartState
                                title="No traffic recorded yet today"
                                message="This chart will populate after the first entrance or exit scan is logged."
                            />
                        )}
                    </ChartCard>

                    <ChartCard
                        title="7-Day Attendance Trend"
                        description="Unique entrance activity for the last seven local dates, grouped by role."
                        icon={TrendingUp}
                        iconClassName="border-emerald-200 bg-emerald-50 text-emerald-600"
                    >
                        {hasTrendData ? (
                            <ChartSurface>
                                {({ width, height }) => (
                                    <AreaChart width={width} height={height} data={attendance_trend} margin={{ top: 10, right: 18, left: -18, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="dashboardStudents" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.24} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="dashboardEmployees" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.24} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="dashboardVisitors" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.22} />
                                                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fill: '#64748b', fontWeight: 600 }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickMargin={10}
                                        />
                                        <YAxis
                                            allowDecimals={false}
                                            tick={{ fill: '#64748b', fontWeight: 600 }}
                                            axisLine={false}
                                            tickLine={false}
                                            width={28}
                                        />
                                        <Tooltip content={<DashboardTooltip />} />
                                        <Legend wrapperStyle={{ paddingTop: '18px' }} iconType="circle" />
                                        <Area
                                            type="monotone"
                                            dataKey="employees"
                                            name="Employees"
                                            stroke="#10b981"
                                            strokeWidth={3}
                                            fillOpacity={1}
                                            fill="url(#dashboardEmployees)"
                                            dot={{ r: 3, strokeWidth: 2, fill: '#ffffff' }}
                                            activeDot={{ r: 5, strokeWidth: 0 }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="students"
                                            name="Students"
                                            stroke="#3b82f6"
                                            strokeWidth={3}
                                            fillOpacity={1}
                                            fill="url(#dashboardStudents)"
                                            dot={{ r: 3, strokeWidth: 2, fill: '#ffffff' }}
                                            activeDot={{ r: 5, strokeWidth: 0 }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="visitors"
                                            name="Visitors"
                                            stroke="#f59e0b"
                                            strokeWidth={3}
                                            fillOpacity={1}
                                            fill="url(#dashboardVisitors)"
                                            dot={{ r: 3, strokeWidth: 2, fill: '#ffffff' }}
                                            activeDot={{ r: 5, strokeWidth: 0 }}
                                        />
                                    </AreaChart>
                                )}
                            </ChartSurface>
                        ) : (
                            <EmptyChartState
                                title="No attendance trend to plot yet"
                                message="Once entrance scans are logged, the last seven local dates will populate automatically instead of staying on a placeholder line."
                            />
                        )}
                    </ChartCard>
                </section>
            </div>
        </div>
    );
};
