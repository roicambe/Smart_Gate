import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from "lucide-react";

const ToastContext = createContext(null);

let nextToastId = 1;
const DEFAULT_DURATION_MS = 4000;

const getToastAccent = (type) => {
    if (type === "success") {
        return {
            border: "border-l-emerald-500",
            icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        };
    }

    if (type === "warning") {
        return {
            border: "border-l-amber-500",
            icon: <AlertTriangle className="h-5 w-5 text-amber-500" />
        };
    }

    if (type === "processing") {
        return {
            border: "border-l-blue-500",
            icon: <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        };
    }

    return {
        border: "border-l-red-500",
        icon: <XCircle className="h-5 w-5 text-red-500" />
    };
};

const ToastItem = ({ toast, onDismiss }) => {
    React.useEffect(() => {
        const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration ?? DEFAULT_DURATION_MS);
        return () => window.clearTimeout(timer);
    }, [toast.id, toast.duration, onDismiss]);

    const accent = getToastAccent(toast.type);

    return (
        <div
            className={`animate-in slide-in-from-top-4 fade-in duration-300 min-w-[340px] max-w-md border border-slate-200 ${accent.border} border-l-4 rounded-2xl bg-white p-4 shadow-[0_20px_50px_rgba(0,0,0,0.1)] flex items-center gap-4`}
        >
            <div className="shrink-0">{accent.icon}</div>
            <p className="flex-1 text-sm font-medium text-slate-800 antialiased">{toast.message}</p>
            <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Dismiss notification"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
};

export const ToastProvider = ({ children, maxToasts = 4 }) => {
    const [toasts, setToasts] = useState([]);

    const dismissToast = useCallback((id) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    const showToast = useCallback(({ type = "success", message, duration = DEFAULT_DURATION_MS }) => {
        if (!message) return null;

        const id = nextToastId++;
        const toast = { id, type, message, duration };

        setToasts((current) => [...current, toast].slice(-maxToasts));
        return id;
    }, [maxToasts]);

    const api = useMemo(() => ({
        showToast,
        showSuccess: (message, duration) => showToast({ type: "success", message, duration }),
        showError: (message, duration) => showToast({ type: "error", message, duration }),
        showWarning: (message, duration) => showToast({ type: "warning", message, duration }),
        showProcessing: (message, duration) => showToast({ type: "processing", message, duration }),
        dismissToast
    }), [showToast, dismissToast]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div className="pointer-events-none fixed left-1/2 top-6 z-[9999] flex -translate-x-1/2 flex-col gap-3">
                {toasts.map((toast) => (
                    <div key={toast.id} className="pointer-events-auto">
                        <ToastItem toast={toast} onDismiss={dismissToast} />
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used inside ToastProvider.");
    }
    return context;
};
