import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Upload, X, Save, Image as ImageIcon, ChevronDown, FileText } from 'lucide-react';
import plpLogo from '../../../imgs/plp-logo.png';
import pasigSeal from '../../../imgs/pasig_seal.png';
import pasigUmaagos from '../../../imgs/pasig_umaagos.png';
import { SettingsSectionHeader } from '../common/SettingsSectionHeader';

export const SystemBrandingPanel = ({ branding, fetchBranding, adminSession, showToast }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';
    const [name, setName] = useState('');
    const [systemTitle, setSystemTitle] = useState('');
    const [reportAddress, setReportAddress] = useState('');
    const [reportPhone, setReportPhone] = useState('');
    const [reportEmail, setReportEmail] = useState('');
    const [primaryLogo, setPrimaryLogo] = useState('');
    const [secondaryLogo1, setSecondaryLogo1] = useState('');
    const [secondaryLogo2, setSecondaryLogo2] = useState('');
    const [primaryCircle, setPrimaryCircle] = useState(false);
    const [secondary1Circle, setSecondary1Circle] = useState(false);
    const [secondary2Circle, setSecondary2Circle] = useState(false);
    const [primaryEnabled, setPrimaryEnabled] = useState(true);
    const [secondary1Enabled, setSecondary1Enabled] = useState(true);
    const [secondary2Enabled, setSecondary2Enabled] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isPdfSettingsOpen, setIsPdfSettingsOpen] = useState(false);

    useEffect(() => {
        if (branding) {
            setName(branding.system_name || 'Pamantasan ng Lungsod ng Pasig');
            setSystemTitle(branding.system_title || 'SMART GATE');
            setReportAddress(branding.report_address || 'Alkalde Jose St. Kapasigan Pasig City, Philippines 1600');
            setReportPhone(branding.report_phone || '(106) 628-1014');
            setReportEmail(branding.report_email || 'info@plpasig.edu.ph');
            setPrimaryLogo(branding.primary_logo || branding.system_logo || '');
            setSecondaryLogo1(branding.secondary_logo_1 || '');
            setSecondaryLogo2(branding.secondary_logo_2 || '');
            setPrimaryCircle(branding.primary_circle ?? false);
            setSecondary1Circle(branding.secondary1_circle ?? false);
            setSecondary2Circle(branding.secondary2_circle ?? false);
            setPrimaryEnabled(branding.primary_logo_enabled ?? true);
            setSecondary1Enabled(branding.secondary_logo_1_enabled ?? true);
            setSecondary2Enabled(branding.secondary_logo_2_enabled ?? true);
        }
    }, [branding]);

    const handleFileChange = (e, type) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            showToast('Please upload a valid image file (PNG, JPG).', 'error');
            return;
        }

        if (file.size > 2 * 1024 * 1024) {
            showToast('File is too large. Please upload an image smaller than 2MB.', 'warning');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            if (type === 'primary') setPrimaryLogo(reader.result);
            else if (type === 'secondary1') setSecondaryLogo1(reader.result);
            else if (type === 'secondary2') setSecondaryLogo2(reader.result);
        };
        reader.readAsDataURL(file);
    };

    const removeLogo = (type) => {
        if (type === 'primary') setPrimaryLogo('');
        else if (type === 'secondary1') setSecondaryLogo1('');
        else if (type === 'secondary2') setSecondaryLogo2('');
    };

    const handleSave = async () => {
        if (!name.trim()) {
            showToast('System Name cannot be empty.', 'error');
            return;
        }
        if (!systemTitle.trim()) {
            showToast('System Title cannot be empty.', 'error');
            return;
        }

        // Check if there are any actual changes
        const hasChanges =
            name.trim() !== (branding?.system_name || 'Pamantasan ng Lungsod ng Pasig') ||
            systemTitle.trim() !== (branding?.system_title || 'SMART GATE') ||
            reportAddress.trim() !== (branding?.report_address || 'Alkalde Jose St. Kapasigan Pasig City, Philippines 1600') ||
            reportPhone.trim() !== (branding?.report_phone || '(106) 628-1014') ||
            reportEmail.trim() !== (branding?.report_email || 'info@plpasig.edu.ph') ||
            primaryLogo !== (branding?.primary_logo || branding?.system_logo || '') ||
            secondaryLogo1 !== (branding?.secondary_logo_1 || '') ||
            secondaryLogo2 !== (branding?.secondary_logo_2 || '') ||
            primaryCircle !== (branding?.primary_circle ?? false) ||
            secondary1Circle !== (branding?.secondary1_circle ?? false) ||
            secondary2Circle !== (branding?.secondary2_circle ?? false) ||
            primaryEnabled !== (branding?.primary_logo_enabled ?? true) ||
            secondary1Enabled !== (branding?.secondary_logo_1_enabled ?? true) ||
            secondary2Enabled !== (branding?.secondary_logo_2_enabled ?? true);

        if (!hasChanges) {
            showToast('No changes detected in Institutional Branding.', 'info');
            return;
        }

        setIsSaving(true);

        try {
            await invoke('update_system_branding', {
                adminId: adminSession.account_id,
                name: name.trim(),
                logoBase64: primaryLogo,
                systemTitle: systemTitle.trim(),
                reportAddress: reportAddress.trim(),
                reportPhone: reportPhone.trim(),
                reportEmail: reportEmail.trim(),
                primaryLogo: primaryLogo || null,
                secondaryLogo1: secondaryLogo1 || null,
                secondaryLogo2: secondaryLogo2 || null,
                primaryCircle: primaryCircle,
                secondary1Circle: secondary1Circle,
                secondary2Circle: secondary2Circle,
                primaryLogoEnabled: primaryEnabled,
                secondaryLogo1Enabled: secondary1Enabled,
                secondaryLogo2Enabled: secondary2Enabled,
            });
            await fetchBranding();
            showToast('Settings Updated: Institutional Branding saved.', 'success');
        } catch (err) {
            showToast(typeof err === 'string' ? err : 'Operation failed.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isSystemAdministrator) {
        return (
            <div className="bg-red-50 text-red-700 p-6 rounded-2xl border border-red-200">
                You do not have permission to access system branding details.
            </div>
        );
    }

    const previewPrimaryLogo = primaryLogo || branding?.system_logo || plpLogo;
    const previewSecondaryLogo1 = secondaryLogo1 || pasigSeal;
    const previewSecondaryLogo2 = secondaryLogo2 || pasigUmaagos;
    const previewSystemName = name.trim() || 'Smart Gate System';
    const previewPrimaryCircleClass = primaryCircle ? 'rounded-full' : 'rounded-none';
    const previewSecondary1CircleClass = secondary1Circle ? 'rounded-full' : 'rounded-none';
    const previewSecondary2CircleClass = secondary2Circle ? 'rounded-full' : 'rounded-none';

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 w-full flex flex-col animate-in fade-in duration-500">
            <SettingsSectionHeader
                icon={ImageIcon}
                title="System Identity & Branding"
                description="Maintain university identity, header branding, and PDF report defaults."
                iconWrapperClassName="border-violet-200 bg-violet-50 text-violet-600"
                action={(
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white shadow-sm transition-all hover:bg-blue-700 focus:outline-none disabled:opacity-70 flex-shrink-0"
                    >
                        {isSaving ? (
                            <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
                        ) : (
                            <Save size={16} />
                        )}
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                )}
            />

            <div className="flex flex-col gap-6">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-shrink-0">
                        <div className="lg:col-span-8 min-w-0">
                            <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3 h-full">
                                <div>
                                    <h3 className="text-base font-semibold text-slate-800">University Identity</h3>
                                    <p className="text-sm text-slate-500 mt-1">
                                        Keep the official institution name and visual branding together.
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        System / University Name
                                    </label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                        placeholder="e.g., Pamantasan ng Lungsod ng Pasig"
                                    />
                                </div>

                                <div className="space-y-2.5">
                                    <label className="block text-sm font-semibold text-slate-700">
                                        Institutional Branding Logos
                                    </label>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                            {/* Primary Logo */}
                            <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col items-center gap-2.5">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Primary (Right)</p>
                                <div className="relative">
                                    <div className="w-20 h-20 rounded-full overflow-hidden shadow-sm bg-white border border-slate-200 flex items-center justify-center">
                                        {primaryLogo ? (
                                            <img src={primaryLogo} alt="Primary Logo" className="w-full h-full object-cover" />
                                        ) : (
                                            <img src={plpLogo} alt="Default Logo" className="w-10 h-10 object-contain opacity-40 grayscale" />
                                        )}
                                    </div>
                                    {primaryLogo && (
                                        <button onClick={() => removeLogo('primary')} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-1 shadow-md hover:bg-rose-600 transition-all"><X size={12} /></button>
                                    )}
                                </div>
                                <div className="flex flex-col w-full gap-1">
                                    <label htmlFor="primary-upload" className="w-full flex items-center justify-center gap-2 py-1.5 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-sm font-medium cursor-pointer transition-colors border border-slate-200">
                                        <Upload size={16} /> Upload
                                    </label>
                                    <input type="file" id="primary-upload" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'primary')} />

                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs font-medium text-slate-500">Circle Format</span>
                                        <button
                                            type="button"
                                            onClick={() => setPrimaryCircle(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${primaryCircle ? 'bg-blue-600' : 'bg-slate-300'
                                                }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${primaryCircle ? 'translate-x-5' : 'translate-x-0'
                                                }`} />
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs font-medium text-slate-500">Enable Logo</span>
                                        <button
                                            type="button"
                                            onClick={() => setPrimaryEnabled(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${primaryEnabled ? 'bg-emerald-500' : 'bg-slate-300'
                                                }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${primaryEnabled ? 'translate-x-5' : 'translate-x-0'
                                                }`} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Secondary Logo 1 */}
                            <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col items-center gap-2.5">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Secondary 1 (Left)</p>
                                <div className="relative">
                                    <div className="w-20 h-20 rounded-full overflow-hidden shadow-sm bg-white border border-slate-200 flex items-center justify-center">
                                        {secondaryLogo1 ? (
                                            <img src={secondaryLogo1} alt="Secondary Logo 1" className="w-full h-full object-cover" />
                                        ) : (
                                            <img src={pasigSeal} alt="Pasig Seal" className="w-10 h-10 object-contain opacity-40 grayscale" />
                                        )}
                                    </div>
                                    {secondaryLogo1 && (
                                        <button onClick={() => removeLogo('secondary1')} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-1 shadow-md hover:bg-rose-600 transition-all"><X size={12} /></button>
                                    )}
                                </div>
                                <div className="flex flex-col w-full gap-1">
                                    <label htmlFor="secondary1-upload" className="w-full flex items-center justify-center gap-2 py-1.5 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-sm font-medium cursor-pointer transition-colors border border-slate-200">
                                        <Upload size={16} /> Upload
                                    </label>
                                    <input type="file" id="secondary1-upload" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'secondary1')} />

                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs font-medium text-slate-500">Circle Format</span>
                                        <button
                                            type="button"
                                            onClick={() => setSecondary1Circle(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${secondary1Circle ? 'bg-blue-600' : 'bg-slate-300'
                                                }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${secondary1Circle ? 'translate-x-5' : 'translate-x-0'
                                                }`} />
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs font-medium text-slate-500">Enable Logo</span>
                                        <button
                                            type="button"
                                            onClick={() => setSecondary1Enabled(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${secondary1Enabled ? 'bg-emerald-500' : 'bg-slate-300'
                                                }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${secondary1Enabled ? 'translate-x-5' : 'translate-x-0'
                                                }`} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Secondary Logo 2 */}
                            <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col items-center gap-2.5">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Secondary 2 (Middle)</p>
                                <div className="relative">
                                    <div className="w-20 h-20 rounded-full overflow-hidden shadow-sm bg-white border border-slate-200 flex items-center justify-center">
                                        {secondaryLogo2 ? (
                                            <img src={secondaryLogo2} alt="Secondary Logo 2" className="w-full h-full object-cover" />
                                        ) : (
                                            <img src={pasigUmaagos} alt="Pasig Umaagos" className="w-10 h-10 object-contain opacity-40 grayscale" />
                                        )}
                                    </div>
                                    {secondaryLogo2 && (
                                        <button onClick={() => removeLogo('secondary2')} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-1 shadow-md hover:bg-rose-600 transition-all"><X size={12} /></button>
                                    )}
                                </div>
                                <div className="flex flex-col w-full gap-1">
                                    <label htmlFor="secondary2-upload" className="w-full flex items-center justify-center gap-2 py-1.5 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-sm font-medium cursor-pointer transition-colors border border-slate-200">
                                        <Upload size={16} /> Upload
                                    </label>
                                    <input type="file" id="secondary2-upload" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'secondary2')} />

                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs font-medium text-slate-500">Circle Format</span>
                                        <button
                                            type="button"
                                            onClick={() => setSecondary2Circle(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${secondary2Circle ? 'bg-blue-600' : 'bg-slate-300'
                                                }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${secondary2Circle ? 'translate-x-5' : 'translate-x-0'
                                                }`} />
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs font-medium text-slate-500">Enable Logo</span>
                                        <button
                                            type="button"
                                            onClick={() => setSecondary2Enabled(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${secondary2Enabled ? 'bg-emerald-500' : 'bg-slate-300'
                                                }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${secondary2Enabled ? 'translate-x-5' : 'translate-x-0'
                                                }`} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                                    </div>
                                </div>

                            </section>
                        </div>

                        <div className="lg:col-span-4 min-w-0">
                            <aside className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 h-full flex flex-col">
                                <div className="mb-2.5">
                                    <h3 className="text-sm font-bold text-blue-800 uppercase tracking-widest flex items-center gap-2">
                                        <ImageIcon size={16} /> Header Branding Layout
                                    </h3>
                                    <p className="mt-1 text-xs text-slate-600">
                                        Preview the current header arrangement.
                                    </p>
                                </div>

                                <div className="flex-1 flex flex-col gap-2.5">
                                    <div className="rounded-xl border border-slate-200 bg-slate-900 p-2.5 shadow-sm">
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                            Header Preview
                                        </div>
                                        <div className="mt-1.5 flex items-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {branding?.secondary_logo_1_enabled !== false && (
                                                    <div className={`h-7 w-7 overflow-hidden bg-white/95 flex items-center justify-center ${previewSecondary1CircleClass}`}>
                                                        <img
                                                            src={previewSecondaryLogo1}
                                                            alt="Secondary Logo 1 preview"
                                                            className={`h-full w-full ${secondary1Circle ? 'object-cover' : 'object-contain'}`}
                                                        />
                                                    </div>
                                                )}
                                                {branding?.secondary_logo_2_enabled !== false && (
                                                    <div className={`h-7 w-7 overflow-hidden bg-white/95 flex items-center justify-center ${previewSecondary2CircleClass}`}>
                                                        <img
                                                            src={previewSecondaryLogo2}
                                                            alt="Secondary Logo 2 preview"
                                                            className={`h-full w-full ${secondary2Circle ? 'object-cover' : 'object-contain'}`}
                                                        />
                                                    </div>
                                                )}
                                                {branding?.primary_logo_enabled !== false && (
                                                    <div className={`h-7 w-7 overflow-hidden bg-white/95 flex items-center justify-center ${previewPrimaryCircleClass}`}>
                                                        <img
                                                            src={previewPrimaryLogo}
                                                            alt="Primary Logo preview"
                                                            className={`h-full w-full ${primaryCircle ? 'object-cover' : 'object-contain'}`}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="truncate text-xs font-semibold text-white">
                                                    {previewSystemName}
                                                </div>
                                                <div className="text-[11px] text-slate-400">
                                                    Left to right arrangement
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-blue-100 bg-white/80 p-2.5">
                                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
                                            Logo Order
                                        </div>
                                        <div className="mt-2 space-y-1">
                                            <div className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
                                                <span className="w-5.5 h-5.5 flex items-center justify-center bg-blue-600 text-white text-xs rounded-full font-bold">1</span>
                                                <span className="font-semibold text-slate-800 text-xs">Secondary Logo 1</span>
                                            </div>
                                            <div className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
                                                <span className="w-5.5 h-5.5 flex items-center justify-center bg-blue-600 text-white text-xs rounded-full font-bold">2</span>
                                                <span className="font-semibold text-slate-800 text-xs">Secondary Logo 2</span>
                                            </div>
                                            <div className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
                                                <span className="w-5.5 h-5.5 flex items-center justify-center bg-blue-600 text-white text-xs rounded-full font-bold">3</span>
                                                <span className="font-semibold text-slate-800 text-xs">Primary Logo</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-auto rounded-xl border border-blue-100 bg-white/70 px-3 py-2">
                                        <p className="text-[11px] text-slate-500">
                                            Upload PNG or JPG files up to 2MB. Circle format clips each logo directly in the application header.
                                        </p>
                                    </div>
                                </div>
                            </aside>
                        </div>
                        </div>

                        <div className="min-w-0">
                            <div className="w-full rounded-xl border border-slate-200 bg-white overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setIsPdfSettingsOpen((prev) => !prev)}
                                    className={`w-full px-4 py-3.5 bg-slate-50/80 flex items-center justify-between text-left ${isPdfSettingsOpen ? 'border-b border-slate-200' : ''}`}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
                                            <FileText size={16} />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-base font-semibold text-slate-800">PDF Settings</h3>
                                            <p className="text-sm text-slate-500 truncate">Report title and contact details used in generated PDFs.</p>
                                        </div>
                                    </div>
                                    <ChevronDown size={18} className={`text-slate-500 transition-transform flex-shrink-0 ${isPdfSettingsOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isPdfSettingsOpen && (
                                    <div className="p-8 space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                                            PDF Title
                                        </label>
                                        <input
                                            type="text"
                                            value={systemTitle}
                                            onChange={(e) => setSystemTitle(e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                            placeholder="e.g., SMART GATE"
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                                Contact Phone
                                            </label>
                                            <input
                                                type="text"
                                                value={reportPhone}
                                                onChange={(e) => setReportPhone(e.target.value)}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                                placeholder="e.g., (106) 628-1014"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                                Contact Email
                                            </label>
                                            <input
                                                type="text"
                                                value={reportEmail}
                                                onChange={(e) => setReportEmail(e.target.value)}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                                placeholder="e.g., info@plpasig.edu.ph"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                                            Contact Address
                                        </label>
                                        <input
                                            type="text"
                                            value={reportAddress}
                                            onChange={(e) => setReportAddress(e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                            placeholder="e.g., Pasig City, Philippines"
                                        />
                                    </div>
                                    </div>
                                )}
                            </div>
                        </div>
            </div>
        </div>
    );
};
