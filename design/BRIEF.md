# Design brief: pixel-art concept images for "Sprite Stack Fighter"

You are the concept artist. Produce reference IMAGES (PNG) only. Do NOT edit fighter.html or any code.
Save everything into F:\AI_Project_Pill\Project_fighter\design\ . Use your built-in image generation tool.
If you truly cannot generate images in this session, say so in worker_done as a failure instead of substituting SVG/ASCII/code drawings.

## Context
Browser toy: a jet fighter flies over tropical islands. Everything is rendered by SPRITE STACKING
(2D cross-section slices stacked 1px apart), Canvas 2D, no 3D engine. Current look: see
screenshots\1_top.png, 2_chase.png, 6_combat_cockpit.png (current internal res 320x180 - too coarse and flat).
We are raising the internal resolution to 640x360..960x540 and re-drawing every sprite procedurally in code,
using your images as the art target. Reference for mood: remix.ui8.ai/fly ("fighter" demo by UI8).
Look: bright clear midday, saturated turquoise sea, lush green islands, white cumulus. NOT dark, NOT gritty.
Style: crisp detailed pixel art (16-bit / modern indie, think high-res Metal Slug / Sky Force quality shading),
hard pixels, no blur, no anti-aliased gradients, limited palette per object, light from upper-left.

## Images to make (one PNG each, plain flat background so shapes are easy to read)
1. player_jet_orthos.png  - player fighter (light grey, red accents, blue canopy; F-16/F-18 class): strict orthographic
   TOP view, SIDE view, FRONT view, and BOTTOM view on one sheet, same scale, ~128 px long. Show panel lines, intakes,
   canopy frame, wing pylons/missiles, twin or single tail, exhaust nozzle, roundel/markings.
2. enemy_jet_orthos.png   - enemy fighter, clearly different silhouette (e.g. Su-27/MiG-29 class, twin tails, dark grey
   + orange markings, amber canopy), same four orthographic views and scale.
3. jet_slices.png         - for the player jet: 12-16 horizontal cross-section slices (bottom to top) laid out in a grid,
   as used for sprite stacking, each slice top-down, labelled by index.
4. island_topdown.png     - top-down tropical island chunk ~512x512: deep sea -> mid -> shallow turquoise -> foam ->
   wet sand -> dry sand -> grass -> dense forest canopy -> rocky cliffs -> pale peak. Show cliff side-faces shaded darker,
   tree canopies with highlights/shadows, rocks, small details (palms, reef patches, a pier or huts optional).
5. island_oblique.png     - same island seen in a tilted 3/4 chase-cam view, showing how stacked layers read as height.
6. sea_tiles.png          - sea surface detail: wave glints, foam bands along shore, reef/depth colour steps, 3 animation frames.
7. clouds.png             - 4 cumulus cloud sprites top-down + the same from the side, with shaded undersides.
8. fx_sheet.png           - explosion (8 frames), missile + smoke trail, tracer rounds, afterburner flame (4 frames),
   wingtip contrail, water spray, muzzle flash.
9. cockpit_hud.png        - first-person cockpit frame at 16:9: canopy bow, glareshield, instrument panel with MFDs,
   green HUD combiner glass with pitch ladder, heading tape, speed/alt boxes, gun reticle, lock box, radar scope.
10. mock_top.png, mock_chase.png, mock_cockpit.png - full 16:9 mock screenshots of the finished game in the three camera
   modes (top-down / chase behind / cockpit) with an enemy on screen, tracers, an explosion, HUD text.

Also write design\NOTES.md: for each image, the exact hex palette you intended (5-10 colours per material) and any
proportions worth copying (jet length:wingspan, canopy position, etc.).

## Done when
All listed PNGs exist in design\ and open as valid images; NOTES.md exists. Report the file list with pixel sizes.
A missing image is a partial failure - report exactly which ones are missing and why.
