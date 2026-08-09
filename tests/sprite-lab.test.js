'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
function expect(name, ok) {
  if (ok) console.log('  OK  ' + name);
  else { console.error('FAIL  ' + name); failed++; }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'screens.js'), 'utf8');
const start = source.indexOf('const SPRITE_LAB_CHARACTERS');
const end = source.indexOf('function spriteLabFace', start);
const catalogSource = source.slice(start, end)
  .replace('const SPRITE_LAB_CHARACTERS', 'globalThis.SPRITE_LAB_CHARACTERS')
  .replace('const SPRITE_LAB_ANIMS', 'globalThis.SPRITE_LAB_ANIMS');
const sandbox = {};
vm.runInNewContext(catalogSource, sandbox);

const chars = sandbox.SPRITE_LAB_CHARACTERS;
const anims = sandbox.SPRITE_LAB_ANIMS;

expect('sprite lab lists every current character', chars.map(c => c.id).join(',') === 'hero,skeleton,tribalist,ripper');
expect('hero has exactly twelve animations', anims.hero.length === 12);
expect('hero has four idle directions',
  anims.hero.filter(a => a.kind === 'idle').map(a => a.dir).sort().join(',') === 'down,left,right,up');
expect('hero has four walking directions',
  anims.hero.filter(a => a.kind === 'walk').map(a => a.dir).sort().join(',') === 'down,left,right,up');
expect('hero has four pushing directions',
  anims.hero.filter(a => a.kind === 'push').map(a => a.dir).sort().join(',') === 'down,left,right,up');
expect('skeleton frame animation catalog includes all four attack directions',
  anims.skeleton.filter(a => a.kind === 'attackFrames').map(a => a.dir).sort().join(',') === 'down,left,right,up');
expect('skeleton runtime rig prototype only includes attack right',
  anims.skeleton.filter(a => a.kind === 'rigAttack').map(a => a.dir).join(',') === 'right');
expect('masked tribalist exposes all four idle directions',
  anims.tribalist.length === 4
  && anims.tribalist.every(a => a.kind === 'idle')
  && anims.tribalist.map(a => a.dir).sort().join(',') === 'down,left,right,up');
expect('masked tribalist renderer receives the selected direction',
  source.includes('faceX: face[0], faceY: face[1], state:'));

if (failed) {
  console.error('\n' + failed + ' SPRITE LAB TEST(S) FAILED');
  process.exit(1);
}
console.log('\nALL SPRITE LAB TESTS PASSED');
