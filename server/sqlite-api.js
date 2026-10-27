import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { analyzeBookingRows, LOCAL_AI_VERSION } from '../src/local-ai.js';
import { DEMO_DASHBOARD } from '../src/demo-data.js';
import { compactRows, diffBookingRows } from '../src/booking-diff.js';

let database;

// Opened on dev-server start only, so `vite build` never creates a database.
function openDatabase() {
  const dataDirectory = resolve('.data');
  mkdirSync(dataDirectory, { recursive: true });
  database = new DatabaseSync(resolve(dataDirectory, 'planner.db'));
  database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_count INTEGER NOT NULL,
    total_quantity REAL NOT NULL,
    total_impressions REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS booking_rows (
    id INTEGER PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    line TEXT,
    customer TEXT,
    brand TEXT,
    ref TEXT,
    color TEXT,
    po TEXT,
    season TEXT,
    line_quantity REAL NOT NULL DEFAULT 0,
    input_date TEXT,
    output_date TEXT,
    model_code TEXT,
    ticket_number TEXT,
    planner TEXT,
    print_count REAL NOT NULL DEFAULT 0,
    lead_time TEXT
  );
  CREATE INDEX IF NOT EXISTS booking_rows_import_id ON booking_rows(import_id);
  CREATE INDEX IF NOT EXISTS booking_rows_lead_time ON booking_rows(lead_time);
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    minutes_per_impression REAL,
    setup_minutes_per_po REAL NOT NULL DEFAULT 0,
    machine_count INTEGER,
    shifts_per_day INTEGER NOT NULL DEFAULT 1,
    minutes_per_shift INTEGER NOT NULL DEFAULT 480,
    efficiency_percent REAL NOT NULL DEFAULT 85,
    planning_days INTEGER NOT NULL DEFAULT 6,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO app_settings(id) VALUES (1);
  CREATE TABLE IF NOT EXISTS file_history (
    id INTEGER PRIMARY KEY,
    import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('original', 'processed', 'delivered')),
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT,
    UNIQUE(import_id, category, filename)
  );
  CREATE INDEX IF NOT EXISTS file_history_category ON file_history(category, created_at DESC);
  CREATE TABLE IF NOT EXISTS ai_checks (
    import_id INTEGER PRIMARY KEY REFERENCES imports(id) ON DELETE CASCADE,
    engine_version TEXT NOT NULL,
    score INTEGER NOT NULL,
    status TEXT NOT NULL,
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    report_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS production_standards (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    minutes_per_impression REAL NOT NULL,
    setup_minutes_per_po REAL,
    machine_count INTEGER,
    shifts_per_day INTEGER,
    minutes_per_shift INTEGER,
    efficiency_percent REAL,
    planning_days INTEGER,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    source_filename TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS warehouse_snapshots (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lines_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS booking_changes (
    import_id INTEGER PRIMARY KEY REFERENCES imports(id) ON DELETE CASCADE,
    previous_import_id INTEGER,
    previous_filename TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    report_json TEXT NOT NULL
  );
  INSERT OR IGNORE INTO file_history(import_id, category, filename, created_at, note)
    SELECT id, 'original', filename, imported_at, 'File tải lên được giữ nguyên; hệ thống chỉ đọc dữ liệu.'
    FROM imports;
`);
  const bookingColumns = database.prepare('PRAGMA table_info(booking_rows)').all().map((column) => column.name);
  if (!bookingColumns.includes('contract_quantity')) database.exec('ALTER TABLE booking_rows ADD COLUMN contract_quantity REAL');
  const importColumns = database.prepare('PRAGMA table_info(imports)').all().map((column) => column.name);
  if (!importColumns.includes('sheet_check_json')) database.exec('ALTER TABLE imports ADD COLUMN sheet_check_json TEXT');
  if (!importColumns.includes('days_json')) database.exec('ALTER TABLE imports ADD COLUMN days_json TEXT');
  if (!bookingColumns.includes('allocations_json')) database.exec('ALTER TABLE booking_rows ADD COLUMN allocations_json TEXT');
  database.exec(`
    CREATE TABLE IF NOT EXISTS source_snapshots (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('receipts', 'deliveries')),
      filename TEXT NOT NULL,
      origin TEXT,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      lines_json TEXT NOT NULL
    );
    INSERT INTO source_snapshots(kind, filename, imported_at, lines_json)
      SELECT 'deliveries', filename, imported_at, lines_json FROM warehouse_snapshots
      WHERE NOT EXISTS (SELECT 1 FROM source_snapshots WHERE kind = 'deliveries')
      ORDER BY id DESC LIMIT 1;
  `);
}

const SOURCE_KINDS = new Set(['receipts', 'deliveries']);

function latestSource(kind) {
  const row = database.prepare(`
    SELECT filename, origin, strftime('%Y-%m-%dT%H:%M:%fZ', imported_at) AS importedAt, lines_json AS linesJson
    FROM source_snapshots WHERE kind = ? ORDER BY id DESC LIMIT 1
  `).get(kind);
  return row
    ? { filename: row.filename, origin: row.origin, importedAt: row.importedAt, lines: JSON.parse(row.linesJson) }
    : { filename: null, origin: null, importedAt: null, lines: [] };
}

// Share links usually open a viewer page; ask the host for the file itself.
export function directDownloadUrl(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:') throw new Error('Chỉ hỗ trợ link https.');
  if (/(^|\.)sharepoint\.com$|(^|\.)onedrive\.live\.com$|^1drv\.ms$/.test(url.hostname)) url.searchParams.set('download', '1');
  const sheet = url.hostname === 'docs.google.com' && url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (sheet) return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=xlsx`;
  return url.toString();
}

const isPrivateHost = (hostname) => hostname === 'localhost'
  || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(hostname)
  || hostname.endsWith('.local') || hostname.startsWith('[');

// SharePoint / OneDrive "anyone with the link" shares answer the first request with a guest
// cookie and a redirect to the file; the file is only served when that cookie comes back.
// fetch() does not keep cookies across redirects, so follow them by hand.
export async function fetchWithCookies(url, { maxRedirects = 10 } = {}) {
  const cookies = new Map();
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (isPrivateHost(new URL(current).hostname)) throw new Error('Không tải file từ địa chỉ nội bộ.');
    const response = await fetch(current, {
      redirect: 'manual',
      headers: cookies.size ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const separator = pair.indexOf('=');
      if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    current = new URL(location, current).toString();
  }
  throw new Error('Link chuyển hướng quá nhiều lần.');
}

function bookingRowsFor(importId) {
  return database.prepare(`
    SELECT line, customer, brand, po, ref, color, season, model_code AS modelCode, planner,
           line_quantity AS lineQuantity, input_date AS inputDate, output_date AS outputDate,
           lead_time AS leadTime, print_count AS printCount, contract_quantity AS contractQuantity,
           ticket_number AS ticketNumber, allocations_json AS allocationsJson
    FROM booking_rows WHERE import_id = ? ORDER BY id
  `).all(importId).map(({ allocationsJson, ...row }) => ({ ...row, allocations: allocationsJson ? JSON.parse(allocationsJson) : {} }));
}

function bookingDaysFor(importId) {
  const row = database.prepare('SELECT days_json AS daysJson FROM imports WHERE id = ?').get(importId);
  return row?.daysJson ? JSON.parse(row.daysJson) : [];
}

function listChanges() {
  return database.prepare(`
    SELECT c.import_id AS importId, i.filename, c.previous_filename AS previousFilename,
           strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) AS createdAt,
           CASE WHEN c.reviewed_at IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', c.reviewed_at) END AS reviewedAt,
           c.report_json AS reportJson
    FROM booking_changes c JOIN imports i ON i.id = c.import_id
    ORDER BY c.import_id DESC LIMIT 20
  `).all().map(({ reportJson, ...change }) => ({ ...change, report: JSON.parse(reportJson) }));
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 25_000_000) rejectBody(new Error('Payload quá lớn'));
    });
    request.on('end', () => resolveBody(body));
    request.on('error', rejectBody);
  });
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function latestDashboard(importId = null) {
  const latest = importId
    ? database.prepare('SELECT * FROM imports WHERE id = ?').get(importId)
    : database.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT 1').get();
  if (!latest) return DEMO_DASHBOARD;
  const leadTimes = database.prepare(`
    SELECT lead_time AS leadTime, COUNT(*) AS rowCount,
           SUM(line_quantity) AS totalQuantity,
           SUM(line_quantity * print_count) AS totalImpressions,
           COUNT(DISTINCT COALESCE(NULLIF(model_code, ''), NULLIF(ref, ''))) AS modelCount,
           COUNT(DISTINCT NULLIF(po, '')) AS poCount,
           MIN(NULLIF(input_date, '')) AS firstInput, MAX(NULLIF(input_date, '')) AS lastInput,
           MIN(NULLIF(output_date, '')) AS firstOutput, MAX(NULLIF(output_date, '')) AS lastOutput
    FROM booking_rows WHERE import_id = ? GROUP BY lead_time
    ORDER BY CASE lead_time WHEN '1 ngày' THEN 1 WHEN '2 ngày' THEN 2 WHEN '3 ngày' THEN 3 WHEN '5 ngày' THEN 5 ELSE 99 END
  `).all(latest.id);
  const customers = database.prepare(`
    SELECT lead_time AS leadTime,
           MIN(COALESCE(NULLIF(TRIM(customer), ''), NULLIF(TRIM(brand), ''), 'Chưa rõ khách hàng')) AS name,
           COUNT(*) AS rowCount, SUM(line_quantity) AS totalQuantity
    FROM booking_rows WHERE import_id = ?
    GROUP BY lead_time, UPPER(COALESCE(NULLIF(TRIM(customer), ''), NULLIF(TRIM(brand), ''), 'Chưa rõ khách hàng'))
    ORDER BY totalQuantity DESC
  `).all(latest.id);
  leadTimes.forEach((group) => {
    group.customers = customers
      .filter((customer) => customer.leadTime === group.leadTime)
      .map(({ name, rowCount, totalQuantity }) => ({ name, rowCount, totalQuantity }));
  });
  const models = database.prepare(`
    SELECT ref AS model, color, MIN(customer) AS customer, SUM(line_quantity) AS quantity,
           MIN(NULLIF(output_date, '')) AS firstOutput, MAX(NULLIF(output_date, '')) AS lastOutput,
           MAX(lead_time) AS leadTime
    FROM booking_rows WHERE import_id = ? AND COALESCE(ref, '') <> '' GROUP BY ref, color
  `).all(latest.id);
  const uniquePo = database.prepare('SELECT COUNT(DISTINCT po) AS count FROM booking_rows WHERE import_id = ?').get(latest.id).count;
  return {
    source: 'sqlite',
    importId: latest.id,
    filename: latest.filename,
    // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
    importedAt: `${String(latest.imported_at).replace(' ', 'T')}Z`,
    rowCount: latest.row_count,
    totalQuantity: latest.total_quantity,
    totalImpressions: latest.total_impressions,
    uniquePo,
    leadTimes,
    models
  };
}

