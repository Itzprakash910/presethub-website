// Follower-based verification tick shown next to creators, notifications and profiles.
const TIERS = [
  { min: 10000, tick: 'gold',  label: 'Star creator' },
  { min: 1000,  tick: 'blue',  label: 'Verified creator' },
  { min: 100,   tick: 'green', label: 'Rising creator' }
];
function tickForFollowers(count) {
  const n = Number(count || 0);
  const t = TIERS.find(x => n >= x.min);
  return t ? t.tick : '';
}
function tickLabel(tick) { return TIERS.find(t => t.tick === tick)?.label || ''; }
module.exports = { tickForFollowers, tickLabel, TIERS };
