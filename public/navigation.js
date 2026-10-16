/** Reveal an SVG move group by changing only its chart container's horizontal offset. */
export function revealChartStep(scroller, target) {
  if (!target || !scroller.clientWidth || scroller.scrollWidth <= scroller.clientWidth) return;
  const bounds = target.getBoundingClientRect();
  const viewportLeft = scroller.getBoundingClientRect().left + scroller.clientLeft;
  const left = bounds.left - viewportLeft, right = bounds.right - viewportLeft;
  const padding = 12;
  const shift = left < padding ? left - padding
    : right > scroller.clientWidth - padding ? right - scroller.clientWidth + padding : 0;
  const offset = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, scroller.scrollLeft + shift));
  if (offset !== scroller.scrollLeft) scroller.scrollLeft = offset;
}
