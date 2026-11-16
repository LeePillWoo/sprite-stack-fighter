# Sprite Stack Fighter — concept art notes

Generated with the built-in image_gen tool on 2026-11-16. All twelve deliverables are PNG reference illustrations; no game code was edited. PNG headers and decoding were checked using System.Drawing, and generated artwork was visually inspected.

## Palette convention

The hex ramps below are the exact intended palettes supplied to generation, listed dark to light, with 5-6 colors per material. Generated RGB pixels are not guaranteed to equal these ramps: use the listed hex values as the authoritative palette for procedural redraws. No palette quantization, resizing, or code-drawn replacement was performed. Flat backgrounds are presentation grounds, not sprite materials.

Upper-left light is shared across assets. Use discrete shade bands and nearest-neighbor display at the implementation's chosen logical resolution. Preserve silhouette and shading hierarchy before micro-detail.

## Output manifest

| File | Native pixels |
|---|---|
| player_jet_orthos.png | 1254 × 1254 |
| enemy_jet_orthos.png | 1254 × 1254 |
| jet_slices.png | 1254 × 1254 |
| island_topdown.png | 1254 × 1254 |
| island_oblique.png | 1536 × 1024 |
| sea_tiles.png | 1536 × 1024 |
| clouds.png | 1536 × 1024 |
| fx_sheet.png | 1536 × 1024 |
| cockpit_hud.png | 1672 × 941 |
| mock_top.png | 1672 × 941 |
| mock_chase.png | 1672 × 941 |
| mock_cockpit.png | 1672 × 941 |

The generator returned 1672×941 for requested 16:9 compositions (ratio 1.77683, within 0.06% of 16:9). These native originals are preserved. The square island is a larger presentation reference for the approximately 512×512 logical target, and the jets are enlarged presentations of the approximately 128px logical target.

## player_jet_orthos.png

Target logical jet length 128 px and span about 85 px (1.5:1); canopy center at 28% of length behind nose, canopy length about 23%; wing broadest near 65% of length. Single tail, four underwing missiles, one exhaust. Sheet layout: TOP upper-left, SIDE upper-right, FRONT lower-left, BOTTOM lower-right. Treat generated views as drawing references; align and normalize their scale when constructing slices.

Intended material palettes:

- **Player metal**: #303D50, #53647A, #8193A5, #ABBCCA, #D4E0E8, #F4FAFC.
- **Red paint**: #701D32, #AC2940, #E7474B, #FF7970, #FFD0B0.
- **Blue glass**: #12394E, #126885, #209DB8, #5DD5E5, #C0F6FA.

## enemy_jet_orthos.png

Target logical length 128 px and span about 91 px (1.4:1); canopy center 30% behind nose. Twin fins and paired exhausts; broad wing roots distinguish it from player. Same four-view arrangement as player.

Intended material palettes:

- **Enemy metal**: #202936, #344151, #4A5C6B, #6F8390, #A5B4BA.
- **Orange / amber**: #71351C, #B65422, #ED812F, #FFB64B, #FFE18A.

## jet_slices.png

Sixteen horizontal sections labeled 00-15. Read left-to-right within each row, starting at BOTTOM row 00-03, then 04-07, 08-11, TOP row 12-15. Intended stack spacing 1 logical pixel. Broad wings around 03-05, shoulders 06-08, canopy 09-11, fin-only 12-15. Use a shared origin and consistent 128 px jet length when redrawing; generated cells are conceptual, not registered production masks.

Intended material palettes:

- **Player metal**: #303D50, #53647A, #8193A5, #ABBCCA, #D4E0E8, #F4FAFC.
- **Red paint**: #701D32, #AC2940, #E7474B, #FF7970, #FFD0B0.
- **Blue glass**: #12394E, #126885, #209DB8, #5DD5E5, #C0F6FA.

## island_topdown.png

Target logical chunk about 512x512. Crescent coast opens right/lower-right; peak upper-left, forest central ridge, pier at lower inner beach. Reef/shallow band about 4-8% of island width; dry beach about 2-4%. Corrected from initial oblique generation to overhead crowns and roof tops. Keep upper-left highlights and darker contour sides.

Intended material palettes:

