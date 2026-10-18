# Vroom City

A simple blocky 3D driving game for small kids. Drive a car around a little town, switch to a helicopter to fly over the mountains, and collect stars. No crashing, no game over.

It's a single HTML file using plain WebGL — no build step, no dependencies, works offline.

## Play

```
./play.sh
```

or open `vroom-city.html` in Chrome.

## Controls

| Key | Car | Helicopter |
| --- | --- | --- |
| Arrow keys | Drive | Fly forward/back, turn |
| WASD | Drive | A/D turn, W up, S down |
| Space | Horn | Go up |
| Shift | — | Go down |
| H or Enter | Switch to helicopter | Land as the car |
| M | Sound on/off | Sound on/off |

## Checks (development only)

The game needs nothing installed. For the checks, with Node 24: `npm ci`, `npx playwright install chromium`, then `npm run lint` and `npm test`.
