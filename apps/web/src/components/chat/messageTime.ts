function sameDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export function formatMessageTime(timestamp: string, now: Date) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const time = `${hours}:${minutes}`;
  if (sameDay(date, now)) return time;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const year = date.getFullYear();
  const isAnotherYear = year !== now.getFullYear();
  if (sameDay(date, yesterday)) return `昨天${isAnotherYear ? `（${year}年）` : ''} ${time}`;

  return `${isAnotherYear ? `${year}年` : ''}${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}
