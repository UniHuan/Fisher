import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, IMPORT_HEADER_TO_KEY, IMPORT_REQUIRED_HEADERS } from './import.constants';

export interface ImportWorkbook {
  workbook: ExcelJS.Workbook;
  worksheet: ExcelJS.Worksheet;
  headerIndex: Map<string, number>;
}

export function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return cell.text.trim();
}

export async function loadImportWorkbook(buffer: Buffer): Promise<ImportWorkbook> {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (worksheet === undefined) {
    throw new Error('Excel 中没有工作表');
  }
  const headerRow = worksheet.getRow(1);
  const headerIndex = new Map<string, number>();
  headerRow.eachCell((cell, columnNumber) => {
    const label = cellText(cell);
    const key = IMPORT_HEADER_TO_KEY.get(label);
    if (key !== undefined) {
      headerIndex.set(key, columnNumber);
    }
  });
  return { workbook, worksheet, headerIndex };
}

export function validateImportHeaders(headerIndex: Map<string, number>): void {
  const missing = IMPORT_REQUIRED_HEADERS.filter((label) => {
    const key = IMPORT_HEADER_TO_KEY.get(label);
    return key === undefined || !headerIndex.has(key);
  });
  if (missing.length > 0) {
    throw new Error(`缺少必填列：${missing.join('、')}`);
  }
}

export function rowValues(
  worksheet: ExcelJS.Worksheet,
  headerIndex: Map<string, number>,
  rowNumber: number,
): Record<string, string> {
  const row = worksheet.getRow(rowNumber);
  const values: Record<string, string> = {};
  for (const column of IMPORT_COLUMNS) {
    const columnNumber = headerIndex.get(column.key);
    values[column.key] =
      columnNumber === undefined ? '' : cellText(row.getCell(columnNumber));
  }
  return values;
}

export function dataRowNumbers(
  worksheet: ExcelJS.Worksheet,
  headerIndex: Map<string, number>,
): number[] {
  const rows: number[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const values = rowValues(worksheet, headerIndex, rowNumber);
    if (Object.values(values).some((value) => value.length > 0)) {
      rows.push(rowNumber);
    }
  }
  return rows;
}
