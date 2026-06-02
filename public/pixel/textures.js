/* BirthdayWorld — runtime-generated terrain TILE textures (textures.js).
 *
 * NO binary assets: every tile texture is drawn with a Phaser Graphics object
 * and baked into a GPU texture via generateTexture(). Plain <script> tag; attaches
 * to window.BW. Depends on BW.makeNoise / BW.palettes (loaded before this file).
 *
 * ── SWAP PATH (real art instead of generated) ─────────────────────────────
 * Every tile this module bakes is registered under a stable string key (see the
 * key list below). To use hand-drawn art instead, simply LOAD images under the
 * SAME keys in your scene's preload(), e.g.
 *     scene.load.image('terr_forest_land_0', 'art/forest_land_0.png');
 * Then DO NOT call BW.textures.generate() (or let its exists() guards skip the
 * ones you've provided). terrain.js only ever references textures by key, so no
 * engine code changes. Tiles must be 32×32; water frames must share dimensions.
 *
 * KEYS REGISTERED (per biome theme T in forest|beach|cave|snow|desert|magical|hub):
 *   terr_<T>_land_0 .. terr_<T>_land_2    (3 land variants)
 *   terr_<T>_beach_0 .. terr_<T>_beach_1  (2 beach variants)
 *   terr_<T>_cliff_0 .. terr_<T>_cliff_1  (2 cliff variants)
 *   terr_water_<T>_0 .. terr_water_<T>_2  (3 animated water frames)
 *   terr_fallback_bridge_h, terr_fallback_bridge_v (used by terrain.js only if
 *                                        sprites.js prop_bridge_* are missing)
 */
