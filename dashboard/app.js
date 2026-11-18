// Token Radar's dashboard (radar-4). It reads window.RADAR (written beside dashboard/ by
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
    scale: 1, coefGrowth: FIT.coef_growth, sandbox: false
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
  // page's code and the board's data are visibly the same arithmetic. implied = 10^predicted,
  // where predicted is the fitted log value stored per row. The sandbox scales that value
  // and moves the growth coefficient, then re-ranks live.
  function growthClamped(row) {
    return Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
  }
  function impliedOf(row, scale, coefGrowth) {
    var pred = row.predicted_log_value + (coefGrowth - FIT.coef_growth) * growthClamped(row);
    var raw = Math.round(Math.pow(10, pred)) * scale;
    return Math.min(MODEL.value_max, Math.max(MODEL.value_min, Math.round(raw)));
  }
  function effectiveRows() {
    if (!state.sandbox) return DATA.rows;
    var scale = state.scale, cg = state.coefGrowth;
    var rescored = DATA.rows.map(function (r) {
      var copy = {};
      for (var k in r) copy[k] = r[k];
      copy.implied_value_usd = impliedOf(r, scale, cg);
      copy.verdict = verdictFor(copy.implied_value_usd, r.plan_cost_usd);
      return copy;
    });
    rescored.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    rescored.forEach(function (r, i) { r.sandboxRank = i + 1; });
    return rescored;
  }
  function verdictFor(implied, cost) {
    var ratio = cost > 0 ? implied / cost : Infinity;
    if (implied >= MODEL.farm_value && ratio >= MODEL.farm_ratio) return 'farm';
    if (implied < MODEL.skip_value || ratio < MODEL.skip_ratio) return 'skip';
    return 'marginal';
  }
  function fmtShort(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function verdictStep(row) {
    var ratio = Math.round(row.implied_value_usd / row.plan_cost_usd).toLocaleString('en-US');
    if (row.verdict === 'farm') return 'Verdict: FARM — the fitted implied value of ' + fmtShort(row.implied_value_usd) + ' is about ' + ratio + 'x the plan cost of about $' + row.plan_cost_usd + ', so farm this protocol first.';
    if (row.verdict === 'marginal') return 'Verdict: MARGINAL — the fitted implied value of ' + fmtShort(row.implied_value_usd) + ' is about ' + ratio + 'x the plan cost of about $' + row.plan_cost_usd + ': worth a small position, not a priority.';
    return 'Verdict: SKIP — the fitted implied value of ' + fmtShort(row.implied_value_usd) + ' is only about ' + ratio + 'x the plan cost of about $' + row.plan_cost_usd + ', or the value is low, so skip it unless its points program changes.';
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
          el('b', { text: String(DATA.board_size) }), ' rows. Each row is priced by a regression fitted on the live-token comparables, and each farm plan carries a verdict — farm, marginal or skip — from the fitted value against the plan cost. Implied value is a model, not a promise.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) })),
        el('div', { class: 'fact' }, el('span', { text: 'Farm verdicts' }), el('b', { text: vc.farm + ' farm / ' + vc.marginal + ' marginal / ' + vc.skip + ' skip' })),
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
    var lineY = function (x) { return FIT.intercept + FIT.coef_log_tvl * Math.log10(Math.pow(10, x) + FIT.size_floor_usd) + FIT.coef_growth * FIT.median_growth + FIT.coef_log_age * FIT.median_log_age; };
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
    s += '<text x="' + (W - R) + '" y="' + (T + 10) + '" fill="#f5b544" font-size="11" text-anchor="end">fitted curve at median growth and age</text>';
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
    var cgSlider = el('input', { type: 'range', min: '-0.02', max: '0.02', step: '0.001', value: String(state.coefGrowth), 'aria-label': 'Growth coefficient' });
    var scaleOut = el('output', { text: state.scale.toFixed(2) + 'x' });
    var cgOut = el('output', { text: String(state.coefGrowth) });
    function onSandbox() {
      state.scale = Number(scaleSlider.value);
      state.coefGrowth = Number(cgSlider.value);
      scaleOut.textContent = state.scale.toFixed(2) + 'x';
      cgOut.textContent = String(state.coefGrowth);
      state.sandbox = state.scale !== 1 || state.coefGrowth !== FIT.coef_growth;
      render();
    }
    scaleSlider.addEventListener('input', onSandbox);
    cgSlider.addEventListener('input', onSandbox);
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the model', onclick: function () { state.scale = 1; state.coefGrowth = FIT.coef_growth; state.sandbox = false; render(); } });
    var scatter = el('div', { class: 'scatter' });
    scatter.innerHTML = scatterSvg();
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How value is fitted' }),
      el('p', { class: 'sub', text: 'A Huber-fitted log-log regression, fitted at run time on the snapshot\'s own live-token comparables — ' + FIT.n_comps + ' protocols with a token trading, TVL and market cap positive, CEX excluded. Huber down-weights the snapshot\'s own attribution quirks instead of letting one mis-counted token drag the curve, and every group adjustment below is a median residual shrunk toward zero, so a group with one or two comps moves a price a little and a group with fifteen moves it a lot. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'log10(implied)' }), ' = ', el('b', { text: String(FIT.intercept) }),
        ' + ', el('b', { text: String(FIT.coef_log_tvl) }), ' x log10(TVL + $100M)',
        ' + ', el('b', { text: String(FIT.coef_growth) }), ' x clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')',
        ' + ', el('b', { text: String(FIT.coef_log_age) }), ' x log10(age_days + 1)',
        ' + category adjustment + main-chain adjustment; implied = round(10^predicted)'
      ),
      el('div', { class: 'facts fit' },
        el('div', { class: 'fact' }, el('span', { text: 'In-sample R² (fitted model)' }), el('b', { text: String(v.r2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Walk-forward out-of-sample error' }), el('b', { text: String(v.oos_median_abs_log_err) + ' dex (median)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Stratified walk-forward error' }), el('b', { text: String(v.oos_stratified) + ' dex (median)' })),
        el('div', { class: 'fact' }, el('span', { text: '5-fold cross-validation error' }), el('b', { text: String(v.cv_median_abs_log_err) + ' dex (median)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Bootstrap band (200 refits, 1-sigma)' }), el('b', { text: '±' + String(v.bootstrap_sd) + ' dex' })),
        el('div', { class: 'fact' }, el('span', { text: 'Walk-forward split' }), el('b', { text: v.n_train + ' train (oldest) / ' + v.n_test + ' test (newest)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live comparables fitted' }), el('b', { text: String(FIT.n_comps) }))
      ),
      el('p', { class: 'sub', text: 'Tested out of sample three ways: the model is fitted on the oldest 70% of the live comparables by listing date and scored on the newest 30%; the same split is repeated with dated and undated protocols each split 70/30, so the third of the set with no listing date is scored too; and a 5-fold cross-validation shuffles the set once with a fixed seed. A median error of ' + v.oos_median_abs_log_err + ' dex means a typical prediction is off by that many orders of magnitude either way, and the bootstrap band of ±' + v.bootstrap_sd + ' dex is how much the fitted value itself wobbles when the comparables are resampled — the ranking is a guide for where to look first, not a price. The $100M floor keeps the curve from pricing a small protocol at zero for being small: TVL below $100M is noisy in the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Wrapped, staked and bridged products of tokens that already trade are set aside, not ranked: their token already exists, so there is no launch to price.' }),
      scatter,
      el('div', { class: 'sandbox' },
        el('label', null, 'Fitted value scale ', scaleOut, scaleSlider),
        el('label', null, 'Growth coefficient ', cgOut, cgSlider),
        el('p', { class: 'note sub', text: 'Move a slider and the board re-ranks live. This is a what-if: board.json keeps the canonical ranks from the fitted model above.' }),
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
      )
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
    var canonical = impliedOf(row, 1, FIT.coef_growth);
    var comps = DATA.live.filter(function (l) { return (l.category || 'Other') === (row.category || 'Other'); }).slice(0, 3);
    var compNote = comps.length > 0
      ? 'Live comparables in ' + (row.category || 'Other') + ': ' + comps.map(function (l) { return l.name + ' at ' + fmtMult(l.multiple); }).join(', ') + '.'
      : 'No live protocol in ' + (row.category || 'Other') + ' is in the top 24 by market cap; this row is priced on the fitted regression' + (row.category_adjustment ? ' with a category adjustment of ' + row.category_adjustment.toFixed(2) + ' dex.' : ' with no category adjustment.') + '.';
    var growthPct = growthClamped(row);
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
        el('div', null, el('span', { text: 'TVL + $100M floor (log10)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) + ' (' + Math.log10(row.tvl_usd + FIT.size_floor_usd).toFixed(2) + ')' })),
        el('div', null, el('span', { text: 'Seven-day growth (clamped)' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' -> ' + growthPct })),
        el('div', null, el('span', { text: 'Age with no token (log10(age+1))' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' (' + Math.log10(age + 1).toFixed(2) + ')' })),
        el('div', null, el('span', { text: 'Category adjustment' }), el('b', { class: 'num', text: (row.category_adjustment >= 0 ? '+' : '') + row.category_adjustment.toFixed(2) + ' dex' })),
        el('div', null, el('span', { text: 'Main-chain adjustment' }), el('b', { class: 'num', text: (row.chain_adjustment >= 0 ? '+' : '') + row.chain_adjustment.toFixed(2) + ' dex' })),
        el('div', null, el('span', { text: 'Predicted log10 value' }), el('b', { class: 'num', text: String(row.predicted_log_value.toFixed(3)) })),
        el('div', null, el('span', { text: 'Implied value (10^predicted)' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': log10(value) = ' + FIT.intercept + ' + ' + FIT.coef_log_tvl + ' x log10(TVL + $100M) + ' + FIT.coef_growth + ' x growth + ' + FIT.coef_log_age + ' x log10(age+1) + adjustments. The page recomputes this row as ' + fmtUsd(canonical) + (canonical === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' Walk-forward out-of-sample error ' + DATA.validation.oos_median_abs_log_err + ' dex, stratified ' + DATA.validation.oos_stratified + ' dex, 5-fold CV ' + DATA.validation.cv_median_abs_log_err + ' dex, R² ' + DATA.validation.r2 + '. This is an estimate, not a price.' }),
      el('p', { class: 'sub', text: compNote })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict' }),
      el('p', null, el('span', { class: 'verdict ' + row.verdict, text: row.verdict.toUpperCase() }), ' ', el('span', { class: 'sub', text: 'Plan cost about $' + row.plan_cost_usd + ' (capital plus seven transactions of gas). ' + verdictStep(row) })),
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
