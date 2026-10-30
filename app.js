/**
 * BET THE SHOW - Official Core Application Logic
 * 6 Boys. 6 Legs. Every Friday NHL • $30 Pool.
 * Axel, Jackson, Will, Alex, Ben, and Edward.
 */

// =============================================================================
// 1. SQUAD CONFIGURATION & 6-WEEK BETTOR ROTATION
// =============================================================================
// Week 1 was Friday, October 9, 2026 (Axel placed the bet from the States)
// Week 2 is Friday, October 16, 2026 (Jackson is ON DECK this week)
// 6-week cycle: Axel -> Jackson -> Will -> Alex -> Ben -> Edward (repeats)
const SQUAD = [
  { id: 'axel', name: 'Axel', initials: 'AX', color: '#f59e0b', defaultRole: 'Week 1 Bettor' },
  { id: 'jackson', name: 'Jackson', initials: 'JA', color: '#00ff87', defaultRole: 'Week 2 Bettor (On Deck)' },
  { id: 'will', name: 'Will', initials: 'WI', color: '#38bdf8', defaultRole: 'Week 3 Bettor' },
  { id: 'alex', name: 'Alex', initials: 'AL', color: '#a855f7', defaultRole: 'Week 4 Bettor' },
  { id: 'ben', name: 'Ben', initials: 'BE', color: '#ec4899', defaultRole: 'Week 5 Bettor' },
  { id: 'edward', name: 'Edward', initials: 'ED', color: '#fb923c', defaultRole: 'Week 6 Bettor' }
];

// REFERENCE START DATE FOR ROTATION
// Week 1 was Friday, October 16, 2026 (Axel placed the bet from the States)
// Week 2 is Friday, October 23, 2026 (Jackson is ON DECK this week)
const ROTATION_START_FRIDAY = new Date('2026-10-16T12:00:00Z');

// DYNAMIC SUNDAY SWITCH ENGINE
// "Each Sunday it should switch from our previous week to the new one."
function getActiveFridayDate(refDate = new Date()) {
  const d = new Date(refDate);
  const day = d.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat

  if (day === 0) {
    // Sunday: upcoming Friday (in 5 days)
    d.setDate(d.getDate() + 5);
  } else if (day === 6) {
    // Saturday: Friday betting is settled, advance directly to next Friday (in 6 days)
    d.setDate(d.getDate() + 6);
  } else if (day >= 1 && day <= 5) {
    // Mon-Fri: upcoming or current Friday
    d.setDate(d.getDate() + (5 - day));
  }
  d.setHours(12, 0, 0, 0);
  return d;
}

// PRE-CONFIGURED SUPABASE CREDENTIALS (Jackson's live Supabase instance)
const DEFAULT_SUPABASE_CONFIG = {
  url: 'https://lumncqjfpdxaygbvtagi.supabase.co',
  key: 'sb_publishable_gBk1KIAlEaspZL6Im2p0lA_g1rSdRQ-'
};

// =============================================================================
// 2. APPLICATION STATE
// =============================================================================
const state = {
  currentFriday: null,        // Date object (defaults to Oct 16, 2026)
  currentFridayStr: '',       // 'YYYY-MM-DD'
  weekNumber: 2,              // Week 2
  legs: {},                   // Map of boyName -> leg object
  games: [],                  // Friday's NHL matchups
  stake: 30,                  // Default $30 pool stake ($5 per boy)
  isPlaced: false,
  supabase: null,
  isLiveSync: false,
  currentView: 'slipBuilderView',
  // Live tracker parlay data (Aragon's template + 6th leg for Edward)
  trackerData: [],
  // Stats & Leaderboard historical data
  statsHistory: []
};

// AUDIO SYNTHESIZER (Web Audio API)
const audioCtx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;

function playSound(type = 'click') {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (type === 'lock') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.12);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === 'triumph') {
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g);
        g.connect(audioCtx.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, now + i * 0.07);
        g.gain.setValueAtTime(0.15, now + i * 0.07);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.5 + i * 0.07);
        o.start(now + i * 0.07);
        o.stop(now + 0.5 + i * 0.07);
      });
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  } catch (e) {}
}

// =============================================================================
// 3. DATE & 6-WEEK ROTATION ENGINE
// =============================================================================
function getFridayDiffWeeks(fridayDate) {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const diffMs = fridayDate.getTime() - ROTATION_START_FRIDAY.getTime();
  return Math.round(diffMs / msPerWeek);
}

