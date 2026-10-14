/**
 * Friday Puck Parlay - Core Application Logic
 * 5 Boys. 5 Legs. Every Friday NHL.
 */

// SQUAD ROSTER CONFIGURATION
const SQUAD = [
  { id: 'alex', name: 'Alex', initials: 'AL', avatarClass: 'avatar-alex', role: 'The Captain' },
  { id: 'will', name: 'Will', initials: 'WI', avatarClass: 'avatar-will', role: 'The Sniper' },
  { id: 'jackson', name: 'Jackson', initials: 'JA', avatarClass: 'avatar-jackson', role: 'The Playmaker' },
  { id: 'axel', name: 'Axel', initials: 'AX', avatarClass: 'avatar-axel', role: 'The Enforcer' },
  { id: 'ben', name: 'Ben', initials: 'BE', avatarClass: 'avatar-ben', role: 'The Wildcard' }
];

// REFERENCE START FRIDAY FOR ROTATION (Alex is Week 1)
const ROTATION_START_FRIDAY = new Date('2026-10-16T12:00:00Z');

// STATE MANAGEMENT
const state = {
  currentFriday: null, // Date object
  currentFridayStr: '', // 'YYYY-MM-DD'
  legs: {}, // Map of boy.name -> leg object
  games: [], // List of games for this Friday
  stake: 25,
  isPlaced: false,
  activeTab: 'tab-board',
  selectedBoy: null,
  selectedBetType: 'Moneyline',
  supabase: null,
  isLiveSync: false
};

// AUDIO SYNTHESIZER (Pure Web Audio API - Zero External Audio Files)
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
      // Satisfying dual chord
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.15);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'triumph') {
      // Major chord fanfare
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g);
        g.connect(audioCtx.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, now + i * 0.08);
        g.gain.setValueAtTime(0.15, now + i * 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.6 + i * 0.08);
        o.start(now + i * 0.08);
        o.stop(now + 0.6 + i * 0.08);
      });
    } else {
      // Clean tap
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    }
  } catch (e) {
    // Ignore audio autoplay restrictions
  }
}

