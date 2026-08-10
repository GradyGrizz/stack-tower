'use strict';
// ── Screens: title, menu, story select, settings, intro ───────

// shared dungeon backdrop: dim floor tiles + vignette
function drawBackdrop(ctx, W, H, t) {
  ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, W, H);
  const ts = 44;
  ctx.save();
  ctx.globalAlpha = 0.22;
  for (let r = 0; r < Math.ceil(H / ts); r++)
    for (let c = 0; c < Math.ceil(W / ts); c++)
      Art.floor(ctx, c * ts, r * ts, ts);
  ctx.restore();
  const g = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(8,9,14,0)');
  g.addColorStop(1, 'rgba(2,3,6,0.88)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// vertical menu list with dpad/tap support
class MenuList {
  constructor(items) {
    this.items = items; // [{label, sub?, action, disabled?}]
    this.sel = 0;
    this.rects = [];
  }
  nav(dr) {
    if (!this.items.length) return;
    const n = this.items.length;
    this.sel = (this.sel + dr + n) % n;
    Snd.blip();
  }
  activate() {
    const it = this.items[this.sel];
    if (!it || it.disabled) { Snd.error(); return; }
    Snd.select();
    it.action();
  }
  tapAt(x, y) {
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        this.sel = i;
        this.activate();
        return true;
      }
    }
    return false;
  }
  // sharp card list: hard pixel shadows, gold selection bar, icons,
  // staggered slide-in when `t` (seconds since screen enter) is given
  draw(ctx, cx, y, w, itemH, s, t) {
    this.rects = [];
    const gap = 10;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const baseY = y + i * (itemH + gap);
      const x = Math.round(cx - w / 2);
      this.rects.push({ x, y: baseY, w, h: itemH });
      const appear = t == null ? 1 : Math.min(1, Math.max(0, (t - i * 0.05) / 0.16));
      if (appear <= 0) continue;
      const ease = 1 - Math.pow(1 - appear, 3);
      const iy = Math.round(baseY + (1 - ease) * 16);
      const seld = i === this.sel;
      ctx.save();
      ctx.globalAlpha = ease;
      // hard pixel drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + 4, iy + 4, w, itemH);
      // card body
      ctx.fillStyle = seld ? '#161226' : '#0d1120';
      ctx.fillRect(x, iy, w, itemH);
      if (seld) {
        ctx.fillStyle = 'rgba(210,160,40,0.08)';
        ctx.fillRect(x, iy, w, itemH);
      }
      // border
      ctx.fillStyle = seld ? PAL.gold : 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, iy, w, 2); ctx.fillRect(x, iy + itemH - 2, w, 2);
      ctx.fillRect(x, iy, 2, itemH); ctx.fillRect(x + w - 2, iy, 2, itemH);
      // gold accent bar on the left of the selected card
      if (seld) {
        ctx.fillStyle = PAL.goldHi;
        ctx.fillRect(x, iy, 5, itemH);
      }
      // icon
      let textL = x + 16, textR = x + w - 16;
      if (it.icon) {
        const isz = Math.min(28, itemH - 16);
        Art.uiIcon(ctx, it.icon, x + 16, iy + Math.round((itemH - isz) / 2), isz);
        textL = x + 16 + isz + 14;
      }
      const col = it.disabled ? PAL.uiDim : (seld ? PAL.goldHi : PAL.ui);
      const hasSub = !!it.sub;
      const ty = iy + Math.round((itemH - (hasSub ? 7 * s + 5 + 7 : 7 * s)) / 2);
      const tcx = it.icon ? textL : Math.round(x + w / 2);
      const align = it.icon ? 'left' : 'center';
      const maxW = it.icon ? textR - textL : w - 36;
      drawTextFit(ctx, it.label, tcx, ty, maxW, s, col, align, '#000');
      if (hasSub) {
        drawTextFit(ctx, it.sub, tcx, ty + 7 * s + 7, maxW, 1, PAL.uiDim, align);
      }
      ctx.restore();
    }
  }
}

function coinsBadge(ctx, x, y, n, s) {
  const txt = (Save.devOn && Save.devOn()) ? '∞' : String(n);
  const w = textWidth(txt, s) + 14 * s;
  Art.coinIcon(ctx, x - w, y, 7 * s);
  drawText(ctx, txt, x - w + 10 * s, y + s, s, PAL.goldHi, 'left', '#000');
}

// classic drop-and-bounce easing for the logo landing
function easeOutBounce(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) { x -= 1.5 / d1; return n1 * x * x + 0.75; }
  if (x < 2.5 / d1) { x -= 2.25 / d1; return n1 * x * x + 0.9375; }
  x -= 2.625 / d1; return n1 * x * x + 0.984375;
}

// ══ TITLE ═════════════════════════════════════════════════════
// Retro startup sequence (Pokémon-ish): the DELVE logo drops in from the
// top, bounces to a stop with a little screen-shake + thud, a shine sweeps
// across it, then the rest of the screen fades in.
// build stamp — bump this to the deploy time (Arizona/Phoenix time) on each update
const BUILD_STAMP = '8/9/2026 5:23pm (mst)';

const ScreenTitle = {
  FALL: 0.85, SHINE_DELAY: 0.12, SHINE_DUR: 0.6,
  t: 0, heroX: -80, frame: 0, landed: false, shineT: -1, shake: 0,
  enter() { this.t = 0; this.heroX = -80; this.landed = false; this.shineT = -1; this.shake = 0; Snd.playMusic('title'); },
  update(dt) {
    this.t += dt;
    this.frame = Math.floor(this.t * 7) % 4;
    if (this.landed) { this.heroX += dt * 42; if (this.heroX > App.W + 80) this.heroX = -80; }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    if (!this.landed && this.t >= this.FALL) {
      this.landed = true; this.shineT = 0; this.shake = 0.22;
      Snd.thud(); Platform.haptic('heavy');
    }
    if (this.shineT >= 0) this.shineT += dt;
  },
  draw(ctx, W, H) {
    drawBackdrop(ctx, W, H, this.t);
    const s = Math.max(2, Math.floor(W / 200));
    const big = Math.max(4, Math.floor(W / 82));
    const ly = H * 0.24;
    const logoW = textWidth('DELVE', big);
    // falling logo with a bounce landing
    const p = Math.min(1, this.t / this.FALL);
    const startY = -7 * big - 30;
    const logoY = Math.round(startY + (ly - startY) * easeOutBounce(p));

    ctx.save();
    if (this.shake > 0) { const k = this.shake / 0.22; ctx.translate(0, Math.round((Math.random() - 0.5) * 9 * k)); }
    drawText(ctx, 'DELVE', W / 2, logoY, big, PAL.goldHi, 'center', '#3a2808');
    // shine sweep across the letters once it lands
    if (this.landed && this.shineT >= this.SHINE_DELAY) {
      const sp = (this.shineT - this.SHINE_DELAY) / this.SHINE_DUR;
      if (sp <= 1) {
        const lx = W / 2 - logoW / 2, band = big * 7, slant = big * 4;
        const cx = lx - band + (logoW + band * 2) * sp;
        const top = logoY - 4, bot = logoY + 7 * big + 4;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, top); ctx.lineTo(cx + band, top);
        ctx.lineTo(cx + band - slant, bot); ctx.lineTo(cx - slant, bot);
        ctx.closePath(); ctx.clip();
        ctx.globalAlpha = 0.92 * Math.sin(sp * Math.PI);
        drawText(ctx, 'DELVE', W / 2, logoY, big, '#fffbe6', 'center');
        ctx.restore();
      }
    }
    ctx.restore();

    // the rest of the screen fades in after the logo settles
    const rev = this.landed ? Math.min(1, this.shineT / 0.35) : 0;
    if (rev <= 0) return;
    ctx.save();
    ctx.globalAlpha = rev;
    drawText(ctx, 'THE KEEP OF ALARIC', W / 2, ly + 7 * big + 12, Math.max(2, s), PAL.ui, 'center', '#000');
    const stripY = H * 0.56, ts = 46;
    for (let c = -1; c < Math.ceil(W / ts) + 1; c++) Art.floor(ctx, c * ts, stripY, ts);
    ctx.fillStyle = 'rgba(2,3,6,0.35)'; ctx.fillRect(0, stripY, W, ts);
    Art.hero(ctx, 'right', this.frame, this.heroX, stripY - 8, ts, false);
    drawText(ctx, 'A DUNGEON PUZZLE', W / 2, H - 40, 1, PAL.uiDim, 'center');
    drawText(ctx, 'UPDATED ' + BUILD_STAMP, W / 2, H - 14, 1, PAL.uiDim, 'center');
    ctx.restore();
    if (rev >= 1 && Math.floor(this.t * 1.6) % 2 === 0) {
      drawText(ctx, 'TAP TO BEGIN', W / 2, H * 0.76, Math.max(2, s - 1), PAL.ui, 'center', '#000');
    }
  },
  _go() {
    Snd.select();
    if (!Save.data.meta.seenIntro) App.setScreen('intro');
    else App.setScreen('menu');
  },
  onTap() { this._go(); },
  onConfirm() { this._go(); },
  onDirPress() {}, onDirRelease() {}, onBack() {},
};