- **Sea**: #07577F, #087AA0, #109DB9, #20C6CD, #67E3D8, #B7F5E9.
- **Sand / wood**: #92734B, #B59B64, #D5BD7D, #EFDAA1, #FFF0C1.
- **Vegetation / reef**: #164F42, #226C42, #348D45, #60AC48, #91CF5A, #C9EA89.
- **Rock**: #424F58, #667471, #8E9890, #BAC0AA, #E4E6CA.
- **Cloud / foam / smoke**: #607F9E, #88A7BF, #B5CCD9, #DAE9ED, #F8FFFF.

## island_oblique.png

Same crescent island and landmark arrangement at oblique angle. Explicit stepped cliff shelves, forest crowns above grass, pale peak above forest. Translate height into 1px stacked slices; illustrative perspective is a reference, not a calibrated projection of the overhead sheet.

Intended material palettes:

- **Sea**: #07577F, #087AA0, #109DB9, #20C6CD, #67E3D8, #B7F5E9.
- **Sand / wood**: #92734B, #B59B64, #D5BD7D, #EFDAA1, #FFF0C1.
- **Vegetation / reef**: #164F42, #226C42, #348D45, #60AC48, #91CF5A, #C9EA89.
- **Rock**: #424F58, #667471, #8E9890, #BAC0AA, #E4E6CA.
- **Cloud / foam / smoke**: #607F9E, #88A7BF, #B5CCD9, #DAE9ED, #F8FFFF.

## sea_tiles.png

Three columns are animation frames 01-03; rows GLINTS, SHORE, REEF. Keep terrain/depth masks fixed and shift foam/glints by 1-2 logical pixels; target 6-8 fps. These are concept panels, not verified seamless runtime tiles.

Intended material palettes:

- **Sea**: #07577F, #087AA0, #109DB9, #20C6CD, #67E3D8, #B7F5E9.
- **Sand / wood**: #92734B, #B59B64, #D5BD7D, #EFDAA1, #FFF0C1.
- **Vegetation / reef**: #164F42, #226C42, #348D45, #60AC48, #91CF5A, #C9EA89.
- **Rock**: #424F58, #667471, #8E9890, #BAC0AA, #E4E6CA.
- **Cloud / foam / smoke**: #607F9E, #88A7BF, #B5CCD9, #DAE9ED, #F8FFFF.

## clouds.png

Four cloud designs in top row, matching side profiles below; vary small to large. Side cloud height about 35-55% of width. Upper-left white clusters and darker blue undersides. No alpha expected: flat teal background follows brief.

Intended material palettes:

- **Cloud / foam / smoke**: #607F9E, #88A7BF, #B5CCD9, #DAE9ED, #F8FFFF.

## fx_sheet.png

Eight explosion frames 01-08 across upper row, four afterburner frames 01-04 in next row left, missile/smoke right, tracers/contrail/spray/muzzle below. Explosion max radius about 1.5 jet spans; afterburner length 15-35% of jet length. Recommended explosion 12-16 fps, flame 12 fps. Generator added decorative reference/footer elements; requested effects are separated above.

Intended material palettes:

- **Player metal**: #303D50, #53647A, #8193A5, #ABBCCA, #D4E0E8, #F4FAFC.
- **Red paint**: #701D32, #AC2940, #E7474B, #FF7970, #FFD0B0.
- **Blue glass**: #12394E, #126885, #209DB8, #5DD5E5, #C0F6FA.
- **Enemy metal**: #202936, #344151, #4A5C6B, #6F8390, #A5B4BA.
- **Cloud / foam / smoke**: #607F9E, #88A7BF, #B5CCD9, #DAE9ED, #F8FFFF.
- **Fire / tracers**: #8D2830, #D94926, #F67C28, #FFBD45, #FFF196, #FFFFFF.

## cockpit_hud.png

Near-16:9 native output. Canopy arch at top/edges; glareshield starts around 60% screen height, twin MFDs below. HUD centered, speed left and altitude right, heading above and gun reticle center. Use green HUD at restrained alpha in the implementation; the PNG is a flat reference.

Intended material palettes:

