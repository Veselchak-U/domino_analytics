/** Local exercise motifs; none is a weight or a replacement for exact W/N. */
export function motifApplies(step, alternative, motif) {
  const f = alternative.facts, team = step.turn % 2;
  if (!f) return false;
  if (motif === 'control') return step.suits.ends.some(e => e.team === team
    && f.profile.ends.some(after => after.value === e.value && after.team === team));
  if (motif === 'partner') return !!f.partner && f.partner.branches > 0
    && f.partner.ended === 0 && f.partner.replies === f.partner.branches;
  if (motif === 'change') return !!alternative.stone && alternative.stone[0] !== alternative.stone[2];
  if (motif === 'block') return !!alternative.settlement && alternative.settlement.outcome.reason !== 'emptyHand';
  return false;
}

/** Reflect the physical ends, including the orientation of the selected tile. */
export function mirrorAction({ action, stone }) {
  return { action: action === 'left' ? 'right' : action === 'right' ? 'left' : action,
    ...(stone ? { stone: stone.split('-').reverse().join('-') } : {}) };
}
