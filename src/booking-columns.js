// Booking headers as planners actually type them, and repairs of rows whose Mã hàng (REF) /
// Model sit in the wrong column or are missing. Everything is anchored on REF + Model: the
// file itself tells which models belong to which REF, and that is what fixes a damaged row.

// Accent-, case- and spacing-insensitive form of a header cell.
export const plainLabel = (value) => String(value ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'D')
  .toUpperCase().replace(/[.:]+$/, '').replace(/\s+/g, ' ').trim();

// Canonical header (the name the reader uses) → other spellings seen or likely in the files.
const ALIASES = {
  LINE: ['LINE', 'CHUYEN', 'LINE SX'],
  CUS: ['CUS', 'CUSTOMER', 'KHACH HANG', 'KHACH'],
  BRAND: ['BRAND', 'NHAN HIEU'],
  REF: ['REF', 'MA HANG', 'MA HANG (REF)', 'REF CODE', 'MA REF', 'STYLE'],
  COLOR: ['COLOR', 'COLOUR', 'MAU'],
  PO: ['PO', 'SO PO', 'PO NO'],
  SS: ['SS', 'MUA', 'SEASON'],
  'LINE QTY': ['LINE QTY', 'LINEQTY', 'LINE QUANTITY', 'QTY', 'SO LUONG', 'SL'],
  INPUT: ['INPUT', 'NGAY NHAN', 'NGAY VAO'],
  OUTPUT: ['OUTPUT', 'HAN GIAO', 'NGAY GIAO', 'NGAY RA'],
  'MODEL CODE': ['MODEL CODE', 'MODEL', 'MA MODEL', 'MODELCODE', 'MODEL CODE (7 SO)'],
  'SỐ PHIẾU': ['SO PHIEU', 'PHIEU', 'TICKET', 'SO PHIEU SX'],
  'SLHĐ TỔNG': ['SLHD TONG', 'SLHD', 'SL HOP DONG', 'TONG SLHD'],
  'KẾ HOẠCH': ['KE HOACH'],
  'HÌNH IN': ['HINH IN', 'SO HINH IN', 'SO HINH', 'PRINT'],
  Leadtime: ['LEADTIME', 'LEAD TIME', 'LT']
};
const CANONICAL = new Map(Object.entries(ALIASES).flatMap(([name, aliases]) => aliases.map((alias) => [alias, name])));

// The reader's name for a header cell, or its own text when it is not a booking column.
export function canonicalHeader(cell) {
  const plain = plainLabel(cell);
  return CANONICAL.get(plain) || CANONICAL.get(plain.replace(/\s*\(.*\)\s*/g, ' ').trim()) || String(cell ?? '').replace(/\s+/g, ' ').trim();
}

// A header row names a PO and either LINE or REF, plus a few other booking columns.
export function isBookingHeader(cells) {
  const names = new Set(cells.map(canonicalHeader));
  return names.has('PO') && (names.has('LINE') || names.has('REF')) && ['REF', 'COLOR', 'LINE QTY', 'MODEL CODE', 'INPUT', 'OUTPUT'].filter((name) => names.has(name)).length >= 2;
}

const MODEL = /^\d{7}$/;
const digits = (value) => String(value ?? '').trim().replace(/\.0+$/, '');
const isModel = (value) => MODEL.test(digits(value));
// REFs are short codes (Decathlon: 6 digits, sometimes with a suffix like "391784(dress)").
// "349821 SKIRT", "391784(jumpsuit)" are parts of mã hàng 349821 / 391784, not other codes.
const baseRef = (value) => (digits(value).match(/^\d+/) || [digits(value)])[0];
const looksLikeRef = (value) => /^\d{5,6}\b/.test(digits(value)) && !isModel(value);
// The 7-digit model inside a COLOR text: at the start ("9046670 1P BEA…") or appended ("…-8788519").
export const modelInText = (value) => (String(value ?? '').match(/(?:^|[^\d])(\d{7})(?!\d)/) || [])[1] || '';

