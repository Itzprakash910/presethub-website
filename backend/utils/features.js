/**
 * Pure logic for the growth features (kept free of I/O so it can be unit-tested).
 */
const IST = 'Asia/Kolkata';

// 'YYYY-MM-DD' for a given instant in India time (streaks and "daily" picks use IST days).
function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function shiftDay(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
// Deterministic pick: same item all day for everyone.
function dailyIndex(key, count) {
  if (!count) return -1;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % count;
}

/**
 * Streak rules: visiting on consecutive IST days extends the streak; a missed day resets it to 1.
 * Every 7-day milestone is rewarded once (returns rewardDays = 1).
 */
function nextStreak(prev, today) {
  const last = prev.lastDay || '';
  const cur = Number(prev.current || 0);
  const best = Number(prev.best || 0);
  if (last === today) return { current: cur, best, lastDay: last, changed: false, rewardDays: 0 };
  const isNext = last && shiftDay(today, -1) === last;
  const current = isNext ? cur + 1 : 1;
  const rewardDays = current > 0 && current % 7 === 0 ? 1 : 0;
  return { current, best: Math.max(best, current), lastDay: today, changed: true, rewardDays };
}

const LEVELS = [
  { key: 'bronze', min: 0, label: 'Bronze creator', next: 100 },
  { key: 'silver', min: 100, label: 'Silver creator', next: 1000 },
  { key: 'gold', min: 1000, label: 'Gold creator', next: null }
];
function creatorLevel(totalDownloads) {
  const n = Number(totalDownloads || 0);
  const lv = [...LEVELS].reverse().find(l => n >= l.min);
  const idx = LEVELS.indexOf(lv);
  const next = LEVELS[idx + 1];
  return { ...lv, downloads: n, toNext: next ? next.min - n : 0, progress: next ? Math.min(100, Math.round(((n - lv.min) / (next.min - lv.min)) * 100)) : 100 };
}

// Caption + hashtag suggestions. Topic and tone are whitelisted; nothing user-supplied is echoed raw.
const TONES = {
  cinematic: ['Quiet moments, bold colours. ✨', 'Every frame tells a story. 🎬', 'Light, mood and a little magic.'],
  warm: ['Golden hour, warm hearts. 🌅', 'Soft light, happy memories. 🤍', 'Feeling all the warm vibes today.'],
  moody: ['Dark tones, deeper feelings. 🌙', 'Shadows that speak. 🖤', 'Moody light for a quiet mind.'],
  fun: ['Colours that make you smile! 🎉', 'Bright, bold and full of life. 🌈', 'Good vibes only. ✌️']
};
const TOPICS = {
  portrait: ['portrait', 'portraitphotography', 'faces'],
  wedding: ['wedding', 'weddingphotography', 'bridesofinstagram'],
  travel: ['travel', 'travelphotography', 'wanderlust'],
  street: ['street', 'streetphotography', 'urbanlife'],
  food: ['food', 'foodphotography', 'foodie'],
  nature: ['nature', 'naturephotography', 'landscape'],
  night: ['night', 'nightphotography', 'citylights'],
  general: ['photography', 'photooftheday', 'lightroom']
};
const TONE_KEYS = Object.keys(TONES);
const TOPIC_KEYS = Object.keys(TOPICS);
function buildCaptions(topic = 'general', tone = 'cinematic', seed = Date.now()) {
  const t = TOPIC_KEYS.includes(topic) ? topic : 'general';
  const k = TONE_KEYS.includes(tone) ? tone : 'cinematic';
  const base = TOPICS[t];
  const lines = TONES[k];
  const captions = lines.map((line, i) => `${line} #${base[i % base.length]}`);
  const rot = Math.abs(Number(seed) || 0) % lines.length;
  const hashtags = [...base, 'lightroompreset', 'presethub', k, 'instagood', 'photoedit'].map(h => `#${h}`);
  return { topic: t, tone: k, captions: [...captions.slice(rot), ...captions.slice(0, rot)], hashtags: [...new Set(hashtags)].slice(0, 12) };
}

// Report auto-hide threshold: this many distinct open reports hides a text/preset until an admin reviews it.
const AUTO_HIDE_REPORTS = Number(process.env.AUTO_HIDE_REPORTS || 5);

module.exports = { IST, dayKey, shiftDay, dailyIndex, nextStreak, creatorLevel, buildCaptions, TOPIC_KEYS, TONE_KEYS, AUTO_HIDE_REPORTS };
