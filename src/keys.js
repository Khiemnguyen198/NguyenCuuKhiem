// Product identity shared by booking, receiving and delivery files. Colors are typed
// inconsistently ("...BLACK*", double spaces), so only letters and digits are compared.
const compact = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

export function productKey(model, color) {
  return `${compact(model)}|${compact(color)}`;
}

export function customerKey(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN');
}
