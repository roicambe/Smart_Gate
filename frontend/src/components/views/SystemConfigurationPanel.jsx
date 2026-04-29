import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Save, ShieldCheck, Fingerprint, Mail, Info } from 'lucide-react';
import { SettingsSectionHeader } from '../common/SettingsSectionHeader';

export const SystemConfigurationPanel = ({ branding, fetchBranding, adminSession, showToast }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';
    const [strictEmailDomain, setStrictEmailDomain] = useState(true);
    const [enableFaceRecognition, setEnableFaceRecognition] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (branding) {
            setStrictEmailDomain(branding.strict_email_domain ?? true);
            setEnableFaceRecognition(branding.enable_face_recognition ?? false);
        }
    }, [branding]);

    const handleSave = async () => {
        if (!isSystemAdministrator) return;
        
        setIsSaving(true);
        try {
            await invoke('update_system_branding', {
                adminId: adminSession.account_id,
                name: branding.system_name,
                logoBase64: branding.system_logo,
                systemTitle: branding.system_title,
                reportAddress: branding.report_address,
                reportPhone: branding.report_phone,
                reportEmail: branding.report_email,
                primaryLogo: branding.primary_logo,
                secondaryLogo1: branding.secondary_logo_1,
                secondaryLogo2: branding.secondary_logo_2,
                primaryCircle: branding.primary_circle,
                secondary1Circle: branding.secondary1_circle,
                secondary2Circle: branding.secondary2_circle,
                primaryLogoEnabled: branding.primary_logo_enabled,
                secondaryLogo1Enabled: branding.secondary_logo_1_enabled,
                secondaryLogo2Enabled: branding.secondary_logo_2_enabled,
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
            
            <div className="flex flex-col gap-6 mt-6">
                {/* Email Domain Restriction */}
                <div className="flex items-start justify-between gap-6 p-6 rounded-2xl bg-slate-50/60 border border-slate-200 transition-all hover:shadow-md">
                    <div className="flex gap-4">
                        <div className="mt-1 p-3 bg-emerald-100 text-emerald-600 rounded-xl">
                            <Mail className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900">Email Domain Restriction</h3>
                            <p className="text-slate-500 mt-1 max-w-xl">
                                When enabled, university members (Students, Professors, and Staff) must use an email address ending in <span className="font-mono font-bold text-emerald-600">@plpasig.edu.ph</span>. 
                                Visitors are exempted from this rule.
                            </p>
                            <div className="mt-3 flex items-center gap-2 text-sm text-slate-400 italic">
                                <Info className="w-4 h-4" />
                                <span>Helps ensure only authorized institutional accounts are used.</span>
                            </div>
                        </div>
                    </div>
                    <div className="relative inline-flex h-8 w-14 items-center">
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
                            className="h-full w-full cursor-pointer rounded-full bg-slate-300 transition-colors peer-checked:bg-blue-600 peer-disabled:opacity-50"
                        />
                        <div className="absolute left-1 top-1 h-6 w-6 rounded-full bg-white transition-transform peer-checked:translate-x-6 shadow-sm" />
                    </div>
                </div>

                {/* Face Recognition Toggle */}
                <div className="flex items-start justify-between gap-6 p-6 rounded-2xl bg-slate-50/60 border border-slate-200 transition-all hover:shadow-md">
                    <div className="flex gap-4">
                        <div className="mt-1 p-3 bg-blue-100 text-blue-600 rounded-xl">
                            <Fingerprint className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900">Biometric Verification</h3>
                            <p className="text-slate-500 mt-1 max-w-xl">
                                Enable AI-powered face recognition for automated gate access and event attendance. 
                                If disabled, the system will fallback to QR/ID scanning only.
                            </p>
                            <div className="mt-3 flex items-center gap-2 text-sm text-slate-400 italic">
                                <Info className="w-4 h-4" />
                                <span>Requires a compatible camera and face template registration.</span>
                            </div>
                        </div>
                    </div>
                    <div className="relative inline-flex h-8 w-14 items-center">
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
                            className="h-full w-full cursor-pointer rounded-full bg-slate-300 transition-colors peer-checked:bg-blue-600 peer-disabled:opacity-50"
                        />
                        <div className="absolute left-1 top-1 h-6 w-6 rounded-full bg-white transition-transform peer-checked:translate-x-6 shadow-sm" />
                    </div>
                </div>
            </div>
        </div>
    );
};