// ══ INTRO (onboarding cards) ══════════════════════════════════
const ScreenIntro = {
  page: 0, t: 0,
  cards: [
    { title: 'PUSH & SOLVE', body: 'PUSH STONE BLOCKS ONTO RED SWITCHES TO UNSEAL THE STAIRS. PLAN AHEAD - BLOCKS ONLY MOVE FORWARD.', art: 'block' },
    { title: 'DELVE DEEPER', body: 'FIND KEYS, OPEN CHESTS, AND CLAIM LOST RELICS. EACH RELIC OPENS NEW PATHS THROUGH THE KEEP.', art: 'chest' },
    { title: 'GROW RICHER', body: 'EARN COINS WITH EVERY PUZZLE. SPEND THEM IN THE SHOP ON GEAR AND STYLES FOR YOUR DELVER.', art: 'coin' },
  ],
  enter() { this.page = 0; this.t = 0; },
  update(dt) { this.t += dt; },
  draw(ctx, W, H) {
    drawBackdrop(ctx, W, H, this.t);
    const s = Math.max(2, Math.floor(Math.min(W, H) / 180));
    const card = this.cards[Math.min(this.page, this.cards.length - 1)];
    const pw = Math.min(W - 80, 700), ph = Math.min(260, H - 104);
    const px = (W - pw) / 2, py = Math.max(44, H * 0.13);
    Art.panel(ctx, px, py, pw, ph);
    drawText(ctx, card.title, W / 2, py + 22, s + 1, PAL.goldHi, 'center', '#000');
    // pictogram
    const ax = W / 2 - 30, ay = py + 60;
    if (card.art === 'block') { Art.block(ctx, ax, ay, 60, false); Art.switchTile(ctx, ax + 70 - 60, ay + 70 - 60 + 60, 0, false); Art.switchTile(ctx, ax - 70, ay, 60, false); }
    else if (card.art === 'chest') Art.chest(ctx, ax, ay, 60, 0);
    else if (card.art === 'coin') Art.coin(ctx, ax, ay, 60, this.t * 4);
    const lines = wrapText(card.body, s, pw - 40);
    let ty = py + 145;
    for (const ln of lines) { drawText(ctx, ln, W / 2, ty, s, PAL.ui, 'center'); ty += 8 * s + 2; }
    // dots
    for (let i = 0; i < this.cards.length; i++) {
      ctx.fillStyle = i === this.page ? PAL.gold : PAL.uiDark;
      ctx.fillRect(W / 2 - this.cards.length * 8 + i * 16 + 4, py + ph - 26, 8, 8);
    }
    if (Math.floor(this.t * 1.6) % 2 === 0)
      drawText(ctx, this.page < this.cards.length - 1 ? 'TAP TO CONTINUE' : 'TAP TO DELVE', W / 2, py + ph + 24, s, PAL.ui, 'center', '#000');
  },
  _next() {
    if (this.page >= this.cards.length) return; // already leaving
    Snd.select();
    this.page++;
    if (this.page >= this.cards.length) {
      Save.data.meta.seenIntro = true; Save.write();
      App.setScreen('menu');
    }
  },
  onTap() { this._next(); },
  onConfirm() { this._next(); },
  onDirPress() {}, onDirRelease() {},
  onBack() { Save.data.meta.seenIntro = true; Save.write(); App.setScreen('menu'); },
};

// ══ MENU ══════════════════════════════════════════════════════
const ScreenMenu = {
  t: 0,
  enter() {
    this.t = 0;
    Snd.playMusic('title');
    const items = [];
    // quick-continue straight into the next unfinished dungeon
    const all = allDungeons();
    const next = all.find(d => !Save.isDungeonDone(d.id) && isDungeonUnlocked(d.id, Save));
    const started = all.some(d => Save.isDungeonDone(d.id));
    const allDone = all.every(d => Save.isDungeonDone(d.id));
    if (next && started) {
      items.push({
        label: 'CONTINUE', sub: next.name, icon: 'play',
        action: () => App.setScreen('game', { gameMode: 'story', dungeonId: next.id }),
      });
    }
    items.push(
      { label: 'STORY', sub: allDone ? 'THE KEEP SHINES AGAIN' : 'THE KEEP OF ALARIC', icon: 'sword', action: () => App.setScreen('story') },
      { label: 'CHALLENGE', sub: 'ENDLESS DEPTHS', icon: 'depth', action: () => App.setScreen('challenge') },
      { label: 'TIMED RUSH', sub: 'RACE THE CLOCK', icon: 'clock', action: () => App.setScreen('timed') },
      { label: 'SHOP', sub: 'SPEND YOUR COINS', icon: 'cart', action: () => App.setScreen('shop') },
      { label: 'SETTINGS', icon: 'gear', action: () => App.setScreen('settings') },
    );
    if (Save.devOn()) items.push(
      { label: 'SPRITE LAB', sub: 'CHARACTERS + ANIMATIONS', icon: 'play', action: () => App.setScreen('spriteLab') },
      { label: 'TEST DUNGEON', sub: 'ALL SYSTEMS TESTING GROUND', icon: 'sword', action: () => App.setScreen('game', { gameMode: 'test' }) },
    );
    this.list = new MenuList(items);
  },
  update(dt) { this.t += dt; },
  draw(ctx, W, H) {
    drawBackdrop(ctx, W, H, this.t);
    const s = Math.max(2, Math.floor(Math.min(W, H) / 190));
    const ts = s + 2;
    drawText(ctx, 'DELVE', W / 2, 38, ts, PAL.goldHi, 'center', '#3a2808');
    // animated gold underline
    const ease = 1 - Math.pow(1 - Math.min(1, this.t / 0.45), 3);
    const uw = Math.round(textWidth('DELVE', ts) * ease);
    ctx.fillStyle = PAL.gold;
    ctx.fillRect(Math.round(W / 2 - uw / 2), 38 + 8 * ts + 4, uw, 3);
    coinsBadge(ctx, W - 16, 16, Save.data.coins, Math.max(2, s - 1));
    const iw = Math.min(W - 40, 360);
    const menuY = Math.max(80, H * 0.19);
    const itemH = Math.max(28, Math.min(26 + s * 8, Math.floor((H - menuY - 12 - (this.list.items.length - 1) * 10) / this.list.items.length)));
    this.list.draw(ctx, W / 2, menuY, iw, itemH, s, this.t);
  },
  onDirPress(dc, dr) { if (dr) this.list.nav(dr); },
  onDirRelease() {},
  onConfirm() { this.list.activate(); },
  onTap(x, y) { this.list.tapAt(x, y); },
  onBack() { App.setScreen('title'); Snd.back(); },
};

