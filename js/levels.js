'use strict';
// ── Story campaign: five multi-room dungeons ──────────────────
// Each dungeon is a set of rooms on a grid (gx,gy). A room is a normal
// engine map; the dungeon layer (js/dungeon.js + game.js) handles the
// room-to-room transitions, a shared key pool, shutter/locked doors and
// the mid-dungeon relic that gates the path to the exit.
//
// Zelda-style structure: from a hub you quickly REACH the exit branch but
// find it walled off by the dungeon's relic-gate (bramble / flame / iron /
// dark / chasm). The relic itself lies down a separate branch behind
// key-fetch loops (find a key, backtrack to a locked door) and shutter
// puzzles. You get the relic ~70% in, then BACKTRACK through old rooms to
// clear the gate and reach the exit. Length/difficulty escalate D1 (~3 min,
// 12 rooms, 1 key) -> D5 (~10 min, 20 rooms, 3 keys).
//
// Room map legend (border is wall; doorways punched at edge centres):
//   # wall  . floor  s switch  b block  h heavy  u bush  f fire  p pit
//   T wall-torch  k key  o coin  C chest  x exit stairs  @ player start
// A relic-gate is a FULL wall of its hazard across the room's middle column
// so it cannot be walked around — you must have the relic to pass.
//
// Door types per side: open | shutter (opens when THIS room is solved)
//   | lock (needs a key). A missing side is solid wall.

const ITEMS = {
  sword:    { name: "GUARD'S BLADE",   desc: 'CUTS THROUGH BUSHES AND BRAMBLE.' },
  shield:   { name: "WARDEN'S SHIELD", desc: 'WALK UNBURNED THROUGH FLAMES.' },
  glove:    { name: 'TITAN GLOVE',     desc: 'PUSHES HEAVY IRON BLOCKS.' },
  lantern:  { name: 'PALE LANTERN',    desc: 'LIGHTS THE DARKEST VAULTS.' },
  boots:    { name: 'STRIDER BOOTS',   desc: 'STRIDE ACROSS OPEN CHASMS.' },
  map:      { name: 'DUNGEON MAP',      desc: 'THE HALLS UNFOLD IN YOUR MIND.' },
  sunstone: { name: 'SUNSTONE',        desc: 'THE HEART OF THE KEEP, ABLAZE ONCE MORE.' },
};

// short room builders keep the data readable
function R(gx, gy, map, doors, extra) {
  return Object.assign({ gx, gy, map, doors: doors || {} }, extra || {});
}