function getBettorForFriday(fridayDate) {
  const weeksDiff = getFridayDiffWeeks(fridayDate);
  const index = ((weeksDiff % SQUAD.length) + SQUAD.length) % SQUAD.length;
  return SQUAD[index];
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatWeekDateStr(str) {
  if (!str) return '';
  const parts = str.split('-');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return str;
}

// ODDS CONVERSION & PARLAY MATH
function americanToDecimal(odds) {
  const num = parseFloat(odds);
  if (isNaN(num) || num === 0) return 1.0;
  if (num > 0) {
    return 1 + (num / 100);
  } else {
    return 1 + (100 / Math.abs(num));
  }
}

function decimalToAmerican(decimal) {
  if (decimal <= 1.0) return '+0';
  if (decimal >= 2.0) {
    return '+' + Math.round((decimal - 1) * 100);
  } else {
    return '-' + Math.round(100 / (decimal - 1));
  }
}

function calculateParlayTotals(legsList, stakeAmount) {
  const lockedLegs = legsList.filter(l => l && l.odds);
  if (lockedLegs.length === 0) {
    return {
      decimal: 1.0,
      american: '+0',
      stake: stakeAmount,
      payout: 0,
      profit: 0,
      count: 0
    };
  }

  let totalDecimal = 1.0;
  lockedLegs.forEach(leg => {
    totalDecimal *= americanToDecimal(leg.odds);
  });

  const american = decimalToAmerican(totalDecimal);
  const payout = stakeAmount * totalDecimal;
  const profit = payout - stakeAmount;

  return {
    decimal: totalDecimal,
    american: american,
    stake: stakeAmount,
    payout: payout,
    profit: profit,
    count: lockedLegs.length
  };
}

// =============================================================================
// 4. DOM ELEMENTS
// =============================================================================
const DOM = {
  // Navigation tabs
  tabSlipBuilder: document.getElementById('tabSlipBuilder'),
  tabLiveTracker: document.getElementById('tabLiveTracker'),
  tabStats: document.getElementById('tabStats'),
  navLiveMultiplier: document.getElementById('navLiveMultiplier'),
  // Header controls
  installAppBtn: document.getElementById('installAppBtn'),
  syncStatusBtn: document.getElementById('syncStatusBtn'),
  syncStatusText: document.getElementById('syncStatusText'),
  tickerGamesCount: document.getElementById('tickerGamesCount'),
  gamesTicker: document.getElementById('gamesTicker'),
  // Views
  slipBuilderView: document.getElementById('slipBuilderView'),
  liveTrackerView: document.getElementById('liveTrackerView'),
  statsView: document.getElementById('statsView'),
  // Week navigation
  prevWeekBtn: document.getElementById('prevWeekBtn'),
  nextWeekBtn: document.getElementById('nextWeekBtn'),
  weekPill: document.getElementById('weekPill'),
  currentFridayDisplay: document.getElementById('currentFridayDisplay'),
  puckDropCountdown: document.getElementById('puckDropCountdown'),
  // Bettor Banner
  bettorName: document.getElementById('bettorName'),
  bettorAvatar: document.getElementById('bettorAvatar'),
  bettorDesc: document.getElementById('bettorDesc'),
  slipProgressText: document.getElementById('slipProgressText'),
  slipProgressBar: document.getElementById('slipProgressBar'),
  slipStatusMsg: document.getElementById('slipStatusMsg'),
  quickChirpBtn: document.getElementById('quickChirpBtn'),
  copySportsbookSlipBtn: document.getElementById('copySportsbookSlipBtn'),
  // Lineup & Ticket
  legsCardsContainer: document.getElementById('legsCardsContainer'),
  matchupsList: document.getElementById('matchupsList'),
  scheduleDateSubtitle: document.getElementById('scheduleDateSubtitle'),
  ticketStatusBadge: document.getElementById('ticketStatusBadge'),
  ticketReferenceCode: document.getElementById('ticketReferenceCode'),
  ticketDateText: document.getElementById('ticketDateText'),
  ticketLegsSummary: document.getElementById('ticketLegsSummary'),
  totalAmericanOdds: document.getElementById('totalAmericanOdds'),
  totalDecimalOdds: document.getElementById('totalDecimalOdds'),
  stakeInput: document.getElementById('stakeInput'),
  potentialPayoutDisplay: document.getElementById('potentialPayoutDisplay'),
  potentialProfitDisplay: document.getElementById('potentialProfitDisplay'),
  ticketCopyBtn: document.getElementById('ticketCopyBtn'),
  markPlacedBtn: document.getElementById('markPlacedBtn'),
  markPlacedText: document.getElementById('markPlacedText'),
  rotationList: document.getElementById('rotationList'),
  // Live Tracker elements
  trackerGamesContainer: document.getElementById('gamesContainer'),
  trackerTotalOddsBadge: document.getElementById('trackerTotalOddsBadge'),
  syncStatus: document.getElementById('syncStatus'),
  refreshBtn: document.getElementById('refreshBtn'),
  refreshIcon: document.getElementById('refreshIcon'),
  legsHitCount: document.getElementById('legsHitCount'),
  overallProgressBar: document.getElementById('overallProgressBar'),
  trackerWagerDisplay: document.getElementById('trackerWagerDisplay'),
  trackerReturnDisplay: document.getElementById('trackerReturnDisplay'),
  ticketStatusBanner: document.getElementById('ticketStatusBanner'),
  autoPollToggle: document.getElementById('autoPollToggle'),
  // Modals
  legModalBackdrop: document.getElementById('legModalBackdrop'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  cancelModalBtn: document.getElementById('cancelModalBtn'),
  legForm: document.getElementById('legForm'),
  modalTitle: document.getElementById('modalTitle'),
  modalBoysPicker: document.getElementById('modalBoysPicker'),
  selectedBoyInput: document.getElementById('selectedBoyInput'),
  gameSelect: document.getElementById('gameSelect'),
  betTypeChips: document.getElementById('betTypeChips'),
  betTypeInput: document.getElementById('betTypeInput'),
  pickTextInput: document.getElementById('pickTextInput'),
  oddsInput: document.getElementById('oddsInput'),
  oddsHelper: document.getElementById('oddsHelper'),
  chirpInput: document.getElementById('chirpInput'),
  submitLegBtn: document.getElementById('submitLegBtn'),
  // Install modal
  installModalBackdrop: document.getElementById('installModalBackdrop'),
  closeInstallModalBtn: document.getElementById('closeInstallModalBtn'),
  gotItInstallBtn: document.getElementById('gotItInstallBtn'),
  // Sync modal
  syncModalBackdrop: document.getElementById('syncModalBackdrop'),
  closeSyncModalBtn: document.getElementById('closeSyncModalBtn'),
  supabaseUrlInput: document.getElementById('supabaseUrlInput'),
  supabaseAnonKeyInput: document.getElementById('supabaseAnonKeyInput'),
  saveSyncBtn: document.getElementById('saveSyncBtn'),
  toastContainer: document.getElementById('toastContainer'),
  // Stats View
  statsTotalWagered: document.getElementById('statsTotalWagered'),
  statsTotalLegs: document.getElementById('statsTotalLegs'),
  statsSquadWinRate: document.getElementById('statsSquadWinRate'),
  statsPickRecord: document.getElementById('statsPickRecord'),
  statsParlayWinRate: document.getElementById('statsParlayWinRate'),
  statsParlayRecord: document.getElementById('statsParlayRecord'),
  trophySniperName: document.getElementById('trophySniperName'),
  trophySniperStat: document.getElementById('trophySniperStat'),
  // Scan & Drop Slip Modal
  scanSlipBtn: document.getElementById('scanSlipBtn'),
  scanSlipModalBackdrop: document.getElementById('scanSlipModalBackdrop'),
  closeScanSlipModalBtn: document.getElementById('closeScanSlipModalBtn'),
  cancelScanSlipBtn: document.getElementById('cancelScanSlipBtn'),
  confirmScanSlipBtn: document.getElementById('confirmScanSlipBtn'),
  slipDropzone: document.getElementById('slipDropzone'),
  slipFileInput: document.getElementById('slipFileInput'),
  slipPreviewWrap: document.getElementById('slipPreviewWrap'),
  slipPreviewImg: document.getElementById('slipPreviewImg'),
  slipFileNameText: document.getElementById('slipFileNameText'),
  clearSlipFileBtn: document.getElementById('clearSlipFileBtn'),
  slipOcrStatus: document.getElementById('slipOcrStatus'),
  slipOcrStatusText: document.getElementById('slipOcrStatusText'),
  slipStakeInput: document.getElementById('slipStakeInput'),
  slipOddsInput: document.getElementById('slipOddsInput'),
  slipPayoutInput: document.getElementById('slipPayoutInput'),
  slipBookInput: document.getElementById('slipBookInput'),
  slipDetectedLegsWrap: document.getElementById('slipDetectedLegsWrap'),
  slipDetectedCountBadge: document.getElementById('slipDetectedCountBadge'),
  slipDetectedLegsList: document.getElementById('slipDetectedLegsList'),
  trophySniperLabel: document.getElementById('trophySniperLabel'),
  trophySniperNote: document.getElementById('trophySniperNote'),
  trophySlumpName: document.getElementById('trophySlumpName'),
  trophySlumpStat: document.getElementById('trophySlumpStat'),
  trophySlumpLabel: document.getElementById('trophySlumpLabel'),
  trophySlumpNote: document.getElementById('trophySlumpNote'),
  trophyLongshotName: document.getElementById('trophyLongshotName'),
  trophyLongshotStat: document.getElementById('trophyLongshotStat'),
  trophyLongshotLabel: document.getElementById('trophyLongshotLabel'),
  trophyLongshotNote: document.getElementById('trophyLongshotNote'),
  trophyChalkName: document.getElementById('trophyChalkName'),
  trophyChalkStat: document.getElementById('trophyChalkStat'),
  trophyChalkLabel: document.getElementById('trophyChalkLabel'),
  trophyChalkNote: document.getElementById('trophyChalkNote'),
  leaderboardTbody: document.getElementById('leaderboardTbody'),
  historyWeeksContainer: document.getElementById('historyWeeksContainer')
};

// =============================================================================
// 5. VIEW SWITCHER
// =============================================================================
function switchView(targetViewId, updateHash = true) {
  state.currentView = targetViewId;

  // Views
  DOM.slipBuilderView.classList.toggle('active', targetViewId === 'slipBuilderView');
  DOM.liveTrackerView.classList.toggle('active', targetViewId === 'liveTrackerView');
  DOM.statsView.classList.toggle('active', targetViewId === 'statsView');

  // Nav buttons
  DOM.tabSlipBuilder.classList.toggle('active', targetViewId === 'slipBuilderView');
  DOM.tabLiveTracker.classList.toggle('active', targetViewId === 'liveTrackerView');
  DOM.tabStats.classList.toggle('active', targetViewId === 'statsView');

  if (updateHash && window.history && window.history.replaceState) {
    let hash = '#slip';
    if (targetViewId === 'liveTrackerView') hash = '#tracker';
    else if (targetViewId === 'statsView') hash = '#stats';
    window.history.replaceState(null, '', hash);
  }

  if (targetViewId === 'liveTrackerView') {
    renderTracker();
    if (state.isPlaced) {
      fetchAllLiveStats(false);
    }
  } else if (targetViewId === 'statsView') {
    renderStatsView();
  } else {
    renderAll();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =============================================================================
// BESPOKE ATHLETIC SVG ICON ENGINE
// =============================================================================
const ICONS = {
  puck: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="16" y2="16"/><path d="M16 16l3-1a1.5 1.5 0 0 1 1.8 1.8l-1 3"/><line x1="20" y1="4" x2="8" y2="16"/><path d="M8 16l-3-1a1.5 1.5 0 0 0-1.8 1.8l1 3"/><ellipse cx="12" cy="19" rx="3" ry="1.5" fill="currentColor"/></svg>`,
  slip: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`,
  trophy: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="M18 9h3a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3"/><path d="M6 3h12v7a6 6 0 0 1-12 0V3z"/><path d="M12 16v4"/><path d="M8 20h8"/></svg>`,
  crown: `<svg class="bts-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4z"/><circle cx="12" cy="18" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/><circle cx="18" cy="18" r="1" fill="currentColor"/></svg>`,
  check: `<svg class="bts-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  checkCircle: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  cross: `<svg class="bts-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  clock: `<svg class="bts-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  quote: `<svg class="bts-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  fire: `<svg class="bts-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c.5 3 2.5 5 4.5 7.5 2 2.5 2.5 5 1.5 7.5-1 2.5-3.5 4-6 4s-5-1.5-6-4c-1-2.5-.5-5 1.5-7.5C9.5 7 11.5 5 12 2z"/><path d="M12 13c-.5 1-1.5 2-1.5 3 0 1.1.9 2 2 2s2-.9 2-2c0-1-1-2-1.5-3z" fill="currentColor"/></svg>`,
  sniper: `<svg class="bts-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="1" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="23" y2="12"/></svg>`,
  frost: `<svg class="bts-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><line x1="3.34" y1="7" x2="20.66" y2="17"/><line x1="3.34" y1="17" x2="20.66" y2="7"/><polyline points="9 4 12 7 15 4"/><polyline points="9 20 12 17 15 20"/><polyline points="4 10 7 12 5 15"/><polyline points="20 14 17 12 19 9"/></svg>`,
  rocket: `<svg class="bts-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>`,
  shield: `<svg class="bts-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  lock: `<svg class="bts-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  spark: `<svg class="bts-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  refresh: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  bolt: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor"/></svg>`,
  alert: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  trash: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  stats: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  cash: `<svg class="bts-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  chat: `<svg class="bts-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`
};

function getIcon(name, extraClass = '') {
  const svg = ICONS[name] || ICONS.puck;
  if (!extraClass) return svg;
  return svg.replace('class="bts-icon"', `class="bts-icon ${extraClass}"`);
}

// TOAST NOTIFICATIONS
function showToast(message, iconKey = 'puck') {
  const toast = document.createElement('div');
  toast.className = 'nhl-toast';
  const iconSvg = ICONS[iconKey] || (typeof iconKey === 'string' && iconKey.startsWith('<svg') ? iconKey : ICONS.puck);
  toast.innerHTML = `<span class="nhl-toast-icon">${iconSvg}</span> <span>${message}</span>`;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// =============================================================================
// =============================================================================
// 6. DEFAULT 6-LEG LIVE PARLAY DATA (ARAGON BET365 ENGINE)
// =============================================================================
const DEFAULT_OCT23_SLATE = [
  {
    gameId: "MTL_CHI",
    title: "SAME GAME PARLAY (+190)",
    odds: "2.90",
    awayTeam: "MTL",
    awayName: "MTL Canadiens",
    homeTeam: "CHI",
    homeName: "CHI Blackhawks",
    startTime: "Fri Oct 23 • 8:00 PM",
    gameStateText: "Final • MTL 4 - CHI 1",
    legs: [
      {
        id: "caufield_sog",
        boyName: "Edward",
        playerName: "Cole Caufield",
        team: "MTL",
        marketLabel: "Over 3.5 Shots on Goal",
        statType: "shots",
        target: 4,
        apiStat: 4,
        manualDelta: 0,
        subDetail: "0G, 0A • 4 SOG • 16:11 TOI"
      },
      {
        id: "slafkovsky_pts",
        boyName: "Will",
        playerName: "Juraj Slafkovsky",
        team: "MTL",
        marketLabel: "Over 0.5 Total Points",
        statType: "points",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 3 SOG • 16:03 TOI"
      },
      {
        id: "hutson_sog",
        boyName: "Ben",
        playerName: "Lane Hutson",
        team: "MTL",
        marketLabel: "Over 1.5 Shots on Goal",
        statType: "shots",
        target: 2,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG • 22:04 TOI"
      }
    ]
  },
  {
    gameId: "TBL_COL",
    title: "SAME GAME PARLAY (+369)",
    odds: "4.69",
    awayTeam: "TBL",
    awayName: "TBL Lightning",
    homeTeam: "COL",
    homeName: "COL Avalanche",
    startTime: "Fri Oct 23 • 9:00 PM",
    gameStateText: "Final • COL 6 - TBL 3",
    legs: [
      {
        id: "mackinnon_sog",
        boyName: "Jackson",
        playerName: "Nathan MacKinnon",
        team: "COL",
        marketLabel: "Over 3.5 Shots on Goal",
        statType: "shots",
        target: 4,
        apiStat: 4,
        manualDelta: 0,
        subDetail: "1G, 3A • 4 SOG • 18:10 TOI"
      },
      {
        id: "kucherov_goals",
        boyName: "Alex",
        playerName: "Nikita Kucherov",
        team: "TBL",
        marketLabel: "Over 0.5 Total Goals",
        statType: "goals",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 2 SOG • 20:43 TOI"
      },
      {
        id: "hagel_pts",
        boyName: "Axel",
        playerName: "Brandon Hagel",
        team: "TBL",
        marketLabel: "Over 0.5 Total Points",
        statType: "points",
        target: 1,
        apiStat: 1,
        manualDelta: 0,
        subDetail: "0G, 1A • 2 SOG • 20:33 TOI"
      }
    ]
  }
];

const DEFAULT_OCT16_SLATE = [
  {
    gameId: "PIT_COL",
    title: "SAME GAME PARLAY",
    odds: "2.80",
    awayTeam: "PIT",
    awayName: "PIT Penguins",
    homeTeam: "COL",
    homeName: "COL Avalanche",
    startTime: "Fri Oct 16 • 8:07 PM",
    gameStateText: "Completed • Final",
    legs: [
      {
        id: "nelson_pts",
        boyName: "Axel",
        playerName: "Brock Nelson",
        team: "COL",
        marketLabel: "1+ Points",
        statType: "points",
        target: 1,
        apiStat: 1,
        manualDelta: 0,
        subDetail: "0G, 1A • 2 SOG"
      },
      {
        id: "mackinnon_sog",
        boyName: "Jackson",
        playerName: "Nathan MacKinnon",
        team: "COL",
        marketLabel: "4+ Shots on Goal",
        statType: "shots",
        target: 4,
        apiStat: 5,
        manualDelta: 0,
        subDetail: "5 SOG • 1G, 1A"
      }
    ]
  },
  {
    gameId: "BOS_ANA",
    title: "SAME GAME PARLAY",
    odds: "3.75",
    awayTeam: "BOS",
    awayName: "BOS Bruins",
    homeTeam: "ANA",
    homeName: "ANA Ducks",
    startTime: "Fri Oct 16 • 9:07 PM",
    gameStateText: "Completed • Final",
    legs: [
      {
        id: "zacha_pts",
        boyName: "Will",
        playerName: "Pavel Zacha",
        team: "BOS",
        marketLabel: "1+ Points",
        statType: "points",
        target: 1,
        apiStat: 1,
        manualDelta: 0,
        subDetail: "1G, 0A • 2 SOG"
      },
      {
        id: "sennecke_pts",
        boyName: "Alex",
        playerName: "Beckett Sennecke",
        team: "ANA",
        marketLabel: "1+ Points",
        statType: "points",
        target: 1,
        apiStat: 1,
        manualDelta: 0,
        subDetail: "0G, 1A • 1 SOG"
      },
      {
        id: "carlsson_pts",
        boyName: "Ben",
        playerName: "Leo Carlsson",
        team: "ANA",
        marketLabel: "1+ Points",
        statType: "points",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 1 SOG"
      }
    ]
  }
];

const DEFAULT_OCT30_SLATE = [
  {
    gameId: "WPG_FLA",
    title: "SAME GAME PARLAY (+582)",
    odds: "6.82",
    awayTeam: "WPG",
    awayName: "WPG Jets",
    homeTeam: "FLA",
    homeName: "FLA Panthers",
    startTime: "Fri Oct 30 • 7:00 PM",
    gameStateText: "Scheduled • 7:00 PM",
    legs: [
      {
        id: "verhaeghe_pts",
        boyName: "Axel",
        playerName: "Carter Verhaeghe",
        team: "FLA",
        odds: "-160",
        marketLabel: "Over 0.5 Total Points (-160)",
        statType: "points",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      },
      {
        id: "bennett_sog",
        boyName: "Jackson",
        playerName: "Sam Bennett",
        team: "FLA",
        odds: "-105",
        marketLabel: "Over 2.5 Shots on Goal (-105)",
        statType: "shots",
        target: 3,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      },
      {
        id: "jones_sog",
        boyName: "Alex",
        playerName: "Seth Jones",
        team: "FLA",
        odds: "+115",
        marketLabel: "Over 2.5 Shots on Goal (+115)",
        statType: "shots",
        target: 3,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      }
    ]
  },
  {
    gameId: "SEA_CGY",
    title: "SAME GAME PARLAY (+858)",
    odds: "9.58",
    awayTeam: "SEA",
    awayName: "SEA Kraken",
    homeTeam: "CGY",
    homeName: "CGY Flames",
    startTime: "Fri Oct 30 • 8:00 PM",
    gameStateText: "Scheduled • 8:00 PM",
    legs: [
      {
        id: "mcmann_pts",
        boyName: "Ben",
        playerName: "Bobby McMann",
        team: "SEA",
        odds: "-120",
        marketLabel: "Over 0.5 Total Points (-120)",
        statType: "points",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      },
      {
        id: "stephenson_ast",
        boyName: "Will",
        playerName: "Chandler Stephenson",
        team: "SEA",
        odds: "+155",
        marketLabel: "Over 0.5 Total Assists (+155)",
        statType: "assists",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      },
      {
        id: "montour_pts",
        boyName: "Edward",
        playerName: "Brandon Montour",
        team: "SEA",
        odds: "+105",
        marketLabel: "Over 0.5 Total Points (+105)",
        statType: "points",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      }
    ]
  }
];

function getSlateForDate(dateStr) {
  if (dateStr === '2026-10-16') {
    return JSON.parse(JSON.stringify(DEFAULT_OCT16_SLATE));
  }
  if (dateStr === '2026-10-23') {
    return JSON.parse(JSON.stringify(DEFAULT_OCT23_SLATE));
  }
  if (dateStr === '2026-10-30') {
    return JSON.parse(JSON.stringify(DEFAULT_OCT30_SLATE));
  }
  return JSON.parse(JSON.stringify(DEFAULT_OCT30_SLATE));
}

const KNOWN_OCT30_PLAYERS = {
  Axel: { name: 'Carter Verhaeghe', target: 1, type: 'points', odds: '-160', label: 'Over 0.5 Total Points (-160)' },
  Jackson: { name: 'Sam Bennett', target: 3, type: 'shots', odds: '-105', label: 'Over 2.5 Shots on Goal (-105)' },
  Alex: { name: 'Seth Jones', target: 3, type: 'shots', odds: '+115', label: 'Over 2.5 Shots on Goal (+115)' },
  Ben: { name: 'Bobby McMann', target: 1, type: 'points', odds: '-120', label: 'Over 0.5 Total Points (-120)' },
  Will: { name: 'Chandler Stephenson', target: 1, type: 'assists', odds: '+155', label: 'Over 0.5 Total Assists (+155)' },
  Edward: { name: 'Brandon Montour', target: 1, type: 'points', odds: '+105', label: 'Over 0.5 Total Points (+105)' }
};

const KNOWN_OCT23_PLAYERS = {
  Edward: { name: 'Cole Caufield', target: 4, type: 'shots', label: 'Over 3.5 Shots on Goal' },
  Will: { name: 'Juraj Slafkovsky', target: 1, type: 'points', label: 'Over 0.5 Total Points' },
  Ben: { name: 'Lane Hutson', target: 2, type: 'shots', label: 'Over 1.5 Shots on Goal' },
  Jackson: { name: 'Nathan MacKinnon', target: 4, type: 'shots', label: 'Over 3.5 Shots on Goal' },
  Alex: { name: 'Nikita Kucherov', target: 1, type: 'goals', label: 'Over 0.5 Total Goals' },
  Axel: { name: 'Brandon Hagel', target: 1, type: 'points', label: 'Over 0.5 Total Points' }
};

function getUnitLabelForStat(statType) {
  switch (statType) {
    case 'saves': return 'SAVES';
    case 'shots': return 'SOG';
    case 'goals': return 'GOALS';
    case 'assists': return 'AST';
    case 'blocks': return 'BLK';
    case 'hits': return 'HITS';
    default: return 'PTS';
  }
}

// Convert any squad member's pick string into an NHL API-trackable leg
function parsePickIntoLeg(boyName, pickObj) {
  const pickText = (pickObj.pick_text || '').trim();
  const oddsStr = (pickObj.odds || '').trim();

  // If this is the active Oct 30 week and matches the official Oct 30 player, use known mapping
  if (state.currentFridayStr === '2026-10-30' && KNOWN_OCT30_PLAYERS[boyName]) {
    const known = KNOWN_OCT30_PLAYERS[boyName];
    if (!pickText || pickText.toLowerCase().includes(known.name.split(' ').slice(-1)[0].toLowerCase())) {
      return {
        id: `${boyName.toLowerCase()}_${known.type}_oct30`,
        boyName: boyName,
        playerName: known.name,
        odds: oddsStr || known.odds,
        marketLabel: known.label,
        statType: known.type,
        target: known.target,
        apiStat: 0,
        subDetail: '0G, 0A • 0 SOG'
      };
    }
  }

  // If this is the active Oct 23 week and matches the official Oct 23 player, use known mapping
  if (state.currentFridayStr === '2026-10-23' && KNOWN_OCT23_PLAYERS[boyName]) {
    const known = KNOWN_OCT23_PLAYERS[boyName];
    if (!pickText || pickText.toLowerCase().includes(known.name.split(' ').slice(-1)[0].toLowerCase()) || pickText.toLowerCase().startsWith('over ')) {
      return {
        id: `${boyName.toLowerCase()}_${known.type}_oct23`,
        boyName: boyName,
        playerName: known.name,
        odds: oddsStr,
        marketLabel: known.label,
        statType: known.type,
        target: known.target,
        apiStat: 0,
        subDetail: known.type === 'shots' ? '0 SOG • 0G, 0A' : (known.type === 'goals' ? '0G • 0A, 0 SOG' : '0G, 0A • 0 SOG')
      };
    }
  }

  let statType = 'points';
  let target = 1;
  let playerName = pickText;
  let marketLabel = 'Over 0.5 Total Points';

  const isSave = /\b(saves?|sv|goalie\s*saves?)\b/i.test(pickText);
  const isBlock = /\b(blocks?|blocked\s*shots?|blk)\b/i.test(pickText);
  const isHit = /\b(hits?)\b/i.test(pickText);
  const isShot = !isBlock && /\b(shots?\s*on\s*goal|shots?|sog)\b/i.test(pickText);
  const isAssist = /\b(assists?|ast)\b/i.test(pickText);
  const isGoal = !isShot && /\b(goals?|anytime\s*goal(?:scorer)?|atgs)\b/i.test(pickText);

  const overMatch = pickText.match(/(?:over|o)\s*(\d+(?:\.\d+)?)/i);
  const plusMatch = pickText.match(/(\d+)\+\s*(?:saves?|sv|shots?|sog|goals?|assists?|ast|points?|pts|blocks?|blk|hits?)/i);

  function extractTarget(defaultVal) {
    if (overMatch) {
      const val = parseFloat(overMatch[1]);
      return Math.floor(val) + 1;
    }
    if (plusMatch) {
      return Math.max(1, parseInt(plusMatch[1], 10));
    }
    return defaultVal;
  }

  if (isSave) {
    statType = 'saves';
    target = extractTarget(25);
    marketLabel = overMatch ? `Over ${overMatch[1]} Goalie Saves` : `${target}+ Goalie Saves`;
  } else if (isBlock) {
    statType = 'blocks';
    target = extractTarget(2);
    marketLabel = overMatch ? `Over ${overMatch[1]} Blocked Shots` : `${target}+ Blocked Shots`;
  } else if (isHit) {
    statType = 'hits';
    target = extractTarget(3);
    marketLabel = overMatch ? `Over ${overMatch[1]} Hits` : `${target}+ Hits`;
  } else if (isShot) {
    statType = 'shots';
    target = extractTarget(3);
    marketLabel = overMatch ? `Over ${overMatch[1]} Shots on Goal` : `${target}+ Shots on Goal`;
  } else if (isAssist) {
    statType = 'assists';
    target = extractTarget(1);
    marketLabel = overMatch ? `Over ${overMatch[1]} Total Assists` : (target === 1 ? 'Over 0.5 Total Assists' : `${target}+ Total Assists`);
  } else if (isGoal) {
    statType = 'goals';
    target = extractTarget(1);
    marketLabel = overMatch ? `Over ${overMatch[1]} Total Goals` : (target === 1 ? 'Over 0.5 Total Goals' : `${target}+ Total Goals`);
  } else {
    statType = 'points';
    target = extractTarget(1);
    marketLabel = overMatch ? `Over ${overMatch[1]} Total Points` : (target === 1 ? 'Over 0.5 Total Points' : `${target}+ Total Points`);
  }

  if (oddsStr) {
    marketLabel = `${marketLabel} (${oddsStr})`;
  }

  // Clean player name from market descriptors
  playerName = pickText
    .replace(/^[•©@*\-\s]+/, '')
    .replace(/\s*[—\-–]\s*(?:points?|shots?(?:\s*on\s*goal)?|sog|goals?|assists?|saves?|blocks?|blocked\s*shots?|hits?|over|under|\d+\+|anytime).*/i, '')
    .replace(/\s+(?:over|under)\s+\d+(?:\.\d+)?.*/i, '')
    .replace(/\s+\d+\+\s*(?:points?|pts|shots?|sog|goals?|assists?|ast|saves?|sv|blocks?|blk|hits?).*/i, '')
    .replace(/\s+anytime\s*goal.*/i, '')
    .replace(/\s*@\s*[+-]\d+.*/i, '')
    .replace(/\s*\([+-]\d+\)\s*$/, '')
    .trim();

  if (!playerName || playerName === pickText) {
    const splitMatch = pickText.match(/^([A-Za-z\s.'-]+?)\s+(?:[—\-–]\s*)?(?:over|under|\d+)/i);
    if (splitMatch) {
      playerName = splitMatch[1].trim();
    }
  }

  const id = `${boyName.toLowerCase()}_${statType}_${Date.now() % 10000}`;
  const defaultSubDetail = statType === 'saves'
    ? '0 SV • 0 SA, 0 GA'
    : (statType === 'blocks' ? '0 BLK • 0G, 0A' : (statType === 'hits' ? '0 HITS • 0G, 0A' : '0G, 0A • 0 SOG'));

  return {
    id: id,
    boyName: boyName,
    playerName: playerName || pickText,
    odds: oddsStr,
    marketLabel: marketLabel,
    statType: statType,
    target: target,
    apiStat: 0,
    subDetail: defaultSubDetail
  };
}

// Synchronize live tracker game blocks with the boys' real picks on the Bet Slip
function syncTrackerFromRealPicks() {
  if (state.currentFridayStr === '2026-10-16') {
    state.trackerData = getSlateForDate('2026-10-16');
    saveTrackerData();
    return;
  }

  let slate = getSlateForDate(state.currentFridayStr);
  const boysWithPicks = Object.keys(state.legs || {});

  if (boysWithPicks.length === 0) {
    state.trackerData = slate;
    saveTrackerData();
    return;
  }

  // Preserve any existing live apiStat / gameStateText / gameStatus if already synced
  const prevGamesMap = {};
  const prevLegsMap = {};
  (state.trackerData || []).forEach(g => {
    prevGamesMap[g.gameId] = { gameStateText: g.gameStateText, gameStatus: g.gameStatus };
    (g.legs || []).forEach(l => {
      prevLegsMap[l.boyName] = { apiStat: l.apiStat, subDetail: l.subDetail };
    });
  });

  // Check if this is a future/custom week where picks belong to games outside the default slate
  const isKnownWeek = state.currentFridayStr === '2026-10-23' || state.currentFridayStr === '2026-10-30';
  if (!isKnownWeek) {
    const groupedGames = {};
    SQUAD.forEach(boy => {
      const realPick = state.legs[boy.name];
      if (!realPick || !realPick.pick_text) return;
      const rawGame = realPick.game_title || realPick.game || 'NHL Matchup';
      if (!groupedGames[rawGame]) {
        const parts = rawGame.split('@').map(s => s.trim());
        const awayTokens = (parts[0] || 'AWAY').split(/\s+/);
        const homeTokens = (parts[1] || 'HOME').split(/\s+/);
        const awayTeam = normalizeTeamAbbr(awayTokens[0] || 'AWAY');
        const homeTeam = normalizeTeamAbbr(homeTokens[0] || 'HOME');
        const gameKey = `${awayTeam}_${homeTeam}`;
        groupedGames[rawGame] = {
          gameId: gameKey,
          awayTeam: awayTeam,
          homeTeam: homeTeam,
          awayName: parts[0] || awayTeam,
          homeName: parts[1] || homeTeam,
          startTime: `Friday, ${state.currentFridayStr}`,
          gameStateText: prevGamesMap[gameKey]?.gameStateText || 'Scheduled',
          gameStatus: prevGamesMap[gameKey]?.gameStatus || 'pre',
          odds: 'SGP',
          legs: []
        };
      }
      const parsed = parsePickIntoLeg(boy.name, realPick);
      const prev = prevLegsMap[boy.name];
      if (prev && prev.apiStat) parsed.apiStat = prev.apiStat;
      if (prev && prev.subDetail) parsed.subDetail = prev.subDetail;
      groupedGames[rawGame].legs.push(parsed);
    });
    const dynamicSlate = Object.values(groupedGames);
    if (dynamicSlate.length > 0) {
      state.trackerData = dynamicSlate;
      saveTrackerData();
      return;
    }
  }

  slate.forEach(game => {
    if (prevGamesMap[game.gameId]) {
      game.gameStateText = prevGamesMap[game.gameId].gameStateText;
      game.gameStatus = prevGamesMap[game.gameId].gameStatus;
    }
    game.legs.forEach(leg => {
      const realPick = state.legs[leg.boyName];
      if (realPick && realPick.pick_text) {
        const parsed = parsePickIntoLeg(leg.boyName, realPick);
        leg.playerName = parsed.playerName || leg.playerName;
        leg.statType = parsed.statType || leg.statType;
        leg.target = parsed.target || leg.target;
        leg.marketLabel = parsed.marketLabel || leg.marketLabel;
        leg.odds = realPick.odds || leg.odds;
        const prev = prevLegsMap[leg.boyName];
        leg.apiStat = prev && prev.apiStat ? prev.apiStat : 0;
        leg.subDetail = prev && prev.subDetail ? prev.subDetail : parsed.subDetail;
      }
    });
  });

  state.trackerData = slate;
  saveTrackerData();
}

// Initialize Tracker Data from LocalStorage or Default (Purely NHL API Data-Driven)
const TRACKER_STORAGE_KEY = "b365_sgp_tracker_data_v5";

function initTrackerData() {
  const currentKey = `${TRACKER_STORAGE_KEY}_${state.currentFridayStr}`;
  const saved = localStorage.getItem(currentKey);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.trackerData = parsed;
      } else {
        state.trackerData = getSlateForDate(state.currentFridayStr);
      }
    } catch (e) {
      state.trackerData = getSlateForDate(state.currentFridayStr);
    }
  } else {
    state.trackerData = getSlateForDate(state.currentFridayStr);
  }

  if (state.isPlaced) {
    syncTrackerFromRealPicks();
  }
}

function saveTrackerData() {
  const currentKey = `${TRACKER_STORAGE_KEY}_${state.currentFridayStr}`;
  localStorage.setItem(currentKey, JSON.stringify(state.trackerData));
}

function loadAragonDemoSlate() {
  state.trackerData = getSlateForDate(state.currentFridayStr);
  saveTrackerData();
  renderTracker();
  fetchAllLiveStats(true);
  showToast(`Loaded ${state.currentFridayStr} 6-Leg Slate!`, "puck");
}

// =============================================================================
// 7. SQUAD STATS & LEADERBOARD HISTORICAL ENGINE
// =============================================================================
const STATS_STORAGE_KEY = "bts_squad_stats_history_v8";

const DEFAULT_STATS_HISTORY = [
  {
    weekNum: 1,
    dateStr: '2026-10-16',
    bettor: 'Axel',
    stake: 25,
    totalOdds: '+950',
    result: 'loss', // 4 of 5 hit!
    notes: 'Axel placed from the States while Jackson was away. 4 of 5 legs hit — Ben missed on Leo Carlsson and sold the parlay! (Edward joined the squad in Week 2)',
    legs: [
      { boy: 'Axel', pick: 'Brock Nelson 1+ Points', odds: '-140', result: 'hit' },
      { boy: 'Jackson', pick: 'Nathan MacKinnon 4+ SOG', odds: '-130', result: 'hit' },
      { boy: 'Will', pick: 'Pavel Zacha 1+ Points', odds: '+120', result: 'hit' },
      { boy: 'Alex', pick: 'Beckett Sennecke 1+ Points', odds: '+110', result: 'hit' },
      { boy: 'Ben', pick: 'Leo Carlsson 1+ Points', odds: '-115', result: 'miss' }
    ]
  },
  {
    weekNum: 2,
    dateStr: '2026-10-23',
    bettor: 'Jackson',
    stake: 30,
    totalOdds: '+1261',
    result: 'loss',
    notes: 'Jackson placed on FanDuel ($30 SGP+ at +1261). 3 of 6 legs hit — Edward (Caufield 4 SOG), Jackson (MacKinnon 4 SOG, 4 PTS), and Axel (Hagel 1 PT) cashed, while Will (Slafkovsky 0 PTS), Ben (Hutson 0 SOG), and Alex (Kucherov 0 G) missed.',
    legs: [
      { boy: 'Axel', pick: 'Brandon Hagel Over 0.5 Total Points', odds: '-175', result: 'hit' },
      { boy: 'Jackson', pick: 'Nathan MacKinnon Over 3.5 Total Shots On Goal', odds: '-145', result: 'hit' },
      { boy: 'Will', pick: 'Juraj Slafkovsky Over 0.5 Total Points', odds: '-175', result: 'miss' },
      { boy: 'Alex', pick: 'Nikita Kucherov Over 0.5 Total Goals', odds: '+170', result: 'miss' },
      { boy: 'Ben', pick: 'Lane Hutson Over 1.5 Total Shots On Goal', odds: '-130', result: 'miss' },
      { boy: 'Edward', pick: 'Cole Caufield Over 3.5 Shots on Goal', odds: '-145', result: 'hit' }
    ]
  },
  {
    weekNum: 3,
    dateStr: '2026-10-30',
    bettor: 'Will',
    stake: 30,
    totalOdds: '+2394',
    result: 'pending',
    notes: 'Will placed on BET99 ($30 SGP+ at +2394 for $748.20 return). WPG @ FLA + SEA @ CGY live tracking active!',
    legs: [
      { boy: 'Axel', pick: 'Carter Verhaeghe — Over 0.5 Points', odds: '-160', result: 'pending' },
      { boy: 'Jackson', pick: 'Sam Bennett — Over 2.5 Shots on Goal', odds: '-105', result: 'pending' },
      { boy: 'Will', pick: 'Chandler Stephenson — Over 0.5 Assists', odds: '+155', result: 'pending' },
      { boy: 'Alex', pick: 'Seth Jones — Over 2.5 Shots on Goal', odds: '+115', result: 'pending' },
      { boy: 'Ben', pick: 'Bobby McMann — Over 0.5 Points', odds: '-120', result: 'pending' },
      { boy: 'Edward', pick: 'Brandon Montour — Over 0.5 Points', odds: '+105', result: 'pending' }
    ]
  }
];

function initStatsHistory() {
  const saved = localStorage.getItem(STATS_STORAGE_KEY);
  if (saved) {
    try {
      state.statsHistory = JSON.parse(saved);
      return;
    } catch (e) {}
  }
  state.statsHistory = JSON.parse(JSON.stringify(DEFAULT_STATS_HISTORY));
  saveStatsHistory();
}

function saveStatsHistory() {
  localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(state.statsHistory));
}

function resetStatsHistory() {
  if (confirm("Reset squad stats to official season baseline?")) {
    state.statsHistory = JSON.parse(JSON.stringify(DEFAULT_STATS_HISTORY));
    saveStatsHistory();
    renderStatsView();
    renderSquadLegs();
    showToast("Stats reset to baseline", "stats");
  }
}

function toggleLegResult(weekIndex, legIndex, targetResult) {
  const week = state.statsHistory[weekIndex];
  if (!week || !week.legs[legIndex]) return;

  week.legs[legIndex].result = targetResult;

  // Auto-evaluate week result
  const hits = week.legs.filter(l => l.result === 'hit').length;
  const misses = week.legs.filter(l => l.result === 'miss').length;
  const pending = week.legs.filter(l => l.result === 'pending').length;

  if (pending > 0) {
    week.result = 'pending';
  } else if (misses > 0) {
    week.result = 'loss';
  } else {
    week.result = 'win';
  }

  saveStatsHistory();
  renderStatsView();
  renderSquadLegs();
  playSound('lock');

  if (week.result === 'win') {
    if (window.confetti) confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
    playSound('triumph');
    showToast(`Week ${week.weekNum} Ticket Cashed! All legs hit!`, 'trophy');
  }
}

// Bespoke Dynamic Accolade Resolver for Players
function resolvePlayerAccolade(p, ctx) {
  // If player hasn't placed any settled bets yet (Edward in W1)
  if (p.total === 0) {
    return {
      title: 'Squad Debut',
      pillClass: 'debut',
      icon: 'spark',
      statTag: '0-0 (Debut)',
      blurb: 'New 6th man joining the $30 pool',
      statClass: 'debut'
    };
  }

  // Active winning streak >= 2
  if (p.streakType === 'W' && p.streak >= 2) {
    return {
      title: `Heater (W${p.streak})`,
      pillClass: 'hot',
      icon: 'fire',
      statTag: `${p.hits}-${p.misses} (${p.rate}%)`,
      blurb: `${p.streak} straight legs cashed! Running hot`,
      statClass: 'hit'
    };
  }

  // Active losing streak >= 2
  if (p.streakType === 'L' && p.streak >= 2) {
    return {
      title: `Cold Streak (L${p.streak})`,
      pillClass: 'slump',
      icon: 'frost',
      statTag: `${p.hits}-${p.misses} (${p.rate}%)`,
      blurb: 'Due for positive regression — bounce-back time',
      statClass: 'miss'
    };
  }

  // If 1-0 or undefeated
  if (p.hits > 0 && p.misses === 0) {
    // Highest odds hit (+120 Will)
    if (ctx.topOddsWinner && ctx.topOddsWinner.name === p.name && p.maxWinningOdds > 2.0) {
      return {
        title: 'Top Value (+120)',
        pillClass: 'value',
        icon: 'cash',
        statTag: `${p.hits}-${p.misses} (100%)`,
        blurb: 'Hit Zacha (+120) • Season High Odds Win',
        statClass: 'hit'
      };
    }
    // Plus-money hit (+110 Alex)
    if (p.maxWinningOdds > 2.0) {
      return {
        title: 'Plus-Money (+110)',
        pillClass: 'value',
        icon: 'bolt',
        statTag: `${p.hits}-${p.misses} (100%)`,
        blurb: 'Hit Sennecke (+110) • Plus-Money Club',
        statClass: 'hit'
      };
    }
    // Bettor on deck (Jackson)
    if (p.isBettorOnDeck) {
      return {
        title: 'On Target',
        pillClass: 'sniper',
        icon: 'crown',
        statTag: `${p.hits}-${p.misses} (100%)`,
        blurb: `Hit MacKinnon SOG (-130) • On Deck W${ctx.currentWeekNum}`,
        statClass: 'hit'
      };
    }
    // Lowest avg odds / Anchor (Axel)
    if (ctx.anchorWinner && ctx.anchorWinner.name === p.name) {
      return {
        title: 'Puck Anchor',
        pillClass: 'chalk',
        icon: 'shield',
        statTag: `${p.hits}-${p.misses} (100%)`,
        blurb: 'Hit Nelson (-140) • Placed W1',
        statClass: 'hit'
      };
    }
    return {
      title: 'Undefeated',
      pillClass: 'sniper',
      icon: 'sniper',
      statTag: `${p.hits}-${p.misses} (100%)`,
      blurb: 'Perfect 1/1 legs cashed this season',
      statClass: 'hit'
    };
  }

  // 0 hits, 1 miss (Ben)
  if (p.hits === 0 && p.misses > 0) {
    return {
      title: 'Revenge Arc',
      pillClass: 'slump',
      icon: 'frost',
      statTag: `${p.hits}-${p.misses} (0%)`,
      blurb: `Sold W1 on Carlsson • Primed for W${ctx.currentWeekNum} revenge`,
      statClass: 'miss'
    };
  }

  // Redeemed after loss
  if (p.streakType === 'W' && p.streak === 1 && p.misses > 0) {
    return {
      title: 'Bounce-Back (W1)',
      pillClass: 'hot',
      icon: 'checkCircle',
      statTag: `${p.hits}-${p.misses} (${p.rate}%)`,
      blurb: 'Bounced back with a hit! Turning it around',
      statClass: 'hit'
    };
  }

  // Winning record
  if (p.rate >= 60) {
    return {
      title: `Sharpshooter (${p.rate}%)`,
      pillClass: 'sniper',
      icon: 'sniper',
      statTag: `${p.hits}-${p.misses} (${p.rate}%)`,
      blurb: `${p.hits} hits across ${p.total} weeks`,
      statClass: 'hit'
    };
  }

  // Default Contender
  return {
    title: 'Contender',
    pillClass: 'contender',
    icon: 'puck',
    statTag: `${p.hits}-${p.misses} (${p.rate}%)`,
    blurb: `${p.streakType}${p.streak} form • ${p.avgAmerican} avg odds`,
    statClass: p.rate >= 50 ? 'hit' : 'miss'
  };
}

// Compute All Squad Analytics
function computeSquadAnalytics() {
  const playerStats = {};
  SQUAD.forEach(boy => {
    playerStats[boy.name] = {
      name: boy.name,
      initials: boy.initials,
      color: boy.color,
      total: 0,
      hits: 0,
      misses: 0,
      pending: 0,
      streak: 0,
      streakType: '',
      oddsList: [],
      maxWinningOdds: 0,
      maxWinningOddsStr: '--',
      lastMissedPick: '',
      parlaysSold: 0,
      plusMoneyHits: 0
    };
  });

  // Iterate chronologically through all weeks
  const sortedWeeks = [...state.statsHistory].sort((a, b) => a.weekNum - b.weekNum);

  sortedWeeks.forEach(w => {
    w.legs.forEach(leg => {
      const p = playerStats[leg.boy];
      if (!p) return;

      const dec = americanToDecimal(leg.odds);

      if (leg.result === 'hit') {
        p.total++;
        p.hits++;
        p.oddsList.push(dec);
        if (dec > 2.0) {
          p.plusMoneyHits++;
        }
        if (dec > p.maxWinningOdds) {
          p.maxWinningOdds = dec;
          p.maxWinningOddsStr = `${leg.odds} (${leg.pick})`;
        }
        if (p.streakType === 'W') {
          p.streak++;
        } else {
          p.streakType = 'W';
          p.streak = 1;
        }
      } else if (leg.result === 'miss') {
        p.total++;
        p.misses++;
        p.oddsList.push(dec);
        p.lastMissedPick = `W${w.weekNum} (${leg.pick})`;
        if (w.result === 'loss') {
          p.parlaysSold++;
        }
        if (p.streakType === 'L') {
          p.streak++;
        } else {
          p.streakType = 'L';
          p.streak = 1;
        }
      } else {
        p.pending++;
      }
    });
  });

  const targetFri = state.currentFriday || getActiveFridayDate();
  const bettorThisWeek = getBettorForFriday(targetFri);
  const currentWeekNum = getFridayDiffWeeks(targetFri) + 1;

  // Calculate percentages and averages
  const list = Object.values(playerStats).map(p => {
    const rate = p.total > 0 ? Math.round((p.hits / p.total) * 100) : 0;
    const avgDec = p.oddsList.length > 0 ? (p.oddsList.reduce((a, b) => a + b, 0) / p.oddsList.length) : 1.8;
    const avgAmerican = decimalToAmerican(avgDec);
    const isBettorOnDeck = (p.name === bettorThisWeek.name);
    return {
      ...p,
      rate,
      avgDec,
      avgAmerican,
      isBettorOnDeck
    };
  });

  // Rank by win rate descending, then hits descending, misses ascending
  list.sort((a, b) => {
    if (a.total === 0 && b.total > 0) return 1;
    if (b.total === 0 && a.total > 0) return -1;
    if (b.rate !== a.rate) return b.rate - a.rate;
    if (b.hits !== a.hits) return b.hits - a.hits;
    return a.misses - b.misses;
  });

  // 1. Sharpshooters (Tie-aware calculation)
  const qualifiedHitters = [...list].filter(p => p.hits > 0);
  let sharpshooters = {
    names: 'TBD',
    stat: '--',
    note: 'Awaiting settled legs.',
    isTie: false,
    list: []
  };

  if (qualifiedHitters.length > 0) {
    const topRate = qualifiedHitters[0].rate;
    const topHits = qualifiedHitters[0].hits;
    const tied = qualifiedHitters.filter(p => p.rate === topRate && p.hits === topHits);
    if (tied.length > 1) {
      const namesStr = tied.length === 2 
        ? `${tied[0].name} & ${tied[1].name}`
        : `${tied.slice(0, -1).map(p => p.name).join(', ')} & ${tied[tied.length - 1].name}`;
      sharpshooters = {
        names: namesStr,
        stat: `${topRate}% Hit Rate (${topHits}-${tied[0].misses} Each)`,
        note: `${tied.length}-way tie for the squad lead — all ${tied.length} boys cashed their legs!`,
        isTie: true,
        list: tied
      };
    } else {
      const leader = tied[0];
      sharpshooters = {
        names: leader.name,
        stat: `${leader.rate}% Hit Rate (${leader.hits}/${leader.total} Hits)`,
        note: `Sole leader in squad accuracy with a ${leader.streakType}${leader.streak} streak.`,
        isTie: false,
        list: [leader]
      };
    }
  }

  // 2. Top Odds Cashed (Highest maxWinningOdds)
  const oddsSorted = [...list].filter(p => p.maxWinningOdds > 0).sort((a, b) => b.maxWinningOdds - a.maxWinningOdds);
  const topOddsWinner = oddsSorted[0] || null;
  const topOddsData = topOddsWinner ? {
    name: topOddsWinner.name,
    stat: `${topOddsWinner.maxWinningOddsStr} Cashed`,
    note: `Highest plus-money payout cashed on a pool ticket this season.`
  } : {
    name: 'TBD',
    stat: '--',
    note: 'No winning bets cashed yet.'
  };

  // 3. The Hot Seat / Revenge Arc (Most misses)
  const slumpSorted = [...list].filter(p => p.misses > 0).sort((a, b) => b.misses - a.misses || a.rate - b.rate);
  const hotSeatWinner = slumpSorted[0] || null;
  const hotSeatData = hotSeatWinner ? {
    name: hotSeatWinner.name,
    stat: `${hotSeatWinner.misses} Miss${hotSeatWinner.misses === 1 ? '' : 'es'} (${hotSeatWinner.hits}-${hotSeatWinner.misses} • ${hotSeatWinner.streakType}${hotSeatWinner.streak})`,
    note: `Last missed ${hotSeatWinner.lastMissedPick || 'a leg'} — locked in for a bounce-back in Week ${currentWeekNum}!`
  } : {
    name: 'Nobody (Clean Sheet)',
    stat: '0 Misses Recorded',
    note: 'The squad is undefeated so far!'
  };

  // 4. The Puck Anchor (Lowest average odds among active bettors)
  const chalkSorted = [...list].filter(p => p.total > 0).sort((a, b) => a.avgDec - b.avgDec);
  const anchorWinner = chalkSorted[0] || null;
  const anchorData = anchorWinner ? {
    name: anchorWinner.name,
    stat: `${anchorWinner.avgAmerican} Avg Odds`,
    note: `Builds the ticket floor with steady high-probability favorites.`
  } : {
    name: 'TBD',
    stat: '--',
    note: 'Awaiting locked legs.'
  };

  // Attach bespoke dynamic accolade to each player
  list.forEach(p => {
    p.accolade = resolvePlayerAccolade(p, {
      topOddsWinner,
      anchorWinner,
      hotSeatWinner,
      sharpshooters,
      currentWeekNum
    });
  });

  // Parlay totals (settled weeks only)
  const settledWeeks = sortedWeeks.filter(w => w.result === 'win' || w.result === 'loss');
  const totalParlays = settledWeeks.length;
  const wonParlays = settledWeeks.filter(w => w.result === 'win').length;
  const lostParlays = settledWeeks.filter(w => w.result === 'loss').length;
  const parlayWinRate = totalParlays > 0 ? ((wonParlays / totalParlays) * 100).toFixed(1) : "0.0";
  const parlayRecordStr = `${wonParlays} / ${totalParlays} Parlays`;

  // Pick totals (settled legs only)
  let totalWagered = settledWeeks.reduce((acc, w) => acc + (w.stake || 25), 0);
  if (totalWagered === 0) totalWagered = 25;
  let totalLegsCount = list.reduce((acc, p) => acc + p.total, 0);
  let totalHitsCount = list.reduce((acc, p) => acc + p.hits, 0);
  let pickWinRate = totalLegsCount > 0 ? ((totalHitsCount / totalLegsCount) * 100).toFixed(1) : "0.0";
  let pickRecordStr = `${totalHitsCount} / ${totalLegsCount} Legs Hit`;

  return {
    players: list,
    sharpshooters,
    topOddsData,
    hotSeatData,
    anchorData,
    totalWagered,
    totalLegsCount,
    totalHitsCount,
    pickWinRate,
    pickRecordStr,
    totalParlays,
    wonParlays,
    lostParlays,
    parlayWinRate,
    parlayRecordStr,
    currentWeekNum
  };
}

function renderStatsView() {
  const data = computeSquadAnalytics();

  // Hero numbers
  DOM.statsTotalWagered.textContent = `$${data.totalWagered.toFixed(2)}`;
  DOM.statsTotalLegs.textContent = data.totalLegsCount;
  DOM.statsSquadWinRate.textContent = `${data.pickWinRate}%`;
  if (DOM.statsPickRecord) DOM.statsPickRecord.textContent = data.pickRecordStr;
  if (DOM.statsParlayWinRate) {
    DOM.statsParlayWinRate.textContent = `${data.parlayWinRate}%`;
    DOM.statsParlayWinRate.className = `meta-val ${data.wonParlays > 0 ? 'b365-green' : 'red'}`;
  }
  if (DOM.statsParlayRecord) {
    DOM.statsParlayRecord.textContent = `${data.wonParlays} / ${data.totalParlays} Parlays`;
  }
  const settledSubEl = document.getElementById('statsSettledSub');
  const wageredSubEl = document.getElementById('statsWageredSub');
  const weeksLabel = data.totalParlays > 1 ? `Weeks 1–${data.totalParlays}` : 'Week 1';
  if (settledSubEl) settledSubEl.textContent = `${weeksLabel} Locked`;
  if (wageredSubEl) wageredSubEl.textContent = `${weeksLabel} Pool`;

  // Trophies
  // 1. Sharpshooters
  if (DOM.trophySniperName) DOM.trophySniperName.textContent = data.sharpshooters.names;
  if (DOM.trophySniperStat) DOM.trophySniperStat.textContent = data.sharpshooters.stat;
  if (DOM.trophySniperLabel) DOM.trophySniperLabel.textContent = data.sharpshooters.isTie ? 'THE SHARPSHOOTERS' : 'THE SNIPER';
  if (DOM.trophySniperNote) DOM.trophySniperNote.textContent = data.sharpshooters.note;

  // 2. The Hot Seat
  if (DOM.trophySlumpName) DOM.trophySlumpName.textContent = data.hotSeatData.name;
  if (DOM.trophySlumpStat) DOM.trophySlumpStat.textContent = data.hotSeatData.stat;
  if (DOM.trophySlumpLabel) DOM.trophySlumpLabel.textContent = 'THE HOT SEAT';
  if (DOM.trophySlumpNote) DOM.trophySlumpNote.textContent = data.hotSeatData.note;

  // 3. Top Odds Cashed
  if (DOM.trophyLongshotName) DOM.trophyLongshotName.textContent = data.topOddsData.name;
  if (DOM.trophyLongshotStat) DOM.trophyLongshotStat.textContent = data.topOddsData.stat;
  if (DOM.trophyLongshotLabel) DOM.trophyLongshotLabel.textContent = 'TOP ODDS CASHED';
  if (DOM.trophyLongshotNote) DOM.trophyLongshotNote.textContent = data.topOddsData.note;

  // 4. The Puck Anchor
  if (DOM.trophyChalkName) DOM.trophyChalkName.textContent = data.anchorData.name;
  if (DOM.trophyChalkStat) DOM.trophyChalkStat.textContent = data.anchorData.stat;
  if (DOM.trophyChalkLabel) DOM.trophyChalkLabel.textContent = 'THE PUCK ANCHOR';
  if (DOM.trophyChalkNote) DOM.trophyChalkNote.textContent = data.anchorData.note;

  // 0. Squad Member Profile Strip (Click any guy's name to view his full betting profile)
  const profilesStrip = document.getElementById('squadProfilesStrip');
  if (profilesStrip) {
    profilesStrip.innerHTML = data.players.map(p => {
      const isDebut = p.total === 0;
      const winRateStr = isDebut ? 'Debut' : `${p.rate}% (${p.hits}-${p.misses})`;
      const avgOddsStr = isDebut ? '--' : `Avg ${p.avgAmerican}`;
      return `
        <div class="squad-profile-chip" onclick="openPlayerProfile('${p.name}')" title="View ${p.name}'s Full Betting Profile">
          <div class="spc-avatar">${p.initials}</div>
          <div class="spc-info">
            <div class="spc-name">${p.name} <span>↗</span></div>
            <div class="spc-meta">${winRateStr} • ${avgOddsStr}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Leaderboard table (with tie-aware rank display)
  let currentRank = 1;
  DOM.leaderboardTbody.innerHTML = data.players.map((p, idx) => {
    const isDebut = p.total === 0;
    if (idx > 0 && !isDebut) {
      const prev = data.players[idx - 1];
      if (prev.rate !== p.rate || prev.hits !== p.hits || prev.misses !== p.misses) {
        currentRank = idx + 1;
      }
    }
    const isTie = !isDebut && data.players.filter(other => other.total > 0 && other.rate === p.rate && other.hits === p.hits && other.misses === p.misses).length > 1;
    const rankText = isDebut ? '--' : (isTie ? `#${currentRank} TIE` : `#${currentRank}`);
    const rankClass = currentRank === 1 ? 'rank-1' : (currentRank === 2 ? 'rank-2' : (currentRank === 3 ? 'rank-3' : ''));
    const rankBadge = isDebut ? '<span class="rank-badge" style="opacity:0.4;">--</span>' : `<span class="rank-badge ${rankClass}">${rankText}</span>`;

    const titlePill = `<span class="title-tag-pill ${p.accolade.pillClass}">${getIcon(p.accolade.icon)} ${p.accolade.title}</span>`;
    const streakDisplay = isDebut ? '--' : (p.streak > 0 ? `${p.streakType}${p.streak}` : '--');

    return `
      <tr>
        <td>${rankBadge}</td>
        <td>
          <div class="table-player-cell clickable" onclick="openPlayerProfile('${p.name}')" title="Click to open ${p.name}'s full betting profile">
            <div class="player-avatar-small">${p.initials}</div>
            <span class="player-name-link">${p.name}</span>
          </div>
        </td>
        <td>
          <div class="hit-rate-cell">
            ${isDebut ? '<span class="rate-num" style="font-size:0.75rem; color:var(--text-secondary);">Debut W2</span>' : `
              <span class="rate-num">${p.rate}%</span>
              <div class="rate-bar-track">
                <div class="rate-bar-fill" style="width: ${p.rate}%"></div>
              </div>
            `}
          </div>
        </td>
        <td class="font-mono font-bold">${isDebut ? '0-0' : `${p.hits}-${p.misses}`}</td>
        <td class="b365-green font-mono font-bold">${p.hits}</td>
        <td class="text-red-400 font-mono font-bold">${p.misses}</td>
        <td class="font-mono font-bold">${streakDisplay}</td>
        <td class="font-mono text-zinc-300">${isDebut ? '--' : p.avgAmerican}</td>
        <td>${titlePill}</td>
      </tr>
    `;
  }).join('');

  // Weekly History logs
  DOM.historyWeeksContainer.innerHTML = state.statsHistory.map((week, wIdx) => {
    const hitsCount = week.legs.filter(l => l.result === 'hit').length;
    const totalLegs = week.legs.length;
    const isWin = week.result === 'win';
    const isLoss = week.result === 'loss';
    const statusText = isWin
      ? `${getIcon('checkCircle')} TICKET CASHED!`
      : (isLoss ? `PARLAY SOLD (${hitsCount}/${totalLegs} HITS)` : `IN PROGRESS (WEEK ${week.weekNum})`);
    const statusClass = isWin ? 'win' : (isLoss ? 'loss' : 'in-progress');

    return `
      <div class="history-week-card">
        <div class="history-week-header">
          <div>
            <span class="h-week-title">WEEK ${week.weekNum} • ${formatWeekDateStr(week.dateStr)}</span>
            <div class="h-bettor-badge">Bettor: <strong>${week.bettor}</strong> • $${week.stake}.00 Stake • Odds: ${week.totalOdds}</div>
          </div>
          <span class="h-result-badge ${statusClass}">${statusText}</span>
        </div>

        <div class="history-legs-grid">
          ${week.legs.map((leg, lIdx) => `
            <div class="history-leg-card">
              <div class="h-leg-top">
                <span class="h-leg-boy" style="cursor:pointer; text-decoration:underline; text-decoration-style:dotted;" onclick="openPlayerProfile('${leg.boy}')">${leg.boy}</span>
                <span class="h-leg-odds">${leg.odds}</span>
              </div>
              <div class="h-leg-pick">${escapeHTML(leg.pick)}</div>
              <div class="h-leg-toggle-row">
                <span class="text-[11px] text-zinc-400">Result:</span>
                <div class="leg-grade-toggle">
                  <button onclick="toggleLegResult(${wIdx}, ${lIdx}, 'hit')" class="grade-btn hit ${leg.result === 'hit' ? 'active' : ''}">${getIcon('check')} HIT</button>
                  <button onclick="toggleLegResult(${wIdx}, ${lIdx}, 'miss')" class="grade-btn miss ${leg.result === 'miss' ? 'active' : ''}">${getIcon('cross')} MISS</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// =============================================================================
// 7B. SQUAD MEMBER PROFILE MODAL & SEASON STATS EXPORT
// =============================================================================
function detectMarketFromPickText(pickText) {
  const lower = String(pickText || '').toLowerCase();
  if (lower.includes('save') || lower.includes(' sv')) return 'Goalie Saves';
  if (lower.includes('shot') || lower.includes('sog')) return 'Shots on Goal';
  if (lower.includes('assist')) return 'Assists';
  if (lower.includes('goal')) return 'Goals';
  if (lower.includes('block')) return 'Blocked Shots';
  if (lower.includes('hit')) return 'Hits';
  return 'Points';
}

window.openPlayerProfile = function(boyName) {
  const data = computeSquadAnalytics();
  const p = data.players.find(pl => pl.name === boyName);
  if (!p) return;

  const backdrop = document.getElementById('playerProfileModalBackdrop');
  const roleTag = document.getElementById('profileModalRoleTag');
  const modalName = document.getElementById('profileModalName');
  const body = document.getElementById('playerProfileModalBody');
  const closeBtn = document.getElementById('closeProfileModalBtn');
  if (!backdrop || !body) return;

  if (roleTag) roleTag.textContent = `${p.role || 'Squad Member'} • ${p.accolade.title}`;
  if (modalName) modalName.textContent = `${p.name}'s Betting Profile`;

  // Gather all historical + active picks for this squad member
  const allPicks = [];
  const sortedWeeks = [...state.statsHistory].sort((a, b) => a.weekNum - b.weekNum);
  sortedWeeks.forEach(w => {
    const leg = (w.legs || []).find(l => l.boy === boyName);
    if (leg) {
      allPicks.push({
        weekNum: w.weekNum,
        dateStr: w.dateStr,
        bettor: w.bettor,
        pick: leg.pick,
        odds: leg.odds,
        decimal: americanToDecimal(leg.odds),
        result: leg.result || 'pending',
        market: detectMarketFromPickText(leg.pick)
      });
    }
  });

  // Also include current active week pick if not already in statsHistory
  const activeWeekInHistory = sortedWeeks.some(w => w.dateStr === state.currentFridayStr);
  if (!activeWeekInHistory && state.legs && state.legs[boyName]) {
    const activeLeg = state.legs[boyName];
    allPicks.push({
      weekNum: sortedWeeks.length + 1,
      dateStr: state.currentFridayStr,
      bettor: getMasterBettor(state.currentFriday).name,
      pick: `${activeLeg.pick_text || activeLeg.pick || ''} (${activeLeg.game || ''})`.trim(),
      odds: activeLeg.odds || '-110',
      decimal: americanToDecimal(activeLeg.odds || '-110'),
      result: 'live',
      market: detectMarketFromPickText(activeLeg.pick_text || activeLeg.pick || '')
    });
  }

  // Compute extended profile analytics
  const allDecimals = allPicks.map(pk => pk.decimal).filter(Boolean);
  const overallAvgDec = allDecimals.length > 0
    ? allDecimals.reduce((a, b) => a + b, 0) / allDecimals.length
    : 0;
  const overallAvgAmerican = overallAvgDec > 0 ? decimalToAmerican(overallAvgDec) : '--';

  // Implied $10 Flat-Bet Unit Profit & ROI on graded picks + Best Hit Odds
  let flatStaked = 0;
  let flatReturned = 0;
  let bestHitDec = 0;
  let bestHitOddsStr = p.maxWinningOddsStr || '--';
  let bestHitPick = '';
  const marketCounts = {};
  const marketHits = {};

  allPicks.forEach(pk => {
    marketCounts[pk.market] = (marketCounts[pk.market] || 0) + 1;
    if (pk.result === 'hit') {
      marketHits[pk.market] = (marketHits[pk.market] || 0) + 1;
      flatStaked += 10;
      flatReturned += 10 * pk.decimal;
      if (pk.decimal > bestHitDec) {
        bestHitDec = pk.decimal;
        bestHitOddsStr = pk.odds;
        bestHitPick = pk.pick;
      }
    } else if (pk.result === 'miss') {
      flatStaked += 10;
    }
  });

  const netProfit = flatReturned - flatStaked;
  const netProfitStr = flatStaked === 0 ? '$0.00' : `${netProfit >= 0 ? '+' : '-'}$${Math.abs(netProfit).toFixed(2)}`;
  const roiPct = flatStaked > 0 ? Math.round((netProfit / flatStaked) * 100) : 0;

  let favMarket = 'Points';
  let bestMarketCount = 0;
  Object.entries(marketCounts).forEach(([mkt, cnt]) => {
    if (cnt > bestMarketCount) {
      bestMarketCount = cnt;
      favMarket = mkt;
    }
  });
  const favMarketRecord = `${marketHits[favMarket] || 0}/${marketCounts[favMarket] || 0}`;

  const weeksAsMaster = sortedWeeks.filter(w => w.bettor === boyName).length +
    (!activeWeekInHistory && getMasterBettor(state.currentFriday).name === boyName ? 1 : 0);

  const streakStr = p.total === 0 ? 'Debut' : (p.streak > 0 ? `${p.streakType}${p.streak}` : 'Even');

  body.innerHTML = `
    <div class="profile-hero-banner">
      <div class="profile-hero-avatar">${p.initials}</div>
      <div class="profile-hero-details">
        <div class="profile-hero-title">
          ${p.name}
          <span class="title-tag-pill ${p.accolade.pillClass}">${getIcon(p.accolade.icon)} ${p.accolade.title}</span>
        </div>
        <div class="profile-hero-sub">
          ${p.role || 'Squad Member'} • ${allPicks.length} Total Picks Logged • ${weeksAsMaster}x Master Bettor
        </div>
      </div>
    </div>

    <div class="profile-stats-grid">
      <div class="profile-stat-box">
        <span class="psb-label">Win Rate & Record</span>
        <span class="psb-val ${p.rate >= 60 ? 'green' : ''}">${p.rate}% (${p.hits}-${p.misses})</span>
        <span class="psb-sub">Current Streak: ${streakStr}</span>
      </div>
      <div class="profile-stat-box">
        <span class="psb-label">Avg Pick Odds</span>
        <span class="psb-val gold">${overallAvgAmerican}</span>
        <span class="psb-sub">${overallAvgDec > 0 ? `${overallAvgDec.toFixed(2)}x Decimal Avg` : 'Graded + Active'}</span>
      </div>
      <div class="profile-stat-box">
        <span class="psb-label">Best Odds Cashed</span>
        <span class="psb-val green">${bestHitOddsStr}</span>
        <span class="psb-sub">${bestHitPick ? escapeHTML(bestHitPick) : 'No cashed leg yet'}</span>
      </div>
      <div class="profile-stat-box">
        <span class="psb-label">Solo $10 Flat P/L</span>
        <span class="psb-val ${netProfit >= 0 ? 'green' : 'red'}">${netProfitStr}</span>
        <span class="psb-sub">ROI: ${roiPct >= 0 ? '+' : ''}${roiPct}% on graded legs</span>
      </div>
      <div class="profile-stat-box">
        <span class="psb-label">Favorite Market</span>
        <span class="psb-val">${favMarket}</span>
        <span class="psb-sub">${favMarketRecord} cashed in ${favMarket}</span>
      </div>
      <div class="profile-stat-box">
        <span class="psb-label">Graded Avg Odds</span>
        <span class="psb-val">${p.avgAmerican}</span>
        <span class="psb-sub">${p.hits} Hits • ${p.misses} Misses</span>
      </div>
    </div>

    <div class="profile-section-title">All Picks & Odds History (${allPicks.length})</div>
    <div class="profile-picks-list">
      ${allPicks.slice().reverse().map(pk => {
        const resClass = pk.result === 'hit' ? 'hit' : (pk.result === 'miss' ? 'miss' : 'live');
        const resLabel = pk.result === 'hit' ? 'HIT ✓' : (pk.result === 'miss' ? 'MISS ✕' : 'LIVE • ON ICE');
        return `
          <div class="profile-pick-row">
            <div class="ppr-left">
              <span class="ppr-week">WEEK ${pk.weekNum} • ${formatWeekDateStr(pk.dateStr)} • ${pk.market.toUpperCase()}</span>
              <span class="ppr-pick">${escapeHTML(pk.pick)}</span>
            </div>
            <div class="ppr-right">
              <span class="ppr-odds">${pk.odds}</span>
              <span class="ppr-badge ${resClass}">${resLabel}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  backdrop.classList.remove('hidden');

  if (closeBtn) {
    closeBtn.onclick = () => backdrop.classList.add('hidden');
  }
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.classList.add('hidden');
  };
};

window.exportSeasonStatsReport = function() {
  const data = computeSquadAnalytics();
  const lines = [];
  lines.push(`# 🏒 FRIDAY NIGHT PUCK — OFFICIAL SEASON STATS LEDGER`);
  lines.push(`Last Updated: ${new Date().toLocaleString()}`);
  lines.push(`Parlays Cashed: ${data.wonParlays}/${data.totalParlays} | Total Leg Hits: ${data.totalHitsCount}/${data.totalLegsCount} (${data.pickWinRate}%) | Total Wagered: $${data.totalWagered.toFixed(2)}`);
  lines.push(``);
  lines.push(`## 🏆 SQUAD LEADERBOARD`);
  data.players.forEach((p, i) => {
    lines.push(`${i + 1}. **${p.name}** (${p.accolade.title}) — ${p.rate}% (${p.hits}-${p.misses}) | Streak: ${p.streakType}${p.streak} | Avg Odds: ${p.avgAmerican} | Best Hit: ${p.maxWinningOddsStr || '--'}`);
  });
  lines.push(``);
  lines.push(`## 📅 WEEKLY PARLAY ARCHIVE`);
  state.statsHistory.forEach(w => {
    lines.push(`### Week ${w.weekNum} (${w.dateStr}) — Bettor: ${w.bettor} | Stake: $${w.stake} | Odds: ${w.totalOdds} | Status: ${String(w.result).toUpperCase()}`);
    (w.legs || []).forEach(l => {
      lines.push(`- **${l.boy}**: ${l.pick} (${l.odds}) -> **${String(l.result).toUpperCase()}**`);
    });
    lines.push(``);
  });

  const reportText = lines.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(reportText).then(() => {
      showToast('📊 Full Season Stats Ledger copied to clipboard!');
    }).catch(() => {
      showToast('📊 Season Stats Ledger ready!');
    });
  } else {
    showToast('📊 Season Stats Ledger generated!');
  }
};

// =============================================================================
// 8. LIVE BET TRACKER ENGINE (BET365 UI WITH ESPN/NHL BOXSCORE INTEGRATION)
// =============================================================================
function normalizeName(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function renderEmptyTrackerState() {
  if (!DOM.trackerGamesContainer) return;
  DOM.trackerGamesContainer.innerHTML = "";

  const bettor = getBettorForFriday(state.currentFriday);
  const boysWithPicks = Object.keys(state.legs || {});
  const readyCount = boysWithPicks.length;

  DOM.legsHitCount.textContent = `0 / 6`;
  if (DOM.overallProgressBar) DOM.overallProgressBar.style.width = "0%";
  if (DOM.trackerTotalOddsBadge) DOM.trackerTotalOddsBadge.textContent = "AWAITING LOCK-IN";
  if (DOM.navLiveMultiplier) DOM.navLiveMultiplier.textContent = "--";
  if (DOM.syncStatus) DOM.syncStatus.textContent = "Awaiting Bet Placement • Live NHL API ready to sync upon lock-in";

  DOM.trackerWagerDisplay.textContent = `$${state.stake.toFixed(2)}`;
  DOM.trackerReturnDisplay.textContent = "--";

  if (DOM.ticketStatusBanner) {
    DOM.ticketStatusBanner.className = "tracker-cashout-btn pending";
    DOM.ticketStatusBanner.innerHTML = `<span class="bts-icon" style="margin-right:6px;">${getIcon('lock')}</span> Bet Not Placed Yet • Awaiting Confirmation`;
  }

  const emptyCard = document.createElement("div");
  emptyCard.className = "tracker-empty-card";
  emptyCard.innerHTML = `
    <div class="tracker-empty-icon-wrap">
      ${getIcon('lock')}
    </div>
    <div class="tracker-empty-badge">PARLAY PENDING</div>
    <h3 class="tracker-empty-title">LIVE TRACKER AWAITING LOCK-IN</h3>
    <p class="tracker-empty-desc">
      This week’s parlay has not been placed yet. Once <strong>${bettor.name}</strong> places the bet on the sportsbook and confirms it, the live tracker will activate, refresh with our real picks, and begin streaming real-time NHL boxscore progress!
    </p>

    <div class="tracker-empty-slip-preview">
      <div class="tracker-empty-preview-header">
        <span>PICKS READY ON BET SLIP</span>
        <span class="tracker-empty-ready-count">${readyCount} / 6 READY</span>
      </div>
      <div class="tracker-empty-preview-list">
        ${SQUAD.map(boy => {
          const leg = state.legs[boy.name];
          const hasPick = !!leg;
          return `
            <div class="tracker-empty-pick-pill ${hasPick ? 'ready' : 'empty'}">
              <span class="tracker-empty-boy-tag">${boy.name}</span>
              <span class="tracker-empty-pick-name">${hasPick ? (leg.pick_text || 'Pick Added') : 'Pending pick...'}</span>
              <span class="tracker-empty-pick-status">${hasPick ? getIcon('check') : '--'}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="tracker-empty-actions">
      <button class="nhl-action-btn accent" onclick="openScanSlipModal()">
        <span>📸 Drop Bet Slip Screenshot</span>
      </button>
      <button class="nhl-action-btn secondary" onclick="switchView('slipBuilderView')">
        <span class="bts-icon">${getIcon('slip')}</span>
        <span>View Bet Slip (${readyCount}/6)</span>
      </button>
      <button class="nhl-action-btn primary" onclick="lockInBetAndRefreshTracker()">
        <span class="bts-icon">${getIcon('check')}</span>
        <span>Confirm as ${bettor.name}</span>
      </button>
    </div>
  `;

  DOM.trackerGamesContainer.appendChild(emptyCard);
}

window.lockInBetAndRefreshTracker = function() {
  state.isPlaced = true;
  saveLocalData(state.currentFridayStr);
  syncTrackerFromRealPicks();
  saveTrackerData();
  renderSportsbookTicket();
  renderTracker();
  if (window.confetti) confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
  playSound('triumph');
  const bettor = getBettorForFriday(state.currentFriday);
  showToast(`Bet locked in by ${bettor.name}! Live tracker active`, 'checkCircle');
  fetchAllLiveStats(true);
};

function renderTracker() {
  if (!DOM.trackerGamesContainer) return;
  DOM.trackerGamesContainer.innerHTML = "";

  if (!state.isPlaced) {
    renderEmptyTrackerState();
    return;
  }

  let totalLegs = 0;
  let hitLegs = 0;
  let missedFinalLegs = 0;
  let allGamesFinal = state.trackerData.length > 0;

  state.trackerData.forEach(game => {
    const gameBlock = document.createElement("div");
    gameBlock.className = "tracker-game-block";
    const isGameFinal = game.gameStatus === 'final' || /final/i.test(game.gameStateText || '');
    if (!isGameFinal) allGamesFinal = false;

    let allGameLegsHit = true;
    game.legs.forEach(l => {
      totalLegs++;
      const val = Math.max(0, l.apiStat || 0);
      if (val >= l.target) hitLegs++;
      else {
        allGameLegsHit = false;
        if (isGameFinal) missedFinalLegs++;
      }
    });

    const isGameLive = game.gameStatus === 'live';
    const awayLogoUrl = `https://assets.nhle.com/logos/nhl/svg/${normalizeTeamAbbr(game.awayTeam)}_light.svg`;
    const homeLogoUrl = `https://assets.nhle.com/logos/nhl/svg/${normalizeTeamAbbr(game.homeTeam)}_light.svg`;
    const awayScoreDisplay = (isGameLive || isGameFinal || game.awayScore !== undefined) ? (game.awayScore ?? 0) : 0;
    const homeScoreDisplay = (isGameLive || isGameFinal || game.homeScore !== undefined) ? (game.homeScore ?? 0) : 0;
    const awaySogDisplay = game.awaySog ?? 0;
    const homeSogDisplay = game.homeSog ?? 0;
    const awayHitsDisplay = game.awayHits ?? 0;
    const homeHitsDisplay = game.homeHits ?? 0;
    const clockBadgeText = isGameLive
      ? `● ${game.statusDetail || 'LIVE'}`
      : (isGameFinal ? 'FINAL' : (game.statusDetail || game.startTime || 'TONIGHT'));

    gameBlock.innerHTML = `
      <div class="tracker-game-top">
        <div class="tracker-game-tag">
          <span class="live-dot-mini" style="background:${allGameLegsHit ? '#00ff87' : (isGameLive ? '#ef4444' : (isGameFinal ? '#ef4444' : '#6b7280'))};"></span>
          <span>SAME GAME <span class="b365-green">PARLAY</span></span>
          <span class="tracker-game-mult">${game.odds}${String(game.odds).endsWith('x') || game.odds === 'SGP' ? '' : 'x'}</span>
        </div>
        <span class="tracker-game-state-badge">
          ${game.gameStateText}
        </span>
      </div>

      <div class="tracker-live-scoreboard">
        <div class="tls-team away">
          <img src="${awayLogoUrl}" class="tls-logo" alt="${game.awayTeam}" onerror="this.style.display='none'" />
          <div class="tls-team-meta">
            <span class="tls-abbrev">${game.awayTeam}</span>
            <span class="tls-sog">${awaySogDisplay} SOG</span>
          </div>
          <span class="tls-score">${awayScoreDisplay}</span>
        </div>
        <div class="tls-center">
          <span class="tls-clock-pill ${isGameLive ? 'live' : ''}">${clockBadgeText}</span>
          <span class="tls-sub-stats">SOG ${awaySogDisplay}-${homeSogDisplay}${awayHitsDisplay || homeHitsDisplay ? ` • HITS ${awayHitsDisplay}-${homeHitsDisplay}` : ''}</span>
        </div>
        <div class="tls-team home">
          <img src="${homeLogoUrl}" class="tls-logo" alt="${game.homeTeam}" onerror="this.style.display='none'" />
          <div class="tls-team-meta">
            <span class="tls-abbrev">${game.homeTeam}</span>
            <span class="tls-sog">${homeSogDisplay} SOG</span>
          </div>
          <span class="tls-score">${homeScoreDisplay}</span>
        </div>
      </div>

      <div class="tracker-legs-wrap">
        ${game.legs.map(leg => {
          const currentVal = Math.max(0, leg.apiStat || 0);
          const pct = Math.min(100, Math.round((currentVal / leg.target) * 100));
          const isHit = currentVal >= leg.target;
          const isMissedFinal = !isHit && isGameFinal;
          const unitLabel = getUnitLabelForStat(leg.statType);
          const remaining = Math.max(0, leg.target - currentVal);
          const statusText = isHit
            ? "✓ LEG HIT"
            : (isMissedFinal
                ? "✗ MISSED (FINAL)"
                : (currentVal > 0 ? `${remaining} TO GO` : `NEED ${leg.target} ${unitLabel}`));
          const statusClass = isHit ? "hit" : (isMissedFinal ? "miss" : (currentVal > 0 ? "in-progress" : ""));

          return `
            <div class="tracker-leg-card ${isHit ? 'hit' : (isMissedFinal ? 'miss' : '')}">
              <div class="tracker-leg-tier1">
                <div class="tracker-leg-person">
                  <div class="tracker-hit-indicator">${isMissedFinal ? getIcon('cross') : getIcon('check')}</div>
                  <span class="tracker-player-title">${leg.playerName}</span>
                </div>
                <div class="tracker-stat-box ${isHit ? 'hit' : (isMissedFinal ? 'miss' : '')}">
                  <span class="tracker-current-num">${currentVal}</span>
                  <span class="tracker-target-num">/ ${leg.target} ${unitLabel}</span>
                </div>
              </div>

              <div class="tracker-leg-tier2">
                <span class="tracker-boy-pill">${leg.boyName || 'SQUAD'}</span>
                <span class="tracker-market-desc">${leg.marketLabel}</span>
              </div>

              <div class="tracker-slider-wrap">
                <div class="tracker-progress-track">
                  <div class="tracker-progress-fill ${statusClass}" style="width: ${pct}%">
                    ${pct > 0 && !isHit && !isMissedFinal ? '<span class="tracker-slider-thumb"></span>' : ''}
                  </div>
                </div>
              </div>

              <div class="tracker-leg-tier4">
                <span class="tracker-live-detail">${leg.subDetail || '0G, 0A • 0 SOG'}</span>
                <span class="tracker-status-badge ${statusClass}">${statusText}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <!-- Matchup Bar -->
      <div class="tracker-matchup-bar">
        <div style="font-weight:700;">
          <span>${game.awayName}</span> vs <span>${game.homeName}</span>
        </div>
        <div style="text-align:right; font-size:0.7rem; color:#94a3b8;">
          <span>${game.startTime}</span>
        </div>
      </div>
    `;

    DOM.trackerGamesContainer.appendChild(gameBlock);
  });

  // Update Overall Header & Ticket Banner
  DOM.legsHitCount.textContent = `${hitLegs} / ${totalLegs}`;
  const overallPct = totalLegs > 0 ? Math.round((hitLegs / totalLegs) * 100) : 0;
  DOM.overallProgressBar.style.width = `${overallPct}%`;

  let totalOddsMulti = 24.94;
  let payout = "748.20";
  if (state.masterSlip && state.masterSlip.potential_payout) {
    payout = parseFloat(state.masterSlip.potential_payout).toFixed(2);
    totalOddsMulti = parseFloat(state.masterSlip.potential_payout) / (state.stake || 1);
  } else if (state.currentFridayStr === '2026-10-23') {
    payout = "408.35";
    totalOddsMulti = 13.61;
  } else if (state.currentFridayStr === '2026-10-16') {
    payout = "262.50";
    totalOddsMulti = 10.50;
  } else {
    payout = "748.20";
    totalOddsMulti = 24.94;
  }
  DOM.trackerWagerDisplay.textContent = `$${state.stake.toFixed(2)}`;
  DOM.trackerReturnDisplay.textContent = `$${payout}`;
  DOM.trackerTotalOddsBadge.textContent = `${totalOddsMulti.toFixed(2)}x`;
  DOM.navLiveMultiplier.textContent = `${totalOddsMulti.toFixed(2)}x`;

  if (hitLegs === totalLegs && totalLegs > 0) {
    DOM.ticketStatusBanner.innerHTML = `<span class="banner-icon-wrap">${getIcon('trophy')}</span> ALL ${totalLegs} LEGS HIT! PAYOUT: $${payout}`;
    DOM.ticketStatusBanner.className = "tracker-cashout-btn all-hit";
  } else if (allGamesFinal && totalLegs > 0) {
    DOM.ticketStatusBanner.textContent = `PARLAY SETTLED • ${hitLegs} OF ${totalLegs} LEGS HIT (${missedFinalLegs} MISSED)`;
    DOM.ticketStatusBanner.className = "tracker-cashout-btn settled-loss";
  } else {
    DOM.ticketStatusBanner.textContent = `Cash Out $${state.stake.toFixed(2)} • ${hitLegs} of ${totalLegs} Legs Hit`;
    DOM.ticketStatusBanner.className = "tracker-cashout-btn active";
  }
}

// Automatically grade legs & settle week in Squad Stats when live boxscores hit or finish
function autoSettleFromLiveTracker() {
  if (!state.trackerData || state.trackerData.length === 0) return;

  let weekEntry = (state.statsHistory || []).find(w => w.dateStr === state.currentFridayStr);
  if (!weekEntry) {
    const bettor = getBettorForFriday(state.currentFriday);
    const weekNum = Math.max(1, getFridayDiffWeeks(state.currentFriday) + 1);
    weekEntry = {
      weekNum: weekNum,
      dateStr: state.currentFridayStr,
      bettor: state.masterSlip?.bettor_name || bettor.name,
      stake: state.stake || 30,
      totalOdds: state.masterSlip?.total_odds || '+2394',
      result: 'pending',
      notes: state.masterSlip?.notes || `Placed by ${bettor.name}`,
      legs: SQUAD.map(b => {
        const l = state.legs[b.name];
        return {
          boy: b.name,
          pick: l?.pick_text || 'Friday Pick',
          odds: l?.odds || '-110',
          result: 'pending'
        };
      })
    };
    state.statsHistory.push(weekEntry);
  }

  let changed = false;
  let allGamesFinal = state.trackerData.length > 0;

  state.trackerData.forEach(game => {
    const isGameFinal = game.gameStatus === 'final' || /final/i.test(game.gameStateText || '');
    if (!isGameFinal) allGamesFinal = false;

    (game.legs || []).forEach(leg => {
      const histLeg = (weekEntry.legs || []).find(hl => hl.boy === leg.boyName);
      if (!histLeg) return;

      const val = Math.max(0, leg.apiStat || 0);
      if (val >= leg.target && histLeg.result !== 'hit') {
        histLeg.result = 'hit';
        changed = true;
      } else if (isGameFinal && val < leg.target && histLeg.result !== 'miss') {
        histLeg.result = 'miss';
        changed = true;
      }
    });
  });

  const hits = (weekEntry.legs || []).filter(l => l.result === 'hit').length;
  const misses = (weekEntry.legs || []).filter(l => l.result === 'miss').length;
  const total = (weekEntry.legs || []).length;

  if (total > 0 && hits === total && weekEntry.result !== 'win') {
    weekEntry.result = 'win';
    changed = true;
  } else if (allGamesFinal && misses > 0 && weekEntry.result !== 'loss') {
    weekEntry.result = 'loss';
    changed = true;
  }

  if (changed) {
    saveStatsHistory();
    renderStatsView();
  }
}

// Team Abbreviation Normalizer (maps ESPN/NHL variations e.g. TB -> TBL, MON -> MTL)
const TEAM_ABBR_ALIASES = {
  TB: "TBL",
  MON: "MTL",
  VEG: "VGK",
  WAS: "WSH",
  NJ: "NJD",
  SJ: "SJS",
  LA: "LAK",
  CAL: "CGY",
  WIN: "WPG"
};

function normalizeTeamAbbr(abbr) {
  if (!abbr) return "";
  const upper = String(abbr).toUpperCase().trim();
  return TEAM_ABBR_ALIASES[upper] || upper;
}

// Live API Fetching (ESPN NHL Public API + NHL Web API fallback)
let isFetchingLiveStats = false;
async function fetchAllLiveStats(isManualClick = false) {
  if (!state.isPlaced) {
    if (DOM.syncStatus) DOM.syncStatus.textContent = "Awaiting Bet Placement • Live NHL API ready to sync upon lock-in";
    if (isManualClick && DOM.refreshIcon) {
      setTimeout(() => DOM.refreshIcon.classList.remove("animate-spin"), 250);
    }
    renderTracker();
    return;
  }

  if (isFetchingLiveStats && !isManualClick) return;
  isFetchingLiveStats = true;

  if (isManualClick && DOM.refreshIcon) DOM.refreshIcon.classList.add("animate-spin");
  if (DOM.syncStatus) DOM.syncStatus.textContent = "Checking live NHL boxscores...";

  let updatedPlayers = 0;
  let espnSucceeded = false;
  const compactDate = (state.currentFridayStr || '').replace(/-/g, '');
  const espnScoreboardUrl = compactDate
    ? `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${compactDate}`
    : "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard";

  try {
    const espnResp = await fetch(espnScoreboardUrl);
    if (espnResp.ok) {
      espnSucceeded = true;
      const scoreboard = await espnResp.json();
      const events = scoreboard.events || [];

      for (const event of events) {
        const comp = event.competitions?.[0];
        if (!comp) continue;

        const competitors = comp.competitors || [];
        const abbrevs = competitors.map(c => normalizeTeamAbbr(c.team?.abbreviation));

        const matchingGame = state.trackerData.find(g =>
          abbrevs.includes(normalizeTeamAbbr(g.awayTeam)) && abbrevs.includes(normalizeTeamAbbr(g.homeTeam))
        );

        if (matchingGame) {
          const awayObj = competitors.find(c => normalizeTeamAbbr(c.team?.abbreviation) === normalizeTeamAbbr(matchingGame.awayTeam));
          const homeObj = competitors.find(c => normalizeTeamAbbr(c.team?.abbreviation) === normalizeTeamAbbr(matchingGame.homeTeam));
          const statusDetail = event.status?.type?.shortDetail || matchingGame.startTime;
          const stateType = event.status?.type?.state || 'pre';
          const isCompleted = !!event.status?.type?.completed || stateType === 'post';

          matchingGame.gameStatus = isCompleted ? 'final' : (stateType === 'in' ? 'live' : 'pre');
          matchingGame.statusDetail = statusDetail;

          if (awayObj && homeObj) {
            const aScore = parseInt(awayObj.score || '0', 10) || 0;
            const hScore = parseInt(homeObj.score || '0', 10) || 0;
            const aSaves = parseInt(awayObj.statistics?.find(s => s.name === 'saves')?.displayValue || '0', 10) || 0;
            const hSaves = parseInt(homeObj.statistics?.find(s => s.name === 'saves')?.displayValue || '0', 10) || 0;
            matchingGame.awayScore = aScore;
            matchingGame.homeScore = hScore;
            if (stateType !== 'pre') {
              matchingGame.awaySog = matchingGame.awaySog || (aScore + hSaves);
              matchingGame.homeSog = matchingGame.homeSog || (hScore + aSaves);
            }
            matchingGame.gameStateText = stateType === 'pre'
              ? statusDetail
              : `${matchingGame.awayTeam} ${aScore} - ${matchingGame.homeTeam} ${hScore} (${statusDetail})`;
          }

          const summaryResp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${event.id}`);
          if (summaryResp.ok) {
            const summaryData = await summaryResp.json();
            updatedPlayers += parseEspnBoxscore(summaryData, matchingGame);
          }
        }
      }
    }
  } catch (err) {
    console.warn("ESPN live feed check fallback:", err);
  }

  // Fallback: NHL Official Web API via CORS Proxy (only if ESPN request failed)
  if (!espnSucceeded && updatedPlayers === 0) {
    try {
      const nhlUrl = encodeURIComponent("https://api-web.nhle.com/v1/score/now");
      const resp = await fetch(`https://api.allorigins.win/raw?url=${nhlUrl}`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined
      });
      if (resp.ok) {
        const data = await resp.json();
        const games = data.games || [];
        for (const g of games) {
          const away = normalizeTeamAbbr(g.awayTeam?.abbrev);
          const home = normalizeTeamAbbr(g.homeTeam?.abbrev);
          const matchingGame = state.trackerData.find(item =>
            (normalizeTeamAbbr(item.awayTeam) === away && normalizeTeamAbbr(item.homeTeam) === home) ||
            (normalizeTeamAbbr(item.awayTeam) === home && normalizeTeamAbbr(item.homeTeam) === away)
          );

          if (matchingGame) {
            const stateText = g.gameState;
            const isFinal = stateText === "OFF" || stateText === "FINAL";
            matchingGame.gameStatus = isFinal ? 'final' : ((stateText === "FUT" || stateText === "PRE") ? 'pre' : 'live');
            const period = g.periodDescriptor?.number ? `P${g.periodDescriptor.number}` : "";
            const clock = g.clock?.timeRemaining || (isFinal ? "FINAL" : "");
            matchingGame.gameStateText = stateText === "FUT" || stateText === "PRE"
              ? matchingGame.startTime
              : `${away} ${g.awayTeam?.score ?? 0} - ${home} ${g.homeTeam?.score ?? 0} (${isFinal ? 'FINAL' : `${period} ${clock}`.trim()})`;

            const boxUrl = encodeURIComponent(`https://api-web.nhle.com/v1/gamecenter/${g.id}/boxscore`);
            const boxResp = await fetch(`https://api.allorigins.win/raw?url=${boxUrl}`, {
              signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined
            });
            if (boxResp.ok) {
              const boxData = await boxResp.json();
              updatedPlayers += parseNhlBoxscore(boxData, matchingGame);
            }
          }
        }
      }
    } catch (e) {
      console.warn("NHL Web API proxy fallback skipped:", e);
    }
  }

  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (DOM.syncStatus) DOM.syncStatus.textContent = `Last synced: ${nowStr} • Auto-updates every 20s`;
  if (isManualClick && DOM.refreshIcon) {
    setTimeout(() => DOM.refreshIcon.classList.remove("animate-spin"), 350);
  }

  isFetchingLiveStats = false;
  autoSettleFromLiveTracker();
  saveTrackerData();
  renderTracker();
}

function parseEspnBoxscore(summaryData, gameObj) {
  let count = 0;

  // 1. Extract Team-Level Boxscore Stats (Shots on Goal, Hits, Blocked Shots, Power Play, Faceoff %)
  const boxTeams = summaryData.boxscore?.teams || [];
  for (const t of boxTeams) {
    const tAbbr = normalizeTeamAbbr(t.team?.abbreviation);
    const tStats = t.statistics || [];
    const getTeamStat = (name) => {
      const found = tStats.find(s => s.name === name || s.label === name || s.abbreviation === name);
      return found ? found.displayValue : null;
    };
    const sogVal = getTeamStat('shotsTotal') ?? getTeamStat('S');
    const hitsVal = getTeamStat('hits') ?? getTeamStat('HT');
    const blocksVal = getTeamStat('blockedShots') ?? getTeamStat('BS');

    if (tAbbr === normalizeTeamAbbr(gameObj.awayTeam)) {
      if (sogVal !== null) gameObj.awaySog = parseInt(sogVal, 10) || 0;
      if (hitsVal !== null) gameObj.awayHits = parseInt(hitsVal, 10) || 0;
      if (blocksVal !== null) gameObj.awayBlocks = parseInt(blocksVal, 10) || 0;
    } else if (tAbbr === normalizeTeamAbbr(gameObj.homeTeam)) {
      if (sogVal !== null) gameObj.homeSog = parseInt(sogVal, 10) || 0;
      if (hitsVal !== null) gameObj.homeHits = parseInt(hitsVal, 10) || 0;
      if (blocksVal !== null) gameObj.homeBlocks = parseInt(blocksVal, 10) || 0;
    }
  }

  // Sync team SOG & scores back to state.games so the top scoreboard ticker also shows exact boxscore SOG
  if (state.games && state.games.length > 0) {
    const tickerGame = state.games.find(tg =>
      normalizeTeamAbbr(tg.away?.abbrev) === normalizeTeamAbbr(gameObj.awayTeam) &&
      normalizeTeamAbbr(tg.home?.abbrev) === normalizeTeamAbbr(gameObj.homeTeam)
    );
    if (tickerGame) {
      if (gameObj.awayScore !== undefined) tickerGame.away.score = gameObj.awayScore;
      if (gameObj.homeScore !== undefined) tickerGame.home.score = gameObj.homeScore;
      if (gameObj.awaySog !== undefined) tickerGame.away.sog = gameObj.awaySog;
      if (gameObj.homeSog !== undefined) tickerGame.home.sog = gameObj.homeSog;
      if (gameObj.statusDetail) tickerGame.statusDetail = gameObj.statusDetail;
      if (gameObj.gameStatus === 'live') tickerGame.state = 'in';
      else if (gameObj.gameStatus === 'final') tickerGame.state = 'post';
      renderGamesTicker(state.games);
    }
  }

  // 2. Extract Player-Level Stats
  const teams = summaryData.boxscore?.players || [];
  for (const teamBlock of teams) {
    const statGroups = teamBlock.statistics || [];
    for (const group of statGroups) {
      const labels = (group.labels || []).map(l => l.toUpperCase());
      const gIdx = labels.indexOf("G");
      const aIdx = labels.indexOf("A");
      const sIdx = labels.indexOf("S") !== -1 ? labels.indexOf("S") : labels.indexOf("SOG");
      const bsIdx = labels.indexOf("BS");
      const htIdx = labels.indexOf("HT");
      const svIdx = labels.indexOf("SV") !== -1 ? labels.indexOf("SV") : labels.indexOf("SAVES");
      const saIdx = labels.indexOf("SA");
      const gaIdx = labels.indexOf("GA");
      const toiIdx = labels.indexOf("TOI");

      for (const athleteRow of (group.athletes || [])) {
        const fullName = athleteRow.athlete?.displayName || "";
        const normTarget = normalizeName(fullName);

        gameObj.legs.forEach(leg => {
          if (normalizeName(leg.playerName) === normTarget) {
            const stats = athleteRow.stats || [];
            const toi = toiIdx !== -1 ? stats[toiIdx] : null;

            if (leg.statType === "saves" || svIdx !== -1) {
              const rawSv = svIdx !== -1 ? String(stats[svIdx] || "0") : "0";
              const saves = parseInt(rawSv.split("-")[0] || "0", 10) || 0;
              const shotsAgainst = saIdx !== -1 ? parseInt(stats[saIdx] || "0", 10) : saves;
              const goalsAgainst = gaIdx !== -1 ? parseInt(stats[gaIdx] || "0", 10) : 0;
              if (leg.statType === "saves") {
                leg.apiStat = saves;
                leg.subDetail = `${saves} SV • ${shotsAgainst} SA, ${goalsAgainst} GA${toi ? ` • ${toi} TOI` : ''}`;
                count++;
                return;
              }
            }

            const goals = gIdx !== -1 ? parseInt(stats[gIdx] || "0", 10) : 0;
            const assists = aIdx !== -1 ? parseInt(stats[aIdx] || "0", 10) : 0;
            const shots = sIdx !== -1 ? parseInt(stats[sIdx] || "0", 10) : 0;
            const blocks = bsIdx !== -1 ? parseInt(stats[bsIdx] || "0", 10) : 0;
            const hits = htIdx !== -1 ? parseInt(stats[htIdx] || "0", 10) : 0;
            const points = goals + assists;

            if (leg.statType === "shots") leg.apiStat = shots;
            else if (leg.statType === "goals") leg.apiStat = goals;
            else if (leg.statType === "assists") leg.apiStat = assists;
            else if (leg.statType === "blocks") leg.apiStat = blocks;
            else if (leg.statType === "hits") leg.apiStat = hits;
            else leg.apiStat = points;

            if (leg.statType === "blocks") {
              leg.subDetail = `${blocks} BLK • ${goals}G, ${assists}A${toi ? ` • ${toi} TOI` : ''}`;
            } else if (leg.statType === "hits") {
              leg.subDetail = `${hits} HITS • ${goals}G, ${assists}A${toi ? ` • ${toi} TOI` : ''}`;
            } else {
              leg.subDetail = `${goals}G, ${assists}A • ${shots} SOG${toi ? ` • ${toi} TOI` : ''}`;
            }
            count++;
          }
        });
      }
    }
  }
  return count;
}

function parseNhlBoxscore(boxData, gameObj) {
  let count = 0;
  if (boxData.awayTeam?.sog !== undefined) gameObj.awaySog = boxData.awayTeam.sog;
  if (boxData.homeTeam?.sog !== undefined) gameObj.homeSog = boxData.homeTeam.sog;
  if (boxData.awayTeam?.score !== undefined) gameObj.awayScore = boxData.awayTeam.score;
  if (boxData.homeTeam?.score !== undefined) gameObj.homeScore = boxData.homeTeam.score;

  const pStats = boxData.playerByGameStats;
  if (!pStats) return 0;

  const allSkaters = [
    ...(pStats.awayTeam?.forwards || []),
    ...(pStats.awayTeam?.defense || []),
    ...(pStats.homeTeam?.forwards || []),
    ...(pStats.homeTeam?.defense || [])
  ];

  const allGoalies = [
    ...(pStats.awayTeam?.goalies || []),
    ...(pStats.homeTeam?.goalies || [])
  ];

  for (const g of allGoalies) {
    const name = g.name?.default || "";
    const lastName = name.split(" ").slice(-1)[0]?.toLowerCase();
    gameObj.legs.forEach(leg => {
      const legLast = leg.playerName.split(" ").slice(-1)[0]?.toLowerCase();
      if (leg.statType === "saves" && lastName && legLast && lastName === legLast) {
        const saves = g.saves ?? (parseInt(String(g.saveShotsAgainst || "0").split("/")[0], 10) || 0);
        const sa = g.shotsAgainst ?? (parseInt(String(g.saveShotsAgainst || "0").split("/")[1], 10) || saves);
        const ga = g.goalsAgainst ?? 0;
        const toi = g.toi || "";
        leg.apiStat = saves;
        leg.subDetail = `${saves} SV • ${sa} SA, ${ga} GA${toi ? ` • ${toi} TOI` : ''}`;
        count++;
      }
    });
  }

  for (const p of allSkaters) {
    const name = p.name?.default || "";
    const lastName = name.split(" ").slice(-1)[0]?.toLowerCase();

    gameObj.legs.forEach(leg => {
      const legLast = leg.playerName.split(" ").slice(-1)[0]?.toLowerCase();
      if (lastName && legLast && lastName === legLast) {
        const goals = p.goals ?? 0;
        const assists = p.assists ?? 0;
        const points = p.points ?? (goals + assists);
        const shots = p.sog ?? 0;
        const blocks = p.blockedShots ?? 0;
        const hits = p.hits ?? 0;
        const toi = p.toi || "";

        if (leg.statType === "shots") leg.apiStat = shots;
        else if (leg.statType === "goals") leg.apiStat = goals;
        else if (leg.statType === "assists") leg.apiStat = assists;
        else if (leg.statType === "blocks") leg.apiStat = blocks;
        else if (leg.statType === "hits") leg.apiStat = hits;
        else leg.apiStat = points;

        leg.subDetail = `${goals}G, ${assists}A • ${shots} SOG${toi ? ` • ${toi} TOI` : ''}`;
        count++;
      }
    });
  }
  return count;
}

// Auto-Polling Loop (every 20 seconds for both Top Scoreboard Ticker & Live Tracker)
let pollInterval = null;
function toggleAutoPoll() {
  const enabled = DOM.autoPollToggle ? DOM.autoPollToggle.checked : true;
  if (enabled) {
    if (!pollInterval) {
      pollInterval = setInterval(() => {
        fetchAllLiveStats(false);
        fetchFridayNhlGames(state.currentFridayStr, true);
      }, 20000);
    }
  } else if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// =============================================================================
// 9. FRIDAY NHL GAMES FETCH (SCOREBOARD TICKER & MATCHUPS EXPLORER)
// =============================================================================
async function fetchFridayNhlGames(dateStr, isSilentRefresh = false) {
  if (!isSilentRefresh) {
    let gamesList = getFallbackGames(dateStr);
    state.games = gamesList;
    DOM.tickerGamesCount.textContent = `${gamesList.length} GAME${gamesList.length === 1 ? '' : 'S'}`;
    renderGamesTicker(gamesList);
    renderMatchupsPanel(gamesList);
    populateGameSelect(gamesList);
  }

  const compactDate = dateStr.replace(/-/g, '');
  const espnScheduleUrl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${compactDate}`;

  try {
    const res = await fetch(espnScheduleUrl);
    if (res.ok) {
      const data = await res.json();
      const events = data.events || [];
      if (events.length > 0) {
        const gamesList = events.map(ev => {
          const comp = ev.competitions?.[0] || {};
          const competitors = comp.competitors || [];
          const awayComp = competitors.find(c => c.homeAway === 'away') || competitors[0] || {};
          const homeComp = competitors.find(c => c.homeAway === 'home') || competitors[1] || {};
          const awayAbbrev = normalizeTeamAbbr(awayComp.team?.abbreviation || 'NHL');
          const homeAbbrev = normalizeTeamAbbr(homeComp.team?.abbreviation || 'NHL');

          const stateType = ev.status?.type?.state || 'pre'; // 'pre', 'in', 'post'
          const statusDetail = ev.status?.type?.shortDetail || '';
          const awayScore = parseInt(awayComp.score || '0', 10) || 0;
          const homeScore = parseInt(homeComp.score || '0', 10) || 0;

          const getStatVal = (compObj, statName) => {
            const st = (compObj.statistics || []).find(s => s.name === statName || s.abbreviation === statName);
            return st ? (parseInt(st.displayValue, 10) || 0) : null;
          };
          const awaySaves = getStatVal(awayComp, 'saves');
          const homeSaves = getStatVal(homeComp, 'saves');

          // Preserve any exact SOG already fetched from boxscore summary
          const prevGame = (state.games || []).find(pg => pg.away?.abbrev === awayAbbrev && pg.home?.abbrev === homeAbbrev);
          const awaySog = prevGame?.away?.sog ?? (homeSaves !== null ? awayScore + homeSaves : null);
          const homeSog = prevGame?.home?.sog ?? (awaySaves !== null ? homeScore + awaySaves : null);

          return {
            id: ev.id,
            startTimeUTC: ev.date,
            venue: comp.venue?.fullName || 'NHL Arena',
            state: stateType,
            statusDetail: statusDetail,
            away: {
              abbrev: awayAbbrev,
              name: awayComp.team?.shortDisplayName || awayAbbrev,
              place: awayComp.team?.location || '',
              logo: awayComp.team?.logo || `https://assets.nhle.com/logos/nhl/svg/${awayAbbrev}_light.svg`,
              score: awayScore,
              sog: awaySog
            },
            home: {
              abbrev: homeAbbrev,
              name: homeComp.team?.shortDisplayName || homeAbbrev,
              place: homeComp.team?.location || '',
              logo: homeComp.team?.logo || `https://assets.nhle.com/logos/nhl/svg/${homeAbbrev}_light.svg`,
              score: homeScore,
              sog: homeSog
            }
          };
        });
        state.games = gamesList;
        DOM.tickerGamesCount.textContent = `${gamesList.length} GAME${gamesList.length === 1 ? '' : 'S'}`;
        renderGamesTicker(gamesList);
        renderMatchupsPanel(gamesList);
        if (!isSilentRefresh) populateGameSelect(gamesList);
      }
    }
  } catch (err) {
    // Fallback games already rendered above
  }
}

