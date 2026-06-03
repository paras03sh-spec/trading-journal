# Trading Journal

Personal trading journal app. Dark terminal aesthetic, tab-based, auto P&L calculation, persistent storage via Supabase, deployable to Vercel.

## Stack
- React (Create React App)
- Supabase (database)
- Vercel (hosting)
- 100% free

## Setup Guide

### Step 1 — Supabase (database)
1. Go to https://supabase.com and sign up (free)
2. Click "New Project" — name it "trading-journal", pick any region, set a password
3. Wait ~2 minutes for it to provision
4. Go to **SQL Editor** (left sidebar) → **New Query**
5. Copy everything from `supabase-schema.sql` in this folder and paste it → click **Run**
6. Go to **Settings** → **API**
7. Copy your **Project URL** and **anon public** key — you'll need these next

### Step 2 — Environment variables
1. In this project folder, create a file called `.env.local`
2. Add these two lines (replace with your actual values from Step 1):
```
REACT_APP_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 3 — GitHub (so Vercel can deploy)
1. Go to https://github.com and sign up / log in
2. Click **New repository** → name it "trading-journal" → Public or Private → **Create**
3. In your terminal, navigate to this folder and run:
```bash
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/trading-journal.git
git push -u origin main
```

### Step 4 — Vercel (hosting)
1. Go to https://vercel.com and sign up with your GitHub account
2. Click **Add New Project** → import your "trading-journal" repo
3. Before deploying, click **Environment Variables** and add:
   - `REACT_APP_SUPABASE_URL` → your Supabase project URL
   - `REACT_APP_SUPABASE_ANON_KEY` → your Supabase anon key
4. Click **Deploy**
5. Done — Vercel gives you a URL like `https://trading-journal-xyz.vercel.app`

### Step 5 — Use it
- Bookmark the Vercel URL on your phone and laptop
- On iPhone: open in Safari → Share → "Add to Home Screen" → it behaves like a native app
- Data saves automatically to Supabase, accessible from any device

## Making changes later
1. Edit the code (ask Claude to make changes)
2. Run `git add . && git commit -m "update" && git push`
3. Vercel auto-deploys in ~30 seconds
4. Your data in Supabase is never touched

## Point values reference
| Instrument | Per Point | Per Tick |
|---|---|---|
| ES | $50 | $12.50 |
| NQ | $20 | $5.00 |
| MES | $5 | $1.25 |
| MNQ | $2 | $0.50 |
