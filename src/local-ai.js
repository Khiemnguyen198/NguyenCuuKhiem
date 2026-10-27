export const LOCAL_AI_VERSION = 'booking-checker-1.3';

const allowedLeadTimes = new Set(['1 ngày', '2 ngày', '3 ngày', '5 ngày']);

function normalizeText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('vi-VN');
}

function quantile(sortedValues, percentile) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sortedValues[lower + 1] === undefined
    ? sortedValues[lower]
    : sortedValues[lower] + fraction * (sortedValues[lower + 1] - sortedValues[lower]);
}

function rowLabel(row, index) {
  return {
    row: index + 1,
    po: String(row.po || 'Chưa có PO'),
    ref: String(row.ref || row.modelCode || 'Chưa có mã'),
    quantity: Number(row.lineQuantity || 0)
  };
}

const isSunday = (isoDate) => /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate)) && new Date(`${isoDate}T00:00:00Z`).getUTCDay() === 0;

// sheetCheck comes from comparing TH with the lead-time sheets at import time (see booking-import.js).
export function analyzeBookingRows(rows = [], { sheetCheck = null } = {}) {
  const findings = [
    { code: 'missing_po', severity: 'danger', title: 'Thiếu mã PO', description: 'Dòng booking không có mã PO.', matches: [] },
    { code: 'invalid_quantity', severity: 'danger', title: 'Số lượng không hợp lệ', description: 'LINE QTY bằng 0, âm hoặc không phải số.', matches: [] },
    { code: 'invalid_print_count', severity: 'warning', title: 'Thiếu lượt hình in', description: 'HÌNH IN bằng 0, âm hoặc không phải số.', matches: [] },
    { code: 'invalid_lead_time', severity: 'warning', title: 'Lead time chưa chuẩn', description: 'Lead time không thuộc nhóm 1, 2, 3 hoặc 5 ngày.', matches: [] },
    { code: 'reversed_dates', severity: 'danger', title: 'Ngày giao trước ngày nhận', description: 'Ngày OUTPUT sớm hơn ngày INPUT.', matches: [] },
    { code: 'duplicate_rows', severity: 'warning', title: 'Dòng có khả năng bị trùng', description: 'Các trường chính của dòng booking giống hoàn toàn một dòng trước đó.', matches: [] },
    { code: 'sunday_output', severity: 'warning', title: 'Hạn giao rơi vào Chủ Nhật', description: 'Nhà máy làm Thứ Hai–Thứ Bảy; OUTPUT Chủ Nhật thực tế phải giao từ Thứ Bảy.', matches: [] },
    { code: 'missing_contract', severity: 'info', title: 'Thiếu SLHĐ tổng', description: 'Cột SLHĐ TỔNG trống hoặc bằng 0, thường do công thức trong sheet TH bỏ sót dòng.', matches: [] },
    { code: 'sheet_mismatch', severity: 'warning', title: 'TH lệch sheet leadtime', description: 'Dòng trong TH không khớp số lượng hoặc không có trong sheet LEADTIME tương ứng (và ngược lại).', matches: [] },
    { code: 'daily_total_mismatch', severity: 'warning', title: 'TỔNG NGÀY trong TH tính sai', description: 'Giá trị TỔNG NGÀY trong file khác Σ(HÌNH IN × phân bổ); thường do công thức SUMPRODUCT lệch dòng.', matches: [] },
    { code: 'quantity_outlier', severity: 'info', title: 'Sản lượng ngoại lệ', description: 'Sản lượng cao bất thường so với phân bố trong file.', matches: [] }
  ];
  const byCode = Object.fromEntries(findings.map((finding) => [finding.code, finding]));
  const seen = new Set();
  const quantities = rows
    .map((row) => Number(row.lineQuantity))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const q1 = quantile(quantities, 0.25);
  const q3 = quantile(quantities, 0.75);
  const outlierThreshold = q3 + Math.max(1, (q3 - q1) * 3);

  rows.forEach((row, index) => {
    const label = rowLabel(row, index);
    const quantity = Number(row.lineQuantity);
    const printCount = Number(row.printCount);
    if (!normalizeText(row.po)) byCode.missing_po.matches.push(label);
    if (!Number.isFinite(quantity) || quantity <= 0) byCode.invalid_quantity.matches.push(label);
    if (!Number.isFinite(printCount) || printCount <= 0) byCode.invalid_print_count.matches.push(label);
    if (!allowedLeadTimes.has(normalizeText(row.leadTime))) byCode.invalid_lead_time.matches.push(label);
    if (row.inputDate && row.outputDate && new Date(row.outputDate) < new Date(row.inputDate)) {
      byCode.reversed_dates.matches.push(label);
    }
    const duplicateKey = [row.line, row.po, row.ref, row.color, row.lineQuantity, row.inputDate, row.outputDate, row.modelCode, row.ticketNumber, row.printCount]
      .map(normalizeText).join('|');
    if (seen.has(duplicateKey)) byCode.duplicate_rows.matches.push(label);
    else seen.add(duplicateKey);
    if (quantities.length >= 8 && quantity > outlierThreshold) byCode.quantity_outlier.matches.push(label);
    if (isSunday(row.outputDate)) byCode.sunday_output.matches.push(label);
    // Only workbooks that carry the column (TH) are checked; old imports have no value at all.
    if ('contractQuantity' in row && !(Number(row.contractQuantity) > 0)) byCode.missing_contract.matches.push(label);
  });
  (sheetCheck?.mismatches || []).forEach((mismatch) => byCode.sheet_mismatch.matches.push(mismatch));
  (sheetCheck?.dailyTotals || []).forEach((mismatch) => byCode.daily_total_mismatch.matches.push(mismatch));

  const affectedRows = new Set(findings.flatMap((finding) => finding.matches.map((match) => match.row))).size;
  const activeFindings = findings
    .filter((finding) => finding.matches.length)
    .map((finding) => ({ ...finding, count: finding.matches.length, samples: finding.matches.slice(0, 5), matches: undefined }));
  const weights = { danger: 5, warning: 2, info: 0.5 };
  const penalty = activeFindings.reduce((sum, finding) => sum + finding.count * weights[finding.severity], 0);
  const score = rows.length ? Math.max(0, Math.round(100 - (penalty / rows.length) * 100)) : 0;
  const hasDanger = activeFindings.some((finding) => finding.severity === 'danger');
  const hasWarning = activeFindings.some((finding) => finding.severity === 'warning');
  const status = !rows.length ? 'empty' : hasDanger || score < 80 ? 'danger' : hasWarning || score < 95 ? 'review' : 'good';

  return {
    engine: 'AI Local · Phát hiện bất thường',
    version: LOCAL_AI_VERSION,
    checkedAt: new Date().toISOString(),
    rowCount: rows.length,
    score,
    status,
    findingCount: activeFindings.reduce((sum, finding) => sum + finding.count, 0),
    affectedRows,
    outlierThreshold: Math.round(outlierThreshold),
    findings: activeFindings
  };
}
