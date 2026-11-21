/**
 * BET THE SHOW - Official Core Application Logic
 * 6 Boys. 6 Legs. Every Friday NHL • $30 Pool.
 * Axel, Jackson, Will, Alex, Ben, and Edward.
 */

// =============================================================================
// 1. SQUAD CONFIGURATION & 6-WEEK BETTOR ROTATION
// =============================================================================
// Week 1: Friday, Oct 2, 2026 (Ben placed the inaugural $5 5-leg ticket on Bet365)
// (Oct 9 skipped — no parlay)
// Week 2: Friday, Oct 16, 2026 (Axel placed $25 5-leg ticket)
// Week 3: Friday, Oct 23, 2026 (Jackson placed $30 6-leg ticket — Edward joined!)
// Week 4: Friday, Oct 30, 2026 (Will placed $30 6-leg ticket)
// Week 5: Friday, Nov 6, 2026 (Alex placed $30 6-leg ticket — CASHED $454.41!)
// Week 6: Friday, Nov 13, 2026 (Edward placed $25 5-leg Betway ticket @ +5525 -> 4/5 hit, Edward sold on Ohgren!)
// Week 7: Special Saturday NHL Edition (Sat Nov 21, 2026 — Ben placed $25 FanDuel split: $20 @ +2105 -> $441.06 + $5 50% Boost @ +3158 -> $162.93 = $603.99!)
// 6-week cycle: Ben -> Axel -> Jackson -> Will -> Alex -> Edward (repeats)
const SQUAD = [
  { id: 'ben', name: 'Ben', initials: 'BE', color: '#ec4899', defaultRole: 'Week 1 & 7 Bettor' },
  { id: 'axel', name: 'Axel', initials: 'AX', color: '#f59e0b', defaultRole: 'Week 2 Bettor' },
  { id: 'jackson', name: 'Jackson', initials: 'JA', color: '#00ff87', defaultRole: 'Week 3 Bettor' },
  { id: 'will', name: 'Will', initials: 'WI', color: '#38bdf8', defaultRole: 'Week 4 Bettor' },
  { id: 'alex', name: 'Alex', initials: 'AL', color: '#a855f7', defaultRole: 'Week 5 Bettor' },
  { id: 'edward', name: 'Edward', initials: 'ED', color: '#fb923c', defaultRole: 'Week 6 Bettor' }
];

// REFERENCE DATES FOR POOL WEEK & ROTATION
const INAUGURAL_OCT02_FRIDAY = new Date('2026-10-02T12:00:00Z');
const ROTATION_START_FRIDAY = new Date('2026-10-16T12:00:00Z');

// WEEK 7 SPECIAL NON-FRIDAY GAME DAY VOTE CONFIGURATION
// (No NHL games scheduled on Friday, Nov 20, 2026)
const WEEK7_FRIDAY_ANCHOR = '2026-11-20';
const WEEK7_VOTE_DATE_KEY = '2026-11-18'; // Supabase parlay_legs week_date key for per-boy votes
const WEEK7_THU_DATE = '2026-11-19';
const WEEK7_SAT_DATE = '2026-11-21';
const WEEK7_SPLIT_CHOICE = 'BOTH_SPLIT_15'; // $15 Thursday + $15 Saturday Doubleheader Split
const WEEK7_SPLIT_ROLLOVER_AT = new Date('2026-11-20T06:00:00-05:00'); // Fri 6:00 AM ET rolls Split Mode default from Thu -> Sat
const WEEK7_VOTE_LOCK_AT = new Date('2026-11-18T20:00:00-05:00'); // Wed, Nov 18, 2026 @ 8:00 PM ET
const WEEK7_VOTE_STORAGE_KEY = 'bts_week7_day_vote_v1';

function isValidWeek7VoteChoice(val) {
  return val === WEEK7_THU_DATE || val === WEEK7_SAT_DATE || val === WEEK7_SPLIT_CHOICE;
}

function parseLocalISODate(dateStr) {
  const parts = String(dateStr || '').split('-');
  if (parts.length === 3) {
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0, 0);
  }
  const d = new Date(dateStr);
  d.setHours(12, 0, 0, 0);
  return d;
}

function isWeek7DateStr(dateStr) {
  return dateStr === WEEK7_THU_DATE || dateStr === WEEK7_FRIDAY_ANCHOR || dateStr === WEEK7_SAT_DATE;
}

function toCanonicalFridayDate(dateOrStr) {
  const iso = typeof dateOrStr === 'string' ? dateOrStr : formatDateISO(dateOrStr);
  if (isWeek7DateStr(iso)) {
    return parseLocalISODate(WEEK7_FRIDAY_ANCHOR);
  }
  const d = typeof dateOrStr === 'string' ? parseLocalISODate(dateOrStr) : new Date(dateOrStr);
  d.setHours(12, 0, 0, 0);
  return d;
}

function getDayLabelForDateStr(dateStr) {
  if (dateStr === WEEK7_THU_DATE) return 'Thursday';
  if (dateStr === WEEK7_SAT_DATE) return 'Saturday';
  return 'Friday';
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
  currentFriday: null,        // Date object for active pool date
  currentFridayStr: '',       // 'YYYY-MM-DD'
  weekNumber: 7,              // Active week number
  legs: {},                   // Map of boyName -> leg object
  games: [],                  // Active day's NHL matchups
  stake: 30,                  // Default $30 pool stake ($5 per boy)
  isPlaced: false,
  supabase: null,
  isLiveSync: false,
  currentView: 'slipBuilderView',
  // Live tracker parlay data
  trackerData: [],
  // Stats & Leaderboard historical data
  statsHistory: [],
  payoutLog: {},              // Map of winning week dateStr -> { boyName: { paid: bool, paidAt: isoStr } }
  selectedHistoryWeek: 6,     // Default to latest settled week (Week 6) for single-week view
  // Week 7 Special Thursday vs. Saturday Vote State
  week7Vote: {
    votes: {},                // Map of boyName -> { choice: '2026-11-19' | '2026-11-21', updatedAt: '' }
    selectedVoter: '',        // Remembered voter name on this device
    slateFilter: 'both',      // 'both' | '2026-11-19' | '2026-11-21'
    thuGames: [],             // Thursday Nov 19 games (12)
    satGames: [],             // Saturday Nov 21 games (14)
    lockedDate: WEEK7_SAT_DATE, // Official Week 7 winner: Saturday Only (Nov 21, 2026) — Ben's FanDuel slip placed!
    supabaseLoaded: false
  }
};

function isWeek7VoteLocked(now = new Date()) {
  if (isValidWeek7VoteChoice(state.week7Vote.lockedDate)) {
    return true;
  }
  return now.getTime() >= WEEK7_VOTE_LOCK_AT.getTime();
}

function getActiveWeek7SplitDateStr(now = new Date()) {
  return now.getTime() >= WEEK7_SPLIT_ROLLOVER_AT.getTime() ? WEEK7_SAT_DATE : WEEK7_THU_DATE;
}

function tallyWeek7Votes(now = new Date()) {
  const thuVoters = [];
  const satVoters = [];
  const splitVoters = [];
  SQUAD.forEach(boy => {
    const v = state.week7Vote.votes[boy.name];
    if (v && v.choice === WEEK7_THU_DATE) thuVoters.push(boy.name);
    else if (v && v.choice === WEEK7_SAT_DATE) satVoters.push(boy.name);
    else if (v && v.choice === WEEK7_SPLIT_CHOICE) splitVoters.push(boy.name);
  });

  const thuCount = thuVoters.length;
  const satCount = satVoters.length;
  const splitCount = splitVoters.length;
  const maxVotes = Math.max(thuCount, satCount, splitCount);

  const leaders = [];
  if (splitCount === maxVotes) leaders.push(WEEK7_SPLIT_CHOICE);
  if (thuCount === maxVotes) leaders.push(WEEK7_THU_DATE);
  if (satCount === maxVotes) leaders.push(WEEK7_SAT_DATE);

  const isTie = leaders.length > 1;
  let winnerMode = WEEK7_SPLIT_CHOICE;
  let tieBreakerReason = '';

  if (isValidWeek7VoteChoice(state.week7Vote.lockedDate)) {
    winnerMode = state.week7Vote.lockedDate;
  } else if (leaders.length === 1) {
    winnerMode = leaders[0];
  } else {
    // Tie-breaker: Week 7 Master Bettor (Ben)'s vote if among tied leaders, else $15+$15 Split compromise (or Sat if Thu/Sat tied)
    const benVote = state.week7Vote.votes['Ben']?.choice;
    if (benVote && leaders.includes(benVote)) {
      winnerMode = benVote;
      tieBreakerReason = "Ben's Master Bettor tiebreaker";
    } else if (leaders.includes(WEEK7_SPLIT_CHOICE)) {
      winnerMode = WEEK7_SPLIT_CHOICE;
      tieBreakerReason = '$15 + $15 Doubleheader Split compromise';
    } else {
      winnerMode = WEEK7_SPLIT_CHOICE;
      tieBreakerReason = 'Thu vs Sat dead-even tie -> $15 + $15 Split';
    }
  }

  const winnerDate = winnerMode === WEEK7_SPLIT_CHOICE
    ? getActiveWeek7SplitDateStr(now)
    : winnerMode;

  return {
    thuVoters,
    satVoters,
    splitVoters,
    thuCount,
    satCount,
    splitCount,
    maxVotes,
    totalVotes: thuCount + satCount + splitCount,
    isTie,
    winnerMode,
    winnerDate,
    tieBreakerReason
  };
}

function getWinningWeek7Mode(now = new Date()) {
  if (!isWeek7VoteLocked(now)) return null;
  return tallyWeek7Votes(now).winnerMode;
}

function isWeek7SplitMode(now = new Date()) {
  return getWinningWeek7Mode(now) === WEEK7_SPLIT_CHOICE;
}

function getResolvedWeek7DateStr(now = new Date()) {
  if (!isWeek7VoteLocked(now)) return WEEK7_FRIDAY_ANCHOR;
  return tallyWeek7Votes(now).winnerDate;
}

function resolvePoolWeekDate(canonicalFriDate, now = new Date()) {
  const iso = formatDateISO(canonicalFriDate);
  if (iso === WEEK7_FRIDAY_ANCHOR) {
    return parseLocalISODate(getResolvedWeek7DateStr(now));
  }
  return canonicalFriDate;
}

function isViewingWeek7Vote(now = new Date()) {
  return state.currentFridayStr === WEEK7_FRIDAY_ANCHOR && !isWeek7VoteLocked(now);
}

// DYNAMIC WEEKLY ROLLOVER ENGINE
function getActiveFridayDate(refDate = new Date()) {
  const d = new Date(refDate);
  const refISO = formatDateISO(d);

  // Week 6 (2026-11-13) is officially settled -> Nov 14 through Nov 21 defaults straight to Week 7!
  if (refISO >= '2026-11-14' && refISO <= '2026-11-21') {
    return resolvePoolWeekDate(parseLocalISODate(WEEK7_FRIDAY_ANCHOR), refDate);
  }
  // On Sunday Nov 22: if Week 7 included Saturday Nov 21 (Sat Only or $15+$15 Split), keep Sat Nov 21 visible!
  if (refISO === '2026-11-22' && (getWinningWeek7Mode(refDate) === WEEK7_SAT_DATE || isWeek7SplitMode(refDate))) {
    return parseLocalISODate(WEEK7_SAT_DATE);
  }

  const day = d.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  if (day === 0) {
    d.setDate(d.getDate() + 5);
  } else if (day === 6) {
    d.setDate(d.getDate() - 1);
  } else if (day >= 1 && day <= 5) {
    d.setDate(d.getDate() + (5 - day));
  }
  d.setHours(12, 0, 0, 0);
  return resolvePoolWeekDate(d, refDate);
}

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
// Returns 0-based pool week index:
//   2026-10-02 -> 0 (Week 1: Ben)
//   (2026-10-09 skipped — no parlay)
//   2026-10-16 -> 1 (Week 2: Axel)
//   2026-10-23 -> 2 (Week 3: Jackson)
//   2026-10-30 -> 3 (Week 4: Will)
//   2026-11-06 -> 4 (Week 5: Alex)
//   2026-11-13 -> 5 (Week 6: Edward)
function getFridayDiffWeeks(fridayDate) {
  const canonicalFri = toCanonicalFridayDate(fridayDate);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const diffFromOct16 = Math.round((canonicalFri.getTime() - ROTATION_START_FRIDAY.getTime()) / msPerWeek);
  if (diffFromOct16 < 0) {
    const diffFromOct02 = Math.round((canonicalFri.getTime() - INAUGURAL_OCT02_FRIDAY.getTime()) / msPerWeek);
    return Math.min(0, diffFromOct02);
  }
  return diffFromOct16 + 1;
}

function getBettorForFriday(fridayDate) {
  const poolWeekIdx = getFridayDiffWeeks(fridayDate);
  const index = ((poolWeekIdx % SQUAD.length) + SQUAD.length) % SQUAD.length;
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
  tabSlipLabel: document.getElementById('tabSlipLabel'),
  tabLiveTracker: document.getElementById('tabLiveTracker'),
  tabStats: document.getElementById('tabStats'),
  navLiveMultiplier: document.getElementById('navLiveMultiplier'),
  // Header controls
  installAppBtn: document.getElementById('installAppBtn'),
  syncStatusBtn: document.getElementById('syncStatusBtn'),
  syncStatusText: document.getElementById('syncStatusText'),
  ribbonDayLabel: document.getElementById('ribbonDayLabel'),
  tickerGamesCount: document.getElementById('tickerGamesCount'),
  gamesTicker: document.getElementById('gamesTicker'),
  // Views
  slipBuilderView: document.getElementById('slipBuilderView'),
  liveTrackerView: document.getElementById('liveTrackerView'),
  statsView: document.getElementById('statsView'),
  // Week 7 Vote Arena & Slip Sections
  week7VoteArena: document.getElementById('week7VoteArena'),
  week7VoteSettledBanner: document.getElementById('week7VoteSettledBanner'),
  week7TrackerSplitBar: document.getElementById('week7TrackerSplitBar'),
  slipBettorBanner: document.getElementById('slipBettorBanner'),
  slipWorkspace: document.getElementById('slipWorkspace'),
  slipMatchupsPanel: document.getElementById('slipMatchupsPanel'),
  lineupColCaption: document.getElementById('lineupColCaption'),
  schedulePanelHeading: document.getElementById('schedulePanelHeading'),
  legModalDayTag: document.getElementById('legModalDayTag'),
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
  historyWeeksContainer: document.getElementById('historyWeeksContainer'),
  historyWeekToggleBar: document.getElementById('historyWeekToggleBar')
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
    awayScore: 2,
    homeScore: 5,
    awaySog: 24,
    homeSog: 38,
    awayHits: 25,
    homeHits: 25,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Fri Oct 30 • 7:00 PM",
    gameStateText: "Final • FLA 5 - WPG 2",
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
        apiStat: 1,
        manualDelta: 0,
        subDetail: "0G, 1A • 3 SOG • 19:58 TOI"
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
        apiStat: 2,
        manualDelta: 0,
        subDetail: "0G, 0A • 2 SOG • 14:25 TOI"
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
        apiStat: 1,
        manualDelta: 0,
        subDetail: "1G, 2A • 1 SOG • 24:16 TOI"
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
    awayScore: 2,
    homeScore: 6,
    awaySog: 22,
    homeSog: 27,
    awayHits: 17,
    homeHits: 31,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Fri Oct 30 • 8:00 PM",
    gameStateText: "Final • CGY 6 - SEA 2",
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
        subDetail: "0G, 0A • 3 SOG • 18:29 TOI"
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
        apiStat: 1,
        manualDelta: 0,
        subDetail: "0G, 1A • 0 SOG • 15:47 TOI"
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
        subDetail: "0G, 0A • 2 SOG • 24:43 TOI"
      }
    ]
  }
];

const DEFAULT_NOV06_SLATE = [
  {
    gameId: "SJS_MIN",
    title: "SAME GAME PARLAY",
    odds: "SGP",
    awayTeam: "SJS",
    awayName: "SJS Sharks",
    homeTeam: "MIN",
    homeName: "MIN Wild",
    awayScore: 1,
    homeScore: 4,
    awaySog: 24,
    homeSog: 29,
    awayHits: 18,
    homeHits: 35,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Fri Nov 6 • 8:00 PM ET",
    gameStateText: "SJS 1 - MIN 4 (Final)",
    legs: [
      {
        id: "boldy_sog_nov06",
        boyName: "Jackson",
        playerName: "Matt Boldy",
        team: "MIN",
        odds: "-135",
        marketLabel: "3+ Shots on Goal (-135)",
        statType: "shots",
        target: 3,
        apiStat: 7,
        manualDelta: 0,
        subDetail: "0G, 1A • 7 SOG • 19:26 TOI"
      },
      {
        id: "wild_pl_nov06",
        boyName: "Alex",
        playerName: "Minnesota Wild -1.5",
        team: "MIN",
        teamAbbr: "MIN",
        isTeamBet: true,
        spread: -1.5,
        margin: 3,
        teamBetCovering: true,
        teamBetHit: true,
        odds: "+110",
        marketLabel: "Puck Line -1.5 (+110)",
        statType: "puckline",
        target: 2,
        apiStat: 3,
        manualDelta: 0,
        subDetail: "MIN 4 - SJS 1 • 29-24 SOG • Won by 3 Goals"
      },
      {
        id: "hughes_pts_nov06",
        boyName: "Ben",
        playerName: "Quinn Hughes",
        team: "MIN",
        odds: "-390",
        marketLabel: "Over 0.5 Total Points (-390)",
        statType: "points",
        target: 1,
        apiStat: 3,
        manualDelta: 0,
        subDetail: "1G, 2A • 2 SOG • 31:00 TOI"
      }
    ]
  },
  {
    gameId: "ANA_CGY",
    title: "SAME GAME PARLAY",
    odds: "SGP",
    awayTeam: "ANA",
    awayName: "ANA Ducks",
    homeTeam: "CGY",
    homeName: "CGY Flames",
    awayScore: 5,
    homeScore: 3,
    awaySog: 29,
    homeSog: 21,
    awayHits: 21,
    homeHits: 16,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Fri Nov 6 • 8:00 PM ET",
    gameStateText: "ANA 5 - CGY 3 (Final)",
    legs: [
      {
        id: "gauthier_goals_nov06",
        boyName: "Will",
        playerName: "Cutter Gauthier",
        team: "ANA",
        odds: "+137",
        marketLabel: "Anytime Goal Scorer (+137)",
        statType: "goals",
        target: 1,
        apiStat: 1,
        manualDelta: 0,
        subDetail: "1G, 0A • 4 SOG • 22:20 TOI"
      },
      {
        id: "sennecke_pts_nov06",
        boyName: "Edward",
        playerName: "Beckett Sennecke",
        team: "ANA",
        odds: "-195",
        marketLabel: "Over 0.5 Total Points (-195)",
        statType: "points",
        target: 1,
        apiStat: 2,
        manualDelta: 0,
        subDetail: "0G, 2A • 3 SOG • 23:16 TOI"
      }
    ]
  },
  {
    gameId: "CBJ_BUF",
    title: "PARLAY SELECTION",
    odds: "SGP+",
    awayTeam: "CBJ",
    awayName: "CBJ Blue Jackets",
    homeTeam: "BUF",
    homeName: "BUF Sabres",
    awayScore: 2,
    homeScore: 5,
    awaySog: 26,
    homeSog: 37,
    awayHits: 20,
    homeHits: 19,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Fri Nov 6 • 7:10 PM ET",
    gameStateText: "CBJ 2 - BUF 5 (Final)",
    legs: [
      {
        id: "kjohnson_pts_nov06",
        boyName: "Axel",
        playerName: "Kent Johnson",
        team: "CBJ",
        odds: "-120",
        marketLabel: "Over 0.5 Total Points (-120)",
        statType: "points",
        target: 1,
        apiStat: 2,
        manualDelta: 0,
        subDetail: "1G, 1A • 5 SOG • 16:22 TOI"
      }
    ]
  }
];

const DEFAULT_OCT02_SLATE = [
  {
    gameId: "ANA_VGK_OCT02",
    title: "SAME GAME PARLAY",
    odds: "SGP",
    awayTeam: "ANA",
    awayName: "ANA Ducks",
    homeTeam: "VGK",
    homeName: "VGK Golden Knights",
    awayScore: 4,
    homeScore: 3,
    awaySog: 27,
    homeSog: 32,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Fri Oct 2 • 10:00 PM ET",
    gameStateText: "ANA 4 - VGK 3 (Final)",
    legs: [
      {
        id: "marner_pts_oct02",
        boyName: "Ben",
        playerName: "Mitch Marner",
        team: "VGK",
        odds: "-200",
        marketLabel: "Over 0.5 Total Points (-200)",
        statType: "points",
        target: 1,
        apiStat: 1,
        manualDelta: 0,
        subDetail: "0G, 1A • 1 SOG • 22:22 TOI"
      },
      {
        id: "eichel_sog_oct02",
        boyName: "Alex",
        playerName: "Jack Eichel",
        team: "VGK",
        odds: "-300",
        marketLabel: "2+ Shots on Goal (-300)",
        statType: "shots",
        target: 2,
        apiStat: 2,
        manualDelta: 0,
        subDetail: "0G, 2A • 2 SOG • 22:07 TOI"
      }
    ]
  },
  {
    gameId: "STL_DAL_OCT02",
    title: "PLAYER PROP",
    odds: "-140",
    awayTeam: "STL",
    awayName: "STL Blues",
    homeTeam: "DAL",
    homeName: "DAL Stars",
    awayScore: 4,
    homeScore: 0,
    awaySog: 24,
    homeSog: 28,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Fri Oct 2 • 9:00 PM ET",
    gameStateText: "STL 4 - DAL 0 (Final)",
    legs: [
      {
        id: "johnston_pts_oct02",
        boyName: "Jackson",
        playerName: "Wyatt Johnston",
        team: "DAL",
        odds: "-140",
        marketLabel: "Over 0.5 Total Points (-140)",
        statType: "points",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 4 SOG • 21:49 TOI"
      }
    ]
  },
  {
    gameId: "WSH_CAR_OCT02",
    title: "MONEYLINE",
    odds: "-180",
    awayTeam: "WSH",
    awayName: "WSH Capitals",
    homeTeam: "CAR",
    homeName: "CAR Hurricanes",
    awayScore: 5,
    homeScore: 2,
    awaySog: 30,
    homeSog: 29,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Fri Oct 2 • 7:00 PM ET",
    gameStateText: "WSH 5 - CAR 2 (Final)",
    legs: [
      {
        id: "car_ml_oct02",
        boyName: "Axel",
        playerName: "Carolina Hurricanes ML",
        team: "CAR",
        odds: "-180",
        marketLabel: "Moneyline (-180)",
        statType: "moneyline",
        isTeamBet: true,
        teamAbbr: "CAR",
        spread: -0.5,
        teamBetCovering: false,
        teamBetHit: false,
        margin: -3,
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "CAR 2 - WSH 5 (-3 Margin • Final)"
      }
    ]
  },
  {
    gameId: "CHI_BUF_OCT03",
    title: "PLAYER PROP",
    odds: "+200",
    awayTeam: "CHI",
    awayName: "CHI Blackhawks",
    homeTeam: "BUF",
    homeName: "BUF Sabres",
    awayScore: 3,
    homeScore: 4,
    awaySog: 23,
    homeSog: 31,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Sat Oct 3 • 7:00 PM ET",
    gameStateText: "CHI 3 - BUF 4 (Final)",
    legs: [
      {
        id: "kane_goal_oct02",
        boyName: "Will",
        playerName: "Patrick Kane",
        team: "CHI",
        odds: "+200",
        marketLabel: "Anytime Goal Scorer (+200)",
        statType: "goals",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG • 19:01 TOI"
      }
    ]
  }
];

const DEFAULT_NOV13_SLATE = [
  {
    gameId: "NYR_VAN",
    title: "SAME GAME PARLAY",
    odds: "SGP",
    awayTeam: "NYR",
    awayName: "NYR Rangers",
    homeTeam: "VAN",
    homeName: "VAN Canucks",
    awayScore: 5,
    homeScore: 1,
    awaySog: 31,
    homeSog: 28,
    awayHits: 21,
    homeHits: 28,
    gameStatus: "final",
    statusDetail: "Final",
    startTime: "Fri Nov 13 • 9:00 PM ET",
    gameStateText: "NYR 5 - VAN 1 (Final)",
    legs: [
      {
        id: "ohgren_goals_nov13",
        boyName: "Edward",
        playerName: "Liam Ohgren",
        team: "VAN",
        odds: "+360",
        marketLabel: "Over 0.5 Total Goals (+360)",
        statType: "goals",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 2 SOG • 12:58 TOI"
      },
      {
        id: "boeser_pts_nov13",
        boyName: "Will",
        playerName: "Brock Boeser",
        team: "VAN",
        odds: "-135",
        marketLabel: "Over 0.5 Total Points (-135)",
        statType: "points",
        target: 1,
        apiStat: 1,
        manualDelta: 0,
        subDetail: "0G, 1A • 1 SOG • 21:34 TOI"
      },
      {
        id: "jtmiller_sog_nov13",
        boyName: "Ben",
        playerName: "J.T. Miller",
        team: "NYR",
        odds: "-140",
        marketLabel: "Over 1.5 Shots on Goal (-140)",
        statType: "shots",
        target: 2,
        apiStat: 2,
        manualDelta: 0,
        subDetail: "0G, 2A • 2 SOG • 18:49 TOI"
      }
    ]
  },
  {
    gameId: "NSH_VGK",
    title: "SAME GAME PARLAY",
    odds: "SGP",
    awayTeam: "NSH",
    awayName: "NSH Predators",
    homeTeam: "VGK",
    homeName: "VGK Golden Knights",
    awayScore: 3,
    homeScore: 2,
    awaySog: 32,
    homeSog: 42,
    awayHits: 18,
    homeHits: 20,
    gameStatus: "final",
    statusDetail: "Final/SO",
    startTime: "Fri Nov 13 • 10:00 PM ET",
    gameStateText: "NSH 3 - VGK 2 (Final/SO)",
    legs: [
      {
        id: "hill_saves_nov13",
        boyName: "Jackson",
        playerName: "Adin Hill",
        team: "VGK",
        odds: "-120",
        marketLabel: "Over 22.5 Total Saves (-120)",
        statType: "saves",
        target: 23,
        apiStat: 30,
        manualDelta: 0,
        subDetail: "30 SV • 32 SA, 2 GA • 65:00 TOI"
      },
      {
        id: "olofsson_sog_nov13",
        boyName: "Axel",
        playerName: "Victor Olofsson",
        team: "VGK",
        odds: "+125",
        marketLabel: "Over 2.5 Shots on Goal (+125)",
        statType: "shots",
        target: 3,
        apiStat: 4,
        manualDelta: 0,
        subDetail: "1G, 0A • 4 SOG • 15:23 TOI"
      }
    ]
  }
];

