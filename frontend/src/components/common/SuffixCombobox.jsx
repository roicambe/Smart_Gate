import React, { useState, useRef, useEffect } from 'react';

const SUFFIX_OPTIONS = ['Jr.', 'Sr.', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * A hybrid suffix input that acts as both a text field and a dropdown.
 * Clicking the field reveals a list of common suffixes, while still
 * allowing free-text entry for custom values.
 */
export const SuffixCombobox = ({ value, onChange, className = '' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);
    const inputRef = useRef(null);

    // Filter options based on current typed value
    const filteredOptions = value
        ? SUFFIX_OPTIONS.filter(opt => opt.toLowerCase().startsWith(value.toLowerCase()))
        : SUFFIX_OPTIONS;

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
    };

    return (
        <div ref={containerRef} className="relative">
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={e => { onChange(e.target.value); setIsOpen(true); }}
                    onFocus={() => setIsOpen(true)}
                    placeholder="None"
                    maxLength={10}
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
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                )}
            </div>
            {isOpen && filteredOptions.length > 0 && (
                <ul className="absolute z-50 mt-1 w-full max-h-44 overflow-y-auto rounded-xl border border-white/20 bg-slate-900/95 backdrop-blur-xl shadow-2xl py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                    {filteredOptions.map(opt => (
                        <li key={opt}>
                            <button
                                type="button"
                                onClick={() => handleSelect(opt)}
                                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                                    value === opt
                                        ? 'bg-blue-600/30 text-blue-300 font-semibold'
                                        : 'text-white/80 hover:bg-white/10 hover:text-white'
                                }`}
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
