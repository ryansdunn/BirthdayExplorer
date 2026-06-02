require('dotenv').config();
const path = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  next();
}

// ---------------------------------------------------------------------------
// Enemy config presets
// ---------------------------------------------------------------------------
const THEMES = ['forest', 'beach', 'cave', 'snow', 'desert', 'magical'];
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
function spiralCoords(count) {
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
    ringCoords.sort((a, b) => {
      const da = Math.abs(a[0]) + Math.abs(a[1]);
      const db_ = Math.abs(b[0]) + Math.abs(b[1]);
      if (da !== db_) return da - db_;
      return rankAxis(a) - rankAxis(b);
    });
    for (const c of ringCoords) coords.push(c);
    ring++;
  }
  return coords.slice(0, count);
}

function rankAxis([x, y]) {
  if (y === 0 && x > 0) return 0;
  if (y === 0 && x < 0) return 1;
  if (x === 0 && y > 0) return 2;
  if (x === 0 && y < 0) return 3;
  return 4 + Math.atan2(y, x);
}

async function nextCoord(worldId) {
  const { data: used, error } = await supabase
    .from('chunks')
    .select('coord_x, coord_y')
    .eq('world_id', worldId);
  if (error) throw error;
  const usedSet = new Set((used || []).map((r) => `${r.coord_x},${r.coord_y}`));
  usedSet.add('0,0');
  const candidates = spiralCoords(usedSet.size + 2);
  for (const [x, y] of candidates) {
    if (!usedSet.has(`${x},${y}`)) return { x, y };
  }
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

// Inject public Supabase config for the frontend.
app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = ${JSON.stringify({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  })};`);
});

app.get('/', (_req, res) => res.redirect('/dashboard'));
app.use(express.static(PUBLIC_DIR));

// Route aliases
app.get('/create', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/auth', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'auth.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
app.get('/contribute/:worldId', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'contribute.html')));
app.get('/explore/:worldId', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'explore.html')));
app.get('/setup/:worldId', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'setup.html')));

// Create a world (requires auth).
app.post('/worlds', requireAuth, async (req, res) => {
  try {
    const { birthday_person, birthday_date } = req.body || {};
    if (!birthday_person || !String(birthday_person).trim()) {
      return res.status(400).json({ error: 'birthday_person is required' });
    }
    const id = nanoid(10);
    const { error } = await supabase.from('worlds').insert({
      id,
      owner_id: req.user.id,
      birthday_person: String(birthday_person).trim(),
      birthday_date: birthday_date || '',
    });
    if (error) throw error;
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get world metadata (public).
app.get('/worlds/:id', async (req, res) => {
  try {
    const { data: world, error } = await supabase
      .from('worlds')
      .select()
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!world) return res.status(404).json({ error: 'world not found' });
    world.enemy_config = normaliseEnemyConfig(world.enemy_config);
    world.mood = world.mood || 'adventure';
    world.terrain_style = world.terrain_style || 'island';
    world.player_sprite = world.player_sprite || 'wanderer';
    world.player_name = world.player_name || world.birthday_person;
    world.world_name = world.world_name || `${world.birthday_person}'s World`;
    res.json(world);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save world setup (requires auth + ownership).
app.put('/worlds/:id/setup', requireAuth, async (req, res) => {
  try {
    const { data: world, error: fetchErr } = await supabase
      .from('worlds')
      .select('id, owner_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!world) return res.status(404).json({ error: 'world not found' });
    if (world.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { world_name, player_sprite, player_name, mood, enemy_config, terrain_style } = req.body || {};
    const moodKey = MOOD_PRESETS[mood] ? mood : 'adventure';
    const terrainKey = terrain_style === 'archipelago' ? 'archipelago' : 'island';
    const config = normaliseEnemyConfig(enemy_config);

    const { error: updateErr } = await supabase.from('worlds').update({
      world_name: (world_name || '').toString().trim().slice(0, 60) || null,
      player_sprite: (player_sprite || 'wanderer').toString(),
      player_name: (player_name || '').toString().trim().slice(0, 40) || null,
      mood: moodKey,
      enemy_config: config,
      terrain_style: terrainKey,
    }).eq('id', req.params.id);
    if (updateErr) throw updateErr;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all chunks for a world (public).
app.get('/worlds/:id/chunks', async (req, res) => {
  try {
    const { data: world } = await supabase
      .from('worlds').select('id').eq('id', req.params.id).maybeSingle();
    if (!world) return res.status(404).json({ error: 'world not found' });
    const { data: chunks, error } = await supabase
      .from('chunks')
      .select()
      .eq('world_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(chunks || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit a chunk (public — contributors don't need accounts).
app.post('/worlds/:id/chunks', async (req, res) => {
  try {
    const { data: world } = await supabase
      .from('worlds').select('id').eq('id', req.params.id).maybeSingle();
    if (!world) return res.status(404).json({ error: 'world not found' });

    const { theme, contributor_name, sprite, greeting, dialogue_lines } = req.body || {};
    if (!THEMES.includes(theme)) {
      return res.status(400).json({ error: `theme must be one of: ${THEMES.join(', ')}` });
    }

    let lines = [];
    if (Array.isArray(dialogue_lines)) lines = dialogue_lines;
    else if (typeof dialogue_lines === 'string') lines = [dialogue_lines];
    lines = lines.map((l) => String(l).trim()).filter((l) => l.length > 0).slice(0, 3);

    const { x, y } = await nextCoord(req.params.id);
    const id = nanoid(10);

    const { error } = await supabase.from('chunks').insert({
      id,
      world_id: req.params.id,
      coord_x: x,
      coord_y: y,
      theme,
      contributor_name: (contributor_name || '').toString().trim() || 'A friend',
      sprite: (sprite || 'guide').toString(),
      greeting: (greeting || '').toString().trim(),
      dialogue_lines: lines,
    });
    if (error) throw error;
    res.status(201).json({ id, coord_x: x, coord_y: y });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all worlds owned by the current user (dashboard).
app.get('/dashboard/worlds', requireAuth, async (req, res) => {
  try {
    const { data: worlds, error } = await supabase
      .from('worlds')
      .select('id, birthday_person, birthday_date, created_at, world_name')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const ids = (worlds || []).map((w) => w.id);
    let countMap = {};
    if (ids.length > 0) {
      const { data: counts } = await supabase
        .from('chunks')
        .select('world_id')
        .in('world_id', ids);
      for (const row of counts || []) {
        countMap[row.world_id] = (countMap[row.world_id] || 0) + 1;
      }
    }

    res.json((worlds || []).map((w) => ({
      ...w,
      world_name: w.world_name || `${w.birthday_person}'s World`,
      chunk_count: countMap[w.id] || 0,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`BirthdayWorld running at http://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);
});
