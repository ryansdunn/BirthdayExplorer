/* BirthdayWorld — procedural pixel-art sprite generator (sprites.js)
 *
 * ART SWAP PATH: to replace any sprite with a real image asset, load your
 * image in your Phaser preload() and call scene.textures.addImage(key, ...)
 * (or use scene.load.image(key, url) in preload) with the SAME key listed
 * below.  Because generate() guards every key with scene.textures.exists(),
 * pre-registered keys will be skipped automatically — engine code unchanged.
 *
 * TEXTURE KEYS registered by generate(scene, { playerDesign }):
 *  Player (24×36 each, 16 keys) — painted from BW.characters.get(playerDesign):
 *    player_down_0..3, player_up_0..3, player_left_0..3, player_right_0..3
 *  Enemies:
 *    enemy_love_heart      28×28
 *    enemy_hugger          30×30
 *    enemy_hugger_grab     30×30
 *    enemy_confetti_bomber 30×30
 *    enemy_birthday_cake   30×36
 *  Props (bottom-anchored, origin 0.5, 0.85):
 *    prop_tree_a           28×48
 *    prop_tree_b           24×44
 *    prop_rock_a           28×20
 *    prop_rock_b           20×14
 *    prop_bush_a           24×16
 *    prop_flower_a         20×14
 *  Bridges (32×32, origin 0,0):
 *    prop_bridge_h
 *    prop_bridge_v
 *  Projectile (origin centred, 0.5, 0.5):
 *    proj_airplane         16×16  — points RIGHT/east; engine rotates for travel direction
 *
 * ANIMATION KEYS registered by generate(scene):
 *  player_walk_down, player_walk_up, player_walk_left, player_walk_right  (8 fps, repeat −1)
 *  player_idle_down, player_idle_up, player_idle_left, player_idle_right  (1 fps, single frame)
 *
 * NPC textures are generated on demand via npcTextureFor(scene, designId) → key.
 * Key format: 'npc_' + designId.  Size: 24×36 (front idle, shared per design).
 */