// ══ DUNGEON SELECT ════════════════════════════════════════════
const ScreenStory = {
  t: 0, sel: 0, cells: [],
  enter() {
    this.t = 0;
    Snd.playMusic('title');
    const all = allDungeons();
    let idx = all.findIndex(d => !Save.isDungeonDone(d.id) && isDungeonUnlocked(d.id, Save));
    if (idx < 0) idx = 0;
    this.sel = idx;
  },
  update(dt) { this.t += dt; },
  draw(ctx, W, H) {
    drawBackdrop(ctx, W, H, this.t);
    const s = Math.max(2, Math.floor(W / 220));
    const all = allDungeons();
    const allDone = all.every(d => Save.isDungeonDone(d.id));

    drawTextFit(ctx, 'THE KEEP OF ALARIC', W / 2, 30, W - 120, s + 1, PAL.goldHi, 'center', '#000');
    drawText(ctx, allDone ? 'THE KEEP SHINES AGAIN.' : 'CHOOSE YOUR DESCENT', W / 2, 30 + 8 * (s + 1) + 6, 1, PAL.uiDim, 'center');
    drawText(ctx, 'BACK', 16, 8, 1, PAL.uiDim, 'left');
    coinsBadge(ctx, W - 16, 4, Save.data.coins, 1);

    const cardW = Math.min(W - 32, 448);
    const cardH = 64, gap = 10;
    const x = (W - cardW) / 2;
    let y = Math.max(80, H * 0.12);
    this.cells = [];
    for (let i = 0; i < all.length; i++) {
      const d = all[i];
      const unlocked = isDungeonUnlocked(d.id, Save);
      const done = Save.isDungeonDone(d.id);
      const seld = i === this.sel;
      const appear = Math.min(1, Math.max(0, (this.t - i * 0.05) / 0.16));
      const ease = 1 - Math.pow(1 - appear, 3);
      const iy = Math.round(y + (1 - ease) * 14);
      this.cells.push({ x, y: iy, w: cardW, h: cardH });
      if (appear > 0) {
        ctx.save();
        ctx.globalAlpha = ease;
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x + 4, iy + 4, cardW, cardH);
        ctx.fillStyle = seld ? '#161226' : '#0d1120'; ctx.fillRect(x, iy, cardW, cardH);
        if (seld) { ctx.fillStyle = 'rgba(210,160,40,0.08)'; ctx.fillRect(x, iy, cardW, cardH); }
        ctx.fillStyle = seld ? PAL.gold : (done ? 'rgba(210,160,40,0.4)' : 'rgba(255,255,255,0.10)');
        ctx.fillRect(x, iy, cardW, 2); ctx.fillRect(x, iy + cardH - 2, cardW, 2);
        ctx.fillRect(x, iy, 2, cardH); ctx.fillRect(x + cardW - 2, iy, 2, cardH);
        if (seld) { ctx.fillStyle = PAL.goldHi; ctx.fillRect(x, iy, 5, cardH); }
        // relic icon (or padlock if sealed)
        const icoX = x + 16, icoY = iy + (cardH - 34) / 2;
        if (unlocked) {
          Art.item(ctx, d.item, icoX, icoY, 34);
        } else {
          ctx.fillStyle = PAL.uiDark;
          const lx = icoX + 6, ly2 = icoY + 6;
          ctx.fillRect(lx + 3, ly2, 14, 7);
          ctx.fillRect(lx + 3, ly2, 3, 10); ctx.fillRect(lx + 14, ly2, 3, 10);
          ctx.fillRect(lx, ly2 + 9, 20, 13);
        }
        const tx = x + 62;
        drawText(ctx, 'DUNGEON ' + (i + 1), tx, iy + 11, 1, PAL.uiDim, 'left');
        drawTextFit(ctx, unlocked ? d.name : '? ? ?', tx, iy + 23, cardW - 150, s, unlocked ? (seld ? PAL.goldHi : PAL.ui) : PAL.uiDim, 'left', '#000');
        drawTextFit(ctx, unlocked ? d.tagline : 'SEALED UNTIL THE PRIOR DELVE IS DONE', tx, iy + 23 + 8 * s + 4, cardW - 82, 1, PAL.uiDim, 'left');
        if (done) drawText(ctx, '★ CLEAR', x + cardW - 14, iy + 11, 1, PAL.gold, 'right');
        else if (unlocked) drawText(ctx, roomCount(d) + ' ROOMS', x + cardW - 14, iy + 11, 1, PAL.uiDim, 'right');
        ctx.restore();
      }
      y += cardH + gap;
    }
    // relics collected so far
    const items = Object.keys(Save.data.story.items);
    if (items.length) {
      let ix = 20;
      const iy = H - (App.isTouch ? 256 : 54);
      drawText(ctx, 'RELICS', ix, iy + 8, 1, PAL.uiDim, 'left');
      ix += 50;
      for (const it of items) { Art.item(ctx, it, ix, iy, 24); ix += 30; }
    }
  },
  _start() {
    const d = allDungeons()[this.sel];
    if (!d || !isDungeonUnlocked(d.id, Save)) { Snd.error(); return; }
    Snd.select();
    App.setScreen('game', { gameMode: 'story', dungeonId: d.id });
  },
  onDirPress(dc, dr) {
    const n = allDungeons().length;
    if (dr) { this.sel = (this.sel + dr + n) % n; Snd.blip(); }
  },
  onDirRelease() {},
  onConfirm() { this._start(); },
  onTap(x, y) {
    if (y < 40 && x < 90) { this.onBack(); return; }
    for (let i = 0; i < this.cells.length; i++) {
      const r = this.cells[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) { this.sel = i; this._start(); return; }
    }
  },
  onBack() { Snd.back(); App.setScreen('menu'); },
};

