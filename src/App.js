import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase, loadDay, saveDay, loadIndex, saveIndex, getCurrentUser, signIn, signUp, signOut } from './supabase';

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

function calcPnL(ticker,contracts,points){return(parseFloat(points)||0)*(POINT_VALUES[ticker]||0);}
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
  const {
    prevDayCandle,      // 'green'|'red'|'inside'|''
    insideDayCount,     // number
    profileShape,       // 'B'|'b'|'P'|'D'|'normal'|'balanced_no_shape'|'wide_range_no_shape'|''
    prevHighQuality,    // 'excess'|'normal'|''
    prevLowQuality,     // 'excess'|'normal'|''
    pocMigration,       // 'rising'|'flat'|'falling'|''
    ibSize,             // 'short'|'medium'|'large'|''
    ibFormedLast,       // 'high'|'low'|'' — which side formed last (opposite leans, +1)
    vaOverlap,          // 'heavy'|'partial'|'none'|''
    liveEdgeContext,    // 'balance_edge_above'|'balance_edge_below'|'failed_breakout_above'|'failed_breakout_below'|'expansion_above'|'expansion_below'|'middle_of_balance'|''
    ibCloseMid,         // 'above'|'below'|'' — IB close vs midpoint at 10:30 (mid-session input, +2)
    ibBreakDir,         // 'high'|'low'|'none'|''
    ibOppositeBreak,    // 'no'|'yes_no_accept'|'yes_accepted'|''
    ibSecondBreak,      // 'high'|'low'|'' — second break direction (+2, 68-72%)
    ibTimeAcceptance,   // 'yes'|'no'|''
    ibBreakTiming,      // 'c_period'|'d_e_period'|'afternoon'|'' — when break occurred (+1/0/-1)
    ibRetrace,          // 'shallow'|'deep'|'' — retracement depth (shallow +1 93.8%, deep -2)
    ibCVD,              // 'agreeing'|'flat'|'diverging'|''
    pdhPdlBreak,        // 'pdh_held'|'pdl_held'|'pdh_snapped'|'pdl_snapped'|''
  } = bi;

  let signals = [];

  // ── Step 1: Prior day candle (base direction) ──
  let baseDir = null;
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

  if (baseDir === null) return { bias: '', conviction: '', sizing: '', signals: [], color: C.textMut };

  // ── Step 2: Profile shape (±2 primary, ±1 secondary) ──
  let profileScore = 0;
  if (profileShape === 'D') {
    if (prevDayCandle === 'green') { profileScore = 2; signals.push('📈 D-shape trend up — strongest continuation signal (+2)'); }
    else if (prevDayCandle === 'red') { profileScore = -2; signals.push('📉 D-shape trend down — strongest continuation signal (-2)'); }
    else { signals.push('📊 D-shape noted — needs a directional candle to confirm'); }
  } else if (profileShape === 'B') {
    profileScore = 2; signals.push('📈 B-shape — buyers won both auctions, long reinforced (+2)');
  } else if (profileShape === 'b') {
    profileScore = 2; signals.push('📈 b-shape — trapped shorts below, long reinforced (+2)');
  } else if (profileShape === 'P') {
    profileScore = -2; signals.push('📉 P-shape — spike rejected, value built low, short reinforced (-2)');
  } else if (profileShape === 'normal') {
    signals.push('⚪ Normal bell — no extra conviction, candle bias stands');
  } else if (profileShape === 'balanced_no_shape') {
    signals.push('⚪ Balanced / No Shape — market found equilibrium, no directional conviction. Prior value area unreliable.');
  } else if (profileShape === 'wide_range_no_shape') {
    signals.push('⚠️ Wide Range / No Shape — huge range, reversal, closed mid. Reversal point is the key level.');
  }

  // ── Step 4: POC migration (±1, multi-session context) ──
  if (pocMigration === 'rising') {
    profileScore += 1; signals.push('↗ Rising POC (3-5 sessions) — accumulation, long backing (+1)');
  } else if (pocMigration === 'falling') {
    profileScore -= 1; signals.push('↘ Falling POC (3-5 sessions) — distribution, short backing (-1)');
  } else if (pocMigration === 'flat') {
    signals.push('➡ Flat POC — balanced, reduce trend conviction');
  }

  // ── Resolve structural direction ──
  let resolvedDir = baseDir;
  if (baseDir === 'long' && profileScore <= -2) {
    resolvedDir = 'neutral';
    signals.push('⚡ Profile strongly conflicts with green candle — downgraded to neutral');
  } else if (baseDir === 'short' && profileScore >= 2) {
    resolvedDir = 'neutral';
    signals.push('⚡ Profile strongly conflicts with red candle — downgraded to neutral');
  } else if (baseDir === 'neutral' && profileScore >= 2) {
    resolvedDir = 'long';
    signals.push('⚡ Strong profile overrides inside/neutral candle — long from structure');
  } else if (baseDir === 'neutral' && profileScore <= -2) {
    resolvedDir = 'short';
    signals.push('⚡ Strong profile overrides inside/neutral candle — short from structure');
  }

  // structural agreement score — how strongly structure backs the direction
  let structuralAgreement = 0;
  if (resolvedDir === 'long') structuralAgreement = Math.max(0, profileScore);
  else if (resolvedDir === 'short') structuralAgreement = Math.max(0, -profileScore);

  // ── Step 5: Same-day IB inputs ──
  let ibBoost = 0;

  // IB formed last — which side formed last leans opposite (52-57%, +1)
  // Combined with IB close vs midpoint (logged at 10:30 in mid-session): 74-84% accuracy
  if (ibFormedLast === 'high') {
    // High formed last = bearish lean (market rejected up, low breaks more likely)
    if (resolvedDir === 'short') {
      ibBoost += 1;
      signals.push('📐 IB HIGH formed last — late rejection of highs, downside leans more likely (+1).');
    } else if (resolvedDir === 'long') {
      ibBoost -= 1;
      signals.push('📐 IB HIGH formed last — late rejection conflicts with long bias (-1).');
    } else {
      signals.push('📐 IB HIGH formed last — mild bearish lean on neutral day.');
    }
  } else if (ibFormedLast === 'low') {
    // Low formed last = bullish lean (market rejected down, high breaks more likely)
    if (resolvedDir === 'long') {
      ibBoost += 1;
      signals.push('📐 IB LOW formed last — late rejection of lows, upside leans more likely (+1).');
    } else if (resolvedDir === 'short') {
      ibBoost -= 1;
      signals.push('📐 IB LOW formed last — late rejection conflicts with short bias (-1).');
    } else {
      signals.push('📐 IB LOW formed last — mild bullish lean on neutral day.');
    }
  }

  // IB size
  if (ibSize === 'short') {
    ibBoost += 1;
    signals.push('📐 Short IB (<50% ATR) — trending day likely (~75-80% after confirmed break), lean into bias (+1)');
  } else if (ibSize === 'medium') {
    signals.push('📐 Medium IB — no extra info, carry bias, use VP levels for execution');
  } else if (ibSize === 'large') {
    ibBoost -= 2;
    signals.push('📐 Large IB (>100% ATR) — market already moved. Fade posture: sell IB high, buy IB low. Conviction reduced (-2).');
  }

  // VA overlap — regime context only, not scored
  // Use to identify balance vs trending regime for edge context selection
  if (vaOverlap === 'heavy') {
    signals.push('🔁 Multi-day heavy VA overlap — balance regime. Fade extremes, expect rotation. Use edge context accordingly.');
  } else if (vaOverlap === 'partial') {
    signals.push('↔ Partial VA overlap — transitional. One side attempting to break out. Watch which side gets rejected.');
  } else if (vaOverlap === 'none') {
    signals.push('➡ No VA overlap — trending/expansion regime. Follow the bias direction, hold runners, don\'t fade.');
  }

  // ── Step 6: Live multi-day balance edge (additive, no override) ──
  // Edge above/below = 0 (two-sided, wait for resolution)
  // Failed breakout above/below = ±2 (trapped participants, direction known)
  // Expansion above/below = ±2 (new directional phase confirmed)
  // Middle = 0 (signal decayed)
  let edgeBoost = 0;
  if (liveEdgeContext === 'balance_edge_above') {
    edgeBoost = 0;
    signals.push('⚖️ Balance edge ABOVE — price at high edge of range. Two-sided: breakout above OR failed expansion back down. No score — wait for resolution, rely on other inputs.');
  } else if (liveEdgeContext === 'balance_edge_below') {
    edgeBoost = 0;
    signals.push('⚖️ Balance edge BELOW — price at low edge of range. Two-sided: breakout below OR failed expansion back up. No score — wait for resolution, rely on other inputs.');
  } else if (liveEdgeContext === 'failed_breakout_above') {
    edgeBoost = -2;
    signals.push('❌ Failed breakout ABOVE — broke above balance high, came back inside. Trapped longs. Bears in control (-2).');
  } else if (liveEdgeContext === 'failed_breakout_below') {
    edgeBoost = 2;
    signals.push('❌ Failed breakout BELOW — broke below balance low, came back inside. Trapped shorts. Bulls in control (+2).');
  } else if (liveEdgeContext === 'expansion_above') {
    edgeBoost = 2;
    signals.push('📈 Expansion ABOVE — clear acceptance above balance high. Bulls in control, new directional phase (+2).');
  } else if (liveEdgeContext === 'expansion_below') {
    edgeBoost = -2;
    signals.push('📉 Expansion BELOW — clear acceptance below balance low. Bears in control, new directional phase (-2).');
  } else if (liveEdgeContext === 'middle_of_balance') {
    edgeBoost = 0;
    signals.push('⚖️ Middle of balance — signal decayed, no directional edge. Fade extremes only.');
  }

  // Edge establishes direction on neutral days if strong enough
  if (edgeBoost >= 2 && resolvedDir === 'neutral') {
    resolvedDir = 'long'; structuralAgreement = 0;
    signals.push('⚡ Failed breakout below / expansion above establishes long from neutral.');
  } else if (edgeBoost <= -2 && resolvedDir === 'neutral') {
    resolvedDir = 'short'; structuralAgreement = 0;
    signals.push('⚡ Failed breakout above / expansion below establishes short from neutral.');
  }

  // ── Step 7: Mid-session IB break (additive, no override) ──
  let midBoost = 0;

  // IB close vs midpoint — logged at 10:30 when IB closes (83-95% directional, +2)
  if (ibCloseMid === 'above') {
    if (resolvedDir === 'long' || resolvedDir === 'neutral') {
      midBoost += 2;
      signals.push('📊 IB closed ABOVE midpoint — 83.5% upside breakout probability (+2).');
    } else {
      midBoost -= 1;
      signals.push('📊 IB closed ABOVE midpoint — conflicts with short bias (-1 conflict).');
    }
  } else if (ibCloseMid === 'below') {
    if (resolvedDir === 'short' || resolvedDir === 'neutral') {
      midBoost += 2;
      signals.push('📊 IB closed BELOW midpoint — 94.9% downside breakout probability (+2).');
    } else {
      midBoost -= 1;
      signals.push('📊 IB closed BELOW midpoint — conflicts with long bias (-1 conflict).');
    }
  }

  // Both sides scenario — check first
  if (ibOppositeBreak === 'yes_accepted') {
    // Both sides accepted = double distribution
    // BUT if we know which broke second, that direction wins 68-72%
    if (ibSecondBreak === 'high') {
      midBoost = 2;
      signals.push('🔼 Double break — second break was HIGH. Second break wins 68-72% (+2 bullish).');
    } else if (ibSecondBreak === 'low') {
      midBoost = -2;
      signals.push('🔽 Double break — second break was LOW. Second break wins 68-72% (-2 bearish).');
    } else {
      midBoost = 0;
      signals.push('⚠️ Both IB sides accepted — double distribution. Log which side broke second for directional edge.');
    }
  } else if (ibOppositeBreak === 'yes_no_accept') {
    midBoost = 0;
    signals.push('⚠️ Both sides tested but neither held — chop. Neutral.');
  } else {
    // Single sided break — merged timing + held into one score
    // C-period break + held = ±2 (strongest, 45.5% reach 100% extension)
    // D/E or afternoon break + held = ±1 (weaker, lower extension probability)
    // Snapped back = ∓1 (failed break, mild reversal)
    if (ibBreakDir === 'high' && ibTimeAcceptance === 'yes') {
      if (ibBreakTiming === 'c_period') {
        midBoost = 2;
        signals.push('🔼 IB broke HIGH + held C-period (10:30-11:00) — strongest confirmation. 45.5% reach 100% extension (+2).');
        signals.push('🌙 Noon Curve: 82% probability PM session extends to new high. Historical PM extreme ~2:04pm — consider holding toward 2pm.');
      } else {
        midBoost = 1;
        signals.push(`🔼 IB broke HIGH + held ${ibBreakTiming === 'afternoon' ? 'afternoon (12:00+)' : 'D/E period (11:00-12:00)'} — confirmed but lower extension probability (+1).`);
      }
    } else if (ibBreakDir === 'low' && ibTimeAcceptance === 'yes') {
      if (ibBreakTiming === 'c_period') {
        midBoost = -2;
        signals.push('🔽 IB broke LOW + held C-period (10:30-11:00) — strongest confirmation. 45.5% reach 100% extension (-2).');
        signals.push('🌙 Noon Curve: 72% probability PM session extends to new low. Historical PM extreme ~2:04pm — consider holding toward 2pm.');
      } else {
        midBoost = -1;
        signals.push(`🔽 IB broke LOW + held ${ibBreakTiming === 'afternoon' ? 'afternoon (12:00+)' : 'D/E period (11:00-12:00)'} — confirmed but lower extension probability (-1).`);
      }
    } else if (ibBreakDir === 'high' && ibTimeAcceptance === 'no') {
      midBoost = -1;
      signals.push('↩ IB broke HIGH but snapped back — higher prices rejected, mild bearish lean (-1).');
    } else if (ibBreakDir === 'low' && ibTimeAcceptance === 'no') {
      midBoost = 1;
      signals.push('↪ IB broke LOW but snapped back — lower prices rejected, mild bullish lean (+1).');
    } else if (ibBreakDir === 'none') {
      signals.push('➡ No clean IB break — original bias carries.');
    }

    // CVD modifier on single sided breaks only
    if (midBoost !== 0 && ibCVD === 'agreeing') {
      midBoost += midBoost > 0 ? 1 : -1;
      signals.push('📊 CVD agreeing with break — delta confirms (+1 in break direction).');
    } else if (midBoost !== 0 && ibCVD === 'diverging') {
      midBoost += midBoost > 0 ? -1 : 1;
      signals.push('📊 CVD diverging — delta not confirming, potential trap (dampened).');
    }

    // Retracement depth after held break
    if (ibTimeAcceptance === 'yes' && ibRetrace) {
      if (ibRetrace === 'shallow') {
        midBoost += midBoost > 0 ? 1 : -1;
        signals.push('📐 Shallow retracement (<25% back into IB) — 93.8% continuation, zero double break days (+1).');
      } else if (ibRetrace === 'deep') {
        midBoost = midBoost > 0 ? midBoost - 2 : midBoost + 2;
        signals.push('📐 Deep retracement (>50% back into IB) — breakout signal largely dead. 24.8% close in original direction. Double break likely (-2).');
      }
    }
  }

  // PDH/PDL break during session
  // Held: PDH +1 bullish (81% close), PDL -1 bearish (66% close)
  // Snapped back: PDH -1 mild bearish (failed upside), PDL +1 mild bullish (failed downside)
  if (pdhPdlBreak === 'pdh_held') {
    if (resolvedDir === 'long' || resolvedDir === 'neutral') {
      midBoost += 1;
      signals.push('📈 PDH broke + held — 81% bullish session close (+1).');
    } else {
      signals.push('📈 PDH broke + held — conflicts with short bias. Watch for reversal.');
    }
  } else if (pdhPdlBreak === 'pdl_held') {
    if (resolvedDir === 'short' || resolvedDir === 'neutral') {
      midBoost -= 1;
      signals.push('📉 PDL broke + held — 66% bearish session close (-1).');
    } else {
      signals.push('📉 PDL broke + held — conflicts with long bias. Watch for reversal.');
    }
  } else if (pdhPdlBreak === 'pdh_snapped') {
    midBoost -= 1;
    signals.push('↩ PDH broke but snapped back — failed upside, mild bearish lean (-1).');
  } else if (pdhPdlBreak === 'pdl_snapped') {
    midBoost += 1;
    signals.push('↪ PDL broke but snapped back — failed downside, mild bullish lean (+1).');
  }

  // Shallow retracement signal note (94% continuation — informational only, not scored)
  // User can note this in trade notes — no UI input needed

  // ── Conviction scoring (fully additive, directionally aware) ──
  // edgeBoost and midBoost are directional — positive = bullish, negative = bearish
  // Agreement with resolvedDir adds, conflict subtracts
  const edgeContrib = resolvedDir === 'long' ? edgeBoost : resolvedDir === 'short' ? -edgeBoost : 0;
  const midContrib = resolvedDir === 'long' ? midBoost : resolvedDir === 'short' ? -midBoost : 0;
  const score = structuralAgreement + ibBoost + edgeContrib + midContrib;

  let conviction, sizing, biasLabel, color;

  if (resolvedDir === 'neutral') {
    conviction = 'neutral';
    sizing = 'Fade extremes only. No trend trades. Half size max.';
    biasLabel = 'neutral';
    color = C.yellow;
  } else {
    biasLabel = resolvedDir === 'long' ? 'bullish' : 'bearish';
    color = resolvedDir === 'long' ? C.green : C.red;
    if (score >= 5) {
      conviction = 'high';
      sizing = 'Full size. Hold runners. High-probability alignment (~68-75%).';
    } else if (score >= 3) {
      conviction = 'medium';
      sizing = 'Standard size. Normal stops. Take clean setups only (~60-65%).';
    } else if (score >= 1) {
      conviction = 'low';
      sizing = 'Reduced size. Tighter stops. Base-rate edge only (~55-58%).';
    } else {
      conviction = 'neutral';
      sizing = 'Score too low or conflicting — treat as neutral. Fade extremes only.';
      biasLabel = 'neutral';
      color = C.yellow;
    }
  }

  return { bias: biasLabel, conviction, sizing, signals, color };
}

