// Token Radar's dashboard (radar-14, charter v1.7). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with
// the fitted model's own inputs and the protocol's farm plan with its verdict, and a model
// sandbox that re-ranks the board live. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var MODEL = DATA.model;
  var FIT = DATA.fit;
  var state = {
    q: '', category: 'all', chain: 'all', watchlistOnly: false, minTvl: 0,
    tab: 'pre-token', sort: 'implied', dir: -1, selected: null,
    scale: 1, sandbox: false
  };
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(2) + 'x'; }

  // The page's code and the board's data are visibly the same arithmetic. implied = 10^predicted
  // x launch odds, where predicted is the fitted log value-if-it-launches stored per row.
  // The sandbox scales that value and re-ranks live. Growth is not a production feature
  // (charter v1.4), so there is no growth slider: the 7-day change is display only.
  function valueIfOf(row, scale) {
    var pred = row.predicted_log_value;
    var raw = Math.round(Math.pow(10, pred)) * scale;
    return Math.min(MODEL.value_max, Math.max(MODEL.value_min, Math.round(raw)));
  }
  function impliedOf(row, scale) {
    var vIf = valueIfOf(row, scale);
    return Math.min(MODEL.value_max, Math.max(MODEL.value_min, Math.round(vIf * row.launch_odds)));
  }
  // The EV arithmetic, analytic (charter v1.7): the analytic (closed-form)
  // statistics decide the verdict; the board's simulation draws are only a
  // cross-check. For a row with predicted log value pred, band sigma and
  // launch odds p_L, the value if it launches is lognormal(pred, sigma),
  // capped at the largest observed dated-comp market cap; the net return is
  // (farmer share x value) - cost on launch and -cost otherwise.
  // The seven prespecified gate policies (charter v1.7): (a) the strict rule —
  // log10(value) ~ Normal(predicted, sigma) with sigma from the (possibly OOD-widened)
  // 50% band, and a launch with probability p_L; values are capped at the largest
  // observed comparable market cap (the production distribution is the CAPPED
  // lognormal, kept because its CRPS is no worse than the uncapped one). The mean net
  // return uses the CAPPED LOGNORMAL MEAN of the value — not its median: the mean of a
  // wide lognormal sits far above the median, and the mean is what an expected value
  // is. The quantiles are quantiles of the mixture (a non-launch is a point mass of
  // -cost), so P25 is -cost whenever p_L <= 0.75. The sandbox has no Monte Carlo, so
  // these closed forms are the exact counterparts of the board's simulation — the same
  // numbers within Monte Carlo error.
  function sigmaOf(row) {
    var hw = DATA.validation.band_halfwidth_dex;
    var mult = row.ood ? row.ood.band_multiplier : 1;
    return hw > 0 ? (hw * mult) / 0.6745 : 0.01;
  }
  function normalCdf(z) {
    // Abramowitz-Stegun 7.1.26; |error| < 1.5e-7.
    if (z < 0) return 1 - normalCdf(-z);
    var t = 1 / (1 + 0.2316419 * z);
    var poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return 1 - Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * poly;
  }
  function normalQuantile(p) {
    // Acklam's rational approximation; |error| < 1.15e-9.
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    var pLow = 0.02425, pHigh = 1 - pLow, q, r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= pHigh) {
      q = p - 0.5; r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // The mean of the capped lognormal: E[min(V, cap)] with log10 V ~ N(pred, sigma^2).
  // Closed form on the natural-log scale: E[V * 1(V < cap)] + cap * P(V >= cap).
  // When the CRPS validation reverted the production cap, this is the plain
  // lognormal mean.
  function lognormalMeanValue(pred, sigma) {
    var t = DATA.validation.distribution_tournament;
    if (!t || !t.cap_kept) return Math.pow(10, pred + (sigma * sigma * Math.LN10) / 2);
    var cap = t.cap_usd;
    var m = pred * Math.LN10;
    var sd = sigma * Math.LN10;
    var logCap = Math.log(Math.max(1, cap));
    var uncapped = Math.exp(m + (sd * sd) / 2);
    var below = normalCdf((logCap - m - sd * sd) / sd);
    var above = 1 - normalCdf((logCap - m) / sd);
    return uncapped * below + cap * above;
  }
  function cappedValue(v) {
    var t = DATA.validation.distribution_tournament;
    if (!t || !t.cap_kept) return v;
    return Math.min(t.cap_usd, v);
  }
  function analyticEvStats(row, pred, cost, pL) {
    var sigma = sigmaOf(row);
    var meanValue = lognormalMeanValue(pred, sigma);
    var mean = pL * MODEL.farmer_share * meanValue - cost;
    var conditionalMeanEv = MODEL.farmer_share * meanValue - cost;
    var threshold = Math.log10(Math.max(1, cost / MODEL.farmer_share));
    var probNegative = 1 - pL * (1 - normalCdf((threshold - pred) / sigma));
    function q(prob) {
      if (prob <= 1 - pL) return -cost;
      var qv = (prob - (1 - pL)) / pL;
      var value = cappedValue(Math.pow(10, pred + sigma * normalQuantile(qv)));
      return MODEL.farmer_share * value - cost;
    }
    return { mean: mean, conditionalMeanEv: conditionalMeanEv, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), probNegative: probNegative };
  }
  // The seven prespecified gate policies (charter v1.5): (a) the strict rule —
  // mean EV > 0 AND P25 of the net return > 0; (b) the Gemini proposal — conditional
  // mean EV > 3x plan cost AND unconditional mean EV > 0; (c) the P(loss) ceiling —
  // mean EV > 0 AND P(negative return) <= 0.90; (d) conditional mean EV > 3x plan
  // cost AND P(negative return) <= 0.85 — launch probability as a risk weighting;
  // (e) conditional mean EV > 5x plan cost AND mean EV > 0 AND P(negative return) <= 0.90;
  // (f) the odds-consistent correction of (d) — conditional mean EV > 3x plan cost
  // AND P(negative return) <= 1 - 0.75 x p_L, where p_L is the launch odds of the
  // layer the statistics come from.
  function gatePassesAnalytic(variant, s, cost, pL) {
    if (variant === 'b') return s.conditionalMeanEv > 3 * cost && s.mean > 0;
    if (variant === 'c') return s.mean > 0 && s.probNegative <= 0.9;
    if (variant === 'd') return s.conditionalMeanEv > 3 * cost && s.probNegative <= 0.85;
    if (variant === 'e') return s.conditionalMeanEv > 5 * cost && s.mean > 0 && s.probNegative <= 0.9;
    if (variant === 'f') {
      if (pL === undefined || !isFinite(pL)) return false;
      return s.conditionalMeanEv > 3 * cost && s.probNegative <= 1 - 0.75 * pL;
    }
    return s.mean > 0 && s.p25 > 0;
  }
  function effectiveRows() {
    if (!state.sandbox) return DATA.rows;
    var scale = state.scale;
    var rescored = DATA.rows.map(function (r) {
      var copy = {};
      for (var k in r) copy[k] = r[k];
      var pred = r.predicted_log_value + Math.log10(scale);
      copy.value_if_launches_usd = valueIfOf(r, scale);
      copy.implied_value_usd = impliedOf(r, scale);
      copy.expected_value_usd = Math.round(analyticEvStats(r, pred, r.plan_cost_usd, r.launch_odds).mean);
      copy.verdict = verdictFor(r, pred, r.plan_cost_usd);
      return copy;
    });
    rescored.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    rescored.forEach(function (r, i) { r.sandboxRank = i + 1; });
    return rescored;
  }
  function breakEvenOdds(valueIf, cost) {
    return valueIf > 0 ? cost / (MODEL.farmer_share * valueIf) : Infinity;
  }
  // The farm verdict, analytic-first (charter v1.7): the production verdict
  // is the CONSERVATIVE layer's analytic verdict, except a BORDERLINE row
  // is MARGINAL (REVIEW) whatever its point estimate says. The sandbox can
  // only check borderline clause (a) — |analytic P(negative) − ceiling| ≤
  // 0.01 under either layer — because it has no simulation draws; clause (b)
  // (analytic/sim gate disagreement) is evaluated on the board, not here.
  function verdictFor(row, pred, cost) {
    var adopted = DATA.validation.gate_test.adopted;
    var cons = DATA.validation.launch_odds_decision.conservative_lower_bound;
    var statsAdopted = analyticEvStats(row, pred, cost, row.launch_odds);
    var statsCons = analyticEvStats(row, pred, cost, cons);
    var ceilingFor = function (pL) {
      if (adopted === 'f') return 1 - 0.75 * pL;
      if (adopted === 'd') return 0.85;
      if (adopted === 'c' || adopted === 'e') return 0.9;
      return null;
    };
    var cAdopt = ceilingFor(row.launch_odds);
    var cCons = ceilingFor(cons);
    var borderline = cAdopt !== null && (Math.abs(statsAdopted.probNegative - cAdopt) <= 0.01 || Math.abs(statsCons.probNegative - cCons) <= 0.01);
    if (gatePassesAnalytic(adopted, statsCons, cost, cons) && !borderline) return 'farm';
    if (statsAdopted.mean > 0) return 'marginal';
    if (breakEvenOdds(Math.pow(10, pred), cost) <= MODEL.marginal_break_even) return 'marginal';
    if (borderline) return 'marginal';
    return 'skip';
  }
  function fmtOdds(o) { return (o * 100).toFixed(1) + '%'; }
  // Launch odds (charter v1.4): the BOARD uses the base rate for every row — the seasoning
  // curve is diagnostic only. curveOddsFor is what the curve would say by age, shown in
  // the seasoning table for comparison and never used for a verdict.
  function launchOddsFor() { return DATA.seasoning.base_rate; }
  function curveOddsFor(ageDays) {
    var s = DATA.seasoning;
    if (ageDays === null || ageDays === undefined) return s.base_rate;
    var z = s.intercept + s.slope * Math.log10(ageDays + 1);
    z = Math.max(-30, Math.min(30, z));
    var raw = 1 / (1 + Math.exp(-z));
    if (s.platt_a === null || s.platt_b === null) return raw;
    var logit = Math.log(Math.max(1e-9, raw) / Math.max(1e-9, 1 - raw));
    var z2 = Math.max(-30, Math.min(30, s.platt_a + s.platt_b * logit));
    return 1 / (1 + Math.exp(-z2));
  }
  function fmtShort(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function verdictStep(row) {
    var be = breakEvenOdds(row.value_if_launches_usd, row.plan_cost_usd);
    // Charter v1.7: the verdict text uses the ANALYTIC (closed-form) mean and
    // P(negative) — the numbers that decide the verdict. The stored
    // row.expected_value_usd / row.prob_negative_return are the simulation
    // mean / P(negative) of the same distribution and are kept as the
    // cross-check in the detail view. The P25 is the 25th percentile of the
    // net-return distribution — not a conditional value scenario. Radar-8
    // mislabeled the conditional EV at the P25 value as "P25 EV"; charter
    // v1.2 fixed the label and the math.
    var cons = DATA.validation.launch_odds_decision.conservative_lower_bound;
    var anAdopt = analyticEvStats(row, row.predicted_log_value, row.plan_cost_usd, row.launch_odds);
    var anCons = analyticEvStats(row, row.predicted_log_value, row.plan_cost_usd, cons);
    var ev = anAdopt.mean;
    var evText = ev >= 0 ? '+$' + Math.round(ev).toLocaleString() : '−$' + Math.round(-ev).toLocaleString();
    var p25 = anAdopt.p25;
    var p25Text = p25 >= 0 ? ' The P25 outcome (25th percentile of the net-return distribution) is +$' + Math.round(p25).toLocaleString() : ' The P25 outcome is −$' + Math.round(-p25).toLocaleString();
    var pNeg = Math.round(anAdopt.probNegative * 100);
    var pNegSim = Math.round(row.prob_negative_return * 100);
    if (row.verdict === 'farm') return 'Verdict: FARM — analytic mean expected net return ' + evText + '.' + p25Text + ' Probability of a negative return ' + pNeg + '% (analytic; ' + pNegSim + '% in the simulation cross-check). The adopted gate passes even under the conservative launch odds (' + (cons * 100).toFixed(1) + '%): a ' + fmtOdds(row.launch_odds) + ' launch chance (p_L) beats the ' + fmtOdds(be) + ' break-even (p_BE), against a value if it launches of ' + fmtShort(row.value_if_launches_usd) + ' and a plan cost of about $' + row.plan_cost_usd + '. Farm this protocol first.';
    if (row.verdict === 'marginal') {
      if (row.borderline) return 'Verdict: MARGINAL (BORDERLINE — REVIEW) — analytic mean expected net return ' + evText + '.' + p25Text + ' Probability of a negative return ' + pNeg + '% (analytic; ' + pNegSim + '% simulated). ' + (row.borderline_reason || 'The row sits near a gate ceiling, or the analytic and simulated gate disagree.') + ' No farm/skip call is made on a coin flip: review it, do not farm it on the point estimate.';
      if (row.conditional_farm) return 'Verdict: MARGINAL (CONDITIONAL FARM) — analytic mean expected net return ' + evText + '.' + p25Text + ' Probability of a negative return ' + pNeg + '% (analytic; ' + pNegSim + '% simulated). The adopted gate passes under the adopted launch odds but NOT under the conservative odds (' + (cons * 100).toFixed(1) + '%), so this is a farm only if the launch odds hold at the adopted rate — the production verdict stays marginal. Break-even ' + fmtOdds(be) + ' against a ' + fmtOdds(row.launch_odds) + ' launch chance, value if it launches ' + fmtShort(row.value_if_launches_usd) + ', plan cost about $' + row.plan_cost_usd + '.';
      if (row.gate_pass_adopted && !row.gate_pass_conservative) return 'Verdict: MARGINAL — analytic mean expected net return ' + evText + '.' + p25Text + ' Probability of a negative return ' + pNeg + '% (analytic; ' + pNegSim + '% simulated). Demoted by the stress test: the adopted gate passes under the adopted launch odds but NOT under the conservative launch odds (' + (cons * 100).toFixed(1) + '%), so this is not a farm. Break-even ' + fmtOdds(be) + ' against a ' + fmtOdds(row.launch_odds) + ' launch chance, value if it launches ' + fmtShort(row.value_if_launches_usd) + ', plan cost about $' + row.plan_cost_usd + '. Worth a small position, not a priority.';
      return 'Verdict: MARGINAL — analytic mean expected net return ' + evText + '.' + p25Text + ' Probability of a negative return ' + pNeg + '% (analytic; ' + pNegSim + '% simulated). Needs ' + fmtOdds(be) + ' to break even against a ' + fmtOdds(row.launch_odds) + ' launch chance, against a value if it launches of ' + fmtShort(row.value_if_launches_usd) + ' and a plan cost of about $' + row.plan_cost_usd + '. Worth a small position, not a priority.';
    }
    return 'Verdict: SKIP — analytic mean expected net return ' + evText + ': break-even launch odds ' + fmtOdds(be) + ' are too far from a ' + fmtOdds(row.launch_odds) + ' launch chance, against a value if it launches of ' + fmtShort(row.value_if_launches_usd) + ' and a plan cost of about $' + row.plan_cost_usd + '. Skip it unless its points program changes.';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is
  // special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return 'about $8 of gas';
    if (c === 'solana') return 'about $0.05 of gas';
    if (c === 'bitcoin') return 'about $2 of gas';
    if (c.indexOf('base') >= 0 || c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('mode') >= 0 || c.indexOf('blast') >= 0) return 'about $0.30 of gas';
    if (c.indexOf('binance') >= 0 || c.indexOf('bnb') >= 0) return 'about $0.30 of gas';
    if (c.indexOf('polygon') >= 0 || c.indexOf('avalanche') >= 0 || c.indexOf('fantom') >= 0) return 'about $0.20 of gas';
    return 'about $1 of gas';
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and borrow a small amount against it to show both sides.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through one fee cycle.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('canonical') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then settle it.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares through one rebalance.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('payment') >= 0) return 'Open a payment channel or account on ' + name + ' with $' + capital + ' and route one payment through it.';
    if (c.indexOf('privacy') >= 0) return 'Deposit $' + capital + ' through ' + name + ' on ' + chain + " and use its private transfer once.";
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold the shares.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + " into " + name + "'s basis vault on " + chain + ' and keep the position.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to the chain ' + name + ' runs and use one of its native apps.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: verdictStep(p), cost: 'about $' + p.plan_cost_usd + ' all-in', time: '1 minute to read' },
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'nothing to set up', time: '5 minutes' },
      { text: "Check the protocol's own page for an audit note and a points program before you deposit anything.", cost: 'no fee to check', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'When you unwind, withdraw in two parts a week apart so a late snapshot still sees activity.', cost: gas + ' per withdrawal', time: '10 minutes each' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('watchlist') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var list = effectiveRows();
    var q = state.q.trim().toLowerCase();
    return list.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.watchlistOnly && !r.on_watchlist) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else if (key === 'verdict') { var order = { farm: 0, marginal: 1, skip: 2 }; av = order[a.verdict]; bv = order[b.verdict]; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, el('b', { text: DATA.model_version }), ' model')
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var vc = { farm: 0, marginal: 0, skip: 0 };
    DATA.rows.forEach(function (r) { vc[r.verdict]++; });
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Launch Radar: comps-fitted value tested out of sample, every farm plan costed with a verdict' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor, so the board is the whole pre-token universe the snapshot holds: ',
          el('b', { text: String(DATA.board_size) }), ' rows. Each row is priced by a regression fitted on the live-token comparables: the fitted value if it launches, multiplied by the launch odds, gives the implied value. The launch odds are the base rate of ', el('b', { text: Math.round(DATA.seasoning.base_rate * 1000) / 10 + '%' }), ' for every row under charter v1.7 — the seasoning curve does not beat the base rate out of sample, so the board does not use it. Each farm plan carries TWO verdicts — one under the adopted launch odds, one under the conservative odds — decided by the closed-form (analytic) P(negative return) of the net-return distribution, with the 20,000-draw simulation kept only as a cross-check: the mean is the expected net return of farming it with a standard $10,000 deposit; farm only when the adopted gate (variant ', el('b', { text: DATA.validation.gate_test.adopted }), ') passes even under the conservative launch odds of ', el('b', { text: (DATA.validation.launch_odds_decision.conservative_lower_bound * 100).toFixed(1) + '%' }), '. On this board the gate passes analytically for ', el('b', { text: String(DATA.validation.gate_test.variant_f.farm_count_conservative) + ' rows' }), ' under the conservative odds, but the board farms only ', el('b', { text: vc.farm + ' row' + (vc.farm === 1 ? '' : 's') }), ' — ', el('b', { text: String(DATA.rows.filter(function (r) { return r.farm_demoted_reason === 'borderline' && r.verdict_conservative === 'farm'; }).length) }), ' BORDERLINE rows are demoted to marginal for REVIEW and ', el('b', { text: String(DATA.validation.gate_test.variant_f.farm_count_conservative - vc.farm - DATA.rows.filter(function (r) { return r.farm_demoted_reason === 'borderline' && r.verdict_conservative === 'farm'; }).length) }), ' are blocked by major out-of-distribution. A BORDERLINE row is never farm and never skip. The gate test below shows why: the strict rule farms nothing under any of seven value distributions; the conditional-on-launch gate (d) fires — ' + DATA.validation.gate_test.variant_d.farm_count + ' rows under the adopted odds — but none of them survives the conservative-odds stress test, because its fixed 0.85 ceiling is structurally impossible under the conservative odds; the adopted gate (f) corrects the ceiling to an odds-consistent form and farms ' + DATA.validation.gate_test.variant_f.farm_count + ' rows under both odds layers. The page serves two functions, kept separate: the valuation radar (the conditional value and its uncertainty) and the farming decision engine (which never lowers a threshold to look active). Implied value is a model, not a promise.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) })),
        el('div', { class: 'fact' }, el('span', { text: 'Launch odds (base rate, all rows)' }), el('b', { text: (DATA.seasoning.base_rate * 100).toFixed(1) + '%' })),
        el('div', { class: 'fact' }, el('span', { text: 'Farm verdicts' }), el('b', { text: vc.farm + ' farm / ' + vc.marginal + ' marginal / ' + vc.skip + ' skip' })),
        el('div', { class: 'fact' }, el('span', { text: 'Borderline rows (REVIEW)' }), el('b', { text: String(DATA.rows.filter(function (r) { return r.borderline; }).length) + ' — marginal, never farm or skip' })),
        el('div', { class: 'fact' }, el('span', { text: 'Gate test (adopted variant ' + DATA.validation.gate_test.adopted + ')' }), el('b', { text: 'variant (a) ' + DATA.validation.gate_test.variant_a.farm_count + ' farms, variant (b) ' + DATA.validation.gate_test.variant_b.farm_count + ' farms, variant (c) ' + DATA.validation.gate_test.variant_c.farm_count + ' farms, variant (d) ' + DATA.validation.gate_test.variant_d.farm_count + ' farms, variant (e) ' + DATA.validation.gate_test.variant_e.farm_count + ' farms, variant (f) ' + DATA.validation.gate_test.variant_f.farm_count + ' farms (' + DATA.validation.gate_test.variant_f.farm_count_conservative + ' under conservative odds), variant (g) ' + DATA.validation.gate_test.variant_g.farm_count + ' farms (' + DATA.validation.gate_test.variant_g.farm_count_conservative + ' under conservative odds)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Nested walk-forward error (pooled)' }), el('b', { text: DATA.validation.nested_wf_pooled + ' dex (about ' + (Math.pow(10, DATA.validation.nested_wf_pooled)).toFixed(2) + 'x)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function categoryChart() {
    var byCat = {};
    effectiveRows().forEach(function (r) {
      var c = r.category || 'Other';
      byCat[c] = (byCat[c] || 0) + r.implied_value_usd;
    });
    var cats = Object.keys(byCat).map(function (c) { return { name: c, value: byCat[c] }; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
    var max = cats.length ? cats[0].value : 1;
    return el('section', { class: 'panel chart' },
      el('h2', { text: 'Where the implied value sits' }),
      el('p', { class: 'sub', text: 'Total implied value by category, across the whole board. Risk curators and allocators dominate: the biggest pre-token protocols manage other people\'s capital.' }),
      cats.map(function (c) {
        return el('div', { class: 'cbar' },
          el('span', { class: 'cname', text: c.name }),
          el('div', { class: 'track' }, el('i', { style: 'width:' + Math.max(2, Math.round((c.value / max) * 100)) + '%' })),
          el('span', { class: 'cval', text: fmtUsd(c.value) })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var tvlSel = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      [0, 5e7, 1e8, 5e8, 1e9].map(function (v) {
        return el('option', { value: String(v), text: v === 0 ? 'Any TVL' : 'TVL >= ' + fmtUsd(v), selected: state.minTvl === v ? 'selected' : null });
      })
    );
    tvlSel.addEventListener('change', function () { state.minTvl = Number(tvlSel.value); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchBox.addEventListener('change', function () { state.watchlistOnly = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Size' }), tvlSel),
      el('label', { class: 'check', for: 'watchlist' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankShown = state.sandbox && r.sandboxRank ? r.sandboxRank : r.rank;
      var rankRange = r.rank_range ? r.rank_range : [r.rank, r.rank, r.rank];
      var rankText = state.sandbox ? String(rankShown) : (rankRange[0] === rankRange[2] ? String(rankShown) : String(rankShown) + ' (' + rankRange[0] + '–' + rankRange[2] + ')');
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: rankText }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.on_watchlist ? ' - watchlist' : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('div', { class: 'verdict-cell' },
          el('span', { class: 'verdict ' + r.verdict, text: r.verdict.toUpperCase() }),
          r.conditional_farm ? el('span', { class: 'badge', text: 'CONDITIONAL' }) : null,
          r.borderline ? el('span', { class: 'badge', text: 'BORDERLINE' }) : null,
          r.farm_demoted_reason === 'unstable' ? el('span', { class: 'badge', text: 'UNSTABLE' }) : null,
          r.verdict === 'farm' && r.stability ? el('span', { class: 'sub', text: 'FARM ' + r.stability.farm + '/' + DATA.validation.verdict_stability.n_refits }) : null
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: (state.sandbox ? 'Sandbox ranking: the model re-run with your sliders. board.json keeps the canonical ranks. ' : 'Pre-token protocols, strongest implied value first. Ranks show their LOPO range (min–max across the 70 refits) where the data does not support one precise rank. ') + 'Badges: CONDITIONAL = farm under the adopted odds only; BORDERLINE = within 0.01 of a gate ceiling, or analytic/sim disagree — marginal for REVIEW; UNSTABLE = fewer than 35 of 70 refits agree with FARM. Farm rows show their FARM refit count. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Verdict'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Their market-cap-to-TVL ratios are the comparables the pre-token board is priced on.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function scatterSvg() {
    var pts = DATA.scatter;
    if (!pts.length) return '';
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var W = 560, H = 260, L = 44, R = 12, T = 10, B = 28;
    function px(x) { return (L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R)).toFixed(1); }
    function py(y) { return (T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B)).toFixed(1); }
    var lineY = function (x) { return FIT.intercept + FIT.coef_log_tvl * Math.log10(Math.pow(10, x) + FIT.size_floor_usd); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Scatter of log TVL against log market cap for the live comparables, with the fitted curve">';
    s += '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="#22304a"/>';
    s += '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" stroke="#22304a"/>';
    var linePts = [];
    for (var k = 0; k <= 24; k++) {
      var lx = x0 + ((x1 - x0) * k) / 24;
      linePts.push(px(lx) + ',' + py(lineY(lx)));
    }
    s += '<polyline points="' + linePts.join(' ') + '" fill="none" stroke="#f5b544" stroke-width="2"/>';
    pts.forEach(function (p) { s += '<circle cx="' + px(p.x) + '" cy="' + py(p.y) + '" r="2.5" fill="#2ee6a8" opacity="0.7"/>'; });
    s += '<text x="' + (W / 2) + '" y="' + (H - 6) + '" fill="#8b9bb4" font-size="11" text-anchor="middle">log10 TVL</text>';
    s += '<text x="12" y="' + (H / 2) + '" fill="#8b9bb4" font-size="11" text-anchor="middle" transform="rotate(-90 12 ' + (H / 2) + ')">log10 mcap</text>';
    s += '<text x="' + (W - R) + '" y="' + (T + 10) + '" fill="#f5b544" font-size="11" text-anchor="end">fitted curve (no growth term)</text>';
    s += '</svg>';
    return s;
  }

  function modelPanel() {
    var m = DATA.model;
    var v = DATA.validation;
    var compRows = DATA.comparables.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.count) }),
        el('td', { class: 'num', text: (c.adjustment >= 0 ? '+' : '') + c.adjustment.toFixed(2) + ' dex' }),
        el('td', { text: c.basis === 'category' ? 'shrunk median residual of its live protocols' : 'global fit (no comps)' })
      );
    });
    var chainRows = DATA.chain_adjustments.filter(function (c) { return c.count >= 3; }).map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.count) }),
        el('td', { class: 'num', text: (c.adjustment >= 0 ? '+' : '') + c.adjustment.toFixed(2) + ' dex' }),
        el('td', { text: 'shrunk median residual of its live protocols' })
      );
    });
    var scaleSlider = el('input', { type: 'range', min: '0.5', max: '2', step: '0.05', value: String(state.scale), 'aria-label': 'Fitted value scale' });
    var scaleOut = el('output', { text: state.scale.toFixed(2) + 'x' });
    function onSandbox() {
      state.scale = Number(scaleSlider.value);
      scaleOut.textContent = state.scale.toFixed(2) + 'x';
      state.sandbox = state.scale !== 1;
      render();
    }
    scaleSlider.addEventListener('input', onSandbox);
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the model', onclick: function () { state.scale = 1; state.sandbox = false; render(); } });
    var scatter = el('div', { class: 'scatter' });
    scatter.innerHTML = scatterSvg();
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How value is fitted' }),
      el('p', { class: 'sub', text: 'A ' + v.model_selection.selected.toUpperCase() + '-fitted log-log regression, fitted at run time on the snapshot\'s own live-token comparables — ' + FIT.n_comps + ' DATED protocols with a token trading, TVL and market cap positive, CEX excluded, and only protocols the board could rank: the board\'s own wrapped / staked / bridged / versioned / exchange-product exclusions are applied to the training set too, so the curve is fitted on the population it prices. The 22 undated comparables are hard-gated out of every fit and calibration (charter v1.4) and appear only as a reference table below. Huber, OLS and a mild ridge were co-equal candidates; the prespecified selection rule picked ' + v.model_selection.selected.toUpperCase() + ' — ' + v.model_selection.reason + ' Every group adjustment below is a median residual shrunk toward zero, so a group with one or two comps moves a price a little and a group with fifteen moves it a lot. Growth is not a production feature: the growth coefficient is unstable across folds and no growth variant improves held-out error, so the 7-day change is shown for display only and never enters the fit. Age is not a regression term: the seasoning curve below is diagnostic only — under charter v1.7 every row is priced with the base-rate launch odds, because the curve does not beat the base rate out of sample. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'log10(value if it launches)' }), ' = ', el('b', { text: String(FIT.intercept) }),
        ' + ', el('b', { text: String(FIT.coef_log_tvl) }), ' x log10(TVL + $25M)',
        ' + category adjustment + main-chain adjustment; implied = round(10^predicted) x launch odds (base rate ' + Math.round(DATA.seasoning.base_rate * 1000) / 10 + '%); verdicts from one seeded simulation of the net return (launch Bernoulli x lognormal value): the mean is the expected net return, farm only when the adopted gate passes under the conservative launch odds'
      ),
      el('div', { class: 'facts fit' },
        el('div', { class: 'fact' }, el('span', { text: 'Selected estimator (charter v1.4 rule)' }), el('b', { text: v.model_selection.selected.toUpperCase() })),
        el('div', { class: 'fact' }, el('span', { text: 'In-sample R² (fitted model)' }), el('b', { text: String(v.r2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Walk-forward out-of-sample error (dated comps)' }), el('b', { text: String(v.oos_median_abs_log_err) + ' dex (median)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Nested walk-forward, selection folds 50–80 (pooled)' }), el('b', { text: String(v.nested_selection_pooled) + ' dex (median)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Nested 90% fold — untouched final test' }), el('b', { text: String(v.nested_untouched_90) + ' dex (median)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Stratified walk-forward error' }), el('b', { text: String(v.oos_stratified) + ' dex (median)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Stratified error, dated only' }), el('b', { text: String(v.oos_stratified_dated) + ' dex (median)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Undated comps, reference diagnostic' }), el('b', { text: String(v.oos_undated) + ' dex (median, ' + v.n_undated_comps + ' undated comps)' })),
        el('div', { class: 'fact' }, el('span', { text: '5-fold cross-validation error' }), el('b', { text: String(v.cv_median_abs_log_err) + ' dex (median)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Bootstrap SD (200 refits, diagnostic)' }), el('b', { text: '±' + String(v.bootstrap_sd) + ' dex' })),
        el('div', { class: 'fact' }, el('span', { text: 'Value band (cross-conformal 50%)' }), el('b', { text: '±' + String(v.band_halfwidth_dex) + ' dex, holds ' + Math.round(v.range_holds * 100) + '% of comps' })),
        el('div', { class: 'fact' }, el('span', { text: 'Purge gap (walk-forward)' }), el('b', { text: String(v.purge_gap_days) + ' days' })),
        el('div', { class: 'fact' }, el('span', { text: 'Evaluation charter' }), el('b', { text: String(v.charter_version) })),
        el('div', { class: 'fact' }, el('span', { text: 'Walk-forward split' }), el('b', { text: v.n_train + ' train (oldest) / ' + v.n_test + ' test (newest)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live comparables fitted (dated only)' }), el('b', { text: String(FIT.n_comps) }))
      ),
      el('p', { class: 'sub', text: 'Tested out of sample four ways: the walk-forward fits the oldest 70% of the dated live comparables by listing date and scores the newest 30% — dated only, because a protocol with no listing date has no position in time; the nested expanding-window walk-forward trains on the oldest 50/60/70/80/90% and tests on the next 10% forward in time, with a 30-day purge gap that drops training rows listed within 30 days before a test window — folds 50–80 are the prespecified selection metric and the 90% fold (the newest 7 comps) is the untouched final test, used for no choice of any kind; the stratified split trains on dated 70% only and scores the dated 30% plus the undated 30% as a reference diagnostic; and a 5-fold cross-validation shuffles the dated set once with a fixed seed. The undated comps cannot be dated from this snapshot — it carries no listing history beyond the listed_at field, which is empty for them — and they are hard-gated out of every fit: bridges and legacy protocols whose market cap belongs to another token. A median error of ' + v.oos_median_abs_log_err + ' dex means a typical prediction is off by that many orders of magnitude either way. The value band of ±' + v.band_halfwidth_dex + ' dex is cross-conformal: the 50% quantile of the absolute out-of-fold residuals from the 5-fold cross-validation on the ' + FIT.n_comps + ' dated comps, so it holds ' + Math.round(v.range_holds * 100) + '% of them by construction — the 80% and 90% bands are in the table below. The bootstrap SD of ±' + v.bootstrap_sd + ' dex is how much the fitted value itself wobbles when the comparables are resampled, kept as a diagnostic only. Every number on this page follows evaluation charter ' + v.charter_version + ' — the ranking is a guide for where to look first, not a price. The $25M floor keeps the curve from pricing a small protocol at zero for being small: TVL below $25M is noisy in the snapshot. The seasoning curve is fitted on all ' + DATA.seasoning.n_protocols + ' dated protocols in the snapshot (base launch rate ' + Math.round(DATA.seasoning.base_rate * 100) + '%); an unlisted age uses the base rate. Wrapped, staked and bridged products of tokens that already trade are set aside, not ranked: their token already exists, so there is no launch to price.' }),
      scatter,
      el('div', { class: 'sandbox' },
        el('label', null, 'Fitted value scale ', scaleOut, scaleSlider),
        el('p', { class: 'note sub', text: 'Move the slider and the board re-ranks live. This is a what-if: board.json keeps the canonical ranks from the fitted model above. There is no growth slider: growth is not a production feature (charter v1.4) — the 7-day change is display only.' }),
        reset
      ),
      el('h3', { text: 'Category adjustments the model priced on' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live comps' }), el('th', { scope: 'col', text: 'Adjustment' }), el('th', { scope: 'col', text: 'Basis' }))),
          el('tbody', null, compRows)
        )
      ),
      el('h3', { text: 'Main-chain adjustments the model priced on (chains with 3+ comps)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Main chain' }), el('th', { scope: 'col', text: 'Live comps' }), el('th', { scope: 'col', text: 'Adjustment' }), el('th', { scope: 'col', text: 'Basis' }))),
          el('tbody', null, chainRows)
        )
      ),
      el('h3', { text: 'Seasoning: launch odds by protocol age (diagnostic only — the board uses the base rate)' }),
      el('p', { class: 'sub', text: 'A logistic curve fitted on all ' + DATA.seasoning.n_protocols + ' dated protocols in the snapshot: the older a protocol has run with no token, the more likely it is to launch one. Under charter v1.4 this curve is DIAGNOSTIC ONLY — every board row takes the base rate of ' + Math.round(DATA.seasoning.base_rate * 100) + '%, because the curve does not beat the base rate on both Brier and log-loss on the untouched test set (see the audit and the launch-odds decision below). The table shows what the curve would say by age, for comparison; no verdict uses it.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Age' }), el('th', { scope: 'col', text: 'Curve odds (diagnostic)' }), el('th', { scope: 'col', text: 'Board odds (base rate)' }))),
          el('tbody', null, [30, 90, 180, 365, 730, 1500, 2200].map(function (days) {
            return el('tr', null,
              el('td', { text: days >= 365 ? (days / 365).toFixed(1) + ' years' : days + ' days' }),
              el('td', { class: 'num', text: fmtOdds(curveOddsFor(days)) }),
              el('td', { class: 'num', text: fmtOdds(launchOddsFor()) })
            );
          }))
        )
      ),
      el('h3', { text: 'Seasoning validation: fold-local refits' }),
      el('p', { class: 'sub', text: 'At each nested cutoff the curve is refitted only on protocols listed before the cutoff and scored on the next 50 listed after it — the full fit above is used for the board only, never for a validation metric. Pooled: Brier ' + v.seasoning_validation.brier + ' (base rate ' + v.seasoning_validation.base_rate_brier + '), log-loss ' + v.seasoning_validation.log_loss + ' (base rate ' + v.seasoning_validation.base_rate_log_loss + '), ECE ' + v.seasoning_validation.ece + '. Verdict: ' + v.seasoning_validation.verdict + ' — the curve beats predicting the base rate only slightly out of sample, so treat its launch odds as directionally right, not precisely calibrated. Token status is measured at the snapshot date for every protocol, so the curve is a cross-sectional association, not a historical hazard.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Train on oldest' }), el('th', { scope: 'col', text: 'Cutoff' }), el('th', { scope: 'col', text: 'Protocols fitted' }), el('th', { scope: 'col', text: 'Brier' }), el('th', { scope: 'col', text: 'Log-loss' }), el('th', { scope: 'col', text: 'ECE' }), el('th', { scope: 'col', text: 'Mean predicted' }), el('th', { scope: 'col', text: 'Actual rate' }))),
          el('tbody', null, v.seasoning_folds.map(function (f) {
            return el('tr', null, el('td', { text: f.train_pct + '%' }), el('td', { text: f.cutoff }), el('td', { class: 'num', text: String(f.n_fit) }), el('td', { class: 'num', text: String(f.brier) }), el('td', { class: 'num', text: String(f.log_loss) }), el('td', { class: 'num', text: String(f.ece) }), el('td', { class: 'num', text: Math.round(f.mean_pred * 100) + '%' }), el('td', { class: 'num', text: Math.round(f.actual_rate * 100) + '%' }));
          }))
        )
      ),
      el('h3', { text: 'Launch-probability audit: is the curve better than the base rate?' }),
      el('p', { class: 'sub', text: 'On the ' + v.seasoning_audit.n_pooled + ' pooled fold-local predictions, the curve’s ranking signal is weak (ROC-AUC ' + v.seasoning_audit.roc_auc + ', PR-AUC ' + v.seasoning_audit.pr_auc + ' against a base launch rate of ' + Math.round(DATA.seasoning.base_rate * 100) + '%) and its improvement over predicting the base rate is NOT statistically significant: the bootstrap 95% interval for the Brier improvement is [' + v.seasoning_audit.brier_improvement_ci[0] + ', ' + v.seasoning_audit.brier_improvement_ci[1] + '] and for log-loss [' + v.seasoning_audit.log_loss_improvement_ci[0] + ', ' + v.seasoning_audit.log_loss_improvement_ci[1] + '] — both straddle zero. ' + (DATA.seasoning.platt_a !== null ? 'A Platt recalibration was adopted (a = ' + DATA.seasoning.platt_a + ', b = ' + DATA.seasoning.platt_b + '): ' + v.seasoning_audit.platt.reason : 'No Platt recalibration was adopted: ' + v.seasoning_audit.platt.reason) + ' Note honestly: on the untouched 80/90 test set the base rate itself scores Brier ' + v.seasoning_audit.platt.test_brier_base + ' and log-loss ' + v.seasoning_audit.platt.test_log_loss_base + ' — better than both the raw curve (' + v.seasoning_audit.platt.test_brier_raw + ' / ' + v.seasoning_audit.platt.test_log_loss_raw + ') and the Platt curve (' + v.seasoning_audit.platt.test_brier_platt + ' / ' + v.seasoning_audit.platt.test_log_loss_platt + '). Under charter v1.4 the board therefore does NOT use the curve at all: every row takes the base rate, and the curve is kept only as a diagnostic — it ranks protocols by age where the base rate cannot, but it has not earned the board.' }),
      el('h3', { text: 'Launch-odds decision: base rate, not the curve (charter v1.4)' }),
      el('p', { class: 'sub', text: v.launch_odds_decision.reason + ' The conservative lower bound is the 2.5th percentile of a 2,000-resample bootstrap of the base rate over the ' + DATA.seasoning.n_protocols + ' dated protocols (seed 20261107): the FARM gate must pass under it. The three predictors below are compared on the SAME untouched test rows — calibration (ECE) and discrimination (ROC-AUC) reported separately, as the audit requires.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Predictor' }), el('th', { scope: 'col', text: 'Brier (lower better)' }), el('th', { scope: 'col', text: 'Log-loss (lower better)' }), el('th', { scope: 'col', text: 'ECE (lower better)' }), el('th', { scope: 'col', text: 'ROC-AUC' }), el('th', { scope: 'col', text: 'Used by the board?' }))),
          el('tbody', null, [
            el('tr', null, el('td', { text: 'Base rate (' + Math.round(DATA.seasoning.base_rate * 1000) / 10 + '%)' }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_brier_base) }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_log_loss_base) }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_ece_base) }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_roc_base) }), el('td', { text: 'YES — adopted' })),
            el('tr', null, el('td', { text: 'Seasoning curve (raw)' }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_brier_raw) }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_log_loss_raw) }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_ece_raw) }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_roc_raw) }), el('td', { text: 'No — diagnostic only' })),
            el('tr', null, el('td', { text: 'Platt-calibrated curve (a = ' + v.seasoning_audit.platt.fitted_a + ', b = ' + v.seasoning_audit.platt.fitted_b + ')' }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_brier_platt) }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_log_loss_platt) }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_ece_platt) }), el('td', { class: 'num', text: String(v.seasoning_audit.platt.test_roc_platt) }), el('td', { text: 'No — fitted, not adopted' })),
          ])
        )
      ),
      el('p', { class: 'sub', text: 'Untouched test set: n = ' + v.seasoning_audit.platt.n_test + ' rows; calibration set: n = ' + v.seasoning_audit.platt.n_calibration + '. The Platt parameters were fitted on the calibration set and tested on the untouched set — and still lost to the base rate. The fitted Platt odds are kept per row (launch_odds_platt) only so the EV stress test can price what the farm would look like under them.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Predicted odds' }), el('th', { scope: 'col', text: 'Protocols' }), el('th', { scope: 'col', text: 'Mean predicted' }), el('th', { scope: 'col', text: 'Actually launched' }))),
          el('tbody', null, v.seasoning_audit.reliability_bins.map(function (b) {
            return el('tr', null, el('td', { text: Math.round(b.pred_min * 100) + '–' + Math.round(b.pred_max * 100) + '%' }), el('td', { class: 'num', text: String(b.n) }), el('td', { class: 'num', text: Math.round(b.mean_pred * 100) + '%' }), el('td', { class: 'num', text: Math.round(b.actual_rate * 100) + '%' }));
          }))
        )
      ),
      el('h3', { text: 'Model selection: three co-equal candidates (charter v1.4)' }),
      el('p', { class: 'sub', text: 'Huber, OLS and a mild ridge (λ = 1.0 on the standardized log-TVL slope) were fitted on identical rows and folds. Rule: the best nested 50–80 pooled median wins; a gap under 0.01 dex prefers the simpler model (OLS > ridge > Huber); Huber needs a P90 tail error better than OLS by > 0.05 dex AND a smaller drop-one slope change. R² is never the criterion. Selected: ' + v.model_selection.selected.toUpperCase() + ' — ' + v.model_selection.reason }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Estimator' }), el('th', { scope: 'col', text: 'Selection pooled 50–80 (dex)' }), el('th', { scope: 'col', text: 'Selection P90 (dex)' }), el('th', { scope: 'col', text: 'Walk-forward 70/30 (dex)' }), el('th', { scope: 'col', text: '5-fold CV (dex)' }), el('th', { scope: 'col', text: 'Drop-one slope change' }))),
          el('tbody', null, v.model_selection.candidates.map(function (c) {
            return el('tr', null, el('td', { text: c.estimator.toUpperCase() + (c.estimator === v.model_selection.selected ? ' (selected)' : '') }), el('td', { class: 'num', text: String(c.selection_pooled) }), el('td', { class: 'num', text: String(c.selection_p90) }), el('td', { class: 'num', text: String(c.wf) }), el('td', { class: 'num', text: String(c.cv) }), el('td', { class: 'num', text: String(c.drop_one_slope_change) }));
          }))
        )
      ),
      el('h3', { text: 'TVL floor sensitivity: the $25M floor is locked, this only reports (charter v1.4)' }),
      el('p', { class: 'sub', text: 'The floor was re-gridded at $0M / $10M / $25M / $50M / $100M with the selected estimator on the same 70 dated comps, and the board re-ranked under each floor. The floor stays $25M — this diagnostic reports, it does not select. ' + v.floor_sensitivity.note + ' Choosing the floor inside the training folds only (' + v.floor_sensitivity.training_fold_choice_floors + ') gives ' + v.floor_sensitivity.training_fold_choice_pooled_dex + ' dex pooled — WORSE than the locked $25M floor’s ' + v.floor_sensitivity.locked_floor_pooled_dex + ' dex — so per-fold floor selection overfits, and there is no case to move it.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Floor' }), el('th', { scope: 'col', text: 'Intercept' }), el('th', { scope: 'col', text: 'TVL coefficient' }), el('th', { scope: 'col', text: 'Selection pooled (dex)' }), el('th', { scope: 'col', text: 'Spearman ρ vs $25M board' }), el('th', { scope: 'col', text: 'Top-20 overlap vs $25M' }), el('th', { scope: 'col', text: 'Top-10 changes vs $25M' }))),
          el('tbody', null, v.floor_sensitivity.rows.map(function (r) {
            return el('tr', null,
              el('td', { text: (r.floor_usd === 0 ? '$0M' : '$' + Math.round(r.floor_usd / 1e6) + 'M') + (r.floor_usd === 25000000 ? ' (locked)' : '') }),
              el('td', { class: 'num', text: String(r.intercept) }),
              el('td', { class: 'num', text: String(r.coef_log_tvl) }),
              el('td', { class: 'num', text: String(r.selection_pooled_dex) }),
              el('td', { class: 'num', text: String(r.spearman_vs_25m) }),
              el('td', { class: 'num', text: String(r.top20_overlap_vs_25m) + ' / 20' }),
              el('td', { class: 'num', text: String(r.top10_changes_vs_25m) })
            );
          }))
        )
      ),
      el('h3', { text: 'Calibration: selected model against the OLS and ridge baselines' }),
      el('p', { class: 'sub', text: 'The old least-squares model and the ridge baseline are kept on the same features and the same splits, so the comparison isolates the fitting method. The growth diagnostic below is a Huber fit with a signed growth term, no clamp, on the identical splits — production has no growth term.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Metric' }), el('th', { scope: 'col', text: 'Selected (' + v.model_selection.selected.toUpperCase() + ')' }), el('th', { scope: 'col', text: 'OLS benchmark' }), el('th', { scope: 'col', text: 'Ridge baseline' }))),
          el('tbody', null, [
            ['R2 (in-sample)', v.r2, v.ols_baseline.r2, v.ridge_baseline.r2],
            ['Walk-forward 70/30 (dex)', v.oos_median_abs_log_err, v.ols_baseline.oos_median_abs_log_err, v.ridge_baseline.oos_median_abs_log_err],
            ['5-fold CV (dex)', v.cv_median_abs_log_err, v.ols_baseline.cv_median_abs_log_err, v.ridge_baseline.cv_median_abs_log_err],
            ['Nested walk-forward pooled (dex)', v.nested_wf_pooled, v.ols_baseline.nested_wf_pooled, v.ridge_baseline.nested_wf_pooled],
          ].map(function (r) {
            return el('tr', null, el('td', { text: r[0] }), el('td', { class: 'num', text: String(r[1]) }), el('td', { class: 'num', text: String(r[2]) }), el('td', { class: 'num', text: String(r[3]) }));
          }))
        )
      ),
      el('h3', { text: 'Growth diagnostic: signed growth, no clamp (reported only)' }),
      el('p', { class: 'sub', text: 'Walk-forward ' + v.growth_diagnostic.wf + ' dex, nested pooled ' + v.growth_diagnostic.nested_pooled + ' dex, 5-fold CV ' + v.growth_diagnostic.cv + ' dex, full-fit growth coefficient ' + v.growth_diagnostic.coef_growth_full_fit + '. ' + v.growth_diagnostic.verdict }),
      el('h3', { text: 'Paired Huber-vs-OLS differences (same observations, same folds)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Split' }), el('th', { scope: 'col', text: 'Median diff (dex)' }), el('th', { scope: 'col', text: '95% interval' }), el('th', { scope: 'col', text: 'Huber better on' }))),
          el('tbody', null, [
            ['Walk-forward 70/30', v.huber_vs_ols.wf],
            ['Nested pooled', v.huber_vs_ols.nested],
            ['5-fold CV', v.huber_vs_ols.cv],
          ].map(function (r) {
            return el('tr', null, el('td', { text: r[0] }), el('td', { class: 'num', text: (r[1].median_diff >= 0 ? '+' : '') + String(r[1].median_diff) }), el('td', { class: 'num', text: '[' + r[1].ci_lo + ', ' + r[1].ci_hi + ']' }), el('td', { class: 'num', text: String(r[1].n_better_huber) + ' / ' + String(r[1].n) }));
          }))
        )
      ),
      el('p', { class: 'sub', text: 'A positive median diff means Huber errs more than OLS on the typical observation. The nested comparison uses the selection folds (50–80). The selection rule, not this table, decides the estimator — and it picked ' + v.model_selection.selected.toUpperCase() + '.' }),
      el('h3', { text: 'Nested walk-forward folds (dated comparables, forward in time)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Train on oldest' }), el('th', { scope: 'col', text: 'Test (next 10%)' }), el('th', { scope: 'col', text: 'Median error (dex)' }))),
          el('tbody', null, v.nested_wf_folds.map(function (f) {
            return el('tr', null, el('td', { text: f.train_pct + '%' }), el('td', { class: 'num', text: String(f.n_test) }), el('td', { class: 'num', text: String(f.median_abs_log_err) }));
          }))
        )
      ),
      el('p', { class: 'sub', text: 'Pooled across all five folds, the nested walk-forward error is ' + v.nested_wf_pooled + ' dex (about ' + (Math.pow(10, v.nested_wf_pooled)).toFixed(2) + 'x) for the selected ' + v.model_selection.selected.toUpperCase() + ' model. Folds 50–80 pooled (' + v.nested_selection_pooled + ' dex) are the selection metric; the 90% fold (' + v.nested_untouched_90 + ' dex, the newest 7 comps) is the untouched final test — it was used for no choice of any kind. The earliest fold (train 50%) has the least history to learn from; the latest folds test on the newest listings.' }),
      el('h3', { text: 'Nested fold diagnostics: what each test window held' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Train' }), el('th', { scope: 'col', text: 'Test window' }), el('th', { scope: 'col', text: 'Median TVL' }), el('th', { scope: 'col', text: 'Median age' }), el('th', { scope: 'col', text: 'Unseen categories / chains' }), el('th', { scope: 'col', text: 'Median signed error' }), el('th', { scope: 'col', text: 'Median abs error' }), el('th', { scope: 'col', text: 'P90 error' }))),
          el('tbody', null, v.nested_fold_diagnostics.map(function (d) {
            return el('tr', null, el('td', { text: d.train_pct + '%' }), el('td', { text: d.test_start + ' → ' + d.test_end }), el('td', { class: 'num', text: fmtUsd(d.median_tvl_usd) }), el('td', { class: 'num', text: fmtAge(d.median_age_days) }), el('td', { class: 'num', text: d.unseen_categories + ' / ' + d.unseen_chains }), el('td', { class: 'num', text: (d.median_signed_log_err >= 0 ? '+' : '') + String(d.median_signed_log_err) }), el('td', { class: 'num', text: String(d.median_abs_log_err) }), el('td', { class: 'num', text: String(d.p90_abs_log_err) }));
          }))
        )
      ),
      el('p', { class: 'sub', text: 'The 80% fold is the hard fold (median ' + v.nested_fold_diagnostics[3].median_abs_log_err + ' dex, P90 ' + v.nested_fold_diagnostics[3].p90_abs_log_err + ' dex, median signed error +' + v.nested_fold_diagnostics[3].median_signed_log_err + ' dex — the fold is systematically under-predicted): its test window (' + v.nested_fold_diagnostics[3].test_start + ' → ' + v.nested_fold_diagnostics[3].test_end + ') holds the newest listings, including structural extremes — ' + v.nested_fold_diagnostics[3].rows.slice().sort(function (a, b) { return b.abs_log_err - a.abs_log_err; }).slice(0, 2).map(function (r) { return r.slug + ' (' + r.category + ', error ' + r.abs_log_err + ' dex)'; }).join(' and ') + ' — and ' + v.nested_fold_diagnostics[3].unseen_categories + ' of its 7 rows are in categories with zero training comps plus ' + v.nested_fold_diagnostics[3].unseen_chains + ' unseen chain. The fold is kept and reported, never deleted: it is the data, not the estimator.' }),
      el('h3', { text: 'Nested reconciliation: why 0.3203 ≠ 0.3284 (charter v1.4)' }),
      el('p', { class: 'sub', text: v.nested_reconciliation.difference_explanation + ' ' + v.nested_reconciliation.aggregation + ' Same observations: ' + (v.nested_reconciliation.same_observations ? 'yes' : 'NO — the observation sets differ, which is the whole difference') + '. Same features, purge and estimator: ' + (v.nested_reconciliation.same_features_purge_estimator ? 'yes' : 'no') + '. Recomputed from the sealed snapshot, both numbers reproduce exactly (' + v.nested_reconciliation.recomputed_selection_dex + ' and ' + v.nested_reconciliation.recomputed_all_folds_dex + ' dex) — the difference is a different test set, not a different calculation.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Number' }), el('th', { scope: 'col', text: 'Folds' }), el('th', { scope: 'col', text: 'Test rows' }), el('th', { scope: 'col', text: 'Fold dates' }), el('th', { scope: 'col', text: 'Pooled median (dex)' }), el('th', { scope: 'col', text: 'Mean of fold medians (dex)' }))),
          el('tbody', null, [
            el('tr', null, el('td', { text: 'nested_selection_pooled (the selection metric)' }), el('td', { text: v.nested_reconciliation.selection.folds }), el('td', { class: 'num', text: String(v.nested_reconciliation.selection.n_test_rows) }), el('td', { text: v.nested_reconciliation.selection.fold_date_range }), el('td', { class: 'num', text: String(v.nested_reconciliation.selection.pooled_median_dex) }), el('td', { class: 'num', text: String(v.nested_reconciliation.selection.mean_of_fold_medians_dex) })),
            el('tr', null, el('td', { text: 'nested_wf_pooled (all folds, incl. the untouched 90%)' }), el('td', { text: v.nested_reconciliation.all_folds.folds }), el('td', { class: 'num', text: String(v.nested_reconciliation.all_folds.n_test_rows) }), el('td', { text: v.nested_reconciliation.all_folds.fold_date_range }), el('td', { class: 'num', text: String(v.nested_reconciliation.all_folds.pooled_median_dex) }), el('td', { class: 'num', text: String(v.nested_reconciliation.all_folds.mean_of_fold_medians_dex) })),
          ])
        )
      ),
      el('h3', { text: 'Value band: cross-conformal intervals' }),
      el('p', { class: 'sub', text: 'The band is the nominal-coverage quantile of the absolute out-of-fold residuals from the 5-fold cross-validation on the ' + FIT.n_comps + ' dated comps (finite-sample corrected), not a bootstrap guess: a 50% band holds about 50% of the comparables by construction. The strict split-conformal check (train 70% / calibration 15% / test 15% on dated comps, train purged) gives a 50% band of ±' + v.conformal_split_check.halfwidth_50_dex + ' dex holding ' + Math.round(v.conformal_split_check.test_coverage_50 * 100) + '% of its ' + v.conformal_split_check.n_test + ' test rows — its calibration set is only n=' + v.conformal_split_check.n_calibration + ', so it is a secondary check. The undated column is a diagnostic against the dated band, not a calibration result: ' + v.conformal_undated.analysis }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Nominal coverage' }), el('th', { scope: 'col', text: 'Half-width (dex)' }), el('th', { scope: 'col', text: 'Coverage, all comps' }), el('th', { scope: 'col', text: 'Coverage, dated' }), el('th', { scope: 'col', text: 'Coverage, undated' }))),
          el('tbody', null, v.conformal_bands.map(function (b) {
            return el('tr', null, el('td', { text: Math.round(b.nominal * 100) + '%' }), el('td', { class: 'num', text: '±' + String(b.halfwidth_dex) }), el('td', { class: 'num', text: Math.round(b.coverage * 100) + '%' }), el('td', { class: 'num', text: Math.round(b.coverage_dated * 100) + '%' }), el('td', { class: 'num', text: Math.round(b.coverage_undated * 100) + '%' }));
          }))
        )
      ),
      el('h3', { text: 'Out-of-distribution: more than half the board extrapolates (charter v1.4)' }),
      (function () {
        var oodRows = DATA.rows.filter(function (r) { return r.ood && r.ood.is_ood; });
        var unseenChain = 0, unseenCat = 0, tvlOut = 0, ageOut = 0;
        oodRows.forEach(function (r) {
          if (r.ood.unseen_chain) unseenChain++;
          if (r.ood.unseen_category) unseenCat++;
          if (r.ood.tvl_out_of_range) tvlOut++;
          if (r.ood.age_out_of_range) ageOut++;
        });
        return el('div', null,
          el('p', { class: 'sub', text: oodRows.length + ' of ' + DATA.rows.length + ' board rows sit outside the training domain — unseen chain (' + unseenChain + ' rows), unseen category (' + unseenCat + '), TVL outside the training range (' + tvlOut + '), age outside the training range (' + ageOut + '), of which ' + oodRows.filter(function (r) { return r.ood.tier === 'partial'; }).length + ' are partially out-of-distribution (1 flag) and ' + oodRows.filter(function (r) { return r.ood.tier === 'major'; }).length + ' are major (2+ flags). The band multiplier is the validated one (x' + v.ood_multiplier_validation.adopted_multiplier + ', see the validation below) — the x1.5 widening radar-9 used was never validated, and the data does not support it. Partially out-of-distribution rows carry the confidence label "extrapolation"; major rows carry "unsupported" and can never be a production FARM. The nearest-comparable distance is small (at most 0.12 dex), so the extrapolation is about novelty — new chains and categories the 70 dated comps never saw — not about distance from a neighbor. The top row, Polymarket, is partially out-of-distribution (unseen chain): exploratory extrapolation, not a production farm.' }),
          el('div', { class: 'table-wrap' },
            el('table', { class: 'comps' },
              el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Row' }), el('th', { scope: 'col', text: 'Why out-of-distribution' }), el('th', { scope: 'col', text: 'Tier' }), el('th', { scope: 'col', text: 'Nearest comp (dex)' }), el('th', { scope: 'col', text: 'Band multiplier' }), el('th', { scope: 'col', text: 'Confidence' }))),
              el('tbody', null, oodRows.slice(0, 25).map(function (r) {
                var why = [];
                if (r.ood.unseen_chain) why.push('unseen chain');
                if (r.ood.unseen_category) why.push('unseen category');
                if (r.ood.tvl_out_of_range) why.push('TVL out of range');
                if (r.ood.age_out_of_range) why.push('age out of range');
                return el('tr', null,
                  el('td', { text: r.name }),
                  el('td', { text: why.join(', ') || '—' }),
                  el('td', { text: r.ood.tier || '—' }),
                  el('td', { class: 'num', text: String(r.ood.nearest_comp_distance_dex) }),
                  el('td', { class: 'num', text: 'x' + String(r.ood.band_multiplier) }),
                  el('td', { text: r.ood.confidence })
                );
              }))
            )
          ),
          el('p', { class: 'sub', text: 'Showing the first 25 of ' + oodRows.length + ' out-of-distribution rows; every row carries its own out-of-distribution report in the detail view.' })
        );
      })(),
      el('h3', { text: 'Missingness: undated comparables are a different population' }),
      el('p', { class: 'sub', text: v.missingness.mechanism + ' ' + v.missingness.handling + ' Errors: dated-only ' + v.missingness.dated_err + ' dex (' + v.missingness.n_dated + ' comps), undated-only ' + v.missingness.undated_err + ' dex (' + v.missingness.n_undated + ' comps), combined ' + v.missingness.combined_err + ' dex. The headline numbers on this page are dated-only; the undated error is a diagnostic, not hidden inside the headline.' }),
      el('h3', { text: 'Truncation audit: no fold peeks ahead' }),
      el('p', { class: 'sub', text: 'At build time, every time-based fold is checked twice: every training row is listed at least ' + v.purge_gap_days + ' days before its test window, and refitting on the snapshot truncated at the purge cutoff reproduces the fold fit exactly — beta and every group adjustment. Result: ' + (v.truncation_audit.passed ? 'PASS on all ' + v.truncation_audit.checks.length + ' folds.' : 'FAIL — see the checks below.') }),
      el('div', null, v.truncation_audit.checks.map(function (c) { return el('p', { class: 'sub', text: c }); })),
      el('h3', { text: 'Seasoning calibration: actual launch rate against predicted odds' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Age with no token' }), el('th', { scope: 'col', text: 'Protocols' }), el('th', { scope: 'col', text: 'Actually launched' }), el('th', { scope: 'col', text: 'Predicted odds' }))),
          el('tbody', null, DATA.seasoning_calibration.map(function (b) {
            return el('tr', null,
              el('td', { text: (b.age_max_days === null ? b.age_min_days + '+ days' : b.age_min_days + '-' + b.age_max_days + ' days') }),
              el('td', { class: 'num', text: String(b.n) }),
              el('td', { class: 'num', text: Math.round(b.actual_rate * 100) + '%' }),
              el('td', { class: 'num', text: Math.round(b.predicted_odds * 100) + '%' })
            );
          }))
        )
      ),
      el('h3', { text: 'EV audit: every positive-EV row, with its stress test and downside (charter v1.4)' }),
      el('p', { class: 'sub', text: 'Every statistic here — the mean EV, the P10/P25/P50/P75 of the net return, P(negative return) — comes from ONE seeded simulation array per protocol, so they cannot contradict each other. Radar-8’s audit could: its "P25 EV" (+$22,148 for Polymarket) was the expected value at the P25 VALUE conditional on launch, mislabeled as a quantile of the net return, while its P(negative) (59.2%) was unconditional — with 59% of outcomes negative, a true P25 cannot be positive. Under v1.3 the P25 of the net return is −$10,084 for Polymarket (the plan cost: 83.6% of draws are non-launches, a point mass at −cost) and P(negative) is 83.8% — consistent. Values are capped at the largest observed comparable market cap ($2.65B, the rain outlier), so the uncapped tail no longer inflates the mean: Polymarket\'s conditional mean value if it launches is $216M in radar-10\'s production simulation, against about $894M in radar-9\'s uncapped, x1.5-widened simulation. A farm verdict means the adopted gate passes under the CONSERVATIVE launch odds; rows that pass under the adopted odds but not the conservative ones are demoted by the stress test. The conditional value scenarios (EV at the P25/P75 value IF it launches) are labeled as conditional, never as quantiles. ' + v.ev_audit.assumptions }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'p_L base / Platt / p_BE' }), el('th', { scope: 'col', text: 'EV mean (base)' }), el('th', { scope: 'col', text: 'EV mean (Platt)' }), el('th', { scope: 'col', text: 'EV mean (conservative)' }), el('th', { scope: 'col', text: 'P25 net return' }), el('th', { scope: 'col', text: 'P(negative) sim / analytic' }), el('th', { scope: 'col', text: 'OOD' }), el('th', { scope: 'col', text: 'Verdict' }))),
          el('tbody', null, v.ev_audit.rows.map(function (r) {
            return el('tr', null,
              el('td', { text: r.name }),
              el('td', { class: 'num', text: Math.round(r.launch_odds * 100) + '% / ' + Math.round(r.launch_odds_platt * 100) + '% / ' + Math.round(r.break_even_odds * 100) + '%' }),
              el('td', { class: 'num', text: (r.ev_mean_base_rate_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.ev_mean_base_rate_usd)) }),
              el('td', { class: 'num', text: (r.ev_mean_platt_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.ev_mean_platt_usd)) }),
              el('td', { class: 'num', text: (r.ev_mean_conservative_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.ev_mean_conservative_usd)) }),
              el('td', { class: 'num', text: (r.ev_conservative_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.ev_conservative_usd)) }),
              el('td', { class: 'num', text: Math.round(r.prob_negative_return * 100) + '% / ' + Math.round(r.prob_negative_analytic * 100) + '%' }),
              el('td', { text: r.is_ood ? 'yes' : 'no' }),
              el('td', null, el('div', null, el('b', { text: r.verdict.toUpperCase() }), el('div', { class: 'sub', text: r.verdict_rule })))
            );
          }))
        )
      ),
      el('h3', { text: 'Gate test: seven prespecified policies, tested honestly under both odds layers (charter v1.7)' }),
      el('p', { class: 'sub', text: 'Seven prespecified gate policies were tested on the analytic (closed-form) statistics under BOTH odds layers — the adopted (base-rate) odds and the conservative (2.5th-percentile) odds — with the 20,000-draw simulation kept only as a cross-check, and with a rule fixed BEFORE the results were seen. A policy is eligible only if it fires (farms at least one row), filters (rejects at least one positive-mean-EV row through its additional condition), and keeps its worst farm\'s P(negative return) at or below 0.90, under BOTH layers; among the eligible policies, adopt the one with the lowest worst-farm P(negative return) under the conservative odds, ties broken (a), then (b), then (c), then (d), then (e), then (f), then (g); if none is eligible, keep the pre-existing rule (a) and report the resulting farm count as-is. The farm count is never a target. The P25 rule\'s math, corrected in v1.3: P25 > 0 needs P(net return > 0) ≥ 75%, and with launch odds at the 16.4% base rate that is impossible for any row — a positive P25 needs launch odds above 50%, nearly unreachable for a call option on a 16% base rate. Policy (d)\'s fixed 0.85 ceiling is the same kind of structural impossibility under the conservative odds: the floor on P(negative) there is 1 − 0.1364 = 0.8636 > 0.85, so (d) can never fire under the conservative layer — the v1.4 board\'s 0 farms was a design outcome, not a data outcome. Policy (f) corrects the ceiling to 1 − 0.75 × p_L (at least 75% of launches must clear breakeven), which scales with the odds layer. Policy (g), added in v1.7, is the per-protocol net-EV hurdle: the conditional mean net EV against the full costed plan (base cost + $50 slippage/fees) must exceed the layer\'s breakeven multiple of that plan, so a (g) farm has a positive expected net return by construction at the layer it passes. ' + v.gate_test.reason }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Variant' }), el('th', { scope: 'col', text: 'Rule' }), el('th', { scope: 'col', text: 'Farms (adopted odds)' }), el('th', { scope: 'col', text: 'Farms (conservative odds)' }), el('th', { scope: 'col', text: 'Farms, simulation cross-check (adopted / conservative)' }), el('th', { scope: 'col', text: 'Positive-EV rows' }), el('th', { scope: 'col', text: 'Rejected positive-EV rows' }), el('th', { scope: 'col', text: 'Max P(negative) among farms (adopted / conservative)' }), el('th', { scope: 'col', text: 'Fires / filters / within ceiling (both layers)' }), el('th', { scope: 'col', text: 'Eligible?' }), el('th', { scope: 'col', text: 'Adopted?' }))),
          el('tbody', null, [v.gate_test.variant_a, v.gate_test.variant_b, v.gate_test.variant_c, v.gate_test.variant_d, v.gate_test.variant_e, v.gate_test.variant_f, v.gate_test.variant_g].map(function (g) {
            return el('tr', null,
              el('td', { text: '(' + g.variant + ')' }),
              el('td', { text: g.rule }),
              el('td', { class: 'num', text: String(g.farm_count) }),
              el('td', { class: 'num', text: String(g.farm_count_conservative) }),
              el('td', { class: 'num', text: String(g.farm_count_sim) + ' / ' + String(g.farm_count_conservative_sim) }),
              el('td', { class: 'num', text: String(g.positive_ev_count) }),
              el('td', { class: 'num', text: String(g.rejected_positive_count) }),
              el('td', { class: 'num', text: (g.max_prob_negative === null ? '—' : Math.round(g.max_prob_negative * 100) + '%') + ' / ' + (g.max_prob_negative_conservative === null ? '—' : Math.round(g.max_prob_negative_conservative * 100) + '%') }),
              el('td', { text: (g.fires ? 'fires' : 'does not fire') + ' / ' + (g.filters ? 'filters' : 'does not filter') + ' / ' + (g.within_risk_ceiling ? 'within ceiling' : 'over ceiling') + ' — conservative: ' + (g.fires_conservative ? 'fires' : 'does not fire') + ' / ' + (g.filters_conservative ? 'filters' : 'does not filter') + ' / ' + (g.within_risk_ceiling_conservative ? 'within ceiling' : 'over ceiling') }),
              el('td', { text: g.eligible ? 'yes' : 'no' }),
              el('td', { text: v.gate_test.adopted === g.variant ? 'YES' : 'no' })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: 'What the test found: variant (a) — mean EV > 0 AND the P25 of the net return > 0 — farms ' + v.gate_test.variant_a.farm_count + ' rows under every one of the seven value distributions in the tournament below, because with launch odds at the base rate (16.4%) the 25th percentile of every row’s net return is −cost: 83.6% of the distribution is the non-launch point mass, so P25 > 0 needs launch odds above 50%. Variant (b) — conditional mean EV > 3x plan cost AND unconditional mean EV > 0 — farms ' + v.gate_test.variant_b.farm_count + ' of the ' + v.gate_test.variant_b.positive_ev_count + ' positive-EV rows under the adopted odds (' + v.gate_test.variant_b.farm_count_conservative + ' under the conservative odds) and filters nothing under the adopted odds: it fires on every row whose conditional value is large, including rows with up to an ' + (v.gate_test.variant_b.max_prob_negative === null ? '—' : Math.round(v.gate_test.variant_b.max_prob_negative * 100) + '%') + ' chance of loss — so it is not eligible under the two-layer rule. Variant (c) — mean EV > 0 AND P(negative) ≤ 0.90 — farms ' + v.gate_test.variant_c.farm_count + ' rows and also filters nothing under the adopted odds. Variant (d) — the Gemini candidate, conditional mean EV > 3x plan cost AND P(negative) ≤ 0.85, launch probability as a risk weighting — farms ' + v.gate_test.variant_d.farm_count + ' rows and filters ' + v.gate_test.variant_d.rejected_positive_count + ' of the ' + v.gate_test.variant_d.positive_ev_count + ' positive-EV rows, with a worst farm P(negative) of ' + (v.gate_test.variant_d.max_prob_negative === null ? '—' : Math.round(v.gate_test.variant_d.max_prob_negative * 100) + '%') + ' — but it farms ' + v.gate_test.variant_d.farm_count_conservative + ' rows under the conservative odds, so it does not fire there and is not eligible. Variant (e) — conditional mean EV > 5x plan cost AND mean EV > 0 AND P(negative) ≤ 0.90 — farms ' + v.gate_test.variant_e.farm_count + ' rows under the adopted odds and ' + v.gate_test.variant_e.farm_count_conservative + ' under the conservative odds, and IS eligible — but its worst farm under the conservative odds carries P(negative) ' + (v.gate_test.variant_e.max_prob_negative_conservative === null ? '—' : Math.round(v.gate_test.variant_e.max_prob_negative_conservative * 100) + '%') + ', higher than (f)’s. Variant (f) — the odds-consistent correction of (d) — farms ' + v.gate_test.variant_f.farm_count + ' rows under the adopted odds and ' + v.gate_test.variant_f.farm_count_conservative + ' under the conservative odds, filters ' + v.gate_test.variant_f.rejected_positive_count + ' of the ' + v.gate_test.variant_f.positive_ev_count + ' positive-EV rows, with a worst farm P(negative) of ' + (v.gate_test.variant_f.max_prob_negative_conservative === null ? '—' : Math.round(v.gate_test.variant_f.max_prob_negative_conservative * 100) + '%') + ' under the conservative odds — the lowest among the eligible policies, so it is adopted. The board farms ' + DATA.rows.filter(function (r) { return r.verdict === 'farm'; }).length + ' rows: the ' + v.gate_test.variant_f.farm_count_conservative + ' (f) farms under the conservative odds minus ' + (v.gate_test.variant_f.farm_count_conservative - DATA.rows.filter(function (r) { return r.verdict === 'farm'; }).length - DATA.rows.filter(function (r) { return r.farm_demoted_reason === 'borderline' && r.verdict_conservative === 'farm'; }).length) + ' rows blocked by major OOD and ' + DATA.rows.filter(function (r) { return r.farm_demoted_reason === 'borderline' && r.verdict_conservative === 'farm'; }).length + ' BORDERLINE rows the guard demotes to marginal (REVIEW). The (f) ceiling is a correction of an odds-inconsistent constant, not a loosening to hit a farm count. The simulation cross-check farms ' + v.gate_test.variant_f.farm_count_sim + ' rows under each layer; the ' + (v.gate_test.variant_f.farm_count - v.gate_test.variant_f.farm_count_sim) + '-row gap from the analytic ' + v.gate_test.variant_f.farm_count + ' is Monte Carlo noise in the cross-check, not in the board — the board follows the analytic counts. Variant (g) — the v1.7 net-EV hurdle against the costed plan — farms ' + v.gate_test.variant_g.farm_count + ' rows under the adopted odds and ' + v.gate_test.variant_g.farm_count_conservative + ' under the conservative odds, ties (f) exactly on the worst-farm conservative P(negative) (' + Math.round(v.gate_test.variant_g.max_prob_negative_conservative * 10000) / 100 + '% = ' + Math.round(v.gate_test.variant_f.max_prob_negative_conservative * 10000) / 100 + '%), so the tie breaks to the earlier letter and (f) stays adopted; its farm set is the (f) set minus ' + v.gate_test.variant_f.farm_slugs.filter(function (x) { return v.gate_test.variant_g.farm_slugs.indexOf(x) === -1; }).join(', ') + '.' }),
      el('h3', { text: 'Two functions: valuation radar and farming decision engine (charter v1.7)' }),
      el('p', { class: 'sub', text: 'The page serves two functions, and they are judged separately. (1) The valuation radar — the conditional value if a protocol launches, with its uncertainty band — ranks 198 pre-token protocols by fitted value, and the ranking is the same under every value distribution in the tournament below. (2) The farming decision engine — the gate that turns a valuation into a FARM verdict — is judged on whether it can fire AND filter under BOTH odds layers: it must pick farms without farming everything with a positive mean. Under charter v1.7 the engine does that under the odds-consistent gate (f): it fires on ' + v.gate_test.variant_f.farm_count + ' rows and rejects ' + v.gate_test.variant_f.rejected_positive_count + ' of the ' + v.gate_test.variant_f.positive_ev_count + ' positive-EV rows under the adopted odds, and the same ' + v.gate_test.variant_f.farm_count_conservative + ' rows survive the conservative-odds stress test — so the board farms ' + DATA.rows.filter(function (r) { return r.verdict === 'farm'; }).length + ' rows after the OOD block and the BORDERLINE guard (' + DATA.rows.filter(function (r) { return r.farm_demoted_reason === 'borderline' && r.verdict_conservative === 'farm'; }).length + ' rows demoted to marginal for REVIEW). The engine is never fixed by lowering a threshold to make it look active: a gate that farms all ' + v.gate_test.variant_f.positive_ev_count + ' positive-EV rows, some with an 89% chance of loss, is not a working gate.' }),
      el('h3', { text: 'Gate (f) audit: is the risk screen also profitable in expectation? (charter v1.7)' }),
      el('p', { class: 'sub', text: v.gate_f_audit.note + ' All ' + v.gate_f_audit.n_candidates + ' analytic-(f)-farm candidates under the adopted odds have a positive expected net return under the adopted odds (' + v.gate_f_audit.n_positive_expected_return_adopted + ') and under the conservative odds (' + v.gate_f_audit.n_positive_expected_return_conservative + '); ' + v.gate_f_audit.n_below_breakeven_multiple_adopted + ' sit below the adopted breakeven multiple of ' + v.gate_f_audit.breakeven_multiple_adopted.toFixed(2) + 'x and ' + v.gate_f_audit.n_below_breakeven_multiple_conservative + ' below the conservative ' + v.gate_f_audit.breakeven_multiple_conservative.toFixed(2) + 'x — so on this dataset the screen implies a positive expected net return for every candidate, though the label stays "risk-screening policy", not "profit gate", until the tail risk is proven adequate. The audit reports; it does not re-pick the gate.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Expected net return (adopted odds)' }), el('th', { scope: 'col', text: 'Expected net return (conservative odds)' }), el('th', { scope: 'col', text: 'Expected net return, param P10–P90' }), el('th', { scope: 'col', text: 'Conditional multiple' }), el('th', { scope: 'col', text: 'Breakeven multiple (adopted / conservative)' }), el('th', { scope: 'col', text: 'P(negative), analytic (adopted / conservative)' }), el('th', { scope: 'col', text: 'Production verdict' }))),
          el('tbody', null, v.gate_f_audit.rows.map(function (r) {
            return el('tr', null,
              el('td', { text: r.name }),
              el('td', { class: 'num', text: (r.expected_net_return_adopted_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.expected_net_return_adopted_usd)) }),
              el('td', { class: 'num', text: (r.expected_net_return_conservative_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.expected_net_return_conservative_usd)) }),
              el('td', { class: 'num', text: (r.expected_net_return_param_usd[0] >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.expected_net_return_param_usd[0])) + ' – ' + (r.expected_net_return_param_usd[1] >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.expected_net_return_param_usd[1])) }),
              el('td', { class: 'num', text: r.conditional_multiple.toFixed(1) + 'x' }),
              el('td', { class: 'num', text: r.breakeven_multiple_adopted.toFixed(2) + 'x / ' + r.breakeven_multiple_conservative.toFixed(2) + 'x' }),
              el('td', { class: 'num', text: Math.round(r.prob_negative_analytic_adopted * 100) + '% / ' + Math.round(r.prob_negative_analytic_conservative * 100) + '%' }),
              el('td', { text: r.verdict.toUpperCase() + (r.borderline ? ' (BORDERLINE)' : '') })
            );
          }))
        )
      ),
      el('h3', { text: 'What radar-14 adds (charter v1.7): costed plans, a second valuation lens, MARGINAL tiers, and a realized holdout' }),
      el('p', { class: 'sub', text: 'Ratio lens (a second valuation, reported as a cross-check only): fitting log10(market cap / TVL) on log10(TVL) with the same shrunk group adjustments scores ' + v.ratio_valuation.nested_selection_pooled_dex + ' dex on the nested selection-pooled metric against ' + v.ratio_valuation.nested_selection_pooled_dex_production_ols + ' dex for the OLS production fit (improvement ' + v.ratio_valuation.improvement_vs_production_dex + ' dex, adoption bar > ' + v.ratio_valuation.adoption_bar_dex + ' dex) — it does not clear the bar, so OLS stays the production valuation. Its board ranking agrees with production at Spearman ' + v.ratio_valuation.board_spearman_vs_production + ' with top-10 overlap ' + v.ratio_valuation.board_top10_overlap_vs_production + '/10. Data gaps, stated not filled: ' + v.ratio_valuation.data_gaps.join(' ') }),
      el('p', { class: 'sub', text: 'Costed farm plans: every plan now carries slippage/fees of $50 (the uniform 0.5% of the $10,000 deposit assumption), so the costed plan is the base cost + $50. Gate (g) — the per-protocol net-EV hurdle against that costed plan — farms ' + v.costed_farm_plans.gate_g_farm_count + ' rows under the adopted odds and ' + v.costed_farm_plans.gate_g_farm_count_conservative + ' under the conservative odds; the adopted gate (f) is insensitive to slippage by construction and farms ' + v.costed_farm_plans.sensitivity[1].farm_count_adopted + '/' + v.costed_farm_plans.sensitivity[1].farm_count_conservative + ' at every rate, while the (g) counts move 64/63/62 across 0%/0.5%/1.0% slippage. Net EV is the expected net return minus the $50 fee at each layer.' }),
      el('p', { class: 'sub', text: 'MARGINAL tiers (sizing guidance inside MARGINAL only — never a verdict change, never a promotion to FARM): ' + v.marginal_tiers.counts['low-size-farm'] + ' LOW-SIZE FARM (' + DATA.rows.filter(function (r) { return r.marginal_tier === 'low-size-farm'; }).map(function (r) { return r.name; }).join(', ') + ' — positive net EV at both layers, ≥ $0.50 expected net return per dollar at risk, quarter-Kelly ≥ 0.01, conservative P(negative) ≤ 0.90, not BORDERLINE), ' + v.marginal_tiers.counts.watchlist + ' WATCHLIST, ' + v.marginal_tiers.counts.hold + ' HOLD. The Kelly bar was corrected 0.02 → 0.01 by erratum before the final build: 0.02 can never fire on this board (the maximum quarter-Kelly is 0.012), and the three-row set is identical for every Kelly threshold in [0.005, 0.012].' }),
      el('p', { class: 'sub', text: 'Realized-outcome holdout (evaluated AFTER the model was frozen, on the untouched 90% fold — the newest 7 dated comps, n = ' + v.realized_holdout.n_rows + '): predicted vs realized log market cap, Spearman ' + v.realized_holdout.spearman + ' (95% CI ' + v.realized_holdout.spearman_ci95[0] + '–' + v.realized_holdout.spearman_ci95[1] + '), Kendall ' + v.realized_holdout.kendall + ', median absolute error ' + v.realized_holdout.median_abs_log_err_dex + ' dex; the top 3 by predicted rank were all actually profitable (' + v.realized_holdout.n_profitable_top3 + '/3). ' + v.realized_holdout.limitation }),
      el('p', { class: 'sub', text: 'Ranking calibration: pooled OOS Spearman ' + v.ranking_calibration.pooled_spearman + ' (95% bootstrap CI ' + v.ranking_calibration.pooled_spearman_ci95[0] + '–' + v.ranking_calibration.pooled_spearman_ci95[1] + '), Kendall ' + v.ranking_calibration.pooled_kendall + ' (CI ' + v.ranking_calibration.pooled_kendall_ci95[0] + '–' + v.ranking_calibration.pooled_kendall_ci95[1] + '), ' + v.ranking_calibration.n_bootstrap_resamples + ' cluster-bootstrap resamples; top-5/10/20 overlap ' + v.ranking_calibration.top5.overlap + '/' + v.ranking_calibration.top10.overlap + '/' + v.ranking_calibration.top20.overlap + '. Reliability: the seasoning curve beats the base rate on Brier (' + v.ranking_calibration.brier_seasoning_curve + ' vs ' + v.ranking_calibration.brier_base_rate + ') and log-loss (' + v.ranking_calibration.log_loss_seasoning_curve + ' vs ' + v.ranking_calibration.log_loss_base_rate + ') on the 645 dated protocols. Target: ' + v.target_comparability.target + ' FDV is NOT built — the snapshot carries no FDV field and no price history.' }),
      el('h3', { text: 'Distribution tournament: no decision rests on the uncapped lognormal mean (charter v1.4)' }),
      el('p', { class: 'sub', text: 'The same ' + v.distribution_tournament.results[0].n_rows + ' audit rows (every farm row plus every positive-EV row) re-priced under seven conditional-launch-value distributions, 5,000 draws each, paired where possible — the four lognormal variants share the same normal draws, and the launch uniforms are common to every distribution. The production distribution is the ' + v.distribution_tournament.production_distribution + '. The cap is the largest observed dated-comp market cap (' + fmtUsd(v.distribution_tournament.cap_usd) + '); the P90-cap row (' + fmtUsd(v.distribution_tournament.cap_p90_usd) + ') and the P95-cap row (' + fmtUsd(v.distribution_tournament.cap_p95_usd) + ') are sensitivity checks. Pooled CRPS on the nested selection folds: capped ' + v.distribution_tournament.crps.capped_dex + ' dex vs uncapped ' + v.distribution_tournament.crps.uncapped_dex + ' dex on ' + v.distribution_tournament.crps.n_test_rows + ' test rows — the cap is kept as a risk limit, not an accuracy claim: capped CRPS is slightly worse than uncapped, so the cap limits the downside of a fat right tail rather than improving the distribution. ' + v.distribution_tournament.note }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Distribution' }), el('th', { scope: 'col', text: 'Pooled conditional mean value' }), el('th', { scope: 'col', text: 'Pooled conditional median value' }), el('th', { scope: 'col', text: 'Pooled mean net EV' }), el('th', { scope: 'col', text: 'Pooled P(negative)' }), el('th', { scope: 'col', text: 'Farms (a) / (b) / (c) / (d) / (e) / (f)' }), el('th', { scope: 'col', text: 'Farm-set overlap vs production (b)' }))),
          el('tbody', null, v.distribution_tournament.results.map(function (r) {
            var ov = v.distribution_tournament.farm_set_overlap_b.filter(function (o) { return o.distribution === r.distribution; })[0];
            return el('tr', null,
              el('td', { text: r.distribution + (r.is_production ? ' (production)' : '') }),
              el('td', { class: 'num', text: fmtUsd(r.pooled_conditional_mean_value_usd) }),
              el('td', { class: 'num', text: fmtUsd(r.pooled_conditional_median_value_usd) }),
              el('td', { class: 'num', text: (r.pooled_mean_net_ev_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.pooled_mean_net_ev_usd)) }),
              el('td', { class: 'num', text: Math.round(r.pooled_prob_negative * 100) + '%' }),
              el('td', { class: 'num', text: r.farm_count_a + ' / ' + r.farm_count_b + ' / ' + r.farm_count_c + ' / ' + r.farm_count_d + ' / ' + r.farm_count_e + ' / ' + r.farm_count_f }),
              el('td', { class: 'num', text: ov ? String(ov.jaccard_vs_production_b) : '—' })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: 'What the tournament shows: the strict gate (a) farms 0 rows under EVERY distribution — even the Student-t, whose pooled conditional mean is ' + fmtUsd(v.distribution_tournament.results.filter(function (r) { return r.distribution === 'student-t'; })[0].pooled_conditional_mean_value_usd) + ' against ' + fmtUsd(v.distribution_tournament.results.filter(function (r) { return r.distribution === 'capped-lognormal'; })[0].pooled_conditional_mean_value_usd) + ' for the capped lognormal — so the 0-farm result is not an artifact of one tail choice. For Polymarket the paired lognormal mean is ' + fmtUsd(v.distribution_tournament.results.filter(function (r) { return r.distribution === 'lognormal'; })[0].rows.filter(function (x) { return x.slug === 'polymarket-international'; })[0].conditional_mean_value_usd) + ' against ' + fmtUsd(v.distribution_tournament.results.filter(function (r) { return r.distribution === 'capped-lognormal'; })[0].rows.filter(function (x) { return x.slug === 'polymarket-international'; })[0].conditional_mean_value_usd) + ' capped — the cap binds rarely at the validated x1.0 OOD multiplier. The bigger change from radar-9 is that multiplier: radar-9\'s unvalidated x1.5 widening inflated Polymarket\'s uncapped mean value to about $894M, against $216M in radar-10\'s production simulation. The bootstrap-residuals distribution has the highest pooled mean (' + fmtUsd(v.distribution_tournament.results.filter(function (r) { return r.distribution === 'bootstrap-residuals'; })[0].pooled_conditional_mean_value_usd) + ') because a few large positive out-of-fold residuals dominate its resampled values; the empirical distribution (' + fmtUsd(v.distribution_tournament.results.filter(function (r) { return r.distribution === 'empirical'; })[0].pooled_conditional_mean_value_usd) + ' pooled) resamples the 70 comp market caps directly, so one comp — rain, a $2.65B outlier — lifts its mean, and it ignores TVL entirely, so it cannot distinguish protocols.' }),
      el('h3', { text: 'Horizon launch probability: the 12-month event, with censoring (charter v1.4)' }),
      el('p', { class: 'sub', text: 'Event: launch within 12 months of listing — P(launch by listed_at + 12 months | X). The dated cohort holds ' + v.horizon_cohort.n_dated_protocols + ' protocols: launched (timing unknown) ' + v.horizon_cohort.status_counts.launched_timing_unknown + ', failed (market cap 0) ' + v.horizon_cohort.status_counts.failed + ', disappeared (sentinel −1) ' + v.horizon_cohort.status_counts.disappeared + ', tokenless-resolved ' + v.horizon_cohort.status_counts.tokenless_resolved + ', tokenless-censored ' + v.horizon_cohort.status_counts.tokenless_censored + '. The risk set (listed ≥ 12 months before as_of) is ' + v.horizon_cohort.n_risk_set + ' protocols with ' + v.horizon_cohort.n_launched + ' holding a token, a rate of ' + Math.round(v.horizon_cohort.risk_set_base_rate * 1000) / 10 + '% — an UPPER BOUND on the 12-month launch rate, not the rate itself, because the snapshot carries no token launch date: a protocol with a token may have launched inside or outside its window. ' + v.horizon_cohort.identification_note }),
      el('p', { class: 'sub', text: 'Survival candidate (category-stratified launch rates, shrunk toward the train base rate): ' + v.horizon_cohort.survival_candidate.reason + ' The flat base rate stands.' }),
      el('h3', { text: 'Heuristic activity multiplier: tested, not adopted (charter v1.4)' }),
      el('p', { class: 'sub', text: 'The Gemini proposal — multiply the base launch odds by 1.5x when a points program or testnet is active, 0.5x when dormant — was tested as a prespecified candidate. ' + v.seasoning_audit.heuristic_multiplier.proxy_definition + ' On the untouched 80/90 test set (n = ' + v.seasoning_audit.heuristic_multiplier.n_test + ') the multiplier scores Brier ' + v.seasoning_audit.heuristic_multiplier.test_brier_multiplier + ' and log-loss ' + v.seasoning_audit.heuristic_multiplier.test_log_loss_multiplier + ' against the flat base rate\'s ' + v.seasoning_audit.heuristic_multiplier.test_brier_base + ' and ' + v.seasoning_audit.heuristic_multiplier.test_log_loss_base + ' — it does not beat the base rate on either, so it is NOT adopted. ' + v.seasoning_audit.heuristic_multiplier.reason }),
      el('h3', { text: 'OOD band multiplier: validated on nested folds (charter v1.4)' }),
      el('p', { class: 'sub', text: 'On the nested selection folds, test rows that are out-of-distribution relative to their fold\'s training domain were scored under multipliers {x1.0, x1.5, x2.0} against the production 50% band; the adopted multiplier is the smallest whose OOD coverage reaches nominal − 0.10 (≥ 40%). ' + v.ood_multiplier_validation.reason }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Multiplier' }), el('th', { scope: 'col', text: 'OOD test rows' }), el('th', { scope: 'col', text: '50% band coverage' }), el('th', { scope: 'col', text: 'Adopted?' }))),
          el('tbody', null, v.ood_multiplier_validation.candidates.map(function (c) {
            return el('tr', null,
              el('td', { text: 'x' + String(c.multiplier) }),
              el('td', { class: 'num', text: String(c.n_ood_test_rows) }),
              el('td', { class: 'num', text: Math.round(c.coverage_50 * 100) + '%' }),
              el('td', { text: c.multiplier === v.ood_multiplier_validation.adopted_multiplier ? 'YES' : 'no' })
            );
          }))
        )
      ),
      el('h3', { text: 'Leave-one-protocol-out influence: the board hinges on one protocol (charter v1.4)' }),
      el('p', { class: 'sub', text: 'Refitting the selected estimator without each of the ' + v.lopo_influence.n_protocols + ' comparables (one row per protocol — no protocol contributes two observations) and measuring how much the board moves. ' + v.lopo_influence.note + ' Training TVL range $' + v.lopo_influence.tvl_range_usd[0].toLocaleString() + ' – $' + v.lopo_influence.tvl_range_usd[1].toLocaleString() + '; age range ' + v.lopo_influence.age_range_days[0] + ' – ' + v.lopo_influence.age_range_days[1] + ' days. ' + v.lopo_influence.n_board_rows_outside_tvl_range + ' board rows sit outside the TVL range and ' + v.lopo_influence.n_board_rows_outside_age_range + ' outside the age range.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Dropped comparable' }), el('th', { scope: 'col', text: '|Δ slope|' }), el('th', { scope: 'col', text: '|Δ intercept|' }), el('th', { scope: 'col', text: 'Max |Δ predicted log| over the board' }))),
          el('tbody', null, v.lopo_influence.most_influential.map(function (r) {
            return el('tr', null,
              el('td', { text: r.slug }),
              el('td', { class: 'num', text: String(r.abs_delta_slope) }),
              el('td', { class: 'num', text: String(r.abs_delta_intercept) }),
              el('td', { class: 'num', text: String(r.max_abs_delta_predicted_log) + ' dex' })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: 'Median absolute log error by category on the pooled nested test rows: ' + v.lopo_influence.error_by_category.map(function (g) { return g.group + ' ' + g.median_abs_log_err + ' dex (n=' + g.n + ')'; }).join('; ') + '. By chain: ' + v.lopo_influence.error_by_chain.map(function (g) { return g.group + ' ' + g.median_abs_log_err + ' dex (n=' + g.n + ')'; }).join('; ') + '. By TVL tercile: ' + v.lopo_influence.error_by_tvl_tercile.map(function (g) { return g.group + ' ' + g.median_abs_log_err + ' dex (n=' + g.n + ')'; }).join('; ') + '.' }),
      el('h3', { text: 'Outlier audit: rain and obol, traced to the source (charter v1.4)' }),
      el('p', { class: 'sub', text: 'The two extreme comparables, audited to the snapshot source — market cap from ' + v.outlier_audit.rows[0].mcap_source + ', TVL and market cap both from the ' + v.outlier_audit.rows[0].snapshot_date + ' snapshot. Target definition: ' + v.outlier_audit.rows[0].target_definition + '.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Listed' }), el('th', { scope: 'col', text: 'Chain / category' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Rank of ratio' }), el('th', { scope: 'col', text: 'Comparable by target and time' }), el('th', { scope: 'col', text: 'TVL consistent' }), el('th', { scope: 'col', text: 'Market cap, not FDV' }))),
          el('tbody', null, v.outlier_audit.rows.map(function (r) {
            return el('tr', null,
              el('td', { text: r.name }),
              el('td', { text: r.listed_at }),
              el('td', { text: r.main_chain + ' / ' + r.category }),
              el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
              el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
              el('td', { class: 'num', text: String(r.mcap_tvl_ratio) + 'x' }),
              el('td', { text: r.mcap_tvl_ratio_rank }),
              el('td', { text: r.comparable_by_target_and_time ? 'yes' : 'no' }),
              el('td', { text: r.tvl_consistent ? 'yes' : 'no' }),
              el('td', { text: r.is_market_cap_not_fdv ? 'yes' : 'no' })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: v.outlier_audit.rows[0].valid_observation_assessment }),
      el('p', { class: 'sub', text: v.outlier_audit.rows[1].valid_observation_assessment }),
      el('p', { class: 'sub', text: 'With and without — the refits, not deletion: ' + v.outlier_audit.note }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Dropped' }), el('th', { scope: 'col', text: 'Intercept' }), el('th', { scope: 'col', text: 'Slope' }), el('th', { scope: 'col', text: 'Nested selection error' }), el('th', { scope: 'col', text: 'Δ vs production' }), el('th', { scope: 'col', text: 'Board Spearman vs production' }), el('th', { scope: 'col', text: 'Top-10 / top-20 overlap' }), el('th', { scope: 'col', text: 'Farms under adopted gate' }))),
          el('tbody', null, v.outlier_audit.refits.map(function (r) {
            return el('tr', null,
              el('td', { text: r.dropped }),
              el('td', { class: 'num', text: String(r.intercept) }),
              el('td', { class: 'num', text: String(r.coef_log_tvl) }),
              el('td', { class: 'num', text: String(r.selection_pooled_dex) + ' dex' }),
              el('td', { class: 'num', text: (r.selection_vs_production_dex >= 0 ? '+' : '') + String(r.selection_vs_production_dex) + ' dex' }),
              el('td', { class: 'num', text: String(r.board_spearman_vs_production) }),
              el('td', { class: 'num', text: String(r.top10_overlap_vs_production) + ' / ' + String(r.top20_overlap_vs_production) }),
              el('td', { class: 'num', text: String(r.farm_count_adopted_gate) })
            );
          }))
        )
      ),
      el('h3', { text: 'Ranking stability: does the order hold when the model is refit? (charter v1.7)' }),
      el('p', { class: 'sub', text: 'Two questions, answered separately. (1) Do higher-valued protocols tend to be worth more out of sample? Nested walk-forward, predicted rank vs actual rank per fold: pooled Spearman ' + v.ranking_stability.nested_pooled_spearman + ' and pooled Kendall τ ' + v.ranking_stability.nested_pooled_kendall + ' — weak on both. The pooled top-10 overlap is ' + v.ranking_stability.nested_pooled_top10_overlap + ' of 10 (precision ' + v.ranking_stability.nested_pooled_top10_precision + ') and the pooled top-20 overlap ' + v.ranking_stability.nested_pooled_top20_overlap + ' of 20 (precision ' + v.ranking_stability.nested_pooled_top20_precision + '), on the 28 pooled selection rows. A higher fitted value only weakly predicts a higher realised value; the valuation is a ranking with a weak signal, not a price — do not claim the radar finds the best protocols until the out-of-sample rank correlation improves. (2) Is the board order stable when one comparable is dropped? Leave-one-protocol-out over all 70 comps: median Spearman ' + v.ranking_stability.lopo_median_spearman + ', worst top-10 overlap ' + v.ranking_stability.lopo_worst_top10_overlap + ' of 10. The ORDER is stable; the VERDICTS are not — ' + v.ranking_stability.lopo_total_verdict_moves + ' verdict moves across the 70 refits, because many rows sit near the adopted gate thresholds and a small refit flips them. ' + v.ranking_stability.note }),
      el('p', { class: 'sub', text: 'The negative fold, diagnosed not averaged away: ' + (v.ranking_stability.negative_fold_diagnosis ? v.ranking_stability.negative_fold_diagnosis.conclusion : 'no negative fold in this build.') }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Nested fold (train %)' }), el('th', { scope: 'col', text: 'Test rows' }), el('th', { scope: 'col', text: 'Spearman predicted vs actual' }), el('th', { scope: 'col', text: 'Kendall τ predicted vs actual' }), el('th', { scope: 'col', text: 'Top-3 overlap' }), el('th', { scope: 'col', text: 'Top-5 overlap' }))),
          el('tbody', null, v.ranking_stability.nested.map(function (r) {
            return el('tr', null,
              el('td', { text: String(r.train_pct) + '%' }),
              el('td', { class: 'num', text: String(r.n_test) }),
              el('td', { class: 'num', text: String(r.spearman_predicted_vs_actual) }),
              el('td', { class: 'num', text: String(r.kendall_predicted_vs_actual) }),
              el('td', { class: 'num', text: String(r.top3_overlap) + ' / 3' }),
              el('td', { class: 'num', text: String(r.top5_overlap) + ' / 5' })
            );
          }))
        )
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Worst LOPO drops' }), el('th', { scope: 'col', text: 'Spearman vs production' }), el('th', { scope: 'col', text: 'Top-10 / top-20 overlap' }), el('th', { scope: 'col', text: 'Verdict moves' }), el('th', { scope: 'col', text: 'Max |Δ predicted log|' }))),
          el('tbody', null, v.ranking_stability.lopo.slice().sort(function (a, b) { return a.spearman_vs_production - b.spearman_vs_production; }).slice(0, 5).map(function (r) {
            return el('tr', null,
              el('td', { text: r.slug }),
              el('td', { class: 'num', text: String(r.spearman_vs_production) }),
              el('td', { class: 'num', text: String(r.top10_overlap) + ' / ' + String(r.top20_overlap) }),
              el('td', { class: 'num', text: String(r.verdict_moves) }),
              el('td', { class: 'num', text: String(r.max_abs_delta_predicted_log) + ' dex' })
            );
          }))
        )
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'TVL shock (one row at a time)' }), el('th', { scope: 'col', text: 'Rows whose rank changes' }), el('th', { scope: 'col', text: 'Largest rank move' }))),
          el('tbody', null, v.ranking_stability.tvl_perturbation.map(function (r) {
            return el('tr', null,
              el('td', { text: r.shock }),
              el('td', { class: 'num', text: String(r.rows_with_rank_change) + ' of ' + DATA.board_size }),
              el('td', { class: 'num', text: String(r.max_abs_rank_move) + ' places' })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: 'A ±10% TVL shock moves nearly every row’s rank — the board is dense: a 0.017 dex shift passes a neighbour. That is a property of a 198-row ranking with close fitted values, not of the shock size. Descriptive bars (reported, not gates — no production decision changes on them): ' + v.ranking_stability.descriptive_bars.map(function (b) { return b.bar + ' — ' + (b.met ? 'met' : 'NOT met'); }).join('; ') + '. Analytic crosscheck (charter v1.7): ' + v.ranking_stability.analytic_verdict_crosscheck.note + ' ' + v.ranking_stability.analytic_verdict_crosscheck.n_near_boundary + ' rows are near-boundary (|analytic mean EV| ≤ $5,000).' }),
      el('h3', { text: 'Segmented OOD: coverage by segment, honestly labeled (charter v1.4)' }),
      el('p', { class: 'sub', text: 'Nested selection-fold test rows (' + v.ood_report_segmented.n_test_rows + ') against the ' + v.ood_report_segmented.multiplier_label + '. Nominal 50% coverage vs observed, per segment, with the Wilson 95% interval and the observation count. ' + v.ood_report_segmented.note }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Segment' }), el('th', { scope: 'col', text: 'n' }), el('th', { scope: 'col', text: 'Nominal 50%' }), el('th', { scope: 'col', text: 'Observed 50%' }), el('th', { scope: 'col', text: 'Wilson 95% CI' }), el('th', { scope: 'col', text: 'Median effective halfwidth' }), el('th', { scope: 'col', text: 'Median signed residual' }), el('th', { scope: 'col', text: 'Evidence' }))),
          el('tbody', null, v.ood_report_segmented.segments.map(function (r) {
            return el('tr', null,
              el('td', { text: r.segment }),
              el('td', { class: 'num', text: String(r.n) }),
              el('td', { class: 'num', text: Math.round(r.nominal_coverage_50 * 100) + '%' }),
              el('td', { class: 'num', text: Math.round(r.observed_coverage_50 * 100) + '%' }),
              el('td', { class: 'num', text: Math.round(r.coverage_50_ci[0] * 100) + '% – ' + Math.round(r.coverage_50_ci[1] * 100) + '%' }),
              el('td', { class: 'num', text: String(r.median_effective_halfwidth_dex) + ' dex' }),
              el('td', { class: 'num', text: (r.median_signed_residual_dex >= 0 ? '+' : '') + String(r.median_signed_residual_dex) + ' dex' }),
              el('td', { text: r.evidence })
            );
          }))
        )
      ),
      el('h3', { text: 'Cap sensitivity: the cap as a risk control, not an accuracy claim (charter v1.4)' }),
      el('p', { class: 'sub', text: v.cap_sensitivity.cap_choice_statement + ' CRPS: capped ' + v.cap_sensitivity.crps_capped_dex + ' dex vs uncapped ' + v.cap_sensitivity.crps_uncapped_dex + ' dex on ' + v.cap_sensitivity.crps_n_test_rows + ' test rows — the capped distribution is slightly worse, so no claim is made that it is more accurate; the cap bounds tail risk. ' + v.cap_sensitivity.note }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Cap' }), el('th', { scope: 'col', text: 'Cap value' }), el('th', { scope: 'col', text: 'Pooled conditional mean value' }), el('th', { scope: 'col', text: 'Pooled mean net EV' }), el('th', { scope: 'col', text: 'Farms (a) / (b) / (c) / (d) / (e) / (f)' }), el('th', { scope: 'col', text: 'Polymarket mean net EV' }))),
          el('tbody', null, v.cap_sensitivity.rows.map(function (r) {
            return el('tr', null,
              el('td', { text: r.cap_label }),
              el('td', { class: 'num', text: r.cap_usd === null ? '—' : fmtUsd(r.cap_usd) }),
              el('td', { class: 'num', text: fmtUsd(r.pooled_conditional_mean_value_usd) }),
              el('td', { class: 'num', text: (r.pooled_mean_net_ev_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.pooled_mean_net_ev_usd)) }),
              el('td', { class: 'num', text: r.farm_count_a + ' / ' + r.farm_count_b + ' / ' + r.farm_count_c + ' / ' + r.farm_count_d + ' / ' + r.farm_count_e + ' / ' + r.farm_count_f }),
              el('td', { class: 'num', text: (r.polymarket_mean_net_ev_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.polymarket_mean_net_ev_usd)) })
            );
          }))
        )
      ),
      el('h3', { text: 'Parameter uncertainty: the fit itself is uncertain (charter v1.5)' }),
      el('p', { class: 'sub', text: 'The simulation intervals on this page hold the fitted coefficients FIXED — they are outcome uncertainty only, not full uncertainty. The fit itself moves: ' + v.parameter_uncertainty.n_refits + ' cluster bootstrap refits (seed ' + v.parameter_uncertainty.seed + ', one protocol per resample, the full fitting process re-run on every refit) give intercept mean ' + v.parameter_uncertainty.intercept.mean + ' (SD ' + v.parameter_uncertainty.intercept.sd + ', 95% CI ' + v.parameter_uncertainty.intercept.p025 + ' – ' + v.parameter_uncertainty.intercept.p975 + ') and slope mean ' + v.parameter_uncertainty.slope.mean + ' (SD ' + v.parameter_uncertainty.slope.sd + ', 95% CI ' + v.parameter_uncertainty.slope.p025 + ' – ' + v.parameter_uncertainty.slope.p975 + '). Sign flips across the refits: intercept ' + v.parameter_uncertainty.intercept_sign_flips + ', slope ' + v.parameter_uncertainty.slope_sign_flips + ' — the slope flips sign in ' + v.parameter_uncertainty.slope_sign_flips + ' of ' + v.parameter_uncertainty.n_refits + ' refits, so the data cannot even settle the direction of the TVL effect in every resample. Neither coefficient distribution is bimodal (intercept ' + (v.parameter_uncertainty.intercept_bimodal ? 'bimodal' : 'not bimodal') + ', slope ' + (v.parameter_uncertainty.slope_bimodal ? 'bimodal' : 'not bimodal') + '). Median parameter SD across board rows ' + v.parameter_uncertainty.median_param_sd_dex + ' dex, maximum ' + v.parameter_uncertainty.max_param_sd_dex + ' dex. ' + v.parameter_uncertainty.note + ' Each row’s detail view carries its own parameter SD, its param-aware band (the interval that includes the parameter variation, next to the outcome-only band), and the P10/P90 of its mean EV and P(negative) across the refits. Launch probability, cap, distribution choice, comp estimation error, actual costs, dilution, token unlocks and liquidity are further uncertainties the simulation does not price.' }),
      el('h3', { text: 'Final evaluation table: one consistent table (charter v1.5)' }),
      el('p', { class: 'sub', text: 'Target: ' + v.final_evaluation.target + ' Target date ' + v.final_evaluation.target_date + '; unit ' + v.final_evaluation.unit + '; ' + v.final_evaluation.n_independent_protocols + ' independent protocols. The walk-forward error is ' + v.final_evaluation.wf_median_abs_log_err_dex + ' dex — a typical error of about ' + v.final_evaluation.wf_typical_error_x + 'x. ' + v.final_evaluation.r2_note }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Fold' }), el('th', { scope: 'col', text: 'Test rows' }), el('th', { scope: 'col', text: 'Median |error| (dex)' }), el('th', { scope: 'col', text: 'Signed bias (dex)' }), el('th', { scope: 'col', text: 'Spearman' }), el('th', { scope: 'col', text: 'Kendall τ' }))),
          el('tbody', null, v.final_evaluation.folds.concat([{ label: 'Pooled (selection folds)', n_test: v.final_evaluation.pooled.n_test, median_abs_log_err: v.final_evaluation.pooled.median_abs_log_err, signed_bias_log: v.final_evaluation.pooled.signed_bias_log, spearman: v.final_evaluation.pooled.spearman, kendall: v.final_evaluation.pooled.kendall }]).map(function (r) {
            return el('tr', null,
              el('td', { text: r.label }),
              el('td', { class: 'num', text: String(r.n_test) }),
              el('td', { class: 'num', text: String(r.median_abs_log_err) }),
              el('td', { class: 'num', text: (r.signed_bias_log >= 0 ? '+' : '') + String(r.signed_bias_log) }),
              el('td', { class: 'num', text: String(r.spearman) }),
              el('td', { class: 'num', text: String(r.kendall) })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: 'Baselines (pooled nested median |error|): ' + v.final_evaluation.baselines.map(function (b) { return b.name + ' ' + b.pooled_median_abs_log_err + ' dex'; }).join('; ') + '. Interval coverage (nominal vs observed): ' + v.final_evaluation.coverage.map(function (c) { return Math.round(c.nominal * 100) + '% → ' + Math.round(c.observed * 100) + '%'; }).join('; ') + '.' }),
      el('h3', { text: 'Ranking tournament: does any simple model rank better than OLS? (charter v1.7)' }),
      el('p', { class: 'sub', text: v.ranking_tournament.reason + ' Adoption rule, fixed before the results were seen: ' + v.ranking_tournament.adoption_rule }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Model' }), el('th', { scope: 'col', text: 'Pooled Spearman' }), el('th', { scope: 'col', text: 'Pooled Kendall τ' }), el('th', { scope: 'col', text: 'Top-10 overlap' }), el('th', { scope: 'col', text: 'Top-20 overlap' }), el('th', { scope: 'col', text: 'Pooled median |error| (dex)' }), el('th', { scope: 'col', text: 'Per-fold Spearman (50/60/70/80)' }))),
          el('tbody', null, v.ranking_tournament.rows.map(function (r) {
            return el('tr', null,
              el('td', { text: r.model + (r.model === v.ranking_tournament.adopted ? ' (adopted)' : '') }),
              el('td', { class: 'num', text: String(r.pooled_spearman) }),
              el('td', { class: 'num', text: String(r.pooled_kendall) }),
              el('td', { class: 'num', text: String(r.pooled_top10_overlap) + ' / 10' }),
              el('td', { class: 'num', text: String(r.pooled_top20_overlap) + ' / 20' }),
              el('td', { class: 'num', text: String(r.pooled_median_abs_log_err) }),
              el('td', { class: 'num', text: r.per_fold.map(function (f) { return String(f.spearman); }).join(' / ') })
            );
          }))
        )
      ),
      el('h3', { text: 'Fold 80 / cross-time generalization: where the ranking breaks (charter v1.7)' }),
      el('p', { class: 'sub', text: v.cohort_ranking.conclusion }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Slice' }), el('th', { scope: 'col', text: 'n' }), el('th', { scope: 'col', text: 'Spearman' }), el('th', { scope: 'col', text: 'Kendall τ' }), el('th', { scope: 'col', text: 'Median |error| (dex)' }), el('th', { scope: 'col', text: 'Evidence' }))),
          el('tbody', null, v.cohort_ranking.by_listing_tercile.concat(v.cohort_ranking.by_listing_year_cohort).map(function (r) {
            return el('tr', null,
              el('td', { text: r.group }),
              el('td', { class: 'num', text: String(r.n) }),
              el('td', { class: 'num', text: r.spearman === null ? '—' : String(r.spearman) }),
              el('td', { class: 'num', text: r.kendall === null ? '—' : String(r.kendall) }),
              el('td', { class: 'num', text: r.median_abs_log_err === null ? '—' : String(r.median_abs_log_err) }),
              el('td', { text: r.evidence })
            );
          }))
        )
      ),
      el('h3', { text: 'Param-aware farming simulation: coefficient, launch-odds and distribution uncertainty in every draw (charter v1.5)' }),
      el('p', { class: 'sub', text: v.param_aware_simulation.note + ' ' + v.param_aware_simulation.n_draws + ' draws per row per distribution over ' + v.param_aware_simulation.n_rows + ' audit rows.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Mean EV, capped lognormal' }), el('th', { scope: 'col', text: 'Mean EV, uncapped lognormal' }), el('th', { scope: 'col', text: 'Mean EV, Student-t' }), el('th', { scope: 'col', text: 'P(negative), capped' }), el('th', { scope: 'col', text: 'Gate (d) pass fraction, adopted odds' }), el('th', { scope: 'col', text: 'Gate (d) pass fraction, conservative odds' }))),
          el('tbody', null, v.param_aware_simulation.rows.slice(0, 12).map(function (r) {
            var byDist = {};
            r.distributions.forEach(function (d) { byDist[d.distribution] = d; });
            return el('tr', null,
              el('td', { text: r.slug }),
              el('td', { class: 'num', text: (byDist['capped-lognormal'].mean_ev_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(byDist['capped-lognormal'].mean_ev_usd)) }),
              el('td', { class: 'num', text: (byDist['lognormal'].mean_ev_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(byDist['lognormal'].mean_ev_usd)) }),
              el('td', { class: 'num', text: (byDist['student-t'].mean_ev_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(byDist['student-t'].mean_ev_usd)) }),
              el('td', { class: 'num', text: Math.round(byDist['capped-lognormal'].prob_negative * 100) + '%' }),
              el('td', { class: 'num', text: Math.round(r.pass_fraction_d_adopted * 100) + '%' }),
              el('td', { class: 'num', text: Math.round(r.pass_fraction_d_conservative * 100) + '%' })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: 'The table shows the 12 highest-ranked audit rows; the full ' + v.param_aware_simulation.n_rows + ' rows ship in data.js. The four gate-(d) candidates pass (d) in only 44–66% of the paired (refit, launch-odds) draws under the adopted odds — and in 0% under the conservative odds, as the structural analysis predicts. The Student-t mean EVs are far higher than the capped lognormal’s because its heavy tail inflates the conditional mean; the P(negative) barely moves, because it is set by the launch odds, not the tail.' }),
      el('h3', { text: 'Gate (d) economic audit: why 3x and 85% (charter v1.5)' }),
      el('p', { class: 'sub', text: v.gate_threshold_grid.note }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Threshold multiple' }), el('th', { scope: 'col', text: 'P(negative) ceiling' }), el('th', { scope: 'col', text: 'Farms (adopted odds)' }), el('th', { scope: 'col', text: 'Farms (conservative odds)' }))),
          el('tbody', null, v.gate_threshold_grid.rows.map(function (r) {
            return el('tr', null,
              el('td', { text: String(r.multiple) + 'x' }),
              el('td', { class: 'num', text: Math.round(r.ceiling * 100) + '%' }),
              el('td', { class: 'num', text: String(r.farm_count_adopted) }),
              el('td', { class: 'num', text: String(r.farm_count_conservative) })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: 'Breakeven multiples: ' + v.gate_threshold_grid.breakeven_multiple_adopted + 'x at the adopted odds, ' + v.gate_threshold_grid.breakeven_multiple_conservative + 'x under the conservative odds — the 3x multiple is a conditional-payoff screen, not a profitability proof. The 85% ceiling demands ' + Math.round(v.gate_threshold_grid.required_launch_success_d_adopted * 1000) / 10 + '% of launches clear breakeven at the adopted odds and ' + Math.round(v.gate_threshold_grid.required_launch_success_d_conservative * 1000) / 10 + '% under the conservative odds — impossible under the conservative odds, so gate (d) can never fire there.' }),
      el('h3', { text: 'Verdict stability: how often the verdict survives a refit (charter v1.7)' }),
      el('p', { class: 'sub', text: 'Over ' + v.verdict_stability.n_refits + ' leave-one-protocol-out refits, ' + v.verdict_stability.unique_rows_ever_flipped + ' of ' + DATA.board_size + ' rows flip their verdict at least once; the median row flips in ' + v.verdict_stability.moves_per_row_median + ' refits and the worst in ' + v.verdict_stability.moves_per_row_max + '. ' + Math.round(v.verdict_stability.pct_pairs_on_main_verdict * 1000) / 10 + '% of (row, refit) pairs stay on the production verdict. The most frequent moves are ' + v.verdict_stability.most_frequent_moves.map(function (m) { return m.from + ' → ' + m.to + ' (' + m.count + ')'; }).join(', ') + '. Ranks are shown as ranges on the board wherever the data does not support one precise rank — the LOPO order is stable (median Spearman ' + v.ranking_stability.lopo_median_spearman + '), but individual ranks move, and the verdicts move more than the ranks. A farm is STABLE only when at least ' + v.verdict_stability.stability_threshold + ' of ' + v.verdict_stability.n_refits + ' refits agree with FARM — the threshold was fixed before the results were seen and is never moved to preserve a farm count; ' + v.verdict_stability.n_stability_demoted + ' farm' + (v.verdict_stability.n_stability_demoted === 1 ? ' was' : 's were') + ' demoted to marginal as UNSTABLE on this board. The board and the detail view show each row\'s FARM / MARGINAL / SKIP refit proportions.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Production verdict' }), el('th', { scope: 'col', text: 'Refits agreeing' }), el('th', { scope: 'col', text: 'Most frequent alternative' }), el('th', { scope: 'col', text: 'Rank range (min–median–max)' }))),
          el('tbody', null, v.verdict_stability.rows.slice().sort(function (a, b) { return a.n_agreeing_refits - b.n_agreeing_refits; }).slice(0, 10).map(function (r) {
            return el('tr', null,
              el('td', { text: r.slug }),
              el('td', { text: r.main_verdict }),
              el('td', { class: 'num', text: String(r.n_agreeing_refits) + ' / ' + v.verdict_stability.n_refits }),
              el('td', { text: r.most_frequent_alternative === null ? '—' : r.most_frequent_alternative }),
              el('td', { class: 'num', text: String(r.rank_range[0]) + '–' + String(r.rank_range[1]) + '–' + String(r.rank_range[2]) })
            );
          }))
        )
      ),
      el('h3', { text: 'Reproducibility: rebuild this board (charter v1.7)' }),
      el('p', { class: 'sub', text: 'Dataset: ' + DATA.reproducibility.dataset + '. Snapshot SHA-256: ' + DATA.reproducibility.snapshot_sha256 + '. Charter ' + DATA.reproducibility.charter_version + ', model ' + DATA.reproducibility.model_version + '. Locked constants: ' + Object.keys(DATA.reproducibility.constants).map(function (k) { return k + ' = ' + DATA.reproducibility.constants[k]; }).join(', ') + '. Seeds: ' + Object.keys(DATA.reproducibility.seeds).map(function (k) { return k + ' = ' + DATA.reproducibility.seeds[k]; }).join(', ') + '. Rebuild: ' + DATA.reproducibility.reproduce_commands.join(' ; ') + '.' }),
      el('h3', { text: 'Winsorization test: capping rain at the 95th percentile, tested not adopted (charter v1.4)' }),
      el('p', { class: 'sub', text: 'The Gemini candidate: cap the dated comparables’ market caps at the 95th percentile (' + fmtUsd(v.winsorization_test.cap_p95_usd) + ') before ANY fitting, rain included. Winsorized fit: intercept ' + v.winsorization_test.winsorized_intercept + ', slope ' + v.winsorization_test.winsorized_coef_log_tvl + ' (production ' + FIT.intercept + ' / ' + FIT.coef_log_tvl + '). Nested selection-pooled error winsorized ' + v.winsorization_test.winsorized_selection_pooled_dex + ' dex vs production ' + v.winsorization_test.production_selection_pooled_dex + ' dex — improvement ' + v.winsorization_test.selection_improvement_dex + ' dex. Winsorized LOPO worst |Δ predicted log| ' + v.winsorization_test.winsorized_lopo_max_abs_delta_predicted_log + ' dex vs production ' + v.winsorization_test.production_lopo_max_abs_delta_predicted_log + ' dex; winsorized board vs production: Spearman ' + v.winsorization_test.board_spearman_vs_production + ', top-10 overlap ' + v.winsorization_test.top10_overlap_vs_production + '/10, top-20 ' + v.winsorization_test.top20_overlap_vs_production + '/20; winsorized farms under the adopted gate ' + v.winsorization_test.farm_count_adopted_gate + '. ' + v.winsorization_test.reason }),
      el('h3', { text: 'Conformal slices: coverage by regime, TVL, age, OOD (charter v1.4)' }),
      el('p', { class: 'sub', text: v.conformal_slices.note }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Slice' }), el('th', { scope: 'col', text: 'Group' }), el('th', { scope: 'col', text: 'n' }), el('th', { scope: 'col', text: 'Coverage 50%' }), el('th', { scope: 'col', text: 'Coverage 80%' }), el('th', { scope: 'col', text: 'Coverage 90%' }), el('th', { scope: 'col', text: '50% coverage, Wilson 95% CI' }))),
          el('tbody', null, v.conformal_slices.by_regime.concat(v.conformal_slices.by_tvl_band, v.conformal_slices.by_age_band, v.conformal_slices.by_ood).map(function (r) {
            return el('tr', null,
              el('td', { text: r.slice }),
              el('td', { text: r.group }),
              el('td', { class: 'num', text: String(r.n) }),
              el('td', { class: 'num', text: Math.round(r.coverage_50 * 100) + '%' }),
              el('td', { class: 'num', text: Math.round(r.coverage_80 * 100) + '%' }),
              el('td', { class: 'num', text: Math.round(r.coverage_90 * 100) + '%' }),
              el('td', { class: 'num', text: Math.round(r.coverage_50_ci[0] * 100) + '% – ' + Math.round(r.coverage_50_ci[1] * 100) + '%' })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: 'Calibration sample: n = ' + v.conformal_slices.calibration_n + ' out-of-fold residuals; the 90% band is the ' + v.conformal_slices.quantile_index_90 + 'th of ' + v.conformal_slices.calibration_n + ' order statistics, so its coverage has a binomial standard error of about ' + v.conformal_slices.coverage_90_standard_error + ' — a shortfall of a few points is sampling noise. Undated comparables stay unsupported: they have no listing date, so no band is calibrated for them.' }),
      el('h3', { text: 'Undated comparables: unsupported estimates (never fitted)' }),
      el('p', { class: 'sub', text: 'These ' + v.n_undated_comps + ' protocols have a token trading but no recorded listing date, so charter v1.4 hard-gates them out of every fit and calibration. Each row below is an UNSUPPORTED ESTIMATE: scored by the dated-only full fit for reference only, with NO calibrated confidence band — the band columns are omitted deliberately, and no row here carries a verdict or a confidence label. Error and coverage are reported separately, never mixed into the headline: dated-only error ' + v.missingness.dated_err + ' dex (' + v.missingness.n_dated + ' comps), undated-only error ' + v.missingness.undated_err + ' dex (' + v.missingness.n_undated + ' comps), combined ' + v.missingness.combined_err + ' dex; the 50% band holds ' + Math.round(v.conformal_undated.coverage_50 * 100) + '% of the undated comps against ' + Math.round(v.range_holds * 100) + '% of the dated ones. ' + v.conformal_undated.analysis }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Predicted log value' }), el('th', { scope: 'col', text: 'Residual (dex)' }))),
          el('tbody', null, v.undated_reference.map(function (r) {
            return el('tr', null,
              el('td', { text: r.name }),
              el('td', { text: r.category || 'Other' }),
              el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
              el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
              el('td', { class: 'num', text: String(r.predicted_log_value) }),
              el('td', { class: 'num', text: (r.residual_dex >= 0 ? '+' : '') + String(r.residual_dex) })
            );
          }))
        )
      ),
      el('h3', { text: 'Valuation → decision: every number behind every verdict (charter v1.7)' }),
      el('p', { class: 'sub', text: 'All ' + v.valuation_decision_table.length + ' board rows in board order: the valuation estimate with its param-aware interval, the launch-odds source, the conditional payoff, and both layer verdicts. This is the final table — the valuation and the decision side by side, so any verdict can be checked against its inputs without opening the detail view.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Rank' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Implied value' }), el('th', { scope: 'col', text: 'Interval P25–P75 (param-aware)' }), el('th', { scope: 'col', text: 'Launch odds (source)' }), el('th', { scope: 'col', text: 'Conditional payoff' }), el('th', { scope: 'col', text: 'Expected net return (adopted / conservative)' }), el('th', { scope: 'col', text: 'Verdict (adopted / conservative / production)' }))),
          el('tbody', null, v.valuation_decision_table.map(function (r) {
            return el('tr', null,
              el('td', { class: 'num', text: String(r.rank) }),
              el('td', { text: r.name }),
              el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
              el('td', { class: 'num', text: fmtUsd(r.interval_p25_usd) + ' – ' + fmtUsd(r.interval_p75_usd) }),
              el('td', { class: 'num', text: fmtOdds(r.launch_odds) + ' (' + r.launch_odds_source + ')' }),
              el('td', { class: 'num', text: (r.conditional_payoff_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.conditional_payoff_usd)) }),
              el('td', { class: 'num', text: (r.expected_net_return_adopted_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.expected_net_return_adopted_usd)) + ' / ' + (r.expected_net_return_conservative_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.expected_net_return_conservative_usd)) }),
              el('td', { text: r.verdict_adopted.toUpperCase() + ' / ' + r.verdict_conservative.toUpperCase() + ' / ' + r.verdict.toUpperCase() + (r.borderline ? ' — BORDERLINE' : '') + (r.conditional_farm ? ' — CONDITIONAL' : '') })
            );
          }))
        )
      ),
      el('h3', { text: 'Target: what the model actually predicts' }),
      el('p', { class: 'sub', text: v.target.definition + ' ' + v.target.fdv_note + ' ' + v.target.comparability_note }),
      el('p', { class: 'sub', text: 'Two limits, stated plainly. The target is the market cap on the snapshot date, not a day-3-to-7 median FDV: the snapshot carries no price history, so that definition cannot be verified or built from this data. And the training set is survivors: 15 protocols in the snapshot hold a token with a zero market cap and 14 more are listed on CoinGecko with no cap at all, the visible dead; tokens removed from the index entirely are invisible, so the fitted values are biased upward for the average protocol.' }),
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var consOdds = DATA.validation.launch_odds_decision.conservative_lower_bound;
    var anAdopt = analyticEvStats(row, row.predicted_log_value, row.plan_cost_usd, row.launch_odds);
    var anCons = analyticEvStats(row, row.predicted_log_value, row.plan_cost_usd, consOdds);
    var audit = DATA.validation.gate_f_audit.rows.filter(function (x) { return x.slug === row.slug; })[0];
    var canonical = impliedOf(row, 1);
    var comps = DATA.live.filter(function (l) { return (l.category || 'Other') === (row.category || 'Other'); }).slice(0, 3);
    var compNote = comps.length > 0
      ? 'Live comparables in ' + (row.category || 'Other') + ': ' + comps.map(function (l) { return l.name + ' at ' + fmtMult(l.multiple); }).join(', ') + '.'
      : 'No live protocol in ' + (row.category || 'Other') + ' is in the top 24 by market cap; this row is priced on the fitted regression' + (row.category_adjustment ? ' with a category adjustment of ' + row.category_adjustment.toFixed(2) + ' dex' : ' with no category adjustment') + (row.chain_adjustment ? ' and a main-chain adjustment of ' + row.chain_adjustment.toFixed(2) + ' dex' : ' and no main-chain adjustment') + '.';
    var age = row.age_days === null ? MODEL.unknown_age_days : row.age_days;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' - watchlist' : ' - early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — fitted' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL + $25M floor (log10)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) + ' (' + Math.log10(row.tvl_usd + FIT.size_floor_usd).toFixed(2) + ')' })),
        el('div', null, el('span', { text: 'Seven-day change (display only — not a model input)' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token -> launch odds (base rate — age does not change the board odds under v1.7)' }), el('b', { class: 'num', text: (row.age_days === null ? 'undated' : fmtAge(row.age_days)) + ' -> ' + fmtOdds(row.launch_odds) })),
        el('div', null, el('span', { text: 'Category adjustment' }), el('b', { class: 'num', text: (row.category_adjustment >= 0 ? '+' : '') + row.category_adjustment.toFixed(2) + ' dex' })),
        el('div', null, el('span', { text: 'Main-chain adjustment' }), el('b', { class: 'num', text: (row.chain_adjustment >= 0 ? '+' : '') + row.chain_adjustment.toFixed(2) + ' dex' })),
        el('div', null, el('span', { text: 'Predicted log10 value if it launches' }), el('b', { class: 'num', text: String(row.predicted_log_value.toFixed(3)) })),
        el('div', null, el('span', { text: 'Value if it launches (10^predicted)' }), el('b', { class: 'num', text: fmtUsd(row.value_if_launches_usd) })),
        el('div', null, el('span', { text: 'Launch odds (base rate, charter v1.7)' }), el('b', { class: 'num', text: fmtOdds(row.launch_odds) })),
        el('div', null, el('span', { text: 'Launch odds, Platt-calibrated curve (diagnostic — not used)' }), el('b', { class: 'num', text: fmtOdds(row.launch_odds_platt) })),
        el('div', null, el('span', { text: 'Implied value (value if it launches x launch odds)' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Mean expected net return, analytic (the decision number; simulation mean in brackets as the cross-check)' }), el('b', { class: 'num', text: (anAdopt.mean >= 0 ? '+' : '−') + fmtUsd(Math.abs(anAdopt.mean)) + ' [' + (row.expected_value_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.expected_value_usd)) + ']' })),
        el('div', null, el('span', { text: 'Mean EV under the conservative odds, analytic / under the Platt odds, simulation (stress test)' }), el('b', { class: 'num', text: (anCons.mean >= 0 ? '+' : '−') + fmtUsd(Math.abs(anCons.mean)) + ' / ' + (row.ev_mean_platt_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.ev_mean_platt_usd)) })),
        el('div', null, el('span', { text: 'P25 / P75 of the net-return distribution (analytic)' }), el('b', { class: 'num', text: (anAdopt.p25 >= 0 ? '+' : '−') + fmtUsd(Math.abs(anAdopt.p25)) + ' / ' + (anAdopt.p75 >= 0 ? '+' : '−') + fmtUsd(Math.abs(anAdopt.p75)) })),
        el('div', null, el('span', { text: 'Probability of a negative return, analytic (adopted / conservative) — simulation with its 95% Wilson interval' }), el('b', { class: 'num', text: Math.round(anAdopt.probNegative * 100) + '% / ' + Math.round(anCons.probNegative * 100) + '% — sim ' + Math.round(row.prob_negative_return * 100) + '% [' + (Math.round(row.prob_negative_sim_ci_adopted[0] * 1000) / 10) + '%–' + (Math.round(row.prob_negative_sim_ci_adopted[1] * 1000) / 10) + '%]' })),
        el('div', null, el('span', { text: 'Gate passes under the adopted odds / under the conservative odds (analytic)' }), el('b', { class: 'num', text: (row.gate_pass_adopted ? 'yes' : 'no') + ' / ' + (row.gate_pass_conservative ? 'yes' : 'no') })),
        el('div', null, el('span', { text: 'Verdict under the adopted odds / under the conservative odds' }), el('b', { class: 'num', text: row.verdict_adopted.toUpperCase() + ' / ' + row.verdict_conservative.toUpperCase() + (row.conditional_farm ? ' — CONDITIONAL FARM' : '') })),
        el('div', null, el('span', { text: 'BORDERLINE — REVIEW (never farm, never skip)' }), el('b', { class: 'num', text: row.borderline ? row.borderline_reason : 'no' })),
        el('div', null, el('span', { text: 'Gate (f) audit: expected net return adopted / conservative; conditional multiple vs breakeven' }), el('b', { class: 'num', text: audit ? ((audit.expected_net_return_adopted_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(audit.expected_net_return_adopted_usd)) + ' / ' + (audit.expected_net_return_conservative_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(audit.expected_net_return_conservative_usd)) + '; ' + audit.conditional_multiple.toFixed(1) + 'x vs ' + audit.breakeven_multiple_adopted.toFixed(2) + 'x / ' + audit.breakeven_multiple_conservative.toFixed(2) + 'x') : 'not a gate (f) candidate' })),
        el('div', null, el('span', { text: 'Costed farm plan (charter v1.7): deposit + gas + opportunity + slippage/fees' }), el('b', { class: 'num', text: fmtUsd(row.costed_plan.deposit_usd) + ' + ' + fmtUsd(row.costed_plan.gas_total_usd) + ' + ' + fmtUsd(row.costed_plan.opportunity_usd) + ' + ' + fmtUsd(row.costed_plan.slippage_fees_usd) + ' = ' + fmtUsd(row.costed_plan.total_usd) })),
        el('div', null, el('span', { text: 'Net expected return, adopted / conservative odds (base EV minus the $50 fee)' }), el('b', { class: 'num', text: (row.net_ev_adopted_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.net_ev_adopted_usd)) + ' / ' + (row.net_ev_conservative_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.net_ev_conservative_usd)) + '; conditional net multiple ' + row.conditional_net_multiple.toFixed(2) + 'x' })),
        el('div', null, el('span', { text: 'MARGINAL tier (charter v1.7 — sizing guidance only, never a verdict change)' }), el('b', { class: 'num', text: row.marginal_tier === null ? '— (not MARGINAL)' : row.marginal_tier.toUpperCase() + ' — EV-per-dollar-at-risk ' + row.ev_per_dollar_at_risk + ', quarter-Kelly ' + row.kelly_fraction })),
        el('div', null, el('span', { text: 'Out-of-distribution (band x' + row.ood.band_multiplier + ', confidence: ' + row.ood.confidence + ')' }), el('b', { class: 'num', text: row.ood.is_ood ? 'yes — ' + [row.ood.unseen_chain ? 'unseen chain' : null, row.ood.unseen_category ? 'unseen category' : null, row.ood.tvl_out_of_range ? 'TVL out of range' : null, row.ood.age_out_of_range ? 'age out of range' : null].filter(function (x) { return x; }).join(', ') : 'no' })),
        el('div', null, el('span', { text: 'P10 value / EV at P10' }), el('b', { class: 'num', text: fmtUsd(row.p10_value_usd) + ' / ' + (row.ev_at_p10_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.ev_at_p10_usd)) })),
        el('div', null, el('span', { text: 'Value band P25–P75 (±' + DATA.validation.band_halfwidth_dex + ' dex' + (row.ood.is_ood ? ', x' + row.ood.band_multiplier + ' OOD' : '') + ')' }), el('b', { class: 'num', text: fmtUsd(row.band_p25_usd) + ' – ' + fmtUsd(row.band_p75_usd) })),
        el('div', null, el('span', { text: 'Param-aware value band P25–P75 (total SD ' + row.param_total_sd_dex + ' dex — outcome + parameter variation)' }), el('b', { class: 'num', text: fmtUsd(row.param_band_p25_usd) + ' – ' + fmtUsd(row.param_band_p75_usd) })),
        el('div', null, el('span', { text: 'Parameter SD of the predicted log value (' + DATA.validation.parameter_uncertainty.n_refits + ' cluster bootstrap refits — model uncertainty, separate from the band)' }), el('b', { class: 'num', text: String(row.predicted_log_param_sd_dex) + ' dex' })),
        el('div', null, el('span', { text: 'Mean EV, P10–P90 across the ' + DATA.validation.parameter_uncertainty.n_refits + ' refits (parameter uncertainty)' }), el('b', { class: 'num', text: (row.ev_mean_param_usd[0] >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.ev_mean_param_usd[0])) + ' – ' + (row.ev_mean_param_usd[1] >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.ev_mean_param_usd[1])) })),
        el('div', null, el('span', { text: 'P(negative return), P10–P90 across the ' + DATA.validation.parameter_uncertainty.n_refits + ' refits' }), el('b', { class: 'num', text: Math.round(row.prob_negative_param[0] * 100) + '% – ' + Math.round(row.prob_negative_param[1] * 100) + '%' })),
        el('div', null, el('span', { text: 'Rank range across the 70 LOPO refits (min–median–max)' }), el('b', { class: 'num', text: String(row.rank_range[0]) + '–' + String(row.rank_range[1]) + '–' + String(row.rank_range[2]) })),
        el('div', null, el('span', { text: 'Verdict stability: FARM / MARGINAL / SKIP across the ' + DATA.validation.verdict_stability.n_refits + ' LOPO refits (farm is STABLE at ≥ ' + DATA.validation.verdict_stability.stability_threshold + ' FARM)' }), el('b', { class: 'num', text: String(row.stability.farm) + ' / ' + String(row.stability.marginal) + ' / ' + String(row.stability.skip) + ' — ' + String(row.stability.agreeing_refits) + ' agree with the production verdict' + (row.farm_demoted_reason === 'unstable' ? ' — UNSTABLE, demoted to marginal' : '') })),
        el('div', null, el('span', { text: 'Gate (d) pass fraction under parameter + launch-odds uncertainty (paired draws)' }), el('b', { class: 'num', text: (function () { var s = DATA.validation.param_aware_simulation.rows.filter(function (x) { return x.slug === row.slug; })[0]; if (!s) return 'not an audit row'; return Math.round(s.pass_fraction_d_adopted * 100) + '% adopted odds / ' + Math.round(s.pass_fraction_d_conservative * 100) + '% conservative odds'; })() }))
      ),
      el('p', { class: 'sub', text: 'Launch odds: ' + row.launch_odds_source + ' — ' + row.launch_odds_cohort + ', horizon ' + row.launch_odds_horizon_months + ' months, supporting observations n=' + row.launch_odds_n_support + ', in the comparable risk set: ' + (row.launch_odds_in_risk_set ? 'yes' : 'no') + '. This is a cohort rate, not an individual probability for this protocol.' }),
      el('p', { class: 'sub', text: 'Decision trace — why this verdict: ' + row.decision_trace.join(' ') }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': log10(value if it launches) = ' + FIT.intercept + ' + ' + FIT.coef_log_tvl + ' x log10(TVL + $25M) + adjustments (selected estimator ' + DATA.validation.model_selection.selected.toUpperCase() + '); implied = 10^predicted x launch odds. The page recomputes this row as ' + fmtUsd(canonical) + (Math.abs(canonical - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.001) ? ', the same number board.json carries (within rounding: the board stores launch odds to 4 decimals).' : ', which differs from the board: the data would be stale.') + ' Walk-forward out-of-sample error ' + DATA.validation.oos_median_abs_log_err + ' dex, stratified ' + DATA.validation.oos_stratified + ' dex, 5-fold CV ' + DATA.validation.cv_median_abs_log_err + ' dex, R² ' + DATA.validation.r2 + ', cross-conformal 50% value band ±' + DATA.validation.band_halfwidth_dex + ' dex holding ' + Math.round(DATA.validation.range_holds * 100) + '% of comparables, 30-day purge gap. This is an estimate, not a price.' }),
      el('p', { class: 'sub', text: compNote })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict' }),
      el('p', null, el('span', { class: 'verdict ' + row.verdict, text: row.verdict.toUpperCase() }), ' ', el('span', { class: 'sub', text: 'Costed plan about $' + row.costed_plan.total_usd + ' (standard $10,000 deposit plus seven transactions of gas plus opportunity cost plus $50 slippage/fees; base cost $' + row.plan_cost_usd + '). ' + verdictStep(row) })),
      el('p', { class: 'sub', text: 'p_L is the base rate (' + Math.round(DATA.seasoning.base_rate * 1000) / 10 + '%) for every row under charter v1.7 — the seasoning curve is diagnostic only and does not price any row. p_BE is the launch probability at which farming breaks even. Each row carries TWO verdicts (adopted odds / conservative odds); the production verdict is the conservative one, unless the row is BORDERLINE — within 0.01 of a gate ceiling, or the analytic and simulated gate disagree — in which case it is MARGINAL for REVIEW, never farm and never skip. A farm verdict means the adopted gate (variant ' + DATA.validation.gate_test.adopted + ') passes under the CONSERVATIVE launch odds (' + (DATA.validation.launch_odds_decision.conservative_lower_bound * 100).toFixed(1) + '%) on the analytic statistics, the row is not BORDERLINE, and at least ' + DATA.validation.verdict_stability.stability_threshold + ' of ' + DATA.validation.verdict_stability.n_refits + ' LOPO refits agree with FARM; a CONDITIONAL FARM passes only under the adopted odds. A marginal verdict is a positive mean EV under the adopted odds that fails the conservative gate, a negative EV with break-even odds ≤33%, a CONDITIONAL FARM, or a BORDERLINE row held for REVIEW. The launch odds, not the valuation alone, decide it.' }),
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(categoryChart());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
