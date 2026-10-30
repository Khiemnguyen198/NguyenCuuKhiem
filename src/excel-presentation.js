import ExcelJS from 'exceljs/dist/exceljs.min.js';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { argb: 'FFE0E8EF' } };
const border = { bottom: thin };

// Keep the calculation workbook as the source of truth; ExcelJS writes its presentation
// without changing dates, cached formula results, filters, comments or merged ranges.
export async function serializeWorkbook(source) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'INKAVA';
  workbook.calcProperties.fullCalcOnLoad = true;
  for (const name of source.SheetNames) {
    const input = source.Sheets[name];
    const filter = input['!autofilter']?.ref;
    const headerRow = name === 'TH' ? 5 : name === 'CAN DOI' ? 4 : filter ? XLSX.utils.decode_range(filter).s.r + 1 : 1;
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: headerRow, xSplit: name === 'TH' ? 6 : name === 'CAN DOI' ? 4 : 3 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });
    (input['!cols'] || []).forEach((column, index) => {
      if (column.wch) sheet.getColumn(index + 1).width = column.wch;
    });
    if (filter) sheet.autoFilter = filter;
    sheet.pageSetup.printTitlesRow = `1:${headerRow}`;
    sheet.properties.defaultRowHeight = 22;
    for (const [address, item] of Object.entries(input)) {
      if (address.startsWith('!') || !item || typeof item !== 'object') continue;
      const cell = sheet.getCell(address);
      if (item.f) cell.value = { formula: item.f, result: item.v };
      else if (item.v !== undefined && item.v !== null) cell.value = item.v;
      if (item.z) cell.numFmt = item.z;
      if (item.c?.length) cell.note = item.c.map((comment) => comment.t || '').join('\n');
      const row = cell.row;
      const header = row === headerRow || (name === 'TH' && row === 1);
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF24384A' } };
      cell.alignment = { vertical: 'middle', wrapText: header };
      cell.border = border;
      if (header) {
        cell.fill = solid('FF173D60');
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        sheet.getRow(row).height = 32;
        const title = String(item.v || '').toLowerCase();
        if (title.includes('booking') && title.includes('ngày')) cell.fill = solid('FF245A86');
        if (title.includes('thực tế') && title.includes('ngày')) cell.fill = solid('FF217163');
      } else if ((name === 'CAN DOI' && row === 3) || (name === 'TH' && (row === 3 || row === 4))) {
        cell.fill = solid('FFE1F2EB');
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF17644E' } };
      } else if (row > headerRow && row % 2 === 0) {
        cell.fill = solid('FFF3F7FA');
      }
      if (item.s?.fill?.fgColor?.rgb) {
        cell.fill = solid(`FF${item.s.fill.fgColor.rgb.slice(-6)}`);
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: `FF${(item.s.font?.color?.rgb || '24384A').slice(-6)}` } };
      }
    }
    for (const merge of input['!merges'] || []) sheet.mergeCells(XLSX.utils.encode_range(merge));
  }
  // Excel treats numeric identifiers as text by design: keeping them as text
  // preserves leading zeroes and values longer than its 15-digit precision.
  // Suppress only Excel's number-stored-as-text indicator, as SheetJS did.
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  for (let index = 0; index < source.SheetNames.length; index++) {
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    const file = zip.file(path);
    const ref = source.Sheets[source.SheetNames[index]]['!ref'];
    if (!file || !ref) continue;
    const xml = await file.async('string');
    const ignored = `<ignoredErrors><ignoredError numberStoredAsText="1" sqref="${ref}"/></ignoredErrors>`;
    zip.file(path, xml.replace(/(?=<(?:drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>)/, ignored));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