window.BW = window.BW || {};
(function () {
  const TILE = 32;

  // Deterministic per-pixel-ish jitter so generated tiles look hand-placed but
  // are identical every run. (Texture content does not depend on world seed —
  // only on biome + variant, so we can share textures across the whole world.)
  function rngFrom(a, b, c) {
    let h = ((a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647) >>> 0;
    return function () {
      h = (h ^ (h << 13)) >>> 0;
      h = (h ^ (h >>> 17)) >>> 0;
      h = (h ^ (h << 5)) >>> 0;
      return h / 4294967295;
    };
  }

  // Fill the 32×32 tile with a base colour, then add chunky 2-4px speckles in
  // two related shades, plus a subtle 1px darker bottom/right edge for tile
  // readability in the baked render texture.
  function paintTile(g, base, light, dark, variant, kind) {
    g.fillStyle(base, 1);
    g.fillRect(0, 0, TILE, TILE);

    const rand = rngFrom(base, kind, variant);
    // Chunky speckles (4px blocks aligned to a coarse grid for pixel-art feel).
    const blocks = kind === 'water' ? 10 : 14;
    for (let i = 0; i < blocks; i++) {
      const bx = (Math.floor(rand() * 8) * 4);
      const by = (Math.floor(rand() * 8) * 4);
      const r = rand();
      const sz = r < 0.5 ? 2 : 4;
      g.fillStyle(r < 0.5 ? dark : light, 1);
      g.fillRect(bx, by, sz, sz);
    }
    // Subtle 1px darker edge on bottom + right so adjacent tiles read as a grid.
    g.fillStyle(dark, 0.6);
    g.fillRect(0, TILE - 1, TILE, 1);
    g.fillRect(TILE - 1, 0, 1, TILE);
  }

  function makeIfMissing(scene, key, drawFn) {
    if (scene.textures.exists(key)) return;
    const g = scene.add.graphics();
    drawFn(g);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }

  function generate(scene) {
    const P = (BW.palettes && BW.palettes.biome) || {};
    const shade = (BW.palettes && BW.palettes.shade) || ((c) => c);
    const themes = Object.keys(P);

    themes.forEach((theme) => {
      const pal = P[theme];

      // ── LAND: 3 variants. land[] has 3 shades; mix to make variety. ──
      for (let v = 0; v < 3; v++) {
        const base = pal.land[v % pal.land.length];
        makeIfMissing(scene, `terr_${theme}_land_${v}`, (g) => {
          paintTile(g, base, shade(base, 0.18), shade(base, -0.18), v, 'land');
          // occasional accent fleck (foliage tint) for organic feel
          const rand = rngFrom(base, 99, v);
          const fol = pal.foliage[v % pal.foliage.length];
          for (let i = 0; i < 3; i++) {
            g.fillStyle(fol, 0.55);
            g.fillRect(Math.floor(rand() * 8) * 4, Math.floor(rand() * 8) * 4, 2, 2);
          }
        });
      }

      // ── BEACH: 2 variants. ──
      for (let v = 0; v < 2; v++) {
        const base = pal.beach[v % pal.beach.length];
        makeIfMissing(scene, `terr_${theme}_beach_${v}`, (g) => {
          paintTile(g, base, shade(base, 0.16), shade(base, -0.16), v, 'beach');
        });
      }

      // ── CLIFF: 2 variants (rocky, higher contrast). ──
      for (let v = 0; v < 2; v++) {
        const base = pal.cliff[v % pal.cliff.length];
        makeIfMissing(scene, `terr_${theme}_cliff_${v}`, (g) => {
          paintTile(g, base, shade(base, 0.22), shade(base, -0.28), v, 'cliff');
        });
      }

      // ── WATER: 3 animated frames. Cycle deep→shallow water[] shades and
      //    drift a couple of foam specks so update() can flip frames cheaply. ──
      for (let f = 0; f < 3; f++) {
        const base = pal.water[f % pal.water.length];
        const next = pal.water[(f + 1) % pal.water.length];
        makeIfMissing(scene, `terr_water_${theme}_${f}`, (g) => {
          g.fillStyle(base, 1);
          g.fillRect(0, 0, TILE, TILE);
          const rand = rngFrom(base, 7, f);
          // horizontal wave bands in the shallower shade
          for (let i = 0; i < 4; i++) {
            const y = ((Math.floor(rand() * 8) * 4) + f * 4) % TILE;
            g.fillStyle(next, 0.5);
            g.fillRect(0, y, TILE, 2);
          }
          // drifting foam specks (move with frame index)
          g.fillStyle(pal.foam, 0.8);
          for (let i = 0; i < 3; i++) {
            const fx = (Math.floor(rand() * 8) * 4 + f * 6) % TILE;
            const fy = (Math.floor(rand() * 8) * 4 + f * 3) % TILE;
            g.fillRect(fx, fy, 2, 2);
          }
        });
      }
    });

    // ── Fallback bridge tiles (only consumed by terrain.js when sprites.js
    //    prop_bridge_h / prop_bridge_v are absent). Wooden planks. ──
    makeIfMissing(scene, 'terr_fallback_bridge_h', (g) => {
      g.fillStyle(0x6b4a2a, 1); g.fillRect(0, 4, TILE, TILE - 8);
      g.fillStyle(0x4f3620, 1);
      for (let x = 0; x < TILE; x += 6) g.fillRect(x, 4, 1, TILE - 8);
      g.fillStyle(0x8a6238, 1); g.fillRect(0, 5, TILE, 2);
      g.fillStyle(0x3a2716, 1); g.fillRect(0, 4, TILE, 1); g.fillRect(0, TILE - 5, TILE, 1);
    });
    makeIfMissing(scene, 'terr_fallback_bridge_v', (g) => {
      g.fillStyle(0x6b4a2a, 1); g.fillRect(4, 0, TILE - 8, TILE);
      g.fillStyle(0x4f3620, 1);
      for (let y = 0; y < TILE; y += 6) g.fillRect(4, y, TILE - 8, 1);
      g.fillStyle(0x8a6238, 1); g.fillRect(5, 0, 2, TILE);
      g.fillStyle(0x3a2716, 1); g.fillRect(4, 0, 1, TILE); g.fillRect(TILE - 5, 0, 1, TILE);
    });
  }

  // Key helpers terrain.js uses so the two files agree on naming.
  const keys = {
    land: (t, v) => `terr_${t}_land_${v}`,
    beach: (t, v) => `terr_${t}_beach_${v}`,
    cliff: (t, v) => `terr_${t}_cliff_${v}`,
    water: (t, f) => `terr_water_${t}_${f}`,
    bridgeH: 'terr_fallback_bridge_h',
    bridgeV: 'terr_fallback_bridge_v',
  };

  BW.textures = { generate, keys, TILE, WATER_FRAMES: 3 };
})();
