/* BirthdayWorld — character design registry + pixel renderer (characters.js).
 *
 * Single source of truth for every playable / NPC character. No emojis, no
 * binary assets: each design is a small colour + hairstyle spec, painted as
 * chunky pixel art. The SAME paintFrame() drives both the in-game Phaser
 * textures (sprites.js) and the canvas previews used by the HTML pickers
 * (setup.html / contribute.html), so what you pick is exactly what you play.
 *
 * Self-contained — depends on nothing else in BW.
 *
 * EXPORTS (window.BW.characters):
 *   PLAYER_DESIGNS  [{id,name,...}]   birthday-person options
 *   NPC_DESIGNS     [{id,name,...}]   contributor options
 *   ALL             {id: spec}        every design by id
 *   get(id)         -> spec           (falls back to a default design)
 *   paintFrame(put, spec, dir, frame) put(colorInt,x,y,w,h) into a W×H grid
 *   drawToCanvas(canvas, idOrSpec, scale)   front idle preview for the pickers
 *   W, H                              sprite cell size in source pixels
 */
window.BW = window.BW || {};
(function () {
  'use strict';

  const OUTLINE = 0x111111;
  const PAD = 6;            // headroom above the head for hats / spikes
  const W = 24, H = 36;     // source-pixel cell size
  const Y = (v) => v + PAD; // shift the classic 24×30 layout down by PAD

  // shade(color, pct): pct>0 lightens, pct<0 darkens (-1..1).
  function shade(color, pct) {
    let r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
    const t = pct < 0 ? 0 : 255, p = Math.abs(pct);
    r = Math.round((t - r) * p) + r;
    g = Math.round((t - g) * p) + g;
    b = Math.round((t - b) * p) + b;
    return (r << 16) | (g << 8) | b;
  }

  // ─── design table ─────────────────────────────────────────────────────────
  // hairStyle ∈ short | long | spiky | bald | cap | bun | pointhat
  function spec(o) {
    return {
      id: o.id, name: o.name,
      skin: o.skin, hair: o.hair, hairStyle: o.hairStyle || 'short',
      top: o.top, topDark: o.topDark != null ? o.topDark : shade(o.top, -0.25),
      bottom: o.bottom, feet: o.feet != null ? o.feet : shade(o.bottom, -0.4),
      accent: o.accent != null ? o.accent : 0xffffff,
    };
  }

  const PLAYER_DESIGNS = [
    spec({ id: 'wanderer', name: 'Wanderer', skin: 0xf1c9a5, hair: 0x5a3a2a, hairStyle: 'short', top: 0xc9a05a, bottom: 0x3a4a7a, accent: 0xffe0a0 }),
    spec({ id: 'azure',    name: 'Azure',    skin: 0xf1c9a5, hair: 0x3a2a1a, hairStyle: 'short', top: 0x4d8bff, bottom: 0x2a3550, accent: 0xffd24d }),
    spec({ id: 'rosalind', name: 'Rosalind', skin: 0xf6d9bd, hair: 0x7a4a2a, hairStyle: 'long',  top: 0xe87fb0, bottom: 0x6a3a6a, accent: 0xfff0a0 }),
    spec({ id: 'sprout',   name: 'Sprout',   skin: 0xe0b48a, hair: 0x3a6a28, hairStyle: 'spiky', top: 0x5aaf4a, bottom: 0x3a5a2a, accent: 0xd6f08a }),
    spec({ id: 'ember',    name: 'Ember',    skin: 0xc89060, hair: 0x2a1a14, hairStyle: 'short', top: 0xe8633a, bottom: 0x6a2a20, accent: 0xffc08a }),
    spec({ id: 'frost',    name: 'Frost',    skin: 0xf6d9bd, hair: 0x9abfd0, hairStyle: 'cap',   top: 0xbfe9ff, bottom: 0x3a6a8a, accent: 0xffffff }),
    spec({ id: 'dusk',     name: 'Dusk',     skin: 0x8a5a3a, hair: 0x1a1414, hairStyle: 'bun',   top: 0x9b6dff, bottom: 0x3a2a5a, accent: 0xe6c9ff }),
    spec({ id: 'sandy',    name: 'Sandy',    skin: 0xe0b48a, hair: 0xd8b86a, hairStyle: 'short', top: 0xf2d06a, bottom: 0x8a6a3a, accent: 0xfff4c0 }),
  ];

  const NPC_DESIGNS = [
    spec({ id: 'guide',    name: 'The Guide', skin: 0xe8c8a8, hair: 0xd8dde6, hairStyle: 'long',     top: 0x9fb6d6, bottom: 0x5a6a8a, accent: 0xeef3ff }),
    spec({ id: 'sage',     name: 'Sage',      skin: 0xe0b48a, hair: 0x8a8a8a, hairStyle: 'pointhat', top: 0x6a55bf, bottom: 0x3a2a6a, accent: 0x9b6dff }),
    spec({ id: 'ranger',   name: 'Ranger',    skin: 0xc89060, hair: 0x3a2a1a, hairStyle: 'short',    top: 0x3a7a4a, bottom: 0x2a4a2a, accent: 0x9bd66b }),
    spec({ id: 'mariner',  name: 'Mariner',   skin: 0xf1c9a5, hair: 0x222222, hairStyle: 'cap',      top: 0x3a6aa6, bottom: 0x2a3a5a, accent: 0xeafcff }),
    spec({ id: 'scarlet',  name: 'Scarlet',   skin: 0xf6d9bd, hair: 0x8a2a2a, hairStyle: 'long',     top: 0xd64a6a, bottom: 0x6a2a3a, accent: 0xffb3c0 }),
    spec({ id: 'botanist', name: 'Botanist',  skin: 0xe0b48a, hair: 0x5a3a2a, hairStyle: 'bun',      top: 0x7aa84f, bottom: 0x4a5a2a, accent: 0xd6f0a0 }),
    spec({ id: 'tinker',   name: 'Tinker',    skin: 0xc89060, hair: 0x9a9aa0, hairStyle: 'spiky',    top: 0xb0843a, bottom: 0x5a4a2a, accent: 0xffd24d }),
    spec({ id: 'amber',    name: 'Amber',     skin: 0xf1c9a5, hair: 0xa64b2a, hairStyle: 'short',    top: 0xe89a3a, bottom: 0x6a4a20, accent: 0xffd9a0 }),
    spec({ id: 'lumis',    name: 'Lumis',     skin: 0x8a5a3a, hair: 0x2a1a2a, hairStyle: 'bun',      top: 0x2a90a0, bottom: 0x1a4a54, accent: 0x80f0ff }),
    spec({ id: 'crest',    name: 'Crest',     skin: 0xf1c9a5, hair: 0x2a7a8a, hairStyle: 'spiky',    top: 0xe85a3a, bottom: 0x5a2a1a, accent: 0xffc090 }),
    spec({ id: 'petal',    name: 'Petal',     skin: 0xe0b48a, hair: 0xd87aaa, hairStyle: 'long',     top: 0x6ad0a0, bottom: 0x2a5a4a, accent: 0xd0ffe8 }),
    spec({ id: 'stone',    name: 'Stone',     skin: 0xc89060, hair: 0x3a3a50, hairStyle: 'short',    top: 0x5a6890, bottom: 0x2a2a4a, accent: 0xa0aac8 }),
  ];

  const ALL = {};
  PLAYER_DESIGNS.forEach((s) => { ALL[s.id] = s; });
  NPC_DESIGNS.forEach((s) => { ALL[s.id] = s; });

  function get(id) { return ALL[id] || PLAYER_DESIGNS[0]; }

  // ─── pixel helpers ──────────────────────────────────────────────────────
  function outline(put, color, x, y, w, h) {
    put(color, x, y, w, 1);
    put(color, x, y + h - 1, w, 1);
    put(color, x, y, 1, h);
    put(color, x + w - 1, y, 1, h);
  }

  // Hair / headwear, style-aware. Drawn on top of the bare skin head, before
  // the dark head outline and the face features.
  function paintHair(put, spec, dir, hx, hy, hw, hh) {
    const hair = spec.hair, accent = spec.accent;
    const style = spec.hairStyle;

    if (style === 'bald') {
      if (dir === 'up') put(hair, hx, hy, hw, 4);
      else { put(hair, hx, hy, 2, 2); put(hair, hx + hw - 2, hy, 2, 2); }
      return;
    }

    const topH = (style === 'long') ? 4 : 3;
    if (dir === 'up') put(hair, hx, hy, hw, style === 'long' ? 8 : 5);
    else put(hair, hx, hy, hw, topH);

    if (style === 'spiky' && dir !== 'up') {
      put(hair, hx + 1, hy - 2, 2, 2);
      put(hair, hx + 5, hy - 3, 2, 3);
      put(hair, hx + 9, hy - 3, 2, 3);
      put(hair, hx + 13, hy - 2, 2, 2);
    }
    if (style === 'long' && dir !== 'up') {
      put(hair, hx - 1, hy, 2, hh);            // left strand past the ear
      put(hair, hx + hw - 1, hy, 2, hh);       // right strand
    }
    if (style === 'bun') put(hair, hx + 6, hy - 3, 5, 4);   // top-knot
    if (style === 'cap') {
      put(accent, hx - 1, hy - 1, hw + 2, 4);              // band
      if (dir === 'down' || dir === 'right') put(accent, hx + hw, hy + 2, 3, 1);
      if (dir === 'down' || dir === 'left') put(accent, hx - 3, hy + 2, 3, 1);
    }
    if (style === 'pointhat') {
      put(accent, hx - 2, hy - 1, hw + 4, 2);              // brim
      put(accent, hx + 3, hy - 4, 10, 4);                  // cone base
      put(accent, hx + 5, hy - 6, 6, 3);                   // cone mid
      put(accent, hx + 7, hy - 7, 3, 3);                   // cone tip (fits headroom)
    }
  }

  /*
   * paintFrame — draw one character cell into a W×H pixel grid.
   *   put(colorInt, x, y, w, h)  caller-supplied pixel-rect sink
   *   dir   'down' | 'up' | 'left' | 'right'
   *   frame 0 idle · 1 left-foot · 2 passing · 3 right-foot
   */
  function paintFrame(put, spec, dir, frame) {
    dir = dir || 'down';
    frame = frame || 0;
    const skin = spec.skin, hair = spec.hair, top = spec.top,
      topD = spec.topDark, accent = spec.accent, bottom = spec.bottom, feet = spec.feet;

    // ── head ──
    const hx = 4, hy = Y(2), hw = 16, hh = 10;
    put(skin, hx, hy + 3, hw, hh - 3);          // face
    put(skin, hx - 1, hy + 4, 1, 3);            // ears
    put(skin, hx + hw, hy + 4, 1, 3);
    paintHair(put, spec, dir, hx, hy, hw, hh);
    outline(put, OUTLINE, hx, hy, hw, hh);

    // direction-specific face
    if (dir === 'down') {
      put(OUTLINE, hx + 3, hy + 4, 2, 2);
      put(OUTLINE, hx + 11, hy + 4, 2, 2);
      put(hair, hx + 7, hy + 6, 2, 1);
    } else if (dir === 'up') {
      put(hair, hx, hy, hw, 5);
    } else if (dir === 'left') {
      put(OUTLINE, hx + 2, hy + 4, 2, 2);
      put(skin, hx - 2, hy + 6, 2, 2);
    } else { // right
      put(OUTLINE, hx + 12, hy + 4, 2, 2);
      put(skin, hx + hw, hy + 6, 2, 2);
    }

    // ── neck ──
    put(skin, 9, Y(12), 6, 2);

    // ── torso ──
    put(top, 3, Y(14), 18, 10);
    put(topD, 3, Y(14), 3, 10);
    put(topD, 18, Y(14), 3, 10);
    put(OUTLINE, 3, Y(14), 18, 1);
    put(OUTLINE, 3, Y(23), 18, 1);
    put(accent, 11, Y(15), 2, 8);               // centre seam
    outline(put, OUTLINE, 3, Y(14), 18, 10);

    // ── arms ──
    if (dir === 'left' || dir === 'right') {
      if (dir === 'left') {
        put(top, 0, Y(15), 3, 8); put(topD, 0, Y(15), 1, 8); put(skin, 0, Y(22), 3, 2);
      } else {
        put(top, 21, Y(15), 3, 8); put(topD, 23, Y(15), 1, 8); put(skin, 21, Y(22), 3, 2);
      }
    } else {
      put(top, 0, Y(15), 3, 8); put(top, 21, Y(15), 3, 8);
      put(topD, 0, Y(15), 1, 8); put(topD, 23, Y(15), 1, 8);
      put(skin, 0, Y(22), 3, 2); put(skin, 21, Y(22), 3, 2);
    }

    // ── pants ──
    put(bottom, 3, Y(24), 18, 4);
    put(OUTLINE, 11, Y(24), 2, 4);
    outline(put, OUTLINE, 3, Y(24), 18, 4);

    // ── feet (walk cycle) ──
    const bob = (frame === 2) ? 1 : 0;
    if (frame === 0 || frame === 2) {
      put(feet, 4, Y(28) + bob, 7, 2 - bob);
      put(feet, 13, Y(28) + bob, 7, 2 - bob);
    } else if (frame === 1) {
      put(feet, 3, Y(28), 7, 2);
      put(feet, 14, Y(27), 6, 2);
    } else {
      put(feet, 4, Y(27), 6, 2);
      put(feet, 13, Y(28), 7, 2);
    }
  }

  // ─── canvas preview (HTML pickers) ────────────────────────────────────────
  function drawToCanvas(canvas, idOrSpec, scale) {
    const s = (typeof idOrSpec === 'string') ? get(idOrSpec) : idOrSpec;
    scale = scale || 4;
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const put = (color, x, y, w, h) => {
      ctx.fillStyle = '#' + ('000000' + (color >>> 0).toString(16)).slice(-6);
      ctx.fillRect(x * scale, y * scale, w * scale, h * scale);
    };
    paintFrame(put, s, 'down', 0);
  }

  BW.characters = { PLAYER_DESIGNS, NPC_DESIGNS, ALL, get, paintFrame, drawToCanvas, W, H, shade };
})();
