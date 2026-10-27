const pad = (value) => String(value).padStart(2, '0');
const shortDate = (date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
const weekdays = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

// The factory works Monday to Saturday; on Sunday the label points at the coming week.
export function workWeekLabel(today = new Date()) {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? 1 : 1 - day));
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return {
    dayLabel: `${weekdays[today.getDay()]}, ${shortDate(today)}/${today.getFullYear()}`,
    weekLabel: `Tuần ${shortDate(monday)} – ${shortDate(saturday)}/${saturday.getFullYear()}`
  };
}
