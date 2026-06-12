/* ============================================================
   ShroobCoin Clicker — game.js
   An incremental game for the 4DickDestroyer Discord server.

   Everything lives in one IIFE. Tuning knobs (prices, rates)
   are all in the DATA section at the top.
   ============================================================ */

(() => {
  'use strict';

  /* ============================== DATA ============================== */

  const PRICE_GROWTH = 1.15;           // generator price multiplier per purchase
  const AUTOSAVE_MS = 15000;           // autosave interval
  const OFFLINE_CAP_MS = 24 * 3600 * 1000; // max offline time credited
  const SAVE_KEY = 'shroobcoin-save-v1';

  // Automatic generators (tiers 1–9). sps = ShroobCoins per second each.
  const GENERATORS = [
    { id: 'teammate',  name: 'League Ranked Teammate', icon: '⚔️',  sps: 0.1,     base: 10,        desc: "0/7/2 and it's somehow the jungler's fault." },
    { id: 'bard',      name: '96rekkilamgems Bard',    icon: '🎶',  sps: 1,       base: 100,       desc: 'Roams the whole map collecting chimes and coins.' },
    { id: 'valorant',  name: 'Valorant Player',        icon: '🔫',  sps: -10,     base: 500,       desc: 'Actively loses you money. A bold investment.', negative: true },
    { id: 'tahm',      name: 'Tahm Kench Botlane',     icon: '🐸',  sps: 10,      base: 2500,      desc: 'An unkillable river king with an appetite for SC.' },
    { id: 'joel',      name: 'Joel',                   icon: '🗿',  sps: 100,     base: 15000,     desc: "He's just Joel. He gets it done." },
    { id: 'tentsletje',name: 'Tentsletje',             icon: '⛺',  sps: 1000,    base: 100000,    desc: 'Camping equipment sold separately.' },
    { id: 'ginger',    name: 'Ginger Man',             icon: '🧑‍🦰', sps: 10000,   base: 750000,    desc: 'Powered by an unexplained source of energy.' },
    { id: 'emerald',   name: 'Emerald Player',         icon: '💚',  sps: 100000,  base: 5000000,   desc: 'Hardstuck, but the coins keep flowing.' },
    { id: 'egirl',     name: 'E-girl Support',         icon: '🎀',  sps: 1000000, base: 50000000,  desc: 'Heals your team. Drains your wallet. Worth it.' }
  ];

  // Tier 10 — the win condition.
  const FAKER = {
    id: 'faker',
    name: 'Faker',
    icon: '🐐',
    base: 500000000,
    desc: 'The GOAT himself. Purchase to win the game.'
  };

  // Clicking upgrades — each one permanently doubles SC per click.
  // Prices are spread across the whole game so clicking stays useful
  // without ever dominating passive income (per the balance brief).
  const CLICKERS = [
    { id: 'aids',     name: 'AIDS',         icon: '🧬', price: 100 },
    { id: 'cholera',  name: 'Cholera',      icon: '💧', price: 800 },
    { id: 'plague',   name: 'Plague',       icon: '🐀', price: 6500 },
    { id: 'tb',       name: 'Tuberculosis', icon: '🫁', price: 50000 },
    { id: 'smallpox', name: 'Smallpox',     icon: '🤒', price: 400000 },
    { id: 'malaria',  name: 'Malaria',      icon: '🦟', price: 3500000 },
    { id: 'ebola',    name: 'Ebola',        icon: '🦠', price: 25000000 }
  ];

  /* ============================== STATE ============================== */

  const defaultState = () => ({
    version: 1,
    balance: 0,
    totalEarned: 0,
    totalClicks: 0,
    totalSpent: 0,
    playtimeMs: 0,
    gens: GENERATORS.map(() => 0),
    clickers: CLICKERS.map(() => false),
    fakerOwned: false,
    won: false,
    freeze: false, // true only while the win screen forces a choice
    settings: { particles: true },
    startedAt: Date.now(),
    lastSave: Date.now()
  });

  let S = defaultState();
  let buyAmt = '1';          // '1' | '10' | 'max'
  let suppressSave = false;  // set during a wipe so autosave can't resurrect the save
  let lastSavedAt = 0;
  let pendingConfirm = null;

  /* ============================== STORAGE ============================== */

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }
  };

  const storageOK = (() => {
    try {
      const probe = '__shroob_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  })();

  /* ============================== FORMATTING ============================== */

  const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];

  function fmt(n) {
    if (!isFinite(n)) return '∞';
    const neg = n < 0 ? '-' : '';
    n = Math.abs(n);
    if (n < 1000) {
      const r = Math.round(n * 10) / 10;
      return neg + (Number.isInteger(r) ? r.toString() : r.toFixed(1));
    }
    const tier = Math.min(Math.floor(Math.log10(n) / 3), UNITS.length - 1);
    const m = n / Math.pow(10, tier * 3);
    const out = m.toFixed(m >= 100 ? 1 : 2).replace(/\.?0+$/, '');
    return neg + out + UNITS[tier];
  }

  function fmtTime(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const p = (x) => String(x).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}`;
  }

  function fmtDur(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  /* ============================== DERIVED VALUES ============================== */

  const clickPower = () => Math.pow(2, S.clickers.filter(Boolean).length);
  const netSps = () => GENERATORS.reduce((sum, g, i) => sum + g.sps * S.gens[i], 0);
  const totalUpgradesPurchased = () =>
    S.gens.reduce((a, b) => a + b, 0) + S.clickers.filter(Boolean).length + (S.fakerOwned ? 1 : 0);

  /* ============================== PRICING ============================== */

  const genPrice = (g, owned) => g.base * Math.pow(PRICE_GROWTH, owned);

  // Total cost of buying n generators in a row (geometric series).
  function bulkCost(g, owned, n) {
    const first = genPrice(g, owned);
    return first * (Math.pow(PRICE_GROWTH, n) - 1) / (PRICE_GROWTH - 1);
  }

  function maxAffordable(g, owned, bal) {
    const first = genPrice(g, owned);
    if (bal < first) return 0;
    let n = Math.floor(Math.log((bal * (PRICE_GROWTH - 1)) / first + 1) / Math.log(PRICE_GROWTH));
    while (n > 0 && bulkCost(g, owned, n) > bal) n--; // guard against float drift
    return Math.max(0, n);
  }

  /* ============================== DOM ============================== */

  const el = (id) => document.getElementById(id);

  const balanceEl = el('balance');
  const spsEl = el('sps');
  const clickPowerEl = el('clickPower');
  const clickersMultEl = el('clickersMult');
  const bigButton = el('bigButton');
  const floatLayer = el('floatLayer');
  const overlay = el('overlay');
  const modal = el('modal');
  const toasts = el('toasts');
  const saveStatusEl = el('saveStatus');

  // Cheap text updates: only touch the DOM when the string changed.
  function setText(node, str) {
    if (node.__last !== str) {
      node.__last = str;
      node.textContent = str;
    }
  }

  function setClass(node, cls, on) {
    if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
  }

  /* ============================== SHOP BUILDING ============================== */

  const genRefs = [];     // { card, ownedEl, metaEl, btn, btnN, btnP }
  const clickerRefs = []; // { card, btn, btnP, badge }
  let fakerRefs = null;   // { card, bar, label, btn, btnP, buyCol }

  function buildShop() {
    const genList = el('generatorsList');
    GENERATORS.forEach((g, i) => {
      const card = document.createElement('div');
      card.className = 'card' + (g.negative ? ' negative' : '');
      card.innerHTML = `
        <div class="icon" aria-hidden="true">${g.icon}</div>
        <div class="info">
          <div class="name">${g.name} <span class="owned-count">Owned: 0</span></div>
          <div class="desc">${g.desc}</div>
          <div class="meta"></div>
        </div>
        <div class="buy-col">
          <button class="buy" type="button">
            <span class="buy-n">Buy ×1</span>
            <span class="buy-price"></span>
          </button>
        </div>`;
      const btn = card.querySelector('.buy');
      btn.addEventListener('click', () => buyGenerator(i));
      genList.appendChild(card);
      genRefs.push({
        card,
        ownedEl: card.querySelector('.owned-count'),
        metaEl: card.querySelector('.meta'),
        btn,
        btnN: card.querySelector('.buy-n'),
        btnP: card.querySelector('.buy-price')
      });
    });

    // Faker — the golden win-condition card at the bottom of the list.
    const card = document.createElement('div');
    card.className = 'card faker';
    card.innerHTML = `
      <div class="icon" aria-hidden="true">${FAKER.icon}</div>
      <div class="info">
        <div class="name">${FAKER.name} <span class="win-tag">Win condition</span></div>
        <div class="desc">${FAKER.desc}</div>
        <div class="progress" aria-hidden="true"><span class="bar"></span></div>
        <div class="progress-label"></div>
      </div>
      <div class="buy-col">
        <button class="buy" type="button">
          <span class="buy-n">Claim victory</span>
          <span class="buy-price">${fmt(FAKER.base)} SC</span>
        </button>
      </div>`;
    const fBtn = card.querySelector('.buy');
    fBtn.addEventListener('click', buyFaker);
    genList.appendChild(card);
    fakerRefs = {
      card,
      bar: card.querySelector('.bar'),
      label: card.querySelector('.progress-label'),
      btn: fBtn,
      btnP: card.querySelector('.buy-price'),
      buyCol: card.querySelector('.buy-col')
    };

    // Clicking upgrades.
    const clickList = el('clickersList');
    CLICKERS.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="icon" aria-hidden="true">${c.icon}</div>
        <div class="info">
          <div class="name">${c.name}</div>
          <div class="desc">Doubles your SC per click.</div>
          <div class="meta">×2 SC/click</div>
        </div>
        <div class="buy-col">
          <button class="buy" type="button">
            <span class="buy-n">Buy</span>
            <span class="buy-price">${fmt(c.price)} SC</span>
          </button>
          <span class="owned-badge" hidden>✓ Owned</span>
        </div>`;
      const btn = card.querySelector('.buy');
      btn.addEventListener('click', () => buyClicker(i));
      clickList.appendChild(card);
      clickerRefs.push({
        card,
        btn,
        btnP: card.querySelector('.buy-price'),
        badge: card.querySelector('.owned-badge')
      });
    });
  }

  /* ============================== RENDER ============================== */

  function render() {
    // Header
    setText(balanceEl, fmt(Math.floor(S.balance)));
    const sps = netSps();
    setText(spsEl, `${fmt(sps)} SC/s`);
    setClass(spsEl, 'neg', sps < 0);
    setText(clickPowerEl, `${fmt(clickPower())} SC/click`);
    setText(clickersMultEl, `Current multiplier: ×${fmt(clickPower())}`);

    // Generators
    GENERATORS.forEach((g, i) => {
      const r = genRefs[i];
      const owned = S.gens[i];
      const maxN = buyAmt === 'max' ? maxAffordable(g, owned, S.balance) : 0;
      const n = buyAmt === 'max' ? Math.max(1, maxN) : parseInt(buyAmt, 10);
      const cost = bulkCost(g, owned, n);
      const affordable = buyAmt === 'max' ? maxN >= 1 : S.balance >= cost;

      setText(r.ownedEl, `Owned: ${owned}`);
      let meta = `${fmt(g.sps)} SC/s each`;
      if (owned > 0) meta += ` · ${fmt(g.sps * owned)} SC/s total`;
      setText(r.metaEl, meta);
      setText(r.btnN, `Buy ×${n}`);
      setText(r.btnP, `${fmt(cost)} SC`);
      setClass(r.btn, 'affordable', affordable);
      if (r.btn.disabled !== !affordable) r.btn.disabled = !affordable;
    });

    // Faker
    if (S.fakerOwned) {
      if (!fakerRefs.done) {
        fakerRefs.done = true;
        fakerRefs.buyCol.innerHTML = '<div class="champion-badge">🏆 Acquired</div>';
        fakerRefs.bar.style.width = '100%';
        setText(fakerRefs.label, 'You beat the game. The GOAT is yours.');
      }
    } else {
      const pct = Math.min(100, (S.balance / FAKER.base) * 100);
      fakerRefs.bar.style.width = pct.toFixed(2) + '%';
      setText(fakerRefs.label, `${pct.toFixed(1)}% of ${fmt(FAKER.base)} SC`);
      const ready = S.balance >= FAKER.base;
      setClass(fakerRefs.btn, 'gold-ready', ready);
      if (fakerRefs.btn.disabled !== !ready) fakerRefs.btn.disabled = !ready;
    }

    // Clickers
    CLICKERS.forEach((c, i) => {
      const r = clickerRefs[i];
      const owned = S.clickers[i];
      setClass(r.card, 'owned', owned);
      if (owned) {
        if (!r.btn.hidden) { r.btn.hidden = true; r.badge.hidden = false; }
      } else {
        if (r.btn.hidden) { r.btn.hidden = false; r.badge.hidden = true; }
        const affordable = S.balance >= c.price;
        setClass(r.btn, 'affordable', affordable);
        if (r.btn.disabled !== !affordable) r.btn.disabled = !affordable;
      }
    });

    // Save status (footer)
    if (!storageOK) {
      setText(saveStatusEl, '⚠ Saves won\u2019t persist here — use Export in Settings');
    } else if (lastSavedAt) {
      const ago = Math.round((Date.now() - lastSavedAt) / 1000);
      setText(saveStatusEl, ago < 3 ? 'Saved just now' : `Saved ${ago}s ago`);
    } else {
      setText(saveStatusEl, 'Autosaves every 15s');
    }
  }

  /* ============================== ACTIONS ============================== */

  function buyGenerator(i) {
    const g = GENERATORS[i];
    const owned = S.gens[i];
    const n = buyAmt === 'max' ? maxAffordable(g, owned, S.balance) : parseInt(buyAmt, 10);
    if (n < 1) return;
    const cost = bulkCost(g, owned, n);
    if (S.balance < cost) return;
    S.balance -= cost;
    S.totalSpent += cost;
    S.gens[i] += n;
    render();
  }

  function buyClicker(i) {
    const c = CLICKERS[i];
    if (S.clickers[i] || S.balance < c.price) return;
    S.balance -= c.price;
    S.totalSpent += c.price;
    S.clickers[i] = true;
    toast(`${c.icon} ${c.name} acquired — click power is now ×${fmt(clickPower())}`);
    render();
  }

  function buyFaker() {
    if (S.fakerOwned || S.balance < FAKER.base) return;
    S.balance -= FAKER.base;
    S.totalSpent += FAKER.base;
    S.fakerOwned = true;
    win();
  }

  function handleBigClick(e) {
    if (S.freeze) return; // win screen is up — choose Continue or New Game first
    const p = clickPower();
    S.balance += p;
    S.totalEarned += p;
    S.totalClicks++;

    // Where to spawn the feedback (keyboard activation → centre of the button).
    const rect = floatLayer.getBoundingClientRect();
    let x, y;
    if (e.detail === 0 || (e.clientX === 0 && e.clientY === 0)) {
      const b = bigButton.getBoundingClientRect();
      x = b.left + b.width / 2 - rect.left;
      y = b.top + b.height / 2 - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    spawnFloat(x, y, '+' + fmt(p));
    spawnSpores(x, y);
    render();
  }

  /* ============================== WIN ============================== */

  function win() {
    S.won = true;
    S.freeze = true; // freezes all income until the player chooses
    save();
    openModal(`
      <div class="trophy" aria-hidden="true">🏆</div>
      <h2 class="gold" style="text-align:center">FAKER ACQUIRED — YOU WIN!</h2>
      <p class="win-sub">The GOAT has joined the 4DickDestroyer roster. GG.</p>
      <div class="stat-row"><span class="k">Total playtime</span><span class="v">${fmtTime(S.playtimeMs)}</span></div>
      <div class="stat-row"><span class="k">Final ShroobCoin count</span><span class="v">${fmt(Math.floor(S.balance))} SC</span></div>
      <div class="stat-row"><span class="k">Total SC earned (lifetime)</span><span class="v">${fmt(Math.floor(S.totalEarned))} SC</span></div>
      <div class="stat-row"><span class="k">Total clicks</span><span class="v">${fmt(S.totalClicks)}</span></div>
      <div class="stat-row"><span class="k">Upgrades purchased</span><span class="v">${fmt(totalUpgradesPurchased())}</span></div>
      <div class="modal-actions">
        <button class="btn danger" data-action="win-new" type="button">New Game</button>
        <button class="btn gold" data-action="win-continue" type="button">Continue Playing</button>
      </div>
    `, { locked: true });
  }

  /* ============================== MODALS ============================== */

  function openModal(html, opts = {}) {
    modal.innerHTML = html;
    overlay.hidden = false;
    overlay.dataset.locked = opts.locked ? '1' : '';
    const first = modal.querySelector('button');
    if (first) first.focus();
  }

  function closeModal() {
    overlay.hidden = true;
    overlay.dataset.locked = '';
    modal.innerHTML = '';
    pendingConfirm = null;
  }

  function confirmAction(message, action) {
    pendingConfirm = action;
    openModal(`
      <h2>Are you sure?</h2>
      <p style="color:var(--muted);font-size:0.9rem">${message}</p>
      <div class="modal-actions">
        <button class="btn" data-action="close" type="button">Cancel</button>
        <button class="btn danger" data-action="confirm-yes" type="button">Yes, do it</button>
      </div>
    `);
  }

  function openStats() {
    openModal(`
      <h2>📊 Statistics</h2>
      <div class="stat-row"><span class="k">ShroobCoins</span><span class="v">${fmt(Math.floor(S.balance))} SC</span></div>
      <div class="stat-row"><span class="k">Income</span><span class="v">${fmt(netSps())} SC/s</span></div>
      <div class="stat-row"><span class="k">Click power</span><span class="v">${fmt(clickPower())} SC/click</span></div>
      <div class="stat-row"><span class="k">Total SC earned</span><span class="v">${fmt(Math.floor(S.totalEarned))} SC</span></div>
      <div class="stat-row"><span class="k">Total SC spent</span><span class="v">${fmt(Math.floor(S.totalSpent))} SC</span></div>
      <div class="stat-row"><span class="k">Total clicks</span><span class="v">${fmt(S.totalClicks)}</span></div>
      <div class="stat-row"><span class="k">Generators owned</span><span class="v">${fmt(S.gens.reduce((a, b) => a + b, 0))}</span></div>
      <div class="stat-row"><span class="k">Upgrades purchased</span><span class="v">${fmt(totalUpgradesPurchased())}</span></div>
      <div class="stat-row"><span class="k">Playtime</span><span class="v">${fmtTime(S.playtimeMs)}</span></div>
      <div class="stat-row"><span class="k">Status</span><span class="v">${S.won ? '👑 Victorious' : 'Grinding'}</span></div>
      <div class="modal-actions">
        <button class="btn primary" data-action="close" type="button">Close</button>
      </div>
    `);
  }

  function openSettings() {
    openModal(`
      <h2>⚙️ Settings</h2>
      ${storageOK ? '' : '<div class="storage-warning">Saving isn\u2019t available in this environment, so progress won\u2019t persist after a reload. Use Export below to back up your save — everything works normally once the game is deployed or opened from a local server.</div>'}
      <div class="setting-row">
        <div>
          <div class="s-label">Particle effects</div>
          <div class="s-sub">Floating numbers and spores on click</div>
        </div>
        <input type="checkbox" class="switch" id="particlesToggle" ${S.settings.particles ? 'checked' : ''}>
      </div>
      <div class="setting-row">
        <div>
          <div class="s-label">Saving</div>
          <div class="s-sub">Autosaves every ${AUTOSAVE_MS / 1000}s${storageOK ? '' : ' (unavailable here)'}</div>
        </div>
        <button class="btn" data-action="save-now" type="button">Save now</button>
      </div>
      <div class="setting-row" style="flex-wrap:wrap">
        <div>
          <div class="s-label">Backup</div>
          <div class="s-sub">Export your save, or paste one below and import it</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn" data-action="export" type="button">Export</button>
          <button class="btn" data-action="import" type="button">Import</button>
        </div>
        <textarea class="save-box" id="saveBox" spellcheck="false" placeholder="Exported save data appears here. Paste a save here and press Import to load it."></textarea>
      </div>
      <div class="danger-zone">
        <button class="btn danger" data-action="open-reset" type="button">🗑 Reset all progress</button>
      </div>
      <div class="modal-actions">
        <button class="btn primary" data-action="close" type="button">Done</button>
      </div>
    `);
  }

  function handleModalAction(action) {
    switch (action) {
      case 'close':
        closeModal();
        break;
      case 'win-continue':
        S.freeze = false;
        closeModal();
        save();
        toast('Income unfrozen. The grind continues.');
        break;
      case 'win-new':
        wipe();
        break;
      case 'open-reset':
        confirmAction('This permanently wipes your ShroobCoins, generators, upgrades and stats. There is no undo.', wipe);
        break;
      case 'confirm-yes': {
        const fn = pendingConfirm;
        pendingConfirm = null;
        if (fn) fn();
        break;
      }
      case 'save-now':
        save();
        toast(storageOK ? 'Game saved.' : 'Saved for this session only — use Export to keep it.');
        break;
      case 'export': {
        const box = el('saveBox');
        if (box) {
          S.lastSave = Date.now();
          box.value = JSON.stringify(S);
          box.focus();
          box.select();
          toast('Save exported — copy the text to keep it safe.');
        }
        break;
      }
      case 'import': {
        const box = el('saveBox');
        if (!box || !box.value.trim()) { toast('Paste a save into the box first.'); break; }
        let parsed;
        try { parsed = JSON.parse(box.value.trim()); } catch (e) { toast('That doesn\u2019t look like a valid save.'); break; }
        const candidate = sanitize(parsed);
        confirmAction('Overwrite your current progress with the imported save?', () => {
          S = candidate;
          S.lastSave = Date.now();
          save();
          closeModal();
          render();
          toast('Save imported. Welcome back.');
        });
        break;
      }
    }
  }

  /* ============================== PARTICLES & TOASTS ============================== */

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function spawnFloat(x, y, text) {
    if (!S.settings.particles || reducedMotion) return;
    if (floatLayer.childElementCount > 70) return;
    const s = document.createElement('span');
    s.className = 'float-num';
    s.textContent = text;
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.setProperty('--dx', (Math.random() * 64 - 32).toFixed(0) + 'px');
    s.addEventListener('animationend', () => s.remove());
    floatLayer.appendChild(s);
  }

  function spawnSpores(x, y) {
    if (!S.settings.particles || reducedMotion) return;
    if (floatLayer.childElementCount > 60) return;
    const count = 4;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'spore';
      s.textContent = '🍄';
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      const ang = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 50;
      s.style.setProperty('--tx', (Math.cos(ang) * dist).toFixed(0) + 'px');
      s.style.setProperty('--ty', (Math.sin(ang) * dist - 20).toFixed(0) + 'px');
      s.style.setProperty('--rot', (Math.random() * 240 - 120).toFixed(0) + 'deg');
      s.addEventListener('animationend', () => s.remove());
      floatLayer.appendChild(s);
    }
  }

  function toast(msg, ms = 3500) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 500);
  }

  /* ============================== SAVE / LOAD ============================== */

  function save() {
    if (suppressSave) return;
    S.lastSave = Date.now();
    if (storage.set(SAVE_KEY, JSON.stringify(S))) {
      lastSavedAt = Date.now();
    }
  }

  // Rebuild a guaranteed-valid state from arbitrary parsed JSON.
  function sanitize(raw) {
    const d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    const num = (v, fallback) => (Number.isFinite(+v) ? +v : fallback);
    d.balance = Math.max(0, num(raw.balance, 0));
    d.totalEarned = Math.max(0, num(raw.totalEarned, 0));
    d.totalClicks = Math.max(0, Math.floor(num(raw.totalClicks, 0)));
    d.totalSpent = Math.max(0, num(raw.totalSpent, 0));
    d.playtimeMs = Math.max(0, num(raw.playtimeMs, 0));
    d.gens = GENERATORS.map((_, i) => Math.max(0, Math.floor(num(raw.gens && raw.gens[i], 0))));
    d.clickers = CLICKERS.map((_, i) => !!(raw.clickers && raw.clickers[i]));
    d.fakerOwned = !!raw.fakerOwned;
    d.won = !!raw.won;
    d.freeze = false; // never restore a frozen state
    d.settings.particles = !(raw.settings && raw.settings.particles === false);
    d.startedAt = num(raw.startedAt, Date.now());
    d.lastSave = num(raw.lastSave, Date.now());
    return d;
  }

  function load() {
    const txt = storage.get(SAVE_KEY);
    if (!txt) return false;
    try {
      S = sanitize(JSON.parse(txt));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Credit income earned while the tab was closed (capped, never negative).
  function applyOffline() {
    const away = Date.now() - S.lastSave;
    if (away < 10000) return;
    const ms = Math.min(away, OFFLINE_CAP_MS);
    const sps = Math.max(0, netSps());
    const gain = sps * (ms / 1000);
    if (gain >= 1) {
      S.balance += gain;
      S.totalEarned += gain;
      toast(`While you were away (${fmtDur(ms)}): +${fmt(gain)} SC 🍄`, 6000);
    }
  }

  function wipe() {
    suppressSave = true;
    storage.remove(SAVE_KEY);
    location.reload();
  }

  /* ============================== GAME LOOP ============================== */

  let lastTick = Date.now();

  function tick() {
    const now = Date.now();
    let dt = (now - lastTick) / 1000;
    lastTick = now;
    if (dt <= 0) return;
    dt = Math.min(dt, 3600); // clamp huge gaps (sleep/wake); offline credit handles the rest

    if (!S.freeze) {
      const sps = netSps();
      if (sps > 0) {
        const delta = sps * dt;
        S.balance += delta;
        S.totalEarned += delta;
      } else if (sps < 0) {
        S.balance = Math.max(0, S.balance + sps * dt); // Valorant players can't put you in debt
      }
    }
    S.playtimeMs += dt * 1000;
    render();
  }

  /* ============================== EVENTS ============================== */

  function bindEvents() {
    bigButton.addEventListener('click', handleBigClick);

    // Logo fallback if logo.png is missing.
    const logoImg = el('logoImg');
    logoImg.addEventListener('error', () => {
      logoImg.hidden = true;
      el('logoFallback').hidden = false;
    });

    // Tabs
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => {
          t.classList.toggle('active', t === tab);
          t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        });
        const target = tab.dataset.tab;
        el('generatorsPanel').classList.toggle('active', target === 'generators');
        el('clickersPanel').classList.toggle('active', target === 'clickers');
      });
    });

    // Buy amount selector
    document.querySelectorAll('.amt').forEach((btn) => {
      btn.addEventListener('click', () => {
        buyAmt = btn.dataset.amt;
        document.querySelectorAll('.amt').forEach((b) => b.classList.toggle('active', b === btn));
        render();
      });
    });

    el('statsBtn').addEventListener('click', openStats);
    el('settingsBtn').addEventListener('click', openSettings);

    // Modal action delegation
    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) handleModalAction(btn.dataset.action);
    });
    modal.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'particlesToggle') {
        S.settings.particles = e.target.checked;
        save();
      }
    });

    // Close on backdrop click / Escape — unless the modal is locked (win screen).
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && overlay.dataset.locked !== '1') closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.hidden && overlay.dataset.locked !== '1') closeModal();
    });

    window.addEventListener('beforeunload', () => save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) save();
    });
  }

  /* ============================== INIT ============================== */

  function init() {
    const hadSave = load();
    buildShop();
    bindEvents();
    if (hadSave) applyOffline();
    if (!storageOK) {
      toast('Heads up: saving isn\u2019t available here. Use Export in Settings to back up progress.', 6000);
    }
    render();
    setInterval(tick, 100);
    setInterval(save, AUTOSAVE_MS);
    save();
  }

  init();
})();
