/**
 * BET THE SHOW - Official Core Application Logic
 * 5 Boys. 5 Legs. Every Friday NHL.
 */

// SQUAD CONFIGURATION & ROTATION ORDER
// Week 1 was Friday, October 9, 2026 (Will placed the bet)
// Week 2 is Friday, October 16, 2026 (Jackson - On Deck this week)
// Will bets at the end of the 5-week cycle
const SQUAD = [
  { id: 'will', name: 'Will', initials: 'WI', role: 'Week 1 Bettor' },
  { id: 'jackson', name: 'Jackson', initials: 'JA', role: 'Week 2 Bettor (On Deck)' },
  { id: 'alex', name: 'Alex', initials: 'AL', role: 'Week 3 Bettor' },
  { id: 'axel', name: 'Axel', initials: 'AX', role: 'Week 4 Bettor' },
  { id: 'ben', name: 'Ben', initials: 'BE', role: 'Week 5 Bettor' }
];

// REFERENCE START DATE FOR ROTATION
// Week 1 was Friday, October 9, 2026 (Will placed the bet)
// Week 2 is Friday, October 16, 2026 (Jackson)
const ROTATION_START_FRIDAY = new Date('2026-10-09T12:00:00Z');

// PRE-CONFIGURED SUPABASE CREDENTIALS (Jackson's live Supabase instance)
const DEFAULT_SUPABASE_CONFIG = {
  url: 'https://lumncqjfpdxaygbvtagi.supabase.co',
  key: 'sb_publishable_gBk1KIAlEaspZL6Im2p0lA_g1rSdRQ-'
};

// APPLICATION STATE
const state = {
  currentFriday: null,        // Date object (defaults to Oct 16, 2026)
  currentFridayStr: '',       // 'YYYY-MM-DD'
  weekNumber: 2,              // Week 2
  legs: {},                   // Map of boyName -> leg object (blank by default for Week 2)
  games: [],                  // Friday's NHL matchups
  stake: 25,                  // Default $25 pool stake
  isPlaced: false,
  supabase: null,
  isLiveSync: false
};

// AUDIO SYNTHESIZER (Pure Web Audio API)
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

// DATE & ROTATION ENGINE
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

// DOM ELEMENTS
const DOM = {
  installAppBtn: document.getElementById('installAppBtn'),
  syncStatusBtn: document.getElementById('syncStatusBtn'),
  syncStatusText: document.getElementById('syncStatusText'),
  tickerGamesCount: document.getElementById('tickerGamesCount'),
  gamesTicker: document.getElementById('gamesTicker'),
  prevWeekBtn: document.getElementById('prevWeekBtn'),
  nextWeekBtn: document.getElementById('nextWeekBtn'),
  weekPill: document.getElementById('weekPill'),
  currentFridayDisplay: document.getElementById('currentFridayDisplay'),
  puckDropCountdown: document.getElementById('puckDropCountdown'),
  bettorName: document.getElementById('bettorName'),
  bettorAvatar: document.getElementById('bettorAvatar'),
  bettorDesc: document.getElementById('bettorDesc'),
  slipProgressText: document.getElementById('slipProgressText'),
  slipProgressBar: document.getElementById('slipProgressBar'),
  slipStatusMsg: document.getElementById('slipStatusMsg'),
  quickChirpBtn: document.getElementById('quickChirpBtn'),
  copySportsbookSlipBtn: document.getElementById('copySportsbookSlipBtn'),
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
  toastContainer: document.getElementById('toastContainer')
};

