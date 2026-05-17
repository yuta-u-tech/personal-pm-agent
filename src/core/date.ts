const DEFAULT_TIME_ZONE = "Asia/Tokyo";

export function today(date = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Could not format date for timezone: ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

export function assertDateString(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}. Expected YYYY-MM-DD.`);
  }
  return value;
}
