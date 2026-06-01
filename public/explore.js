/* BirthdayWorld — Phaser explorer scene */

const TILE = 32;
const CHUNK_TILES = 16;
const CHUNK_PX = TILE * CHUNK_TILES; // 512
const PLAYER_SPEED = 160;
const TALK_RANGE = 60;
const TYPE_SPEED = 30; // ms per character

const THEME_COLORS = {
  forest: 0x2d4a1e,
  beach: 0x1a6b8a,
  cave: 0x3a2820,
  snow: 0xb0ccd8,
  desert: 0x8a7040,
  magical: 0x3a2060,
};
const HUB_COLOR = 0x3a5a3a;
const PATH_COLOR = 0x8a8266;

const worldId = location.pathname.split('/').pop();

class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
    this.chunks = [];
    this.npcs = [];
    this.dialogue = null; // active dialogue state
  }

  async create() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      w: 'W', a: 'A', s: 'S', d: 'D',
      e: 'E', space: 'SPACE',
    });

    // Fetch world data
    let chunks = [];
    let world = null;
    try {
      [world, chunks] = await Promise.all([
        fetch(`/worlds/${worldId}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/worlds/${worldId}/chunks`).then((r) => (r.ok ? r.json() : [])),
      ]);
    } catch (e) {
      chunks = [];
    }
    this.chunks = chunks;
    document.getElementById('loading').style.display = 'none';

    // Build coordinate set (always include hub at 0,0)
    const coordSet = new Set(['0,0']);
    chunks.forEach((c) => coordSet.add(`${c.coord_x},${c.coord_y}`));

    // --- Render world ground & paths (static graphics) ---
    const g = this.add.graphics();
    g.setDepth(0);

    // Hub
    this.drawChunk(g, 0, 0, HUB_COLOR);
    // Themed chunks
    chunks.forEach((c) => {
      const color = THEME_COLORS[c.theme] ?? 0x333333;
      this.drawChunk(g, c.coord_x, c.coord_y, color);
    });

    // Paths between adjacent occupied chunks
    const pathG = this.add.graphics();
    pathG.setDepth(1);
    pathG.fillStyle(PATH_COLOR, 1);
    const drawn = new Set();
    const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    coordSet.forEach((key) => {
      const [cx, cy] = key.split(',').map(Number);
      adj.forEach(([dx, dy]) => {
        const nKey = `${cx + dx},${cy + dy}`;
        if (!coordSet.has(nKey)) return;
        const edgeKey = [key, nKey].sort().join('|');
        if (drawn.has(edgeKey)) return;
        drawn.add(edgeKey);
        this.drawPath(pathG, cx, cy, dx, dy);
      });
    });

    // --- NPCs ---
    chunks.forEach((c) => this.spawnNpc(c));

    // --- Empty world hint ---
    if (chunks.length === 0) {
      const cx = CHUNK_PX / 2;
      const cy = CHUNK_PX / 2;
      this.add
        .text(cx, cy, 'waiting for contributors…', {
          fontFamily: 'sans-serif', fontSize: '20px', color: '#dfe6f5',
        })
        .setOrigin(0.5)
        .setDepth(5);
    }

    // --- Title banner ---
    if (world) {
      this.add
        .text(12, 10, `${world.birthday_person}'s world`, {
          fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff',
          backgroundColor: 'rgba(0,0,0,0.4)', padding: { x: 8, y: 4 },
        })
        .setScrollFactor(0)
        .setDepth(100);
    }

    // --- Player ---
    const spawnX = CHUNK_PX / 2;
    const spawnY = CHUNK_PX / 2;
    this.player = this.add.circle(spawnX, spawnY, 12, 0xffd24d);
    this.player.setStrokeStyle(3, 0xffffff);
    this.player.setDepth(20);
    this.physics.add.existing(this.player);
    this.player.body.setCircle(12);
    this.player.body.setCollideWorldBounds(false);

    // Camera follow with lerp
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setBackgroundColor('#0c0f18');

    // Talk hint (single reusable text floating above nearest NPC)
    this.talkHint = this.add
      .text(0, 0, 'E to talk', {
        fontFamily: 'sans-serif', fontSize: '13px', color: '#10131f',
        backgroundColor: '#ffe27a', padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setDepth(30)
      .setVisible(false);

    this.setupDialogueUi();
    this.setupTouchControls();

    // Interaction key handling
    this.input.keyboard.on('keydown-E', () => this.onInteract());
    this.input.keyboard.on('keydown-SPACE', () => {
      if (this.dialogue) this.onInteract();
    });
  }

  // pixel origin of a chunk's top-left
  chunkOrigin(cx, cy) {
    return { x: cx * CHUNK_PX, y: cy * CHUNK_PX };
  }

  drawChunk(g, cx, cy, color) {
    const { x, y } = this.chunkOrigin(cx, cy);
    g.fillStyle(color, 1);
    g.fillRect(x, y, CHUNK_PX, CHUNK_PX);
    // subtle border so chunks read as distinct tiles
    g.lineStyle(2, 0x000000, 0.18);
    g.strokeRect(x + 1, y + 1, CHUNK_PX - 2, CHUNK_PX - 2);
  }

  // Draw a 2-tile-wide path from the centre of chunk (cx,cy) toward neighbour (dx,dy)
  drawPath(g, cx, cy, dx, dy) {
    const { x, y } = this.chunkOrigin(cx, cy);
    const centerX = x + CHUNK_PX / 2;
    const centerY = y + CHUNK_PX / 2;
    const w = TILE * 2; // 2 tiles wide
    if (dx !== 0) {
      // horizontal path spanning to neighbour centre
      const start = dx > 0 ? centerX : centerX - CHUNK_PX;
      g.fillRect(start, centerY - w / 2, CHUNK_PX, w);
    } else {
      const start = dy > 0 ? centerY : centerY - CHUNK_PX;
      g.fillRect(centerX - w / 2, start, w, CHUNK_PX);
    }
  }

  spawnNpc(c) {
    const { x, y } = this.chunkOrigin(c.coord_x, c.coord_y);
    const px = x + CHUNK_PX / 2;
    const py = y + CHUNK_PX / 2;

    const ring = this.add.circle(px, py, 20, 0x000000, 0.35).setDepth(14);
    ring.setStrokeStyle(3, 0xffffff, 0.9);
    const avatar = this.add
      .text(px, py, c.sprite || '🙂', { fontSize: '26px' })
      .setOrigin(0.5)
      .setDepth(15);

    const nameplate = this.add
      .text(px, py - 34, c.contributor_name || 'A friend', {
        fontFamily: 'sans-serif', fontSize: '13px', color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.45)', padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(16);

    // Greeting bubble (shown when near, hidden during dialogue)
    let greetingText = null;
    if (c.greeting) {
      greetingText = this.add
        .text(px, py - 52, c.greeting, {
          fontFamily: 'sans-serif', fontSize: '12px', color: '#fff8d0',
          backgroundColor: 'rgba(40,30,10,0.7)', padding: { x: 6, y: 3 },
          wordWrap: { width: 180 }, align: 'center',
        })
        .setOrigin(0.5, 1)
        .setDepth(16)
        .setVisible(false);
    }

    this.npcs.push({ data: c, x: px, y: py, avatar, nameplate, greetingText });
  }

  setupDialogueUi() {
    const cam = this.cameras.main;
    const W = cam.width;
    const H = cam.height;
    const boxH = 150;
    const boxY = H - boxH - 16;
    const margin = 16;

    this.dlg = {};
    const c = this.add.container(0, 0).setScrollFactor(0).setDepth(200).setVisible(false);

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0c14, 0.88);
    bg.fillRoundedRect(margin, boxY, W - margin * 2, boxH, 12);
    bg.lineStyle(2, 0x6d8cff, 0.6);
    bg.strokeRoundedRect(margin, boxY, W - margin * 2, boxH, 12);
    c.add(bg);

    const avBg = this.add.circle(margin + 50, boxY + 55, 32, 0x1a2030).setStrokeStyle(2, 0xffffff, 0.7);
    const av = this.add.text(margin + 50, boxY + 55, '🙂', { fontSize: '36px' }).setOrigin(0.5);
    const name = this.add.text(margin + 100, boxY + 18, '', {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#9fb0ff', fontStyle: 'bold',
    });
    const body = this.add.text(margin + 100, boxY + 46, '', {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#f0f2f8',
      wordWrap: { width: W - margin * 2 - 130 }, lineSpacing: 4,
    });
    const cont = this.add.text(W - margin - 20, boxY + boxH - 16, '▼ continue', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#aab3cc',
    }).setOrigin(1, 1).setVisible(false);

    // progress pips container (rebuilt per dialogue)
    const pips = this.add.container(margin + 100, boxY + boxH - 22);

    c.add([avBg, av, name, body, cont, pips]);
    this.dlg = { container: c, bg, avBg, av, name, body, cont, pips, boxY, boxH, W, margin };

    // Tap on dialogue box advances/skips
    bg.setInteractive(new Phaser.Geom.Rectangle(margin, boxY, W - margin * 2, boxH), Phaser.Geom.Rectangle.Contains);
    bg.on('pointerdown', () => { if (this.dialogue) this.onInteract(); });

    // Resize handling keeps the box anchored
    this.scale.on('resize', () => this.repositionDialogue());
  }

  repositionDialogue() {
    // Simple approach: rebuild geometry positions on resize.
    const cam = this.cameras.main;
    const W = cam.width;
    const H = cam.height;
    const boxH = 150;
    const boxY = H - boxH - 16;
    const margin = 16;
    const d = this.dlg;
    d.W = W; d.boxY = boxY; d.margin = margin;
    d.bg.clear();
    d.bg.fillStyle(0x0a0c14, 0.88);
    d.bg.fillRoundedRect(margin, boxY, W - margin * 2, boxH, 12);
    d.bg.lineStyle(2, 0x6d8cff, 0.6);
    d.bg.strokeRoundedRect(margin, boxY, W - margin * 2, boxH, 12);
    d.bg.setInteractive(new Phaser.Geom.Rectangle(margin, boxY, W - margin * 2, boxH), Phaser.Geom.Rectangle.Contains);
    d.avBg.setPosition(margin + 50, boxY + 55);
    d.av.setPosition(margin + 50, boxY + 55);
    d.name.setPosition(margin + 100, boxY + 18);
    d.body.setPosition(margin + 100, boxY + 46);
    d.body.setWordWrapWidth(W - margin * 2 - 130);
    d.cont.setPosition(W - margin - 20, boxY + boxH - 16);
    d.pips.setPosition(margin + 100, boxY + boxH - 22);
  }

  onInteract() {
    if (this.dialogue) {
      // In dialogue: skip typing or advance
      const d = this.dialogue;
      if (d.typing) {
        // skip to full line
        d.body.setText(d.lines[d.index]);
        d.typing = false;
        if (d.typeEvent) d.typeEvent.remove(false);
        this.showContinue(true);
      } else {
        this.advanceDialogue();
      }
      return;
    }
    // Not in dialogue: try to start one with nearest NPC in range
    const npc = this.nearestNpcInRange();
    if (npc) this.startDialogue(npc);
  }

  nearestNpcInRange() {
    let best = null;
    let bestD = TALK_RANGE;
    for (const n of this.npcs) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y);
      if (dist <= bestD) { best = n; bestD = dist; }
    }
    return best;
  }

  startDialogue(npc) {
    const data = npc.data;
    let lines = Array.isArray(data.dialogue_lines) ? data.dialogue_lines.slice() : [];
    if (lines.length === 0) lines = [data.greeting || '…'];

    this.dialogue = {
      npc, lines, index: 0, typing: false, body: this.dlg.body, typeEvent: null,
    };

    this.dlg.name.setText(data.contributor_name || 'A friend');
    this.dlg.av.setText(data.sprite || '🙂');
    this.buildPips(lines.length);
    this.dlg.container.setVisible(true);
    this.talkHint.setVisible(false);
    if (npc.greetingText) npc.greetingText.setVisible(false);

    this.typeLine(0);
  }

  buildPips(n) {
    this.dlg.pips.removeAll(true);
    for (let i = 0; i < n; i++) {
      const dot = this.add.circle(i * 16, 0, 4, 0x4a5573);
      this.dlg.pips.add(dot);
    }
  }

  updatePips(index) {
    this.dlg.pips.list.forEach((dot, i) => {
      dot.setFillStyle(i <= index ? 0x9fb0ff : 0x4a5573);
    });
  }

  typeLine(index) {
    const d = this.dialogue;
    d.index = index;
    const full = d.lines[index] || '';
    d.body.setText('');
    d.typing = true;
    this.showContinue(false);
    this.updatePips(index);

    let i = 0;
    if (d.typeEvent) d.typeEvent.remove(false);
    d.typeEvent = this.time.addEvent({
      delay: TYPE_SPEED,
      repeat: full.length - 1,
      callback: () => {
        i++;
        d.body.setText(full.slice(0, i));
        if (i >= full.length) {
          d.typing = false;
          this.showContinue(true);
        }
      },
    });
    if (full.length === 0) {
      d.typing = false;
      this.showContinue(true);
    }
  }

  showContinue(show) {
    const last = this.dialogue && this.dialogue.index >= this.dialogue.lines.length - 1;
    this.dlg.cont.setText(last ? '▼ close' : '▼ continue').setVisible(show);
  }

  advanceDialogue() {
    const d = this.dialogue;
    if (d.index >= d.lines.length - 1) {
      this.closeDialogue();
    } else {
      this.typeLine(d.index + 1);
    }
  }

  closeDialogue() {
    if (this.dialogue && this.dialogue.typeEvent) this.dialogue.typeEvent.remove(false);
    this.dialogue = null;
    this.dlg.container.setVisible(false);
  }

  setupTouchControls() {
    // Virtual joystick: fixed base bottom-left, drag thumb to steer.
    this.joy = { active: false, dx: 0, dy: 0, baseX: 0, baseY: 0, pointerId: null };
    const cam = this.cameras.main;
    const baseX = 90;
    const baseY = cam.height - 90;
    const radius = 55;

    const base = this.add.circle(baseX, baseY, radius, 0xffffff, 0.12)
      .setScrollFactor(0).setDepth(150);
    const thumb = this.add.circle(baseX, baseY, 26, 0xffffff, 0.3)
      .setScrollFactor(0).setDepth(151);
    this.joy.base = base; this.joy.thumb = thumb;
    this.joy.baseX = baseX; this.joy.baseY = baseY; this.joy.radius = radius;

    // Only show joystick on touch devices
    const isTouch = this.sys.game.device.input.touch;
    base.setVisible(isTouch);
    thumb.setVisible(isTouch);
    if (!isTouch) return;

    this.input.addPointer(2);

    this.input.on('pointerdown', (pointer) => {
      // ignore touches on the dialogue box (handled separately) when dialogue open
      if (this.dialogue) return;
      // start joystick if touch is on left half
      if (pointer.x < cam.width / 2) {
        this.joy.active = true;
        this.joy.pointerId = pointer.id;
        this.joy.baseX = pointer.x;
        this.joy.baseY = pointer.y;
        base.setPosition(pointer.x, pointer.y);
        thumb.setPosition(pointer.x, pointer.y);
      } else {
        // right-half tap = interact/talk
        this.onInteract();
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (!this.joy.active || pointer.id !== this.joy.pointerId) return;
      let dx = pointer.x - this.joy.baseX;
      let dy = pointer.y - this.joy.baseY;
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(len, this.joy.radius);
      const nx = (dx / len);
      const ny = (dy / len);
      thumb.setPosition(this.joy.baseX + nx * clamped, this.joy.baseY + ny * clamped);
      this.joy.dx = nx * (clamped / this.joy.radius);
      this.joy.dy = ny * (clamped / this.joy.radius);
    });

    const endJoy = (pointer) => {
      if (pointer.id !== this.joy.pointerId) return;
      this.joy.active = false;
      this.joy.dx = 0; this.joy.dy = 0;
      this.joy.pointerId = null;
      base.setPosition(baseX, baseY);
      thumb.setPosition(baseX, baseY);
    };
    this.input.on('pointerup', endJoy);
    this.input.on('pointerupoutside', endJoy);
  }

  update() {
    if (!this.player) return;
    const body = this.player.body;

    // Freeze movement during dialogue
    if (this.dialogue) {
      body.setVelocity(0, 0);
      return;
    }

    let vx = 0;
    let vy = 0;
    const k = this.keys;
    const cur = this.cursors;
    if (k.a.isDown || cur.left.isDown) vx -= 1;
    if (k.d.isDown || cur.right.isDown) vx += 1;
    if (k.w.isDown || cur.up.isDown) vy -= 1;
    if (k.s.isDown || cur.down.isDown) vy += 1;

    // joystick
    if (this.joy && this.joy.active) {
      vx += this.joy.dx;
      vy += this.joy.dy;
    }

    const len = Math.hypot(vx, vy);
    if (len > 0) {
      vx = (vx / len) * PLAYER_SPEED;
      vy = (vy / len) * PLAYER_SPEED;
    }
    body.setVelocity(vx, vy);

    // Proximity: show talk hint + greeting on nearest NPC in range
    const near = this.nearestNpcInRange();
    this.npcs.forEach((n) => {
      if (n.greetingText) n.greetingText.setVisible(n === near);
    });
    if (near) {
      this.talkHint.setPosition(near.x, near.y - (near.greetingText ? 70 : 52));
      this.talkHint.setVisible(true);
    } else {
      this.talkHint.setVisible(false);
    }
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0c0f18',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [WorldScene],
};

new Phaser.Game(config);
