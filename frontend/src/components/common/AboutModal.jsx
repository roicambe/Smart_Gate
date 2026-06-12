import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AdminModal } from "./AdminModal";
import {
    Users, Github, Mail, Link, Instagram, Facebook,
    ChevronDown, ChevronUp, Copy, Check, Code2,
} from "lucide-react";

const TEAM_MEMBERS = [
    { name: "Roi Yvann M. Cambe",       isContact: true },
    { name: "Francis Carl S. Esguerra" },
    { name: "Gen-Rey B. Jarina"        },
    { name: "Ivee P. Guevarra"         },
    { name: "Jace H. Bellen"           },
    { name: "Jericho Riga"             },
];

const CONTACT_LINKS = [
    {
        label: "GitHub",
        href: "https://github.com/roicambe",
        copyText: "https://github.com/roicambe",
        icon: <Github className="w-4 h-4" />,
        display: "github.com/roicambe",
    },
    {
        label: "Email",
        href: "mailto:roicambe02@gmail.com",
        copyText: "roicambe02@gmail.com",
        icon: <Mail className="w-4 h-4" />,
        display: "roicambe02@gmail.com",
    },
    {
        label: "Linktree",
        href: "https://linktr.ee/pu_roi",
        copyText: "https://linktr.ee/pu_roi",
        icon: <Link className="w-4 h-4" />,
        display: "linktr.ee/pu_roi",
    },
    {
        label: "Instagram",
        href: "https://www.instagram.com/pu_roi/",
        copyText: "https://www.instagram.com/pu_roi/",
        icon: <Instagram className="w-4 h-4" />,
        display: "@pu_roi",
    },
    {
        label: "Facebook",
        href: "https://www.facebook.com/roiyvann.cambe",
        copyText: "https://www.facebook.com/roiyvann.cambe",
        icon: <Facebook className="w-4 h-4" />,
        display: "roiyvann.cambe",
    },
];

const SOURCE_LINK = {
    label: "Source Code",
    href: "https://github.com/roicambe/Smart_Gate",
    copyText: "https://github.com/roicambe/Smart_Gate",
    display: "github.com/roicambe/Smart_Gate",
};

async function openLink(href) {
    try {
        await invoke("open_external_url", { url: href });
    } catch (err) {
        console.error("Failed to open link:", href, err);
    }
}

