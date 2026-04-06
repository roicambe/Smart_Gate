import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Upload, X, Save, Image as ImageIcon } from 'lucide-react';
import plpLogo from '../../../imgs/plp-logo.png';

export const SystemBrandingPanel = ({ branding, fetchBranding, adminSession, showToast }) => {
    const isSystemAdministrator = adminSession?.role === 'System Administrator';
    const [name, setName] = useState('');
    const [logoPreview, setLogoPreview] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (branding) {
            setName(branding.system_name || 'Pamantasan ng Lungsod ni Roi');
            setLogoPreview(branding.system_logo || '');
        }
    }, [branding]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Ensure it's an image
        if (!file.type.startsWith('image/')) {
            setError('Please upload a valid image file (PNG, JPG).');
            return;
        }

        // Check size (Optional cap at 2MB to keep DB clean)
        if (file.size > 2 * 1024 * 1024) {
             setError('File is too large. Please upload an image smaller than 2MB.');
             return;
        }

        setError('');
        const reader = new FileReader();
        reader.onloadend = () => {
            setLogoPreview(reader.result);
        };
        reader.readAsDataURL(file);
    };

    const removeCustomLogo = () => {
        setLogoPreview('');
    };

    const handleSave = async () => {
        if (!name.trim()) {
            setError('System Name cannot be empty.');
            return;
        }

        setIsSaving(true);
        setError('');

        try {
            await invoke('update_system_branding', { 
                adminId: adminSession.account_id,
                name: name.trim(), 
                logoBase64: logoPreview 
            });
            await fetchBranding();
            showToast('System Branding updated successfully.');
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Operation failed.');
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 w-full">
             <h2 className="text-2xl font-bold text-slate-800 mb-6">System Identity & Branding</h2>
             
             {error && (
                <div className="mb-6 p-4 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl">
                    {error}
                </div>
             )}

             <div className="space-y-8 flex flex-col">
                 <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        System / University Name
                    </label>
                    <input 
                        type="text" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        placeholder="e.g., Pamantasan ng Lungsod ni Roi"
                    />
                    <p className="text-sm text-slate-500 mt-2">
                        This name is displayed prominently in the application header and footers.
                    </p>
                 </div>

                 <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        System Logo
                    </label>
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 mt-2">
                        <div className="relative group shrink-0">
                            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-slate-100 shadow-sm bg-slate-50 flex items-center justify-center">
                                {logoPreview ? (
                                    <img src={logoPreview} alt="System Logo Outline" className="w-full h-full object-cover" />
                                ) : (
                                    <img src={plpLogo} alt="Default Logo" className="w-20 h-20 object-contain opacity-50" />
                                )}
                            </div>
                            {logoPreview && (
                                <button 
                                    onClick={removeCustomLogo}
                                    title="Remove Custom Logo"
                                    className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-1 shadow-md hover:bg-rose-600 transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            )}
                        </div>

                        <div className="flex flex-col justify-center gap-3">
                            <div>
                                <input 
                                    type="file" 
                                    id="logo-upload" 
                                    accept="image/png, image/jpeg, image/jpg" 
                                    className="hidden" 
                                    onChange={handleFileChange}
                                />
                                <label 
                                    htmlFor="logo-upload" 
                                    className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium cursor-pointer transition-colors"
                                >
                                    <Upload size={18} />
                                    Upload New Logo
                                </label>
                            </div>
                            <p className="text-sm text-slate-500 max-w-xs">
                                Upload a square or circular transparent image (.PNG or .JPG). It will be automatically formatted into a circular frame layout. Max 2MB.
                            </p>
                        </div>
                    </div>
                 </div>

                 <div className="pt-4 border-t border-slate-100 flex justify-end">
                    <button 
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-md shadow-blue-500/20 disabled:opacity-70 disabled:cursor-not-allowed transition-all"
                    >
                        {isSaving ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <Save size={18} />
                        )}
                        {isSaving ? 'Saving...' : 'Save Branding'}
                    </button>
                 </div>
             </div>
        </div>
    );
};
