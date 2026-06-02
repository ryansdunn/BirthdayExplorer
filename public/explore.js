/* BirthdayWorld — pixel-art Zelda-style explorer scene.
 * Rendering, terrain and sprites come from the pixel/* modules (window.BW):
 *   BW.makeNoise / BW.hashStringToSeed   (noise.js)
 *   BW.palettes                          (palettes.js)
 *   BW.sprites.generate / npcTextureFor  (sprites.js)
 *   BW.textures.generate                 (textures.js, called by terrain)
 *   BW.terrain.build                     (terrain.js)
 *   BW.makeWeapon                        (weapon.js)
 * Everything is generated at runtime — zero binary assets. */

const FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const TILE = 32;
const CHUNK_TILES = 16;
const CHUNK_PX = TILE * CHUNK_TILES; // 512
const PLAYER_SPEED = 160;
const TALK_RANGE = 60;
const TYPE_SPEED = 30; // ms per character
const MAX_HEALTH = 6; // half-hearts (3 hearts)
const DAY_LENGTH = 10 * 60 * 1000;
const ENEMY_RESPAWN_MS = 30 * 1000;
const CAM_ZOOM = 2;

const THEME_COLORS = {
  forest: 0x2d4a1e, beach: 0x1a6b8a, cave: 0x3a2820,
  snow: 0xb0ccd8, desert: 0x8a7040, magical: 0x3a2060, hub: 0x3a5a3a,
};
const DUST_COLORS = {
  forest: 0x6b5a3a, beach: 0xe8d6a0, cave: 0x6a5a50,
  snow: 0xffffff, desert: 0xe8d6a0, magical: 0xc9a8ff, hub: 0x8a9a7a,
};

const worldId = location.pathname.split('/').pop();

