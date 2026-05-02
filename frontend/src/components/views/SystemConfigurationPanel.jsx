import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Save, ShieldCheck, Fingerprint, Mail, Info, GraduationCap, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { SettingsSectionHeader } from '../common/SettingsSectionHeader';
import { AdminModal } from '../common/AdminModal';

export const SystemConfigurationPanel = ({ branding, fetchBranding, adminSession, showToast }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';
    const [strictEmailDomain, setStrictEmailDomain] = useState(true);
    const [enableFaceRecognition, setEnableFaceRecognition] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Promotion Modal state
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [confirmInput, setConfirmInput] = useState('');
    const [isPromoting, setIsPromoting] = useState(false);

    useEffect(() => {
        if (branding) {
            setStrictEmailDomain(branding.strict_email_domain ?? true);
            setEnableFaceRecognition(branding.enable_face_recognition ?? true);
        }
    }, [branding]);

    const handleSave = async () => {
        if (!isSystemAdministrator) return;

        setIsSaving(true);
        try {
            await invoke('update_system_configuration', {
                adminId: adminSession.account_id,
                strictEmailDomain: strictEmailDomain,
                enableFaceRecognition: enableFaceRecognition
            });

            await fetchBranding();
            showToast('System configuration updated successfully.', 'success');
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 w-full flex flex-col animate-in fade-in duration-500">
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
        </div>
    );
};