- **Player metal**: #303D50, #53647A, #8193A5, #ABBCCA, #D4E0E8, #F4FAFC.
- **Red paint**: #701D32, #AC2940, #E7474B, #FF7970, #FFD0B0.
- **Blue glass**: #12394E, #126885, #209DB8, #5DD5E5, #C0F6FA.
- **Cockpit**: #142B36, #25414A, #42606A, #6A8790, #A7C5C9.
- **HUD**: #165C48, #26875A, #4BC778, #8BF2A2, #D3FFD4.

## mock_top.png

Near-16:9 native output. Overhead combat composition with player lower-middle, enemy upper-right, island right, radar lower-left. Generated player occupies roughly 30% screen height; implementation target is 14-20% for more tactical visibility. The image is an art target, not a scale mandate.

Intended material palettes:

- **Player metal**: #303D50, #53647A, #8193A5, #ABBCCA, #D4E0E8, #F4FAFC.
- **Red paint**: #701D32, #AC2940, #E7474B, #FF7970, #FFD0B0.
- **Blue glass**: #12394E, #126885, #209DB8, #5DD5E5, #C0F6FA.
- **Enemy metal**: #202936, #344151, #4A5C6B, #6F8390, #A5B4BA.
- **Orange / amber**: #71351C, #B65422, #ED812F, #FFB64B, #FFE18A.
- **Sea**: #07577F, #087AA0, #109DB9, #20C6CD, #67E3D8, #B7F5E9.
- **Sand / wood**: #92734B, #B59B64, #D5BD7D, #EFDAA1, #FFF0C1.
- **Vegetation / reef**: #164F42, #226C42, #348D45, #60AC48, #91CF5A, #C9EA89.
- **Rock**: #424F58, #667471, #8E9890, #BAC0AA, #E4E6CA.
- **Cloud / foam / smoke**: #607F9E, #88A7BF, #B5CCD9, #DAE9ED, #F8FFFF.
- **Fire / tracers**: #8D2830, #D94926, #F67C28, #FFBD45, #FFF196, #FFFFFF.
- **Cockpit**: #142B36, #25414A, #42606A, #6A8790, #A7C5C9.
- **HUD**: #165C48, #26875A, #4BC778, #8BF2A2, #D3FFD4.

## mock_chase.png

Near-16:9 native output. Player below center, enemy near upper-center, low horizon and island cliffs forward. Generated player spans roughly 47% screen width; implementation target can be 22-30% to preserve forward visibility. Lock box and trails establish depth.

Intended material palettes:

- **Player metal**: #303D50, #53647A, #8193A5, #ABBCCA, #D4E0E8, #F4FAFC.
- **Red paint**: #701D32, #AC2940, #E7474B, #FF7970, #FFD0B0.
- **Blue glass**: #12394E, #126885, #209DB8, #5DD5E5, #C0F6FA.
- **Enemy metal**: #202936, #344151, #4A5C6B, #6F8390, #A5B4BA.
- **Orange / amber**: #71351C, #B65422, #ED812F, #FFB64B, #FFE18A.
- **Sea**: #07577F, #087AA0, #109DB9, #20C6CD, #67E3D8, #B7F5E9.
- **Sand / wood**: #92734B, #B59B64, #D5BD7D, #EFDAA1, #FFF0C1.
- **Vegetation / reef**: #164F42, #226C42, #348D45, #60AC48, #91CF5A, #C9EA89.
- **Rock**: #424F58, #667471, #8E9890, #BAC0AA, #E4E6CA.
- **Cloud / foam / smoke**: #607F9E, #88A7BF, #B5CCD9, #DAE9ED, #F8FFFF.
- **Fire / tracers**: #8D2830, #D94926, #F67C28, #FFBD45, #FFF196, #FFFFFF.
- **Cockpit**: #142B36, #25414A, #42606A, #6A8790, #A7C5C9.
- **HUD**: #165C48, #26875A, #4BC778, #8BF2A2, #D3FFD4.

## mock_cockpit.png

Near-16:9 native output. Same canopy/HUD vocabulary as cockpit sheet; enemy centered through combiner, explosion right, radar left MFD. Keep middle 50% screen width readable and free of opaque panels above glareshield.

Intended material palettes:

