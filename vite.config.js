import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig } from 'vite';
import { analyzeBookingRows, LOCAL_AI_VERSION } from './src/local-ai.js';

const dataDirectory = resolve('.data');
mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(resolve(dataDirectory, 'planner.db'));
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
  INSERT OR IGNORE INTO file_history(import_id, category, filename, created_at, note)
    SELECT id, 'original', filename, imported_at, 'File tải lên được giữ nguyên; hệ thống chỉ đọc dữ liệu.'
    FROM imports;
`);

const demoDashboard = {
  source: 'demo',
  importId: 'demo-plan',
  filename: '45.DECATHLON - KẾ HOẠCH BOOK IN CẬP NHẬT NGÀY 26102026.xlsx',
  importedAt: '2026-10-27T09:14:00.000Z',
  rowCount: 2503,
  totalQuantity: 1768485,
  totalImpressions: 2953041,
  uniquePo: 2410,
  leadTimes: [
    { label: '1 ngày', rows: 2149, quantity: 1633779 },
    { label: '2 ngày', rows: 184, quantity: 72658 },
    { label: '3 ngày', rows: 143, quantity: 56000 },
    { label: '5 ngày', rows: 27, quantity: 6048 }
  ]
};

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
  if (!latest) return demoDashboard;
  const leadTimes = database.prepare(`
    SELECT lead_time AS label, COUNT(*) AS rows, SUM(line_quantity) AS quantity
    FROM booking_rows WHERE import_id = ? GROUP BY lead_time
    ORDER BY CASE lead_time WHEN '1 ngày' THEN 1 WHEN '2 ngày' THEN 2 WHEN '3 ngày' THEN 3 WHEN '5 ngày' THEN 5 ELSE 99 END
  `).all(latest.id);
  const uniquePo = database.prepare('SELECT COUNT(DISTINCT po) AS count FROM booking_rows WHERE import_id = ?').get(latest.id).count;
  return {
    source: 'sqlite',
    importId: latest.id,
    filename: latest.filename,
    importedAt: latest.imported_at,
    rowCount: latest.row_count,
    totalQuantity: latest.total_quantity,
    totalImpressions: latest.total_impressions,
    uniquePo,
    leadTimes
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
           print_count AS printCount, lead_time AS leadTime
    FROM booking_rows
    WHERE import_id = ?
    ORDER BY id
  `).all(importId);
}

function localAiCheck(importId, force = false) {
  const imported = database.prepare('SELECT id, filename FROM imports WHERE id = ?').get(importId);
  if (!imported) return null;
  const saved = !force && database.prepare('SELECT report_json AS reportJson, engine_version AS engineVersion FROM ai_checks WHERE import_id = ?').get(importId);
  if (saved?.engineVersion === LOCAL_AI_VERSION) return JSON.parse(saved.reportJson);
  const report = { ...analyzeBookingRows(rowsForAiCheck(importId)), importId, filename: imported.filename, source: 'sqlite' };
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

function sqliteApi() {
  return {
    name: 'sqlite-api',
    configureServer(server) {
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

      server.middlewares.use('/api/settings', async (request, response) => {
        if (request.method === 'GET') return sendJson(response, 200, currentSettings());
        if (request.method !== 'PUT') return sendJson(response, 405, { error: 'Method not allowed' });
        try {
          const payload = JSON.parse(await readBody(request));
          const numbers = {
            minutesPerImpression: Number(payload.minutesPerImpression),
            setupMinutesPerPo: Number(payload.setupMinutesPerPo || 0),
            machineCount: Number(payload.machineCount),
            shiftsPerDay: Number(payload.shiftsPerDay),
            minutesPerShift: Number(payload.minutesPerShift),
            efficiencyPercent: Number(payload.efficiencyPercent),
            planningDays: Number(payload.planningDays)
          };
          if (
            numbers.minutesPerImpression <= 0 || numbers.setupMinutesPerPo < 0 || numbers.machineCount <= 0 ||
            numbers.shiftsPerDay <= 0 || numbers.minutesPerShift <= 0 || numbers.efficiencyPercent <= 0 ||
            numbers.efficiencyPercent > 100 || numbers.planningDays <= 0
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
          const { fileId, category } = JSON.parse(await readBody(request));
          const file = database.prepare('SELECT * FROM file_history WHERE id = ?').get(fileId ?? null);
          if (!file) return sendJson(response, 404, { error: 'Không tìm thấy file.' });
          const expected = file.category === 'original' ? 'processed' : file.category === 'processed' ? 'delivered' : null;
          if (!expected || category !== expected) return sendJson(response, 400, { error: 'Trạng thái file không hợp lệ.' });
          database.prepare(`
            INSERT OR IGNORE INTO file_history(import_id, category, filename, note)
            VALUES (?, ?, ?, ?)
          `).run(file.import_id, category, file.filename, category === 'processed' ? 'Người dùng xác nhận đã xử lý.' : 'Người dùng xác nhận đã giao.');
          return sendJson(response, 200, { files: listFiles() });
        } catch (error) {
          return sendJson(response, 400, { error: error.message || 'Không thể cập nhật file.' });
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

          database.exec('BEGIN IMMEDIATE');
          try {
            const imported = database.prepare(`
              INSERT INTO imports(filename, row_count, total_quantity, total_impressions)
              VALUES (?, ?, ?, ?)
            `).run(payload.filename, payload.rows.length, totalQuantity, totalImpressions);

            const insertRow = database.prepare(`
              INSERT INTO booking_rows(
                import_id, line, customer, brand, ref, color, po, season, line_quantity,
                input_date, output_date, model_code, ticket_number, planner, print_count, lead_time
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                row.leadTime ?? null
              );
            }
            database.prepare(`
              INSERT OR IGNORE INTO file_history(import_id, category, filename, note)
              VALUES (?, 'original', ?, 'File tải lên được giữ nguyên; hệ thống chỉ đọc dữ liệu.')
            `).run(imported.lastInsertRowid, payload.filename);
            database.exec('COMMIT');
          } catch (error) {
            database.exec('ROLLBACK');
            throw error;
          }
          const dashboard = latestDashboard();
          localAiCheck(dashboard.importId, true);
          sendJson(response, 201, dashboard);
        } catch (error) {
          sendJson(response, 500, { error: error.message || 'Không thể lưu dữ liệu.' });
        }
      });
    }
  };
}

export default defineConfig({
  base: '/',
  plugins: [sqliteApi()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local']
  }
});