// DATE HELPERS
function getNextFriday(from = new Date()) {
  const date = new Date(from);
  date.setHours(12, 0, 0, 0);
  const day = date.getDay();
  const diff = (day <= 5 ? 5 - day : 6);
  date.setDate(date.getDate() + diff);
  return date;
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

function getFridayDiffWeeks(fridayDate) {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const diffMs = fridayDate.getTime() - ROTATION_START_FRIDAY.getTime();
  return Math.round(diffMs / msPerWeek);
}

// ROTATION ENGINE: Alex -> Will -> Jackson -> Axel -> Ben
function getBettorForFriday(fridayDate) {
  const weeksDiff = getFridayDiffWeeks(fridayDate);
  const index = ((weeksDiff % SQUAD.length) + SQUAD.length) % SQUAD.length;
  return SQUAD[index];
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

// INITIAL DEMO DATA FOR OCT 16, 2026
function getInitialDemoPicks(dateStr) {
  if (dateStr === '2026-10-16') {
    return {
      'Alex': {
        user_name: 'Alex',
        game_title: 'PIT Penguins @ COL Avalanche',
        pick_text: 'Avalanche Moneyline (-145)',
        odds: '-145',
        bet_type: 'Moneyline',
        chirp: 'Mackinnon on a heater at home. Easy money.',
        locked: true
      },
      'Will': {
        user_name: 'Will',
        game_title: 'BOS Bruins @ ANA Ducks',
        pick_text: 'Bruins -1.5 Puckline (+125)',
        odds: '+125',
        bet_type: 'Puckline',
        chirp: 'Bruins bounce-back road statement game.',
        locked: true
      },
      'Jackson': {
        user_name: 'Jackson',
        game_title: 'PIT Penguins @ COL Avalanche',
        pick_text: 'Over 6.5 Total Goals (-110)',
        odds: '-110',
        bet_type: 'Total',
        chirp: 'Both goalies give up juicy rebounds on back-to-backs.',
        locked: true
      }
    };
  }
  return {};
}

// DOM ELEMENTS
const DOM = {
  syncStatusBtn: document.getElementById('syncStatusBtn'),
  syncStatusText: document.getElementById('syncStatusText'),
  prevWeekBtn: document.getElementById('prevWeekBtn'),
  nextWeekBtn: document.getElementById('nextWeekBtn'),
  jumpCurrentBtn: document.getElementById('jumpCurrentBtn'),
  currentFridayDisplay: document.getElementById('currentFridayDisplay'),
  puckDropCountdown: document.getElementById('puckDropCountdown'),
  bettorName: document.getElementById('bettorName'),
  bettorAvatar: document.getElementById('bettorAvatar'),
  bettorSub: document.getElementById('bettorSub'),
  slipProgressText: document.getElementById('slipProgressText'),
  slipProgressBar: document.getElementById('slipProgressBar'),
  slipStatusMsg: document.getElementById('slipStatusMsg'),
  quickChirpBtn: document.getElementById('quickChirpBtn'),
  copySportsbookSlipBtn: document.getElementById('copySportsbookSlipBtn'),
  legsCardsContainer: document.getElementById('legsCardsContainer'),
  totalAmericanOdds: document.getElementById('totalAmericanOdds'),
  totalDecimalOdds: document.getElementById('totalDecimalOdds'),
  stakeInput: document.getElementById('stakeInput'),
  potentialPayoutDisplay: document.getElementById('potentialPayoutDisplay'),
  potentialProfitDisplay: document.getElementById('potentialProfitDisplay'),
  ticketLegsSummary: document.getElementById('ticketLegsSummary'),
  ticketStatusPill: document.getElementById('ticketStatusPill'),
  ticketDateText: document.getElementById('ticketDateText'),
  ticketCopyBtn: document.getElementById('ticketCopyBtn'),
  markPlacedBtn: document.getElementById('markPlacedBtn'),
  markPlacedText: document.getElementById('markPlacedText'),
  nhlGamesCount: document.getElementById('nhlGamesCount'),
  gamesGrid: document.getElementById('gamesGrid'),
  refreshScheduleBtn: document.getElementById('refreshScheduleBtn'),
  rotationTimeline: document.getElementById('rotationTimeline'),
  rosterGrid: document.getElementById('rosterGrid'),
  statTotalStaked: document.getElementById('statTotalStaked'),
  statTotalWon: document.getElementById('statTotalWon'),
  statParlaysHit: document.getElementById('statParlaysHit'),
  statRoi: document.getElementById('statRoi'),
  // Modals
  legModalBackdrop: document.getElementById('legModalBackdrop'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  cancelModalBtn: document.getElementById('cancelModalBtn'),
  legForm: document.getElementById('legForm'),
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
  modalTitle: document.getElementById('modalTitle'),
  // Supabase Sync Modal
  syncModalBackdrop: document.getElementById('syncModalBackdrop'),
  closeSyncModalBtn: document.getElementById('closeSyncModalBtn'),
  supabaseUrlInput: document.getElementById('supabaseUrlInput'),
  supabaseAnonKeyInput: document.getElementById('supabaseAnonKeyInput'),
  saveSyncBtn: document.getElementById('saveSyncBtn'),
  clearSyncBtn: document.getElementById('clearSyncBtn'),
  sqlAccordionHeader: document.getElementById('sqlAccordionHeader'),
  sqlAccordionBody: document.getElementById('sqlAccordionBody'),
  copySqlBtn: document.getElementById('copySqlBtn'),
  syncConnectionStatus: document.getElementById('syncConnectionStatus'),
  toastContainer: document.getElementById('toastContainer')
};

// TOAST NOTIFICATIONS
function showToast(message, icon = '🏒') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// FETCH FRIDAY NHL SCHEDULE FROM OFFICIAL NHL API
async function fetchFridayNhlGames(dateStr) {
  DOM.gamesGrid.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Connecting to official NHL schedule for ${dateStr}...</span>
    </div>
  `;

  let gamesList = [];
  const directUrl = `https://api-web.nhle.com/v1/schedule/${dateStr}`;
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`;

  try {
    // Attempt 1: Free CORS proxy
    let res = await fetch(proxyUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Proxy returned status ' + res.status);
    let data = await res.json();
    gamesList = parseNhlScheduleData(data, dateStr);
  } catch (err) {
    console.warn('Proxy fetch failed, attempting direct fetch:', err);
    try {
      let res = await fetch(directUrl);
      let data = await res.json();
      gamesList = parseNhlScheduleData(data, dateStr);
    } catch (e) {
      console.warn('Direct fetch failed, falling back to curated matchups:', e);
      gamesList = getFallbackGames(dateStr);
    }
  }

  state.games = gamesList;
  DOM.nhlGamesCount.textContent = gamesList.length;
  renderGamesGrid(gamesList);
  populateGameSelectDropdown(gamesList);
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

function renderGamesGrid(games) {
  if (!games || games.length === 0) {
    DOM.gamesGrid.innerHTML = `
      <div class="empty-state-card" style="text-align: center; padding: 40px; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-subtle);">
        <p style="font-size: 1.1rem; color: #fff; font-weight: 700; margin-bottom: 8px;">No NHL Games Scheduled for This Date</p>
        <p style="font-size: 0.85rem; color: var(--text-muted);">You can still manually enter any pick details and odds in the 5-Leg Slip!</p>
      </div>
    `;
    return;
  }

  DOM.gamesGrid.innerHTML = games.map(g => {
    const timeFormatted = formatGameTime(g.startTimeUTC);
    const gameTitle = `${g.away.abbrev} @ ${g.home.abbrev}`;
    return `
      <div class="game-match-card">
        <div class="teams-faceoff">
          <div class="team-badge-side away">
            <div>
              <div class="team-name-text">${g.away.place} ${g.away.name}</div>
              <div class="team-record-sub">${g.away.abbrev}</div>
            </div>
            <img src="${g.away.logo}" alt="${g.away.abbrev}" class="team-logo-img" onerror="this.style.display='none'" />
          </div>

          <div class="vs-badge">VS</div>

          <div class="team-badge-side home">
            <img src="${g.home.logo}" alt="${g.home.abbrev}" class="team-logo-img" onerror="this.style.display='none'" />
            <div>
              <div class="team-name-text">${g.home.place} ${g.home.name}</div>
              <div class="team-record-sub">${g.home.abbrev}</div>
            </div>
          </div>
        </div>

        <div class="game-time-info">
          <div class="game-time-val">${timeFormatted}</div>
          <div class="game-venue-val">${g.venue}</div>
        </div>

        <button class="btn btn-sm btn-outline pick-game-quick-btn" data-game="${gameTitle}">
          + Pick Game
        </button>
      </div>
    `;
  }).join('');

  // Attach quick pick handlers
  document.querySelectorAll('.pick-game-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const gameTitle = btn.getAttribute('data-game');
      openLegModal(null, gameTitle);
    });
  });
}

function formatGameTime(utcString) {
  if (!utcString) return 'TBD';
  try {
    const d = new Date(utcString);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch (e) {
    return '7:00 PM ET';
  }
}

function populateGameSelectDropdown(games) {
  DOM.gameSelect.innerHTML = '<option value="">Select a Friday matchup...</option>';
  games.forEach(g => {
    const title = `${g.away.abbrev} ${g.away.name} @ ${g.home.abbrev} ${g.home.name}`;
    const opt = document.createElement('option');
    opt.value = title;
    opt.textContent = title;
    DOM.gameSelect.appendChild(opt);
  });
  const customOpt = document.createElement('option');
  customOpt.value = 'Custom NHL Matchup';
  customOpt.textContent = '✏️ Custom / Other NHL Matchup';
  DOM.gameSelect.appendChild(customOpt);
}

// STORAGE & DATA SYNC (LOCALSTORAGE + SUPABASE)
function loadLocalData(dateStr) {
  const key = `friday_puck_parlay_${dateStr}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.legs = parsed.legs || {};
      state.stake = parsed.stake || 25;
      state.isPlaced = !!parsed.isPlaced;
      return;
    } catch (e) {
      console.error('Failed to parse local storage:', e);
    }
  }

  // Pre-load default demo picks for Oct 16, 2026
  state.legs = getInitialDemoPicks(dateStr);
  state.stake = 25;
  state.isPlaced = false;
  saveLocalData(dateStr);
}

function saveLocalData(dateStr) {
  const key = `friday_puck_parlay_${dateStr}`;
  const payload = {
    date: dateStr,
    legs: state.legs,
    stake: state.stake,
    isPlaced: state.isPlaced,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

// SUPABASE CLIENT SETUP
function initSupabase() {
  const savedUrl = localStorage.getItem('puck_supabase_url');
  const savedKey = localStorage.getItem('puck_supabase_key');

  if (savedUrl && savedKey && window.supabase) {
    try {
      state.supabase = window.supabase.createClient(savedUrl, savedKey);
      state.isLiveSync = true;
      updateSyncStatusUI(true);
      setupSupabaseRealtime();
      fetchSupabaseParlay(state.currentFridayStr);
    } catch (e) {
      console.error('Failed to initialize Supabase client:', e);
      updateSyncStatusUI(false);
    }
  } else {
    updateSyncStatusUI(false);
  }
}

function updateSyncStatusUI(isLive) {
  if (isLive) {
    DOM.syncStatusBtn.classList.add('live-mode');
    DOM.syncStatusText.textContent = 'Live Sync (Supabase)';
    DOM.syncConnectionStatus.innerHTML = `
      <div class="status-indicator-dot live"></div>
      <div>
        <strong>Connected to Supabase Realtime</strong>
        <p>Changes on any of the boys' phones sync instantly without reloading!</p>
      </div>
    `;
  } else {
    DOM.syncStatusBtn.classList.remove('live-mode');
    DOM.syncStatusText.textContent = 'Local Storage';
    DOM.syncConnectionStatus.innerHTML = `
      <div class="status-indicator-dot local"></div>
      <div>
        <strong>Local Storage Mode</strong>
        <p>Picks are saved in this browser. Enter Supabase keys to sync across all 5 phones.</p>
      </div>
    `;
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

    if (legs && legs.length > 0) {
      const legsMap = {};
      legs.forEach(l => {
        legsMap[l.user_name] = l;
      });
      state.legs = legsMap;
      renderAll();
    }
  } catch (e) {
    console.error('Supabase query failed:', e);
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
          playSound('lock');
          renderAll();
          showToast(`${row.user_name} updated their pick live!`, '🔥');
        }
      })
      .subscribe();
  } catch (e) {
    console.warn('Failed to subscribe to Supabase realtime:', e);
  }
}