function parseNhlScheduleData(data, targetDateStr) {
  const games = [];
  if (!data || !data.gameWeek) return games;

  const dayObj = data.gameWeek.find(d => d.date === targetDateStr) || 
                 data.gameWeek.find(d => d.dayAbbrev === 'FRI');

  if (dayObj && dayObj.games) {
    dayObj.games.forEach(g => {
      games.push({
        id: g.id,
        startTimeUTC: g.startTimeUTC,
        venue: g.venue ? g.venue.default : 'NHL Arena',
        away: {
          abbrev: g.awayTeam.abbrev,
          name: g.awayTeam.commonName ? g.awayTeam.commonName.default : g.awayTeam.abbrev,
          place: g.awayTeam.placeName ? g.awayTeam.placeName.default : '',
          logo: g.awayTeam.logo || `https://assets.nhle.com/logos/nhl/svg/${g.awayTeam.abbrev}_light.svg`
        },
        home: {
          abbrev: g.homeTeam.abbrev,
          name: g.homeTeam.commonName ? g.homeTeam.commonName.default : g.homeTeam.abbrev,
          place: g.homeTeam.placeName ? g.homeTeam.placeName.default : '',
          logo: g.homeTeam.logo || `https://assets.nhle.com/logos/nhl/svg/${g.homeTeam.abbrev}_light.svg`
        }
      });
    });
  }
  return games;
}

