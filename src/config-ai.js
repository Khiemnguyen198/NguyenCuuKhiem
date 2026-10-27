const fieldAliases = {
  name: ['ten', 'tên', 'name', 'model', 'model code', 'ma', 'mã', 'loai', 'loại', 'quy cach', 'quy cách'],
  minutesPerImpression: ['so phut', 'số phút', 'phut', 'phút', 'minutes', 'minute', 'phut luot hinh', 'phút lượt hình', 'time'],
  setupMinutesPerPo: ['phut setup', 'phút setup', 'setup', 'setup minutes', 'phut setup po'],
  machineCount: ['so may', 'số máy', 'may', 'máy', 'machine', 'machines'],
  shiftsPerDay: ['so ca', 'số ca', 'ca ngay', 'ca/ngay', 'shifts'],
  minutesPerShift: ['phut ca', 'phút ca', 'phut/ca', 'minutes per shift'],
  efficiencyPercent: ['hieu suat', 'hiệu suất', 'efficiency', 'efficiency percent'],
  planningDays: ['so ngay', 'số ngày', 'ngay ke hoach', 'ngày kế hoạch', 'planning days'],
  note: ['ghi chu', 'ghi chú', 'note', 'notes', 'mo ta', 'mô tả']
};

function normalizeLabel(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

function findColumn(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeLabel);
  return headers.find((header) => {
    const normalized = normalizeLabel(header);
    return normalizedAliases.some((alias) => normalized === alias || normalized.includes(alias));
  });
}

function optionalNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.').replace(/%/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeStandardRows(rows = []) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const mapping = Object.fromEntries(Object.entries(fieldAliases).map(([field, aliases]) => [field, findColumn(headers, aliases)]));
  const standards = rows.map((row) => ({
    name: String(row[mapping.name] ?? '').trim(),
    minutesPerImpression: optionalNumber(row[mapping.minutesPerImpression]),
    setupMinutesPerPo: optionalNumber(row[mapping.setupMinutesPerPo]),
    machineCount: optionalNumber(row[mapping.machineCount]),
    shiftsPerDay: optionalNumber(row[mapping.shiftsPerDay]),
    minutesPerShift: optionalNumber(row[mapping.minutesPerShift]),
    efficiencyPercent: optionalNumber(row[mapping.efficiencyPercent]),
    planningDays: optionalNumber(row[mapping.planningDays]),
    note: String(row[mapping.note] ?? '').trim()
  })).filter((standard) => standard.name && standard.minutesPerImpression != null && standard.minutesPerImpression > 0);
  return {
    standards,
    mapping,
    ignoredRows: Math.max(0, rows.length - standards.length),
    confidence: mapping.name && mapping.minutesPerImpression ? 'high' : standards.length ? 'medium' : 'low'
  };
}