// Repairs rows in place and returns what was changed (applied) or only flagged for a person.
// Each entry: { sheetRow, field, found, used, applied, reason }.
export function repairBookingRows(rows) {
  const repairs = [];
  const note = (row, field, found, used, applied, reason) => repairs.push({ sheet: row.sheetName, sheetRow: row.sheetRow, po: row.po, ref: row.ref, field, found, used, applied, reason });

  // 1. REF and MODEL CODE typed into each other's column.
  for (const row of rows) {
    if (isModel(row.ref) && looksLikeRef(row.modelCode)) {
      note(row, 'REF ↔ MODEL CODE', `REF ${row.ref} · MODEL ${row.modelCode}`, `REF ${digits(row.modelCode)} · MODEL ${digits(row.ref)}`, true, 'Cột REF đang chứa mã 7 số (model) và cột MODEL CODE chứa mã hàng: hai cột bị gõ đổi chỗ.');
      [row.ref, row.modelCode] = [digits(row.modelCode), digits(row.ref)];
    }
  }

  // 2. What the file itself says: which models each REF has, and which REF each model belongs to.
  const modelOf = (row) => (isModel(row.modelCode) ? digits(row.modelCode) : modelInText(row.color));
  const refModels = new Map();
  const modelRefs = new Map();
  for (const row of rows) {
    const ref = digits(row.ref);
    const model = modelOf(row);
    if (!ref || !model) continue;
    refModels.set(ref, new Set([...(refModels.get(ref) || []), model]));
    const counts = modelRefs.get(model) || new Map();
    counts.set(ref, (counts.get(ref) || 0) + 1);
    modelRefs.set(model, counts);
  }
  const knownModels = new Set(modelRefs.keys());
  const mainRef = (model) => [...(modelRefs.get(model) || new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  for (const row of rows) {
    const colorModel = modelInText(row.color);
    // 3. MODEL CODE missing or not a 7-digit model: take it from COLOR, else from any other cell
    // of the row holding a model this file knows, else the REF's only model.
    if (!isModel(row.modelCode)) {
      const found = String(row.modelCode ?? '').trim();
      const elsewhere = (row.cells || []).map(digits).find((value) => knownModels.has(value));
      const only = refModels.get(digits(row.ref));
      const used = colorModel || elsewhere || (only?.size === 1 ? [...only][0] : '');
      if (used) {
        row.modelCode = used;
        note(row, 'MODEL CODE', found || 'trống', used, true, colorModel
          ? 'Lấy mã model 7 số có trong ô COLOR.'
          : elsewhere ? 'Tìm thấy mã model của file này ở một ô khác trong cùng dòng (dữ liệu lệch cột).'
            : `Mã hàng ${row.ref} chỉ có một model trong file booking.`);
      } else if (row.ref || found) {
        note(row, 'MODEL CODE', found || 'trống', '—', false, only?.size > 1
          ? `Không xác định được model: mã hàng ${row.ref} có ${only.size} model trong file (${[...only].join(', ')}) và ô COLOR không có mã 7 số.`
          : 'Không có mã model 7 số ở MODEL CODE, COLOR hay ô nào khác của dòng.');
      }
    } else if (colorModel && colorModel !== digits(row.modelCode)) {
      note(row, 'MODEL CODE', `MODEL ${row.modelCode} · COLOR ${colorModel}`, '—', false, 'MODEL CODE khác mã 7 số đầu ô COLOR; app dùng MODEL CODE, hãy kiểm tra ô nào đúng.');
    }

    // 4. REF missing or unknown for this model: the REF this model has everywhere else.
    const model = digits(row.modelCode);
    const ref = digits(row.ref);
    const expected = mainRef(model);
    if (!ref && expected) {
      row.ref = expected;
      note(row, 'REF', 'trống', expected, true, `Model ${model} thuộc mã hàng ${expected} ở các dòng khác của file.`);
    } else if (ref && expected && baseRef(ref) !== baseRef(expected) && (modelRefs.get(model).get(ref) || 0) <= 1 && modelRefs.get(model).get(expected) >= 2) {
      note(row, 'REF', ref, expected, false, `Model ${model} thuộc mã hàng ${expected} ở các dòng khác; kiểm tra mã hàng ${ref} của dòng này.`);
    }
  }
  for (const row of rows) {
    if (!String(row.line ?? '').trim()) note(row, 'LINE', 'trống', '—', false, 'Dòng có mã hàng nhưng thiếu LINE; vẫn được tính vào booking, hãy điền LINE.');
    delete row.cells;
  }
  return repairs;
}
