// Token Radar — dashboard.
//
// Reads window.RADAR (written by main.ts into data.js) and renders the board:
// a sortable, filterable table of pre-token protocols ranked by implied value,
// a live-token tab, a top-three spotlight, and a detail drawer per protocol
// with its model breakdown and farm plan. No network, no framework: the page
// only ever reads the data file that sits beside it.

const R = window.RADAR;

const $ = (id) => document.getElementById(id);
const rowsEl = $('rows');
const emptyEl = $('empty');
const countEl = $('count');
const drawerEl = $('drawer');
const detailEl = $('detail');

/** Escape text for HTML so protocol names can never break the page. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** $1,234,567 or $1.23B / $45.6M for large amounts. */
function money(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/** A whole-dollar amount with commas. */
function dollars(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** +12.3% / −4.1% / — for a seven-day change in per cent. */
function pct(x) {
  if (x === null || x === undefined) return { text: '—', cls: 'flat' };
  const sign = x > 0 ? '+' : x < 0 ? '−' : '';
  return { text: `${sign}${Math.abs(x).toFixed(1)}%`, cls: x > 0 ? 'up' : x < 0 ? 'down' : 'flat' };
}

/** 812 days / 2.2 yrs / — for an age in days. */
function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 365) return `${(days / 365).toFixed(1)} yrs`;
  return `${days} days`;
}

/** The page's working state: tab, filters, sort. */
const state = {
  tab: 'pre',
  q: '',
  category: '',
  chain: '',
  watchlistOnly: false,
  sortKey: 'rank',
  sortDir: 1,
};

/** Fill the masthead facts and the meta line from the snapshot. */
function renderHead() {
  const rows = R.rows;
  const top = rows[0];
  const watchRows = rows.filter((r) => r.on_watchlist).length;
  const medianTvl = rows.map((r) => r.tvl_usd).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  $('meta-line').textContent =
    `Snapshot ${R.as_of} · ${R.watchlist_size} protocols on the watchlist · ${rows.length} ranked · ` +
    `top implied value ${top ? dollars(top.implied_value_usd) : '—'}`;
  $('facts').innerHTML =
    `<div class="fact"><b>${rows.length}</b><span>protocols ranked</span></div>` +
    `<div class="fact"><b>${watchRows}</b><span>watchlist covered</span></div>` +
    `<div class="fact"><b>${money(medianTvl)}</b><span>median TVL</span></div>` +
    `<div class="fact"><b>${R.live.length}</b><span>already have a token</span></div>`;
  $('as-of').textContent = R.as_of;
  $('source').textContent = R.source;
}

/** The top three rows as spotlight cards. */
function renderSpotlight() {
  $('spotlight').innerHTML = R.rows.slice(0, 3).map((r) => {
    const change = pct(r.change_7d);
    return `<article class="spot" data-slug="${esc(r.slug)}" tabindex="0" role="button" aria-label="Open ${esc(r.name)}">
      <span class="spot-rank">Rank ${r.rank}${r.on_watchlist ? ' · watchlist' : ''}</span>
      <h2>${esc(r.name)}</h2>
      <p class="spot-value">${dollars(r.implied_value_usd)}</p>
      <p>TVL ${money(r.tvl_usd)} · 7d <span class="${change.cls}">${change.text}</span> · ${esc(r.chains[0] ?? '')}</p>
    </article>`;
  }).join('');
  document.querySelectorAll('.spot').forEach((el) => {
    const open = () => openDetail(el.getAttribute('data-slug'));
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

/** Fill the category and chain selects from the data, once. */
function renderFilters() {
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('category').innerHTML = '<option value="">All categories</option>' +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' +
    chains.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

/** The rows for the current tab, after search and filters. */
function visibleRows() {
  const q = state.q.trim().toLowerCase();
  if (state.tab === 'live') {
    return R.live.filter((r) => {
      if (q && !(`${r.name} ${r.slug}`.toLowerCase().includes(q))) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      return true;
    });
  }
  return R.rows.filter((r) => {
    if (q && !(`${r.name} ${r.slug}`.toLowerCase().includes(q))) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.watchlistOnly && !r.on_watchlist) return false;
    return true;
  });
}

/** Sort a list of rows by the active sort key and direction. */
function sortRows(list) {
  const key = state.sortKey;
  const dir = state.sortDir;
  const val = (r) => {
    if (key === 'rank') return r.rank ?? 1e9;
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'change') return r.change_7d ?? 0;
    if (key === 'age') return r.age_days ?? -1;
    if (key === 'value') return r.implied_value_usd ?? r.tvl_usd;
    return r.rank ?? 1e9;
  };
  return [...list].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (typeof va === 'string') return va.localeCompare(vb) * dir;
    return (va - vb) * dir;
  });
}