const DEFAULT_NOV21_SLATE = [
  {
    gameId: "NYI_DET",
    title: "SAME GAME PARLAY",
    odds: "+148",
    awayTeam: "NYI",
    awayName: "NYI Islanders",
    homeTeam: "DET",
    homeName: "DET Red Wings",
    awayScore: 0,
    homeScore: 0,
    awaySog: 0,
    homeSog: 0,
    gameStatus: "pre",
    statusDetail: "7:00 PM ET",
    startTime: "Sat Nov 21 • 7:00 PM ET",
    gameStateText: "7:00 PM ET",
    legs: [
      {
        id: "debrincat_pts_nov21",
        boyName: "Axel",
        playerName: "Alex DeBrincat",
        team: "DET",
        odds: "-222",
        marketLabel: "1+ Points (SGP +148)",
        statType: "points",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      },
      {
        id: "schaefer_sog_nov21",
        boyName: "Will",
        playerName: "Matthew Schaefer",
        team: "NYI",
        odds: "-150",
        marketLabel: "3+ Shots on Goal (SGP +148)",
        statType: "shots",
        target: 3,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      }
    ]
  },
  {
    gameId: "CBJ_TOR",
    title: "MONEYLINE",
    odds: "-122",
    awayTeam: "CBJ",
    awayName: "CBJ Blue Jackets",
    homeTeam: "TOR",
    homeName: "TOR Maple Leafs",
    awayScore: 0,
    homeScore: 0,
    awaySog: 0,
    homeSog: 0,
    gameStatus: "pre",
    statusDetail: "7:00 PM ET",
    startTime: "Sat Nov 21 • 7:00 PM ET",
    gameStateText: "7:00 PM ET",
    legs: [
      {
        id: "leafs_ml_nov21",
        boyName: "Jackson",
        playerName: "Toronto Maple Leafs ML",
        team: "TOR",
        teamAbbr: "TOR",
        isTeamBet: true,
        spread: -0.5,
        teamBetCovering: false,
        teamBetHit: false,
        margin: 0,
        odds: "-122",
        marketLabel: "Moneyline (-122)",
        statType: "moneyline",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "TOR 0 - CBJ 0 • Awaiting Puck Drop"
      }
    ]
  },
  {
    gameId: "WSH_BOS",
    title: "TOTAL GOALS",
    odds: "-106",
    awayTeam: "WSH",
    awayName: "WSH Capitals",
    homeTeam: "BOS",
    homeName: "BOS Bruins",
    awayScore: 0,
    homeScore: 0,
    awaySog: 0,
    homeSog: 0,
    gameStatus: "pre",
    statusDetail: "7:00 PM ET",
    startTime: "Sat Nov 21 • 7:00 PM ET",
    gameStateText: "7:00 PM ET",
    legs: [
      {
        id: "wsh_bos_u65_nov21",
        boyName: "Alex",
        playerName: "WSH @ BOS Under 6.5",
        team: "BOS",
        isTeamBet: true,
        line: 6.5,
        teamBetCovering: true,
        teamBetHit: false,
        teamBetBusted: false,
        odds: "-106",
        marketLabel: "Under 6.5 Total Goals (-106)",
        statType: "total_under",
        target: 6.5,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0 Total Goals • Need ≤ 6 Goals"
      }
    ]
  },
  {
    gameId: "ANA_UTA",
    title: "SAME GAME PARLAY",
    odds: "+151",
    awayTeam: "ANA",
    awayName: "ANA Ducks",
    homeTeam: "UTA",
    homeName: "UTA Mammoth",
    awayScore: 0,
    homeScore: 0,
    awaySog: 0,
    homeSog: 0,
    gameStatus: "pre",
    statusDetail: "9:00 PM ET",
    startTime: "Sat Nov 21 • 9:00 PM ET",
    gameStateText: "9:00 PM ET",
    legs: [
      {
        id: "lacombe_pts_nov21",
        boyName: "Ben",
        playerName: "Jackson LaCombe",
        team: "ANA",
        odds: "-172",
        marketLabel: "1+ Points (SGP +151)",
        statType: "points",
        target: 1,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      },
      {
        id: "gauthier_sog_nov21",
        boyName: "Edward",
        playerName: "Cutter Gauthier",
        team: "ANA",
        odds: "-125",
        marketLabel: "4+ Shots on Goal (SGP +151)",
        statType: "shots",
        target: 4,
        apiStat: 0,
        manualDelta: 0,
        subDetail: "0G, 0A • 0 SOG"
      }
    ]
  }
];

function getSlateForDate(dateStr) {
  if (dateStr === '2026-10-02') {
    return JSON.parse(JSON.stringify(DEFAULT_OCT02_SLATE));
  }
  if (dateStr === '2026-10-16') {
    return JSON.parse(JSON.stringify(DEFAULT_OCT16_SLATE));
  }
  if (dateStr === '2026-10-23') {
    return JSON.parse(JSON.stringify(DEFAULT_OCT23_SLATE));
  }
  if (dateStr === '2026-10-30') {
    return JSON.parse(JSON.stringify(DEFAULT_OCT30_SLATE));
  }
  if (dateStr === '2026-11-06') {
    return JSON.parse(JSON.stringify(DEFAULT_NOV06_SLATE));
  }
  if (dateStr === '2026-11-13') {
    return JSON.parse(JSON.stringify(DEFAULT_NOV13_SLATE));
  }
  if (dateStr === '2026-11-21') {
    return JSON.parse(JSON.stringify(DEFAULT_NOV21_SLATE));
  }
  return [];
}

const KNOWN_NOV21_PLAYERS = {
  Axel: { name: 'Alex DeBrincat', target: 1, type: 'points', odds: '-222', label: '1+ Points (SGP +148)' },
  Will: { name: 'Matthew Schaefer', target: 3, type: 'shots', odds: '-150', label: '3+ Shots on Goal (SGP +148)' },
  Ben: { name: 'Jackson LaCombe', target: 1, type: 'points', odds: '-172', label: '1+ Points (SGP +151)' },
  Edward: { name: 'Cutter Gauthier', target: 4, type: 'shots', odds: '-125', label: '4+ Shots on Goal (SGP +151)' },
  Jackson: { name: 'Toronto Maple Leafs ML', target: 1, type: 'moneyline', odds: '-122', label: 'Moneyline (-122)', isTeamBet: true, teamAbbr: 'TOR', spread: -0.5 },
  Alex: { name: 'WSH @ BOS Under 6.5', target: 6.5, type: 'total_under', odds: '-106', label: 'Under 6.5 Total Goals (-106)', isTeamBet: true, line: 6.5 }
};

const KNOWN_NOV13_PLAYERS = {
  Edward: { name: 'Liam Ohgren', target: 1, type: 'goals', odds: '+360', label: 'Over 0.5 Total Goals (+360)' },
  Will: { name: 'Brock Boeser', target: 1, type: 'points', odds: '-135', label: 'Over 0.5 Total Points (-135)' },
  Ben: { name: 'J.T. Miller', target: 2, type: 'shots', odds: '-140', label: 'Over 1.5 Shots on Goal (-140)' },
  Jackson: { name: 'Adin Hill', target: 23, type: 'saves', odds: '-120', label: 'Over 22.5 Total Saves (-120)' },
  Axel: { name: 'Victor Olofsson', target: 3, type: 'shots', odds: '+125', label: 'Over 2.5 Shots on Goal (+125)' }
};

const KNOWN_NOV06_PLAYERS = {
  Jackson: { name: 'Matt Boldy', target: 3, type: 'shots', odds: '-135', label: '3+ Shots on Goal (-135)' },
  Alex: { name: 'Minnesota Wild -1.5', target: 2, type: 'puckline', odds: '+110', label: 'Puck Line -1.5 (+110)', isTeamBet: true, teamAbbr: 'MIN', spread: -1.5 },
  Ben: { name: 'Quinn Hughes', target: 1, type: 'points', odds: '-390', label: 'Over 0.5 Total Points (-390)' },
  Will: { name: 'Cutter Gauthier', target: 1, type: 'goals', odds: '+137', label: 'Anytime Goal Scorer (+137)' },
  Edward: { name: 'Beckett Sennecke', target: 1, type: 'points', odds: '-195', label: 'Over 0.5 Total Points (-195)' },
  Axel: { name: 'Kent Johnson', target: 1, type: 'points', odds: '-120', label: 'Over 0.5 Total Points (-120)' }
};

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
    case 'puckline': return 'PL';
    case 'moneyline': return 'ML';
    case 'total_under': return 'U';
    case 'total_over': return 'O';
    case 'saves': return 'SAVES';
    case 'shots': return 'SOG';
    case 'goals': return 'GOALS';
    case 'assists': return 'AST';
    case 'blocks': return 'BLK';
    case 'hits': return 'HITS';
    default: return 'PTS';
  }
}

const NHL_TEAM_CATALOG = [
  { abbr: 'ANA', full: 'Anaheim Ducks', keys: ['anaheim ducks', 'anaheim', 'ducks'] },
  { abbr: 'BOS', full: 'Boston Bruins', keys: ['boston bruins', 'boston', 'bruins'] },
  { abbr: 'BUF', full: 'Buffalo Sabres', keys: ['buffalo sabres', 'buffalo', 'sabres'] },
  { abbr: 'CGY', full: 'Calgary Flames', keys: ['calgary flames', 'calgary', 'flames'] },
  { abbr: 'CAR', full: 'Carolina Hurricanes', keys: ['carolina hurricanes', 'carolina', 'hurricanes', 'canes'] },
  { abbr: 'CHI', full: 'Chicago Blackhawks', keys: ['chicago blackhawks', 'chicago', 'blackhawks', 'hawks'] },
  { abbr: 'COL', full: 'Colorado Avalanche', keys: ['colorado avalanche', 'colorado', 'avalanche', 'avs'] },
  { abbr: 'CBJ', full: 'Columbus Blue Jackets', keys: ['columbus blue jackets', 'columbus', 'blue jackets', 'jackets'] },
  { abbr: 'DAL', full: 'Dallas Stars', keys: ['dallas stars', 'dallas', 'stars'] },
  { abbr: 'DET', full: 'Detroit Red Wings', keys: ['detroit red wings', 'detroit', 'red wings', 'wings'] },
  { abbr: 'EDM', full: 'Edmonton Oilers', keys: ['edmonton oilers', 'edmonton', 'oilers'] },
  { abbr: 'FLA', full: 'Florida Panthers', keys: ['florida panthers', 'florida', 'panthers', 'cats'] },
  { abbr: 'LAK', full: 'Los Angeles Kings', keys: ['los angeles kings', 'los angeles', 'la kings', 'kings'] },
  { abbr: 'MIN', full: 'Minnesota Wild', keys: ['minnesota wild', 'minnesota', 'wild'] },
  { abbr: 'MTL', full: 'Montreal Canadiens', keys: ['montreal canadiens', 'montreal', 'canadiens', 'habs'] },
  { abbr: 'NSH', full: 'Nashville Predators', keys: ['nashville predators', 'nashville', 'predators', 'preds'] },
  { abbr: 'NJD', full: 'New Jersey Devils', keys: ['new jersey devils', 'new jersey', 'devils'] },
  { abbr: 'NYI', full: 'New York Islanders', keys: ['new york islanders', 'islanders', 'isles'] },
  { abbr: 'NYR', full: 'New York Rangers', keys: ['new york rangers', 'rangers'] },
  { abbr: 'OTT', full: 'Ottawa Senators', keys: ['ottawa senators', 'ottawa', 'senators', 'sens'] },
  { abbr: 'PHI', full: 'Philadelphia Flyers', keys: ['philadelphia flyers', 'philadelphia', 'flyers'] },
  { abbr: 'PIT', full: 'Pittsburgh Penguins', keys: ['pittsburgh penguins', 'pittsburgh', 'penguins', 'pens'] },
  { abbr: 'SJS', full: 'San Jose Sharks', keys: ['san jose sharks', 'san jose', 'sharks'] },
  { abbr: 'SEA', full: 'Seattle Kraken', keys: ['seattle kraken', 'seattle', 'kraken'] },
  { abbr: 'STL', full: 'St. Louis Blues', keys: ['st. louis blues', 'st louis blues', 'st louis', 'blues'] },
  { abbr: 'TBL', full: 'Tampa Bay Lightning', keys: ['tampa bay lightning', 'tampa bay', 'lightning', 'bolts'] },
  { abbr: 'TOR', full: 'Toronto Maple Leafs', keys: ['toronto maple leafs', 'toronto', 'maple leafs', 'leafs'] },
  { abbr: 'UTA', full: 'Utah Hockey Club', keys: ['utah hockey club', 'utah mammoth', 'utah'] },
  { abbr: 'VAN', full: 'Vancouver Canucks', keys: ['vancouver canucks', 'vancouver', 'canucks'] },
  { abbr: 'VGK', full: 'Vegas Golden Knights', keys: ['vegas golden knights', 'vegas', 'golden knights', 'knights'] },
  { abbr: 'WSH', full: 'Washington Capitals', keys: ['washington capitals', 'washington', 'capitals', 'caps'] },
  { abbr: 'WPG', full: 'Winnipeg Jets', keys: ['winnipeg jets', 'winnipeg', 'jets'] }
];

const PLAYER_NICKNAME_ALIASES = {
  'cutter': 'Cutter Gauthier',
  'cutter g': 'Cutter Gauthier',
  'schaefer': 'Matthew Schaefer',
  'lacombe': 'Jackson LaCombe',
  'slaf': 'Juraj Slafkovsky',
  'slafkovsky': 'Juraj Slafkovsky',
  'mack': 'Nathan MacKinnon',
  'nate dogg': 'Nathan MacKinnon',
  'mackinnon': 'Nathan MacKinnon',
  'kuch': 'Nikita Kucherov',
  'kucherov': 'Nikita Kucherov',
  'mcmann': 'Bobby McMann',
  'sennecke': 'Beckett Sennecke',
  'boldy': 'Matt Boldy',
  'boesr': 'Brock Boeser',
  'boeser': 'Brock Boeser',
  'ohgren': 'Liam Ohgren',
  'jt miller': 'J.T. Miller',
  'bedsy': 'Connor Bedard',
  'pasta': 'David Pastrnak',
  'ovi': 'Alex Ovechkin',
  'sid': 'Sidney Crosby'
};

function resolveTeamFromPickText(pickText) {
  if (!pickText) return null;
  const low = pickText.toLowerCase();
  for (const t of NHL_TEAM_CATALOG) {
    for (const k of t.keys) {
      const rx = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
      if (rx.test(low)) return t;
    }
  }
  for (const t of NHL_TEAM_CATALOG) {
    const abbrRx = new RegExp(`\\b${t.abbr}\\b`, 'i');
    if (abbrRx.test(pickText)) return t;
  }
  return null;
}