// TOAST NOTIFICATIONS
function showToast(message, icon = '🏒') {
  const toast = document.createElement('div');
  toast.className = 'nhl-toast';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

// FETCH FRIDAY NHL GAMES (OFFICIAL NHL API)
async function fetchFridayNhlGames(dateStr) {
  DOM.gamesTicker.innerHTML = `<div class="ticker-loading">Loading NHL matchups...</div>`;
  DOM.matchupsList.innerHTML = `<div class="loading-state">Loading Friday games from NHL.com...</div>`;

  let gamesList = [];
  const directUrl = `https://api-web.nhle.com/v1/schedule/${dateStr}`;
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`;

  try {
    const res = await fetch(proxyUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Proxy status ' + res.status);
    const data = await res.json();
    gamesList = parseNhlScheduleData(data, dateStr);
  } catch (err) {
    try {
      const res = await fetch(directUrl);
      const data = await res.json();
      gamesList = parseNhlScheduleData(data, dateStr);
    } catch (e) {
      gamesList = getFallbackGames(dateStr);
    }
  }

  state.games = gamesList;
  DOM.tickerGamesCount.textContent = `${gamesList.length} GAME${gamesList.length === 1 ? '' : 'S'}`;
  renderGamesTicker(gamesList);
  renderMatchupsPanel(gamesList);
  populateGameSelect(gamesList);
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

function renderGamesTicker(games) {
  if (!games || games.length === 0) {
    DOM.gamesTicker.innerHTML = `<div class="ticker-loading">No scheduled Friday games found.</div>`;
    return;
  }

  DOM.gamesTicker.innerHTML = games.map(g => {
    const timeStr = formatGameTime(g.startTimeUTC);
    return `
      <div class="ticker-game-chip" data-game="${g.away.abbrev} @ ${g.home.abbrev}">
        <div class="ticker-teams">
          <div class="ticker-team-line">
            <img src="${g.away.logo}" class="ticker-team-logo" alt="${g.away.abbrev}" onerror="this.style.display='none'" />
            <span class="ticker-team-abbrev">${g.away.abbrev}</span>
          </div>
          <div class="ticker-team-line">
            <img src="${g.home.logo}" class="ticker-team-logo" alt="${g.home.abbrev}" onerror="this.style.display='none'" />
            <span class="ticker-team-abbrev">${g.home.abbrev}</span>
          </div>
        </div>
        <div class="ticker-status">
          <div class="ticker-time">${timeStr}</div>
          <div class="ticker-state">LIVE / SET</div>
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
          <div class="matchup-time-box">${timeStr}</div>
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
  customOpt.textContent = '✏️ Custom / Other NHL Game';
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

// STORAGE & SUPABASE SYNC ENGINE
function loadLocalData(dateStr) {
  const key = `bet_the_show_${dateStr}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.legs = parsed.legs || {};
      state.stake = parsed.stake || 25;
      state.isPlaced = !!parsed.isPlaced;
      return;
    } catch (e) {}
  }

  // Blank by default for Week 2 (No picks locked in yet!)
  state.legs = {};
  state.stake = 25;
  state.isPlaced = false;
  saveLocalData(dateStr);
}

function saveLocalData(dateStr) {
  const key = `bet_the_show_${dateStr}`;
  const payload = {
    date: dateStr,
    legs: state.legs,
    stake: state.stake,
    isPlaced: state.isPlaced,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

// SUPABASE AUTO-CONNECT TO JACKSON'S DATABASE
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

    if (legs && Array.isArray(legs)) {
      const map = {};
      legs.forEach(l => { map[l.user_name] = l; });
      state.legs = map;
      saveLocalData(dateStr);
      renderAll();
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
          showToast(`${row.user_name} locked in their pick live!`, '🔥');
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
  showToast(`Removed ${userName}'s pick`, '🗑️');
}

// RENDER ALL COMPONENTS
function renderSquadLegs() {
  const bettorThisWeek = getBettorForFriday(state.currentFriday);

  DOM.legsCardsContainer.innerHTML = SQUAD.map(boy => {
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
                <div style="display: flex; align-items: center;">
                  <span class="boy-name-text">${boy.name}</span>
                  ${isBettor ? '<span class="bettor-tag-inline">👑 BETTOR ON DECK</span>' : ''}
                </div>
                <div class="boy-sub-role">${leg.bet_type || 'NHL Pick'}</div>
              </div>
            </div>

            <span class="leg-status-tag locked">✓ LOCKED IN</span>
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
              <span>💬</span>
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
                <div style="display: flex; align-items: center;">
                  <span class="boy-name-text">${boy.name}</span>
                  ${isBettor ? '<span class="bettor-tag-inline">👑 BETTOR ON DECK</span>' : ''}
                </div>
                <div class="boy-sub-role">Waiting on ${boy.name}'s leg</div>
              </div>
            </div>

            <span class="leg-status-tag waiting">⏳ PENDING</span>
          </div>

          <div class="empty-action-row">
            <span class="empty-state-text">No pick locked in yet for Week 2.</span>
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
    DOM.bettorDesc.innerHTML = `Week 1 was placed by Alex. This week it's <strong>${bettor.name}</strong>'s turn to place the 5-leg parlay ticket on his sportsbook account.`;
  } else {
    DOM.bettorDesc.innerHTML = `It's <strong>${bettor.name}</strong>'s turn in the 5-week rotation to place this week's 5-leg ticket on his sportsbook account.`;
  }

  const legsCount = Object.keys(state.legs).length;
  DOM.slipProgressText.textContent = `${legsCount} / 5 LEGS`;
  DOM.slipProgressBar.style.width = `${(legsCount / 5) * 100}%`;

  if (legsCount === 5) {
    DOM.slipStatusMsg.textContent = `🔥 All 5 legs locked in! ${bettor.name} is clear to submit the ticket to the book!`;
    DOM.slipStatusMsg.style.color = 'var(--green-win)';
  } else if (legsCount === 0) {
    DOM.slipStatusMsg.textContent = `No picks locked in yet for Week 2. Let's build the ticket!`;
    DOM.slipStatusMsg.style.color = 'var(--text-muted)';
  } else {
    DOM.slipStatusMsg.textContent = `Need ${5 - legsCount} more leg${5 - legsCount === 1 ? '' : 's'} to complete the 5-legger.`;
    DOM.slipStatusMsg.style.color = 'var(--gold-odds)';
  }

  updateCountdown();
}

function updateCountdown() {
  const target = new Date(state.currentFriday);
  target.setHours(19, 0, 0, 0); // 7:00 PM ET
  const diff = target - new Date();

  if (diff <= 0) {
    DOM.puckDropCountdown.textContent = '🏒 Puck Drop Live / Completed';
  } else {
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    DOM.puckDropCountdown.textContent = `⏳ ${days}d ${hours}h ${mins}m until Friday puck drop`;
  }
}

function renderSportsbookTicket() {
  const legsList = SQUAD.map(b => state.legs[b.name]).filter(Boolean);
  const totals = calculateParlayTotals(legsList, state.stake);

  DOM.totalAmericanOdds.textContent = totals.american;
  DOM.totalDecimalOdds.textContent = `${totals.decimal.toFixed(2)}x`;
  DOM.potentialPayoutDisplay.textContent = `$${totals.payout.toFixed(2)}`;
  DOM.potentialProfitDisplay.textContent = `+$${totals.profit.toFixed(2)} net profit`;
  DOM.ticketDateText.textContent = formatDateDisplay(state.currentFriday);
  DOM.ticketReferenceCode.textContent = `SLIP #BTS-${state.currentFridayStr.replace(/-/g, '')}-W${state.weekNumber}`;

  if (totals.count === 5) {
    DOM.ticketStatusBadge.textContent = 'SLIP READY (5/5)';
    DOM.ticketStatusBadge.className = 'ticket-badge ready';
  } else {
    DOM.ticketStatusBadge.textContent = `${totals.count}/5 LEGS`;
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
    DOM.markPlacedBtn.classList.add('primary');
    DOM.markPlacedText.textContent = `✓ Bet Placed on Sportsbook`;
  } else {
    const bettor = getBettorForFriday(state.currentFriday);
    DOM.markPlacedBtn.classList.add('outline');
    DOM.markPlacedBtn.classList.remove('primary');
    DOM.markPlacedText.textContent = `Mark as Placed by ${bettor.name}`;
  }
}

function renderRotationSchedule() {
  const weeks = [];
  const base = new Date(state.currentFriday);

  for (let i = -1; i <= 3; i++) {
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
          ${isCurrent ? '<span style="color: var(--gold-odds); font-weight: 800;">👑 ON DECK</span>' : ''}
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
}

// INTERACTIVE MODALS
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

  let text = `🏒 BET THE SHOW: FRIDAY NHL 5-LEGGER (${dateFormatted})\n`;
  text += `👤 Bettor On Deck: ${bettor.name} ($${state.stake} Pool Stake)\n`;
  text += `🔥 ${totals.count}/5 Legs Locked In:\n\n`;

  SQUAD.forEach((boy, idx) => {
    const leg = state.legs[boy.name];
    if (leg && leg.odds) {
      text += `${idx + 1}. ${boy.name}: ${leg.pick_text} (${leg.odds})\n`;
      if (leg.chirp) text += `   💬 "${leg.chirp}"\n`;
    } else {
      text += `${idx + 1}. ${boy.name}: [WAITING ON PICK]\n`;
    }
  });

  text += `\n-------------------------------\n`;
  text += `💰 Total Odds: ${totals.american} (${totals.decimal.toFixed(2)}x)\n`;
  text += `💵 Potential Payout: $${totals.payout.toFixed(2)} (+$${totals.profit.toFixed(2)} profit)\n`;
  text += `📱 View Live Slip: https://mukpostproduction-debug.github.io/friday-puck-parlay/\n`;

  navigator.clipboard.writeText(text).then(() => {
    playSound('triumph');
    if (window.confetti) confetti({ particleCount: 80, spread: 60, origin: { y: 0.85 } });
    showToast('Slip copied! Ready to paste into sportsbook or chat', '📋');
  });
}

// CHIRP THE BOYS
function generateGroupChirp() {
  const bettor = getBettorForFriday(state.currentFriday);
  const missing = SQUAD.filter(b => !state.legs[b.name]);

  let msg = '';
  if (missing.length === 0) {
    msg = `🚨 ALL 5 LEGS ARE LOCKED IN FOR THE SHOW! 👑 @${bettor.name} is on deck to place the ticket on his sportsbook right now! Let's get that bag boys 🏒💰`;
  } else {
    const names = missing.map(b => `@${b.name}`).join(', ');
    const insults = [
      `Lock in your Friday leg before puck drop! 🏒⏰`,
      `Stop sleeping and get your picks in. Don't sell our parlay! 🎯`,
      `We need the final legs before Friday puck drop. Lock it down! 💥`
    ];
    const pickInsult = insults[Math.floor(Math.random() * insults.length)];
    msg = `🏒 BET THE SHOW ALERT: ${names} — ${pickInsult} (Bettor this week: ${bettor.name})`;
  }

  navigator.clipboard.writeText(msg).then(() => {
    playSound('click');
    showToast('Chirp message copied! Paste in group chat 📱', '💬');
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

// EVENT HANDLERS
function setupEvents() {
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
    fetchFridayNhlGames(state.currentFridayStr);
    if (state.supabase) fetchSupabaseParlay(state.currentFridayStr);
    renderAll();
    playSound('click');
  });

  DOM.nextWeekBtn.addEventListener('click', () => {
    state.currentFriday.setDate(state.currentFriday.getDate() + 7);
    state.currentFridayStr = formatDateISO(state.currentFriday);
    loadLocalData(state.currentFridayStr);
    fetchFridayNhlGames(state.currentFridayStr);
    if (state.supabase) fetchSupabaseParlay(state.currentFridayStr);
    renderAll();
    playSound('click');
  });

  // Stake input
  DOM.stakeInput.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      state.stake = val;
      saveLocalData(state.currentFridayStr);
      renderSportsbookTicket();
    }
  });

  // Mark placed toggle
  DOM.markPlacedBtn.addEventListener('click', () => {
    state.isPlaced = !state.isPlaced;
    saveLocalData(state.currentFridayStr);
    renderSportsbookTicket();
    playSound('lock');
    if (state.isPlaced) {
      if (window.confetti) confetti({ particleCount: 100, spread: 70, origin: { y: 0.7 } });
      showToast('Bet marked as placed on sportsbook! 🏒🎯', '✅');
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
      showToast('Please fill in pick and odds', '⚠️');
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
    renderAll();
    showToast(`Locked in ${userName}'s leg! 🔥`, '🏒');

    if (Object.keys(state.legs).length === 5 && window.confetti) {
      setTimeout(() => {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
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
      showToast('Connected to Supabase!', '⚡');
    }
  });
}

// INITIALIZATION
window.addEventListener('DOMContentLoaded', () => {
  // Start on Week 2: Friday, October 16, 2026
  state.currentFriday = new Date('2026-10-16T12:00:00Z');
  state.currentFridayStr = formatDateISO(state.currentFriday);

  loadLocalData(state.currentFridayStr);
  setupEvents();
  renderAll();
  initSupabase();
  fetchFridayNhlGames(state.currentFridayStr);

  setInterval(updateCountdown, 60000);
});