function currentSettings() {
  const row = database.prepare('SELECT * FROM app_settings WHERE id = 1').get();
  return {
    minutesPerImpression: row.minutes_per_impression,
    setupMinutesPerPo: row.setup_minutes_per_po,
    machineCount: row.machine_count,
    shiftsPerDay: row.shifts_per_day,
    minutesPerShift: row.minutes_per_shift,
    efficiencyPercent: row.efficiency_percent,
    planningDays: row.planning_days,
    updatedAt: row.updated_at
  };
}

function rowsForAiCheck(importId) {
  return database.prepare(`
    SELECT line, customer, brand, ref, color, po, season,
           line_quantity AS lineQuantity, input_date AS inputDate, output_date AS outputDate,
           model_code AS modelCode, ticket_number AS ticketNumber, planner,
           print_count AS printCount, lead_time AS leadTime, contract_quantity AS contractQuantity
    FROM booking_rows
    WHERE import_id = ?
    ORDER BY id
  `).all(importId);
}

function localAiCheck(importId, force = false) {
  const imported = database.prepare('SELECT id, filename, sheet_check_json AS sheetCheckJson FROM imports WHERE id = ?').get(importId);
  if (!imported) return null;
  const saved = !force && database.prepare('SELECT report_json AS reportJson, engine_version AS engineVersion FROM ai_checks WHERE import_id = ?').get(importId);
  if (saved?.engineVersion === LOCAL_AI_VERSION) return JSON.parse(saved.reportJson);
  const sheetCheck = imported.sheetCheckJson ? JSON.parse(imported.sheetCheckJson) : null;
  const report = { ...analyzeBookingRows(rowsForAiCheck(importId), { sheetCheck }), importId, filename: imported.filename, source: 'sqlite' };
  database.prepare(`
    INSERT INTO ai_checks(import_id, engine_version, score, status, checked_at, report_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(import_id) DO UPDATE SET
      engine_version = excluded.engine_version,
      score = excluded.score,
      status = excluded.status,
      checked_at = excluded.checked_at,
      report_json = excluded.report_json
  `).run(importId, LOCAL_AI_VERSION, report.score, report.status, report.checkedAt, JSON.stringify(report));
  return report;
}

