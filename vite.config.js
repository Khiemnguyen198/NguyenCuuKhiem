import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig } from 'vite';

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
`);

const demoDashboard = {
  source: 'demo',
  filename: '45.DECATHLON - KẾ HOẠCH BOOK IN CẬP NHẬT NGÀY 26102026.xlsx',
  importedAt: '2026-10-27T09:14:00.000Z',
  rowCount: 2503,
  totalQuantity: 1768485,
  totalImpressions: 2953041,
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

function latestDashboard() {
  const latest = database.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT 1').get();
  if (!latest) return demoDashboard;
  const leadTimes = database.prepare(`
    SELECT lead_time AS label, COUNT(*) AS rows, SUM(line_quantity) AS quantity
    FROM booking_rows WHERE import_id = ? GROUP BY lead_time
    ORDER BY CASE lead_time WHEN '1 ngày' THEN 1 WHEN '2 ngày' THEN 2 WHEN '3 ngày' THEN 3 WHEN '5 ngày' THEN 5 ELSE 99 END
  `).all(latest.id);
  return {
    source: 'sqlite',
    filename: latest.filename,
    importedAt: latest.imported_at,
    rowCount: latest.row_count,
    totalQuantity: latest.total_quantity,
    totalImpressions: latest.total_impressions,
    leadTimes
  };
}

function sqliteApi() {
  return {
    name: 'sqlite-api',
    configureServer(server) {
      server.middlewares.use('/api/dashboard', (request, response) => {
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' });
        sendJson(response, 200, latestDashboard());
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
            database.exec('COMMIT');
          } catch (error) {
            database.exec('ROLLBACK');
            throw error;
          }
          sendJson(response, 201, latestDashboard());
        } catch (error) {
          sendJson(response, 500, { error: error.message || 'Không thể lưu dữ liệu.' });
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [sqliteApi()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local']
  }
});
