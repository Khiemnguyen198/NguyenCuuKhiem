// A booking "batch" is one planning week: the PXC pick-up days from Monday to Sunday.
// Rows belong to a batch when they have an allocation on one of its days.
const DAY_MS = 86_400_000;
const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function mondayOf(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

export function weeksFromDays(days = []) {
  const weeks = new Map();
  days.forEach((day, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date || '')) return;
    const key = mondayOf(day.date);
    const week = weeks.get(key) || { key, from: day.date, to: day.date, dayIndexes: [] };
    week.dayIndexes.push(index);
    if (day.date < week.from) week.from = day.date;
    if (day.date > week.to) week.to = day.date;
    weeks.set(key, week);
  });
  return [...weeks.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((week) => ({ ...week, label: `Tuần ${shortDate(week.from)} – ${shortDate(week.to)}/${week.to.slice(0, 4)}` }));
}

// The batch of this week, else the next one coming, else the last one.
export function defaultWeekKey(weeks, today = new Date()) {
  if (!weeks.length) return 'all';
  const current = mondayOf(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString().slice(0, 10));
  return (weeks.find((week) => week.key === current) || weeks.find((week) => week.key > current) || weeks.at(-1)).key;
}

// Rows of one batch, with the quantity planned in that week and its latest return (PXI) date.
export function batchRows(rows, days, week) {
  if (!week) return rows;
  const inWeek = new Set(week.dayIndexes.map(String));
  return rows.flatMap((row) => {
    const entries = Object.entries(row.allocations || {}).filter(([index]) => inWeek.has(index));
    if (!entries.length) return [];
    const quantity = entries.reduce((sum, [, value]) => sum + (typeof value === 'number' ? value : 0), 0);
    const returns = entries.map(([index]) => days[index]?.returnDate || days[index]?.date).filter(Boolean).sort();
    return [{
      ...row,
      bookedLineQuantity: row.lineQuantity,
      lineQuantity: Math.round(quantity),
      outputDate: returns.at(-1) || row.outputDate,
      allocations: Object.fromEntries(entries)
    }];
  });
}
