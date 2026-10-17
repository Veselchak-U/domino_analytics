/** Approximate cache bytes; binary unit boundaries, Russian display labels. */
export function formatCacheSize(bytes) {
  const gigabytes = bytes >= 1024 ** 3;
  const value = bytes / 1024 ** (gigabytes ? 3 : 2);
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${gigabytes ? 'ГБ' : 'МБ'}`;
}

/** Round a fraction of one directly to hundredths of a percentage point.
 * Positive sub-hundredth losses remain distinguishable from exact zero.
 * @param {{numerator: bigint, denominator: bigint}} fraction
 * @param {boolean} signed Include a plus for positive values.
 */
export function formatPointDifference({ numerator, denominator }, signed = false) {
  const absolute = numerator < 0n ? -numerator : numerator;
  const sign = numerator < 0n ? '−' : signed && numerator > 0n ? '+' : '';
  if (absolute > 0n && absolute * 10000n < denominator) return `${sign}<0,01 %`;
  const hundredths = (absolute * 10000n + denominator / 2n) / denominator;
  const value = Number(hundredths) / 100;
  return `${sign}${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}