function emptyBiasInputs() {
  return {
    prevDayCandle: '',
    insideDayCount: '0',
    profileShape: '',
    prevHighQuality: '', // 'excess'|'normal'|''
    prevLowQuality: '',  // 'excess'|'normal'|''
    pocMigration: '',
    // same-day inputs
    ibSize: '',
    ibCloseMid: '',      // 'above'|'below'|'' — IB close vs IB midpoint (moved to mid-session)
    ibBreakTiming: '',   // 'c_period'|'d_e_period'|'afternoon'|'' — when did break occur
    ibRetrace: '',       // 'shallow'|'deep'|'' — retracement depth after break
    ibFormedLast: '',    // 'high'|'low'|'' — which side of IB formed last (52-57% opposite breaks)
    vaOverlap: '',
    // live / mid-session inputs
    liveEdgeContext: '',
    ibBreakDir: '',
    ibOppositeBreak: '',  // 'no'|'yes_no_accept'|'yes_accepted'|''
    ibSecondBreak: '',    // 'high'|'low'|'' — which side was the second break on double break days
    ibTimeAcceptance: '',
    ibCVD: '',
    pdhPdlBreak: '',     // 'pdh'|'pdl'|'' — PDH or PDL broke during session
  };
}

// ─── Mid-Session Update Engine ────────────────────────────────────────────────
const CONVICTION_LEVELS = ['low','medium','high'];
function applyLiveEdge(result, liveEdgeContext) {
  if (!liveEdgeContext || liveEdgeContext === '') return result;
  if (result.updatedConviction === 'neutral') return result; // neutral days not affected

  const bullishEdge = ['failed_exp_low_middle','low_edge_tapped_held_middle','returning_low_from_below'];
  const bearishEdge = ['failed_exp_high_middle','high_edge_tapped_held_middle','returning_high_from_above'];
  const neutralEdge = ['at_high_edge','at_low_edge','not_at_edge'];

  const edgeDir = bullishEdge.includes(liveEdgeContext) ? 'bullish'
    : bearishEdge.includes(liveEdgeContext) ? 'bearish'
    : 'neutral';

  if (edgeDir === 'neutral') return result;

  const agrees = edgeDir === result.updatedBias;
  const conflicts = edgeDir !== result.updatedBias;
  const curIdx = CONVICTION_LEVELS.indexOf(result.updatedConviction);
  if (curIdx === -1) return result; // non-standard conviction, leave it

  if (agrees) {
    const newIdx = Math.min(curIdx + 1, CONVICTION_LEVELS.length - 1);
    const newConviction = CONVICTION_LEVELS[newIdx];
    return {
      ...result,
      updatedConviction: newConviction,
      verdict: result.verdict + ` Live edge context agrees (${liveEdgeContext.replace(/_/g,' ')}) — conviction upgraded to ${newConviction}.`,
      action: result.action + ` Live edge context reinforces direction.`,
    };
  }

  if (conflicts) {
    const newIdx = Math.max(curIdx - 1, 0);
    const newConviction = CONVICTION_LEVELS[newIdx];
    return {
      ...result,
      updatedConviction: newConviction,
      verdict: result.verdict + ` Live edge context conflicts (${liveEdgeContext.replace(/_/g,' ')}) — conviction downgraded to ${newConviction}.`,
      action: result.action + ` Live edge context is fighting the direction — reduce size, tighten stops.`,
    };
  }

  return result;
}

