import React, { useEffect, useState } from "react";
import { X, Minus, AlertTriangle, Lock, Eye, EyeOff, ShieldCheck, RotateCcw, Mail, KeyRound, ArrowLeft } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import logoImage from "../../imgs/plp-logo.png";
import pasigSeal from "../../imgs/pasig_seal.png";
import pasigUmaagos from "../../imgs/pasig_umaagos.png";
import { useToast } from "./toast/ToastProvider";

const appWindow = getCurrentWindow();

const initialActivationForm = {
    newPassword: "",
    confirmPassword: "",
    otpCode: ""
};

const HeaderBar = ({ setView, isAdminLoggedIn, setIsAdminLoggedIn, branding, onAdminOverlayChange }) => {
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [showAdminModal, setShowAdminModal] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loginError, setLoginError] = useState("");
    const [pendingActivation, setPendingActivation] = useState(null);
    const [activationForm, setActivationForm] = useState(initialActivationForm);
    const [activationError, setActivationError] = useState("");
    const [activationNotice, setActivationNotice] = useState("");
    const [isActivating, setIsActivating] = useState(false);
    const [isResendingOtp, setIsResendingOtp] = useState(false);
    const [showActivationPassword, setShowActivationPassword] = useState(false);
    const [showActivationConfirmPassword, setShowActivationConfirmPassword] = useState(false);
    const { showSuccess } = useToast();

    // Forgot Password States
    const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
    const [forgotPasswordStep, setForgotPasswordStep] = useState('email'); // 'email', 'otp', 'reset'
    const [forgotEmail, setForgotEmail] = useState('');
    const [forgotUsername, setForgotUsername] = useState('');
    const [forgotOtp, setForgotOtp] = useState('');
    const [forgotAccountId, setForgotAccountId] = useState(null);
    const [forgotMaskedEmail, setForgotMaskedEmail] = useState('');
    const [forgotNewPassword, setForgotNewPassword] = useState('');
    const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
    const [forgotError, setForgotError] = useState('');
    const [forgotNotice, setForgotNotice] = useState('');
    const [isProcessingForgot, setIsProcessingForgot] = useState(false);
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [showForgotConfirmPassword, setShowForgotConfirmPassword] = useState(false);

    useEffect(() => {
        if (typeof onAdminOverlayChange !== "function") {
            return undefined;
        }

        onAdminOverlayChange(showAdminModal || Boolean(pendingActivation) || showForgotPasswordModal);
    }, [showAdminModal, pendingActivation, showForgotPasswordModal, onAdminOverlayChange]);

    useEffect(() => () => {
        if (typeof onAdminOverlayChange === "function") {
            onAdminOverlayChange(false);
        }
    }, [onAdminOverlayChange]);

    const handleMinimize = () => {
        appWindow.minimize();
    };

    const attemptClose = () => {
        setShowCloseModal(true);
    };

    const confirmClose = () => {
        appWindow.close();
    };

    const cancelClose = () => {
        setShowCloseModal(false);
    };

    const resetLoginForm = () => {
        setUsername("");
        setPassword("");
        setShowPassword(false);
        setLoginError("");
    };

    const closeLoginModal = () => {
        setShowAdminModal(false);
        resetLoginForm();
    };

    const resetActivationState = () => {
        setPendingActivation(null);
        setActivationForm(initialActivationForm);
        setActivationError("");
        setActivationNotice("");
        setIsActivating(false);
        setIsResendingOtp(false);
        setShowActivationPassword(false);
        setShowActivationConfirmPassword(false);
    };

    const returnToLogin = () => {
        resetActivationState();
        setShowAdminModal(true);
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoginError("");

        try {
            const response = await invoke('admin_login', { username, password });

            if (!response.success) {
                setLoginError(response.message || "Invalid credentials.");
                return;
            }

            if (response.requires_activation && response.account) {
                setPendingActivation({
                    account: response.account,
                    maskedEmail: response.masked_email || 'your contact email'
                });
                setActivationForm(initialActivationForm);
                setActivationError("");
                setActivationNotice("");
                closeLoginModal();
                return;
            }

            setIsAdminLoggedIn(response.account);
            setView('admin_dashboard');
            closeLoginModal();
        } catch (error) {
            console.error(error);
            setLoginError(typeof error === 'string' ? error : error?.message || "Authentication failed.");
        }
    };

    const handleActivateAccount = async (e) => {
        e.preventDefault();
        setActivationError("");
        setActivationNotice("");

        if (!pendingActivation?.account?.account_id) {
            setActivationError("Activation session not found. Please sign in again.");
            return;
        }

        if (activationForm.newPassword !== activationForm.confirmPassword) {
            setActivationError("New password and confirm password must match.");
            return;
        }

        if (activationForm.otpCode.length !== 6) {
            setActivationError("Enter the 6-digit OTP code.");
            return;
        }

        setIsActivating(true);

        try {
            const response = await invoke('activate_admin_first_login', {
                accountId: pendingActivation.account.account_id,
                otpCode: activationForm.otpCode,
                newPassword: activationForm.newPassword,
                confirmPassword: activationForm.confirmPassword
            });

            if (!response.success || !response.account) {
                setActivationError(response.message || 'Account activation failed.');
                return;
            }

            resetActivationState();
            setIsAdminLoggedIn(response.account);
            showSuccess("Account fully activated. Welcome to Smart Gate!");
            setView('admin_dashboard');
        } catch (error) {
            console.error(error);
            setActivationError(typeof error === 'string' ? error : error?.message || "Account activation failed.");
        } finally {
            setIsActivating(false);
        }
    };

    const handleResendOtp = async () => {
        if (!pendingActivation?.account?.account_id) {
            return;
        }

        setIsResendingOtp(true);
        setActivationError("");

        try {
            const message = await invoke('send_verification_otp', {
                accountId: pendingActivation.account.account_id
            });
            setActivationNotice(message || "A fresh verification code has been sent.");
        } catch (error) {
            console.error(error);
            setActivationError(typeof error === 'string' ? error : error?.message || "Failed to resend the verification code.");
        } finally {
            setIsResendingOtp(false);
        }
    };

    // Forgot Password Handlers
    const resetForgotPasswordState = () => {
        setShowForgotPasswordModal(false);
        setForgotPasswordStep('email');
        setForgotEmail('');
        setForgotUsername('');
        setForgotOtp('');
        setForgotAccountId(null);
        setForgotMaskedEmail('');
        setForgotNewPassword('');
        setForgotConfirmPassword('');
        setForgotError('');
        setForgotNotice('');
        setShowForgotPassword(false);
        setShowForgotConfirmPassword(false);
    };

    const handleForgotPasswordEmailSubmit = async (e) => {
        e.preventDefault();
        setForgotError('');
        setForgotNotice('');

        if (!forgotUsername.trim()) {
            setForgotError('Please enter your username.');
            return;
        }
        if (!forgotEmail.trim()) {
            setForgotError('Please enter your email address.');
            return;
        }

        setIsProcessingForgot(true);

        try {
            const response = await invoke('forgot_password_request', {
                email: forgotEmail.trim(),
                username: forgotUsername.trim()
            });
            if (response.success) {
                setForgotAccountId(response.account_id);
                setForgotMaskedEmail(response.masked_email);
                setForgotNotice(`Verification code sent to ${response.masked_email}`);
                setForgotPasswordStep('otp');
            } else {
                setForgotError(response.message || 'Account not found. Check your username and email.');
            }
        } catch (error) {
            console.error(error);
            setForgotError(typeof error === 'string' ? error : 'Failed to process request.');
        } finally {
            setIsProcessingForgot(false);
        }
    };

    const handleForgotPasswordOtpSubmit = async (e) => {
        e.preventDefault();
        setForgotError('');

        if (forgotOtp.length !== 6) {
            setForgotError('Enter the 6-digit OTP code.');
            return;
        }

        setIsProcessingForgot(true);

        try {
            const response = await invoke('verify_forgot_password_otp', {
                accountId: forgotAccountId,
                otpCode: forgotOtp
            });
            if (response.success) {
                setForgotPasswordStep('reset');
            } else {
                setForgotError(response.message || 'Invalid verification code.');
            }
        } catch (error) {
            console.error(error);
            setForgotError(typeof error === 'string' ? error : 'Verification failed.');
        } finally {
            setIsProcessingForgot(false);
        }
    };

    const handleForgotPasswordResetSubmit = async (e) => {
        e.preventDefault();
        setForgotError('');

        if (forgotNewPassword !== forgotConfirmPassword) {
            setForgotError('Passwords do not match.');
            return;
        }

        if (forgotNewPassword.length < 6) {
            setForgotError('Password must be at least 6 characters.');
            return;
        }

        setIsProcessingForgot(true);

        try {
            const response = await invoke('reset_password_with_otp', {
                accountId: forgotAccountId,
                otpCode: forgotOtp,
                newPassword: forgotNewPassword
            });
            if (response.success) {
                showSuccess('Password reset successfully! Please login with your new password.');
                resetForgotPasswordState();
                setShowAdminModal(true);
            } else {
                setForgotError(response.message || 'Failed to reset password.');
            }
        } catch (error) {
            console.error(error);
            setForgotError(typeof error === 'string' ? error : 'Password reset failed.');
        } finally {
            setIsProcessingForgot(false);
        }
    };

    // Resolve logos: use DB-saved value OR fall back to bundled assets
    const logoSrc = (branding && branding.primary_logo && branding.primary_logo !== "") ? branding.primary_logo : logoImage;
    const secondaryLogo1 = (branding && branding.secondary_logo_1 && branding.secondary_logo_1 !== "") ? branding.secondary_logo_1 : pasigSeal;
    const secondaryLogo2 = (branding && branding.secondary_logo_2 && branding.secondary_logo_2 !== "") ? branding.secondary_logo_2 : pasigUmaagos;
    const systemName = (branding && branding.system_name) ? branding.system_name : "Smart Gate System";
    
    // Individual Circle Formatting
    const primaryCircleClass = branding?.primary_circle ? "rounded-full" : "rounded-none";
    const secondary1CircleClass = branding?.secondary1_circle ? "rounded-full" : "rounded-none";
    const secondary2CircleClass = branding?.secondary2_circle ? "rounded-full" : "rounded-none";

    return (
        <>
            <div className="flex h-16 w-full select-none items-center justify-between border-b border-white/10 bg-black/20 px-6 text-white backdrop-blur-md">
                <div className="pointer-events-none flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className={`h-11 w-11 flex items-center justify-center overflow-hidden flex-shrink-0 ${secondary1CircleClass}`}>
                            <img src={secondaryLogo1} alt="Secondary Logo 1" className={`w-full h-full ${branding?.secondary1_circle ? 'object-cover' : 'object-contain'} drop-shadow-md`} />
                        </div>
                        <div className={`h-11 w-11 flex items-center justify-center overflow-hidden flex-shrink-0 ${secondary2CircleClass}`}>
                            <img src={secondaryLogo2} alt="Secondary Logo 2" className={`w-full h-full ${branding?.secondary2_circle ? 'object-cover' : 'object-contain'} drop-shadow-md`} />
                        </div>
                        <div className={`h-11 w-11 flex items-center justify-center overflow-hidden flex-shrink-0 ${primaryCircleClass}`}>
                            <img src={logoSrc} alt="Primary Logo" className={`w-full h-full ${branding?.primary_circle ? 'object-cover' : 'object-contain'} drop-shadow-md`} />
                        </div>
                    </div>
                    <span className="text-xl font-bold tracking-wide drop-shadow-sm line-clamp-1">{systemName}</span>
                </div>

                <div className="flex items-center space-x-6">
                    {!isAdminLoggedIn ? (
                        <button
                            onClick={() => setShowAdminModal(true)}
                            className="flex items-center gap-1.5 text-sm font-medium text-white/80 transition-colors hover:text-white focus:outline-none"
                        >
                            <Lock className="h-4 w-4" />
                            Administrator Login
                        </button>
                    ) : (
                        <div className="flex items-center gap-6">
                            <div className="text-right">
                                <p className="text-sm font-bold tracking-wide text-white">Welcome, {isAdminLoggedIn.full_name}</p>
                                <p className="text-xs font-medium text-brand-300">{isAdminLoggedIn.role}</p>
                            </div>
                            <button
                                onClick={() => {
                                    setIsAdminLoggedIn(false);
                                    setView('main');
                                }}
                                className="flex items-center gap-1.5 text-sm font-medium text-white/80 transition-colors hover:text-rose-400 focus:outline-none"
                            >
                                <Lock className="h-4 w-4" />
                                Logout
                            </button>
                        </div>
                    )}

                    <div className="h-6 w-px bg-white/20"></div>

                    <div className="flex items-center space-x-2">
                        <button
                            onClick={handleMinimize}
                            className="rounded p-1.5 transition-colors hover:bg-white/10 focus:outline-none"
                        >
                            <Minus className="h-4 w-4 text-white/80 hover:text-white" />
                        </button>
                        <button
                            onClick={attemptClose}
                            className="rounded p-1.5 transition-colors hover:bg-red-500/80 focus:outline-none"
                        >
                            <X className="h-4 w-4 text-white/80 hover:text-white" />
                        </button>
                    </div>
                </div>
            </div>

            {showAdminModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/20 bg-slate-900/80 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center border-b border-white/10 p-6">
                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/20 text-brand-400">
                                <Lock className="h-7 w-7" />
                            </div>
                            <h2 className="text-center text-xl font-bold tracking-wide text-white">Administrator Access</h2>
                            <p className="mt-2 text-center text-sm text-white/60">
                                Enter your secure passcode to proceed.
                            </p>
                        </div>
                        <form onSubmit={handleLogin} className="p-6">
                            <input
                                type="text"
                                placeholder="Enter username..."
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="mb-3 w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-center tracking-wide text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                autoFocus
                            />
                            <div className="relative mb-2">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Enter passcode..."
                                    value={password}
                                    onChange={(e) => {
                                        const nextPassword = e.target.value;
                                        setPassword(nextPassword);
                                        if (!nextPassword) {
                                            setShowPassword(false);
                                        }
                                    }}
                                    data-password-toggle="custom"
                                    className="w-full rounded-lg border border-white/10 bg-black/40 px-11 py-3 text-center tracking-wide text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                />
                                {password && (
                                    <button
                                        type="button"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            setShowPassword(true);
                                        }}
                                        onMouseUp={() => setShowPassword(false)}
                                        onMouseLeave={() => setShowPassword(false)}
                                        onTouchStart={() => setShowPassword(true)}
                                        onTouchEnd={() => setShowPassword(false)}
                                        onTouchCancel={() => setShowPassword(false)}
                                        onKeyDown={(e) => {
                                            if (e.key === " " || e.key === "Enter") {
                                                setShowPassword(true);
                                            }
                                        }}
                                        onKeyUp={(e) => {
                                            if (e.key === " " || e.key === "Enter") {
                                                setShowPassword(false);
                                            }
                                        }}
                                        onBlur={() => setShowPassword(false)}
                                        className="absolute inset-y-0 right-0 flex items-center px-3 text-white/90 hover:text-white focus:outline-none"
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                    >
                                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                )}
                            </div>
                            {loginError && <div className="mb-4 text-center text-sm text-rose-400">{loginError}</div>}
                            <div className="mb-4 text-center">
                                <button
                                    type="button"
                                    onClick={() => { setShowAdminModal(false); setShowForgotPasswordModal(true); }}
                                    className="text-sm text-brand-400 hover:text-brand-300 transition-colors focus:outline-none"
                                >
                                    Forgot Password?
                                </button>
                            </div>
                            <div className="mt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={closeLoginModal}
                                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 font-medium text-white/80 transition-all hover:bg-white/10 hover:text-white focus:outline-none"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white shadow-lg shadow-brand-500/25 transition-all hover:bg-brand-500 focus:outline-none"
                                >
                                    Login
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {pendingActivation && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
                    <div className="bg-black/90 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-2xl overflow-y-auto max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
                        <div className="border-b border-white/10 px-8 py-6 sticky top-0 bg-black/50 backdrop-blur-md z-10">
                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white">
                                <ShieldCheck className="h-7 w-7" />
                            </div>
                            <h2 className="text-2xl font-bold text-white">Account Activation Required</h2>
                            <p className="mt-2 text-sm leading-relaxed text-white/70">
                                For your security, you must set a permanent password. A verification code has been sent to <span className="font-semibold text-white">{pendingActivation.maskedEmail}</span>.
                            </p>
                        </div>

                        <form onSubmit={handleActivateAccount} className="space-y-5 p-8">
                            <div>
                                <label className="mb-2 block text-sm font-semibold text-white/80">New Password <span className="ml-0.5 text-rose-500">*</span></label>
                                <div className="relative">
                                    <input
                                        required
                                        type={showActivationPassword ? "text" : "password"}
                                        value={activationForm.newPassword}
                                        onChange={(e) => setActivationForm({ ...activationForm, newPassword: e.target.value })}
                                        data-password-toggle="custom"
                                        className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 pr-12 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowActivationPassword((current) => !current)}
                                        tabIndex={-1}
                                        className="absolute inset-y-0 right-0 flex items-center px-3 text-white/80 transition-colors hover:text-white focus:outline-none"
                                        aria-label={showActivationPassword ? "Hide password" : "Show password"}
                                    >
                                        {showActivationPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="mb-2 block text-sm font-semibold text-white/80">Confirm New Password <span className="ml-0.5 text-rose-500">*</span></label>
                                <div className="relative">
                                    <input
                                        required
                                        type={showActivationConfirmPassword ? "text" : "password"}
                                        value={activationForm.confirmPassword}
                                        onChange={(e) => setActivationForm({ ...activationForm, confirmPassword: e.target.value })}
                                        data-password-toggle="custom"
                                        className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 pr-12 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowActivationConfirmPassword((current) => !current)}
                                        tabIndex={-1}
                                        className="absolute inset-y-0 right-0 flex items-center px-3 text-white/80 transition-colors hover:text-white focus:outline-none"
                                        aria-label={showActivationConfirmPassword ? "Hide password" : "Show password"}
                                    >
                                        {showActivationConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="mb-2 block text-sm font-semibold text-white/80">OTP Code <span className="ml-0.5 text-rose-500">*</span></label>
                                <input
                                    required
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={activationForm.otpCode}
                                    onChange={(e) => setActivationForm({ ...activationForm, otpCode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                                    placeholder="123456"
                                />
                            </div>

                            {activationError && (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                                    {activationError}
                                </div>
                            )}

                            {activationNotice && (
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                                    {activationNotice}
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={returnToLogin}
                                    className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-medium text-white/80 transition hover:bg-white/10 hover:text-white focus:outline-none"
                                >
                                    Return to Sign In
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResendOtp}
                                    disabled={isResendingOtp}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-3 font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                    {isResendingOtp ? 'Sending...' : 'Resend Code'}
                                </button>
                            </div>

                            <button
                                type="submit"
                                disabled={isActivating}
                                className="flex w-full items-center justify-center rounded-xl bg-indigo-500 px-4 py-3.5 font-bold text-white transition-all hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-70 focus:outline-none focus:ring-4 focus:ring-white/30"
                            >
                                {isActivating ? 'Activating Account...' : 'Secure & Activate Account'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Forgot Password Modal */}
            {showForgotPasswordModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-slate-900/80 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
                        {/* Step 1: Email + Username Verification */}
                        {forgotPasswordStep === 'email' && (
                            <>
                                <div className="flex flex-col items-center border-b border-white/10 p-6">
                                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/20 text-brand-400">
                                        <Mail className="h-7 w-7" />
                                    </div>
                                    <h2 className="text-center text-xl font-bold tracking-wide text-white">Forgot Password?</h2>
                                    <p className="mt-2 text-center text-sm text-white/60">
                                        Enter your username and email address to receive a verification code.
                                    </p>
                                </div>
                                <form onSubmit={handleForgotPasswordEmailSubmit} className="p-6 space-y-4">
                                    <div>
                                        <label className="block text-sm text-white/60 mb-2 font-medium">Username</label>
                                        <input
                                            type="text"
                                            placeholder="Enter your username..."
                                            value={forgotUsername}
                                            onChange={(e) => setForgotUsername(e.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                            autoFocus
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm text-white/60 mb-2 font-medium">Email Address</label>
                                        <input
                                            type="email"
                                            placeholder="Enter your email..."
                                            value={forgotEmail}
                                            onChange={(e) => setForgotEmail(e.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                            required
                                        />
                                    </div>
                                    {forgotError && <div className="text-center text-sm text-rose-400">{forgotError}</div>}
                                    {forgotNotice && <div className="text-center text-sm text-emerald-400">{forgotNotice}</div>}
                                    <div className="flex gap-3 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => { resetForgotPasswordState(); setShowAdminModal(true); }}
                                            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 font-medium text-white/80 transition-all hover:bg-white/10 hover:text-white focus:outline-none"
                                        >
                                            Back to Login
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={isProcessingForgot}
                                            className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white shadow-lg shadow-brand-500/25 transition-all hover:bg-brand-500 focus:outline-none disabled:opacity-70"
                                        >
                                            {isProcessingForgot ? 'Sending...' : 'Send Code'}
                                        </button>
                                    </div>
                                </form>
                            </>
                        )}

                        {/* Step 2: OTP Entry */}
                        {forgotPasswordStep === 'otp' && (
                            <>
                                <div className="flex flex-col items-center border-b border-white/10 p-6">
                                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/20 text-brand-400">
                                        <KeyRound className="h-7 w-7" />
                                    </div>
                                    <h2 className="text-center text-xl font-bold tracking-wide text-white">Enter Verification Code</h2>
                                    <p className="mt-2 text-center text-sm text-white/60">
                                        Enter the 6-digit code sent to <span className="font-semibold text-white">{forgotMaskedEmail}</span>
                                    </p>
                                </div>
                                <form onSubmit={handleForgotPasswordOtpSubmit} className="p-6 space-y-4">
                                    <div>
                                        <label className="block text-sm text-white/60 mb-2 font-medium">6-Digit Code</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={6}
                                            placeholder="123456"
                                            value={forgotOtp}
                                            onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                            autoFocus
                                            required
                                        />
                                    </div>
                                    {forgotError && <div className="text-center text-sm text-rose-400">{forgotError}</div>}
                                    <div className="flex gap-3 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setForgotPasswordStep('email')}
                                            className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 font-medium text-white/80 transition-all hover:bg-white/10 hover:text-white focus:outline-none"
                                        >
                                            <ArrowLeft className="h-4 w-4" /> Back
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={isProcessingForgot}
                                            className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white shadow-lg shadow-brand-500/25 transition-all hover:bg-brand-500 focus:outline-none disabled:opacity-70"
                                        >
                                            {isProcessingForgot ? 'Verifying...' : 'Verify Code'}
                                        </button>
                                    </div>
                                </form>
                            </>
                        )}

                        {/* Step 3: Password Reset */}
                        {forgotPasswordStep === 'reset' && (
                            <>
                                <div className="flex flex-col items-center border-b border-white/10 p-6">
                                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/20 text-emerald-400">
                                        <Lock className="h-7 w-7" />
                                    </div>
                                    <h2 className="text-center text-xl font-bold tracking-wide text-white">Reset Password</h2>
                                    <p className="mt-2 text-center text-sm text-white/60">
                                        Create a new password for your account.
                                    </p>
                                </div>
                                <form onSubmit={handleForgotPasswordResetSubmit} className="p-6 space-y-4">
                                    <div>
                                        <label className="block text-sm text-white/60 mb-2 font-medium">New Password</label>
                                        <div className="relative">
                                            <input
                                                type={showForgotPassword ? "text" : "password"}
                                                placeholder="Enter new password..."
                                                value={forgotNewPassword}
                                                onChange={(e) => setForgotNewPassword(e.target.value)}
                                                data-password-toggle="custom"
                                                className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 pr-12 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                                required
                                                minLength={6}
                                                autoFocus
                                            />
                                            <button
                                                type="button"
                                                onMouseDown={(e) => { e.preventDefault(); setShowForgotPassword(true); }}
                                                onMouseUp={() => setShowForgotPassword(false)}
                                                onMouseLeave={() => setShowForgotPassword(false)}
                                                onTouchStart={() => setShowForgotPassword(true)}
                                                onTouchEnd={() => setShowForgotPassword(false)}
                                                onTouchCancel={() => setShowForgotPassword(false)}
                                                onBlur={() => setShowForgotPassword(false)}
                                                tabIndex={-1}
                                                className="absolute inset-y-0 right-0 flex items-center px-3 text-white/60 hover:text-white focus:outline-none"
                                                aria-label={showForgotPassword ? "Hide password" : "Show password"}
                                            >
                                                {showForgotPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm text-white/60 mb-2 font-medium">Confirm Password</label>
                                        <div className="relative">
                                            <input
                                                type={showForgotConfirmPassword ? "text" : "password"}
                                                placeholder="Confirm new password..."
                                                value={forgotConfirmPassword}
                                                onChange={(e) => setForgotConfirmPassword(e.target.value)}
                                                data-password-toggle="custom"
                                                className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 pr-12 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                                required
                                                minLength={6}
                                            />
                                            <button
                                                type="button"
                                                onMouseDown={(e) => { e.preventDefault(); setShowForgotConfirmPassword(true); }}
                                                onMouseUp={() => setShowForgotConfirmPassword(false)}
                                                onMouseLeave={() => setShowForgotConfirmPassword(false)}
                                                onTouchStart={() => setShowForgotConfirmPassword(true)}
                                                onTouchEnd={() => setShowForgotConfirmPassword(false)}
                                                onTouchCancel={() => setShowForgotConfirmPassword(false)}
                                                onBlur={() => setShowForgotConfirmPassword(false)}
                                                tabIndex={-1}
                                                className="absolute inset-y-0 right-0 flex items-center px-3 text-white/60 hover:text-white focus:outline-none"
                                                aria-label={showForgotConfirmPassword ? "Hide password" : "Show password"}
                                            >
                                                {showForgotConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                            </button>
                                        </div>
                                    </div>
                                    {forgotError && <div className="text-center text-sm text-rose-400">{forgotError}</div>}
                                    <div className="flex gap-3 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setForgotPasswordStep('otp')}
                                            className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 font-medium text-white/80 transition-all hover:bg-white/10 hover:text-white focus:outline-none"
                                        >
                                            <ArrowLeft className="h-4 w-4" /> Back
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={isProcessingForgot}
                                            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white shadow-lg shadow-emerald-500/25 transition-all hover:bg-emerald-500 focus:outline-none disabled:opacity-70"
                                        >
                                            {isProcessingForgot ? 'Resetting...' : 'Reset Password'}
                                        </button>
                                    </div>
                                </form>
                            </>
                        )}
                    </div>
                </div>
            )}

            {showCloseModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/20 bg-slate-900/80 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center border-b border-white/10 p-6">
                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/30 bg-red-500/20 text-red-500">
                                <AlertTriangle className="h-7 w-7" />
                            </div>
                            <h2 className="text-center text-xl font-bold tracking-wide text-white">Exit System?</h2>
                            <p className="mt-2 text-center text-sm leading-relaxed text-white/60">
                                Are you sure you want to close the application? This will disconnect active scanners.
                            </p>
                        </div>
                        <div className="flex gap-3 bg-white/5 p-4">
                            <button
                                onClick={cancelClose}
                                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 font-medium text-white/80 transition-all hover:bg-white/10 hover:text-white focus:outline-none"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmClose}
                                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white shadow-lg shadow-red-500/25 transition-all hover:bg-red-500 focus:outline-none"
                            >
                                Confirm Exit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default HeaderBar;
