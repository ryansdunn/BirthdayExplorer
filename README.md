# 🎂 BirthdayWorld

An interactive **pixel-art adventure** where friends contribute NPC characters with
birthday messages, and the birthday person washes ashore and explores the world talking
to them.

Built with **Phaser 3** (frontend) and **Node + Express + better-sqlite3** (backend).
No build step, no bundler — Phaser is loaded via CDN. **Zero binary assets**: every
tile, character, prop and projectile is generated at runtime with Phaser Graphics.

## Run it

```bash
npm install
npm start          # or: npm run dev  (auto-restart)
```

Then open <http://localhost:3000/create>.

## The loop

1. **Create** (`/create`) — enter the birthday person's name and date. You get a link
   to set the world up, plus a **contributor** link and an **explorer** link.
2. **Set up** (`/setup/:worldId`) — the organiser picks a world name, the birthday
   person's character + nameplate, the **world shape** (🏝 one organic island / ⛵
   archipelago), a **mood** (Peaceful / Adventure / Chaotic), and the **enemy mix**
   (toggle + 1–5 slider per wholesome enemy type).
3. **Contribute** (`/contribute/:worldId`) — friends pick an emoji character, a zone
   theme, a name, a greeting, and up to 3 dialogue lines. Each submission is placed at
   the next free coordinate, spiralling outward from the hub.
4. **Explore** (`/explore/:worldId`) — a Zelda-style top-down adventure (see below).

## The explorer

A top-down pixel-art adventure rendered with a zoomed main camera (chunky pixels) and a
separate unzoomed UI camera (crisp HUD).

- **Organic terrain.** Each contributed chunk is no longer a square. A deterministic
  noise generator (seeded from the world id) sculpts the land:
  - **One island** — chunks fuse into a single landmass from continuous world-space
    noise, biomes bleed into each other via domain-warped anchors, water rings the coast.
  - **Archipelago** — each contributor is its own organic island ringed by beach, joined
    to neighbours by walkable **wooden bridges**.
  Water is impassable (manual per-tile collision with wall-sliding); every chunk centre
  is guaranteed land so NPCs always stand on ground.
- **Pixel sprites**, all palette-driven and generated at runtime — a 4-direction
  walk-cycle player, distinct NPCs (palette derived from the contributor's name + their
  emoji face), enemies, trees/rocks/bushes/flowers, and the paper airplane. Restyle the
  whole game by editing `public/pixel/palettes.js`.
- **Paper airplanes.** Press **F** (or the mobile ✈ button) to throw a pixel airplane in
  your facing direction; a hit pops a roaming enemy into confetti (it returns on the 30s
  respawn). Birthday Cakes and NPCs are never affected.
- **Feel** — camera leads the direction of travel, ambient particles (forest leaves /
  beach bubbles / magical sparkles), animated water, a 10-minute day/night tint,
  footstep dust, and a light-bloom fog-of-war reveal.
- **HUD** — heart containers (full / half / empty, ½-heart hits with a 1s invincibility
  flash), a compass to the nearest un-met friend, and a fog-of-war minimap.
- **Wholesome enemies** — Love Hearts (home in, ½-heart bump), Huggers (charge, grab
  1.5s, full-heart squeeze), Confetti Bombers (keep distance, lob confetti), and
  Birthday Cakes (stationary; walk in to **heal** a heart). Run out of hearts and you get
  a wholesome game-over — *"You were loved too hard. Try again?"* — respawning at the hub.

Controls: **WASD / arrows** move, **E** talk, **F** throw, **Space** advance dialogue.
On mobile: left-half drag joystick, ✈ button throws, 💬 button appears to talk.

### Swapping in real art

Every sprite/tile is registered under a stable texture key (see the comments atop
`public/pixel/sprites.js` and `public/pixel/textures.js`). To use real pixel art (e.g.
Kenney tiles) instead, register the same keys from loaded images in a Phaser `preload()`
— generation is guarded by `textures.exists`, so engine code doesn't change.

## API

| Method | Route                     | Purpose                                  |
| ------ | ------------------------- | ---------------------------------------- |
| POST   | `/worlds`                 | Create a world → `{ id }`                |
| GET    | `/worlds/:id`             | World metadata (incl. enemy config)      |
| PUT    | `/worlds/:id/setup`       | Save organiser setup (mood, enemies, …)  |
| GET    | `/worlds/:id/chunks`      | All chunks (JSON)                        |
| POST   | `/worlds/:id/chunks`      | Submit a new chunk                       |

SQLite data lives in `birthdayworld.db` (created automatically; git-ignored). Existing
databases are migrated in place (new world columns are added if missing).

## Structure

```
server/index.js         Express app, SQLite, routes, spiral allocation, enemy/terrain config
public/index.html       Create screen
public/setup.html       Organiser world-setup screen (shape, mood, enemies, player)
public/contribute.html  Contributor form
public/explore.html     Phaser game shell (loads the pixel/* modules, then explore.js)
public/explore.js       Phaser scene: terrain/sprite wiring, movement, NPCs, enemies, HUD, dialogue
public/pixel/noise.js     Deterministic value-noise + domain warp (no deps)
public/pixel/palettes.js  Data-driven colour palettes (the restyle "config")
public/pixel/textures.js  Runtime pixel terrain-tile textures
public/pixel/terrain.js   Island / archipelago generators, walkability, rendering
public/pixel/sprites.js   Runtime pixel player / NPC / enemy / prop / airplane sprites
public/pixel/weapon.js    Paper-airplane projectile system
```
