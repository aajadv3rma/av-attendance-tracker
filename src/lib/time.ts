function utcTimestamp(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, second, 0);
  return value.getTime();
}

function parseLocalDateTime(date: string, time: string) {
  const dateMatch = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(date);
  const timeMatch = /^(\\d{2}):(\\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new Error("Enter a valid local date and time.");
  }

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59
  ) {
    throw new Error("Enter a valid local date and time.");
  }

  return { year, month, day, hour, minute };
}

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(utcTimestamp(year, month, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function dateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function localDateTimeToUtc(date: string, time: string, timezone: string) {
  const { year, month, day, hour, minute } = parseLocalDateTime(date, time);
  const target = utcTimestamp(year, month, day, hour, minute);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    const represented = utcTimestamp(values.year, values.month, values.day, values.hour, values.minute, values.second);
    const difference = target - represented;
    guess += difference;
    if (difference === 0) break;
  }

  const resolved = Object.fromEntries(
    formatter.formatToParts(new Date(guess)).map((part) => [part.type, Number(part.value)])
  );
  if (
    resolved.year !== year ||
    resolved.month !== month ||
    resolved.day !== day ||
    resolved.hour !== hour ||
    resolved.minute !== minute
  ) {
    throw new Error("That local time does not exist in the selected timezone. Choose a different time.");
  }

  return new Date(guess);
}

export function shiftWindow(date: string, startTime: string, endTime: string, timezone: string) {
  const start = localDateTimeToUtc(date, startTime, timezone);
  const overnight = endTime.slice(0, 5) <= startTime.slice(0, 5);
  const endDate = overnight ? addDays(date, 1) : date;
  const end = localDateTimeToUtc(endDate, endTime, timezone);
  return { start, end };
}

export function dateTimeForTimezone(date: Date | string | null | undefined, timezone: string, withTime = true) {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : { year: "numeric" }),
  }).format(value);
}

export function formatDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.floor(minutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

export function toDateInput(date = new Date(), timezone = "Asia/Kolkata") {
  return dateInTimezone(date, timezone);
}
