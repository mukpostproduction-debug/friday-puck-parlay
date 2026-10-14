# 🏒 Friday Puck Parlay

> **5 Boys. 5 Legs. Every Friday NHL.**  
> A custom real-time parlay builder, rotation tracker, and sports betting hub for **Alex, Will, Jackson, Axel, and Ben**.

Live on GitHub Pages: **[https://mukpostproduction-debug.github.io/friday-puck-parlay/](https://mukpostproduction-debug.github.io/friday-puck-parlay/)**

---

## ⚡ How It Works

1. **1 Friday Parlay Each Week (NHL Only)**:
   - Every Friday during the NHL season, the boys build a single **5-leg parlay ticket**.
   - Each boy is responsible for submitting **1 leg** (Matchup, Pick, Odds, and optional hot take / chirp).
2. **Weekly Bet Placer Rotation Engine**:
   - The bet placement rotates every Friday so financial deposits stay 100% even across the squad:
     - **Week 1**: 👑 **Alex**
     - **Week 2**: 👑 **Will**
     - **Week 3**: 👑 **Jackson**
     - **Week 4**: 👑 **Axel**
     - **Week 5**: 👑 **Ben**
     - *(Repeats cyclically all season and through playoffs!)*
   - The app dynamically spotlights **who is on deck** this week with a countdown timer to Friday puck drop!
3. **Live NHL Schedule Integration**:
   - Fetches live Friday matchups directly from the official NHL schedule API with team logos, game times, and venues.
   - Click **"+ Pick Game"** on any matchup to instantly lock in your leg.
4. **Real-time Parlay Calculator**:
   - Automatically converts American odds (`-140`, `+125`) into decimal multipliers.
   - Calculates combined parlay odds and potential payout based on the weekly stake (default `$25.00`).
5. **1-Click Sportsbook Slip Copy**:
   - Formats the entire 5-leg parlay cleanly for Bet365, FanDuel, DraftKings, or iMessage.
6. **Group Chirp Generator**:
   - Generates funny, randomized trash-talk chirps tagging whoever hasn't submitted their leg yet.

---

## 🚀 Setting Up Live Cloud Sync (Supabase)

The app works immediately out of the box in **Local Storage mode** for testing. To sync picks live across all 5 boys' phones without refreshing:

1. Create a free project at **[supabase.com](https://supabase.com)** (takes ~60 seconds).
2. Open the **SQL Editor** in your Supabase dashboard and run the contents of [`supabase_schema.sql`](./supabase_schema.sql).
3. On the web app, tap the **"Local Storage"** badge in the top right.
4. Paste your **Supabase Project URL** and **Anon Key** and tap **Connect & Save**.
5. Once connected, whenever anyone submits a leg from their phone, everyone's slip updates live!

---

## 📱 Mobile App (Add to Home Screen)

The web app is optimized for iOS and Android:
1. Open the URL in Safari on iPhone.
2. Tap the **Share** button (box with arrow).
3. Tap **"Add to Home Screen"**.
4. Now it opens like a native app with a dark sports lounge icon!

---

## 🛠️ Tech Stack

- **Frontend**: Pure Semantic HTML5, Vanilla CSS3 (Obsidian Dark Ice theme, glassmorphism, responsive grid), Vanilla ES6 JavaScript.
- **Audio & Animations**: Web Audio API synthesizer for clean haptic sounds, `canvas-confetti` for winning blasts.
- **Data & APIs**: Official NHL Schedule API (`api-web.nhle.com`) + Supabase Realtime Client (`@supabase/supabase-js`).
- **Zero build tools required**: Works directly in any browser and on GitHub Pages with instant deployment.
