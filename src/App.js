import { useState, useRef, useEffect, useCallback } from 'react';
import { loadDay, saveDay, loadIndex, saveIndex } from './supabase';

const POINT_VALUES = { ES: 50, NQ: 20, MES: 5, MNQ: 2 };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS_HDR = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const TABS = ["Pre-Market", "Trades", "EOD Review"];

const C = {
  bg:'#0e0e0e', surface:'#161616', surface2:'#1c1c1c',
  border:'#2a2a2a', border2:'#3a3a3a',
  text:'#e8e8e8', textSub:'#999', textMut:'#555', textDim:'#333',
  green:'#4ade80', red:'#f87171', yellow:'#fbbf24',
  blue:'#60a5fa', purple:'#a78bfa', teal:'#34d399', orange:'#fb923c',
};

function calcPnL(ticker,contracts,points){return(parseFloat(points)||0)*(POINT_VALUES[ticker]||0)*(parseFloat(contracts)||0);}
function calcRisk(ticker,contracts,sl){return(parseFloat(sl)||0)*(POINT_VALUES[ticker]||0)*(parseFloat(contracts)||0);}
function fmtDate(d){return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}
function todayStr(){return new Date().toLocaleDateString('en-CA');}
function getMonthDays(year,month){
  const days=[];
  const first=new Date(year,month,1).getDay();
  const total=new Date(year,month+1,0).getDate();
  for(let i=0;i<first;i++)days.push(null);
  for(let d=1;d<=total;d++){
    const mm=String(month+1).padStart(2,'0');
    const dd=String(d).padStart(2,'0');
    days.push(`${year}-${mm}-${dd}`);
  }
  return days;
}

// ─── Bias Engine ──────────────────────────────────────────────────────────────
function computeBias(bi) {
  // bi = biasInputs object from pre data
  const {
    prevDayCandle,      // 'green' | 'red' | 'inside' | ''
    insideDayCount,     // number (0,1,2,3+)
    profileShape,       // 'B'|'b'|'P'|'D'|'normal'|'single_prints'|''
    prevHighQuality,    // 'excess'|'poor'|'normal'|''
    prevLowQuality,     // 'excess'|'poor'|'normal'|''
    tpoDistribution,    // 'upper'|'lower'|''
    pocMigration,       // 'rising'|'flat'|'falling'|''
    edgeContext,        // ''|'none'|'high_from_inside'|'low_from_inside'|'high_from_above'|'low_from_below'|'failed_break_high'|'failed_break_low'
    // same-day inputs
    ibSize,             // 'short'|'medium'|'large'|''
    vaOverlap,          // 'heavy'|'none'|''
    ibLocation,         // 'upper'|'middle'|'lower'|''  — where is price in IB at 10:30
    vwapRelation,       // 'above'|'at'|'below'|''  — price vs VWAP at 10:30
    ethOvernight,       // 'broke_high_held'|'broke_high_rejected'|'broke_low_held'|'broke_low_rejected'|'inside'|'both_sides_touched'|''
  } = bi;

  // ── Step 1: Prior day candle (base direction) ──
  let baseDir = null; // 'long' | 'short' | 'neutral'
  let signals = [];

  if (parseInt(insideDayCount) >= 2) {
    baseDir = 'neutral';
    signals.push(`⚪ ${insideDayCount}+ consecutive inside days — balance mode, fade extremes only`);
  } else if (prevDayCandle === 'green') {
    baseDir = 'long';
    signals.push('🟢 Prior day green — long bias base (~55-58% base rate)');
  } else if (prevDayCandle === 'red') {
    baseDir = 'short';
    signals.push('🔴 Prior day red — short bias base (~58-62%, down clusters harder)');
  } else if (prevDayCandle === 'inside') {
    baseDir = 'neutral';
    signals.push('⚪ Inside day — neutral, fade extremes');
  }

  if (baseDir === null) {
    return { bias: '', conviction: '', sizing: '', signals: [], color: C.textMut };
  }

  // ── Step 2: Profile shape ──
  // profileScore: positive = bullish weight, negative = bearish weight.
  // ±2 = primary structural signal, ±1 = secondary.
  let profileScore = 0;
  if (profileShape === 'D') {
    if (prevDayCandle === 'green') { profileScore = 2; signals.push('📈 D-shape trend up — strongest continuation signal'); }
    else if (prevDayCandle === 'red') { profileScore = -2; signals.push('📉 D-shape trend down — strongest continuation signal'); }
    else { signals.push('📊 D-shape noted — needs a directional candle to confirm'); }
  } else if (profileShape === 'B') {
    profileScore = 2; signals.push('📈 B-shape — buyers won both auctions, long reinforced');
  } else if (profileShape === 'b') {
    profileScore = 2; signals.push('📈 b-shape — trapped shorts below, long reinforced');
  } else if (profileShape === 'P') {
    profileScore = -2; signals.push('📉 P-shape — spike rejected, value built low, short reinforced');
  } else if (profileShape === 'normal') {
    signals.push('⚪ Normal bell — no extra conviction, candle bias stands');
  } else if (profileShape === 'single_prints') {
    signals.push('🧲 Single prints — secondary magnet, not a primary signal');
  }

  // ── Step 3: Prior day extreme quality (excess / poor) ──
  // Excess = clean single/two letter rejection at extreme. Level defended (~65-70%).
  // Poor = overlapping letters at extreme. Unfinished auction, magnetic pull back.
  // Excess at LOW = bullish +1 (buyers defended). Excess at HIGH = bearish -1 (sellers defended).
  // Poor LOW = bearish -1 (unfinished auction below, downside pull). Poor HIGH = bullish +1 (upside target magnetic).
  if (prevLowQuality === 'excess') {
    profileScore += 1;
    signals.push('✅ Excess at prior day LOW — clean buyer rejection, low defended (~65-70% holds). Structural support.');
  } else if (prevLowQuality === 'poor') {
    profileScore -= 1;
    signals.push('⚠ Poor LOW on prior day — unfinished auction below, downside magnetic pull. That low is a target.');
  }
  if (prevHighQuality === 'excess') {
    profileScore -= 1;
    signals.push('✅ Excess at prior day HIGH — clean seller rejection, high defended (~65-70% holds). Structural resistance.');
  } else if (prevHighQuality === 'poor') {
    profileScore += 1;
    signals.push('⚠ Poor HIGH on prior day — unfinished auction above, upside magnetic pull. That high is a target.');
  }

  // ── Step 4: TPO distribution (secondary, ±1) ──
  if (tpoDistribution === 'upper') {
    profileScore += 1; signals.push('⬆ TPO upper half — buyers controlled close');
  } else if (tpoDistribution === 'lower') {
    profileScore -= 1; signals.push('⬇ TPO lower half — sellers controlled close');
  }

  // ── Step 4: POC migration (secondary, ±1) ──
  if (pocMigration === 'rising') {
    profileScore += 1; signals.push('↗ Rising POC — accumulation, long backing');
  } else if (pocMigration === 'falling') {
    profileScore -= 1; signals.push('↘ Falling POC — distribution, short backing');
  } else if (pocMigration === 'flat') {
    signals.push('➡ Flat POC — balanced, reduce trend conviction');
  }

  // ── Resolve structural direction (candle + profile + tpo + poc) ──
  let resolvedDir = baseDir;
  if (baseDir === 'long' && profileScore <= -2) {
    resolvedDir = 'neutral';
    signals.push('⚡ Structure conflicts with green candle — downgraded to neutral');
  } else if (baseDir === 'short' && profileScore >= 2) {
    resolvedDir = 'neutral';
    signals.push('⚡ Structure conflicts with red candle — downgraded to neutral');
  } else if (baseDir === 'neutral' && profileScore >= 2) {
    resolvedDir = 'long';
    signals.push('⚡ Structure overrides inside day — long from profile');
  } else if (baseDir === 'neutral' && profileScore <= -2) {
    resolvedDir = 'short';
    signals.push('⚡ Structure overrides inside day — short from profile');
  }

  // structuralAgreement = how strongly the structure agrees with resolvedDir
  let structuralAgreement = 0;
  if (resolvedDir === 'long') structuralAgreement = Math.max(0, profileScore);
  else if (resolvedDir === 'short') structuralAgreement = Math.max(0, -profileScore);

  // ── Step 5: Multi-day balance edge (longest-timeframe override) ──
  if (edgeContext && edgeContext !== 'none') {
    let edgeBias, edgeColor, edgeConv, edgeSizing, edgeSignal;

    if (edgeContext === 'high_from_inside') {
      edgeBias = 'neutral'; edgeColor = C.yellow; edgeConv = 'edge-watch';
      edgeSignal = '⬆ At HIGH edge from inside — long-into-edge done. Neutral at the line.';
      edgeSizing = 'Two-sided: failed expansion = short back into range. Acceptance + hold above = breakout long. Do not press until it resolves.';
    } else if (edgeContext === 'low_from_inside') {
      edgeBias = 'neutral'; edgeColor = C.yellow; edgeConv = 'edge-watch';
      edgeSignal = '⬇ At LOW edge from inside — short-into-edge done. Neutral at the line.';
      edgeSizing = 'Two-sided: failed expansion = long back into range. Acceptance + hold below = breakout short. Do not press until it resolves.';
    } else if (edgeContext === 'high_from_above') {
      edgeBias = 'bullish'; edgeColor = C.green; edgeConv = 'reclaim';
      edgeSignal = '↩ Returning to HIGH edge from above — edge is now support, reclaim attempt.';
      edgeSizing = 'Lean long while edge holds as support. Long on a hold/bounce. If price slices back inside with acceptance, bias dead → neutral range-fade.';
    } else if (edgeContext === 'low_from_below') {
      edgeBias = 'bearish'; edgeColor = C.red; edgeConv = 'reclaim';
      edgeSignal = '↪ Returning to LOW edge from below — edge is now resistance, reclaim attempt.';
      edgeSizing = 'Lean short while edge holds as resistance. Short on a rejection. If price pushes back inside with acceptance, bias dead → neutral range-fade.';
    } else if (edgeContext === 'failed_break_high') {
      // Strongest balance edge signal — breakout confirmed failed overnight.
      // Trapped longs above the edge + stops below it = mechanical selling pressure.
      // ~68-72% resolution toward opposite balance edge.
      edgeBias = 'bearish'; edgeColor = C.red; edgeConv = 'high';
      edgeSignal = '❌ Failed breakout HIGH — expanded above balance last session, overnight returned inside. Trapped longs above edge.';
      edgeSizing = 'Strong short lean. Prior expansion high is resistance — sell against it. Target opposite balance edge (low). Confirm: price must be clearly inside the balance at 10:30, not hovering at the edge.';
    } else if (edgeContext === 'failed_break_low') {
      // Mirror — trapped shorts below the edge = mechanical buying pressure.
      edgeBias = 'bullish'; edgeColor = C.green; edgeConv = 'high';
      edgeSignal = '❌ Failed breakout LOW — expanded below balance last session, overnight returned inside. Trapped shorts below edge.';
      edgeSizing = 'Strong long lean. Prior expansion low is support — buy against it. Target opposite balance edge (high). Confirm: price must be clearly inside the balance at 10:30, not hovering at the edge.';
    } else if (edgeContext === 'tapped_low_now_middle') {
      // Price tapped the balance low prior session/overnight, bounced, now trading clearly
      // away from the edge in the middle of balance. Responsive buyers proved themselves.
      // ~60-65% continuation toward the high edge from here.
      edgeBias = 'bullish'; edgeColor = C.green; edgeConv = 'medium';
      edgeSignal = '🔄 Low edge tapped prior/overnight + held — price now in middle of balance. Responsive buyers proved themselves.';
      edgeSizing = 'Bullish lean within balance. Target: high edge. Entry on pullbacks to VWAP or prior session POC — not at the original tap level. Confirmation already done, do not chase.';
    } else if (edgeContext === 'tapped_high_now_middle') {
      // Mirror — price tapped balance high, rejected, now in middle.
      // Responsive sellers proved themselves. ~60-65% continuation toward low edge.
      edgeBias = 'bearish'; edgeColor = C.red; edgeConv = 'medium';
      edgeSignal = '🔄 High edge tapped prior/overnight + held — price now in middle of balance. Responsive sellers proved themselves.';
      edgeSizing = 'Bearish lean within balance. Target: low edge. Entry on bounces to VWAP or prior session POC — not at the original tap level. Confirmation already done, do not chase.';
    } else if (edgeContext === 'failed_exp_low_now_middle') {
      // Failed expansion below balance low, price has already rallied back to middle.
      // Strongest possible scenario — trapped shorts are significantly underwater.
      // Squeeze is already in progress. ~65-72% continuation toward high edge.
      edgeBias = 'bullish'; edgeColor = C.green; edgeConv = 'high';
      edgeSignal = '🚀 Failed expansion LOW + already back in middle — trapped shorts underwater, squeeze in progress.';
      edgeSizing = 'Highest conviction bullish. The move is already proving itself. Target: high edge. Entry on pullbacks to VWAP, prior POC, or IB low — NOT the original break level. Hold runners. Do not fade this unless mid-session IB update contradicts.';
    } else if (edgeContext === 'failed_exp_high_now_middle') {
      // Mirror — failed expansion above balance high, price back in middle.
      // Trapped longs significantly underwater. Squeeze in progress.
      edgeBias = 'bearish'; edgeColor = C.red; edgeConv = 'high';
      edgeSignal = '💥 Failed expansion HIGH + already back in middle — trapped longs underwater, squeeze in progress.';
      edgeSizing = 'Highest conviction bearish. The move is already proving itself. Target: low edge. Entry on bounces to VWAP, prior POC, or IB high — NOT the original break level. Hold runners. Do not fade this unless mid-session IB update contradicts.';
    }

    signals.push(edgeSignal);
    if (ibSize === 'large') {
      signals.push('📐 Large IB at the edge — extension already spent, favor the fade/rejection side.');
    } else if (ibSize === 'short') {
      signals.push('📐 Short IB at the edge — coiled, if it breaks/holds the move can run.');
    } else if (ibSize === 'medium') {
      signals.push('📐 Medium IB — let price tell you, no forced read.');
    }

    return { bias: edgeBias, conviction: edgeConv, sizing: edgeSizing, signals, color: edgeColor };
  }

  // ── Step 6: Same-day IB filter ──
  let ibBoost = 0;
  if (ibSize === 'short') {
    signals.push('📐 Short IB (<50% ATR) — trending day likely (~75-80% after a confirmed break), lean into bias');
    ibBoost = 1;
  } else if (ibSize === 'medium') {
    signals.push('📐 Medium IB — no extra info, carry bias, use VP levels for execution');
  } else if (ibSize === 'large') {
    signals.push('📐 Large IB (>100% ATR) — market already moved, shift to fade posture regardless of bias');
  }

  if (ibSize === 'large') {
    return {
      bias: 'neutral',
      conviction: 'fade',
      sizing: 'Fade posture only. Sell IB high, buy IB low. Prior bias secondary.',
      signals,
      color: C.orange,
    };
  }

  // ── Step 7: VA overlap + IB location at 10:30 ──
  if (vaOverlap === 'heavy') {
    signals.push('🔁 Heavy VA overlap — balanced day likely (~70-80%), tighten targets');
    if (resolvedDir !== 'neutral') ibBoost -= 1;
  } else if (vaOverlap === 'none') {
    signals.push('↔ No VA overlap — market rejecting prior value, trend probability up');
    ibBoost += 1;
  }

  // IB location at 10:30 — where price is sitting within the completed IB.
  // Upper quarter = buyers held high ground through the IB (~62-68% bullish continuation).
  // Lower quarter = sellers held low ground (~62-68% bearish continuation).
  // Middle = rotational, balanced day likely (~70-75%), no directional lean.
  if (ibLocation === 'upper') {
    if (resolvedDir === 'long') {
      signals.push('📍 Price in upper IB quarter at 10:30 — buyers held high ground, confirms long bias (~62-68%)');
      ibBoost += 2;
    } else if (resolvedDir === 'short') {
      signals.push('📍 Price in upper IB quarter — conflicts with short bias. Buyers held the IB. Reduce conviction.');
      ibBoost -= 1;
    } else {
      signals.push('📍 Price in upper IB quarter — mild long lean on a neutral day, watch for IB high break');
      ibBoost += 1;
    }
  } else if (ibLocation === 'lower') {
    if (resolvedDir === 'short') {
      signals.push('📍 Price in lower IB quarter at 10:30 — sellers held low ground, confirms short bias (~62-68%)');
      ibBoost += 2;
    } else if (resolvedDir === 'long') {
      signals.push('📍 Price in lower IB quarter — conflicts with long bias. Sellers held the IB. Reduce conviction.');
      ibBoost -= 1;
    } else {
      signals.push('📍 Price in lower IB quarter — mild short lean on a neutral day, watch for IB low break');
      ibBoost += 1;
    }
  } else if (ibLocation === 'middle') {
    signals.push('📍 Price in IB middle at 10:30 — rotational open, balanced day likely (~70-75%), fade extremes');
    if (resolvedDir !== 'neutral') ibBoost -= 1;
  }

  // ── Step 8: VWAP relationship at 10:30 ──
  // VWAP is the most widely used institutional intraday reference.
  // By 10:30 it has 2 hours of data and is a meaningful read.
  // Agreement with bias = confirms direction, improves entry quality.
  // Conflict with bias = caution, wait for VWAP flip before committing.
  // At VWAP = neutral, wait for separation.
  if (vwapRelation === 'above') {
    if (resolvedDir === 'long') {
      signals.push('📊 Price above VWAP — confirms long bias. Look for longs on VWAP retest, not extended above it.');
      ibBoost += 1;
    } else if (resolvedDir === 'short') {
      signals.push('📊 Price above VWAP — conflicts with short bias. Wait for price to break and accept below VWAP before shorting.');
      ibBoost -= 1;
    } else {
      signals.push('📊 Price above VWAP — mild long lean on neutral day. Long setups above VWAP only.');
    }
  } else if (vwapRelation === 'below') {
    if (resolvedDir === 'short') {
      signals.push('📊 Price below VWAP — confirms short bias. Look for shorts on VWAP retest, not extended below it.');
      ibBoost += 1;
    } else if (resolvedDir === 'long') {
      signals.push('📊 Price below VWAP — conflicts with long bias. Same-day auction not confirming. Wait for VWAP reclaim before pressing longs.');
      ibBoost -= 1;
    } else {
      signals.push('📊 Price below VWAP — mild short lean on neutral day. Short setups below VWAP only.');
    }
  } else if (vwapRelation === 'at') {
    signals.push('📊 Price at VWAP — institutional pivot point. Wait for separation. Direction of break from VWAP sets intraday tone.');
  }

  // ── Step 9: ETH overnight level interaction ──
  // Overnight H/L are liquidity pools. Market sweeps them before moving.
  // Broke and HELD = directional confirmation, ~68-72% continuation.
  // Broke and REJECTED = failed sweep, likely reversal back inside overnight range.
  // Inside overnight range = no information from ETH yet.
  if (ethOvernight === 'broke_high_held') {
    if (resolvedDir === 'long') {
      signals.push('🌙 ETH broke overnight high + held — confirms long bias. Overnight level is now support (~68-72%).');
      ibBoost += 1;
    } else if (resolvedDir === 'short') {
      signals.push('🌙 ETH broke overnight high + held — conflicts with short bias. Wait for RTH to reject and close back below overnight high.');
      ibBoost -= 1;
    } else {
      signals.push('🌙 ETH broke overnight high + held — mild long lean. Overnight level is support.');
    }
  } else if (ethOvernight === 'broke_low_held') {
    if (resolvedDir === 'short') {
      signals.push('🌙 ETH broke overnight low + held — confirms short bias. Overnight level is now resistance (~68-72%).');
      ibBoost += 1;
    } else if (resolvedDir === 'long') {
      signals.push('🌙 ETH broke overnight low + held — conflicts with long bias. Wait for RTH to reject and close back above overnight low.');
      ibBoost -= 1;
    } else {
      signals.push('🌙 ETH broke overnight low + held — mild short lean. Overnight level is resistance.');
    }
  } else if (ethOvernight === 'broke_high_rejected') {
    signals.push('🌙 ETH swept overnight high but rejected — failed sweep. Bearish lean at that level. Stop hunt done, watch for RTH fade.');
    if (resolvedDir === 'short') ibBoost += 1;
  } else if (ethOvernight === 'broke_low_rejected') {
    signals.push('🌙 ETH swept overnight low but rejected — failed sweep. Bullish lean at that level. Stop hunt done, watch for RTH bounce.');
    if (resolvedDir === 'long') ibBoost += 1;
  } else if (ethOvernight === 'inside') {
    signals.push('🌙 RTH opened inside overnight range — no ETH breakout signal. Overnight H/L are live targets for RTH session.');
  } else if (ethOvernight === 'both_sides_touched') {
    signals.push('🌙 ETH touched both sides — no clean directional story. Overnight was two-sided with no resolution. Defer to IB development at 10:30. Overnight H/L are live execution levels only.');
  }

  // ── Conviction scoring ──
  // score = structural agreement (0-4) + same-day boost.
  //   >=4 → high (~68-75%), 2-3 → medium (~60-65%), <2 → low (~55-58%)
  const score = structuralAgreement + ibBoost;
  let conviction, sizing, biasLabel, color;

  if (resolvedDir === 'neutral') {
    conviction = 'neutral';
    sizing = 'Fade extremes only. No trend trades. Half size max.';
    biasLabel = 'neutral';
    color = C.yellow;
  } else {
    biasLabel = resolvedDir === 'long' ? 'bullish' : 'bearish';
    color = resolvedDir === 'long' ? C.green : C.red;
    if (score >= 4) {
      conviction = 'high';
      sizing = 'Full size. Hold runners. Highest-probability day when IB also confirms (~68-75%).';
    } else if (score >= 2) {
      conviction = 'medium';
      sizing = 'Standard size. Normal stops. Take clean setups only (~60-65%).';
    } else {
      conviction = 'low';
      sizing = 'Reduced size. Tighter stops. Base-rate edge only (~55-58%).';
    }
  }

  return { bias: biasLabel, conviction, sizing, signals, color };
}

