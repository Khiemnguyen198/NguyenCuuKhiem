// The three inputs of the planner. Each accepts a local file or a share link.
export const SOURCES = {
  booking: {
    title: 'Booking',
    icon: 'ph-calendar-check',
    description: 'File booking của khách (sheet TH hoặc LEADTIME 1/2/3/5 NGÀY).',
    accept: '.xlsx,.xls,.xlsm'
  },
  receipts: {
    title: 'Nhận',
    icon: 'ph-tray-arrow-down',
    description: 'File nhập BTP (sheet DATA, ví dụ INKAVA_XUẤT NHẬP BTP).',
    accept: '.xlsx,.xls,.xlsm'
  },
  deliveries: {
    title: 'Giao',
    icon: 'ph-truck',
    description: 'File kế toán kho (sheet TỔNG HỢP: giao, hỏng in, lỗi vải).',
    accept: '.xlsx,.xls,.xlsm'
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

export function renderSourceCards() {
  return Object.entries(SOURCES).map(([kind, source]) => `
    <article class="source-card" data-source="${kind}">
      <header><span class="source-card__icon"><i class="ph ${source.icon}"></i></span><div><h3>${source.title}</h3><p>${source.description}</p></div></header>
      <div class="source-card__meta" id="sourceMeta-${kind}"><span class="muted">Chưa có dữ liệu</span></div>
      <div class="source-card__actions">
        <button type="button" class="primary-button" data-pick-file="${kind}"><i class="ph ph-file-arrow-up"></i>Chọn file</button>
        <button type="button" class="secondary-button" data-toggle-link="${kind}"><i class="ph ph-link"></i>Dán link</button>
        <input type="file" accept="${source.accept}" data-file-input="${kind}" hidden />
      </div>
      <form class="source-card__link" data-link-form="${kind}" hidden>
        <input type="url" name="url" placeholder="https://…" aria-label="Link file ${source.title}" required />
        <button type="submit" class="secondary-button">Tải</button>
      </form>
    </article>`).join('');
}