- **Player metal**: #303D50, #53647A, #8193A5, #ABBCCA, #D4E0E8, #F4FAFC.
- **Red paint**: #701D32, #AC2940, #E7474B, #FF7970, #FFD0B0.
- **Blue glass**: #12394E, #126885, #209DB8, #5DD5E5, #C0F6FA.
- **Enemy metal**: #202936, #344151, #4A5C6B, #6F8390, #A5B4BA.
- **Orange / amber**: #71351C, #B65422, #ED812F, #FFB64B, #FFE18A.
- **Sea**: #07577F, #087AA0, #109DB9, #20C6CD, #67E3D8, #B7F5E9.
- **Sand / wood**: #92734B, #B59B64, #D5BD7D, #EFDAA1, #FFF0C1.
- **Vegetation / reef**: #164F42, #226C42, #348D45, #60AC48, #91CF5A, #C9EA89.
- **Rock**: #424F58, #667471, #8E9890, #BAC0AA, #E4E6CA.
- **Cloud / foam / smoke**: #607F9E, #88A7BF, #B5CCD9, #DAE9ED, #F8FFFF.
- **Fire / tracers**: #8D2830, #D94926, #F67C28, #FFBD45, #FFF196, #FFFFFF.
- **Cockpit**: #142B36, #25414A, #42606A, #6A8790, #A7C5C9.
- **HUD**: #165C48, #26875A, #4BC778, #8BF2A2, #D3FFD4.

## Prompt record

Each initial call used this shared prefix:

> Use case: stylized-concept. Reference PNG for Sprite Stack Fighter, a Canvas 2D sprite stacking tropical air combat game. Crisp detailed pixel art, high resolution 16-bit modern indie quality, deliberate hard square pixels, no blur, no anti-aliased gradients, no photographic or smooth 3D rendering. Bright clear midday, saturated colors, light from upper left, readable silhouettes and discrete limited-color shading. 

Every call also appended this shared exact palette instruction:

> Exact intended material palette ramps: player metal #303D50 #53647A #8193A5 #ABBCCA #D4E0E8 #F4FAFC; red #701D32 #AC2940 #E7474B #FF7970 #FFD0B0; blue glass #12394E #126885 #209DB8 #5DD5E5 #C0F6FA; enemy metal #202936 #344151 #4A5C6B #6F8390 #A5B4BA; orange #71351C #B65422 #ED812F #FFB64B #FFE18A; sea #07577F #087AA0 #109DB9 #20C6CD #67E3D8 #B7F5E9; sand #92734B #B59B64 #D5BD7D #EFDAA1 #FFF0C1; vegetation #164F42 #226C42 #348D45 #60AC48 #91CF5A #C9EA89; rock #424F58 #667471 #8E9890 #BAC0AA #E4E6CA; cloud #607F9E #88A7BF #B5CCD9 #DAE9ED #F8FFFF; fire #8D2830 #D94926 #F67C28 #FFBD45 #FFF196 #FFFFFF; cockpit #142B36 #25414A #42606A #6A8790 #A7C5C9; HUD #165C48 #26875A #4BC778 #8BF2A2 #D3FFD4.

### player_jet_orthos.png

Square 1024x1024 orthographic sprite reference sheet on flat pale blue-grey background. Four strict orthographic views TOP SIDE FRONT BOTTOM in a 2x2 layout, aligned and consistent scale. A single light grey F-16/F-18-class player jet with single tail, red wing tips and tail accents, blue canopy, single exhaust, panel lines, canopy frame, intakes, two missiles under each wing, small roundels. Length:wingspan 1.5:1, canopy centered 28 percent behind nose. Each top/side/bottom represents approximately 128 logical pixels long enlarged with hard pixels. No perspective. Labels TOP SIDE FRONT BOTTOM. No additional views.

### enemy_jet_orthos.png

Square 1024x1024 sheet on flat pale blue-grey background: four strict orthographic views TOP SIDE FRONT BOTTOM in a 2x2 layout, same scale. Enemy fighter clearly Su-27/MiG-29-class: broad blended wing roots, twin engines, twin outward tails, long pointed nose, dark grey body, orange tips and fin markings, amber canopy; detailed panels, pylons/missiles, intakes and two exhausts. Length:wingspan 1.4:1, canopy 30 percent behind nose. Approximately 128 logical pixels length enlarged in hard pixels. No perspective. Labels TOP SIDE FRONT BOTTOM.

