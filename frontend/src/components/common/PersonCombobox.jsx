import React, { useState, useRef, useEffect, useMemo } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { formatName } from "../../utils/formatters";

/**
 * An autocomplete combobox for selecting a person to visit.
 * It fetches the list of active users (excluding visitors) and
 * allows fuzzy searching across their name parts.
 */
export const PersonCombobox = ({ value, onChange, className = '', required = false, placeholder = '' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [persons, setPersons] = useState([]);
    const containerRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        const fetchPersons = async () => {
            try {
                const fetchedPersons = await invoke('get_persons');
                // Filter out visitors and map to a searchable string
                const validPersons = fetchedPersons
                    .filter(p => !p.id_number.startsWith('VIS-') && p.is_active)
                    .map(p => {
                        const fullName = [
                            p.first_name,
                            p.middle_name,
                            p.last_name,
                            p.suffix
                        ].filter(Boolean).join(' ');
                        return fullName;
                    });

                // Remove duplicates if any
                setPersons([...new Set(validPersons)]);
            } catch (error) {
                console.error("Failed to fetch persons for autocomplete:", error);
            }
        };
        fetchPersons();
    }, []);

    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, 400);

        return () => clearTimeout(handler);
    }, [value]);

    const filteredOptions = useMemo(() => {
        if (!debouncedValue) return [];
        const searchTerms = debouncedValue.toLowerCase().split(' ').filter(Boolean);
        if (searchTerms.length === 0) return [];

        return persons.filter(personName => {
            const lowerName = personName.toLowerCase();
            return searchTerms.every(term => lowerName.includes(term));
        }).slice(0, 10); // Limit to top 10 suggestions for performance
    }, [debouncedValue, persons]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (option) => {
        onChange(option);
        setIsOpen(false);
        inputRef.current?.blur();
    };

    const handleClear = (e) => {
        e.stopPropagation();
        onChange('');
        setIsOpen(false);
        inputRef.current?.focus();
    };

    return (
        <div ref={containerRef} className="relative">
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    required={required}
                    value={value}
                    onChange={e => { onChange(e.target.value); setIsOpen(true); }}
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder}
                    className={className}
                    autoComplete="off"
                />
                {value && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                        tabIndex={-1}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                )}
            </div>
            {isOpen && filteredOptions.length > 0 && (
                <ul className="absolute z-[110] mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-white/20 bg-slate-900/95 backdrop-blur-xl shadow-2xl py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                    {filteredOptions.map(opt => (
                        <li key={opt}>
                            <button
                                type="button"
                                onClick={() => handleSelect(opt)}
                                className="w-full text-left px-4 py-3 text-sm transition-colors text-white/80 hover:bg-white/10 hover:text-white"
                            >
                                {opt}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
