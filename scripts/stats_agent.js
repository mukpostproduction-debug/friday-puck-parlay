#!/usr/bin/env node
/**
 * FRIDAY NIGHT PUCK — WEEKLY STATS ARCHIVIST AGENT (`scripts/stats_agent.js`)
 * 
 * Pulls weekly parlay slips & squad picks from Supabase + local canonical records,
 * verifies live/final NHL boxscores via ESPN's NHL API (`?dates=YYYYMMDD`),
 * computes career squad analytics (Win %, Streaks, Avg Odds, Implied Flat-Bet ROI,
 * Favorite Prop Markets), and writes:
 *   1. `/SEASON_STATS_LEDGER.md` (Human-readable Markdown Season Ledger)
 *   2. `/data/season_stats_archive.json` (Machine-readable JSON Season Archive)
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://lumncqjfpdxaygbvtagi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bW5jcWpmcGR4YXlnYnZ0YWdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NTIzOTEsImV4cCI6MjA5MjAyODM5MX0.157-8-27s41-fH892wW672L5a62B1zR2pX7n-c857gI';

const SQUAD_MEMBERS = [
  { name: 'Jackson', initials: 'JM', role: 'Leg #1' },
  { name: 'Edward',  initials: 'ED', role: 'Leg #2' },
  { name: 'Axel',    initials: 'AX', role: 'Leg #3' },
  { name: 'Alex',    initials: 'AL', role: 'Leg #4' },
  { name: 'Ben',     initials: 'BN', role: 'Leg #5' },
  { name: 'Will',    initials: 'WL', role: 'Leg #6' }
];

const CANONICAL_WEEKS = [
  {
    weekNum: 1,
    dateStr: '2026-10-16',
    bettor: 'Axel',
    stake: 25,
    totalOdds: '+950',
    potentialPayout: 262.50,
    actualPayout: 0,
    book: 'DraftKings / Bet365',
    result: 'loss',
    legs: [
      { boy: 'Axel',    pick: 'Brock Nelson 1+ Points (PIT @ COL)',     odds: '-140', result: 'hit' },
      { boy: 'Jackson', pick: 'Nathan MacKinnon 4+ Shots (PIT @ COL)',  odds: '-130', result: 'hit' },
      { boy: 'Will',    pick: 'Pavel Zacha 1+ Points (BOS @ ANA)',      odds: '+120', result: 'hit' },
      { boy: 'Alex',    pick: 'Beckett Sennecke 1+ Points (BOS @ ANA)', odds: '+110', result: 'hit' },
      { boy: 'Ben',     pick: 'Leo Carlsson 1+ Points (BOS @ ANA)',     odds: '-115', result: 'miss' }
    ]
  },
  {
    weekNum: 2,
    dateStr: '2026-10-23',
    bettor: 'Jackson',
    stake: 30,
    totalOdds: '+1261',
    potentialPayout: 408.35,
    actualPayout: 0,
    book: 'FanDuel',
    result: 'loss',
    legs: [
      { boy: 'Edward',  pick: 'Cole Caufield Over 3.5 SOG (MTL @ CHI)',       odds: '-145', result: 'hit' },
      { boy: 'Will',    pick: 'Juraj Slafkovsky Over 0.5 Points (MTL @ CHI)', odds: '-175', result: 'miss' },
      { boy: 'Ben',     pick: 'Lane Hutson Over 1.5 SOG (MTL @ CHI)',         odds: '-130', result: 'miss' },
      { boy: 'Jackson', pick: 'Nathan MacKinnon Over 3.5 SOG (TBL @ COL)',    odds: '-145', result: 'hit' },
      { boy: 'Alex',    pick: 'Nikita Kucherov Over 0.5 Goals (TBL @ COL)',   odds: '+170', result: 'miss' },
      { boy: 'Axel',    pick: 'Brandon Hagel Over 0.5 Points (TBL @ COL)',    odds: '-175', result: 'hit' }
    ]
  },
  {
    weekNum: 3,
    dateStr: '2026-10-30',
    bettor: 'Will',
    stake: 30,
    totalOdds: '+2394',
    potentialPayout: 748.20,
    actualPayout: 0,
    book: 'BET99 (SGP+)',
    result: 'loss',
    legs: [
      { boy: 'Axel',    pick: 'Carter Verhaeghe — Over 0.5 Points (WPG @ FLA)',    odds: '-160', result: 'hit',  playerName: 'Carter Verhaeghe',    statType: 'points',  target: 1, game: 'WPG @ FLA' },
      { boy: 'Jackson', pick: 'Sam Bennett — Over 2.5 Shots on Goal (WPG @ FLA)',  odds: '-105', result: 'miss', playerName: 'Sam Bennett',         statType: 'shots',   target: 3, game: 'WPG @ FLA' },
      { boy: 'Alex',    pick: 'Seth Jones — Over 2.5 Shots on Goal (WPG @ FLA)',   odds: '+115', result: 'miss', playerName: 'Seth Jones',          statType: 'shots',   target: 3, game: 'WPG @ FLA' },
      { boy: 'Ben',     pick: 'Bobby McMann — Over 0.5 Points (SEA @ CGY)',        odds: '-120', result: 'miss', playerName: 'Bobby McMann',        statType: 'points',  target: 1, game: 'SEA @ CGY' },
      { boy: 'Will',    pick: 'Chandler Stephenson — Over 0.5 Assists (SEA @ CGY)',odds: '+155', result: 'hit',  playerName: 'Chandler Stephenson', statType: 'assists', target: 1, game: 'SEA @ CGY' },
      { boy: 'Edward',  pick: 'Brandon Montour — Over 0.5 Points (SEA @ CGY)',     odds: '+105', result: 'miss', playerName: 'Brandon Montour',     statType: 'points',  target: 1, game: 'SEA @ CGY' }
    ]
  },
  {
    weekNum: 4,
    dateStr: '2026-11-06',
    bettor: 'Alex',
    stake: 30,
    totalOdds: '+1414',
    potentialPayout: 454.41,
    actualPayout: 454.41,
    book: 'FanDuel (SGP+)',
    result: 'win',
    legs: [
      { boy: 'Axel',    pick: 'Kent Johnson — 1+ Points (CBJ @ BUF)',              odds: '-120', result: 'hit', playerName: 'Kent Johnson',     statType: 'points',   target: 1, game: 'CBJ @ BUF' },
      { boy: 'Jackson', pick: 'Matt Boldy — 3+ Shots on Goal (SJS @ MIN)',         odds: '-135', result: 'hit', playerName: 'Matt Boldy',       statType: 'shots',    target: 3, game: 'SJS @ MIN' },
      { boy: 'Will',    pick: 'Cutter Gauthier — Anytime Goal Scorer (ANA @ CGY)', odds: '+137', result: 'hit', playerName: 'Cutter Gauthier',  statType: 'goals',    target: 1, game: 'ANA @ CGY' },
      { boy: 'Alex',    pick: 'Minnesota Wild -1.5 Puck Line (SJS @ MIN)',         odds: '+110', result: 'hit', playerName: 'Minnesota Wild',   statType: 'puckline', target: 2, game: 'SJS @ MIN' },
      { boy: 'Ben',     pick: 'Quinn Hughes — 1+ Points (SJS @ MIN)',              odds: '-390', result: 'hit', playerName: 'Quinn Hughes',     statType: 'points',   target: 1, game: 'SJS @ MIN' },
      { boy: 'Edward',  pick: 'Beckett Sennecke — 1+ Points (ANA @ CGY)',          odds: '-195', result: 'hit', playerName: 'Beckett Sennecke', statType: 'points',   target: 1, game: 'ANA @ CGY' }
    ]
  }
];

function americanToDecimal(oddsStr) {
  if (!oddsStr) return 1.91;
  const cleaned = String(oddsStr).trim().replace(/[^0-9+-]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num === 0) return 1.91;
  if (num > 0) return 1 + (num / 100);
  return 1 + (100 / Math.abs(num));
}

function decimalToAmerican(dec) {
  if (!dec || dec <= 1) return '+100';
  if (dec >= 2.0) return `+${Math.round((dec - 1) * 100)}`;
  return `-${Math.round(100 / (dec - 1))}`;
}

function detectMarket(pickText) {
  const lower = String(pickText || '').toLowerCase();
  if (lower.includes('puck line') || lower.includes('puckline') || /[+-]\d+\.5/.test(lower)) return 'Puck Line';
  if (lower.includes('moneyline') || lower.includes('money line') || /\bml\b/.test(lower)) return 'Moneyline';
  if (lower.includes('save') || lower.includes(' sv')) return 'Goalie Saves';
  if (lower.includes('shot') || lower.includes('sog')) return 'Shots on Goal';
  if (lower.includes('assist')) return 'Assists';
  if (lower.includes('goal')) return 'Goals';
  if (lower.includes('block')) return 'Blocked Shots';
  if (lower.includes('hit')) return 'Hits';
  return 'Points';
}

function normalizeName(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim();
}

async function checkEspnLiveBoxscoresForWeek(week) {
  const compactDate = week.dateStr.replace(/-/g, '');
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${compactDate}`);
    if (!res.ok) return;
    const data = await res.json();
    const events = data.events || [];
    if (events.length === 0) return;

    let allGamesFinal = true;
    for (const ev of events) {
      const stateType = ev.status?.type?.state; // 'pre', 'in', 'post'
      if (stateType !== 'post') allGamesFinal = false;

      if (stateType === 'in' || stateType === 'post') {
        const sumRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${ev.id}`);
        if (!sumRes.ok) continue;
        const summary = await sumRes.json();
        const players = summary.boxscore?.players || [];
        for (const teamBlock of players) {
          for (const group of (teamBlock.statistics || [])) {
            const labels = (group.labels || []).map(l => l.toUpperCase());
            const gIdx = labels.indexOf('G');
            const aIdx = labels.indexOf('A');
            const sIdx = labels.indexOf('S') !== -1 ? labels.indexOf('S') : labels.indexOf('SOG');
            const svIdx = labels.indexOf('SV') !== -1 ? labels.indexOf('SV') : labels.indexOf('SAVES');

            for (const row of (group.athletes || [])) {
              const pName = normalizeName(row.athlete?.displayName || '');
              for (const leg of week.legs) {
                if (leg.playerName && normalizeName(leg.playerName) === pName) {
                  const st = row.stats || [];
                  const goals = gIdx !== -1 ? parseInt(st[gIdx] || '0', 10) : 0;
                  const assists = aIdx !== -1 ? parseInt(st[aIdx] || '0', 10) : 0;
                  const shots = sIdx !== -1 ? parseInt(st[sIdx] || '0', 10) : 0;
                  const saves = svIdx !== -1 ? parseInt(String(st[svIdx] || '0').split('-')[0], 10) : 0;
                  let currentVal = goals + assists;
                  if (leg.statType === 'shots') currentVal = shots;
                  else if (leg.statType === 'goals') currentVal = goals;
                  else if (leg.statType === 'assists') currentVal = assists;
                  else if (leg.statType === 'saves') currentVal = saves;

                  leg.liveStat = `${currentVal}/${leg.target}`;
                  if (currentVal >= leg.target) {
                    leg.result = 'hit';
                  } else if (stateType === 'post') {
                    leg.result = 'miss';
                  }
                }
              }
            }
          }
        }
      }
    }

    const gradedLegs = week.legs.filter(l => l.result === 'hit' || l.result === 'miss');
    if (allGamesFinal && gradedLegs.length === week.legs.length) {
      const allHit = week.legs.every(l => l.result === 'hit');
      week.result = allHit ? 'win' : 'loss';
    }
  } catch (err) {
    // Non-fatal network fallback
  }
}

async function main() {
  const weeks = JSON.parse(JSON.stringify(CANONICAL_WEEKS));

  // Check ESPN boxscores for any in-progress week
  for (const w of weeks) {
    if (w.result === 'in-progress') {
      await checkEspnLiveBoxscoresForWeek(w);
    }
  }

  // Master Bettor 6-Week Rotation Order
  const ROTATION_ORDER = ['Axel', 'Jackson', 'Will', 'Alex', 'Ben', 'Edward'];
  const settledRotationCount = weeks.filter(w => w.result === 'win' || w.result === 'loss').length;

  // Compute Squad Member Career Profiles & Individual Bankroll Ledger
  const profiles = SQUAD_MEMBERS.map(boy => {
    let hits = 0;
    let misses = 0;
    let pending = 0;
    let streak = 0;
    let streakType = '';
    const gradedDecimals = [];
    const allDecimals = [];
    let bestHitDec = 0;
    let bestHitOdds = '--';
    let bestHitPick = '';
    let flatStaked = 0;
    let flatReturned = 0;
    let placedAmount = 0;
    let ticketsPlacedCount = 0;
    const ticketsPlacedWeeks = [];
    let earningsShare = 0;
    const marketCounts = {};
    const marketHits = {};
    const pickHistory = [];

    weeks.forEach(w => {
      const isSettledOrActive = w.result === 'win' || w.result === 'loss' || w.result === 'in-progress';
      const wStake = Number(w.stake || 0);
      if (isSettledOrActive && wStake > 0 && String(w.bettor || '').toLowerCase() === boy.name.toLowerCase()) {
        placedAmount += wStake;
        ticketsPlacedCount++;
        ticketsPlacedWeeks.push({ weekNum: w.weekNum, dateStr: w.dateStr, stake: wStake, book: w.book });
      }

      if (w.result === 'win') {
        const weekPayout = Number(w.actualPayout ?? w.potentialPayout ?? 0);
        const uniqueBoys = Array.from(new Set((w.legs || []).map(l => l.boy).filter(Boolean)));
        const splitCount = uniqueBoys.length > 0 ? uniqueBoys.length : SQUAD_MEMBERS.length;
        const perBoyShare = Math.round(((weekPayout / splitCount) + 1e-9) * 100) / 100;
        if (uniqueBoys.includes(boy.name) || uniqueBoys.length === 0) {
          earningsShare = Math.round((earningsShare + perBoyShare + 1e-9) * 100) / 100;
        }
      }

      const leg = w.legs.find(l => l.boy === boy.name);
      if (!leg) return;
      const dec = americanToDecimal(leg.odds);
      const mkt = detectMarket(leg.pick);
      allDecimals.push(dec);
      marketCounts[mkt] = (marketCounts[mkt] || 0) + 1;

      if (leg.result === 'hit') {
        hits++;
        gradedDecimals.push(dec);
        marketHits[mkt] = (marketHits[mkt] || 0) + 1;
        flatStaked += 10;
        flatReturned += 10 * dec;
        if (dec > bestHitDec) {
          bestHitDec = dec;
          bestHitOdds = leg.odds;
          bestHitPick = leg.pick;
        }
        if (streakType === 'W') streak++;
        else { streakType = 'W'; streak = 1; }
      } else if (leg.result === 'miss') {
        misses++;
        gradedDecimals.push(dec);
        flatStaked += 10;
        if (streakType === 'L') streak++;
        else { streakType = 'L'; streak = 1; }
      } else {
        pending++;
      }

      pickHistory.push({
        weekNum: w.weekNum,
        dateStr: w.dateStr,
        pick: leg.pick,
        odds: leg.odds,
        market: mkt,
        result: leg.result
      });
    });

    const totalGraded = hits + misses;
    const winRate = totalGraded > 0 ? Math.round((hits / totalGraded) * 100) : 0;
    const avgGradedDec = gradedDecimals.length > 0 ? gradedDecimals.reduce((a, b) => a + b, 0) / gradedDecimals.length : 0;
    const avgAllDec = allDecimals.length > 0 ? allDecimals.reduce((a, b) => a + b, 0) / allDecimals.length : 0;
    const netFlatPL = flatReturned - flatStaked;
    const flatRoiPct = flatStaked > 0 ? Math.round((netFlatPL / flatStaked) * 100) : 0;
    const netPoolPL = Math.round(((earningsShare - placedAmount) + 1e-9) * 100) / 100;

    const rotIdx = ROTATION_ORDER.indexOf(boy.name);
    let nextTurnWeekNum = settledRotationCount + 1;
    if (rotIdx >= 0) {
      const currentCycleStart = Math.floor(settledRotationCount / ROTATION_ORDER.length) * ROTATION_ORDER.length;
      const candidate = currentCycleStart + rotIdx + 1;
      nextTurnWeekNum = candidate > settledRotationCount ? candidate : candidate + ROTATION_ORDER.length;
    }

    let favMarket = 'Points';
    let bestCnt = 0;
    Object.entries(marketCounts).forEach(([m, c]) => {
      if (c > bestCnt) { bestCnt = c; favMarket = m; }
    });

    return {
      name: boy.name,
      role: boy.role,
      hits,
      misses,
      pending,
      totalGraded,
      totalPicks: pickHistory.length,
      winRate,
      streak: streak > 0 ? `${streakType}${streak}` : '--',
      avgGradedOdds: avgGradedDec > 0 ? decimalToAmerican(avgGradedDec) : '--',
      avgAllOdds: avgAllDec > 0 ? decimalToAmerican(avgAllDec) : '--',
      bestHitOdds,
      bestHitPick,
      favMarket,
      favMarketRecord: `${marketHits[favMarket] || 0}/${marketCounts[favMarket] || 0}`,
      flatBetPL: `${netFlatPL >= 0 ? '+' : '-'}$${Math.abs(netFlatPL).toFixed(2)}`,
      flatBetRoi: `${flatRoiPct >= 0 ? '+' : ''}${flatRoiPct}%`,
      ticketsPlacedCount,
      ticketsPlacedWeeks,
      placedAmount: Number(placedAmount.toFixed(2)),
      earningsShare: Number(earningsShare.toFixed(2)),
      netPoolProfit: Number(netPoolPL.toFixed(2)),
      netPoolProfitFormatted: `${netPoolPL >= 0 ? '+' : '-'}$${Math.abs(netPoolPL).toFixed(2)}`,
      nextTurnWeekNum,
      pickHistory
    };
  });

  profiles.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.hits !== a.hits) return b.hits - a.hits;
    return a.misses - b.misses;
  });

  // Compute Pool Bankroll Summary
  const settledWeeks = weeks.filter(w => w.result === 'win' || w.result === 'loss');
  const wonWeeks = settledWeeks.filter(w => w.result === 'win');
  const totalStaked = settledWeeks.reduce((acc, w) => acc + (w.stake || 0), 0);
  const totalCashed = wonWeeks.reduce((acc, w) => acc + (w.actualPayout ?? w.potentialPayout ?? 0), 0);
  const netPoolProfit = totalCashed - totalStaked;
  const totalGradedLegs = profiles.reduce((acc, p) => acc + p.totalGraded, 0);
  const totalHitLegs = profiles.reduce((acc, p) => acc + p.hits, 0);
  const overallLegWinPct = totalGradedLegs > 0 ? ((totalHitLegs / totalGradedLegs) * 100).toFixed(1) : '0.0';
  const parlayWinPct = settledWeeks.length > 0 ? ((wonWeeks.length / settledWeeks.length) * 100).toFixed(1) : '0.0';

  const poolSummary = {
    settledParlays: settledWeeks.length,
    parlaysWon: wonWeeks.length,
    parlaysLost: settledWeeks.length - wonWeeks.length,
    parlayWinPct: `${parlayWinPct}%`,
    totalGradedLegs,
    totalHitLegs,
    overallLegWinPct: `${overallLegWinPct}%`,
    totalStaked: Number(totalStaked.toFixed(2)),
    totalCashed: Number(totalCashed.toFixed(2)),
    netPoolProfit: Number(netPoolProfit.toFixed(2))
  };

  // Save JSON Archive
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const archivePath = path.join(dataDir, 'season_stats_archive.json');
  const archivePayload = {
    generatedAt: new Date().toISOString(),
    season: '2026-2027',
    poolSummary,
    profiles,
    weeks
  };
  fs.writeFileSync(archivePath, JSON.stringify(archivePayload, null, 2), 'utf8');

  // Generate Markdown Season Ledger
  const md = [];
  md.push(`# 🏒 FRIDAY NIGHT PUCK — OFFICIAL SEASON STATS LEDGER`);
  md.push(`> **Maintained by the Friday Puck Stats Archivist Agent (\`scripts/stats_agent.js\`)**`);
  md.push(`> **Last Synced:** ${new Date().toUTCString()}`);
  md.push(``);
  md.push(`---`);
  md.push(``);
  md.push(`## 💰 SQUAD POOL BANKROLL SUMMARY`);
  md.push(``);
  md.push(`| Metric | Season Total |`);
  md.push(`| :--- | :--- |`);
  md.push(`| **Parlay Tickets Cashed** | **${poolSummary.parlaysWon} / ${poolSummary.settledParlays}** (\`${poolSummary.parlayWinPct}\`) |`);
  md.push(`| **Individual Legs Hit** | **${poolSummary.totalHitLegs} / ${poolSummary.totalGradedLegs}** (\`${poolSummary.overallLegWinPct}\`) |`);
  md.push(`| **Total Pool Staked** | \`$${poolSummary.totalStaked.toFixed(2)}\` |`);
  md.push(`| **Total Payouts Cashed** | \`$${poolSummary.totalCashed.toFixed(2)}\` |`);
  md.push(`| **Net Pool Profit** | **${poolSummary.netPoolProfit >= 0 ? '+' : '-'}\\$${Math.abs(poolSummary.netPoolProfit).toFixed(2)}** |`);
  md.push(``);
  md.push(`---`);
  md.push(``);
  md.push(`## 💵 INDIVIDUAL BANKROLL & EQUAL-SPLIT PROFIT LEDGER`);
  md.push(`> **How Pool Accounting Works:** One Master Bettor fronts the full ticket stake on their sportsbook each Friday (6-week rotation: \`Axel -> Jackson -> Will -> Alex -> Ben -> Edward\`). Every winning ticket payout is split equally 6 ways across the squad, and **Net Profit = Equal Payout Share − Tickets Placed Out-of-Pocket**.`);
  md.push(``);
  md.push(`| Rotation | Squad Member | Tickets Placed | Out-of-Pocket Placed | Equal Payout Share | Actual Net Profit | Next Master Bettor Turn |`);
  md.push(`| :---: | :--- | :--- | :---: | :---: | :---: | :---: |`);
  const rotationProfiles = ROTATION_ORDER.map(name => profiles.find(p => p.name === name)).filter(Boolean);
  rotationProfiles.forEach((p, idx) => {
    const ticketDetail = p.ticketsPlacedCount > 0
      ? `${p.ticketsPlacedCount}x (${p.ticketsPlacedWeeks.map(tw => `WK ${tw.weekNum}: $${tw.stake}`).join(', ')})`
      : `0x (On Deck)`;
    const netFormatted = `${p.netPoolProfit >= 0 ? '+' : '-'}\\$${Math.abs(p.netPoolProfit).toFixed(2)}`;
    md.push(`| **#${idx + 1}** | **${p.name}** (${p.role}) | \`${ticketDetail}\` | \`$${p.placedAmount.toFixed(2)}\` | \`$${p.earningsShare.toFixed(2)}\` | **${netFormatted}** | \`WK ${p.nextTurnWeekNum}\` |`);
  });
  md.push(``);
  md.push(`---`);
  md.push(``);
  md.push(`## 🏆 SQUAD STANDINGS & CAREER ANALYTICS`);
  md.push(``);
  md.push(`| Rank | Squad Member | Win % | Record | Streak | Actual Net Profit | Placed / Earned | Graded Avg Odds | Best Odds Cashed | Favorite Market |`);
  md.push(`| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |`);
  profiles.forEach((p, idx) => {
    const netFormatted = `${p.netPoolProfit >= 0 ? '+' : '-'}\\$${Math.abs(p.netPoolProfit).toFixed(2)}`;
    const flatFormatted = p.flatBetPL.replace('$', '\\$');
    md.push(`| **#${idx + 1}** | **${p.name}** (${p.role}) | **${p.winRate}%** | \`${p.hits}-${p.misses}\` | \`${p.streak}\` | **${netFormatted}** | \`$${p.placedAmount.toFixed(2)}\` / \`$${p.earningsShare.toFixed(2)}\` | \`${p.avgGradedOdds}\` | \`${p.bestHitOdds}\` | ${p.favMarket} (\`${p.favMarketRecord}\`) |`);
  });
  md.push(``);
  md.push(`---`);
  md.push(``);
  md.push(`## 👤 INDIVIDUAL SQUAD BETTING PROFILES`);
  md.push(``);
  profiles.forEach(p => {
    const netFormatted = `${p.netPoolProfit >= 0 ? '+' : '-'}\\$${Math.abs(p.netPoolProfit).toFixed(2)}`;
    const flatFormatted = p.flatBetPL.replace('$', '\\$');
    const placedLog = p.ticketsPlacedCount > 0
      ? p.ticketsPlacedWeeks.map(tw => `WK ${tw.weekNum} ($${tw.stake.toFixed(2)})`).join(', ')
      : `None yet (Next turn: WK ${p.nextTurnWeekNum})`;
    md.push(`### 🏒 ${p.name} (${p.role})`);
    md.push(`- **Actual Pool Bankroll:** **${netFormatted}** Net Profit (\`$${p.earningsShare.toFixed(2)}\` Equal Share Won − \`$${p.placedAmount.toFixed(2)}\` Placed • Tickets: \`${placedLog}\`)`);
    md.push(`- **Career Record:** \`${p.hits}-${p.misses}\` (**${p.winRate}%** Win Rate) • **Active/Pending:** ${p.pending}`);
    md.push(`- **Average Odds:** \`${p.avgAllOdds}\` across all ${p.totalPicks} picks (\`${p.avgGradedOdds}\` on graded legs)`);
    md.push(`- **Best Odds Cashed:** \`${p.bestHitOdds}\` ${p.bestHitPick ? `— *${p.bestHitPick}*` : ''}`);
    md.push(`- **Implied Solo \\$10 Flat-Bet Profit:** **${flatFormatted}** (\`${p.flatBetRoi}\` ROI)`);
    md.push(`- **Favorite Market:** ${p.favMarket} (\`${p.favMarketRecord}\` cashed)`);
    md.push(`- **Complete Pick Log:**`);
    p.pickHistory.forEach(pk => {
      const badge = pk.result === 'hit' ? '✅ HIT' : (pk.result === 'miss' ? '❌ MISS' : '⏳ LIVE / PENDING');
      md.push(`  - **Week ${pk.weekNum} (${pk.dateStr}):** ${pk.pick} @ \`${pk.odds}\` [${pk.market}] — **${badge}**`);
    });
    md.push(``);
  });
  md.push(`---`);
  md.push(``);
  md.push(`## 📅 WEEKLY PARLAY ARCHIVE`);
  md.push(``);
  weeks.forEach(w => {
    const hits = w.legs.filter(l => l.result === 'hit').length;
    const statusBanner = w.result === 'win'
      ? '✅ TICKET CASHED'
      : (w.result === 'loss' ? `❌ PARLAY SOLD (${hits}/${w.legs.length} HITS)` : `⚡ IN PROGRESS (${hits}/${w.legs.length} HITS)`);
    md.push(`### Week ${w.weekNum} • ${w.dateStr} — **${statusBanner}**`);
    md.push(`- **Master Bettor:** ${w.bettor} | **Book:** ${w.book} | **Stake:** \\$${w.stake.toFixed(2)} | **Combined Odds:** \`${w.totalOdds}\` | **Potential Payout:** \\$${w.potentialPayout.toFixed(2)}`);
    md.push(``);
    md.push(`| Squad Member | Official Pick & Matchup | Odds | Market | Status |`);
    md.push(`| :--- | :--- | :---: | :--- | :---: |`);
    w.legs.forEach(l => {
      const badge = l.result === 'hit' ? '✅ HIT' : (l.result === 'miss' ? '❌ MISS' : '⏳ LIVE / ON ICE');
      md.push(`| **${l.boy}** | ${l.pick} | \`${l.odds}\` | ${detectMarket(l.pick)} | **${badge}** |`);
    });
    md.push(``);
  });

  const ledgerPath = path.join(__dirname, '..', 'SEASON_STATS_LEDGER.md');
  fs.writeFileSync(ledgerPath, md.join('\n'), 'utf8');
  console.log(`Updated ${ledgerPath} and ${archivePath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

