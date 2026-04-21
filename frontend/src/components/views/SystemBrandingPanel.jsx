import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Upload, X, Save, Image as ImageIcon } from 'lucide-react';
import plpLogo from '../../../imgs/plp-logo.png';
import pasigSeal from '../../../imgs/pasig_seal.png';
import pasigUmaagos from '../../../imgs/pasig_umaagos.png';

export const SystemBrandingPanel = ({ branding, fetchBranding, adminSession, showToast }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';
    const [name, setName] = useState('');
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

    useEffect(() => {
        if (branding) {
            setName(branding.system_name || 'Standard Gate System');
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

        setIsSaving(true);

        try {
            await invoke('update_system_branding', { 
                adminId: adminSession.account_id,
                name: name.trim(), 
                logoBase64: primaryLogo, 
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

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 w-full max-h-[calc(100vh-120px)] overflow-y-auto">
             <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-slate-800">System Identity & Branding</h2>
                <button 
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-70 transition-all shadow-md shadow-blue-500/10"
                >
                    {isSaving ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                        <Save size={16} />
                    )}
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
             </div>
 
             <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                 {/* Left Column - Main Settings */}
                 <div className="lg:col-span-8 space-y-6">
                     <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                            System / University Name
                        </label>
                        <input 
                            type="text" 
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            placeholder="e.g., Pamantasan ng Lungsod ni Roi"
                        />
                     </div>
 
                     <div className="space-y-4">
                        <label className="block text-sm font-semibold text-slate-700">
                            Institutional Branding Logos
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Primary Logo */}
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center gap-3">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Primary (Right)</p>
                                <div className="relative">
                                    <div className="w-24 h-24 rounded-full overflow-hidden shadow-sm bg-white border border-slate-200 flex items-center justify-center">
                                        {primaryLogo ? (
                                            <img src={primaryLogo} alt="Primary Logo" className="w-full h-full object-cover" />
                                        ) : (
                                            <img src={plpLogo} alt="Default Logo" className="w-12 h-12 object-contain opacity-40 grayscale" />
                                        )}
                                    </div>
                                    {primaryLogo && (
                                        <button onClick={() => removeLogo('primary')} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-1 shadow-md hover:bg-rose-600 transition-all"><X size={12} /></button>
                                    )}
                                </div>
                                <div className="flex flex-col w-full gap-2">
                                    <label htmlFor="primary-upload" className="w-full flex items-center justify-center gap-2 py-2 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-sm font-medium cursor-pointer transition-colors border border-slate-200">
                                        <Upload size={16} /> Upload
                                    </label>
                                    <input type="file" id="primary-upload" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'primary')} />
                                    
                                    <div className="flex items-center justify-between px-1 mt-1">
                                        <span className="text-sm font-medium text-slate-500">Circle Format</span>
                                        <button
                                            type="button"
                                            onClick={() => setPrimaryCircle(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                                primaryCircle ? 'bg-blue-600' : 'bg-slate-300'
                                            }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                                primaryCircle ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between px-1 mt-1">
                                        <span className="text-sm font-medium text-slate-500">Enable Logo</span>
                                        <button
                                            type="button"
                                            onClick={() => setPrimaryEnabled(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                                primaryEnabled ? 'bg-emerald-500' : 'bg-slate-300'
                                            }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                                primaryEnabled ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                        </button>
                                    </div>
                                </div>
                            </div>
 
                            {/* Secondary Logo 1 */}
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center gap-3">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Secondary 1 (Left)</p>
                                <div className="relative">
                                    <div className="w-24 h-24 rounded-full overflow-hidden shadow-sm bg-white border border-slate-200 flex items-center justify-center">
                                        {secondaryLogo1 ? (
                                            <img src={secondaryLogo1} alt="Secondary Logo 1" className="w-full h-full object-cover" />
                                        ) : (
                                            <img src={pasigSeal} alt="Pasig Seal" className="w-12 h-12 object-contain opacity-40 grayscale" />
                                        )}
                                    </div>
                                    {secondaryLogo1 && (
                                        <button onClick={() => removeLogo('secondary1')} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-1 shadow-md hover:bg-rose-600 transition-all"><X size={12} /></button>
                                    )}
                                </div>
                                <div className="flex flex-col w-full gap-2">
                                    <label htmlFor="secondary1-upload" className="w-full flex items-center justify-center gap-2 py-2 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-sm font-medium cursor-pointer transition-colors border border-slate-200">
                                        <Upload size={16} /> Upload
                                    </label>
                                    <input type="file" id="secondary1-upload" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'secondary1')} />
                                    
                                    <div className="flex items-center justify-between px-1 mt-1">
                                        <span className="text-sm font-medium text-slate-500">Circle Format</span>
                                        <button
                                            type="button"
                                            onClick={() => setSecondary1Circle(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                                secondary1Circle ? 'bg-blue-600' : 'bg-slate-300'
                                            }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                                secondary1Circle ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between px-1 mt-1">
                                        <span className="text-sm font-medium text-slate-500">Enable Logo</span>
                                        <button
                                            type="button"
                                            onClick={() => setSecondary1Enabled(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                                secondary1Enabled ? 'bg-emerald-500' : 'bg-slate-300'
                                            }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                                secondary1Enabled ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                        </button>
                                    </div>
                                </div>
                            </div>
 
                            {/* Secondary Logo 2 */}
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center gap-3">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Secondary 2 (Middle)</p>
                                <div className="relative">
                                    <div className="w-24 h-24 rounded-full overflow-hidden shadow-sm bg-white border border-slate-200 flex items-center justify-center">
                                        {secondaryLogo2 ? (
                                            <img src={secondaryLogo2} alt="Secondary Logo 2" className="w-full h-full object-cover" />
                                        ) : (
                                            <img src={pasigUmaagos} alt="Pasig Umaagos" className="w-12 h-12 object-contain opacity-40 grayscale" />
                                        )}
                                    </div>
                                    {secondaryLogo2 && (
                                        <button onClick={() => removeLogo('secondary2')} className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-1 shadow-md hover:bg-rose-600 transition-all"><X size={12} /></button>
                                    )}
                                </div>
                                <div className="flex flex-col w-full gap-2">
                                    <label htmlFor="secondary2-upload" className="w-full flex items-center justify-center gap-2 py-2 bg-white hover:bg-slate-100 text-slate-600 rounded-lg text-sm font-medium cursor-pointer transition-colors border border-slate-200">
                                        <Upload size={16} /> Upload
                                    </label>
                                    <input type="file" id="secondary2-upload" accept="image/*" className="hidden" onChange={(e) => handleFileChange(e, 'secondary2')} />
                                    
                                    <div className="flex items-center justify-between px-1 mt-1">
                                        <span className="text-sm font-medium text-slate-500">Circle Format</span>
                                        <button
                                            type="button"
                                            onClick={() => setSecondary2Circle(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                                secondary2Circle ? 'bg-blue-600' : 'bg-slate-300'
                                            }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                                secondary2Circle ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between px-1 mt-1">
                                        <span className="text-sm font-medium text-slate-500">Enable Logo</span>
                                        <button
                                            type="button"
                                            onClick={() => setSecondary2Enabled(v => !v)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                                secondary2Enabled ? 'bg-emerald-500' : 'bg-slate-300'
                                            }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                                secondary2Enabled ? 'translate-x-5' : 'translate-x-0'
                                            }`} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                     </div>
                 </div>
 
                 {/* Right Column - Help & Info */}
                 <div className="lg:col-span-4 flex flex-col gap-4">
                    <div className="bg-blue-50/50 p-5 rounded-xl border border-blue-100 h-full">
                        <h3 className="text-sm font-bold text-blue-800 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <ImageIcon size={16} /> Header Layout
                        </h3>
                        <div className="text-sm text-slate-600 leading-relaxed space-y-3">
                            <span>The logos in the application header are arranged from left to right as described below:</span>
                            <div className="mt-4 space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="w-5 h-5 flex items-center justify-center bg-blue-600 text-white text-xs rounded-full font-bold">1</span>
                                    <span className="font-semibold text-slate-800 text-sm">Secondary Logo 1</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-5 h-5 flex items-center justify-center bg-blue-600 text-white text-xs rounded-full font-bold">2</span>
                                    <span className="font-semibold text-slate-800 text-sm">Secondary Logo 2</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-5 h-5 flex items-center justify-center bg-blue-600 text-white text-xs rounded-full font-bold">3</span>
                                    <span className="font-semibold text-slate-800 text-sm">Primary Logo</span>
                                </div>
                            </div>
                            <div className="mt-6 pt-4 border-t border-blue-100">
                                <p className="text-xs text-slate-500 italic">
                                    Max file size: 2MB (PNG/JPG). Toggles enable circular clipping for Each logo.
                                </p>
                            </div>
                        </div>
                    </div>
                 </div>
             </div>
        </div>
    );
};
