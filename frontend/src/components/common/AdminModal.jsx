import React from 'react';
import { X } from 'lucide-react';

const toneStyles = {
    default: {
        panel: 'bg-slate-950/85 border-white/20',
        iconWrap: 'bg-white/10 border-white/20',
        title: 'text-white',
        subtitle: 'text-white/65',
        closeButton: 'border-white/15 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white focus:ring-white/30',
    },
    danger: {
        panel: 'bg-rose-950/65 border-rose-300/30',
        iconWrap: 'bg-rose-500/15 border-rose-300/35',
        title: 'text-rose-50',
        subtitle: 'text-rose-100/75',
        closeButton: 'border-rose-200/30 bg-rose-500/10 text-rose-100/80 hover:bg-rose-500/20 hover:text-rose-50 focus:ring-rose-200/30',
    },
    light: {
        panel: 'bg-white/95 border-slate-200/90',
        iconWrap: 'bg-slate-100 border-slate-200',
        title: 'text-slate-900',
        subtitle: 'text-slate-500',
        closeButton: 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus:ring-slate-300/60',
    },
};

export const AdminModal = ({
    isOpen,
    onClose,
    title,
    subtitle,
    icon,
    tone = 'default',
    size = 'md',
    children,
    footer,
    bodyClassName = '',
    closeOnBackdrop = true,
}) => {
    if (!isOpen) return null;

    const palette = toneStyles[tone] || toneStyles.default;
    const sizeClass = size === 'xl'
        ? 'max-w-5xl'
        : size === 'lg'
            ? 'max-w-3xl'
            : 'max-w-md';

    const handleBackdropClick = () => {
        if (closeOnBackdrop) onClose?.();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <button
                type="button"
                onClick={handleBackdropClick}
                className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-300"
                aria-label="Close modal backdrop"
            />
            <div
                className={`relative max-h-[92vh] w-full ${sizeClass} overflow-hidden rounded-3xl border shadow-2xl backdrop-blur-3xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 ${palette.panel}`}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-start justify-between gap-3 rounded-t-3xl border-b border-white/10 bg-black/15 px-6 py-5 backdrop-blur-md md:px-8">
                    <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-3">
                            {icon && (
                                <div className={`rounded-xl border p-2 ${palette.iconWrap}`}>
                                    {icon}
                                </div>
                            )}
                            <h2 className={`text-xl font-semibold tracking-tight ${palette.title}`}>{title}</h2>
                        </div>
                        {subtitle && <p className={`text-sm leading-relaxed ${palette.subtitle}`}>{subtitle}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className={`rounded-xl border p-2 transition-all focus:outline-none focus:ring-2 ${palette.closeButton}`}
                        aria-label="Close modal"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className={`px-6 py-5 md:px-8 ${bodyClassName}`}>
                    {children}
                </div>

                {footer && (
                    <div className="border-t border-white/10 bg-black/10 px-6 py-4 backdrop-blur-sm md:px-8">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};