function emptyBiasInputs() {
  return {
    prevDayCandle: '',
    insideDayCount: '0',
    profileShape: '',
    prevHighQuality: '', // 'excess'|'poor'|'normal'|''
    prevLowQuality: '',  // 'excess'|'poor'|'normal'|''
    tpoDistribution: '',
    pocMigration: '',
    edgeContext: '',
    ibSize: '',
    vaOverlap: '',
    ibLocation: '',
    vwapRelation: '',
    ethOvernight: '',
    ibBreakDir: '',
    ibTimeAcceptance: '',
    ibCVD: '',
    ibOppositeBreak: '', // 'no'|'yes_no_accept'|'yes_accepted'|''
  };
}

// ─── Mid-Session Update Engine ────────────────────────────────────────────────
function computeMidSession(bi, preBias) {
  const { ibBreakDir, ibTimeAcceptance, ibCVD, ibOppositeBreak } = bi;

  // Nothing entered yet
  if (!ibBreakDir) return null;

  // No clean break — original bias stands
  if (ibBreakDir === 'none') {
    return {
      updatedBias: preBias.bias,
      updatedConviction: preBias.conviction,
      verdict: 'No clean IB break. Original bias unchanged.',
      action: 'Continue with pre-market read. Wait for a cleaner setup.',
      color: C.textSub,
      effect: 'none',
    };
  }

  // Time acceptance not confirmed — break is unresolved
  if (ibTimeAcceptance === 'no') {
    // Both sides snapped through with no acceptance = pure noise, chop
    if (ibOppositeBreak === 'yes_no_accept') {
      return {
        updatedBias: 'neutral',
        updatedConviction: 'neutral',
        verdict: 'Both IB extremes snapped through — neither held. Choppy noise.',
        action: 'Price tested both sides and rejected both without acceptance. This is the choppiest possible scenario — no edge in either direction. Sit on hands. Do not trade.',
        color: C.yellow,
        effect: 'neutralized',
      };
    }
    return {
      updatedBias: preBias.bias,
      updatedConviction: preBias.conviction,
      verdict: 'IB break rejected — price returned inside within 15-30 min.',
      action: preBias.bias === 'bullish' && ibBreakDir === 'low'
        ? 'Failed break low with bullish bias. Potential long setup back to IB mid.'
        : preBias.bias === 'bearish' && ibBreakDir === 'high'
        ? 'Failed break high with bearish bias. Potential short setup back to IB mid.'
        : 'Failed break. Original bias stands. Wait for cleaner structure.',
      color: C.yellow,
      effect: 'none',
    };
  }

  // ── OPPOSITE IB EXTREME ALSO BROKEN ──
  // Check this before anything else once time acceptance is confirmed.
  if (ibOppositeBreak === 'yes_no_accept') {
    // Both sides broke but neither held with acceptance = pure chop.
    // Market explored both directions and found responsive activity on both sides.
    // ~70-75% probability of closing near middle or inside IB. No directional trade.
    return {
      updatedBias: 'neutral',
      updatedConviction: 'neutral',
      verdict: 'Both IB extremes broken — neither accepted. Double-sided chop.',
      action: 'Market explored both directions and rejected both. This is a choppy neutral day. Do not trade directionally. Fade both extremes if anything — minimum size only. Best move is to sit on hands.',
      color: C.yellow,
      effect: 'neutralized',
    };
  }

  if (ibOppositeBreak === 'yes_accepted') {
    // Both sides broke and the opposite side accepted = double distribution developing
    // OR structural reversal. Either way the original directional bias is dead.
    // The second break with acceptance is the dominant signal now.
    const secondDir = ibBreakDir === 'high' ? 'bearish' : 'bullish'; // opposite accepted = new direction
    return {
      updatedBias: 'neutral',
      updatedConviction: 'neutral',
      verdict: `Both IB extremes broken — opposite side accepted. Original bias neutralized.`,
      action: `Price broke ${ibBreakDir} first then reversed and accepted the ${ibBreakDir === 'high' ? 'low' : 'high'}. This is a structural reversal or double distribution day. Original ${preBias.bias} bias is dead. Do not fade the second break — go neutral. Wait for clear structure to emerge before re-engaging. If a second separate value area builds, trade the gap between them.`,
      color: C.orange,
      effect: 'neutralized',
    };
  }

  // Time acceptance confirmed — now check direction vs pre-market bias
  const breakDir = ibBreakDir === 'high' ? 'bullish' : 'bearish';
  const agrees = breakDir === preBias.bias;
  const priorWasNeutral = preBias.bias === 'neutral' || !preBias.bias;

  // CVD weight
  const cvdStrong = ibCVD === 'agreeing';
  const cvdDiverging = ibCVD === 'diverging';

  // ── SCENARIO 1: Neutral pre-market + clean break ──
  if (priorWasNeutral) {
    const newBias = breakDir;
    const conviction = cvdStrong ? 'medium' : cvdDiverging ? 'low' : 'low';
    return {
      updatedBias: newBias,
      updatedConviction: conviction,
      verdict: `Neutral day upgraded to ${newBias} by IB break ${ibBreakDir}.`,
      action: cvdDiverging
        ? 'CVD diverging — be cautious. Time acceptance is there but delta is not. Reduce size.'
        : `IB accepted ${ibBreakDir}. Look for ${newBias === 'bullish' ? 'long' : 'short'} setups on pullbacks to IB ${ibBreakDir === 'high' ? 'high' : 'low'} as support/resistance.`,
      color: newBias === 'bullish' ? C.green : C.red,
      effect: 'upgrade',
    };
  }

  // ── SCENARIO 2: Bias and break agree ──
  if (agrees) {
    const conviction = cvdDiverging ? 'medium' : 'high';
    return {
      updatedBias: preBias.bias,
      updatedConviction: conviction,
      verdict: `IB break ${ibBreakDir} confirms ${preBias.bias} bias.`,
      action: cvdDiverging
        ? 'Time accepted but CVD diverging. Confirmation is partial. Standard size, not full press.'
        : `Full confirmation. Press the ${preBias.bias === 'bullish' ? 'long' : 'short'} bias. IB ${ibBreakDir === 'high' ? 'high' : 'low'} is now your support/resistance. Hold runners.`,
      color: preBias.bias === 'bullish' ? C.green : C.red,
      effect: 'confirmed',
    };
  }

  // ── SCENARIO 3: Bias and break contradict ──
  if (cvdDiverging) {
    return {
      updatedBias: preBias.bias,
      updatedConviction: 'medium',
      verdict: `IB break ${ibBreakDir} contradicts bias but CVD is diverging — likely a trap.`,
      action: `Price broke ${ibBreakDir} but delta didn't confirm. High probability failed break. Watch for reversal back through IB ${ibBreakDir === 'high' ? 'high' : 'low'}. Original ${preBias.bias} bias may still be valid.`,
      color: C.yellow,
      effect: 'caution',
    };
  }

  return {
    updatedBias: 'neutral',
    updatedConviction: 'neutral',
    verdict: `IB break ${ibBreakDir} contradicts ${preBias.bias} bias with time + CVD confirmation.`,
    action: `Pre-market bias is wrong today. Stop looking for ${preBias.bias === 'bullish' ? 'longs' : 'shorts'}. Go neutral. Fade the range or sit on hands. Do not flip to ${preBias.bias === 'bullish' ? 'bearish' : 'bullish'} — one IB break is not a full structural reversal.`,
    color: C.orange,
    effect: 'neutralized',
  };
}

