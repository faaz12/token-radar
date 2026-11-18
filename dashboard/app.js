// Token Radar's dashboard (radar-8). It reads window.RADAR (written beside dashboard/ by
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

  // The model in one function: the page recomputes a row from the fitted log value, so the
  // page's code and the board's data are visibly the same arithmetic. implied = 10^predicted
  // x launch odds, where predicted is the fitted log value-if-it-launches stored per row.
  // The sandbox scales that value and re-ranks live. Growth is not a production feature
  // (charter v1.1), so there is no growth slider: the 7-day change is display only.
  function valueIfOf(row, scale) {
    var pred = row.predicted_log_value;
    var raw = Math.round(Math.pow(10, pred)) * scale;
    return Math.min(MODEL.value_max, Math.max(MODEL.value_min, Math.round(raw)));
  }
  function impliedOf(row, scale) {
    var vIf = valueIfOf(row, scale);
    return Math.min(MODEL.value_max, Math.max(MODEL.value_min, Math.round(vIf * row.launch_odds)));
  }
  function effectiveRows() {
    if (!state.sandbox) return DATA.rows;
    var scale = state.scale;
    var rescored = DATA.rows.map(function (r) {
      var copy = {};
      for (var k in r) copy[k] = r[k];
      copy.value_if_launches_usd = valueIfOf(r, scale);
      copy.implied_value_usd = impliedOf(r, scale);
      copy.expected_value_usd = Math.round(expectedValue(r.launch_odds, copy.value_if_launches_usd, r.plan_cost_usd));
      copy.verdict = verdictFor(r.launch_odds, copy.value_if_launches_usd, r.plan_cost_usd, r.predicted_log_value);
      return copy;
    });
    rescored.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    rescored.forEach(function (r, i) { r.sandboxRank = i + 1; });
    return rescored;
  }
  function breakEvenOdds(valueIf, cost) {
    return valueIf > 0 ? cost / (MODEL.farmer_share * valueIf) : Infinity;
  }
  function expectedValue(launchOdds, valueIf, cost) {
    return launchOdds * MODEL.farmer_share * valueIf - cost;
  }
  // The farm verdict, from the expected net return with a safety margin (charter v1.1):
  // farm only when EV is positive at BOTH the central value and the P25 value.
  function verdictFor(launchOdds, valueIf, cost, predictedLog) {
    var ev = expectedValue(launchOdds, valueIf, cost);
    var hw = DATA.validation.band_halfwidth_dex;
    var evP25 = launchOdds * MODEL.farmer_share * Math.pow(10, predictedLog - hw) - cost;
    if (ev > 0 && evP25 > 0) return 'farm';
    if (ev > 0) return 'marginal';
    if (breakEvenOdds(valueIf, cost) <= MODEL.marginal_break_even) return 'marginal';
    return 'skip';
  }
  function fmtOdds(o) { return (o * 100).toFixed(1) + '%'; }
  // Launch odds by age, with the Platt recalibration applied when the charter adopted it.
  function launchOddsFor(ageDays) {
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
    var ev = expectedValue(row.launch_odds, row.value_if_launches_usd, row.plan_cost_usd);
    var evText = ev >= 0 ? '+$' + Math.round(ev).toLocaleString() : '−$' + Math.round(-ev).toLocaleString();
    var evP25 = row.ev_conservative_usd;
    var evP25Text = (evP25 === null || evP25 === undefined) ? '' : evP25 >= 0 ? ' and stays +$' + Math.round(evP25).toLocaleString() + ' at the P25 value' : ' but falls to −$' + Math.round(-evP25).toLocaleString() + ' at the P25 value';
    if (row.verdict === 'farm') return 'Verdict: FARM — expected net return ' + evText + evP25Text + ': a ' + fmtOdds(row.launch_odds) + ' launch chance (p_L) beats the ' + fmtOdds(be) + ' break-even (p_BE), against a value if it launches of ' + fmtShort(row.value_if_launches_usd) + ' and a plan cost of about $' + row.plan_cost_usd + '. Farm this protocol first.';
    if (row.verdict === 'marginal') return 'Verdict: MARGINAL — expected net return ' + evText + evP25Text + ': needs ' + fmtOdds(be) + ' to break even against a ' + fmtOdds(row.launch_odds) + ' launch chance, against a value if it launches of ' + fmtShort(row.value_if_launches_usd) + ' and a plan cost of about $' + row.plan_cost_usd + '. Worth a small position, not a priority.';
    return 'Verdict: SKIP — expected net return ' + evText + ': break-even launch odds ' + fmtOdds(be) + ' are too far from a ' + fmtOdds(row.launch_odds) + ' launch chance, against a value if it launches of ' + fmtShort(row.value_if_launches_usd) + ' and a plan cost of about $' + row.plan_cost_usd + '. Skip it unless its points program changes.';
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
          el('b', { text: String(DATA.board_size) }), ' rows. Each row is priced by a regression fitted on the live-token comparables: the fitted value if it launches, multiplied by the launch odds from the seasoning curve for its age, gives the implied value. Each farm plan carries a verdict — farm, marginal or skip — from the expected net return of farming it with a safety margin: the launch odds times 0.25% of the value if it launches, minus the plan cost of a standard $10,000 deposit; farm only when EV is positive at both the central value and the P25 value. Implied value is a model, not a promise.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) })),
        el('div', { class: 'fact' }, el('span', { text: 'Farm verdicts' }), el('b', { text: vc.farm + ' farm / ' + vc.marginal + ' marginal / ' + vc.skip + ' skip' })),
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
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(rankShown) }),
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
        el('td', null, el('span', { class: 'verdict ' + r.verdict, text: r.verdict.toUpperCase() })),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: (state.sandbox ? 'Sandbox ranking: the model re-run with your sliders. board.json keeps the canonical ranks. ' : 'Pre-token protocols, strongest implied value first. ') + 'Select a row for its model and farm plan.' }),
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
      el('p', { class: 'sub', text: 'A ' + v.model_selection.selected.toUpperCase() + '-fitted log-log regression, fitted at run time on the snapshot\'s own live-token comparables — ' + FIT.n_comps + ' DATED protocols with a token trading, TVL and market cap positive, CEX excluded, and only protocols the board could rank: the board\'s own wrapped / staked / bridged / versioned / exchange-product exclusions are applied to the training set too, so the curve is fitted on the population it prices. The 22 undated comparables are hard-gated out of every fit and calibration (charter v1.1) and appear only as a reference table below. Huber, OLS and a mild ridge were co-equal candidates; the prespecified selection rule picked ' + v.model_selection.selected.toUpperCase() + ' — ' + v.model_selection.reason + ' Every group adjustment below is a median residual shrunk toward zero, so a group with one or two comps moves a price a little and a group with fifteen moves it a lot. Growth is not a production feature: the growth coefficient is unstable across folds and no growth variant improves held-out error, so the 7-day change is shown for display only and never enters the fit. Age is not a regression term: it lives in the seasoning curve below, which prices the odds that a protocol of that age ever launches a token, and the fitted value is multiplied by those odds. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'log10(value if it launches)' }), ' = ', el('b', { text: String(FIT.intercept) }),
        ' + ', el('b', { text: String(FIT.coef_log_tvl) }), ' x log10(TVL + $25M)',
        ' + category adjustment + main-chain adjustment; implied = round(10^predicted) x launch odds; verdicts from expected net return with a safety margin (launch odds x 0.25% x value if it launches − plan cost), farm only when EV is positive at both the central value and the P25 value'
      ),
      el('div', { class: 'facts fit' },
        el('div', { class: 'fact' }, el('span', { text: 'Selected estimator (charter v1.1 rule)' }), el('b', { text: v.model_selection.selected.toUpperCase() })),
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
        el('p', { class: 'note sub', text: 'Move the slider and the board re-ranks live. This is a what-if: board.json keeps the canonical ranks from the fitted model above. There is no growth slider: growth is not a production feature (charter v1.1) — the 7-day change is display only.' }),
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
      el('h3', { text: 'Seasoning: launch odds by protocol age' }),
      el('p', { class: 'sub', text: 'A logistic curve fitted on all ' + DATA.seasoning.n_protocols + ' dated protocols in the snapshot: the older a protocol has run with no token, the more likely it is to launch one. An undated protocol uses the base rate of ' + Math.round(DATA.seasoning.base_rate * 100) + '%.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Age' }), el('th', { scope: 'col', text: 'Launch odds' }))),
          el('tbody', null, [30, 90, 180, 365, 730, 1500, 2200].map(function (days) {
            return el('tr', null,
              el('td', { text: days >= 365 ? (days / 365).toFixed(1) + ' years' : days + ' days' }),
              el('td', { class: 'num', text: fmtOdds(launchOddsFor(days)) })
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
      el('p', { class: 'sub', text: 'On the ' + v.seasoning_audit.n_pooled + ' pooled fold-local predictions, the curve’s ranking signal is weak (ROC-AUC ' + v.seasoning_audit.roc_auc + ', PR-AUC ' + v.seasoning_audit.pr_auc + ' against a base launch rate of ' + Math.round(DATA.seasoning.base_rate * 100) + '%) and its improvement over predicting the base rate is NOT statistically significant: the bootstrap 95% interval for the Brier improvement is [' + v.seasoning_audit.brier_improvement_ci[0] + ', ' + v.seasoning_audit.brier_improvement_ci[1] + '] and for log-loss [' + v.seasoning_audit.log_loss_improvement_ci[0] + ', ' + v.seasoning_audit.log_loss_improvement_ci[1] + '] — both straddle zero. Every farm verdict depends on this curve, so the verdicts inherit its limits: the EV audit below shows the exposure. ' + (DATA.seasoning.platt_a !== null ? 'A Platt recalibration was adopted (a = ' + DATA.seasoning.platt_a + ', b = ' + DATA.seasoning.platt_b + '): ' + v.seasoning_audit.platt.reason : 'No Platt recalibration was adopted: ' + v.seasoning_audit.platt.reason) + ' Note honestly: on the untouched 80/90 test set the base rate itself scores Brier ' + v.seasoning_audit.platt.test_brier_base + ' and log-loss ' + v.seasoning_audit.platt.test_log_loss_base + ' — better than both the raw curve (' + v.seasoning_audit.platt.test_brier_raw + ' / ' + v.seasoning_audit.platt.test_log_loss_raw + ') and the Platt curve (' + v.seasoning_audit.platt.test_brier_platt + ' / ' + v.seasoning_audit.platt.test_log_loss_platt + '). The curve is kept because it ranks protocols by age where the base rate cannot, not because it beats the base rate on the latest period.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Predicted odds' }), el('th', { scope: 'col', text: 'Protocols' }), el('th', { scope: 'col', text: 'Mean predicted' }), el('th', { scope: 'col', text: 'Actually launched' }))),
          el('tbody', null, v.seasoning_audit.reliability_bins.map(function (b) {
            return el('tr', null, el('td', { text: Math.round(b.pred_min * 100) + '–' + Math.round(b.pred_max * 100) + '%' }), el('td', { class: 'num', text: String(b.n) }), el('td', { class: 'num', text: Math.round(b.mean_pred * 100) + '%' }), el('td', { class: 'num', text: Math.round(b.actual_rate * 100) + '%' }));
          }))
        )
      ),
      el('h3', { text: 'Model selection: three co-equal candidates (charter v1.1)' }),
      el('p', { class: 'sub', text: 'Huber, OLS and a mild ridge (λ = 1.0 on the standardized log-TVL slope) were fitted on identical rows and folds. Rule: the best nested 50–80 pooled median wins; a gap under 0.01 dex prefers the simpler model (OLS > ridge > Huber); Huber needs a P90 tail error better than OLS by > 0.05 dex AND a smaller drop-one slope change. R² is never the criterion. Selected: ' + v.model_selection.selected.toUpperCase() + ' — ' + v.model_selection.reason }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Estimator' }), el('th', { scope: 'col', text: 'Selection pooled 50–80 (dex)' }), el('th', { scope: 'col', text: 'Selection P90 (dex)' }), el('th', { scope: 'col', text: 'Walk-forward 70/30 (dex)' }), el('th', { scope: 'col', text: '5-fold CV (dex)' }), el('th', { scope: 'col', text: 'Drop-one slope change' }))),
          el('tbody', null, v.model_selection.candidates.map(function (c) {
            return el('tr', null, el('td', { text: c.estimator.toUpperCase() + (c.estimator === v.model_selection.selected ? ' (selected)' : '') }), el('td', { class: 'num', text: String(c.selection_pooled) }), el('td', { class: 'num', text: String(c.selection_p90) }), el('td', { class: 'num', text: String(c.wf) }), el('td', { class: 'num', text: String(c.cv) }), el('td', { class: 'num', text: String(c.drop_one_slope_change) }));
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
      el('h3', { text: 'EV audit: every farm verdict, with its scenarios and downside' }),
      el('p', { class: 'sub', text: 'A farm verdict means EV is positive at BOTH the central value and the P25 value (charter v1.1 safety margin). Rows below that are not farm but have a positive central EV were demoted by the margin rule — the audit trail for the verdicts. Probability of a negative return assumes log10(value) is normal around the prediction with σ from the 50% band, and counts a non-launch as a full loss of the plan cost. ' + v.ev_audit.assumptions }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'p_L / p_BE' }), el('th', { scope: 'col', text: 'EV central' }), el('th', { scope: 'col', text: 'EV at P25' }), el('th', { scope: 'col', text: 'EV at P75' }), el('th', { scope: 'col', text: 'P(negative return)' }), el('th', { scope: 'col', text: 'P10 value / EV at P10' }), el('th', { scope: 'col', text: 'Verdict' }))),
          el('tbody', null, v.ev_audit.rows.map(function (r) {
            return el('tr', null,
              el('td', { text: r.name }),
              el('td', { class: 'num', text: Math.round(r.launch_odds * 100) + '% / ' + Math.round(r.break_even_odds * 100) + '%' }),
              el('td', { class: 'num', text: (r.ev_central_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.ev_central_usd)) }),
              el('td', { class: 'num', text: (r.ev_conservative_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.ev_conservative_usd)) }),
              el('td', { class: 'num', text: (r.ev_optimistic_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.ev_optimistic_usd)) }),
              el('td', { class: 'num', text: Math.round(r.prob_negative_return * 100) + '%' }),
              el('td', { class: 'num', text: fmtUsd(r.p10_value_usd) + ' / ' + (r.ev_at_p10_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(r.ev_at_p10_usd)) }),
              el('td', { text: r.verdict.toUpperCase() })
            );
          }))
        )
      ),
      el('h3', { text: 'Undated comparables: reference table (never fitted)' }),
      el('p', { class: 'sub', text: 'These ' + v.n_undated_comps + ' protocols have a token trading but no recorded listing date, so charter v1.1 hard-gates them out of every fit and calibration. Each row is scored by the dated-only full fit; the residuals are an honest out-of-sample diagnostic of a different, harder population. ' + v.conformal_undated.analysis }),
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
        el('div', null, el('span', { text: 'Age with no token -> launch odds' }), el('b', { class: 'num', text: (row.age_days === null ? 'undated' : fmtAge(row.age_days)) + ' -> ' + fmtOdds(row.launch_odds) })),
        el('div', null, el('span', { text: 'Category adjustment' }), el('b', { class: 'num', text: (row.category_adjustment >= 0 ? '+' : '') + row.category_adjustment.toFixed(2) + ' dex' })),
        el('div', null, el('span', { text: 'Main-chain adjustment' }), el('b', { class: 'num', text: (row.chain_adjustment >= 0 ? '+' : '') + row.chain_adjustment.toFixed(2) + ' dex' })),
        el('div', null, el('span', { text: 'Predicted log10 value if it launches' }), el('b', { class: 'num', text: String(row.predicted_log_value.toFixed(3)) })),
        el('div', null, el('span', { text: 'Value if it launches (10^predicted)' }), el('b', { class: 'num', text: fmtUsd(row.value_if_launches_usd) })),
        el('div', null, el('span', { text: 'Launch odds (seasoning curve)' }), el('b', { class: 'num', text: fmtOdds(row.launch_odds) })),
        el('div', null, el('span', { text: 'Implied value (value if it launches x launch odds)' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Expected net return (launch odds x 0.25% x value if it launches − plan cost)' }), el('b', { class: 'num', text: (row.expected_value_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.expected_value_usd)) })),
        el('div', null, el('span', { text: 'Expected net return at P25 / P75 value' }), el('b', { class: 'num', text: (row.ev_conservative_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.ev_conservative_usd)) + ' / ' + (row.ev_optimistic_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.ev_optimistic_usd)) })),
        el('div', null, el('span', { text: 'Probability of a negative return' }), el('b', { class: 'num', text: Math.round(row.prob_negative_return * 100) + '%' })),
        el('div', null, el('span', { text: 'P10 value / EV at P10' }), el('b', { class: 'num', text: fmtUsd(row.p10_value_usd) + ' / ' + (row.ev_at_p10_usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(row.ev_at_p10_usd)) })),
        el('div', null, el('span', { text: 'Value band P25–P75 (±' + DATA.validation.band_halfwidth_dex + ' dex)' }), el('b', { class: 'num', text: fmtUsd(row.band_p25_usd) + ' – ' + fmtUsd(row.band_p75_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': log10(value if it launches) = ' + FIT.intercept + ' + ' + FIT.coef_log_tvl + ' x log10(TVL + $25M) + adjustments (selected estimator ' + DATA.validation.model_selection.selected.toUpperCase() + '); implied = 10^predicted x launch odds. The page recomputes this row as ' + fmtUsd(canonical) + (Math.abs(canonical - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.001) ? ', the same number board.json carries (within rounding: the board stores launch odds to 4 decimals).' : ', which differs from the board: the data would be stale.') + ' Walk-forward out-of-sample error ' + DATA.validation.oos_median_abs_log_err + ' dex, stratified ' + DATA.validation.oos_stratified + ' dex, 5-fold CV ' + DATA.validation.cv_median_abs_log_err + ' dex, R² ' + DATA.validation.r2 + ', cross-conformal 50% value band ±' + DATA.validation.band_halfwidth_dex + ' dex holding ' + Math.round(DATA.validation.range_holds * 100) + '% of comparables, 30-day purge gap. This is an estimate, not a price.' }),
      el('p', { class: 'sub', text: compNote })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict' }),
      el('p', null, el('span', { class: 'verdict ' + row.verdict, text: row.verdict.toUpperCase() }), ' ', el('span', { class: 'sub', text: 'Plan cost about $' + row.plan_cost_usd + ' (standard $10,000 deposit plus seven transactions of gas plus opportunity cost). ' + verdictStep(row) })),
      el('p', { class: 'sub', text: 'p_L is this protocol\u2019s own launch odds from the seasoning curve; p_BE is the launch probability at which farming breaks even. A farm verdict means the expected net return is positive at BOTH the central value and the P25 value (safety margin); a marginal verdict is positive centrally but not at P25, or negative with break-even odds ≤33%. The launch odds, not the valuation alone, decide it.' }),
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
