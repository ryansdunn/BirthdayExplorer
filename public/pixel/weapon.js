/* BirthdayWorld — paper-airplane weapon system.
 * Self-contained projectile manager. The engine (explore.js) wires it via
 * callbacks so all enemy internals stay in explore.js.
 *
 * BW.makeWeapon(scene, cfg) -> { throw(), throwToward(wx,wy), update(dt), canThrow(), clear() }
 *   cfg.getPlayer()  -> {x, y}
 *   cfg.getFacing()  -> 'down'|'up'|'left'|'right'
 *   cfg.getEnemies() -> array of active enemy objects {x, y, type, consumed, ...}
 *   cfg.onHit(enemy, proj)   -> called when a plane hits a damaging enemy
 *   cfg.projKey      -> texture key (default 'proj_airplane')
 *   cfg.depth        -> render depth (default 22)
 *   cfg.onSpawn(img) -> optional, lets the engine assign cameras/ignore lists
 */
window.BW = window.BW || {};
(function () {
  const COOLDOWN = 380; // ms between throws
  const SPEED = 360;    // px/s
  const LIFE = 1400;    // ms before a plane fades out
  const HIT_RADIUS = 26;
  const DIR = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

  BW.makeWeapon = function (scene, cfg) {
    cfg = cfg || {};
    const projKey = cfg.projKey || 'proj_airplane';
    const depth = cfg.depth == null ? 22 : cfg.depth;
    let projectiles = [];
    let lastThrow = -1e9;

    const canThrow = () => scene.time.now - lastThrow >= COOLDOWN;

    // Spawn a plane travelling along an arbitrary (dx,dy) vector.
    function spawn(dx, dy) {
      if (!canThrow()) return false;
      const len = Math.hypot(dx, dy);
      if (len < 0.0001) return false;
      dx /= len; dy /= len;
      lastThrow = scene.time.now;
      const p = cfg.getPlayer();
      let img;
      if (scene.textures.exists(projKey)) img = scene.add.image(p.x, p.y, projKey);
      else img = scene.add.rectangle(p.x, p.y, 12, 6, 0xffffff).setStrokeStyle(1, 0x888888);
      img.setDepth(depth);
      img.setRotation(Math.atan2(dy, dx)); // airplane art points east by default
      if (cfg.onSpawn) cfg.onSpawn(img);
      projectiles.push({ img, vx: dx * SPEED, vy: dy * SPEED, born: scene.time.now });
      return true;
    }

    // Throw in the player's current facing direction (keyboard).
    function throwPlane() {
      const f = cfg.getFacing() || 'down';
      const [dx, dy] = DIR[f] || DIR.down;
      return spawn(dx, dy);
    }

    // Throw toward a world-space point (mouse click).
    function throwToward(wx, wy) {
      const p = cfg.getPlayer();
      return spawn(wx - p.x, wy - p.y);
    }

    function update(dt) {
      const now = scene.time.now;
      const enemies = cfg.getEnemies ? cfg.getEnemies() : [];
      projectiles = projectiles.filter((pr) => {
        pr.img.x += pr.vx * dt;
        pr.img.y += pr.vy * dt;
        pr.img.y += Math.sin((now - pr.born) / 55) * 0.35; // light "paper" flutter
        for (const e of enemies) {
          if (!e || e.consumed || e.type === 'birthday_cake') continue;
          if (Phaser.Math.Distance.Between(pr.img.x, pr.img.y, e.x, e.y) < HIT_RADIUS) {
            if (cfg.onHit) cfg.onHit(e, pr);
            pr.img.destroy();
            return false;
          }
        }
        if (now - pr.born > LIFE) { pr.img.destroy(); return false; }
        return true;
      });
    }

    function clear() { projectiles.forEach((p) => p.img.destroy()); projectiles = []; }

    return { throw: throwPlane, throwToward, update, canThrow, clear };
  };
})();