function listStandards() {
  return database.prepare(`
    SELECT id, name, minutes_per_impression AS minutesPerImpression,
           setup_minutes_per_po AS setupMinutesPerPo, machine_count AS machineCount,
           shifts_per_day AS shiftsPerDay, minutes_per_shift AS minutesPerShift,
           efficiency_percent AS efficiencyPercent, planning_days AS planningDays,
           note, source, source_filename AS sourceFilename, is_default AS isDefault,
           locked, strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) AS updatedAt
    FROM production_standards
    ORDER BY is_default DESC, name COLLATE NOCASE
  `).all().map((row) => ({ ...row, isDefault: Boolean(row.isDefault), locked: Boolean(row.locked) }));
}

function standardValues(standard) {
  const values = {
    name: String(standard.name || '').trim(),
    minutesPerImpression: Number(standard.minutesPerImpression),
    setupMinutesPerPo: standard.setupMinutesPerPo == null ? null : Number(standard.setupMinutesPerPo),
    machineCount: standard.machineCount == null ? null : Number(standard.machineCount),
    shiftsPerDay: standard.shiftsPerDay == null ? null : Number(standard.shiftsPerDay),
    minutesPerShift: standard.minutesPerShift == null ? null : Number(standard.minutesPerShift),
    efficiencyPercent: standard.efficiencyPercent == null ? null : Number(standard.efficiencyPercent),
    planningDays: standard.planningDays == null ? null : Number(standard.planningDays),
    note: String(standard.note || '').trim()
  };
  if (!values.name || !Number.isFinite(values.minutesPerImpression) || values.minutesPerImpression <= 0) {
    throw new Error('Mỗi định mức cần có tên và số phút lớn hơn 0.');
  }
  const positiveFields = ['machineCount', 'shiftsPerDay', 'minutesPerShift', 'efficiencyPercent', 'planningDays'];
  if (values.setupMinutesPerPo != null && (!Number.isFinite(values.setupMinutesPerPo) || values.setupMinutesPerPo < 0)) {
    throw new Error('Phút setup phải là số không âm.');
  }
  if (positiveFields.some((field) => values[field] != null && (!Number.isFinite(values[field]) || values[field] <= 0))) {
    throw new Error('Các thông số máy, ca, hiệu suất và ngày kế hoạch phải lớn hơn 0.');
  }
  if (values.efficiencyPercent != null && values.efficiencyPercent > 100) throw new Error('Hiệu suất không được vượt 100%.');
  return values;
}

