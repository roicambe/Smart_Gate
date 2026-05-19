import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Save, ShieldCheck, Fingerprint, Mail, Info, GraduationCap, AlertTriangle, Check, RefreshCw, Clock, ArrowLeftRight, Eye, EyeOff, HelpCircle, ExternalLink, Key, BookOpen, X } from 'lucide-react';
import { SettingsSectionHeader } from '../common/SettingsSectionHeader';
import { AdminModal } from '../common/AdminModal';

export const SystemConfigurationPanel = ({ branding, fetchBranding, adminSession, showToast }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';
    const [strictEmailDomain, setStrictEmailDomain] = useState(true);
    const [enableFaceRecognition, setEnableFaceRecognition] = useState(true);
    const [enableAutoExit, setEnableAutoExit] = useState(true);
    const [autoExitTime, setAutoExitTime] = useState('22:00');
    const [enableEntryExitValidation, setEnableEntryExitValidation] = useState(true);
    // Email provider
    const [emailProvider, setEmailProvider] = useState('smtp');
    // Brevo settings
    const [brevoApiKey, setBrevoApiKey] = useState('');
    const [brevoFromName, setBrevoFromName] = useState('');
    // SMTP settings
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState('587');
    const [smtpUsername, setSmtpUsername] = useState('');
    const [smtpPassword, setSmtpPassword] = useState('');
    const [smtpFromName, setSmtpFromName] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Password visibility states
    const [showSmtpPassword, setShowSmtpPassword] = useState(false);
    const [showBrevoApiKey, setShowBrevoApiKey] = useState(false);

    // Help modal states
    const [isSmtpHelpOpen, setIsSmtpHelpOpen] = useState(false);
    const [isBrevoHelpOpen, setIsBrevoHelpOpen] = useState(false);

    // Promotion Modal state
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [confirmInput, setConfirmInput] = useState('');
    const [isPromoting, setIsPromoting] = useState(false);

    useEffect(() => {
        if (branding) {
            setStrictEmailDomain(branding.strict_email_domain ?? true);
            setEnableFaceRecognition(branding.enable_face_recognition ?? true);
            setEnableAutoExit(branding.enable_auto_exit ?? false);
            setAutoExitTime(branding.auto_exit_time ?? '22:00');
            setEnableEntryExitValidation(branding.enable_entry_exit_validation ?? true);
            setEmailProvider(branding.email_provider ?? 'smtp');
            setBrevoApiKey(branding.brevo_api_key ?? '');
            setBrevoFromName(branding.brevo_from_name || 'Smart Gate - PLP');
            setSmtpHost(branding.smtp_host ?? '');
            setSmtpPort(branding.smtp_port ?? '587');
            setSmtpUsername(branding.smtp_username ?? '');
            setSmtpPassword(branding.smtp_password ?? '');
            setSmtpFromName(branding.smtp_from_name || 'Smart Gate - PLP');
        }
    }, [branding]);

    const handleSave = async () => {
        if (!isSystemAdministrator) return;

        setIsSaving(true);
        try {
            const hasChanges = await invoke('update_system_configuration', {
                adminId: adminSession.account_id,
                strictEmailDomain,
                enableFaceRecognition,
                enableAutoExit,
                autoExitTime,
                enableEntryExitValidation,
                brevoApiKey,
                emailProvider,
                smtpHost,
                smtpPort,
                smtpUsername,
                smtpPassword,
                smtpFromName,
                brevoFromName,
            });

            if (hasChanges) {
                await fetchBranding();
                showToast('System configuration updated successfully.', 'success');
            } else {
                showToast('No changes detected in System Configuration.', 'info');
            }
        } catch (error) {
            console.error('Save error:', error);
            showToast(error || 'Failed to update system configuration.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handlePromote = async () => {
        if (!isSystemAdministrator || confirmInput !== 'PROMOTE') return;

        setIsPromoting(true);
        try {
            await invoke('promote_all_students', { activeAdminId: adminSession.account_id });
            showToast('All students have been promoted to the next year level.', 'success');
            setIsConfirmModalOpen(false);
        } catch (error) {
            console.error('Promotion error:', error);
            showToast(error || 'Failed to promote students.', 'error');
        } finally {
            setIsPromoting(false);
        }
    };

    const openConfirmModal = () => {
        setConfirmInput('');
        setIsConfirmModalOpen(true);
    };

    const canSubmitPromotion = confirmInput === 'PROMOTE' && !isPromoting;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm w-full flex flex-col animate-in fade-in duration-500 overflow-hidden h-full max-h-[calc(100vh-16rem)]">
            {/* Header Section (Fixed) */}
            <div className="px-8 pt-8 pb-4 flex-shrink-0 bg-white">
                <SettingsSectionHeader
                    icon={ShieldCheck}
                    title="System Policies & Configuration"
                    description="Configure global access rules, biometric verification, and security settings."
                    iconWrapperClassName="border-blue-200 bg-blue-50 text-blue-600"
                    action={(
                        <button
                            onClick={handleSave}
                            disabled={!isSystemAdministrator || isSaving}
                            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-blue-700 focus:outline-none disabled:opacity-70 flex-shrink-0"
                        >
                            {isSaving ? (
                                <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            ) : (
                                <Save size={16} />
                            )}
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    )}
                />
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-white border-t border-slate-100">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Email Domain Restriction */}
                <div className="flex flex-col justify-between gap-4 p-6 rounded-2xl bg-slate-50/60 border border-slate-200 transition-all hover:shadow-md">
                    <div className="flex gap-4">
                        <div className="mt-1 p-3 bg-emerald-100 text-emerald-600 rounded-xl flex-shrink-0 h-fit">
                            <Mail className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900 leading-tight">Email Domain Restriction</h3>
                            <p className="text-slate-500 mt-2 text-sm leading-relaxed">
                                University members must use <span className="font-mono font-bold text-emerald-600">@plpasig.edu.ph</span>. Visitors are exempted.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-200/60">
                        <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                            <Info className="w-3.5 h-3.5" />
                            <span>Mandatory institutional access.</span>
                        </div>
                        <div className="relative inline-flex h-7 w-12 items-center">
                            <input
                                type="checkbox"
                                className="peer sr-only"
                                checked={strictEmailDomain}
                                onChange={(e) => setStrictEmailDomain(e.target.checked)}
                                disabled={!isSystemAdministrator || isSaving}
                                id="strict-email-toggle"
                            />
                            <label
                                htmlFor="strict-email-toggle"
                                className="h-full w-full cursor-pointer rounded-full bg-slate-300 transition-all duration-300 ease-in-out peer-checked:bg-blue-600 peer-disabled:opacity-50"
                            />
                            <div className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-all duration-300 ease-in-out peer-checked:translate-x-5 shadow-sm pointer-events-none" />
                        </div>
                    </div>
                </div>

                {/* Face Recognition Toggle */}
                <div className="flex flex-col justify-between gap-4 p-6 rounded-2xl bg-slate-50/60 border border-slate-200 transition-all hover:shadow-md">
                    <div className="flex gap-4">
                        <div className="mt-1 p-3 bg-blue-100 text-blue-600 rounded-xl flex-shrink-0 h-fit">
                            <Fingerprint className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900 leading-tight">Biometric Verification</h3>
                            <p className="text-slate-500 mt-2 text-sm leading-relaxed">
                                Enable AI face recognition for automated gate access. Fallback to QR scanning if disabled.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-200/60">
                        <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                            <Info className="w-3.5 h-3.5" />
                            <span>Requires compatible hardware.</span>
                        </div>
                        <div className="relative inline-flex h-7 w-12 items-center">
                            <input
                                type="checkbox"
                                className="peer sr-only"
                                checked={enableFaceRecognition}
                                onChange={(e) => setEnableFaceRecognition(e.target.checked)}
                                disabled={!isSystemAdministrator || isSaving}
                                id="face-recog-toggle"
                            />
                            <label
                                htmlFor="face-recog-toggle"
                                className="h-full w-full cursor-pointer rounded-full bg-slate-300 transition-all duration-300 ease-in-out peer-checked:bg-blue-600 peer-disabled:opacity-50"
                            />
                            <div className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-all duration-300 ease-in-out peer-checked:translate-x-5 shadow-sm pointer-events-none" />
                        </div>
                    </div>
                </div>

                {/* Automatic Campus Exit */}
                <div className="flex flex-col justify-between gap-4 p-6 rounded-2xl bg-slate-50/60 border border-slate-200 transition-all hover:shadow-md">
                    <div className="flex gap-4">
                        <div className="mt-1 p-3 bg-purple-100 text-purple-600 rounded-xl flex-shrink-0 h-fit">
                            <Clock className="w-6 h-6" />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-semibold text-slate-900 leading-tight">Automatic Campus Exit</h3>
                                <div className="relative inline-flex h-7 w-12 items-center">
                                    <input
                                        type="checkbox"
                                        className="peer sr-only"
                                        checked={enableAutoExit}
                                        onChange={(e) => setEnableAutoExit(e.target.checked)}
                                        disabled={!isSystemAdministrator || isSaving}
                                        id="auto-exit-toggle"
                                    />
                                    <label
                                        htmlFor="auto-exit-toggle"
                                        className="h-full w-full cursor-pointer rounded-full bg-slate-300 transition-all duration-300 ease-in-out peer-checked:bg-blue-600 peer-disabled:opacity-50"
                                    />
                                    <div className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-all duration-300 ease-in-out peer-checked:translate-x-5 shadow-sm pointer-events-none" />
                                </div>
                            </div>
                            <p className="text-slate-500 mt-2 text-sm leading-relaxed">
                                Automatically records an 'Exit' log for all users still marked as 'Inside' once the closing time is reached.
                            </p>
                            
                            {enableAutoExit && (
                                <div className="mt-4 p-4 rounded-xl bg-white border border-slate-200 flex items-center justify-between animate-in slide-in-from-top-2 duration-300">
                                    <span className="text-sm font-medium text-slate-600 uppercase tracking-wider">Closing Time</span>
                                    <input
                                        type="time"
                                        value={autoExitTime}
                                        onChange={(e) => setAutoExitTime(e.target.value)}
                                        disabled={!isSystemAdministrator || isSaving}
                                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-200/60">
                        <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                            <Info className="w-3.5 h-3.5" />
                            <span>Prevents overnight "Inside" status.</span>
                        </div>
                    </div>
                </div>

                {/* Entry-Exit Validation */}
                <div className="flex flex-col justify-between gap-4 p-6 rounded-2xl bg-slate-50/60 border border-slate-200 transition-all hover:shadow-md">
                    <div className="flex gap-4">
                        <div className="mt-1 p-3 bg-rose-100 text-rose-600 rounded-xl flex-shrink-0 h-fit">
                            <ArrowLeftRight className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900 leading-tight">Entry-Exit Validation</h3>
                            <p className="text-slate-500 mt-2 text-sm leading-relaxed">
                                Enforce logical flow by requiring an 'Entry' log before allowing an 'Exit'. Useful for single-computer setups.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-200/60">
                        <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                            <Info className="w-3.5 h-3.5" />
                            <span>Disable for offline/distributed gate nodes.</span>
                        </div>
                        <div className="relative inline-flex h-7 w-12 items-center">
                            <input
                                type="checkbox"
                                className="peer sr-only"
                                checked={enableEntryExitValidation}
                                onChange={(e) => setEnableEntryExitValidation(e.target.checked)}
                                disabled={!isSystemAdministrator || isSaving}
                                id="entry-exit-toggle"
                            />
                            <label
                                htmlFor="entry-exit-toggle"
                                className="h-full w-full cursor-pointer rounded-full bg-slate-300 transition-all duration-300 ease-in-out peer-checked:bg-blue-600 peer-disabled:opacity-50"
                            />
                            <div className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-all duration-300 ease-in-out peer-checked:translate-x-5 shadow-sm pointer-events-none" />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Email Service Configuration ── */}
            <div className="mt-8 pt-8 border-t border-slate-100">
                <div className="flex flex-col gap-5">
                    {/* Header row */}
                    <div className="flex gap-4">
                        <div className="mt-1 p-3 bg-indigo-100 text-indigo-600 rounded-xl flex-shrink-0 h-fit">
                            <Mail className="w-6 h-6" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-semibold text-slate-900 leading-tight">Email Service Configuration</h3>
                            <p className="text-slate-500 mt-1 text-sm leading-relaxed">
                                Choose how the system sends transactional emails (OTPs, Visitor QR Codes, etc.). SMTP is the default and works with Gmail, Outlook, or any mail server.
                            </p>
                        </div>
                    </div>

                    {/* Provider Toggle Pills */}
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
                        {['smtp', 'brevo'].map((p) => (
                            <button
                                key={p}
                                id={`email-provider-${p}`}
                                onClick={() => isSystemAdministrator && !isSaving && setEmailProvider(p)}
                                disabled={!isSystemAdministrator || isSaving}
                                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200 disabled:opacity-60 ${
                                    emailProvider === p
                                        ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-200'
                                        : 'text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                {p === 'smtp' ? 'SMTP (Recommended)' : 'Brevo API'}
                            </button>
                        ))}
                    </div>

                    {/* ── SMTP Panel ── */}
                    {emailProvider === 'smtp' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 rounded-2xl bg-slate-50/60 border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="md:col-span-2 flex justify-between items-center pb-2 border-b border-slate-200/60">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">SMTP Server Settings</span>
                                <button
                                    type="button"
                                    onClick={() => setIsSmtpHelpOpen(true)}
                                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-indigo-50"
                                >
                                    <HelpCircle size={14} />
                                    <span>Setup Guide</span>
                                </button>
                            </div>
                            {/* SMTP Host */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                                    SMTP Host
                                </label>
                                <input
                                    type="text"
                                    value={smtpHost}
                                    onChange={(e) => setSmtpHost(e.target.value)}
                                    disabled={!isSystemAdministrator || isSaving}
                                    placeholder="smtp.gmail.com"
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-60"
                                />
                            </div>
                            {/* SMTP Port */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                                    Port
                                </label>
                                <input
                                    type="text"
                                    value={smtpPort}
                                    onChange={(e) => setSmtpPort(e.target.value)}
                                    disabled={!isSystemAdministrator || isSaving}
                                    placeholder="587"
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-60"
                                />
                                <p className="mt-1.5 text-xs text-slate-400 italic">587 = STARTTLS, 465 = TLS</p>
                            </div>
                            {/* SMTP Username */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                                    Username / Email Address
                                </label>
                                <input
                                    type="text"
                                    value={smtpUsername}
                                    onChange={(e) => setSmtpUsername(e.target.value)}
                                    disabled={!isSystemAdministrator || isSaving}
                                    placeholder="smartgate@example.com"
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-60"
                                />
                            </div>
                            {/* SMTP Password */}
                            <div>
                                <style>{`
                                    .no-browser-reveal::-ms-reveal,
                                    .no-browser-reveal::-ms-clear,
                                    .no-browser-reveal::-webkit-contacts-auto-fill-button,
                                    .no-browser-reveal::-webkit-credentials-auto-fill-button {
                                        display: none !important;
                                        width: 0 !important;
                                        height: 0 !important;
                                    }
                                `}</style>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                                    Password / App Password
                                </label>
                                <div className="relative group">
                                    <input
                                        type={showSmtpPassword ? "text" : "password"}
                                        value={smtpPassword}
                                        onChange={(e) => setSmtpPassword(e.target.value)}
                                        disabled={!isSystemAdministrator || isSaving}
                                        placeholder="••••••••••••"
                                        className="w-full bg-white border border-slate-200 rounded-xl pl-4 pr-10 py-2.5 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-60 no-browser-reveal"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                                        disabled={!isSystemAdministrator || isSaving}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-500 transition-colors focus:outline-none disabled:opacity-50"
                                    >
                                        {showSmtpPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                            {/* Sender Display Name */}
                            <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                                    Sender Display Name
                                </label>
                                <input
                                    type="text"
                                    value={smtpFromName}
                                    onChange={(e) => setSmtpFromName(e.target.value)}
                                    disabled={!isSystemAdministrator || isSaving}
                                    placeholder="Smart Gate - PLP"
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-60"
                                />
                                <p className="mt-2 text-xs text-slate-400 flex items-center gap-1.5 italic">
                                    <Info size={12} />
                                    <span>For Gmail, use an App Password (not your account password) from Google Account → Security → App Passwords.</span>
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── Brevo Panel ── */}
                    {emailProvider === 'brevo' && (
                        <div className="grid grid-cols-1 gap-4 p-5 rounded-2xl bg-slate-50/60 border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="flex justify-between items-center pb-2 border-b border-slate-200/60">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Brevo API Settings</span>
                                <button
                                    type="button"
                                    onClick={() => setIsBrevoHelpOpen(true)}
                                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-indigo-50"
                                >
                                    <HelpCircle size={14} />
                                    <span>Setup Guide</span>
                                </button>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                    Brevo API v3 Key
                                </label>
                                <div className="relative group">
                                    <input
                                        type={showBrevoApiKey ? "text" : "password"}
                                        value={brevoApiKey}
                                        onChange={(e) => setBrevoApiKey(e.target.value)}
                                        disabled={!isSystemAdministrator || isSaving}
                                        placeholder="xkeysib-..."
                                        className="w-full bg-white border border-slate-200 rounded-2xl pl-5 pr-12 py-3.5 text-sm font-mono text-slate-900 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all disabled:opacity-60 no-browser-reveal"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowBrevoApiKey(!showBrevoApiKey)}
                                        disabled={!isSystemAdministrator || isSaving}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-500 transition-colors focus:outline-none disabled:opacity-50"
                                    >
                                        {showBrevoApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                    Sender Display Name
                                </label>
                                <input
                                    type="text"
                                    value={brevoFromName}
                                    onChange={(e) => setBrevoFromName(e.target.value)}
                                    disabled={!isSystemAdministrator || isSaving}
                                    placeholder="Smart Gate - PLP"
                                    className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3.5 text-sm text-slate-900 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all disabled:opacity-60"
                                />
                            </div>
                            <p className="mt-1 text-xs text-slate-400 flex items-center gap-1.5 italic">
                                <Info size={12} />
                                <span>Get your API key from app.brevo.com → SMTP &amp; API → API Keys. The sender email must be verified in Brevo.</span>
                            </p>
                        </div>
                    )}
                </div>
            </div>


            {/* Academic Year Promotion */}
            <div className="mt-6 pt-6 border-t border-slate-100">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-2xl bg-amber-50/40 border border-amber-200/60 transition-all hover:shadow-md">
                    <div className="flex gap-4 items-center">
                        <div className="p-3 bg-amber-100 text-amber-600 rounded-xl flex-shrink-0">
                            <GraduationCap className="w-7 h-7" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">Student Year Level Promotion</h3>
                            <p className="text-slate-500 text-sm mt-0.5">
                                Securely increment the year level of all registered students by 1.
                                <span className="hidden md:inline"> This is typically done at the start of a new academic year.</span>
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={openConfirmModal}
                        disabled={!isSystemAdministrator || isSaving}
                        className="w-full md:w-auto flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-6 py-3 font-bold text-white shadow-md shadow-amber-600/10 transition-all hover:bg-amber-700 focus:outline-none disabled:opacity-50"
                    >
                        <RefreshCw size={18} />
                        Promote All Students
                    </button>
                </div>
            </div>
            </div>

            {/* Confirmation Modal */}
            {isConfirmModalOpen && (
                <AdminModal
                    isOpen={isConfirmModalOpen}
                    onClose={() => setIsConfirmModalOpen(false)}
                    title="BULK STUDENT PROMOTION"
                    tone="default"
                    icon={<GraduationCap className="w-5 h-5 text-amber-300" />}
                    size="md"
                    footer={(
                        <div className="flex w-full items-center gap-3">
                            <button
                                onClick={() => setIsConfirmModalOpen(false)}
                                disabled={isPromoting}
                                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handlePromote}
                                disabled={!canSubmitPromotion}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg shadow-amber-600/20"
                            >
                                {isPromoting ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                                {isPromoting ? 'Processing...' : 'Confirm Promotion'}
                            </button>
                        </div>
                    )}
                >
                    <div className="space-y-8">
                        <div className="text-center space-y-4">
                            <div className="mx-auto w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mb-4 border border-amber-500/20">
                                <Info className="w-8 h-8 text-amber-500" />
                            </div>
                            <p className="text-white/70 leading-relaxed text-lg">
                                This action will increment the year level of <span className="text-white font-bold underline">ALL</span> registered students in the system.
                            </p>
                            <div className="py-3 px-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl inline-block">
                                <p className="text-xl font-bold text-amber-400 tracking-wide uppercase">
                                    Academic Year Level Up
                                </p>
                            </div>
                            <p className="text-white/40 text-sm italic">
                                Note: This action is typically performed at the start of a new semester or school year.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <label className="block text-xs font-semibold text-white/40 text-center uppercase tracking-widest">
                                To confirm, type <span className="font-mono font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">PROMOTE</span> below
                            </label>
                            <input
                                type="text"
                                value={confirmInput}
                                onChange={(e) => setConfirmInput(e.target.value.toUpperCase())}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && canSubmitPromotion) {
                                        handlePromote();
                                    }
                                }}
                                placeholder="PROMOTE"
                                className="w-full text-center text-base tracking-widest font-mono px-4 py-3 bg-black/40 border-2 border-amber-500/30 focus:border-amber-500 rounded-2xl text-white placeholder-white/5 focus:outline-none focus:ring-4 focus:ring-amber-500/10 transition-all shadow-inner"
                                autoFocus
                            />
                        </div>
                    </div>
                </AdminModal>
            )}

            {/* SMTP Guide Modal */}
            {isSmtpHelpOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
                    <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-indigo-50/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                                    <BookOpen size={20} />
                                </div>
                                <div>
                                    <h4 className="text-base font-bold text-slate-800">SMTP Configuration Guide</h4>
                                    <p className="text-xs text-slate-500">Configure your system to relay emails through standard mail servers.</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsSmtpHelpOpen(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all focus:outline-none"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-600">
                            {/* Definition Fields */}
                            <div>
                                <h5 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                    <span className="w-1.5 h-3 bg-indigo-500 rounded-full"></span>
                                    Understanding the Configuration Fields
                                </h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                                        <p className="font-semibold text-slate-800 text-xs uppercase tracking-wider mb-1">SMTP Host</p>
                                        <p className="text-xs text-slate-505 leading-relaxed">The address of your provider's mail server. E.g. <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">smtp.gmail.com</span> for Gmail.</p>
                                    </div>
                                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                                        <p className="font-semibold text-slate-800 text-xs uppercase tracking-wider mb-1">Port</p>
                                        <p className="text-xs text-slate-505 leading-relaxed">The network port. Use <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">587</span> for secure STARTTLS (recommended) or <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">465</span> for implicit TLS.</p>
                                    </div>
                                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                                        <p className="font-semibold text-slate-800 text-xs uppercase tracking-wider mb-1">Username / Email</p>
                                        <p className="text-xs text-slate-505 leading-relaxed">The full email account address you are using to send messages (e.g., <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">yourname@gmail.com</span>).</p>
                                    </div>
                                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                                        <p className="font-semibold text-slate-800 text-xs uppercase tracking-wider mb-1">Sender Display Name</p>
                                        <p className="text-xs text-slate-505 leading-relaxed">The friendly name recipients see in their inbox (e.g. <span className="font-semibold text-slate-800">Smart Gate - PLP</span>).</p>
                                    </div>
                                </div>
                            </div>

                            {/* Google App Password Guide */}
                            <div className="p-5 rounded-2xl bg-indigo-50/50 border border-indigo-100/60 space-y-4">
                                <div className="flex items-center gap-2.5 pb-2.5 border-b border-indigo-100">
                                    <Key className="w-5 h-5 text-indigo-600" />
                                    <h5 className="font-bold text-indigo-900">How to get Gmail App Password</h5>
                                </div>
                                <ol className="list-decimal list-inside space-y-3.5 text-xs text-indigo-950 font-medium">
                                    <li>
                                        Open a browser, go to <span className="font-mono bg-indigo-100 text-indigo-850 border border-indigo-200 rounded-lg px-2 py-0.5 font-bold">myaccount.google.com</span> and log in.
                                    </li>
                                    <li>
                                        Click <span className="bg-white border border-indigo-200 rounded px-1.5 py-0.5 font-bold">Security</span> in the left-hand sidebar menu.
                                    </li>
                                    <li>
                                        Scroll down to the <span className="italic">"How you sign in to Google"</span> section. Make sure <span className="font-bold">2-Step Verification</span> is enabled (this is required by Google).
                                    </li>
                                    <li>
                                        Go back to the Security tab and search for <span className="font-bold">"App Passwords"</span> in the top search bar (or go directly to <span className="font-mono bg-indigo-100 text-indigo-850 border border-indigo-200 rounded-lg px-2 py-0.5 font-bold">myaccount.google.com/apppasswords</span>).
                                    </li>
                                    <li>
                                        Click <span className="bg-white border border-indigo-200 rounded px-1.5 py-0.5 font-bold">Create</span>, give it a custom name like <span className="font-mono text-indigo-700 bg-white border border-indigo-200 rounded px-1.5 py-0.5">SmartGate</span>, and click generate.
                                    </li>
                                    <li>
                                        Google will instantly display a <span className="bg-amber-100 text-amber-900 border border-amber-200 rounded px-2 py-0.5 font-bold text-sm tracking-widest font-mono">16-character password</span> (e.g., <span className="font-mono">abcd efgh ijkl mnop</span>).
                                    </li>
                                    <li>
                                        Copy that password, <span className="text-indigo-700 font-bold">remove the spaces</span>, and paste it directly into the <span className="font-bold">Password / App Password</span> field in Smart Gate configuration.
                                    </li>
                                </ol>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end bg-slate-50">
                            <button
                                onClick={() => setIsSmtpHelpOpen(false)}
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/10 transition-all text-xs"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Brevo Guide Modal */}
            {isBrevoHelpOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
                    <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-indigo-50/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                                    <BookOpen size={20} />
                                </div>
                                <div>
                                    <h4 className="text-base font-bold text-slate-800">Brevo API Configuration Guide</h4>
                                    <p className="text-xs text-slate-500">Configure your system to dispatch emails over high-reputation HTTP API.</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsBrevoHelpOpen(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all focus:outline-none"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-600">
                            {/* Definition Fields */}
                            <div>
                                <h5 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                    <span className="w-1.5 h-3 bg-indigo-500 rounded-full"></span>
                                    Understanding the Configuration Fields
                                </h5>
                                <div className="grid grid-cols-1 gap-4">
                                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                                        <p className="font-semibold text-slate-800 text-xs uppercase tracking-wider mb-1">Brevo API v3 Key</p>
                                        <p className="text-xs text-slate-505 leading-relaxed">The secure token used to authenticate requests to Brevo's mail servers. It starts with <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">xkeysib-</span>.</p>
                                    </div>
                                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                                        <p className="font-semibold text-slate-800 text-xs uppercase tracking-wider mb-1">Sender Display Name</p>
                                        <p className="text-xs text-slate-505 leading-relaxed">The friendly display name shown to visitors (e.g. <span className="font-semibold text-slate-800">Smart Gate - PLP</span>). The sending email defaults to your verified sender address.</p>
                                    </div>
                                </div>
                            </div>

                            {/* Brevo Guide */}
                            <div className="p-5 rounded-2xl bg-indigo-50/50 border border-indigo-100/60 space-y-4">
                                <div className="flex items-center gap-2.5 pb-2.5 border-b border-indigo-100">
                                    <Key className="w-5 h-5 text-indigo-600" />
                                    <h5 className="font-bold text-indigo-900">How to get Brevo API Key</h5>
                                </div>
                                <ol className="list-decimal list-inside space-y-3.5 text-xs text-indigo-950 font-medium">
                                    <li>
                                        Open a browser, go to <span className="font-mono bg-indigo-100 text-indigo-850 border border-indigo-200 rounded-lg px-2 py-0.5 font-bold">brevo.com</span> and sign up or log in.
                                    </li>
                                    <li>
                                        Navigate to <span className="bg-white border border-indigo-200 rounded px-1.5 py-0.5 font-bold">Settings</span> in the dashboard menu.
                                    </li>
                                    <li>
                                        Select <span className="font-bold text-indigo-800">SMTP &amp; API</span> from the settings menu.
                                    </li>
                                    <li>
                                        Navigate to the <span className="bg-white border border-indigo-200 rounded px-1.5 py-0.5 font-bold">API Keys</span> tab.
                                    </li>
                                    <li>
                                        Click <span className="bg-white border border-indigo-200 rounded px-1.5 py-0.5 font-bold">Generate a new API key</span>.
                                    </li>
                                    <li>
                                        Give the API key a descriptive label (like <span className="font-mono text-indigo-700 bg-white border border-indigo-200 rounded px-1.5 py-0.5">SmartGate</span>) and click generate.
                                    </li>
                                    <li>
                                        Copy the long key (starting with <span className="font-mono">xkeysib-</span>) **immediately** (it will never be shown again!) and paste it into the **Brevo API v3 Key** field in Smart Gate configuration.
                                    </li>
                                </ol>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-slate-100 flex justify-end bg-slate-50">
                            <button
                                onClick={() => setIsBrevoHelpOpen(false)}
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/10 transition-all text-xs"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