function getFallbackGames(dateStr) {
  if (dateStr === '2026-10-16') {
    return [
      {
        id: 2026020138,
        startTimeUTC: `${dateStr}T23:00:00Z`,
        venue: 'Ball Arena',
        away: { abbrev: 'PIT', name: 'Penguins', place: 'Pittsburgh', logo: 'https://assets.nhle.com/logos/nhl/svg/PIT_light.svg' },
        home: { abbrev: 'COL', name: 'Avalanche', place: 'Colorado', logo: 'https://assets.nhle.com/logos/nhl/svg/COL_light.svg' }
      },
      {
        id: 2026020139,
        startTimeUTC: `${dateStr}T02:00:00Z`,
        venue: 'Honda Center',
        away: { abbrev: 'BOS', name: 'Bruins', place: 'Boston', logo: 'https://assets.nhle.com/logos/nhl/svg/BOS_light.svg' },
        home: { abbrev: 'ANA', name: 'Ducks', place: 'Anaheim', logo: 'https://assets.nhle.com/logos/nhl/svg/ANA_light.svg' }
      }
    ];
  }
  if (dateStr === '2026-10-23') {
    return [
      {
        id: 2026020160,
        startTimeUTC: `${dateStr}T00:30:00Z`,
        venue: 'United Center',
        away: { abbrev: 'MTL', name: 'Canadiens', place: 'Montreal', logo: 'https://assets.nhle.com/logos/nhl/svg/MTL_light.svg' },
        home: { abbrev: 'CHI', name: 'Blackhawks', place: 'Chicago', logo: 'https://assets.nhle.com/logos/nhl/svg/CHI_light.svg' }
      },
      {
        id: 2026020161,
        startTimeUTC: `${dateStr}T01:00:00Z`,
        venue: 'Ball Arena',
        away: { abbrev: 'TBL', name: 'Lightning', place: 'Tampa Bay', logo: 'https://assets.nhle.com/logos/nhl/svg/TBL_light.svg' },
        home: { abbrev: 'COL', name: 'Avalanche', place: 'Colorado', logo: 'https://assets.nhle.com/logos/nhl/svg/COL_light.svg' }
      }
    ];
  }
  return [
    {
      id: 2026020180,
      startTimeUTC: `${dateStr}T22:00:00Z`,
      venue: 'T-Mobile Arena',
      away: { abbrev: 'NJD', name: 'Devils', place: 'New Jersey', logo: 'https://assets.nhle.com/logos/nhl/svg/NJD_light.svg' },
      home: { abbrev: 'VGK', name: 'Golden Knights', place: 'Vegas', logo: 'https://assets.nhle.com/logos/nhl/svg/VGK_light.svg' }
    },
    {
      id: 2026020181,
      startTimeUTC: `${dateStr}T23:00:00Z`,
      venue: 'Amerant Bank Arena',
      away: { abbrev: 'WPG', name: 'Jets', place: 'Winnipeg', logo: 'https://assets.nhle.com/logos/nhl/svg/WPG_light.svg' },
      home: { abbrev: 'FLA', name: 'Panthers', place: 'Florida', logo: 'https://assets.nhle.com/logos/nhl/svg/FLA_light.svg' }
    },
    {
      id: 2026020182,
      startTimeUTC: `${dateStr}T00:00:00Z`,
      venue: 'Scotiabank Saddledome',
      away: { abbrev: 'SEA', name: 'Kraken', place: 'Seattle', logo: 'https://assets.nhle.com/logos/nhl/svg/SEA_light.svg' },
      home: { abbrev: 'CGY', name: 'Flames', place: 'Calgary', logo: 'https://assets.nhle.com/logos/nhl/svg/CGY_light.svg' }
    }
  ];
}

