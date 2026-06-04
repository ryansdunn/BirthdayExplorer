/* BirthdayWorld — terrain generation pipeline (terrain.js).
 *
 * Plain <script> tag, attaches to window.BW. Depends on (load order):
 *   noise.js     → BW.makeNoise, BW.hashStringToSeed
 *   palettes.js  → BW.palettes
 *   textures.js  → BW.textures (terrain tile texture keys + generate)
 * Optionally CONSUMES sprite prop textures from sprites.js
 *   (prop_tree_a/b, prop_rock_a/b, prop_bush_a, prop_flower_a,
 *    prop_bridge_h, prop_bridge_v) — falls back to drawn shapes if missing.
 *
 * ── SWAP PATH ─────────────────────────────────────────────────────────────
 * This module references all art only by texture key. Provide real art by
 * loading images under the keys documented in textures.js / the prop_* keys,
 * and no code here changes.
 *
 * EXTERNAL CONTRACT (the engine calls EXACTLY this):
 *   BW.terrain.build(scene, { chunks, coordKeys, style, seed }) → WorldTerrain
 * WorldTerrain: isWalkable, surfaceAt, biomeAt, chunkCenterLand,
 *               randomLandTiles, spawnPoint, update(time, delta).
 * See bottom of file for full signatures.
 */
