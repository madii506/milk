/* MILK front end. No framework, no keys: the server builds PumpSwap transactions, your wallet signs. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const COW = $('.brand .cow').outerHTML;
  const S = { pools: [], sort: 'milk', min: 25, q: '', cfg: {}, pool: null, tab: 'add', slip: 2, pct: 100, toSol: true, busy: false, positions: null, updated: 0, amt: '' };
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

  /* ---------- utils ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = bytes => { let n = 0n; for (const x of bytes) n = n * 256n + BigInt(x); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const x of bytes) { if (x === 0) s = '1' + s; else break; } return s; };
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const isAddr = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  function compact(n) {
    n = Number(n); if (!isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
    if (a >= 100) return n.toFixed(0);
    if (a >= 1) return n.toFixed(2);
    if (a === 0) return '0';
    return n.toPrecision(3);
  }
  function fsol(n, d) { n = Number(n) || 0; if (d != null) return n.toFixed(d); const a = Math.abs(n); return a >= 1000 ? compact(n) : a >= 1 ? n.toFixed(2) : a >= 0.01 ? n.toFixed(3) : a > 0 ? n.toFixed(5) : '0'; }
  const coinAmt = (raw, dec) => Number(BigInt(raw || '0')) / Math.pow(10, dec || 6);
  const pctTxt = (x, d = 2) => (x * 100).toFixed(d) + '%';
  const age = ms => { if (!ms) return ''; const h = (Date.now() - ms) / 36e5; return h < 1 ? Math.max(1, Math.round(h * 60)) + 'm' : h < 48 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd'; };
  function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
  async function api(path, body) {
    const opt = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {};
    const r = await fetch('/api/' + path, opt);
    let j = null; try { j = await r.json(); } catch (e) { }
    if (!r.ok || !j || j.ok === false) { const e = new Error((j && j.error) || ('Request failed (' + r.status + ')')); e.logs = j && j.logs; throw e; }
    return j;
  }
  function tokImg(p, cls = 'tok') {
    const letter = esc(((p.symbol || p.name || '?')[0] || '?').toUpperCase());
    const img = p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('ok')" onerror="this.remove()">` : '';
    return `<span class="${cls}"><span class="ph">${letter}</span>${img}</span>`;
  }
  const label = p => esc(p.symbol ? '$' + p.symbol : short(p.mint));

  /* ---------- wallet (Wallet Standard) ---------- */
  const W = { list: [], w: null, acct: null };
  function addWallet(w) {
    try {
      if (!w || !w.features || !w.name) return;
      const sol = (w.chains || []).some(c => String(c).startsWith('solana:'));
      const can = w.features['standard:connect'] && (w.features['solana:signTransaction'] || w.features['solana:signAndSendTransaction']);
      if (!sol || !can || W.list.some(x => x.name === w.name)) return;
      W.list.push(w);
      if (!W.w && store.get('milk:wallet') === w.name && w.accounts && w.accounts.length) use(w, w.accounts[0]);
      if (!$('#wModal').hidden) renderWallets();
    } catch (e) { }
  }
  const walletApi = Object.freeze({ register: (...ws) => { ws.forEach(addWallet); return () => { }; } });
  window.addEventListener('wallet-standard:register-wallet', e => { try { e.detail(walletApi); } catch (_) { } });
  try { window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: walletApi })); } catch (_) { }

  function use(w, acct) {
    W.w = w; W.acct = acct; store.set('milk:wallet', w.name);
    $('#walletBtn').classList.add('on'); $('#walletLabel').textContent = short(acct.address);
    try { w.features['standard:events'] && w.features['standard:events'].on('change', ({ accounts }) => { if (accounts && W.w === w) { if (accounts.length) use(w, accounts[0]); else disconnect(); } }); } catch (e) { }
    loadPositions(); if (S.pool && S.pool.pool) openPool(S.pool.pool, true);
  }
  function disconnect() {
    try { W.w && W.w.features['standard:disconnect'] && W.w.features['standard:disconnect'].disconnect(); } catch (e) { }
    W.w = null; W.acct = null; store.set('milk:wallet', '');
    $('#walletBtn').classList.remove('on'); $('#walletLabel').textContent = 'Connect wallet';
    renderPositions(); if (S.pool) renderDrawer();
  }
  const mobile = /iphone|ipad|android/i.test(navigator.userAgent);
  function renderWallets() {
    const box = $('#wList');
    $('#wModal h3').textContent = W.w ? 'Your wallet' : 'Connect a wallet';
    if (W.w) {
      box.innerHTML = `<p>${esc(W.w.name)}<br><code>${esc(W.acct.address)}</code></p><button class="wopt" type="button" id="wCopy">Copy address</button><button class="wopt" type="button" id="wOut">Disconnect</button>`;
      $('#wCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(W.acct.address).then(() => toast('Address copied')); };
      $('#wOut').onclick = () => { disconnect(); $('#wModal').hidden = true; toast('Disconnected'); };
      return;
    }
    if (!W.list.length) {
      const here = encodeURIComponent(location.href), ref = encodeURIComponent(location.origin);
      box.innerHTML = mobile
        ? `<p>Open MILK inside your wallet app's browser:</p>
           <a class="wopt" href="https://phantom.app/ul/browse/${here}?ref=${ref}">Open in Phantom</a>
           <a class="wopt" href="https://solflare.com/ul/v1/browse/${here}?ref=${ref}">Open in Solflare</a>`
        : `<p>No Solana wallet found in this browser. Install one, then reload:</p>
           <a class="wopt" href="https://phantom.com/download" target="_blank" rel="noopener">Phantom</a>
           <a class="wopt" href="https://solflare.com/download" target="_blank" rel="noopener">Solflare</a>
           <a class="wopt" href="https://backpack.app/download" target="_blank" rel="noopener">Backpack</a>`;
      return;
    }
    box.innerHTML = W.list.map((w, i) => `<button class="wopt" data-i="${i}" type="button">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}${esc(w.name)}<small>Detected</small></button>`).join('');
  }
  function connect() { renderWallets(); $('#wModal').hidden = false; }
  $('#wList').addEventListener('click', async e => {
    const b = e.target.closest('button.wopt[data-i]'); if (!b) return;
    const w = W.list[+b.dataset.i];
    try {
      b.disabled = true;
      const r = await w.features['standard:connect'].connect();
      const acct = (r && r.accounts && r.accounts[0]) || (w.accounts && w.accounts[0]);
      if (!acct) throw new Error('No account shared');
      $('#wModal').hidden = true; use(w, acct); toast('Connected ' + short(acct.address));
    } catch (err) { toast(err && err.message ? err.message : 'Connection cancelled'); }
    finally { b.disabled = false; }
  });
  $('#walletBtn').addEventListener('click', connect);
  $('#wClose').addEventListener('click', () => { $('#wModal').hidden = true; });
  $('#wModal').addEventListener('click', e => { if (e.target.id === 'wModal') $('#wModal').hidden = true; });
  const needWallet = () => { if (!W.w) { connect(); return true; } return false; };

  async function waitFor(sig) {
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await new Promise(r => setTimeout(r, 1300));
      try {
        const s = await api('status?sig=' + sig);
        if (s.err) throw Object.assign(new Error('The transaction failed on-chain.'), { chain: s.err });
        if (s.status === 'confirmed' || s.status === 'finalized') return true;
      } catch (e) { if (e.chain) throw e; }
    }
    throw new Error('Not confirmed after 90 seconds. Check the link below before trying again.');
  }
  async function signSend(txs, step) {
    const f = W.w.features, chain = 'solana:mainnet', bytes = txs.map(t => fromB64(t.tx)), sigs = [];
    if (bytes.length === 1 && f['solana:signAndSendTransaction']) {
      step('sign');
      const [r] = await f['solana:signAndSendTransaction'].signAndSendTransaction({ account: W.acct, chain, transaction: bytes[0], options: { commitment: 'confirmed', preflightCommitment: 'processed', maxRetries: 3 } });
      const sig = typeof r.signature === 'string' ? r.signature : b58(r.signature); sigs.push(sig);
      step('confirm', sigs); await waitFor(sig); return sigs;
    }
    if (f['solana:signTransaction']) {
      step('sign');
      const outs = await f['solana:signTransaction'].signTransaction(...bytes.map(t => ({ account: W.acct, chain, transaction: t })));
      for (let i = 0; i < outs.length; i++) {
        step('confirm', sigs, i);
        const { sig } = await api('send', { tx: toB64(outs[i].signedTransaction) }); sigs.push(sig);
        step('confirm', sigs, i); await waitFor(sig);
      }
      return sigs;
    }
    for (let i = 0; i < bytes.length; i++) {
      step('sign', sigs, i);
      const [r] = await f['solana:signAndSendTransaction'].signAndSendTransaction({ account: W.acct, chain, transaction: bytes[i] });
      const sig = typeof r.signature === 'string' ? r.signature : b58(r.signature); sigs.push(sig);
      step('confirm', sigs, i); await waitFor(sig);
    }
    return sigs;
  }

  /* ---------- pools ---------- */
  const KEY = { milk: p => p.milkPerSolDay, tvl: p => p.tvlSol, vol: p => p.volSol, fee: p => p.lpBps * 1e6 + p.milkPerSolDay, chg: p => p.change24 };
  function visible() {
    const q = S.q.trim().toLowerCase();
    return S.pools.filter(p => p.tvlSol >= S.min && (!q || (p.name + ' ' + p.symbol + ' ' + p.mint).toLowerCase().includes(q))).sort((x, y) => KEY[S.sort](y) - KEY[S.sort](x));
  }
  function renderPools() {
    const rows = $('#rows'); const list = visible();
    if (!list.length) {
      rows.innerHTML = `<div class="empty">${COW}<b>${S.q ? 'No pool on the board matches that.' : 'No pools this size right now.'}</b>${S.q ? 'Paste the coin address in the search at the top to look it up on-chain.' : 'Try a smaller pool size.'}</div>`;
      return;
    }
    const top = Math.max(...list.map(p => p.milkPerSolDay), 1e-9);
    rows.innerHTML = list.map((p, i) => `
      <div class="tr row" data-pool="${esc(p.pool)}" style="animation-delay:${Math.min(i, 14) * 20}ms">
        <span class="c-cow">${tokImg(p)}<span class="nm"><b>${esc(p.name || short(p.mint))}${p.tvlSol < 25 ? '<span class="tiny">small</span>' : ''}</b><small>${label(p)} · ${compact(p.mcapSol)} SOL mcap${p.created ? ' · ' + age(p.created) : ''}</small></span></span>
        <span class="c-milk"><span class="big">${pctTxt(p.milkPerSolDay)}</span><span class="mbar"><i style="width:${Math.max(3, Math.round(p.milkPerSolDay / top * 100))}%"></i></span></span>
        <span class="c-tvl num">${compact(p.tvlSol)} SOL</span>
        <span class="c-vol num">${compact(p.volSol)} SOL</span>
        <span class="c-fee num">${(p.lpBps / 100).toFixed(2)}%</span>
        <span class="c-chg num ${p.change24 >= 0 ? 'up' : 'down'}">${p.change24 >= 0 ? '+' : ''}${(+p.change24).toFixed(1)}%</span>
        <span class="c-go"><button class="btn sm blue" type="button">Milk</button></span>
      </div>`).join('');
  }
  function renderStats() {
    const P = S.pools; if (!P.length) return;
    const tvl = P.reduce((a, p) => a + p.tvlSol, 0), vol = P.reduce((a, p) => a + p.volSol, 0), fees = P.reduce((a, p) => a + p.volSol * p.lpBps / 10000, 0);
    const set = (k, v) => { const el = $(`#stats b[data-k="${k}"]`); if (el) el.innerHTML = v; };
    set('n', P.length); set('tvl', compact(tvl) + '<small>SOL</small>'); set('vol', compact(vol) + '<small>SOL</small>'); set('fees', compact(fees) + '<small>SOL</small>');
  }
  function renderTopCow() {
    const box = $('#topCow .hc-body');
    const pool = S.pools.filter(p => p.tvlSol >= 50).sort((a, b) => b.milkPerSolDay - a.milkPerSolDay);
    const list = pool.length ? pool : S.pools.slice().sort((a, b) => b.milkPerSolDay - a.milkPerSolDay);
    if (!list.length) { box.innerHTML = `<div class="empty" style="padding:24px 0">${COW}<b>The market is quiet.</b></div>`; return; }
    const p = list[0], next = list.slice(1, 4), max = Math.max(...list.slice(0, 4).map(x => x.milkPerSolDay));
    box.innerHTML = `
      <div class="hc-top">${tokImg(p)}<div><b>${esc(p.name || short(p.mint))}</b><small>${label(p)} · ${compact(p.mcapSol)} SOL mcap</small></div></div>
      <div class="hc-big">${pctTxt(p.milkPerSolDay)}<small>a day</small></div>
      <div class="hc-sub">1 SOL added would have made about <b>${fsol(p.milkPerSolDay)} SOL</b> in fees over the last 24h.</div>
      <div class="hc-meta"><div><span>Pool size</span><b>${compact(p.tvlSol)} SOL</b></div><div><span>24h volume</span><b>${compact(p.volSol)} SOL</b></div></div>
      <div class="hc-next"><p>Next in the herd</p>${next.map(x => `<button type="button" data-pool="${esc(x.pool)}"><b>${esc(x.name || short(x.mint))}</b><span class="mbar"><i style="width:${Math.max(4, Math.round(x.milkPerSolDay / max * 100))}%"></i></span><em>${pctTxt(x.milkPerSolDay, 1)}</em></button>`).join('')}</div>
      <button class="btn px blue hc-go" type="button" data-pool="${esc(p.pool)}">Milk this cow</button>`;
  }
  $('#topCow').addEventListener('click', e => { const b = e.target.closest('[data-pool]'); if (b) openPool(b.dataset.pool); });
  function tickUpdated() {
    const el = $('#updated span'); if (!S.updated) return;
    const s = Math.round((Date.now() - S.updated) / 1000);
    el.textContent = 'Live · updated ' + (s < 5 ? 'just now' : s < 60 ? s + 's ago' : Math.round(s / 60) + 'm ago');
  }
  setInterval(tickUpdated, 1000);
  async function loadPools(quiet) {
    if (!quiet) $('#rows').innerHTML = '<div class="skel"></div>'.repeat(6);
    try {
      const j = await api('pools');
      S.pools = j.pools || []; S.updated = j.updated || Date.now();
      renderPools(); renderStats(); renderTopCow(); renderTicker(); calcPools(); tickUpdated();
    } catch (e) {
      if (quiet) return;
      $('#rows').innerHTML = `<div class="empty">${COW}<b>Could not reach the market.</b><button class="btn sm" id="retry" type="button" style="margin-top:10px">Retry</button></div>`;
      $('#retry').onclick = () => loadPools();
      $('#updated span').textContent = 'Offline';
    }
  }
  setInterval(() => { if (!document.hidden && !S.busy) loadPools(true); }, 60000);
  $('#rows').addEventListener('click', e => { const r = e.target.closest('.row'); if (r) openPool(r.dataset.pool); });
  $('#th').addEventListener('click', e => { const b = e.target.closest('.sort'); if (!b) return; S.sort = b.dataset.s; $$('#th .sort').forEach(x => x.classList.toggle('on', x === b)); renderPools(); });
  $('#size').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.min = +b.dataset.m; $$('#size button').forEach(x => x.classList.toggle('on', x === b)); renderPools(); });
  $('#q').addEventListener('input', e => { S.q = e.target.value; renderPools(); });
  $('#find').addEventListener('submit', e => {
    e.preventDefault(); const v = $('#findIn').value.trim(); if (!v) return;
    if (isAddr(v)) { openPool(v); return; }
    S.q = v; $('#q').value = v; S.min = 0; $$('#size button').forEach(x => x.classList.toggle('on', x.dataset.m === '0')); renderPools();
    document.getElementById('pools').scrollIntoView({ behavior: 'smooth' });
  });

  /* ---------- the drawer ---------- */
  function openDrawer() { $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#veil').hidden = false; document.documentElement.style.overflow = 'hidden'; }
  function closeDrawer() { if (S.busy) return; $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#veil').hidden = true; document.documentElement.style.overflow = ''; S.pool = null; }
  $('#dClose').addEventListener('click', closeDrawer); $('#veil').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#wModal').hidden) $('#wModal').hidden = true; else if (S.pool) closeDrawer(); } });

  async function openPool(id, quiet, tab, amt) {
    if (!quiet) { S.pool = { pool: id, loading: true }; S.tab = tab || 'add'; S.amt = amt || ''; renderDrawer(); openDrawer(); }
    try {
      const j = await api('pool?id=' + encodeURIComponent(id) + (W.acct ? '&user=' + W.acct.address : ''));
      if (S.pool && (S.pool.pool === id || S.pool.mint === id || S.pool.pool === j.pool.pool || quiet)) { S.pool = j.pool; renderDrawer(); }
    } catch (e) {
      if (!quiet) { S.pool = { pool: id, error: e.message }; renderDrawer(); }
    }
  }
  function estimate(p, solIn) {
    try {
      const lamports = BigInt(Math.floor(solIn * 1e9)); if (lamports <= 0n) return null;
      const fee = BigInt(S.cfg.feeBps || 0); const jug = lamports * fee / 10000n; const budget = lamports - jug;
      const Rb = BigInt(p.reserves.coin), Rq = BigInt(p.reserves.solLamports), L = BigInt(p.lpSupply), vq = BigInt(p.reserves.vqr || '0');
      const f = p.feeBps, cd = (a, b) => (a + b - 1n) / b;
      const cost = b => { const q = cd((Rq + vq) * b, Rb - b); const g = bp => cd(q * BigInt(bp), 10000n); return { q, lf: g(f.lp), t: q + g(f.lp) + g(f.protocol) + g(f.creator) }; };
      let lo = 0n, hi = Rb / 2n;
      for (let i = 0; i < 90 && hi - lo > 1n; i++) { const m = (lo + hi) / 2n, c = cost(m); if (c.t >= budget) { hi = m; continue; } const D = budget - c.t; if (m * (Rq + c.q + c.lf) < D * (Rb - m)) lo = m; else hi = m; }
      const c = cost(lo), D = budget - c.t, Rq2 = Rq + c.q + c.lf, Rb2 = Rb - lo;
      let lp = lo * L / Rb2; const lq = D * L / Rq2; if (lq < lp) lp = lq;
      const share = Number(lp) / Number(L + lp);
      const value = share * 2 * Number(Rq2 + D) / 1e9;
      return { jug: Number(jug) / 1e9, swap: Number(c.t) / 1e9, coin: Number(lo), dep: Number(D) / 1e9, share, value, milkDay: share * p.volSol * p.lpBps / 10000 };
    } catch (e) { return null; }
  }
  function renderDrawer() {
    const p = S.pool, el = $('#dIn'); if (!p) return;
    if (p.loading) { el.innerHTML = `<div class="d-top"><span class="tok"></span><div><h3>Finding the pool…</h3><small><span class="loader"></span>Reading PumpSwap on-chain</small></div></div><div class="skel" style="margin-top:20px;border-radius:12px"></div>`; return; }
    if (p.error) { el.innerHTML = `<div class="empty">${COW}<b>${esc(p.error)}</b><button class="btn sm" type="button" id="dBack">Back to the pools</button></div>`; $('#dBack').onclick = closeDrawer; return; }
    const sym = p.symbol ? '$' + p.symbol : 'the coin';
    const you = p.you, hasPos = you && BigInt(you.lp || '0') > 0n;
    const f = p.feeBps || { lp: p.lpBps, protocol: 0, creator: 0 };
    el.innerHTML = `
      <div class="d-top">${tokImg(p)}<div><h3>${esc(p.name || short(p.mint))}</h3>
        <small>${p.symbol ? esc('$' + p.symbol) + ' · ' : ''}<a href="https://solscan.io/account/${esc(p.pool)}" target="_blank" rel="noopener">pool ${short(p.pool)}</a> · <a href="https://dexscreener.com/solana/${esc(p.pool)}" target="_blank" rel="noopener">chart</a></small></div></div>
      <div class="kv">
        <div><span>Milk / day</span><b>${p.volSol ? pctTxt(p.milkPerSolDay) : '—'}</b></div>
        <div><span>Pool size</span><b>${compact(p.tvlSol)} SOL</b></div>
        <div><span>24h volume</span><b>${p.volSol ? compact(p.volSol) + ' SOL' : '—'}</b></div>
        <div><span>Market cap</span><b>${compact(p.mcapSol)} SOL</b></div>
      </div>
      <p class="feeline">Each trade pays ${((f.lp + f.protocol + f.creator) / 100).toFixed(2)}%: <b>${(f.lp / 100).toFixed(2)}% to the pool's LPs</b>, ${(f.protocol / 100).toFixed(2)}% to PumpSwap, ${(f.creator / 100).toFixed(2)}% to the coin's creator.</p>
      ${hasPos ? `<div class="you">Your position: <b>${fsol(you.valueSol)} SOL</b> · ${pctTxt(you.share, 3)} of the pool · about ${fsol(you.share * p.volSol * p.lpBps / 10000)} SOL a day</div>` : ''}
      ${!p.solPool ? `<div class="status show err">This pool is not paired with SOL. MILK handles SOL pools only for now.</div>` : `
      <div class="tabs"><button type="button" data-t="add" class="${S.tab === 'add' ? 'on' : ''}">Add</button><button type="button" data-t="remove" class="${S.tab === 'remove' ? 'on' : ''}">Withdraw</button></div>
      <div id="pane"></div>`}
      <div class="status" id="st"></div>`;
    $$('.tabs button', el).forEach(b => b.onclick = () => { if (S.busy) return; S.tab = b.dataset.t; renderDrawer(); });
    if (p.solPool) S.tab === 'add' ? paneAdd(p, sym) : paneRemove(p, sym);
  }
  function paneAdd(p, sym) {
    const bal = p.you ? p.you.sol : null;
    $('#pane').innerHTML = `
      <div class="field"><div class="row1"><span>You put in</span>${bal != null ? `<button type="button" id="max">Balance ${fsol(bal)} SOL</button>` : ''}</div>
        <div class="row2"><input id="amt" inputmode="decimal" placeholder="0.0" aria-label="SOL amount" value="${esc(S.amt)}"><span class="unit">SOL</span></div></div>
      <div class="chips" id="quick">${[0.1, 0.5, 1, 5].map(v => `<button class="chip" type="button" data-v="${v}">${v} SOL</button>`).join('')}</div>
      <div class="slip"><span>Max price move</span><div class="chips" id="slip">${[1, 2, 5].map(v => `<button class="chip ${S.slip === v ? 'on' : ''}" type="button" data-v="${v}">${v}%</button>`).join('')}</div></div>
      <div class="prev" id="prev"></div>
      <div class="sim" id="sim" hidden></div>
      <button class="btn px blue go" id="goAdd" type="button">${W.w ? 'Milk it' : 'Connect wallet'}</button>
      <p class="fine">Your wallet signs. LP tokens go to your wallet.</p>`;
    const amt = $('#amt');
    const upd = () => {
      S.amt = amt.value;
      const v = parseFloat(amt.value.replace(',', '.'));
      const e = v > 0 ? estimate(p, v) : null;
      const dec = p.decimals || 6;
      $('#prev').innerHTML = e ? `
        ${e.jug ? `<div><span>To the jug (${(S.cfg.feeBps / 100).toFixed(1)}%)</span><b>${fsol(e.jug, 4)} SOL</b></div>` : ''}
        <div><span>Swapped for ${esc(sym)}</span><b>${fsol(e.swap)} SOL → ${compact(e.coin / Math.pow(10, dec))}</b></div>
        <div><span>Added to the pool</span><b>${fsol(e.dep)} SOL + ${compact(e.coin / Math.pow(10, dec))}</b></div>
        <div><span>Your share of the pool</span><b>${pctTxt(e.share, 3)}</b></div>
        <div class="hi"><span>Milk at the last 24h pace</span><b>${p.volSol ? '≈ ' + fsol(e.milkDay) + ' SOL / day' : '—'}</b></div>` : '';
      const sim = $('#sim');
      if (!e) { sim.hidden = true; return; }
      const V = e.value;
      const rowsHtml = [[-75, 0.25], [-50, 0.5], [100, 2], [300, 4]].map(([pc, r]) => {
        const lp = V * Math.sqrt(r), d = lp / v - 1;
        return `<tr><td>${esc(sym)} ${pc > 0 ? '+' : ''}${pc}%</td><td>${fsol(lp)} SOL</td><td class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)}%</td></tr>`;
      }).join('');
      sim.hidden = false;
      sim.innerHTML = `<p><b>If the price moves</b> before you withdraw, your position changes like this, before any fees earned:</p><table><tr><th>Price move</th><th>Position</th><th>vs. ${fsol(v)} SOL in</th></tr>${rowsHtml}</table>`;
    };
    amt.addEventListener('input', upd); upd();
    $('#quick').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; amt.value = b.dataset.v; upd(); };
    $('#slip').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; S.slip = +b.dataset.v; $$('#slip .chip').forEach(x => x.classList.toggle('on', x === b)); };
    const mx = $('#max'); if (mx) mx.onclick = () => { amt.value = Math.max(0, bal - 0.012).toFixed(3); upd(); };
    $('#goAdd').onclick = async () => {
      if (needWallet()) return;
      const v = parseFloat(amt.value.replace(',', '.'));
      if (!(v >= 0.01)) { toast('Enter at least 0.01 SOL'); amt.focus(); return; }
      await run('add', { kind: 'add', pool: p.pool, user: W.acct.address, sol: v, slippage: S.slip }, q => `Adds ${fsol(q.depositSol)} SOL + ${compact(coinAmt(q.depositCoin, q.decimals))} ${esc(sym)} · ${pctTxt(q.share, 3)} of the pool`);
    };
  }
  function paneRemove(p, sym) {
    const you = p.you, has = you && BigInt(you.lp || '0') > 0n;
    if (!W.w || !has) {
      $('#pane').innerHTML = `<div class="empty" style="padding:24px 8px">${W.w ? `<b>No liquidity here yet.</b>Add some first, then come back to withdraw.` : `<b>Connect to see your position.</b><button class="btn sm blue" id="cw" type="button" style="margin-top:10px">Connect wallet</button>`}</div>`;
      const cw = $('#cw'); if (cw) cw.onclick = connect; return;
    }
    $('#pane').innerHTML = `
      <div class="chips" id="pcts">${[25, 50, 75, 100].map(v => `<button class="chip ${S.pct === v ? 'on' : ''}" type="button" data-v="${v}">${v}%</button>`).join('')}</div>
      <label class="toggle"><span>Get it all back as SOL</span><span class="sw"><input type="checkbox" id="toSol" ${S.toSol ? 'checked' : ''}><i></i></span></label>
      <div class="slip"><span>Max price move</span><div class="chips" id="slip">${[1, 2, 5].map(v => `<button class="chip ${S.slip === v ? 'on' : ''}" type="button" data-v="${v}">${v}%</button>`).join('')}</div></div>
      <div class="prev" id="prev"></div>
      <button class="btn px go" id="goRm" type="button" style="margin-top:12px">Withdraw</button>
      <p class="fine">Withdrawals are free. Network fees only.</p>`;
    const upd = () => {
      const fr = S.pct / 100, dec = p.decimals || 6;
      const coin = coinAmt(you.coinInPool, dec) * fr, solv = you.solInPool * fr;
      $('#prev').innerHTML = S.toSol
        ? `<div><span>From the pool</span><b>${fsol(solv)} SOL + ${compact(coin)} ${esc(sym)}</b></div><div class="hi"><span>You get about</span><b>${fsol(solv * 2 * (1 - p.totalBps / 10000))} SOL</b></div>`
        : `<div class="hi"><span>You get about</span><b>${fsol(solv)} SOL + ${compact(coin)}</b></div>`;
    };
    upd();
    $('#pcts').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; S.pct = +b.dataset.v; $$('#pcts .chip').forEach(x => x.classList.toggle('on', x === b)); upd(); };
    $('#toSol').onchange = e => { S.toSol = e.target.checked; upd(); };
    $('#slip').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; S.slip = +b.dataset.v; $$('#slip .chip').forEach(x => x.classList.toggle('on', x === b)); };
    $('#goRm').onclick = () => run('remove', { kind: 'remove', pool: p.pool, user: W.acct.address, pct: S.pct, toSol: S.toSol, slippage: S.slip }, q => q.toSol ? `Withdraws ${q.pct}% and sells the coin side: about ${fsol(q.solOut + q.sellSol)} SOL` : `Withdraws ${q.pct}%: about ${fsol(q.solOut)} SOL + ${compact(coinAmt(q.coinOut, q.decimals))} ${esc(sym)}`);
  }
  async function run(kind, body, describe) {
    if (S.busy) return; S.busy = true;
    const st = $('#st'); const btn = $(kind === 'add' ? '#goAdd' : '#goRm'); if (btn) btn.disabled = true;
    const steps = ['Build and simulate the transaction', 'Approve in your wallet', 'Confirm on Solana'];
    let line = '', sigs = [], idx = 0, total = 1;
    const draw = (cur, err) => {
      st.className = 'status show ' + (err ? 'err' : cur >= 3 ? 'ok' : 'wait');
      const links = sigs.map((s, i) => `<a href="https://solscan.io/tx/${s}" target="_blank" rel="noopener">${total > 1 ? 'Step ' + (i + 1) + ' on Solscan' : 'View on Solscan'}</a>`).join(' · ');
      st.innerHTML = (err ? `<b>${esc(err.message || err)}</b>${err.logs ? `<pre>${esc(err.logs.join('\n'))}</pre>` : ''}` : cur >= 3 ? `<b>Done. ${kind === 'add' ? 'The cow is yours to milk.' : 'Withdrawn to your wallet.'}</b>` : `<b><span class="loader"></span>${esc(line || 'Working…')}</b>`)
        + (!err && cur < 3 ? `<ol>${steps.map((t, i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}">${i < cur ? '✓ ' : ''}${t}${i === 2 && total > 1 ? ` (${Math.min(idx + 1, total)} of ${total})` : ''}</li>`).join('')}</ol>` : '')
        + (links ? `<div style="margin-top:8px">${links}</div>` : '');
    };
    try {
      line = 'Checking the pool and simulating…'; draw(0);
      const r = await api('tx', body);
      total = r.txs.length; line = describe(r.quote) + (total > 1 ? ' · two signatures' : ''); draw(1);
      await signSend(r.txs, (what, s, i) => { if (s) sigs = s.slice(); if (i != null) idx = i; draw(what === 'sign' ? 1 : 2); });
      draw(3); toast(kind === 'add' ? 'Milked.' : 'Withdrawn.');
      setTimeout(() => { if (S.pool && S.pool.pool) openPool(S.pool.pool, true); loadPositions(); }, 1500);
    } catch (e) {
      const msg = /reject|denied|cancel/i.test(e && e.message || '') ? new Error('You cancelled in the wallet. Nothing was sent.') : e;
      draw(0, msg);
    } finally { S.busy = false; if (btn) btn.disabled = false; }
  }

  /* ---------- positions ---------- */
  function renderPositions() {
    const box = $('#pos'); $('#refreshPos').hidden = !W.w;
    if (!W.w) { box.innerHTML = `<div class="connect-card wide"><div class="bottle-ico">${BOTTLE}</div><div><h3>Every position you hold, in one place</h3><p>Connect a wallet to see each PumpSwap pool it is in, what the position is worth, and what it earns a day. Positions added on pump.fun show up too.</p></div><button class="btn px blue" id="cw2" type="button">Connect wallet</button></div>`; $('#cw2').onclick = connect; return; }
    if (S.positions == null) { box.innerHTML = '<div class="skel" style="border-radius:16px;border:0"></div>'; return; }
    if (S.positions.error) { box.innerHTML = `<div class="connect-card"><p>${esc(S.positions.error)}</p><button class="btn sm" id="rp" type="button">Retry</button></div>`; $('#rp').onclick = loadPositions; return; }
    if (!S.positions.length) { box.innerHTML = `<div class="connect-card">${COW}<p>No cows yet. Pick one from the herd and add from SOL.</p><a class="btn px blue" href="#pools">See the pools</a></div>`; return; }
    const tot = S.positions.reduce((a, p) => a + p.valueSol, 0), day = S.positions.reduce((a, p) => a + (p.milkDaySol || 0), 0);
    box.innerHTML = `<div class="pos-grid">
      <div class="pcard" style="background:#f4f6ff;border-color:#d6defd"><span class="c-cow"><span class="nm"><b>All positions</b><small>${S.positions.length} pool${S.positions.length > 1 ? 's' : ''}</small></span></span><span><span class="lbl">Value</span><span class="val">${fsol(tot)} SOL</span></span><span><span class="lbl">Milk / day</span><span class="val">≈ ${fsol(day)}</span></span><span></span><span></span></div>
      ${S.positions.map(p => `
      <div class="pcard"><span class="c-cow">${tokImg(p)}<span class="nm"><b>${esc(p.name || short(p.mint))}</b><small>${label(p)}</small></span></span>
        <span><span class="lbl">Value</span><span class="val">${fsol(p.valueSol)} SOL</span></span>
        <span><span class="lbl">Share</span><span class="val">${pctTxt(p.share, 3)}</span></span>
        <span><span class="lbl">Milk / day</span><span class="val">${p.volSol ? '≈ ' + fsol(p.milkDaySol) : '—'}</span></span>
        <span class="acts"><button class="btn sm" data-a="add" data-pool="${esc(p.pool)}" type="button">Add</button><button class="btn sm blue" data-a="remove" data-pool="${esc(p.pool)}" type="button">Withdraw</button></span></div>`).join('')}</div>`;
  }
  $('#pos').addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (!b) return; openPool(b.dataset.pool, false, b.dataset.a); });
  $('#refreshPos').addEventListener('click', loadPositions);
  async function loadPositions() {
    if (!W.w) return renderPositions();
    S.positions = null; renderPositions();
    try { const j = await api('positions?user=' + W.acct.address); S.positions = j.positions; }
    catch (e) { S.positions = { error: e.message }; }
    renderPositions();
  }


  /* ---------- polish-1: ticker, calculator, machine ---------- */
  const BOTTLE = `<svg viewBox="0 0 16 22" shape-rendering="crispEdges" aria-hidden="true"><path fill="#241e1b" d="M5 0h6v1H5zM4 1h1v3H4zM11 1h1v3h-1zM5 4h6v1H5zM5 5h1v2H5zM10 5h1v2h-1zM4 7h1v1H4zM11 7h1v1h-1zM3 8h1v13H3zM12 8h1v13h-1zM4 21h8v1H4z"/><path fill="#2354f0" d="M5 1h6v3H5z"/><path fill="#dfe6f7" d="M6 5h4v2H6zM5 7h6v1H5zM4 8h8v13H4z"/><rect class="milkfill" x="4" y="10" width="8" height="11" fill="#fffdf6"/><path fill="#ffffff" d="M5 9h1v5H5z" opacity=".8"/></svg>`;
  function renderTicker() {
    const list = S.pools.filter(p => p.tvlSol >= 25).sort((a, b) => b.milkPerSolDay - a.milkPerSolDay).slice(0, 18);
    if (!list.length) return;
    const one = list.map(p => `<span class="tk-item" data-pool="${esc(p.pool)}"><i></i><b>${esc(p.symbol ? '$' + p.symbol : short(p.mint))}</b><em>${pctTxt(p.milkPerSolDay, 1)}</em>a day · ${compact(p.tvlSol)} SOL pool</span>`).join('');
    $('#ticker').innerHTML = one + one; $('#tickerBox').hidden = false;
  }
  $('#ticker').addEventListener('click', e => { const t = e.target.closest('[data-pool]'); if (t) openPool(t.dataset.pool); });

  const C = { list: [], p: null, amt: 1 };
  function calcPools() {
    C.list = S.pools.filter(p => p.tvlSol >= 25).sort((a, b) => b.milkPerSolDay - a.milkPerSolDay).slice(0, 30);
    if (!C.list.length) C.list = S.pools.slice(0, 30);
    if (!C.p || !C.list.some(p => p.pool === C.p.pool)) C.p = C.list[0] || null;
    else C.p = C.list.find(p => p.pool === C.p.pool);
    $('#cList').innerHTML = C.list.map(p => `<button type="button" role="option" data-pool="${esc(p.pool)}" class="${C.p && p.pool === C.p.pool ? 'on' : ''}">${tokImg(p)}<b>${esc(p.name || short(p.mint))}</b><em>${pctTxt(p.milkPerSolDay, 1)}</em></button>`).join('');
    calcRender();
  }
  function calcRender() {
    const p = C.p, v = C.amt;
    $('#cCur').innerHTML = p ? `${tokImg(p)}<span class="t">${esc(p.name || short(p.mint))}<small>${label(p)} · ${compact(p.tvlSol)} SOL pool · ${pctTxt(p.milkPerSolDay, 1)} a day</small></span>` : 'No pools loaded';
    const set = (id, t) => { $(id).textContent = t; };
    if (!p || !(v > 0)) { ['#cDay', '#cWeek', '#cMonth', '#cShare'].forEach(id => set(id, '—')); $('#cSim').innerHTML = ''; return; }
    const dep = v * (1 - (S.cfg.feeBps || 0) / 1e4) * (1 - p.totalBps / 2e4);
    const share = dep / (p.tvlSol + dep), day = share * p.volSol * p.lpBps / 1e4;
    set('#cDay', fsol(day)); set('#cWeek', fsol(day * 7) + ' SOL'); set('#cMonth', fsol(day * 30) + ' SOL'); set('#cShare', pctTxt(share, 3));
    const sym = p.symbol ? '$' + p.symbol : 'the coin';
    $('#cSim').innerHTML = `<p><b>If the price moves</b>, your ${fsol(v)} SOL position is worth this, before fees earned:</p><table><tr><th>${esc(sym)}</th><th>Position</th><th>Change</th></tr>${[[-75, .25], [-50, .5], [100, 2], [300, 4]].map(([pc, r]) => { const lp = dep * Math.sqrt(r), d = lp / v - 1; return `<tr><td>${pc > 0 ? '+' : ''}${pc}%</td><td>${fsol(lp)} SOL</td><td class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)}%</td></tr>`; }).join('')}</table>`;
  }
  const pickClose = () => { $('#cList').hidden = true; $('#cPick').classList.remove('open'); };
  $('#cPickBtn').addEventListener('click', e => { e.stopPropagation(); const open = $('#cList').hidden; $('#cList').hidden = !open; $('#cPick').classList.toggle('open', open); });
  $('#cList').addEventListener('click', e => { const b = e.target.closest('[data-pool]'); if (!b) return; C.p = C.list.find(p => p.pool === b.dataset.pool); $$('#cList button').forEach(x => x.classList.toggle('on', x === b)); pickClose(); calcRender(); });
  document.addEventListener('click', e => { if (!e.target.closest('#cPick')) pickClose(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') pickClose(); });
  $('#cAmts').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; C.amt = +b.dataset.v; $('#cAmt').value = ''; $$('#cAmts .chip').forEach(x => x.classList.toggle('on', x === b)); calcRender(); });
  $('#cAmt').addEventListener('input', e => { const v = parseFloat(e.target.value.replace(',', '.')); if (v > 0) { C.amt = v; $$('#cAmts .chip').forEach(x => x.classList.remove('on')); } calcRender(); });
  $('#cGo').addEventListener('click', () => { if (C.p) openPool(C.p.pool, false, 'add', String(C.amt)); });
  $('#mCow').innerHTML = COW; $('#mBottle').innerHTML = BOTTLE; $('#faqCow').innerHTML = COW;

  /* ---------- config, nav, icons, wave ---------- */
  async function loadConfig() {
    try {
      S.cfg = await api('config');
      if (S.cfg.ca) {
        $('#caFaq').innerHTML = `Yes. The only official $MILK address is <code>${esc(S.cfg.ca)}</code><button class="copy" type="button" id="cpy">Copy</button>. Anything else is not ours.`;
        $('#cpy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(S.cfg.ca).then(() => toast('Address copied')); };
      }
      if (S.cfg.feeBps) $('#feeFaq').innerHTML = `${(S.cfg.feeBps / 100).toFixed(1)}% of each add goes to the MILK jug${S.cfg.jug ? ` (<code>${esc(S.cfg.jug)}</code>)` : ''}. Withdrawals are free. You also pay Solana network fees and a small, refundable rent for new token accounts.`;
    } catch (e) { S.cfg = { feeBps: 0 }; }
  }
  const nav = $('#nav'), hero = $('#top');
  const onScroll = () => {
    nav.classList.toggle('top', window.scrollY < hero.offsetHeight - 70);
    let cur = null; for (const a of $$('#links a')) { const s = document.getElementById(a.getAttribute('href').slice(1)); if (s && s.getBoundingClientRect().top < 160) cur = a; }
    $$('#links a').forEach(a => a.classList.toggle('on', a === cur));
  };
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const PAL = { K: '#241e1b', W: '#fffdf6', B: '#2a2628', P: '#f6a6ac', Y: '#ffce3a', U: '#2354f0', H: '#f0e0b6' };
  const ICONS = {
    split: ['................', '.....KKKKKK.....', '....KYYYYYYK....', '...KYYKKKKYYK...', '...KYKYYYYYYK...', '...KYYKKKKYYK...', '...KYYYYYYKYK...', '...KYYKKKKYYK...', '....KYYYYYYK....', '.....KKKKKK.....', '......K..K......', '.....K....K.....', '..KKKK....KKKK..', '.KUUUUK..KWWWWK.', '.KUUUUK..KWBWWK.', '..KKKK....KKKK..'],
    bottle: ['.....KKKKKK.....', '.....KUUUUK.....', '.....KKKKKK.....', '......KWWK......', '.....KWWWWK.....', '....KWWWWWWK....', '...KWWWWWWWWK...', '...KUUUUUUUUK...', '...KUWWUUWWUK...', '...KUWUUUUWUK...', '...KUWWUUWWUK...', '...KUUUUUUUUK...', '...KWWWWWWWWK...', '...KWWWWWWWWK...', '....KKKKKKKK....', '................'],
  };
  $$('.ico').forEach(el => {
    if (el.dataset.icon === 'cow') { el.innerHTML = COW; return; }
    const g = ICONS[el.dataset.icon]; if (!g) return; const by = {};
    g.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') (by[c] = by[c] || []).push(`M${x} ${y}h1v1h-1z`); }));
    el.innerHTML = `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${Object.keys(by).map(c => `<path fill="${PAL[c] || '#000'}" d="${by[c].join('')}"/>`).join('')}</svg>`;
  });

  // the milk line under the hero: a stepped pixel wave that never stops
  const cv = $('#wave'), cx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0, last = 0, running = true;
  function sizeWave() { const r = cv.getBoundingClientRect(); cv.width = Math.ceil(r.width / 8); cv.height = Math.ceil(r.height / 8); }
  function drawWave(ts) {
    if (running && ts - last > 60) {
      last = ts; t += 0.05;
      const w = cv.width, h = cv.height; cx.clearRect(0, 0, w, h);
      const yAt = x => Math.round(h * 0.46 + Math.sin(x * 0.075 + t) * 1.5 + Math.sin(x * 0.026 - t * 0.55) * 1.8);
      cx.fillStyle = '#f7f6f2';
      for (let x = 0; x < w; x++) { const y = yAt(x); cx.fillRect(x, y, 1, h - y); }
      cx.fillStyle = '#ffffff';
      for (let x = 0; x < w; x++) if ((x + Math.floor(t * 2)) % 11 === 0) cx.fillRect(x, yAt(x), 1, 1);
    }
    if (!reduce) requestAnimationFrame(drawWave);
  }
  sizeWave(); addEventListener('resize', sizeWave); requestAnimationFrame(drawWave); if (reduce) drawWave(999);
  document.addEventListener('visibilitychange', () => { running = !document.hidden; });

  const qp = new URLSearchParams(location.search).get('pool') || (isAddr(location.hash.slice(1)) ? location.hash.slice(1) : '');
  loadConfig().then(() => { loadPools(); renderPositions(); if (qp) openPool(qp); });
})();