// ─── NQ + ES Alignment Engine ─────────────────────────────────────────────────
function computeAlignment(esResult, nqResult) {
  if (!esResult?.bias || !nqResult?.bias) return null;

  const esBias = esResult.bias;   // 'bullish'|'bearish'|'neutral'|''
  const nqBias = nqResult.bias;
  const esConv = esResult.conviction; // 'high'|'medium'|'low'|'neutral'|'fade'|'reclaim'|'edge-watch'
  const nqConv = nqResult.conviction;

  const convRank = { high:3, medium:2, low:1, neutral:0, fade:0, reclaim:1, 'edge-watch':0 };
  const esRank = convRank[esConv] || 0;
  const nqRank = convRank[nqConv] || 0;

  // ── Conflict ──
  if ((esBias === 'bullish' && nqBias === 'bearish') ||
      (esBias === 'bearish' && nqBias === 'bullish')) {
    return {
      alignment: 'conflict',
      color: C.orange,
      badge: 'CONFLICT',
      verdict: 'NQ and ES are pointing opposite directions.',
      action: 'Do not trade directionally. Sit on hands or take minimum size only. Wait for both instruments to agree before committing.',
      sizing: 'Minimum size or no trade.',
      combined: 'conflict',
    };
  }

  // ── Both neutral ──
  if (esBias === 'neutral' && nqBias === 'neutral') {
    return {
      alignment: 'both_neutral',
      color: C.yellow,
      badge: 'BOTH NEUTRAL',
      verdict: 'Both NQ and ES are in balance or at an edge. No directional trade.',
      action: 'Fade extremes only on both instruments. No trend trades. Half size max.',
      sizing: 'Fade extremes only. Half size max.',
      combined: 'neutral',
    };
  }

  // ── One neutral, one directional ──
  if (esBias === 'neutral' || nqBias === 'neutral') {
    const dirResult = esBias !== 'neutral' ? esResult : nqResult;
    const leadInstrument = esBias !== 'neutral' ? 'ES' : 'NQ';
    return {
      alignment: 'partial',
      color: C.yellow,
      badge: 'PARTIAL',
      verdict: `${leadInstrument} has a directional read but the other instrument is neutral.`,
      action: `Wait for the neutral instrument to confirm. If it does, conviction upgrades. Until then — reduced size, tighter stops, only the clearest setups.`,
      sizing: 'Reduced size. Wait for both to align.',
      combined: dirResult.bias,
    };
  }

  // ── Both neutral ──
  if (esBias === 'neutral' && nqBias === 'neutral') {
    return {
      alignment: 'both_neutral',
      color: C.yellow,
      badge: 'BOTH NEUTRAL',
      verdict: 'Both NQ and ES are in balance or at an edge. No directional trade.',
      action: 'Fade extremes only on both instruments. No trend trades. Half size max.',
      sizing: 'Fade extremes only. Half size max.',
      combined: 'neutral',
    };
  }

  // ── Both same direction ──
  const direction = esBias; // both equal at this point
  const totalRank = esRank + nqRank;
  let conv, action, sizing;

  if (totalRank >= 5) {
    conv = 'strong';
    action = `Both NQ and ES high conviction ${direction}. This is your best trade of the week. Full size. Hold runners to the next structural target. NQ will lead — use NQ breaks as entry trigger, ES confirmation as add.`;
    sizing = 'Full size. Hold runners.';
  } else if (totalRank >= 3) {
    conv = 'confirmed';
    action = `Both instruments confirm ${direction} bias. Take clean setups in bias direction on both. Standard size. NQ likely leads the move — watch NQ IB for the first break signal.`;
    sizing = 'Standard size. Take clean setups.';
  } else if (totalRank >= 2) {
    conv = 'moderate';
    action = `Both ${direction} but conviction is moderate on at least one. Trade the instrument with higher conviction first. Reduced size until the move confirms and both are pressing.`;
    sizing = 'Reduced size. Trade higher conviction instrument first.';
  } else {
    conv = 'weak';
    action = `Both lean ${direction} but conviction is low on both. Base rate edge only. Minimal size or sit out and wait for a cleaner structure session.`;
    sizing = 'Minimal size or sit out.';
  }

  const convColor = conv === 'strong' ? C.green : conv === 'confirmed' ? C.teal : conv === 'moderate' ? C.yellow : C.textMut;
  const dirColor = direction === 'bullish' ? C.green : direction === 'bearish' ? C.red : C.yellow;

  return {
    alignment: 'confirmed',
    color: dirColor,
    convColor,
    badge: conv.toUpperCase(),
    verdict: `NQ and ES both ${direction.toUpperCase()} — cross-instrument confirmation.`,
    action,
    sizing,
    combined: direction,
    esConvLabel: esConv,
    nqConvLabel: nqConv,
  };
}

function emptyDay(){
  return{
    pre:{
      esInputs: emptyBiasInputs(),
      esComputedBias: '',
      nqInputs: emptyBiasInputs(),
      nqComputedBias: '',
      dailyBias: '',
      alignmentBias: '',
      esImgTPO:'', esImg15:'',
      nqImgTPO:'', nqImg15:'',
      keyLevelsImg:'',
      esPlan:'',
      nqPlan:'',
      mentalSleep:'',
      mentalStress:'',
      mentalConfidence:'',
      mentalExterior:'',
    },
    trades:[newTrade()],
    eod:{emotions:'',well:'',fix:'',review:'',
      img15ES:'',imgTPOES:'',img15NQ:'',imgTPONQ:''},
  };
}
function newTrade(){return{ticker:'',direction:'',contracts:'',sl:'',plan:'',candle:'',result:'',points:'',emotions:'',notes:'',img1:'',img15:'',open:true};}
function useIsMobile(){
  const[mobile,setMobile]=useState(window.innerWidth<768);
  useEffect(()=>{
    const h=()=>setMobile(window.innerWidth<768);
    window.addEventListener('resize',h);
    return()=>window.removeEventListener('resize',h);
  },[]);
  return mobile;
}

