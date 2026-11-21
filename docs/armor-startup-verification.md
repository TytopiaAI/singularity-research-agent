# Red / gold MK3 startup — 2026-10-21

The two user-supplied film frames informed the helmet, rounded reactor, shoulder plates and red/gold palette. The rendered artwork is hand-drawn SVG geometry with procedural Canvas particles; no film screenshots, remote assets, videos, audio or models are loaded by the application.

## Behaviour

- Fourth startup style `armor`, selected once per renderer launch with 70% probability; planets, Willow and Sail each have 10% probability.
- Dark opening, reactor ignition, converging particles, progressive panel outlines, shaded surfaces, eye illumination and a completed breathing armor contour.
- A ready backend and completed 5.2-second reveal trigger a 480ms fade. If the backend is slower, the completed suit remains visible. The user can enter early once the backend is ready; startup failures immediately show the application's error view.
- Reduced motion immediately displays the finished illustration, stops particle animation, and avoids the cinematic delay. Background rendering is paused when hidden; canvas density is capped at 2× and active rendering at approximately 30fps. Resize and animation listeners are removed on unmount.
- Native assistant visibility remains tied to startup completion, so it cannot cover the fade with a separate native view.

## Verification

- TypeScript check and eight targeted tests passed (startup timing, slow backend, ready-only skipping, errors, reduced motion, other styles and sidebar behaviour).
- Electron verification: `.local-data/startup-splash-verification/1792559908536/report.json`. All four styles ran offline; all window actions and cleanup passed. Armor snapshots cover ignition/reveal/complete, 1000×720, 1920×1080, 800×600 and reduced motion. Original watercolor graphics fallback was also verified.
- A standalone replayable preview is generated at `.local-data/armor-preview/index.html` using production artwork and CSS. The separately sampled video is 1280×800, 30fps, seven seconds: `.local-data/armor-preview/armor-startup.mp4`. FFprobe and a storyboard confirmed duration and progression.
- Development build only; no installer or installed desktop files changed.

Recreate the preview with Electron running `scripts/preview-armor.cjs`. Recheck startup artwork with Electron running `scripts/verify-startup-splash.cjs`.

## MK3 contour revision

- Used the additional suit-up recording to refine the continuous faceplate, narrow eye apertures, rounded shoulder pods, connected breastplate and red forearm shells. Replaced fragmented chest panels with a single silhouette; the artwork now has 32 panels.
- Reduced surface opacity to emphasize red/gold contours. Helmet tracing and eye ignition occur later than chest activation.
- TypeScript passed. Electron report `.local-data/startup-splash-verification/1792572750350/report.json` passed all four startup variants, viewport sizing, reduced motion, cleanup and offline checks without errors.
- Regenerated the standalone preview and seven-second video. No packaging or installation.


## Reference-matched faceplate and suit revision

- Rebuilt the mask from the supplied `Screenshot 2026-10-21 130337.png`: continuous forehead/midface, crown recess, separate dark eye housings, narrower light apertures, wider mouth cutout and a distinct gold jaw plate. Removed the invented nose and cheek polygons. Secondary temple outlines and cheek creases are dimmer than the main face contour.
- Reworked the chest into a downward-tapering shield with a circular reactor, added collar fasteners and neck linkages, reduced the abdominal width, reshaped forearm ridges, and added a subdued torso understructure to connect the separate shells.
- The offline preview script now also exports `armor-helmet.png`; `--still` produces quick final/detail snapshots for geometry review.
- TypeScript and the development build passed; Vite retains its existing large-chunk advisory. Electron report `.local-data/startup-splash-verification/1792580943248/report.json` passed all four styles, eye illumination, particle drawing, three viewport sizes, reduced motion, offline execution and cleanup, with no renderer errors.
- Regenerated the seven-second 1280×800/30 fps preview. No installer or installed application was updated.

## Latest two-reference revision

The user's replacement references supersede the earlier MK3 film frames. Helmet paths now follow the wide V crown, continuous gold mask, nearly flat mouth seam, gold jaw surround and independent red chin of `codex-clipboard-452a4973-69ef-43ad-8d7d-e3a422c8a94b.png`. Torso paths follow the turned body, raised left forearm, layered shoulder armor and diagonal rib plates of `codex-clipboard-d2ebf00e-b668-46a8-9734-b6b7b5118644.png`.

The reactor is now a tapered polygon at the reference chest location; its halo and scan pulse share that center. Captions use ARMOR rather than the earlier MK3 designation. Geometry is authored in reference-space coordinates and transformed into the common SVG/particle coordinate system. No source photograph is loaded by the application.

TypeScript and the development build passed. Electron report `.local-data/startup-splash-verification/1792581716648/report.json` passed the four startup styles, contour validity, eye illumination, particle drawing, three viewport sizes, reduced motion, cleanup and offline behavior. Regenerated the local seven-second video, overall still and helmet detail. No packaging or installation.

## Additive gauntlet detail

- Added two clenched gauntlets with finger segments, thumb plates, knuckle caps and wrist/heel connections. New hand backing surfaces cover the earlier hand stubs without removing their geometry.
- Compared against `.local-data/armor-before-hands.ts`: all 49 existing panels, materials and delays are identical, as are the existing seams, eyes, eye sockets and reactor. Only 19 hand panels were added to the geometry.
- Expanded the SVG mask and particle drawing margins sideways to display the right fist beyond the former crop. Narrow-window layout now reserves sufficient side space without changing armor coordinates.
- TypeScript and development build passed. Electron report `.local-data/startup-splash-verification/1792589928210/report.json` passed all startup variants, offline/cleanup and reduced-motion checks. Both hand silhouettes were verified fully inside the window at 1000×720, 1920×1080, 800×600 and 640×760.
- Regenerated the seven-second 1280×800/30 fps video and replayable preview. No packaging or installation.

## Additive rear armor accessories

- Added separate rear-layer panels for the reference's upper shoulder blade, lower side brace and long lower blade, with internal rib/strut lines and hinge details. All use the existing red/gold artwork styles and reveal timing.
- Foreground occlusion uses the original suit silhouettes, so rear roots and their settled particles remain behind the body and gauntlets.
- `.local-data/verify-back-additions.ts` compared against the pre-change geometry: all 68 existing armor/hand panels and all existing seams, eyes and reactor definitions are identical. Added 12 independent rear panels and four rear seam paths.
- TypeScript and development build passed. Electron report `.local-data/startup-splash-verification/1792590829641/report.json` passed all four styles, rear-layer order/occlusion, four viewport sizes with hands and rear armor inside the window, reduced motion, offline rendering and cleanup. No renderer errors.
- Regenerated the seven-second video and replayable preview. No packaging or installation.
