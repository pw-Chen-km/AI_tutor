/**
 * Exam Export Module - Styles and Constants
 * 考試卷輸出模組 - 樣式和常數
 */

import { BorderStyle, convertInchesToTwip } from 'docx';

// ============================================
// Unit Conversion Utilities (單位轉換工具)
// ============================================

/**
 * Convert centimeters to twips (1 cm = 566.93 twips)
 */
export function cmToTwip(cm: number): number {
  return Math.round(cm * 566.93);
}

/**
 * Convert points to half-points (docx uses half-points for font size)
 */
export function ptToHalfPt(pt: number): number {
  return pt * 2;
}

/**
 * Convert inches to twips
 */
export function inchesToTwip(inches: number): number {
  return convertInchesToTwip(inches);
}

/**
 * Convert millimeters to twips
 */
export function mmToTwip(mm: number): number {
  return Math.round(mm * 56.693);
}

// ============================================
// Page Styles (頁面樣式)
// ============================================

export const PAGE_SIZES = {
  A4: {
    width: convertInchesToTwip(8.27),   // 210mm
    height: convertInchesToTwip(11.69), // 297mm
  },
  Letter: {
    width: convertInchesToTwip(8.5),
    height: convertInchesToTwip(11),
  },
};

export const DEFAULT_MARGINS = {
  // 2.54 cm (1 inch) margins
  top: convertInchesToTwip(1),
  bottom: convertInchesToTwip(1),
  left: convertInchesToTwip(1),
  right: convertInchesToTwip(1),
};

// ============================================
// Font Styles (字體樣式)
// ============================================

export const FONTS = {
  default: 'Times New Roman',
  code: 'Consolas',
  chinese: 'Microsoft YaHei',
};

export const FONT_SIZES = {
  title: 32,       // 16pt * 2 (half-points)
  subtitle: 28,    // 14pt
  sectionTitle: 26, // 13pt
  normal: 24,      // 12pt
  small: 22,       // 11pt
  code: 20,        // 10pt
};

// ============================================
// Spacing Styles (間距樣式)
// ============================================

export const SPACING = {
  afterParagraph: 120,
  afterSection: 400,
  afterQuestion: 200,
  lineSpacing: 276,  // 1.15 line spacing
  codeLineHeight: 300, // approx 0.5cm per line
};

// ============================================
// Border Styles (邊框樣式)
// ============================================

export const BORDERS = {
  box: {
    top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
  },
  none: {
    top: { style: BorderStyle.NIL },
    bottom: { style: BorderStyle.NIL },
    left: { style: BorderStyle.NIL },
    right: { style: BorderStyle.NIL },
  },
  bottomOnly: {
    top: { style: BorderStyle.NIL },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    left: { style: BorderStyle.NIL },
    right: { style: BorderStyle.NIL },
  },
};

// ============================================
// Complete Exam Styles Object (完整考試樣式物件)
// ============================================

export const EXAM_STYLES = {
  page: {
    A4: PAGE_SIZES.A4,
    Letter: PAGE_SIZES.Letter,
    margins: DEFAULT_MARGINS,
  },
  fonts: FONTS,
  sizes: FONT_SIZES,
  spacing: SPACING,
  borders: BORDERS,
};