### jet_slices.png

Square 1024x1024 technical pixel-art sheet on flat pale blue-grey: EXACTLY 16 isolated HORIZONTAL CROSS SECTION masks of the same single-tail light grey red-accent blue-canopy player jet, laid in a 4x4 grid labeled 00 through 15 row-major, bottom to top. Every slice viewed strictly top-down, nose up, identical coordinate origin and scale, never side view, never complete jet repeated. Show physically plausible successive filled planar sections: 00 narrow belly, 01 lower fuselage/intakes, 02 belly missiles and pylons, 03 broad low wing plane, 04 broad main swept wing/body, 05 upper wing/fuselage, 06 narrower upper body, 07 shoulders, 08 canopy base, 09 canopy glass plus aft fin base, 10 narrow canopy/fin, 11 canopy crown/fin, 12 only aft fin, 13 shorter fin strip, 14 smaller fin strip, 15 tiny tail-fin top strip. Grey metal/red accent/blue glass, no exploded perspective. Each grid cell same size. Clear sectional progression essential.

### island_topdown.png

Square 1024x1024 top-down tropical island chunk designed on approximately 512x512 logical pixel grid. Single recognizable crescent/hook island curving around a lagoon opening toward lower-right, pale rocky peak upper-left of center, dense forest central ridge, small pier on inner lower shore. Orthographic top-down only. Flat deep blue sea surrounds entire island without horizon. Clearly separated deep sea > mid blue > shallow turquoise > reef patches > white broken foam > wet sand > dry sand > grass > dense highlighted forest canopy > dark rocky cliff side faces > pale peak. Individual palm crowns, rocks, tiny huts beside pier. Bright lush inviting. No text.

### island_oblique.png

Landscape 1536x1024 tilted 3/4 chase-cam concept of the same crescent/hook tropical island: lagoon mouth lower-right, pale rocky peak upper-left of center, dense forest central ridge, small pier on inner lower shore with tiny huts. All isolated in flat deep blue sea, no sky horizon, no text. Emphasize visibly stepped stacked horizontal elevation bands, 1-pixel-layer sprite-stack interpretation, dark lower-right cliff side faces, bright upper-left tops, tree canopy height, reef color steps, foam, wet and dry beaches. Maintain detailed hard-edged pixel art, no smooth 3D.

The initial island image was supplied as a visual reference for consistent coastline and landmarks.

### sea_tiles.png

Landscape 1536x1024 pixel art sea animation reference sheet on plain pale blue-grey. Three equal aligned columns labeled 01 02 03, three rows labeled GLINTS SHORE REEF. Each row is the SAME seamless square tile across three successive animation frames, unchanged geometry, only glints and foam shift. GLINTS: deep cyan water with sparse white turquoise wave glints. SHORE: diagonal sandy edge and stepped turquoise water with broken foam bands advancing. REEF: deep-to-shallow discrete color steps and underwater reef shapes, small shifting surface ripples. Nine clean bordered tiles; no perspective; no smooth gradients.

### clouds.png

Landscape 1536x1024 sprite sheet on uniform medium teal-blue flat background: EXACTLY four distinct white cumulus cloud designs across top row in strict TOP-DOWN view, and the SAME FOUR matched clouds directly underneath in strict SIDE view, eight sprites total. Labels TOP and SIDE only. Each cloud readable separate silhouette, from small 3-lobe puff through long 7-lobe cluster. Bright upper-left ivory white highlights, pale blue midtones, stepped blue-grey shaded undersides and lower-right shadows. Crisp hard pixel clusters, no blur, no transparent glow.

### fx_sheet.png

Landscape 1536x1024 organized pixel-art VFX sprite sheet on flat muted deep teal background, generously separated elements. Row 1 EXACTLY eight explosion frames numbered 01-08: tiny spark, expanding bright fireball, large orange blast, lobed orange blast, dark smoke eruption, fading smoke, diffuse pixel fragments, tiny residual sparks. Row 2 exactly four afterburner flame frames numbered 01-04, luminous blue core and orange tip, and one detailed missile plus segmented smoke trail. Row 3 separate tracer rounds, curved wingtip contrail, water spray burst, three-point muzzle flash, with short labels. Hard pixels, discrete palette bands, no soft glow, no blur. Every requested effect clearly readable.