export function sqliteApi() {
  return {
    name: 'sqlite-api',
    configureServer(server) {
      openDatabase();
      server.middlewares.use('/api/dashboard', (request, response) => {
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' });
        const requestedId = Number(new URL(request.url, 'http://local').searchParams.get('id')) || null;
        sendJson(response, 200, latestDashboard(requestedId));
      });

      server.middlewares.use('/api/ai-check', (request, response) => {
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' });
        const url = new URL(request.url, 'http://local');
        const importId = Number(url.searchParams.get('id'));
        if (!importId) return sendJson(response, 400, { error: 'Thiếu mã lần nhập.' });
        try {
          const report = localAiCheck(importId, url.searchParams.get('force') === '1');
          return report
            ? sendJson(response, 200, report)
            : sendJson(response, 404, { error: 'Không tìm thấy dữ liệu trong SQLite.' });
        } catch (error) {
          return sendJson(response, 500, { error: error.message || 'AI local không thể kiểm tra dữ liệu.' });
        }
      });

      server.middlewares.use('/api/standards', async (request, response) => {
        if (request.method === 'GET') return sendJson(response, 200, { standards: listStandards() });
        try {
          const payload = JSON.parse(await readBody(request));
          if (request.method === 'POST') {
            const standards = Array.isArray(payload.standards) ? payload.standards : [payload];
            if (!standards.length) return sendJson(response, 400, { error: 'Không có định mức hợp lệ.' });
            database.exec('BEGIN IMMEDIATE');
            try {
              if (payload.makeDefault !== false) database.prepare('UPDATE production_standards SET is_default = 0').run();
              const upsert = database.prepare(`
                INSERT INTO production_standards(
                  name, minutes_per_impression, setup_minutes_per_po, machine_count,
                  shifts_per_day, minutes_per_shift, efficiency_percent, planning_days,
                  note, source, source_filename, is_default, locked
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(name) DO UPDATE SET
                  minutes_per_impression = excluded.minutes_per_impression,
                  setup_minutes_per_po = excluded.setup_minutes_per_po,
                  machine_count = excluded.machine_count, shifts_per_day = excluded.shifts_per_day,
                  minutes_per_shift = excluded.minutes_per_shift, efficiency_percent = excluded.efficiency_percent,
                  planning_days = excluded.planning_days, note = excluded.note, source = excluded.source,
                  source_filename = excluded.source_filename, is_default = excluded.is_default,
                  locked = 1, updated_at = CURRENT_TIMESTAMP
              `);
              standards.forEach((standard, index) => {
                const value = standardValues(standard);
                upsert.run(
                  value.name, value.minutesPerImpression, value.setupMinutesPerPo, value.machineCount,
                  value.shiftsPerDay, value.minutesPerShift, value.efficiencyPercent, value.planningDays,
                  value.note, payload.source || 'manual', payload.sourceFilename || null,
                  payload.makeDefault !== false && index === 0 ? 1 : 0
                );
              });
              database.exec('COMMIT');
            } catch (error) {
              database.exec('ROLLBACK');
              throw error;
            }
            return sendJson(response, 200, { standards: listStandards() });
          }
          if (request.method === 'PUT') {
            if (payload.setDefault && Number(payload.id)) {
              database.exec('BEGIN IMMEDIATE');
              try {
                database.prepare('UPDATE production_standards SET is_default = 0').run();
                database.prepare('UPDATE production_standards SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(payload.id));
                database.exec('COMMIT');
              } catch (error) {
                database.exec('ROLLBACK');
                throw error;
              }
              return sendJson(response, 200, { standards: listStandards() });
            }
            if (!payload.confirmed) return sendJson(response, 409, { error: 'Cần xác nhận mở khóa trước khi chỉnh sửa.' });
            const value = standardValues(payload);
            const updated = database.prepare(`
              UPDATE production_standards SET name = ?, minutes_per_impression = ?,
                setup_minutes_per_po = ?, machine_count = ?, shifts_per_day = ?,
                minutes_per_shift = ?, efficiency_percent = ?, planning_days = ?, note = ?,
                locked = 1, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(
              value.name, value.minutesPerImpression, value.setupMinutesPerPo, value.machineCount,
              value.shiftsPerDay, value.minutesPerShift, value.efficiencyPercent,
              value.planningDays, value.note, Number(payload.id)
            );
            if (!updated.changes) return sendJson(response, 404, { error: 'Không tìm thấy định mức.' });
            return sendJson(response, 200, { standards: listStandards() });
          }
          return sendJson(response, 405, { error: 'Method not allowed' });
        } catch (error) {
          return sendJson(response, 400, { error: error.message || 'Không thể lưu định mức.' });
        }
      });

      server.middlewares.use('/api/settings', async (request, response) => {
        if (request.method === 'GET') return sendJson(response, 200, currentSettings());
        if (request.method !== 'PUT') return sendJson(response, 405, { error: 'Method not allowed' });
        try {
          const payload = JSON.parse(await readBody(request));
          const numbers = {
            minutesPerImpression: payload.minutesPerImpression == null || payload.minutesPerImpression === '' ? null : Number(payload.minutesPerImpression),
            setupMinutesPerPo: Number(payload.setupMinutesPerPo || 0),
            machineCount: payload.machineCount == null || payload.machineCount === '' ? null : Number(payload.machineCount),
            shiftsPerDay: Number(payload.shiftsPerDay),
            minutesPerShift: Number(payload.minutesPerShift),
            efficiencyPercent: Number(payload.efficiencyPercent),
            planningDays: Number(payload.planningDays)
          };
          if (
            (numbers.minutesPerImpression != null && (!Number.isFinite(numbers.minutesPerImpression) || numbers.minutesPerImpression <= 0)) ||
            !Number.isFinite(numbers.setupMinutesPerPo) || numbers.setupMinutesPerPo < 0 ||
            (numbers.machineCount != null && (!Number.isFinite(numbers.machineCount) || numbers.machineCount <= 0)) ||
            !Number.isFinite(numbers.shiftsPerDay) || numbers.shiftsPerDay <= 0 ||
            !Number.isFinite(numbers.minutesPerShift) || numbers.minutesPerShift <= 0 ||
            !Number.isFinite(numbers.efficiencyPercent) || numbers.efficiencyPercent <= 0 ||
            numbers.efficiencyPercent > 100 || !Number.isFinite(numbers.planningDays) || numbers.planningDays <= 0
          ) return sendJson(response, 400, { error: 'Thông số cấu hình không hợp lệ.' });

          database.prepare(`
            UPDATE app_settings SET
              minutes_per_impression = ?, setup_minutes_per_po = ?, machine_count = ?,
              shifts_per_day = ?, minutes_per_shift = ?, efficiency_percent = ?, planning_days = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
          `).run(
            numbers.minutesPerImpression, numbers.setupMinutesPerPo, numbers.machineCount,
            numbers.shiftsPerDay, numbers.minutesPerShift, numbers.efficiencyPercent, numbers.planningDays
          );
          return sendJson(response, 200, currentSettings());
        } catch (error) {
          return sendJson(response, 500, { error: error.message || 'Không thể lưu cấu hình.' });
        }
      });

      server.middlewares.use('/api/files', async (request, response) => {
        const listFiles = () => database.prepare(`
          SELECT h.id, h.import_id AS importId, h.category, h.filename, strftime('%Y-%m-%dT%H:%M:%fZ', h.created_at) AS createdAt, h.note,
                 i.row_count AS rowCount, i.total_quantity AS totalQuantity,
                 i.total_impressions AS totalImpressions
          FROM file_history h
          LEFT JOIN imports i ON i.id = h.import_id
          ORDER BY h.created_at DESC, h.id DESC
        `).all();
        if (request.method === 'GET') return sendJson(response, 200, { files: listFiles() });
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
        try {
          const { fileId, category, note } = JSON.parse(await readBody(request));
          const file = database.prepare('SELECT * FROM file_history WHERE id = ?').get(fileId ?? null);
          if (!file) return sendJson(response, 404, { error: 'Không tìm thấy file.' });
          const expected = file.category === 'original' ? 'processed' : file.category === 'processed' ? 'delivered' : null;
          if (!expected || category !== expected) return sendJson(response, 400, { error: 'Trạng thái file không hợp lệ.' });
          database.prepare(`
            INSERT OR IGNORE INTO file_history(import_id, category, filename, note)
            VALUES (?, ?, ?, ?)
          `).run(
            file.import_id, category, file.filename,
            typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : category === 'processed' ? 'Người dùng xác nhận đã xử lý.' : 'Người dùng xác nhận đã giao.'
          );
          return sendJson(response, 200, { files: listFiles() });
        } catch (error) {
          return sendJson(response, 400, { error: error.message || 'Không thể cập nhật file.' });
        }
      });

      server.middlewares.use('/api/booking-rows', (request, response) => {
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' });
        const importId = Number(new URL(request.url, 'http://local').searchParams.get('id'));
        const imported = importId && database.prepare('SELECT id, filename, sheet_check_json AS sheetCheckJson FROM imports WHERE id = ?').get(importId);
        if (!imported) return sendJson(response, 404, { error: 'Không tìm thấy lần nhập booking.' });
        return sendJson(response, 200, {
          filename: imported.filename,
          days: bookingDaysFor(importId),
          rows: bookingRowsFor(importId),
          sheetCheck: imported.sheetCheckJson ? JSON.parse(imported.sheetCheckJson) : null
        });
      });

      server.middlewares.use('/api/changes', async (request, response) => {
        if (request.method === 'GET') return sendJson(response, 200, { changes: listChanges() });
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
        try {
          const { importId } = JSON.parse(await readBody(request));
          const updated = database.prepare('UPDATE booking_changes SET reviewed_at = CURRENT_TIMESTAMP WHERE import_id = ? AND reviewed_at IS NULL').run(Number(importId));
          if (!updated.changes) return sendJson(response, 404, { error: 'Không tìm thấy thay đổi cần xác nhận.' });
          return sendJson(response, 200, { changes: listChanges() });
        } catch (error) {
          return sendJson(response, 400, { error: error.message || 'Không thể xác nhận thay đổi.' });
        }
      });

      server.middlewares.use('/api/sources', async (request, response) => {
        const kind = new URL(request.url, 'http://local').searchParams.get('kind');
        if (!SOURCE_KINDS.has(kind)) return sendJson(response, 400, { error: 'Loại nguồn dữ liệu không hợp lệ.' });
        if (request.method === 'GET') return sendJson(response, 200, latestSource(kind));
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
        try {
          const payload = JSON.parse(await readBody(request));
          if (!payload.filename || !Array.isArray(payload.lines) || !payload.lines.length) {
            return sendJson(response, 400, { error: 'File không có dòng dữ liệu hợp lệ.' });
          }
          database.prepare('INSERT INTO source_snapshots(kind, filename, origin, lines_json) VALUES (?, ?, ?, ?)')
            .run(kind, payload.filename, payload.origin || null, JSON.stringify(payload.lines));
          return sendJson(response, 201, latestSource(kind));
        } catch (error) {
          return sendJson(response, 500, { error: error.message || 'Không thể lưu nguồn dữ liệu.' });
        }
      });

      // Downloads a workbook from a share link on behalf of the browser, which CORS would block.
      server.middlewares.use('/api/fetch-url', async (request, response) => {
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
        try {
          const { url } = JSON.parse(await readBody(request));
          const target = directDownloadUrl(String(url || ''));
          if (isPrivateHost(new URL(target).hostname)) return sendJson(response, 400, { error: 'Không tải file từ địa chỉ nội bộ.' });
          const upstream = await fetchWithCookies(target);
          const type = upstream.headers.get('content-type') || '';
          if (upstream.status === 401 || upstream.status === 403) {
            return sendJson(response, 403, { error: 'Link yêu cầu đăng nhập. Hãy kiểm tra quyền chia sẻ là “Bất kỳ ai có link” (không phải “Người trong tổ chức”), hoặc tải file về rồi chọn file.' });
          }
          if (!upstream.ok) return sendJson(response, 502, { error: `Không tải được file (HTTP ${upstream.status}).` });
          if (type.includes('text/html')) {
            return sendJson(response, 415, { error: 'Link trả về trang web chứ không phải file Excel. Hãy dùng link tải trực tiếp hoặc tải file về.' });
          }
          const bytes = Buffer.from(await upstream.arrayBuffer());
          if (bytes.length > 60_000_000) return sendJson(response, 413, { error: 'File quá lớn (trên 60 MB).' });
          const disposition = upstream.headers.get('content-disposition') || '';
          const filename = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || disposition.match(/filename="?([^";]+)"?/i)?.[1] || new URL(upstream.url || target).pathname.split('/').pop() || 'file.xlsx');
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/octet-stream');
          response.setHeader('X-Filename', encodeURIComponent(filename));
          return response.end(bytes);
        } catch (error) {
          return sendJson(response, 400, { error: error.message || 'Link không hợp lệ.' });
        }
      });

      server.middlewares.use('/api/imports', async (request, response) => {
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
        try {
          const payload = JSON.parse(await readBody(request));
          if (!payload.filename || !Array.isArray(payload.rows) || payload.rows.length === 0) {
            return sendJson(response, 400, { error: 'File không có dòng booking hợp lệ.' });
          }

          const totalQuantity = payload.rows.reduce((sum, row) => sum + Number(row.lineQuantity || 0), 0);
          const totalImpressions = payload.rows.reduce(
            (sum, row) => sum + Number(row.lineQuantity || 0) * Number(row.printCount || 0),
            0
          );

          const previous = database.prepare('SELECT id, filename FROM imports ORDER BY id DESC LIMIT 1').get();
          const days = Array.isArray(payload.days) ? payload.days : [];
          const report = previous
            ? diffBookingRows(bookingRowsFor(previous.id), compactRows(payload.rows), { previousDays: bookingDaysFor(previous.id), currentDays: days })
            : null;

          database.exec('BEGIN IMMEDIATE');
          try {
            const imported = database.prepare(`
              INSERT INTO imports(filename, row_count, total_quantity, total_impressions, sheet_check_json, days_json)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(payload.filename, payload.rows.length, totalQuantity, totalImpressions, payload.sheetCheck ? JSON.stringify(payload.sheetCheck) : null, JSON.stringify(days));

            const insertRow = database.prepare(`
              INSERT INTO booking_rows(
                import_id, line, customer, brand, ref, color, po, season, line_quantity,
                input_date, output_date, model_code, ticket_number, planner, print_count, lead_time, contract_quantity,
                allocations_json
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const row of payload.rows) {
              insertRow.run(
                imported.lastInsertRowid,
                row.line ?? null,
                row.customer ?? null,
                row.brand ?? null,
                row.ref ?? null,
                row.color ?? null,
                row.po ?? null,
                row.season ?? null,
                Number(row.lineQuantity || 0),
                row.inputDate ?? null,
                row.outputDate ?? null,
                row.modelCode ?? null,
                row.ticketNumber ?? null,
                row.planner ?? null,
                Number(row.printCount || 0),
                row.leadTime ?? null,
                row.contractQuantity ?? null,
                row.allocations && Object.keys(row.allocations).length ? JSON.stringify(row.allocations) : null
              );
            }
            database.prepare(`
              INSERT OR IGNORE INTO file_history(import_id, category, filename, note)
              VALUES (?, 'original', ?, 'File tải lên được giữ nguyên; hệ thống chỉ đọc dữ liệu.')
            `).run(imported.lastInsertRowid, payload.filename);
            if (report?.hasChanges) {
              database.prepare('INSERT INTO booking_changes(import_id, previous_import_id, previous_filename, report_json) VALUES (?, ?, ?, ?)')
                .run(imported.lastInsertRowid, previous.id, previous.filename, JSON.stringify(report));
            }
            database.exec('COMMIT');
          } catch (error) {
            database.exec('ROLLBACK');
            throw error;
          }
          const dashboard = latestDashboard();
          localAiCheck(dashboard.importId, true);
          sendJson(response, 201, { ...dashboard, changes: report?.hasChanges ? listChanges()[0] : null });
        } catch (error) {
          sendJson(response, 500, { error: error.message || 'Không thể lưu dữ liệu.' });
        }
      });
    }
  };
}