window.BW = window.BW || {};
(function () {
  const TILE = 32;
  const CHUNK_TILES = 16;
  const CHUNK_PX = 512;
  const HALF = CHUNK_TILES / 2; // 8

  // Surface codes (small ints for compact grid + O(1) checks).
  const S_WATER = 0, S_BEACH = 1, S_LAND = 2, S_CLIFF = 3, S_BRIDGE = 4;
  const SURF_NAME = { 0: 'water', 1: 'beach', 2: 'land', 3: 'cliff', 4: 'bridge' };

  function key(gx, gy) { return gx + ',' + gy; }

  // ── Deterministic per-call PRNG seeded from world seed + salts. ──
  function mulberry(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build(scene, opts) {
    opts = opts || {};
    const chunks = opts.chunks || [];
    const coordKeys = opts.coordKeys || new Set();
    const style = opts.style === 'archipelago' ? 'archipelago' : 'island';
    const seed = (opts.seed >>> 0) || 1;

    // Ensure tile textures exist (idempotent).
    if (BW.textures && BW.textures.generate) BW.textures.generate(scene);
    const TK = (BW.textures && BW.textures.keys) || null;
    const WATER_FRAMES = (BW.textures && BW.textures.WATER_FRAMES) || 3;

    const noise = BW.makeNoise(seed);
    const shade = (BW.palettes && BW.palettes.shade) || ((c) => c);
    const BIOMES = (BW.palettes && BW.palettes.biome) || {};

    // Build the set of occupied chunk grid coords from coordKeys (includes hub).
    const occupied = []; // {cx,cy}
    coordKeys.forEach((k) => {
      const p = k.split(',');
      occupied.push({ cx: parseInt(p[0], 10), cy: parseInt(p[1], 10) });
    });
    const occSet = coordKeys; // alias for membership tests

    // Map of chunk coord -> theme. Hub (and any coord not in `chunks`) => 'hub'.
    const themeOf = {};
    chunks.forEach((c) => { themeOf[key(c.coord_x, c.coord_y)] = c.theme; });
    function chunkTheme(cx, cy) { return themeOf[key(cx, cy)] || 'hub'; }

    // Themed-chunk centres (in tile-space) for the island biome assignment.
    // Includes hub centre mapped to 'hub'.
    const centres = occupied.map((o) => ({
      tx: o.cx * CHUNK_TILES + HALF,
      ty: o.cy * CHUNK_TILES + HALF,
      theme: chunkTheme(o.cx, o.cy),
    }));

    // Centroid of occupied chunk centres (for island radial falloff).
    let cenX = 0, cenY = 0;
    centres.forEach((c) => { cenX += c.tx; cenY += c.ty; });
    if (centres.length) { cenX /= centres.length; cenY /= centres.length; }
    // Falloff radius scales with the spread of chunks.
    let maxR = CHUNK_TILES;
    centres.forEach((c) => {
      const d = Math.hypot(c.tx - cenX, c.ty - cenY);
      if (d > maxR) maxR = d;
    });
    const islandRadius = maxR + CHUNK_TILES * 0.9; // land extends ~a chunk past furthest centre

    // ── Grid storage: Map "gx,gy" -> { s, b } surface + biome theme. ──
    const grid = new Map();
    // Decoration-blocked tiles (subset of land that became non-walkable).
    const blocked = new Set();

    function setTile(gx, gy, s, theme) {
      grid.set(key(gx, gy), { s: s, b: theme });
    }
    function getTile(gx, gy) { return grid.get(key(gx, gy)); }

    const SEA = 0.42;        // sea level on the (low-biased) fbm distribution
    const BEACH_BAND = 0.04; // band above sea level that renders as beach
    const ELEV_FREQ = 0.045; // global elevation noise frequency (no seams)

    // Nearest themed centre (domain-warped) → biome theme, for island mode.
    function biomeForTile(gx, gy) {
      if (centres.length === 1) return centres[0].theme;
      const w = noise.warp(gx, gy, 6, 0.05);
      let best = centres[0], bd = Infinity;
      for (let i = 0; i < centres.length; i++) {
        const c = centres[i];
        const d = (c.tx - w.x) * (c.tx - w.x) + (c.ty - w.y) * (c.ty - w.y);
        if (d < bd) { bd = d; best = c; }
      }
      return best.theme;
    }

    // ── GENERATE TILES per occupied chunk. ──
    occupied.forEach((o) => {
      const baseTheme = chunkTheme(o.cx, o.cy);
      // per-chunk PRNG/seed for archipelago blobs
      const cseed = (seed ^ Math.imul(o.cx + 1013, 0x9e3779b1) ^ Math.imul(o.cy + 2027, 0x85ebca77)) >>> 0;

      for (let j = 0; j < CHUNK_TILES; j++) {
        for (let i = 0; i < CHUNK_TILES; i++) {
          const gx = o.cx * CHUNK_TILES + i;
          const gy = o.cy * CHUNK_TILES + j;

          let elev, theme;
          if (style === 'island') {
            // Continuous GLOBAL-space fbm (no seams) minus soft radial falloff.
            const f = noise.fbm(gx, gy, { octaves: 5, persistence: 0.5, lacunarity: 2, frequency: ELEV_FREQ });
            const dist = Math.hypot(gx - cenX, gy - cenY);
            const fall = Math.max(0, dist / islandRadius); // 0 centre → ~1 edge
            // Gentle quadratic falloff: centre stays high, gradient near the
            // coast is shallow so a beach ring forms between land and water.
            const fallSoft = fall * fall * 0.45;
            elev = f - fallSoft + 0.10;
            theme = biomeForTile(gx, gy);
          } else {
            // ARCHIPELAGO: one blob per chunk inside its own footprint.
            const lx = i - HALF + 0.5; // tile offset from chunk centre
            const ly = j - HALF + 0.5;
            const r = Math.hypot(lx, ly) / HALF; // 0 centre → ~1 footprint edge
            const cn = BW.makeNoise(cseed);
            const f = cn.fbm(i, j, { octaves: 4, persistence: 0.5, lacunarity: 2, frequency: 0.12 });
            // radial falloff stronger near edge so water rings the island
            elev = f - r * r * 0.95 + 0.18;
            theme = baseTheme;
          }

          let s;
          if (elev > SEA + BEACH_BAND) s = S_LAND;
          else if (elev > SEA) s = S_BEACH;
          else s = S_WATER;

          setTile(gx, gy, s, theme);
        }
      }
    });

    // ── Cliffs: mark steep land near water on high ground as cliff (readability
    //    + non-walkable barriers). A land tile bordering water with high elev
    //    in island mode; in archipelago keep it land/beach for simplicity. ──
    if (style === 'island') {
      grid.forEach((cell, k) => {
        if (cell.s !== S_LAND) return;
        const p = k.split(','); const gx = +p[0], gy = +p[1];
        const f = noise.fbm(gx, gy, { octaves: 5, persistence: 0.5, lacunarity: 2, frequency: ELEV_FREQ });
        // interior high points become cliffs occasionally (impassable peaks)
        if (f > 0.72) {
          const n = [getTile(gx + 1, gy), getTile(gx - 1, gy), getTile(gx, gy + 1), getTile(gx, gy - 1)];
          const allLandish = n.every((t) => t && t.s !== S_WATER);
          if (allLandish) cell.s = S_CLIFF;
        }
      });
    }

    // ── Force a guaranteed-land disc (radius ~2 tiles) at EVERY chunk centre. ──
    const DISC_R = 2;
    occupied.forEach((o) => {
      const theme = chunkTheme(o.cx, o.cy);
      for (let dj = -DISC_R; dj <= DISC_R; dj++) {
        for (let di = -DISC_R; di <= DISC_R; di++) {
          if (di * di + dj * dj > DISC_R * DISC_R + 1) continue;
          const gx = o.cx * CHUNK_TILES + HALF + di;
          const gy = o.cy * CHUNK_TILES + HALF + dj;
          const t = getTile(gx, gy);
          if (t) { t.s = S_LAND; t.b = theme; }
        }
      }
    });

    // ── CONNECTIVITY between adjacent occupied chunks via path corridor. ──
    // Corridor = the two centre tiles (indices 7,8) on the shared edge.
    // Helper: carve a land strip / bridge between chunk a and neighbour dir.
    // dir: 'R' (b is to the right), 'D' (b below).
    function connect(a, dirRight) {
      const bcx = a.cx + (dirRight ? 1 : 0);
      const bcy = a.cy + (dirRight ? 0 : 1);
      if (!occSet.has(key(bcx, bcy))) return;
      const themeA = chunkTheme(a.cx, a.cy);
      const themeB = chunkTheme(bcx, bcy);

      // The two corridor lanes (indices 7 and 8 along the perpendicular axis).
      const lanes = [HALF - 1, HALF]; // 7, 8

      if (dirRight) {
        // horizontal connection: walk gx from a-centre to b-centre along lanes.
        const gxStart = a.cx * CHUNK_TILES + HALF;
        const gxEnd = bcx * CHUNK_TILES + HALF;
        lanes.forEach((lane) => {
          const gy = a.cy * CHUNK_TILES + lane;
          carveCorridor(gxStart, gy, gxEnd, gy, true, themeA, themeB);
        });
      } else {
        const gyStart = a.cy * CHUNK_TILES + HALF;
        const gyEnd = bcy * CHUNK_TILES + HALF;
        lanes.forEach((lane) => {
          const gx = a.cx * CHUNK_TILES + lane;
          carveCorridor(gx, gyStart, gx, gyEnd, false, themeA, themeB);
        });
      }
    }

    function carveCorridor(g0x, g0y, g1x, g1y, horizontal, themeA, themeB) {
      const steps = horizontal ? (g1x - g0x) : (g1y - g0y);
      for (let s = 0; s <= steps; s++) {
        const gx = horizontal ? g0x + s : g0x;
        const gy = horizontal ? g0y : g0y + s;
        const t = getTile(gx, gy);
        const theme = s < steps / 2 ? themeA : themeB;
        if (!t) { setTile(gx, gy, style === 'archipelago' ? S_WATER : S_LAND, theme); }
        const cell = getTile(gx, gy);
        if (style === 'island') {
          // carve a solid land isthmus
          cell.s = S_LAND;
          cell.b = theme;
        } else {
          // archipelago: land spit on island side, bridge across the water gap.
          if (cell.s !== S_WATER) {
            cell.s = S_LAND; cell.b = theme; // spit extending from island
          } else {
            cell.s = S_BRIDGE; cell.b = theme;
          }
        }
      }
    }

    occupied.forEach((o) => { connect(o, true); connect(o, false); });

    // ── RENDER: bake each chunk's tiles into a per-chunk RenderTexture. ──
    function variant(gx, gy, n) {
      // stable per-tile variant from coords + seed
      let h = (Math.imul(gx + 7919, 0x9e3779b1) ^ Math.imul(gy + 104729, 0x85ebca77) ^ seed) >>> 0;
      return h % n;
    }

    // ── OCEAN APRON: a big tiled-water backdrop ringing the whole island so
    //    the rectangular map edge is never visible — open water in every
    //    direction. Sits behind every chunk (depth -2). ──
    if (occupied.length) {
      let minCx = Infinity, minCy = Infinity, maxCx = -Infinity, maxCy = -Infinity;
      occupied.forEach((o) => {
        minCx = Math.min(minCx, o.cx); minCy = Math.min(minCy, o.cy);
        maxCx = Math.max(maxCx, o.cx); maxCy = Math.max(maxCy, o.cy);
      });
      const MARGIN = 8; // chunks of ocean padding on every side
      const ax = (minCx - MARGIN) * CHUNK_PX, ay = (minCy - MARGIN) * CHUNK_PX;
      const aw = (maxCx - minCx + 1 + MARGIN * 2) * CHUNK_PX;
      const ah = (maxCy - minCy + 1 + MARGIN * 2) * CHUNK_PX;
      const wkey = TK ? TK.water('hub', 0) : null;
      if (wkey && scene.textures.exists(wkey)) {
        scene.add.tileSprite(ax, ay, aw, ah, wkey).setOrigin(0, 0).setDepth(-2);
      } else {
        scene.add.rectangle(ax, ay, aw, ah, 0x1b4a63).setOrigin(0, 0).setDepth(-2);
      }
    }

    // Animated water overlays: only coast-adjacent water tiles.
    const waterImages = []; // {img, theme}

    // ── COASTAL FRINGE: 1-tile beach strip + animated tide foam just outside
    //    the island's outer perimeter, sitting on top of the open-ocean apron
    //    (depth -2). Beach tiles at depth -1; foam overlay at depth -0.5. ──
    const coastalFringeImages = []; // {img, phase}
    if (occupied.length && style === 'island') {
      const BIOMES_PAL = (BW.palettes && BW.palettes.biome) || {};

      occupied.forEach((o) => {
        const cx = o.cx, cy = o.cy;
        const theme = chunkTheme(cx, cy);
        const pal = BIOMES_PAL[theme] || BIOMES_PAL.hub;

        const dirs = [
          { nx: cx - 1, ny: cy, faceI: 0,               faceJ: null,            outDx: -1, outDy:  0 },
          { nx: cx + 1, ny: cy, faceI: CHUNK_TILES - 1,  faceJ: null,            outDx:  1, outDy:  0 },
          { nx: cx, ny: cy - 1, faceI: null,             faceJ: 0,               outDx:  0, outDy: -1 },
          { nx: cx, ny: cy + 1, faceI: null,             faceJ: CHUNK_TILES - 1, outDx:  0, outDy:  1 },
        ];

        dirs.forEach(({ nx, ny, faceI, faceJ, outDx, outDy }) => {
          if (occSet.has(key(nx, ny))) return; // neighbor chunk occupied — no fringe
          for (let k = 0; k < CHUNK_TILES; k++) {
            const gx = cx * CHUNK_TILES + (faceI !== null ? faceI : k);
            const gy = cy * CHUNK_TILES + (faceJ !== null ? faceJ : k);

            // Only fringe where the edge tile is water or beach — skip land/cliff
            // edges (e.g. corridors exiting the chunk) so fringe doesn't appear
            // around paths or bridges.
            const edgeCell = getTile(gx, gy);
            if (!edgeCell || (edgeCell.s !== S_WATER && edgeCell.s !== S_BEACH)) continue;

            // Smooth noise drives beach width (0–3 tiles) so the shoreline
            // undulates naturally instead of forming a uniform rectangular strip.
            const n = noise.fbm(gx, gy, { octaves: 3, persistence: 0.5, lacunarity: 2, frequency: 0.18 });
            let beachWidth;
            if (n < 0.12)      beachWidth = 0; // bare water edge — no fringe
            else if (n < 0.55) beachWidth = 1;
            else if (n < 0.82) beachWidth = 2;
            else               beachWidth = 3;

            for (let d = 1; d <= beachWidth; d++) {
              const extGx = gx + outDx * d;
              const extGy = gy + outDy * d;
              // Register in grid so isWalkable() finds these tiles at runtime.
              if (!getTile(extGx, extGy)) setTile(extGx, extGy, S_BEACH, theme);
              const v = variant(extGx, extGy, 2);
              const bkey = tk('beach', theme, v);
              if (bkey && scene.textures.exists(bkey)) {
                scene.add.image(extGx * TILE, extGy * TILE, bkey).setOrigin(0, 0).setDepth(-1);
              } else if (pal) {
                const gb = scene.add.graphics().setDepth(-1);
                gb.fillStyle(pal.beach[v % pal.beach.length], 1).fillRect(extGx * TILE, extGy * TILE, TILE, TILE);
              }
            }

            // Tide wash on the outermost beach tile: a solid pale-blue Rectangle
            // animated via setAlpha() — avoids texture-transparency issues.
            if (beachWidth > 0) {
              const extGx = gx + outDx * beachWidth;
              const extGy = gy + outDy * beachWidth;
              const rect = scene.add.rectangle(
                extGx * TILE + TILE / 2, extGy * TILE + TILE / 2, TILE, TILE
              ).setFillStyle(0xcce8ff, 1).setDepth(-0.5).setAlpha(0);
              const phase = ((extGx * 3 + extGy * 7) % 16) / 16;
              coastalFringeImages.push({ img: rect, phase });
            }
          }
        });
      });
    }

    occupied.forEach((o) => {
      const rt = scene.add.renderTexture(o.cx * CHUNK_PX, o.cy * CHUNK_PX, CHUNK_PX, CHUNK_PX).setDepth(0);
      rt.setOrigin(0, 0);

      for (let j = 0; j < CHUNK_TILES; j++) {
        for (let i = 0; i < CHUNK_TILES; i++) {
          const gx = o.cx * CHUNK_TILES + i;
          const gy = o.cy * CHUNK_TILES + j;
          const cell = getTile(gx, gy);
          if (!cell) continue;
          const px = i * TILE, py = j * TILE;
          const theme = BIOMES[cell.b] ? cell.b : 'hub';

          let texKey;
          if (cell.s === S_LAND) texKey = tk('land', theme, variant(gx, gy, 3));
          else if (cell.s === S_BEACH) texKey = tk('beach', theme, variant(gx, gy, 2));
          else if (cell.s === S_CLIFF) texKey = tk('cliff', theme, variant(gx, gy, 2));
          else if (cell.s === S_BRIDGE) texKey = tk('land', theme, variant(gx, gy, 3)); // base under bridge
          else texKey = tk('water', theme, 0); // static base water frame baked

          if (texKey && scene.textures.exists(texKey)) {
            rt.draw(texKey, px, py);
          } else {
            // ultimate fallback: flat colour rect baked into RT
            drawFallbackTile(scene, rt, px, py, cell, theme, shade, BIOMES);
          }

          // Register coast-adjacent water for animation overlay.
          if (cell.s === S_WATER && isCoast(gx, gy)) {
            const wkey = tk('water', theme, 0);
            if (scene.textures.exists(wkey)) {
              const img = scene.add.image(o.cx * CHUNK_PX + px, o.cy * CHUNK_PX + py, wkey)
                .setOrigin(0, 0).setDepth(1);
              waterImages.push({ img: img, theme: theme });
            }
          }
        }
      }
    });

    function isCoast(gx, gy) {
      const ns = [getTile(gx + 1, gy), getTile(gx - 1, gy), getTile(gx, gy + 1), getTile(gx, gy - 1)];
      for (let k = 0; k < ns.length; k++) {
        const t = ns[k];
        if (t && t.s !== S_WATER) return true;
      }
      return false;
    }

    function tk(kind, theme, v) {
      if (!TK) return null;
      if (kind === 'land') return TK.land(theme, v);
      if (kind === 'beach') return TK.beach(theme, v);
      if (kind === 'cliff') return TK.cliff(theme, v);
      if (kind === 'water') return TK.water(theme, v);
      return null;
    }

    // ── BRIDGE PROPS (archipelago): place prop_bridge_* over bridge tiles. ──
    if (style === 'archipelago') {
      // Group bridge tiles into runs and stamp tile-aligned bridge sprites.
      grid.forEach((cell, k) => {
        if (cell.s !== S_BRIDGE) return;
        const p = k.split(','); const gx = +p[0], gy = +p[1];
        // orientation: horizontal if left/right neighbour is also bridge/land spit
        const horiz = isBridgeOrSpit(gx + 1, gy) || isBridgeOrSpit(gx - 1, gy);
        const propKey = horiz ? 'prop_bridge_h' : 'prop_bridge_v';
        const fallback = horiz ? (TK && TK.bridgeH) : (TK && TK.bridgeV);
        const wx = gx * TILE, wy = gy * TILE;
        if (scene.textures.exists(propKey)) {
          scene.add.image(wx, wy, propKey).setOrigin(0, 0).setDepth(10);
        } else if (fallback && scene.textures.exists(fallback)) {
          scene.add.image(wx, wy, fallback).setOrigin(0, 0).setDepth(10);
        } else {
          const g = scene.add.graphics().setDepth(10);
          g.fillStyle(0x6b4a2a, 1).fillRect(wx, wy, TILE, TILE);
        }
      });
    }
    function isBridgeOrSpit(gx, gy) {
      const t = getTile(gx, gy);
      return t && (t.s === S_BRIDGE || t.s === S_LAND);
    }

    // ── DECORATION PROPS on suitable LAND tiles (not centre disc / corridors). ──
    const PROP_KEYS = ['prop_tree_a', 'prop_tree_b', 'prop_rock_a', 'prop_rock_b', 'prop_bush_a', 'prop_flower_a'];
    const decoRng = mulberry(seed ^ 0xabcdef);

    function inProtectedZone(gx, gy, ocx, ocy) {
      // protected = centre disc (r 3) + corridor lanes (indices 7,8 within 3 of edge)
      const li = gx - ocx * CHUNK_TILES, lj = gy - ocy * CHUNK_TILES;
      const di = li - HALF, dj = lj - HALF;
      if (di * di + dj * dj <= (DISC_R + 1) * (DISC_R + 1)) return true;
      // corridor lanes 7/8 across the chunk
      if ((li === HALF - 1 || li === HALF) || (lj === HALF - 1 || lj === HALF)) return true;
      return false;
    }

    occupied.forEach((o) => {
      const theme = chunkTheme(o.cx, o.cy);
      const isTree = (theme === 'forest' || theme === 'hub' || theme === 'snow' || theme === 'magical');
      for (let j = 1; j < CHUNK_TILES - 1; j++) {
        for (let i = 1; i < CHUNK_TILES - 1; i++) {
          const gx = o.cx * CHUNK_TILES + i;
          const gy = o.cy * CHUNK_TILES + j;
          const cell = getTile(gx, gy);
          if (!cell || cell.s !== S_LAND) continue;
          if (inProtectedZone(gx, gy, o.cx, o.cy)) continue;
          if (decoRng() > 0.14) continue; // moderate density

          // pick a prop suited to biome
          const r = decoRng();
          let propKey;
          if (r < 0.4) propKey = isTree ? (decoRng() < 0.5 ? 'prop_tree_a' : 'prop_tree_b') : (decoRng() < 0.5 ? 'prop_rock_a' : 'prop_rock_b');
          else if (r < 0.7) propKey = decoRng() < 0.5 ? 'prop_rock_a' : 'prop_rock_b';
          else if (r < 0.9) propKey = 'prop_bush_a';
          else propKey = 'prop_flower_a';

          const wx = gx * TILE + TILE / 2;
          const wy = gy * TILE + TILE; // bottom anchored
          const blocks = (propKey.indexOf('tree') >= 0 || propKey.indexOf('rock') >= 0);

          if (scene.textures.exists(propKey)) {
            scene.add.image(wx, wy, propKey).setOrigin(0.5, 0.85).setDepth(10);
          } else {
            drawFallbackProp(scene, wx, wy, propKey, theme, shade, BIOMES);
          }
          // Flowers/bushes don't block; trees/rocks do.
          if (blocks) blocked.add(key(gx, gy));
        }
      }
    });

    // ── PUBLIC QUERY HELPERS ──
    function worldToTile(wx, wy) {
      return { gx: Math.floor(wx / TILE), gy: Math.floor(wy / TILE) };
    }

    function surfaceAt(wx, wy) {
      const t = worldToTile(wx, wy);
      const cell = getTile(t.gx, t.gy);
      if (!cell) return null;
      return SURF_NAME[cell.s];
    }

    function biomeAt(wx, wy) {
      const t = worldToTile(wx, wy);
      const cell = getTile(t.gx, t.gy);
      if (!cell) return null;
      return cell.b;
    }

    function isWalkable(wx, wy) {
      const t = worldToTile(wx, wy);
      const cell = getTile(t.gx, t.gy);
      if (!cell) return false; // outside every chunk footprint
      if (cell.s === S_WATER || cell.s === S_CLIFF) return false;
      if (blocked.has(key(t.gx, t.gy))) return false;
      return true; // land, beach, bridge
    }

    function chunkCenterLand(cx, cy) {
      // The forced disc guarantees the exact centre is land + unblocked.
      const gx = cx * CHUNK_TILES + HALF;
      const gy = cy * CHUNK_TILES + HALF;
      const wx = gx * TILE + TILE / 2;
      const wy = gy * TILE + TILE / 2;
      if (isWalkable(wx, wy)) return { x: wx, y: wy };
      // spiral search outward as a safety net
      for (let r = 1; r <= HALF; r++) {
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            const px = (cx * CHUNK_TILES + HALF + di) * TILE + TILE / 2;
            const py = (cy * CHUNK_TILES + HALF + dj) * TILE + TILE / 2;
            if (isWalkable(px, py)) return { x: px, y: py };
          }
        }
      }
      return { x: wx, y: wy };
    }

    function randomLandTiles(cx, cy, count, marginTiles) {
      const margin = marginTiles == null ? 3 : marginTiles;
      const out = [];
      const rng = mulberry((seed ^ Math.imul(cx + 1, 2654435761) ^ Math.imul(cy + 1, 40503) ^ count) >>> 0);
      // collect candidate inner-land tiles
      const cands = [];
      for (let j = margin; j < CHUNK_TILES - margin; j++) {
        for (let i = margin; i < CHUNK_TILES - margin; i++) {
          const gx = cx * CHUNK_TILES + i;
          const gy = cy * CHUNK_TILES + j;
          const cell = getTile(gx, gy);
          if (!cell || cell.s !== S_LAND) continue;
          if (blocked.has(key(gx, gy))) continue;
          cands.push({ x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 });
        }
      }
      // shuffle deterministically, take `count`
      for (let i = cands.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = cands[i]; cands[i] = cands[j]; cands[j] = tmp;
      }
      for (let i = 0; i < Math.min(count, cands.length); i++) out.push(cands[i]);
      return out;
    }

    function spawnPoint() {
      // Hub centre, then nudge toward an adjacent beach tile for "wash ashore".
      const hub = chunkCenterLand(0, 0);
      const t = worldToTile(hub.x, hub.y);
      // search outward for a land tile that touches a beach tile
      for (let r = 1; r <= HALF; r++) {
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            const gx = t.gx + di, gy = t.gy + dj;
            const cell = getTile(gx, gy);
            if (!cell || cell.s !== S_LAND || blocked.has(key(gx, gy))) continue;
            const touchesBeach = [getTile(gx + 1, gy), getTile(gx - 1, gy), getTile(gx, gy + 1), getTile(gx, gy - 1)]
              .some((n) => n && n.s === S_BEACH);
            if (touchesBeach) return { x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 };
          }
        }
      }
      return hub;
    }

    // ── ANIMATED WATER + TIDE: cycle water frames and advance tide phase. ──
    let waterFrame = 0;
    let waterAccum = 0;
    const WATER_MS = 420; // ms per water frame
    let tidePhase = 0;    // 0..1, continuously advances
    function update(time, delta) {
      const dt = delta || 16.6;
      waterAccum += dt;
      if (waterAccum >= WATER_MS) {
        waterAccum = 0;
        waterFrame = (waterFrame + 1) % WATER_FRAMES;
        for (let i = 0; i < waterImages.length; i++) {
          const w = waterImages[i];
          const k = TK ? TK.water(w.theme, waterFrame) : null;
          if (k && scene.textures.exists(k)) w.img.setTexture(k);
        }
      }
      // Tide foam: each fringe tile gets a sine-wave alpha pulse; phase offset
      // staggers neighbours so the wave appears to sweep along the shore (~3.2 s cycle).
      if (coastalFringeImages.length) {
        tidePhase = (tidePhase + dt / 3200) % 1;
        for (let i = 0; i < coastalFringeImages.length; i++) {
          const t = coastalFringeImages[i];
          const ph = (tidePhase + t.phase) % 1;
          t.img.setAlpha(Math.max(0, Math.sin(ph * Math.PI)) * 0.62);
        }
      }
    }

    return {
      isWalkable, surfaceAt, biomeAt, chunkCenterLand,
      randomLandTiles, spawnPoint, update,
      // exposed for debugging / minimap; not part of required contract
      _grid: grid, _blocked: blocked, _style: style,
    };
  }

  // ── Fallback drawing (when generated/sprite textures somehow missing). ──
  function drawFallbackTile(scene, rt, px, py, cell, theme, shade, BIOMES) {
    const pal = BIOMES[theme] || BIOMES.hub;
    let col;
    if (cell.s === 0) col = pal.water[0];
    else if (cell.s === 1) col = pal.beach[0];
    else if (cell.s === 3) col = pal.cliff[0];
    else col = pal.land[0];
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(col, 1).fillRect(0, 0, TILE, TILE);
    const tmpKey = '__bw_fallback_' + col;
    if (!scene.textures.exists(tmpKey)) g.generateTexture(tmpKey, TILE, TILE);
    g.destroy();
    rt.draw(tmpKey, px, py);
  }

  function drawFallbackProp(scene, wx, wy, propKey, theme, shade, BIOMES) {
    const pal = BIOMES[theme] || BIOMES.hub;
    const g = scene.add.graphics().setDepth(10);
    if (propKey.indexOf('tree') >= 0) {
      g.fillStyle(0x6b4a2a, 1).fillRect(wx - 3, wy - 14, 6, 14); // trunk
      g.fillStyle(pal.foliage[0], 1).fillCircle(wx, wy - 20, 12);
      g.fillStyle(pal.foliage[1], 1).fillCircle(wx - 5, wy - 16, 7);
    } else if (propKey.indexOf('rock') >= 0) {
      g.fillStyle(pal.cliff[0], 1).fillCircle(wx, wy - 6, 8);
      g.fillStyle(shade(pal.cliff[0], -0.2), 1).fillCircle(wx + 3, wy - 3, 5);
    } else if (propKey.indexOf('bush') >= 0) {
      g.fillStyle(pal.foliage[0], 1).fillCircle(wx, wy - 6, 8);
      g.fillStyle(pal.foliage[1], 1).fillCircle(wx - 4, wy - 4, 5);
    } else { // flower
      g.fillStyle(pal.foliage[0], 1).fillRect(wx - 1, wy - 8, 2, 8);
      g.fillStyle(pal.accent, 1).fillCircle(wx, wy - 9, 3);
    }
  }

  BW.terrain = { build: build };
})();
