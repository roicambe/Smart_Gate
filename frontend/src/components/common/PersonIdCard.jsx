import React from "react";
import { X } from "lucide-react";
import { getFullNameLabel, formatRoleLabel, getProgramYearLabel } from "../../utils/formatters";

/**
 * PersonIdCard component to display a person's information in a premium modal.
 */
export const PersonIdCard = ({ person, onDismiss }) => {
    if (!person) return null;

    return (
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-4 animate-in fade-in duration-300">
            <div className="pointer-events-auto relative w-full max-w-2xl rounded-3xl border border-white/20 bg-black/80 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
                <button
                    type="button"
                    onClick={onDismiss}
                    className="absolute right-4 top-4 rounded-lg p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Close ID card"
                >
                    <X className="h-5 w-5" />
                </button>
                
                <div className="mb-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/85">
                        ID Card
                    </p>
                    <h3 className="mt-2 text-4xl font-extrabold text-white">
                        {getFullNameLabel(person)}
                    </h3>
                </div>

                <div className="grid grid-cols-1 gap-4 text-base text-slate-100 sm:grid-cols-2">
                    <div>
                        <p className="text-xs uppercase tracking-widest text-slate-300/80">ID Number</p>
                        <p className="mt-1 text-xl font-semibold">{person.id_number}</p>
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-widest text-slate-300/80">Role</p>
                        <p className="mt-1 text-xl font-semibold">{formatRoleLabel(person.role)}</p>
                    </div>

                    {/* Student Behavior Fields */}
                    {person.role_behavior === 'student' && (
                        <>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">Department</p>
                                <p className="mt-1 font-semibold">{person.department_name || "---"}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">Program</p>
                                <p className="mt-1 font-semibold text-cyan-200">{person.program_name || "---"}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">Year Level</p>
                                <p className="mt-1 font-semibold">{person.year_level ? `Year ${person.year_level}` : "---"}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">Classification</p>
                                <p className="mt-1 font-semibold text-cyan-200">
                                    {person.is_irregular ? "Irregular" : "Regular"}
                                </p>
                            </div>
                        </>
                    )}

                    {/* Employee Behavior Fields */}
                    {person.role_behavior === 'employee' && (
                        <>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">Position or Title</p>
                                <p className="mt-1 font-semibold text-cyan-200">{person.position_title || "---"}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">Department</p>
                                <p className="mt-1 font-semibold">{person.department_name || "---"}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-300/80">Employment Status</p>
                                <p className="mt-1 font-semibold text-cyan-200">
                                    {person.is_part_time ? "Part-Time" : "Full-Time"}
                                </p>
                            </div>
                        </>
                    )}

                    {/* Visitor Behavior (No additional fields besides ID, Role, Name) */}
                </div>
            </div>
        </div>
    );
};
