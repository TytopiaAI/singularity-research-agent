# Willow and Sail startup artwork

`willow.js` and `sail.js` adapt the complete Willow and Sail engines pasted by the user from
https://painterly.design-tools.workers.dev/. They preserve the palette, seed,
watercolor brushes, willow/lily and sea/sail compositions, and adapt the canvas
to the app window. The bounded rendering resolution avoids allocating three
full desktop resolution WebGL surfaces on high DPI displays.

The renderer chooses between Willow, Sail and the existing planets with equal
probability (one third each) once at module load. The isolated painting frame is
unmounted as soon as the existing startup
process becomes ready or fails; loading time is not extended for the artwork.
Graphics errors fall back to the existing planets. No CDN or network access is
needed at startup.

Local dependencies:

- p5.js 2.3.3: https://cdn.jsdelivr.net/npm/p5@2.3.3/lib/p5.min.js
  (LGPL-2.1; license in `vendor/p5-LICENSE.txt`).
- p5.brush 2.2.2: https://cdn.jsdelivr.net/npm/p5.brush@2.2.2
  (MIT; license in `vendor/p5.brush-LICENSE.txt`).