### cockpit_hud.png

Wide exact 16:9 1536x864 pixel-art first-person cockpit frame and HUD reference on flat pale cyan exterior background. Canopy bow across top and side rails, glareshield across lower third, instrument panel and two MFDs below, visible green tinted transparent HUD combiner at center. HUD includes pitch ladder, heading tape 270 280 290, left SPD 420 box, right ALT 1250 box, centered gun reticle, offset enemy lock box, radar scope on left MFD, engine/fuel on right MFD. Symmetric clean aviation geometry, readable pixel text, restrained green HUD, preserve clear outside field of view. Upper-left lighting and detailed hard-pixel metal edges; no landscape in this reference.

### mock_top.png

Wide exact 16:9 1536x864 full finished-game screenshot concept TOP-DOWN camera. Bright saturated turquoise sea and crescent/hook tropical island lagoon lower-right, pale peak and lush layered forest. Player light grey single-tail fighter with red accents blue canopy at lower-middle pointing up, about 14 percent screen height, detailed panelled silhouette. Enemy dark grey twin-tail orange-marked amber-canopy jet upper-right. Yellow tracer stream between planes, one orange explosion off left wing of enemy, white wingtip contrails. Sparse HUD text SPD 420 ALT 1250 at upper-left, SCORE 02400 upper-right, tiny radar bottom-left, GUN 320 MSL 04 lower-right. Clear game action composition, no cockpit. All rendering looks made of crisp sprite stacks with coherent shadows.

### mock_chase.png

Wide exact 16:9 1536x864 full finished-game screenshot concept CHASE BEHIND camera, slight downward tilt. Player light grey red-accent single-tail blue-canopy fighter bottom-center seen from behind above, swept wings and single glowing exhaust, about 22 percent screen width. Ahead lies crescent tropical island with lower-right opening lagoon, pale peak upper-left and stepped lush forest cliffs, turquoise reefs, bright blue midday horizon and white cumulus. Dark grey twin-tail orange enemy in upper-center with green lock box, tracer streaks, one orange aerial explosion to right, wingtip trails. HUD SPD 420 ALT 1250 upper-left, SCORE 02400 upper-right, tiny radar bottom-left, MSL 04 bottom-right. Detailed hard pixel sprite stacks; no smooth 3D.

### mock_cockpit.png

Wide exact 16:9 1536x864 full finished-game screenshot concept FIRST-PERSON COCKPIT. Detailed canopy bow and side rails, lower-third glareshield and instrument panel with two MFDs, green HUD combiner glass, heading tape 270 280 290, pitch ladder, SPD 420, ALT 1250, gun reticle and green lock box framing a dark grey orange-marked twin-tail enemy ahead. Bright turquoise sea, crescent tropical lagoon island and stepped forest cliffs below, midday blue sky with shaded white cumulus. Yellow tracers toward enemy, orange explosion off to right. Radar scope left MFD, engine/fuel right MFD, SCORE 02400 top-right. Exterior clearly visible through HUD, energetic readable game screenshot, hard pixel artwork throughout.

### Final overhead island correction

The initial island was supplied as the edit reference, with shared style and palette, and this instruction: Edit reference island camera ONLY into strict nadir bird's-eye overhead map, camera looking vertically down at 90 degrees. Preserve crescent coastline, lagoon mouth right, peak upper-left, forests, pier lower inner shore, reefs and colors. Tree trunks and hut walls should disappear behind their crowns and roofs. No isometric projection. Flatten apparent cliff heights into narrow shadow bands along contours. Square image.

## Reference and limitations

The three supplied local screenshots were inspected. The brief's https://remix.ui8.ai/fly mood-reference URL could not be opened by the web tool, so the written bright tropical mood and local screenshots guided the work. These are generated art targets, not production-ready sliced atlases: scale consistency, exact palette indexing, tile seamlessness and slice registration still belong to the procedural redraw step. All requested image files were produced; none are missing.