// ══ SETTINGS ══════════════════════════════════════════════════
// Secret dev-mode code. Client-side only — anyone reading the JS can find
// it, so it's obscurity (hidden entry + code), not real security. Change
// it here anytime. '3358' spells DELV on a phone keypad (D3 E3 L5 V8).
const ScreenSettings = {
  t: 0, sel: 0, scrollY: 0, confirmWipe: false, toast: null,

  enter() {
    this.t = 0; this.scrollY = 0; this.confirmWipe = false;
    this.toast = null;
    this._build();
    this.sel = this.rows.findIndex(r => r.type !== 'header');
  },

  _apply() { Save.write(); Snd.syncVolumes(); },
  _say(t) { this.toast = { text: t, t: 2.2 }; },

  _build() {
    const s = Save.data.settings;
    const rows = [];
    rows.push({ type: 'header', label: 'AUDIO' });
    rows.push({ type: 'toggle', label: 'MUSIC', get: () => s.music, set: v => { s.music = v; this._apply(); } });
    rows.push({ type: 'slider', label: 'MUSIC VOLUME', get: () => s.musicVol, set: v => { s.musicVol = v; this._apply(); }, dim: () => !s.music });
    rows.push({ type: 'toggle', label: 'SOUND FX', get: () => s.sfx, set: v => { s.sfx = v; this._apply(); } });
    rows.push({ type: 'slider', label: 'SFX VOLUME', get: () => s.sfxVol, set: v => { s.sfxVol = v; this._apply(); Snd.blip(); }, dim: () => !s.sfx });
    rows.push({ type: 'button', label: 'TEST SOUND EFFECT', action: () => { Snd.unlock(); Snd.syncVolumes(); if (!s.sfx) this._say('SOUND FX ARE OFF.'); else { Snd.coin(); this._say('SOUND EFFECT PLAYED.'); } } });
    rows.push({ type: 'header', label: 'GAME' });
    rows.push({ type: 'toggle', label: 'HAPTICS', get: () => s.haptics, set: v => { s.haptics = v; Save.write(); if (v) Platform.haptic(); } });
    rows.push({ type: 'toggle', label: 'REDUCED FLASH', get: () => s.reducedFlash, set: v => { s.reducedFlash = v; Save.write(); } });
    rows.push({ type: 'toggle', label: 'TUTORIAL TIPS', get: () => s.tips !== false, set: v => { s.tips = v; Save.write(); } });
    rows.push({ type: 'button', label: 'CONTROLS', action: () => { Snd.select(); App.setScreen('controls'); } });
    rows.push({ type: 'button', label: 'REPLAY INTRO', action: () => { Snd.select(); App.setScreen('intro'); } });
    rows.push({ type: 'header', label: 'ACCOUNT' });
    rows.push({ type: 'button', label: this.confirmWipe ? 'TAP AGAIN TO ERASE ALL' : 'RESET PROGRESS', danger: true, action: () => this._reset() });
    rows.push({ type: 'button', label: 'LOG OUT', disabled: true, action: () => this._say('ACCOUNTS ARE COMING SOON.') });
    // ── developer mode (separate save profile; account-gated at launch) ──
    rows.push({ type: 'header', label: 'DEVELOPER' });
    rows.push({ type: 'toggle', label: 'DEVELOPER MODE', get: () => Save.devOn(), set: v => this._setDev(v) });
    if (Save.devOn()) rows.push({ type: 'button', label: 'DEV TOOLS', gold: true, action: () => { Snd.select(); App.setScreen('dev'); } });
    this.rows = rows;
  },

  _setDev(on) {
    Save.setDevMode(on);          // swaps to the separate dev/normal profile
    Snd.syncVolumes();
    Art.setSkin(Save.data.shop.skin);
    Art.setTheme(Save.data.shop.theme);
    Snd.select();
    this.confirmWipe = false;
    this._build();
    this._say(on ? 'DEVELOPER MODE ON — SEPARATE PROFILE' : 'DEVELOPER MODE OFF');
  },

  _reset() {
    if (!this.confirmWipe) { this.confirmWipe = true; Snd.blip(); this._build(); return; }
    Save.wipe();                  // wipes only the active profile
    Snd.syncVolumes();
    Art.setSkin(Save.data.shop.skin);
    Art.setTheme(Save.data.shop.theme);
    Snd.error();
    this.confirmWipe = false;
    this._build();
    this._say('PROGRESS ERASED.');
  },

  _focusable(i) { const r = this.rows[i]; return r && r.type !== 'header'; },

  update(dt) {
    this.t += dt;
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) this.toast = null; }
  },

  // ── layout (scrollable card list) ──
  _layout(W, H) {
    const top = 78;
    let y = top - this.scrollY;
    const out = [];
    for (const r of this.rows) {
      const h = r.type === 'header' ? 30 : 54;
      out.push({ row: r, y, h });
      y += h + 8;
    }
    this.contentH = y + this.scrollY - top;
    this.viewH = H - top - 40;
    return out;
  },
  _clampScroll() { this.scrollY = Math.max(0, Math.min(Math.max(0, this.contentH - this.viewH), this.scrollY)); },
  _ensureVisible() {
    const lay = this._layout(App.W, App.H);
    const it = lay[this.sel]; if (!it) return;
    if (it.y < 84) this.scrollY -= (84 - it.y);
    else if (it.y + it.h > App.H - 44) this.scrollY += it.y + it.h - (App.H - 44);
    this._clampScroll();
  },

  draw(ctx, W, H) {
    drawBackdrop(ctx, W, H, this.t);
    const s = Math.max(2, Math.floor(W / 240));
    const lay = this._layout(W, H);
    const pw = Math.min(W - 28, 420), px = (W - pw) / 2;

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 70, W, H - 70); ctx.clip();
    for (let i = 0; i < lay.length; i++) {
      const { row, y, h } = lay[i];
      if (y + h < 60 || y > H) continue;
      if (row.type === 'header') { drawText(ctx, row.label, px + 4, y + 12, 1, PAL.uiDim, 'left'); continue; }
      const seld = i === this.sel;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(px + 4, y + 4, pw, h);
      ctx.fillStyle = seld ? '#161226' : '#0d1120'; ctx.fillRect(px, y, pw, h);
      if (seld) { ctx.fillStyle = 'rgba(210,160,40,0.08)'; ctx.fillRect(px, y, pw, h); }
      const border = row.danger ? PAL.red : (row.gold ? PAL.gold : (seld ? PAL.gold : 'rgba(255,255,255,0.10)'));
      ctx.fillStyle = border;
      ctx.fillRect(px, y, pw, 2); ctx.fillRect(px, y + h - 2, pw, 2);
      ctx.fillRect(px, y, 2, h); ctx.fillRect(px + pw - 2, y, 2, h);
      if (seld) { ctx.fillStyle = row.danger ? PAL.red : PAL.goldHi; ctx.fillRect(px, y, 5, h); }

      const labelCol = row.disabled ? PAL.uiDim : row.danger ? '#e06a58' : row.gold ? PAL.goldHi : (seld ? PAL.goldHi : PAL.ui);
      const midY = y + Math.floor(h / 2);

      if (row.type === 'toggle') {
        drawTextFit(ctx, row.label, px + 16, midY - 6, pw - 120, s, labelCol, 'left');
        const on = row.get();
        const pw2 = 54, ph2 = 24, tx = px + pw - pw2 - 14, ty = midY - ph2 / 2;
        ctx.fillStyle = on ? 'rgba(210,160,40,0.25)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(tx, ty, pw2, ph2);
        ctx.fillStyle = on ? PAL.gold : 'rgba(255,255,255,0.14)';
        ctx.fillRect(tx, ty, pw2, 2); ctx.fillRect(tx, ty + ph2 - 2, pw2, 2);
        ctx.fillRect(tx, ty, 2, ph2); ctx.fillRect(tx + pw2 - 2, ty, 2, ph2);
        // knob
        ctx.fillStyle = on ? PAL.goldHi : PAL.uiDim;
        ctx.fillRect(on ? tx + pw2 - 20 : tx + 4, ty + 4, 16, ph2 - 8);
        drawText(ctx, on ? 'ON' : 'OFF', on ? tx + 6 : tx + pw2 - 6, midY - 3, 1, on ? PAL.goldHi : PAL.uiDim, on ? 'left' : 'right');
      } else if (row.type === 'slider') {
        const dim = row.dim && row.dim();
        drawText(ctx, row.label, px + 16, y + 10, 1, dim ? PAL.uiDim : (seld ? PAL.goldHi : PAL.ui), 'left');
        const val = row.get();
        const trackX = px + 16, trackW = pw - 84, trackY = y + h - 18;
        row._track = { x: trackX, w: trackW };
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(trackX, trackY, trackW, 6);
        ctx.fillStyle = dim ? PAL.uiDark : (seld ? PAL.goldHi : PAL.gold);
        ctx.fillRect(trackX, trackY, Math.round(trackW * val), 6);
        // knob
        const kx = trackX + Math.round(trackW * val);
        ctx.fillStyle = dim ? PAL.uiDim : PAL.goldHi;
        ctx.fillRect(kx - 3, trackY - 4, 7, 14);
        drawText(ctx, Math.round(val * 100) + '%', px + pw - 14, trackY - 3, 1, dim ? PAL.uiDim : PAL.ui, 'right');
      } else { // button
        drawTextFit(ctx, row.label, px + pw / 2, midY - 3 * s, pw - 32, s, labelCol, 'center', '#000');
      }
    }
    ctx.restore();

    // header bar
    ctx.fillStyle = 'rgba(4,5,10,0.92)'; ctx.fillRect(0, 0, W, 70);
    drawText(ctx, 'SETTINGS', W / 2, 24, s + 1, PAL.goldHi, 'center', '#000');
    drawText(ctx, '◀ BACK', 16, 12, s, PAL.uiDim, 'left');

    if (this.contentH > this.viewH) {
      const frac = this.viewH / this.contentH, barH = Math.max(24, this.viewH * frac);
      const barY = 78 + (this.scrollY / (this.contentH - this.viewH)) * (this.viewH - barH);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(W - 5, barY, 3, barH);
    }

    drawText(ctx, 'DELVE V1.0', W / 2, H - 22, 1, PAL.uiDark, 'center');

    if (this.toast) {
      const tw = textWidth(this.toast.text, 2) + 24;
      ctx.fillStyle = 'rgba(4,5,10,0.94)'; ctx.fillRect((W - tw) / 2, H - 96, Math.min(tw, W - 20), 28);
      drawTextFit(ctx, this.toast.text, W / 2, H - 89, W - 36, 2, PAL.goldHi, 'center');
    }
  },

  // ── input ──
  onDirPress(dc, dr) {
    if (dr) {
      let i = this.sel;
      do { i += dr; } while (i >= 0 && i < this.rows.length && !this._focusable(i));
      if (i >= 0 && i < this.rows.length) { this.sel = i; this.confirmWipe = false; this._build(); Snd.blip(); this._ensureVisible(); }
    } else if (dc) {
      const row = this.rows[this.sel];
      if (row && row.type === 'slider') {
        const v = Math.max(0, Math.min(1, Math.round((row.get() + dc * 0.1) * 10) / 10));
        row.set(v); Snd.tick();
      }
    }
  },
  onDirRelease() {},
  onConfirm() {
    const row = this.rows[this.sel];
    if (!row) return;
    if (row.type === 'toggle') { row.set(!row.get()); Snd.select(); this.confirmWipe = false; this._build(); }
    else if (row.type === 'button') row.action();
    else if (row.type === 'slider') { row.set(row.get() >= 1 ? 0 : Math.min(1, row.get() + 0.1)); }
  },
  onScroll(dy) { this.scrollY -= dy; this._clampScroll(); },

  onTap(x, y) {
    if (y < 40 && x < 110) { this.onBack(); return; }
    const lay = this._layout(App.W, App.H);
    const pw = Math.min(App.W - 28, 420), px = (App.W - pw) / 2;
    for (let i = 0; i < lay.length; i++) {
      const { row, y: ry, h } = lay[i];
      if (row.type === 'header' || ry < 60) continue;
      if (x >= px && x < px + pw && y >= ry && y < ry + h) {
        this.sel = i;
        if (row.type === 'toggle') { row.set(!row.get()); Snd.select(); this.confirmWipe = false; this._build(); }
        else if (row.type === 'button') row.action();
        else if (row.type === 'slider' && row._track) {
          const val = Math.max(0, Math.min(1, (x - row._track.x) / row._track.w));
          row.set(Math.round(val * 20) / 20); Snd.tick();
        }
        return;
      }
    }
  },
  onBack() { Snd.back(); App.setScreen('menu'); },
};

