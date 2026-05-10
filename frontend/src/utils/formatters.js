/**
 * Formats a person's role or roles into a human-readable string.
 */
export const formatRoleLabel = (role) => {
    if (Array.isArray(role)) {
        return role.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', ');
    }
    return role ? role.charAt(0).toUpperCase() + role.slice(1) : "---";
};

/**
 * Returns the full name of a person including middle initial and suffix.
 */
export const getFullNameLabel = (person) => {
    if (!person) return "---";
    const last = person.last_name || "---";
    const first = person.first_name || "---";
    const middle = person.middle_name ? ` ${person.middle_name.charAt(0)}.` : '';
    const suffix = person.suffix ? ` ${person.suffix}` : '';
    return `${last.toUpperCase()}, ${first}${middle}${suffix}`;
};

/**
 * Returns a formatted string for program and year level.
 */
export const getProgramYearLabel = (person) => {
    if (!person) return null;
    const program = person.program_name || person.program || "";
    const year = person.year_level ? ` Yr ${person.year_level}` : "";
    return program || year ? `${program}${year}` : null;
};

/**
 * Standardizes name capitalization (Title Case) and handles suffixes.
 */
export const formatName = (val) => {
    if (!val) return '';
    
    // Only allow letters, spaces, dots, hyphens, and single quotes
    let cleaned = val.replace(/[^a-zA-Z\s.\-']/g, '');

    // List of suffixes to preserve/handle
    const suffixes = ['Jr', 'Sr', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

    // Split by spaces and hyphens while keeping the delimiters to correctly title case each segment
    return cleaned.split(/(\s|-)/).map(part => {
        if (!part) return '';
        if (part === ' ' || part === '-') return part;
        
        const cleanWord = part.replace(/[.,]/g, '');
        const upperWord = cleanWord.toUpperCase();
        
        // Special handling for suffixes
        if (suffixes.includes(upperWord)) {
            const hasDot = part.endsWith('.');
            return upperWord + (hasDot ? '.' : '');
        }

        // Handle specific cases like "Jr." if typed manually with dot
        if (upperWord === 'JR' || upperWord === 'SR') {
             return upperWord.charAt(0).toUpperCase() + upperWord.slice(1).toLowerCase() + (part.endsWith('.') ? '.' : '');
        }

        // Standard Title Case
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join('');
};

/**
 * Formats ID numbers for Student (XX-XXXXX), Employee (XXXXXXXXX), or Visitor (VIS-XXXXX).
 */
export const formatIdNumber = (val, isDeleting = false) => {
    if (!val) return "";
    
    // 1. Character Filtering: Only allow 0-9, hyphen, and V, I, S (case-insensitive)
    let filtered = val.replace(/[^0-9VvIiSs\-]/g, "");
    const upper = filtered.toUpperCase();
    
    // 2. Visitor Logic: Automatically recognize "VIS" (any case)
    if (upper.includes("VIS")) {
        const visIndex = upper.indexOf("VIS");
        const afterVis = upper.slice(visIndex + 3);
        const digits = afterVis.replace(/[^0-9]/g, "").slice(0, 5);
        
        if (digits.length > 0 || (!isDeleting && upper === "VIS") || upper.includes("VIS-")) {
            return `VIS-${digits}`;
        }
        return "VIS";
    }
    
    // 3. Numeric Logic (Student/Employee)
    const digits = filtered.replace(/[^0-9]/g, "");
    
    if (digits.length > 7) {
        return digits.slice(0, 9);
    }
    
    if (digits.length === 7) {
        return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    }
    
    if (filtered.indexOf('-') === 2 && digits.length <= 7) {
        if (digits.length >= 2) {
             return `${digits.slice(0, 2)}-${digits.slice(2)}`;
        }
    }
    
    if (upper === 'V' || upper === 'VI') {
        return upper;
    }
    
    return digits;
};