// ─── Discord-style Lightbox ───────────────────────────────────────────────────
function Lightbox({src,onClose}){
  const[zoom,setZoom]=useState(1);
  const[pos,setPos]=useState({x:0,y:0});
  const[dragging,setDragging]=useState(false);
  const dragStart=useRef(null);
  const imgRef=useRef();

  useEffect(()=>{
    document.body.style.overflow='hidden';
    const esc=(e)=>{if(e.key==='Escape')onClose();};
    window.addEventListener('keydown',esc);
    return()=>{document.body.style.overflow='';window.removeEventListener('keydown',esc);};
  },[onClose]);

  const onWheel=useCallback((e)=>{
    e.preventDefault();
    const delta=e.deltaY>0?-0.15:0.15;
    setZoom(z=>Math.min(8,Math.max(1,z+delta)));
    if(zoom+delta<=1)setPos({x:0,y:0});
  },[zoom]);

  useEffect(()=>{
    const el=imgRef.current;
    if(!el)return;
    el.addEventListener('wheel',onWheel,{passive:false});
    return()=>el.removeEventListener('wheel',onWheel);
  },[onWheel]);

  const onMouseDown=(e)=>{
    if(zoom<=1)return;
    e.preventDefault();
    setDragging(true);
    dragStart.current={mx:e.clientX-pos.x,my:e.clientY-pos.y};
  };
  const onMouseMove=(e)=>{if(!dragging)return;setPos({x:e.clientX-dragStart.current.mx,y:e.clientY-dragStart.current.my});};
  const onMouseUp=()=>setDragging(false);

  const lastTouch=useRef(null);
  const onTouchStart=(e)=>{
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      lastTouch.current=Math.hypot(dx,dy);
    }
  };
  const onTouchMove=(e)=>{
    if(e.touches.length===2&&lastTouch.current){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const dist=Math.hypot(dx,dy);
      const delta=(dist-lastTouch.current)*0.01;
      setZoom(z=>Math.min(8,Math.max(1,z+delta)));
      lastTouch.current=dist;
    }
  };

  const zoomPct=Math.round(zoom*100);
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'#000000ee',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
      <div onClick={e=>e.stopPropagation()} style={{position:'fixed',top:0,left:0,right:0,height:52,background:'#111111cc',backdropFilter:'blur(12px)',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',zIndex:10000,borderBottom:`1px solid ${C.border}`}}>
        <span style={{fontSize:13,color:C.textSub,fontFamily:'inherit'}}>📷 Chart Preview</span>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>{setZoom(z=>Math.max(1,+(z-0.25).toFixed(2)));}} style={btnStyle}>−</button>
          <span style={{fontSize:12,color:C.textSub,minWidth:40,textAlign:'center',fontVariantNumeric:'tabular-nums'}}>{zoomPct}%</span>
          <button onClick={()=>setZoom(z=>Math.min(8,+(z+0.25).toFixed(2)))} style={btnStyle}>+</button>
          <button onClick={()=>{setZoom(1);setPos({x:0,y:0});}} style={{...btnStyle,fontSize:11,padding:'0 10px',width:'auto'}}>Reset</button>
          <div style={{width:1,height:24,background:C.border,margin:'0 4px'}}/>
          <button onClick={onClose} style={{...btnStyle,color:C.red}}>✕</button>
        </div>
      </div>
      <div
        ref={imgRef}
        onClick={e=>e.stopPropagation()}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        style={{
          marginTop:52,
          transform:`scale(${zoom}) translate(${pos.x/zoom}px,${pos.y/zoom}px)`,
          transformOrigin:'center center',
          cursor:zoom>1?(dragging?'grabbing':'grab'):'zoom-in',
          transition:dragging?'none':'transform 0.1s',
        }}
      >
        <img src={src} alt="chart" style={{maxWidth:'92vw',maxHeight:'calc(92vh - 52px)',borderRadius:6,display:'block',boxShadow:'0 8px 40px #00000088'}}/>
      </div>
      {zoom===1&&<div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',fontSize:11,color:C.textMut,background:'#111111cc',padding:'6px 14px',borderRadius:20,backdropFilter:'blur(8px)'}}>
        Scroll to zoom · Drag to pan · Esc to close
      </div>}
    </div>
  );
}
const btnStyle={background:'#1e1e1e',border:`1px solid ${C.border}`,borderRadius:7,color:C.textSub,width:34,height:34,cursor:'pointer',fontSize:16,fontFamily:'inherit',fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center'};

// ─── Image Slot ───────────────────────────────────────────────────────────────
function ImageSlot({label,value,onChange,accent}){
  const[drag,setDrag]=useState(false);
  const[lightbox,setLightbox]=useState(false);
  const[pasteActive,setPasteActive]=useState(false);
  const fileRef=useRef();
  const zoneRef=useRef();

  const processFile=useCallback((file)=>{
    if(!file||!file.type.startsWith('image/'))return;
    const reader=new FileReader();
    reader.onload=(e)=>onChange(e.target.result);
    reader.readAsDataURL(file);
  },[onChange]);

  const processClipboard=useCallback((clipData)=>{
    if(!clipData?.items)return;
    for(const item of clipData.items){
      if(item.type.startsWith('image/')){processFile(item.getAsFile());break;}
    }
  },[processFile]);

  useEffect(()=>{
    if(!pasteActive)return;
    const handler=(e)=>{
      e.preventDefault();
      e.stopPropagation();
      processClipboard(e.clipboardData);
      setPasteActive(false);
    };
    window.addEventListener('paste',handler,true);
    const outside=(e)=>{if(zoneRef.current&&!zoneRef.current.contains(e.target))setPasteActive(false);};
    window.addEventListener('mousedown',outside);
    return()=>{window.removeEventListener('paste',handler,true);window.removeEventListener('mousedown',outside);};
  },[pasteActive,processClipboard]);

  const borderCol=pasteActive?C.yellow:drag?C.green:value?C.border:`${C.border}`;
  const accentCol=accent||C.blue;

  return(
    <>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,color:C.textSub,marginBottom:6,letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
          <span style={{width:6,height:6,borderRadius:'50%',background:accentCol,display:'inline-block'}}/>
          {label}
        </div>
        <div
          ref={zoneRef}
          onClick={()=>{if(value){return;}setPasteActive(true);}}
          onDragOver={(e)=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)}
          onDrop={(e)=>{e.preventDefault();setDrag(false);processFile(e.dataTransfer.files[0]);}}
          style={{
            border:`1.5px ${value?'solid':'dashed'} ${borderCol}`,
            borderRadius:10,minHeight:value?'auto':82,
            display:'flex',alignItems:'center',justifyContent:'center',
            cursor:value?'default':'pointer',overflow:'hidden',
            background:pasteActive?C.yellow+'08':drag?C.green+'08':C.surface,
            transition:'all 0.15s',position:'relative',
          }}
        >
          {value?(
            <>
              <img src={value} alt={label} onClick={(e)=>{e.stopPropagation();setLightbox(true);}}
                style={{width:'100%',display:'block',borderRadius:9,cursor:'zoom-in'}}/>
              <div style={{position:'absolute',top:7,right:7,display:'flex',gap:6}}>
                <button onClick={(e)=>{e.stopPropagation();setLightbox(true);}}
                  style={{background:'#000000bb',border:`1px solid ${C.border}`,borderRadius:6,color:C.textSub,fontSize:11,padding:'4px 9px',cursor:'pointer'}}>⤢</button>
                <button onClick={(e)=>{e.stopPropagation();onChange('');}}
                  style={{background:'#000000bb',border:`1px solid ${C.border}`,borderRadius:6,color:C.red,fontSize:11,padding:'4px 8px',cursor:'pointer'}}>✕</button>
              </div>
            </>
          ):(
            <div style={{textAlign:'center',padding:'14px 10px'}}>
              {pasteActive?(
                <>
                  <div style={{fontSize:20,marginBottom:6}}>📋</div>
                  <div style={{color:C.yellow,fontSize:12,fontWeight:700}}>Ready — press Ctrl+V</div>
                  <div style={{color:C.textDim,fontSize:10,marginTop:3}}>or click elsewhere to cancel</div>
                </>
              ):(
                <>
                  <div style={{fontSize:18,marginBottom:5}}>📎</div>
                  <div style={{color:C.textMut,fontSize:11,lineHeight:1.6}}>
                    Drop · Browse · <span style={{color:accentCol}}>Click then Ctrl+V</span>
                  </div>
                </>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={(e)=>processFile(e.target.files[0])}/>
        </div>
        {!value&&!pasteActive&&(
          <button onClick={()=>fileRef.current.click()} style={{marginTop:4,background:'none',border:'none',color:C.textDim,fontSize:10,cursor:'pointer',fontFamily:'inherit',padding:'2px 0'}}>browse files</button>
        )}
      </div>
      {lightbox&&<Lightbox src={value} onClose={()=>setLightbox(false)}/>}
    </>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────
function Pills({options,value,onChange,colors}){
  return(
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      {options.map((o)=>{
        const active=value===o.value;
        const col=colors?.[o.value]||C.text;
        return(
          <button key={o.value} onClick={()=>onChange(active?'':o.value)} style={{
            padding:'7px 18px',borderRadius:20,
            border:active?`1.5px solid ${col}`:`1.5px solid ${C.border}`,
            background:active?col+'22':'transparent',
            color:active?col:C.textMut,fontSize:13,fontFamily:'inherit',
            cursor:'pointer',fontWeight:active?700:400,
            letterSpacing:'0.03em',transition:'all 0.15s',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function Field({label,placeholder,value,onChange,rows=3}){
  return(
    <div style={{marginBottom:20}}>
      <div style={{fontSize:11,color:C.textSub,marginBottom:7,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>{label}</div>
      <textarea value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{
        width:'100%',background:C.surface,border:`1.5px solid ${C.border}`,
        borderRadius:10,color:C.text,fontSize:14,padding:'11px 14px',
        resize:'vertical',fontFamily:'inherit',lineHeight:1.7,outline:'none',boxSizing:'border-box',
      }} onFocus={(e)=>e.target.style.borderColor=C.border2} onBlur={(e)=>e.target.style.borderColor=C.border}/>
    </div>
  );
}

function Input({label,value,onChange,type='text'}){
  return(
    <div style={{marginBottom:16}}>
      <div style={{fontSize:11,color:C.textSub,marginBottom:7,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>{label}</div>
      <input type={type} value={value} onChange={(e)=>onChange(e.target.value)} style={{
        width:'100%',background:C.surface,border:`1.5px solid ${C.border}`,
        borderRadius:10,color:C.text,fontSize:14,padding:'10px 14px',
        fontFamily:'inherit',outline:'none',boxSizing:'border-box',
      }} onFocus={(e)=>e.target.style.borderColor=C.border2} onBlur={(e)=>e.target.style.borderColor=C.border}/>
    </div>
  );
}

function Divider({label}){
  return(
    <div style={{display:'flex',alignItems:'center',gap:12,margin:'26px 0 20px'}}>
      <div style={{flex:1,height:1,background:C.surface2}}/>
      {label&&<span style={{fontSize:10,color:C.textMut,letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:600}}>{label}</span>}
      <div style={{flex:1,height:1,background:C.surface2}}/>
    </div>
  );
}

function StatBox({label,val,color}){
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:'11px 12px',textAlign:'center'}}>
      <div style={{fontSize:10,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:5}}>{label}</div>
      <div style={{fontSize:15,fontWeight:700,color:color||C.text,fontVariantNumeric:'tabular-nums'}}>{val}</div>
    </div>
  );
}

function InstrumentLabel({name,color}){
  return(
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,marginTop:4}}>
      <div style={{width:3,height:32,background:color,borderRadius:2}}/>
      <div>
        <div style={{fontSize:14,fontWeight:800,color:color}}>{name}</div>
        <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.08em'}}>CHARTS</div>
      </div>
    </div>
  );
}

// ─── Bias Engine UI ───────────────────────────────────────────────────────────
function SectionLabel({children}){
  return <div style={{fontSize:10,color:C.textSub,marginBottom:8,letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600}}>{children}</div>;
}

function BiasEnginePanel({biasInputs, onChange, result, preBiasResult}){
  const set = k => v => onChange({...biasInputs, [k]: v});
  const midSession = computeMidSession(biasInputs, preBiasResult || result);

  const convictionColors = {
    high: C.green, medium: C.yellow, low: C.orange,
    neutral: C.yellow, fade: C.orange, override: C.yellow,
    'edge-watch': C.yellow, reclaim: C.blue, '': C.textMut
  };

  const displayResult = {...result, midSession};

  return(
    <div>
      {/* ── OUTPUT CARD ── */}
      {displayResult.bias && (
        <div style={{
          background: displayResult.color+'12',
          border:`1.5px solid ${displayResult.color}44`,
          borderRadius:14,padding:'18px 20px',marginBottom:28,
        }}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
            <div>
              <div style={{fontSize:11,color:C.textMut,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:4}}>Pre-Market Bias</div>
              <div style={{fontSize:26,fontWeight:800,color:displayResult.color,textTransform:'uppercase',letterSpacing:'0.06em'}}>
                {displayResult.bias === 'bullish' ? '🟢' : displayResult.bias === 'bearish' ? '🔴' : '⚪'} {displayResult.bias}
              </div>
            </div>
            {displayResult.conviction && (
              <div style={{
                padding:'6px 14px',borderRadius:20,
                background:convictionColors[displayResult.conviction]+'22',
                border:`1px solid ${convictionColors[displayResult.conviction]}44`,
                fontSize:12,fontWeight:700,
                color:convictionColors[displayResult.conviction],
                textTransform:'uppercase',letterSpacing:'0.08em',
              }}>{displayResult.conviction}</div>
            )}
          </div>
          {displayResult.sizing && (
            <div style={{fontSize:13,color:C.textSub,lineHeight:1.6,marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${C.border}`}}>
              {displayResult.sizing}
            </div>
          )}
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {displayResult.signals.map((s,i)=>(
              <div key={i} style={{fontSize:12,color:C.textMut,lineHeight:1.5}}>{s}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── SECTION A: Pre-market inputs ── */}
      <div style={{fontSize:11,color:C.blue,letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:700,marginBottom:16,display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:3,height:14,background:C.blue,borderRadius:2}}/>
        Pre-Market Inputs
      </div>

      {/* Prior day candle */}
      <div style={{marginBottom:18}}>
        <SectionLabel>Prior day body (close vs open, no wicks)</SectionLabel>
        <Pills
          options={[
            {label:'🟢 Green close',value:'green'},
            {label:'🔴 Red close',value:'red'},
            {label:'⚪ Inside day',value:'inside'},
          ]}
          value={biasInputs.prevDayCandle}
          onChange={set('prevDayCandle')}
          colors={{green:C.green,red:C.red,inside:'#aaa'}}
        />
      </div>

      {/* Inside day count — only show if inside or if count > 0 */}
      {(biasInputs.prevDayCandle === 'inside' || parseInt(biasInputs.insideDayCount) > 0) && (
        <div style={{marginBottom:18}}>
          <SectionLabel>Consecutive inside days</SectionLabel>
          <Pills
            options={[{label:'1',value:'1'},{label:'2',value:'2'},{label:'3+',value:'3'}]}
            value={biasInputs.insideDayCount}
            onChange={set('insideDayCount')}
            colors={{1:C.yellow,2:C.orange,3:C.red}}
          />
        </div>
      )}

      {/* Profile shape */}
      <div style={{marginBottom:18}}>
        <SectionLabel>Prior day profile shape</SectionLabel>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {[
            {label:'D — Trend',value:'D',col:C.purple},
            {label:'B — Double dist. long',value:'B',col:C.green},
            {label:'b — Trapped shorts',value:'b',col:C.teal},
            {label:'P — Spike rejected',value:'P',col:C.red},
            {label:'Normal bell',value:'normal',col:'#aaa'},
            {label:'Single prints',value:'single_prints',col:C.yellow},
          ].map(o=>{
            const active=biasInputs.profileShape===o.value;
            return(
              <button key={o.value} onClick={()=>set('profileShape')(active?'':o.value)} style={{
                padding:'7px 14px',borderRadius:20,
                border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                background:active?o.col+'22':'transparent',
                color:active?o.col:C.textMut,fontSize:12,fontFamily:'inherit',
                cursor:'pointer',fontWeight:active?700:400,transition:'all 0.15s',
              }}>{o.label}</button>
            );
          })}
        </div>
      </div>

      {/* Prior day extreme quality */}
      <div style={{marginBottom:18}}>
        <SectionLabel>Prior day HIGH quality</SectionLabel>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            {label:'Excess — clean seller rejection',value:'excess',col:C.red,sub:'High defended, structural resistance (~65-70% holds)'},
            {label:'Poor — unfinished auction above',value:'poor',col:C.green,sub:'Upside magnetic, high is a target next session'},
            {label:'Normal — nothing notable',value:'normal',col:'#aaa',sub:'No extra information from the high'},
          ].map(o=>{
            const active=biasInputs.prevHighQuality===o.value;
            return(
              <button key={o.value} onClick={()=>set('prevHighQuality')(active?'':o.value)} style={{
                padding:'9px 14px',borderRadius:10,textAlign:'left',
                border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                background:active?o.col+'18':'transparent',
                cursor:'pointer',transition:'all 0.15s',fontFamily:'inherit',
                display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,
              }}>
                <span style={{color:active?o.col:C.textSub,fontSize:13,fontWeight:active?700:400}}>{o.label}</span>
                <span style={{color:active?o.col:C.textDim,fontSize:11,flexShrink:0}}>{o.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{marginBottom:18}}>
        <SectionLabel>Prior day LOW quality</SectionLabel>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            {label:'Excess — clean buyer rejection',value:'excess',col:C.green,sub:'Low defended, structural support (~65-70% holds)'},
            {label:'Poor — unfinished auction below',value:'poor',col:C.red,sub:'Downside magnetic, low is a target next session'},
            {label:'Normal — nothing notable',value:'normal',col:'#aaa',sub:'No extra information from the low'},
          ].map(o=>{
            const active=biasInputs.prevLowQuality===o.value;
            return(
              <button key={o.value} onClick={()=>set('prevLowQuality')(active?'':o.value)} style={{
                padding:'9px 14px',borderRadius:10,textAlign:'left',
                border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                background:active?o.col+'18':'transparent',
                cursor:'pointer',transition:'all 0.15s',fontFamily:'inherit',
                display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,
              }}>
                <span style={{color:active?o.col:C.textSub,fontSize:13,fontWeight:active?700:400}}>{o.label}</span>
                <span style={{color:active?o.col:C.textDim,fontSize:11,flexShrink:0}}>{o.sub}</span>
              </button>
            );
          })}
        </div>
        <div style={{fontSize:11,color:C.textDim,marginTop:8,lineHeight:1.5}}>
          Only log excess when it is unambiguous — single or two isolated letters at the extreme, sharp rejection, price left fast. If you have to think about it, select Normal.
        </div>
      </div>

      {/* TPO distribution */}
      <div style={{marginBottom:18}}>
        <SectionLabel>TPO letter distribution (where did most letters print?)</SectionLabel>
        <Pills
          options={[
            {label:'⬆ Upper half',value:'upper'},
            {label:'⬇ Lower half',value:'lower'},
          ]}
          value={biasInputs.tpoDistribution}
          onChange={set('tpoDistribution')}
          colors={{upper:C.green,lower:C.red}}
        />
      </div>

      {/* POC migration */}
      <div style={{marginBottom:18}}>
        <SectionLabel>POC migration (last 3–5 sessions)</SectionLabel>
        <Pills
          options={[
            {label:'↗ Rising',value:'rising'},
            {label:'➡ Flat',value:'flat'},
            {label:'↘ Falling',value:'falling'},
          ]}
          value={biasInputs.pocMigration}
          onChange={set('pocMigration')}
          colors={{rising:C.green,flat:'#aaa',falling:C.red}}
        />
      </div>

      {/* Multi-day balance edge */}
      <div style={{marginBottom:24}}>
        <SectionLabel>Multi-day balance edge context</SectionLabel>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            {label:'Not at an edge — open space',value:'none',col:C.teal,sub:'Bias runs normally'},
            {label:'⬆ At HIGH edge, from inside',value:'high_from_inside',col:C.yellow,sub:'Failed exp short / breakout long'},
            {label:'⬇ At LOW edge, from inside',value:'low_from_inside',col:C.yellow,sub:'Failed exp long / breakout short'},
            {label:'↩ Returning to HIGH edge from above',value:'high_from_above',col:C.green,sub:'Edge = support, reclaim, lean long'},
            {label:'↪ Returning to LOW edge from below',value:'low_from_below',col:C.red,sub:'Edge = resistance, reclaim, lean short'},
            {label:'❌ Failed breakout HIGH — back inside overnight',value:'failed_break_high',col:C.red,sub:'Trapped longs above, lean short (~68-72%)'},
            {label:'❌ Failed breakout LOW — back inside overnight',value:'failed_break_low',col:C.green,sub:'Trapped shorts below, lean long (~68-72%)'},
            {label:'🔄 Low edge tapped prior/overnight + held — now in middle',value:'tapped_low_now_middle',col:C.green,sub:'Buyers proved, bullish lean toward high edge (~60-65%)'},
            {label:'🔄 High edge tapped prior/overnight + held — now in middle',value:'tapped_high_now_middle',col:C.red,sub:'Sellers proved, bearish lean toward low edge (~60-65%)'},
            {label:'🚀 Failed expansion LOW — already back in middle',value:'failed_exp_low_now_middle',col:C.green,sub:'Squeeze in progress, highest conviction bullish (~65-72%)'},
            {label:'💥 Failed expansion HIGH — already back in middle',value:'failed_exp_high_now_middle',col:C.red,sub:'Squeeze in progress, highest conviction bearish (~65-72%)'},
          ].map(o=>{
            const active=biasInputs.edgeContext===o.value;
            return(
              <button key={o.value} onClick={()=>set('edgeContext')(active?'':o.value)} style={{
                padding:'10px 14px',borderRadius:10,textAlign:'left',
                border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                background:active?o.col+'18':'transparent',
                cursor:'pointer',transition:'all 0.15s',fontFamily:'inherit',
                display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,
              }}>
                <span style={{color:active?o.col:C.textSub,fontSize:13,fontWeight:active?700:400}}>{o.label}</span>
                <span style={{color:active?o.col:C.textDim,fontSize:11,opacity:0.8,flexShrink:0}}>{o.sub}</span>
              </button>
            );
          })}
        </div>
        <div style={{fontSize:11,color:C.textDim,marginTop:8,lineHeight:1.5}}>
          Balance is fractal — applies to whatever range governs price on your timeframe. From inside = neutral two-sided watch. Returning to edge = directional reclaim lean. Failed breakout overnight = strong signal near the edge. Tapped edge + now in middle = buyers/sellers proved themselves, directional lean toward opposite edge. Failed expansion + already in middle = squeeze in progress, highest conviction — entry on pullbacks not at original level.
        </div>
      </div>

      {/* ── SECTION B: Same-day inputs (10:30 check) ── */}
      <div style={{fontSize:11,color:C.purple,letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:700,marginBottom:16,display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:3,height:14,background:C.purple,borderRadius:2}}/>
        Same-Day Inputs (10:30 EST)
      </div>

      {/* IB size */}
      <div style={{marginBottom:18}}>
        <SectionLabel>IB size vs prior day ATR</SectionLabel>
        <Pills
          options={[
            {label:'Short &lt;50%',value:'short'},
            {label:'Medium 50–100%',value:'medium'},
            {label:'Large &gt;100%',value:'large'},
          ]}
          value={biasInputs.ibSize}
          onChange={set('ibSize')}
          colors={{short:C.teal,medium:'#aaa',large:C.orange}}
        />
        <div style={{fontSize:11,color:C.textDim,marginTop:6,lineHeight:1.5}}>
          Short → trending day. Medium → carry bias. Large → fade posture regardless of bias.
        </div>
      </div>

      {/* VA overlap */}
      <div style={{marginBottom:18}}>
        <SectionLabel>Value area overlap with prior session</SectionLabel>
        <Pills
          options={[
            {label:'Heavy overlap',value:'heavy'},
            {label:'No overlap / gap',value:'none'},
          ]}
          value={biasInputs.vaOverlap}
          onChange={set('vaOverlap')}
          colors={{heavy:C.yellow,none:C.blue}}
        />
        <div style={{fontSize:11,color:C.textDim,marginTop:6}}>Heavy → balanced day likely. No overlap → trend day probability up.</div>
      </div>

      {/* IB location at 10:30 */}
      <div style={{marginBottom:8}}>
        <SectionLabel>Where is price in the IB at 10:30? (same-day read)</SectionLabel>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            {label:'⬆ Upper quarter',value:'upper',col:C.green,sub:'Buyers held high ground (~62-68% bullish cont.)'},
            {label:'↔ Middle',value:'middle',col:C.yellow,sub:'Rotational, balanced day likely (~70-75%)'},
            {label:'⬇ Lower quarter',value:'lower',col:C.red,sub:'Sellers held low ground (~62-68% bearish cont.)'},
          ].map(o=>{
            const active=biasInputs.ibLocation===o.value;
            return(
              <button key={o.value} onClick={()=>set('ibLocation')(active?'':o.value)} style={{
                padding:'10px 14px',borderRadius:10,textAlign:'left',
                border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                background:active?o.col+'18':'transparent',
                cursor:'pointer',transition:'all 0.15s',fontFamily:'inherit',
                display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,
              }}>
                <span style={{color:active?o.col:C.textSub,fontSize:13,fontWeight:active?700:400}}>{o.label}</span>
                <span style={{color:active?o.col:C.textDim,fontSize:11,flexShrink:0}}>{o.sub}</span>
              </button>
            );
          })}
        </div>
        <div style={{fontSize:11,color:C.textDim,marginTop:8,lineHeight:1.5}}>
          Upper or lower quarter confirms or conflicts with your bias. Middle = balanced, fade extremes, tighten targets. Direction matters — upper quarter on a short bias day reduces conviction, not adds.
        </div>
      </div>

      {/* VWAP relationship at 10:30 */}
      <div style={{marginBottom:8}}>
        <SectionLabel>Price vs VWAP at 10:30</SectionLabel>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            {label:'⬆ Above VWAP',value:'above',col:C.green,sub:'Confirms long bias / conflicts with short'},
            {label:'↔ At VWAP',value:'at',col:C.yellow,sub:'Pivot point — wait for separation'},
            {label:'⬇ Below VWAP',value:'below',col:C.red,sub:'Confirms short bias / conflicts with long'},
          ].map(o=>{
            const active=biasInputs.vwapRelation===o.value;
            return(
              <button key={o.value} onClick={()=>set('vwapRelation')(active?'':o.value)} style={{
                padding:'10px 14px',borderRadius:10,textAlign:'left',
                border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                background:active?o.col+'18':'transparent',
                cursor:'pointer',transition:'all 0.15s',fontFamily:'inherit',
                display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,
              }}>
                <span style={{color:active?o.col:C.textSub,fontSize:13,fontWeight:active?700:400}}>{o.label}</span>
                <span style={{color:active?o.col:C.textDim,fontSize:11,flexShrink:0}}>{o.sub}</span>
              </button>
            );
          })}
        </div>
        <div style={{fontSize:11,color:C.textDim,marginTop:8,lineHeight:1.5}}>
          VWAP is the institutional intraday reference. Bias + VWAP agreement = highest quality entry zone. Conflict = wait for VWAP flip before pressing. Never enter long extended far above VWAP or short extended far below it — enter on the retest.
        </div>
      </div>

      {/* ETH overnight level */}
      <div style={{marginBottom:18}}>
        <SectionLabel>ETH overnight level interaction</SectionLabel>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            {label:'Inside overnight range',value:'inside',col:'#aaa',sub:'Overnight H/L are live RTH targets'},
            {label:'⬆ Broke overnight HIGH + held',value:'broke_high_held',col:C.green,sub:'Level is support (~68-72% cont.)'},
            {label:'⬆ Swept overnight HIGH + rejected',value:'broke_high_rejected',col:C.orange,sub:'Stop hunt done — watch RTH fade'},
            {label:'⬇ Broke overnight LOW + held',value:'broke_low_held',col:C.red,sub:'Level is resistance (~68-72% cont.)'},
            {label:'⬇ Swept overnight LOW + rejected',value:'broke_low_rejected',col:C.orange,sub:'Stop hunt done — watch RTH bounce'},
            {label:'↕ Both sides touched — no clean story',value:'both_sides_touched',col:'#aaa',sub:'Two-sided overnight, no signal — defer to IB at 10:30'},
          ].map(o=>{
            const active=biasInputs.ethOvernight===o.value;
            return(
              <button key={o.value} onClick={()=>set('ethOvernight')(active?'':o.value)} style={{
                padding:'9px 14px',borderRadius:10,textAlign:'left',
                border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                background:active?o.col+'18':'transparent',
                cursor:'pointer',transition:'all 0.15s',fontFamily:'inherit',
                display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,
              }}>
                <span style={{color:active?o.col:C.textSub,fontSize:12,fontWeight:active?700:400}}>{o.label}</span>
                <span style={{color:active?o.col:C.textDim,fontSize:11,flexShrink:0}}>{o.sub}</span>
              </button>
            );
          })}
        </div>
        <div style={{fontSize:11,color:C.textDim,marginTop:8,lineHeight:1.5}}>
          Never take your first trade before the overnight H/L has been swept or clearly respected. Wait for the sweep — then enter on the rejection.
        </div>
      </div>

      <div style={{height:1,background:C.surface2,margin:'28px 0 24px'}}/>
      <div style={{fontSize:11,color:C.orange,letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:700,marginBottom:6,display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:3,height:14,background:C.orange,borderRadius:2}}/>
        Mid-Session IB Update
      </div>
      <div style={{fontSize:11,color:C.textDim,marginBottom:18,lineHeight:1.6}}>
        Fill in after IB forms and price has had 15–30 min to accept or reject a break.
      </div>

      {/* ── SECTION C: Mid-session IB breakout update ── */}
      <div style={{marginBottom:18}}>
        <SectionLabel>Did IB break?</SectionLabel>
        <Pills
          options={[
            {label:'⬆ Broke high',value:'high'},
            {label:'⬇ Broke low',value:'low'},
            {label:'No clean break',value:'none'},
          ]}
          value={biasInputs.ibBreakDir}
          onChange={set('ibBreakDir')}
          colors={{high:C.green,low:C.red,none:'#aaa'}}
        />
      </div>

      {/* Time acceptance — only show if break happened */}
      {(biasInputs.ibBreakDir === 'high' || biasInputs.ibBreakDir === 'low') && (
        <>
          {/* Opposite IB extreme — show immediately after any break logged */}
          <div style={{marginBottom:18}}>
            <SectionLabel>Did price also break the opposite IB extreme?</SectionLabel>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {[
                {label:'No — single sided break only',value:'no',col:C.teal,sub:'Normal scenario'},
                {label:'Yes — opposite broke but snapped back',value:'yes_no_accept',col:C.yellow,sub:'Both sides tested, neither held — chop, go neutral'},
                {label:'Yes — opposite broke and accepted',value:'yes_accepted',col:C.red,sub:'Double distribution or reversal — bias dead'},
              ].map(o=>{
                const active=biasInputs.ibOppositeBreak===o.value;
                return(
                  <button key={o.value} onClick={()=>set('ibOppositeBreak')(active?'':o.value)} style={{
                    padding:'9px 14px',borderRadius:10,textAlign:'left',
                    border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                    background:active?o.col+'18':'transparent',
                    cursor:'pointer',transition:'all 0.15s',fontFamily:'inherit',
                    display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,
                  }}>
                    <span style={{color:active?o.col:C.textSub,fontSize:13,fontWeight:active?700:400}}>{o.label}</span>
                    <span style={{color:active?o.col:C.textDim,fontSize:11,flexShrink:0}}>{o.sub}</span>
                  </button>
                );
              })}
            </div>
            <div style={{fontSize:11,color:C.textDim,marginTop:8,lineHeight:1.5}}>
              Log this first — if both sides snapped, stop here. If single sided, continue below.
            </div>
          </div>

          {/* Only show time acceptance if opposite break was single sided or not yet selected */}
          {(biasInputs.ibOppositeBreak === 'no' || !biasInputs.ibOppositeBreak) && (
            <>
              <div style={{marginBottom:18}}>
                <SectionLabel>Time acceptance (15–30 min held outside IB)?</SectionLabel>
                <Pills
                  options={[
                    {label:'✓ Yes — held outside',value:'yes'},
                    {label:'✗ No — snapped back inside',value:'no'},
                  ]}
                  value={biasInputs.ibTimeAcceptance}
                  onChange={set('ibTimeAcceptance')}
                  colors={{yes:C.green,no:C.red}}
                />
                <div style={{fontSize:11,color:C.textDim,marginTop:6}}>
                  Yes = new TPO letters building outside IB. No = price returned inside quickly.
                </div>
              </div>

              {/* CVD — only show if time accepted */}
              {biasInputs.ibTimeAcceptance === 'yes' && (
                <div style={{marginBottom:18}}>
                  <SectionLabel>CVD agreement with break direction?</SectionLabel>
                  <Pills
                    options={[
                      {label:'Agreeing',value:'agreeing'},
                      {label:'Flat',value:'flat'},
                      {label:'Diverging',value:'diverging'},
                    ]}
                    value={biasInputs.ibCVD}
                    onChange={set('ibCVD')}
                    colors={{agreeing:C.green,flat:'#aaa',diverging:C.red}}
                  />
                  <div style={{fontSize:11,color:C.textDim,marginTop:6,lineHeight:1.5}}>
                    Agreeing = delta moving with price. Flat = no delta participation. Diverging = delta opposite to price — potential trap.
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Mid-session output card */}
      {displayResult.midSession && (
        <div style={{
          background: displayResult.midSession.color+'12',
          border:`1.5px solid ${displayResult.midSession.color}44`,
          borderRadius:14,padding:'16px 18px',marginTop:8,
        }}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <div style={{fontSize:11,color:C.textMut,letterSpacing:'0.1em',textTransform:'uppercase'}}>Updated Bias</div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              {displayResult.midSession.effect && displayResult.midSession.effect !== 'none' && (
                <div style={{
                  fontSize:10,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',
                  padding:'3px 10px',borderRadius:20,
                  background: displayResult.midSession.effect === 'confirmed' ? C.green+'22'
                    : displayResult.midSession.effect === 'upgrade' ? C.blue+'22'
                    : displayResult.midSession.effect === 'neutralized' ? C.orange+'22'
                    : C.yellow+'22',
                  color: displayResult.midSession.effect === 'confirmed' ? C.green
                    : displayResult.midSession.effect === 'upgrade' ? C.blue
                    : displayResult.midSession.effect === 'neutralized' ? C.orange
                    : C.yellow,
                }}>
                  {displayResult.midSession.effect === 'confirmed' ? '✓ Confirmed'
                    : displayResult.midSession.effect === 'upgrade' ? '↑ Upgraded'
                    : displayResult.midSession.effect === 'neutralized' ? '⚠ Neutralized'
                    : displayResult.midSession.effect === 'caution' ? '⚡ Caution'
                    : '— No change'}
                </div>
              )}
              <div style={{fontSize:18,fontWeight:800,color:displayResult.midSession.color,textTransform:'uppercase'}}>
                {displayResult.midSession.updatedBias === 'bullish' ? '🟢'
                  : displayResult.midSession.updatedBias === 'bearish' ? '🔴' : '⚪'} {displayResult.midSession.updatedBias}
              </div>
            </div>
          </div>
          <div style={{fontSize:13,color:displayResult.midSession.color,fontWeight:600,marginBottom:8}}>
            {displayResult.midSession.verdict}
          </div>
          <div style={{fontSize:12,color:C.textSub,lineHeight:1.6}}>
            {displayResult.midSession.action}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pre-Market Tab ───────────────────────────────────────────────────────────
function MentalStatePanel({data, onChange}){
  const set = k => v => onChange({...data, [k]: v === data[k] ? '' : v});

  const mentalWarnings = [];
  if (data.mentalSleep === 'poor' || data.mentalSleep === 'terrible') mentalWarnings.push('poor sleep');
  if (data.mentalStress === 'elevated' || data.mentalStress === 'high') mentalWarnings.push('elevated stress');
  if (data.mentalConfidence === 'shaky') mentalWarnings.push('shaky confidence');
  if (data.mentalExterior === 'personal' || data.mentalExterior === 'distracted') mentalWarnings.push('external distractions');
  const hasWarning = mentalWarnings.length >= 2;
  const hasSevere = data.mentalSleep === 'terrible' || data.mentalStress === 'high' || data.mentalConfidence === 'shaky';

  return(
    <div>
      {/* Sleep */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Sleep</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[{v:'great',l:'Great 7-8h',c:C.green},{v:'ok',l:'OK 5-6h',c:C.teal},{v:'poor',l:'Poor 3-4h',c:C.orange},{v:'terrible',l:'Terrible <3h',c:C.red}].map(o=>{
            const active=data.mentalSleep===o.v;
            return <button key={o.v} onClick={()=>set('mentalSleep')(o.v)} style={{padding:'6px 14px',borderRadius:20,border:active?`1.5px solid ${o.c}`:`1.5px solid ${C.border}`,background:active?o.c+'22':'transparent',color:active?o.c:C.textMut,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:active?700:400,transition:'all 0.15s'}}>{o.l}</button>;
          })}
        </div>
      </div>
      {/* Stress */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Stress</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[{v:'calm',l:'Calm',c:C.green},{v:'mild',l:'Mild',c:C.teal},{v:'elevated',l:'Elevated',c:C.orange},{v:'high',l:'High',c:C.red}].map(o=>{
            const active=data.mentalStress===o.v;
            return <button key={o.v} onClick={()=>set('mentalStress')(o.v)} style={{padding:'6px 14px',borderRadius:20,border:active?`1.5px solid ${o.c}`:`1.5px solid ${C.border}`,background:active?o.c+'22':'transparent',color:active?o.c:C.textMut,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:active?700:400,transition:'all 0.15s'}}>{o.l}</button>;
          })}
        </div>
      </div>
      {/* Confidence */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Confidence</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[{v:'sharp',l:'Sharp',c:C.green},{v:'normal',l:'Normal',c:C.teal},{v:'cautious',l:'Cautious',c:C.yellow},{v:'shaky',l:'Shaky',c:C.red}].map(o=>{
            const active=data.mentalConfidence===o.v;
            return <button key={o.v} onClick={()=>set('mentalConfidence')(o.v)} style={{padding:'6px 14px',borderRadius:20,border:active?`1.5px solid ${o.c}`:`1.5px solid ${C.border}`,background:active?o.c+'22':'transparent',color:active?o.c:C.textMut,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:active?700:400,transition:'all 0.15s'}}>{o.l}</button>;
          })}
        </div>
      </div>
      {/* Exterior */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>External Factors</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[{v:'clear',l:'All clear',c:C.green},{v:'news_day',l:'Major news day',c:C.yellow},{v:'personal',l:'Personal stuff',c:C.orange},{v:'distracted',l:'Distracted',c:C.red}].map(o=>{
            const active=data.mentalExterior===o.v;
            return <button key={o.v} onClick={()=>set('mentalExterior')(o.v)} style={{padding:'6px 14px',borderRadius:20,border:active?`1.5px solid ${o.c}`:`1.5px solid ${C.border}`,background:active?o.c+'22':'transparent',color:active?o.c:C.textMut,fontSize:12,fontFamily:'inherit',cursor:'pointer',fontWeight:active?700:400,transition:'all 0.15s'}}>{o.l}</button>;
          })}
        </div>
      </div>
      {/* Warning */}
      {(hasWarning || hasSevere) && (
        <div style={{background:C.red+'12',border:`1px solid ${C.red}44`,borderRadius:10,padding:'12px 14px',marginTop:4}}>
          <div style={{fontSize:12,color:C.red,fontWeight:700,marginBottom:4}}>
            ⚠ {hasSevere ? 'Severe impairment detected' : 'Multiple risk factors'}
          </div>
          <div style={{fontSize:11,color:C.textSub,lineHeight:1.6}}>
            {hasSevere
              ? 'Consider not trading today. If you do trade — minimum size, maximum 2 trades, stop at first loss.'
              : `${mentalWarnings.join(' + ')} detected. Reduce size by 50%. Tighter daily max loss. Take only A+ setups.`}
          </div>
        </div>
      )}
    </div>
  );
}

function PreMarketTab({data,onChange,isMobile}){
  const set=k=>v=>onChange({...data,[k]:v});

  const esInputs = data.esInputs || emptyBiasInputs();
  const nqInputs = data.nqInputs || emptyBiasInputs();
  const esResult = computeBias(esInputs);
  const nqResult = computeBias(nqInputs);
  const alignment = computeAlignment(esResult, nqResult);

  const handleESChange = (newInputs) => {
    const result = computeBias(newInputs);
    const newNqResult = computeBias(data.nqInputs || emptyBiasInputs());
    const align = computeAlignment(result, newNqResult);
    onChange({...data, esInputs: newInputs, esComputedBias: result.bias,
      dailyBias: align?.combined || result.bias, alignmentBias: align?.combined || ''});
  };

  const handleNQChange = (newInputs) => {
    const result = computeBias(newInputs);
    const newEsResult = computeBias(data.esInputs || emptyBiasInputs());
    const align = computeAlignment(newEsResult, result);
    onChange({...data, nqInputs: newInputs, nqComputedBias: result.bias,
      dailyBias: align?.combined || result.bias, alignmentBias: align?.combined || ''});
  };

  const mentalData = {
    mentalSleep: data.mentalSleep||'',
    mentalStress: data.mentalStress||'',
    mentalConfidence: data.mentalConfidence||'',
    mentalExterior: data.mentalExterior||'',
  };

  // Instrument column component
  const InstrumentColumn = ({instrument, inputs, result, onInputChange, accentColor, imgTPO, imgTPOKey, img15, img15Key}) => (
    <div style={{flex:1,minWidth:0}}>
      {/* Header */}
      <div style={{
        display:'flex',alignItems:'center',justifyContent:'space-between',
        marginBottom:16,padding:'14px 16px',
        background:accentColor+'10',
        border:`1px solid ${accentColor}33`,
        borderRadius:12,
      }}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:4,height:40,background:accentColor,borderRadius:2}}/>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:accentColor}}>{instrument}</div>
            <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.08em'}}>{instrument==='ES'?'S&P 500':'NASDAQ 100'} BIAS</div>
          </div>
        </div>
        {result.bias && (
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:20,fontWeight:800,color:result.color,textTransform:'uppercase'}}>
              {result.bias==='bullish'?'🟢':result.bias==='bearish'?'🔴':'⚪'} {result.bias}
            </div>
            {result.conviction && (
              <div style={{
                fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',
                color:result.conviction==='high'?C.green:result.conviction==='medium'?C.yellow:result.conviction==='low'?C.orange:C.textMut,
                marginTop:2,
              }}>{result.conviction} conviction</div>
            )}
          </div>
        )}
      </div>

      {/* Sizing instruction when bias exists */}
      {result.sizing && (
        <div style={{
          padding:'10px 14px',borderRadius:10,marginBottom:16,
          background:C.surface,border:`1px solid ${C.border}`,
          fontSize:12,color:C.textSub,lineHeight:1.5,
        }}>
          {result.sizing}
        </div>
      )}

      {/* Signal log */}
      {result.signals && result.signals.length > 0 && (
        <div style={{
          padding:'12px 14px',borderRadius:10,marginBottom:16,
          background:result.color+'08',border:`1px solid ${result.color}22`,
        }}>
          {result.signals.map((s,i)=>(
            <div key={i} style={{fontSize:11,color:C.textMut,lineHeight:1.6,paddingBottom:i<result.signals.length-1?4:0}}>{s}</div>
          ))}
        </div>
      )}

      {/* Bias inputs */}
      <BiasEnginePanel biasInputs={inputs} onChange={onInputChange} result={result} preBiasResult={result}/>

      {/* Charts */}
      <div style={{marginTop:20}}>
        <div style={{fontSize:10,color:C.textSub,marginBottom:10,letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600}}>Charts</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
          <ImageSlot label="TPO" value={imgTPO} onChange={set(imgTPOKey)} accent={accentColor}/>
          <ImageSlot label="15min" value={img15} onChange={set(img15Key)} accent={accentColor}/>
        </div>
      </div>
    </div>
  );

  return(
    <div>
      {/* ── TWO COLUMN LAYOUT ── */}
      <div style={{
        display: isMobile ? 'block' : 'grid',
        gridTemplateColumns: isMobile ? undefined : '1fr 1fr',
        gap: isMobile ? 0 : 24,
        alignItems: 'start',
      }}>
        <InstrumentColumn
          instrument="ES"
          inputs={esInputs}
          result={esResult}
          onInputChange={handleESChange}
          accentColor={C.blue}
          imgTPO={data.esImgTPO||''} imgTPOKey="esImgTPO"
          img15={data.esImg15||''} img15Key="esImg15"
        />

        {isMobile && <div style={{height:2,background:C.surface2,margin:'28px 0'}}/>}

        <InstrumentColumn
          instrument="NQ"
          inputs={nqInputs}
          result={nqResult}
          onInputChange={handleNQChange}
          accentColor={C.purple}
          imgTPO={data.nqImgTPO||''} imgTPOKey="nqImgTPO"
          img15={data.nqImg15||''} img15Key="nqImg15"
        />
      </div>

      {/* ── ALIGNMENT OUTPUT ── */}
      <div style={{height:2,background:C.surface2,margin:'32px 0'}}/>
      <div style={{marginBottom:28}}>
        <div style={{fontSize:11,color:C.textMut,letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:600,marginBottom:14,display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:3,height:14,background:C.textMut,borderRadius:2}}/>
          NQ + ES Alignment
        </div>
        {alignment ? (
          <div style={{
            background:alignment.color+'10',
            border:`2px solid ${alignment.color}55`,
            borderRadius:16,padding:'22px 24px',
          }}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:12}}>
              <div>
                <div style={{fontSize:28,fontWeight:800,color:alignment.color,textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>
                  {alignment.combined==='bullish'?'🟢':alignment.combined==='bearish'?'🔴':alignment.combined==='conflict'?'⚡':'⚪'} {alignment.combined||alignment.alignment}
                </div>
                <div style={{fontSize:13,color:alignment.color,fontWeight:600}}>{alignment.verdict}</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
                <div style={{
                  padding:'7px 18px',borderRadius:20,
                  background:(alignment.convColor||alignment.color)+'22',
                  border:`1.5px solid ${(alignment.convColor||alignment.color)}55`,
                  fontSize:13,fontWeight:800,
                  color:alignment.convColor||alignment.color,
                  textTransform:'uppercase',letterSpacing:'0.08em',
                }}>{alignment.badge}</div>
                {alignment.esConvLabel && (
                  <div style={{display:'flex',gap:8}}>
                    <div style={{fontSize:11,padding:'3px 10px',borderRadius:12,background:esResult.color+'20',color:esResult.color,fontWeight:600}}>ES {alignment.esConvLabel}</div>
                    <div style={{fontSize:11,padding:'3px 10px',borderRadius:12,background:nqResult.color+'20',color:nqResult.color,fontWeight:600}}>NQ {alignment.nqConvLabel}</div>
                  </div>
                )}
              </div>
            </div>
            <div style={{height:1,background:alignment.color+'22',marginBottom:14}}/>
            <div style={{fontSize:13,color:C.textSub,lineHeight:1.8,marginBottom:14}}>{alignment.action}</div>
            <div style={{
              padding:'10px 14px',borderRadius:10,
              background:C.surface,border:`1px solid ${C.border}`,
              display:'flex',alignItems:'center',gap:10,
            }}>
              <div style={{fontSize:11,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,flexShrink:0}}>Sizing</div>
              <div style={{fontSize:13,color:C.text,fontWeight:600}}>{alignment.sizing}</div>
            </div>
          </div>
        ) : (
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:'24px',textAlign:'center'}}>
            <div style={{fontSize:22,marginBottom:8}}>📊</div>
            <div style={{fontSize:14,color:C.textMut}}>Fill in ES and NQ bias inputs above to see the alignment assessment</div>
          </div>
        )}
      </div>

      {/* ── KEY LEVELS ── */}
      <Divider label="Key Levels"/>
      <ImageSlot label="Key Levels Chart — upload your screenshot with levels marked" value={data.keyLevelsImg||''} onChange={set('keyLevelsImg')} accent={C.teal}/>

      {/* ── MENTAL STATE ── */}
      <Divider label="Mental State"/>
      <MentalStatePanel data={mentalData} onChange={d=>onChange({...data,...d})}/>
    </div>
  );
}

// ─── Trade Card ───────────────────────────────────────────────────────────────
function TradeCard({index,trade,onChange,onRemove,isMobile}){
  const pnl=calcPnL(trade.ticker,trade.contracts,trade.points);
  const risk=calcRisk(trade.ticker,trade.contracts,trade.sl);
  const rr=risk>0?(Math.abs(pnl)/risk).toFixed(2):'—';
  const set=(k)=>(v)=>onChange({...trade,[k]:v});
  const dot=trade.result==='W'?C.green:trade.result==='L'?C.red:trade.result==='BE'?C.yellow:C.border;

  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,marginBottom:10,overflow:'hidden'}}>
      <div onClick={()=>set('open')(!trade.open)} style={{padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',background:trade.open?C.surface2:C.surface}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:dot,flexShrink:0}}/>
          <span style={{fontSize:13,color:C.text,fontWeight:700}}>Trade {index+1}</span>
          {trade.ticker&&<span style={{fontSize:12,color:C.blue,background:C.surface,padding:'2px 8px',borderRadius:5,border:`1px solid ${C.border}`}}>{trade.ticker}</span>}
          {trade.direction&&<span style={{fontSize:11,color:trade.direction==='long'?C.green:C.red,fontWeight:700}}>{trade.direction==='long'?'⬆ L':'⬇ S'}</span>}
          {trade.plan&&<span style={{fontSize:11,color:C.textMut}}>{({balance:'balance',failedexp:'failed exp',reclaim:'reclaim',breakout:'breakout'})[trade.plan]||trade.plan}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          {trade.points!==''&&<span style={{fontSize:13,fontWeight:700,color:parseFloat(trade.points)>=0?C.green:C.red,fontVariantNumeric:'tabular-nums'}}>{parseFloat(trade.points)>=0?'+':''}{trade.points}pts</span>}
          <span style={{color:C.textMut,fontSize:13}}>{trade.open?'▲':'▼'}</span>
          <button onClick={(e)=>{e.stopPropagation();onRemove();}} style={{background:'none',border:'none',color:C.textMut,fontSize:16,cursor:'pointer',padding:0,lineHeight:1}}>✕</button>
        </div>
      </div>
      {trade.open&&(
        <div style={{padding:'4px 16px 20px'}}>
          <Divider label="Setup"/>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Ticker</div>
            <Pills options={[{label:'ES',value:'ES'},{label:'NQ',value:'NQ'},{label:'MES',value:'MES'},{label:'MNQ',value:'MNQ'}]}
              value={trade.ticker} onChange={set('ticker')}
              colors={{ES:C.blue,NQ:C.purple,MES:C.teal,MNQ:C.orange}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <Input label="Contracts" type="number" value={trade.contracts} onChange={set('contracts')}/>
            <Input label="SL Points" type="number" value={trade.sl} onChange={set('sl')}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Direction</div>
            <Pills options={[{label:'⬆ Long',value:'long'},{label:'⬇ Short',value:'short'}]}
              value={trade.direction} onChange={set('direction')} colors={{long:C.green,short:C.red}}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Setup Type</div>
            <Pills options={[
              {label:'Balance Trade',value:'balance'},
              {label:'Failed Expansion',value:'failedexp'},
              {label:'Balance Reclaim',value:'reclaim'},
              {label:'Balance Breakout',value:'breakout'},
            ]} value={trade.plan} onChange={set('plan')} colors={{
              balance:C.blue,failedexp:C.orange,reclaim:C.teal,breakout:C.yellow,
            }}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Reversal Candle</div>
            <Pills options={[{label:'✓ Confirmed',value:'yes'},{label:'✗ No confirmation',value:'no'}]}
              value={trade.candle} onChange={set('candle')} colors={{yes:C.green,no:C.red}}/>
          </div>
          <Divider label="Entry Charts"/>
          <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <ImageSlot label="1min Chart" value={trade.img1} onChange={set('img1')} accent={C.teal}/>
            <ImageSlot label="15min Chart" value={trade.img15} onChange={set('img15')} accent={C.blue}/>
          </div>
          <Divider label="Result"/>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Result</div>
            <Pills options={[{label:'Win',value:'W'},{label:'Loss',value:'L'},{label:'Break Even',value:'BE'}]}
              value={trade.result} onChange={set('result')} colors={{W:C.green,L:C.red,BE:C.yellow}}/>
          </div>
          <Input label="Points Gained / Lost" type="number" value={trade.points} onChange={set('points')}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:20}}>
            <StatBox label="P&L $" val={`${pnl>=0?'+':''}$${pnl.toFixed(0)}`} color={pnl>=0?C.green:C.red}/>
            <StatBox label="Risk $" val={`$${risk.toFixed(0)}`} color={C.yellow}/>
            <StatBox label="RR" val={`${rr}R`} color={C.textSub}/>
          </div>
          <Divider label="Notes"/>
          <Field label="Emotions" placeholder="Entry · during · exit..." value={trade.emotions} onChange={set('emotions')} rows={2}/>
          <Field label="Trade Notes" placeholder="Plan followed? Deviations? Key observations..." value={trade.notes} onChange={set('notes')} rows={2}/>
        </div>
      )}
    </div>
  );
}

function SummaryBar({trades}){
  const total=trades.reduce((s,t)=>s+calcPnL(t.ticker,t.contracts,t.points),0);
  const totalPts=trades.reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const wins=trades.filter(t=>t.result==='W').length;
  const losses=trades.filter(t=>t.result==='L').length;
  const counted=trades.filter(t=>t.result).length;
  const wr=counted>0?Math.round((wins/counted)*100):0;
  return(
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}}>
      <StatBox label="P&L" val={`${total>=0?'+':''}$${total.toFixed(0)}`} color={total>=0?C.green:C.red}/>
      <StatBox label="Points" val={`${totalPts>=0?'+':''}${totalPts.toFixed(1)}`} color={totalPts>=0?C.green:C.red}/>
      <StatBox label="W Rate" val={`${wr}%`} color={C.yellow}/>
      <StatBox label="Trades" val={`${wins}W ${losses}L`} color={C.textSub}/>
    </div>
  );
}

function TradesTab({trades,onChange,isMobile}){
  const update=(i,t)=>onChange(trades.map((x,j)=>j===i?t:x));
  const remove=(i)=>onChange(trades.filter((_,j)=>j!==i));
  const add=()=>onChange([...trades,newTrade()]);
  return(
    <div>
      <SummaryBar trades={trades}/>
      {trades.map((t,i)=>(
        <TradeCard key={i} index={i} trade={t} onChange={nt=>update(i,nt)} onRemove={()=>remove(i)} isMobile={isMobile}/>
      ))}
      <button onClick={add} style={{
        width:'100%',padding:'13px',marginTop:8,
        background:'transparent',border:`1.5px dashed ${C.border}`,
        borderRadius:12,color:C.textMut,fontSize:13,
        fontFamily:'inherit',cursor:'pointer',letterSpacing:'0.04em',transition:'all 0.15s',
      }}
        onMouseEnter={e=>{e.target.style.borderColor=C.border2;e.target.style.color=C.textSub;}}
        onMouseLeave={e=>{e.target.style.borderColor=C.border;e.target.style.color=C.textMut;}}
      >+ Add Trade</button>
    </div>
  );
}

// ─── EOD Tab ─────────────────────────────────────────────────────────────────
function EODTab({data,onChange,trades,date,isMobile}){
  const set=k=>v=>onChange({...data,[k]:v});
  const total=trades.reduce((s,t)=>s+calcPnL(t.ticker,t.contracts,t.points),0);
  const totalPts=trades.reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const[copied,setCopied]=useState(false);

  const biasStr = `ES: ${data.esComputedBias||'—'} | NQ: ${data.nqComputedBias||'—'} | Alignment: ${data.alignmentBias||data.dailyBias||'—'}`;
  const mentalStr = [data.mentalSleep&&`Sleep: ${data.mentalSleep}`,data.mentalStress&&`Stress: ${data.mentalStress}`,data.mentalConfidence&&`Confidence: ${data.mentalConfidence}`,data.mentalExterior&&`External: ${data.mentalExterior}`].filter(Boolean).join(' · ')||'—';
  const prompt=`Review my trading journal for ${date}.
Bias — ${biasStr}
Mental State: ${mentalStr}
Trades (${trades.length}):
${trades.map((t,i)=>`Trade ${i+1}: ${t.ticker}|${t.direction||'—'}|${t.contracts}c|SL ${t.sl}pts|Setup:${t.plan}|Candle:${t.candle}|Result:${t.result}|Points:${t.points}|P&L:$${calcPnL(t.ticker,t.contracts,t.points).toFixed(0)}|Notes:${t.notes}`).join('\n')}
Total P&L: $${total.toFixed(0)} | Total Points: ${totalPts.toFixed(1)}
EOD Emotions: ${data.emotions||'—'}
What I Did Well: ${data.well||'—'}
What I Must Fix: ${data.fix||'—'}
General Review: ${data.review||'—'}
Please: 1. ES vs NQ bias accuracy — did they align or diverge. 2. Did alignment call match what happened. 3. Trade-by-trade breakdown. 4. Mental state impact. 5. What I did well (specific). 6. Top 1-2 fixes. 7. Confirm P&L math (ES=$50 NQ=$20 MES=$5 MNQ=$2). 8. One edge to build on. Direct, no padding.`;

  const copy=()=>{navigator.clipboard.writeText(prompt);setCopied(true);setTimeout(()=>setCopied(false),2500);};

  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:24}}>
        {[
          {label:'Day P&L',val:`${total>=0?'+':''}$${total.toFixed(0)}`,col:total>=0?C.green:C.red},
          {label:'Total Points',val:`${totalPts>=0?'+':''}${totalPts.toFixed(1)}`,col:totalPts>=0?C.green:C.red},
        ].map(s=>(
          <div key={s.label} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'16px'}}>
            <div style={{fontSize:11,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>{s.label}</div>
            <div style={{fontSize:30,fontWeight:800,color:s.col,fontVariantNumeric:'tabular-nums'}}>{s.val}</div>
          </div>
        ))}
      </div>

      <Divider label="End of Day Charts"/>

      <InstrumentLabel name="ES" color={C.blue}/>
      <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
        <ImageSlot label="15min — Full Day" value={data.img15ES} onChange={set('img15ES')} accent={C.blue}/>
        <ImageSlot label="TPO — Full Day" value={data.imgTPOES} onChange={set('imgTPOES')} accent={C.blue}/>
      </div>

      <InstrumentLabel name="NQ" color={C.purple}/>
      <div style={{display:isMobile?'block':'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:8}}>
        <ImageSlot label="15min — Full Day" value={data.img15NQ} onChange={set('img15NQ')} accent={C.purple}/>
        <ImageSlot label="TPO — Full Day" value={data.imgTPONQ} onChange={set('imgTPONQ')} accent={C.purple}/>
      </div>

      <Divider label="Review"/>
      <Field label="Overall Emotions & Summary" placeholder="In control? Reactive? Overtraded?" value={data.emotions} onChange={set('emotions')} rows={3}/>
      <Field label="✅ What I Did Well" placeholder="Specific — clean executions, rules, reads..." value={data.well} onChange={set('well')} rows={2}/>
      <Field label="❌ What I Must Fix" placeholder="Honest — rules broken, bad entries, oversized..." value={data.fix} onChange={set('fix')} rows={2}/>
      <Field label="General Review" placeholder="Market narrative, levels, notes for tomorrow..." value={data.review} onChange={set('review')} rows={3}/>

      <Divider label="Claude Analysis Prompt"/>
      <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:'14px 16px',fontSize:11,color:C.textMut,lineHeight:1.8,fontFamily:'monospace',marginBottom:12,whiteSpace:'pre-wrap',maxHeight:140,overflowY:'auto'}}>{prompt}</div>
      <button onClick={copy} style={{
        width:'100%',padding:'13px',
        background:copied?C.green+'18':'transparent',
        border:`1.5px solid ${copied?C.green:C.border}`,
        borderRadius:12,color:copied?C.green:C.textSub,
        fontSize:13,fontFamily:'inherit',cursor:'pointer',fontWeight:700,transition:'all 0.2s',
      }}>{copied?'✓ Copied — paste into Claude':'Copy Claude Prompt'}</button>
    </div>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function CalendarModal({selectedDate,onSelect,onClose,index}){
  const now=new Date(selectedDate+'T12:00:00');
  const[year,setYear]=useState(now.getFullYear());
  const[month,setMonth]=useState(now.getMonth());
  const days=getMonthDays(year,month);
  const today=todayStr();
  const prevM=()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);};
  const nextM=()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);};
  return(
    <div style={{position:'fixed',inset:0,background:'#000000cc',zIndex:100,display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#111',border:`1px solid ${C.border}`,borderRadius:'18px 18px 0 0',padding:'22px 18px 36px',width:'100%',maxWidth:560}}>
        <div style={{width:36,height:4,background:C.border,borderRadius:2,margin:'0 auto 20px'}}/>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18}}>
          <button onClick={prevM} style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,width:36,height:36,cursor:'pointer',fontSize:18}}>‹</button>
          <span style={{fontSize:15,color:C.text,fontWeight:700}}>{MONTHS[month]} {year}</span>
          <button onClick={nextM} style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,width:36,height:36,cursor:'pointer',fontSize:18}}>›</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',marginBottom:8}}>
          {DAYS_HDR.map(d=><div key={d} style={{textAlign:'center',fontSize:11,color:C.textMut,padding:'4px 0'}}>{d}</div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
          {days.map((d,i)=>{
            if(!d)return<div key={i}/>;
            const isSel=d===selectedDate;
            const isTod=d===today;
            const dayIdx=index[d];
            const dotColor=dayIdx?.pnl>0?C.green:dayIdx?.pnl<0?C.red:dayIdx?C.yellow:null;
            return(
              <button key={d} onClick={()=>{onSelect(d);onClose();}} style={{
                padding:'9px 0',borderRadius:9,
                border:isSel?`1.5px solid ${C.border2}`:'1.5px solid transparent',
                background:isSel?C.surface2:'transparent',
                color:isTod?'#fff':dayIdx?C.textSub:C.textDim,
                fontSize:13,fontFamily:'inherit',cursor:'pointer',
                fontWeight:isTod?800:400,display:'flex',flexDirection:'column',alignItems:'center',gap:3,
              }}>
                {String(new Date(d+'T12:00:00').getDate())}
                {dotColor&&<div style={{width:4,height:4,borderRadius:'50%',background:dotColor}}/>}
              </button>
            );
          })}
        </div>
        <div style={{display:'flex',gap:18,justifyContent:'center',marginTop:18}}>
          {[[C.green,'Profit'],[C.red,'Loss'],[C.yellow,'Breakeven']].map(([col,lbl])=>(
            <div key={lbl} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:C.textMut}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:col}}/>{lbl}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App(){
  const today=todayStr();
  const isMobile=useIsMobile();
  const[selectedDate,setSelectedDate]=useState(today);
  const[tab,setTab]=useState(0);
  const[dayData,setDayData]=useState(null);
  const[index,setIndex]=useState({});
  const[loading,setLoading]=useState(true);
  const[saveStatus,setSaveStatus]=useState('idle');
  const[showCal,setShowCal]=useState(false);
  const saveTimer=useRef(null);

  useEffect(()=>{loadIndex().then(idx=>setIndex(idx||{}));},[]);
  useEffect(()=>{
    setLoading(true);
    loadDay(selectedDate).then(d=>{setDayData(d||emptyDay());setLoading(false);});
  },[selectedDate]);

  useEffect(()=>{
    if(!dayData||loading)return;
    setSaveStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      await saveDay(selectedDate,dayData);
      const trades=dayData.trades||[];
      const total=trades.reduce((s,t)=>s+calcPnL(t.ticker,t.contracts,t.points),0);
      const totalPts=trades.reduce((s,t)=>s+(parseFloat(t.points)||0),0);
      const wins=trades.filter(t=>t.result==='W').length;
      const summary={pnl:total,pts:totalPts,wins,trades:trades.length,bias:dayData.pre?.dailyBias||''};
      await saveIndex(selectedDate,summary);
      setIndex(prev=>({...prev,[selectedDate]:summary}));
      setSaveStatus('saved');
      setTimeout(()=>setSaveStatus('idle'),3000);
    },1000);
    return()=>clearTimeout(saveTimer.current);
  },[dayData]);

  const updatePre=pre=>setDayData(d=>({...d,pre}));
  const updateTrades=trades=>setDayData(d=>({...d,trades}));
  const updateEod=eod=>setDayData(d=>({...d,eod}));

  const goDay=(offset)=>{
    const d=new Date(selectedDate+'T12:00:00');
    d.setDate(d.getDate()+offset);
    setSelectedDate(d.toLocaleDateString('en-CA'));
    setTab(0);
  };

  const esResult = dayData?.pre?.esInputs ? computeBias(dayData.pre.esInputs) : null;
  const nqResult = dayData?.pre?.nqInputs ? computeBias(dayData.pre.nqInputs) : null;
  const alignment = (esResult && nqResult) ? computeAlignment(esResult, nqResult) : null;
  const activeBias = alignment?.combined || dayData?.pre?.dailyBias || '';
  const biasColor = activeBias === 'bullish' ? C.green : activeBias === 'bearish' ? C.red : activeBias === 'neutral' ? C.yellow : activeBias === 'conflict' ? C.orange : null;
  const isToday=selectedDate===today;
  const dayIdx=index[selectedDate];
  const sideW=260;

  return(
    <div style={{minHeight:'100vh',background:C.bg,fontFamily:"'Inter','DM Sans','Helvetica Neue',sans-serif",color:C.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px;}
        textarea::placeholder,input::placeholder{color:${C.textDim};}
        textarea,input{transition:border-color 0.15s;}
      `}</style>

      <div style={{maxWidth:isMobile?'100%':1280,margin:'0 auto',display:isMobile?'block':'flex',minHeight:'100vh'}}>

        {/* Desktop Sidebar */}
        {!isMobile&&(
          <div style={{width:sideW,flexShrink:0,borderRight:`1px solid ${C.surface2}`,padding:'28px 20px',display:'flex',flexDirection:'column',gap:24,position:'sticky',top:0,height:'100vh',overflowY:'auto'}}>
            <div>
              <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.14em',textTransform:'uppercase',marginBottom:6}}>Trading Journal</div>
              <div style={{fontSize:24,fontWeight:800,color:C.text}}>📈</div>
            </div>
            <div style={{fontSize:12,color:saveStatus==='saving'?C.yellow:saveStatus==='saved'?C.green:C.textDim}}>
              {saveStatus==='saving'?'● Saving...':saveStatus==='saved'?'✓ Saved':'○ Auto-save on'}
            </div>
            <div>
              <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>Date</div>
              <button onClick={()=>setShowCal(true)} style={{width:'100%',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',cursor:'pointer',textAlign:'left',fontFamily:'inherit',marginBottom:8}}>
                <div style={{fontSize:14,color:C.text,fontWeight:700}}>{fmtDate(selectedDate)}</div>
                {dayIdx?<div style={{fontSize:12,color:dayIdx.pnl>=0?C.green:C.red,marginTop:3,fontVariantNumeric:'tabular-nums'}}>{dayIdx.pnl>=0?'+':''}${dayIdx.pnl.toFixed(0)} · {dayIdx.trades} trade{dayIdx.trades!==1?'s':''}</div>
                  :<div style={{fontSize:12,color:C.textDim,marginTop:3}}>no entries yet</div>}
              </button>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>goDay(-1)} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,height:34,cursor:'pointer',fontSize:16}}>‹</button>
                <button onClick={()=>goDay(1)} disabled={selectedDate>=today} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:selectedDate>=today?C.textDim:C.textSub,height:34,cursor:selectedDate>=today?'default':'pointer',fontSize:16}}>›</button>
                {!isToday&&<button onClick={()=>{setSelectedDate(today);setTab(0);}} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,height:34,cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>Today</button>}
              </div>
            </div>
            <div>
              <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>Section</div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                {TABS.map((t,i)=>(
                  <button key={t} onClick={()=>setTab(i)} style={{padding:'10px 14px',borderRadius:9,textAlign:'left',background:tab===i?C.surface2:'transparent',border:tab===i?`1px solid ${C.border}`:'1px solid transparent',color:tab===i?C.text:C.textMut,fontSize:13,fontFamily:'inherit',cursor:'pointer',fontWeight:tab===i?700:400,transition:'all 0.15s'}}>
                    {i===0?'📋 ':i===1?'📊 ':'🔚 '}{t}
                  </button>
                ))}
              </div>
            </div>
            {activeBias&&(
              <div style={{padding:'12px 14px',borderRadius:10,border:`1px solid ${biasColor}44`,background:biasColor+'10'}}>
                <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6}}>Alignment</div>
                <div style={{fontSize:16,color:biasColor,fontWeight:800,textTransform:'capitalize',marginBottom:6}}>
                  {activeBias==='bullish'?'🟢':activeBias==='bearish'?'🔴':activeBias==='conflict'?'⚡':'⚪'} {activeBias}
                </div>
                <div style={{display:'flex',gap:6}}>
                  {esResult?.bias&&<div style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:esResult.color+'22',color:esResult.color,fontWeight:600}}>ES {esResult.bias}</div>}
                  {nqResult?.bias&&<div style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:nqResult.color+'22',color:nqResult.color,fontWeight:600}}>NQ {nqResult.bias}</div>}
                </div>
              </div>
            )}
            {dayIdx&&(
              <div style={{marginTop:'auto',paddingTop:20,borderTop:`1px solid ${C.surface2}`}}>
                <div style={{fontSize:10,color:C.textMut,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:8}}>Day P&L</div>
                <div style={{fontSize:28,fontWeight:800,color:dayIdx.pnl>=0?C.green:C.red,fontVariantNumeric:'tabular-nums'}}>{dayIdx.pnl>=0?'+':''}${dayIdx.pnl.toFixed(0)}</div>
              </div>
            )}
          </div>
        )}

        {/* Main content */}
        <div style={{flex:1,padding:isMobile?'16px 16px 80px':'28px 32px 60px',overflowY:'auto'}}>

          {/* Mobile header */}
          {isMobile&&(
            <div style={{marginBottom:18}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                <div style={{fontSize:11,color:C.textMut,letterSpacing:'0.12em',textTransform:'uppercase'}}>Trading Journal</div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{fontSize:11,color:saveStatus==='saving'?C.yellow:saveStatus==='saved'?C.green:'transparent'}}>{saveStatus==='saving'?'saving...':'✓ saved'}</span>
                  {activeBias&&<div style={{padding:'4px 10px',borderRadius:20,border:`1px solid ${biasColor}44`,background:biasColor+'12',fontSize:11,color:biasColor,fontWeight:700,textTransform:'uppercase'}}>{activeBias==='conflict'?'⚡':activeBias==='bullish'?'🟢':activeBias==='bearish'?'🔴':'⚪'} {activeBias}</div>}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
                <button onClick={()=>goDay(-1)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,width:36,height:36,cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>‹</button>
                <button onClick={()=>setShowCal(true)} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 12px',cursor:'pointer',textAlign:'left',fontFamily:'inherit'}}>
                  <div style={{fontSize:14,color:C.text,fontWeight:700}}>{fmtDate(selectedDate)}{isToday?' · Today':''}</div>
                  {dayIdx?<div style={{fontSize:11,color:dayIdx.pnl>=0?C.green:C.red,marginTop:2,fontVariantNumeric:'tabular-nums'}}>{dayIdx.pnl>=0?'+':''}${dayIdx.pnl.toFixed(0)} · {dayIdx.trades} trade{dayIdx.trades!==1?'s':''}</div>
                    :<div style={{fontSize:11,color:C.textDim,marginTop:2}}>no entries yet</div>}
                </button>
                <button onClick={()=>goDay(1)} disabled={selectedDate>=today} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:selectedDate>=today?C.textDim:C.textSub,width:36,height:36,cursor:selectedDate>=today?'default':'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>›</button>
                {!isToday&&<button onClick={()=>{setSelectedDate(today);setTab(0);}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,padding:'0 10px',height:36,cursor:'pointer',fontSize:12,fontFamily:'inherit',flexShrink:0}}>Today</button>}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4,background:C.surface,borderRadius:12,padding:4,border:`1px solid ${C.border}`}}>
                {TABS.map((t,i)=>(
                  <button key={t} onClick={()=>setTab(i)} style={{padding:'10px 4px',borderRadius:9,background:tab===i?C.surface2:'transparent',border:'none',color:tab===i?C.text:C.textMut,fontSize:11,fontFamily:'inherit',cursor:'pointer',fontWeight:tab===i?700:400,letterSpacing:'0.03em',transition:'all 0.15s'}}>{t}</button>
                ))}
              </div>
            </div>
          )}

          {!isMobile&&(
            <div style={{marginBottom:28}}>
              <div style={{fontSize:22,fontWeight:800,color:C.text,marginBottom:4}}>
                {tab===0?'📋 Pre-Market Bias':tab===1?'📊 Trades':'🔚 End of Day Review'}
              </div>
              <div style={{fontSize:14,color:C.textMut}}>{fmtDate(selectedDate)}{isToday?' · Today':''}</div>
            </div>
          )}

          {loading?(
            <div style={{textAlign:'center',color:C.textMut,fontSize:13,padding:'60px 0'}}>Loading...</div>
          ):(
            <>
              {tab===0&&<PreMarketTab data={dayData.pre} onChange={updatePre} isMobile={isMobile}/>}
              {tab===1&&<TradesTab trades={dayData.trades} onChange={updateTrades} isMobile={isMobile}/>}
              {tab===2&&<EODTab data={{...dayData.eod,
                dailyBias:dayData.pre.dailyBias,
                alignmentBias:dayData.pre.alignmentBias,
                esComputedBias:dayData.pre.esComputedBias,
                nqComputedBias:dayData.pre.nqComputedBias,
                mentalSleep:dayData.pre.mentalSleep,
                mentalStress:dayData.pre.mentalStress,
                mentalConfidence:dayData.pre.mentalConfidence,
                mentalExterior:dayData.pre.mentalExterior,
              }} onChange={updateEod} trades={dayData.trades} date={selectedDate} isMobile={isMobile}/> }
            </>
          )}
        </div>
      </div>
      {showCal&&<CalendarModal selectedDate={selectedDate} onSelect={d=>{setSelectedDate(d);setTab(0);}} onClose={()=>setShowCal(false)} index={index}/>}
    </div>
  );
}
