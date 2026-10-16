// HUD and menus (plain DOM).
import { formatInt, clamp } from './util.js';
import { MODE_INFO, medalFor } from './modes.js';
import { CHALLENGES, TIERS } from './challenges.js';
import { BOARD_DESIGNS, boardCanvas } from './rider/model.js';
import { JACKETS, PANTS, HELMETS, LENSES } from './save.js';
import { PRESETS } from './world/sky.js';
import { CAMERA_LABELS } from './camera.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const trail = (tier) => `<i class="trail ${tier}" aria-hidden="true"></i>`;
const medalBadge = (m) => (m ? `<span class="medal ${m}" title="${m} medal">${m[0].toUpperCase()}</span>` : '');

export class UI {
  constructor(game) {
    this.game = game;
    this.menu = $('menu');
    this.hud = $('hud');
    this.labels = $('labels');
    this.calloutT = 0;
    this.trickHold = 0;
    this.hintsShown = new Set();
    this.hintT = 0;
    this.lbTab = 'slopestyle';
    this.screen = null;
    this.menu.addEventListener('click', (e) => this.onClick(e));
    this.menu.addEventListener('input', (e) => this.onInput(e));
    this.buildLetters();
    this.mapCanvas = null;
  }

  hideLoading() {
    const l = $('loading');
    l.style.opacity = '0';
    setTimeout(() => (l.hidden = true), 520);
  }

  showHUD(on) {
    this.hud.hidden = !on;
  }

  // ------------------------------------------------------------ HUD

  buildLetters() {
    const el = $('hudLetters');
    el.innerHTML = 'SHRED'.split('').map((c) => `<span data-l="${c}">${c}</span>`).join('');
  }

  refreshLetters() {
    const col = this.game.save.data.collected;
    for (const span of $('hudLetters').children) span.classList.toggle('got', !!col['L' + span.dataset.l]);
  }

  setScore(label, value) {
    $('hudScoreLbl').textContent = label;
    $('hudScore').textContent = formatInt(value);
  }

  setCombo(combo) {
    const el = $('hudCombo');
    const on = combo.active && combo.tricks.length > 0;
    el.classList.toggle('on', on);
    if (on) {
      $('hudPot').textContent = formatInt(combo.pot);
      $('hudMult').textContent = combo.mult;
      $('hudComboBar').style.transform = `scaleX(${clamp(combo.timer / combo.window, 0, 1)})`;
    }
  }

  setTrick(name, pts) {
    $('hudTrickName').textContent = name || '';
    $('hudTrickPts').textContent = pts ? `${formatInt(pts)}` : '';
  }

  holdTrick(name, pts, seconds = 1.6) {
    this.setTrick(name, pts);
    this.trickHold = seconds;
  }

  callout(text, kind = 'clean', sub = '') {
    const el = $('hudCallout');
    el.className = `hud-callout ${kind}`;
    el.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    void el.offsetWidth;
    el.classList.add('show');
    this.calloutT = kind === 'neutral' ? 2.2 : 1.3;
  }

