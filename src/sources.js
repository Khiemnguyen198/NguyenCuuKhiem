// The three inputs of the planner. Each accepts a local file or a share link.
export const SOURCES = {
  booking: {
    title: 'Booking',
    icon: 'ph-calendar-check',
    description: 'File booking của khách (sheet TH hoặc LEADTIME 1/2/3/5 NGÀY).',
    accept: '.xlsx,.xls,.xlsm,.xlsb'
  },
  receipts: {
    title: 'Nhận',
    icon: 'ph-tray-arrow-down',
    description: 'File nhập BTP (sheet DATA, ví dụ INKAVA_XUẤT NHẬP BTP).',
    accept: '.xlsx,.xls,.xlsm,.xlsb'
  },
  deliveries: {
    title: 'Giao',
    icon: 'ph-truck',
    description: 'File kế toán kho (sheet TỔNG HỢP: giao, hỏng in, lỗi vải).',
    accept: '.xlsx,.xls,.xlsm,.xlsb'
  }
};

// Returns { buffer, filename } for a share link. The dev server downloads it (no CORS);
// the static site can only read links that allow cross-origin downloads.
export async function downloadFromLink(url, { viaServer }) {
  const link = String(url || '').trim();
  if (!/^https:\/\//i.test(link)) throw new Error('Hãy dán link bắt đầu bằng https://');
  if (viaServer) {
    const response = await fetch('/api/fetch-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: link }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Không tải được file từ link.');
    const filename = decodeURIComponent(response.headers.get('X-Filename') || 'file-tu-link.xlsx');
    return { buffer: await response.arrayBuffer(), filename };
  }
  let response;
  try {
    response = await fetch(link);
  } catch {
    throw new Error('Trình duyệt không được phép tải link này (SharePoint/OneDrive cần đăng nhập). Hãy tải file về rồi chọn file.');
  }
  if (!response.ok) throw new Error(`Không tải được file (HTTP ${response.status}).`);
  if ((response.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('Link trả về trang web chứ không phải file Excel. Hãy tải file về rồi chọn file.');
  }
  return { buffer: await response.arrayBuffer(), filename: decodeURIComponent(new URL(link).pathname.split('/').pop() || 'file-tu-link.xlsx') };
}

// A source's origin is either a share link (https://…) or a file path on this computer or a
// shared drive (\\server\share\…, Z:\…, /Volumes/…).
export const originType = (origin) => (!origin ? null : /^https:\/\//i.test(origin) ? 'link' : 'path');

async function readPathResponse(response) {
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Không đọc được file theo đường dẫn.');
}

// Reads a workbook from a path through the local server; returns { buffer, filename, mtime }.
export async function readFromPath(path) {
  const response = await fetch('/api/read-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  await readPathResponse(response);
  return {
    buffer: await response.arrayBuffer(),
    filename: decodeURIComponent(response.headers.get('X-Filename') || 'file.xlsx'),
    mtime: response.headers.get('X-Mtime')
  };
}

// Only the file's modified time: cheap enough to ask every minute.
export async function statPath(path) {
  const response = await fetch('/api/read-path?stat=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  await readPathResponse(response);
  return response.json();
}

// Each card: what is loaded, three equal buttons to choose where it comes from (file, link,
// path), the input for the chosen one, and a footer with update / delete (and, for the
// booking, the check before export).
export function renderSourceCards({ allowPath = true, canBrowse = false } = {}) {
  return Object.entries(SOURCES).map(([kind, source]) => `
    <article class="source-card" data-source="${kind}">
      <header><span class="source-card__icon"><i class="ph ${source.icon}"></i></span><div><h3>${source.title}</h3><p>${source.description}</p></div></header>
      <div class="source-card__meta" id="sourceMeta-${kind}"><span class="muted">Chưa có dữ liệu</span></div>
      <div class="source-card__choices${allowPath ? '' : ' source-card__choices--two'}" role="group" aria-label="Nguồn file ${source.title}">
        <button type="button" class="source-choice" data-pick-file="${kind}"><i class="ph ph-file-arrow-up"></i><span>Chọn file</span></button>
        <button type="button" class="source-choice" data-toggle-form="link" data-kind="${kind}" aria-expanded="false"><i class="ph ph-link"></i><span>Dán link</span></button>
        ${allowPath ? `<button type="button" class="source-choice" data-toggle-form="path" data-kind="${kind}" aria-expanded="false"><i class="ph ph-folder-open"></i><span>Đường dẫn</span></button>` : ''}
        <input type="file" accept="${source.accept}" data-file-input="${kind}" hidden />
      </div>
      <form class="source-card__form" data-link-form="${kind}" hidden>
        <input type="url" name="url" placeholder="https://… (SharePoint, OneDrive, Google Sheets)" aria-label="Link file ${source.title}" required />
        <button type="submit" class="secondary-button">Tải</button>
      </form>
      ${allowPath ? `<form class="source-card__form" data-path-form="${kind}" hidden>
        <input type="text" name="path" placeholder="\\\\server\\thu-muc\\file.xlsm hoặc Z:\\…\\file.xlsx" aria-label="Đường dẫn file ${source.title}" spellcheck="false" required />
        ${canBrowse ? `<button type="button" class="secondary-button" data-browse-path="${kind}" title="Chọn file trên máy hoặc ổ mạng"><i class="ph ph-folder-simple-dashed"></i></button>` : ''}
        <button type="submit" class="secondary-button">Dùng</button>
      </form>` : ''}
      <footer class="source-card__footer">
        <button type="button" class="source-update" data-update-source="${kind}" title="Đọc lại file từ nguồn đã chọn"><i class="ph ph-arrows-clockwise"></i>Cập nhật file</button>
        ${kind === 'booking' ? '<button type="button" class="source-check" data-show-calendar><i class="ph ph-calendar-dots"></i>Kiểm tra</button>' : ''}
        <button type="button" class="source-delete" data-delete-source="${kind}" title="Xoá file của mục ${source.title}"><i class="ph ph-trash"></i>Xoá</button>
      </footer>
    </article>`).join('');
}
