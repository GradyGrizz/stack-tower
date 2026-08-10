'use strict';
// Reusable real-time combat simulation. Positions are tile-space centres.
// The module has no canvas/save dependencies, so timing and collision rules
// can be tested in Node and reused by future enemy types.

const Combat = {
  ENEMY: {
    skeleton: { hp: 3, speed: 1.35, aggro: 7, range: 0.95, windup: 25 / 36, cooldown: 0.9 },
    // MASKED TRIBALIST — the ranged enemy; it is the one that throws darts.
    // ('dart' was this enemy's old type name and is normalised away in create.)
    tribalist:{ hp: 2, speed: 1.05, aggro: 9, range: 7.0, windup: 0.48, cooldown: 1.45 },
    // EARTH RIPPER — a burrowing ambush enemy. It locks onto where you are
    // standing, commits to that spot, and loses track of you the moment it
    // goes under. Bait it, step aside, and punish the stunned miss.
    // Every field below is tuning; variants (magma/frost/crystal/corrupted)
    // can reuse the AI by overriding these plus `trail`.
    ripper: {
      maxHealth: 2,            // 1-2 sword hits
      aggro: 6.5,              // detectionRange (tiles)
      roamSpeed: 0.55,         // slow wander
      undergroundSpeed: 3.2,   // moderately fast while tunnelling
      lockOnDuration: 0.4,     // readable "it saw me" tell
      burrowStartDuration: 0.3,
      emergenceDelay: 0.12,    // beat under the target before bursting out
      emergeRise: 0.22,        // how long the body takes to rise
      stunDuration: 0.5,       // the punish window after a miss
      recoverDuration: 0.3,
      attackCooldown: 1.4,     // no instant re-attacks
      contactDamage: 1,
      emergenceDamage: 1,
      emergenceRadius: 0.85,   // small and fair
      trailSpawnInterval: 0.07,
      trailLifetime: 0.9,
      maxUnderground: 3.5,     // safety: never tunnel forever
      trail: 'dirt',           // variants swap this for magma/frost/crystal
    },
  },
  PLAYER_MAX_HP: 5,
  PLAYER_INVULN: 0.75,
  ATTACK_ACTIVE: 0.07,
  ATTACK_DURATION: 0.22,
  ATTACK_RANGE: 1.2,

  // `world` is optional; when given, a spawn that lands in stone/a block/hazard
  // is nudged to the nearest open tile. An enemy stuck inside a solid can never
  // move (every step collides) and never shoot (its line of sight starts blocked),
  // so it just stands there looking broken — this keeps authored *and* random
  // spawn points honest.
  create(spawns, defeated, world) {
    const gone = defeated || {};
    return {
      enemies: (spawns || []).filter((s, i) => !gone[s.id || ('enemy-' + i)]).map((s, i) => {
        const raw = s.type === 'dart' ? 'tribalist' : s.type;   // legacy alias
        const type = this.ENEMY[raw] ? raw : 'skeleton';
        const cfg = this.ENEMY[type];
        const hp = cfg.maxHealth != null ? cfg.maxHealth : cfg.hp;
        let x = s.c + 0.5, y = s.r + 0.5;
        if (world && world.solid && world.solid(x, y, 0.27)) {
          const spot = this._nearestClear(world, x, y);
          if (spot) { x = spot.x; y = spot.y; }
        }
        return {
          id: s.id || ('enemy-' + i), type, x, y,
          hp, maxHp: hp, state: 'idle', timer: 0,
          cooldown: (i % 3) * 0.18, flash: 0, dead: false, faceX: 0, faceY: 1,
          roamT: 0.4 + (i % 5) * 0.3, roamX: 0, roamY: 0,
        };
      }),
      projectiles: [],
      effects: [],
      attack: null,
      attackSeq: 0,
      playerHp: this.PLAYER_MAX_HP,
      playerInvuln: 0,
      playerDead: false,
    };
  },

  startAttack(state) {
    if (!state || state.playerDead || state.attack) return false;
    state.attack = { t: 0, struck: false, seq: ++state.attackSeq };
    return true;
  },

  update(state, world, player, dt) {
    if (!state) return [];
    const events = [];
    state.playerInvuln = Math.max(0, state.playerInvuln - dt);
    for (const e of state.enemies) {
      e.flash = Math.max(0, e.flash - dt);
      e.cooldown = Math.max(0, e.cooldown - dt);
      if (e.dead) e.timer -= dt;
    }
    for (const fx of state.effects) fx.t -= dt;
    state.effects = state.effects.filter(fx => fx.t > 0);

    if (state.attack) {
      state.attack.t += dt;
      if (!state.attack.struck && state.attack.t >= this.ATTACK_ACTIVE) {
        state.attack.struck = true;
        this._swordHit(state, player, events);
      }
      if (state.attack.t >= this.ATTACK_DURATION) state.attack = null;
    }

    if (!state.playerDead) {
      for (const enemy of state.enemies) {
        if (enemy.dead) continue;
        this._updateEnemy(state, enemy, world, player, dt, events);
      }
      this._updateProjectiles(state, world, player, dt, events);
    }
    state.enemies = state.enemies.filter(e => !e.dead || e.timer > -0.35);
    return events;
  },

  _swordHit(state, player, events) {
    const dir = {
      up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
    }[player.dir] || [0, 1];
    for (const e of state.enemies) {
      if (e.dead) continue;
      if (this.untouchable(e)) continue;      // below the floor: nothing to cut
      const dx = e.x - player.x, dy = e.y - player.y;
      const dist = Math.hypot(dx, dy);
      const dot = dist > 0 ? (dx * dir[0] + dy * dir[1]) / dist : 1;
      if (dist <= this.ATTACK_RANGE && dot >= 0.25) {
        e.hp--;
        e.flash = 0.14;
        const k = dist > 0 ? 0.24 / dist : 0;
        e.x += dx * k; e.y += dy * k;
        state.effects.push({ type: 'hit', x: e.x, y: e.y, t: 0.18 });
        events.push({ type: 'enemyHit', enemy: e });
        if (e.hp <= 0) {
          e.dead = true; e.timer = 0;
          events.push({ type: 'enemyDead', enemy: e });
        }
      }
    }
  },

  // Only a Ripper that is actually below the floor is safe from the blade.
  // Above ground it is always a legal target — the stunned miss is simply the
  // easiest opening, not the only one.
  untouchable(e) {
    if (e.type !== 'ripper') return false;
    return e.state === 'under' || this.ripperSink(e) > 0.75;
  },

  // how far under the floor it is: 0 = fully up, 1 = fully buried
  ripperSink(e) {
    const cfg = this.ENEMY.ripper;
    if (e.state === 'under') return 1;
    if (e.state === 'burrow') return Math.min(1, 1 - Math.max(0, e.timer) / cfg.burrowStartDuration);
    if (e.state === 'emerge') {
      // holds under the floor for emergenceDelay, then rises
      const rise = Math.max(0, e.timer - 0);
      return Math.max(0, Math.min(1, rise / cfg.emergeRise));
    }
    return 0;
  },

  // nearest cell the creature can legally stand in, searched outward
  _nearestClear(world, x, y) {
    if (!world.solid(x, y, 0.27)) return { x, y };
    for (let r = 0.5; r <= 4; r += 0.5) {
      for (let a = 0; a < 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        const nx = x + Math.cos(t) * r, ny = y + Math.sin(t) * r;
        if (!world.solid(nx, ny, 0.27)) return { x: nx, y: ny };
      }
    }
    return null;
  },

  _updateEnemy(state, e, world, player, dt, events) {
    const cfg = this.ENEMY[e.type];
    let dx = player.x - e.x, dy = player.y - e.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    dx /= dist; dy /= dist;
    // the Ripper aims itself (it must hold its heading once committed), so it
    // is dispatched before the generic "always face the player" rule
    if (e.type === 'ripper') { this._updateRipper(state, e, world, player, dt, events, cfg, dx, dy, dist); return; }
    // out of aggro: wander instead of standing frozen, so the room feels alive
    if (dist > cfg.aggro) { this._roam(e, world, dt, cfg); return; }
    e.faceX = dx; e.faceY = dy;

    if (e.state === 'windup') {
      e.timer -= dt;
      if (e.timer <= 0) {
        if (e.type === 'skeleton') {
          if (dist <= cfg.range + 0.25) this._hurtPlayer(state, player, 1, dx, dy, events, 'melee');
        } else {
          state.projectiles.push({ x: e.x, y: e.y, vx: dx * 4.4, vy: dy * 4.4, life: 2.4 });
          events.push({ type: 'dartFired', enemy: e });
        }
        e.state = 'cooldown'; e.cooldown = cfg.cooldown;
      }
      return;
    }
    if (e.cooldown > 0) {
      e.state = 'cooldown';
      // keep working the spacing between shots rather than freezing in place
      if (e.type !== 'skeleton') {
        const sign = dist < 2.6 ? -1 : (dist > 4.6 ? 1 : 0);
        if (sign) this._move(e, dx * sign, dy * sign, cfg.speed * 0.7 * dt, world);
      }
      return;
    }

    if (e.type === 'skeleton') {
      if (dist <= cfg.range) { e.state = 'windup'; e.timer = cfg.windup; events.push({ type: 'enemyWindup', enemy: e }); }
      else this._move(e, dx, dy, cfg.speed * dt, world);
    } else {
      if (dist >= 2.8 && dist <= cfg.range && world.lineClear(e.x, e.y, player.x, player.y)) {
        e.state = 'windup'; e.timer = cfg.windup; events.push({ type: 'enemyWindup', enemy: e });
      } else {
        const sign = dist < 2.5 ? -1 : 1;
        this._move(e, dx * sign, dy * sign, cfg.speed * dt, world);
      }
    }
  },

  // EARTH RIPPER loop — bait, dodge, punish:
  //   roam -> spot you -> LOCK the tile you are standing on -> burrow ->
  //   tunnel blind to that saved tile -> burst out -> hit, or miss and reel.
  // The commitment is the whole point: once it is under, it has no idea where
  // you actually are, so stepping aside is always the correct answer.
  _updateRipper(state, e, world, player, dt, events, cfg, dx, dy, dist) {
    e.timer -= dt;
    if (e.trail) { for (const m of e.trail) m.t -= dt; e.trail = e.trail.filter(m => m.t > 0); }

    const faceTo = (fx, fy) => {
      const m = Math.hypot(fx, fy);
      if (m > 0.001) { e.faceX = fx / m; e.faceY = fy / m; }
    };
    const touch = () => {
      if (dist < 0.72) this._hurtPlayer(state, player, cfg.contactDamage, -dx, -dy, events, 'ripper');
    };

    switch (e.state) {

      // ── committed: sinking out of sight, target already locked ──
      case 'burrow':
        if (e.timer <= 0) {
          e.state = 'under'; e.timer = cfg.maxUnderground;
          e.safeX = e.x; e.safeY = e.y;
          events.push({ type: 'ripperDig', enemy: e });
        }
        return;

      // ── blind travel to the SAVED tile (never re-targets the player) ──
      case 'under': {
        const tx = e.lockX, ty = e.lockY;
        let vx = tx - e.x, vy = ty - e.y;
        const d = Math.hypot(vx, vy) || 0.0001;
        // slight wobble so it reads as a burrowing creature, not a projectile
        const wob = Math.sin((cfg.maxUnderground - e.timer) * 9) * 0.22;
        const nx = (vx / d) - (vy / d) * wob, ny = (vy / d) + (vx / d) * wob;
        this._move(e, nx, ny, cfg.undergroundSpeed * dt, world, true);
        faceTo(vx, vy);
        if (!world.solid(e.x, e.y, 0.27)) { e.safeX = e.x; e.safeY = e.y; }
        this._ripperTrail(e, cfg, dt);
        // arrived (or ran out of patience / got stuck): come up
        const arrived = d <= 0.18;
        if (arrived || e.timer <= 0) {
          let spot = this._nearestClear(world, e.x, e.y);
          if (!spot && e.safeX != null) spot = { x: e.safeX, y: e.safeY };
          if (spot) { e.x = spot.x; e.y = spot.y; }
          e.state = 'emerge'; e.timer = cfg.emergeRise + cfg.emergenceDelay;
          e.struckOnEmerge = false;
          events.push({ type: 'ripperBurst', enemy: e });
        }
        return;
      }

      // ── bursting out: one hit check, at the spot it committed to ──
      case 'emerge': {
        if (!e.struckOnEmerge && e.timer <= cfg.emergeRise) {
          e.struckOnEmerge = true;                       // resolve the ambush once
          const hit = Math.hypot(player.x - e.x, player.y - e.y) <= cfg.emergenceRadius;
          if (hit) {
            this._hurtPlayer(state, player, cfg.emergenceDamage,
              player.x - e.x, player.y - e.y, events, 'ripper');
            e.missed = false;
          } else {
            e.missed = true;                             // whiffed: it is now yours
            events.push({ type: 'ripperMiss', enemy: e });
          }
        }
        if (e.timer <= 0) {
          if (e.missed) { e.state = 'stun'; e.timer = cfg.stunDuration; }
          else { e.state = 'recover'; e.timer = cfg.recoverDuration; }
        }
        return;
      }

      // ── the punish window: dazed, rooted, fully vulnerable ──
      case 'stun':
        if (e.timer <= 0) { e.state = 'recover'; e.timer = cfg.recoverDuration; }
        return;

      // ── shaking it off before it may attack again ──
      case 'recover':
        if (e.timer <= 0) { e.state = 'idle'; e.timer = 0; e.cooldown = cfg.attackCooldown; }
        return;

      // ── winding up: facing you, saving the tile you are standing on ──
      case 'lockon':
        faceTo(dx, dy);
        touch();
        if (e.timer <= 0) {
          const spot = this._nearestClear(world, player.x, player.y);   // never lock a wall
          e.lockX = spot ? spot.x : e.x;
          e.lockY = spot ? spot.y : e.y;
          e.state = 'burrow'; e.timer = cfg.burrowStartDuration;
        }
        return;

      // ── idle / roam ──
      default: {
        touch();
        if (dist <= cfg.aggro && e.cooldown <= 0) {
          e.state = 'lockon'; e.timer = cfg.lockOnDuration;
          faceTo(dx, dy);
          events.push({ type: 'enemyWindup', enemy: e });
          return;
        }
        // slow wander: pick a nearby spot, amble to it, pick another
        if (e.roamX == null || e.timer <= 0 ||
            Math.hypot(e.roamX - e.x, e.roamY - e.y) < 0.25) {
          const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2;
          const spot = this._nearestClear(world, e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
          e.roamX = spot ? spot.x : e.x; e.roamY = spot ? spot.y : e.y;
          e.timer = 1.5 + Math.random();
        }
        let rx = e.roamX - e.x, ry = e.roamY - e.y;
        const rd = Math.hypot(rx, ry) || 1;
        this._move(e, rx / rd, ry / rd, cfg.roamSpeed * dt, world);
        faceTo(rx, ry);
        return;
      }
    }
  },

  // dirt churned up along the tunnel, so the path is always readable
  _ripperTrail(e, cfg, dt) {
    e.trail = e.trail || [];
    e.trailT = (e.trailT || 0) - dt;
    if (e.trailT <= 0) {
      e.trailT = cfg.trailSpawnInterval;
      e.trail.push({ x: e.x, y: e.y, t: cfg.trailLifetime, life: cfg.trailLifetime });
      if (e.trail.length > 40) e.trail.shift();
    }
  },

  // idle wander: stroll a little, pause, pick a new heading. Bumping a wall
  // immediately re-rolls the heading so nobody grinds against the stone.
  _roam(e, world, dt, cfg) {
    e.state = 'idle';
    e.roamT = (e.roamT || 0) - dt;
    if (e.roamT <= 0) {
      if (e.roamX || e.roamY) {                       // was walking -> rest
        e.roamX = 0; e.roamY = 0; e.roamT = 0.5 + Math.random() * 1.1;
      } else {                                        // was resting -> walk
        const a = Math.random() * Math.PI * 2;
        e.roamX = Math.cos(a); e.roamY = Math.sin(a);
        e.roamT = 0.6 + Math.random() * 1.0;
      }
    }
    if (!e.roamX && !e.roamY) return;
    const speed = cfg.roamSpeed != null ? cfg.roamSpeed : (cfg.speed || 1) * 0.45;
    const px = e.x, py = e.y;
    this._move(e, e.roamX, e.roamY, speed * dt, world);
    if (Math.abs(e.x - px) < 1e-9 && Math.abs(e.y - py) < 1e-9) { e.roamT = 0; return; }  // wall: re-roll
    e.faceX = e.roamX; e.faceY = e.roamY;
  },

  _move(e, dx, dy, step, world, underground) {
    // a tunnelling creature passes under blocks and hazards; only the room's
    // outer stone stops it (falls back to normal collision if the world can't
    // tell the difference, so the sim still runs standalone in tests)
    const blocked = underground && world.solidWall
      ? (x, y) => world.solidWall(x, y, 0.27)
      : (x, y) => world.solid(x, y, 0.27);
    const nx = e.x + dx * step;
    if (!blocked(nx, e.y)) e.x = nx;
    const ny = e.y + dy * step;
    if (!blocked(e.x, ny)) e.y = ny;
  },

  _updateProjectiles(state, world, player, dt, events) {
    for (const p of state.projectiles) {
      p.life -= dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) * dt / 0.18));
      for (let i = 0; i < steps && p.life > 0; i++) {
        p.x += p.vx * dt / steps; p.y += p.vy * dt / steps;
        if (world.solid(p.x, p.y, 0.10)) { p.life = 0; events.push({ type: 'dartImpact', x: p.x, y: p.y }); break; }
        if (Math.hypot(p.x - player.x, p.y - player.y) < 0.42) {
          this._hurtPlayer(state, player, 1, p.vx, p.vy, events, 'dart');
          p.life = 0; break;
        }
      }
    }
    state.projectiles = state.projectiles.filter(p => p.life > 0);
  },

  _hurtPlayer(state, player, amount, dx, dy, events, source) {
    if (state.playerDead || state.playerInvuln > 0 || player.rolling) return false;
    state.playerHp = Math.max(0, state.playerHp - amount);
    state.playerInvuln = this.PLAYER_INVULN;
    const len = Math.hypot(dx, dy) || 1;
    events.push({ type: 'playerHit', hp: state.playerHp, dx: dx / len, dy: dy / len, source });
    if (state.playerHp <= 0) {
      state.playerDead = true;
      events.push({ type: 'playerDead' });
    }
    return true;
  },

  render(state, ctx, board, t) {
    if (!state || !board) return;
    const { bx, by, T } = board;
    for (const e of state.enemies) {
      if (e.dead && e.timer < -0.35) continue;
      const x = bx + (e.x - 0.5) * T, y = by + (e.y - 0.5) * T;
      ctx.save();
      if (e.flash > 0) ctx.globalAlpha = 0.45 + 0.55 * Math.sin(t * 55);
      if (e.dead) ctx.globalAlpha = Math.max(0, 1 + e.timer / 0.35);
      if (e.type === 'skeleton') this._drawSkeleton(ctx, x, y, T, e);
      else if (e.type === 'ripper') this._drawRipper(ctx, x, y, T, e, t);
      else this._drawDarter(ctx, x, y, T, e);
      ctx.restore();
    }
    for (const p of state.projectiles) {
      const x = bx + p.x * T, y = by + p.y * T;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillStyle = '#d9c46b'; ctx.fillRect(-T * 0.22, -2, T * 0.44, 4);
      ctx.fillStyle = '#7b5931'; ctx.fillRect(-T * 0.28, -1, T * 0.12, 2);
      ctx.restore();
    }
    for (const fx of state.effects) {
      const x = bx + fx.x * T, y = by + fx.y * T;
      ctx.fillStyle = `rgba(255,235,150,${Math.min(1, fx.t * 6)})`;
      ctx.fillRect(x - 3, y - T * 0.36, 6, T * 0.72);
      ctx.fillRect(x - T * 0.36, y - 3, T * 0.72, 6);
    }
  },

  // Draws the uploaded Earth Ripper sprite. The sprite itself is never warped,
  // stretched or recoloured — pose changes come only from whole-pixel offsets
  // and from clipping it at the floor line as it sinks or rises. Dirt, dust
  // and dizzy stars are separate VFX drawn around the creature, not on it.
  _drawRipper(ctx, x, y, T, e, t) {
    if (typeof Art === 'undefined' || !Art.ripper) return;
    const cfg = this.ENEMY.ripper;

    // the churned tunnel is drawn first, underneath everything
    if (e.trail && e.trail.length) {
      for (const m of e.trail) {
        const mx = x + (m.x - e.x) * T, my = y + (m.y - e.y) * T;
        Art.ripperTrailMark(ctx, mx, my, T, m.t / (m.life || cfg.trailLifetime), cfg.trail);
      }
    }

    const dir = Math.abs(e.faceX) > Math.abs(e.faceY)
      ? (e.faceX > 0 ? 'right' : 'left')
      : (e.faceY > 0 ? 'down' : 'up');
    const sink = this.ripperSink(e);

    if (e.state === 'under') {                     // body hidden; only the mound
      Art.ripperMound(ctx, x, y, T, t, true);
      return;
    }

    const o = { sink, flash: e.flash > 0 ? Math.min(1, e.flash * 5) : 0 };
    const px = Math.max(1, Math.round(T / 30));    // one "art pixel" at this zoom

    if (e.state === 'stun') {
      // dizzy: whole-pixel sway, no distortion
      o.shake = Math.round(Math.sin(t * 26) * 1.6) * px;
    } else if (e.state === 'lockon') {
      // the tell: one small hop up and back down — no shaking, just the "!"
      o.bob = -Math.round(Math.max(0, Math.sin(t * 9)) * 2) * px;
    } else if (e.state === 'burrow') {
      // digging in: the body shivers as it works itself under the floor
      o.shake = Math.round(Math.sin(t * 60) * 1.2) * px;
    } else if (e.state === 'idle' || e.state === 'recover') {
      // slow plodding bob — a 2-step cycle, integer pixels only
      o.bob = (Math.sin(t * 5) > 0 ? -1 : 0) * px;
    }
    if (e.dead) o.scale = 1 - Math.min(1, -e.timer / 0.35) * 0.4;

    if (sink > 0 && sink < 1) Art.ripperMound(ctx, x, y, T, t, false);
    Art.ripper(ctx, dir, x, y, T, o);

    // dirt kicked up while digging in or bursting out
    if (e.state === 'burrow') Art.ripperDust(ctx, x, y, T, 1 - sink);
    else if (e.state === 'emerge') Art.ripperDust(ctx, x, y, T, sink);
    // stars while it reels
    if (e.state === 'stun') Art.ripperStars(ctx, x, y, T, t);
    // the "!" rides the hop so the tell reads at a glance
    if (e.state === 'lockon') Art.ripperAlert(ctx, x, y, T, -(o.bob || 0));
  },

  _drawSkeleton(ctx, x, y, T, e) {
    const attackRight = typeof Art !== 'undefined' && Art.img && Art.img.skeleton_attack_right;
    const facingHorizontal = Math.abs(e.faceX) > Math.abs(e.faceY);
    const facingRight = facingHorizontal && e.faceX > 0;
    const facingLeft = facingHorizontal && e.faceX < 0;
    const attackDir = facingHorizontal ? 'right' : (e.faceY < 0 ? 'up' : 'down');
    const sourceDir = facingLeft ? 'right' : attackDir;
    const attack = typeof SKELETON_ATTACKS !== 'undefined' ? SKELETON_ATTACKS[sourceDir] : null;
    const attackElapsed = this.ENEMY.skeleton.windup - Math.max(0, e.timer);
    const frame = typeof spriteLabAttackFrameAt === 'function'
      ? spriteLabAttackFrameAt(attackElapsed) : 0;
    const frameImage = attack && typeof Art !== 'undefined' && Art.img
      ? Art.img[attack.prefix + String(frame + 1).padStart(2, '0')] : null;
    if (e.state === 'windup' && frameImage && Art._ready(frameImage)
        && typeof spriteLabAttackImage === 'function') {
      const scale = attack.scale[frame];
      const drawImg = spriteLabAttackImage(frameImage, sourceDir, frame);
      // Each direction has a measured base box that matches its idle body height.
      const box = T * attack.gameBox * scale;
      const iw = drawImg.naturalWidth || drawImg.width;
      const ih = drawImg.naturalHeight || drawImg.height;
      const fit = Math.min(box / iw, box / ih);
      const dw = Math.round(iw * fit), dh = Math.round(ih * fit);
      const cy = y + T - (attack.feet[frame] - 0.5) * box;
      ctx.imageSmoothingEnabled = false;
      const centerX = Math.round(x + T / 2);
      const dy = Math.round(cy - dh / 2);
      if (facingLeft) {
        ctx.save();
        ctx.translate(centerX, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(drawImg, Math.round(-dw / 2), dy, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(drawImg, Math.round(centerX - dw / 2), dy, dw, dh);
      }
      return;
    }
    if (e.state === 'windup' && facingRight && attackRight && Art._ready(attackRight)) {
      const progress = 1 - Math.max(0, e.timer) / this.ENEMY.skeleton.windup;
      const oldFrame = Math.min(7, Math.max(0, Math.floor(progress * 8)));
      const sx = Math.floor(oldFrame * attackRight.naturalWidth / 8);
      const ex = Math.floor((oldFrame + 1) * attackRight.naturalWidth / 8);
      const sw = ex - sx, sh = attackRight.naturalHeight;
      const dh = Math.round(T * 3.4), dw = Math.round(dh * sw / sh);
      const dx = Math.round(x + (T - dw) / 2);
      const dy = Math.round(y - T * 1.33);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(attackRight, sx, 0, sw, sh, dx, dy, dw, dh);
      return;
    }
    const sprite = typeof Art !== 'undefined' && Art.img && Art.img.skeleton;
    if (sprite && Art._ready(sprite)) {
      const dir = Math.abs(e.faceX) > Math.abs(e.faceY)
        ? (e.faceX < 0 ? 'left' : 'right')
        : (e.faceY < 0 ? 'up' : 'down');
      const frames = {
        left:  [373, 175, 238, 319],
        right: [927, 175, 237, 319],
        up:    [429, 591, 231, 299],
        down:  [882, 591, 232, 299],
      };
      const [sx, sy, sw, sh] = frames[dir];
      const dh = Math.round(T * 1.12);
      const dw = Math.round(dh * sw / sh);
      const dx = Math.round(x + (T - dw) / 2);
      const dy = Math.round(y + T - dh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }
    const w = Math.max(2, Math.floor(T / 9));
    ctx.fillStyle = '#e4dfc6';
    ctx.fillRect(x + T * 0.31, y + T * 0.12, T * 0.38, T * 0.28);
    ctx.fillRect(x + T * 0.39, y + T * 0.40, T * 0.22, T * 0.36);
    ctx.fillStyle = '#17131b';
    ctx.fillRect(x + T * 0.38, y + T * 0.22, w, w);
    ctx.fillRect(x + T * 0.57, y + T * 0.22, w, w);
    ctx.strokeStyle = e.state === 'windup' ? '#ff6655' : '#c8a647';
    ctx.lineWidth = Math.max(2, T / 12);
    ctx.beginPath(); ctx.moveTo(x + T * 0.62, y + T * 0.48); ctx.lineTo(x + T * 0.88, y + T * 0.18); ctx.stroke();
  },

  _drawDarter(ctx, x, y, T, e) {
    const sprite = typeof Art !== 'undefined' && Art.img && Art.img.masked_tribalist;
    if (sprite && Art._ready(sprite)) {
      const dir = Math.abs(e.faceX || 0) > Math.abs(e.faceY || 0)
        ? (e.faceX < 0 ? 'left' : 'right')
        : (e.faceY < 0 ? 'up' : 'down');
      const frames = {
        left:  [343, 1, 102, 193],
        right: [58, 0, 100, 194],
        up:    [60, 307, 114, 196],
        down:  [328, 309, 112, 194],
      };
      const [sx, sy, sw, sh] = frames[dir];
      // Share the skeleton's foot line and top height. The feathered silhouette
      // fills that height, leaving the tribalist's body intentionally smaller.
      const dh = Math.round(T * 1.12);
      const dw = Math.round(dh * sw / sh);
      const dx = Math.round(x + (T - dw) / 2);
      const dy = Math.round(y + T - dh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }
    ctx.fillStyle = e.state === 'windup' ? '#d96a4e' : '#7762a8';
    ctx.fillRect(x + T * 0.22, y + T * 0.24, T * 0.56, T * 0.54);
    ctx.fillStyle = '#d8c8a0';
    ctx.fillRect(x + T * 0.34, y + T * 0.12, T * 0.32, T * 0.28);
    ctx.fillStyle = '#2c203b';
    ctx.fillRect(x + T * 0.42, y + T * 0.20, Math.max(2, T / 9), Math.max(2, T / 9));
    ctx.fillStyle = '#b48a45';
    ctx.fillRect(x + T * 0.62, y + T * 0.43, T * 0.28, Math.max(3, T / 10));
  },
};

if (typeof window !== 'undefined') window.Combat = Combat;
if (typeof module !== 'undefined') module.exports = { Combat };
