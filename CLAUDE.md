# Dino Hunter (Three.js + Electron) — notes for Claude

User writes Armenian, is a beginner on Ubuntu, has limited quota: answer short, in Armenian,
give exact copy-paste terminal commands. Save files straight into this folder (don't send files in chat).
Run the game: `cd /run/media/sur2004/imortant/HomeSimulatorGame && npm start`

## Layout
- `index.html` — the whole game (one `<script type="module">`, Three.js r160 from CDN importmap).
- `*_glb.js` — GLB models embedded as base64 (`window.PROPS*_B64`, `PORSCHE_GLB_B64`, `TREX…`), because file:// blocks fetch.
  Loader `loadProps()` merges PROPS_B64…PROPS7_B64, parses each with GLTFLoader, then `whenProp(name, cb)` callbacks run.
- `main.js` — Electron window, loads index.html.
- A version tag is shown bottom-left (`vNN | FPS | GLB list | animals GLB x/y`). Bump it on every change so the user can
  tell whether the new file is really running.
- Debug keys: **K** = name of the object in the screen centre, **L** = bloom on/off.

## Mistakes already made (don't repeat)
1. **File commits silently not landing.** device_commit_files said "written" but the device kept the OLD file (it
   often writes the previous version). ALWAYS check the size with device_list_dir after committing and commit again
   until the size matches the local file.
2. **Interleaved GLB attributes.** Copying `geometry.attributes.X.array` directly (crop / wheel split / rotor split)
   produced garbage vertices -> huge black triangles. Always go through `plainGeo()` (uses getX/getY/getZ).
3. **NaN pixels + UnrealBloom = big black screen rectangles.** Zero normals (after polygon reduction) gave NaN; bloom
   spread them. Fixed by `fixNormals()` on load and the `nanKillPass` before bloom. Test with key L.
4. **Water GLB rising above the ground.** Its morph targets reach ~5.5 units and its clip also animates scale;
   keep only the morph track, scale Y to ±0.15 m, sit at y = -0.42 (ground of flattened areas is 0).
5. **Spec-gloss materials** (KHR_materials_pbrSpecularGlossiness) are not supported by r160 -> textures white.
   Convert to metal-rough when shrinking (see shrink3.py logic: diffuseTexture -> baseColorTexture).
6. **Different skeletons.** Animations from another rig can't be applied by renaming tracks (police were crouched).
   Retarget in world space with bind poses from inverseBindMatrices (verified ~4° error), bake into the GLB.
7. **Node rest pose ≠ bind pose** in Sketchfab exports (rest = frame 0 of some clip). Use inverseBindMatrices.
8. **Broken models.** First velociraptor GLB was broken inside the file itself (flat sheet). Check models
   before blaming code; ask the user for another.
9. **Too-heavy models** (1.4M-poly cheetah, 415k Gazelle) kill FPS on this laptop (FPS 13–25). Reduce polygons
   (vertex clustering keyed by position+UV) and shrink textures to 512–1024.
10. **Placing big props on slopes** half-buries them. Flatten terrain in `getTerrainHeight` around them
    (base, heliport, hangar zones) and keep trees/rocks/ferns out of those zones.
11. **Cabin too close to the start** -> 3rd-person camera ended inside it. Keep START_KEEP distances; camera
    is pulled in front of `camBlockers`.
12. **Local variable shadowing**: `const groundY = ... groundY(x,z)` inside the player block = TDZ crash. The
    function `groundY()` exists; don't reuse the name.
13. Orientation of every new GLB vehicle/animal: work it out from geometry (narrow end, wheel widths, root-motion
    direction of a walk clip) and say in the reply which way was assumed.
14. Electron caches nothing important, but the user must fully restart (`Ctrl+C`, `npm start`) after changes.
15. "Remove the 2D hangar" meant the dark shed INSIDE the heliport model (meshes Object_3/Object_6), not the
    cloth hangar. When the user says "this" about an object, ask/confirm with the screenshot before deleting.