// ══ CONTROLS (reachable from SETTINGS) ════════════════════════
const ScreenControls = {
  t: 0,
  enter() { this.t = 0; this._build(); },
  _build() {
    const scheme = Save.data.settings.controlScheme || 'joystick';
    const items = [
      {
        label: 'MOVEMENT: ' + (scheme === 'dpad' ? 'D-PAD' : 'JOYSTICK'),
        sub: scheme === 'dpad' ? 'FIXED 8-WAY DIRECTION PAD' : 'FLOATING ANALOG STICK - TOUCH & DRAG',
        icon: 'play',
        action: () => this._toggleScheme(),
      },
      { label: 'BACK', action: () => { Snd.back(); App.setScreen('settings'); } },
    ];
    this.list = new MenuList(items);
    if (this._sel != null) this.list.sel = Math.min(this._sel, items.length - 1);
  },
  _toggleScheme() {
    const cur = Save.data.settings.controlScheme || 'joystick';
    Save.data.settings.controlScheme = cur === 'dpad' ? 'joystick' : 'dpad';
    Save.write();
    App.applyControlScheme();
    Snd.select();
    this._sel = this.list.sel;
    this._build();
  },
  update(dt) { this.t += dt; },
  draw(ctx, W, H) {
    drawBackdrop(ctx, W, H, this.t);
    const s = Math.max(2, Math.floor(W / 240));
    drawText(ctx, 'CONTROLS', W / 2, 34, s + 1, PAL.goldHi, 'center', '#000');
    drawText(ctx, 'CHOOSE HOW YOU MOVE', W / 2, 34 + 8 * (s + 1) + 6, 1, PAL.uiDim, 'center');
    const iw = Math.min(W - 40, 380);
    this.list.draw(ctx, W / 2, Math.max(112, H * 0.22), iw, 40 + s * 8, s, this.t);
    drawText(ctx, '◀ BACK', 16, 12, s, PAL.uiDim, 'left');
  },
  onDirPress(dc, dr) { if (dr) { this.list.nav(dr); this._sel = this.list.sel; } },
  onDirRelease() {},
  onConfirm() { this._sel = this.list.sel; this.list.activate(); },
  onTap(x, y) { if (y < 40 && x < 110) { this.onBack(); return; } this._sel = this.list.sel; this.list.tapAt(x, y); },
  onBack() { Snd.back(); App.setScreen('settings'); },
};

// ══ DEV TOOLS (reachable from the DEVELOPER MODE section) ═════
const ScreenDev = {
  t: 0,
  enter() { this.t = 0; this._build(); },
  _speedName() {
    const m = App.moveMs;
    return m <= 220 ? 'FAST' : m >= 480 ? 'SLOW' : 'NORMAL';
  },
  _build() {
    // dev mode already grants infinite coins + all levels; these are the
    // extra testing shortcuts (relics, shop, walk speed)
    const grantAllItems = () => { for (const k in ITEMS) { Save.grantItem(k); Save.setEquipped(k, true); } };
    const items = [
      { label: 'GRANT + EQUIP ALL RELICS', action: () => { grantAllItems(); Snd.itemGet(); this._say('RELICS GRANTED'); } },
      { label: 'CLEAR RELICS', action: () => { Save.data.story.items = {}; Save.data.story.equipped = {}; Save.write(); Snd.back(); this._say('RELICS CLEARED'); } },
      { label: 'UNLOCK SHOP ITEMS', action: () => { for (const id in SKINS) if (!Save.owns(id)) Save.data.shop.owned.push(id); for (const id in THEMES) if (!Save.owns(id)) Save.data.shop.owned.push(id); Save.addHints(20); Save.write(); Snd.buy(); this._say('SHOP UNLOCKED'); } },
      { label: 'WALK SPEED: ' + this._speedName(), action: () => { App.moveMs = App.moveMs <= 220 ? 350 : App.moveMs >= 480 ? 200 : 500; Snd.blip(); this._build(); } },
      { label: 'TURN OFF DEV MODE', danger: true, action: () => { Save.setDevMode(false); Art.setSkin(Save.data.shop.skin); Art.setTheme(Save.data.shop.theme); Snd.back(); App.setScreen('settings'); } },
      { label: 'BACK', action: () => { Snd.back(); App.setScreen('settings'); } },
    ];
    this.list = new MenuList(items);
    if (this._sel != null) this.list.sel = Math.min(this._sel, items.length - 1);
  },
  _say(t) { this.toast = { text: t, t: 1.8 }; },
  update(dt) { this.t += dt; if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) this.toast = null; } },
  draw(ctx, W, H) {
    drawBackdrop(ctx, W, H, this.t);
    const s = Math.max(2, Math.floor(W / 240));
    drawText(ctx, 'DEV TOOLS', W / 2, 34, s + 1, PAL.goldHi, 'center', '#000');
    drawText(ctx, 'FOR TESTING - HANDLE WITH CARE', W / 2, 34 + 8 * (s + 1) + 6, 1, PAL.uiDim, 'center');
    const iw = Math.min(W - 40, 360);
    this.list.draw(ctx, W / 2, Math.max(96, H * 0.15), iw, 30 + s * 8, s, this.t);
    if (this.toast) {
      const tw = textWidth(this.toast.text, 2) + 24;
      ctx.fillStyle = 'rgba(4,5,10,0.94)'; ctx.fillRect((W - tw) / 2, H - 70, tw, 28);
      drawText(ctx, this.toast.text, W / 2, H - 63, 2, PAL.goldHi, 'center');
    }
  },
  onDirPress(dc, dr) { if (dr) { this.list.nav(dr); this._sel = this.list.sel; } },
  onDirRelease() {},
  onConfirm() { this._sel = this.list.sel; this.list.activate(); },
  onTap(x, y) { this._sel = this.list.sel; this.list.tapAt(x, y); },
  onBack() { Snd.back(); App.setScreen('settings'); },
};

// ══ SPRITE LAB (developer mode only) ══════════════════════════
const SPRITE_LAB_CHARACTERS = [
  { id: 'hero', name: 'DELVER', sub: '12 ANIMATIONS' },
  { id: 'skeleton', name: 'SKELETON', sub: '9 ANIMATIONS' },
  { id: 'tribalist', name: 'MASKED TRIBALIST', sub: '4 ANIMATIONS' },
  { id: 'ripper', name: 'EARTH RIPPER', sub: '9 ANIMATIONS' },
];

