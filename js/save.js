'use strict';
// ── Save: localStorage persistence with versioned schema ──────

const SAVE_KEY = 'delve_save_v1';
// gameplay progress kept per-profile; a separate 'dev' profile means dev
// mode never touches your real coins / unlocks (settings + dev flag + meta
// stay global across both profiles)
const PROGRESS_KEYS = ['coins', 'story', 'challenge', 'timed', 'shop'];
const GLOBAL_KEYS = ['settings', 'dev', 'meta'];

const Save = {
  data: null,   // working view of the ACTIVE profile + globals
  store: null,  // full persisted object (both profiles + globals)

  _progressDefaults() {
    return {
      coins: 0,
      // dungeons: per-id { done:true }. items/equipped = relics.
      story: { dungeons: {}, items: {}, equipped: {}, structVer: 2 },
      challenge: { best: 0, runs: [] },
      timed: { bests: [] },
      shop: {
        owned: ['skin_default', 'theme_default'],
        skin: 'skin_default', theme: 'theme_default',
        hints: 0, adDay: '', adCount: 0,
      },
    };
  },

  _storeDefaults() {
    return {
      version: 2,
      active: 'normal',
      profiles: { normal: this._progressDefaults(), dev: this._progressDefaults() },
      settings: {
        music: true, musicVol: 0.8, sfx: true, sfxVol: 0.9,
        reducedFlash: false, haptics: true, tips: true,
        controlScheme: 'joystick',   // 'joystick' (floating analog) | 'dpad'
        // TEST DUNGEON options — only reachable from inside the test dungeon.
        // dark: false renders authored dark rooms lit; enemies gates which
        // types spawn there (so you can, say, face only skeletons).
        test: {
          dark: true,
          enemies: { skeleton: true, tribalist: true, ripper: true },
        },
      },
      dev: { on: false },
      meta: { seenIntro: false, launches: 0 },
    };
  },

  load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) {}
    this.store = this._storeDefaults();
    if (raw && raw.version === 2 && raw.profiles) {
      this._merge(this.store, raw);
    } else if (raw) {
      // migrate a v1 flat save into the 'normal' profile
      this.store.profiles.normal = this._migrateV1(raw);
      if (raw.settings) this._merge(this.store.settings, raw.settings);
      if (raw.meta) this._merge(this.store.meta, raw.meta);
      this.store.active = 'normal';
      this.store.dev.on = false;
    }
    // ensure both profiles use the current dungeon story structure
    this._dungeonMigrate(this.store.profiles.normal);
    this._dungeonMigrate(this.store.profiles.dev);
    this._assemble();
    this.data.meta.launches++;
    this.write();
    return this.data;
  },

  _migrateV1(raw) {
    const p = this._progressDefaults();
    if (typeof raw.coins === 'number') p.coins = raw.coins;
    if (raw.challenge) this._merge(p.challenge, raw.challenge);
    if (raw.timed) this._merge(p.timed, raw.timed);
    if (raw.shop) this._merge(p.shop, raw.shop);
    // the single-room "levels" campaign was replaced by multi-room
    // dungeons — keep coins/shop but start the story fresh so the new
    // relic progression (earn each item mid-dungeon) is coherent
    return p;
  },

  // returning saves from the pre-dungeon structure: reset story only
  _dungeonMigrate(prog) {
    if (!prog.story) prog.story = { dungeons: {}, items: {}, equipped: {}, structVer: 2 };
    if (prog.story.structVer !== 2) {
      prog.story = { dungeons: {}, items: {}, equipped: {}, structVer: 2 };
    }
    if (!prog.story.dungeons) prog.story.dungeons = {};
  },

  // build the working `data` view for the active profile (objects shared by
  // reference so mutations persist on write; coins is a copied primitive)
  _assemble() {
    const prog = this.store.profiles[this.store.active];
    this.data = { version: this.store.version };
    for (const k of GLOBAL_KEYS) this.data[k] = this.store[k];
    for (const k of PROGRESS_KEYS) this.data[k] = prog[k];
  },

  _merge(base, over) {
    for (const k in over) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
          base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        this._merge(base[k], over[k]);
      } else if (over[k] !== undefined) {
        base[k] = over[k];
      }
    }
    return base;
  },

  write() {
    // fold the working view back into the active profile + globals
    const prog = this.store.profiles[this.store.active];
    for (const k of PROGRESS_KEYS) prog[k] = this.data[k];
    for (const k of GLOBAL_KEYS) this.store[k] = this.data[k];
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.store)); } catch (e) {}
  },

  wipe() {
    // erase only the ACTIVE profile's progress (keeps the other profile,
    // settings, and dev flag intact)
    this.write();
    this.store.profiles[this.store.active] = this._progressDefaults();
    this._assemble();
    this.write();
  },

  // ── developer mode (separate profile) ──
  devOn() { return !!(this.data && this.data.dev && this.data.dev.on); },
  setDevMode(on) {
    on = !!on;
    if (this.devOn() === on) return;
    this.write();                                  // flush current profile
    this.data.dev.on = on;                         // data.dev === store.dev (shared)
    this.store.active = on ? 'dev' : 'normal';
    this._assemble();                              // switch working view
    this.write();
  },
  canAfford(price) { return this.devOn() || this.data.coins >= price; },
  coinLabel() { return this.devOn() ? '∞' : String(this.data.coins); },

  // ── convenience ──
  addCoins(n) {
    if (this.devOn()) return;                      // dev has infinite coins
    this.data.coins = Math.max(0, this.data.coins + n); this.write();
  },

  // ── dungeon progress ──
  isDungeonDone(id) { const r = this.data.story.dungeons[id]; return !!(r && r.done); },
  completeDungeon(id, coinsEarned) {
    const rec = this.data.story.dungeons[id] || (this.data.story.dungeons[id] = {});
    const first = !rec.done;
    rec.done = true;
    if (first && !this.devOn()) this.data.coins += coinsEarned;
    this.write();
    return first;
  },
  // per-dungeon map (revealed by that dungeon's map chest); dev sees all
  hasDungeonMap(id) {
    if (this.devOn()) return true;
    const r = this.data.story.dungeons[id];
    return !!(r && r.map);
  },
  grantDungeonMap(id) {
    const rec = this.data.story.dungeons[id] || (this.data.story.dungeons[id] = {});
    rec.map = true;
    this.write();
  },

  hasItem(item) { return !!this.data.story.items[item]; },
  grantItem(item) { this.data.story.items[item] = true; this.write(); },

  // ── equipment ──
  isEquipped(item) { return !!this.data.story.equipped[item]; },
  setEquipped(item, on) {
    if (on && !this.hasItem(item)) return;
    if (on) this.data.story.equipped[item] = true;
    else delete this.data.story.equipped[item];
    this.write();
  },
  toggleEquip(item) {
    if (!this.hasItem(item)) return false;
    this.setEquipped(item, !this.isEquipped(item));
    return this.isEquipped(item);
  },

  // ── shop ──
  owns(id) {
    return id.endsWith('_default') || this.data.shop.owned.includes(id);
  },

  // returns true on success (coins deducted, item owned)
  buyItem(id, price) {
    if (this.owns(id)) return false;
    if (this.devOn()) { this.data.shop.owned.push(id); this.write(); return true; }
    if (this.data.coins < price) return false;
    this.data.coins -= price;
    this.data.shop.owned.push(id);
    this.write();
    return true;
  },

  // consumables: pay without ownership (hint packs)
  spend(price) {
    if (this.devOn()) return true;                 // free in dev, coins untouched
    if (this.data.coins < price) return false;
    this.data.coins -= price;
    this.write();
    return true;
  },

  addHints(n) { this.data.shop.hints += n; this.write(); },
  useHint() {
    if (this.data.shop.hints <= 0) return false;
    this.data.shop.hints--;
    this.write();
    return true;
  },

  // rewarded ad allowance: 3 per calendar day
  adsLeftToday() {
    const today = new Date().toDateString();
    if (this.data.shop.adDay !== today) return 3;
    return Math.max(0, 3 - this.data.shop.adCount);
  },
  recordAdWatch() {
    const today = new Date().toDateString();
    if (this.data.shop.adDay !== today) { this.data.shop.adDay = today; this.data.shop.adCount = 0; }
    this.data.shop.adCount++;
    this.write();
  },

  // ── leaderboards (local device) ──
  recordChallengeRun(depth, coins) {
    const runs = this.data.challenge.runs;
    runs.push({ depth, coins, date: Date.now() });
    runs.sort((a, b) => b.depth - a.depth || a.date - b.date);
    if (runs.length > 10) runs.length = 10;
    this.data.challenge.best = Math.max(this.data.challenge.best || 0, depth);
    this.write();
  },

  // returns 1-based rank of this run among bests (0 if not top 10)
  recordTimedRun(ms) {
    ms = Math.round(ms);
    const bests = this.data.timed.bests;
    const entry = { ms, date: Date.now() };
    bests.push(entry);
    bests.sort((a, b) => a.ms - b.ms);
    if (bests.length > 10) bests.length = 10;
    this.write();
    const i = bests.indexOf(entry);
    return i >= 0 ? i + 1 : 0;
  },
};
