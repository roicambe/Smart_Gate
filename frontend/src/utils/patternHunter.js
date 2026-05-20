export const extractScanId = (inputString) => {
    if (!inputString) return null;

    // 1. Student Hyphenated Pattern: \d{2}-\d{5} (e.g. 23-00193)
    const studentMatch = inputString.match(/\d{2}-\d{5}/);
    if (studentMatch) return studentMatch[0];

    // 2. Student Unhyphenated Pattern: \b\d{7}\b (e.g. 2300193, exact 7 digits)
    // Automatically formats with a hyphen so the database lookup matches stored format
    const studentUnhyphenatedMatch = inputString.match(/\b\d{7}\b/);
    if (studentUnhyphenatedMatch) {
        const val = studentUnhyphenatedMatch[0];
        return `${val.slice(0, 2)}-${val.slice(2)}`;
    }

    // 3. Visitor Pattern: VIS-\d{5,6} (Supports 9-char and legacy 10-char formats)
    const visitorMatch = inputString.match(/VIS-\d{5,6}/);
    if (visitorMatch) return visitorMatch[0];

    // 4. Employee Pattern: \b\d{9}\b (e.g. 123456789, exact 9 digits)
    const employeeMatch = inputString.match(/\b\d{9}\b/);
    if (employeeMatch) return employeeMatch[0];

    return null; // Return null if no matches found
};
