const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DB_PATH = path.join(__dirname, '..', 'birthdayworld.db');

const THEMES = ['forest', 'beach', 'cave', 'snow', 'desert', 'magical'];

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS worlds (
    id              TEXT PRIMARY KEY,
    birthday_person TEXT NOT NULL,
    birthday_date   TEXT,
    created_at      TEXT NOT NULL,
    world_name      TEXT,
    player_sprite   TEXT,
    player_name     TEXT,
    mood            TEXT,
    enemy_config    TEXT,
    terrain_style   TEXT
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id               TEXT PRIMARY KEY,
    world_id         TEXT NOT NULL,
    coord_x          INTEGER NOT NULL,
    coord_y          INTEGER NOT NULL,
    theme            TEXT NOT NULL,
    contributor_name TEXT,
    sprite           TEXT,
    greeting         TEXT,
    dialogue_lines   TEXT,
    created_at       TEXT NOT NULL,
    FOREIGN KEY (world_id) REFERENCES worlds(id)
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_world ON chunks(world_id);
`);

// Lightweight migration: add any columns missing from older databases.
const worldCols = new Set(db.prepare('PRAGMA table_info(worlds)').all().map((c) => c.name));
for (const [col, type] of [
  ['world_name', 'TEXT'],
  ['player_sprite', 'TEXT'],
  ['player_name', 'TEXT'],
  ['mood', 'TEXT'],
  ['enemy_config', 'TEXT'],
  ['terrain_style', 'TEXT'],
]) {
  if (!worldCols.has(col)) db.exec(`ALTER TABLE worlds ADD COLUMN ${col} ${type}`);
}

// ---------------------------------------------------------------------------
// Enemy config presets
// ---------------------------------------------------------------------------
const ENEMY_TYPES = ['love_heart', 'hugger', 'confetti_bomber', 'birthday_cake'];

const MOOD_PRESETS = {
  peaceful: {
    love_heart: { on: false, count: 2 },
    hugger: { on: false, count: 1 },
    confetti_bomber: { on: false, count: 2 },
    birthday_cake: { on: true, count: 1 },
  },
  adventure: {
    love_heart: { on: true, count: 2 },
    hugger: { on: true, count: 1 },
    confetti_bomber: { on: false, count: 2 },
    birthday_cake: { on: true, count: 1 },
  },
  chaotic: {
    love_heart: { on: true, count: 4 },
    hugger: { on: true, count: 3 },
    confetti_bomber: { on: true, count: 3 },
    birthday_cake: { on: true, count: 2 },
  },
};

const DEFAULT_ENEMY_CONFIG = MOOD_PRESETS.adventure;

function normaliseEnemyConfig(raw) {
  const out = {};
  for (const t of ENEMY_TYPES) {
    const src = (raw && raw[t]) || DEFAULT_ENEMY_CONFIG[t];
    const count = Math.max(1, Math.min(5, parseInt(src.count, 10) || 1));
    out[t] = { on: !!src.on, count };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spiral coordinate allocation
// ---------------------------------------------------------------------------
// Slot 0 is the hub (0,0). Subsequent slots spiral outward. The brief gives:
//   slot 1 -> (1,0), slot 2 -> (-1,0), slot 3 -> (0,1), slot 4 -> (0,-1),
//   slot 5 -> (1,1), ...
// We generate a deterministic ordered list of coordinates and pick the first
// one not already occupied.
function spiralCoords(count) {
  // Ordered by ring, with the explicit ordering the brief asks for in ring 1:
  // +x, -x, +y, -y, then diagonals.
  const coords = [[0, 0]];
  let ring = 1;
  while (coords.length < count) {
    const ringCoords = [];
    for (let x = -ring; x <= ring; x++) {
      for (let y = -ring; y <= ring; y++) {
        if (Math.max(Math.abs(x), Math.abs(y)) === ring) {
          ringCoords.push([x, y]);
        }
      }
    }
    // Sort so axis-aligned neighbours come before diagonals, matching the brief.
    ringCoords.sort((a, b) => {
      const da = Math.abs(a[0]) + Math.abs(a[1]);
      const db_ = Math.abs(b[0]) + Math.abs(b[1]);
      if (da !== db_) return da - db_;
      // within same manhattan distance: +x, -x, +y, -y ordering
      return rankAxis(a) - rankAxis(b);
    });
    for (const c of ringCoords) coords.push(c);
    ring++;
  }
  return coords.slice(0, count);
}

function rankAxis([x, y]) {
  // Deterministic tie-breaker: prefer +x, then -x, then +y, then -y, then rest.
  if (y === 0 && x > 0) return 0;
  if (y === 0 && x < 0) return 1;
  if (x === 0 && y > 0) return 2;
  if (x === 0 && y < 0) return 3;
  // diagonals: stable by angle
  return 4 + Math.atan2(y, x);
}

function nextCoord(worldId) {
  const used = db
    .prepare('SELECT coord_x, coord_y FROM chunks WHERE world_id = ?')
    .all(worldId);
  const usedSet = new Set(used.map((r) => `${r.coord_x},${r.coord_y}`));
  // The hub (0,0) is reserved as the spawn point and never gets an NPC chunk.
  usedSet.add('0,0');
  const candidates = spiralCoords(usedSet.size + 2);
  for (const [x, y] of candidates) {
    if (!usedSet.has(`${x},${y}`)) return { x, y };
  }
  // Fallback (should not happen): expand further.
  const more = spiralCoords(usedSet.size + 50);
  for (const [x, y] of more) {
    if (!usedSet.has(`${x},${y}`)) return { x, y };
  }
  throw new Error('Could not allocate a coordinate');
}

// ---------------------------------------------------------------------------
// App + routes
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Friendly route aliases for the three screens.
app.get('/create', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/contribute/:worldId', (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'contribute.html'))
);
app.get('/explore/:worldId', (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'explore.html'))
);
app.get('/setup/:worldId', (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'setup.html'))
);

// Create a world.
app.post('/worlds', (req, res) => {
  const { birthday_person, birthday_date } = req.body || {};
  if (!birthday_person || !String(birthday_person).trim()) {
    return res.status(400).json({ error: 'birthday_person is required' });
  }
  const id = nanoid(10);
  const created_at = new Date().toISOString();
  db.prepare(
    'INSERT INTO worlds (id, birthday_person, birthday_date, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, String(birthday_person).trim(), birthday_date || '', created_at);
  res.status(201).json({ id });
});

// Get world metadata.
app.get('/worlds/:id', (req, res) => {
  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(req.params.id);
  if (!world) return res.status(404).json({ error: 'world not found' });
  world.enemy_config = normaliseEnemyConfig(safeParseObject(world.enemy_config));
  world.mood = world.mood || 'adventure';
  world.terrain_style = world.terrain_style || 'island';
  world.player_sprite = world.player_sprite || '🧑';
  world.player_name = world.player_name || world.birthday_person;
  world.world_name = world.world_name || `${world.birthday_person}'s World`;
  res.json(world);
});

