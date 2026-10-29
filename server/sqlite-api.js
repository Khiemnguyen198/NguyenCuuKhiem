import { mkdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { analyzeBookingRows, LOCAL_AI_VERSION } from '../src/local-ai.js';
import { compactRows, diffBookingRows } from '../src/booking-diff.js';
import { validateBookingRows } from '../src/booking-validation.js';

// Opened on dev-server start only, so `vite build` never creates a database.
function openDatabase(dataDirectory = resolve(process.env.PLANNER_DATA_DIR || '.data')) {
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
  // The removed Cấu hình page kept its data in these tables.
  database.exec('DROP TABLE IF EXISTS app_settings; DROP TABLE IF EXISTS production_standards;');
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
    CREATE TABLE IF NOT EXISTS source_origins (
      kind TEXT PRIMARY KEY CHECK (kind IN ('booking', 'receipts', 'deliveries')),
      origin TEXT NOT NULL,
      origin_mtime TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const originColumns = database.prepare('PRAGMA table_info(source_origins)').all().map((column) => column.name);
  if (!originColumns.includes('content_hash')) database.exec('ALTER TABLE source_origins ADD COLUMN content_hash TEXT');
  if (!originColumns.includes('checked_at')) database.exec('ALTER TABLE source_origins ADD COLUMN checked_at TEXT');
  for (const kind of SOURCE_KINDS) pruneSnapshots(database, kind);
  return database;
}

const SOURCE_KINDS = new Set(['receipts', 'deliveries']);
// Only the newest snapshot is read; a few older ones are kept, not one per refresh forever.
const KEPT_SNAPSHOTS = 3;

function pruneSnapshots(database, kind) {
  database.prepare(`
    DELETE FROM source_snapshots WHERE kind = ? AND id NOT IN (
      SELECT id FROM source_snapshots WHERE kind = ? ORDER BY id DESC LIMIT ?
    )
  `).run(kind, kind, KEPT_SNAPSHOTS);
}
const ORIGIN_KINDS = new Set(['booking', ...SOURCE_KINDS]);

// Where each input is refreshed from: a share link or a file path, plus the file's modified
// time when it was last read, so a changed file is read again.
function listOrigins(database) {
  const origins = Object.fromEntries([...ORIGIN_KINDS].map((kind) => [kind, null]));
  for (const row of database.prepare('SELECT kind, origin, origin_mtime AS mtime, content_hash AS hash, checked_at AS checkedAt FROM source_origins').all()) {
    origins[row.kind] = { origin: row.origin, mtime: row.mtime, hash: row.hash, checkedAt: row.checkedAt };
  }
  // Links saved before this table existed sit on the newest snapshot.
  for (const kind of SOURCE_KINDS) {
    const origin = !origins[kind] && database.prepare('SELECT origin FROM source_snapshots WHERE kind = ? ORDER BY id DESC LIMIT 1').get(kind)?.origin;
    if (origin) origins[kind] = { origin, mtime: null, hash: null, checkedAt: null };
  }
  return origins;
}

const EXCEL_FILE = /\.(xlsx|xlsm|xlsb|xls)$/i;

// A workbook on this computer or on a shared drive: C:\…, \\server\share\…, /Volumes/…,
// or a file:// URL. Only Excel files, so the route cannot be used to read anything else.
export function excelPath(input) {
  let path = String(input || '').trim().replace(/^"(.*)"$/, '$1');
  if (/^file:\/\//i.test(path)) path = fileURLToPath(path);
  if (!isAbsolute(path) && !/^(\\\\[^\\]+\\|[a-z]:[\\/])/i.test(path)) throw new Error('Hãy nhập đường dẫn đầy đủ, ví dụ \\\\server\\thu-muc\\file.xlsm hoặc /Volumes/…/file.xlsx.');
  if (!EXCEL_FILE.test(path)) throw new Error('Đường dẫn phải trỏ tới file Excel (.xlsx, .xlsm, .xlsb, .xls).');
  return path;
}

// Only the computer running the server may read its files (the dev server listens on the LAN).
const isLoopback = (request) => /^(127\.|::1$|::ffff:127\.)/.test(request.socket?.remoteAddress || '');

function latestSource(database, kind) {
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

function bookingRowsFor(database, importId) {
  return database.prepare(`
    SELECT line, customer, brand, po, ref, color, season, model_code AS modelCode, planner,
           line_quantity AS lineQuantity, input_date AS inputDate, output_date AS outputDate,
           lead_time AS leadTime, print_count AS printCount, contract_quantity AS contractQuantity,
           ticket_number AS ticketNumber, allocations_json AS allocationsJson
    FROM booking_rows WHERE import_id = ? ORDER BY id
  `).all(importId).map(({ allocationsJson, ...row }) => ({ ...row, allocations: allocationsJson ? JSON.parse(allocationsJson) : {} }));
}

function bookingDaysFor(database, importId) {
  const row = database.prepare('SELECT days_json AS daysJson FROM imports WHERE id = ?').get(importId);
  return row?.daysJson ? JSON.parse(row.daysJson) : [];
}

function listChanges(database) {
  return database.prepare(`
    SELECT c.import_id AS importId, i.filename, c.previous_filename AS previousFilename,
           strftime('%Y-%m-%dT%H:%M:%fZ', c.created_at) AS createdAt,
           CASE WHEN c.reviewed_at IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', c.reviewed_at) END AS reviewedAt,
           c.report_json AS reportJson
    FROM booking_changes c JOIN imports i ON i.id = c.import_id
    ORDER BY c.import_id DESC LIMIT 20
  `).all().map(({ reportJson, ...change }) => ({ ...change, report: JSON.parse(reportJson) }));
}

const BODY_LIMIT = Symbol('planner-body-limit');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function errorStatus(error, fallback = 500) {
  return error.status || (error instanceof SyntaxError ? 400 : fallback);
}

function sendError(response, error, fallback = 500, message = 'Không thể đọc hoặc lưu dữ liệu. Vui lòng thử lại.') {
  const status = errorStatus(error, fallback);
  return sendJson(response, status, { error: status === 500 ? message : error.message });
}

function checkWriteRequest(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
  if (request.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'Không cho phép thay đổi dữ liệu từ website khác.');
  const origin = request.headers.origin;
  if (!origin) return; // Keep desktop/CLI clients that do not send browser headers working.
  let expectedOrigin;
  let actualOrigin;
  try {
    const forwarded = request.headers['x-forwarded-proto']?.split(',')[0].trim();
    const protocol = forwarded === 'https' || request.socket?.encrypted ? 'https:' : 'http:';
    expectedOrigin = new URL(`${protocol}//${request.headers.host}`).origin;
    actualOrigin = new URL(origin).origin;
  } catch {
    throw httpError(403, 'Nguồn gửi yêu cầu không hợp lệ.');
  }
  if (actualOrigin !== expectedOrigin) throw httpError(403, 'Không cho phép thay đổi dữ liệu từ website khác.');
  if (request.method !== 'DELETE' && request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw httpError(400, 'Yêu cầu phải dùng Content-Type application/json.');
  }
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const maxBytes = request[BODY_LIMIT] || 25_000_000;
    if (Number(request.headers['content-length']) > maxBytes) {
      request.resume();
      return rejectBody(httpError(413, 'Payload quá lớn. Giới hạn dữ liệu nhập là 25 MB.'));
    }
    let size = 0;
    let finished = false;
    const chunks = [];
    const fail = (error) => {
      if (finished) return;
      finished = true;
      chunks.length = 0;
      rejectBody(error);
    };
    request.on('data', (chunk) => {
      if (finished) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) return fail(httpError(413, 'Payload quá lớn. Giới hạn dữ liệu nhập là 25 MB.'));
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (finished) return;
      finished = true;
      // A multibyte Vietnamese character can span HTTP chunks: decode only once.
      resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('aborted', () => fail(httpError(400, 'Yêu cầu nhập đã bị ngắt.')));
    request.on('error', () => fail(httpError(400, 'Không thể đọc dữ liệu nhập.')));
  });
}

async function readJsonBody(request) {
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, 'Dữ liệu JSON không hợp lệ.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw httpError(400, 'Dữ liệu JSON phải là một đối tượng.');
  return payload;
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function latestDashboard(database, importId = null) {
  const latest = importId
    ? database.prepare('SELECT * FROM imports WHERE id = ?').get(importId)
    : database.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT 1').get();
  if (!latest) {
    if (importId) throw httpError(404, 'Không tìm thấy lần nhập booking.');
    return { source: 'empty', importId: null, filename: '', importedAt: null, rowCount: 0, totalQuantity: 0, totalImpressions: 0, uniquePo: 0, leadTimes: [], models: [] };
  }
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

function rowsForAiCheck(database, importId) {
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

function localAiCheck(database, importId, force = false) {
  const imported = database.prepare('SELECT id, filename, sheet_check_json AS sheetCheckJson FROM imports WHERE id = ?').get(importId);
  if (!imported) return null;
  const saved = !force && database.prepare('SELECT report_json AS reportJson, engine_version AS engineVersion FROM ai_checks WHERE import_id = ?').get(importId);
  if (saved?.engineVersion === LOCAL_AI_VERSION) return JSON.parse(saved.reportJson);
  const sheetCheck = imported.sheetCheckJson ? JSON.parse(imported.sheetCheckJson) : null;
  const report = { ...analyzeBookingRows(rowsForAiCheck(database, importId), { sheetCheck }), importId, filename: imported.filename, source: 'sqlite' };
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

// Registers every /api route on a connect-style `use(prefix, handler)`: the Vite dev server
// in development, the desktop app's own HTTP server in the packaged app.
export function registerApi(register, { dataDirectory, maxBodyBytes = 25_000_000 } = {}) {
  const database = openDatabase(dataDirectory);
  let closed = false;
  const use = (prefix, handler) => register(prefix, async (request, response) => {
    request[BODY_LIMIT] = maxBodyBytes;
    try {
      checkWriteRequest(request);
      return await handler(request, response);
    } catch (error) {
      request.resume();
      if (!response.writableEnded) sendError(response, error);
    }
  });
  use('/api/dashboard', (request, response) => {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' });
    const requestedId = Number(new URL(request.url, 'http://local').searchParams.get('id')) || null;
    sendJson(response, 200, latestDashboard(database, requestedId));
  });

  use('/api/ai-check', (request, response) => {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' });
    const url = new URL(request.url, 'http://local');
    const importId = Number(url.searchParams.get('id'));
    if (!importId) return sendJson(response, 400, { error: 'Thiếu mã lần nhập.' });
    try {
      const report = localAiCheck(database, importId, url.searchParams.get('force') === '1');
      return report
        ? sendJson(response, 200, report)
        : sendJson(response, 404, { error: 'Không tìm thấy dữ liệu trong SQLite.' });
    } catch (error) {
      return sendError(response, error, 500, 'AI local không thể kiểm tra dữ liệu.');
    }
  });

  use('/api/files', async (request, response) => {
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
      const { fileId, category, note } = await readJsonBody(request);
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
      return sendError(response, error, 400);
    }
  });

  use('/api/booking-rows', (request, response) => {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' });
    const importId = Number(new URL(request.url, 'http://local').searchParams.get('id'));
    const imported = importId && database.prepare('SELECT id, filename, sheet_check_json AS sheetCheckJson FROM imports WHERE id = ?').get(importId);
    if (!imported) return sendJson(response, 404, { error: 'Không tìm thấy lần nhập booking.' });
    return sendJson(response, 200, {
      filename: imported.filename,
      days: bookingDaysFor(database, importId),
      rows: bookingRowsFor(database, importId),
      sheetCheck: imported.sheetCheckJson ? JSON.parse(imported.sheetCheckJson) : null
    });
  });

  use('/api/changes', async (request, response) => {
    if (request.method === 'GET') return sendJson(response, 200, { changes: listChanges(database) });
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
    try {
      const { importId } = await readJsonBody(request);
      const updated = database.prepare('UPDATE booking_changes SET reviewed_at = CURRENT_TIMESTAMP WHERE import_id = ? AND reviewed_at IS NULL').run(Number(importId));
      if (!updated.changes) return sendJson(response, 404, { error: 'Không tìm thấy thay đổi cần xác nhận.' });
      return sendJson(response, 200, { changes: listChanges(database) });
    } catch (error) {
      return sendError(response, error, 400);
    }
  });

  use('/api/sources', async (request, response) => {
    const kind = new URL(request.url, 'http://local').searchParams.get('kind');
    if (!SOURCE_KINDS.has(kind)) return sendJson(response, 400, { error: 'Loại nguồn dữ liệu không hợp lệ.' });
    if (request.method === 'GET') return sendJson(response, 200, latestSource(database, kind));
    if (request.method === 'DELETE') {
      database.prepare('DELETE FROM source_snapshots WHERE kind = ?').run(kind);
      database.prepare('DELETE FROM source_origins WHERE kind = ?').run(kind);
      return sendJson(response, 200, latestSource(database, kind));
    }
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
    try {
      const payload = await readJsonBody(request);
      if (!payload.filename || !Array.isArray(payload.lines) || !payload.lines.length) {
        return sendJson(response, 400, { error: 'File không có dòng dữ liệu hợp lệ.' });
      }
      database.prepare('INSERT INTO source_snapshots(kind, filename, origin, lines_json) VALUES (?, ?, ?, ?)')
        .run(kind, payload.filename, payload.origin || null, JSON.stringify(payload.lines));
      pruneSnapshots(database, kind);
      return sendJson(response, 201, latestSource(database, kind));
    } catch (error) {
      return sendError(response, error);
    }
  });

  use('/api/origins', async (request, response) => {
    if (request.method === 'GET') return sendJson(response, 200, listOrigins(database));
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
    try {
      const { kind, origin, mtime, hash, checkedAt } = await readJsonBody(request);
      if (!ORIGIN_KINDS.has(kind)) return sendJson(response, 400, { error: 'Loại nguồn dữ liệu không hợp lệ.' });
      if (origin) {
        database.prepare(`
          INSERT INTO source_origins(kind, origin, origin_mtime, content_hash, checked_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(kind) DO UPDATE SET origin = excluded.origin, origin_mtime = excluded.origin_mtime,
            content_hash = excluded.content_hash, checked_at = excluded.checked_at, updated_at = CURRENT_TIMESTAMP
        `).run(kind, String(origin), mtime || null, hash || null, checkedAt || null);
      } else {
        database.prepare('DELETE FROM source_origins WHERE kind = ?').run(kind);
      }
      return sendJson(response, 200, listOrigins(database));
    } catch (error) {
      return sendError(response, error, 400);
    }
  });

  // Reads a workbook from a path (local disk or shared drive). `?stat=1` only reports its
  // modified time, which the page polls to notice when someone saves the file.
  use('/api/read-path', async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
    if (!isLoopback(request)) return sendJson(response, 403, { error: 'Chỉ đọc được đường dẫn trên máy đang chạy ứng dụng.' });
    let path;
    try {
      path = excelPath((await readJsonBody(request)).path);
    } catch (error) {
      return sendError(response, error, 400);
    }
    try {
      const info = await stat(path);
      if (!info.isFile()) return sendJson(response, 400, { error: 'Đường dẫn không phải là file.' });
      const mtime = info.mtime.toISOString();
      if (new URL(request.url, 'http://local').searchParams.get('stat') === '1') return sendJson(response, 200, { mtime, size: info.size, filename: basename(path) });
      if (info.size > 60_000_000) return sendJson(response, 413, { error: 'File quá lớn (trên 60 MB).' });
      const bytes = await readFile(path);
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader('X-Filename', encodeURIComponent(basename(path)));
      response.setHeader('X-Mtime', mtime);
      return response.end(bytes);
    } catch (error) {
      const reason = error.code === 'ENOENT' ? 'Không tìm thấy file (kiểm tra đường dẫn hoặc ổ mạng đã kết nối chưa).'
        : error.code === 'EACCES' || error.code === 'EPERM' ? 'Không có quyền đọc file này.'
        : error.code === 'EBUSY' ? 'File đang bị khoá bởi chương trình khác, thử lại sau.'
        : error.message;
      return sendJson(response, 400, { error: reason });
    }
  });

  // Downloads a workbook from a share link on behalf of the browser, which CORS would block.
  use('/api/fetch-url', async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
    try {
      const { url } = await readJsonBody(request);
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
      return sendError(response, error, 400);
    }
  });

  use('/api/imports', async (request, response) => {
    if (request.method === 'DELETE') {
      // Removing a booking file drops its rows, history, check and change report with it.
      const importId = Number(new URL(request.url, 'http://local').searchParams.get('id'));
      const removed = importId ? database.prepare('DELETE FROM imports WHERE id = ?').run(importId) : { changes: 0 };
      if (!removed.changes) return sendJson(response, 404, { error: 'Không tìm thấy file booking.' });
      if (!database.prepare('SELECT 1 FROM imports LIMIT 1').get()) database.prepare("DELETE FROM source_origins WHERE kind = 'booking'").run();
      return sendJson(response, 200, latestDashboard(database));
    }
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
    try {
      const payload = await readJsonBody(request);
      if (typeof payload.filename !== 'string' || !payload.filename.trim() || payload.filename.length > 1024 || !Array.isArray(payload.rows) || payload.rows.length === 0) {
        return sendJson(response, 400, { error: 'File không có dòng booking hợp lệ.' });
      }
      payload.filename = payload.filename.trim();
      // Missing LINE / PO and optional metadata are retained for the repair/check flow.
      // Only invalid quantities are rejected before any history or rows are persisted.
      payload.rows = validateBookingRows(payload.rows);

      const totalQuantity = payload.rows.reduce((sum, row) => sum + Number(row.lineQuantity || 0), 0);
      const totalImpressions = payload.rows.reduce(
        (sum, row) => sum + Number(row.lineQuantity || 0) * Number(row.printCount || 0),
        0
      );

      const previous = database.prepare('SELECT id, filename FROM imports ORDER BY id DESC LIMIT 1').get();
      const days = Array.isArray(payload.days) ? payload.days : [];
      const report = previous
        ? diffBookingRows(bookingRowsFor(database, previous.id), compactRows(payload.rows), { previousDays: bookingDaysFor(database, previous.id), currentDays: days })
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
            row.lineQuantity,
            row.inputDate ?? null,
            row.outputDate ?? null,
            row.modelCode ?? null,
            row.ticketNumber ?? null,
            row.planner ?? null,
            row.printCount,
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
        // The check belongs to the same atomic import, rather than failing after commit.
        localAiCheck(database, Number(imported.lastInsertRowid), true);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      const dashboard = latestDashboard(database);
      sendJson(response, 201, { ...dashboard, changes: report?.hasChanges ? listChanges(database)[0] : null });
    } catch (error) {
      sendError(response, error);
    }
  });
  return () => {
    if (closed) return;
    closed = true;
    database.close();
  };
}

export function sqliteApi(options) {
  function configure(server) {
    const base = new URL(server.config.base, 'http://localhost').pathname.replace(/\/$/, '');
    const close = registerApi((prefix, handler) => {
      server.middlewares.use(prefix, handler);
      if (base) server.middlewares.use(`${base}${prefix}`, handler);
    }, options);
    server.httpServer?.once('close', close);
  }
  return { name: 'sqlite-api', configureServer: configure, configurePreviewServer: configure };
}
