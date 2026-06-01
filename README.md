# 🎂 BirthdayWorld

An interactive tiled world where friends contribute NPC characters with birthday
messages, and the birthday person explores the world talking to them.

Built with **Phaser 3** (frontend) and **Node + Express + better-sqlite3** (backend).
No build step, no bundler — Phaser is loaded via CDN.

## Run it

```bash
npm install
npm start          # or: npm run dev  (auto-restart)
```

Then open <http://localhost:3000/create>.

## The loop

1. **Create** (`/create`) — enter the birthday person's name and date. You get two
   shareable links: a **contributor** link and an **explorer** link.
2. **Contribute** (`/contribute/:worldId`) — friends pick an emoji character, a zone
   theme, a name, a greeting, and up to 3 dialogue lines. Each submission is placed at
   the next free coordinate, spiralling outward from the hub.
3. **Explore** (`/explore/:worldId`) — the birthday person walks a Phaser world
   (WASD / arrow keys, or a touch joystick on mobile), walks up to each friend's NPC,
   and presses **E** (or taps) to read their message with a typewriter dialogue box.

## API

| Method | Route                     | Purpose                          |
| ------ | ------------------------- | -------------------------------- |
| POST   | `/worlds`                 | Create a world → `{ id }`        |
| GET    | `/worlds/:id`             | World metadata                   |
| GET    | `/worlds/:id/chunks`      | All chunks (JSON)                |
| POST   | `/worlds/:id/chunks`      | Submit a new chunk               |

SQLite data lives in `birthdayworld.db` (created automatically; git-ignored).

## Structure

```
server/index.js     Express app, SQLite setup, routes, spiral coordinate allocation
public/index.html   Create screen
public/contribute.html  Contributor form
public/explore.html Phaser game shell (Phaser via CDN)
public/explore.js   Phaser scene: world rendering, player, NPCs, dialogue
```