function renderGamesTicker(games) {
  if (!games || games.length === 0) {
    DOM.gamesTicker.innerHTML = `<div class="ticker-loading">No scheduled Friday games found.</div>`;
    return;
  }

  DOM.gamesTicker.innerHTML = games.map(g => {
    const timeStr = formatGameTime(g.startTimeUTC);
    const isLive = g.state === 'in';
    const isFinal = g.state === 'post';
    const showScores = isLive || isFinal || g.away.score !== undefined || g.home.score !== undefined;
    const awayScore = g.away.score ?? 0;
    const homeScore = g.home.score ?? 0;
    const hasSog = g.away.sog !== null && g.away.sog !== undefined && g.home.sog !== null && g.home.sog !== undefined;

    const topStatusHtml = isLive
      ? `<div class="ticker-time live"><span class="ticker-live-dot"></span>${g.statusDetail || 'LIVE'}</div>`
      : (isFinal
        ? `<div class="ticker-time">${g.statusDetail || 'FINAL'}</div>`
        : `<div class="ticker-time">${timeStr}</div>`);

    const subStatusHtml = hasSog
      ? `<div class="ticker-state">SOG ${g.away.sog}-${g.home.sog}</div>`
      : `<div class="ticker-state">${isLive ? 'ON ICE' : (isFinal ? 'FINAL' : 'SOG 0-0')}</div>`;

    return `
      <div class="ticker-game-chip" data-game="${g.away.abbrev} @ ${g.home.abbrev}">
        <div class="ticker-teams">
          <div class="ticker-team-line">
            <div class="ticker-team-left">
              <img src="${g.away.logo}" class="ticker-team-logo" alt="${g.away.abbrev}" onerror="this.style.display='none'" />
              <span class="ticker-team-abbrev">${g.away.abbrev}</span>
            </div>
            ${showScores ? `<span class="ticker-score ${awayScore > homeScore ? 'leading' : ''}">${awayScore}</span>` : ''}
          </div>
          <div class="ticker-team-line">
            <div class="ticker-team-left">
              <img src="${g.home.logo}" class="ticker-team-logo" alt="${g.home.abbrev}" onerror="this.style.display='none'" />
              <span class="ticker-team-abbrev">${g.home.abbrev}</span>
            </div>
            ${showScores ? `<span class="ticker-score ${homeScore > awayScore ? 'leading' : ''}">${homeScore}</span>` : ''}
          </div>
        </div>
        <div class="ticker-status">
          ${topStatusHtml}
          ${subStatusHtml}
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.ticker-game-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const gameTitle = chip.getAttribute('data-game');
      openLegModal(null, gameTitle);
    });
  });
}

function renderMatchupsPanel(games) {
  DOM.scheduleDateSubtitle.textContent = formatDateDisplay(state.currentFriday);

  if (!games || games.length === 0) {
    DOM.matchupsList.innerHTML = `<div class="empty-state-text" style="padding: 10px;">No games listed for this Friday. Enter custom matchups when submitting.</div>`;
    return;
  }

  DOM.matchupsList.innerHTML = games.map(g => {
    const timeStr = formatGameTime(g.startTimeUTC);
    const gameTitle = `${g.away.abbrev} @ ${g.home.abbrev}`;
    const isLive = g.state === 'in';
    const isFinal = g.state === 'post';
    const hasSog = g.away.sog !== null && g.away.sog !== undefined && g.home.sog !== null && g.home.sog !== undefined;
    const scoreBadge = (isLive || isFinal)
      ? `${g.away.abbrev} ${g.away.score ?? 0} - ${g.home.abbrev} ${g.home.score ?? 0} (${g.statusDetail || (isFinal ? 'FINAL' : 'LIVE')})${hasSog ? ` • SOG ${g.away.sog}-${g.home.sog}` : ''}`
      : timeStr;

    return `
      <div class="matchup-row-card">
        <div class="teams-strip">
          <div class="team-item">
            <img src="${g.away.logo}" class="team-logo-small" alt="${g.away.abbrev}" onerror="this.style.display='none'" />
            <span class="team-name-bold">${g.away.place} ${g.away.name}</span>
          </div>
          <span class="vs-text">@</span>
          <div class="team-item">
            <img src="${g.home.logo}" class="team-logo-small" alt="${g.home.abbrev}" onerror="this.style.display='none'" />
            <span class="team-name-bold">${g.home.place} ${g.home.name}</span>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 12px;">
          <div class="matchup-time-box">${scoreBadge}</div>
          <button class="btn-pick-matchup" data-game="${gameTitle}">+ Pick Leg</button>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.btn-pick-matchup').forEach(btn => {
    btn.addEventListener('click', () => {
      const gameTitle = btn.getAttribute('data-game');
      openLegModal(null, gameTitle);
    });
  });
}