  toast(title, sub = '', icon = '') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon}<div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3600);
    setTimeout(() => el.remove(), 4100);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }

  popup(text, x = 0.5, y = 0.42) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    $('popups').appendChild(el);
    setTimeout(() => el.remove(), 1450);
  }

  hint(id, html, seconds = 5) {
    if (!this.game.save.settings.hints || this.hintsShown.has(id)) return;
    this.hintsShown.add(id);
    const el = $('hudHint');
    el.innerHTML = html;
    el.classList.add('on');
    this.hintT = seconds;
  }

  setBalance(v) {
    const el = $('hudBalance');
    if (v === null) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.firstElementChild.style.left = `${50 + clamp(v, -1, 1) * 48}%`;
  }

  setModeInfo(info) {
    $('hudMode').textContent = info.title;
    const html = info.lines.map((l) => `<div>${esc(l)}</div>`).join('');
    if (this._info !== html) {
      this._info = html;
      $('hudInfo').innerHTML = html;
    }
  }

  setSpeed(ms, units) {
    const v = units === 'mph' ? ms * 2.23694 : ms * 3.6;
    $('hudSpeed').textContent = Math.round(v);
    $('hudUnit').textContent = units === 'mph' ? 'MPH' : 'KM/H';
  }

  setOnline(n, status) {
    const el = $('hudOnline');
    if (status !== 'online') {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = n > 0 ? `${n + 1} riders on the mountain` : 'Online · just you';
  }

  setReplay(on, progress = 0, slowmo = false) {
    $('replayBar').hidden = !on;
    if (!on) return;
    $('replayProg').style.width = `${progress * 100}%`;
    const keys = `<kbd>Space</kbd> ${slowmo ? 'normal speed' : 'slow motion'} · <kbd>C</kbd> camera · <kbd>Esc</kbd> exit`;
    if ($('replayKeys').innerHTML !== keys) $('replayKeys').innerHTML = keys;
  }

  tick(dt) {
    if (this.calloutT > 0) {
      this.calloutT -= dt;
      if (this.calloutT <= 0) $('hudCallout').classList.remove('show');
    }
    if (this.trickHold > 0) {
      this.trickHold -= dt;
      if (this.trickHold <= 0) this.setTrick('', 0);
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) $('hudHint').classList.remove('on');
    }
  }

  // ------------------------------------------------------------ minimap

  buildMap() {
    const w = this.game.world;
    const S = 0.875 * 2; // px per metre on the 2x canvas
    const W = 184;
    const d0 = -60;
    const d1 = 1760;
    const H = Math.ceil((d1 - d0) * S);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const X = (x) => W / 2 + x * S;
    const Y = (d) => (d - d0) * S;
    g.fillStyle = 'rgba(30,60,50,0.55)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(235,242,255,0.85)';
    g.beginPath();
    for (let d = d0; d <= d1; d += 6) g.lineTo(X(-w.halfWidth(d)), Y(d));
    for (let d = d1; d >= d0; d -= 6) g.lineTo(X(w.halfWidth(d)), Y(d));
    g.fill();
    // pipe
    const p = w.pipe;
    g.fillStyle = 'rgba(43,111,224,0.75)';
    g.fillRect(X(p.x0 - p.copingV), Y(p.d0), p.copingV * 2 * S, p.length * S);
    // kickers
    for (const k of w.kickers) {
      g.fillStyle = '#ff6a1f';
      g.beginPath();
      g.moveTo(X(k.x0 - k.width / 2), Y(k.d0 + k.lipU));
      g.lineTo(X(k.x0 + k.width / 2), Y(k.d0 + k.lipU));
      g.lineTo(X(k.x0), Y(k.d0));
      g.fill();
      g.fillStyle = 'rgba(255,106,31,0.35)';
      g.fillRect(X(k.x0 - k.width / 2), Y(k.d0 + k.lipU), k.width * S, (k.landU1 - k.lipU) * S);
    }
    g.strokeStyle = '#19202d';
    g.lineWidth = 3;
    for (const r of w.rails) {
      g.beginPath();
      g.moveTo(X(r.pts[0].x), Y(-r.pts[0].z));
      const e = r.pts[r.pts.length - 1];
      g.lineTo(X(e.x), Y(-e.z));
      g.stroke();
    }
    for (const cl of w.cliffs) {
      g.fillStyle = '#4a5468';
      g.fillRect(X(cl.x0), Y(cl.d0) - 3, (cl.x1 - cl.x0) * S, 6);
    }
    // finish line
    g.fillStyle = '#19202d';
    g.fillRect(X(-40), Y(this.game.world.course.finishD), 80 * S, 3);
    this.mapCanvas = c;
    this.mapD0 = d0;
    this.mapS = S;
  }

  drawMap(rider, extras = []) {
    if (!this.mapCanvas) this.buildMap();
    const cv = $('minimap');
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const S = this.mapS;
    const d = -rider.pos.z;
    const top = (d - 70 - this.mapD0) * S;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.mapCanvas, 0, top, W, H, 0, 0, W, H);
    const X = (x) => W / 2 + x * S;
    const Y = (dd) => (dd - this.mapD0) * S - top;
    const col = this.game.save.data.collected;
    for (const l of this.game.world.letters) {
      if (col[l.id]) continue;
      g.fillStyle = '#ff6a1f';
      g.beginPath();
      g.arc(X(l.pos.x), Y(-l.pos.z), 5, 0, 7);
      g.fill();
    }
    for (const e of extras) {
      g.fillStyle = e.color;
      g.beginPath();
      g.arc(X(e.x), Y(-e.z), 6, 0, 7);
      g.fill();
    }
    // rider arrow
    const vx = rider.vel.x;
    const vz = rider.vel.z;
    const a = Math.atan2(vx, -vz);
    g.save();
    g.translate(X(rider.pos.x), Y(d));
    g.rotate(a);
    g.fillStyle = '#fff';
    g.strokeStyle = '#19202d';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 12);
    g.lineTo(8, -8);
    g.lineTo(0, -3);
    g.lineTo(-8, -8);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }

  // ------------------------------------------------------------ menus

  open(html, opts = {}) {
    this.menu.hidden = false;
    this.menu.innerHTML = `<div class="scrim ${opts.full || opts.wide ? 'full' : ''}"></div><div class="sheet ${opts.wide ? 'wide' : ''} ${opts.center ? 'center' : ''}">${html}</div>`;
    const first = this.menu.querySelector('[data-focus], .btn.primary, .btn, .ticket');
    if (first && !opts.noFocus) first.focus({ preventScroll: true });
  }

  close() {
    this.menu.hidden = true;
    this.menu.innerHTML = '';
    this.screen = null;
  }

  onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const g = this.game;
    const act = t.dataset.act;
    const val = t.dataset.val;
    g.audio.ui();
    switch (act) {
      case 'nav': this.show(val); break;
      case 'mode': g.startMode(val); break;
      case 'section': g.startMode('freeride', { section: val }); break;
      case 'resume': g.resume(); break;
      case 'restart': g.restartMode(); break;
      case 'quit': g.quitToMenu(); break;
      case 'replay': g.watchReplay(); break;
      case 'teleport': g.teleport(val); break;
      case 'set': this.setSetting(t.dataset.key, val); break;
      case 'rider': this.setRider(t.dataset.key, val); break;
      case 'lbtab': this.lbTab = val; this.show('leaderboard'); break;
      case 'reset-progress':
        if (t.dataset.confirm) { g.save.reset(); g.applySettings(); g.applyRider(); this.show('settings'); }
        else { t.dataset.confirm = '1'; t.innerHTML = 'Tap again to erase all progress'; }
        break;
      case 'back': this.show(this.backTo || 'title'); break;
      default: break;
    }
  }

  onInput(e) {
    const t = e.target;
    if (t.dataset.key && t.type === 'range') this.setSetting(t.dataset.key, t.value, true);
    if (t.id === 'riderName') {
      this.game.save.rider.name = t.value.replace(/[\u0000-\u001f]/g, '').slice(0, 18);
      this.game.save.persist();
    }
  }

  setSetting(key, val, silent) {
    const s = this.game.save.settings;
    if (['sfx', 'music'].includes(key)) s[key] = clamp(parseFloat(val), 0, 1);
    else if (['musicOn', 'shake', 'invertFlip', 'hints'].includes(key)) s[key] = val === 'true';
    else s[key] = val;
    this.game.save.persist();
    this.game.applySettings();
    if (!silent) this.show(this.screen);
  }

  setRider(key, val) {
    const r = this.game.save.rider;
    if (['jacket', 'pants', 'helmet', 'gloves', 'lens'].includes(key)) r[key] = parseInt(val, 10);
    else r[key] = val;
    this.game.save.persist();
    this.game.applyRider();
    this.show('rider');
  }

  show(screen, data) {
    this.screen = screen;
    this.game.showcase = screen === 'rider' && this.game.state === 'menu';
    const fn = this['screen_' + screen];
    if (fn) fn.call(this, data);
  }

  screen_title() {
    const g = this.game;
    const s = g.save.data;
    const done = g.save.challengeCount();
    const best = s.best;
    const online = g.online.status === 'online';
    this.backTo = 'title';
    this.open(`
      <div class="eyebrow">Shredline Mountain · Snowboard park</div>
      <h1 class="logo">SHRED<em>LINE</em></h1>
      <p class="tagline">Carve 1.7 km of park: eleven kickers, eleven rails and boxes, a 180 m superpipe, cliffs and a Big Air jump.</p>
      <div class="menu-list">
        <button class="btn primary" data-act="nav" data-val="modes" data-focus>Ride <small>Pick a lift ticket</small></button>
        <button class="btn" data-act="nav" data-val="rider">Rider <small>${esc(g.save.rider.name || 'Customise')}</small></button>
        <button class="btn" data-act="nav" data-val="challenges">Challenges <small>${done} / ${CHALLENGES.length}</small></button>
        <button class="btn" data-act="nav" data-val="trickbook">Trick Book <small>${Object.keys(s.trickbook).length} landed</small></button>
        ${online ? `<button class="btn" data-act="nav" data-val="leaderboard">Leaderboard <small>Mountain rankings</small></button>` : ''}
        <button class="btn" data-act="nav" data-val="settings">Settings</button>
        <button class="btn" data-act="nav" data-val="controls">Controls</button>
      </div>
      <div class="stats">
        <div class="stat"><b>${formatInt(best.slopestyle)}</b><span>Slopestyle PB</span></div>
        <div class="stat"><b>${formatInt(best.bigair)}</b><span>Big Air PB</span></div>
        <div class="stat"><b>${formatInt(best.combo)}</b><span>Best combo</span></div>
      </div>
      <p class="foot"><b>Keyboard:</b> WASD carve, spin and flip · Space ollie · Arrows grab · Shift tweak. Gamepad and touch work too.</p>
    `);
  }

  screen_modes() {
    const g = this.game;
    const b = g.save.data.best;
    const medals = g.save.data.best.medals || {};
    const ticket = (id, color, extra = '') => {
      const info = MODE_INFO[id];
      const pb = id === 'freeride' ? `${g.save.challengeCount()} / ${CHALLENGES.length}` : formatInt(b[id] || 0);
      const pbLabel = id === 'freeride' ? 'Challenges' : 'Personal best';
      return `<button class="ticket ${color}" data-act="mode" data-val="${id}" ${id === 'freeride' ? 'data-focus' : ''}>
        <div class="band"><span>Shredline Mtn</span><span>Day pass</span></div>
        <div class="body"><h3>${info.name}</h3><p>${info.blurb}</p>${extra}</div>
        <div class="perf"></div>
        <div class="meta"><div class="pb">${pbLabel}<b>${pb} ${medalBadge(medals[id])}</b></div><div class="barcode"></div></div>
      </button>`;
    };
    this.backTo = 'title';
    this.open(`
      <button class="btn slim back" data-act="back">← Back</button>
      <div class="eyebrow">Choose your lift ticket</div>
      <h2 class="title">Where are you riding?</h2>
      <div class="tickets">
        ${ticket('freeride', '')}
        ${ticket('slopestyle', 'blue')}
        ${ticket('bigair', 'dark')}
        ${ticket('halfpipe', 'teal')}
      </div>
      <div>
        <div class="eyebrow" style="margin-bottom:8px">Free ride from a section</div>
        <div class="row">${g.world.sections.slice(1).map((s) => `<button class="btn slim" data-act="section" data-val="${s.id}">${esc(s.name)}</button>`).join('')}</div>
      </div>
      <p class="note">Medals: Slopestyle gold at ${formatInt(MODE_INFO.slopestyle.medals.gold)}, Big Air gold at ${formatInt(MODE_INFO.bigair.medals.gold)}, Superpipe gold at ${formatInt(MODE_INFO.halfpipe.medals.gold)}.</p>
    `, { wide: true });
  }

  screen_rider() {
    const g = this.game;
    const r = g.save.rider;
    const done = g.save.challengeCount();
    const sw = (key, list, cur) =>
      `<div class="swatches">${list
        .map((item) => {
          const h = typeof item === 'number' ? item : item.hex;
          const locked = item.unlock && done < item.unlock;
          const title = item.name ? item.name + (locked ? ` (unlocks at ${item.unlock} challenges)` : '') : hex(h);
          return `<button class="sw ${h === cur ? 'on' : ''} ${locked ? 'locked' : ''}" style="background:${hex(h)}" title="${esc(title)}" aria-label="${esc(title)}" ${locked ? 'disabled' : `data-act="rider" data-key="${key}" data-val="${h}"`}></button>`;
        })
        .join('')}</div>`;
    const boards = BOARD_DESIGNS.map((b) => {
      const locked = done < b.unlock;
      return `<button class="boardcard ${r.design === b.id ? 'on' : ''} ${locked ? 'locked' : ''}" ${locked ? 'disabled' : `data-act="rider" data-key="design" data-val="${b.id}"`}>
        <canvas data-board="${b.id}" width="256" height="48"></canvas><b>${b.name}</b><small>${locked ? `Unlocks at ${b.unlock} challenges` : 'Ready'}</small></button>`;
    }).join('');
    this.open(`
      <button class="btn slim back" data-act="back">← Back</button>
      <div class="eyebrow">Rider</div>
      <h2 class="title">Suit up</h2>
      <div>
        <div class="field"><label for="riderName">Name</label><input id="riderName" type="text" maxlength="18" placeholder="Rider name" value="${esc(r.name)}"></div>
        <div class="field"><span>Stance</span><div class="seg">
          <button class="${r.stance === 'regular' ? 'on' : ''}" data-act="rider" data-key="stance" data-val="regular">Regular (left foot forward)</button>
          <button class="${r.stance === 'goofy' ? 'on' : ''}" data-act="rider" data-key="stance" data-val="goofy">Goofy (right foot forward)</button></div></div>
        <div class="field"><span>Head</span><div class="seg">
          <button class="${r.headwear === 'helmet' ? 'on' : ''}" data-act="rider" data-key="headwear" data-val="helmet">Helmet</button>
          <button class="${r.headwear === 'beanie' ? 'on' : ''}" data-act="rider" data-key="headwear" data-val="beanie">Beanie</button></div></div>
        <div class="field"><span>Jacket</span>${sw('jacket', JACKETS, r.jacket)}</div>
        <div class="field"><span>Pants</span>${sw('pants', PANTS, r.pants)}</div>
        <div class="field"><span>Helmet / beanie</span>${sw('helmet', HELMETS, r.helmet)}</div>
        <div class="field"><span>Gloves</span>${sw('gloves', [0x1b1f27, 0xf4f7fb, 0xff6a1f, 0x2b6fe0, 0xe8455a, 0x3dbb7c], r.gloves)}</div>
        <div class="field"><span>Goggle lens</span>${sw('lens', LENSES, r.lens)}</div>
      </div>
      <div><div class="eyebrow" style="margin-bottom:8px">Board · ${done} challenges complete</div><div class="boards">${boards}</div></div>
    `, { noFocus: true });
    for (const cv of this.menu.querySelectorAll('canvas[data-board]')) {
      const ctx = cv.getContext('2d');
      ctx.drawImage(boardCanvas(cv.dataset.board), 0, 0, cv.width, cv.height);
    }
    g.enterShowcase();
  }

  screen_challenges() {
    const g = this.game;
    const done = g.save.data.challenges;
    const n = Object.keys(done).length;
    const col = g.save.data.collected;
    const letters = Object.keys(col).filter((k) => k[0] === 'L').length;
    const flakes = Object.keys(col).filter((k) => k[0] === 'F').length;
    const groups = Object.keys(TIERS)
      .map((tier) => {
        const items = CHALLENGES.filter((c) => c.tier === tier)
          .map((c) => `<div class="chal ${done[c.id] ? 'done' : ''}">${trail(tier)}<div><b>${esc(c.name)}</b><span>${esc(c.desc)}</span></div>${done[c.id] ? '<span class="tick">DONE</span>' : ''}</div>`)
          .join('');
        return `<div><div class="eyebrow" style="margin:6px 0 8px">${trail(tier)} ${TIERS[tier].label}</div><div class="clist">${items}</div></div>`;
      })
      .join('');
    const next = BOARD_DESIGNS.find((b) => b.unlock > n);
    this.open(`
      <button class="btn slim back" data-act="back">← Back</button>
      <div class="eyebrow">Challenges</div>
      <h2 class="title">${n} of ${CHALLENGES.length} complete</h2>
      <div class="progress"><i style="width:${(n / CHALLENGES.length) * 100}%"></i></div>
      <p class="note">Letters found: ${letters} / 5 · Snowflakes found: ${flakes} / 20${next ? ` · Next board (${esc(next.name)}) unlocks at ${next.unlock}` : ' · Every board unlocked'}</p>
      ${groups}
    `, { wide: true });
  }

  screen_trickbook() {
    const g = this.game;
    const book = Object.entries(g.save.data.trickbook).sort((a, b) => b[1].best - a[1].best);
    const rows = book.length
      ? book.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.kind === 'grind' ? 'Rail' : v.kind === 'butter' ? 'Butter' : 'Air'}</td><td class="num">${v.count}</td><td class="num">${formatInt(v.best)}</td></tr>`).join('')
      : `<tr><td colspan="4">Nothing landed yet. Every trick you stomp is logged here with its best score.</td></tr>`;
    this.open(`
      <button class="btn slim back" data-act="back">← Back</button>
      <div class="eyebrow">Trick Book</div>
      <h2 class="title">${book.length} tricks landed</h2>
      <div class="scroll"><table class="table"><thead><tr><th>Trick</th><th>Type</th><th style="text-align:right">Landed</th><th style="text-align:right">Best</th></tr></thead><tbody>${rows}</tbody></table></div>
    `, { wide: true });
  }

  screen_leaderboard() {
    const g = this.game;
    const tabs = [['slopestyle', 'Slopestyle'], ['bigair', 'Big Air'], ['halfpipe', 'Superpipe'], ['combo', 'Best Combo']];
    const list = g.online.top(this.lbTab, 25);
    const rows = list.length
      ? list.map((s, i) => `<tr class="${s.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(s.name)}${s.me ? ' (you)' : ''}</td><td class="num">${formatInt(s.score)}</td></tr>`).join('')
      : `<tr><td colspan="3">No scores yet. Finish a run to put your name on the board.</td></tr>`;
    const note = g.online.canRank ? 'Your best scores post here automatically.' : 'Scores from riders who can save to this page show here. Yours stay on this device.';
    this.open(`
      <button class="btn slim back" data-act="back">← Back</button>
      <div class="eyebrow">Mountain leaderboard</div>
      <h2 class="title">Who rules the park</h2>
      <div class="tabs">${tabs.map(([id, l]) => `<button class="tab ${this.lbTab === id ? 'on' : ''}" data-act="lbtab" data-val="${id}">${l}</button>`).join('')}</div>
      <div class="scroll"><table class="table"><thead><tr><th>#</th><th>Rider</th><th style="text-align:right">Score</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">${note}</p>
    `);
  }

  screen_settings() {
    const s = this.game.save.settings;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(s[key]) === String(v) ? 'on' : ''}" data-act="set" data-key="${key}" data-val="${v}">${l}</button>`).join('')}</div>`;
    this.open(`
      <button class="btn slim back" data-act="back">← Back</button>
      <div class="eyebrow">Settings</div>
      <h2 class="title">Tune it</h2>
      <div>
        <div class="field"><span>Graphics</span>${seg('quality', [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']])}</div>
        <div class="field"><span>Time of day</span>${seg('time', Object.entries(PRESETS).map(([k, p]) => [k, p.label]))}</div>
        <div class="field"><span>Snowfall</span>${seg('snow', [['off', 'Off'], ['light', 'Light'], ['storm', 'Storm']])}</div>
        <div class="field"><label for="sfxVol">Sound</label><input id="sfxVol" type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-key="sfx"></div>
        <div class="field"><label for="musicVol">Music</label><input id="musicVol" type="range" min="0" max="1" step="0.05" value="${s.music}" data-key="music"></div>
        <div class="field"><span>Music</span>${seg('musicOn', [[true, 'On'], [false, 'Off']])}</div>
        <div class="field"><span>Camera shake</span>${seg('shake', [[true, 'On'], [false, 'Off']])}</div>
        <div class="field"><span>Flip keys</span>${seg('invertFlip', [[false, 'W front, S back'], [true, 'W back, S front']])}</div>
        <div class="field"><span>Speed</span>${seg('units', [['kmh', 'km/h'], ['mph', 'mph']])}</div>
        <div class="field"><span>Tips</span>${seg('hints', [[true, 'Show'], [false, 'Hide']])}</div>
      </div>
      <div class="row"><button class="btn slim" data-act="reset-progress">Erase progress</button></div>
    `, { noFocus: true });
  }

  screen_controls() {
    this.open(`
      <button class="btn slim back" data-act="back">← Back</button>
      <div class="eyebrow">Controls</div>
      <h2 class="title">How to shred</h2>
      <div class="controls-grid">
        <div><h4>Keyboard</h4><dl class="kv">
          <dt><kbd>A</kbd> <kbd>D</kbd></dt><dd>Carve on snow · spin in the air · balance on rails</dd>
          <dt><kbd>W</kbd></dt><dd>Tuck for speed (and push on flats) · frontflip in the air</dd>
          <dt><kbd>S</kbd></dt><dd>Brake · backflip in the air</dd>
          <dt><kbd>Space</kbd></dt><dd>Hold to load, release to ollie. Pop at the lip to go bigger</dd>
          <dt>Arrows or <kbd>I</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd></dt><dd>Grabs in the air · nose/tail press on snow and rails</dd>
          <dt><kbd>Shift</kbd></dt><dd>Tweak the grab you are holding</dd>
          <dt><kbd>R</kbd></dt><dd>Reset to your last safe spot</dd>
          <dt><kbd>C</kbd> <kbd>V</kbd></dt><dd>Change camera · instant replay</dd>
          <dt><kbd>M</kbd> <kbd>Esc</kbd></dt><dd>Teleport (Free Ride) · pause</dd>
        </dl></div>
        <div><h4>Grabs</h4><dl class="kv">
          <dt>↑</dt><dd>Nose grab</dd><dt>↓</dt><dd>Tail grab</dd>
          <dt>→</dt><dd>Indy</dd><dt>←</dt><dd>Melon</dd>
          <dt>↑ →</dt><dd>Mute</dd><dt>↑ ←</dt><dd>Method</dd>
          <dt>↓ ←</dt><dd>Stalefish</dd><dt>↓ →</dt><dd>Japan</dd>
        </dl></div>
        <div><h4>Gamepad</h4><dl class="kv">
          <dt>Left stick</dt><dd>Carve, spin, flip</dd><dt>Right stick</dt><dd>Grabs (8 ways)</dd>
          <dt>A</dt><dd>Ollie</dd><dt>RB / RT</dt><dd>Tweak</dd><dt>LT / B</dt><dd>Tuck / brake</dd>
          <dt>Y · X</dt><dd>Reset · replay</dd><dt>View · Menu</dt><dd>Camera · pause</dd>
        </dl></div>
        <div><h4>Trick names</h4><dl class="kv">
          <dt>Spins</dt><dd>Frontside or Backside 180 to 1800. Taking off switch: Cab (frontside) or Switch Backside</dd>
          <dt>Off-axis</dt><dd>Spin + flip: Cork, Rodeo or Misty. Two flips make it a Double</dd>
          <dt>Pipe</dt><dd>McTwist (frontflip 540), Crippler, alley-oops by landing it</dd>
          <dt>Scoring</dt><dd>500 × turns² for spins and flips, off-axis ×1.3, more grabs multiply. Chain tricks within the combo timer to multiply the whole line</dd>
        </dl></div>
      </div>
    `, { wide: true });
  }

  screen_pause() {
    const g = this.game;
    const isFree = g.mode && g.mode.id === 'freeride';
    this.backTo = 'pause';
    this.open(`
      <div class="eyebrow">Paused · ${esc(MODE_INFO[g.mode.id].name)}</div>
      <h2 class="title">Take a breather</h2>
      <div class="menu-list">
        <button class="btn primary" data-act="resume" data-focus>Resume</button>
        <button class="btn" data-act="replay">Watch replay <small>Last 15 seconds</small></button>
        ${isFree ? '<button class="btn" data-act="nav" data-val="teleport">Teleport <small>Jump to a section</small></button>' : '<button class="btn" data-act="restart">Restart run</button>'}
        <button class="btn" data-act="nav" data-val="challenges">Challenges</button>
        <button class="btn" data-act="nav" data-val="settings">Settings</button>
        <button class="btn" data-act="nav" data-val="controls">Controls</button>
        <button class="btn" data-act="quit">Quit to menu</button>
      </div>
      <p class="note">Camera: ${CAMERA_LABELS[g.cam.mode]} (press <kbd>C</kbd> while riding).</p>
    `);
  }

  screen_teleport() {
    const g = this.game;
    this.backTo = 'pause';
    this.open(`
      <button class="btn slim back" data-act="back">← Back</button>
      <div class="eyebrow">Teleport</div>
      <h2 class="title">Drop in anywhere</h2>
      <div class="menu-list">${g.world.sections.map((s) => `<button class="btn" data-act="teleport" data-val="${s.id}">${esc(s.name)} <small>${s.d} m</small></button>`).join('')}</div>
    `);
  }

  screen_results(res) {
    const g = this.game;
    const medal = medalFor(res.mode, res.score);
    const top = (res.top || [])
      .map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${formatInt(t.points)}</td></tr>`)
      .join('');
    const lines = res.lines.map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
    const m = MODE_INFO[res.mode].medals;
    this.backTo = 'title';
    this.open(`
      <div class="eyebrow">${esc(MODE_INFO[res.mode].name)} · Results</div>
      <div class="row">${medal ? `<span class="medal ${medal}" style="width:44px;height:44px;font-size:22px">${medal[0].toUpperCase()}</span>` : ''}<div class="results-score">${formatInt(res.score)}</div></div>
      <div class="row">${res.pb ? '<span class="pb-flag">New personal best</span>' : `<span class="note">Personal best ${formatInt(g.save.data.best[res.mode] || 0)}</span>`}${medal ? `<span class="note">${medal[0].toUpperCase() + medal.slice(1)} medal</span>` : `<span class="note">Bronze at ${formatInt(m.bronze)}</span>`}</div>
      <div class="stats" style="max-width:none">${lines}</div>
      ${top ? `<div class="scroll"><table class="table"><thead><tr><th>Judges' top tricks</th><th style="text-align:right">Points</th></tr></thead><tbody>${top}</tbody></table></div>` : ''}
      <div class="menu-list">
        <button class="btn primary" data-act="restart" data-focus>Ride again</button>
        <button class="btn" data-act="replay">Watch replay</button>
        <button class="btn" data-act="quit">Menu</button>
      </div>
    `);
  }
}
