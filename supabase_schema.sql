-- ==============================================================================
-- FRIDAY PUCK PARLAY - SUPABASE DATABASE SCHEMA & REALTIME SETUP
-- 6 Boys. 6 Legs. Every Friday NHL • $30 Pool.
-- ==============================================================================

-- 1. Table for Weekly Parlay Master Slips
CREATE TABLE IF NOT EXISTS friday_parlays (
  id TEXT PRIMARY KEY,                       -- e.g. '2026-10-16' (Date string)
  week_date DATE NOT NULL,                   -- Friday date
  bettor_name TEXT NOT NULL,                 -- Who is placing the bet this week (Axel, Jackson, Will, Alex, Ben, Edward)
  status TEXT DEFAULT 'building',            -- 'building', 'locked', 'placed', 'won', 'lost'
  stake NUMERIC DEFAULT 30.00,               -- Wager amount in dollars ($5 each x 6 boys)
  total_odds TEXT,                           -- e.g. '+1050'
  potential_payout NUMERIC,                  -- Total potential payout
  ticket_image_url TEXT,                     -- Optional link/screenshot of placed sportsbook bet
  notes TEXT,                                -- Group notes / trash talk
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table for Individual Boys' Legs (Axel, Jackson, Will, Alex, Ben, Edward)
CREATE TABLE IF NOT EXISTS parlay_legs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_date DATE NOT NULL,                   -- Which Friday this leg belongs to
  user_name TEXT NOT NULL,                   -- 'Axel', 'Jackson', 'Will', 'Alex', 'Ben', 'Edward'
  game_title TEXT NOT NULL,                  -- e.g. 'PIT Penguins @ COL Avalanche'
  pick_text TEXT NOT NULL,                   -- e.g. 'Avalanche Moneyline (-145)'
  odds TEXT NOT NULL,                        -- e.g. '-145' or '+135'
  bet_type TEXT DEFAULT 'Moneyline',         -- 'Moneyline', 'Puckline', 'Total', 'Player Prop'
  chirp TEXT,                                -- Hot take / justification / trash talk
  locked BOOLEAN DEFAULT TRUE,
  result TEXT DEFAULT 'pending',             -- 'hit', 'miss', 'pending'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(week_date, user_name)              -- Only 1 leg per boy per Friday!
);

-- 3. Row-Level Security (RLS) Setup
-- Enables full public read/write so the boys can submit picks with standard anon key
ALTER TABLE friday_parlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE parlay_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon all on friday_parlays"
  ON friday_parlays
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon all on parlay_legs"
  ON parlay_legs
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- 4. Enable Supabase Realtime for instant phone updates
ALTER PUBLICATION supabase_realtime ADD TABLE friday_parlays;
ALTER PUBLICATION supabase_realtime ADD TABLE parlay_legs;

-- 5. Helpful index for ultra fast queries
CREATE INDEX IF NOT EXISTS idx_parlay_legs_date ON parlay_legs(week_date);
CREATE INDEX IF NOT EXISTS idx_parlays_date ON friday_parlays(week_date);
