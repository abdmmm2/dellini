// Verification tier configuration for دلني
const VERIFICATION_TIERS = [
  { id: 'none',     name: 'غير موثّق',      name_short: '—',          stars: 0,     color: '#ccc',  icon: '' },
  { id: 'black',    name: 'موثّق أسود',      name_short: 'أسود',       stars: 15000, color: '#1a1a2e', icon: '⬛' },
  { id: 'blue',     name: 'موثّق أزرق',      name_short: 'أزرق',       stars: 30000, color: '#1d9bf0', icon: '🔵' },
  { id: 'silver',   name: 'موثّق فضي',       name_short: 'فضي',        stars: 50000, color: '#c0c0c0', icon: '⭐' },
  { id: 'gold',     name: 'موثّق ذهبي',      name_short: 'ذهبي',       stars: 80000, color: '#ffd700', icon: '🌟' },
  { id: 'platinum', name: 'موثّق بلاتيني',   name_short: 'بلاتيني',    stars: 100000, color: '#b0b0ff', icon: '💎' },
];

function getTierInfo(tierId) {
  return VERIFICATION_TIERS.find(t => t.id === tierId) || VERIFICATION_TIERS[0];
}

function getNextTier(currentStars) {
  return VERIFICATION_TIERS.slice(1).find(t => currentStars < t.stars) || VERIFICATION_TIERS[VERIFICATION_TIERS.length - 1];
}

function getCurrentTier(stars) {
  let tier = VERIFICATION_TIERS[0];
  for (const t of VERIFICATION_TIERS.slice(1)) {
    if (stars >= t.stars) tier = t;
  }
  return tier;
}

module.exports = { VERIFICATION_TIERS, getTierInfo, getNextTier, getCurrentTier };