/** Render the table body for the current state. */
function renderTable() {
  const list = sortRows(visibleRows());
  countEl.textContent = `${list.length} of ${state.tab === 'live' ? R.live.length : R.rows.length} shown`;
  emptyEl.hidden = list.length !== 0;
  if (state.tab === 'live') {
    rowsEl.innerHTML = list.map((r) => {
      const change = pct(r.change_7d);
      return `<tr data-slug="${esc(r.slug)}">
        <td class="num">—</td>
        <td class="name-cell"><b>${esc(r.name)}</b><span>${esc(r.slug)} · has a token (${esc(r.symbol ?? '')})</span></td>
        <td>${esc(r.category ?? '—')}</td>
        <td>${r.chains.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}</td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num ${change.cls}">${change.text}</td>
        <td class="num">—</td>
        <td class="num">${r.mcap_usd !== null && r.mcap_usd !== undefined ? money(r.mcap_usd) : '—'}</td>
      </tr>`;
    }).join('');
  } else {
    rowsEl.innerHTML = list.map((r) => {
      const change = pct(r.change_7d);
      return `<tr data-slug="${esc(r.slug)}">
        <td class="num">${r.rank}</td>
        <td class="name-cell"><b>${esc(r.name)}</b><span>${esc(r.slug)}${r.on_watchlist ? ' · watchlist' : ''}</span></td>
        <td>${esc(r.category ?? '—')}</td>
        <td>${r.chains.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}${r.on_watchlist ? ' <span class="tag watch">watchlist</span>' : ''}</td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num ${change.cls}">${change.text}</td>
        <td class="num">${ageText(r.age_days)}</td>
        <td class="num"><b>${dollars(r.implied_value_usd)}</b></td>
      </tr>`;
    }).join('');
  }
  rowsEl.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => openDetail(tr.getAttribute('data-slug')));
  });
  document.querySelectorAll('.sort').forEach((btn) => {
    const key = btn.getAttribute('data-sort');
    btn.setAttribute('aria-sort', key === state.sortKey ? (state.sortDir === 1 ? 'ascending' : 'descending') : 'none');
  });
}

