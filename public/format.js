/** Approximate cache bytes; binary unit boundaries, Russian display labels. */
export function formatCacheSize(bytes) {
  const gigabytes = bytes >= 1024 ** 3;
  const value = bytes / 1024 ** (gigabytes ? 3 : 2);
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${gigabytes ? 'ГБ' : 'МБ'}`;
}