function computeMidSession(bi, preBias) {
  const { ibBreakDir, ibTimeAcceptance, ibCVD, ibOppositeBreak, liveEdgeContext } = bi;

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
    return applyLiveEdge({
      updatedBias: newBias,
      updatedConviction: conviction,
      verdict: `Neutral day upgraded to ${newBias} by IB break ${ibBreakDir}.`,
      action: cvdDiverging
        ? 'CVD diverging — be cautious. Time acceptance is there but delta is not. Reduce size.'
        : `IB accepted ${ibBreakDir}. Look for ${newBias === 'bullish' ? 'long' : 'short'} setups on pullbacks to IB ${ibBreakDir === 'high' ? 'high' : 'low'} as support/resistance.`,
      color: newBias === 'bullish' ? C.green : C.red,
      effect: 'upgrade',
    }, liveEdgeContext);
  }

  // ── SCENARIO 2: Bias and break agree ──
  if (agrees) {
    const conviction = cvdDiverging ? 'medium' : 'high';
    return applyLiveEdge({
      updatedBias: preBias.bias,
      updatedConviction: conviction,
      verdict: `IB break ${ibBreakDir} confirms ${preBias.bias} bias.`,
      action: cvdDiverging
        ? 'Time accepted but CVD diverging. Confirmation is partial. Standard size, not full press.'
        : `Full confirmation. Press the ${preBias.bias === 'bullish' ? 'long' : 'short'} bias. IB ${ibBreakDir === 'high' ? 'high' : 'low'} is now your support/resistance. Hold runners.`,
      color: preBias.bias === 'bullish' ? C.green : C.red,
      effect: 'confirmed',
    }, liveEdgeContext);
  }

  // ── SCENARIO 3: Bias and break contradict ──
  if (cvdDiverging) {
    return applyLiveEdge({
      updatedBias: preBias.bias,
      updatedConviction: 'medium',
      verdict: `IB break ${ibBreakDir} contradicts bias but CVD is diverging — likely a trap.`,
      action: `Price broke ${ibBreakDir} but delta didn't confirm. High probability failed break. Watch for reversal back through IB ${ibBreakDir === 'high' ? 'high' : 'low'}. Original ${preBias.bias} bias may still be valid.`,
      color: C.yellow,
      effect: 'caution',
    }, liveEdgeContext);
  }

  return applyLiveEdge({
    updatedBias: 'neutral',
    updatedConviction: 'neutral',
    verdict: `IB break ${ibBreakDir} contradicts ${preBias.bias} bias with time + CVD confirmation.`,
    action: `Pre-market bias is wrong today. Stop looking for ${preBias.bias === 'bullish' ? 'longs' : 'shorts'}. Go neutral. Fade the range or sit on hands. Do not flip to ${preBias.bias === 'bullish' ? 'bearish' : 'bullish'} — one IB break is not a full structural reversal.`,
    color: C.orange,
    effect: 'neutralized',
  }, liveEdgeContext);
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
      dayType:'',
      weeklyContext:'',
    },
    trades:[newTrade()],
    eod:{emotions:'',well:'',fix:'',review:'',
      img15ES:'',imgTPOES:'',img15NQ:'',imgTPONQ:''},
  };
}
function newTrade(){return{ticker:'',direction:'',contracts:'',sl:'',plan:'',confluences:[],result:'',points:'',entryTime:'',exitTime:'',emotions:'',notes:'',img1:'',img15:'',open:true};}