/** Open the detail drawer for one protocol. */
function openDetail(slug) {
  const row = R.rows.find((r) => r.slug === slug) ?? R.live.find((r) => r.slug === slug);
  if (!row) return;
  rowsEl.querySelectorAll('tr.selected').forEach((tr) => tr.classList.remove('selected'));
  const tr = rowsEl.querySelector(`tr[data-slug="${CSS.escape(slug)}"]`);
  if (tr) tr.classList.add('selected');
  if (row.implied_value_usd === undefined) {
    detailEl.innerHTML =
      `<h2>${esc(row.name)}</h2>
       <p class="sub">${esc(row.slug)} · ${esc(row.category ?? 'no category')} · ${row.chains.map((c) => esc(c)).join(', ')}</p>
       <div class="kv">
         <div><span>TVL</span><b>${money(row.tvl_usd)}</b></div>
         <div><span>Market cap</span><b>${row.mcap_usd ? money(row.mcap_usd) : '—'}</b></div>
         <div><span>Token</span><b>${esc(row.symbol ?? '—')}</b></div>
         <div><span>7d change</span><b>${pct(row.change_7d).text}</b></div>
       </div>
       <p>This protocol already records a token, so it is not on the pre-token board. It is shown here
       so the board's claim is checkable: the radar separates what already trades from what may come.</p>`;
  } else {
    const change = pct(row.change_7d);
    detailEl.innerHTML =
      `<h2>${esc(row.name)}</h2>
       <p class="sub">${esc(row.slug)} · rank ${row.rank} · ${esc(row.category ?? 'no category')} · ${row.chains.map((c) => esc(c)).join(', ')}${row.on_watchlist ? ' · on the watchlist' : ''}</p>
       <div class="kv">
         <div><span>Implied value</span><b>${dollars(row.implied_value_usd)}</b></div>
         <div><span>TVL</span><b>${money(row.tvl_usd)}</b></div>
         <div><span>7d change</span><b class="${change.cls}">${change.text}</b></div>
         <div><span>Age with no token</span><b>${ageText(row.age_days)}</b></div>
       </div>
       <h3>How the value is built</h3>
       <table class="model-table">
         <tr><td>TVL</td><td>${dollars(row.tvl_usd)}</td></tr>
         <tr><td>Tier multiple</td><td>× ${row.tier.toFixed(2)}</td></tr>
         <tr><td>Seven-day growth</td><td>${change.text} → × ${row.growth_mult.toFixed(3)}</td></tr>
         <tr><td>Time with no token</td><td>${ageText(row.age_days)} → × ${row.maturity_mult.toFixed(3)}</td></tr>
         <tr><td>Chain breadth (${row.chains.length} chain${row.chains.length === 1 ? '' : 's'})</td><td>× ${row.breadth_mult.toFixed(3)}</td></tr>
         <tr><td><b>Implied value</b></td><td><b>${dollars(row.implied_value_usd)}</b></td></tr>
       </table>
       <h3>Farm plan — seven steps</h3>
       <ol class="steps">${row.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  }
  drawerEl.hidden = false;
}

function closeDetail() {
  drawerEl.hidden = true;
  rowsEl.querySelectorAll('tr.selected').forEach((tr) => tr.classList.remove('selected'));
}

/** Wire every control, then paint the page. */
function init() {
  if (!R || !Array.isArray(R.rows)) {
    document.body.innerHTML = '<main><p class="empty">The radar data did not load. data.js must sit beside this page.</p></main>';
    return;
  }
  renderHead();
  renderSpotlight();
  renderFilters();
  renderTable();
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderTable(); });
  $('category').addEventListener('change', (e) => { state.category = e.target.value; renderTable(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; renderTable(); });
  $('watchlist-only').addEventListener('change', (e) => { state.watchlistOnly = e.target.checked; renderTable(); });
  $('tab-pre').addEventListener('click', () => {
    state.tab = 'pre'; state.sortKey = 'rank'; state.sortDir = 1;
    $('tab-pre').classList.add('active'); $('tab-live').classList.remove('active');
    $('tab-pre').setAttribute('aria-selected', 'true'); $('tab-live').setAttribute('aria-selected', 'false');
    renderTable();
  });
  $('tab-live').addEventListener('click', () => {
    state.tab = 'live'; state.sortKey = 'tvl'; state.sortDir = -1;
    $('tab-live').classList.add('active'); $('tab-pre').classList.remove('active');
    $('tab-live').setAttribute('aria-selected', 'true'); $('tab-pre').setAttribute('aria-selected', 'false');
    renderTable();
  });
  document.querySelectorAll('.sort').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-sort');
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = key === 'name' ? 1 : -1; }
      renderTable();
    });
  });
  $('drawer-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
}

init();