async function persistLeg(legObj) {
  // 1. Update in-memory & LocalStorage
  state.legs[legObj.user_name] = legObj;
  saveLocalData(state.currentFridayStr);

  // 2. If Supabase is connected, push to cloud
  if (state.supabase) {
    try {
      const { error } = await state.supabase
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

      if (error) console.error('Supabase upsert error:', error);
    } catch (e) {
      console.error('Supabase leg persist failed:', e);
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

// RENDER BOARD (THE 5 SQUAD LEGS)
function renderSquadLegs() {
  const bettorThisWeek = getBettorForFriday(state.currentFriday);

  DOM.legsCardsContainer.innerHTML = SQUAD.map(boy => {
    const leg = state.legs[boy.name];
    const isLocked = !!(leg && leg.odds);
    const isBettor = (boy.name === bettorThisWeek.name);

    if (isLocked) {
      const decOdds = americanToDecimal(leg.odds).toFixed(2);
      return `
        <div class="leg-card locked">
          <div class="leg-card-header">
            <div class="boy-profile">
              <div class="boy-avatar ${boy.avatarClass}">${boy.initials}</div>
              <div>
                <div class="boy-name-wrap">
                  <span class="boy-name">${boy.name}</span>
                  ${isBettor ? '<span class="bettor-tag-mini">👑 PLACING BET</span>' : ''}
                </div>
                <div class="bet-type-tag">${leg.bet_type || 'Pick'} • ${boy.role}</div>
              </div>
            </div>

            <div class="leg-status-pill pill-locked">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>LOCKED IN</span>
            </div>
          </div>

          <div class="pick-details-box">
            <div>
              <div class="game-title">${escapeHTML(leg.game_title || 'NHL Matchup')}</div>
              <div class="pick-desc">${escapeHTML(leg.pick_text)}</div>
            </div>
            <div class="leg-odds-wrap">
              <div class="odds-badge">${leg.odds.startsWith('-') || leg.odds.startsWith('+') ? leg.odds : '+' + leg.odds}</div>
              <div class="odds-decimal-sub">${decOdds}x</div>
            </div>
          </div>

          ${leg.chirp ? `
            <div class="chirp-quote">
              <span>💬</span>
              <span>"${escapeHTML(leg.chirp)}"</span>
            </div>
          ` : ''}

          <div class="card-actions">
            <button class="btn-icon-subtle edit-leg-btn" data-boy="${boy.name}" title="Edit pick">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-icon-subtle btn-icon-danger delete-leg-btn" data-boy="${boy.name}" title="Remove pick">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="leg-card pending">
          <div class="leg-card-header">
            <div class="boy-profile">
              <div class="boy-avatar ${boy.avatarClass}" style="opacity: 0.65;">${boy.initials}</div>
              <div>
                <div class="boy-name-wrap">
                  <span class="boy-name">${boy.name}</span>
                  ${isBettor ? '<span class="bettor-tag-mini">👑 PLACING BET</span>' : ''}
                </div>
                <div class="bet-type-tag">${boy.role}</div>
              </div>
            </div>

            <div class="leg-status-pill pill-pending">
              <span>⏳ WAITING ON PICK</span>
            </div>
          </div>

          <div class="empty-leg-row">
            <span class="empty-prompt">No Friday leg locked in yet.</span>
            <button class="btn btn-sm btn-primary add-leg-btn" data-boy="${boy.name}">
              + Lock In Leg
            </button>
          </div>
        </div>
      `;
    }
  }).join('');

  // Event handlers for edit/add/delete
  document.querySelectorAll('.add-leg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const boyName = btn.getAttribute('data-boy');
      openLegModal(boyName);
    });
  });

  document.querySelectorAll('.edit-leg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const boyName = btn.getAttribute('data-boy');
      openLegModal(boyName);
    });
  });

  document.querySelectorAll('.delete-leg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const boyName = btn.getAttribute('data-boy');
      if (confirm(`Remove ${boyName}'s pick from this week's parlay?`)) {
        deleteLeg(boyName);
      }
    });
  });
}

