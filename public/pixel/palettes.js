/* BirthdayWorld — data-driven colour palettes (the "config" layer).
 * Edit colours here to restyle the whole game; no art files involved.
 * All colours are 0xRRGGBB integers (Phaser-native). */
window.BW = window.BW || {};
(function () {
  // shade(color, pct): pct>0 lightens, pct<0 darkens. pct in -1..1
  function shade(color, pct) {
    let r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
    const t = pct < 0 ? 0 : 255;
    const p = Math.abs(pct);
    r = Math.round((t - r) * p) + r;
    g = Math.round((t - g) * p) + g;
    b = Math.round((t - b) * p) + b;
    return (r << 16) | (g << 8) | b;
  }

  // Per-biome palettes. Each: land shades, beach shades, cliff/rock shades,
  // water shades (deep→shallow), foam, foliage shades, and an accent.
  const biome = {
    forest: {
      land: [0x4a7a36, 0x3f6b2e, 0x568a3e], beach: [0xe2cd8f, 0xd2bb78],
      cliff: [0x6b5a3a, 0x53462e], water: [0x1f5575, 0x2a6b8a, 0x3f86a6], foam: 0xcaf0ff,
      foliage: [0x2f5a26, 0x244a1d], accent: 0x9bd66b,
    },
    beach: {
      land: [0xd9c789, 0xcdb878, 0xe6d79a], beach: [0xefe1ad, 0xe2d094],
      cliff: [0x9a8a66, 0x80734f], water: [0x1a6b8a, 0x2585a6, 0x3fa0c2], foam: 0xeafcff,
      foliage: [0x6fae5a, 0x5b9447], accent: 0xffe6a3,
    },
    cave: {
      land: [0x4a3f3a, 0x3d332f, 0x564944], beach: [0x6a5d52, 0x5a4e44],
      cliff: [0x2f2724, 0x241d1b], water: [0x243a55, 0x33506f, 0x456a8a], foam: 0x9fc6e0,
      foliage: [0x4a5a3a, 0x3c4a2f], accent: 0x8f7fae,
    },
    snow: {
      land: [0xd8e6ee, 0xc6d8e2, 0xeaf3f8], beach: [0xbfd2db, 0xaec3cd],
      cliff: [0x8fa6b2, 0x76909d], water: [0x4f7e96, 0x6a9bb2, 0x8bbacd], foam: 0xffffff,
      foliage: [0x6f9c8a, 0x5a8472], accent: 0xbfe9ff,
    },
    desert: {
      land: [0xc9a86a, 0xba975a, 0xd8ba7e], beach: [0xe4cd92, 0xd6bd80],
      cliff: [0x9a7c4a, 0x806339], water: [0x2585a6, 0x39a0bf, 0x55b8d6], foam: 0xe9fbff,
      foliage: [0x8aa84f, 0x73913e], accent: 0xf2d98a,
    },
    magical: {
      land: [0x4a3a6b, 0x3f3060, 0x59477f], beach: [0x8a6fae, 0x77609a],
      cliff: [0x352651, 0x2a1d42], water: [0x3a2a7a, 0x4f3a9c, 0x6a55bf], foam: 0xe6c9ff,
      foliage: [0x6a4f9c, 0x573f86], accent: 0xffb3f0,
    },
    hub: {
      land: [0x4f8a4a, 0x447b40, 0x5d9b57], beach: [0xe4d398, 0xd6c486],
      cliff: [0x6f6048, 0x584c38], water: [0x256f8a, 0x3a8aa6, 0x55a4c2], foam: 0xeafcff,
      foliage: [0x356b30, 0x2b5827], accent: 0xffe7a3,
    },
  };

  const enemy = {
    love_heart: { body: 0xff5fa2, dark: 0xe23f86, light: 0xffa6cd, eye: 0x6a1030 },
    hugger: { body: 0xffb066, dark: 0xe8893a, light: 0xffd0a0, eye: 0x5a3a20 },
    confetti_bomber: { body: 0xffd24d, dark: 0xe6b32f, light: 0xfff0a0, eye: 0x8a6a10 },
    birthday_cake: { base: 0xf3d9b0, icing: 0xff9ecb, candle: 0xffffff, flame: 0xffc94d, plate: 0xd9d9e0 },
  };

  const player = {
    skin: 0xf1c9a5, hair: 0x5a3a2a, jacket: 0x4d8bff, jacketDark: 0x356bd6,
    pants: 0x2a3550, feet: 0x222a3a, accent: 0xffd24d,
  };

  // Deterministic NPC body palette from a name string.
  const NPC_JACKETS = [0xd76a6a, 0x6ad79a, 0xd7b86a, 0x6a9bd7, 0xb06ad7, 0xd76aa8, 0x6ad7cf, 0x9ad76a];
  const NPC_HAIRS = [0x3a2a1a, 0x5a3a2a, 0x222222, 0x7a5a3a, 0x8a8a8a, 0xa64b2a];
  const NPC_SKINS = [0xf1c9a5, 0xe0b48a, 0xc89060, 0x8a5a3a, 0xf6d9bd];
  function forName(name) {
    const s = BW.hashStringToSeed(name || 'friend');
    return {
      skin: NPC_SKINS[s % NPC_SKINS.length],
      hair: NPC_HAIRS[(s >> 3) % NPC_HAIRS.length],
      jacket: NPC_JACKETS[(s >> 6) % NPC_JACKETS.length],
      jacketDark: shade(NPC_JACKETS[(s >> 6) % NPC_JACKETS.length], -0.25),
      pants: shade(NPC_JACKETS[(s >> 9) % NPC_JACKETS.length], -0.4),
      accent: 0xffffff,
    };
  }

  BW.palettes = { shade, biome, enemy, player, forName, lighten: (c) => shade(c, 0.25), darken: (c) => shade(c, -0.25) };
})();