// Convert any squad member's pick string into an NHL API-trackable leg (Player Prop OR Team Puckline/Moneyline)
function parsePickIntoLeg(boyName, pickObj) {
  const pickText = (pickObj.pick_text || '').trim();
  const oddsStr = (pickObj.odds || '').trim();
  const betTypeRaw = (pickObj.bet_type || pickObj.betType || '').toLowerCase();

  // Official Nov 21 canonical mapping (FanDuel 6-Leg SGP+ Split: $20 @ +2105 + $5 50% Boost @ +3158 = $603.99)
  if (state.currentFridayStr === '2026-11-21' && KNOWN_NOV21_PLAYERS[boyName]) {
    const known = KNOWN_NOV21_PLAYERS[boyName];
    if (known.type === 'total_under' || known.type === 'total_over') {
      return {
        id: `${boyName.toLowerCase()}_${known.type}_nov21`,
        boyName: boyName,
        playerName: known.name,
        isTeamBet: true,
        line: known.line,
        odds: oddsStr || known.odds,
        marketLabel: known.label,
        statType: known.type,
        target: known.target,
        apiStat: 0,
        subDetail: `0 Total Goals • Need ≤ ${Math.floor(known.line)} Goals`
      };
    }
    if (known.isTeamBet) {
      return {
        id: `${boyName.toLowerCase()}_${known.type}_nov21`,
        boyName: boyName,
        playerName: known.name,
        teamAbbr: known.teamAbbr,
        isTeamBet: true,
        spread: known.spread,
        odds: oddsStr || known.odds,
        marketLabel: known.label,
        statType: known.type,
        target: known.target,
        apiStat: 0,
        subDetail: '0 - 0 • Awaiting Puck Drop'
      };
    }
    return {
      id: `${boyName.toLowerCase()}_${known.type}_nov21`,
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

  // Official Nov 13 canonical mapping (Betway 5-Fold BetBuilder+ @ +5525)
  if (state.currentFridayStr === '2026-11-13' && KNOWN_NOV13_PLAYERS[boyName]) {
    const known = KNOWN_NOV13_PLAYERS[boyName];
    const lastToken = known.name.split(' ').slice(-1)[0].toLowerCase();
    if (!pickText || pickText.toLowerCase().includes(lastToken) || (boyName === 'Will' && pickText.toLowerCase().includes('boes'))) {
      return {
        id: `${boyName.toLowerCase()}_${known.type}_nov13`,
        boyName: boyName,
        playerName: known.name,
        odds: oddsStr || known.odds,
        marketLabel: known.label,
        statType: known.type,
        target: known.target,
        apiStat: 0,
        subDetail: known.type === 'saves' ? '0 SV • 0 SA, 0 GA' : '0G, 0A • 0 SOG'
      };
    }
  }

  // Official Nov 6 canonical mapping
  if (state.currentFridayStr === '2026-11-06' && KNOWN_NOV06_PLAYERS[boyName]) {
    const known = KNOWN_NOV06_PLAYERS[boyName];
    const checkToken = known.isTeamBet ? 'wild' : known.name.split(' ')[0].toLowerCase();
    const lastToken = known.name.split(' ').slice(-1)[0].toLowerCase();
    if (!pickText || pickText.toLowerCase().includes(checkToken) || pickText.toLowerCase().includes(lastToken)) {
      if (known.isTeamBet) {
        return {
          id: `${boyName.toLowerCase()}_puckline_nov06`,
          boyName: boyName,
          playerName: known.name,
          teamAbbr: known.teamAbbr,
          isTeamBet: true,
          spread: known.spread,
          odds: oddsStr || known.odds,
          marketLabel: oddsStr ? `Puck Line -1.5 (${oddsStr})` : known.label,
          statType: 'puckline',
          target: known.target,
          apiStat: 0,
          subDetail: '0 - 0 • Awaiting Puck Drop'
        };
      }
      return {
        id: `${boyName.toLowerCase()}_${known.type}_nov06`,
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

  // Detect Game Total Over/Under Goals (e.g. "Under 6.5 goals", "Over 5.5 Total Goals")
  const gameTotalMatch = pickText.match(/^(?:[A-Z]{2,3}\s*@\s*[A-Z]{2,3}\s+)?(under|over)\s+(\d+(?:\.\d+)?)\s*(?:total\s*)?(?:goals?)?$/i);
  if (gameTotalMatch || (betTypeRaw === 'total' && /\b(under|over)\s+(\d+(?:\.\d+)?)\s*(?:total\s*)?goals?\b/i.test(pickText) && !/\b(points?|pts|shots?|sog|assists?|saves?|blocks?|hits?)\b/i.test(pickText))) {
    const m = gameTotalMatch || pickText.match(/\b(under|over)\s+(\d+(?:\.\d+)?)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const lineVal = parseFloat(m[2]);
      const isUnder = dir === 'under';
      const labelDir = isUnder ? 'Under' : 'Over';
      return {
        id: `${boyName.toLowerCase()}_total_${dir}_${Date.now() % 10000}`,
        boyName: boyName,
        playerName: `${labelDir} ${lineVal} Total Goals`,
        isTeamBet: true,
        line: lineVal,
        odds: oddsStr,
        marketLabel: `${labelDir} ${lineVal} Total Goals${oddsStr ? ` (${oddsStr})` : ''}`,
        statType: isUnder ? 'total_under' : 'total_over',
        target: lineVal,
        apiStat: 0,
        subDetail: isUnder ? `0 Total Goals • Need ≤ ${Math.floor(lineVal)} Goals` : `0 Total Goals • Need ${Math.floor(lineVal) + 1}+ Goals`
      };
    }
  }

  // Detect Team Puck Line or Team Moneyline Bets
  const hasPlayerPropKeywords = /\b(shots?\s*on\s*goal|shots?|sog|points?|pts|goals?|anytime\s*goal|assists?|ast|saves?|sv|blocks?|blocked\s*shots?|blk|hits?|over|under|\d+\+)\b/i.test(pickText);
  const spreadMatch = pickText.match(/([+-]\d+\.5)/);
  const isPucklinePick = /\bpuck\s*line\b|\bpuckline\b/i.test(pickText) ||
    ((betTypeRaw === 'puckline' || !!spreadMatch) && !hasPlayerPropKeywords);
  const isMoneylinePick = !isPucklinePick && !hasPlayerPropKeywords && (
    /\bmoney\s*line\b|\bmoneyline\b|\bml\b|\bto\s+win\b/i.test(pickText) ||
    betTypeRaw === 'moneyline'
  );

  if (isPucklinePick || isMoneylinePick) {
    const teamMatch = resolveTeamFromPickText(pickText);
    if (teamMatch) {
      if (isPucklinePick) {
        const spreadVal = spreadMatch ? parseFloat(spreadMatch[1]) : -1.5;
        const spreadLabel = spreadVal > 0 ? `+${spreadVal}` : `${spreadVal}`;
        const targetGoals = spreadVal < 0 ? Math.ceil(Math.abs(spreadVal)) : 0;
        return {
          id: `${boyName.toLowerCase()}_puckline_${Date.now() % 10000}`,
          boyName: boyName,
          playerName: `${teamMatch.full} ${spreadLabel}`,
          teamAbbr: teamMatch.abbr,
          isTeamBet: true,
          spread: spreadVal,
          odds: oddsStr,
          marketLabel: `Puck Line ${spreadLabel}${oddsStr ? ` (${oddsStr})` : ''}`,
          statType: 'puckline',
          target: targetGoals,
          apiStat: 0,
          subDetail: '0 - 0 • Awaiting Puck Drop'
        };
      } else {
        return {
          id: `${boyName.toLowerCase()}_moneyline_${Date.now() % 10000}`,
          boyName: boyName,
          playerName: `${teamMatch.full} ML`,
          teamAbbr: teamMatch.abbr,
          isTeamBet: true,
          spread: -0.5,
          odds: oddsStr,
          marketLabel: `Moneyline${oddsStr ? ` (${oddsStr})` : ''}`,
          statType: 'moneyline',
          target: 1,
          apiStat: 0,
          subDetail: '0 - 0 • Awaiting Puck Drop'
        };
      }
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
  const isGoal = !isShot && /\b(goals?|anytime\s*goal(?:\s*scorer)?|atgs)\b/i.test(pickText);

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
    marketLabel = /anytime\s*goal/i.test(pickText)
      ? 'Anytime Goal Scorer'
      : (overMatch ? `Over ${overMatch[1]} Total Goals` : (target === 1 ? 'Over 0.5 Total Goals' : `${target}+ Total Goals`));
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

  // Upgrade known single-name/nickname shorthand (e.g. "Cutter" -> "Cutter Gauthier", "Slaf" -> "Juraj Slafkovsky")
  const normCandidate = (playerName || '').toLowerCase().trim();
  if (PLAYER_NICKNAME_ALIASES[normCandidate]) {
    playerName = PLAYER_NICKNAME_ALIASES[normCandidate];
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
  if (state.currentFridayStr === '2026-10-02' || state.currentFridayStr === '2026-10-16') {
    state.trackerData = getSlateForDate(state.currentFridayStr);
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

  // Preserve any existing live apiStat / gameStateText / gameStatus / live scores & SOG if already synced
  const prevGamesMap = {};
  const prevLegsMap = {};
  (state.trackerData || []).forEach(g => {
    prevGamesMap[g.gameId] = {
      gameStateText: g.gameStateText,
      gameStatus: g.gameStatus,
      statusDetail: g.statusDetail,
      awayScore: g.awayScore,
      homeScore: g.homeScore,
      awaySog: g.awaySog,
      homeSog: g.homeSog,
      awayHits: g.awayHits,
      homeHits: g.homeHits,
      awayBlocks: g.awayBlocks,
      homeBlocks: g.homeBlocks
    };
    (g.legs || []).forEach(l => {
      prevLegsMap[l.boyName] = {
        apiStat: l.apiStat,
        subDetail: l.subDetail,
        teamBetHit: l.teamBetHit,
        teamBetCovering: l.teamBetCovering,
        teamBetBusted: l.teamBetBusted,
        margin: l.margin
      };
    });
  });

  // Check if this is a future/custom week where picks belong to games outside the default slate
  const isKnownWeek = state.currentFridayStr === '2026-10-23' ||
                      state.currentFridayStr === '2026-10-30' ||
                      state.currentFridayStr === '2026-11-06' ||
                      state.currentFridayStr === '2026-11-13' ||
                      state.currentFridayStr === '2026-11-21';
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
          awayScore: prevGamesMap[gameKey]?.awayScore,
          homeScore: prevGamesMap[gameKey]?.homeScore,
          awaySog: prevGamesMap[gameKey]?.awaySog,
          homeSog: prevGamesMap[gameKey]?.homeSog,
          awayHits: prevGamesMap[gameKey]?.awayHits,
          homeHits: prevGamesMap[gameKey]?.homeHits,
          statusDetail: prevGamesMap[gameKey]?.statusDetail,
          startTime: `${getDayLabelForDateStr(state.currentFridayStr)}, ${state.currentFridayStr}`,
          gameStateText: prevGamesMap[gameKey]?.gameStateText || 'Scheduled',
          gameStatus: prevGamesMap[gameKey]?.gameStatus || 'pre',
          odds: 'SGP',
          legs: []
        };
      }
      const parsed = parsePickIntoLeg(boy.name, realPick);
      const prev = prevLegsMap[boy.name];
      if (prev && prev.apiStat !== undefined) parsed.apiStat = prev.apiStat;
      if (prev && prev.subDetail) parsed.subDetail = prev.subDetail;
      if (prev && prev.teamBetHit !== undefined) parsed.teamBetHit = prev.teamBetHit;
      if (prev && prev.teamBetCovering !== undefined) parsed.teamBetCovering = prev.teamBetCovering;
      if (prev && prev.margin !== undefined) parsed.margin = prev.margin;
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
      Object.assign(game, prevGamesMap[game.gameId]);
    }
    game.legs.forEach(leg => {
      const realPick = state.legs[leg.boyName];
      if (realPick && realPick.pick_text) {
        const parsed = parsePickIntoLeg(leg.boyName, realPick);
        leg.playerName = parsed.playerName || leg.playerName;
        leg.statType = parsed.statType || leg.statType;
        leg.target = parsed.target ?? leg.target;
        leg.marketLabel = parsed.marketLabel || leg.marketLabel;
        leg.odds = realPick.odds || leg.odds;
        if (parsed.isTeamBet) {
          leg.isTeamBet = true;
          leg.teamAbbr = parsed.teamAbbr || leg.teamAbbr;
          leg.spread = parsed.spread ?? leg.spread;
          if (parsed.line !== undefined) leg.line = parsed.line;
        }
        const prev = prevLegsMap[leg.boyName];
        leg.apiStat = (prev && prev.apiStat !== undefined) ? prev.apiStat : (leg.apiStat || 0);
        leg.subDetail = (prev && prev.subDetail) ? prev.subDetail : (leg.subDetail || parsed.subDetail);
        if (prev && prev.teamBetHit !== undefined) leg.teamBetHit = prev.teamBetHit;
        if (prev && prev.teamBetCovering !== undefined) leg.teamBetCovering = prev.teamBetCovering;
        if (prev && prev.teamBetBusted !== undefined) leg.teamBetBusted = prev.teamBetBusted;
        if (prev && prev.margin !== undefined) leg.margin = prev.margin;
      }
    });
  });

  state.trackerData = slate;
  saveTrackerData();
}

// Initialize Tracker Data from LocalStorage or Default (Purely NHL API Data-Driven)
const TRACKER_STORAGE_KEY = "b365_sgp_tracker_data_v10";

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
const STATS_STORAGE_KEY = "bts_squad_stats_history_v12";
const PAYOUT_LOG_STORAGE_KEY = "bts_payout_settlement_log_v1";
const PAYOUT_LOG_SUPABASE_ID = "payout_log_v1";

function initPayoutLog() {
  try {
    const raw = localStorage.getItem(PAYOUT_LOG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state.payoutLog = parsed;
        return;
      }
    }
  } catch (e) {}
  state.payoutLog = {};
}

function saveLocalPayoutLog() {
  try {
    localStorage.setItem(PAYOUT_LOG_STORAGE_KEY, JSON.stringify(state.payoutLog || {}));
  } catch (e) {}
}

async function fetchPayoutLogFromSupabase() {
  if (!state.supabase) return;
  try {
    const { data, error } = await state.supabase
      .from('friday_parlays')
      .select('notes')
      .eq('id', PAYOUT_LOG_SUPABASE_ID)
      .maybeSingle();

    if (!error && data && data.notes) {
      const parsed = JSON.parse(data.notes);
      if (parsed && typeof parsed === 'object') {
        state.payoutLog = parsed;
        saveLocalPayoutLog();
        if (state.currentView === 'statsView') renderStatsView();
      }
    }
  } catch (e) {
    console.warn('Could not fetch payout log from Supabase:', e);
  }
}

async function savePayoutLogToSupabase() {
  if (!state.supabase) return;
  try {
    await state.supabase
      .from('friday_parlays')
      .upsert({
        id: PAYOUT_LOG_SUPABASE_ID,
        week_date: '2026-10-01',
        bettor_name: 'Squad',
        status: 'payout_log',
        stake: 0,
        total_odds: '--',
        potential_payout: 0,
        notes: JSON.stringify(state.payoutLog || {}),
        updated_at: new Date().toISOString()
      });
  } catch (e) {
    console.warn('Could not sync payout log to Supabase:', e);
  }
}

window.togglePayoutStatus = async function(dateStr, boyName, weekNum, shareAmount) {
  if (!dateStr || !boyName) return;
  if (!state.payoutLog || typeof state.payoutLog !== 'object') state.payoutLog = {};
  if (!state.payoutLog[dateStr] || typeof state.payoutLog[dateStr] !== 'object') {
    state.payoutLog[dateStr] = {};
  }
  const current = state.payoutLog[dateStr][boyName];
  const nextPaid = !(current && current.paid);
  state.payoutLog[dateStr][boyName] = {
    paid: nextPaid,
    paidAt: nextPaid ? new Date().toISOString() : null
  };
  saveLocalPayoutLog();
  playSound(nextPaid ? 'lock' : 'click');
  renderStatsView();
  showToast(
    nextPaid
      ? `Marked ${boyName} PAID ($${Number(shareAmount).toFixed(2)}) for Week ${weekNum}!`
      : `Marked ${boyName} UNPAID for Week ${weekNum}`,
    nextPaid ? 'checkCircle' : 'clock'
  );
  await savePayoutLogToSupabase();
};

window.copyPayoutStatusSummary = function(dateStr, weekNum, bettorName, payout, perBoyShare) {
  const weekLog = (state.payoutLog && state.payoutLog[dateStr]) || {};
  const shareStr = Number(perBoyShare).toFixed(2);
  const lines = [
    `💸 Week ${weekNum} Payout Log ($${Number(payout).toFixed(2)} ÷ 6 = $${shareStr}/guy • Bettor: ${bettorName})`,
    ``
  ];
  let unpaidList = [];
  SQUAD.forEach(b => {
    if (b.name === bettorName) {
      lines.push(`✅ ${b.name}: $${shareStr} (Kept own share)`);
    } else if (weekLog[b.name]?.paid) {
      lines.push(`✅ ${b.name}: $${shareStr} (PAID)`);
    } else {
      lines.push(`⏳ ${b.name}: $${shareStr} (UNPAID)`);
      unpaidList.push(b.name);
    }
  });
  lines.push(``);
  if (unpaidList.length === 0) {
    lines.push(`🏆 All 6/6 guys settled up!`);
  } else {
    const owedAmt = (unpaidList.length * Number(perBoyShare)).toFixed(2);
    lines.push(`Still owed by ${bettorName}: $${owedAmt} (${unpaidList.join(', ')})`);
  }
  const text = lines.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Copied Week ${weekNum} payout log to clipboard!`, 'checkCircle');
    }).catch(() => {
      showToast('Copy failed — check clipboard permissions', 'alert');
    });
  }
};

const DEFAULT_STATS_HISTORY = [
  {
    weekNum: 1,
    dateStr: '2026-10-02',
    bettor: 'Ben',
    stake: 5,
    totalOdds: '+1500',
    payout: 0,
    result: 'loss', // 2 of 5 hit!
    notes: 'Inaugural Friday Puck Parlay! Ben lowered the wager to $5 on Bet365 (+1500 -> $80.00 potential payout) with the original 5 guys before Edward joined. 2 of 5 legs hit: Ben (Marner 1A) and Alex (Eichel 2 SOG) cashed Friday night, while Jackson (Wyatt Johnston 0 PTS), Axel (Canes ML 2-5), and Will (Patrick Kane 0G) missed.',
    legs: [
      { boy: 'Ben', pick: 'Mitch Marner — 1+ Points', odds: '-200', result: 'hit' },
      { boy: 'Alex', pick: 'Jack Eichel — 2+ Shots on Goal', odds: '-300', result: 'hit' },
      { boy: 'Jackson', pick: 'Wyatt Johnston — 1+ Points', odds: '-140', result: 'miss' },
      { boy: 'Will', pick: 'Patrick Kane — Anytime Goal Scorer', odds: '+200', result: 'miss' },
      { boy: 'Axel', pick: 'Carolina Hurricanes Moneyline', odds: '-180', result: 'miss' }
    ]
  },
  {
    weekNum: 2,
    dateStr: '2026-10-16',
    bettor: 'Axel',
    stake: 25,
    totalOdds: '+950',
    payout: 0,
    result: 'loss', // 4 of 5 hit!
    notes: 'Axel placed from the States while Jackson was away ($25 stake). 4 of 5 legs hit — Ben missed on Leo Carlsson and sold the parlay! (Edward joined the squad in Week 3)',
    legs: [
      { boy: 'Axel', pick: 'Brock Nelson 1+ Points', odds: '-140', result: 'hit' },
      { boy: 'Jackson', pick: 'Nathan MacKinnon 4+ SOG', odds: '-130', result: 'hit' },
      { boy: 'Will', pick: 'Pavel Zacha 1+ Points', odds: '+120', result: 'hit' },
      { boy: 'Alex', pick: 'Beckett Sennecke 1+ Points', odds: '+110', result: 'hit' },
      { boy: 'Ben', pick: 'Leo Carlsson 1+ Points', odds: '-115', result: 'miss' }
    ]
  },
  {
    weekNum: 3,
    dateStr: '2026-10-23',
    bettor: 'Jackson',
    stake: 30,
    totalOdds: '+1261',
    payout: 0,
    result: 'loss',
    notes: 'Jackson placed on FanDuel ($30 SGP+ at +1261) — Edward joined as the 6th member! 3 of 6 legs hit: Edward (Caufield 4 SOG), Jackson (MacKinnon 4 SOG, 4 PTS), and Axel (Hagel 1 PT) cashed, while Will (Slafkovsky 0 PTS), Ben (Hutson 0 SOG), and Alex (Kucherov 0 G) missed.',
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
    weekNum: 4,
    dateStr: '2026-10-30',
    bettor: 'Will',
    stake: 30,
    totalOdds: '+2394',
    payout: 0,
    result: 'loss',
    notes: 'Will placed on BET99 ($30 SGP+ at +2394). 2 of 6 legs hit — Axel (Verhaeghe 1A) and Will (Stephenson 1A at +155) cashed, while Jackson (Bennett 2 SOG), Alex (Jones 1 SOG), Ben (McMann 0 PTS), and Edward (Montour 0 PTS) missed.',
    legs: [
      { boy: 'Axel', pick: 'Carter Verhaeghe — Over 0.5 Points', odds: '-160', result: 'hit' },
      { boy: 'Jackson', pick: 'Sam Bennett — Over 2.5 Shots on Goal', odds: '-105', result: 'miss' },
      { boy: 'Will', pick: 'Chandler Stephenson — Over 0.5 Assists', odds: '+155', result: 'hit' },
      { boy: 'Alex', pick: 'Seth Jones — Over 2.5 Shots on Goal', odds: '+115', result: 'miss' },
      { boy: 'Ben', pick: 'Bobby McMann — Over 0.5 Points', odds: '-120', result: 'miss' },
      { boy: 'Edward', pick: 'Brandon Montour — Over 0.5 Points', odds: '+105', result: 'miss' }
    ]
  },
  {
    weekNum: 5,
    dateStr: '2026-11-06',
    bettor: 'Alex',
    stake: 30,
    totalOdds: '+1414',
    payout: 454.41,
    result: 'win',
    notes: 'FIRST PARLAY CASHED IN FRANCHISE HISTORY! Alex placed on FanDuel ($30 SGP+ at +1414 -> $454.41 payout, $75.74/guy). All 6/6 legs hit: Boldy 7 SOG, Wild -1.5 (4-1), Quinn Hughes 3 PTS, Cutter Gauthier 1G, Beckett Sennecke 2A, and Kent Johnson 2 PTS!',
    legs: [
      { boy: 'Axel', pick: 'Kent Johnson — 1+ Points', odds: '-120', result: 'hit' },
      { boy: 'Jackson', pick: 'Matt Boldy — 3+ Shots on Goal', odds: '-135', result: 'hit' },
      { boy: 'Will', pick: 'Cutter Gauthier — Anytime Goal Scorer', odds: '+137', result: 'hit' },
      { boy: 'Alex', pick: 'Minnesota Wild -1.5 Puck Line', odds: '+110', result: 'hit' },
      { boy: 'Ben', pick: 'Quinn Hughes — 1+ Points', odds: '-390', result: 'hit' },
      { boy: 'Edward', pick: 'Beckett Sennecke — 1+ Points', odds: '-195', result: 'hit' }
    ]
  },
  {
    weekNum: 6,
    dateStr: '2026-11-13',
    bettor: 'Edward',
    stake: 25,
    totalOdds: '+5525',
    payout: 0,
    result: 'loss',
    notes: 'Edward locked in a $25 5-Fold BetBuilder+ on Betway (@ +5525 -> $1,406.25 potential return)! 4 of 5 legs cashed (Will Boeser 1A, Ben J.T. Miller 2 SOG, Jackson Adin Hill 30 SV, Axel Olofsson 4 SOG / 1G) — Edward sold his own bettor week on Liam Ohgren 0G! Alex sat out Week 6.',
    legs: [
      { boy: 'Edward', pick: 'Liam Ohgren — Over 0.5 Total Goals', odds: '+360', result: 'miss' },
      { boy: 'Will', pick: 'Brock Boeser — Over 0.5 Total Points', odds: '-135', result: 'hit' },
      { boy: 'Ben', pick: 'J.T. Miller — Over 1.5 Shots on Goal', odds: '-140', result: 'hit' },
      { boy: 'Jackson', pick: 'Adin Hill — Over 22.5 Total Saves', odds: '-120', result: 'hit' },
      { boy: 'Axel', pick: 'Victor Olofsson — Over 2.5 Shots on Goal', odds: '+125', result: 'hit' }
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
    if (!week.payout || week.payout <= 0) {
      const canonicalSlip = DEFAULT_MASTER_SLIPS[week.dateStr];
      week.payout = canonicalSlip?.potential_payout
        ? parseFloat(canonicalSlip.potential_payout)
        : Number(((week.stake || 30) * americanToDecimal(week.totalOdds)).toFixed(2));
    }
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

  // Undefeated multi-week streak (e.g. Axel 4-0 W4)
  if (p.hits > 0 && p.misses === 0 && p.streak >= 2) {
    return {
      title: `Undefeated (W${p.streak})`,
      pillClass: 'sniper',
      icon: 'fire',
      statTag: `${p.hits}-${p.misses} (100%)`,
      blurb: `Perfect ${p.hits}-0! ${p.streak} straight legs cashed`,
      statClass: 'hit'
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

  // If 1-0 undefeated
  if (p.hits > 0 && p.misses === 0) {
    if (ctx.topOddsWinner && ctx.topOddsWinner.name === p.name && p.maxWinningOdds > 2.0) {
      return {
        title: 'Top Value',
        pillClass: 'value',
        icon: 'cash',
        statTag: `${p.hits}-${p.misses} (100%)`,
        blurb: 'Season High Odds Win',
        statClass: 'hit'
      };
    }
    return {
      title: 'Undefeated',
      pillClass: 'sniper',
      icon: 'sniper',
      statTag: `${p.hits}-${p.misses} (100%)`,
      blurb: `Perfect ${p.hits}/${p.total} legs cashed this season`,
      statClass: 'hit'
    };
  }

  // 0 hits, 1+ miss
  if (p.hits === 0 && p.misses > 0) {
    return {
      title: 'Revenge Arc',
      pillClass: 'slump',
      icon: 'frost',
      statTag: `${p.hits}-${p.misses} (0%)`,
      blurb: `Primed for W${ctx.currentWeekNum} revenge`,
      statClass: 'miss'
    };
  }

  // Strong winning record (>= 65%, e.g. 3-1 = 75% or 2-1 = 67%)
  if (p.rate >= 65) {
    return {
      title: `Sharpshooter (${p.rate}%)`,
      pillClass: 'sniper',
      icon: 'sniper',
      statTag: `${p.hits}-${p.misses} (${p.rate}%)`,
      blurb: `${p.hits} hits across ${p.total} weeks`,
      statClass: 'hit'
    };
  }

  // Placed a winning parlay ticket!
  if (p.parlaysWon > 0) {
    return {
      title: `Ticket Casher (${p.streakType}${p.streak})`,
      pillClass: 'value',
      icon: 'trophy',
      statTag: `${p.hits}-${p.misses} (${p.rate}%)`,
      blurb: 'Placed the squad’s cashed parlay ticket!',
      statClass: 'hit'
    };
  }

  // Redeemed after losses
  if (p.streakType === 'W' && p.streak === 1 && p.misses > 0) {
    return {
      title: p.misses >= 3 ? 'Streak Breaker (W1)' : 'Bounce-Back (W1)',
      pillClass: 'hot',
      icon: 'checkCircle',
      statTag: `${p.hits}-${p.misses} (${p.rate}%)`,
      blurb: 'Snapped the skid with a clutch hit!',
      statClass: 'hit'
    };
  }

  // Default Contender
  return {
    title: 'Contender',
    pillClass: 'contender',
    icon: 'puck',
    statTag: `${p.hits}-${p.misses} (${p.rate}%)`,
    blurb: `${p.streakType}${p.streak} form • ${p.avgAmerican} avg`,
    statClass: p.rate >= 50 ? 'hit' : 'miss'
  };
}

// Compute All Squad Analytics
function computeSquadAnalytics() {
  const playerStats = {};
  SQUAD.forEach((boy, rotIdx) => {
    playerStats[boy.name] = {
      name: boy.name,
      initials: boy.initials,
      color: boy.color,
      role: `Leg #${rotIdx + 1}`,
      rotIdx: rotIdx,
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
      parlaysWon: 0,
      plusMoneyHits: 0,
      ticketsPlacedCount: 0,
      ticketsPlacedWeeks: [],
      placedAmount: 0,
      earningsShare: 0,
      winningSharesCount: 0,
      netPoolPL: 0,
      nextTurnWeekNum: rotIdx + 1
    };
  });

  // Iterate chronologically through all weeks
  const sortedWeeks = [...state.statsHistory].sort((a, b) => a.weekNum - b.weekNum);
  const winningWeeksSummary = [];

  sortedWeeks.forEach(w => {
    const isSettledWeek = w.result === 'win' || w.result === 'loss';
    const weekStake = Number(w.stake || 30);

    if (isSettledWeek && w.bettor && playerStats[w.bettor]) {
      playerStats[w.bettor].ticketsPlacedCount += 1;
      playerStats[w.bettor].placedAmount += weekStake;
      playerStats[w.bettor].ticketsPlacedWeeks.push(`W${w.weekNum} ($${weekStake})`);
    }

    if (w.result === 'win') {
      if (w.bettor && playerStats[w.bettor]) {
        playerStats[w.bettor].parlaysWon++;
      }
      const weekPayout = (w.payout && w.payout > 0)
        ? Number(w.payout)
        : Number((weekStake * americanToDecimal(w.totalOdds)).toFixed(2));
      const participants = (w.legs || [])
        .map(l => l.boy)
        .filter(boyName => !!playerStats[boyName]);
      const uniqueParticipants = [...new Set(participants)];
      const splitCount = uniqueParticipants.length > 0 ? uniqueParticipants.length : SQUAD.length;
      const perBoyShare = Math.round(((weekPayout / splitCount) + 1e-9) * 100) / 100;

      uniqueParticipants.forEach(boyName => {
        playerStats[boyName].earningsShare = Math.round((playerStats[boyName].earningsShare + perBoyShare + 1e-9) * 100) / 100;
        playerStats[boyName].winningSharesCount += 1;
      });

      winningWeeksSummary.push({
        weekNum: w.weekNum,
        dateStr: w.dateStr,
        bettor: w.bettor,
        stake: weekStake,
        payout: weekPayout,
        splitCount,
        perBoyShare,
        otherBoys: uniqueParticipants.filter(n => n !== w.bettor)
      });
    }

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
  const settledWeeksCount = sortedWeeks.filter(w => w.result === 'win' || w.result === 'loss').length;

  // Calculate percentages, averages, and individual net bankroll profit
  const list = Object.values(playerStats).map(p => {
    const rate = p.total > 0 ? Math.round((p.hits / p.total) * 100) : 0;
    const avgDec = p.oddsList.length > 0 ? (p.oddsList.reduce((a, b) => a + b, 0) / p.oddsList.length) : 1.8;
    const avgAmerican = decimalToAmerican(avgDec);
    const isBettorOnDeck = (p.name === bettorThisWeek.name);
    const netPoolPL = Math.round(((p.earningsShare - p.placedAmount) + 1e-9) * 100) / 100;

    let nextTurn = p.rotIdx + 1;
    while (nextTurn <= settledWeeksCount) {
      nextTurn += SQUAD.length;
    }

    return {
      ...p,
      rate,
      avgDec,
      avgAmerican,
      isBettorOnDeck,
      netPoolPL,
      nextTurnWeekNum: nextTurn
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
        note: `${tied.length}-way tie for the squad lead — all ${tied.length} guys cashed their legs!`,
        isTie: true,
        list: tied
      };
    } else {
      const leader = tied[0];
      sharpshooters = {
        names: leader.name,
        stat: `${leader.rate}% Hit Rate (${leader.hits}/${leader.total} Hits)`,
        note: `${leader.misses === 0 ? 'Undefeated sole' : 'Sole'} leader in squad accuracy on a ${leader.streakType}${leader.streak} heater!`,
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
    note: `Highest plus-money payout cashed on a pool ticket (${topOddsWinner.plusMoneyHits} plus-money hits).`
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
    note: hotSeatWinner.streakType === 'W'
      ? `Most season misses (${hotSeatWinner.misses}), now climbing back on a W${hotSeatWinner.streak} rebound streak!`
      : `Last missed ${hotSeatWinner.lastMissedPick || 'a leg'} — locked in for a bounce-back in Week ${currentWeekNum}!`
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
    note: `Builds the ticket floor with heavy high-probability favorites.`
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

  // Pick totals & Pool Bankroll P/L (settled weeks only)
  let totalWagered = settledWeeks.reduce((acc, w) => acc + (w.stake || 25), 0);
  if (totalWagered === 0) totalWagered = 25;
  const totalWon = settledWeeks.reduce((acc, w) => {
    if (w.result !== 'win') return acc;
    if (w.payout && w.payout > 0) return acc + w.payout;
    return acc + ((w.stake || 30) * americanToDecimal(w.totalOdds));
  }, 0);
  const netPoolProfit = totalWon - totalWagered;

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
    totalWon,
    netPoolProfit,
    winningWeeksSummary,
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

function formatSignedCurrency(val) {
  const num = Number(val || 0);
  if (Math.abs(num) < 0.005) return '$0.00';
  return `${num >= 0 ? '+' : '-'}$${Math.abs(num).toFixed(2)}`;
}

function renderStatsView() {
  const data = computeSquadAnalytics();

  // Hero numbers
  const wageredLabelEl = DOM.statsTotalWagered?.parentElement?.querySelector('.meta-label');
  if (data.totalWon > 0) {
    if (wageredLabelEl) wageredLabelEl.textContent = 'Pool Profit';
    DOM.statsTotalWagered.textContent = formatSignedCurrency(data.netPoolProfit);
    DOM.statsTotalWagered.className = `meta-val ${data.netPoolProfit >= 0 ? 'b365-green' : 'red'}`;
  } else {
    if (wageredLabelEl) wageredLabelEl.textContent = 'Season Wagered';
    DOM.statsTotalWagered.textContent = `$${data.totalWagered.toFixed(2)}`;
    DOM.statsTotalWagered.className = 'meta-val';
  }
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
  if (wageredSubEl) {
    wageredSubEl.textContent = data.totalWon > 0
      ? `$${data.totalWon.toFixed(2)} Won • $${data.totalWagered.toFixed(0)} Staked`
      : `${weeksLabel} Pool`;
  }

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

  // Squad Bankroll & Individual Earnings Ledger
  const bankrollSummaryPill = document.getElementById('bankrollPoolSummaryPill');
  const bankrollKpiStrip = document.getElementById('bankrollKpiStrip');
  const bankrollCardsGrid = document.getElementById('bankrollCardsGrid');
  const bankrollSettlementNote = document.getElementById('bankrollSettlementNote');

  if (bankrollSummaryPill) {
    bankrollSummaryPill.textContent = `Net Pool Profit: ${formatSignedCurrency(data.netPoolProfit)}`;
    bankrollSummaryPill.className = `bankroll-pool-pill ${data.netPoolProfit >= 0 ? '' : 'negative'}`;
  }

  if (bankrollKpiStrip) {
    const perBoyEqualShare = data.totalWon > 0 ? (Math.round(((data.totalWon / SQUAD.length) + 1e-9) * 100) / 100) : 0;
    const poolRoiPct = data.totalWagered > 0 ? Math.round((data.netPoolProfit / data.totalWagered) * 100) : 0;
    bankrollKpiStrip.innerHTML = `
      <div class="bankroll-kpi-box">
        <span class="bkpi-label">Total Tickets Placed</span>
        <span class="bkpi-val">$${data.totalWagered.toFixed(2)}</span>
        <span class="bkpi-sub">${data.totalParlays} Friday Ticket${data.totalParlays === 1 ? '' : 's'} Staked</span>
      </div>
      <div class="bankroll-kpi-box">
        <span class="bkpi-label">Total Parlay Winnings</span>
        <span class="bkpi-val ${data.totalWon > 0 ? 'green' : ''}">$${data.totalWon.toFixed(2)}</span>
        <span class="bkpi-sub">${data.wonParlays} of ${data.totalParlays} Ticket${data.totalParlays === 1 ? '' : 's'} Cashed</span>
      </div>
      <div class="bankroll-kpi-box">
        <span class="bkpi-label">Equal Payout / Guy</span>
        <span class="bkpi-val ${perBoyEqualShare > 0 ? 'green' : ''}">$${perBoyEqualShare.toFixed(2)}</span>
        <span class="bkpi-sub">${data.totalWon > 0 ? `$${data.totalWon.toFixed(2)} ÷ 6 Guys` : 'Split equally on win'}</span>
      </div>
      <div class="bankroll-kpi-box">
        <span class="bkpi-label">Net Squad Profit</span>
        <span class="bkpi-val ${data.netPoolProfit >= 0 ? 'green' : 'red'}">${formatSignedCurrency(data.netPoolProfit)}</span>
        <span class="bkpi-sub">${poolRoiPct >= 0 ? '+' : ''}${poolRoiPct}% Season Pool ROI</span>
      </div>
    `;
  }

  if (bankrollCardsGrid) {
    const rotationOrderedPlayers = SQUAD.map(b => data.players.find(pl => pl.name === b.name)).filter(Boolean);
    bankrollCardsGrid.innerHTML = rotationOrderedPlayers.map(p => {
      const isPositive = p.netPoolPL >= 0;
      const netStr = formatSignedCurrency(p.netPoolPL);
      const placedStr = p.placedAmount > 0 ? `-$${p.placedAmount.toFixed(2)}` : '$0.00';
      const earnedStr = p.earningsShare > 0 ? `+$${p.earningsShare.toFixed(2)}` : '$0.00';
      const turnTagText = p.ticketsPlacedCount > 0
        ? `Placed ${p.ticketsPlacedWeeks.join(', ')} • Next WK ${p.nextTurnWeekNum}`
        : `$0 Placed Yet • On Deck WK ${p.nextTurnWeekNum}`;

      return `
        <div class="bankroll-player-card ${isPositive ? 'positive' : 'negative'}" onclick="openPlayerProfile('${p.name}')" title="Tap to inspect ${p.name}'s full bankroll & pick history">
          <div class="bpc-top">
            <div class="bpc-person">
              <div class="bpc-avatar">${p.initials}</div>
              <div class="bpc-name-wrap">
                <span class="bpc-name">${p.name}</span>
                <span class="bpc-turn-tag ${p.ticketsPlacedCount === 0 ? 'pending-turn' : ''}">${turnTagText}</span>
              </div>
            </div>
            <span class="bpc-net-pill ${isPositive ? 'green' : 'red'}">${netStr}</span>
          </div>

          <div class="bpc-ledger-row">
            <div class="bpc-col">
              <span class="bpc-col-label">Placed (${p.ticketsPlacedCount})</span>
              <span class="bpc-col-val ${p.placedAmount > 0 ? 'red' : ''}">${placedStr}</span>
            </div>
            <div class="bpc-col">
              <span class="bpc-col-label">Split Won</span>
              <span class="bpc-col-val ${p.earningsShare > 0 ? 'green' : ''}">${earnedStr}</span>
            </div>
            <div class="bpc-col right">
              <span class="bpc-col-label">Net Profit</span>
              <span class="bpc-col-val ${isPositive ? 'green' : 'red'}">${netStr}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (bankrollSettlementNote) {
    if (data.winningWeeksSummary && data.winningWeeksSummary.length > 0) {
      bankrollSettlementNote.style.display = 'block';
      bankrollSettlementNote.innerHTML = data.winningWeeksSummary.map(win => {
        const shareStr = win.perBoyShare.toFixed(2);
        const bettorNetOnWeek = (win.perBoyShare - win.stake).toFixed(2);
        const othersStr = win.otherBoys.length > 1
          ? `${win.otherBoys.slice(0, -1).join(', ')} & ${win.otherBoys[win.otherBoys.length - 1]}`
          : (win.otherBoys[0] || 'the squad');
        return `<strong>💸 Week ${win.weekNum} Cashout Split ($${win.payout.toFixed(2)} ÷ ${win.splitCount} guys = $${shareStr} each):</strong> <strong>${win.bettor}</strong> placed the $${win.stake.toFixed(2)} ticket, keeps his <strong>$${shareStr}</strong> share (<strong>+$${bettorNetOnWeek}</strong> net on W${win.weekNum}), and sends <strong>$${shareStr}</strong> each to ${othersStr}.`;
      }).join('<br/>');
    } else {
      bankrollSettlementNote.style.display = 'none';
      bankrollSettlementNote.innerHTML = '';
    }
  }

  // Payout & E-Transfer Settlement Log (synced via Supabase)
  const payoutLedgerWrap = document.getElementById('payoutLedgerWrap');
  if (payoutLedgerWrap) {
    if (data.winningWeeksSummary && data.winningWeeksSummary.length > 0) {
      payoutLedgerWrap.style.display = 'flex';
      payoutLedgerWrap.innerHTML = data.winningWeeksSummary.map(win => {
        const weekLog = (state.payoutLog && state.payoutLog[win.dateStr]) || {};
        const shareStr = win.perBoyShare.toFixed(2);
        const participants = SQUAD.filter(b => b.name === win.bettor || win.otherBoys.includes(b.name));
        let settledCount = 0;
        let unpaidCount = 0;

        const rowsHtml = participants.map(boy => {
          const isBettor = boy.name === win.bettor;
          const entry = weekLog[boy.name];
          const isPaid = isBettor || !!(entry && entry.paid);
          if (isPaid) settledCount++;
          else unpaidCount++;

          let subText = `$${shareStr} owed by ${win.bettor}`;
          if (isBettor) {
            subText = `$${shareStr} • Kept share`;
          } else if (isPaid) {
            let dateTag = 'Paid';
            if (entry?.paidAt) {
              try {
                const dt = new Date(entry.paidAt);
                dateTag = `Paid ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
              } catch (e) {}
            }
            subText = `$${shareStr} • ${dateTag}`;
          }

          return `
            <div class="payout-boy-row ${isBettor ? 'self' : (isPaid ? 'paid' : 'unpaid')}">
              <div class="payout-boy-left">
                <div class="payout-boy-avatar">${boy.initials}</div>
                <div class="payout-boy-meta">
                  <span class="payout-boy-name">${boy.name}${isBettor ? ' (Bettor)' : ''}</span>
                  <span class="payout-boy-sub">${subText}</span>
                </div>
              </div>
              ${isBettor
                ? `<span class="payout-toggle-btn is-self">KEPT ✓</span>`
                : `<button type="button" class="payout-toggle-btn ${isPaid ? 'is-paid' : 'mark-paid'}" onclick="togglePayoutStatus('${win.dateStr}', '${boy.name}', ${win.weekNum}, ${win.perBoyShare})" title="Tap to toggle ${boy.name}'s payout status">${isPaid ? '✓ PAID' : 'MARK PAID'}</button>`
              }
            </div>
          `;
        }).join('');

        const totalParticipants = participants.length || 6;
        const pct = Math.round((settledCount / totalParticipants) * 100);
        const allSettled = unpaidCount === 0;
        const remainingOwed = (unpaidCount * win.perBoyShare).toFixed(2);
        const paidOutOthers = Math.max(0, settledCount - 1);
        const totalOthers = Math.max(0, totalParticipants - 1);

        return `
          <div class="payout-week-card ${allSettled ? 'all-settled' : ''}">
            <div class="payout-week-top">
              <div>
                <div class="payout-week-title">
                  <span>PAYOUT &amp; E-TRANSFER LOG — WEEK ${win.weekNum}</span>
                  <span class="payout-status-pill ${allSettled ? 'settled' : ''}">${allSettled ? `ALL ${totalParticipants}/${totalParticipants} SETTLED ✓` : `${settledCount}/${totalParticipants} SETTLED • $${remainingOwed} OWED`}</span>
                </div>
                <div class="payout-week-sub">Tap any guy to toggle Paid / Unpaid — syncs live across everyone's phone</div>
              </div>
              <div class="payout-week-actions">
                <button type="button" class="payout-copy-btn" onclick="copyPayoutStatusSummary('${win.dateStr}', ${win.weekNum}, '${win.bettor}', ${win.payout}, ${win.perBoyShare})">Copy Log</button>
              </div>
            </div>
            <div class="payout-progress-track">
              <div class="payout-progress-fill ${allSettled ? 'settled' : ''}" style="width: ${pct}%"></div>
            </div>
            <div class="payout-boys-grid">
              ${rowsHtml}
            </div>
            <div class="payout-week-footer">
              <span><strong>${win.bettor}</strong> e-transfers sent: <strong>${paidOutOthers} of ${totalOthers}</strong></span>
              <span>${allSettled ? `<strong style="color:var(--green-win);">All $${win.payout.toFixed(2)} accounted for ✓</strong>` : `Still owed by ${win.bettor}: <strong style="color:#fbbf24;">$${remainingOwed}</strong>`}</span>
            </div>
          </div>
        `;
      }).join('');
    } else {
      payoutLedgerWrap.style.display = 'none';
      payoutLedgerWrap.innerHTML = '';
    }
  }

  // 0. Squad Member Profile Strip (Click any guy's name to view his full betting profile)
  const profilesStrip = document.getElementById('squadProfilesStrip');
  if (profilesStrip) {
    profilesStrip.innerHTML = data.players.map(p => {
      const isDebut = p.total === 0;
      const winRateStr = isDebut ? 'Debut' : `${p.rate}% (${p.hits}-${p.misses})`;
      const netStr = formatSignedCurrency(p.netPoolPL);
      return `
        <div class="squad-profile-chip" onclick="openPlayerProfile('${p.name}')" title="View ${p.name}'s Full Betting Profile">
          <div class="spc-avatar">${p.initials}</div>
          <div class="spc-info">
            <div class="spc-name">${p.name} <span>↗</span></div>
            <div class="spc-meta">${winRateStr} • <strong style="color:${p.netPoolPL >= 0 ? 'var(--green-win)' : 'var(--red-alert)'};">${netStr}</strong></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Leaderboard table (with tie-aware rank display + individual bankroll columns)
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
    const netStr = formatSignedCurrency(p.netPoolPL);
    const placedDisplay = p.placedAmount > 0 ? `$${p.placedAmount.toFixed(0)} (${p.ticketsPlacedCount})` : `$0 (WK ${p.nextTurnWeekNum})`;
    const earnedDisplay = `$${p.earningsShare.toFixed(2)}`;

    return `
      <tr>
        <td>${rankBadge}</td>
        <td>
          <div class="table-player-cell clickable" onclick="openPlayerProfile('${p.name}')" title="Click to open ${p.name}'s full betting profile">
            <div class="player-avatar-small">${p.initials}</div>
            <span class="player-name-link">${p.name}</span>
          </div>
        </td>
        <td class="font-mono font-bold ${p.netPoolPL >= 0 ? 'b365-green' : 'text-red-500'}">${netStr}</td>
        <td class="font-mono text-zinc-500">${placedDisplay}</td>
        <td class="font-mono font-bold ${p.earningsShare > 0 ? 'b365-green' : ''}">${earnedDisplay}</td>
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
        <td class="font-mono font-bold">${streakDisplay}</td>
        <td class="font-mono text-zinc-500">${isDebut ? '--' : p.avgAmerican}</td>
        <td>${titlePill}</td>
      </tr>
    `;
  }).join('');

  // Weekly History logs with interactive single-week toggle
  renderHistorySection();
}

window.selectHistoryWeek = function(weekNum) {
  state.selectedHistoryWeek = weekNum;
  playSound('click');
  renderHistorySection();
};

function renderHistorySection() {
  const toggleBar = DOM.historyWeekToggleBar || document.getElementById('historyWeekToggleBar');
  if (!DOM.historyWeeksContainer) return;

  if (state.selectedHistoryWeek === undefined || state.selectedHistoryWeek === null) {
    const latest = Math.max(...state.statsHistory.map(w => w.weekNum), 1);
    state.selectedHistoryWeek = latest;
  }

  // Render Week Toggle Pills (newest to oldest)
  if (toggleBar) {
    const sortedWeeks = [...state.statsHistory].sort((a, b) => b.weekNum - a.weekNum);
    toggleBar.innerHTML = `
      <div class="h-toggle-scroll">
        ${sortedWeeks.map(w => {
          const isSelected = state.selectedHistoryWeek === w.weekNum;
          const hits = w.legs.filter(l => l.result === 'hit').length;
          const total = w.legs.length;
          const isWin = w.result === 'win';
          const isPending = w.result === 'pending';
          const tagText = isWin ? `${total}/${total} WIN 💥` : (isPending ? `${hits}/${total} LIVE` : `${hits}/${total}`);
          const winClass = isWin ? 'is-win' : '';
          const activeClass = isSelected ? 'active' : '';
          return `
            <button type="button" class="h-week-toggle-btn ${winClass} ${activeClass}" onclick="selectHistoryWeek(${w.weekNum})">
              <span>WEEK ${w.weekNum}</span>
              <span class="h-toggle-tag">${tagText}</span>
            </button>
          `;
        }).join('')}
        <button type="button" class="h-week-toggle-btn ${state.selectedHistoryWeek === 'all' ? 'active' : ''}" onclick="selectHistoryWeek('all')">
          <span>ALL WEEKS</span>
          <span class="h-toggle-tag">${state.statsHistory.length}</span>
        </button>
      </div>
    `;
  }

  // Filter weeks to render
  const weeksToRender = state.selectedHistoryWeek === 'all'
    ? state.statsHistory
    : state.statsHistory.filter(w => w.weekNum === state.selectedHistoryWeek);

  DOM.historyWeeksContainer.innerHTML = weeksToRender.map((week) => {
    const wIdx = state.statsHistory.findIndex(sw => sw.weekNum === week.weekNum);
    const hitsCount = week.legs.filter(l => l.result === 'hit').length;
    const totalLegs = week.legs.length;
    const isWin = week.result === 'win';
    const isLoss = week.result === 'loss';
    const winPayoutLabel = week.payout ? ` ($${week.payout.toFixed(2)} • $${(Math.round(((week.payout / (totalLegs || 6)) + 1e-9) * 100) / 100).toFixed(2)}/guy)` : '';
    const statusText = isWin
      ? `${getIcon('checkCircle')} TICKET CASHED!${winPayoutLabel}`
      : (isLoss ? `PARLAY SOLD (${hitsCount}/${totalLegs} HITS)` : `IN PROGRESS (WEEK ${week.weekNum})`);
    const statusClass = isWin ? 'win' : (isLoss ? 'loss' : 'in-progress');

    return `
      <div class="history-week-card ${isWin ? 'is-winner' : ''}">
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
  if (lower.includes('puck line') || lower.includes('puckline') || /[+-]1\.5/.test(lower)) return 'Puck Line';
  if (lower.includes('moneyline') || /\bml\b/.test(lower)) return 'Moneyline';
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
      bettor: getBettorForFriday(state.currentFriday).name,
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

  let bestHitDec = 0;
  let bestHitOddsStr = p.maxWinningOddsStr || '--';
  let bestHitPick = '';
  const marketCounts = {};
  const marketHits = {};

  allPicks.forEach(pk => {
    marketCounts[pk.market] = (marketCounts[pk.market] || 0) + 1;
    if (pk.result === 'hit') {
      marketHits[pk.market] = (marketHits[pk.market] || 0) + 1;
      if (pk.decimal > bestHitDec) {
        bestHitDec = pk.decimal;
        bestHitOddsStr = pk.odds;
        bestHitPick = pk.pick;
      }
    }
  });

  let favMarket = 'Points';
  let bestMarketCount = 0;
  Object.entries(marketCounts).forEach(([mkt, cnt]) => {
    if (cnt > bestMarketCount) {
      bestMarketCount = cnt;
      favMarket = mkt;
    }
  });
  const favMarketRecord = `${marketHits[favMarket] || 0}/${marketCounts[favMarket] || 0}`;

  const streakStr = p.total === 0 ? 'Debut' : (p.streak > 0 ? `${p.streakType}${p.streak}` : 'Even');
  const poolNetStr = formatSignedCurrency(p.netPoolPL);
  const placedSummary = p.ticketsPlacedCount > 0
    ? `${p.ticketsPlacedWeeks.join(', ')} • Next WK ${p.nextTurnWeekNum}`
    : `$0 Placed • On Deck WK ${p.nextTurnWeekNum}`;

  body.innerHTML = `
    <div class="profile-hero-banner">
      <div class="profile-hero-avatar">${p.initials}</div>
      <div class="profile-hero-details">
        <div class="profile-hero-title">
          ${p.name}
          <span class="title-tag-pill ${p.accolade.pillClass}">${getIcon(p.accolade.icon)} ${p.accolade.title}</span>
        </div>
        <div class="profile-hero-sub">
          ${p.role || 'Squad Member'} • ${allPicks.length} Total Picks • ${p.ticketsPlacedCount} Ticket${p.ticketsPlacedCount === 1 ? '' : 's'} Placed ($${p.placedAmount.toFixed(2)})
        </div>
      </div>
    </div>

    <div class="profile-stats-grid">
      <div class="profile-stat-box">
        <span class="psb-label">Actual Pool Net Profit</span>
        <span class="psb-val ${p.netPoolPL >= 0 ? 'green' : 'red'}">${poolNetStr}</span>
        <span class="psb-sub">$${p.earningsShare.toFixed(2)} Won − $${p.placedAmount.toFixed(2)} Placed</span>
      </div>
      <div class="profile-stat-box">
        <span class="psb-label">Tickets Placed (${p.ticketsPlacedCount})</span>
        <span class="psb-val">$${p.placedAmount.toFixed(2)}</span>
        <span class="psb-sub">${placedSummary}</span>
      </div>
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
        <span class="psb-label">Favorite Market</span>
        <span class="psb-val">${favMarket}</span>
        <span class="psb-sub">${favMarketRecord} cashed in ${favMarket}</span>
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
  backdrop.classList.add('open');

  if (closeBtn) {
    closeBtn.onclick = () => backdrop.classList.remove('open');
  }
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  };
};

window.exportSeasonStatsReport = function() {
  const data = computeSquadAnalytics();
  const lines = [];
  lines.push(`# 🏒 FRIDAY NIGHT PUCK — OFFICIAL SEASON STATS LEDGER`);
  lines.push(`Last Updated: ${new Date().toLocaleString()}`);
  lines.push(`Parlays Cashed: ${data.wonParlays}/${data.totalParlays} | Total Leg Hits: ${data.totalHitsCount}/${data.totalLegsCount} (${data.pickWinRate}%) | Pool Staked: $${data.totalWagered.toFixed(2)} | Pool Won: $${data.totalWon.toFixed(2)} | Net Profit: ${formatSignedCurrency(data.netPoolProfit)}`);
  lines.push(``);
  lines.push(`## 💰 INDIVIDUAL BANKROLL & PROFIT LEDGER`);
  SQUAD.forEach(b => {
    const p = data.players.find(pl => pl.name === b.name);
    if (!p) return;
    const placedInfo = p.ticketsPlacedCount > 0 ? p.ticketsPlacedWeeks.join(', ') : `On Deck WK ${p.nextTurnWeekNum}`;
    lines.push(`- **${p.name}**: Net Profit **${formatSignedCurrency(p.netPoolPL)}** | Placed: $${p.placedAmount.toFixed(2)} (${placedInfo}) | Payout Split Earned: $${p.earningsShare.toFixed(2)}`);
  });
  lines.push(``);
  lines.push(`## 🏆 SQUAD LEADERBOARD`);
  data.players.forEach((p, i) => {
    lines.push(`${i + 1}. **${p.name}** (${p.accolade.title}) — ${p.rate}% (${p.hits}-${p.misses}) | Net Profit: ${formatSignedCurrency(p.netPoolPL)} | Streak: ${p.streakType}${p.streak} | Avg Odds: ${p.avgAmerican}`);
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
      showToast('📊 Full Season Stats & Bankroll Ledger copied to clipboard!');
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

  if (isViewingWeek7Vote()) {
    const tally = tallyWeek7Votes();
    DOM.legsHitCount.textContent = `0 / 6`;
    if (DOM.overallProgressBar) DOM.overallProgressBar.style.width = "0%";
    if (DOM.trackerTotalOddsBadge) DOM.trackerTotalOddsBadge.textContent = "WEEK 7 DAY VOTE";
    if (DOM.navLiveMultiplier) DOM.navLiveMultiplier.textContent = "VOTE";
    if (DOM.syncStatus) DOM.syncStatus.textContent = "No NHL games Fri Nov 20 • Voting Thu Nov 19 vs Sat Nov 21 until Wed 8:00 PM ET";
    DOM.trackerWagerDisplay.textContent = `$30.00`;
    DOM.trackerReturnDisplay.textContent = "--";

    if (DOM.ticketStatusBanner) {
      DOM.ticketStatusBanner.className = "tracker-cashout-btn pending";
      DOM.ticketStatusBanner.innerHTML = `<span class="bts-icon" style="margin-right:6px;">${getIcon('clock')}</span> Voting Open (${tally.totalVotes}/6 In) • Locks Wed Nov 18 @ 8:00 PM ET`;
    }

    const voteCard = document.createElement("div");
    voteCard.className = "tracker-empty-card";
    voteCard.innerHTML = `
      <div class="tracker-empty-icon-wrap">
        ${getIcon('puck')}
      </div>
      <div class="tracker-empty-badge">WEEK 7 SPECIAL SCHEDULE VOTE</div>
      <h3 class="tracker-empty-title">THU ($30) VS. SAT ($30) VS. $15 + $15 SPLIT</h3>
      <p class="tracker-empty-desc">
        There are <strong>zero NHL games scheduled on Friday, Nov 20</strong>. Cast your vote on the <strong>Slip ($30)</strong> tab before <strong>Wednesday, Nov 18 at 8:00 PM ET</strong> — choose one $30 night or split the pool into two $15 parlays (Thu + Sat) with <strong>${bettor.name}</strong> on deck!
      </p>
      <div class="tracker-empty-actions">
        <button class="nhl-action-btn primary" onclick="switchView('slipBuilderView')">
          <span class="bts-icon">${getIcon('bolt')}</span>
          <span>Go Vote: Thu (${tally.thuCount}) • Sat (${tally.satCount}) • Both $15x2 (${tally.splitCount})</span>
        </button>
        <button class="nhl-action-btn secondary" onclick="jumpToWeekDate('2026-11-13')">
          <span class="bts-icon">${getIcon('trophy')}</span>
          <span>View Settled Week 6 Slip (4/5)</span>
        </button>
      </div>
    `;
    DOM.trackerGamesContainer.appendChild(voteCard);
    return;
  }

  const boysWithPicks = Object.keys(state.legs || {});
  const readyCount = boysWithPicks.length;
  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);

  DOM.legsHitCount.textContent = `0 / 6`;
  if (DOM.overallProgressBar) DOM.overallProgressBar.style.width = "0%";
  if (DOM.trackerTotalOddsBadge) DOM.trackerTotalOddsBadge.textContent = "AWAITING LOCK-IN";
  if (DOM.navLiveMultiplier) DOM.navLiveMultiplier.textContent = "--";
  if (DOM.syncStatus) DOM.syncStatus.textContent = `Awaiting ${dayLabel} Bet Placement • Live NHL API ready to sync upon lock-in`;

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
    <div class="tracker-empty-badge">${dayLabel.toUpperCase()} PARLAY PENDING</div>
    <h3 class="tracker-empty-title">LIVE TRACKER AWAITING LOCK-IN</h3>
    <p class="tracker-empty-desc">
      This week’s ${dayLabel} parlay has not been placed yet. Once <strong>${bettor.name}</strong> places the bet on the sportsbook and confirms it, the live tracker will activate, refresh with our real picks, and begin streaming real-time NHL boxscore progress!
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

window.jumpToWeekDate = function(targetDateStr) {
  state.currentFriday = parseLocalISODate(targetDateStr);
  state.currentFridayStr = formatDateISO(state.currentFriday);
  loadLocalData(state.currentFridayStr);
  initTrackerData();
  if (isViewingWeek7Vote()) {
    fetchWeek7DualSlates();
  } else {
    fetchFridayNhlGames(state.currentFridayStr);
    if (state.supabase) fetchSupabaseParlay(state.currentFridayStr);
  }
  renderAll();
  renderTracker();
  playSound('click');
};

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

function doesPlayerNameMatch(legPlayerName, boxscoreFullName) {
  const normLeg = normalizeName(legPlayerName);
  const normBox = normalizeName(boxscoreFullName);
  if (!normLeg || !normBox) return false;

  const aliasFull = PLAYER_NICKNAME_ALIASES[normLeg]
    ? normalizeName(PLAYER_NICKNAME_ALIASES[normLeg])
    : normLeg;

  if (aliasFull === normBox || normLeg === normBox) return true;

  const legTokens = aliasFull.split(/\s+/).filter(Boolean);
  const boxTokens = normBox.split(/\s+/).filter(Boolean);
  if (legTokens.length === 0 || boxTokens.length === 0) return false;

  if (legTokens.length === 1) {
    const single = legTokens[0];
    return boxTokens[0] === single || boxTokens[boxTokens.length - 1] === single;
  }

  const legLast = legTokens[legTokens.length - 1];
  const boxLast = boxTokens[boxTokens.length - 1];
  if (legLast !== boxLast) return false;

  const legFirst = legTokens[0];
  const boxFirst = boxTokens[0];
  if (legFirst.length === 1) return boxFirst.startsWith(legFirst);
  return legFirst === boxFirst;
}

function isGameLevelLeg(leg) {
  return !!(leg && (leg.isTeamBet || leg.statType === 'puckline' || leg.statType === 'moneyline' || leg.statType === 'total_under' || leg.statType === 'total_over'));
}

function evaluateTeamBetLeg(leg, gameObj) {
  if (!isGameLevelLeg(leg)) {
    return false;
  }

  const isFinal = gameObj.gameStatus === 'final' || /final/i.test(gameObj.gameStateText || '');
  const isStarted = gameObj.gameStatus === 'live' || isFinal;
  const aScore = gameObj.awayScore ?? 0;
  const hScore = gameObj.homeScore ?? 0;
  const aSog = gameObj.awaySog ?? 0;
  const hSog = gameObj.homeSog ?? 0;

  // Game Total Over/Under Goals (e.g. Under 6.5 Total Goals)
  if (leg.statType === 'total_under' || leg.statType === 'total_over') {
    const line = typeof leg.line === 'number' ? leg.line : (parseFloat(leg.target) || 6.5);
    const totalGoals = aScore + hScore;
    const isUnder = leg.statType === 'total_under';
    leg.line = line;
    leg.apiStat = totalGoals;

    if (!isStarted) {
      leg.teamBetHit = false;
      leg.teamBetCovering = isUnder;
      leg.teamBetBusted = false;
      leg.subDetail = isUnder
        ? `0 Total Goals • Need ≤ ${Math.floor(line)} Goals`
        : `0 Total Goals • Need ${Math.floor(line) + 1}+ Goals`;
      return false;
    }

    if (isUnder) {
      const underSafe = totalGoals < line;
      leg.teamBetCovering = underSafe;
      leg.teamBetHit = isFinal && underSafe;
      leg.teamBetBusted = !underSafe;
      const roomLeft = Math.max(0, Math.floor(line) - totalGoals);
      leg.subDetail = `${gameObj.awayTeam} ${aScore} - ${gameObj.homeTeam} ${hScore} • ${totalGoals} Total Goals (${underSafe ? (isFinal ? 'UNDER CASHED' : `${roomLeft} goal${roomLeft === 1 ? '' : 's'} cushion`) : `OVER ${line} • BUSTED`})`;
    } else {
      const overHit = totalGoals > line;
      leg.teamBetCovering = overHit;
      leg.teamBetHit = overHit;
      leg.teamBetBusted = isFinal && !overHit;
      const needed = Math.max(0, Math.floor(line) + 1 - totalGoals);
      leg.subDetail = `${gameObj.awayTeam} ${aScore} - ${gameObj.homeTeam} ${hScore} • ${totalGoals} Total Goals (${overHit ? 'OVER CASHED' : `Need ${needed} more`})`;
    }
    return true;
  }

  const resolvedTeam = leg.teamAbbr || resolveTeamFromPickText(leg.playerName)?.abbr || gameObj.homeTeam;
  const teamAbbr = normalizeTeamAbbr(resolvedTeam);
  const isHome = teamAbbr === normalizeTeamAbbr(gameObj.homeTeam);
  const oppAbbr = isHome ? normalizeTeamAbbr(gameObj.awayTeam) : normalizeTeamAbbr(gameObj.homeTeam);

  if (!isStarted) {
    leg.teamBetHit = false;
    leg.teamBetCovering = false;
    leg.teamBetBusted = false;
    return false;
  }

  const teamScore = isHome ? hScore : aScore;
  const oppScore = isHome ? aScore : hScore;
  const teamSog = isHome ? hSog : aSog;
  const oppSog = isHome ? aSog : hSog;

  const margin = teamScore - oppScore;
  const spread = typeof leg.spread === 'number'
    ? leg.spread
    : (leg.statType === 'moneyline' ? -0.5 : -1.5);
  const covering = (margin + spread) > 0;

  leg.teamAbbr = teamAbbr;
  leg.margin = margin;
  leg.teamBetCovering = covering;
  leg.teamBetHit = isFinal && covering;
  leg.teamBetBusted = isFinal && !covering;
  leg.apiStat = leg.teamBetHit ? (leg.target || 2) : (covering ? (leg.target || 2) : Math.max(0, margin));

  const marginDesc = isFinal
    ? (margin > 0 ? `Won by ${margin}` : (margin < 0 ? `Lost by ${Math.abs(margin)}` : 'Tied'))
    : (margin > 0 ? `Leading by ${margin}` : (margin < 0 ? `Trailing by ${Math.abs(margin)}` : 'Tied'));

  leg.subDetail = `${teamAbbr} ${teamScore} - ${oppAbbr} ${oppScore}${(teamSog || oppSog) ? ` • ${teamSog}-${oppSog} SOG` : ''} • ${marginDesc}`;
  return true;
}

function renderTracker() {
  renderWeek7TrackerSplitBar();
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
      const isTeamLeg = isGameLevelLeg(l);
      if (isTeamLeg) evaluateTeamBetLeg(l, game);

      const legHit = isTeamLeg ? !!l.teamBetHit : (Math.max(0, l.apiStat || 0) >= l.target);
      if (legHit) hitLegs++;
      else {
        allGameLegsHit = false;
        if (isGameFinal || l.teamBetBusted) missedFinalLegs++;
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
    const shortStart = String(game.statusDetail || game.startTime || 'TONIGHT')
      .replace(/^Fri(?:day)?,?\s+(?:Oct|Nov|Dec|Jan|Feb|Mar|Apr)\s+\d+\s*[•·-]\s*/i, '')
      .replace(/^\d+\/\d+\s*-\s*/i, '');
    const clockBadgeText = isGameLive
      ? `● ${game.statusDetail || 'LIVE'}`
      : (isGameFinal ? 'FINAL' : shortStart);
    const isSingleLegBlock = (game.legs || []).length === 1;

    gameBlock.innerHTML = `
      <div class="tracker-game-top">
        <div class="tracker-game-tag">
          <span class="live-dot-mini" style="background:${allGameLegsHit ? '#00ff87' : (isGameLive ? '#ef4444' : (isGameFinal ? '#ef4444' : '#6b7280'))};"></span>
          <span>${isSingleLegBlock ? 'PARLAY <span class="b365-green">SELECTION</span>' : 'SAME GAME <span class="b365-green">PARLAY</span>'}</span>
          <span class="tracker-game-mult">${game.odds}${String(game.odds).endsWith('x') || String(game.odds).startsWith('+') || String(game.odds).startsWith('-') || game.odds === 'SGP' || game.odds === '1 LEG' ? '' : 'x'}</span>
        </div>
        <span class="tracker-game-state-badge">
          ${game.awayTeam} @ ${game.homeTeam}
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
          <span class="tls-sub-stats">${(awayHitsDisplay || homeHitsDisplay) ? `HITS ${awayHitsDisplay}-${homeHitsDisplay}` : `SOG ${awaySogDisplay}-${homeSogDisplay}`}</span>
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
          const isTeamLeg = isGameLevelLeg(leg);
          const unitLabel = getUnitLabelForStat(leg.statType);

          if (leg.statType === 'total_under' || leg.statType === 'total_over') {
            const isUnder = leg.statType === 'total_under';
            const line = typeof leg.line === 'number' ? leg.line : (parseFloat(leg.target) || 6.5);
            const totalGoals = Math.max(0, leg.apiStat || 0);
            const isHit = !!leg.teamBetHit;
            const isMissed = !!leg.teamBetBusted || (!isHit && isGameFinal);
            const isCoveringLive = !isHit && !isMissed && isGameLive && !!leg.teamBetCovering;
            const pct = isMissed
              ? 100
              : (isHit ? 100 : Math.min(100, Math.round((totalGoals / (Math.floor(line) + 1)) * 100)));
            const roomLeft = Math.max(0, Math.floor(line) - totalGoals);
            const statusText = isHit
              ? "✓ LEG HIT"
              : (isMissed
                  ? `✗ OVER ${line} (MISSED)`
                  : (isUnder
                      ? (isGameLive ? `UNDER LIVE (${roomLeft} CUSHION)` : `NEED ≤ ${Math.floor(line)} GOALS`)
                      : (isGameLive ? `NEED ${Math.max(1, Math.floor(line) + 1 - totalGoals)} MORE` : `NEED ${Math.floor(line) + 1}+ GOALS`)));
            const statusClass = isHit ? "hit" : (isMissed ? "miss" : (isCoveringLive || totalGoals > 0 ? "in-progress" : ""));

            return `
              <div class="tracker-leg-card ${isHit ? 'hit' : (isMissed ? 'miss' : '')}">
                <div class="tracker-leg-tier1">
                  <div class="tracker-leg-person">
                    <div class="tracker-hit-indicator">${isMissed ? getIcon('cross') : getIcon('check')}</div>
                    <span class="tracker-player-title">${leg.playerName}</span>
                  </div>
                  <div class="tracker-stat-box ${isHit ? 'hit' : (isMissed ? 'miss' : '')}">
                    <span class="tracker-current-num">${totalGoals}</span>
                    <span class="tracker-target-num">/ ${line} ${isUnder ? 'U' : 'O'}</span>
                  </div>
                </div>

                <div class="tracker-leg-tier2">
                  <span class="tracker-boy-pill">${leg.boyName || 'SQUAD'}</span>
                  <span class="tracker-market-desc">${leg.marketLabel}</span>
                </div>

                <div class="tracker-slider-wrap">
                  <div class="tracker-progress-track">
                    <div class="tracker-progress-fill ${statusClass}" style="width: ${pct}%">
                      ${pct > 0 && !isHit && !isMissed ? '<span class="tracker-slider-thumb"></span>' : ''}
                    </div>
                  </div>
                </div>

                <div class="tracker-leg-tier4">
                  <span class="tracker-live-detail">${leg.subDetail || `0 Total Goals • Need ≤ ${Math.floor(line)} Goals`}</span>
                  <span class="tracker-status-badge ${statusClass}">${statusText}</span>
                </div>
              </div>
            `;
          }

          if (isTeamLeg) {
            const isHit = !!leg.teamBetHit;
            const isMissedFinal = !isHit && isGameFinal;
            const isCoveringLive = !isHit && isGameLive && !!leg.teamBetCovering;
            const spreadNum = typeof leg.spread === 'number' ? leg.spread : (leg.statType === 'moneyline' ? -0.5 : -1.5);
            const spreadDisplay = spreadNum > 0 ? `+${spreadNum}` : `${spreadNum}`;
            const marginNum = typeof leg.margin === 'number' ? leg.margin : 0;
            const marginDisplay = (isGameLive || isGameFinal)
              ? (marginNum > 0 ? `+${marginNum}` : `${marginNum}`)
              : '0';
            const targetDisplay = leg.statType === 'moneyline' ? '/ ML' : `/ ${spreadDisplay} PL`;

            let pct = 0;
            if (isHit || isCoveringLive) pct = 100;
            else if ((isGameLive || isGameFinal) && spreadNum === -1.5 && marginNum === 1) pct = 50;

            const neededGoals = Math.max(1, Math.ceil(Math.abs(spreadNum) - marginNum));
            const statusText = isHit
              ? "✓ LEG HIT"
              : (isMissedFinal
                  ? "✗ MISSED (FINAL)"
                  : (isCoveringLive
                      ? "COVERING LIVE"
                      : (isGameLive ? `NEED +${neededGoals} GOAL${neededGoals === 1 ? '' : 'S'}` : (leg.statType === 'moneyline' ? 'NEED WIN' : `NEED ${spreadDisplay} PL`))));
            const statusClass = isHit ? "hit" : (isMissedFinal ? "miss" : ((isCoveringLive || pct > 0) ? "in-progress" : ""));

            return `
              <div class="tracker-leg-card ${isHit ? 'hit' : (isMissedFinal ? 'miss' : '')}">
                <div class="tracker-leg-tier1">
                  <div class="tracker-leg-person">
                    <div class="tracker-hit-indicator">${isMissedFinal ? getIcon('cross') : getIcon('check')}</div>
                    <span class="tracker-player-title">${leg.playerName}</span>
                  </div>
                  <div class="tracker-stat-box ${isHit ? 'hit' : (isMissedFinal ? 'miss' : '')}">
                    <span class="tracker-current-num">${marginDisplay}</span>
                    <span class="tracker-target-num">${targetDisplay}</span>
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
                  <span class="tracker-live-detail">${leg.subDetail || '0 - 0 • Awaiting Puck Drop'}</span>
                  <span class="tracker-status-badge ${statusClass}">${statusText}</span>
                </div>
              </div>
            `;
          }

          const currentVal = Math.max(0, leg.apiStat || 0);
          const pct = Math.min(100, Math.round((currentVal / leg.target) * 100));
          const isHit = currentVal >= leg.target;
          const isMissedFinal = !isHit && isGameFinal;
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

  let totalOddsMulti = 15.15;
  let payout = "454.41";
  if (state.masterSlip && state.masterSlip.potential_payout) {
    payout = parseFloat(state.masterSlip.potential_payout).toFixed(2);
    totalOddsMulti = parseFloat(state.masterSlip.potential_payout) / (state.stake || 1);
  } else if (state.currentFridayStr === '2026-11-21') {
    payout = "603.99";
    totalOddsMulti = 24.16;
  } else if (state.currentFridayStr === '2026-11-13') {
    payout = "1406.25";
    totalOddsMulti = 56.25;
  } else if (state.currentFridayStr === '2026-11-06') {
    payout = "454.41";
    totalOddsMulti = 15.15;
  } else if (state.currentFridayStr === '2026-10-30') {
    payout = "748.20";
    totalOddsMulti = 24.94;
  } else if (state.currentFridayStr === '2026-10-23') {
    payout = "408.35";
    totalOddsMulti = 13.61;
  } else if (state.currentFridayStr === '2026-10-16') {
    payout = "262.50";
    totalOddsMulti = 10.50;
  } else if (state.currentFridayStr === '2026-10-02') {
    payout = "80.00";
    totalOddsMulti = 16.00;
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
    const activeBoys = SQUAD.filter(b => state.legs[b.name] && state.legs[b.name].pick_text);
    const squadForWeek = activeBoys.length > 0 ? activeBoys : SQUAD;
    weekEntry = {
      weekNum: weekNum,
      dateStr: state.currentFridayStr,
      bettor: state.masterSlip?.bettor_name || bettor.name,
      stake: state.stake || 30,
      totalOdds: state.masterSlip?.total_odds || '+1414',
      payout: 0,
      result: 'pending',
      notes: state.masterSlip?.notes || `Placed by ${bettor.name}`,
      legs: squadForWeek.map(b => {
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

      const isTeamLeg = isGameLevelLeg(leg);
      if (isTeamLeg) {
        evaluateTeamBetLeg(leg, game);
        if (leg.teamBetHit && histLeg.result !== 'hit') {
          histLeg.result = 'hit';
          changed = true;
        } else if ((leg.teamBetBusted || (isGameFinal && !leg.teamBetHit)) && histLeg.result !== 'miss') {
          histLeg.result = 'miss';
          changed = true;
        }
        return;
      }

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
    if (state.masterSlip?.potential_payout) {
      weekEntry.payout = parseFloat(state.masterSlip.potential_payout) || weekEntry.payout;
    }
    changed = true;
  } else if (allGamesFinal && misses > 0 && weekEntry.result !== 'loss') {
    weekEntry.result = 'loss';
    weekEntry.payout = 0;
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
  const baseEspnUrl = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard";
  const datedEspnUrl = compactDate ? `${baseEspnUrl}?dates=${compactDate}` : baseEspnUrl;

  try {
    let espnResp = null;
    try {
      espnResp = await fetch(datedEspnUrl);
    } catch (e) {
      if (!compactDate) espnResp = await fetch(baseEspnUrl);
    }
    if (espnResp && espnResp.ok) {
      let scoreboard = await espnResp.json();
      let events = scoreboard.events || [];
      espnSucceeded = true;

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
            } else {
              matchingGame.awaySog = 0;
              matchingGame.homeSog = 0;
            }
            matchingGame.gameStateText = stateType === 'pre'
              ? statusDetail
              : `${matchingGame.awayTeam} ${aScore} - ${matchingGame.homeTeam} ${hScore} (${statusDetail})`;
          }

          (matchingGame.legs || []).forEach(leg => {
            if (isGameLevelLeg(leg)) {
              if (evaluateTeamBetLeg(leg, matchingGame)) updatedPlayers++;
            }
          });

          if (stateType !== 'pre') {
            const summaryResp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${event.id}`);
            if (summaryResp.ok) {
              const summaryData = await summaryResp.json();
              const latestGame = state.trackerData.find(g =>
                abbrevs.includes(normalizeTeamAbbr(g.awayTeam)) && abbrevs.includes(normalizeTeamAbbr(g.homeTeam))
              ) || matchingGame;
              Object.assign(latestGame, {
                gameStatus: matchingGame.gameStatus,
                statusDetail: matchingGame.statusDetail,
                awayScore: matchingGame.awayScore,
                homeScore: matchingGame.homeScore,
                awaySog: matchingGame.awaySog,
                homeSog: matchingGame.homeSog,
                gameStateText: matchingGame.gameStateText
              });
              updatedPlayers += parseEspnBoxscore(summaryData, latestGame);
            }
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
            if (g.awayTeam?.score !== undefined) matchingGame.awayScore = g.awayTeam.score;
            if (g.homeTeam?.score !== undefined) matchingGame.homeScore = g.homeTeam.score;
            const period = g.periodDescriptor?.number ? `P${g.periodDescriptor.number}` : "";
            const clock = g.clock?.timeRemaining || (isFinal ? "FINAL" : "");
            matchingGame.gameStateText = stateText === "FUT" || stateText === "PRE"
              ? matchingGame.startTime
              : `${away} ${g.awayTeam?.score ?? 0} - ${home} ${g.homeTeam?.score ?? 0} (${isFinal ? 'FINAL' : `${period} ${clock}`.trim()})`;

            (matchingGame.legs || []).forEach(leg => {
              if (isGameLevelLeg(leg)) {
                if (evaluateTeamBetLeg(leg, matchingGame)) updatedPlayers++;
              }
            });

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
  if (DOM.syncStatus) DOM.syncStatus.textContent = `Synced ${nowStr} • 20s live poll`;
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

  // Re-evaluate team puckline/moneyline/total legs now that exact team SOG is populated
  (gameObj.legs || []).forEach(leg => {
    if (isGameLevelLeg(leg)) {
      if (evaluateTeamBetLeg(leg, gameObj)) count++;
    }
  });

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

        gameObj.legs.forEach(leg => {
          if (isGameLevelLeg(leg)) return;
          if (doesPlayerNameMatch(leg.playerName, fullName)) {
            if (fullName && !String(leg.playerName || '').includes(' ')) {
              leg.playerName = fullName;
            }
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

  (gameObj.legs || []).forEach(leg => {
    if (isGameLevelLeg(leg)) {
      if (evaluateTeamBetLeg(leg, gameObj)) count++;
    }
  });

  const pStats = boxData.playerByGameStats;
  if (!pStats) return count;

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
    gameObj.legs.forEach(leg => {
      if (isGameLevelLeg(leg)) return;
      if (leg.statType === "saves" && doesPlayerNameMatch(leg.playerName, name)) {
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

    gameObj.legs.forEach(leg => {
      if (isGameLevelLeg(leg)) return;
      if (doesPlayerNameMatch(leg.playerName, name)) {
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
  if (isViewingWeek7Vote()) {
    await fetchWeek7DualSlates();
    return;
  }

  if (!isSilentRefresh) {
    let gamesList = getFallbackGames(dateStr);
    state.games = gamesList;
    DOM.tickerGamesCount.textContent = `${gamesList.length} GAME${gamesList.length === 1 ? '' : 'S'}`;
    renderGamesTicker(gamesList);
    renderMatchupsPanel(gamesList);
    populateGameSelect(gamesList);
  }

  const compactDate = dateStr.replace(/-/g, '');
  const baseScheduleUrl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard`;
  const espnScheduleUrl = `${baseScheduleUrl}?dates=${compactDate}`;

  try {
    const res = await fetch(espnScheduleUrl);
    if (res && res.ok) {
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

          // Preserve any exact SOG already fetched from boxscore summary (only for live/final games)
          const prevGame = (state.games || []).find(pg => pg.away?.abbrev === awayAbbrev && pg.home?.abbrev === homeAbbrev);
          const awaySog = stateType === 'pre' ? null : (prevGame?.away?.sog ?? (homeSaves !== null ? awayScore + homeSaves : null));
          const homeSog = stateType === 'pre' ? null : (prevGame?.home?.sog ?? (awaySaves !== null ? homeScore + awaySaves : null));

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

const NHL_LOGO = (abbr) => `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`;

const DEFAULT_NOV19_GAMES = [
  { id: 2026020347, startTimeUTC: '2026-11-20T00:00:00Z', venue: 'Scotiabank Arena', away: { abbrev: 'LAK', name: 'Kings', place: 'Los Angeles', logo: NHL_LOGO('LAK') }, home: { abbrev: 'TOR', name: 'Maple Leafs', place: 'Toronto', logo: NHL_LOGO('TOR') } },
  { id: 2026020348, startTimeUTC: '2026-11-20T00:00:00Z', venue: 'Canadian Tire Centre', away: { abbrev: 'PHI', name: 'Flyers', place: 'Philadelphia', logo: NHL_LOGO('PHI') }, home: { abbrev: 'OTT', name: 'Senators', place: 'Ottawa', logo: NHL_LOGO('OTT') } },
  { id: 2026020350, startTimeUTC: '2026-11-20T00:00:00Z', venue: 'PPG Paints Arena', away: { abbrev: 'STL', name: 'Blues', place: 'St. Louis', logo: NHL_LOGO('STL') }, home: { abbrev: 'PIT', name: 'Penguins', place: 'Pittsburgh', logo: NHL_LOGO('PIT') } },
  { id: 2026020351, startTimeUTC: '2026-11-20T00:00:00Z', venue: 'Capital One Arena', away: { abbrev: 'BUF', name: 'Sabres', place: 'Buffalo', logo: NHL_LOGO('BUF') }, home: { abbrev: 'WSH', name: 'Capitals', place: 'Washington', logo: NHL_LOGO('WSH') } },
  { id: 2026020352, startTimeUTC: '2026-11-20T00:00:00Z', venue: 'Lenovo Center', away: { abbrev: 'MTL', name: 'Canadiens', place: 'Montréal', logo: NHL_LOGO('MTL') }, home: { abbrev: 'CAR', name: 'Hurricanes', place: 'Carolina', logo: NHL_LOGO('CAR') } },
  { id: 2026020354, startTimeUTC: '2026-11-20T00:00:00Z', venue: 'Canada Life Centre', away: { abbrev: 'NYI', name: 'Islanders', place: 'New York', logo: NHL_LOGO('NYI') }, home: { abbrev: 'WPG', name: 'Jets', place: 'Winnipeg', logo: NHL_LOGO('WPG') } },
  { id: 2026020349, startTimeUTC: '2026-11-20T00:30:00Z', venue: 'Benchmark International Arena', away: { abbrev: 'EDM', name: 'Oilers', place: 'Edmonton', logo: NHL_LOGO('EDM') }, home: { abbrev: 'TBL', name: 'Lightning', place: 'Tampa Bay', logo: NHL_LOGO('TBL') } },
  { id: 2026020353, startTimeUTC: '2026-11-20T01:00:00Z', venue: 'United Center', away: { abbrev: 'CBJ', name: 'Blue Jackets', place: 'Columbus', logo: NHL_LOGO('CBJ') }, home: { abbrev: 'CHI', name: 'Blackhawks', place: 'Chicago', logo: NHL_LOGO('CHI') } },
  { id: 2026020355, startTimeUTC: '2026-11-20T01:00:00Z', venue: 'Scotiabank Saddledome', away: { abbrev: 'MIN', name: 'Wild', place: 'Minnesota', logo: NHL_LOGO('MIN') }, home: { abbrev: 'CGY', name: 'Flames', place: 'Calgary', logo: NHL_LOGO('CGY') } },
  { id: 2026020356, startTimeUTC: '2026-11-20T02:00:00Z', venue: 'Ball Arena', away: { abbrev: 'ANA', name: 'Ducks', place: 'Anaheim', logo: NHL_LOGO('ANA') }, home: { abbrev: 'COL', name: 'Avalanche', place: 'Colorado', logo: NHL_LOGO('COL') } },
  { id: 2026020357, startTimeUTC: '2026-11-20T02:40:00Z', venue: 'Climate Pledge Arena', away: { abbrev: 'VAN', name: 'Canucks', place: 'Vancouver', logo: NHL_LOGO('VAN') }, home: { abbrev: 'SEA', name: 'Kraken', place: 'Seattle', logo: NHL_LOGO('SEA') } },
  { id: 2026020358, startTimeUTC: '2026-11-20T03:00:00Z', venue: 'T-Mobile Arena', away: { abbrev: 'DAL', name: 'Stars', place: 'Dallas', logo: NHL_LOGO('DAL') }, home: { abbrev: 'VGK', name: 'Golden Knights', place: 'Vegas', logo: NHL_LOGO('VGK') } }
];

const DEFAULT_NOV21_GAMES = [
  { id: 2026020359, startTimeUTC: '2026-11-21T18:00:00Z', venue: 'Lenovo Center', away: { abbrev: 'EDM', name: 'Oilers', place: 'Edmonton', logo: NHL_LOGO('EDM') }, home: { abbrev: 'CAR', name: 'Hurricanes', place: 'Carolina', logo: NHL_LOGO('CAR') } },
  { id: 2026020360, startTimeUTC: '2026-11-21T20:30:00Z', venue: 'Scotiabank Saddledome', away: { abbrev: 'CHI', name: 'Blackhawks', place: 'Chicago', logo: NHL_LOGO('CHI') }, home: { abbrev: 'CGY', name: 'Flames', place: 'Calgary', logo: NHL_LOGO('CGY') } },
  { id: 2026020361, startTimeUTC: '2026-11-21T23:00:00Z', venue: 'Amerant Bank Arena', away: { abbrev: 'BUF', name: 'Sabres', place: 'Buffalo', logo: NHL_LOGO('BUF') }, home: { abbrev: 'FLA', name: 'Panthers', place: 'Florida', logo: NHL_LOGO('FLA') } },
  { id: 2026020362, startTimeUTC: '2026-11-21T23:00:00Z', venue: 'Bridgestone Arena', away: { abbrev: 'PIT', name: 'Penguins', place: 'Pittsburgh', logo: NHL_LOGO('PIT') }, home: { abbrev: 'NSH', name: 'Predators', place: 'Nashville', logo: NHL_LOGO('NSH') } },
  { id: 2026020363, startTimeUTC: '2026-11-22T00:00:00Z', venue: 'TD Garden', away: { abbrev: 'WSH', name: 'Capitals', place: 'Washington', logo: NHL_LOGO('WSH') }, home: { abbrev: 'BOS', name: 'Bruins', place: 'Boston', logo: NHL_LOGO('BOS') } },
  { id: 2026020364, startTimeUTC: '2026-11-22T00:00:00Z', venue: 'Scotiabank Arena', away: { abbrev: 'CBJ', name: 'Blue Jackets', place: 'Columbus', logo: NHL_LOGO('CBJ') }, home: { abbrev: 'TOR', name: 'Maple Leafs', place: 'Toronto', logo: NHL_LOGO('TOR') } },
  { id: 2026020365, startTimeUTC: '2026-11-22T00:00:00Z', venue: 'Centre Bell', away: { abbrev: 'PHI', name: 'Flyers', place: 'Philadelphia', logo: NHL_LOGO('PHI') }, home: { abbrev: 'MTL', name: 'Canadiens', place: 'Montréal', logo: NHL_LOGO('MTL') } },
  { id: 2026020366, startTimeUTC: '2026-11-22T00:00:00Z', venue: 'Canadian Tire Centre', away: { abbrev: 'LAK', name: 'Kings', place: 'Los Angeles', logo: NHL_LOGO('LAK') }, home: { abbrev: 'OTT', name: 'Senators', place: 'Ottawa', logo: NHL_LOGO('OTT') } },
  { id: 2026020367, startTimeUTC: '2026-11-22T00:00:00Z', venue: 'Little Caesars Arena', away: { abbrev: 'NYI', name: 'Islanders', place: 'New York', logo: NHL_LOGO('NYI') }, home: { abbrev: 'DET', name: 'Red Wings', place: 'Detroit', logo: NHL_LOGO('DET') } },
  { id: 2026020368, startTimeUTC: '2026-11-22T00:00:00Z', venue: 'Enterprise Center', away: { abbrev: 'NJD', name: 'Devils', place: 'New Jersey', logo: NHL_LOGO('NJD') }, home: { abbrev: 'STL', name: 'Blues', place: 'St. Louis', logo: NHL_LOGO('STL') } },
  { id: 2026020369, startTimeUTC: '2026-11-22T00:00:00Z', venue: 'Canada Life Centre', away: { abbrev: 'VGK', name: 'Golden Knights', place: 'Vegas', logo: NHL_LOGO('VGK') }, home: { abbrev: 'WPG', name: 'Jets', place: 'Winnipeg', logo: NHL_LOGO('WPG') } },
  { id: 2026020370, startTimeUTC: '2026-11-22T02:00:00Z', venue: 'Delta Center', away: { abbrev: 'ANA', name: 'Ducks', place: 'Anaheim', logo: NHL_LOGO('ANA') }, home: { abbrev: 'UTA', name: 'Mammoth', place: 'Utah', logo: NHL_LOGO('UTA') } },
  { id: 2026020371, startTimeUTC: '2026-11-22T03:00:00Z', venue: 'Rogers Arena', away: { abbrev: 'MIN', name: 'Wild', place: 'Minnesota', logo: NHL_LOGO('MIN') }, home: { abbrev: 'VAN', name: 'Canucks', place: 'Vancouver', logo: NHL_LOGO('VAN') } },
  { id: 2026020372, startTimeUTC: '2026-11-22T03:00:00Z', venue: 'SAP Center at San Jose', away: { abbrev: 'SEA', name: 'Kraken', place: 'Seattle', logo: NHL_LOGO('SEA') }, home: { abbrev: 'SJS', name: 'Sharks', place: 'San Jose', logo: NHL_LOGO('SJS') } }
];

function getFallbackGames(dateStr) {
  if (dateStr === '2026-10-02') {
    return [
      {
        id: 401892432,
        startTimeUTC: `${dateStr}T23:00:00Z`,
        venue: 'Lenovo Center',
        away: { abbrev: 'WSH', name: 'Capitals', place: 'Washington', logo: 'https://assets.nhle.com/logos/nhl/svg/WSH_light.svg' },
        home: { abbrev: 'CAR', name: 'Hurricanes', place: 'Carolina', logo: 'https://assets.nhle.com/logos/nhl/svg/CAR_light.svg' }
      },
      {
        id: 401891782,
        startTimeUTC: `2026-10-03T01:00:00Z`,
        venue: 'American Airlines Center',
        away: { abbrev: 'STL', name: 'Blues', place: 'St. Louis', logo: 'https://assets.nhle.com/logos/nhl/svg/STL_light.svg' },
        home: { abbrev: 'DAL', name: 'Stars', place: 'Dallas', logo: 'https://assets.nhle.com/logos/nhl/svg/DAL_light.svg' }
      },
      {
        id: 401892433,
        startTimeUTC: `2026-10-03T02:00:00Z`,
        venue: 'T-Mobile Arena',
        away: { abbrev: 'ANA', name: 'Ducks', place: 'Anaheim', logo: 'https://assets.nhle.com/logos/nhl/svg/ANA_light.svg' },
        home: { abbrev: 'VGK', name: 'Golden Knights', place: 'Vegas', logo: 'https://assets.nhle.com/logos/nhl/svg/VGK_light.svg' }
      }
    ];
  }
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
  if (dateStr === '2026-10-30') {
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
  if (dateStr === '2026-11-06') {
    return [
      {
        id: 401802569,
        startTimeUTC: `${dateStr}T00:10:00Z`,
        venue: 'KeyBank Center',
        away: { abbrev: 'CBJ', name: 'Blue Jackets', place: 'Columbus', logo: 'https://assets.nhle.com/logos/nhl/svg/CBJ_light.svg' },
        home: { abbrev: 'BUF', name: 'Sabres', place: 'Buffalo', logo: 'https://assets.nhle.com/logos/nhl/svg/BUF_light.svg' }
      },
      {
        id: 401802570,
        startTimeUTC: `${dateStr}T01:00:00Z`,
        venue: 'Xcel Energy Center',
        away: { abbrev: 'SJS', name: 'Sharks', place: 'San Jose', logo: 'https://assets.nhle.com/logos/nhl/svg/SJS_light.svg' },
        home: { abbrev: 'MIN', name: 'Wild', place: 'Minnesota', logo: 'https://assets.nhle.com/logos/nhl/svg/MIN_light.svg' }
      },
      {
        id: 401802571,
        startTimeUTC: `${dateStr}T01:00:00Z`,
        venue: 'Scotiabank Saddledome',
        away: { abbrev: 'ANA', name: 'Ducks', place: 'Anaheim', logo: 'https://assets.nhle.com/logos/nhl/svg/ANA_light.svg' },
        home: { abbrev: 'CGY', name: 'Flames', place: 'Calgary', logo: 'https://assets.nhle.com/logos/nhl/svg/CGY_light.svg' }
      }
    ];
  }
  if (dateStr === '2026-11-13') {
    return [
      {
        id: 401802624,
        startTimeUTC: '2026-11-14T02:00:00Z',
        venue: 'Rogers Arena',
        state: 'post',
        statusDetail: 'Final',
        away: { abbrev: 'NYR', name: 'Rangers', place: 'New York', logo: NHL_LOGO('NYR'), score: 5, sog: 31 },
        home: { abbrev: 'VAN', name: 'Canucks', place: 'Vancouver', logo: NHL_LOGO('VAN'), score: 1, sog: 28 }
      },
      {
        id: 401802625,
        startTimeUTC: '2026-11-14T03:00:00Z',
        venue: 'T-Mobile Arena',
        state: 'post',
        statusDetail: 'Final/SO',
        away: { abbrev: 'NSH', name: 'Predators', place: 'Nashville', logo: NHL_LOGO('NSH'), score: 3, sog: 32 },
        home: { abbrev: 'VGK', name: 'Golden Knights', place: 'Vegas', logo: NHL_LOGO('VGK'), score: 2, sog: 42 }
      }
    ];
  }
  if (dateStr === '2026-11-19') {
    return JSON.parse(JSON.stringify(DEFAULT_NOV19_GAMES));
  }
  if (dateStr === '2026-11-21') {
    return JSON.parse(JSON.stringify(DEFAULT_NOV21_GAMES));
  }
  return [];
}

function renderGamesTicker(games) {
  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);
  if (!games || games.length === 0) {
    DOM.gamesTicker.innerHTML = `<div class="ticker-loading">No scheduled ${dayLabel} NHL games on ${formatWeekDateStr(state.currentFridayStr)}.</div>`;
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
  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);
  DOM.scheduleDateSubtitle.textContent = formatDateDisplay(state.currentFriday);
  if (DOM.schedulePanelHeading) {
    DOM.schedulePanelHeading.textContent = `${dayLabel}'s NHL Matchups`;
  }

  if (!games || games.length === 0) {
    DOM.matchupsList.innerHTML = `<div class="empty-state-text" style="padding: 10px;">No NHL games listed for this ${dayLabel}. Enter custom matchups when submitting.</div>`;
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
  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);
  DOM.gameSelect.innerHTML = `<option value="">Select a ${dayLabel} game...</option>`;
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

const DEFAULT_NOV21_PICKS = {
  Axel: { user_name: 'Axel', boy: 'Axel', game: 'NYI @ DET', game_title: 'NYI Islanders @ DET Red Wings', bet_type: 'Player Prop', pick_text: 'Alex DeBrincat — 1+ Points', odds: '-222', chirp: 'I love it when Alex puts his cock in my mouth! 🥰', locked: true },
  Will: { user_name: 'Will', boy: 'Will', game: 'NYI @ DET', game_title: 'NYI Islanders @ DET Red Wings', bet_type: 'Player Prop', pick_text: 'Matthew Schaefer — 3+ Shots on Goal', odds: '-150', chirp: 'someone snatch up a bo pick make a stack', locked: true },
  Ben: { user_name: 'Ben', boy: 'Ben', game: 'ANA @ UTA', game_title: 'ANA Ducks @ UTA Mammoth', bet_type: 'Player Prop', pick_text: 'Jackson LaCombe — 1+ Points', odds: '-172', chirp: 'Dish it to Macarooner and let daddy eat.', locked: true },
  Edward: { user_name: 'Edward', boy: 'Edward', game: 'ANA @ UTA', game_title: 'ANA Ducks @ UTA Mammoth', bet_type: 'Player Prop', pick_text: 'Cutter Gauthier — 4+ Shots on Goal', odds: '-125', chirp: 'Ride the hot roddddddd', locked: true },
  Jackson: { user_name: 'Jackson', boy: 'Jackson', game: 'CBJ @ TOR', game_title: 'CBJ Blue Jackets @ TOR Maple Leafs', bet_type: 'Moneyline', pick_text: 'Toronto Maple Leafs ML', odds: '-122', chirp: 'Curse breaker night vs Knies', locked: true },
  Alex: { user_name: 'Alex', boy: 'Alex', game: 'WSH @ BOS', game_title: 'WSH Capitals @ BOS Bruins', bet_type: 'Total', pick_text: 'WSH @ BOS Under 6.5 Total Goals', odds: '-106', chirp: 'I am gay', locked: true }
};

const DEFAULT_NOV13_PICKS = {
  Edward: { user_name: 'Edward', boy: 'Edward', game: 'NYR @ VAN', game_title: 'NYR Rangers @ VAN Canucks', bet_type: 'Player Prop', pick_text: 'Liam Ohgren — Over 0.5 Total Goals', odds: '+360', chirp: 'Kid is HOT, all sweedish tonight baby', locked: true },
  Will: { user_name: 'Will', boy: 'Will', game: 'NYR @ VAN', game_title: 'NYR Rangers @ VAN Canucks', bet_type: 'Player Prop', pick_text: 'Brock Boeser — Over 0.5 Total Points', odds: '-135', chirp: 'Brock Hard!', locked: true },
  Ben: { user_name: 'Ben', boy: 'Ben', game: 'NYR @ VAN', game_title: 'NYR Rangers @ VAN Canucks', bet_type: 'Player Prop', pick_text: 'J.T. Miller — Over 1.5 Shots on Goal', odds: '-140', chirp: 'JT is coming home baby', locked: true },
  Jackson: { user_name: 'Jackson', boy: 'Jackson', game: 'NSH @ VGK', game_title: 'NSH Predators @ VGK Golden Knights', bet_type: 'Player Prop', pick_text: 'Adin Hill — Over 22.5 Total Saves', odds: '-120', chirp: 'fuk carter hart', locked: true },
  Axel: { user_name: 'Axel', boy: 'Axel', game: 'NSH @ VGK', game_title: 'NSH Predators @ VGK Golden Knights', bet_type: 'Player Prop', pick_text: 'Victor Olofsson — Over 2.5 Shots on Goal', odds: '+125', chirp: 'Victor “Shot Factory” Olofsson', locked: true }
};

const DEFAULT_NOV06_PICKS = {
  Axel: { user_name: 'Axel', boy: 'Axel', game: 'CBJ @ BUF', game_title: 'CBJ Blue Jackets @ BUF Sabres', bet_type: 'Player Prop', pick_text: 'Kent Johnson — 1+ Points', odds: '-120', chirp: 'Fella’s on a 6 game point streak and had 1A last time he played Buffalo. Free money 🔏', locked: true },
  Jackson: { user_name: 'Jackson', boy: 'Jackson', game: 'SJS @ MIN', game_title: 'SJS Sharks @ MIN Wild', bet_type: 'Player Prop', pick_text: 'Matt Boldy — 3+ Shots on Goal', odds: '-135', chirp: 'Sharks defense is Swiss cheese', locked: true },
  Will: { user_name: 'Will', boy: 'Will', game: 'ANA @ CGY', game_title: 'ANA Ducks @ CGY Flames', bet_type: 'Player Prop', pick_text: 'Cutter Gauthier — Anytime Goal Scorer', odds: '+137', chirp: 'slurp me up crazy style', locked: true },
  Alex: { user_name: 'Alex', boy: 'Alex', game: 'SJS @ MIN', game_title: 'SJS Sharks @ MIN Wild', bet_type: 'Puckline', pick_text: 'Minnesota Wild -1.5 Puck Line', odds: '+110', chirp: '', locked: true },
  Ben: { user_name: 'Ben', boy: 'Ben', game: 'SJS @ MIN', game_title: 'SJS Sharks @ MIN Wild', bet_type: 'Player Prop', pick_text: 'Quinn Hughes — 1+ Points', odds: '-390', chirp: 'Please', locked: true },
  Edward: { user_name: 'Edward', boy: 'Edward', game: 'ANA @ CGY', game_title: 'ANA Ducks @ CGY Flames', bet_type: 'Player Prop', pick_text: 'Beckett Sennecke — 1+ Points', odds: '-195', chirp: 'The Macrooner will strike again', locked: true }
};

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
  Will: { user_name: 'Will', boy: 'Will', game: 'MTL @ CHI', game_title: 'MTL Canadiens @ CHI Blackhawks', betType: 'Player Prop', pick_text: 'Over 0.5 Total Points', odds: '-175', chirp: "Free money guys, goalie on a cold streak…", locked: true },
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

const DEFAULT_OCT02_PICKS = {
  Ben: { user_name: 'Ben', boy: 'Ben', game: 'ANA @ VGK', game_title: 'ANA Ducks @ VGK Golden Knights', bet_type: 'Player Prop', pick_text: 'Mitch Marner — 1+ Points', odds: '-200', chirp: 'I actually only did $5 — we can start with 5 and increase if we want', locked: true },
  Alex: { user_name: 'Alex', boy: 'Alex', game: 'ANA @ VGK', game_title: 'ANA Ducks @ VGK Golden Knights', bet_type: 'Player Prop', pick_text: 'Jack Eichel — 2+ Shots on Goal', odds: '-300', chirp: 'Me and Alex’s legs both hit tonight', locked: true },
  Jackson: { user_name: 'Jackson', boy: 'Jackson', game: 'STL @ DAL', game_title: 'STL Blues @ DAL Stars', bet_type: 'Player Prop', pick_text: 'Wyatt Johnston — 1+ Points', odds: '-140', chirp: 'wyatt johnston for a point', locked: true },
  Will: { user_name: 'Will', boy: 'Will', game: 'CHI @ BUF', game_title: 'CHI Blackhawks @ BUF Sabres', bet_type: 'Player Prop', pick_text: 'Patrick Kane — Anytime Goal Scorer', odds: '+200', chirp: 'Patty Kane goal after the Canes game started at 5', locked: true },
  Axel: { user_name: 'Axel', boy: 'Axel', game: 'WSH @ CAR', game_title: 'WSH Capitals @ CAR Hurricanes', bet_type: 'Moneyline', pick_text: 'Carolina Hurricanes Moneyline', odds: '-180', chirp: 'Canes ML', locked: true }
};

const DEFAULT_MASTER_SLIPS = {
  '2026-10-02': {
    id: '2026-10-02',
    week_date: '2026-10-02',
    bettor_name: 'Ben',
    status: 'lost',
    stake: 5,
    total_odds: '+1500',
    potential_payout: 80.00,
    notes: 'Inaugural Friday Puck Parlay placed on Bet365 by Ben ($5 @ +1500 -> $80.00 • 2 of 5 hit)'
  },
  '2026-10-16': {
    id: '2026-10-16',
    week_date: '2026-10-16',
    bettor_name: 'Axel',
    status: 'lost',
    stake: 25,
    total_odds: '+950',
    potential_payout: 262.50,
    notes: 'Placed by Axel'
  },
  '2026-10-23': {
    id: '2026-10-23',
    week_date: '2026-10-23',
    bettor_name: 'Jackson',
    status: 'lost',
    stake: 30,
    total_odds: '+1261',
    potential_payout: 408.35,
    notes: 'Placed on FanDuel by Jackson'
  },
  '2026-10-30': {
    id: '2026-10-30',
    week_date: '2026-10-30',
    bettor_name: 'Will',
    status: 'lost',
    stake: 30,
    total_odds: '+2394',
    potential_payout: 748.20,
    notes: 'Placed on BET99 by Will (SGP+ @ +2394)'
  },
  '2026-11-06': {
    id: '2026-11-06',
    week_date: '2026-11-06',
    bettor_name: 'Alex',
    status: 'won',
    stake: 30,
    total_odds: '+1414',
    potential_payout: 454.41,
    notes: 'CASHED! Placed on FanDuel by Alex ($30 SGP+ @ +1414 -> $454.41 Payout • All 6/6 Legs Hit!)'
  },
  '2026-11-13': {
    id: '2026-11-13',
    week_date: '2026-11-13',
    bettor_name: 'Edward',
    status: 'lost',
    stake: 25,
    total_odds: '+5525',
    potential_payout: 1406.25,
    notes: 'Settled - Lost on Betway ($25 5-Fold @ +5525 -> $1,406.25 • 4 of 5 hit: Will, Ben, Jackson & Axel cashed; Edward sold on Liam Ohgren 0G!)'
  },
  '2026-11-21': {
    id: '2026-11-21',
    week_date: '2026-11-21',
    bettor_name: 'Ben',
    status: 'placed',
    stake: 25,
    total_odds: '+2316',
    potential_payout: 603.99,
    notes: 'Placed on FanDuel by Ben ($25 split: $20 @ +2105 -> $441.06 + $5 w/ 50% Profit Boost @ +3158 -> $162.93 = $603.99 total payout)'
  }
};

function getDefaultStakeForDate(dateStr) {
  if (dateStr === '2026-10-02') return 5;
  if (dateStr === '2026-10-16' || dateStr === '2026-11-13' || dateStr === '2026-11-21') return 25;
  if ((dateStr === WEEK7_THU_DATE || dateStr === WEEK7_SAT_DATE) && isWeek7SplitMode()) return 15;
  return 30;
}

function peekSavedLegsCount(dateStr) {
  if (state.currentFridayStr === dateStr) {
    return Object.keys(state.legs || {}).length;
  }
  try {
    const raw = localStorage.getItem(`bet_the_show_${dateStr}_v8`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Object.keys(parsed.legs || {}).length;
    }
  } catch (e) {}
  return 0;
}

function loadLocalData(dateStr) {
  state.masterSlip = DEFAULT_MASTER_SLIPS[dateStr] ? JSON.parse(JSON.stringify(DEFAULT_MASTER_SLIPS[dateStr])) : null;

  const defaultStakeForDate = getDefaultStakeForDate(dateStr);
  const key = `bet_the_show_${dateStr}_v8`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.legs = parsed.legs || {};
      const hasAnyLegs = Object.keys(state.legs).length > 0;
      state.stake = (!parsed.isPlaced && !hasAnyLegs) ? defaultStakeForDate : (parsed.stake || defaultStakeForDate);
      state.isPlaced = !!parsed.isPlaced;
      // If an official placed/settled master slip exists in code, ensure local draft upgrades cleanly
      if (state.masterSlip && ['placed', 'won', 'lost'].includes(state.masterSlip.status)) {
        if (!state.isPlaced) {
          state.isPlaced = true;
          state.stake = state.masterSlip.stake || defaultStakeForDate;
          if (dateStr === '2026-11-21' && Object.keys(state.legs).length < 6) {
            state.legs = JSON.parse(JSON.stringify(DEFAULT_NOV21_PICKS));
          }
          saveLocalData(dateStr);
        }
      }
      return;
    } catch (e) {}
  }

  // Prepopulate if opening canonical weeks
  if (dateStr === '2026-11-21') {
    state.legs = JSON.parse(JSON.stringify(DEFAULT_NOV21_PICKS));
    state.stake = 25;
    state.isPlaced = true;
  } else if (dateStr === '2026-11-13') {
    state.legs = JSON.parse(JSON.stringify(DEFAULT_NOV13_PICKS));
    state.stake = 25;
    state.isPlaced = true;
  } else if (dateStr === '2026-11-06') {
    state.legs = JSON.parse(JSON.stringify(DEFAULT_NOV06_PICKS));
    state.stake = 30;
    state.isPlaced = true;
  } else if (dateStr === '2026-10-30') {
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
  } else if (dateStr === '2026-10-02') {
    state.legs = JSON.parse(JSON.stringify(DEFAULT_OCT02_PICKS));
    state.stake = 5;
    state.isPlaced = true;
  } else {
    state.legs = {};
    state.stake = defaultStakeForDate;
    state.isPlaced = false;
  }
  saveLocalData(dateStr);
}

function saveLocalData(dateStr) {
  const key = `bet_the_show_${dateStr}_v8`;
  const payload = {
    date: dateStr,
    legs: state.legs,
    stake: state.stake,
    isPlaced: state.isPlaced,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

// =============================================================================
// 10B. WEEK 7 SPECIAL THURSDAY VS. SATURDAY VOTE & AUTO-LOCK ENGINE
// =============================================================================
function initWeek7VoteState() {
  state.week7Vote.thuGames = getFallbackGames(WEEK7_THU_DATE);
  state.week7Vote.satGames = getFallbackGames(WEEK7_SAT_DATE);

  const savedVoter = localStorage.getItem('bts_voter_identity') || '';
  if (SQUAD.some(b => b.name === savedVoter)) {
    state.week7Vote.selectedVoter = savedVoter;
  }

  try {
    const raw = localStorage.getItem(WEEK7_VOTE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state.week7Vote.votes = parsed.votes || {};
        if (isValidWeek7VoteChoice(parsed.lockedDate)) {
          state.week7Vote.lockedDate = parsed.lockedDate;
        }
      }
    }
  } catch (e) {}
}

function saveLocalWeek7Votes() {
  try {
    localStorage.setItem(WEEK7_VOTE_STORAGE_KEY, JSON.stringify({
      votes: state.week7Vote.votes,
      lockedDate: state.week7Vote.lockedDate,
      updatedAt: new Date().toISOString()
    }));
  } catch (e) {}
}

function mapEspnEventsToGames(events, fallbackList = []) {
  if (!Array.isArray(events) || events.length === 0) return fallbackList;
  return events.map(ev => {
    const comp = ev.competitions?.[0] || {};
    const competitors = comp.competitors || [];
    const awayComp = competitors.find(c => c.homeAway === 'away') || competitors[0] || {};
    const homeComp = competitors.find(c => c.homeAway === 'home') || competitors[1] || {};
    const awayAbbrev = normalizeTeamAbbr(awayComp.team?.abbreviation || 'NHL');
    const homeAbbrev = normalizeTeamAbbr(homeComp.team?.abbreviation || 'NHL');
    return {
      id: ev.id,
      startTimeUTC: ev.date,
      venue: comp.venue?.fullName || 'NHL Arena',
      state: ev.status?.type?.state || 'pre',
      statusDetail: ev.status?.type?.shortDetail || '',
      away: {
        abbrev: awayAbbrev,
        name: awayComp.team?.shortDisplayName || awayAbbrev,
        place: awayComp.team?.location || '',
        logo: awayComp.team?.logo || NHL_LOGO(awayAbbrev),
        score: parseInt(awayComp.score || '0', 10) || 0
      },
      home: {
        abbrev: homeAbbrev,
        name: homeComp.team?.shortDisplayName || homeAbbrev,
        place: homeComp.team?.location || '',
        logo: homeComp.team?.logo || NHL_LOGO(homeAbbrev),
        score: parseInt(homeComp.score || '0', 10) || 0
      }
    };
  });
}

async function fetchWeek7DualSlates() {
  if (!state.week7Vote.thuGames || state.week7Vote.thuGames.length === 0) {
    state.week7Vote.thuGames = getFallbackGames(WEEK7_THU_DATE);
  }
  if (!state.week7Vote.satGames || state.week7Vote.satGames.length === 0) {
    state.week7Vote.satGames = getFallbackGames(WEEK7_SAT_DATE);
  }

  if (isViewingWeek7Vote()) {
    renderDualVoteTicker();
    renderWeek7VoteArena();
  }

  const baseUrl = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard';
  try {
    const [thuRes, satRes] = await Promise.allSettled([
      fetch(`${baseUrl}?dates=20261119`),
      fetch(`${baseUrl}?dates=20261121`)
    ]);

    if (thuRes.status === 'fulfilled' && thuRes.value.ok) {
      const thuJson = await thuRes.value.json();
      if (Array.isArray(thuJson.events) && thuJson.events.length > 0) {
        state.week7Vote.thuGames = mapEspnEventsToGames(thuJson.events, state.week7Vote.thuGames);
      }
    }
    if (satRes.status === 'fulfilled' && satRes.value.ok) {
      const satJson = await satRes.value.json();
      if (Array.isArray(satJson.events) && satJson.events.length > 0) {
        state.week7Vote.satGames = mapEspnEventsToGames(satJson.events, state.week7Vote.satGames);
      }
    }
  } catch (e) {}

  if (isViewingWeek7Vote()) {
    renderDualVoteTicker();
    renderWeek7VoteArena();
  }
}

function renderDualVoteTicker() {
  const thuList = (state.week7Vote.thuGames || []).map(g => ({ ...g, dayTag: 'THU 11/19' }));
  const satList = (state.week7Vote.satGames || []).map(g => ({ ...g, dayTag: 'SAT 11/21' }));
  const combined = [...thuList, ...satList];

  if (DOM.ribbonDayLabel) DOM.ribbonDayLabel.textContent = 'THU / SAT SLATES';
  if (DOM.tickerGamesCount) DOM.tickerGamesCount.textContent = `${combined.length} GAMES`;

  if (!DOM.gamesTicker) return;
  DOM.gamesTicker.innerHTML = combined.map(g => {
    const timeStr = formatGameTime(g.startTimeUTC);
    return `
      <div class="ticker-game-chip" data-vote-day="${g.dayTag.startsWith('THU') ? WEEK7_THU_DATE : WEEK7_SAT_DATE}">
        <div class="ticker-teams">
          <div class="ticker-team-line">
            <div class="ticker-team-left">
              <img src="${g.away.logo}" class="ticker-team-logo" alt="${g.away.abbrev}" onerror="this.style.display='none'" />
              <span class="ticker-team-abbrev">${g.away.abbrev}</span>
            </div>
          </div>
          <div class="ticker-team-line">
            <div class="ticker-team-left">
              <img src="${g.home.logo}" class="ticker-team-logo" alt="${g.home.abbrev}" onerror="this.style.display='none'" />
              <span class="ticker-team-abbrev">${g.home.abbrev}</span>
            </div>
          </div>
        </div>
        <div class="ticker-status">
          <div class="ticker-time" style="color:${g.dayTag.startsWith('THU') ? 'var(--nhl-blue)' : 'var(--green-win)'};">${g.dayTag}</div>
          <div class="ticker-state">${timeStr}</div>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.ticker-game-chip[data-vote-day]').forEach(chip => {
    chip.addEventListener('click', () => {
      const targetDay = chip.getAttribute('data-vote-day');
      state.week7Vote.slateFilter = targetDay;
      switchView('slipBuilderView');
      renderWeek7VoteArena();
      const slatesEl = document.getElementById('week7DualSlatesSection');
      if (slatesEl) slatesEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function parseVoteRowChoice(row) {
  if (!row) return null;
  if (row.pick_text === WEEK7_SPLIT_CHOICE || row.odds === 'BOTH') return WEEK7_SPLIT_CHOICE;
  if (row.pick_text === WEEK7_THU_DATE || row.odds === 'THU') return WEEK7_THU_DATE;
  if (row.pick_text === WEEK7_SAT_DATE || row.odds === 'SAT') return WEEK7_SAT_DATE;
  return null;
}

function getWeek7ChoiceDisplayLabel(choiceVal) {
  if (choiceVal === WEEK7_SPLIT_CHOICE) return '$15 Thu + $15 Sat Split (2 Parlays)';
  if (choiceVal === WEEK7_THU_DATE) return 'Thursday Only ($30 • Nov 19)';
  if (choiceVal === WEEK7_SAT_DATE) return 'Saturday Only ($30 • Nov 21)';
  return 'Week 7';
}

function parseWeek7LockRow(masterRow) {
  if (!masterRow) return null;
  const st = String(masterRow.status || '').toLowerCase();
  if (st === 'voting') {
    return { unlocked: true };
  }
  if (st === 'vote_locked' && masterRow.notes) {
    try {
      const parsed = JSON.parse(masterRow.notes);
      if (parsed && isValidWeek7VoteChoice(parsed.resolvedMode || parsed.resolvedDate)) {
        return { resolvedMode: parsed.resolvedMode || parsed.resolvedDate };
      }
    } catch (e) {
      if (String(masterRow.notes).includes(WEEK7_SPLIT_CHOICE)) return { resolvedMode: WEEK7_SPLIT_CHOICE };
      if (String(masterRow.notes).includes(WEEK7_THU_DATE)) return { resolvedMode: WEEK7_THU_DATE };
      if (String(masterRow.notes).includes(WEEK7_SAT_DATE)) return { resolvedMode: WEEK7_SAT_DATE };
    }
  }
  return null;
}

async function fetchWeek7VotesFromSupabase() {
  if (!state.supabase) return;
  try {
    const [votesResp, lockResp] = await Promise.all([
      state.supabase.from('parlay_legs').select('*').eq('week_date', WEEK7_VOTE_DATE_KEY),
      state.supabase.from('friday_parlays').select('*').eq('id', WEEK7_FRIDAY_ANCHOR).maybeSingle()
    ]);

    if (!votesResp.error && Array.isArray(votesResp.data)) {
      const map = {};
      votesResp.data.forEach(row => {
        const choice = parseVoteRowChoice(row);
        if (choice && SQUAD.some(b => b.name === row.user_name)) {
          map[row.user_name] = {
            choice,
            updatedAt: row.updated_at || row.created_at || ''
          };
        }
      });
      state.week7Vote.votes = map;
    }

    if (!lockResp.error && lockResp.data) {
      const lockInfo = parseWeek7LockRow(lockResp.data);
      if (lockInfo?.unlocked) {
        state.week7Vote.lockedDate = null;
      } else if (lockInfo?.resolvedMode) {
        state.week7Vote.lockedDate = lockInfo.resolvedMode;
      }
    }

    state.week7Vote.supabaseLoaded = true;
    saveLocalWeek7Votes();

    // If Week 7 vote is locked (either via Wed 8 PM deadline or explicit lock), transition active Week 7 date
    if (isWeek7DateStr(state.currentFridayStr)) {
      const targetStr = getResolvedWeek7DateStr();
      if (state.currentFridayStr === WEEK7_FRIDAY_ANCHOR && targetStr !== WEEK7_FRIDAY_ANCHOR) {
        applyWeek7ResolvedTransition(targetStr, false);
        return;
      }
    }

    renderAll();
  } catch (err) {
    console.warn('Week 7 vote fetch error:', err);
  }
}

async function castWeek7Vote(boyName, choiceVal) {
  if (!boyName || !SQUAD.some(b => b.name === boyName)) {
    showToast('Tap your name in Step 1 first to cast your vote!', 'alert');
    const step1 = document.getElementById('voteIdentityStepBar');
    if (step1) {
      step1.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }
  if (!isValidWeek7VoteChoice(choiceVal)) return;

  state.week7Vote.selectedVoter = boyName;
  localStorage.setItem('bts_voter_identity', boyName);

  state.week7Vote.votes[boyName] = {
    choice: choiceVal,
    updatedAt: new Date().toISOString()
  };
  saveLocalWeek7Votes();
  playSound('lock');
  renderAll();

  const label = getWeek7ChoiceDisplayLabel(choiceVal);
  const shortTag = choiceVal === WEEK7_SPLIT_CHOICE ? 'BOTH' : (choiceVal === WEEK7_THU_DATE ? 'THU' : 'SAT');
  showToast(`${boyName} voted for ${label}!`, 'checkCircle');

  if (state.supabase) {
    try {
      await state.supabase
        .from('parlay_legs')
        .upsert({
          week_date: WEEK7_VOTE_DATE_KEY,
          user_name: boyName,
          game_title: 'WEEK7_DAY_VOTE',
          pick_text: choiceVal,
          odds: shortTag,
          bet_type: 'Day Vote',
          chirp: `Voted ${label}`,
          locked: true,
          updated_at: new Date().toISOString()
        }, { onConflict: 'week_date,user_name' });
    } catch (e) {
      console.warn('Could not sync Week 7 vote to Supabase:', e);
    }
  }
}
window.castWeek7Vote = castWeek7Vote;

function selectWeek7Voter(boyName) {
  state.week7Vote.selectedVoter = boyName;
  localStorage.setItem('bts_voter_identity', boyName);
  playSound('click');
  renderWeek7VoteArena();
}
window.selectWeek7Voter = selectWeek7Voter;

function setWeek7SlateFilter(filterVal) {
  state.week7Vote.slateFilter = filterVal;
  playSound('click');
  renderWeek7VoteArena();
}
window.setWeek7SlateFilter = setWeek7SlateFilter;

function applyWeek7ResolvedTransition(targetDateStr, celebrate = false) {
  const openDateStr = targetDateStr === WEEK7_SPLIT_CHOICE
    ? getActiveWeek7SplitDateStr()
    : targetDateStr;
  state.currentFriday = parseLocalISODate(openDateStr);
  state.currentFridayStr = formatDateISO(state.currentFriday);
  loadLocalData(state.currentFridayStr);
  initTrackerData();
  fetchFridayNhlGames(state.currentFridayStr);
  if (state.supabase) fetchSupabaseParlay(state.currentFridayStr);
  renderAll();
  renderTracker();

  if (celebrate) {
    playSound('triumph');
    if (window.confetti) confetti({ particleCount: 110, spread: 75, origin: { y: 0.65 } });
    if (isWeek7SplitMode()) {
      showToast('Week 7 Doubleheader ($15 Thu + $15 Sat) locked! Part 1 (Thu Nov 19) is live.', 'fire');
    } else {
      const dayName = getDayLabelForDateStr(openDateStr);
      showToast(`Week 7 locked for ${dayName}, ${formatWeekDateStr(openDateStr)}! Slip Builder is live.`, 'fire');
    }
  }
}

async function persistWeek7LockState(resolvedModeOrNull) {
  state.week7Vote.lockedDate = resolvedModeOrNull;
  saveLocalWeek7Votes();

  if (state.supabase) {
    try {
      const isLocked = isValidWeek7VoteChoice(resolvedModeOrNull);
      await state.supabase
        .from('friday_parlays')
        .upsert({
          id: WEEK7_FRIDAY_ANCHOR,
          week_date: WEEK7_FRIDAY_ANCHOR,
          bettor_name: 'Ben',
          status: isLocked ? 'vote_locked' : 'voting',
          stake: 30,
          total_odds: '--',
          potential_payout: 0,
          notes: isLocked
            ? JSON.stringify({ resolvedMode: resolvedModeOrNull, resolvedDate: resolvedModeOrNull, lockedAt: new Date().toISOString() })
            : 'Week 7 Format Vote Open (Thu $30 vs Sat $30 vs $15+$15 Split)',
          updated_at: new Date().toISOString()
        });
    } catch (e) {
      console.warn('Could not persist Week 7 lock state:', e);
    }
  }
}

async function lockWeek7VoteNow(explicitChoice = null) {
  const tally = tallyWeek7Votes();
  const chosenMode = isValidWeek7VoteChoice(explicitChoice)
    ? explicitChoice
    : tally.winnerMode;
  const label = getWeek7ChoiceDisplayLabel(chosenMode);
  if (!explicitChoice && !confirm(`Lock in the Week 7 vote right now for "${label}" and open Ben's Slip Builder?`)) {
    return;
  }
  await persistWeek7LockState(chosenMode);
  applyWeek7ResolvedTransition(chosenMode, true);
}
window.lockWeek7VoteNow = lockWeek7VoteNow;

async function switchWeek7ResolvedDay(explicitMode = null) {
  const currentMode = getWinningWeek7Mode() || state.currentFridayStr;
  let nextMode = explicitMode;
  if (!isValidWeek7VoteChoice(nextMode)) {
    // Cycle: BOTH_SPLIT_15 -> 2026-11-19 ($30 Thu) -> 2026-11-21 ($30 Sat) -> BOTH_SPLIT_15
    if (currentMode === WEEK7_SPLIT_CHOICE) nextMode = WEEK7_THU_DATE;
    else if (currentMode === WEEK7_THU_DATE) nextMode = WEEK7_SAT_DATE;
    else nextMode = WEEK7_SPLIT_CHOICE;
  }
  const label = getWeek7ChoiceDisplayLabel(nextMode);
  if (!confirm(`Switch Week 7's locked format to "${label}"?`)) return;
  await persistWeek7LockState(nextMode);
  applyWeek7ResolvedTransition(nextMode, true);
}
window.switchWeek7ResolvedDay = switchWeek7ResolvedDay;

async function reopenWeek7Vote() {
  if (new Date().getTime() >= WEEK7_VOTE_LOCK_AT.getTime()) {
    showToast('Wednesday 8:00 PM ET deadline has passed — use "Change Format" to switch.', 'clock');
    return;
  }
  await persistWeek7LockState(null);
  state.currentFriday = parseLocalISODate(WEEK7_FRIDAY_ANCHOR);
  state.currentFridayStr = WEEK7_FRIDAY_ANCHOR;
  loadLocalData(state.currentFridayStr);
  initTrackerData();
  fetchWeek7DualSlates();
  renderAll();
  showToast('Week 7 vote reopened!', 'bolt');
}
window.reopenWeek7Vote = reopenWeek7Vote;

function copyWeek7VoteChirp() {
  const tally = tallyWeek7Votes();
  const missing = SQUAD.filter(b => !state.week7Vote.votes[b.name]).map(b => `@${b.name}`);
  let msg = `[BET THE SHOW — WEEK 7 SCHEDULE VOTE]\n`;
  msg += `Zero NHL games next Friday (Nov 20), so vote on how we run our $30 Week 7 pool!\n\n`;
  msg += `• $15 THU + $15 SAT SPLIT (2 Parlays): ${tally.splitCount} vote${tally.splitCount === 1 ? '' : 's'}${tally.splitVoters.length ? ` (${tally.splitVoters.join(', ')})` : ''}\n`;
  msg += `• THU NOV 19 ONLY ($30 • 12 Gm): ${tally.thuCount} vote${tally.thuCount === 1 ? '' : 's'}${tally.thuVoters.length ? ` (${tally.thuVoters.join(', ')})` : ''}\n`;
  msg += `• SAT NOV 21 ONLY ($30 • 14 Gm): ${tally.satCount} vote${tally.satCount === 1 ? '' : 's'}${tally.satVoters.length ? ` (${tally.satVoters.join(', ')})` : ''}\n\n`;
  if (missing.length > 0) {
    msg += `Still need votes from: ${missing.join(', ')}\n`;
  } else {
    msg += `All 6 votes are in!\n`;
  }
  msg += `Locks Wednesday, Nov 18 @ 8:00 PM ET (Ben on deck):\nhttps://mukpostproduction-debug.github.io/friday-puck-parlay/`;

  navigator.clipboard.writeText(msg).then(() => {
    playSound('click');
    showToast('Vote reminder copied! Paste in the group chat', 'chat');
  });
}
window.copyWeek7VoteChirp = copyWeek7VoteChirp;

function formatVoteLockCountdown(now = new Date()) {
  const diff = WEEK7_VOTE_LOCK_AT.getTime() - now.getTime();
  if (diff <= 0) return 'LOCKED • WED 8:00 PM ET';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);
  const pad = n => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
  return `${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
}

function checkWeek7AutoLockTransition() {
  const now = new Date();
  const timerEl = document.getElementById('voteCountdownTimerEl');
  if (timerEl) {
    timerEl.textContent = formatVoteLockCountdown(now);
  }

  // Automatic Wednesday 8:00 PM ET lock-in transition!
  if (state.currentFridayStr === WEEK7_FRIDAY_ANCHOR && isWeek7VoteLocked(now)) {
    const winnerMode = tallyWeek7Votes(now).winnerMode;
    persistWeek7LockState(winnerMode);
    applyWeek7ResolvedTransition(winnerMode, true);
  }
}

function renderSlateColumnHtml(titleText, badgeText, gamesList) {
  const rowsHtml = (gamesList || []).map(g => {
    const timeStr = formatGameTime(g.startTimeUTC);
    return `
      <div class="vote-game-row">
        <div class="vote-game-teams">
          <span class="vote-game-team">
            <img src="${g.away.logo}" alt="${g.away.abbrev}" onerror="this.style.display='none'" />
            <span>${escapeHTML(g.away.place ? `${g.away.place} ${g.away.name}` : g.away.name)}</span>
          </span>
          <span class="vote-game-at">@</span>
          <span class="vote-game-team">
            <img src="${g.home.logo}" alt="${g.home.abbrev}" onerror="this.style.display='none'" />
            <span>${escapeHTML(g.home.place ? `${g.home.place} ${g.home.name}` : g.home.name)}</span>
          </span>
        </div>
        <div class="vote-game-meta">
          <div class="vote-game-time">${timeStr}</div>
          <div class="vote-game-venue">${escapeHTML(g.venue || 'NHL Arena')}</div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="vote-slate-col">
      <div class="vote-slate-col-head">
        <span class="vote-slate-col-title">${titleText}</span>
        <span class="vote-slate-col-badge">${badgeText}</span>
      </div>
      <div class="vote-slate-games-list">
        ${rowsHtml}
      </div>
    </div>
  `;
}

function renderWeek7VoteArena() {
  if (!DOM.week7VoteArena) return;
  const tally = tallyWeek7Votes();
  const thuGames = state.week7Vote.thuGames?.length ? state.week7Vote.thuGames : getFallbackGames(WEEK7_THU_DATE);
  const satGames = state.week7Vote.satGames?.length ? state.week7Vote.satGames : getFallbackGames(WEEK7_SAT_DATE);
  const selectedVoter = state.week7Vote.selectedVoter;
  const selectedVoteChoice = selectedVoter ? state.week7Vote.votes[selectedVoter]?.choice : null;

  const thuPct = tally.totalVotes > 0 ? Math.round((tally.thuCount / 6) * 100) : 0;
  const satPct = tally.totalVotes > 0 ? Math.round((tally.satCount / 6) * 100) : 0;
  const splitPct = tally.totalVotes > 0 ? Math.round((tally.splitCount / 6) * 100) : 0;

  const thuLeading = tally.maxVotes > 0 && tally.thuCount === tally.maxVotes && tally.thuCount > tally.satCount && tally.thuCount > tally.splitCount;
  const satLeading = tally.maxVotes > 0 && tally.satCount === tally.maxVotes && tally.satCount > tally.thuCount && tally.satCount > tally.splitCount;
  const splitLeading = tally.maxVotes > 0 && tally.splitCount === tally.maxVotes && tally.splitCount > tally.thuCount && tally.splitCount > tally.satCount;

  const thuMarquee = [
    ['LAK', 'TOR'], ['EDM', 'TBL'], ['MTL', 'CAR'], ['DAL', 'VGK']
  ];
  const satMarquee = [
    ['CBJ', 'TOR'], ['PHI', 'MTL'], ['WSH', 'BOS'], ['EDM', 'CAR']
  ];

  const filter = state.week7Vote.slateFilter || 'both';
  const showThu = filter === 'both' || filter === WEEK7_THU_DATE;
  const showSat = filter === 'both' || filter === WEEK7_SAT_DATE;

  DOM.week7VoteArena.innerHTML = `
    <div class="vote-arena-wrap">
      <!-- HERO HEADER & STEP 1 VOTER IDENTITY -->
      <div class="nhl-card vote-hero-card">
        <div class="vote-hero-top">
          <div>
            <div class="vote-alert-pill">${getIcon('bolt')} NO FRIDAY NHL GAMES ON NOV 20 • WEEK 7 FORMAT VOTE</div>
            <h2 class="vote-hero-title">Pick Week 7 Format: $15 + $15 Split vs. Thu ($30) vs. Sat ($30)</h2>
            <p class="vote-hero-desc">
              Zero NHL games are scheduled next Friday (Nov 20). Vote below to either <strong>split our $30 pool in half ($15 Thursday + $15 Saturday — two 6-leg parlays!)</strong> or go all-in for <strong>$30 on Thursday (12 games)</strong> or <strong>$30 on Saturday (14 games)</strong>. Locks automatically <strong>Wednesday, Nov 18 @ 8:00 PM ET</strong> with <strong>Ben</strong> on deck!
            </p>
          </div>
          <div class="vote-deadline-box">
            <div class="vote-deadline-label">Auto-Locks Wed Nov 18 • 8:00 PM ET</div>
            <div class="vote-deadline-timer" id="voteCountdownTimerEl">${formatVoteLockCountdown()}</div>
            <div class="vote-deadline-sub">${tally.totalVotes} of 6 Squad Votes Cast</div>
          </div>
        </div>

        <div class="vote-identity-bar" id="voteIdentityStepBar">
          <div class="vote-step-label">
            <span>Step 1 — Tap Your Name to Vote (${selectedVoter ? `Voting as ${selectedVoter}` : 'Select yourself below'})</span>
            <span style="color:var(--nhl-blue);">${state.isLiveSync ? '● Live Cloud Sync Active' : 'Local Mode'}</span>
          </div>
          <div class="vote-boys-grid">
            ${SQUAD.map(boy => {
              const bVote = state.week7Vote.votes[boy.name]?.choice;
              const isSelected = selectedVoter === boy.name;
              const tagClass = bVote === WEEK7_SPLIT_CHOICE ? 'voted-both' : (bVote === WEEK7_THU_DATE ? 'voted-thu' : (bVote === WEEK7_SAT_DATE ? 'voted-sat' : ''));
              const tagText = bVote === WEEK7_SPLIT_CHOICE ? '$15×2' : (bVote === WEEK7_THU_DATE ? 'THU' : (bVote === WEEK7_SAT_DATE ? 'SAT' : '--'));
              return `
                <button type="button" class="vote-boy-chip ${isSelected ? 'active' : ''}" onclick="selectWeek7Voter('${boy.name}')">
                  <span class="vote-boy-chip-left">
                    <span class="vote-boy-initials">${boy.initials}</span>
                    <span>${boy.name}</span>
                  </span>
                  <span class="vote-boy-mini-tag ${tagClass}">${tagText}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- STEP 2: 3-WAY FORMAT VOTE CARDS -->
      <div class="vote-options-grid">
        <!-- OPTION 1: SPLIT POOL ($15 THU + $15 SAT) -->
        <div class="nhl-card vote-day-card split-option ${splitLeading ? 'leading' : ''} ${selectedVoteChoice === WEEK7_SPLIT_CHOICE ? 'user-voted' : ''}">
          <div class="vote-day-top">
            <div>
              <div class="vote-day-kicker" style="color:var(--gold-odds);">Doubleheader • Split Pool in Half</div>
              <div class="vote-day-title">$15 Thu + $15 Sat</div>
              <div class="vote-day-window">Two 6-Leg Parlays • $2.50/Guy Each Night ($30 Total)</div>
            </div>
            <span class="vote-games-count-pill">2 PARLAYS</span>
          </div>

          <div class="vote-marquee-strip">
            <span class="vote-marquee-chip">🏒 Thu Nov 19: $15 (12 Gm)</span>
            <span class="vote-marquee-chip">🏒 Sat Nov 21: $15 (14 Gm)</span>
            <span class="vote-marquee-chip">🔥 2 Shots to Cash</span>
          </div>

          <div class="vote-tally-box">
            <div class="vote-tally-row">
              <span class="vote-tally-num">${tally.splitCount} Vote${tally.splitCount === 1 ? '' : 's'} ${splitLeading ? '• LEADING' : ''}</span>
              <span class="vote-tally-pct">${tally.splitCount} / 6 Squad</span>
            </div>
            <div class="vote-bar-track">
              <div class="vote-bar-fill both" style="width: ${splitPct}%;"></div>
            </div>
            <div class="vote-voters-list">
              ${tally.splitVoters.length > 0
                ? tally.splitVoters.map(v => `<span class="vote-voter-pill">${getIcon('check')} ${v}</span>`).join('')
                : `<span class="vote-voters-empty">No votes for $15 + $15 Split yet</span>`}
            </div>
          </div>

          <button type="button" class="vote-cast-btn ${selectedVoteChoice === WEEK7_SPLIT_CHOICE ? 'selected' : ''}" onclick="castWeek7Vote('${selectedVoter}', '${WEEK7_SPLIT_CHOICE}')">
            <span class="bts-icon">${getIcon(selectedVoteChoice === WEEK7_SPLIT_CHOICE ? 'checkCircle' : 'fire')}</span>
            <span>${selectedVoter
              ? (selectedVoteChoice === WEEK7_SPLIT_CHOICE ? `${selectedVoter} Voted $15 + $15 Split` : `Vote $15 + $15 Split as ${selectedVoter}`)
              : 'Tap Name Above to Vote $15 + $15'}</span>
          </button>
        </div>

        <!-- OPTION 2: THURSDAY NOV 19 ($30 FULL POOL) -->
        <div class="nhl-card vote-day-card ${thuLeading ? 'leading' : ''} ${selectedVoteChoice === WEEK7_THU_DATE ? 'user-voted' : ''}">
          <div class="vote-day-top">
            <div>
              <div class="vote-day-kicker">Single Night • Full $30 Pool</div>
              <div class="vote-day-title">Thursday Only ($30)</div>
              <div class="vote-day-window">Thu, Nov 19 • 7:00–10:00 PM ET ($5/Guy)</div>
            </div>
            <span class="vote-games-count-pill">${thuGames.length} GAMES</span>
          </div>

          <div class="vote-marquee-strip">
            ${thuMarquee.map(([a, h]) => `
              <span class="vote-marquee-chip">
                <img src="${NHL_LOGO(a)}" alt="${a}" onerror="this.style.display='none'" />
                <span>${a} @ ${h}</span>
                <img src="${NHL_LOGO(h)}" alt="${h}" onerror="this.style.display='none'" />
              </span>
            `).join('')}
            <span class="vote-marquee-chip">+${Math.max(0, thuGames.length - thuMarquee.length)} more</span>
          </div>

          <div class="vote-tally-box">
            <div class="vote-tally-row">
              <span class="vote-tally-num">${tally.thuCount} Vote${tally.thuCount === 1 ? '' : 's'} ${thuLeading ? '• LEADING' : ''}</span>
              <span class="vote-tally-pct">${tally.thuCount} / 6 Squad</span>
            </div>
            <div class="vote-bar-track">
              <div class="vote-bar-fill thu" style="width: ${thuPct}%;"></div>
            </div>
            <div class="vote-voters-list">
              ${tally.thuVoters.length > 0
                ? tally.thuVoters.map(v => `<span class="vote-voter-pill">${getIcon('check')} ${v}</span>`).join('')
                : `<span class="vote-voters-empty">No votes for Thursday Only yet</span>`}
            </div>
          </div>

          <button type="button" class="vote-cast-btn ${selectedVoteChoice === WEEK7_THU_DATE ? 'selected' : ''}" onclick="castWeek7Vote('${selectedVoter}', '${WEEK7_THU_DATE}')">
            <span class="bts-icon">${getIcon(selectedVoteChoice === WEEK7_THU_DATE ? 'checkCircle' : 'bolt')}</span>
            <span>${selectedVoter
              ? (selectedVoteChoice === WEEK7_THU_DATE ? `${selectedVoter} Voted Thu ($30)` : `Vote Thu Only ($30) as ${selectedVoter}`)
              : 'Tap Name Above to Vote Thu ($30)'}</span>
          </button>
        </div>

        <!-- OPTION 3: SATURDAY NOV 21 ($30 FULL POOL) -->
        <div class="nhl-card vote-day-card ${satLeading ? 'leading' : ''} ${selectedVoteChoice === WEEK7_SAT_DATE ? 'user-voted' : ''}">
          <div class="vote-day-top">
            <div>
              <div class="vote-day-kicker">Single Night • Full $30 Pool</div>
              <div class="vote-day-title">Saturday Only ($30)</div>
              <div class="vote-day-window">Sat, Nov 21 • 1:00–10:00 PM ET ($5/Guy)</div>
            </div>
            <span class="vote-games-count-pill">${satGames.length} GAMES</span>
          </div>

          <div class="vote-marquee-strip">
            ${satMarquee.map(([a, h]) => `
              <span class="vote-marquee-chip">
                <img src="${NHL_LOGO(a)}" alt="${a}" onerror="this.style.display='none'" />
                <span>${a} @ ${h}</span>
                <img src="${NHL_LOGO(h)}" alt="${h}" onerror="this.style.display='none'" />
              </span>
            `).join('')}
            <span class="vote-marquee-chip">+${Math.max(0, satGames.length - satMarquee.length)} more</span>
          </div>

          <div class="vote-tally-box">
            <div class="vote-tally-row">
              <span class="vote-tally-num">${tally.satCount} Vote${tally.satCount === 1 ? '' : 's'} ${satLeading ? '• LEADING' : ''}</span>
              <span class="vote-tally-pct">${tally.satCount} / 6 Squad</span>
            </div>
            <div class="vote-bar-track">
              <div class="vote-bar-fill sat" style="width: ${satPct}%;"></div>
            </div>
            <div class="vote-voters-list">
              ${tally.satVoters.length > 0
                ? tally.satVoters.map(v => `<span class="vote-voter-pill">${getIcon('check')} ${v}</span>`).join('')
                : `<span class="vote-voters-empty">No votes for Saturday Only yet</span>`}
            </div>
          </div>

          <button type="button" class="vote-cast-btn ${selectedVoteChoice === WEEK7_SAT_DATE ? 'selected' : ''}" onclick="castWeek7Vote('${selectedVoter}', '${WEEK7_SAT_DATE}')">
            <span class="bts-icon">${getIcon(selectedVoteChoice === WEEK7_SAT_DATE ? 'checkCircle' : 'bolt')}</span>
            <span>${selectedVoter
              ? (selectedVoteChoice === WEEK7_SAT_DATE ? `${selectedVoter} Voted Sat ($30)` : `Vote Sat Only ($30) as ${selectedVoter}`)
              : 'Tap Name Above to Vote Sat ($30)'}</span>
          </button>
        </div>
      </div>

      <!-- SQUAD ROLL-CALL & COMMISSIONER CONTROLS -->
      <div class="nhl-card vote-rollcall-card">
        <div class="vote-rollcall-left">
          <span class="vote-rollcall-title">Squad Roll Call (${tally.totalVotes}/6):</span>
          ${SQUAD.map(boy => {
            const c = state.week7Vote.votes[boy.name]?.choice;
            const cls = c === WEEK7_SPLIT_CHOICE ? 'both' : (c === WEEK7_THU_DATE ? 'thu' : (c === WEEK7_SAT_DATE ? 'sat' : ''));
            const lbl = c === WEEK7_SPLIT_CHOICE ? '$15+$15 Split' : (c === WEEK7_THU_DATE ? 'THU ($30)' : (c === WEEK7_SAT_DATE ? 'SAT ($30)' : 'Pending'));
            return `<span class="vote-rollcall-pill ${cls}">${boy.name}: ${lbl}</span>`;
          }).join('')}
        </div>
        <div class="vote-rollcall-actions">
          <button type="button" class="nhl-action-btn secondary" onclick="jumpToWeekDate('2026-11-13')" title="Review settled Week 6 slip">
            <span>← Week 6 Results (4/5)</span>
          </button>
          <button type="button" class="nhl-action-btn secondary" onclick="copyWeek7VoteChirp()">
            <span class="bts-icon">${getIcon('chat')}</span>
            <span>Chirp Missing Voters</span>
          </button>
          <button type="button" class="nhl-action-btn primary" onclick="lockWeek7VoteNow()">
            <span class="bts-icon">${getIcon('lock')}</span>
            <span>Lock Vote Early</span>
          </button>
        </div>
      </div>

      <!-- FULL NHL SLATES FOR BOTH DAYS -->
      <div class="nhl-card vote-slates-panel" id="week7DualSlatesSection">
        <div class="vote-slates-header">
          <div>
            <h3 class="panel-heading">Full NHL Slates: Thursday vs. Saturday</h3>
            <p class="panel-sub-caption">Compare every scheduled matchup before Wednesday's 8:00 PM ET lock-in</p>
          </div>
          <div class="vote-filter-tabs">
            <button type="button" class="vote-filter-btn ${filter === 'both' ? 'active' : ''}" onclick="setWeek7SlateFilter('both')">Both Days (${thuGames.length + satGames.length})</button>
            <button type="button" class="vote-filter-btn ${filter === WEEK7_THU_DATE ? 'active' : ''}" onclick="setWeek7SlateFilter('${WEEK7_THU_DATE}')">Thu Nov 19 (${thuGames.length})</button>
            <button type="button" class="vote-filter-btn ${filter === WEEK7_SAT_DATE ? 'active' : ''}" onclick="setWeek7SlateFilter('${WEEK7_SAT_DATE}')">Sat Nov 21 (${satGames.length})</button>
          </div>
        </div>

        <div class="vote-slates-columns ${filter === 'both' ? '' : 'single-col'}">
          ${showThu ? renderSlateColumnHtml('Thursday, Nov 19, 2026', `${thuGames.length} NHL GAMES`, thuGames) : ''}
          ${showSat ? renderSlateColumnHtml('Saturday, Nov 21, 2026', `${satGames.length} NHL GAMES`, satGames) : ''}
        </div>
      </div>
    </div>
  `;
}

function buildDoubleheaderSwitcherHtml() {
  const thuLegsCount = peekSavedLegsCount(WEEK7_THU_DATE);
  const satLegsCount = peekSavedLegsCount(WEEK7_SAT_DATE);
  const onThu = state.currentFridayStr === WEEK7_THU_DATE;
  const onSat = state.currentFridayStr === WEEK7_SAT_DATE;
  return `
    <div class="split-day-switcher">
      <button type="button" class="split-day-btn ${onThu ? 'active' : ''}" onclick="jumpToWeekDate('${WEEK7_THU_DATE}')">
        <span>Part 1: Thu Nov 19 ($15 • ${thuLegsCount}/6)</span>
      </button>
      <button type="button" class="split-day-btn ${onSat ? 'active' : ''}" onclick="jumpToWeekDate('${WEEK7_SAT_DATE}')">
        <span>Part 2: Sat Nov 21 ($15 • ${satLegsCount}/6)</span>
      </button>
    </div>
  `;
}

function renderWeek7SettledBanner() {
  if (!DOM.week7VoteSettledBanner) return;
  if (!isWeek7DateStr(state.currentFridayStr) || isViewingWeek7Vote()) {
    DOM.week7VoteSettledBanner.style.display = 'none';
    DOM.week7VoteSettledBanner.innerHTML = '';
    return;
  }

  const tally = tallyWeek7Votes();
  const canReopen = new Date().getTime() < WEEK7_VOTE_LOCK_AT.getTime();
  DOM.week7VoteSettledBanner.style.display = 'flex';
  DOM.week7VoteSettledBanner.className = 'vote-settled-banner';

  if (isWeek7SplitMode()) {
    DOM.week7VoteSettledBanner.innerHTML = `
      <div class="vote-settled-text">
        <span class="vote-settled-pill">${getIcon('check')} $15 + $15 DOUBLEHEADER</span>
        <span>
          <strong>Two $15 6-Leg Parlays</strong> locked in! Flip between <strong>Thursday (12 Gm)</strong> & <strong>Saturday (14 Gm)</strong> anytime:
        </span>
      </div>
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        ${buildDoubleheaderSwitcherHtml()}
        ${canReopen ? `<button type="button" class="nhl-action-btn secondary" onclick="reopenWeek7Vote()">Reopen Vote</button>` : ''}
        <button type="button" class="nhl-action-btn secondary" onclick="switchWeek7ResolvedDay()" title="Cycle format">Change Format</button>
      </div>
    `;
    return;
  }

  const activeDayLabel = getDayLabelForDateStr(state.currentFridayStr);
  const gamesCount = state.games?.length || (state.currentFridayStr === WEEK7_THU_DATE ? 12 : 14);

  DOM.week7VoteSettledBanner.innerHTML = `
    <div class="vote-settled-text">
      <span class="vote-settled-pill">${getIcon('check')} WEEK 7 NIGHT LOCKED</span>
      <span>
        Squad set for <strong>${activeDayLabel}, ${formatWeekDateStr(state.currentFridayStr)}</strong> (${gamesCount} NHL games • Tally: ${tally.splitCount} Split, ${tally.thuCount} Thu, ${tally.satCount} Sat). <strong>Ben</strong> is on deck for the $30 6-leg slip!
      </span>
    </div>
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
      ${canReopen ? `<button type="button" class="nhl-action-btn secondary" onclick="reopenWeek7Vote()">Reopen Vote</button>` : ''}
      <button type="button" class="nhl-action-btn secondary" onclick="switchWeek7ResolvedDay()">Change Format</button>
    </div>
  `;
}

function renderWeek7TrackerSplitBar() {
  if (!DOM.week7TrackerSplitBar) return;
  if (!isWeek7SplitMode() || !isWeek7DateStr(state.currentFridayStr) || isViewingWeek7Vote()) {
    DOM.week7TrackerSplitBar.style.display = 'none';
    DOM.week7TrackerSplitBar.innerHTML = '';
    return;
  }
  DOM.week7TrackerSplitBar.style.display = 'flex';
  DOM.week7TrackerSplitBar.className = 'vote-settled-banner';
  DOM.week7TrackerSplitBar.innerHTML = `
    <div class="vote-settled-text">
      <span class="vote-settled-pill">${getIcon('bolt')} WEEK 7 DOUBLEHEADER</span>
      <span>Switch live tracker between <strong>Thursday ($15)</strong> & <strong>Saturday ($15)</strong>:</span>
    </div>
    ${buildDoubleheaderSwitcherHtml()}
  `;
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
      fetchWeek7VotesFromSupabase();
      fetchPayoutLogFromSupabase();
      if (!isViewingWeek7Vote()) {
        fetchSupabaseParlay(state.currentFridayStr);
      }
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
        if (master.stake) state.stake = parseFloat(master.stake) || state.stake;
        if (['placed', 'won', 'lost'].includes(String(master.status || '').toLowerCase())) {
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
      .channel('public:bts_realtime_v7')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parlay_legs' }, payload => {
        const row = payload.new || payload.old;
        if (!row) return;

        // Live sync for Week 7 Thursday / Saturday / $15+$15 Split votes!
        if (row.week_date === WEEK7_VOTE_DATE_KEY) {
          if (payload.eventType === 'DELETE') {
            delete state.week7Vote.votes[row.user_name];
          } else if (payload.new) {
            const choice = parseVoteRowChoice(payload.new);
            if (choice) {
              state.week7Vote.votes[row.user_name] = {
                choice,
                updatedAt: payload.new.updated_at || new Date().toISOString()
              };
            }
          }
          saveLocalWeek7Votes();
          playSound('lock');
          renderAll();
          if (payload.eventType !== 'DELETE' && payload.new) {
            const choice = parseVoteRowChoice(payload.new);
            const votedDay = choice === WEEK7_SPLIT_CHOICE
              ? '$15 Thu + $15 Sat Split'
              : (choice === WEEK7_THU_DATE ? 'Thursday ($30)' : 'Saturday ($30)');
            showToast(`${row.user_name} voted for ${votedDay}!`, 'bolt');
          }
          return;
        }

        if (row.week_date === state.currentFridayStr) {
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friday_parlays' }, payload => {
        const row = payload.new || payload.old;
        if (!row) return;
        if (row.id === PAYOUT_LOG_SUPABASE_ID && payload.new && payload.new.notes) {
          try {
            const parsed = JSON.parse(payload.new.notes);
            if (parsed && typeof parsed === 'object') {
              state.payoutLog = parsed;
              saveLocalPayoutLog();
              if (state.currentView === 'statsView') renderStatsView();
            }
          } catch (e) {}
          return;
        }
        if (row.id === WEEK7_FRIDAY_ANCHOR && payload.new) {
          const lockInfo = parseWeek7LockRow(payload.new);
          if (lockInfo?.unlocked) {
            state.week7Vote.lockedDate = null;
            saveLocalWeek7Votes();
            if (isWeek7DateStr(state.currentFridayStr) && new Date().getTime() < WEEK7_VOTE_LOCK_AT.getTime()) {
              state.currentFriday = parseLocalISODate(WEEK7_FRIDAY_ANCHOR);
              state.currentFridayStr = WEEK7_FRIDAY_ANCHOR;
              fetchWeek7DualSlates();
              renderAll();
            }
          } else if (lockInfo?.resolvedMode) {
            state.week7Vote.lockedDate = lockInfo.resolvedMode;
            saveLocalWeek7Votes();
            if (isWeek7DateStr(state.currentFridayStr)) {
              applyWeek7ResolvedTransition(lockInfo.resolvedMode, true);
            } else {
              renderAll();
            }
          }
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

    if ((state.currentFridayStr === '2026-10-02' || state.currentFridayStr === '2026-10-16') && boy.name === 'Edward') {
      const preJoinWeek = state.currentFridayStr === '2026-10-02' ? 1 : 2;
      const preJoinStake = state.currentFridayStr === '2026-10-02' ? 5 : 25;
      return `
        <div class="leg-card-nhl empty" style="opacity: 0.6; border-style: dashed;">
          <div class="leg-card-top">
            <div class="boy-info-group">
              <div class="boy-jersey" style="opacity: 0.4;">ED</div>
              <div>
                <div class="boy-title-line">
                  <span class="boy-name-text">Edward</span>
                  <span class="title-tag-pill debut">${getIcon('spark')} Joined Week 3</span>
                </div>
                <div class="boy-sub-role">
                  <span class="boy-stat-tag debut">N/A</span>
                  <span class="boy-stat-divider">•</span>
                  <span class="boy-blurb-text">Not in group for Week ${preJoinWeek} (5-guy $${preJoinStake} ticket)</span>
                </div>
              </div>
            </div>
            <span class="leg-status-tag" style="background:var(--nhl-subcard); color:var(--text-secondary); border:1px solid var(--border-subtle);">N/A (Joined W3)</span>
          </div>
        </div>
      `;
    }

    if (state.currentFridayStr === '2026-11-13' && boy.name === 'Alex' && !state.legs['Alex']) {
      return `
        <div class="leg-card-nhl empty" style="opacity: 0.65; border-style: dashed;">
          <div class="leg-card-top">
            <div class="boy-info-group">
              <div class="boy-jersey" style="opacity: 0.4;">AL</div>
              <div>
                <div class="boy-title-line">
                  <span class="boy-name-text">Alex</span>
                  <span class="title-tag-pill slump">${getIcon('frost')} Sat Out Week 6</span>
                </div>
                <div class="boy-sub-role">
                  <span class="boy-stat-tag miss">OUT</span>
                  <span class="boy-stat-divider">•</span>
                  <span class="boy-blurb-text">"Buckled in the sauna w/ Taylor Hall" • 5-guy $25 Betway slip</span>
                </div>
              </div>
            </div>
            <span class="leg-status-tag" style="background:var(--nhl-subcard); color:var(--text-secondary); border:1px solid var(--border-subtle);">SAT OUT (WK 6)</span>
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
  const isFiveLegWeek = state.currentFridayStr === '2026-10-02' || state.currentFridayStr === '2026-10-16' || state.currentFridayStr === '2026-11-13';
  const expectedLegs = isFiveLegWeek ? 5 : 6;
  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);
  const inSplitWeek7 = isWeek7SplitMode() && (state.currentFridayStr === WEEK7_THU_DATE || state.currentFridayStr === WEEK7_SAT_DATE);

  if (inSplitWeek7) {
    const partLabel = state.currentFridayStr === WEEK7_THU_DATE
      ? 'PART 1 OF 2 • THURSDAY $15 SLIP'
      : 'PART 2 OF 2 • SATURDAY $15 SLIP';
    DOM.weekPill.textContent = `WEEK ${weekNum} DOUBLEHEADER • ${partLabel}`;
  } else {
    DOM.weekPill.textContent = `WEEK ${weekNum} OF THE REGULAR SEASON${dayLabel !== 'Friday' ? ` • SPECIAL ${dayLabel.toUpperCase()} SLATE` : ''}`;
  }
  DOM.bettorName.textContent = bettor.name;
  DOM.bettorAvatar.textContent = bettor.initials;
  
  if (weekNum === 1) {
    DOM.bettorDesc.innerHTML = `Inaugural Friday Puck Parlay! <strong>${bettor.name}</strong> placed the original 5-guy Bet365 ticket ($${state.stake} total wager).`;
  } else if (weekNum === 2) {
    DOM.bettorDesc.innerHTML = `Week 1 was placed by Ben. For Week 2, <strong>${bettor.name}</strong> placed the 5-leg parlay ticket ($${state.stake} total wager).`;
  } else if (state.currentFridayStr === '2026-11-21') {
    DOM.bettorDesc.innerHTML = `Special <strong>Saturday NHL Edition</strong>! <strong>${bettor.name}</strong> locked in a <strong>$25 FanDuel SGP+ split</strong> ($20 @ +2105 → $441.06 + $5 w/ 50% Boost @ +3158 → $162.93 = <strong>$603.99 payout</strong> • +2316 effective).`;
  } else if (state.currentFridayStr === '2026-11-13') {
    DOM.bettorDesc.innerHTML = `<strong>${bettor.name}</strong> placed Week 6's <strong>5-leg $25.00 Betway BetBuilder+</strong> (@ +5525 → $1,406.25) — 4 of 5 hit (Will, Ben, Jackson & Axel cashed; Edward sold on Liam Ohgren 0G!).`;
  } else if (inSplitWeek7) {
    const partText = state.currentFridayStr === WEEK7_THU_DATE ? 'Part 1: Thursday' : 'Part 2: Saturday';
    DOM.bettorDesc.innerHTML = `Week 7 Doubleheader (<strong>${partText}</strong>)! Pool split in half (<strong>$15 Thu + $15 Sat</strong> = $30 total • $2.50/guy per slip) with <strong>${bettor.name}</strong> on deck for both ${expectedLegs}-leg parlays.`;
  } else if (dayLabel !== 'Friday') {
    DOM.bettorDesc.innerHTML = `Special <strong>${dayLabel} NHL Edition</strong> (0 games Fri Nov 20)! It's <strong>${bettor.name}</strong>'s turn in the 6-week rotation to place our ${expectedLegs}-leg $${state.stake} ticket.`;
  } else {
    DOM.bettorDesc.innerHTML = `It's <strong>${bettor.name}</strong>'s turn in the 6-week rotation to place this week's ${expectedLegs}-leg ticket ($${state.stake} total wager) on his sportsbook account.`;
  }

  const legsCount = Object.keys(state.legs).length;
  DOM.slipProgressText.textContent = `${legsCount} / ${expectedLegs} LEGS`;
  DOM.slipProgressBar.style.width = `${Math.min(100, (legsCount / expectedLegs) * 100)}%`;

  if (state.masterSlip && state.masterSlip.status === 'lost') {
    DOM.slipStatusMsg.innerHTML = `<span class="msg-icon">${getIcon('cross')}</span> Settled Loss • ${state.currentFridayStr === '2026-11-13' ? '4 of 5 legs hit — Edward sold on Liam Ohgren!' : `Placed by ${bettor.name} ($${state.stake} ticket)`}`;
    DOM.slipStatusMsg.style.color = 'var(--red-loss)';
  } else if (state.isPlaced && legsCount >= expectedLegs) {
    DOM.slipStatusMsg.innerHTML = `<span class="msg-icon">${getIcon('checkCircle')}</span> Locked in by ${bettor.name}! $${state.stake} ${expectedLegs}-leg ticket is live on the sportsbook!`;
    DOM.slipStatusMsg.style.color = 'var(--b365-green)';
  } else if (legsCount >= expectedLegs) {
    DOM.slipStatusMsg.innerHTML = `<span class="msg-icon">${getIcon('fire')}</span> All ${expectedLegs} legs locked in! ${bettor.name} is clear to submit the $${state.stake} ticket to the book!`;
    DOM.slipStatusMsg.style.color = 'var(--b365-green)';
  } else if (legsCount === 0) {
    DOM.slipStatusMsg.textContent = `No picks locked in yet for Week ${weekNum} (${dayLabel}). Let's build the $${state.stake} ticket!`;
    DOM.slipStatusMsg.style.color = 'var(--text-muted)';
  } else {
    DOM.slipStatusMsg.textContent = `Need ${expectedLegs - legsCount} more leg${expectedLegs - legsCount === 1 ? '' : 's'} to complete ${dayLabel}'s ${expectedLegs}-legger ($${state.stake} stake).`;
    DOM.slipStatusMsg.style.color = 'var(--gold-odds)';
  }

  updateCountdown();
}

function updateCountdown() {
  if (isViewingWeek7Vote()) {
    DOM.puckDropCountdown.innerHTML = `<span class="msg-icon">${getIcon('clock')}</span> ${formatVoteLockCountdown()} until Wed 8 PM Vote Lock`;
    return;
  }

  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);
  let target = null;
  if (state.games && state.games.length > 0) {
    const validTimes = state.games
      .map(g => g.startTimeUTC ? new Date(g.startTimeUTC).getTime() : NaN)
      .filter(t => !isNaN(t));
    if (validTimes.length > 0) {
      target = new Date(Math.min(...validTimes));
    }
  }
  if (!target) {
    target = new Date(state.currentFriday);
    target.setHours(state.currentFridayStr === '2026-11-13' ? 21 : (state.currentFridayStr === '2026-11-21' ? 13 : 19), 0, 0, 0);
  }
  const diff = target - new Date();

  if (diff <= 0) {
    DOM.puckDropCountdown.innerHTML = `<span class="msg-icon">${getIcon('puck')}</span> Puck Drop Live / Completed`;
  } else {
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const timeStr = days > 0 ? `${days}d ${hours}h ${mins}m` : (hours > 0 ? `${hours}h ${mins}m` : `${mins}m`);
    DOM.puckDropCountdown.innerHTML = `<span class="msg-icon">${getIcon('clock')}</span> ${timeStr} until ${dayLabel} puck drop`;
  }
}

function renderSportsbookTicket() {
  const legsList = SQUAD.map(b => state.legs[b.name]).filter(Boolean);
  const totals = calculateParlayTotals(legsList, state.stake);

  const hasValidMasterOdds = state.masterSlip && state.masterSlip.total_odds && state.masterSlip.total_odds !== '--';
  const displayOdds = hasValidMasterOdds
    ? state.masterSlip.total_odds
    : (state.currentFridayStr === '2026-11-21' ? '+2316' : (state.currentFridayStr === '2026-11-13' ? '+5525' : (state.currentFridayStr === '2026-11-06' ? '+1414' : (state.currentFridayStr === '2026-10-30' ? '+2394' : totals.american))));
  const displayPayout = (state.masterSlip && state.masterSlip.potential_payout)
    ? parseFloat(state.masterSlip.potential_payout)
    : (state.currentFridayStr === '2026-11-21' ? 603.99 : (state.currentFridayStr === '2026-11-13' ? 1406.25 : (state.currentFridayStr === '2026-11-06' ? 454.41 : (state.currentFridayStr === '2026-10-30' ? 748.20 : totals.payout))));
  const displayProfit = displayPayout - state.stake;
  const displayDecimal = displayPayout / (state.stake || 1);

  if (DOM.stakeInput && document.activeElement !== DOM.stakeInput) {
    DOM.stakeInput.value = state.stake;
  }
  const barcodeTextEl = document.querySelector('.barcode-text');
  if (barcodeTextEl) {
    barcodeTextEl.textContent = `* BET THE SHOW POOL • WEEK ${state.weekNumber} • $${state.stake} TOTAL *`;
  }

  DOM.totalAmericanOdds.textContent = displayOdds;
  DOM.totalDecimalOdds.textContent = `${displayDecimal.toFixed(2)}x`;
  DOM.potentialPayoutDisplay.textContent = `$${displayPayout.toFixed(2)}`;
  DOM.potentialProfitDisplay.textContent = `+$${displayProfit.toFixed(2)} net profit`;
  DOM.ticketDateText.textContent = formatDateDisplay(state.currentFriday);
  DOM.ticketReferenceCode.textContent = `SLIP #BTS-${state.currentFridayStr.replace(/-/g, '')}-W${state.weekNumber}`;

  const expectedTicketLegs = (state.currentFridayStr === '2026-10-02' || state.currentFridayStr === '2026-10-16' || state.currentFridayStr === '2026-11-13') ? 5 : 6;
  if (state.masterSlip && state.masterSlip.status === 'won') {
    DOM.ticketStatusBadge.textContent = `TICKET CASHED (${expectedTicketLegs}/${expectedTicketLegs})`;
    DOM.ticketStatusBadge.className = 'ticket-badge ready';
  } else if (state.masterSlip && state.masterSlip.status === 'lost') {
    DOM.ticketStatusBadge.textContent = state.currentFridayStr === '2026-11-13' ? `SETTLED • 4/5 HIT` : `SETTLED • LOST`;
    DOM.ticketStatusBadge.className = 'ticket-badge';
  } else if (state.isPlaced && totals.count >= expectedTicketLegs) {
    DOM.ticketStatusBadge.textContent = `BET PLACED (${expectedTicketLegs}/${expectedTicketLegs})`;
    DOM.ticketStatusBadge.className = 'ticket-badge ready';
  } else if (totals.count >= expectedTicketLegs) {
    DOM.ticketStatusBadge.textContent = `SLIP READY (${expectedTicketLegs}/${expectedTicketLegs})`;
    DOM.ticketStatusBadge.className = 'ticket-badge ready';
  } else {
    DOM.ticketStatusBadge.textContent = `${totals.count}/${expectedTicketLegs} LEGS`;
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
    } else if ((state.currentFridayStr === '2026-10-02' || state.currentFridayStr === '2026-10-16') && boy.name === 'Edward') {
      return `
        <div class="ticket-leg-row" style="opacity: 0.4;">
          <span class="t-boy-name">${boy.name}</span>
          <span class="t-pick-desc">Joined Week 3 (5-leg slip)</span>
          <span class="t-odds">N/A</span>
        </div>
      `;
    } else if (state.currentFridayStr === '2026-11-13' && boy.name === 'Alex') {
      return `
        <div class="ticket-leg-row" style="opacity: 0.45;">
          <span class="t-boy-name">${boy.name}</span>
          <span class="t-pick-desc">Sat out Week 6 (5-leg $25 slip)</span>
          <span class="t-odds">OUT</span>
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
  let cursor = toCanonicalFridayDate(state.currentFriday);
  cursor.setDate(cursor.getDate() - 7);
  if (formatDateISO(cursor) === '2026-10-09') {
    cursor.setDate(cursor.getDate() - 7);
  }

  while (weeks.length < 6) {
    const d = new Date(cursor);
    if (formatDateISO(d) !== '2026-10-09') {
      weeks.push(d);
    }
    cursor.setDate(cursor.getDate() + 7);
  }

  const currentCanonicalISO = formatDateISO(toCanonicalFridayDate(state.currentFriday));

  DOM.rotationList.innerHTML = weeks.map(fri => {
    const bettor = getBettorForFriday(fri);
    const canonicalISO = formatDateISO(fri);
    let dateFormatted = fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (canonicalISO === WEEK7_FRIDAY_ANCHOR) {
      if (!isWeek7VoteLocked()) {
        dateFormatted = 'Thu / Sat / $15×2 (Vote)';
      } else if (isWeek7SplitMode()) {
        dateFormatted = 'Thu 19 + Sat 21 ($15×2)';
      } else {
        const resDate = parseLocalISODate(getResolvedWeek7DateStr());
        dateFormatted = resDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      }
    }
    const isCurrent = canonicalISO === currentCanonicalISO;
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
  const votingWeek7 = isViewingWeek7Vote();
  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);

  if (votingWeek7) {
    DOM.weekPill.textContent = 'WEEK 7 OF THE REGULAR SEASON • SCHEDULE VOTE';
    DOM.currentFridayDisplay.textContent = 'Week 7 Vote: $15+$15 Split vs. Thu vs. Sat';
    if (DOM.tabSlipLabel) DOM.tabSlipLabel.textContent = 'Slip ($30)';
    if (DOM.week7VoteArena) DOM.week7VoteArena.style.display = 'block';
    if (DOM.week7VoteSettledBanner) DOM.week7VoteSettledBanner.style.display = 'none';
    if (DOM.week7TrackerSplitBar) DOM.week7TrackerSplitBar.style.display = 'none';
    if (DOM.slipBettorBanner) DOM.slipBettorBanner.style.display = 'none';
    if (DOM.slipWorkspace) DOM.slipWorkspace.style.display = 'none';
    if (DOM.slipMatchupsPanel) DOM.slipMatchupsPanel.style.display = 'none';

    state.weekNumber = 7;
    renderDualVoteTicker();
    renderWeek7VoteArena();
    updateCountdown();
    renderStatsView();
    renderTracker();
    return;
  }

  const inSplitWeek7 = isWeek7SplitMode() && (state.currentFridayStr === WEEK7_THU_DATE || state.currentFridayStr === WEEK7_SAT_DATE);
  if (inSplitWeek7) {
    const partIdx = state.currentFridayStr === WEEK7_THU_DATE ? '1/2' : '2/2';
    DOM.currentFridayDisplay.textContent = `${formatDateDisplay(state.currentFriday)} ($${state.stake} • ${partIdx})`;
    if (DOM.tabSlipLabel) DOM.tabSlipLabel.textContent = `Slip ($${state.stake} • ${partIdx})`;
  } else {
    DOM.currentFridayDisplay.textContent = formatDateDisplay(state.currentFriday);
    if (DOM.tabSlipLabel) DOM.tabSlipLabel.textContent = `Slip ($${state.stake})`;
  }
  if (DOM.ribbonDayLabel) DOM.ribbonDayLabel.textContent = `${dayLabel.toUpperCase()} NHL`;
  if (DOM.lineupColCaption) DOM.lineupColCaption.textContent = `Every guy locks in one ${dayLabel} NHL pick`;
  if (DOM.legModalDayTag) DOM.legModalDayTag.textContent = `1 LEG PER GUY • ${dayLabel.toUpperCase()} NHL`;

  if (DOM.week7VoteArena) DOM.week7VoteArena.style.display = 'none';
  if (DOM.slipBettorBanner) DOM.slipBettorBanner.style.display = '';
  if (DOM.slipWorkspace) DOM.slipWorkspace.style.display = '';
  if (DOM.slipMatchupsPanel) DOM.slipMatchupsPanel.style.display = '';

  renderWeek7SettledBanner();
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
  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);
  if (existing) {
    DOM.modalTitle.textContent = `Edit ${boyName}'s ${dayLabel} Leg`;
    DOM.pickTextInput.value = existing.pick_text || '';
    DOM.oddsInput.value = existing.odds || '';
    DOM.chirpInput.value = existing.chirp || '';
    DOM.betTypeInput.value = existing.bet_type || 'Player Prop';
    if (existing.game_title) DOM.gameSelect.value = existing.game_title;
  } else {
    DOM.modalTitle.textContent = `Lock In ${boyName}'s ${dayLabel} Leg`;
    DOM.pickTextInput.value = '';
    DOM.oddsInput.value = '';
    DOM.chirpInput.value = '';
    DOM.betTypeInput.value = 'Player Prop';
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
  const expectedLegs = (state.currentFridayStr === '2026-10-02' || state.currentFridayStr === '2026-10-16' || state.currentFridayStr === '2026-11-13') ? 5 : 6;
  const finalOdds = (state.masterSlip && state.masterSlip.total_odds) ? state.masterSlip.total_odds : totals.american;
  const finalPayout = (state.masterSlip && state.masterSlip.potential_payout) ? parseFloat(state.masterSlip.potential_payout) : totals.payout;
  const finalDecimal = finalPayout > 0 ? (finalPayout / (state.stake || 1)) : totals.decimal;
  const finalProfit = finalPayout > 0 ? (finalPayout - state.stake) : totals.profit;

  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);
  const perGuyVal = state.stake / expectedLegs;
  const perGuyStr = Number.isInteger(perGuyVal) ? `$${perGuyVal}` : `$${perGuyVal.toFixed(2)}`;
  const inSplitWeek7 = isWeek7SplitMode() && (state.currentFridayStr === WEEK7_THU_DATE || state.currentFridayStr === WEEK7_SAT_DATE);
  const splitTag = inSplitWeek7 ? (state.currentFridayStr === WEEK7_THU_DATE ? ' • DOUBLEHEADER PART 1/2' : ' • DOUBLEHEADER PART 2/2') : '';
  let text = `[BET THE SHOW] ${dayLabel.toUpperCase()} NHL ${expectedLegs}-LEGGER (${dateFormatted})${splitTag}\n`;
  text += `Bettor On Deck: ${bettor.name} ($${state.stake} Pool Stake • ${perGuyStr}/Guy)\n`;
  text += `${totals.count}/${expectedLegs} Legs Locked In:\n\n`;

  let legIdx = 1;
  SQUAD.forEach((boy) => {
    const leg = state.legs[boy.name];
    if (leg && leg.odds) {
      text += `${legIdx++}. ${boy.name}: ${leg.pick_text} (${leg.odds})\n`;
      if (leg.chirp) text += `   • "${leg.chirp}"\n`;
    } else if (state.currentFridayStr === '2026-11-13' && boy.name === 'Alex') {
      text += `— ${boy.name}: [SAT OUT WEEK 6]\n`;
    } else if (!((state.currentFridayStr === '2026-10-02' || state.currentFridayStr === '2026-10-16') && boy.name === 'Edward')) {
      text += `${legIdx++}. ${boy.name}: [WAITING ON PICK]\n`;
    }
  });

  text += `\n-------------------------------\n`;
  text += `Total Combined Odds: ${finalOdds} (${finalDecimal.toFixed(2)}x)\n`;
  text += `Potential Payout: $${finalPayout.toFixed(2)} (+$${finalProfit.toFixed(2)} profit)\n`;
  text += `Live Slip: https://mukpostproduction-debug.github.io/friday-puck-parlay/\n`;

  navigator.clipboard.writeText(text).then(() => {
    playSound('triumph');
    if (window.confetti) confetti({ particleCount: 80, spread: 60, origin: { y: 0.85 } });
    showToast(`${expectedLegs}-Leg Slip copied! Ready to paste into sportsbook or chat`, 'slip');
  });
}

// CHIRP THE GUYS
function generateGroupChirp() {
  if (isViewingWeek7Vote()) {
    copyWeek7VoteChirp();
    return;
  }
  const bettor = getBettorForFriday(state.currentFriday);
  const missing = SQUAD.filter(b => !state.legs[b.name]);
  const dayLabel = getDayLabelForDateStr(state.currentFridayStr);
  const inSplitWeek7 = isWeek7SplitMode() && (state.currentFridayStr === WEEK7_THU_DATE || state.currentFridayStr === WEEK7_SAT_DATE);
  const splitSuffix = inSplitWeek7 ? (state.currentFridayStr === WEEK7_THU_DATE ? ' (Doubleheader Part 1/2)' : ' (Doubleheader Part 2/2)') : '';

  let msg = '';
  if (missing.length === 0) {
    msg = `[BET THE SHOW] ALL 6 LEGS ARE LOCKED IN! @${bettor.name} is on deck to place ${dayLabel}'s $${state.stake} ticket${splitSuffix} on his sportsbook right now! Let's get that bag guys.`;
  } else {
    const names = missing.map(b => `@${b.name}`).join(', ');
    const insults = [
      `Lock in your ${dayLabel} leg ($${state.stake} slip)${splitSuffix} before puck drop!`,
      `Stop sleeping and get your ${dayLabel} picks in. Don't sell our $${state.stake} parlay!`,
      `We need the final legs before ${dayLabel} puck drop${splitSuffix}. Lock it down!`
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
  if (low.includes('betway')) result.book = 'Betway';
  else if (low.includes('bet99')) result.book = 'BET99';
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
              week_date: state.currentFridayStr,
              user_name: scanned.boyName,
              game_title: updatedLeg.game_title,
              bet_type: updatedLeg.bet_type,
              pick_text: updatedLeg.pick_text,
              odds: updatedLeg.odds,
              chirp: updatedLeg.chirp,
              locked: true,
              updated_at: new Date().toISOString()
            }, { onConflict: 'week_date,user_name' });
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

  // Week navigation (skipping non-parlay Friday 2026-10-09 & stepping cleanly through Week 7 Doubleheader if split won)
  DOM.prevWeekBtn.addEventListener('click', () => {
    if (isWeek7SplitMode() && state.currentFridayStr === WEEK7_SAT_DATE) {
      window.jumpToWeekDate(WEEK7_THU_DATE);
      return;
    }
    if (isWeek7SplitMode() && state.currentFridayStr === '2026-11-27') {
      window.jumpToWeekDate(WEEK7_SAT_DATE);
      return;
    }
    const canonical = toCanonicalFridayDate(state.currentFriday);
    canonical.setDate(canonical.getDate() - 7);
    if (formatDateISO(canonical) === '2026-10-09') {
      canonical.setDate(canonical.getDate() - 7);
    }
    state.currentFriday = resolvePoolWeekDate(canonical);
    state.currentFridayStr = formatDateISO(state.currentFriday);
    loadLocalData(state.currentFridayStr);
    initTrackerData();
    if (isViewingWeek7Vote()) {
      fetchWeek7DualSlates();
    } else {
      fetchFridayNhlGames(state.currentFridayStr);
      if (state.supabase) fetchSupabaseParlay(state.currentFridayStr);
    }
    renderAll();
    renderTracker();
    playSound('click');
  });

  DOM.nextWeekBtn.addEventListener('click', () => {
    if (isWeek7SplitMode() && state.currentFridayStr === WEEK7_THU_DATE) {
      window.jumpToWeekDate(WEEK7_SAT_DATE);
      return;
    }
    if (isWeek7SplitMode() && state.currentFridayStr === '2026-11-13') {
      window.jumpToWeekDate(WEEK7_THU_DATE);
      return;
    }
    const canonical = toCanonicalFridayDate(state.currentFriday);
    canonical.setDate(canonical.getDate() + 7);
    if (formatDateISO(canonical) === '2026-10-09') {
      canonical.setDate(canonical.getDate() + 7);
    }
    state.currentFriday = resolvePoolWeekDate(canonical);
    state.currentFridayStr = formatDateISO(state.currentFriday);
    loadLocalData(state.currentFridayStr);
    initTrackerData();
    if (isViewingWeek7Vote()) {
      fetchWeek7DualSlates();
    } else {
      fetchFridayNhlGames(state.currentFridayStr);
      if (state.supabase) fetchSupabaseParlay(state.currentFridayStr);
    }
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
      if (DOM.tabSlipLabel && !isViewingWeek7Vote()) {
        const inSplit = isWeek7SplitMode() && (state.currentFridayStr === WEEK7_THU_DATE || state.currentFridayStr === WEEK7_SAT_DATE);
        DOM.tabSlipLabel.textContent = inSplit
          ? `Slip ($${state.stake} • ${state.currentFridayStr === WEEK7_THU_DATE ? '1/2' : '2/2'})`
          : `Slip ($${state.stake})`;
      }
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
    const dayLabel = getDayLabelForDateStr(state.currentFridayStr);
    const gameTitle = DOM.gameSelect.value || `${dayLabel} NHL Game`;
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
  initWeek7VoteState();

  // Automatically rollover to the active pool week (Week 7 Vote until Wed Nov 18 @ 8 PM ET, then winning Thu/Sat):
  state.currentFriday = getActiveFridayDate();
  state.currentFridayStr = formatDateISO(state.currentFriday);

  loadLocalData(state.currentFridayStr);
  initTrackerData();
  initStatsHistory();
  initPayoutLog();
  setupEvents();
  renderAll();
  initSupabase();
  if (isViewingWeek7Vote()) {
    fetchWeek7DualSlates();
  } else {
    fetchFridayNhlGames(state.currentFridayStr);
  }
  toggleAutoPoll();

  // If already placed (and not in voting mode), show Live Tracker by default (unless explicit URL hash was provided)
  setTimeout(() => {
    if (state.isPlaced && !isViewingWeek7Vote() && !window.location.hash) {
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
    } else if (hash === '#slip' || hash === '#vote') {
      switchView('slipBuilderView', false);
    }
  }
  window.addEventListener('hashchange', handleHash);
  if (window.location.hash) {
    handleHash();
  }

  setInterval(updateCountdown, 30000);
  setInterval(checkWeek7AutoLockTransition, 1000);
});
