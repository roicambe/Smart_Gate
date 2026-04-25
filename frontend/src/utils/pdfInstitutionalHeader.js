import plpLogo from '../../imgs/plp-logo.png';
import pasigSeal from '../../imgs/pasig_seal.png';
import pasigUmaagos from '../../imgs/pasig_umaagos.png';
import pinIcon from '../../imgs/icons/pin.png';
import phoneCallIcon from '../../imgs/icons/phone-call.png';
import mailIcon from '../../imgs/icons/mail.png';

const BODY_MARGIN = 12.7; // 0.5 inch body margin
const HEADER_SIDE_MARGIN = 8; // print-safe but wider than body
const HEADER_HEIGHT = 34;
const HEADER_TOP_OFFSET = 8;
const CONTACT_ICON_HEIGHT = 2.9;
const CONTACT_ICON_TEXT_GAP = 1.4;
const CONTACT_ITEM_GAP = 3.8;
const UNIVERSITY_HIGHLIGHT_HEIGHT = 6.5;
const UNIVERSITY_HIGHLIGHT_PADDING_X = 5.5;
const UNIVERSITY_HIGHLIGHT_LEFT_RADIUS = 2.5;

const FALLBACKS = {
  universityName: 'PAMANTASAN NG LUNGSOD NG PASIG',
  systemName: 'SMART GATE',
  address: 'Alkalde Jose St. Kapasigan Pasig City, Philippines 1600',
  phone: '(106) 628-1014',
  email: 'info@plpasig.edu.ph',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const setHeaderFont = (doc, style = 'normal') => {
  const fonts = doc.getFontList?.() || {};
  if (fonts.Poppins) {
    doc.setFont('Poppins', style);
  } else {
    doc.setFont('helvetica', style);
  }
};

const setBodyFont = (doc, style = 'normal') => {
  // jsPDF built-in Helvetica is the closest built-in equivalent to Arial.
  doc.setFont('helvetica', style);
};

const safeText = (value, fallback) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
};

const toPdfSafeAscii = (value) =>
  String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const loadImage = (src) =>
  new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = src;
    img.onload = () => {
      resolve({ src: img, ratio: img.width / img.height });
    };
    img.onerror = () => resolve(null);
  });

export const prepareInstitutionalHeaderAssets = async (branding) => {
  const logoSources = [];
  if (branding?.secondary_logo_1_enabled !== false) {
    logoSources.push(branding?.secondary_logo_1 || pasigSeal);
  }
  if (branding?.secondary_logo_2_enabled !== false) {
    logoSources.push(branding?.secondary_logo_2 || pasigUmaagos);
  }
  if (branding?.primary_logo_enabled !== false) {
    logoSources.push(branding?.primary_logo || branding?.system_logo || plpLogo);
  }

  const [logoResults, contactIconResults] = await Promise.all([
    Promise.all(logoSources.map((src) => loadImage(src))),
    Promise.all([loadImage(pinIcon), loadImage(phoneCallIcon), loadImage(mailIcon)]),
  ]);

  const [addressIcon, phoneIcon, emailIcon] = contactIconResults;

  return {
    logos: logoResults.filter(Boolean),
    contactIcons: {
      address: addressIcon,
      phone: phoneIcon,
      email: emailIcon,
    },
  };
};

