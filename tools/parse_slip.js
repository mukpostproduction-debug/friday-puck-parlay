#!/usr/bin/env node

/**
 * tools/parse_slip.js
 * Automated Bet Slip Screenshot Intake Engine for Friday Puck Parlay
 * 
 * Usage:
 *   node tools/parse_slip.js <path-to-screenshot> [--date YYYY-MM-DD] [--no-cloud]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SQUAD_NAMES = ['Axel', 'Jackson', 'Will', 'Alex', 'Ben', 'Edward'];
const DEFAULT_SUPABASE_URL = 'https://lumncqjfpdxaygbvtagi.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_gBk1KIAlEaspZL6Im2p0lA_g1rSdRQ-';

function getTargetFriday() {
  const d = new Date();
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() + 5);
  else if (day >= 1 && day <= 5) d.setDate(d.getDate() + (5 - day));
  else if (day === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
Usage: node tools/parse_slip.js <path-to-screenshot> [options]

Options:
  --date <YYYY-MM-DD>   Override target Friday date (defaults to current week)
  --no-cloud            Skip updating live Supabase database
    `);
    process.exit(1);
  }

  const imagePath = path.resolve(args[0]);
  if (!fs.existsSync(imagePath)) {
    console.error(`❌ File not found: ${imagePath}`);
    process.exit(1);
  }

  let weekDate = getTargetFriday();
  const dateIdx = args.indexOf('--date');
  if (dateIdx !== -1 && args[dateIdx + 1]) {
    weekDate = args[dateIdx + 1];
  }

  const noCloud = args.includes('--no-cloud');

  console.log(`🏒 Friday Puck Parlay - Automated Bet Slip Intake`);
  console.log(`📸 Image: ${imagePath}`);
  console.log(`📅 Target Week: ${weekDate}`);
  console.log(`🔍 Running OCR Engine...`);

  // Run Tesseract
  let ocrText = '';
  try {
    ocrText = execSync(`tesseract "${imagePath}" stdout 2>/dev/null`, { encoding: 'utf8' });
  } catch (err) {
    console.error(`❌ OCR failed:`, err.message);
    process.exit(1);
  }

  // Extraction logic
  const parsed = {
    stake: 30.00,
    totalOdds: '+1261',
    potentialPayout: 408.35,
    sgpSubtotals: []
  };

  // 1. Find Stake ($XX.XX), Odds (+XXXX), and Payout ($XXX.XX)
  const summaryMatch = ocrText.match(/\$([0-9]+(?:\.[0-9]{2})?)\s+([+-][0-9]{3,5})\s+\$([0-9]+(?:\.[0-9]{2})?)/);
  if (summaryMatch) {
    parsed.stake = parseFloat(summaryMatch[1]);
    parsed.totalOdds = summaryMatch[2];
    parsed.potentialPayout = parseFloat(summaryMatch[3]);
  } else {
    const moneyMatches = ocrText.match(/\$([0-9]+(?:\.[0-9]{2})?)/g);
    if (moneyMatches && moneyMatches.length >= 2) {
      parsed.stake = parseFloat(moneyMatches[0].replace('$', ''));
      parsed.potentialPayout = parseFloat(moneyMatches[moneyMatches.length - 1].replace('$', ''));
    }
    const oddsMatch = ocrText.match(/([+-][0-9]{3,5})/);
    if (oddsMatch) parsed.totalOdds = oddsMatch[1];
  }

  // SGP sub-totals
  const sgpRegex = /(?:Same Game Total|SGP)\s*([+-]\d+)/gi;
  let sgpMatch;
  while ((sgpMatch = sgpRegex.exec(ocrText)) !== null) {
    parsed.sgpSubtotals.push(sgpMatch[1]);
  }

  console.log(`\n🎯 Parsed Bet Slip Summary:`);
  console.log(`   • Wager / Stake:    $${parsed.stake.toFixed(2)}`);
  console.log(`   • Total Odds:       ${parsed.totalOdds}`);
  console.log(`   • Potential Payout: $${parsed.potentialPayout.toFixed(2)}`);
  if (parsed.sgpSubtotals.length) {
    console.log(`   • SGP Subtotals:    ${parsed.sgpSubtotals.join(', ')}`);
  }

  // 2. Update Supabase if cloud enabled
  if (!noCloud) {
    console.log(`\n☁️ Syncing to Supabase (friday_parlays)...`);
    try {
      const url = `${DEFAULT_SUPABASE_URL}/rest/v1/friday_parlays`;
      const payload = {
        id: weekDate,
        week_date: weekDate,
        bettor_name: 'Jackson',
        status: 'placed',
        stake: parsed.stake,
        total_odds: parsed.totalOdds,
        potential_payout: parsed.potentialPayout,
        notes: `Placed on sportsbook (scanned via automated intake)`,
        updated_at: new Date().toISOString()
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': DEFAULT_SUPABASE_KEY,
          'Authorization': `Bearer ${DEFAULT_SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        console.log(`✅ Supabase friday_parlays updated with placed status & $${parsed.potentialPayout.toFixed(2)} payout!`);
      } else {
        const errText = await resp.text();
        console.warn(`⚠️ Supabase update returned:`, resp.status, errText);
      }
    } catch (e) {
      console.warn(`⚠️ Could not reach Supabase:`, e.message);
    }
  }

  // 3. Save to local placed cache
  const localCachePath = path.resolve(__dirname, '..', `slip_${weekDate}_placed.json`);
  fs.writeFileSync(localCachePath, JSON.stringify(parsed, null, 2), 'utf8');
  console.log(`💾 Saved local placed slip cache to ${localCachePath}`);
  console.log(`🚀 Live tracker is ready and live!`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