// Generate 5-min interval time options for 10:30am - 4:00pm EST
function timeOptions(){
  const opts=[];
  for(let h=10;h<=16;h++){
    for(let m=0;m<60;m+=5){
      if(h===10&&m<30)continue; // start at 10:30
      if(h===16&&m>0)break;     // end at 16:00
      const hh=String(h).padStart(2,'0');
      const mm=String(m).padStart(2,'0');
      const period=h<12?'AM':h===12?'PM':'PM';
      const h12=h>12?h-12:h===0?12:h;
      opts.push({value:`${hh}:${mm}`,label:`${h12}:${mm} ${period}`});
    }
  }
  return opts;
}
const TIME_OPTIONS=timeOptions();

function calcHoldTime(entry,exit){
  if(!entry||!exit)return null;
  const [eh,em]=entry.split(':').map(Number);
  const [xh,xm]=exit.split(':').map(Number);
  const mins=(xh*60+xm)-(eh*60+em);
  if(mins<=0)return null;
  if(mins<60)return `${mins}m`;
  return `${Math.floor(mins/60)}h ${mins%60>0?`${mins%60}m`:''}`.trim();
}

function sessionWindow(time){
  if(!time)return null;
  const [h,m]=time.split(':').map(Number);
  const total=h*60+m;
  if(total>=630&&total<690)return 'C-period';   // 10:30-11:00
  if(total>=690&&total<720)return 'D-period';   // 11:00-12:00
  if(total>=720&&total<840)return 'Noon';       // 12:00-2:00pm
  if(total>=840&&total<=960)return 'Afternoon'; // 2:00-4:00pm
  return null;
}
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

      {/* TPO distribution */}
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
        
      </div>

      {/* VA overlap — regime context, not scored */}
      <div style={{marginBottom:18,padding:'12px 14px',background:C.surface,borderRadius:12,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:11,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,marginBottom:8}}>
          Multi-Day VA Overlap — Regime Context (not scored)
        </div>
        <Pills
          options={[
            {label:'Heavy overlap (2+ sessions)',value:'heavy'},
            {label:'Partial overlap',value:'partial'},
            {label:'No overlap',value:'none'},
          ]}
          value={biasInputs.vaOverlap}
          onChange={set('vaOverlap')}
          colors={{heavy:C.yellow,partial:'#aaa',none:C.blue}}
        />
        
      </div>

      {/* IB formed last — which side formed last leans opposite */}
      <div style={{marginBottom:18}}>
        <SectionLabel>Which side of IB formed LAST?</SectionLabel>
        <Pills
          options={[
            {label:'⬆ HIGH formed last',value:'high'},
            {label:'⬇ LOW formed last',value:'low'},
          ]}
          value={biasInputs.ibFormedLast}
          onChange={set('ibFormedLast')}
          colors={{high:C.red,low:C.green}}
        />
      </div>

      <div style={{height:1,background:C.surface2,margin:'28px 0 24px'}}/>
      <div style={{fontSize:11,color:C.orange,letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:700,marginBottom:6,display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:3,height:14,background:C.orange,borderRadius:2}}/>
        Mid-Session IB Update
      </div>

      {/* IB close vs midpoint — fill at 10:30 when IB closes */}
      <div style={{marginBottom:18}}>
        <SectionLabel>IB close vs midpoint (log at 10:30)</SectionLabel>
        <Pills
          options={[
            {label:'⬆ Closed ABOVE midpoint',value:'above'},
            {label:'⬇ Closed BELOW midpoint',value:'below'},
          ]}
          value={biasInputs.ibCloseMid}
          onChange={set('ibCloseMid')}
          colors={{above:C.green,below:C.red}}
        />
      </div>

      {/* Step 1: Did IB break? */}
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

      {(biasInputs.ibBreakDir === 'high' || biasInputs.ibBreakDir === 'low') && (
        <>
          {/* Step 2: Break result — merged timing + held into one question */}
          <div style={{marginBottom:18}}>
            <SectionLabel>Break result</SectionLabel>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {[
                {label:'✓ Held — broke in C-period (10:30–11:00)',value:'c_period',col:C.green},
                {label:'✓ Held — broke in D/E period (11:00–12:00)',value:'d_e_period',col:C.teal},
                {label:'✓ Held — broke afternoon (12:00+)',value:'afternoon',col:'#aaa'},
                {label:'✗ Snapped back inside',value:'snapped',col:C.red},
              ].map(o=>{
                const isSnapped = o.value === 'snapped';
                const timing = isSnapped ? null : o.value;
                const acceptance = isSnapped ? 'no' : 'yes';
                const isActive = isSnapped
                  ? biasInputs.ibTimeAcceptance === 'no'
                  : biasInputs.ibTimeAcceptance === 'yes' && biasInputs.ibBreakTiming === timing;
                const handleClick = () => {
                  if (isActive) {
                    set('ibTimeAcceptance')('');
                    set('ibBreakTiming')('');
                  } else {
                    set('ibTimeAcceptance')(acceptance);
                    if (!isSnapped) set('ibBreakTiming')(timing);
                    else set('ibBreakTiming')('');
                  }
                };
                return(
                  <button key={o.value} onClick={handleClick} style={{
                    padding:'9px 14px',borderRadius:10,textAlign:'left',
                    border:isActive?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                    background:isActive?o.col+'18':'transparent',
                    cursor:'pointer',transition:'all 0.15s',fontFamily:'inherit',
                  }}>
                    <span style={{color:isActive?o.col:C.textSub,fontSize:13,fontWeight:isActive?700:400}}>{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 3: CVD — only if held */}
          {biasInputs.ibTimeAcceptance === 'yes' && (
            <div style={{marginBottom:18}}>
              <SectionLabel>CVD at the IB break level?</SectionLabel>
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
              
            </div>
          )}

          {/* Step 4: Did opposite side break later in session? — only if first break held */}
          {biasInputs.ibTimeAcceptance === 'yes' && (
            <div style={{marginBottom:18}}>
              <SectionLabel>Did opposite side break later in session?</SectionLabel>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {[
                  {label:'No — single sided all day',value:'no',col:C.teal,sub:'Clean trend day, original break direction held'},
                  {label:'Yes — opposite broke but snapped back',value:'yes_no_accept',col:C.yellow,sub:'Both sides tested, neither fully accepted — rotational day'},
                  {label:'Yes — opposite broke and accepted',value:'yes_accepted',col:C.red,sub:'Double distribution — log which side broke second below'},
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
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 5: Second break direction — only when both sides accepted */}
          {biasInputs.ibOppositeBreak === 'yes_accepted' && (
            <div style={{marginBottom:18}}>
              <SectionLabel>Which side broke SECOND? (68-72% wins)</SectionLabel>
              <Pills
                options={[
                  {label:'⬆ HIGH broke second',value:'high'},
                  {label:'⬇ LOW broke second',value:'low'},
                ]}
                value={biasInputs.ibSecondBreak}
                onChange={set('ibSecondBreak')}
                colors={{high:C.green,low:C.red}}
              />
            </div>
          )}

          {/* Retracement depth after break */}
          {biasInputs.ibTimeAcceptance === 'yes' && (
            <div style={{marginBottom:18}}>
              <SectionLabel>Retracement depth after break</SectionLabel>
              <Pills
                options={[
                  {label:'Shallow (<25% back into IB)',value:'shallow'},
                  {label:'Deep (>50% back into IB)',value:'deep'},
                ]}
                value={biasInputs.ibRetrace}
                onChange={set('ibRetrace')}
                colors={{shallow:C.green,deep:C.red}}
              />
            </div>
          )}
        </>
      )}

      {/* Live Edge Context — updated as session develops */}
      <div style={{marginTop:12,marginBottom:4}}>
        <SectionLabel>Multi-Day Balance Edge (live — adds to score)</SectionLabel>
        
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[
            {label:'⚖️ Balance edge above',value:'balance_edge_above',col:C.yellow},
            {label:'⚖️ Balance edge below',value:'balance_edge_below',col:C.yellow},
            {label:'❌ Failed breakout above',value:'failed_breakout_above',col:C.red},
            {label:'❌ Failed breakout below',value:'failed_breakout_below',col:C.green},
            {label:'📈 Expansion above',value:'expansion_above',col:C.green},
            {label:'📉 Expansion below',value:'expansion_below',col:C.red},
            {label:'⚖️ Middle of balance',value:'middle_of_balance',col:'#aaa'},
          ].map(o=>{
            const active=biasInputs.liveEdgeContext===o.value;
            return(
              <button key={o.value} onClick={()=>set('liveEdgeContext')(active?'':o.value)} style={{
                padding:'6px 12px',borderRadius:20,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                background:active?o.col+'22':'transparent',
                color:active?o.col:C.textMut,fontWeight:active?700:400,transition:'all 0.15s',
              }}>{o.label}</button>
            );
          })}
        </div>
      </div>

      {/* PDH/PDL break during session */}
      <div style={{marginTop:16,marginBottom:4}}>
        <SectionLabel>PDH / PDL interaction during session</SectionLabel>
        
        <Pills
          options={[
            {label:'📈 PDH broke + held',value:'pdh_held'},
            {label:'📉 PDL broke + held',value:'pdl_held'},
            {label:'↩ PDH broke + snapped back',value:'pdh_snapped'},
            {label:'↪ PDL broke + snapped back',value:'pdl_snapped'},
          ]}
          value={biasInputs.pdhPdlBreak}
          onChange={set('pdhPdlBreak')}
          colors={{pdh_held:C.green,pdl_held:C.red,pdh_snapped:C.red,pdl_snapped:C.green}}
        />
        
      </div>

      {/* Profile shape — context only, no scoring */}
      <div style={{marginTop:20,marginBottom:4,padding:'14px 16px',background:C.surface,borderRadius:12,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:11,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,marginBottom:10}}>
          Prior Day Profile Shape — Reference Only (not scored)
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[
            {label:'D — Trend',value:'D',col:C.purple},
            {label:'B — Double dist.',value:'B',col:C.green},
            {label:'b — Trapped shorts',value:'b',col:C.teal},
            {label:'P — Spike rejected',value:'P',col:C.red},
            {label:'Normal bell',value:'normal',col:'#aaa'},
            {label:'Balanced / No Shape',value:'balanced_no_shape',col:'#aaa'},
            {label:'Wide Range / No Shape',value:'wide_range_no_shape',col:C.yellow},
          ].map(o=>{
            const active=biasInputs.profileShape===o.value;
            return(
              <button key={o.value} onClick={()=>set('profileShape')(active?'':o.value)} style={{
                padding:'5px 11px',borderRadius:20,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                background:active?o.col+'22':'transparent',
                color:active?o.col:C.textMut,fontWeight:active?700:400,transition:'all 0.15s',
              }}>{o.label}</button>
            );
          })}
        </div>
        
      </div>

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
            <Input label="SL Points (per contract)" type="number" value={trade.sl} onChange={set('sl')}/>
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
            <div style={{fontSize:11,color:C.textSub,marginBottom:8,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Confluences at Entry</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {[
                {label:'yVAH',value:'yVAH',col:C.blue},
                {label:'yVAL',value:'yVAL',col:C.blue},
                {label:'yPOC',value:'yPOC',col:C.blue},
                {label:'Excess',value:'Excess',col:C.orange},
                {label:'pwVAH',value:'pwVAH',col:C.purple},
                {label:'pwVAL',value:'pwVAL',col:C.purple},
                {label:'pwPOC',value:'pwPOC',col:C.purple},
                {label:'PriorVAH',value:'PriorVAH',col:C.teal},
                {label:'PriorVAL',value:'PriorVAL',col:C.teal},
                {label:'PriorPOC',value:'PriorPOC',col:C.teal},
                {label:'IB High',value:'IBHigh',col:C.teal},
                {label:'IB Low',value:'IBLow',col:C.teal},
                {label:'LEDGE',value:'LEDGE',col:C.yellow},
                {label:'Medium TF Edge',value:'MedTFEdge',col:C.yellow},
                {label:'GAP',value:'GAP',col:C.yellow},
                {label:'Single Prints',value:'SinglePrints',col:C.yellow},
                {label:'ETH VWAP',value:'ETHVWAP',col:C.red},
                {label:'RTH VWAP',value:'RTHVWAP',col:C.green},
              ].map(o=>{
                const active=(trade.confluences||[]).includes(o.value);
                const toggle=()=>{
                  const cur=trade.confluences||[];
                  set('confluences')(active?cur.filter(x=>x!==o.value):[...cur,o.value]);
                };
                return(
                  <button key={o.value} onClick={toggle} style={{
                    padding:'5px 11px',borderRadius:20,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                    border:active?`1.5px solid ${o.col}`:`1.5px solid ${C.border}`,
                    background:active?o.col+'22':'transparent',
                    color:active?o.col:C.textMut,fontWeight:active?700:400,transition:'all 0.15s',
                  }}>{o.label}</button>
                );
              })}
            </div>
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
          <Input label="Total Points (all contracts combined)" type="number" value={trade.points} onChange={set('points')}/>

          {/* Entry / Exit time */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
            <div>
              <div style={{fontSize:11,color:C.textSub,marginBottom:6,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Entry Time (EST)</div>
              <select value={trade.entryTime||''} onChange={e=>set('entryTime')(e.target.value)} style={{
                width:'100%',padding:'9px 12px',borderRadius:10,border:`1.5px solid ${C.border}`,
                background:C.bg,color:trade.entryTime?C.text:C.textDim,fontSize:13,fontFamily:'inherit',
                cursor:'pointer',outline:'none',
              }}>
                <option value=''>-- select --</option>
                {TIME_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:11,color:C.textSub,marginBottom:6,letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:600}}>Exit Time (EST)</div>
              <select value={trade.exitTime||''} onChange={e=>set('exitTime')(e.target.value)} style={{
                width:'100%',padding:'9px 12px',borderRadius:10,border:`1.5px solid ${C.border}`,
                background:C.bg,color:trade.exitTime?C.text:C.textDim,fontSize:13,fontFamily:'inherit',
                cursor:'pointer',outline:'none',
              }}>
                <option value=''>-- select --</option>
                {TIME_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Hold time + session window auto-display */}
          {(trade.entryTime||trade.exitTime)&&(
            <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
              {trade.entryTime&&(()=>{const w=sessionWindow(trade.entryTime);return w&&(
                <div style={{padding:'4px 10px',borderRadius:6,background:C.surface2,border:`1px solid ${C.border}`,fontSize:11,color:C.textSub}}>
                  Entry: <span style={{color:C.blue,fontWeight:700}}>{w}</span>
                </div>
              );})()}
              {calcHoldTime(trade.entryTime,trade.exitTime)&&(
                <div style={{padding:'4px 10px',borderRadius:6,background:C.surface2,border:`1px solid ${C.border}`,fontSize:11,color:C.textSub}}>
                  Hold: <span style={{color:C.yellow,fontWeight:700}}>{calcHoldTime(trade.entryTime,trade.exitTime)}</span>
                </div>
              )}
            </div>
          )}

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
  const wins=trades.filter(t=>t.result==='W').length;
  const losses=trades.filter(t=>t.result==='L').length;
  const counted=trades.filter(t=>t.result).length;
  const wr=counted>0?Math.round((wins/counted)*100):0;
  // Points broken down by instrument — mixing ES and NQ pts is meaningless
  const esPts=trades.filter(t=>['ES','MES'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const nqPts=trades.filter(t=>['NQ','MNQ'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const hasES=trades.some(t=>['ES','MES'].includes(t.ticker));
  const hasNQ=trades.some(t=>['NQ','MNQ'].includes(t.ticker));
  const ptsLabel=hasES&&hasNQ?`ES ${esPts>=0?'+':''}${esPts.toFixed(1)} / NQ ${nqPts>=0?'+':''}${nqPts.toFixed(1)}`:hasES?`${esPts>=0?'+':''}${esPts.toFixed(1)} ES`:hasNQ?`${nqPts>=0?'+':''}${nqPts.toFixed(1)} NQ`:'—';
  const ptsColor=hasES&&hasNQ?C.textSub:hasES?(esPts>=0?C.green:C.red):(nqPts>=0?C.green:C.red);
  return(
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}}>
      <StatBox label="P&L" val={`${total>=0?'+':''}$${total.toFixed(0)}`} color={total>=0?C.green:C.red}/>
      <StatBox label="Points" val={ptsLabel} color={ptsColor}/>
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
  const esPts=trades.filter(t=>['ES','MES'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const nqPts=trades.filter(t=>['NQ','MNQ'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
  const hasES=trades.some(t=>['ES','MES'].includes(t.ticker));
  const hasNQ=trades.some(t=>['NQ','MNQ'].includes(t.ticker));
  const ptsLabel=hasES&&hasNQ?`ES ${esPts>=0?'+':''}${esPts.toFixed(1)} / NQ ${nqPts>=0?'+':''}${nqPts.toFixed(1)}`:hasES?`${esPts>=0?'+':''}${esPts.toFixed(1)} ES`:hasNQ?`${nqPts>=0?'+':''}${nqPts.toFixed(1)} NQ`:'—';
  const ptsColor=hasES&&hasNQ?C.textSub:hasES?(esPts>=0?C.green:C.red):(nqPts>=0?C.green:C.red);

  const[copied,setCopied]=useState(false);
  const[organising,setOrganising]=useState(false);

  const pre=data||{};
  const esIn=data.esInputs||{};
  const nqIn=data.nqInputs||{};
  const biasStr = `ES: ${data.esComputedBias||'—'} | NQ: ${data.nqComputedBias||'—'} | Alignment: ${data.alignmentBias||data.dailyBias||'—'}`;
  const mentalStr = [data.mentalSleep&&`Sleep: ${data.mentalSleep}`,data.mentalStress&&`Stress: ${data.mentalStress}`,data.mentalConfidence&&`Confidence: ${data.mentalConfidence}`,data.mentalExterior&&`External: ${data.mentalExterior}`].filter(Boolean).join(' · ')||'—';
  const biasInputStr=(ins,label)=>`${label} Inputs: Candle=${ins.prevDayCandle||'—'} Shape=${ins.profileShape||'—'}(ref) POC=${ins.pocMigration||'—'} IBSize=${ins.ibSize||'—'} IBFormedLast=${ins.ibFormedLast||'—'} VAOverlap=${ins.vaOverlap||'—'} | Mid: IBCloseMid=${ins.ibCloseMid||'—'} IBBreak=${ins.ibBreakDir||'—'} TimeAccept=${ins.ibTimeAcceptance||'—'} BreakTiming=${ins.ibBreakTiming||'—'} Retrace=${ins.ibRetrace||'—'} CVD=${ins.ibCVD||'—'} OppBreak=${ins.ibOppositeBreak||'—'} SecondBreak=${ins.ibSecondBreak||'—'} PDH/PDL=${ins.pdhPdlBreak||'—'} LiveEdge=${ins.liveEdgeContext||'—'}`;
  const prompt=`Review my trading journal for ${date}.
Bias — ${biasStr}
${biasInputStr(data.esInputs||{},'ES')}
${biasInputStr(data.nqInputs||{},'NQ')}
ES Plan: ${data.esPlan||'—'}
NQ Plan: ${data.nqPlan||'—'}
Day Type: ${data.dayType||'—'}
Weekly Context: ${data.weeklyContext||'—'}
Mental State: ${mentalStr}
Trades (${trades.length}):
${trades.map((t,i)=>{const r=calcRisk(t.ticker,t.contracts,t.sl);const p=calcPnL(t.ticker,t.contracts,t.points);const rr=r>0?(Math.abs(p)/r).toFixed(2):'—';const hold=calcHoldTime(t.entryTime,t.exitTime)||'—';const win=sessionWindow(t.entryTime)||'—';return`Trade ${i+1}: ${t.ticker}|${t.direction||'—'}|${t.contracts}c|SL ${t.sl}pts(per contract)|Setup:${t.plan}|Confluences:${(t.confluences||[]).join(',')||'none'}|Result:${t.result}|TotalPoints:${t.points}|P&L:$${p.toFixed(0)}|Risk:$${r.toFixed(0)}|RR:${rr}R|Entry:${t.entryTime||'—'}EST(${win})|Exit:${t.exitTime||'—'}EST|Hold:${hold}|Emotions:${t.emotions||'—'}|Notes:${t.notes||'—'}`}).join('\n')}
Total P&L: $${total.toFixed(0)} | ES Points: ${esPts.toFixed(1)} | NQ Points: ${nqPts.toFixed(1)}
What I Did Well: ${data.well||'—'}
What I Must Fix: ${data.fix||'—'}
General Review: ${data.review||'—'}
Please: 1. ES vs NQ bias accuracy — did they align or diverge. 2. Did alignment call match what happened. 3. Trade-by-trade breakdown. 4. Mental state impact. 5. What I did well (specific). 6. Top 1-2 fixes. 7. Confirm P&L math (ES=$50/pt NQ=$20/pt MES=$5/pt MNQ=$2/pt — points are total across all contracts, SL is per contract). 8. One edge to build on. Direct, no padding.`;

  const copy=()=>{navigator.clipboard.writeText(prompt);setCopied(true);setTimeout(()=>setCopied(false),2500);};

  const organiseReview=async()=>{
    if(!data.review||data.review.trim()==='')return;
    setOrganising(true);
    try{
      const res=await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'x-api-key': process.env.REACT_APP_ANTHROPIC_API_KEY||'',
          'anthropic-version':'2023-06-01',
          'anthropic-dangerous-direct-browser-access':'true',
        },
        body:JSON.stringify({
          model:'claude-sonnet-4-20250514',
          max_tokens:1000,
          messages:[{role:'user',content:`You are analysing a futures day trader's end-of-day journal entry. The trader has written a raw general review. Your job is to:
1. Fix grammar and spelling in the general review — keep ALL the same words, meaning and content, just fix errors. Do not rephrase or add anything.
2. Extract from the review what the trader did well (specific positives, good executions, correct reads, rules followed).
3. Extract from the review what the trader must fix (mistakes, rule breaks, bad entries, missed exits, anything negative).

Respond ONLY with valid JSON, no markdown, no backticks:
{"review":"corrected general review text here","well":"what was done well, extracted and written cleanly","fix":"what must be fixed, extracted and written cleanly"}

General Review:
${data.review}`}]
        })
      });
      const json=await res.json();
      const text=json.content?.find(b=>b.type==='text')?.text||'';
      const parsed=JSON.parse(text.replace(/```json|```/g,'').trim());
      onChange({...data,review:parsed.review||data.review,well:parsed.well||'',fix:parsed.fix||''});
    }catch(e){console.error('Organise failed',e);}
    setOrganising(false);
  };

  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:24}}>
        {[
          {label:'Day P&L',val:`${total>=0?'+':''}$${total.toFixed(0)}`,col:total>=0?C.green:C.red},
          {label:'Points',val:ptsLabel,col:ptsColor},
        ].map(s=>(
          <div key={s.label} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'16px'}}>
            <div style={{fontSize:11,color:C.textMut,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>{s.label}</div>
            <div style={{fontSize:s.label==='Points'&&hasES&&hasNQ?16:30,fontWeight:800,color:s.col,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>{s.val}</div>
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
      <Field label="General Review" placeholder="Write freely — market narrative, what happened, mistakes, good reads, levels for tomorrow..." value={data.review} onChange={set('review')} rows={6}/>

      <button onClick={organiseReview} disabled={organising||!data.review} style={{
        width:'100%',padding:'13px',marginBottom:16,
        background:organising?C.surface:'transparent',
        border:`1.5px solid ${organising?C.border:C.yellow}`,
        borderRadius:12,color:organising?C.textMut:C.yellow,
        fontSize:13,fontFamily:'inherit',cursor:organising||!data.review?'not-allowed':'pointer',
        fontWeight:700,transition:'all 0.2s',opacity:!data.review?0.4:1,
      }}>{organising?'Organising…':'✦ Organise with AI'}</button>

      {data.well&&(
        <div style={{background:C.green+'10',border:`1px solid ${C.green}30`,borderRadius:12,padding:'14px 16px',marginBottom:12}}>
          <div style={{fontSize:11,color:C.green,textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,marginBottom:8}}>✅ What I Did Well</div>
          <div style={{fontSize:13,color:C.text,lineHeight:1.7,whiteSpace:'pre-wrap'}}>{data.well}</div>
        </div>
      )}
      {data.fix&&(
        <div style={{background:C.red+'10',border:`1px solid ${C.red}30`,borderRadius:12,padding:'14px 16px',marginBottom:16}}>
          <div style={{fontSize:11,color:C.red,textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,marginBottom:8}}>❌ What I Must Fix</div>
          <div style={{fontSize:13,color:C.text,lineHeight:1.7,whiteSpace:'pre-wrap'}}>{data.fix}</div>
        </div>
      )}

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
// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen(){
  const[email,setEmail]=useState('');
  const[password,setPassword]=useState('');
  const[mode,setMode]=useState('login'); // 'login'|'signup'
  const[error,setError]=useState('');
  const[loading,setLoading]=useState(false);

  const handle=async()=>{
    if(!email||!password){setError('Enter email and password.');return;}
    setLoading(true);setError('');
    const{error:err}=mode==='login'?await signIn(email,password):await signUp(email,password);
    setLoading(false);
    if(err)setError(err.message);
  };

  return(
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Inter',sans-serif",padding:20}}>
      <div style={{width:'100%',maxWidth:380,background:C.surface,borderRadius:20,padding:'36px 32px',border:`1px solid ${C.border}`}}>
        <div style={{fontSize:22,fontWeight:800,color:C.text,marginBottom:4}}>Trading Journal</div>
        <div style={{fontSize:13,color:C.textMut,marginBottom:32}}>{mode==='login'?'Sign in to your account':'Create a new account'}</div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:C.textSub,marginBottom:6,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em'}}>Email</div>
          <input
            type="email" value={email} onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handle()}
            placeholder="you@email.com"
            style={{width:'100%',padding:'11px 14px',borderRadius:10,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,fontFamily:'inherit',outline:'none'}}
          />
        </div>
        <div style={{marginBottom:22}}>
          <div style={{fontSize:11,color:C.textSub,marginBottom:6,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em'}}>Password</div>
          <input
            type="password" value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handle()}
            placeholder="••••••••"
            style={{width:'100%',padding:'11px 14px',borderRadius:10,border:`1.5px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,fontFamily:'inherit',outline:'none'}}
          />
        </div>

        {error&&<div style={{fontSize:12,color:C.red,marginBottom:14,padding:'8px 12px',background:C.red+'15',borderRadius:8}}>{error}</div>}

        <button onClick={handle} disabled={loading} style={{
          width:'100%',padding:'13px',borderRadius:12,
          background:loading?C.surface:C.blue,border:'none',
          color:'#fff',fontSize:14,fontFamily:'inherit',fontWeight:700,
          cursor:loading?'not-allowed':'pointer',marginBottom:16,
          opacity:loading?0.6:1,transition:'all 0.15s',
        }}>{loading?'...':(mode==='login'?'Sign In':'Create Account')}</button>

        <div style={{textAlign:'center',fontSize:13,color:C.textMut}}>
          {mode==='login'?'No account? ':'Have an account? '}
          <span onClick={()=>{setMode(m=>m==='login'?'signup':'login');setError('');}} style={{color:C.blue,cursor:'pointer',fontWeight:600}}>
            {mode==='login'?'Sign up':'Sign in'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const today=todayStr();
  const isMobile=useIsMobile();
  const[user,setUser]=useState(null);
  const[authLoading,setAuthLoading]=useState(true);
  const[selectedDate,setSelectedDate]=useState(today);
  const[tab,setTab]=useState(0);
  const[dayData,setDayData]=useState(null);
  const[index,setIndex]=useState({});
  const[loading,setLoading]=useState(true);
  const[saveStatus,setSaveStatus]=useState('idle');
  const[showCal,setShowCal]=useState(false);
  const saveTimer=useRef(null);

  // Auth state listener
  useEffect(()=>{
    getCurrentUser().then(u=>{setUser(u);setAuthLoading(false);});
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user||null);
    });
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{if(user)loadIndex(user.id).then(idx=>setIndex(idx||{}));},[user]);
  useEffect(()=>{
    if(!user)return;
    setLoading(true);
    loadDay(selectedDate,user.id).then(d=>{setDayData(d||emptyDay());setLoading(false);});
  },[selectedDate,user]);

  useEffect(()=>{
    if(!dayData||loading||!user)return;
    setSaveStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      await saveDay(selectedDate,dayData,user.id);
      const trades=dayData.trades||[];
      const total=trades.reduce((s,t)=>s+calcPnL(t.ticker,t.contracts,t.points),0);
      const esPts=trades.filter(t=>['ES','MES'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
      const nqPts=trades.filter(t=>['NQ','MNQ'].includes(t.ticker)).reduce((s,t)=>s+(parseFloat(t.points)||0),0);
      const wins=trades.filter(t=>t.result==='W').length;
      const summary={
        pnl:total,esPts,nqPts,wins,trades:trades.length,
        bias:dayData.pre?.dailyBias||'',
      };
      await saveIndex(selectedDate,summary,user.id);
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

  // Auth loading
  if(authLoading) return(
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Inter',sans-serif"}}>
      <div style={{color:C.textMut,fontSize:14}}>Loading...</div>
    </div>
  );

  // Login screen
  if(!user) return <LoginScreen/>;

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
            <div style={{marginTop:'auto',paddingTop:16,borderTop:`1px solid ${C.border}`}}>
              
              <button onClick={signOut} style={{width:'100%',padding:'8px',borderRadius:8,background:'transparent',border:`1px solid ${C.border}`,color:C.textMut,fontSize:12,fontFamily:'inherit',cursor:'pointer'}}>Sign out</button>
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
                esInputs:dayData.pre.esInputs,
                nqInputs:dayData.pre.nqInputs,
                esPlan:dayData.pre.esPlan,
                nqPlan:dayData.pre.nqPlan,
                dayType:dayData.pre.dayType,
                weeklyContext:dayData.pre.weeklyContext,
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