window.BW = window.BW || {};
(function () {
  'use strict';

  // ─── tiny drawing helpers ────────────────────────────────────────────────
  /** Make a temporary Graphics object (not added to scene display list). */
  function mkG(scene) {
    return scene.make.graphics({ x: 0, y: 0, add: false });
  }

  /** Bake graphics → texture then destroy the graphics. */
  function bake(g, key, w, h) {
    g.generateTexture(key, w, h);
    g.destroy();
  }

  /** Adapt a Phaser Graphics object to the characters.js put(color,x,y,w,h) sink. */
  function mkPut(g) {
    return function (color, x, y, w, h) {
      g.fillStyle(color, 1);
      g.fillRect(x, y, w, h);
    };
  }

  /** Fill a rectangle with a solid colour (alpha 1). */
  function rect(g, color, x, y, w, h) {
    g.fillStyle(color, 1);
    g.fillRect(x, y, w, h);
  }

  /** Draw a 1-px dark outline rectangle (no fill). */
  function outline(g, color, x, y, w, h) {
    g.fillStyle(color, 1);
    // top
    g.fillRect(x, y, w, 1);
    // bottom
    g.fillRect(x, y + h - 1, w, 1);
    // left
    g.fillRect(x, y, 1, h);
    // right
    g.fillRect(x + w - 1, y, 1, h);
  }

  // ─── PLAYER ─────────────────────────────────────────────────────────────
  /*
   * The chunky humanoid body (24 wide × 36 tall) is painted by the shared
   * BW.characters.paintFrame() so the in-game sprite matches the canvas
   * preview the organiser picked. Frame 0 idle · 1/3 footsteps · 2 passing.
   */

  const OUTLINE_DARK = 0x111111;

  function drawCharacterFrame(scene, key, spec, dir, frame) {
    if (scene.textures.exists(key)) return;
    const C = BW.characters;
    const g = mkG(scene);
    C.paintFrame(mkPut(g), spec, dir, frame);
    bake(g, key, C.W, C.H);
  }

  function generatePlayer(scene, designId) {
    const spec = BW.characters.get(designId);
    const dirs = ['down', 'up', 'left', 'right'];
    for (const dir of dirs) {
      for (let f = 0; f < 4; f++) {
        drawCharacterFrame(scene, `player_${dir}_${f}`, spec, dir, f);
      }
    }
  }

  // ─── PLAYER ANIMS ───────────────────────────────────────────────────────
  function generatePlayerAnims(scene) {
    const dirs = ['down', 'up', 'left', 'right'];
    for (const dir of dirs) {
      const walkKey = `player_walk_${dir}`;
      if (!scene.anims.exists(walkKey)) {
        scene.anims.create({
          key: walkKey,
          frames: [
            { key: `player_${dir}_0` },
            { key: `player_${dir}_1` },
            { key: `player_${dir}_2` },
            { key: `player_${dir}_3` },
          ],
          frameRate: 8,
          repeat: -1,
        });
      }
      const idleKey = `player_idle_${dir}`;
      if (!scene.anims.exists(idleKey)) {
        scene.anims.create({
          key: idleKey,
          frames: [{ key: `player_${dir}_0` }],
          frameRate: 1,
          repeat: -1,
        });
      }
    }
  }

  // ─── ENEMY: love_heart ──────────────────────────────────────────────────
  function generateEnemyLoveHeart(scene) {
    const key = 'enemy_love_heart';
    if (scene.textures.exists(key)) return;
    const W = 28, H = 28;
    const g = mkG(scene);
    const pal = BW.palettes.enemy.love_heart;

    // Symmetric chunky heart, built row-by-row so the silhouette reads clearly:
    // two rounded top lobes with a dip between them, tapering to a point.
    // [xStart, width] spans of the heart body per 2px-tall row band.
    const rows = [
      [4, 2],            // y4-6  : lobe tops (left)  + (right) handled by mirror
      [2, 7],            // y6-8
      [2, 24],           // y8-10 : lobes merge into full width
      [2, 24],           // y10-12
      [3, 22],           // y12-14
      [4, 20],           // y14-16
      [6, 16],           // y16-18
      [8, 12],           // y18-20
      [10, 8],           // y20-22
      [12, 4],           // y22-24 : point
    ];
    // Top band needs two separate lobes (left + mirrored right) with a centre dip.
    rect(g, pal.body, 4, 4, 7, 2); rect(g, pal.body, 17, 4, 7, 2);   // y4-6 lobes
    rect(g, pal.body, 3, 6, 9, 2); rect(g, pal.body, 16, 6, 9, 2);   // y6-8 lobes
    for (let i = 2; i < rows.length; i++) {
      const y = 4 + i * 2;
      rect(g, pal.body, rows[i][0], y, rows[i][1], 2);
    }
    // Lower-right shading for volume.
    rect(g, pal.dark, 14, 8, 11, 12);
    rect(g, pal.dark, 12, 18, 8, 4);
    // Top-left highlights on each lobe.
    rect(g, pal.light, 5, 6, 4, 3);
    rect(g, pal.light, 18, 6, 4, 3);
    // Cute eyes.
    rect(g, pal.eye, 9, 10, 3, 3);
    rect(g, pal.eye, 16, 10, 3, 3);
    rect(g, pal.light, 10, 10, 1, 1);
    rect(g, pal.light, 17, 10, 1, 1);

    bake(g, key, W, H);
  }

  // ─── ENEMY: hugger ──────────────────────────────────────────────────────
  function generateEnemyHugger(scene) {
    const key = 'enemy_hugger';
    if (scene.textures.exists(key)) return;
    const W = 30, H = 30;
    const g = mkG(scene);
    const pal = BW.palettes.enemy.hugger;

    // Round friendly body — circular silhouette via stacked rects
    rect(g, pal.body, 8, 2, 14, 4);
    rect(g, pal.body, 4, 4, 22, 18);
    rect(g, pal.body, 6, 22, 18, 4);
    rect(g, pal.body, 8, 26, 14, 2);
    // Shading bottom
    rect(g, pal.dark, 4, 20, 22, 4);
    // Shading sides
    rect(g, pal.dark, 4, 4, 3, 18);
    rect(g, pal.dark, 23, 4, 3, 18);
    // Highlight top-left
    rect(g, pal.light, 8, 3, 6, 4);
    // Arms out to sides (open/grabbing-air)
    rect(g, pal.body, 0, 8, 4, 5);
    rect(g, pal.dark, 0, 12, 4, 2);
    rect(g, pal.body, 26, 8, 4, 5);
    rect(g, pal.dark, 26, 12, 4, 2);
    // Eyes
    rect(g, pal.eye, 9, 9, 3, 3);
    rect(g, pal.eye, 18, 9, 3, 3);
    // Highlights on eyes
    rect(g, pal.light, 10, 9, 1, 1);
    rect(g, pal.light, 19, 9, 1, 1);
    // Smile
    rect(g, pal.eye, 10, 16, 2, 1);
    rect(g, pal.eye, 12, 17, 6, 1);
    rect(g, pal.eye, 18, 16, 2, 1);
    // Outline
    outline(g, OUTLINE_DARK, 4, 2, 22, 26);

    bake(g, key, W, H);
  }

  // ─── ENEMY: hugger_grab ─────────────────────────────────────────────────
  function generateEnemyHuggerGrab(scene) {
    const key = 'enemy_hugger_grab';
    if (scene.textures.exists(key)) return;
    const W = 30, H = 30;
    const g = mkG(scene);
    const pal = BW.palettes.enemy.hugger;

    // Same round body
    rect(g, pal.body, 8, 2, 14, 4);
    rect(g, pal.body, 4, 4, 22, 18);
    rect(g, pal.body, 6, 22, 18, 4);
    rect(g, pal.body, 8, 26, 14, 2);
    rect(g, pal.dark, 4, 20, 22, 4);
    rect(g, pal.dark, 4, 4, 3, 18);
    rect(g, pal.dark, 23, 4, 3, 18);
    rect(g, pal.light, 8, 3, 6, 4);
    // Arms wrapped INWARD (closed/grabbing)
    rect(g, pal.body, 0, 6, 5, 4);  // left arm coming across
    rect(g, pal.body, 1, 10, 6, 3);
    rect(g, pal.dark, 1, 12, 6, 2);
    rect(g, pal.body, 25, 6, 5, 4); // right arm coming across
    rect(g, pal.body, 23, 10, 6, 3);
    rect(g, pal.dark, 23, 12, 6, 2);
    // Eyes (squinting / determined)
    rect(g, pal.eye, 9, 9, 3, 2);
    rect(g, pal.eye, 18, 9, 3, 2);
    rect(g, pal.light, 10, 9, 1, 1);
    rect(g, pal.light, 19, 9, 1, 1);
    // Determined expression (straight line mouth)
    rect(g, pal.eye, 10, 16, 10, 1);
    outline(g, OUTLINE_DARK, 4, 2, 22, 26);

    bake(g, key, W, H);
  }

  // ─── ENEMY: confetti_bomber ─────────────────────────────────────────────
  function generateEnemyConfettiBomber(scene) {
    const key = 'enemy_confetti_bomber';
    if (scene.textures.exists(key)) return;
    const W = 30, H = 30;
    const g = mkG(scene);
    const pal = BW.palettes.enemy.confetti_bomber;

    // 5-point star — engine spins this via .rotation
    // Centre disc
    rect(g, pal.body, 9, 9, 12, 12);
    // 5 points (approximated with pixel rects radiating out)
    // Top point
    rect(g, pal.body, 12, 1, 6, 9);
    rect(g, pal.light, 13, 2, 4, 5);
    // Bottom-left point
    rect(g, pal.body, 1, 17, 9, 6);
    rect(g, pal.body, 3, 23, 6, 5);
    rect(g, pal.dark, 2, 18, 4, 4);
    // Bottom-right point
    rect(g, pal.body, 20, 17, 9, 6);
    rect(g, pal.body, 21, 23, 6, 5);
    rect(g, pal.dark, 24, 18, 4, 4);
    // Upper-left point
    rect(g, pal.body, 1, 7, 9, 6);
    rect(g, pal.body, 1, 9, 7, 4);
    rect(g, pal.dark, 2, 8, 4, 4);
    // Upper-right point
    rect(g, pal.body, 20, 7, 9, 6);
    rect(g, pal.body, 22, 9, 7, 4);
    rect(g, pal.dark, 24, 8, 4, 4);
    // Highlight
    rect(g, pal.light, 11, 10, 6, 5);
    // Eye dots
    rect(g, pal.eye, 10, 12, 3, 3);
    rect(g, pal.eye, 17, 12, 3, 3);

    bake(g, key, W, H);
  }

  // ─── ENEMY: birthday_cake ───────────────────────────────────────────────
  function generateEnemyBirthdayCake(scene) {
    const key = 'enemy_birthday_cake';
    if (scene.textures.exists(key)) return;
    const W = 30, H = 36;
    const g = mkG(scene);
    const pal = BW.palettes.enemy.birthday_cake;

    // Plate (bottom)
    rect(g, pal.plate, 2, 30, 26, 4);
    rect(g, BW.palettes.shade(pal.plate, -0.2), 2, 32, 26, 2);
    outline(g, OUTLINE_DARK, 2, 30, 26, 4);

    // Cake base (two layers)
    // Bottom layer
    rect(g, pal.base, 3, 20, 24, 10);
    rect(g, BW.palettes.shade(pal.base, -0.15), 3, 27, 24, 3);
    rect(g, BW.palettes.shade(pal.base, 0.1), 3, 20, 24, 3);
    // Icing band on bottom layer
    rect(g, pal.icing, 3, 20, 24, 3);
    rect(g, BW.palettes.shade(pal.icing, 0.2), 3, 20, 24, 1);
    // Icing drips
    rect(g, pal.icing, 5, 23, 3, 2);
    rect(g, pal.icing, 13, 23, 4, 3);
    rect(g, pal.icing, 21, 23, 3, 2);
    outline(g, OUTLINE_DARK, 3, 20, 24, 10);

    // Top layer
    rect(g, pal.base, 6, 11, 18, 9);
    rect(g, BW.palettes.shade(pal.base, -0.15), 6, 17, 18, 3);
    rect(g, BW.palettes.shade(pal.base, 0.1), 6, 11, 18, 3);
    // Icing on top layer
    rect(g, pal.icing, 6, 11, 18, 3);
    rect(g, BW.palettes.shade(pal.icing, 0.2), 6, 11, 18, 1);
    rect(g, pal.icing, 8, 14, 3, 2);
    rect(g, pal.icing, 19, 14, 3, 2);
    outline(g, OUTLINE_DARK, 6, 11, 18, 9);

    // Candle (centred on top)
    rect(g, pal.candle, 13, 4, 4, 7);
    rect(g, BW.palettes.shade(pal.candle, -0.15), 15, 4, 2, 7);
    outline(g, OUTLINE_DARK, 13, 4, 4, 7);

    // Flame
    rect(g, pal.flame, 13, 1, 4, 4);
    rect(g, 0xffffff, 14, 2, 2, 2);
    rect(g, BW.palettes.shade(pal.flame, -0.2), 13, 3, 4, 2);

    bake(g, key, W, H);
  }

  // ─── PROPS ──────────────────────────────────────────────────────────────

  function generatePropTreeA(scene) {
    const key = 'prop_tree_a';
    if (scene.textures.exists(key)) return;
    const W = 28, H = 48;
    const g = mkG(scene);
    const GREEN_MID = 0x3a7a2a;
    const GREEN_DARK = 0x2a5a1d;
    const GREEN_LIGHT = 0x5ea84a;
    const TRUNK = 0x7a5a3a;
    const TRUNK_D = 0x5a3a1d;

    // Trunk
    rect(g, TRUNK, 11, 34, 6, 14);
    rect(g, TRUNK_D, 14, 34, 3, 14);
    outline(g, OUTLINE_DARK, 11, 34, 6, 14);

    // Canopy — layered (3 tiers, getting smaller toward top)
    // Bottom tier (widest)
    rect(g, GREEN_MID, 2, 26, 24, 10);
    rect(g, GREEN_DARK, 2, 33, 24, 3);
    rect(g, GREEN_LIGHT, 4, 26, 10, 4);
    outline(g, OUTLINE_DARK, 2, 26, 24, 10);

    // Mid tier
    rect(g, GREEN_MID, 4, 16, 20, 12);
    rect(g, GREEN_DARK, 4, 24, 20, 4);
    rect(g, GREEN_LIGHT, 6, 16, 8, 5);
    outline(g, OUTLINE_DARK, 4, 16, 20, 12);

    // Top tier (narrowest)
    rect(g, GREEN_MID, 7, 6, 14, 12);
    rect(g, GREEN_DARK, 7, 14, 14, 4);
    rect(g, GREEN_LIGHT, 9, 6, 6, 5);
    outline(g, OUTLINE_DARK, 7, 6, 14, 12);

    // Top cap
    rect(g, GREEN_MID, 10, 2, 8, 6);
    rect(g, GREEN_LIGHT, 11, 2, 4, 3);
    outline(g, OUTLINE_DARK, 10, 2, 8, 6);

    bake(g, key, W, H);
  }

  function generatePropTreeB(scene) {
    const key = 'prop_tree_b';
    if (scene.textures.exists(key)) return;
    const W = 24, H = 44;
    const g = mkG(scene);
    // Slightly different greens — more blue-green, rounder shape
    const GREEN_MID = 0x2a7a5a;
    const GREEN_DARK = 0x1d5a3f;
    const GREEN_LIGHT = 0x4aac7f;
    const TRUNK = 0x8a6a4a;
    const TRUNK_D = 0x6a4a2a;

    // Trunk
    rect(g, TRUNK, 9, 32, 6, 12);
    rect(g, TRUNK_D, 12, 32, 3, 12);
    outline(g, OUTLINE_DARK, 9, 32, 6, 12);

    // Round canopy — two tiers
    // Bottom tier
    rect(g, GREEN_MID, 2, 22, 20, 12);
    rect(g, GREEN_DARK, 2, 30, 20, 4);
    rect(g, GREEN_LIGHT, 4, 22, 8, 5);
    // Round corners
    rect(g, GREEN_MID, 0, 24, 2, 8);
    rect(g, GREEN_MID, 22, 24, 2, 8);
    outline(g, OUTLINE_DARK, 2, 22, 20, 12);

    // Top tier
    rect(g, GREEN_MID, 4, 10, 16, 14);
    rect(g, GREEN_DARK, 4, 20, 16, 4);
    rect(g, GREEN_LIGHT, 6, 10, 6, 6);
    rect(g, GREEN_MID, 2, 13, 2, 8);
    rect(g, GREEN_MID, 20, 13, 2, 8);
    outline(g, OUTLINE_DARK, 4, 10, 16, 14);

    // Round top
    rect(g, GREEN_MID, 7, 4, 10, 8);
    rect(g, GREEN_LIGHT, 8, 4, 5, 4);
    outline(g, OUTLINE_DARK, 7, 4, 10, 8);

    bake(g, key, W, H);
  }

  function generatePropRockA(scene) {
    const key = 'prop_rock_a';
    if (scene.textures.exists(key)) return;
    const W = 28, H = 20;
    const g = mkG(scene);
    const ROCK = 0x8a8a96;
    const ROCK_D = 0x6a6a78;
    const ROCK_L = 0xb0b0bc;

    rect(g, ROCK, 2, 6, 24, 12);
    rect(g, ROCK_D, 2, 14, 24, 4);
    rect(g, ROCK_L, 4, 6, 10, 5);
    rect(g, ROCK, 0, 10, 2, 6);
    rect(g, ROCK, 26, 10, 2, 6);
    rect(g, ROCK, 4, 3, 20, 4);
    rect(g, ROCK_L, 6, 3, 8, 3);
    outline(g, OUTLINE_DARK, 2, 3, 24, 15);

    bake(g, key, W, H);
  }

  function generatePropRockB(scene) {
    const key = 'prop_rock_b';
    if (scene.textures.exists(key)) return;
    const W = 20, H = 14;
    const g = mkG(scene);
    const ROCK = 0x909098;
    const ROCK_D = 0x70707a;
    const ROCK_L = 0xb8b8c2;

    rect(g, ROCK, 2, 4, 16, 8);
    rect(g, ROCK_D, 2, 9, 16, 3);
    rect(g, ROCK_L, 3, 4, 7, 4);
    rect(g, ROCK, 4, 2, 12, 4);
    rect(g, ROCK_L, 5, 2, 5, 2);
    outline(g, OUTLINE_DARK, 2, 2, 16, 10);

    bake(g, key, W, H);
  }

  function generatePropBushA(scene) {
    const key = 'prop_bush_a';
    if (scene.textures.exists(key)) return;
    const W = 24, H = 16;
    const g = mkG(scene);
    const BUSH = 0x4a8a36;
    const BUSH_D = 0x2f6022;
    const BUSH_L = 0x72b258;

    rect(g, BUSH, 2, 6, 20, 8);
    rect(g, BUSH_D, 2, 11, 20, 3);
    rect(g, BUSH_L, 3, 6, 7, 4);
    // Rounded bumps on top
    rect(g, BUSH, 4, 2, 6, 6);
    rect(g, BUSH, 14, 2, 6, 6);
    rect(g, BUSH_L, 5, 2, 3, 3);
    rect(g, BUSH_L, 15, 2, 3, 3);
    rect(g, BUSH, 9, 4, 6, 4);
    rect(g, BUSH_L, 10, 4, 3, 2);
    outline(g, OUTLINE_DARK, 2, 2, 20, 12);

    bake(g, key, W, H);
  }

  function generatePropFlowerA(scene) {
    const key = 'prop_flower_a';
    if (scene.textures.exists(key)) return;
    const W = 20, H = 14;
    const g = mkG(scene);
    const GRASS = 0x4a8a36;
    const STEM = 0x3a6a28;
    const PETAL_A = 0xff6fa8;
    const PETAL_B = 0xffe066;
    const CENTRE = 0xffcc22;

    // Grass base
    rect(g, GRASS, 0, 8, 20, 6);
    rect(g, STEM, 2, 8, 1, 4);
    rect(g, STEM, 11, 6, 1, 6);
    // Flower 1 (left, pink)
    rect(g, PETAL_A, 0, 4, 3, 3);
    rect(g, PETAL_A, 3, 2, 3, 3);
    rect(g, PETAL_A, 3, 5, 3, 3);
    rect(g, PETAL_A, 6, 4, 3, 3);
    rect(g, CENTRE, 3, 4, 3, 3);
    // Flower 2 (right, yellow)
    rect(g, PETAL_B, 10, 2, 3, 3);
    rect(g, PETAL_B, 13, 4, 3, 3);
    rect(g, PETAL_B, 10, 5, 3, 3);
    rect(g, PETAL_B, 7, 4, 3, 3);
    rect(g, CENTRE, 10, 4, 3, 3);

    bake(g, key, W, H);
  }

  // ─── BRIDGES ────────────────────────────────────────────────────────────

  function generateBridgeH(scene) {
    const key = 'prop_bridge_h';
    if (scene.textures.exists(key)) return;
    const W = 32, H = 32;
    const g = mkG(scene);
    const PLANK = 0xc8a066;
    const PLANK_D = 0xa07a44;
    const PLANK_L = 0xe0bc88;
    const RAIL = 0x8a6a3a;

    // Planks running left-right (horizontal direction crossing)
    for (let row = 0; row < 4; row++) {
      const y = 4 + row * 6;
      rect(g, PLANK, 0, y, 32, 5);
      rect(g, PLANK_D, 0, y + 4, 32, 1);
      rect(g, PLANK_L, 0, y, 32, 1);
      // Plank seams (vertical lines)
      for (let s = 0; s < 4; s++) {
        rect(g, PLANK_D, 7 + s * 8, y, 1, 5);
      }
    }
    // Side railings (top and bottom edges)
    rect(g, RAIL, 0, 1, 32, 3);
    rect(g, PLANK_L, 0, 1, 32, 1);
    rect(g, RAIL, 0, 28, 32, 3);
    rect(g, PLANK_D, 0, 30, 32, 1);
    // Rail posts
    for (let p = 0; p <= 3; p++) {
      rect(g, RAIL, p * 10, 0, 3, 32);
    }
    outline(g, OUTLINE_DARK, 0, 0, 32, 32);

    bake(g, key, W, H);
  }

  function generateBridgeV(scene) {
    const key = 'prop_bridge_v';
    if (scene.textures.exists(key)) return;
    const W = 32, H = 32;
    const g = mkG(scene);
    const PLANK = 0xc8a066;
    const PLANK_D = 0xa07a44;
    const PLANK_L = 0xe0bc88;
    const RAIL = 0x8a6a3a;

    // Planks running top-bottom (vertical direction crossing)
    for (let col = 0; col < 4; col++) {
      const x = 4 + col * 6;
      rect(g, PLANK, x, 0, 5, 32);
      rect(g, PLANK_D, x + 4, 0, 1, 32);
      rect(g, PLANK_L, x, 0, 1, 32);
      // Plank seams (horizontal lines)
      for (let s = 0; s < 4; s++) {
        rect(g, PLANK_D, x, 7 + s * 8, 5, 1);
      }
    }
    // Side railings (left and right edges)
    rect(g, RAIL, 1, 0, 3, 32);
    rect(g, PLANK_L, 1, 0, 1, 32);
    rect(g, RAIL, 28, 0, 3, 32);
    rect(g, PLANK_D, 30, 0, 1, 32);
    // Rail posts
    for (let p = 0; p <= 3; p++) {
      rect(g, RAIL, 0, p * 10, 32, 3);
    }
    outline(g, OUTLINE_DARK, 0, 0, 32, 32);

    bake(g, key, W, H);
  }

  // ─── PROJECTILE: paper airplane ─────────────────────────────────────────
  function generateProjAirplane(scene) {
    const key = 'proj_airplane';
    if (scene.textures.exists(key)) return;
    const W = 16, H = 16;
    const g = mkG(scene);
    const WHITE = 0xf4f4f4;
    const GREY = 0xc8c8d0;
    const FOLD = 0xa0a0ac;

    // Paper airplane pointing RIGHT (east)
    // Main body — triangle pointing right
    rect(g, WHITE, 0, 7, 14, 2);    // horizontal spine
    rect(g, WHITE, 2, 5, 12, 6);    // body width
    rect(g, WHITE, 8, 4, 6, 8);     // wider rear
    // Nose tip
    rect(g, WHITE, 13, 7, 3, 2);
    rect(g, WHITE, 14, 6, 2, 4);
    rect(g, WHITE, 15, 7, 1, 2);
    // Top wing
    rect(g, GREY, 2, 3, 10, 4);
    rect(g, WHITE, 3, 4, 8, 2);
    // Bottom wing
    rect(g, GREY, 2, 9, 10, 4);
    rect(g, WHITE, 3, 10, 8, 2);
    // Fold crease (centre line)
    rect(g, FOLD, 1, 7, 13, 2);
    rect(g, WHITE, 1, 8, 13, 1);
    // Tail fin
    rect(g, GREY, 0, 5, 3, 6);
    rect(g, FOLD, 0, 7, 3, 2);
    // Dark outline
    outline(g, OUTLINE_DARK, 0, 4, 16, 8);

    bake(g, key, W, H);
  }

  // ─── NPC BODY ───────────────────────────────────────────────────────────
  /*
   * Front-facing idle NPC body, painted from the contributor's chosen
   * character design (BW.characters). Cached per design id so many NPCs
   * sharing a design reuse one texture.  Key: 'npc_' + designId.
   */
  const _npcCache = {};

  function npcTextureFor(scene, designId) {
    const spec = BW.characters.get(designId);
    const key = 'npc_' + spec.id;
    if (!_npcCache[key]) {
      drawCharacterFrame(scene, key, spec, 'down', 0);
      _npcCache[key] = true;
    }
    return key;
  }

  // ─── MAIN ENTRY ─────────────────────────────────────────────────────────
  function generate(scene, opts) {
    opts = opts || {};
    // Player frames (all 4 dirs × 4 frames = 16 textures) for the chosen design
    generatePlayer(scene, opts.playerDesign);
    // Player animations
    generatePlayerAnims(scene);
    // Enemies
    generateEnemyLoveHeart(scene);
    generateEnemyHugger(scene);
    generateEnemyHuggerGrab(scene);
    generateEnemyConfettiBomber(scene);
    generateEnemyBirthdayCake(scene);
    // Props
    generatePropTreeA(scene);
    generatePropTreeB(scene);
    generatePropRockA(scene);
    generatePropRockB(scene);
    generatePropBushA(scene);
    generatePropFlowerA(scene);
    // Bridges
    generateBridgeH(scene);
    generateBridgeV(scene);
    // Projectile
    generateProjAirplane(scene);
  }

  // ─── EXPORT ─────────────────────────────────────────────────────────────
  BW.sprites = { generate, npcTextureFor };
})();
