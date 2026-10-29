const DATE_TOKEN = /(\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})\b)/g;

function isCalendarDate(value) {
  if (!/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(value)) return false;
  const parts = value.split(/[-/]/).map(Number);
  const [year, month, day] = /^\d{4}[-/]/.test(value) ? parts : parts.reverse();
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function redactContactText(value) {
  const text = String(value || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email đã ẩn]');
  // Split around valid dates so phone matching cannot consume a date and the following appointment time.
  return text.split(DATE_TOKEN).map((part, index) => index % 2 === 1 && isCalendarDate(part) ? part
    : part.replace(/(?<!\d)(?:\+?84|0)(?:[\s().-]*\d){8,10}(?!\d)/g, '[số điện thoại đã ẩn]')).join('');
}
