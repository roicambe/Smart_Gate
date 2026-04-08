export const extractScanId = (inputString) => {
    if (!inputString) return null;

    // 1. Student Pattern: \d{2}-\d{5} (e.g. 23-00193)
    const studentMatch = inputString.match(/\d{2}-\d{5}/);
    if (studentMatch) return studentMatch[0];

    // 2. Visitor Pattern: VIS-\d{6} (e.g. VIS-260001)
    const visitorMatch = inputString.match(/VIS-\d{6}/);
    if (visitorMatch) return visitorMatch[0];

    // 3. Employee Pattern: \b\d{7}\b (e.g. 1234567, exact 7 digits)
    const employeeMatch = inputString.match(/\b\d{7}\b/);
    if (employeeMatch) return employeeMatch[0];

    return null; // Return null if no matches found
};