function populateGameSelect(games) {
  DOM.gameSelect.innerHTML = '<option value="">Select a Friday game...</option>';
  games.forEach(g => {
    const title = `${g.away.abbrev} ${g.away.name} @ ${g.home.abbrev} ${g.home.name}`;
    const opt = document.createElement('option');
    opt.value = title;
    opt.textContent = title;
    DOM.gameSelect.appendChild(opt);
  });
  const customOpt = document.createElement('option');
  customOpt.value = 'Custom NHL Matchup';
  customOpt.textContent = 'Custom / Other NHL Game';
  DOM.gameSelect.appendChild(customOpt);
}

function formatGameTime(utcString) {
  if (!utcString) return '7:00 PM';
  try {
    const d = new Date(utcString);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch (e) {
    return '7:00 PM ET';
  }
}

const DEFAULT_OCT30_PICKS = {
  Axel: { user_name: 'Axel', boy: 'Axel', game: 'WPG @ FLA', game_title: 'WPG Jets @ FLA Panthers', bet_type: 'Player Prop', pick_text: 'Carter Verhaeghe — Over 0.5 Points', odds: '-160', chirp: 'witnessed him terrorize winnipeg on tuesday, fear he may do it again', locked: true },
  Jackson: { user_name: 'Jackson', boy: 'Jackson', game: 'WPG @ FLA', game_title: 'WPG Jets @ FLA Panthers', bet_type: 'Player Prop', pick_text: 'Sam Bennett — Over 2.5 Shots on Goal', odds: '-105', chirp: 'Centring the goons he’s shootin tn', locked: true },
  Alex: { user_name: 'Alex', boy: 'Alex', game: 'WPG @ FLA', game_title: 'WPG Jets @ FLA Panthers', bet_type: 'Player Prop', pick_text: 'Seth Jones — Over 2.5 Shots on Goal', odds: '+115', chirp: '', locked: true },
  Ben: { user_name: 'Ben', boy: 'Ben', game: 'SEA @ CGY', game_title: 'SEA Kraken @ CGY Flames', bet_type: 'Player Prop', pick_text: 'Bobby McMann — Over 0.5 Points', odds: '-120', chirp: '', locked: true },
  Will: { user_name: 'Will', boy: 'Will', game: 'SEA @ CGY', game_title: 'SEA Kraken @ CGY Flames', bet_type: 'Player Prop', pick_text: 'Chandler Stephenson — Over 0.5 Assists', odds: '+155', chirp: 'Wolf gonna shit the bed! The Flames will be extinguished by the Kraken!', locked: true },
  Edward: { user_name: 'Edward', boy: 'Edward', game: 'SEA @ CGY', game_title: 'SEA Kraken @ CGY Flames', bet_type: 'Player Prop', pick_text: 'Brandon Montour — Over 0.5 Points', odds: '+105', chirp: '4-game point streak, 7 points in last 10, playing the flames??? Free money', locked: true }
};

const DEFAULT_OCT23_PICKS = {
  Edward: { user_name: 'Edward', boy: 'Edward', game: 'MTL @ CHI', game_title: 'MTL Canadiens @ CHI Blackhawks', betType: 'Player Prop', pick_text: 'Over 3.5 Shots on Goal', odds: '-145', chirp: "He’s 7/9 on this line through the season", locked: true },
  Will: { user_name: 'Will', boy: 'Will', game: 'MTL @ CHI', game_title: 'MTL Canadiens @ CHI Blackhawks', betType: 'Player Prop', pick_text: 'Over 0.5 Total Points', odds: '-175', chirp: "Free money boys, goalie on a cold streak…", locked: true },
  Ben: { user_name: 'Ben', boy: 'Ben', game: 'MTL @ CHI', game_title: 'MTL Canadiens @ CHI Blackhawks', betType: 'Player Prop', pick_text: 'Over 1.5 Total Shots On Goal', odds: '-130', chirp: "Hutson running the entire show from the point", locked: true },
  Jackson: { user_name: 'Jackson', boy: 'Jackson', game: 'TBL @ COL', game_title: 'TBL Lightning @ COL Avalanche', betType: 'Player Prop', pick_text: 'Over 3.5 Total Shots On Goal', odds: '-145', chirp: "Nate Dogg let 'em fly 🔥", locked: true },
  Alex: { user_name: 'Alex', boy: 'Alex', game: 'TBL @ COL', game_title: 'TBL Lightning @ COL Avalanche', betType: 'Player Prop', pick_text: 'Over 0.5 Total Goals', odds: '+170', chirp: "My Kuchy quakinnnn 💅😮‍💨", locked: true },
  Axel: { user_name: 'Axel', boy: 'Axel', game: 'TBL @ COL', game_title: 'TBL Lightning @ COL Avalanche', betType: 'Player Prop', pick_text: 'Over 0.5 Total Points', odds: '-175', chirp: "the saskatoon man is showing out tonight", locked: true }
};

const DEFAULT_OCT16_PICKS = {
  Axel: { boy: 'Axel', game: 'PIT @ COL', betType: 'prop', pick_text: 'Brock Nelson 1+ Points', odds: '-140', chirp: 'Axel locking in from the States' },
  Jackson: { boy: 'Jackson', game: 'PIT @ COL', betType: 'prop', pick_text: 'Nathan MacKinnon 4+ Shots', odds: '-130', chirp: 'High volume night in Denver' },
  Will: { boy: 'Will', game: 'BOS @ ANA', betType: 'prop', pick_text: 'Pavel Zacha 1+ Points', odds: '+120', chirp: 'Top line center duties' },
  Alex: { boy: 'Alex', game: 'BOS @ ANA', betType: 'prop', pick_text: 'Beckett Sennecke 1+ Points', odds: '+110', chirp: 'Rookie phenom power' },
  Ben: { boy: 'Ben', game: 'BOS @ ANA', betType: 'prop', pick_text: 'Leo Carlsson 1+ Points', odds: '-115', chirp: 'Sold the parlay' }
};

const DEFAULT_MASTER_SLIPS = {
  '2026-10-16': {
    id: '2026-10-16',
    week_date: '2026-10-16',
    bettor_name: 'Axel',
    status: 'placed',
    stake: 25,
    total_odds: '+950',
    potential_payout: 262.50,
    notes: 'Placed by Axel'
  },
  '2026-10-23': {
    id: '2026-10-23',
    week_date: '2026-10-23',
    bettor_name: 'Jackson',
    status: 'placed',
    stake: 30,
    total_odds: '+1261',
    potential_payout: 408.35,
    notes: 'Placed on FanDuel by Jackson'
  },
  '2026-10-30': {
    id: '2026-10-30',
    week_date: '2026-10-30',
    bettor_name: 'Will',
    status: 'placed',
    stake: 30,
    total_odds: '+2394',
    potential_payout: 748.20,
    notes: 'Placed on BET99 by Will (SGP+ @ +2394)'
  }
};

function loadLocalData(dateStr) {
  state.masterSlip = DEFAULT_MASTER_SLIPS[dateStr] ? JSON.parse(JSON.stringify(DEFAULT_MASTER_SLIPS[dateStr])) : null;

  const key = `bet_the_show_${dateStr}_v5`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.legs = parsed.legs || {};
      state.stake = parsed.stake || (dateStr === '2026-10-16' ? 25 : 30);
      state.isPlaced = !!parsed.isPlaced;
      return;
    } catch (e) {}
  }

  // Prepopulate if opening default week
  if (dateStr === '2026-10-30') {
    state.legs = JSON.parse(JSON.stringify(DEFAULT_OCT30_PICKS));
    state.stake = 30;
    state.isPlaced = true;
  } else if (dateStr === '2026-10-23') {
    state.legs = JSON.parse(JSON.stringify(DEFAULT_OCT23_PICKS));
    state.stake = 30;
    state.isPlaced = true;
  } else if (dateStr === '2026-10-16') {
    state.legs = JSON.parse(JSON.stringify(DEFAULT_OCT16_PICKS));
    state.stake = 25;
    state.isPlaced = true;
  } else {
    state.legs = {};
    state.stake = 30;
    state.isPlaced = false;
  }
  saveLocalData(dateStr);
}

function saveLocalData(dateStr) {
  const key = `bet_the_show_${dateStr}_v5`;
  const payload = {
    date: dateStr,
    legs: state.legs,
    stake: state.stake,
    isPlaced: state.isPlaced,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

function initSupabase() {
  const url = localStorage.getItem('bts_supabase_url') || DEFAULT_SUPABASE_CONFIG.url;
  const key = localStorage.getItem('bts_supabase_key') || DEFAULT_SUPABASE_CONFIG.key;

  if (window.supabase && url && key) {
    try {
      state.supabase = window.supabase.createClient(url, key);
      state.isLiveSync = true;
      DOM.syncStatusBtn.classList.add('live');
      DOM.syncStatusText.textContent = 'Cloud Live';
      setupSupabaseRealtime();
      fetchSupabaseParlay(state.currentFridayStr);
    } catch (e) {
      console.warn('Supabase connect failed:', e);
      state.isLiveSync = false;
      DOM.syncStatusBtn.classList.remove('live');
      DOM.syncStatusText.textContent = 'Local Only';
    }
  }
}

async function fetchSupabaseParlay(dateStr) {
  if (!state.supabase) return;
  try {
    const { data: legs, error } = await state.supabase
      .from('parlay_legs')
      .select('*')
      .eq('week_date', dateStr);

    if (error) {
      console.warn('Supabase fetch error:', error);
      return;
    }

    if (legs && Array.isArray(legs) && legs.length > 0) {
      const map = {};
      legs.forEach(l => { map[l.user_name] = l; });
      state.legs = map;
      saveLocalData(dateStr);
    }

    try {
      const { data: master } = await state.supabase
        .from('friday_parlays')
        .select('*')
        .eq('id', dateStr)
        .maybeSingle();

      if (master) {
        state.masterSlip = master;
        if (master.status === 'placed') {
          state.isPlaced = true;
          saveLocalData(dateStr);
          if (DOM.markPlacedText) DOM.markPlacedText.textContent = 'Placed on Sportsbook!';
          if (DOM.markPlacedBtn) DOM.markPlacedBtn.classList.add('placed');
        }
      }
    } catch (errMaster) {}

    if (state.isPlaced) {
      syncTrackerFromRealPicks();
      saveTrackerData();
    }

    renderAll();
    renderTracker();
    if (state.isPlaced) {
      fetchAllLiveStats(false);
    }
  } catch (e) {
    console.error('Supabase query error:', e);
  }
}

function setupSupabaseRealtime() {
  if (!state.supabase) return;
  try {
    state.supabase
      .channel('public:parlay_legs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parlay_legs' }, payload => {
        const row = payload.new || payload.old;
        if (row && row.week_date === state.currentFridayStr) {
          if (payload.eventType === 'DELETE') {
            delete state.legs[row.user_name];
          } else {
            state.legs[row.user_name] = payload.new;
          }
          saveLocalData(state.currentFridayStr);
          playSound('lock');
          renderAll();
          showToast(`${row.user_name} locked in their pick live!`, 'fire');
        }
      })
      .subscribe();
  } catch (e) {
    console.warn('Supabase realtime error:', e);
  }
}

async function persistLeg(legObj) {
  state.legs[legObj.user_name] = legObj;
  saveLocalData(state.currentFridayStr);

  // Keep state.statsHistory in sync if this date matches a week in history
  const histWeek = state.statsHistory.find(w => w.dateStr === state.currentFridayStr);
  if (histWeek) {
    const existingLeg = histWeek.legs.find(l => l.boy === legObj.user_name);
    if (existingLeg) {
      existingLeg.pick = legObj.pick_text;
      existingLeg.odds = legObj.odds;
    } else {
      histWeek.legs.push({
        boy: legObj.user_name,
        pick: legObj.pick_text,
        odds: legObj.odds,
        result: 'pending'
      });
    }
    saveStatsHistory();
  }

  if (state.supabase) {
    try {
      await state.supabase
        .from('parlay_legs')
        .upsert({
          week_date: state.currentFridayStr,
          user_name: legObj.user_name,
          game_title: legObj.game_title,
          pick_text: legObj.pick_text,
          odds: legObj.odds,
          bet_type: legObj.bet_type,
          chirp: legObj.chirp,
          locked: true
        }, { onConflict: 'week_date,user_name' });
    } catch (e) {
      console.error('Supabase persist error:', e);
    }
  }
}

async function deleteLeg(userName) {
  delete state.legs[userName];
  saveLocalData(state.currentFridayStr);

  const histWeek = state.statsHistory.find(w => w.dateStr === state.currentFridayStr);
  if (histWeek) {
    const existingLeg = histWeek.legs.find(l => l.boy === userName);
    if (existingLeg) {
      existingLeg.result = 'pending';
    }
    saveStatsHistory();
  }

  if (state.supabase) {
    try {
      await state.supabase
        .from('parlay_legs')
        .delete()
        .eq('week_date', state.currentFridayStr)
        .eq('user_name', userName);
    } catch (e) {
      console.error('Supabase delete error:', e);
    }
  }
  renderAll();
  showToast(`Removed ${userName}'s pick`, 'trash');
}

// =============================================================================
// 11. RENDER SLIP BUILDER & BETTOR ROTATION
// =============================================================================
function renderSquadLegs() {
  const targetFri = state.currentFriday || getActiveFridayDate();
  const bettorThisWeek = getBettorForFriday(targetFri);
  const analytics = computeSquadAnalytics();

  DOM.legsCardsContainer.innerHTML = SQUAD.map(boy => {
    const pInfo = analytics.players.find(p => p.name === boy.name);
    const acc = pInfo ? pInfo.accolade : {
      title: 'Contender',
      pillClass: 'contender',
      icon: 'puck',
      statTag: '0-0',
      blurb: 'Friday NHL Pick',
      statClass: 'debut'
    };

    if (state.currentFridayStr === '2026-10-16' && boy.name === 'Edward') {
      return `
        <div class="leg-card-nhl empty" style="opacity: 0.6; border-style: dashed;">
          <div class="leg-card-top">
            <div class="boy-info-group">
              <div class="boy-jersey" style="opacity: 0.4;">ED</div>
              <div>
                <div class="boy-title-line">
                  <span class="boy-name-text">Edward</span>
                  <span class="title-tag-pill debut">${getIcon('spark')} Joined Week 2</span>
                </div>
                <div class="boy-sub-role">
                  <span class="boy-stat-tag debut">N/A</span>
                  <span class="boy-stat-divider">•</span>
                  <span class="boy-blurb-text">Not in group for Week 1 (5-boy $25 ticket)</span>
                </div>
              </div>
            </div>
            <span class="leg-status-tag" style="background:var(--nhl-subcard); color:var(--text-secondary); border:1px solid var(--border-subtle);">N/A (Joined W2)</span>
          </div>
        </div>
      `;
    }

    const leg = state.legs[boy.name];
    const isLocked = !!(leg && leg.odds);
    const isBettor = (boy.name === bettorThisWeek.name);

    if (isLocked) {
      const decOdds = americanToDecimal(leg.odds).toFixed(2);
      return `
        <div class="leg-card-nhl locked">
          <div class="leg-card-top">
            <div class="boy-info-group">
              <div class="boy-jersey">${boy.initials}</div>
              <div>
                <div class="boy-title-line">
                  <span class="boy-name-text">${boy.name}</span>
                  <span class="title-tag-pill ${acc.pillClass}">${getIcon(acc.icon)} ${acc.title}</span>
                  ${isBettor ? `<span class="bettor-tag-inline">${getIcon('crown')} BETTOR ON DECK</span>` : ''}
                </div>
                <div class="boy-sub-role">
                  <span class="boy-stat-tag ${acc.statClass}">${acc.statTag}</span>
                  <span class="boy-stat-divider">•</span>
                  <span class="boy-blurb-text">${acc.blurb}</span>
                </div>
              </div>
            </div>

            <span class="leg-status-tag locked">${getIcon('check')} LOCKED IN</span>
          </div>

          <div class="leg-pick-box">
            <div>
              <div class="matchup-tag">${escapeHTML(leg.game_title || 'NHL GAME')}</div>
              <div class="pick-headline">${escapeHTML(leg.pick_text)}</div>
            </div>
            <div class="odds-pill-box">
              <div class="odds-num">${leg.odds.startsWith('-') || leg.odds.startsWith('+') ? leg.odds : '+' + leg.odds}</div>
              <div class="odds-dec-sub">${decOdds}x</div>
            </div>
          </div>

          ${leg.chirp ? `
            <div class="leg-chirp-row">
              <span class="leg-chirp-icon">${getIcon('quote')}</span>
              <span>"${escapeHTML(leg.chirp)}"</span>
            </div>
          ` : ''}

          <div class="leg-card-bottom-actions">
            <button class="action-icon-btn edit-leg-btn" data-boy="${boy.name}" title="Edit pick">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="action-icon-btn danger delete-leg-btn" data-boy="${boy.name}" title="Remove pick">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="leg-card-nhl empty">
          <div class="leg-card-top">
            <div class="boy-info-group">
              <div class="boy-jersey" style="opacity: 0.5;">${boy.initials}</div>
              <div>
                <div class="boy-title-line">
                  <span class="boy-name-text">${boy.name}</span>
                  <span class="title-tag-pill ${acc.pillClass}">${getIcon(acc.icon)} ${acc.title}</span>
                  ${isBettor ? `<span class="bettor-tag-inline">${getIcon('crown')} BETTOR ON DECK</span>` : ''}
                </div>
                <div class="boy-sub-role">
                  <span class="boy-stat-tag ${acc.statClass}">${acc.statTag}</span>
                  <span class="boy-stat-divider">•</span>
                  <span class="boy-blurb-text">${acc.blurb}</span>
                </div>
              </div>
            </div>

            <span class="leg-status-tag waiting">${getIcon('clock')} PENDING</span>
          </div>

          <div class="empty-action-row">
            <span class="empty-state-text">No pick locked in yet for Week ${state.weekNumber || 3}.</span>
            <button class="lock-in-leg-btn add-leg-btn" data-boy="${boy.name}">
              + Lock In Leg
            </button>
          </div>
        </div>
      `;
    }
  }).join('');

  document.querySelectorAll('.add-leg-btn').forEach(btn => {
    btn.addEventListener('click', () => openLegModal(btn.getAttribute('data-boy')));
  });

  document.querySelectorAll('.edit-leg-btn').forEach(btn => {
    btn.addEventListener('click', () => openLegModal(btn.getAttribute('data-boy')));
  });

  document.querySelectorAll('.delete-leg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const boy = btn.getAttribute('data-boy');
      if (confirm(`Remove ${boy}'s pick?`)) deleteLeg(boy);
    });
  });
}