const SPRITE_LAB_ANIMS = {
  hero: [
    { label: 'IDLE UP', dir: 'up', kind: 'idle' },
    { label: 'IDLE DOWN', dir: 'down', kind: 'idle' },
    { label: 'IDLE LEFT', dir: 'left', kind: 'idle' },
    { label: 'IDLE RIGHT', dir: 'right', kind: 'idle' },
    { label: 'WALK UP', dir: 'up', kind: 'walk' },
    { label: 'WALK DOWN', dir: 'down', kind: 'walk' },
    { label: 'WALK LEFT', dir: 'left', kind: 'walk' },
    { label: 'WALK RIGHT', dir: 'right', kind: 'walk' },
    { label: 'PUSH UP', dir: 'up', kind: 'push' },
    { label: 'PUSH DOWN', dir: 'down', kind: 'push' },
    { label: 'PUSH LEFT', dir: 'left', kind: 'push' },
    { label: 'PUSH RIGHT', dir: 'right', kind: 'push' },
  ],
  skeleton: [
    { label: 'IDLE UP', dir: 'up', kind: 'idle' },
    { label: 'IDLE DOWN', dir: 'down', kind: 'idle' },
    { label: 'IDLE LEFT', dir: 'left', kind: 'idle' },
    { label: 'IDLE RIGHT', dir: 'right', kind: 'idle' },
    { label: 'ATTACK UP', dir: 'up', kind: 'attackFrames' },
    { label: 'ATTACK DOWN', dir: 'down', kind: 'attackFrames' },
    { label: 'ATTACK LEFT', dir: 'left', kind: 'attackFrames' },
    { label: 'ATTACK RIGHT', dir: 'right', kind: 'attackFrames' },
    { label: 'RIG ATTACK RIGHT', dir: 'right', kind: 'rigAttack' },
  ],
  tribalist: [
    { label: 'IDLE UP', dir: 'up', kind: 'idle' },
    { label: 'IDLE DOWN', dir: 'down', kind: 'idle' },
    { label: 'IDLE LEFT', dir: 'left', kind: 'idle' },
    { label: 'IDLE RIGHT', dir: 'right', kind: 'idle' },
  ],
  // The Ripper's "animations" are its ambush states: it plods, tells, digs
  // under, tunnels, bursts out, and reels when it whiffs. Each entry below
  // drives Combat._drawRipper with that state so the lab shows the real VFX
  // (mound, dirt, tunnel marks, dizzy stars) exactly as combat renders them.
  ripper: [
    { label: 'IDLE UP', dir: 'up', kind: 'idle' },
    { label: 'IDLE DOWN', dir: 'down', kind: 'idle' },
    { label: 'IDLE LEFT', dir: 'left', kind: 'idle' },
    { label: 'IDLE RIGHT', dir: 'right', kind: 'idle' },
    { label: 'LOCK-ON TELL', dir: 'down', kind: 'lockon' },
    { label: 'BURROW IN', dir: 'down', kind: 'burrow' },
    { label: 'TUNNELLING', dir: 'down', kind: 'under' },
    { label: 'BURST OUT', dir: 'down', kind: 'emerge' },
    { label: 'STUNNED', dir: 'down', kind: 'stun' },
  ],
};

function spriteLabFace(dir) {
  return {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  }[dir] || [0, 1];
}

// Direction-specific normalization keeps each generated frame at frame 1's
// skull scale, sole baseline, and palette without altering the source PNGs.
const SKELETON_ATTACKS = {
  right: {
    prefix: 'skeleton_attack_right_', gameBox: 1.61,
    scale: [1, 1.036, 1.066, 1.142, 1.237, 1.345, 1.365, 1.336, 1.303, 1.303],
    feet: [1079, 1051, 1052, 1077, 998, 954, 957, 957, 961, 960].map(v => v / 1254),
    color: [
      [1, 1, 1], [0.988, 1.003, 0.981], [0.965, 0.982, 0.956], [0.946, 0.982, 0.949],
      [0.910, 0.968, 0.928], [0.898, 0.961, 0.904], [0.868, 0.942, 0.877],
      [0.862, 0.959, 0.894], [0.919, 0.971, 0.955], [0.907, 0.984, 0.951],
    ],
  },
  up: {
    prefix: 'skeleton_attack_up_', gameBox: 1.98,
    scale: [1, 1.015, 1.011, 1.074, 1.062, 1.150, 1.145, 1.127, 1.140, 1.366],
    feet: [940, 933, 933, 929, 949, 958, 957, 957, 956, 927].map(v => v / 1254),
    color: [
      [1, 1, 1], [0.972, 1.002, 0.981], [0.947, 0.995, 0.958], [0.926, 0.981, 0.940],
      [0.902, 0.980, 0.940], [0.919, 1.033, 1.011], [0.898, 1.048, 1.052],
      [0.885, 1.059, 1.037], [0.894, 1.050, 1.037], [0.968, 1.102, 1.151],
    ],
  },
  down: {
    prefix: 'skeleton_attack_down_', gameBox: 2.15,
    scale: [1, 1, 1.136, 1.141, 1.251, 1.289, 1.199, 1.194, 1.227, 1.183],
    feet: [946/1315, 946/1315, 915/1312, 924/1312, 945/1311, 1040/1312, 1115/1312, 1117/1312, 1056/1312, 980/1312],
    color: [
      [1, 1, 1], [0.971, 0.989, 0.965], [0.948, 0.975, 0.911], [0.947, 0.967, 0.901],
      [0.938, 0.995, 0.941], [0.915, 0.965, 0.899], [0.879, 0.907, 0.826],
      [0.898, 0.959, 0.887], [0.952, 1.044, 0.999], [1.047, 1.104, 1.154],
    ],
  },
};
const SKELETON_ATTACK_TINTED = {};

function spriteLabAttackFrameAt(t) {
  const liftFrames = 5, liftFps = 12, strikeFps = 18;
  const liftTime = liftFrames / liftFps;
  const cycleTime = liftTime + (10 - liftFrames) / strikeFps;
  const cycle = t % cycleTime;
  if (cycle < liftTime) return Math.min(liftFrames - 1, Math.floor(cycle * liftFps));
  return Math.min(9, liftFrames + Math.floor((cycle - liftTime) * strikeFps));
}

function spriteLabAttackImage(img, direction, frame) {
  if (frame === 0 || !Art._ready(img)) return img;
  const cacheKey = direction + frame;
  if (SKELETON_ATTACK_TINTED[cacheKey]) return SKELETON_ATTACK_TINTED[cacheKey];
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const c2 = cv.getContext('2d');
  c2.drawImage(img, 0, 0);
  try {
    const pixels = c2.getImageData(0, 0, cv.width, cv.height);
    const d = pixels.data, gain = SKELETON_ATTACKS[direction].color[frame];
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      // Keep the cyan wind slash unchanged; color-match only the skeleton and sword.
      if (d[i + 2] > d[i + 1] && d[i + 1] > d[i] && d[i + 2] > 130) continue;
      d[i] = Math.min(255, Math.round(d[i] * gain[0]));
      d[i + 1] = Math.min(255, Math.round(d[i + 1] * gain[1]));
      d[i + 2] = Math.min(255, Math.round(d[i + 2] * gain[2]));
    }
    c2.putImageData(pixels, 0, 0);
  } catch (e) {
    return img;
  }
  SKELETON_ATTACK_TINTED[cacheKey] = cv;
  return cv;
}

