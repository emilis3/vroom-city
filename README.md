# Vroom City

A simple blocky 3D driving game for small kids. Drive a car around a little town, drive into the lake to sail an Italian speedboat, switch to a helicopter to fly over the mountains, and collect stars. No crashing, no game over.

It's a single HTML file using plain WebGL — no build step, no dependencies, works offline.

## Play

```
./play.sh
```

or open `vroom-city.html` in Chrome.

## Controls

| Key | Car | Boat | Helicopter |
| --- | --- | --- | --- |
| Arrow keys | Drive | Steer | Fly forward/back, turn |
| WASD | Drive | Steer | A/D turn, W up, S down |
| Space | Horn | Toot toot | Go up |
| Shift | — | — | Go down |
| H or Enter | Switch to helicopter | Switch to helicopter | Land (as the boat over water, else the car) |
| M | Sound on/off | Sound on/off | Sound on/off |

The car turns into the boat when it drives into the lake or the river, and back into the car on land.

## Checks (development only)

The game needs nothing installed. For the checks, with Node 24: `npm ci`, `npx playwright install chromium`, then `npm run lint` and `npm test`.