export const drawInstitutionalHeader = (doc, options) => {
  const {
    branding,
    logos = [],
    contactIcons = {},
    reportTitle,
    officeName,
  } = options;

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = BODY_MARGIN;
  const headerMargin = HEADER_SIDE_MARGIN;
  // Keep body margins at 1 inch, but render the letterhead in the top header area.
  const headerTop = HEADER_TOP_OFFSET;
  const printableWidth = pageWidth - headerMargin * 2;
  const sectionGap = 8;
  const leftWidth = Math.max(52, printableWidth * 0.42);
  const rightWidth = Math.max(68, printableWidth - leftWidth - sectionGap);
  const leftStartX = headerMargin;
  const rightStartX = pageWidth - headerMargin - rightWidth;

  const universityName = safeText(branding?.system_name, FALLBACKS.universityName).toUpperCase();
  const office = safeText(officeName, 'Office of Campus Security');
  const address = safeText(branding?.report_address, FALLBACKS.address);
  const phone = safeText(branding?.report_phone, FALLBACKS.phone);
  const email = safeText(branding?.report_email, FALLBACKS.email);
  const reportType = safeText(reportTitle, 'REPORT');

  const logoHeight = 15;
  const logoGap = 2.2;
  const logoWidths = logos.map((item) => clamp(logoHeight * item.ratio, 12, 25));
  const totalLogosWidth =
    logoWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, logos.length - 1) * logoGap;
  let logoX = leftStartX;
  const logoY = headerTop + 5;
  logos.forEach((logo, index) => {
    const width = logoWidths[index];
    if (logoX + width > leftStartX + leftWidth) {
      return;
    }
    doc.addImage(logo.src, 'PNG', logoX, logoY, width, logoHeight);
    logoX += width + logoGap;
  });

  setHeaderFont(doc, 'bold');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9.5);
  const rightTextX = Math.round(rightStartX + rightWidth - 2);
  const universityTextWidth = doc.getTextWidth(universityName);
  const universityHighlightWidth = Math.min(universityTextWidth + UNIVERSITY_HIGHLIGHT_PADDING_X * 2, rightWidth);
  const universityHighlightRightX = rightTextX;
  const universityHighlightX = Math.max(rightStartX, universityHighlightRightX - universityHighlightWidth);
  doc.setFillColor(15, 42, 84);
  doc.roundedRect(
    universityHighlightX,
    headerTop,
    universityHighlightWidth,
    UNIVERSITY_HIGHLIGHT_HEIGHT,
    UNIVERSITY_HIGHLIGHT_LEFT_RADIUS,
    UNIVERSITY_HIGHLIGHT_LEFT_RADIUS,
    'F',
  );
  doc.rect(
    universityHighlightX + UNIVERSITY_HIGHLIGHT_LEFT_RADIUS,
    headerTop,
    Math.max(0, universityHighlightWidth - UNIVERSITY_HIGHLIGHT_LEFT_RADIUS),
    UNIVERSITY_HIGHLIGHT_HEIGHT,
    'F',
  );
  doc.text(universityName, universityHighlightX + universityHighlightWidth / 2, headerTop + 4.5, { align: 'center' });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.text(office, rightTextX, headerTop + 11, { align: 'right' });

  setHeaderFont(doc, 'normal');
  doc.setFontSize(8.6);
  const safeAddress = toPdfSafeAscii(address);
  const safePhone = toPdfSafeAscii(phone);
  const safeEmail = toPdfSafeAscii(email);
  const addressY = headerTop + 15.2;
  const contactY = headerTop + 20.0;

  const addressTextWidth = doc.getTextWidth(safeAddress);
  const addressIconWidth = contactIcons.address ? clamp(CONTACT_ICON_HEIGHT * contactIcons.address.ratio, 2.4, 4.2) : 0;
  doc.text(safeAddress, rightTextX, addressY, { align: 'right' });
  if (contactIcons.address?.src) {
    const iconY = addressY - CONTACT_ICON_HEIGHT + 0.35;
    const iconX = rightTextX - addressTextWidth - CONTACT_ICON_TEXT_GAP - addressIconWidth;
    doc.addImage(contactIcons.address.src, 'PNG', iconX, iconY, addressIconWidth, CONTACT_ICON_HEIGHT, undefined, 'FAST');
    setHeaderFont(doc, 'normal');
  }

  const phoneTextWidth = doc.getTextWidth(safePhone);
  const emailTextWidth = doc.getTextWidth(safeEmail);
  const phoneIconWidth = contactIcons.phone ? clamp(CONTACT_ICON_HEIGHT * contactIcons.phone.ratio, 2.4, 4.2) : 0;
  const emailIconWidth = contactIcons.email ? clamp(CONTACT_ICON_HEIGHT * contactIcons.email.ratio, 2.4, 4.2) : 0;
  const emailGroupWidth = emailTextWidth + (contactIcons.email ? emailIconWidth + CONTACT_ICON_TEXT_GAP : 0);
  const phoneRightX = rightTextX - emailGroupWidth - CONTACT_ITEM_GAP;

  doc.text(safeEmail, rightTextX, contactY, { align: 'right' });
  if (contactIcons.email?.src) {
    const emailIconY = contactY - CONTACT_ICON_HEIGHT + 0.35;
    const emailIconX = rightTextX - emailTextWidth - CONTACT_ICON_TEXT_GAP - emailIconWidth;
    doc.addImage(contactIcons.email.src, 'PNG', emailIconX, emailIconY, emailIconWidth, CONTACT_ICON_HEIGHT, undefined, 'FAST');
    setHeaderFont(doc, 'normal');
  }

  doc.text(safePhone, phoneRightX, contactY, { align: 'right' });
  if (contactIcons.phone?.src) {
    const phoneIconY = contactY - CONTACT_ICON_HEIGHT + 0.35;
    const phoneIconX = phoneRightX - phoneTextWidth - CONTACT_ICON_TEXT_GAP - phoneIconWidth;
    doc.addImage(contactIcons.phone.src, 'PNG', phoneIconX, phoneIconY, phoneIconWidth, CONTACT_ICON_HEIGHT, undefined, 'FAST');
    setHeaderFont(doc, 'normal');
  }

  setHeaderFont(doc, 'bold');
  doc.setFontSize(10.5);
  doc.text(safeText(branding?.system_title, FALLBACKS.systemName), pageWidth / 2, headerTop + 28, { align: 'center' });
  doc.setFontSize(9.5);
  doc.text(reportType, pageWidth / 2, headerTop + 32.5, { align: 'center' });

  const dividerY = headerTop + HEADER_HEIGHT + 2.5;
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.35);
  doc.line(headerMargin, dividerY, pageWidth - headerMargin, dividerY);

  return {
    margin,
    contentStartY: Math.max(dividerY + 10, margin + 10),
    setBodyFont: () => setBodyFont(doc),
  };
};
