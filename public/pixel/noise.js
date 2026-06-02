/* BirthdayWorld — deterministic value noise (no dependencies).
 * Exposes BW.makeNoise(seed) and BW.hashStringToSeed(str).
 * fbm() returns 0..1; warp() returns domain-warped coordinates. */
window.BW = window.BW || {};
(function () {
  function hash2(ix, iy, seed) {
    let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 1274126177;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295; // 0..1
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;

  function value2d(x, y, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const v00 = hash2(x0, y0, seed), v10 = hash2(x0 + 1, y0, seed);
    const v01 = hash2(x0, y0 + 1, seed), v11 = hash2(x0 + 1, y0 + 1, seed);
    const sx = smooth(fx), sy = smooth(fy);
    return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
  }

  BW.makeNoise = function (seed) {
    seed = seed >>> 0;
    return {
      value(x, y) { return value2d(x, y, seed); },
      // Fractal Brownian motion, returns 0..1
      fbm(x, y, opts) {
        opts = opts || {};
        const oct = opts.octaves || 4;
        const pers = opts.persistence || 0.5;
        const lac = opts.lacunarity || 2;
        let freq = opts.frequency || 1, amp = 1, sum = 0, norm = 0;
        for (let i = 0; i < oct; i++) {
          sum += amp * value2d(x * freq, y * freq, seed + i * 1013);
          norm += amp; amp *= pers; freq *= lac;
        }
        return sum / norm;
      },
      // Domain warp: returns shifted {x, y} for organic, non-griddy edges
      warp(x, y, amount, freq) {
        freq = freq || 0.5; amount = amount == null ? 1 : amount;
        const wx = value2d(x * freq + 11.3, y * freq + 5.1, seed + 777) - 0.5;
        const wy = value2d(x * freq - 7.7, y * freq + 19.2, seed + 999) - 0.5;
        return { x: x + wx * amount, y: y + wy * amount };
      },
    };
  };

  BW.hashStringToSeed = function (str) {
    let h = 2166136261 >>> 0;
    str = String(str || '');
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  };
})();
