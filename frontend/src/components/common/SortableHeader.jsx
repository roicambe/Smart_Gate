import React from 'react';
import { ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react';

/**
 * A clickable table header cell that toggles sorting state.
 *
 * Props:
 *  - label:       Display text for the column
 *  - sortKey:     The key used to identify this column for sorting
 *  - sortConfig:  { key, direction } – current active sort state
 *  - onSort:      (sortKey) => void – callback to update sort state
 *  - className:   Additional CSS classes for the <th>
 *  - align:       'left' | 'center' | 'right' (default: 'left')
 */
export const SortableHeader = ({ label, sortKey, sortConfig, onSort, className = '', align = 'left' }) => {
    const isActive = sortConfig?.key === sortKey;
    const alignClass = align === 'right' ? 'text-right justify-end' : align === 'center' ? 'text-center justify-center' : 'text-left';

    return (
        <th
            className={`px-3 py-2 font-semibold tracking-wider select-none cursor-pointer group transition-colors hover:bg-slate-200/60 ${alignClass} ${className}`}
            onClick={() => onSort(sortKey)}
        >
            <span className="inline-flex items-center gap-1">
                {label}
                <span className={`inline-flex transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
                    {isActive ? (
                        sortConfig.direction === 'asc'
                            ? <ChevronUp className="w-3.5 h-3.5" />
                            : <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                        <ArrowUpDown className="w-3 h-3" />
                    )}
                </span>
            </span>
        </th>
    );
};

/**
 * Hook that manages sort state and provides a sort comparator.
 *
 * Returns: { sortConfig, requestSort, sortedData }
 *
 * `requestSort(key)` cycles asc → desc → clear for the given key.
 * A third click on the same column resets to the default (unsorted) order.
 * `sortedData` is a memoized, sorted copy of `data`.
 *
 * When `storageKey` is provided, the sort preference is persisted to
 * localStorage so it survives navigation and page refreshes.
 */
export const useTableSort = (data, defaultKey = null, defaultDirection = 'asc', storageKey = null) => {
    const [sortConfig, setSortConfig] = React.useState(() => {
        // Try restoring from localStorage first
        if (storageKey) {
            try {
                const saved = localStorage.getItem(`sort_${storageKey}`);
                if (saved) return JSON.parse(saved);
            } catch { /* ignore */ }
        }
        return defaultKey ? { key: defaultKey, direction: defaultDirection } : null;
    });

    // Persist to localStorage whenever sortConfig changes
    React.useEffect(() => {
        if (!storageKey) return;
        try {
            if (sortConfig) {
                localStorage.setItem(`sort_${storageKey}`, JSON.stringify(sortConfig));
            } else {
                localStorage.removeItem(`sort_${storageKey}`);
            }
        } catch { /* ignore */ }
    }, [sortConfig, storageKey]);

    const requestSort = React.useCallback((key) => {
        setSortConfig(prev => {
            if (prev?.key === key) {
                // asc → desc → clear
                if (prev.direction === 'asc') return { key, direction: 'desc' };
                return null; // clear sort on third click
            }
            return { key, direction: 'asc' };
        });
    }, []);

    const sortedData = React.useMemo(() => {
        if (!sortConfig || !data) return data || [];
        const { key, direction } = sortConfig;

        return [...data].sort((a, b) => {
            let aVal = a[key];
            let bVal = b[key];

            // Handle null / undefined
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            // Date-like strings (ISO / timestamp)
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                // Check if both look like dates
                const aDate = Date.parse(aVal);
                const bDate = Date.parse(bVal);
                if (!isNaN(aDate) && !isNaN(bDate) && aVal.length > 6) {
                    return direction === 'asc' ? aDate - bDate : bDate - aDate;
                }
            }

            // Numeric comparison
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return direction === 'asc' ? aVal - bVal : bVal - aVal;
            }

            // Boolean
            if (typeof aVal === 'boolean') {
                return direction === 'asc'
                    ? (aVal === bVal ? 0 : aVal ? -1 : 1)
                    : (aVal === bVal ? 0 : aVal ? 1 : -1);
            }

            // String comparison (case-insensitive)
            const aStr = String(aVal).toLowerCase();
            const bStr = String(bVal).toLowerCase();
            if (aStr < bStr) return direction === 'asc' ? -1 : 1;
            if (aStr > bStr) return direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data, sortConfig]);

    return { sortConfig, requestSort, sortedData };
};