export const AboutModal = ({ isOpen, onClose }) => {
    const [contactOpen, setContactOpen] = useState(false);
    const [copiedKey, setCopiedKey]     = useState(null);

    const handleClose = () => {
        setContactOpen(false);
        onClose?.();
    };

    const handleCopy = async (e, link) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(link.copyText);
            setCopiedKey(link.label);
            setTimeout(() => setCopiedKey(null), 1800);
        } catch (err) {
            console.error("Clipboard write failed:", err);
        }
    };

    return (
        <AdminModal
            isOpen={isOpen}
            onClose={handleClose}
            title="About the Team"
            subtitle="The people who built Smart Gate"
            icon={<Users className="w-5 h-5 text-white/80" />}
            tone="default"
            size="md"
            closeOnBackdrop
            backdropClassName="bg-black/80 backdrop-blur-md"
            panelClassName="about-modal-enter"
        >
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap');
                .about-mono { font-family: 'Space Mono', 'Courier New', monospace; }

                /* Modal entrance: starts large, springs down to size */
                @keyframes modalPopIn {
                    0%   { opacity: 0;   transform: scale(1.12); }
                    50%  { opacity: 1;   transform: scale(0.97); }
                    75%  { transform: scale(1.02); }
                    100% { opacity: 1;   transform: scale(1);    }
                }
                .about-modal-enter {
                    animation: modalPopIn 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
                }

                /* Dropdown container: animated via max-height + opacity */
                .contact-dropdown {
                    display: grid;
                    grid-template-rows: 0fr;
                    opacity: 0;
                    transition:
                        grid-template-rows 320ms cubic-bezier(0.4, 0, 0.2, 1),
                        opacity 250ms ease;
                }
                .contact-dropdown.open {
                    grid-template-rows: 1fr;
                    opacity: 1;
                }
                .contact-dropdown-inner {
                    overflow: hidden;
                }

                /* Each row slides + fades in with a stagger */
                @keyframes rowIn {
                    from { opacity: 0; transform: translateY(-6px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                .contact-dropdown.open .contact-row {
                    animation: rowIn 220ms ease both;
                }
                .contact-dropdown.open .contact-row:nth-child(1) { animation-delay:  40ms; }
                .contact-dropdown.open .contact-row:nth-child(2) { animation-delay:  90ms; }
                .contact-dropdown.open .contact-row:nth-child(3) { animation-delay: 140ms; }
                .contact-dropdown.open .contact-row:nth-child(4) { animation-delay: 190ms; }
                .contact-dropdown.open .contact-row:nth-child(5) { animation-delay: 240ms; }

                /* Chevron spin */
                .chevron-icon {
                    transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
                }
                .chevron-icon.rotated {
                    transform: rotate(180deg);
                }
            `}</style>

            <div className="about-mono space-y-2 py-1">
                {TEAM_MEMBERS.map((member) =>
                    member.isContact ? (
                        <div key={member.name}>
                            {/* ── Roi's row ── */}
                            <button
                                type="button"
                                onClick={() => setContactOpen((o) => !o)}
                                className="w-full text-left group flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 hover:border-emerald-400/60 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-500/25 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold uppercase tracking-widest shrink-0">
                                        Dev
                                    </span>
                                    <span className="text-emerald-200 font-bold text-sm tracking-wide truncate group-hover:text-emerald-100 transition-colors underline underline-offset-4 decoration-emerald-500/50 group-hover:decoration-emerald-400">
                                        {member.name}
                                    </span>
                                </div>
                                {/* Single chevron that rotates */}
                                <ChevronDown
                                    className={`chevron-icon w-4 h-4 text-emerald-400 shrink-0 ${contactOpen ? "rotated" : ""}`}
                                />
                            </button>

                            {/* ── Animated contact dropdown ── */}
                            <div className={`contact-dropdown ${contactOpen ? "open" : ""}`}>
                                <div className="contact-dropdown-inner">
                                    <div className="mt-1.5 ml-2 pl-4 border-l border-emerald-500/30 space-y-0.5 pb-1">
                                        {CONTACT_LINKS.map((link) => (
                                            <div key={link.label} className="contact-row flex items-center gap-1">
                                                {/* Open-in-browser */}
                                                <button
                                                    type="button"
                                                    onClick={() => openLink(link.href)}
                                                    className="flex-1 flex items-center gap-3 px-3 py-2 rounded-xl text-white/60 hover:text-white hover:bg-white/8 transition-all duration-150 group/link text-sm min-w-0"
                                                >
                                                    <span className="text-emerald-400/70 group-hover/link:text-emerald-300 transition-colors shrink-0">
                                                        {link.icon}
                                                    </span>
                                                    <span className="text-white/40 text-xs w-16 shrink-0 text-left">
                                                        {link.label}
                                                    </span>
                                                    <span className="text-white/70 group-hover/link:text-white transition-colors truncate text-xs text-left">
                                                        {link.display}
                                                    </span>
                                                </button>

                                                {/* Copy */}
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleCopy(e, link)}
                                                    title={`Copy ${link.label}`}
                                                    className="shrink-0 p-2 rounded-lg text-white/30 hover:text-emerald-300 hover:bg-emerald-500/10 transition-all duration-150 focus:outline-none"
                                                >
                                                    {copiedKey === link.label
                                                        ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                        : <Copy  className="w-3.5 h-3.5" />
                                                    }
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div
                            key={member.name}
                            className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/8 bg-white/4 hover:bg-white/7 transition-colors duration-150"
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-white/30 shrink-0" />
                            <span className="text-white/75 text-sm tracking-wide">{member.name}</span>
                        </div>
                    )
                )}
            </div>

            {/* ── Source Code — separated section ── */}
            <div className="mt-4">
                <div className="flex items-center gap-3 mb-2">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="about-mono text-[10px] text-white/30 uppercase tracking-widest">Source Code</span>
                    <div className="h-px flex-1 bg-white/10" />
                </div>

                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => openLink(SOURCE_LINK.href)}
                        className="flex-1 flex items-center gap-3 px-4 py-3 rounded-2xl border border-blue-500/30 bg-blue-500/8 hover:bg-blue-500/15 hover:border-blue-400/50 transition-all duration-150 group/src min-w-0"
                    >
                        <span className="text-blue-400/70 group-hover/src:text-blue-300 transition-colors shrink-0">
                            <Code2 className="w-4 h-4" />
                        </span>
                        <span className="about-mono text-white/60 group-hover/src:text-white transition-colors truncate text-xs text-left">
                            {SOURCE_LINK.display}
                        </span>
                        <Github className="w-3.5 h-3.5 text-white/25 group-hover/src:text-blue-300 transition-colors shrink-0 ml-auto" />
                    </button>

                    <button
                        type="button"
                        onClick={async (e) => {
                            e.stopPropagation();
                            try {
                                await navigator.clipboard.writeText(SOURCE_LINK.copyText);
                                setCopiedKey("__source");
                                setTimeout(() => setCopiedKey(null), 1800);
                            } catch {}
                        }}
                        title="Copy source URL"
                        className="shrink-0 p-2 rounded-lg text-white/30 hover:text-blue-300 hover:bg-blue-500/10 transition-all duration-150 focus:outline-none"
                    >
                        {copiedKey === "__source"
                            ? <Check className="w-3.5 h-3.5 text-blue-400" />
                            : <Copy  className="w-3.5 h-3.5" />
                        }
                    </button>
                </div>
            </div>

            <p className="about-mono mt-4 text-center text-[11px] text-white/30 tracking-widest uppercase">
                Smart Gate &mdash; {new Date().getFullYear()}
            </p>
        </AdminModal>
    );
};