// RENDER PARLAY TICKET (SUMMARY & COMBINED ODDS)
function renderParlayTicket() {
  const legsList = SQUAD.map(b => state.legs[b.name]).filter(Boolean);
  const totals = calculateParlayTotals(legsList, state.stake);

  DOM.totalAmericanOdds.textContent = totals.american;
  DOM.totalDecimalOdds.textContent = `${totals.decimal.toFixed(2)}x`;
  DOM.potentialPayoutDisplay.textContent = `$${totals.payout.toFixed(2)}`;
  DOM.potentialProfitDisplay.textContent = `+$${totals.profit.toFixed(2)} profit`;

  // Ticket date text
  DOM.ticketDateText.textContent = formatDateDisplay(state.currentFriday);

  // Status pill
  if (totals.count === 5) {
    DOM.ticketStatusPill.textContent = 'SLIP READY (5/5)';
    DOM.ticketStatusPill.className = 'ticket-pill ready';
  } else {
    DOM.ticketStatusPill.textContent = `BUILDING (${totals.count}/5)`;
    DOM.ticketStatusPill.className = 'ticket-pill';
  }

  // Mini summary items on ticket
  DOM.ticketLegsSummary.innerHTML = SQUAD.map(boy => {
    const leg = state.legs[boy.name];
    if (leg && leg.odds) {
      return `
        <div class="ticket-leg-item">
          <span class="leg-summary-name">
            <span style="color: var(--green-win)">✓</span> ${boy.name}
          </span>
          <span class="leg-summary-pick" title="${escapeHTML(leg.pick_text)}">${escapeHTML(leg.pick_text)}</span>
          <span class="leg-summary-odds">${leg.odds}</span>
        </div>
      `;
    } else {
      return `
        <div class="ticket-leg-item" style="opacity: 0.5;">
          <span class="leg-summary-name">
            <span style="color: var(--text-muted)">○</span> ${boy.name}
          </span>
          <span class="leg-summary-pick">Waiting for pick...</span>
          <span class="leg-summary-odds">--</span>
        </div>
      `;
    }
  }).join('');

  // Placed status button
  if (state.isPlaced) {
    DOM.markPlacedBtn.classList.remove('btn-outline');
    DOM.markPlacedBtn.classList.add('btn-primary');
    DOM.markPlacedText.textContent = '✓ Bet Placed on Sportsbook';
  } else {
    DOM.markPlacedBtn.classList.add('btn-outline');
    DOM.markPlacedBtn.classList.remove('btn-primary');
    DOM.markPlacedText.textContent = 'Mark as Placed by Bettor';
  }
}