function renderBettorBanner() {
  const bettor = getBettorForFriday(state.currentFriday);
  const diffWeeks = getFridayDiffWeeks(state.currentFriday);
  const weekNum = diffWeeks + 1;
  state.weekNumber = weekNum;

  DOM.weekPill.textContent = `WEEK ${weekNum} OF THE REGULAR SEASON`;
  DOM.bettorName.textContent = bettor.name;
  DOM.bettorAvatar.textContent = bettor.initials;
  
  if (weekNum === 2) {
    DOM.bettorDesc.innerHTML = `Week 1 was placed by Axel. This week it's <strong>${bettor.name}</strong>'s turn to place the 6-leg parlay ticket ($30 total wager) on his sportsbook account.`;
  } else {
    DOM.bettorDesc.innerHTML = `It's <strong>${bettor.name}</strong>'s turn in the 6-week rotation to place this week's 6-leg ticket ($30 total wager) on his sportsbook account.`;
  }

  const legsCount = Object.keys(state.legs).length;
  DOM.slipProgressText.textContent = `${legsCount} / 6 LEGS`;
  DOM.slipProgressBar.style.width = `${(legsCount / 6) * 100}%`;

  if (legsCount === 6) {
    DOM.slipStatusMsg.innerHTML = `<span class="msg-icon">${getIcon('fire')}</span> All 6 legs locked in! ${bettor.name} is clear to submit the $30 ticket to the book!`;
    DOM.slipStatusMsg.style.color = 'var(--b365-green)';
  } else if (legsCount === 0) {
    DOM.slipStatusMsg.textContent = `No picks locked in yet for Week ${weekNum}. Let's build the ${state.stake} ticket!`;
    DOM.slipStatusMsg.style.color = 'var(--text-muted)';
  } else {
    DOM.slipStatusMsg.textContent = `Need ${6 - legsCount} more leg${6 - legsCount === 1 ? '' : 's'} to complete the 6-legger ($30 stake).`;
    DOM.slipStatusMsg.style.color = 'var(--gold-odds)';
  }

  updateCountdown();
}

function updateCountdown() {
  const target = new Date(state.currentFriday);
  target.setHours(19, 0, 0, 0); // 7:00 PM ET
  const diff = target - new Date();

  if (diff <= 0) {
    DOM.puckDropCountdown.innerHTML = `<span class="msg-icon">${getIcon('puck')}</span> Puck Drop Live / Completed`;
  } else {
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    DOM.puckDropCountdown.innerHTML = `<span class="msg-icon">${getIcon('clock')}</span> ${days}d ${hours}h ${mins}m until Friday puck drop`;
  }
}

function renderSportsbookTicket() {
  const legsList = SQUAD.map(b => state.legs[b.name]).filter(Boolean);
  const totals = calculateParlayTotals(legsList, state.stake);

  const hasValidMasterOdds = state.masterSlip && state.masterSlip.total_odds && state.masterSlip.total_odds !== '--';
  const displayOdds = hasValidMasterOdds ? state.masterSlip.total_odds : (state.currentFridayStr === '2026-10-30' ? '+2394' : totals.american);
  const displayPayout = (state.masterSlip && state.masterSlip.potential_payout) ? parseFloat(state.masterSlip.potential_payout) : (state.currentFridayStr === '2026-10-30' ? 748.20 : totals.payout);
  const displayProfit = displayPayout - state.stake;
  const displayDecimal = displayPayout / (state.stake || 1);

  DOM.totalAmericanOdds.textContent = displayOdds;
  DOM.totalDecimalOdds.textContent = `${displayDecimal.toFixed(2)}x`;
  DOM.potentialPayoutDisplay.textContent = `$${displayPayout.toFixed(2)}`;
  DOM.potentialProfitDisplay.textContent = `+$${displayProfit.toFixed(2)} net profit`;
  DOM.ticketDateText.textContent = formatDateDisplay(state.currentFriday);
  DOM.ticketReferenceCode.textContent = `SLIP #BTS-${state.currentFridayStr.replace(/-/g, '')}-W${state.weekNumber}`;

  if (totals.count === 6) {
    DOM.ticketStatusBadge.textContent = 'SLIP READY (6/6)';
    DOM.ticketStatusBadge.className = 'ticket-badge ready';
  } else {
    DOM.ticketStatusBadge.textContent = `${totals.count}/6 LEGS`;
    DOM.ticketStatusBadge.className = 'ticket-badge';
  }

  DOM.ticketLegsSummary.innerHTML = SQUAD.map(boy => {
    const leg = state.legs[boy.name];
    if (leg && leg.odds) {
      return `
        <div class="ticket-leg-row">
          <span class="t-boy-name">${boy.name}</span>
          <span class="t-pick-desc" title="${escapeHTML(leg.pick_text)}">${escapeHTML(leg.pick_text)}</span>
          <span class="t-odds">${leg.odds}</span>
        </div>
      `;
    } else {
      return `
        <div class="ticket-leg-row" style="opacity: 0.4;">
          <span class="t-boy-name">${boy.name}</span>
          <span class="t-pick-desc">Waiting for pick...</span>
          <span class="t-odds">--</span>
        </div>
      `;
    }
  }).join('');

  if (state.isPlaced) {
    DOM.markPlacedBtn.classList.remove('outline');
    DOM.markPlacedBtn.classList.add('b365-btn-green');
    DOM.markPlacedText.innerHTML = `<span class="bts-icon" style="margin-right:4px;">${getIcon('check')}</span> Bet Placed • Click to View Live Tracker <span class="placed-dot-pulsing"></span>`;
  } else {
    const bettor = getBettorForFriday(state.currentFriday);
    DOM.markPlacedBtn.classList.add('b365-btn-green');
    DOM.markPlacedText.textContent = `Mark as Placed by ${bettor.name}`;
  }
}

function renderRotationSchedule() {
  const weeks = [];
  const base = new Date(state.currentFriday);

  for (let i = -1; i <= 4; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + (i * 7));
    weeks.push(d);
  }

  DOM.rotationList.innerHTML = weeks.map(fri => {
    const bettor = getBettorForFriday(fri);
    const dateFormatted = fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isCurrent = formatDateISO(fri) === state.currentFridayStr;
    const weekNum = getFridayDiffWeeks(fri) + 1;

    return `
      <div class="rot-row ${isCurrent ? 'current-week' : ''}">
        <div>
          <span class="rot-week-label">WK ${weekNum} • ${dateFormatted}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="rot-bettor-name">${bettor.name}</span>
          ${isCurrent ? `<span class="on-deck-rot-tag">${getIcon('crown')} ON DECK</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderAll() {
  DOM.currentFridayDisplay.textContent = formatDateDisplay(state.currentFriday);
  renderBettorBanner();
  renderSquadLegs();
  renderSportsbookTicket();
  renderRotationSchedule();
  renderStatsView();
  renderTracker();
}

// =============================================================================
// 12. INTERACTIVE MODALS & BET SUBMISSION
// =============================================================================
function openLegModal(defaultBoy = null, defaultGame = null) {
  DOM.legModalBackdrop.classList.add('open');

  DOM.modalBoysPicker.innerHTML = SQUAD.map(b => `
    <button type="button" class="boy-pick-btn ${defaultBoy === b.name ? 'active' : ''}" data-boy="${b.name}">
      ${b.name}
    </button>
  `).join('');

  let selected = defaultBoy || SQUAD[0].name;
  DOM.selectedBoyInput.value = selected;

  document.querySelectorAll('.boy-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.boy-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selected = btn.getAttribute('data-boy');
      DOM.selectedBoyInput.value = selected;
      loadBoyModalFields(selected);
    });
  });

  loadBoyModalFields(selected, defaultGame);
  DOM.pickTextInput.focus();
}

function loadBoyModalFields(boyName, defaultGame = null) {
  const existing = state.legs[boyName];
  if (existing) {
    DOM.modalTitle.textContent = `Edit ${boyName}'s Friday Leg`;
    DOM.pickTextInput.value = existing.pick_text || '';
    DOM.oddsInput.value = existing.odds || '';
    DOM.chirpInput.value = existing.chirp || '';
    DOM.betTypeInput.value = existing.bet_type || 'Moneyline';
    if (existing.game_title) DOM.gameSelect.value = existing.game_title;
  } else {
    DOM.modalTitle.textContent = `Lock In ${boyName}'s Friday Leg`;
    DOM.pickTextInput.value = '';
    DOM.oddsInput.value = '';
    DOM.chirpInput.value = '';
    DOM.betTypeInput.value = 'Moneyline';
    if (defaultGame) DOM.gameSelect.value = defaultGame;
  }

  document.querySelectorAll('.bet-type-btn').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-type') === DOM.betTypeInput.value);
  });
  updateOddsHelper(DOM.oddsInput.value);
}

function closeLegModal() {
  DOM.legModalBackdrop.classList.remove('open');
}

function updateOddsHelper(val) {
  const dec = americanToDecimal(val);
  if (!isNaN(dec) && dec > 1.0) {
    DOM.oddsHelper.textContent = `Decimal multiplier: ${dec.toFixed(2)}x`;
  } else {
    DOM.oddsHelper.textContent = 'Enter e.g. -130 or +125';
  }
}

// COPY SPORTSBOOK TICKET
function copySlipForSportsbook() {
  const bettor = getBettorForFriday(state.currentFriday);
  const legsList = SQUAD.map(b => state.legs[b.name]).filter(Boolean);
  const totals = calculateParlayTotals(legsList, state.stake);
  const dateFormatted = formatDateDisplay(state.currentFriday);

  let text = `[BET THE SHOW] FRIDAY NHL 6-LEGGER (${dateFormatted})\n`;
  text += `Bettor On Deck: ${bettor.name} ($${state.stake} Pool Stake • $5/Boy)\n`;
  text += `${totals.count}/6 Legs Locked In:\n\n`;

  SQUAD.forEach((boy, idx) => {
    const leg = state.legs[boy.name];
    if (leg && leg.odds) {
      text += `${idx + 1}. ${boy.name}: ${leg.pick_text} (${leg.odds})\n`;
      if (leg.chirp) text += `   • "${leg.chirp}"\n`;
    } else {
      text += `${idx + 1}. ${boy.name}: [WAITING ON PICK]\n`;
    }
  });

  text += `\n-------------------------------\n`;
  text += `Total Combined Odds: ${totals.american} (${totals.decimal.toFixed(2)}x)\n`;
  text += `Potential Payout: $${totals.payout.toFixed(2)} (+$${totals.profit.toFixed(2)} profit)\n`;
  text += `Live Slip: https://mukpostproduction-debug.github.io/friday-puck-parlay/\n`;

  navigator.clipboard.writeText(text).then(() => {
    playSound('triumph');
    if (window.confetti) confetti({ particleCount: 80, spread: 60, origin: { y: 0.85 } });
    showToast('6-Leg Slip copied! Ready to paste into sportsbook or chat', 'slip');
  });
}

// CHIRP THE BOYS
function generateGroupChirp() {
  const bettor = getBettorForFriday(state.currentFriday);
  const missing = SQUAD.filter(b => !state.legs[b.name]);

  let msg = '';
  if (missing.length === 0) {
    msg = `[BET THE SHOW] ALL 6 LEGS ARE LOCKED IN! @${bettor.name} is on deck to place the $30 ticket on his sportsbook right now! Let's get that bag boys.`;
  } else {
    const names = missing.map(b => `@${b.name}`).join(', ');
    const insults = [
      `Lock in your Friday leg before puck drop!`,
      `Stop sleeping and get your picks in. Don't sell our parlay!`,
      `We need the final legs before Friday puck drop. Lock it down!`
    ];
    const pickInsult = insults[Math.floor(Math.random() * insults.length)];
    msg = `[BET THE SHOW ALERT] ${names} — ${pickInsult} (Bettor this week: ${bettor.name})`;
  }

  navigator.clipboard.writeText(msg).then(() => {
    playSound('click');
    showToast('Chirp message copied! Paste in group chat', 'chat');
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// =============================================================================
// 13. EVENT HANDLERS & INITIALIZATION
// =============================================================================

// =============================================================================
// AUTOMATED BET SLIP INTAKE & OCR MODAL CONTROLLER
// =============================================================================
const NHL_TEAM_NAME_TO_ABBR = {
  'anaheim ducks': 'ANA Ducks', 'ducks': 'ANA Ducks',
  'boston bruins': 'BOS Bruins', 'bruins': 'BOS Bruins',
  'buffalo sabres': 'BUF Sabres', 'sabres': 'BUF Sabres',
  'calgary flames': 'CGY Flames', 'flames': 'CGY Flames',
  'carolina hurricanes': 'CAR Hurricanes', 'hurricanes': 'CAR Hurricanes',
  'chicago blackhawks': 'CHI Blackhawks', 'blackhawks': 'CHI Blackhawks',
  'colorado avalanche': 'COL Avalanche', 'avalanche': 'COL Avalanche',
  'columbus blue jackets': 'CBJ Blue Jackets', 'blue jackets': 'CBJ Blue Jackets',
  'dallas stars': 'DAL Stars', 'stars': 'DAL Stars',
  'detroit red wings': 'DET Red Wings', 'red wings': 'DET Red Wings',
  'edmonton oilers': 'EDM Oilers', 'oilers': 'EDM Oilers',
  'florida panthers': 'FLA Panthers', 'panthers': 'FLA Panthers',
  'los angeles kings': 'LAK Kings', 'kings': 'LAK Kings',
  'minnesota wild': 'MIN Wild', 'wild': 'MIN Wild',
  'montreal canadiens': 'MTL Canadiens', 'canadiens': 'MTL Canadiens',
  'nashville predators': 'NSH Predators', 'predators': 'NSH Predators',
  'new jersey devils': 'NJD Devils', 'devils': 'NJD Devils',
  'new york islanders': 'NYI Islanders', 'islanders': 'NYI Islanders',
  'new york rangers': 'NYR Rangers', 'rangers': 'NYR Rangers',
  'ottawa senators': 'OTT Senators', 'senators': 'OTT Senators',
  'philadelphia flyers': 'PHI Flyers', 'flyers': 'PHI Flyers',
  'pittsburgh penguins': 'PIT Penguins', 'penguins': 'PIT Penguins',
  'san jose sharks': 'SJS Sharks', 'sharks': 'SJS Sharks',
  'seattle kraken': 'SEA Kraken', 'kraken': 'SEA Kraken',
  'st. louis blues': 'STL Blues', 'st louis blues': 'STL Blues', 'blues': 'STL Blues',
  'tampa bay lightning': 'TBL Lightning', 'lightning': 'TBL Lightning',
  'toronto maple leafs': 'TOR Maple Leafs', 'maple leafs': 'TOR Maple Leafs',
  'utah hockey club': 'UTA Hockey Club', 'utah mammoth': 'UTA Mammoth',
  'vancouver canucks': 'VAN Canucks', 'canucks': 'VAN Canucks',
  'vegas golden knights': 'VGK Golden Knights', 'golden knights': 'VGK Golden Knights',
  'washington capitals': 'WSH Capitals', 'capitals': 'WSH Capitals',
  'winnipeg jets': 'WPG Jets', 'jets': 'WPG Jets'
};

function normalizeMatchupLine(rawLine) {
  if (!rawLine) return '';
  const cleaned = rawLine.replace(/^[^A-Za-z]+/, '').trim();
  const parts = cleaned.split(/\s*(?:@|\bvs\.?\b|\bv\.?\b)\s*/i);
  if (parts.length !== 2) return '';
  const resolveSide = (str) => {
    const low = str.toLowerCase().trim();
    if (NHL_TEAM_NAME_TO_ABBR[low]) return NHL_TEAM_NAME_TO_ABBR[low];
    for (const [k, v] of Object.entries(NHL_TEAM_NAME_TO_ABBR)) {
      if (low.includes(k)) return v;
    }
    return str.trim();
  };
  const away = resolveSide(parts[0]);
  const home = resolveSide(parts[1]);
  return `${away} @ ${home}`;
}

function normalizeMarketCategory(rawMarket) {
  const m = (rawMarket || '').toLowerCase().trim();
  if (m.includes('save') || m === 'sv') return 'Saves';
  if (m.includes('block') || m === 'blk') return 'Blocked Shots';
  if (m.includes('hit')) return 'Hits';
  if (m.includes('shot') || m === 'sog') return 'Shots on Goal';
  if (m.includes('assist') || m === 'ast') return 'Assists';
  if (m.includes('goal')) return 'Goals';
  return 'Points';
}

function parseSportsbookOcrText(text) {
  const result = {
    stake: null,
    totalOdds: null,
    payout: null,
    book: null,
    legs: []
  };

  if (!text) return result;

  // 1. Detect Sportsbook
  const low = text.toLowerCase();
  if (low.includes('bet99')) result.book = 'BET99';
  else if (low.includes('fanduel')) result.book = 'FanDuel';
  else if (low.includes('betmgm')) result.book = 'BetMGM';
  else if (low.includes('bet365')) result.book = 'Bet365';
  else if (low.includes('draftkings')) result.book = 'DraftKings';
  else if (low.includes('thescore')) result.book = 'theScore Bet';

  // 2. Extract Stake, Total Odds, and Payout
  const stakeLabelMatch = text.match(/(?:stake|wager|total\s*wager|bet\s*amount|risk)[:\s]*\$([0-9,]+(?:\.[0-9]{1,2})?)/i);
  const returnLabelMatch = text.match(/(?:returns?|to\s*return|payout|potential\s*payout|to\s*win|est\.?\s*payout)[:\s]*\$([0-9,]+(?:\.[0-9]{1,2})?)/i);
  const sgpOddsMatch = text.match(/(?:sgp\+?|\bparlay\b|total\s*odds)\s*(?:@|:)?\s*([+-][0-9]{3,6})/i);
  const summaryMatch = text.match(/\$([0-9]+(?:\.[0-9]{2})?)\s+([+-][0-9]{3,6})\s+\$([0-9,]+(?:\.[0-9]{2})?)/);

  if (stakeLabelMatch) {
    result.stake = parseFloat(stakeLabelMatch[1].replace(/,/g, ''));
  }
  if (returnLabelMatch) {
    result.payout = parseFloat(returnLabelMatch[1].replace(/,/g, ''));
  }
  if (sgpOddsMatch) {
    result.totalOdds = sgpOddsMatch[1];
  }

  if (summaryMatch) {
    if (!result.stake) result.stake = parseFloat(summaryMatch[1]);
    if (!result.totalOdds) result.totalOdds = summaryMatch[2];
    if (!result.payout) result.payout = parseFloat(summaryMatch[3].replace(/,/g, ''));
  }

  // Fallback for dollar amounts: ignore $0.00 (e.g. Cash $0.00 / Bonus $0.00 in app header)
  if (!result.stake || !result.payout) {
    const rawDollarMatches = [...text.matchAll(/\$([0-9,]+(?:\.[0-9]{2})?)/g)]
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(v => !isNaN(v) && v > 0);
    if (rawDollarMatches.length >= 2) {
      if (!result.stake) result.stake = rawDollarMatches[0];
      if (!result.payout) result.payout = Math.max(...rawDollarMatches);
    } else if (rawDollarMatches.length === 1 && !result.stake) {
      result.stake = rawDollarMatches[0];
    }
  }

  if (!result.totalOdds) {
    const bigPlusOdds = text.match(/([+][0-9]{3,6})/);
    if (bigPlusOdds) result.totalOdds = bigPlusOdds[1];
  }

  // 3. Extract Individual Player Legs & Matchups
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const extracted = [];

  const patternBet99 = /^(?:[©•@*\-—oO0]+\s+)?([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)+)\s*[-—–]\s*(Points?|Shots?(?:\s*on\s*Goal)?|SOG|Goals?|Assists?|Saves?|Blocks?|Blocked\s*Shots?|Hits?)\s*[-—–]\s*((?:Over|Under)\s*\d+(?:\.\d+)?|\d+\+)\s*(?:@\s*([+-]\d{3,4}))?/i;
  const patternGeneric = /^(?:[©•@*\-—oO0]+\s+)?([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)+)\s*[-—–]?\s*((?:Over|Under)\s*\d+(?:\.\d+)?|\d+\+)\s+(?:Total\s+)?(Points?|Shots?(?:\s*on\s*Goal)?|SOG|Goals?|Assists?|Saves?|Blocks?|Blocked\s*Shots?|Hits?)(?:\s*(?:@|\()?\s*([+-]\d{3,4})\)?)?/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let playerName = '';
    let marketRaw = '';
    let lineTargetRaw = '';
    let legOdds = '';

    const m1 = line.match(patternBet99);
    const m2 = !m1 ? line.match(patternGeneric) : null;

    if (m1) {
      playerName = m1[1].trim();
      marketRaw = m1[2].trim();
      lineTargetRaw = m1[3].trim();
      legOdds = (m1[4] || '').trim();
    } else if (m2) {
      playerName = m2[1].trim();
      lineTargetRaw = m2[2].trim();
      marketRaw = m2[3].trim();
      legOdds = (m2[4] || '').trim();
    }

    if (playerName && marketRaw && lineTargetRaw) {
      const marketClean = normalizeMarketCategory(marketRaw);
      const targetClean = lineTargetRaw.replace(/^over\s*/i, 'Over ').replace(/^under\s*/i, 'Under ');
      const pickText = `${playerName} — ${targetClean} ${marketClean}`;

      let gameTitle = '';
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 2); j++) {
        if (/(@|\bvs\.?\b)/i.test(lines[j]) && !patternBet99.test(lines[j]) && !patternGeneric.test(lines[j])) {
          gameTitle = normalizeMatchupLine(lines[j]);
          break;
        }
      }

      if (!legOdds && i + 1 < lines.length) {
        const nextOdds = lines[i + 1].match(/^([+-]\d{3,4})$/);
        if (nextOdds) legOdds = nextOdds[1];
      }

      extracted.push({
        playerName,
        pick_text: pickText,
        odds: legOdds || '-110',
        game_title: gameTitle || 'Friday NHL Game',
        bet_type: 'Player Prop'
      });
    }
  }

  // Match extracted legs to boys in SQUAD
  const usedBoys = new Set();
  extracted.forEach(item => {
    const itemLast = item.playerName.split(' ').slice(-1)[0].toLowerCase();
    let matchedBoy = null;

    // 1. Check current state.legs for matching player name
    for (const boy of SQUAD) {
      if (usedBoys.has(boy.name)) continue;
      const existing = state.legs[boy.name];
      if (existing && existing.pick_text && existing.pick_text.toLowerCase().includes(itemLast)) {
        matchedBoy = boy.name;
        break;
      }
    }

    // 2. Check KNOWN_OCT30_PLAYERS if still unmatched
    if (!matchedBoy && state.currentFridayStr === '2026-10-30') {
      for (const [bName, kObj] of Object.entries(KNOWN_OCT30_PLAYERS)) {
        if (!usedBoys.has(bName) && kObj.name.toLowerCase().includes(itemLast)) {
          matchedBoy = bName;
          break;
        }
      }
    }

    if (matchedBoy) {
      usedBoys.add(matchedBoy);
      item.boyName = matchedBoy;
    }
  });

  // 3. Assign any remaining legs to unassigned boys in squad order
  extracted.forEach(item => {
    if (!item.boyName) {
      const nextBoy = SQUAD.find(b => !usedBoys.has(b.name)) || SQUAD[0];
      usedBoys.add(nextBoy.name);
      item.boyName = nextBoy.name;
    }
    const parsedSlider = parsePickIntoLeg(item.boyName, item);
    item.statType = parsedSlider.statType;
    item.target = parsedSlider.target;
    item.unitLabel = getUnitLabelForStat(parsedSlider.statType);
  });

  result.legs = extracted;
  return result;
}