// ── reusable room interiors (9x7; door cols/inner cells kept clear) ──
const _ST    = ['##T###T##', '#.......#', '#.o...o.#', '#...@...#', '#.......#', '#.o...o.#', '#########']; // start @ (3,4)
const _HALL  = ['##T###T##', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#########'];
const _COIN  = ['##T###T##', '#.......#', '#.o...o.#', '#.......#', '#.o...o.#', '#.......#', '#########'];
const _P2    = ['#########', '#.s...s.#', '#.......#', '#.b...b.#', '#.......#', '#.......#', '#########']; // 2 blocks -> 2 switches
const _P4    = ['#########', '#.ss.ss.#', '#.bb.bb.#', '#.......#', '#.......#', '#.......#', '#########']; // 4 blocks, one push each
const _KEY   = ['##T###T##', '#...k...#', '#.......#', '#.o...o.#', '#.......#', '#.......#', '#########']; // key (1,4)
const _CHEST = ['##T###T##', '#.......#', '#...C...#', '#.......#', '#.......#', '#.......#', '#########']; // chest (2,4)
const _BUSHV = ['#########', '#...u...#', '#...u...#', '#...u...#', '#...u...#', '#...u...#', '#########']; // bramble wall col4
const _FIREV = ['#########', '#...f...#', '#...f...#', '#...f...#', '#...f...#', '#...f...#', '#########']; // flame wall col4
const _PITV  = ['#########', '#...p...#', '#...p...#', '#...p...#', '#...p...#', '#...p...#', '#########']; // chasm wall col4
const _HEAVY = ['#########', '#...s...#', '#.......#', '#...h...#', '#.......#', '#.......#', '#########']; // heavy -> switch (needs glove)
const _PITS  = ['#########', '#.p...p.#', '#.......#', '#...p...#', '#.......#', '#.p...p.#', '#########']; // scattered chasms
const _BOSS  = ['##T###T##', '#.......#', '#.......#', '#...x...#', '#.......#', '#.......#', '#########']; // exit (3,4)
const _BOSSC = ['##T###T##', '#.......#', '#...C...#', '#.......#', '#...x...#', '#.......#', '#########']; // chest (2,4) + exit (4,4)
// 11x9 grand hall (bigger room), coins scattered, door inner cells clear
const _HALL11 = ['###T###T###', '#.........#', '#..o...o..#', '#.........#', '#....o....#', '#.........#', '#..o...o..#', '#.........#', '###########'];

const DUNGEONS_LEGACY = [
  // ══ D1 · THE SUNKEN HALLS · SWORD · 12 rooms · 1 key · bramble-gated exit ══
  // Hub east = the exit, walled by bramble (need SWORD). Sword is north,
  // behind a locked door whose key sits west past a push puzzle. Backtrack.
  {
    id: 'd1', name: 'THE SUNKEN HALLS',
    tagline: 'EVERY DELVE BEGINS WITH A SINGLE STEP.',
    item: 'sword', prior: [],
    start: { room: 'r1', r: 3, c: 4 }, goal: 'r6',
    intro: "RAIN HAMMERS THE RUINS OF KING ALARIC'S KEEP. FAR BELOW, THE SUNSTONE STILL BURNS. YOU ARE THE ONLY ONE FOOL ENOUGH TO GO GET IT.",
    outro: "THE DROWNED GUARD'S BLADE IS YOURS, AND THE FIRST HALL LIES CONQUERED BEHIND YOU.",
    rooms: {
      r1: R(2, 4, _ST, { n: 'open' }, { intro: 'THE HALLS REMEMBER FOOTSTEPS. CLIMB NORTH.' }),
      r2: R(2, 3, _HALL, { s: 'open', w: 'open', e: 'open', n: 'lock' }, { intro: 'FOUR WAYS. THE NORTH DOOR IS LOCKED; THE EAST IS CHOKED WITH BRAMBLE.' }),
      r3: R(1, 3, _P2, { e: 'open', w: 'open', n: 'shutter' }, { intro: 'PUSH BOTH STONES ONTO THE SEALS TO OPEN THE WAY NORTH.' }),
      rM: R(0, 3, _CHEST, { e: 'open' }, { chest: { item: 'map' }, intro: 'A CARTOGRAPHER DIED CLUTCHING THIS.' }),
      rK: R(1, 2, _KEY, { s: 'open' }),
      r5: R(3, 3, _BUSHV, { w: 'open', e: 'open' }, { intro: 'THE EXIT LIES JUST BEYOND — BUT BRAMBLE BARS IT. YOU NEED A BLADE.' }),
      r6: R(4, 3, _BOSS, { w: 'open' }, { boss: true }),
      r7: R(2, 2, _COIN, { s: 'lock', n: 'open' }),
      r8: R(2, 1, _P2, { s: 'open', e: 'open', n: 'shutter' }),
      rC: R(3, 1, _COIN, { w: 'open' }),
      r9: R(2, 0, _HALL, { s: 'open', w: 'open' }),
      rB: R(1, 0, _CHEST, { e: 'open' }, { chest: { item: 'sword' }, intro: "THE DROWNED GUARD'S BLADE. NOW — BACK TO THE BRAMBLE." }),
    },
  },

  // ══ D2 · THE ASHEN GALLERIES · SHIELD · 13 rooms · 2 keys · flame-gated exit ══
  {
    id: 'd2', name: 'THE ASHEN GALLERIES',
    tagline: 'THE FLOOD NEVER REACHED HERE. FIRE DID.',
    item: 'shield', prior: ['sword'],
    start: { room: 'r1', r: 3, c: 4 }, goal: 'r6',
    intro: 'GAS FROM THE DEEP VENTS HAS KEPT THESE GALLERIES ALIGHT FOR A HUNDRED YEARS. THE HEAT LEANS AGAINST THE DOORS.',
    outro: "THE WARDEN'S SHIELD HUMS WITH BANKED HEAT. THE GALLERIES ARE ASHES BEHIND YOU.",
    rooms: {
      r1: R(2, 5, _ST, { n: 'open' }),
      r2: R(2, 4, _HALL, { s: 'open', w: 'open', e: 'open', n: 'lock' }, { intro: 'THE EAST HALL BURNS. THE SHIELD LIES PAST TWO LOCKS.' }),
      r3: R(1, 4, _P2, { e: 'open', w: 'open', n: 'shutter' }),
      rC: R(0, 4, _COIN, { e: 'open' }),
      rA: R(1, 3, _KEY, { s: 'open' }),
      r5: R(3, 4, _FIREV, { w: 'open', e: 'open' }, { intro: 'A WALL OF FLAME GUARDS THE EXIT. RAISE A SHIELD AND WALK ON.' }),
      r6: R(4, 4, _BOSS, { w: 'open' }, { boss: true }),
      r7: R(2, 3, _HALL, { s: 'lock', e: 'open', n: 'open' }),
      r8: R(3, 3, _P4, { w: 'open', e: 'open', n: 'shutter' }),
      rB: R(3, 2, _KEY, { s: 'open' }),
      rM: R(4, 3, _CHEST, { w: 'open' }, { chest: { item: 'map' } }),
      r9: R(2, 2, _HALL, { s: 'open', n: 'lock' }),
      r10: R(2, 1, _CHEST, { s: 'lock' }, { chest: { item: 'shield' }, intro: "THE WARDEN'S SHIELD. NOW FACE THE FLAMES." }),
    },
  },

  // ══ D3 · THE IRON VAULTS · GLOVE · 14 rooms · 2 keys · heavy-sealed exit ══
  {
    id: 'd3', name: 'THE IRON VAULTS',
    tagline: 'WHAT THE KING VALUED, HE MADE TOO HEAVY TO STEAL.',
    item: 'glove', prior: ['sword', 'shield'],
    start: { room: 'r1', r: 3, c: 4 }, goal: 'r6',
    intro: 'THE VAULTS ARE IRON TO THE CORE. NOTHING HERE MOVES FOR A BARE HAND.',
    outro: 'THE TITAN GLOVE SWALLOWS YOUR ARM TO THE ELBOW. IRON GROANS AND OBEYS.',
    rooms: {
      r1: R(2, 5, _ST, { n: 'open' }),
      r2: R(2, 4, _HALL, { s: 'open', w: 'open', e: 'open', n: 'lock' }),
      r3: R(1, 4, _P2, { e: 'open', w: 'open', n: 'shutter' }),
      rC: R(0, 4, _HALL11, { e: 'open' }),
      rA: R(1, 3, _KEY, { s: 'open' }),
      r5: R(3, 4, _HEAVY, { w: 'open', e: 'shutter' }, { intro: 'AN IRON SEAL BARS THE EXIT. IT WANTS A HEAVY STONE ON ITS PLATE — AND A HAND STRONG ENOUGH TO PUSH ONE.' }),
      r6: R(4, 4, _BOSS, { w: 'open' }, { boss: true }),
      r7: R(2, 3, _HALL, { s: 'lock', n: 'open' }),
      r8: R(2, 2, _P4, { s: 'open', n: 'shutter' }),
      r9: R(2, 1, _HALL, { s: 'open', w: 'open', e: 'open', n: 'lock' }),
      r10: R(1, 1, _P2, { e: 'open', n: 'shutter' }),
      rB: R(1, 0, _KEY, { s: 'open' }),
      rM: R(3, 1, _CHEST, { w: 'open' }, { chest: { item: 'map' } }),
      r11: R(2, 0, _CHEST, { s: 'lock' }, { chest: { item: 'glove' }, intro: 'THE TITAN GLOVE. NOW MOVE THAT SEAL.' }),
    },
  },

  // ══ D4 · THE LIGHTLESS DEEP · LANTERN · 18 rooms · 2 keys · dark-veiled exit ══
  {
    id: 'd4', name: 'THE LIGHTLESS DEEP',
    tagline: 'THE SUN HAS NEVER ONCE TOUCHED THIS PLACE.',
    item: 'lantern', prior: ['sword', 'shield', 'glove'],
    start: { room: 'r1', r: 3, c: 4 }, goal: 'rX',
    intro: 'THE TORCHES END HERE. WHAT LIES DEEPER HAS NEVER BEEN SEEN, ONLY FELT.',
    outro: 'THE PALE LANTERN BURNS WITHOUT OIL OR FLAME. THE DARK PEELS BACK, AND YOU WALK ON.',
    rooms: {
      r1: R(2, 5, _ST, { n: 'open' }),
      r2: R(2, 4, _HALL, { s: 'open', w: 'open', e: 'open', n: 'lock' }),
      r3: R(1, 4, _P2, { e: 'open', w: 'open', n: 'shutter' }),
      rC: R(0, 4, _HALL11, { e: 'open' }),
      rA: R(1, 3, _KEY, { s: 'open' }),
      r5: R(3, 4, _HALL, { w: 'open', e: 'open' }, { dark: true, intro: 'EAST IS PITCH BLACK. YOU CANNOT SEE A SEAL, LET ALONE SOLVE ONE. FIND A LIGHT.' }),
      r6: R(4, 4, _P2, { w: 'open', e: 'shutter' }, { dark: true }),
      r6b: R(5, 4, _COIN, { w: 'open', e: 'open' }, { dark: true }),
      rX: R(6, 4, _BOSS, { w: 'open' }, { boss: true, dark: true }),
      r7: R(2, 3, _HALL, { s: 'lock', n: 'open', e: 'open' }),
      rD: R(3, 3, _COIN, { w: 'open' }),
      r8: R(2, 2, _P4, { s: 'open', n: 'shutter' }),
      r9: R(2, 1, _HALL, { s: 'open', w: 'open', e: 'open', n: 'lock' }),
      r10: R(1, 1, _P2, { e: 'open', n: 'shutter' }),
      rB: R(1, 0, _KEY, { s: 'open' }),
      rM: R(3, 1, _CHEST, { w: 'open', e: 'open' }, { chest: { item: 'map' } }),
      rE: R(4, 1, _COIN, { w: 'open' }),
      r11: R(2, 0, _CHEST, { s: 'lock' }, { chest: { item: 'lantern' }, intro: 'THE PALE LANTERN. THE DARK NO LONGER OWNS THE DEEP.' }),
    },
  },

  // ══ D5 · THE ABYSSAL DESCENT · BOOTS · 20 rooms · 3 keys · chasm-gated exit ══
  {
    id: 'd5', name: 'THE ABYSSAL DESCENT',
    tagline: 'THE SUNSTONE WAITS WHERE THE FLOOR RUNS OUT.',
    item: 'boots', prior: ['sword', 'shield', 'glove', 'lantern'],
    start: { room: 'r1', r: 3, c: 4 }, goal: 'rX',
    intro: "THE KEEP'S HEART LIES BELOW A THROAT OF CHASMS. ONE MISSTEP IS A LONG WAY DOWN.",
    outro: 'THE SUNSTONE RISES INTO YOUR HANDS, WARM AS A SUMMER YOU NEVER LIVED TO SEE. STONE BY STONE THE KEEP BEGINS TO GLOW. THE DELVE IS COMPLETE.',
    rooms: {
      r1: R(2, 5, _ST, { n: 'open' }),
      r2: R(2, 4, _HALL, { s: 'open', w: 'open', e: 'open', n: 'lock' }, { intro: 'THREE LOCKS GUARD THE DESCENT. THE EXIT EAST ENDS IN A CHASM.' }),
      r3: R(1, 4, _P2, { e: 'open', w: 'shutter' }),
      rA: R(0, 4, _KEY, { e: 'open' }),
      r5: R(3, 4, _PITV, { w: 'open', e: 'open' }, { intro: 'A CHASM WITHOUT A BRIDGE SWALLOWS THE EXIT HALL. ONLY STRIDER BOOTS CROSS IT.' }),
      r6: R(4, 4, _PITS, { w: 'open', e: 'open' }),
      r6b: R(5, 4, _PITS, { w: 'open', e: 'open' }),
      rX: R(6, 4, _BOSSC, { w: 'open' }, { boss: true, chest: { item: 'sunstone' } }),
      r7: R(2, 3, _COIN, { s: 'lock', n: 'open', e: 'open' }),
      rD: R(3, 3, _HALL11, { w: 'open' }),
      r8: R(2, 2, _HALL, { s: 'open', w: 'open', e: 'open', n: 'lock' }),
      r9: R(1, 2, _P4, { e: 'open', w: 'shutter' }),
      rB: R(0, 2, _KEY, { e: 'open' }),
      rM: R(3, 2, _CHEST, { w: 'open', e: 'open' }, { chest: { item: 'map' } }),
      rE: R(4, 2, _COIN, { w: 'open' }),
      r11: R(2, 1, _HALL, { s: 'open', w: 'open', e: 'open', n: 'lock' }),
      r12: R(1, 1, _P2, { e: 'open', n: 'shutter' }),
      rC: R(1, 0, _KEY, { s: 'open' }),
      rF: R(3, 1, _COIN, { w: 'open' }),
      r13: R(2, 0, _CHEST, { s: 'lock' }, { chest: { item: 'boots' }, intro: 'THE STRIDER BOOTS. NOW — BACK TO THE CHASM.' }),
    },
  },
];

// ── Story campaign v3: five mechanically distinct dungeon identities ──────
// Rooms deliberately vary from compact 9x7 chambers to 15x11 set pieces.
// Puzzle state resets on re-entry; defeated enemies remain defeated for the
// entire run. `combat` doors open only after the current room is cleared.
const DUNGEONS = [
  {
    id: 'd1', name: 'THE SUNKEN HALLS',
    tagline: 'DROWNED COURTS, MOSSY LOCKS, AND A BLADE BELOW THE TIDE.',
    item: 'sword', prior: [], start: { room: 'landing', r: 5, c: 4 }, goal: 'warden',
    intro: "RAIN RUNS DOWN THE BURIED STAIR. THE SUNKEN GUARD STILL PATROLS BELOW.",
    outro: "THE DROWNED GUARD'S BLADE IS YOURS. THE HALLS FALL SILENT.",
    rooms: {
      landing: R(0, 2, ['##T###T##','#.u...u.#','#...o...#','#.c...c.#','#.......#','#...@...#','#########'], { n: 'open' }),
      nave: R(0, 1, ['###T###T###','#..u...u..#','#.#.....#.#','#...c.c...#','#o.......o#','#...c.c...#','#.#.....#.#','#..u...u..#','###########'], { s: 'open', w: 'open', e: 'open', n: 'lock' }),
      cistern: R(-1, 1, ['###########','#s..p.p..s#','#...p.p...#','#.b.....b.#','#...c.c...#','#.........#','#.u..o..u.#','#.........#','###########'], { e: 'open', w: 'open', n: 'shutter' }),
      chart: R(-2, 1, ['##T###T##','#.c...c.#','#...C...#','#.u...u.#','#...o...#','#.......#','#########'], { e: 'open' }, { chest: { item: 'map' } }),
      drownedKey: R(-1, 0, ['#########','#p..k..p#','#.c...c.#','#...u...#','#.o...o.#','#.......#','##T###T##'], { s: 'open' }),
      guardCourt: R(1, 1, ['###T#####T###','#p...c.c...p#','#..##...##..#','#...........#','#.c..o.o..c.#','#...........#','#..##...##..#','#p...c.c...p#','#############'], { w: 'open', e: 'combat' }, { enemies: [
        { id: 'd1-sk-a', type: 'skeleton', r: 2, c: 2 }, { id: 'd1-sk-b', type: 'skeleton', r: 6, c: 10 },
      ] }),
      brambleRun: R(2, 1, ['##T#####T##','#....u....#','#.c..u..c.#','#....u....#','#.o..u..o.#','#....u....#','#.c..u..c.#','#....u....#','###########'], { w: 'open', e: 'open' }),
      ironLanding: R(0, 0, ['#########','#.c...c.#','#.......#','#...o...#','#.......#','#.c...c.#','##T###T##'], { s: 'lock', n: 'open' }),
      bladeCrypt: R(0, -1, ['##T###T##','#.u...u.#','#...C...#','#.c...c.#','#.u...u.#','#.......#','#########'], { s: 'open' }, { chest: { item: 'sword' } }),
      warden: R(3, 1, ['##T###T##','#.c...c.#','#.......#','#...x...#','#.c...c.#','#.......#','#########'], { w: 'open' }, { boss: true, enemies: [{ id: 'd1-warden', type: 'skeleton', r: 3, c: 6 }] }),
    },
  },
  {
    id: 'd2', name: 'THE ASHEN GALLERIES',
    tagline: 'A RING OF FURNACES BUILT AROUND A BURNING HEART.',
    item: 'shield', prior: ['sword'], start: { room: 'kilnGate', r: 7, c: 6 }, goal: 'ashThrone',
    intro: 'THE FLOOD ENDS AT A RED IRON DOOR. BEYOND IT, THE KEEP IS STILL BURNING.',
    outro: "THE WARDEN'S SHIELD DRINKS THE HEAT. THE FURNACES GUTTER OUT.",
    rooms: {
      kilnGate: R(0, 2, ['###T#####T###','#...........#','#.c.......c.#','#.....o.....#','#.f.......f.#','#.c.......c.#','#...........#','#.....@.....#','#############'], { n: 'open' }),
      furnaceHub: R(0, 1, ['##T#######T##','#f...#.#...f#','#....#.#....#','#.c.......c.#','#.....f.....#','#.c.......c.#','#....#.#....#','#f...#.#...f#','#############'], { s: 'open', w: 'open', n: 'open', e: 'open' }),
      coalWorks: R(-1, 1, ['###########','#s.f...f.s#','#.........#','#.b..h..b.#','#....f....#','#.c.....c.#','#.........#','#o.......o#','##T#####T##'], { e: 'open', w: 'combat' }, { enemies: [
        { id: 'd2-tribe-a', type: 'tribalist', r: 2, c: 5 }, { id: 'd2-sk-a', type: 'skeleton', r: 6, c: 5 },
      ] }),
      emberVault: R(-2, 1, ['##T###T##','#f..k..f#','#.c...c.#','#...o...#','#.c...c.#','#f.....f#','#########'], { e: 'open' }),
      smokeMap: R(0, 0, ['#########','#f.....f#','#...C...#','#.c...c.#','#...f...#','#.......#','##T###T##'], { s: 'open', e: 'open' }, { chest: { item: 'map' } }),
      flue: R(1, 0, ['###########','#f...c...f#','#.###.###.#','#.....o...#','#.###.###.#','#f...c...f#','#.........#','#...k.....#','##T#####T##'], { w: 'open', s: 'lock' }),
      fireDance: R(1, 1, ['###############','#f..f..f..f..f#','#.............#','#..c..p..c....#','#f....o....f..#','#....c..p..c..#','#.............#','#f..f..f..f..f#','###############'], { n: 'lock', w: 'open', e: 'combat' }, { enemies: [
        { id: 'd2-tribe-b', type: 'tribalist', r: 2, c: 3 }, { id: 'd2-tribe-c', type: 'tribalist', r: 6, c: 11 },
        { id: 'd2-sk-b', type: 'skeleton', r: 4, c: 7 },
      ] }),
      shieldForge: R(2, 1, ['##T#####T##','#f.......f#','#...C.....#','#.c.....c.#','#...h.h...#','#.c.....c.#','#f.......f#','#.........#','###########'], { w: 'open', e: 'open' }, { chest: { item: 'shield' } }),
      coolingHall: R(3, 1, ['###########','#....f....#','#.c..f..c.#','#....f....#','#.o..f..o.#','#....f....#','#.c..f..c.#','#....f....#','##T#####T##'], { w: 'open', e: 'open' }),
      ashThrone: R(4, 1, ['##T###T##','#f.....f#','#.c...c.#','#...x...#','#.c...c.#','#f.....f#','#########'], { w: 'open' }, { boss: true, enemies: [{ id: 'd2-ashguard', type: 'skeleton', r: 3, c: 6 }] }),
    },
  },
  {
    id: 'd3', name: 'THE IRON VAULTS',
    tagline: 'A MECHANICAL STOREHOUSE OF WEIGHT, LEVERS, AND MOVING STONE.',
    item: 'glove', prior: ['sword', 'shield'], start: { room: 'freightLift', r: 5, c: 4 }, goal: 'treasury',
    intro: 'CHAINS SHUDDER ABOVE A VAULT BUILT TO MAKE TREASURE TOO HEAVY TO STEAL.',
    outro: 'THE TITAN GLOVE CLOSES AROUND YOUR ARM. IRON NOW ANSWERS TO YOU.',
    rooms: {
      freightLift: R(0, 3, ['#########','#h.....h#','#.c...c.#','#...o...#','#.......#','#...@...#','##T###T##'], { n: 'open' }),
      sortingFloor: R(0, 2, ['###T#####T###','#h.........h#','#..s.....s..#','#...........#','#..b.....b..#','#.....o.....#','#.c.......c.#','#h.........h#','#############'], { s: 'open', e: 'shutter', n: 'open' }),
      chainGallery: R(0, 1, ['###########','#h..c.c..h#','#.........#','#.###.###.#','#....o....#','#.###.###.#','#.........#','#h..c.c..h#','##T#####T##'], { s: 'open', w: 'open' }),
      keyCrane: R(-1, 1, ['##T###T##','#h..k..h#','#.c...c.#','#...s...#','#...b...#','#.......#','#########'], { e: 'open' }),
      pressRoom: R(1, 2, ['###############','#s...h...h...s#','#.............#','#..###...###..#','#..b.......b..#','#.....c.c.....#','#..###...###..#','#o...........o#','###############'], { w: 'open', n: 'combat' }, { enemies: [
        { id: 'd3-sk-a', type: 'skeleton', r: 3, c: 2 }, { id: 'd3-sk-b', type: 'skeleton', r: 5, c: 10 },
        { id: 'd3-ripper-a', type: 'ripper', r: 2, c: 7 },
      ] }),
      records: R(1, 1, ['###########','#h...C...h#','#.c.....c.#','#...###...#','#....o....#','#...###...#','#.c.....c.#','#h.......h#','##T#####T##'], { s: 'open', e: 'lock' }, { chest: { item: 'map' } }),
      lockworks: R(2, 1, ['##T#####T##','#h..s.s..h#','#...b.b...#','#.........#','#.c..o..c.#','#.........#','#h.......h#','#.........#','###########'], { w: 'lock', n: 'shutter' }),
      titanTest: R(2, 0, ['#############','#h....s....h#','#.....h.....#','#.c.......c.#','#.....o.....#','#.c.......c.#','#.....h.....#','#h.........h#','###T#####T###'], { s: 'open', w: 'open' }, { enemies: [{ id: 'd3-ripper-b', type: 'ripper', r: 7, c: 5 }] }),
      gloveVault: R(1, 0, ['##T###T##','#h.....h#','#...C...#','#.c...c.#','#...h...#','#.......#','#########'], { e: 'open', w: 'open' }, { chest: { item: 'glove' } }),
      crusherRun: R(0, 0, ['###########','#....h....#','#.c..h..c.#','#....h....#','#.o..h..o.#','#....h....#','#.c..h..c.#','#....h....#','##T#####T##'], { e: 'open', w: 'combat' }, { enemies: [
        { id: 'd3-tribe-a', type: 'tribalist', r: 2, c: 2 }, { id: 'd3-tribe-b', type: 'tribalist', r: 6, c: 8 },
      ] }),
      treasury: R(-1, 0, ['##T###T##','#h.....h#','#.c...c.#','#...x...#','#.c...c.#','#h.....h#','#########'], { e: 'open' }, { boss: true, enemies: [{ id: 'd3-treasurer', type: 'skeleton', r: 3, c: 6 }] }),
    },
  },
  {
    id: 'd4', name: 'THE LIGHTLESS DEEP',
    tagline: 'ONE CANDLE, A BLACK LABYRINTH, AND A LANTERN LOST WITHIN.',
    item: 'lantern', prior: ['sword', 'shield', 'glove'], start: { room: 'candle', r: 7, c: 6 }, goal: 'blindKing',
    intro: 'THE DOOR CLOSES. TOTAL DARKNESS. YOU LIGHT A SINGLE CANDLE SAVED FROM THE IRON VAULTS; ITS PALE SQUARE IS ALL YOU CAN SEE.',
    outro: 'THE PALE LANTERN OPENS THE DARK TO FIVE PACES. THE DEEP CAN HIDE NO LONGER.',
    rooms: {
      candle: R(0, 3, ['#############','#...........#','#.c.......c.#','#...........#','#.....f.....#','#...........#','#.c.......c.#','#.....@.....#','###T#####T###'], { n: 'open' }, { dark: true }),
      blindCross: R(0, 2, ['#############','#p.........p#','#...#...#...#','#...........#','#.#...o...#.#','#...........#','#...#...#...#','#p.........p#','#############'], { s: 'open', w: 'open', e: 'open', n: 'combat' }, { dark: true, enemies: [
        { id: 'd4-sk-a', type: 'skeleton', r: 2, c: 6 }, { id: 'd4-sk-b', type: 'skeleton', r: 6, c: 6 },
      ] }),
      whisperMaze: R(-1, 2, ['###########','#...#.....#','#.#.#.###.#','#.#...#...#','#.#####.#.#','#.....#.#.#','#####.#.#.#','#k......#.#','##T#####T##'], { e: 'open', n: 'open' }, { dark: true }),
      echoMap: R(-1, 1, ['##T#####T##','#p.......p#','#...C.....#','#.###.###.#','#....o....#','#.###.###.#','#p.......p#','#.........#','###########'], { s: 'open' }, { dark: true, chest: { item: 'map' } }),
      hunterHall: R(1, 2, ['###############','#p...........p#','#...###.###...#','#.............#','#.c....o....c.#','#.............#','#...###.###...#','#p...........p#','###############'], { w: 'open', n: 'combat' }, { dark: true, enemies: [
        { id: 'd4-tribe-a', type: 'tribalist', r: 2, c: 3 }, { id: 'd4-tribe-b', type: 'tribalist', r: 6, c: 11 },
        { id: 'd4-sk-c', type: 'skeleton', r: 4, c: 7 },
      ] }),
      blackLock: R(1, 1, ['###########','#p..c.c..p#','#.........#','#.###.###.#','#....k....#','#.###.###.#','#.........#','#p..c.c..p#','##T#####T##'], { s: 'open', w: 'lock' }, { dark: true }),
      sealedDark: R(0, 1, ['#############','#s.........s#','#...........#','#..b.....b..#','#.....p.....#','#..c.....c..#','#...........#','#p.........p#','#############'], { s: 'combat', e: 'lock', n: 'shutter' }, { dark: true }),
      lanternTomb: R(0, 0, ['##T#####T##','#p.......p#','#...C.....#','#.c.....c.#','#....f....#','#.c.....c.#','#p.......p#','#.........#','###########'], { s: 'open', e: 'open' }, { dark: true, chest: { item: 'lantern' } }),
      revealedHall: R(1, 0, ['###############','#p...c...c...p#','#...###.###...#','#.............#','#..o.......o..#','#.............#','#...###.###...#','#p...c...c...p#','###############'], { w: 'open', e: 'combat' }, { dark: true, enemies: [
        { id: 'd4-sk-d', type: 'skeleton', r: 2, c: 3 }, { id: 'd4-sk-e', type: 'skeleton', r: 6, c: 11 },
        { id: 'd4-tribe-c', type: 'tribalist', r: 4, c: 12 },
      ] }),
      paleBridge: R(2, 0, ['###########','#p.p...p.p#','#.........#','#.c.....c.#','#....o....#','#.c.....c.#','#.........#','#p.p...p.p#','##T#####T##'], { w: 'open', e: 'open' }, { dark: true }),
      blindKing: R(3, 0, ['##T###T##','#p.....p#','#.c...c.#','#...x...#','#.c...c.#','#p.....p#','#########'], { w: 'open' }, { boss: true, dark: true, enemies: [{ id: 'd4-king', type: 'skeleton', r: 3, c: 6 }] }),
    },
  },
  {
    id: 'd5', name: 'THE ABYSSAL DESCENT',
    tagline: 'A VERTICAL RUIN WHERE EVERY PATH CROSSES THE VOID.',
    item: 'boots', prior: ['sword', 'shield', 'glove', 'lantern'], start: { room: 'rim', r: 7, c: 6 }, goal: 'sunstone',
    intro: "THE KEEP'S LAST STAIR HANGS ABOVE AN ENDLESS SHAFT. THE SUNSTONE BURNS SOMEWHERE BELOW.",
    outro: 'THE SUNSTONE RISES WARM IN YOUR HAND. FAR ABOVE, THE KEEP BEGINS TO WAKE.',
    rooms: {
      rim: R(0, 4, ['#############','#p.........p#','#.c.......c.#','#.....o.....#','#p.........p#','#.c.......c.#','#...........#','#.....@.....#','###T#####T###'], { n: 'open' }),
      switchback: R(0, 3, ['###############','#p...........p#','#..p.......p..#','#....p...p....#','#......o......#','#....p...p....#','#..p.......p..#','#p...........p#','###############'], { s: 'open', w: 'open', e: 'open', n: 'open' }),
      westLedge: R(-1, 3, ['###########','#p..c.c..p#','#.........#','#.p.....p.#','#....k....#','#.p.....p.#','#.........#','#p..c.c..p#','##T#####T##'], { e: 'open', n: 'open', s: 'combat' }, { enemies: [
        { id: 'd5-tribe-a', type: 'tribalist', r: 2, c: 5 }, { id: 'd5-sk-a', type: 'skeleton', r: 6, c: 5 },
      ] }),
      cartographer: R(-1, 4, ['##T#####T##','#p.......p#','#...C.....#','#.p.....p.#','#....o....#','#.p.....p.#','#p.......p#','#.........#','###########'], { n: 'open' }, { chest: { item: 'map' } }),
      eastFall: R(1, 3, ['#############','#p...c...c.p#','#...p...p...#','#...........#','#..p..o..p..#','#...........#','#...p...p...#','#p.c...c...p#','#############'], { w: 'open', n: 'combat' }, { enemies: [
        { id: 'd5-sk-b', type: 'skeleton', r: 2, c: 3 }, { id: 'd5-sk-c', type: 'skeleton', r: 6, c: 9 },
        { id: 'd5-tribe-b', type: 'tribalist', r: 4, c: 6 },
      ] }),
      hangingCells: R(1, 2, ['###########','#p.#...#.p#','#..#...#..#','#.c.....c.#','#....k....#','#.c.....c.#','#..#...#..#','#p.#...#.p#','##T#####T##'], { s: 'open', w: 'lock' }),
      deepHub: R(0, 2, ['#############','#p...c.c...p#','#..##...##..#','#...........#','#.p...o...p.#','#...........#','#..##...##..#','#p...c.c...p#','#############'], { s: 'open', e: 'lock', w: 'open', n: 'open' }, { enemies: [{ id: 'd5-ripper-a', type: 'ripper', r: 3, c: 6 }] }),
      bootTrial: R(-1, 2, ['###############','#.............#','#......p......#','#s.b...p...b.s#','#......p......#','#..c...p...c..#','#......p......#','#o...........o#','###############'], { s: 'open', e: 'open', n: 'shutter' }),
      striderCrypt: R(-1, 1, ['##T#####T##','#p.......p#','#...C.....#','#.c.....c.#','#....o....#','#.c.....c.#','#p.......p#','#.........#','###########'], { s: 'open', e: 'open' }, { chest: { item: 'boots' } }),
      voidArena: R(0, 1, ['###############','#p.p.......p.p#','#...###.###...#','#.............#','#p....o.o....p#','#.............#','#...###.###...#','#p.p.......p.p#','###############'], { w: 'open', s: 'open', e: 'combat' }, { enemies: [
        { id: 'd5-sk-d', type: 'skeleton', r: 2, c: 3 }, { id: 'd5-sk-e', type: 'skeleton', r: 6, c: 11 },
        { id: 'd5-tribe-c', type: 'tribalist', r: 3, c: 10 }, { id: 'd5-tribe-d', type: 'tribalist', r: 5, c: 4 },
      ] }),
      finalSpan: R(1, 1, ['#############','#.....p.....#','#.c...p...c.#','#.....p.....#','#.o...p...o.#','#.....p.....#','#.c...p...c.#','#.....p.....#','###T#####T###'], { w: 'open', e: 'open' }),
      sunstone: R(2, 1, ['##T#####T##','#p.......p#','#.c.....c.#','#...C.....#','#....x....#','#.c.....c.#','#p.......p#','#.........#','###########'], { w: 'open' }, { boss: true, chest: { item: 'sunstone' }, enemies: [{ id: 'd5-lastguard', type: 'skeleton', r: 5, c: 7 }, { id: 'd5-ripper-b', type: 'ripper', r: 7, c: 3 }] }),
    },
  },
];

// Isolated five-room showcase dungeon. It uses the normal room/door system,
// but remains outside DUNGEONS so it can never alter campaign progression.
const TEST_DUNGEON = {
  id: 'test-ground', name: 'TEST DUNGEON',
  start: { room: 'hub', r: 7, c: 6 },
  rooms: {
    // The visual centerpiece: a symmetrical relic dais, four braziers,
    // stone columns and four framed exits arranged around a cross-shaped nave.
    hub: R(0, 0, [
      '##T#######T##',
      '#.....o.....#',
      '#.#.......#.#',
      '#...f...f...#',
      '#..c..#..c..#',
      '#o.........o#',
      '#..c.....c..#',
      '#...f.@.f...#',
      '#.#.......#.#',
      '#.....o.....#',
      '##T#######T##',
    ], { n: 'open', s: 'open', e: 'open', w: 'open' }, {
      label: 'HUB',
      decorations: [{ type: 'relic', item: 'sunstone', r: 4, c: 6 }],
    }),

    // Two blocks must cross the ruined western floor to reach both seals.
    // The eastern wall and key-door form a short antechamber before the vault.
    puzzle: R(-1, 0, [
      '##T#######T##',
      '#..u...#....#',
      '#.c.c..#.k..#',
      '#......#....#',
      '#.s.b..#.o..#',
      '#..p...d....#',
      '#.s.b..#.c..#',
      '#......#....#',
      '#.C..h.#.u..#',
      '#..c...#....#',
      '##T#######T##',
    ], { e: 'shutter' }, { label: 'PUZZLE', chest: { item: 'map' } }),

    // A ruined arena: broken floor, collapsed columns and a dark prison-like
    // perimeter. Every implemented enemy type appears here — keep this room in
    // sync when a new type is added, since it is the combat testing ground.
    combat: R(1, 0, [
      '##T#######T##',
      '#p..c...c..p#',
      '#.##.....##.#',
      '#...c.p.c...#',
      '#.#.......#.#',
      '#.....c.....#',
      '#.#.......#.#',
      '#...c.p.c...#',
      '#.##.....##.#',
      '#p..c...c..p#',
      '##T#######T##',
    ], { w: 'open' }, {
      label: 'COMBAT',
      dark: true,
      enemies: [
        { id: 'arena-skeleton-a', type: 'skeleton', r: 3, c: 4 },
        { id: 'arena-skeleton-b', type: 'skeleton', r: 7, c: 8 },
        { id: 'arena-skeleton-c', type: 'skeleton', r: 5, c: 9 },
        { id: 'arena-dart-a', type: 'dart', r: 2, c: 10 },
        { id: 'arena-dart-b', type: 'dart', r: 8, c: 2 },
        { id: 'arena-ripper-a', type: 'ripper', r: 5, c: 3 },
        { id: 'arena-ripper-b', type: 'ripper', r: 5, c: 9 },
        // ranged: parked up/down the far lanes so their darts have a clear line
        { id: 'arena-tribalist-a', type: 'tribalist', r: 1, c: 6 },
        { id: 'arena-tribalist-b', type: 'tribalist', r: 9, c: 6 },
      ],
    }),

    // The narrow hazard lanes telegraph alternating flame, chasm and dart
    // threats. A key opens the final barred reliquary at the south end.
    trap: R(0, 1, [
      '##T#######T##',
      '#.....c.....#',
      '#.f.p...p.f.#',
      '#...c.k.c...#',
      '#.p.f...f.p.#',
      '#s..c...c..s#',
      '#.p.f...f.p.#',
      '######d######',
      '#..c..#..c..#',
      '#o...f.f...o#',
      '##T#######T##',
    ], { n: 'open' }, {
      label: 'TRAP / RELICS',
      decorations: [{ type: 'relic', item: 'shield', r: 8, c: 6 }],
      enemies: [
        { id: 'trap-dart-a', type: 'dart', r: 3, c: 1 },
        { id: 'trap-dart-b', type: 'dart', r: 3, c: 11 },
        { id: 'trap-dart-c', type: 'dart', r: 6, c: 6 },
      ],
    }),

    // Coins lead through a ceremonial aisle to the weapon chest. Heavy stone
    // figures, flames and the existing gold palette make the reward readable.
    treasure: R(0, -1, [
      '##T#######T##',
      '#o.o.o.o.o.o#',
      '#h..f...f..h#',
      '#.o...C...o.#',
      '#...c...c...#',
      '#h.o..#..o.h#',
      '#...c...c...#',
      '#h..f...f..h#',
      '#o.o.o.o.o.o#',
      '#.....o.....#',
      '##T#######T##',
    ], { s: 'open' }, {
      label: 'TREASURE',
      chest: { item: 'sword' },
      decorations: [{ type: 'relic', item: 'sunstone', r: 5, c: 6 }],
    }),
  },
};
// ── helpers ───────────────────────────────────────────────────
function allDungeons() { return DUNGEONS; }
function getDungeon(id) { return DUNGEONS.find(d => d.id === id) || null; }
function dungeonIndex(id) { return DUNGEONS.findIndex(d => d.id === id); }
function nextDungeon(id) { const i = dungeonIndex(id); return i >= 0 && i < DUNGEONS.length - 1 ? DUNGEONS[i + 1] : null; }
function isDungeonUnlocked(id, save) {
  if (save.devOn && save.devOn()) return true;
  const i = dungeonIndex(id);
  if (i <= 0) return true;
  return save.isDungeonDone(DUNGEONS[i - 1].id);
}
function roomCount(dun) { return Object.keys(dun.rooms).length; }

if (typeof module !== 'undefined') {
  module.exports = { DUNGEONS, TEST_DUNGEON, ITEMS, allDungeons, getDungeon, nextDungeon, isDungeonUnlocked, roomCount };
}
if (typeof window !== 'undefined') {
  window.DUNGEONS = DUNGEONS; window.TEST_DUNGEON = TEST_DUNGEON; window.ITEMS = ITEMS;
  window.allDungeons = allDungeons; window.getDungeon = getDungeon;
  window.nextDungeon = nextDungeon; window.isDungeonUnlocked = isDungeonUnlocked;
  window.roomCount = roomCount;
}
