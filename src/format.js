export const formatNumber = new Intl.NumberFormat('vi-VN');

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

export function formatFileDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Chưa có thời gian';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