// Save organiser world setup (mood, enemy mix, player appearance, world name).
app.put('/worlds/:id/setup', (req, res) => {
  const world = db.prepare('SELECT id FROM worlds WHERE id = ?').get(req.params.id);
  if (!world) return res.status(404).json({ error: 'world not found' });

  const { world_name, player_sprite, player_name, mood, enemy_config, terrain_style } = req.body || {};
  const moodKey = MOOD_PRESETS[mood] ? mood : 'adventure';
  const terrainKey = terrain_style === 'archipelago' ? 'archipelago' : 'island';
  const config = normaliseEnemyConfig(enemy_config);

  db.prepare(
    `UPDATE worlds
       SET world_name = ?, player_sprite = ?, player_name = ?, mood = ?, enemy_config = ?, terrain_style = ?
     WHERE id = ?`
  ).run(
    (world_name || '').toString().trim().slice(0, 60) || null,
    (player_sprite || '🧑').toString(),
    (player_name || '').toString().trim().slice(0, 40) || null,
    moodKey,
    JSON.stringify(config),
    terrainKey,
    req.params.id
  );
  res.json({ ok: true });
});

// Get all chunks for a world.
app.get('/worlds/:id/chunks', (req, res) => {
  const world = db.prepare('SELECT id FROM worlds WHERE id = ?').get(req.params.id);
  if (!world) return res.status(404).json({ error: 'world not found' });
  const rows = db
    .prepare('SELECT * FROM chunks WHERE world_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  const chunks = rows.map((r) => ({
    ...r,
    dialogue_lines: safeParseLines(r.dialogue_lines),
  }));
  res.json(chunks);
});

// Submit a new chunk (contributor form).
app.post('/worlds/:id/chunks', (req, res) => {
  const world = db.prepare('SELECT id FROM worlds WHERE id = ?').get(req.params.id);
  if (!world) return res.status(404).json({ error: 'world not found' });

  const {
    theme,
    contributor_name,
    sprite,
    greeting,
    dialogue_lines,
  } = req.body || {};

  if (!THEMES.includes(theme)) {
    return res.status(400).json({ error: `theme must be one of: ${THEMES.join(', ')}` });
  }

  // Normalise dialogue lines to a JSON array of non-empty strings (max 3).
  let lines = [];
  if (Array.isArray(dialogue_lines)) {
    lines = dialogue_lines;
  } else if (typeof dialogue_lines === 'string') {
    lines = [dialogue_lines];
  }
  lines = lines
    .map((l) => String(l).trim())
    .filter((l) => l.length > 0)
    .slice(0, 3);

  const { x, y } = nextCoord(req.params.id);
  const id = nanoid(10);
  const created_at = new Date().toISOString();

  db.prepare(
    `INSERT INTO chunks
      (id, world_id, coord_x, coord_y, theme, contributor_name, sprite, greeting, dialogue_lines, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.params.id,
    x,
    y,
    theme,
    (contributor_name || '').toString().trim() || 'A friend',
    (sprite || '🧙').toString(),
    (greeting || '').toString().trim(),
    JSON.stringify(lines),
    created_at
  );

  res.status(201).json({ id, coord_x: x, coord_y: y });
});

function safeParseLines(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`BirthdayWorld running at http://localhost:${PORT}`);
  console.log(`  Create a world:  http://localhost:${PORT}/create`);
});
