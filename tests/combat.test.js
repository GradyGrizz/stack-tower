'use strict';
const path = require('path');
const { Combat } = require(path.join(__dirname, '..', 'js', 'combat.js'));
const { TEST_DUNGEON } = require(path.join(__dirname, '..', 'js', 'levels.js'));
const Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
global.Engine = Engine;
const { Dungeon } = require(path.join(__dirname, '..', 'js', 'dungeon.js'));
let failures = 0;
function expect(name, cond) { if (cond) console.log('  OK  combat: ' + name); else { console.error('FAIL  combat: ' + name); failures++; } }
const openWorld = { solid: () => false, lineClear: () => true };
const player = (rolling) => ({ x: 1.5, y: 1.5, dir: 'right', rolling: !!rolling });

{
  const st = Combat.create([{ id: 's', type: 'skeleton', r: 1, c: 2 }], {});
  Combat.startAttack(st);
  Combat.update(st, openWorld, player(false), 0.05);
  expect('sword does not hit before active frame', st.enemies[0].hp === 3);
  Combat.update(st, openWorld, player(false), 0.03);
  expect('sword hits during active frame', st.enemies[0].hp === 2);
  Combat.update(st, openWorld, player(false), 0.12);
  expect('one swing damages an enemy only once', st.enemies[0].hp === 2);
}

{
  const st = Combat.create([{ id: 's', type: 'skeleton', r: 1, c: 2 }], {});
  st.enemies[0].state = 'windup'; st.enemies[0].timer = 0;
  Combat.update(st, openWorld, player(true), 0.01);
  expect('roll grants melee invulnerability', st.playerHp === Combat.PLAYER_MAX_HP);
}

{
  const st = Combat.create([{ id: 's', type: 'skeleton', r: 1, c: 2 }], {});
  st.enemies[0].state = 'windup'; st.enemies[0].timer = 0;
  Combat.update(st, openWorld, player(false), 0.01);
  expect('melee attack damages player', st.playerHp === Combat.PLAYER_MAX_HP - 1);
  expect('post-hit invulnerability is applied', st.playerInvuln > 0);
}

{
  const st = Combat.create([], {});
  st.projectiles.push({ x: 1, y: 1, vx: 4, vy: 0, life: 2 });
  const wallWorld = { solid: x => x >= 1.25, lineClear: () => true };
  Combat.update(st, wallWorld, { x: 9, y: 9, dir: 'left', rolling: false }, 0.1);
  expect('dart disappears when it hits a wall', st.projectiles.length === 0);
}

{
  const st = Combat.create([], {});
  st.projectiles.push({ x: 1.1, y: 1.5, vx: 4, vy: 0, life: 2 });
  Combat.update(st, openWorld, player(true), 0.1);
  expect('roll grants dart invulnerability', st.playerHp === Combat.PLAYER_MAX_HP);
}

{
  const st = Combat.create([{ id: 's', type: 'skeleton', r: 1, c: 2 }], {});
  let died = false;
  for (let i = 0; i < Combat.PLAYER_MAX_HP; i++) {
    st.playerInvuln = 0; st.enemies[0].state = 'windup'; st.enemies[0].timer = 0;
    died = Combat.update(st, openWorld, player(false), 0.01).some(e => e.type === 'playerDead') || died;
  }
  expect('zero health emits player death', st.playerHp === 0 && st.playerDead && died);
}
{
  const st = Combat.create([{ id: 'dead', type: 'skeleton', r: 1, c: 2 }], { dead: true });
  expect('defeated enemies stay defeated within a run', st.enemies.length === 0);
}
{
  const st = Combat.create([{ id: 'tribe', type: 'tribalist', r: 1, c: 2 }], {});
  expect('masked tribalist is a supported ranged enemy', st.enemies.length === 1 && st.enemies[0].type === 'tribalist');
}
{
  const room = { gx: 0, gy: 0, map: ['#####', '#...#', '#...#', '#...#', '#####'], doors: { e: 'combat' } };
  const dun = { rooms: { arena: room } };
  const st = Engine.parseLevel({ map: room.map });
  expect('combat seal stays shut while enemies remain', !Dungeon.passableSides(dun, 'arena', st, {}, false, false).e);
  expect('combat seal opens after the room is cleared', Dungeon.passableSides(dun, 'arena', st, {}, false, true).e);
}

const testRooms = Object.values(TEST_DUNGEON.rooms);
expect('test dungeon has five purpose-built rooms', testRooms.length === 5);
expect('test dungeon uses a cross layout',
  testRooms.some(r => r.gx === 0 && r.gy === 0) &&
  testRooms.some(r => r.gx === 0 && r.gy === -1) &&
  testRooms.some(r => r.gx === -1 && r.gy === 0) &&
  testRooms.some(r => r.gx === 1 && r.gy === 0) &&
  testRooms.some(r => r.gx === 0 && r.gy === 1));
expect('all test rooms use consistent 13x11 presentation', testRooms.every(r => r.map.length === 11 && r.map.every(row => row.length === 13)));
for (const ch of ['b', 'h', 's', 'p', 'c', 'f', 'u', 'o', 'k', 'C', 'd']) {
  expect('test dungeon includes ' + ch, testRooms.some(room => room.map.some(row => row.includes(ch))));
}
const testEnemies = testRooms.flatMap(room => room.enemies || []);
expect('test dungeon contains both enemy types', testEnemies.some(e => e.type === 'skeleton') && testEnemies.some(e => e.type === 'tribalist'));
expect('test dungeon has no developer-room text labels', testRooms.every(room => !room.zones));
expect('every test room has a concise doorway destination label', testRooms.every(room => typeof room.label === 'string' && room.label.length > 0));
expect('hub, trap and treasure rooms use existing relic displays',
  ['hub', 'trap', 'treasure'].every(id => (TEST_DUNGEON.rooms[id].decorations || []).some(d => d.type === 'relic')));
{
  const room = TEST_DUNGEON.rooms.puzzle;
  const st = Engine.parseLevel({ map: room.map, chest: room.chest });
  st.player = { r: 5, c: 11, dir: 'left' };
  const solved = Engine.solveGoal(st, { sword: true, shield: true, glove: true, lantern: true, boots: true }, Engine.switchesDone, 500000);
  expect('gated puzzle room is solvable from its entrance', solved.solvable);
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL COMBAT TESTS PASSED');
process.exit(failures ? 1 : 0);