function drawSpriteLabCharacter(ctx, id, anim, t, x, y, tile) {
  if (typeof SpriteLabReferenceAnimations !== 'undefined' &&
      SpriteLabReferenceAnimations.draw(ctx, id, anim, t, x, y, tile)) return;
  if (id === 'hero') {
    const isHorizontalWalk = anim.dir === 'right' || anim.dir === 'left';
    const isUpWalk = anim.dir === 'up';
    const isDownWalk = anim.dir === 'down';
    const walkFrameCount = isUpWalk ? 4 : isDownWalk ? 9 : 8;
    const frame = Math.floor(t * 12) % walkFrameCount;
    const walkSheet = isUpWalk ? Art.img.player_walk_up_review :
      isDownWalk ? Art.img.player_walk_down_review :
      Art.img.player_walk_right_review;
    if (anim.kind === 'walk' && (isHorizontalWalk || isUpWalk || isDownWalk) &&
        Art._ready(walkSheet)) {
      const sw = Math.floor(walkSheet.naturalWidth / walkFrameCount);
      const sh = walkSheet.naturalHeight;
      const dh = Math.round(tile * 1.05);
      const dw = Math.round(dh * sw / sh);
      const dx = Math.round(x - dw / 2);
      const bob = isHorizontalWalk
        ? [0, 0, 1, 0, 0, 0, 1, 0][frame] * Math.max(1, Math.round(tile / 30))
        : 0;
      const dy = Math.round(y - dh + bob);
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, y - 3, tile * 0.28, tile * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.imageSmoothingEnabled = false;
      if (anim.dir === 'left') {
        ctx.save();
        ctx.translate(dx + dw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(walkSheet, frame * sw, 0, sw, sh, 0, 0, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(walkSheet, frame * sw, 0, sw, sh, dx, dy, dw, dh);
      }
      return;
    }
    Art.hero(ctx, anim.dir, frame, Math.round(x - tile / 2), Math.round(y - tile),
      tile, anim.kind === 'push', anim.kind === 'idle');
    return;
  }
  if (id === 'skeleton') {
    if (anim.kind === 'attackFrames') {
      const frame = spriteLabAttackFrameAt(t);
      const sourceDir = anim.dir === 'left' ? 'right' : anim.dir;
      const attack = SKELETON_ATTACKS[sourceDir];
      const img = Art.img[attack.prefix + String(frame + 1).padStart(2, '0')];
      if (Art._ready(img)) {
        const scale = attack.scale[frame];
        const drawImg = spriteLabAttackImage(img, sourceDir, frame);
        ctx.imageSmoothingEnabled = false;
        // Scale around the feet instead of the canvas center so the downswing's
        // head movement remains motion, not an apparent full-body shrink.
        const box = tile * 2.65 * scale;
        const iw = drawImg.naturalWidth || drawImg.width;
        const ih = drawImg.naturalHeight || drawImg.height;
        const fit = Math.min(box / iw, box / ih);
        const dw = Math.round(iw * fit), dh = Math.round(ih * fit);
        // Keep the sole line fixed to frame 1 while letting the head, torso,
        // sword, and wind slash extend freely above and outside the usual box.
        const frameOneFeetY = y - tile * 0.28
          + (attack.feet[0] - 0.5) * tile * 2.65;
        const cy = frameOneFeetY
          - (attack.feet[frame] - 0.5) * box;
        const dy = Math.round(cy - dh / 2);
        if (anim.dir === 'left') {
          ctx.save();
          ctx.translate(Math.round(x), 0);
          ctx.scale(-1, 1);
          ctx.drawImage(drawImg, Math.round(-dw / 2), dy, dw, dh);
          ctx.restore();
        } else {
          ctx.drawImage(drawImg, Math.round(x - dw / 2), dy, dw, dh);
        }
      }
      return;
    }
    if (anim.kind === 'rigAttack') {
      SkeletonRig.drawAttackRight(ctx, x, y, tile, (t * 1.35) % 1);
      return;
    }
    const face = spriteLabFace(anim.dir);
    const attacking = anim.kind === 'attack';
    const cycle = (t * 1.65) % 1;
    const e = {
      faceX: face[0], faceY: face[1],
      state: attacking ? 'windup' : 'idle',
      timer: attacking ? Combat.ENEMY.skeleton.windup * (1 - cycle) : 0,
    };
    Combat._drawSkeleton(ctx, Math.round(x - tile / 2), Math.round(y - tile), tile, e);
    return;
  }
  if (id === 'ripper') {
    const cfg = Combat.ENEMY.ripper;
    const face = spriteLabFace(anim.dir);
    const kind = anim.kind === 'idle' ? 'idle' : anim.kind;
    // Loop each timed state on its real duration so the lab plays it back at
    // the same pace combat does; 'under' and 'idle' just run continuously.
    const dur = kind === 'burrow' ? cfg.burrowStartDuration
      : kind === 'emerge' ? cfg.emergeRise
      : kind === 'stun' ? cfg.stunDuration
      : kind === 'lockon' ? cfg.lockOnDuration : 0;
    // these states count their timer DOWN, so invert the loop phase
    const timer = dur ? dur * (1 - ((t / (dur + 0.45)) % 1)) : 0;
    const e = {
      type: 'ripper', x: 0, y: 0,
      faceX: face[0], faceY: face[1],
      state: kind, timer, flash: 0, trail: [],
    };
    Combat._drawRipper(ctx, Math.round(x - tile / 2), Math.round(y - tile), tile, e, t);
    return;
  }
  const face = spriteLabFace(anim.dir);
  Combat._drawDarter(ctx, Math.round(x - tile / 2), Math.round(y - tile), tile, {
    faceX: face[0], faceY: face[1], state: 'idle',
  });
}

const ScreenSpriteLab = {
  t: 0, sel: 0, cards: [], scrollX: 0,
  enter() {
    if (!Save.devOn()) { App.setScreen('menu'); return; }
    this.t = 0; this.sel = 0; this.cards = []; this.scrollX = 0;
  },
  update(dt) { this.t += dt; },

  // Three cards stay visible at a time; any beyond that live off to the right
  // and are reached by scrolling, so the roster can grow without cards being
  // clipped off the screen edge.
  _metrics(W, H) {
    const gap = 14;
    const totalW = Math.min(W - 32, 660);
    const cardW = Math.floor((totalW - gap * 2) / 3);
    const cardH = Math.min(230, H - 105);
    const n = SPRITE_LAB_CHARACTERS.length;
    const contentW = n * cardW + (n - 1) * gap;
    const viewW = Math.min(contentW, cardW * 3 + gap * 2);
    const viewX = Math.round((W - viewW) / 2);
    const y = Math.max(78, Math.round((H - cardH) / 2 + 18));
    return { gap, cardW, cardH, contentW, viewW, viewX, y, maxScroll: Math.max(0, contentW - viewW) };
  },
  _clamp(m) { this.scrollX = Math.max(0, Math.min(m.maxScroll, this.scrollX)); },
  // keep the highlighted card fully inside the viewport
  _ensureVisible() {
    const m = this._metrics(App.W, App.H);
    const left = this.sel * (m.cardW + m.gap);
    const right = left + m.cardW;
    if (left < this.scrollX) this.scrollX = left;
    else if (right > this.scrollX + m.viewW) this.scrollX = right - m.viewW;
    this._clamp(m);
  },

  draw(ctx, W, H) {
    drawBackdrop(ctx, W, H, this.t);
    const s = Math.max(2, Math.floor(W / 240));
    drawText(ctx, 'SPRITE LAB', W / 2, 24, s + 1, PAL.goldHi, 'center', '#000');
    drawText(ctx, 'CHOOSE A CHARACTER', W / 2, 24 + 8 * (s + 1) + 5, 1, PAL.uiDim, 'center');
    drawText(ctx, '◀ BACK', 14, 10, 1, PAL.uiDim, 'left');

    const m = this._metrics(W, H);
    this._clamp(m);
    const { gap, cardW, cardH, viewX, viewW, y } = m;
    this.cards = [];
    ctx.save();
    ctx.beginPath(); ctx.rect(viewX, y - 6, viewW, cardH + 12); ctx.clip();
    for (let i = 0; i < SPRITE_LAB_CHARACTERS.length; i++) {
      const ch = SPRITE_LAB_CHARACTERS[i];
      const x = viewX + i * (cardW + gap) - this.scrollX;
      this.cards.push({ x, y, w: cardW, h: cardH });
      if (x + cardW < viewX - 4 || x > viewX + viewW + 4) continue;   // fully off-view
      const selected = i === this.sel;
      Art.panel(ctx, x, y, cardW, cardH);
      if (selected) {
        ctx.fillStyle = PAL.goldHi;
        ctx.fillRect(x, y, cardW, 3); ctx.fillRect(x, y + cardH - 3, cardW, 3);
        ctx.fillRect(x, y, 3, cardH); ctx.fillRect(x + cardW - 3, y, 3, cardH);
      }
      const anim = SPRITE_LAB_ANIMS[ch.id][0];
      const tile = Math.min(92, cardW * 0.55, cardH * 0.50);
      drawSpriteLabCharacter(ctx, ch.id, anim, this.t, x + cardW / 2, y + cardH * 0.58, tile);
      drawTextFit(ctx, ch.name, x + cardW / 2, y + 16, cardW - 20, s, selected ? PAL.goldHi : PAL.ui, 'center', '#000');
      drawTextFit(ctx, ch.sub, x + cardW / 2, y + cardH - 24, cardW - 16, 1, PAL.uiDim, 'center');
    }
    ctx.restore();

    if (m.maxScroll > 0) {
      // edge arrows showing there is more roster either way
      const midY = y + cardH / 2;
      ctx.fillStyle = this.scrollX > 1 ? PAL.goldHi : PAL.uiDark;
      drawText(ctx, '◀', viewX - 16, midY - 4, 1, ctx.fillStyle, 'center');
      ctx.fillStyle = this.scrollX < m.maxScroll - 1 ? PAL.goldHi : PAL.uiDark;
      drawText(ctx, '▶', viewX + viewW + 16, midY - 4, 1, ctx.fillStyle, 'center');
      // scrollbar under the strip
      const barW = Math.max(28, viewW * (viewW / m.contentW));
      const barX = viewX + (m.maxScroll ? (this.scrollX / m.maxScroll) * (viewW - barW) : 0);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(viewX, y + cardH + 10, viewW, 3);
      ctx.fillStyle = PAL.gold; ctx.fillRect(barX, y + cardH + 10, barW, 3);
    }
  },
  _open() {
    const ch = SPRITE_LAB_CHARACTERS[this.sel];
    if (!ch) return;
    Snd.select();
    App.setScreen('spriteDetail', { character: ch.id });
  },
  onDirPress(dc, dr) {
    if (!dc) return;
    this.sel = (this.sel + dc + SPRITE_LAB_CHARACTERS.length) % SPRITE_LAB_CHARACTERS.length;
    this._ensureVisible();
    Snd.blip();
  },
  onDirRelease() {},
  onConfirm() { this._open(); },
  // drag sideways / wheel to run through the roster
  onScrollX(dx) {
    const m = this._metrics(App.W, App.H);
    if (!m.maxScroll) return;
    this.scrollX -= dx;
    this._clamp(m);
  },
  onTap(x, y) {
    if (y < 42 && x < 105) { this.onBack(); return; }
    const m = this._metrics(App.W, App.H);
    // tapping the edge arrows pages the strip by one card
    if (m.maxScroll > 0 && y >= m.y && y <= m.y + m.cardH) {
      if (x < m.viewX) { this.scrollX -= m.cardW + m.gap; this._clamp(m); Snd.blip(); return; }
      if (x > m.viewX + m.viewW) { this.scrollX += m.cardW + m.gap; this._clamp(m); Snd.blip(); return; }
    }
    for (let i = 0; i < this.cards.length; i++) {
      const r = this.cards[i];
      // ignore taps on the slivers scrolled outside the viewport
      if (r.x + r.w <= m.viewX || r.x >= m.viewX + m.viewW) continue;
      if (x >= Math.max(r.x, m.viewX) && x < Math.min(r.x + r.w, m.viewX + m.viewW) &&
          y >= r.y && y < r.y + r.h) {
        this.sel = i; this._ensureVisible(); this._open(); return;
      }
    }
  },
  onBack() { Snd.back(); App.setScreen('menu'); },
};

const ScreenSpriteDetail = {
  t: 0, sel: 0, character: 'hero', buttons: [],
  enter(params) {
    if (!Save.devOn()) { App.setScreen('menu'); return; }
    this.character = params.character && SPRITE_LAB_ANIMS[params.character] ? params.character : 'hero';
    this.t = 0; this.sel = 0; this.buttons = [];
  },
  update(dt) { this.t += dt; },
  draw(ctx, W, H) {
    drawBackdrop(ctx, W, H, this.t);
    const ch = SPRITE_LAB_CHARACTERS.find(c => c.id === this.character);
    const anims = SPRITE_LAB_ANIMS[this.character];
    const s = Math.max(2, Math.floor(W / 240));
    drawText(ctx, ch.name + ' ANIMATIONS', W / 2, 20, s + 1, PAL.goldHi, 'center', '#000');
    drawText(ctx, 'TAP AN ANIMATION TO PLAY IT', W / 2, 20 + 8 * (s + 1) + 5, 1, PAL.uiDim, 'center');
    drawText(ctx, '◀ CHARACTERS', 14, 10, 1, PAL.uiDim, 'left');

    const previewW = Math.min(260, W * 0.34);
    const previewX = 20, previewY = 76, previewH = H - previewY - 18;
    Art.panel(ctx, previewX, previewY, previewW, previewH);
    const anim = anims[this.sel];
    const tile = Math.min(112, previewW * 0.55, previewH * 0.58);
    drawSpriteLabCharacter(ctx, this.character, anim, this.t, previewX + previewW / 2, previewY + previewH * 0.63, tile);
    drawTextFit(ctx, anim.label, previewX + previewW / 2, previewY + 18, previewW - 20, s, PAL.goldHi, 'center', '#000');
    drawText(ctx, 'PLAYING', previewX + previewW / 2, previewY + previewH - 24, 1, PAL.uiDim, 'center');

    const gridX = previewX + previewW + 18;
    const gridW = W - gridX - 20;
    const cols = anims.length > 1 ? 2 : 1;
    const gap = 10;
    const bw = Math.floor((gridW - gap * (cols - 1)) / cols);
    const rows = Math.ceil(anims.length / cols);
    const bh = Math.min(52, Math.floor((H - 92 - gap * (rows - 1)) / rows));
    const startY = 78;
    this.buttons = [];
    for (let i = 0; i < anims.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = gridX + col * (bw + gap), y = startY + row * (bh + gap);
      const selected = i === this.sel;
      this.buttons.push({ x, y, w: bw, h: bh });
      ctx.fillStyle = selected ? '#241a24' : '#0d1120'; ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = selected ? PAL.goldHi : 'rgba(255,255,255,0.14)';
      ctx.fillRect(x, y, bw, 2); ctx.fillRect(x, y + bh - 2, bw, 2);
      ctx.fillRect(x, y, 2, bh); ctx.fillRect(x + bw - 2, y, 2, bh);
      if (selected) { ctx.fillStyle = PAL.gold; ctx.fillRect(x, y, 5, bh); }
      drawTextFit(ctx, anims[i].label, x + bw / 2, y + Math.round((bh - 7 * s) / 2), bw - 20, s, selected ? PAL.goldHi : PAL.ui, 'center', '#000');
    }
  },
  _select(i) {
    const anims = SPRITE_LAB_ANIMS[this.character];
    if (i < 0 || i >= anims.length) return;
    this.sel = i; this.t = 0; Snd.select();
  },
  onDirPress(dc, dr) {
    const anims = SPRITE_LAB_ANIMS[this.character];
    const cols = anims.length > 1 ? 2 : 1;
    let next = this.sel;
    if (dc) next += dc;
    else if (dr) next += dr * cols;
    next = Math.max(0, Math.min(anims.length - 1, next));
    if (next !== this.sel) { this.sel = next; this.t = 0; Snd.blip(); }
  },
  onDirRelease() {},
  onConfirm() { this.t = 0; Snd.select(); },
  onTap(x, y) {
    if (y < 42 && x < 125) { this.onBack(); return; }
    for (let i = 0; i < this.buttons.length; i++) {
      const r = this.buttons[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) { this._select(i); return; }
    }
  },
  onBack() { Snd.back(); App.setScreen('spriteLab'); },
};