// RENDER ON DECK HERO BANNER & COUNTDOWN
function renderOnDeckBanner() {
  const bettor = getBettorForFriday(state.currentFriday);
  DOM.bettorName.textContent = bettor.name;
  DOM.bettorAvatar.textContent = bettor.initials;
  DOM.bettorAvatar.className = `bettor-avatar-lg ${bettor.avatarClass}`;
  DOM.bettorSub.textContent = `It's ${bettor.name}'s turn to place the 5-leg parlay on his sportsbook account.`;

  const legsCount = Object.keys(state.legs).length;
  DOM.slipProgressText.textContent = `${legsCount} / 5 LEGS`;
  DOM.slipProgressBar.style.width = `${(legsCount / 5) * 100}%`;

  if (legsCount === 5) {
    DOM.slipStatusMsg.textContent = `🔥 All 5 legs locked in! ${bettor.name} can submit the ticket now.`;
    DOM.slipStatusMsg.style.color = 'var(--green-win)';
  } else {
    DOM.slipStatusMsg.textContent = `Need ${5 - legsCount} more leg${5 - legsCount === 1 ? '' : 's'} before puck drop.`;
    DOM.slipStatusMsg.style.color = 'var(--text-muted)';
  }

  // Update countdown to Friday 7:00 PM ET
  updatePuckDropCountdown();
}

