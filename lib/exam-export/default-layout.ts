/**
 * Exam Export Module - Default Header Layout
 * 考試卷輸出模組 - 預設表頭範本
 */

import { HeaderLayout } from './types';

/**
 * Default header layout for international university exam papers
 * 國際大學考試卷預設表頭佈局
 */
export const DEFAULT_HEADER_LAYOUT: HeaderLayout = {
  page: {
    size: 'A4',
    marginCm: 2.5,
    fontFamily: 'Times New Roman',
  },
  header: {
    grid: {
      cols: 12,
      rowGapPx: 8,
      colGapPx: 12,
      baseRowHeightPx: 28,
    },
    items: [
      // Row 1: Institution name (centered, bold, 16pt)
      {
        id: 'school',
        type: 'text',
        value: '{{institution}}',
        row: 1,
        col: 1,
        colSpan: 12,
        align: 'center',
        style: { fontSize: 16, bold: true, underline: false },
      },
      // Row 2: Course name (centered, bold, 14pt)
      {
        id: 'course',
        type: 'text',
        value: '{{course}}',
        row: 2,
        col: 1,
        colSpan: 12,
        align: 'center',
        style: { fontSize: 14, bold: true, underline: false },
      },
      // Row 3: Exam type (centered, 12pt)
      {
        id: 'examType',
        type: 'text',
        value: '{{examType}}',
        row: 3,
        col: 1,
        colSpan: 12,
        align: 'center',
        style: { fontSize: 12, bold: false, underline: false },
      },
      // Row 4: Duration and marks info
      {
        id: 'info',
        type: 'text',
        value: 'Duration: {{duration}} minutes  |  Total Marks: {{totalMarks}}',
        row: 4,
        col: 1,
        colSpan: 12,
        align: 'center',
        style: { fontSize: 11, bold: false, underline: false, italic: true },
      },
      // Row 5: Divider line
      {
        id: 'divider1',
        type: 'divider',
        row: 5,
        col: 1,
        colSpan: 12,
        align: 'center',
        style: { fontSize: 12, bold: false, underline: false },
      },
      // Row 6: ID field (left, 4 columns)
      {
        id: 'studentId',
        type: 'field',
        label: 'ID: ',
        placeholder: '______________',
        bindKey: 'student_id',
        row: 6,
        col: 1,
        colSpan: 4,
        align: 'left',
        style: { fontSize: 8, bold: false, underline: false },  // 縮小字體
      },
      // Row 6: Student Name field (center, 4 columns)
      {
        id: 'studentName',
        type: 'field',
        label: 'Name: ',
        placeholder: '____________________',
        bindKey: 'name',
        row: 6,
        col: 5,
        colSpan: 4,
        align: 'left',
        style: { fontSize: 8, bold: false, underline: false },  // 縮小字體
      },
      // Row 6: Class field (right, 4 columns)
      {
        id: 'class',
        type: 'field',
        label: 'Class: ',
        placeholder: '__________',
        bindKey: 'class',
        row: 6,
        col: 9,
        colSpan: 4,
        align: 'left',
        style: { fontSize: 8, bold: false, underline: false },  // 縮小字體
      },
    ],
  },
};

/**
 * Minimal header layout (just institution and course)
 * 簡約表頭佈局
 */
export const MINIMAL_HEADER_LAYOUT: HeaderLayout = {
  page: {
    size: 'A4',
    marginCm: 2.5,
    fontFamily: 'Times New Roman',
  },
  header: {
    grid: {
      cols: 12,
      rowGapPx: 8,
      colGapPx: 12,
      baseRowHeightPx: 28,
    },
    items: [
      {
        id: 'school',
        type: 'text',
        value: '{{institution}}',
        row: 1,
        col: 1,
        colSpan: 12,
        align: 'center',
        style: { fontSize: 16, bold: true, underline: false },
      },
      {
        id: 'course',
        type: 'text',
        value: '{{course}} - {{examType}}',
        row: 2,
        col: 1,
        colSpan: 12,
        align: 'center',
        style: { fontSize: 14, bold: true, underline: false },
      },
      {
        id: 'divider1',
        type: 'divider',
        row: 3,
        col: 1,
        colSpan: 12,
        align: 'center',
        style: { fontSize: 12, bold: false, underline: false },
      },
      {
        id: 'studentName',
        type: 'field',
        label: 'Name: ',
        placeholder: '________________________________',
        bindKey: 'name',
        row: 4,
        col: 1,
        colSpan: 6,
        align: 'left',
        style: { fontSize: 12, bold: false, underline: false },
      },
      {
        id: 'studentId',
        type: 'field',
        label: 'ID: ',
        placeholder: '________________',
        bindKey: 'student_id',
        row: 4,
        col: 7,
        colSpan: 6,
        align: 'left',
        style: { fontSize: 12, bold: false, underline: false },
      },
    ],
  },
};

/**
 * Get layout by name
 */
export function getHeaderLayout(name: 'default' | 'minimal' = 'default'): HeaderLayout {
  switch (name) {
    case 'minimal':
      return MINIMAL_HEADER_LAYOUT;
    default:
      return DEFAULT_HEADER_LAYOUT;
  }
}

