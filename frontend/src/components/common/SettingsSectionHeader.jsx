import React from 'react';

export const SettingsSectionHeader = ({
    icon: Icon,
    title,
    description,
    action = null,
    iconWrapperClassName = 'border-slate-200 bg-slate-50 text-slate-600',
}) => (
    <div className="mb-8 flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl border shadow-sm ${iconWrapperClassName}`}>
                <Icon className="h-6 w-6" />
            </div>
            <div>
                <h2 className="text-2xl font-bold tracking-wide text-slate-900">{title}</h2>
                {description && (
                    <p className="text-sm text-slate-500">{description}</p>
                )}
            </div>
        </div>

        {action}
    </div>
);