function updatePuckDropCountdown() {
  const targetTime = new Date(state.currentFriday);
  targetTime.setHours(19, 0, 0, 0); // 7:00 PM
  const now = new Date();
  const diffMs = targetTime - now;

  if (diffMs <= 0) {
    DOM.puckDropCountdown.textContent = '🏒 Puck Drop Live / Completed';
  } else {
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    DOM.puckDropCountdown.textContent = `⏳ ${days}d ${hours}h ${minutes}m until puck drop`;
  }
}

// RENDER ROTATION ROADMAP & STATS TAB
function renderRotationTab() {
  // Generate 8 upcoming Fridays
  const upcomingFridays = [];
  const base = new Date(state.currentFriday);

  for (let i = -1; i <= 6; i++) {
    const f = new Date(base);
    f.setDate(f.getDate() + (i * 7));
    upcomingFridays.push(f);
  }

  DOM.rotationTimeline.innerHTML = upcomingFridays.map(fri => {
    const bettor = getBettorForFriday(fri);
    const dateFormatted = fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const isCurrent = formatDateISO(fri) === state.currentFridayStr;
    const weekNum = getFridayDiffWeeks(fri) + 1;

    return `
      <div class="rotation-row ${isCurrent ? 'current-week' : ''}">
        <div class="rot-week-info">
          <span class="rot-week-tag">WEEK ${weekNum > 0 ? weekNum : 1}</span>
          <span class="rot-date">${dateFormatted}</span>
        </div>
        <div class="rot-bettor">
          <div class="boy-avatar ${bettor.avatarClass}" style="width: 32px; height: 32px; font-size: 0.85rem;">${bettor.initials}</div>
          <span class="rot-name">${bettor.name}</span>
          ${isCurrent ? '<span class="bettor-tag-mini">👑 ON DECK</span>' : ''}
        </div>
      </div>
    `;
  }).join('');

  // Roster hit counts
  DOM.rosterGrid.innerHTML = SQUAD.map(boy => {
    return `
      <div class="roster-card">
        <div class="roster-avatar ${boy.avatarClass}">${boy.initials}</div>
        <div class="roster-name">${boy.name}</div>
        <div class="bet-type-tag">${boy.role}</div>
        <div class="roster-stat" style="color: var(--green-win); font-weight: 700; margin-top: 4px;">Active Bettor</div>
      </div>
    `;
  }).join('');

  // Placeholder League stats
  DOM.statTotalStaked.textContent = `$${(state.stake * 3).toFixed(0)}`;
  DOM.statTotalWon.textContent = `$${(state.stake * 3 * 2.8).toFixed(0)}`;
  DOM.statParlaysHit.textContent = '1 / 3';
  DOM.statRoi.textContent = '+180%';
}

// MAIN RENDER CALL
function renderAll() {
  DOM.currentFridayDisplay.textContent = formatDateDisplay(state.currentFriday);
  renderOnDeckBanner();
  renderSquadLegs();
  renderParlayTicket();
  renderRotationTab();
}