function renderDetectedSlipLegs(legs) {
  state.pendingScannedLegs = legs || [];
  if (!DOM.slipDetectedLegsWrap || !DOM.slipDetectedLegsList) return;

  if (!legs || legs.length === 0) {
    DOM.slipDetectedLegsWrap.style.display = 'none';
    DOM.slipDetectedLegsList.innerHTML = '';
    return;
  }

  DOM.slipDetectedLegsWrap.style.display = 'block';
  if (DOM.slipDetectedCountBadge) {
    DOM.slipDetectedCountBadge.textContent = `${legs.length} LEG${legs.length === 1 ? '' : 'S'} READY`;
  }

  DOM.slipDetectedLegsList.innerHTML = legs.map((leg, idx) => `
    <div class="slip-detected-leg-row" data-idx="${idx}">
      <select class="slip-boy-select" data-leg-idx="${idx}">
        ${SQUAD.map(b => `<option value="${b.name}" ${b.name === leg.boyName ? 'selected' : ''}>${b.name}</option>`).join('')}
      </select>
      <div class="slip-leg-main">
        <div class="slip-leg-pick-title">${escapeHTML(leg.pick_text)}</div>
        <div class="slip-leg-sub">${escapeHTML(leg.game_title)}</div>
      </div>
      <div class="slip-leg-badges">
        <span class="slip-slider-pill">0 / ${leg.target} ${leg.unitLabel}</span>
        <span class="slip-odds-pill">${escapeHTML(leg.odds)}</span>
      </div>
    </div>
  `).join('');

  DOM.slipDetectedLegsList.querySelectorAll('.slip-boy-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-leg-idx'), 10);
      if (state.pendingScannedLegs && state.pendingScannedLegs[idx]) {
        state.pendingScannedLegs[idx].boyName = e.target.value;
      }
    });
  });
}

function openScanSlipModal() {
  if (DOM.scanSlipModalBackdrop) {
    DOM.scanSlipModalBackdrop.classList.add('open');
    if (DOM.slipStakeInput) DOM.slipStakeInput.value = state.stake.toFixed(2);
    if (state.masterSlip && state.masterSlip.total_odds) {
      if (DOM.slipOddsInput) DOM.slipOddsInput.value = state.masterSlip.total_odds;
      if (DOM.slipPayoutInput) DOM.slipPayoutInput.value = parseFloat(state.masterSlip.potential_payout || 0).toFixed(2);
    }
  }
}
window.openScanSlipModal = openScanSlipModal;

function closeScanSlipModal() {
  if (DOM.scanSlipModalBackdrop) {
    DOM.scanSlipModalBackdrop.classList.remove('open');
  }
}

async function handleSlipFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("Please select a valid image screenshot (PNG, JPG, WebP)", "cross");
    return;
  }

  if (DOM.slipFileNameText) DOM.slipFileNameText.textContent = file.name || "Pasted Bet Slip";
  if (DOM.slipDropzone) DOM.slipDropzone.style.display = "none";
  if (DOM.slipPreviewWrap) DOM.slipPreviewWrap.style.display = "block";

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    if (DOM.slipPreviewImg) DOM.slipPreviewImg.src = dataUrl;

    if (window.Tesseract) {
      if (DOM.slipOcrStatus) DOM.slipOcrStatus.style.display = "flex";
      if (DOM.slipOcrStatusText) DOM.slipOcrStatusText.textContent = "Scanning odds, wager, payout & 6 player legs via OCR...";
      try {
        const result = await Tesseract.recognize(dataUrl, "eng");
        const text = result?.data?.text || "";
        const parsed = parseSportsbookOcrText(text);

        if (parsed.stake && DOM.slipStakeInput) DOM.slipStakeInput.value = parsed.stake.toFixed(2);
        if (parsed.totalOdds && DOM.slipOddsInput) DOM.slipOddsInput.value = parsed.totalOdds;
        if (parsed.payout && DOM.slipPayoutInput) DOM.slipPayoutInput.value = parsed.payout.toFixed(2);
        if (parsed.book && DOM.slipBookInput) DOM.slipBookInput.value = parsed.book;

        renderDetectedSlipLegs(parsed.legs);

        const legCount = parsed.legs.length;
        if (DOM.slipOcrStatusText) {
          DOM.slipOcrStatusText.textContent = legCount > 0
            ? `✓ OCR Complete! Extracted ${legCount} player leg${legCount === 1 ? '' : 's'}, odds & slider targets.`
            : "✓ OCR Complete! Wager, odds & payout extracted from screenshot.";
        }
        showToast(legCount > 0 ? `Scanned ${legCount} legs & slip values!` : "Slip scanned & values extracted!", "checkCircle");
      } catch (ocrErr) {
        console.warn("OCR error:", ocrErr);
        if (DOM.slipOcrStatusText) DOM.slipOcrStatusText.textContent = "Screenshot loaded. Review & confirm below.";
      }
    } else {
      if (DOM.slipOcrStatus) DOM.slipOcrStatus.style.display = "flex";
      if (DOM.slipOcrStatusText) DOM.slipOcrStatusText.textContent = "Screenshot loaded. Review & confirm details below.";
    }
  };
  reader.readAsDataURL(file);
}

function clearSlipFile() {
  if (DOM.slipFileInput) DOM.slipFileInput.value = '';
  if (DOM.slipPreviewImg) DOM.slipPreviewImg.src = '';
  if (DOM.slipPreviewWrap) DOM.slipPreviewWrap.style.display = 'none';
  if (DOM.slipDropzone) DOM.slipDropzone.style.display = 'block';
  if (DOM.slipOcrStatus) DOM.slipOcrStatus.style.display = 'none';
  renderDetectedSlipLegs([]);
}

async function confirmAndLockInSlip() {
  const stake = parseFloat(DOM.slipStakeInput?.value || 30.00);
  const odds = (DOM.slipOddsInput?.value || '+2394').trim();
  const payout = parseFloat(DOM.slipPayoutInput?.value || 748.20);
  const book = DOM.slipBookInput?.value || 'BET99';
  const bettor = getBettorForFriday(state.currentFriday);

  // If OCR extracted individual legs, update state.legs (preserving existing chirps)
  if (Array.isArray(state.pendingScannedLegs) && state.pendingScannedLegs.length > 0) {
    for (const scanned of state.pendingScannedLegs) {
      if (!scanned.boyName) continue;
      const prevLeg = state.legs[scanned.boyName] || {};
      const shortGame = (scanned.game_title || '').split('@').map(s => s.trim().split(/\s+/)[0]).join(' @ ');
      const updatedLeg = {
        ...prevLeg,
        user_name: scanned.boyName,
        boy: scanned.boyName,
        game: shortGame || prevLeg.game || 'NHL',
        game_title: scanned.game_title || prevLeg.game_title || 'Friday NHL Game',
        bet_type: 'Player Prop',
        pick_text: scanned.pick_text || prevLeg.pick_text,
        odds: scanned.odds || prevLeg.odds || '-110',
        chirp: prevLeg.chirp || '',
        locked: true
      };
      state.legs[scanned.boyName] = updatedLeg;

      if (state.supabase) {
        try {
          await state.supabase
            .from('parlay_legs')
            .upsert({
              id: `${state.currentFridayStr}_${scanned.boyName}`,
              week_date: state.currentFridayStr,
              user_name: scanned.boyName,
              game_title: updatedLeg.game_title,
              bet_type: updatedLeg.bet_type,
              pick_text: updatedLeg.pick_text,
              odds: updatedLeg.odds,
              chirp: updatedLeg.chirp,
              locked: true,
              updated_at: new Date().toISOString()
            });
        } catch (legErr) {
          console.warn('Could not sync scanned leg to Supabase:', legErr);
        }
      }
    }
  }

  state.stake = stake;
  state.isPlaced = true;
  state.masterSlip = {
    id: state.currentFridayStr,
    week_date: state.currentFridayStr,
    bettor_name: bettor.name,
    status: 'placed',
    stake: stake,
    total_odds: odds,
    potential_payout: payout,
    notes: `Placed on ${book} by ${bettor.name} (SGP+ @ ${odds})`
  };

  saveLocalData(state.currentFridayStr);
  syncTrackerFromRealPicks();
  saveTrackerData();

  if (state.supabase) {
    try {
      await state.supabase
        .from('friday_parlays')
        .upsert({
          id: state.currentFridayStr,
          week_date: state.currentFridayStr,
          bettor_name: bettor.name,
          status: 'placed',
          stake: stake,
          total_odds: odds,
          potential_payout: payout,
          notes: `Placed on ${book} by ${bettor.name} (SGP+ @ ${odds})`,
          updated_at: new Date().toISOString()
        });
    } catch (e) {
      console.warn('Could not sync placed parlay to Supabase:', e);
    }
  }

  closeScanSlipModal();
  renderAll();
  renderTracker();

  if (window.confetti) confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
  playSound('triumph');
  showToast(`Slip locked in on ${book}! Payout: $${payout.toFixed(2)}`, 'checkCircle');

  setTimeout(() => {
    switchView('liveTrackerView');
    fetchAllLiveStats(true);
  }, 350);
}

function setupEvents() {
  // Scan slip modal triggers
  if (DOM.scanSlipBtn) DOM.scanSlipBtn.addEventListener('click', openScanSlipModal);
  if (DOM.closeScanSlipModalBtn) DOM.closeScanSlipModalBtn.addEventListener('click', closeScanSlipModal);
  if (DOM.cancelScanSlipBtn) DOM.cancelScanSlipBtn.addEventListener('click', closeScanSlipModal);
  if (DOM.confirmScanSlipBtn) DOM.confirmScanSlipBtn.addEventListener('click', confirmAndLockInSlip);
  if (DOM.clearSlipFileBtn) DOM.clearSlipFileBtn.addEventListener('click', clearSlipFile);

  if (DOM.slipDropzone && DOM.slipFileInput) {
    DOM.slipDropzone.addEventListener('click', () => DOM.slipFileInput.click());
    DOM.slipFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleSlipFile(e.target.files[0]);
    });

    DOM.slipDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      DOM.slipDropzone.classList.add('dragover');
    });
    DOM.slipDropzone.addEventListener('dragleave', () => {
      DOM.slipDropzone.classList.remove('dragover');
    });
    DOM.slipDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      DOM.slipDropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleSlipFile(e.dataTransfer.files[0]);
      }
    });
  }

  // Global paste handler (Cmd+V anywhere on the page to drop slip screenshot)
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        openScanSlipModal();
        handleSlipFile(file);
        break;
      }
    }
  });
  // Navigation tabs
  DOM.tabSlipBuilder.addEventListener('click', () => switchView('slipBuilderView'));
  DOM.tabLiveTracker.addEventListener('click', () => switchView('liveTrackerView'));
  DOM.tabStats.addEventListener('click', () => switchView('statsView'));

  // iPhone App install modal
  DOM.installAppBtn.addEventListener('click', () => {
    DOM.installModalBackdrop.classList.add('open');
  });
  DOM.closeInstallModalBtn.addEventListener('click', () => {
    DOM.installModalBackdrop.classList.remove('open');
  });
  DOM.gotItInstallBtn.addEventListener('click', () => {
    DOM.installModalBackdrop.classList.remove('open');
  });
  DOM.installModalBackdrop.addEventListener('click', e => {
    if (e.target === DOM.installModalBackdrop) DOM.installModalBackdrop.classList.remove('open');
  });

  // Week navigation
  DOM.prevWeekBtn.addEventListener('click', () => {
    state.currentFriday.setDate(state.currentFriday.getDate() - 7);
    state.currentFridayStr = formatDateISO(state.currentFriday);
    loadLocalData(state.currentFridayStr);
    initTrackerData();
    fetchFridayNhlGames(state.currentFridayStr);
    if (state.supabase) fetchSupabaseParlay(state.currentFridayStr);
    renderAll();
    renderTracker();
    playSound('click');
  });

  DOM.nextWeekBtn.addEventListener('click', () => {
    state.currentFriday.setDate(state.currentFriday.getDate() + 7);
    state.currentFridayStr = formatDateISO(state.currentFriday);
    loadLocalData(state.currentFridayStr);
    initTrackerData();
    fetchFridayNhlGames(state.currentFridayStr);
    if (state.supabase) fetchSupabaseParlay(state.currentFridayStr);
    renderAll();
    renderTracker();
    playSound('click');
  });

  // Stake input
  DOM.stakeInput.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      state.stake = val;
      saveLocalData(state.currentFridayStr);
      renderSportsbookTicket();
      renderTracker();
    }
  });

  // Mark placed toggle -> AUTOMATIC SWITCH TO LIVE BET TRACKER!
  DOM.markPlacedBtn.addEventListener('click', () => {
    state.isPlaced = !state.isPlaced;
    saveLocalData(state.currentFridayStr);
    renderSportsbookTicket();
    playSound('lock');

    if (state.isPlaced) {
      syncTrackerFromRealPicks();
      saveTrackerData();
      if (window.confetti) confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      playSound('triumph');
      showToast('Bet placed on sportsbook! Switching to Live Tracker', 'checkCircle');
      renderTracker();
      setTimeout(() => {
        switchView('liveTrackerView');
        fetchAllLiveStats(true);
      }, 350);
    } else {
      renderTracker();
      showToast('Bet marked as unplaced', 'puck');
    }
  });

  // Bet type chip selector
  document.querySelectorAll('.bet-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bet-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      DOM.betTypeInput.value = btn.getAttribute('data-type');
    });
  });

  DOM.oddsInput.addEventListener('input', e => updateOddsHelper(e.target.value));

  DOM.copySportsbookSlipBtn.addEventListener('click', copySlipForSportsbook);
  DOM.ticketCopyBtn.addEventListener('click', copySlipForSportsbook);
  DOM.quickChirpBtn.addEventListener('click', generateGroupChirp);

  // Form submit
  DOM.legForm.addEventListener('submit', async e => {
    e.preventDefault();
    const userName = DOM.selectedBoyInput.value;
    const gameTitle = DOM.gameSelect.value || 'Friday NHL Game';
    const pickText = DOM.pickTextInput.value.trim();
    const odds = DOM.oddsInput.value.trim();
    const betType = DOM.betTypeInput.value;
    const chirp = DOM.chirpInput.value.trim();

    if (!userName || !pickText || !odds) {
      showToast('Please fill in pick and odds', 'alert');
      return;
    }

    const legObj = {
      user_name: userName,
      game_title: gameTitle,
      pick_text: pickText,
      odds: odds,
      bet_type: betType,
      chirp: chirp,
      locked: true
    };

    await persistLeg(legObj);
    closeLegModal();
    playSound('lock');
    if (state.isPlaced) {
      syncTrackerFromRealPicks();
      saveTrackerData();
    }
    renderAll();
    renderTracker();
    showToast(`Locked in ${userName}'s leg!`, 'fire');

    if (Object.keys(state.legs).length === 6 && window.confetti) {
      setTimeout(() => {
        confetti({ particleCount: 140, spread: 90, origin: { y: 0.6 } });
        playSound('triumph');
      }, 200);
    }
  });

  DOM.closeModalBtn.addEventListener('click', closeLegModal);
  DOM.cancelModalBtn.addEventListener('click', closeLegModal);
  DOM.legModalBackdrop.addEventListener('click', e => {
    if (e.target === DOM.legModalBackdrop) closeLegModal();
  });

  // Supabase sync modal
  DOM.syncStatusBtn.addEventListener('click', () => {
    DOM.syncModalBackdrop.classList.add('open');
  });
  DOM.closeSyncModalBtn.addEventListener('click', () => {
    DOM.syncModalBackdrop.classList.remove('open');
  });
  DOM.syncModalBackdrop.addEventListener('click', e => {
    if (e.target === DOM.syncModalBackdrop) DOM.syncModalBackdrop.classList.remove('open');
  });

  DOM.saveSyncBtn.addEventListener('click', () => {
    const url = DOM.supabaseUrlInput.value.trim();
    const key = DOM.supabaseAnonKeyInput.value.trim();
    if (url && key) {
      localStorage.setItem('bts_supabase_url', url);
      localStorage.setItem('bts_supabase_key', key);
      initSupabase();
      DOM.syncModalBackdrop.classList.remove('open');
      showToast('Connected to Supabase!', 'bolt');
    }
  });
}

// INITIALIZATION
window.addEventListener('DOMContentLoaded', () => {
  // Automatically rollover every Sunday to the upcoming Friday:
  state.currentFriday = getActiveFridayDate();
  state.currentFridayStr = formatDateISO(state.currentFriday);

  loadLocalData(state.currentFridayStr);
  initTrackerData();
  initStatsHistory();
  setupEvents();
  renderAll();
  initSupabase();
  fetchFridayNhlGames(state.currentFridayStr);
  toggleAutoPoll();

  // If already placed, show Live Tracker by default (unless explicit URL hash was provided)
  setTimeout(() => {
    if (state.isPlaced && !window.location.hash) {
      switchView('liveTrackerView', false);
    }
  }, 400);

  // Support URL hash routing (#tracker, #stats, #slip)
  function handleHash() {
    const hash = (window.location.hash || '').toLowerCase();
    if (hash === '#tracker' || hash === '#live' || hash === '#livetracker') {
      switchView('liveTrackerView', false);
    } else if (hash === '#stats' || hash === '#leaderboard') {
      switchView('statsView', false);
    } else if (hash === '#slip') {
      switchView('slipBuilderView', false);
    }
  }
  window.addEventListener('hashchange', handleHash);
  if (window.location.hash) {
    handleHash();
  }

  setInterval(updateCountdown, 60000);
});