class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
    this.npcs = [];
    this.chunkState = new Map();
    this.enemies = []; // all roaming enemies, visible/active everywhere
    this.projectiles = []; // confetti from bombers
    this.dialogue = null;
    this.health = MAX_HEALTH;
    this.facing = 'down';
    this.curAnim = '';
    this.walkPhase = 0;
    this.stepAccum = 0;
    this.invincibleUntil = 0;
    this.frozenUntil = 0;
    this.activeKey = null;
    this.visited = new Set();
    this.hud = [];
  }

  addWorld(o) { this.worldLayer.add(o); return o; }
  addHud(o) { this.uiLayer.add(o); return o; }

  async create() {
    this.makeSparkTexture();
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({ w: 'W', a: 'A', s: 'S', d: 'D' });

    let world = null, chunks = [];
    try {
      [world, chunks] = await Promise.all([
        fetch(`/worlds/${worldId}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/worlds/${worldId}/chunks`).then((r) => (r.ok ? r.json() : [])),
      ]);
    } catch (e) { chunks = []; }

    this.world = world || {};
    this.chunks = chunks;
    this.enemyConfig = (world && world.enemy_config) || {};
    this.terrainStyle = (world && world.terrain_style) || 'island';
    this.playerDesign = (world && world.player_sprite) || 'wanderer';
    this.playerName = (world && world.player_name) || (world && world.birthday_person) || 'Explorer';
    document.getElementById('loading').style.display = 'none';

    this.coordSet = new Set(['0,0']);
    chunks.forEach((c) => this.coordSet.add(`${c.coord_x},${c.coord_y}`));

    // Render layers so the two cameras can cleanly split world vs HUD.
    this.worldLayer = this.add.layer();
    this.uiLayer = this.add.layer().setDepth(1000);

    // Generate sprites, then build + render terrain (terrain calls textures.generate).
    BW.sprites.generate(this, { playerDesign: this.playerDesign });
    this.terrain = BW.terrain.build(this, {
      chunks, coordKeys: this.coordSet, style: this.terrainStyle,
      seed: BW.hashStringToSeed(worldId),
    });
    // Reparent everything terrain created at the root into the world layer.
    this.children.getChildren().slice().forEach((o) => {
      if (o === this.worldLayer || o === this.uiLayer) return;
      this.worldLayer.add(o);
    });

    // World bounds (px) over every occupied chunk — enemies roam the whole
    // island rather than being confined to their home chunk.
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    this.coordSet.forEach((key) => {
      const [cx, cy] = key.split(',').map(Number);
      bMinX = Math.min(bMinX, cx * CHUNK_PX); bMinY = Math.min(bMinY, cy * CHUNK_PX);
      bMaxX = Math.max(bMaxX, (cx + 1) * CHUNK_PX); bMaxY = Math.max(bMaxY, (cy + 1) * CHUNK_PX);
    });
    this.worldBounds = { minX: bMinX + 24, minY: bMinY + 24, maxX: bMaxX - 24, maxY: bMaxY - 24 };

    // Ambient particles + NPCs per themed chunk (no more fog — the whole world
    // is visible from the start so you can see what's out there before entering).
    const npcByKey = new Map();
    chunks.forEach((c) => npcByKey.set(`${c.coord_x},${c.coord_y}`, c));
    this.coordSet.forEach((key) => {
      const [cx, cy] = key.split(',').map(Number);
      const c = npcByKey.get(key);
      if (c) { this.spawnNpc(c); this.addAmbient(cx, cy, c.theme); }
      this.chunkState.set(key, { themed: !!c, def: c });
    });

    // All enemies spawn up front and stay visible/active everywhere.
    this.spawnAllEnemies();

    if (chunks.length === 0) {
      this.addWorld(this.add.text(CHUNK_PX / 2, CHUNK_PX / 2, 'waiting for contributors…', {
        fontFamily: FONT, fontSize: '18px', color: '#dfe6f5',
      }).setOrigin(0.5).setDepth(5));
    }

    this.buildPlayer();
    this.buildHud();
    this.initPortrait();
    this.setupDialogueUi();
    this.setupTouchControls();
    this.buildOverlays(world);
    this.setupWeapon();
    this.setupCameras();

    this.input.keyboard.on('keydown-E', () => this.onInteract());
    this.input.keyboard.on('keydown-SPACE', () => { if (!this.gameOver) this.onInteract(); });
    this.input.keyboard.on('keydown-F', () => { if (!this.dialogue && !this.gameOver) this.weapon.throw(); });

    // Mouse aim: click anywhere to throw a paper airplane toward that point.
    // (Touch devices use the on-screen throw button + joystick instead.)
    if (!this.sys.game.device.input.touch) {
      this.input.on('pointerdown', (pointer) => {
        if (this.dialogue || this.gameOver) return;
        const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const dx = wp.x - this.player.x, dy = wp.y - this.player.y;
        if (Math.abs(dx) > Math.abs(dy)) this.facing = dx < 0 ? 'left' : 'right';
        else this.facing = dy < 0 ? 'up' : 'down';
        this.weapon.throwToward(wp.x, wp.y);
      });
    }

    this.startTime = this.time.now;
    this.markVisited(0, 0);
  }

  makeSparkTexture() {
    if (this.textures.exists('spark')) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 4);
    g.generateTexture('spark', 8, 8); g.destroy();
  }

  chunkOrigin(cx, cy) { return { x: cx * CHUNK_PX, y: cy * CHUNK_PX }; }

  // ---- NPCs (generated pixel body + floating nameplate, gentle idle bob) ----
  spawnNpc(c) {
    const ground = this.terrain.chunkCenterLand(c.coord_x, c.coord_y);
    const px = ground.x, py = ground.y;
    const key = BW.sprites.npcTextureFor(this, c.sprite);

    const container = this.add.container(px, py).setDepth(16);
    const sprite = this.add.sprite(0, 0, key).setOrigin(0.5, 1);
    const nameplate = this.add.text(0, -44, c.contributor_name || 'A friend', {
      fontFamily: FONT, fontSize: '12px', color: '#eef3ff',
      backgroundColor: 'rgba(16,22,30,0.82)', padding: { x: 7, y: 3 },
    }).setOrigin(0.5, 1);
    let greetingText = null;
    if (c.greeting) {
      greetingText = this.add.text(0, -62, c.greeting, {
        fontFamily: FONT, fontSize: '11px', color: '#fff8d0',
        backgroundColor: 'rgba(40,30,10,0.78)', padding: { x: 6, y: 4 },
        wordWrap: { width: 160 }, align: 'center',
      }).setOrigin(0.5, 1).setVisible(false);
    }
    container.add(greetingText ? [sprite, nameplate, greetingText] : [sprite, nameplate]);
    this.addWorld(container);

    this.npcs.push({
      data: c, x: px, y: py, container, sprite, greetingText, texKey: key,
      baseY: py, bob: Math.random() * Math.PI * 2, nextFace: 0, visited: false,
    });
  }

  // ---- player --------------------------------------------------------------
  buildPlayer() {
    const sp = this.terrain.spawnPoint();
    this.player = this.add.container(sp.x, sp.y).setDepth(20);
    this.playerSprite = this.add.sprite(0, 0, 'player_down_0').setOrigin(0.5, 1);
    this.playerSprite.play('player_idle_down');
    this.curAnim = 'player_idle_down';
    const nameplate = this.add.text(0, -46, this.playerName, {
      fontFamily: FONT, fontSize: '12px', color: '#ffffff',
      backgroundColor: 'rgba(16,22,30,0.82)', padding: { x: 7, y: 3 },
    }).setOrigin(0.5, 1);
    this.player.add([this.playerSprite, nameplate]);
    this.addWorld(this.player);

    this.talkHint = this.addWorld(this.add.text(0, 0, 'SPACE to talk', {
      fontFamily: FONT, fontSize: '11px', color: '#10131f',
      backgroundColor: '#ffe27a', padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setDepth(30).setVisible(false));
  }

  updatePlayerAnim(moving) {
    const key = (moving ? 'player_walk_' : 'player_idle_') + this.facing;
    if (key !== this.curAnim) { this.playerSprite.play(key, true); this.curAnim = key; }
  }

  // ---- cameras: main (zoomed, world) + ui (unzoomed, HUD) ------------------
  setupCameras() {
    const cam = this.cameras.main;
    cam.setZoom(CAM_ZOOM);
    cam.startFollow(this.player, true, 0.09, 0.09);
    cam.setBackgroundColor('#1b4a63'); // open ocean beyond the island's water apron
    cam.ignore(this.uiLayer);

    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.ignore(this.worldLayer);

    this.scale.on('resize', (size) => {
      this.uiCam.setSize(size.width, size.height);
      this.layoutHud();
      this.repositionDialogue();
    });
  }

  // ---- HUD -----------------------------------------------------------------
  buildHud() {
    // Hearts sit top-right (matching the portfolio screenshot).
    this.heartsGfx = this.addHud(this.add.graphics().setScrollFactor(0).setDepth(100));

    // Paper-airplane weapon indicator (generated sprite, no emoji).
    this.weaponInd = this.addHud(this.add.image(0, 0, 'proj_airplane')
      .setScale(1.6).setScrollFactor(0).setDepth(100));

    this.compass = this.addHud(this.add.container(0, 0).setScrollFactor(0).setDepth(100));
    const cring = this.add.circle(0, 0, 22, 0x10131f, 0.7).setStrokeStyle(2, 0xffffff, 0.6);
    this.compassArrow = this.add.triangle(0, 0, 0, -14, -7, 8, 7, 8, 0xff5fa2);
    this.compassLabel = this.add.text(0, 26, 'friend', {
      fontFamily: FONT, fontSize: '10px', color: '#cdd6f0',
    }).setOrigin(0.5, 0);
    this.compass.add([cring, this.compassArrow, this.compassLabel]);

    this.minimap = this.addHud(this.add.graphics().setScrollFactor(0).setDepth(100));
    this.layoutHud();
    this.drawHearts();
  }

  layoutHud() {
    const cam = this.cameras.main;
    if (this.weaponInd) this.weaponInd.setPosition(28, cam.height - 28);
    if (this.compass) this.compass.setPosition(cam.width - 40, 130);
    if (this.heartsGfx) this.drawHearts();
    if (this.throwBtn) { this.throwBtn.setPosition(cam.width - 60, cam.height - 70); this.throwLabel.setPosition(cam.width - 60, cam.height - 70); }
    if (this.talkBtn) { this.talkBtn.setPosition(cam.width / 2, cam.height - 64); this.talkLabel.setPosition(cam.width / 2, cam.height - 64); }
  }

  drawHearts() {
    const g = this.heartsGfx; g.clear();
    const cam = this.cameras.main;
    const count = MAX_HEALTH / 2;
    const gap = 30, right = cam.width - 20;
    for (let h = 0; h < count; h++) {
      const cx = right - (count - 1 - h) * gap, cy = 26;
      const filled = this.health - h * 2;
      this.drawHeart(g, cx, cy, 11, 0x3a1020);
      if (filled >= 2) this.drawHeart(g, cx, cy, 11, 0xff4d6d);
      else if (filled === 1) {
        this.drawHeart(g, cx, cy, 11, 0xff4d6d);
        g.fillStyle(0x3a1020, 1); g.fillRect(cx, cy - 14, 16, 28);
      }
    }
  }

  drawHeart(g, cx, cy, r, color) {
    g.fillStyle(color, 1);
    g.fillCircle(cx - r * 0.5, cy - r * 0.35, r * 0.55);
    g.fillCircle(cx + r * 0.5, cy - r * 0.35, r * 0.55);
    g.fillTriangle(cx - r, cy - r * 0.25, cx + r, cy - r * 0.25, cx, cy + r);
  }

  // ---- living portrait (DOM roster of people met) -------------------------
  initPortrait() {
    this.discovered = new Set();
    const el = (id) => document.getElementById(id);
    this.portraitEls = {
      card: el('portrait'), hbd: el('pHappyBday'), progress: el('pProgress'),
      bar: el('pBar'), list: el('pList'), hint: el('pHint'), tip: el('pTip'),
    };
    const p = this.portraitEls;
    if (!p.card) return;
    p.card.style.display = 'block';
    if (p.hbd) p.hbd.textContent = `Happy Birthday, ${this.playerName}`;
    this.portraitTotal = this.npcs.length;
    this.updatePortraitProgress();
  }

  updatePortraitProgress() {
    const p = this.portraitEls; if (!p || !p.card) return;
    const found = this.discovered.size, total = this.portraitTotal || 0;
    if (p.progress) p.progress.textContent = `${found}/${total} discovered`;
    if (p.bar) p.bar.style.width = total ? `${Math.round((found / total) * 100)}%` : '0%';
    if (p.hint) {
      if (total === 0) p.hint.textContent = 'No one has planted a patch in this world yet.';
      else if (found === 0) p.hint.textContent = "You're a stranger here. Walk up to someone and press SPACE to talk.";
      else if (found >= total) p.hint.textContent = `You've met everyone in ${this.playerName}'s world.`;
      else p.hint.textContent = 'Explore the world, find messages from your loved ones.';
    }
  }

  discoverNpc(npc) {
    const p = this.portraitEls; if (!p || !p.card) return;
    const data = npc.data;
    const id = `${data.coord_x},${data.coord_y}`;
    if (this.discovered.has(id)) return;
    this.discovered.add(id);

    const row = document.createElement('li');
    row.className = 'p-row';

    const canvas = document.createElement('canvas');
    canvas.className = 'p-av';
    BW.characters.drawToCanvas(canvas, data.sprite, 2);

    const meta = document.createElement('div');
    meta.className = 'p-meta';
    const nm = document.createElement('div');
    nm.className = 'p-nm';
    nm.textContent = data.contributor_name || 'A friend';
    meta.appendChild(nm);

    row.appendChild(canvas);
    row.appendChild(meta);

    const msgs = [];
    if (data.greeting) msgs.push(data.greeting);
    (data.dialogue_lines || []).forEach((l) => msgs.push(l));
    const message = msgs.join('\n') || '…';

    if (p.tip) {
      const show = () => {
        p.tip.textContent = message;
        p.tip.style.display = 'block';
        const r = row.getBoundingClientRect();
        const tw = p.tip.offsetWidth;
        let left = r.right + 10;
        if (left + tw > window.innerWidth - 8) left = r.left - tw - 10;
        p.tip.style.left = Math.max(8, left) + 'px';
        p.tip.style.top = r.top + 'px';
      };
      row.addEventListener('mouseenter', show);
      row.addEventListener('mouseleave', () => { p.tip.style.display = 'none'; });
    }

    if (p.list) p.list.appendChild(row);
    this.updatePortraitProgress();
  }

  drawMinimap() {
    const g = this.minimap; g.clear();
    const cam = this.cameras.main;
    const size = 120, ox = cam.width - size - 12, oy = cam.height - size - 12;
    g.fillStyle(0x05070e, 0.75); g.fillRoundedRect(ox, oy, size, size, 8);
    g.lineStyle(2, 0xffffff, 0.2); g.strokeRoundedRect(ox, oy, size, size, 8);

    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    this.coordSet.forEach((k) => {
      const [x, y] = k.split(',').map(Number);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    const cols = maxX - minX + 1, rows = maxY - minY + 1, pad = 10;
    const cell = Math.max(8, Math.min(22, Math.floor((size - pad * 2) / Math.max(cols, rows))));
    const gw = cols * cell, gh = rows * cell;
    const sx = ox + (size - gw) / 2, sy = oy + (size - gh) / 2;
    const cellPx = (cx, cy) => ({ x: sx + (cx - minX) * cell, y: sy + (cy - minY) * cell });

    const themeByKey = new Map();
    this.chunks.forEach((c) => themeByKey.set(`${c.coord_x},${c.coord_y}`, c.theme));
    this.coordSet.forEach((k) => {
      const [cx, cy] = k.split(',').map(Number);
      const p = cellPx(cx, cy);
      // Whole map is revealed (no fog) — colour every chunk by its biome.
      const col = k === '0,0' ? THEME_COLORS.hub : (THEME_COLORS[themeByKey.get(k)] ?? 0x444444);
      g.fillStyle(col, 1); g.fillRect(p.x + 1, p.y + 1, cell - 2, cell - 2);
    });
    this.npcs.forEach((n) => {
      const p = cellPx(Math.floor(n.x / CHUNK_PX), Math.floor(n.y / CHUNK_PX));
      g.fillStyle(n.visited ? 0x888f9f : 0xffffff, 1);
      g.fillCircle(p.x + cell / 2, p.y + cell / 2, Math.max(1.5, cell * 0.12));
    });
    const px = sx + (this.player.x / CHUNK_PX - minX) * cell;
    const py = sy + (this.player.y / CHUNK_PX - minY) * cell;
    g.fillStyle(0xffd24d, 1); g.fillCircle(px, py, 3);
    g.lineStyle(1.5, 0x000000, 0.6); g.strokeCircle(px, py, 3);
  }

  // ---- overlays ------------------------------------------------------------
  buildOverlays(world) {
    const cam = this.cameras.main;
    this.nightOverlay = this.addHud(this.add.rectangle(0, 0, cam.width, cam.height, 0x0a1030, 0)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(90));
    this.scale.on('resize', (size) => this.nightOverlay.setSize(size.width, size.height));

    const title = (world && world.world_name) || 'BirthdayWorld';
    const welcome = this.addHud(this.add.text(cam.width / 2, cam.height / 2, `Welcome to\n${title}`, {
      fontFamily: FONT, fontSize: '22px', color: '#ffffff', align: 'center',
      backgroundColor: 'rgba(10,12,24,0.7)', padding: { x: 18, y: 14 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(120));
    this.time.delayedCall(2200, () => this.tweens.add({ targets: welcome, alpha: 0, duration: 600, onComplete: () => welcome.destroy() }));
  }

  // No fog of war — the whole world is visible from the start. markVisited is
  // kept only to track which chunks the player has actually stepped into (used
  // for the player dot trail / future stats); it no longer hides anything.
  markVisited(cx, cy) {
    this.visited.add(`${cx},${cy}`);
  }

  addAmbient(cx, cy, theme) {
    const { x, y } = this.chunkOrigin(cx, cy);
    const area = { x: { min: x, max: x + CHUNK_PX }, y: { min: y, max: y + CHUNK_PX } };
    let cfg = null;
    if (theme === 'forest') cfg = { ...area, tint: 0x88bb55, speedX: { min: -8, max: 8 }, speedY: { min: 6, max: 18 }, lifespan: 6000, scale: { start: 0.4, end: 0.25 }, alpha: { start: 0.7, end: 0 }, rotate: { start: 0, end: 180 }, frequency: 900, quantity: 1 };
    else if (theme === 'beach') cfg = { ...area, tint: 0xbfe8ff, speedY: { min: -22, max: -8 }, lifespan: 4500, scale: { start: 0.3, end: 0.5 }, alpha: { start: 0.6, end: 0 }, frequency: 1100, quantity: 1 };
    else if (theme === 'magical') cfg = { ...area, tint: 0xe6b3ff, speedX: { min: -6, max: 6 }, speedY: { min: -6, max: 6 }, lifespan: 3000, scale: { start: 0.4, end: 0 }, alpha: { start: 0.9, end: 0 }, frequency: 600, quantity: 1 };
    if (cfg) this.addWorld(this.add.particles(0, 0, 'spark', cfg).setDepth(12));
  }

  // ---- dialogue ------------------------------------------------------------
  setupDialogueUi() {
    const c = this.addHud(this.add.container(0, 0).setScrollFactor(0).setDepth(200).setVisible(false));
    const bg = this.add.graphics();
    const avBg = this.add.rectangle(0, 0, 60, 60, 0x161e28).setStrokeStyle(2, 0xffffff, 0.18);
    const av = this.add.image(0, 0, 'player_down_0').setOrigin(0.5).setScale(1.3);
    const name = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '16px', color: '#ffffff', fontStyle: 'bold' });
    const role = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#8fa0c8' });
    const body = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '15px', color: '#f0f2f8', lineSpacing: 5 });
    const cont = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#aab3cc' }).setOrigin(1, 1).setVisible(false);
    const pips = this.add.container(0, 0);
    c.add([bg, avBg, av, name, role, body, cont, pips]);
    this.dlg = { container: c, bg, avBg, av, name, role, body, cont, pips };
    this.repositionDialogue();
    this.dlg.bg.on('pointerdown', () => { if (this.dialogue) this.onInteract(); });
  }

  repositionDialogue() {
    if (!this.dlg) return;
    const cam = this.cameras.main;
    const W = cam.width, H = cam.height, boxH = 150, margin = 16, boxY = H - boxH - 16;
    const d = this.dlg;
    d.bg.clear();
    d.bg.fillStyle(0x0a0c14, 0.92); d.bg.fillRoundedRect(margin, boxY, W - margin * 2, boxH, 14);
    d.bg.lineStyle(2, 0x2a3550, 0.9); d.bg.strokeRoundedRect(margin, boxY, W - margin * 2, boxH, 14);
    d.bg.setInteractive(new Phaser.Geom.Rectangle(margin, boxY, W - margin * 2, boxH), Phaser.Geom.Rectangle.Contains);
    d.avBg.setPosition(margin + 50, boxY + 58); d.av.setPosition(margin + 50, boxY + 58);
    d.name.setPosition(margin + 100, boxY + 18);
    d.role.setPosition(margin + 100, boxY + 40);
    d.body.setPosition(margin + 100, boxY + 60); d.body.setWordWrapWidth(W - margin * 2 - 130);
    d.cont.setPosition(W - margin - 18, boxY + boxH - 14);
    d.pips.setPosition(margin + 100, boxY + boxH - 18);
  }

  onInteract() {
    if (this.dialogue) {
      const d = this.dialogue;
      if (d.typing) { d.body.setText(d.lines[d.index]); d.typing = false; if (d.typeEvent) d.typeEvent.remove(false); this.showContinue(true); }
      else this.advanceDialogue();
      return;
    }
    const npc = this.nearestNpcInRange();
    if (npc) this.popThenTalk(npc);
  }

  popThenTalk(npc) {
    const pop = this.addWorld(this.add.text(npc.x, npc.container.y - 52, '!', {
      fontFamily: FONT, fontSize: '22px', color: '#ffe27a', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(31));
    this.tweens.add({ targets: pop, y: pop.y - 14, alpha: 0, duration: 350, onComplete: () => pop.destroy() });
    this.time.delayedCall(220, () => this.startDialogue(npc));
  }

  nearestNpcInRange() {
    let best = null, bestD = TALK_RANGE;
    for (const n of this.npcs) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y);
      if (d <= bestD) { best = n; bestD = d; }
    }
    return best;
  }

  startDialogue(npc) {
    const data = npc.data;
    let lines = Array.isArray(data.dialogue_lines) ? data.dialogue_lines.slice() : [];
    if (lines.length === 0) lines = [data.greeting || '…'];
    npc.visited = true;
    this.discoverNpc(npc);
    this.dialogue = { npc, lines, index: 0, typing: false, body: this.dlg.body, typeEvent: null };
    this.dlg.name.setText(data.contributor_name || 'A friend');
    this.dlg.role.setText(BW.characters.get(data.sprite).name);
    if (npc.texKey && this.textures.exists(npc.texKey)) this.dlg.av.setTexture(npc.texKey);
    this.buildPips(lines.length);
    this.dlg.container.setVisible(true);
    this.talkHint.setVisible(false);
    if (npc.greetingText) npc.greetingText.setVisible(false);
    this.typeLine(0);
  }

  buildPips(n) {
    this.dlg.pips.removeAll(true);
    for (let i = 0; i < n; i++) this.dlg.pips.add(this.add.circle(i * 16, 0, 4, 0x4a5573));
  }
  updatePips(i) { this.dlg.pips.list.forEach((d, k) => d.setFillStyle(k <= i ? 0x9fb0ff : 0x4a5573)); }

  typeLine(index) {
    const d = this.dialogue; d.index = index;
    const full = d.lines[index] || '';
    d.body.setText(''); d.typing = true; this.showContinue(false); this.updatePips(index);
    if (d.typeEvent) d.typeEvent.remove(false);
    if (full.length === 0) { d.typing = false; this.showContinue(true); return; }
    let i = 0;
    d.typeEvent = this.time.addEvent({ delay: TYPE_SPEED, repeat: full.length - 1, callback: () => {
      i++; d.body.setText(full.slice(0, i));
      if (i >= full.length) { d.typing = false; this.showContinue(true); }
    } });
  }

  showContinue(show) {
    const d = this.dialogue;
    if (!d) { this.dlg.cont.setVisible(false); return; }
    const last = d.index >= d.lines.length - 1;
    const label = last ? 'close' : 'next ›';
    this.dlg.cont.setText(`${label}  (${d.index + 1}/${d.lines.length})`).setVisible(show);
  }
  advanceDialogue() { const d = this.dialogue; if (d.index >= d.lines.length - 1) this.closeDialogue(); else this.typeLine(d.index + 1); }
  closeDialogue() { if (this.dialogue && this.dialogue.typeEvent) this.dialogue.typeEvent.remove(false); this.dialogue = null; this.dlg.container.setVisible(false); }

  // ---- enemies (spawned once, roam the whole island, always visible) -------
  activeEnemies() { return this.enemies; }

  spawnAllEnemies() {
    this.chunkState.forEach((st, key) => {
      if (st.themed) this.spawnEnemies(key);
    });
  }

  spawnEnemies(key) {
    const [cx, cy] = key.split(',').map(Number);
    const cfg = this.enemyConfig;
    const add = (type) => {
      const c = cfg[type];
      if (!c || !c.on) return;
      this.terrain.randomLandTiles(cx, cy, c.count || 1, 3).forEach((t) =>
        this.enemies.push(this.makeEnemy(type, t.x, t.y)));
    };
    add('love_heart'); add('hugger'); add('confetti_bomber'); add('birthday_cake');
  }

  makeEnemy(type, x, y) {
    const container = this.add.container(x, y).setDepth(18);
    const sprite = this.add.sprite(0, 0, 'enemy_' + type).setOrigin(0.5, 0.5);
    container.add(sprite);
    this.addWorld(container);
    return {
      type, x, y, vx: 0, vy: 0, container, sprite,
      bounds: this.worldBounds,
      phase: Math.random() * Math.PI * 2, consumed: false, cooldownUntil: 0,
      fireAt: this.time.now + 1200 + Math.random() * 800, grabbing: false,
    };
  }

  updateEnemies(dt) {
    const enemies = this.enemies;
    if (!enemies.length) { this.updateProjectiles(dt); return; }
    const now = this.time.now;
    const px = this.player.x, py = this.player.y;
    for (const e of enemies) {
      if (e.consumed) continue;
      e.phase += dt * 4;
      const dx = px - e.x, dy = py - e.y, dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist, ny = dy / dist;
      if (e.type === 'love_heart') this.updateLoveHeart(e, dist, nx, ny);
      else if (e.type === 'hugger') this.updateHugger(e, dist, nx, ny, now);
      else if (e.type === 'confetti_bomber') this.updateBomber(e, dt, dist, nx, ny, now);
      else if (e.type === 'birthday_cake') this.updateCake(e, dist);

      if (e.type !== 'birthday_cake' && !e.grabbing) {
        let nxp = Phaser.Math.Clamp(e.x + e.vx * dt, e.bounds.minX, e.bounds.maxX);
        let nyp = Phaser.Math.Clamp(e.y + e.vy * dt, e.bounds.minY, e.bounds.maxY);
        if (this.terrain.isWalkable(nxp, e.y)) e.x = nxp;
        if (this.terrain.isWalkable(e.x, nyp)) e.y = nyp;
        e.container.setPosition(e.x, e.y);
      } else if (e.grabbing) {
        e.x = this.player.x; e.y = this.player.y; e.container.setPosition(e.x, e.y);
      }
    }
    this.updateProjectiles(dt);
  }

  contact(dist, r) { return dist < (r || 28); }

  updateLoveHeart(e, dist, nx, ny) {
    e.container.setScale(1 + Math.sin(e.phase) * 0.12);
    if (this.time.now < e.cooldownUntil) return;
    if (dist < 120) { e.vx = nx * 50; e.vy = ny * 50; }
    else { if (Math.random() < 0.02) e.wAng = Math.random() * Math.PI * 2; const a = e.wAng || 0; e.vx = Math.cos(a) * 22; e.vy = Math.sin(a) * 22; }
    if (this.contact(dist, 26)) {
      this.takeDamage(1);
      e.vx = -nx * 160; e.vy = -ny * 160; e.cooldownUntil = this.time.now + 600;
      this.burst(e.x, e.y, 0xff7fb0, 12);
    }
  }

  updateHugger(e, dist, nx, ny, now) {
    e.container.setScale(e.grabbing ? 1.15 : 1 + Math.sin(e.phase) * 0.05);
    if (e.grabbing) return;
    if (now < e.cooldownUntil) { e.vx = 0; e.vy = 0; return; }
    if (dist < 150) { e.vx = nx * 95; e.vy = ny * 95; }
    else { if (Math.random() < 0.02) e.pAng = Math.random() * Math.PI * 2; const a = e.pAng || 0; e.vx = Math.cos(a) * 35; e.vy = Math.sin(a) * 35; }
    if (this.contact(dist, 28) && now >= this.invincibleUntil) {
      e.grabbing = true; e.vx = 0; e.vy = 0;
      e.sprite.setTexture('enemy_hugger_grab');
      this.frozenUntil = now + 1500;
      this.time.delayedCall(1500, () => {
        e.grabbing = false; e.sprite.setTexture('enemy_hugger');
        e.cooldownUntil = this.time.now + 1500; this.frozenUntil = this.time.now + 300;
        this.takeDamage(2); this.burst(e.x, e.y, 0xffb066, 10);
      });
    }
  }

  updateBomber(e, dt, dist, nx, ny, now) {
    e.container.rotation += dt * 3;
    if (dist < 100) { e.vx = -nx * 80; e.vy = -ny * 80; }
    else if (dist > 200) { e.vx = nx * 70; e.vy = ny * 70; }
    else { e.vx = -ny * 40; e.vy = nx * 40; }
    if (now >= e.fireAt && dist < 260) { e.fireAt = now + 1600; this.fireConfetti(e.x, e.y, nx, ny); }
  }

  updateCake(e, dist) {
    e.container.setScale(1 + Math.sin(e.phase) * 0.08);
    if (!e.consumed && this.contact(dist, 26)) {
      e.consumed = true; this.heal(2); this.burst(e.x, e.y, 0xfff0a0, 16);
      this.tweens.add({ targets: e.container, scale: 0, alpha: 0, duration: 300, onComplete: () => e.container.setVisible(false) });
    }
  }

  fireConfetti(x, y, nx, ny) {
    const colors = [0xff5fa2, 0xffd24d, 0x6df0a0, 0x6db3ff, 0xc98aff];
    const gfx = this.add.rectangle(x, y, 8, 8, colors[Math.floor(Math.random() * colors.length)]).setDepth(18).setAngle(Math.random() * 360);
    this.addWorld(gfx);
    this.projectiles.push({ gfx, vx: nx * 220, vy: ny * 220, born: this.time.now });
  }

  updateProjectiles(dt) {
    const now = this.time.now, px = this.player.x, py = this.player.y;
    this.projectiles = this.projectiles.filter((p) => {
      p.gfx.x += p.vx * dt; p.gfx.y += p.vy * dt; p.gfx.angle += 6;
      if (Phaser.Math.Distance.Between(p.gfx.x, p.gfx.y, px, py) < 24 && now >= this.invincibleUntil) {
        this.takeDamage(1); this.burst(p.gfx.x, p.gfx.y, p.gfx.fillColor, 10); p.gfx.destroy(); return false;
      }
      if (now - p.born > 2500) { p.gfx.destroy(); return false; }
      return true;
    });
  }

  // ---- weapon (paper airplanes — playful defeat) ---------------------------
  setupWeapon() {
    this.weapon = BW.makeWeapon(this, {
      getPlayer: () => ({ x: this.player.x, y: this.player.y - 8 }),
      getFacing: () => this.facing,
      getEnemies: () => this.activeEnemies(),
      onHit: (e) => this.popEnemy(e),
      projKey: 'proj_airplane', depth: 22,
      onSpawn: (img) => this.addWorld(img),
    });
  }

  popEnemy(e) {
    if (e.consumed) return;
    e.consumed = true;
    this.burst(e.x, e.y, 0xffd24d, 14);
    this.burst(e.x, e.y, 0xff5fa2, 10);
    this.tweens.add({ targets: e.container, scale: 0, alpha: 0, duration: 220, onComplete: () => e.container.setVisible(false) });
  }

  // ---- damage / heal / game over ------------------------------------------
  takeDamage(amount) {
    if (this.time.now < this.invincibleUntil || this.gameOver) return;
    this.health = Math.max(0, this.health - amount);
    this.invincibleUntil = this.time.now + 1000;
    this.drawHearts(); this.flashPlayer();
    if (this.health <= 0) this.showGameOver();
  }

  heal(amount) {
    if (this.gameOver) return;
    this.health = Math.min(MAX_HEALTH, this.health + amount);
    this.drawHearts();
    this.tweens.add({ targets: this.playerSprite, alpha: 0.3, yoyo: true, duration: 120, repeat: 1 });
  }

  flashPlayer() {
    const tint = this.add.circle(0, -14, 16, 0xff0000, 0.5).setDepth(21);
    this.player.add(tint);
    this.tweens.add({ targets: tint, alpha: 0, duration: 1000, onComplete: () => tint.destroy() });
  }

  burst(x, y, color, count) {
    count = count || 10;
    const p = this.addWorld(this.add.particles(x, y, 'spark', {
      tint: color, speed: { min: 40, max: 140 }, lifespan: 500,
      scale: { start: 0.9, end: 0 }, quantity: count, emitting: false,
    }).setDepth(25));
    p.explode(count);
    this.time.delayedCall(700, () => p.destroy());
  }

  showGameOver() {
    this.gameOver = true;
    const cam = this.cameras.main;
    const c = this.addHud(this.add.container(0, 0).setScrollFactor(0).setDepth(300));
    const bg = this.add.rectangle(0, 0, cam.width, cam.height, 0x10131f, 0.85).setOrigin(0, 0);
    const t1 = this.add.text(cam.width / 2, cam.height / 2 - 50, 'You were loved too hard.', { fontFamily: FONT, fontSize: '24px', color: '#ff9ecb', fontStyle: 'bold' }).setOrigin(0.5);
    const t2 = this.add.text(cam.width / 2, cam.height / 2 - 12, 'Try again?', { fontFamily: FONT, fontSize: '16px', color: '#cdd6f0' }).setOrigin(0.5);
    const btn = this.add.rectangle(cam.width / 2, cam.height / 2 + 44, 180, 50, 0x6d8cff).setStrokeStyle(2, 0xffffff, 0.5).setInteractive({ useHandCursor: true });
    const btnT = this.add.text(cam.width / 2, cam.height / 2 + 44, 'Respawn', { fontFamily: FONT, fontSize: '17px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
    c.add([bg, t1, t2, btn, btnT]);
    btn.on('pointerdown', () => { c.destroy(); this.respawn(); });
  }

  respawn() {
    this.gameOver = false; this.health = MAX_HEALTH; this.drawHearts();
    const sp = this.terrain.spawnPoint();
    this.player.setPosition(sp.x, sp.y);
    this.invincibleUntil = this.time.now + 1500; this.frozenUntil = 0;
    this.weapon.clear();
    this.activeKey = null;
  }

  // ---- touch controls ------------------------------------------------------
  setupTouchControls() {
    const cam = this.cameras.main;
    this.joy = { active: false, dx: 0, dy: 0, baseX: 0, baseY: 0, pointerId: null, radius: 55 };
    const homeX = 90, homeY = cam.height - 90;
    const base = this.addHud(this.add.circle(homeX, homeY, 55, 0xffffff, 0.12).setScrollFactor(0).setDepth(150));
    const thumb = this.addHud(this.add.circle(homeX, homeY, 26, 0xffffff, 0.3).setScrollFactor(0).setDepth(151));
    this.joy.base = base; this.joy.thumb = thumb; this.joy.homeX = homeX; this.joy.homeY = homeY;

    const isTouch = this.sys.game.device.input.touch;
    base.setVisible(isTouch); thumb.setVisible(isTouch);

    // Throw + Talk buttons (touch only)
    this.throwBtn = this.addHud(this.add.circle(0, 0, 34, 0xffffff, 0.16).setScrollFactor(0).setDepth(150).setVisible(isTouch).setInteractive({ useHandCursor: true }));
    this.throwLabel = this.addHud(this.add.image(0, 0, 'proj_airplane').setScale(1.7).setOrigin(0.5).setScrollFactor(0).setDepth(151).setVisible(isTouch));
    this.throwBtn.on('pointerdown', (p) => { p.event && p.event.stopPropagation && p.event.stopPropagation(); if (!this.dialogue && !this.gameOver) this.weapon.throw(); });
    this.talkBtn = this.addHud(this.add.circle(0, 0, 30, 0xffe27a, 0.9).setScrollFactor(0).setDepth(150).setVisible(false).setInteractive({ useHandCursor: true }));
    this.talkLabel = this.addHud(this.add.text(0, 0, 'TALK', { fontFamily: FONT, fontSize: '11px', color: '#10131f', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0).setDepth(151).setVisible(false));
    this.talkBtn.on('pointerdown', () => this.onInteract());
    this.layoutHud();

    if (!isTouch) return;
    this.input.addPointer(2);
    this.input.on('pointerdown', (pointer) => {
      if (this.gameOver || this.dialogue) return;
      if (pointer.x < cam.width / 2) {
        this.joy.active = true; this.joy.pointerId = pointer.id;
        this.joy.baseX = pointer.x; this.joy.baseY = pointer.y;
        base.setPosition(pointer.x, pointer.y); thumb.setPosition(pointer.x, pointer.y);
      }
    });
    this.input.on('pointermove', (pointer) => {
      if (!this.joy.active || pointer.id !== this.joy.pointerId) return;
      const dx = pointer.x - this.joy.baseX, dy = pointer.y - this.joy.baseY;
      const len = Math.hypot(dx, dy) || 1, clamped = Math.min(len, this.joy.radius);
      const nx = dx / len, ny = dy / len;
      thumb.setPosition(this.joy.baseX + nx * clamped, this.joy.baseY + ny * clamped);
      this.joy.dx = nx * (clamped / this.joy.radius); this.joy.dy = ny * (clamped / this.joy.radius);
    });
    const end = (pointer) => {
      if (pointer.id !== this.joy.pointerId) return;
      this.joy.active = false; this.joy.dx = 0; this.joy.dy = 0; this.joy.pointerId = null;
      base.setPosition(homeX, homeY); thumb.setPosition(homeX, homeY);
    };
    this.input.on('pointerup', end);
    this.input.on('pointerupoutside', end);
  }

  // ---- main loop -----------------------------------------------------------
  update(time, delta) {
    if (!this.player || !this.terrain) return;
    const dt = delta / 1000, now = this.time.now;
    this.terrain.update(time, delta);

    let vx = 0, vy = 0, moving = false;
    const frozen = now < this.frozenUntil;
    if (!this.dialogue && !frozen && !this.gameOver) {
      const k = this.keys, cur = this.cursors;
      if (k.a.isDown || cur.left.isDown) vx -= 1;
      if (k.d.isDown || cur.right.isDown) vx += 1;
      if (k.w.isDown || cur.up.isDown) vy -= 1;
      if (k.s.isDown || cur.down.isDown) vy += 1;
      if (this.joy && this.joy.active) { vx += this.joy.dx; vy += this.joy.dy; }
      const len = Math.hypot(vx, vy);
      if (len > 0) {
        moving = true;
        if (Math.abs(vx) > Math.abs(vy)) this.facing = vx < 0 ? 'left' : 'right';
        else this.facing = vy < 0 ? 'up' : 'down';
        vx = (vx / len) * PLAYER_SPEED; vy = (vy / len) * PLAYER_SPEED;
      }
    }

    // manual per-axis tile collision (walk-slide along water/obstacles)
    if (moving) {
      const nx = this.player.x + vx * dt;
      if (this.terrain.isWalkable(nx, this.player.y)) this.player.x = nx;
      const ny = this.player.y + vy * dt;
      if (this.terrain.isWalkable(this.player.x, ny)) this.player.y = ny;
      this.walkPhase += dt * 10;
      this.stepAccum += Math.hypot(vx, vy) * dt;
      if (this.stepAccum > 26) { this.stepAccum = 0; this.footDust(); }
    }
    this.updatePlayerAnim(moving);

    // camera lead
    const cam = this.cameras.main;
    const leadX = moving ? (vx / PLAYER_SPEED) * 46 : 0;
    const leadY = moving ? (vy / PLAYER_SPEED) * 46 : 0;
    cam.followOffset.x += (-leadX - cam.followOffset.x) * 0.05;
    cam.followOffset.y += (-leadY - cam.followOffset.y) * 0.05;

    // chunk tracking + fog reveal + enemy spawn
    const cx = Math.floor(this.player.x / CHUNK_PX), cy = Math.floor(this.player.y / CHUNK_PX);
    const key = `${cx},${cy}`;
    if (key !== this.activeKey) {
      this.activeKey = key;
      if (this.coordSet.has(key)) this.markVisited(cx, cy);
    }

    // Action — enemies, their confetti, and thrown airplanes — freezes while a
    // dialogue is open or on game-over, so the world pauses when you're talking.
    if (!this.dialogue && !this.gameOver) {
      this.updateEnemies(dt);
      this.weapon.update(dt);
    }

    // NPC idle bob + occasional flip
    this.npcs.forEach((n) => {
      n.bob += dt * 2;
      n.container.y = n.baseY + Math.sin(n.bob) * 3;
      if (now > n.nextFace) { n.nextFace = now + 1800 + Math.random() * 2600; n.sprite.setFlipX(Math.random() < 0.5); }
    });

    // proximity hint + greeting + talk button
    const near = this.nearestNpcInRange();
    this.npcs.forEach((n) => { if (n.greetingText) n.greetingText.setVisible(n === near); });
    if (near && !this.dialogue) {
      this.talkHint.setPosition(near.x, near.container.y - (near.greetingText ? 66 : 48));
      this.talkHint.setVisible(true);
    } else this.talkHint.setVisible(false);
    if (this.talkBtn && this.sys.game.device.input.touch) {
      const show = !!near && !this.dialogue && !this.gameOver;
      this.talkBtn.setVisible(show); this.talkLabel.setVisible(show);
    }

    this.updateCompass();
    if (this.weaponInd) this.weaponInd.setAlpha(this.weapon.canThrow() ? 1 : 0.35);

    // day/night
    const phase = ((now - this.startTime) % DAY_LENGTH) / DAY_LENGTH;
    this.nightOverlay.setAlpha((1 - Math.cos(phase * Math.PI * 2)) / 2 * 0.55);

    this.drawMinimap();
  }

  footDust() {
    const st = this.activeKey && this.chunkState.get(this.activeKey);
    const tname = st && st.def ? st.def.theme : 'hub';
    const p = this.addWorld(this.add.particles(this.player.x, this.player.y, 'spark', {
      tint: DUST_COLORS[tname] || DUST_COLORS.hub, speed: { min: 5, max: 20 }, lifespan: 350,
      scale: { start: 0.35, end: 0 }, alpha: { start: 0.6, end: 0 }, quantity: 1, emitting: false,
    }).setDepth(19));
    p.explode(1);
    this.time.delayedCall(450, () => p.destroy());
  }

  updateCompass() {
    let target = null, bestD = Infinity;
    for (const n of this.npcs) {
      if (n.visited) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y);
      if (d < bestD) { bestD = d; target = n; }
    }
    if (!target) { this.compassArrow.setVisible(false); this.compassLabel.setText('all found'); return; }
    this.compassArrow.setVisible(true);
    this.compassArrow.setRotation(Math.atan2(target.y - this.player.y, target.x - this.player.x) + Math.PI / 2);
    this.compassLabel.setText('friend');
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0c1018',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [WorldScene],
};

new Phaser.Game(config);