// INTERACTIVE MODAL (LOCK IN LEG)
function openLegModal(defaultBoy = null, defaultGame = null) {
  DOM.legModalBackdrop.classList.add('open');

  // Populate Boys Picker Buttons
  DOM.modalBoysPicker.innerHTML = SQUAD.map(b => `
    <button type="button" class="boy-select-btn ${defaultBoy === b.name ? 'active' : ''}" data-boy="${b.name}">
      <span class="boy-avatar ${b.avatarClass}" style="width: 28px; height: 28px; font-size: 0.75rem;">${b.initials}</span>
      <span>${b.name}</span>
    </button>
  `).join('');

  // Handle boy selection
  let selectedName = defaultBoy || SQUAD[0].name;
  DOM.selectedBoyInput.value = selectedName;

  document.querySelectorAll('.boy-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.boy-select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedName = btn.getAttribute('data-boy');
      DOM.selectedBoyInput.value = selectedName;
      loadBoyExistingLegIntoModal(selectedName);
    });
  });

  loadBoyExistingLegIntoModal(selectedName, defaultGame);
  DOM.pickTextInput.focus();
}

function loadBoyExistingLegIntoModal(boyName, defaultGame = null) {
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

  // Set active bet type chip
  document.querySelectorAll('.type-chip').forEach(c => {
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

// COPY FUNCTIONS
function copySlipForSportsbook() {
  const bettor = getBettorForFriday(state.currentFriday);
  const legsList = SQUAD.map(b => state.legs[b.name]).filter(Boolean);
  const totals = calculateParlayTotals(legsList, state.stake);
  const dateFormatted = formatDateDisplay(state.currentFriday);

  let text = `🏒 FRIDAY PUCK PARLAY (${dateFormatted})\n`;
  text += `👤 Bettor On Deck: ${bettor.name} ($${state.stake} Stake)\n`;
  text += `🔥 ${totals.count}/5 Legs Locked In:\n\n`;

  SQUAD.forEach((boy, idx) => {
    const leg = state.legs[boy.name];
    if (leg && leg.odds) {
      text += `${idx + 1}. ${boy.name}: ${leg.pick_text} (${leg.odds})\n`;
      if (leg.chirp) text += `   💬 "${leg.chirp}"\n`;
    } else {
      text += `${idx + 1}. ${boy.name}: [PENDING PICK]\n`;
    }
  });

  text += `\n-------------------------------\n`;
  text += `💰 Combined Odds: ${totals.american} (${totals.decimal.toFixed(2)}x)\n`;
  text += `💵 Potential Payout: $${totals.payout.toFixed(2)} (+$${totals.profit.toFixed(2)} profit)\n`;
  text += `🔗 Track on: https://mukpostproduction-debug.github.io/friday-puck-parlay/\n`;

  navigator.clipboard.writeText(text).then(() => {
    playSound('triumph');
    if (window.confetti) {
      confetti({ particleCount: 75, spread: 60, origin: { y: 0.85 } });
    }
    showToast('Parlay slip copied to clipboard!', '📋');
  }).catch(() => {
    showToast('Failed to copy. Please allow clipboard permissions.', '⚠️');
  });
}

function generateGroupChirp() {
  const bettor = getBettorForFriday(state.currentFriday);
  const missing = SQUAD.filter(b => !state.legs[b.name]);

  let msg = '';
  if (missing.length === 0) {
    msg = `🚨 ALL 5 LEGS ARE LOCKED IN! 👑 @${bettor.name} is on deck to place the ticket on his sportsbook right now! Let's get that bag boys 🏒💰`;
  } else {
    const names = missing.map(b => `@${b.name}`).join(', ');
    const insults = [
      `Lock in your Friday leg before the lines move! Puck drop is ticking down 🏒⏰`,
      `Stop sleeping and get your picks in. Don't sell the parlay! 🎯`,
      `We need the final legs before Friday puck drop. Lock it in! 💥`
    ];
    const pickInsult = insults[Math.floor(Math.random() * insults.length)];
    msg = `🏒 Friday Puck Parlay Alert: ${names} - ${pickInsult} (Bettor this week: ${bettor.name})`;
  }

  navigator.clipboard.writeText(msg).then(() => {
    playSound('click');
    showToast('Chirp message copied! Paste it in the group chat 📱', '💬');
  });
}

// ESCAPE HTML HELPER
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

// SETUP EVENT LISTENERS
function setupEvents() {
  // Date navigation
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

  DOM.jumpCurrentBtn.addEventListener('click', () => {
    state.currentFriday = getNextFriday();
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
      renderParlayTicket();
    }
  });

  // Mark bet as placed toggle
  DOM.markPlacedBtn.addEventListener('click', () => {
    state.isPlaced = !state.isPlaced;
    saveLocalData(state.currentFridayStr);
    renderParlayTicket();
    playSound('lock');
    if (state.isPlaced) {
      if (window.confetti) confetti({ particleCount: 100, spread: 70, origin: { y: 0.7 } });
      showToast('Bet marked as placed on sportsbook! 🏒🎯', '✅');
    }
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
      state.activeTab = targetId;
      playSound('click');
    });
  });

  // Bet type chip selector
  document.querySelectorAll('.type-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      DOM.betTypeInput.value = chip.getAttribute('data-type');
    });
  });

  // Odds input listener
  DOM.oddsInput.addEventListener('input', e => {
    updateOddsHelper(e.target.value);
  });

  // Copy buttons
  DOM.copySportsbookSlipBtn.addEventListener('click', copySlipForSportsbook);
  DOM.ticketCopyBtn.addEventListener('click', copySlipForSportsbook);
  DOM.quickChirpBtn.addEventListener('click', generateGroupChirp);
  DOM.refreshScheduleBtn.addEventListener('click', () => {
    fetchFridayNhlGames(state.currentFridayStr);
  });

  // Leg Modal Form Submission
  DOM.legForm.addEventListener('submit', async e => {
    e.preventDefault();
    const userName = DOM.selectedBoyInput.value;
    const gameTitle = DOM.gameSelect.value || 'Friday NHL Matchup';
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

    // Confetti if all 5 are locked
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
    DOM.supabaseUrlInput.value = localStorage.getItem('puck_supabase_url') || '';
    DOM.supabaseAnonKeyInput.value = localStorage.getItem('puck_supabase_key') || '';
  });

  DOM.closeSyncModalBtn.addEventListener('click', () => {
    DOM.syncModalBackdrop.classList.remove('open');
  });

  DOM.syncModalBackdrop.addEventListener('click', e => {
    if (e.target === DOM.syncModalBackdrop) DOM.syncModalBackdrop.classList.remove('open');
  });

  DOM.sqlAccordionHeader.addEventListener('click', () => {
    DOM.sqlAccordionBody.classList.toggle('open');
  });

  DOM.copySqlBtn.addEventListener('click', () => {
    const sql = document.getElementById('sqlCodeBlock').textContent;
    navigator.clipboard.writeText(sql).then(() => {
      showToast('SQL script copied! Paste into Supabase SQL Editor.', '📋');
    });
  });

  DOM.saveSyncBtn.addEventListener('click', () => {
    const url = DOM.supabaseUrlInput.value.trim();
    const key = DOM.supabaseAnonKeyInput.value.trim();

    if (!url || !key) {
      showToast('Please enter both Supabase URL and Anon Key', '⚠️');
      return;
    }

    localStorage.setItem('puck_supabase_url', url);
    localStorage.setItem('puck_supabase_key', key);
    initSupabase();
    DOM.syncModalBackdrop.classList.remove('open');
    showToast('Supabase Live Sync connected!', '⚡');
  });

  DOM.clearSyncBtn.addEventListener('click', () => {
    localStorage.removeItem('puck_supabase_url');
    localStorage.removeItem('puck_supabase_key');
    state.supabase = null;
    state.isLiveSync = false;
    updateSyncStatusUI(false);
    DOM.syncModalBackdrop.classList.remove('open');
    showToast('Reset to Local Storage mode', '💾');
  });
}

// INITIALIZATION
window.addEventListener('DOMContentLoaded', () => {
  // Start with upcoming Friday
  state.currentFriday = getNextFriday();
  state.currentFridayStr = formatDateISO(state.currentFriday);

  loadLocalData(state.currentFridayStr);
  setupEvents();
  renderAll();
  initSupabase();
  fetchFridayNhlGames(state.currentFridayStr);

  // Update countdown every minute
  setInterval(updatePuckDropCountdown, 60000);
});
