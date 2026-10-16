# Shredline

A 3D snowboard park game that runs in the browser. Inspired by Cork7, rebuilt
from scratch for snowboarding only, with a lot more in it.

**Play:** open `index.html` in any modern browser (double-click works, no
server or install needed). It also runs on phones and tablets with touch
controls, and with a gamepad.

## What's in it

- **Shredline Mountain:** 1.7 km of park in one run. Warm-up rollers, a jib
  garden (down rail, flat-down-flat, rainbow rail, kinked rail, long box,
  butter box, gap rail), a jump line with S/M/L/XL kickers, a 180 m superpipe,
  backcountry cliffs and tree islands, a 21 m Big Air jump and a finish area
  with the lodge and a working chairlift.
- **Real snowboard tricks:** frontside/backside spins from 180 to 1800, Cab
  and Half Cab, Switch Backside, corks, rodeos and mistys (Double, Triple),
  backflips and frontflips, McTwist and Crippler in the pipe, eight grabs
  (Indy, Melon, Mute, Method, Stalefish, Japan, Nose, Tail) with tweaks,
  50-50s, boardslides, nose and tail presses, butters and cliff drops.
- **Scoring like Cork7, plus combos:** 500 × turns² for spins and flips,
  off-axis ×1.3, multiple grabs multiply. Chain tricks before the combo timer
  runs out to multiply the whole line. Repeating the same trick scores less.
- **Modes:** Free Ride, Slopestyle (timed judged run with a ghost of your best
  run), Big Air (best two of three jumps) and Superpipe (best of two runs).
  Bronze, silver and gold medals.
- **26 challenges** rated like trail signs (green circle to double black
  diamond), S-H-R-E-D letters and 20 hidden snowflakes to find. Challenges
  unlock board graphics and jacket colours.
- **Rider customisation:** name, regular or goofy stance, helmet or beanie,
  jacket, pants, helmet, glove and goggle-lens colours, seven board designs.
- **Trick Book** of everything you've landed, with your best score for each.
- **Replays:** instant replay of the last 15 seconds and full-run replays with
  cinematic cameras and slow motion.
- **Three times of day:** Bluebird, Golden Hour and a floodlit Night Session,
  plus light snow or a storm.
- **Sound:** carve, wind, rail scrape, pops, landings and a chill music loop,
  all synthesised in the browser.
- **Online (when shared as a claude.ai page):** see other riders live on the
  mountain with name tags, and a shared leaderboard.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Carve / spin / balance on rails | A, D | Left stick |
| Tuck (and push on flats) / frontflip | W | Left stick up |
| Brake / backflip | S | Left stick down |
| Ollie (hold to load, release to pop) | Space | A |
| Grabs | Arrow keys or I, J, K, L | Right stick |
| Tweak the grab | Shift | RB / RT |
| Reset to safe spot | R | Y |
| Camera | C | View |
| Instant replay | V | X |
| Teleport (Free Ride) | M | |
| Pause | Esc or P | Menu |

Tips: pop right at the lip of a kicker for extra height, and hold A or D
while loading an ollie to pre-wind your spin. Land with the board lined up,
nose or tail first.

## Development

```bash
npm install
npm run build   # writes index.html (self-contained) and dist/shredline.html
npm test        # headless physics checks
```

Source lives in `src/`:

- `world/` terrain, park features, rails, decor, sky and lighting
- `rider/` snowboard physics (`rider.js`), the rider model (`model.js`), the board (`board.js`)
- `tricks.js` trick naming, scoring and combos
- `modes.js`, `challenges.js`, `replay.js`, `save.js`, `online.js`
- `camera.js`, `fx.js`, `audio.js`, `input.js`, `ui.js`, `main.js`
- `page.html` the page shell and styles

Built with [three.js](https://threejs.org/) r149 and bundled with esbuild.
