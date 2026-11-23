import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
    LIM, WEAPONS, player, CABIN, HELIPAD, HOUSE_INT,
    creatures, vehicles, traffic, swatUnits, structures,
    tracers, particles, propMixers, keys, G, bulletCam, whenProp
} from './state.js';
import {
    scene, camera, W, H, isMobile, normalTex, woodTex, sparkTex, muzzleFlashLight
} from './scene.js';
import {
    getTerrainHeight, groundY, angleLerp, carBlocked,
    alignVehicleToGround, rebuildStaticGrid, resolveStaticObstacles, dynamicGrid
} from './physics.js';
import { sfx } from './audio.js';
import { terrainMesh } from './terrain.js';
import { aimBoneToward, damageCreature } from './ai.js';

// ---- Procedural fallback player mesh + Hero GLB replacement ----
{
    const g = player.mesh;
    const suit = new THREE.MeshStandardMaterial({ color: 0x3b4d36, roughness: 0.65 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.5, roughness: 0.4 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.75, 0.3), suit);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 14), new THREE.MeshStandardMaterial({ color: 0xd6a17c }));
    head.position.y = 1.72;
    player.legL = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.75, 0.22), dark);
    player.legL.position.set(-0.14, 0.38, 0);
    player.legR = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.75, 0.22), dark);
    player.legR.position.set(0.14, 0.38, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 1.05), dark);
    gun.position.set(0.32, 1.28, 0.45);
    g.add(torso, head, player.legL, player.legR, gun);
    g.traverse(c => { if (c.isMesh) c.castShadow = true; });
    scene.add(g);
}

whenProp('hero', gltf => {
    const model = SkeletonUtils.clone(gltf.scene);
    const mx = new THREE.AnimationMixer(model);
    const acts = {};
    gltf.animations.forEach(a => { acts[a.name] = mx.clipAction(a); });
    if (acts.idle) {
        acts.idle.play();
        mx.update(0.01);
    }
    const holder = new THREE.Group();
    holder.add(model);
    holder.updateMatrixWorld(true);
    let minY = Infinity, maxY = -Infinity;
    const bp = new THREE.Vector3();
    model.traverse(o => {
        if (o.isBone) {
            o.getWorldPosition(bp);
            minY = Math.min(minY, bp.y);
            maxY = Math.max(maxY, bp.y);
        }
    });
    const k = 1.7 / Math.max(0.001, (maxY - minY) * 1.08);
    holder.scale.setScalar(k);
    holder.position.set(0, -minY * k, 0);
    model.traverse(o => {
        if (o.isMesh) {
            o.castShadow = true;
            o.frustumCulled = false;
        }
    });
    player.mesh.children.forEach(ch => { if (!ch.userData.keep) ch.visible = false; });
    player.mesh.add(holder);
    player.heroMixer = mx;
    player.heroActs = acts;
    player.heroNow = 'idle';

    const hb = {};
    model.traverse(o => {
        if (!o.isBone) return;
        if (/RightArm/i.test(o.name)) hb.rArm = o;
        else if (/RightForeArm/i.test(o.name)) hb.rFore = o;
        else if (/RightHand/i.test(o.name) && !/Thumb|Index|Middle|Ring|Pinky/i.test(o.name)) hb.rHand = o;
        else if (/LeftArm/i.test(o.name)) hb.lArm = o;
        else if (/LeftForeArm/i.test(o.name)) hb.lFore = o;
        else if (/LeftHand/i.test(o.name) && !/Thumb|Index|Middle|Ring|Pinky/i.test(o.name)) hb.lHand = o;
        else if (/RightUpLeg/i.test(o.name)) hb.rUpLeg = o;
        else if (/RightLeg/i.test(o.name) && !/Up/i.test(o.name)) hb.rLeg = o;
        else if (/LeftUpLeg/i.test(o.name)) hb.lUpLeg = o;
        else if (/LeftLeg/i.test(o.name) && !/Up/i.test(o.name)) hb.lLeg = o;
        else if (/Spine1|Spine$/i.test(o.name) && !hb.spine) hb.spine = o;
    });
    player.heroBones = hb;
});

function heroAnim(dt, moving) {
    const mx = player.heroMixer;
    if (!mx) return;
    const want = keys['g'] && !moving ? 'dance' : moving ? (keys['shift'] && player.stamina > 0 ? 'run' : 'walk') : 'idle';
    if (want !== player.heroNow) {
        const next = player.heroActs[want];
        const cur = player.heroActs[player.heroNow];
        if (next) {
            next.reset().play();
            if (cur) cur.crossFadeTo(next, 0.2, false);
            player.heroNow = want;
        }
    }
    mx.update(dt);
}

// ---- 1st-Person & 3rd-Person Weapon Viewmodels ----
export const fpGunGroup = new THREE.Group();
G.fpGunGroup = fpGunGroup;
{
    const gunMetal = new THREE.MeshPhysicalMaterial({ color: 0x22252a, metalness: 0.88, roughness: 0.24, clearcoat: 0.5 });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.58), gunMetal);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.68, 12).rotateX(Math.PI / 2), gunMetal);
    barrel.position.set(0, 0.03, -0.45);
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.28, 14).rotateX(Math.PI / 2), gunMetal);
    scopeTube.position.set(0, 0.095, -0.1);
    fpGunGroup.add(receiver, barrel, scopeTube);
    fpGunGroup.position.set(0.26, -0.22, -0.48);
    camera.add(fpGunGroup);
    scene.add(camera);
}

export const tpGunHolder = new THREE.Group();
tpGunHolder.userData.keep = true;
tpGunHolder.position.set(-0.22, 1.18, 0.28);
player.mesh.add(tpGunHolder);
G.tpGunHolder = tpGunHolder;

const tpDefaultGuns = G.tpDefaultGuns;
{
    const gm = new THREE.MeshStandardMaterial({ color: 0x1e2228, metalness: 0.78, roughness: 0.30 });
    const wd = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.75 });
    const ol = new THREE.MeshStandardMaterial({ color: 0x3b4d36, roughness: 0.6 });
    const mk = (parts) => { const g = new THREE.Group(); parts.forEach(p => g.add(p)); g.visible = false; tpGunHolder.add(g); return g; };
    const box = (w, h, l, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; return o; };
    const cyl = (r1, r2, l, m, x, y, z) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, l, 10).rotateX(Math.PI / 2), m); o.position.set(x, y, z); o.castShadow = true; return o; };
    tpDefaultGuns.sniper = mk([box(0.04, 0.11, 0.05, wd, 0, -0.03, 0, -0.25), box(0.05, 0.08, 0.55, gm, 0, 0.05, 0.18), box(0.045, 0.10, 0.28, wd, 0, 0.04, -0.18), cyl(0.014, 0.018, 0.62, gm, 0, 0.07, 0.68), cyl(0.022, 0.022, 0.26, gm, 0, 0.13, 0.22)]);
    tpDefaultGuns.ak = mk([box(0.04, 0.11, 0.05, wd, 0, -0.03, 0, -0.25), box(0.055, 0.09, 0.42, gm, 0, 0.05, 0.16), box(0.045, 0.10, 0.24, wd, 0, 0.04, -0.14), cyl(0.015, 0.017, 0.40, gm, 0, 0.07, 0.52), box(0.036, 0.18, 0.06, gm, 0, -0.07, 0.24, 0.25)]);
    tpDefaultGuns.shotgun = mk([box(0.04, 0.11, 0.05, wd, 0, -0.03, 0, -0.25), box(0.06, 0.09, 0.40, gm, 0, 0.05, 0.16), box(0.05, 0.10, 0.26, wd, 0, 0.03, -0.14), cyl(0.022, 0.022, 0.48, gm, 0, 0.07, 0.54), box(0.055, 0.05, 0.18, wd, 0, 0.03, 0.46)]);
    tpDefaultGuns.bow = mk([box(0.03, 0.92, 0.04, wd, 0, 0.02, 0.04), box(0.015, 0.015, 0.65, gm, 0, 0.04, 0.18)]);
    tpDefaultGuns.rpg = mk([box(0.04, 0.12, 0.05, gm, 0, -0.03, 0), cyl(0.045, 0.045, 1.15, ol, 0, 0.07, 0.05), cyl(0.01, 0.07, 0.28, gm, 0, 0.07, 0.72)]);
}

const tpMuzzle = new THREE.Object3D();
tpMuzzle.position.set(0, 0.03, 0.62);
tpGunHolder.add(tpMuzzle);
G.tpMuzzle = tpMuzzle;

const tpFlash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sparkTex, color: 0xffd166, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending
}));
tpFlash.scale.setScalar(0.45);
tpFlash.position.copy(tpMuzzle.position);
tpFlash.visible = false;
tpGunHolder.add(tpFlash);
G.tpFlash = tpFlash;

function normalizeWeapon(gltf, targetLen) {
    const raw = gltf.scene.clone(true);
    const holder = new THREE.Group();
    holder.add(raw);
    holder.updateMatrixWorld(true);
    let bb = new THREE.Box3().setFromObject(holder), sz = bb.getSize(new THREE.Vector3());
    if (sz.x >= sz.y && sz.x >= sz.z) {
        raw.rotation.y = Math.PI / 2;
        if (sz.z > sz.y) raw.rotation.z = Math.PI / 2;
    } else if (sz.y >= sz.x && sz.y >= sz.z) {
        raw.rotation.x = Math.PI / 2;
        if (sz.x > sz.z) raw.rotation.z = Math.PI / 2;
    } else if (sz.x > sz.y) {
        raw.rotation.z = Math.PI / 2;
    }
    holder.updateMatrixWorld(true);
    bb = new THREE.Box3().setFromObject(holder);
    const c0 = bb.getCenter(new THREE.Vector3());
    let yPosMin = 1e9, yPosMax = -1e9, yNegMin = 1e9, yNegMax = -1e9;
    const v = new THREE.Vector3();
    raw.traverse(o => {
        if (!o.isMesh || !o.geometry.attributes.position) return;
        const P = o.geometry.attributes.position, step = Math.max(1, Math.floor(P.count / 600));
        for (let i = 0; i < P.count; i += step) {
            v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
            if (v.z > c0.z) {
                if (v.y < yPosMin) yPosMin = v.y;
                if (v.y > yPosMax) yPosMax = v.y;
            } else {
                if (v.y < yNegMin) yNegMin = v.y;
                if (v.y > yNegMax) yNegMax = v.y;
            }
        }
    });
    if ((yNegMax - yNegMin) < (yPosMax - yPosMin) * 0.92) raw.rotation.y += Math.PI;
    holder.updateMatrixWorld(true);
    bb = new THREE.Box3().setFromObject(holder);
    sz = bb.getSize(new THREE.Vector3());
    const k = targetLen / Math.max(sz.z, 0.001);
    holder.scale.setScalar(k);
    holder.updateMatrixWorld(true);
    bb = new THREE.Box3().setFromObject(holder);
    const c = bb.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, -c.y, -c.z);
    raw.traverse(o => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    const wrap = new THREE.Group();
    wrap.add(holder);
    return { group: wrap, muzzleZ: (bb.max.z - c.z), halfY: (bb.max.y - bb.min.y) * 0.5 };
}

whenProp('m4', gltf => {
    const model = SkeletonUtils.clone(gltf.scene);
    const mx = new THREE.AnimationMixer(model);
    const clips = {};
    gltf.animations.forEach(a => {
        const c = a.clone();
        let t0 = Infinity;
        c.tracks.forEach(t => { t0 = Math.min(t0, t.times[0]); });
        c.tracks.forEach(t => t.shift(-t0));
        c.resetDuration();
        clips[a.name] = mx.clipAction(c);
        clips[a.name].setLoop(THREE.LoopOnce, 1);
        clips[a.name].clampWhenFinished = true;
    });
    const draw = clips.Draw;
    if (draw) { draw.play(); mx.update(10); }
    model.updateMatrixWorld(true);
    const camNode = model.getObjectByName('FPS_Camera') || model;
    const M = new THREE.Matrix4().copy(camNode.matrixWorld).invert();
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.add(model);
    holder.matrix.copy(M);
    holder.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(holder), c = bb.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(c.x, 0, c.z);
    const fix = new THREE.Matrix4();
    if (dir.length() > 1e-4) {
        fix.makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(dir.normalize(), new THREE.Vector3(0, 0, -1)));
    }
    const r = c.length();
    let sc = 1;
    if (r > 3 || r < 0.05) sc = 0.45 / Math.max(r, 1e-4);
    holder.matrix.premultiply(new THREE.Matrix4().makeScale(sc, sc, sc))
        .premultiply(fix)
        .premultiply(new THREE.Matrix4().makeTranslation(-0.26, 0.22, 0.48));
    model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
    fpGunGroup.children.forEach(ch => { if (!ch.userData.keep) ch.visible = false; });
    fpGunGroup.add(holder);
    G.fpM4 = {
        mx,
        holder,
        fire() {
            const f = clips.Fire;
            if (f) {
                Object.values(clips).forEach(a => { if (a !== f) a.stop(); });
                f.reset().play();
            }
        }
    };
    syncWeaponModels();
    propMixers.push(mx);
});

['scorpion', 'thompson', 'ump45'].forEach(key => {
    whenProp(key, gltf => {
        const spec = WEAPONS.find(w => w.glb === key);
        const len = spec ? spec.len : 0.72;
        const fp = normalizeWeapon(gltf, len);
        fp.group.userData.keep = true;
        fp.group.rotation.y = Math.PI;
        fp.group.position.set(0.02, -0.02, -0.08);
        fp.group.visible = false;
        fpGunGroup.add(fp.group);
        G.fpCustomGuns[key] = fp.group;

        const tp = normalizeWeapon(gltf, len);
        tp.group.visible = false;
        tpGunHolder.add(tp.group);
        G.tpCustomGuns[key] = tp.group;
        syncWeaponModels();
    });
});

export function syncWeaponModels() {
    const w = WEAPONS[G.curWeap];
    const key = w && w.glb;
    const hasCustomFP = !!(key && G.fpCustomGuns[key]);
    fpGunGroup.children.forEach(ch => {
        const isCust = Object.values(G.fpCustomGuns).includes(ch);
        if (isCust) ch.visible = (ch === G.fpCustomGuns[key]);
        else if (G.fpM4) ch.visible = !hasCustomFP && ch.children && ch.children.length > 0;
        else ch.visible = !hasCustomFP;
    });
    Object.keys(G.tpCustomGuns).forEach(k => { G.tpCustomGuns[k].visible = (k === key); });
    Object.keys(tpDefaultGuns).forEach(k => { tpDefaultGuns[k].visible = (!key && w && w.type === k); });
}
G.ui.syncWeaponModels = syncWeaponModels;
syncWeaponModels();

// ---- Slow-Mo Bullet Cam ----
bulletCam.bulletMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.38, 10).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xfacc15 })
);
bulletCam.bulletMesh.visible = false;
scene.add(bulletCam.bulletMesh);

export function triggerBulletCam(startPt, endPt, onHitCallback) {
    bulletCam.active = true;
    bulletCam.start.copy(startPt);
    bulletCam.end.copy(endPt);
    bulletCam.progress = 0;
    bulletCam.onArrive = onHitCallback;
    bulletCam.bulletMesh.position.copy(startPt);
    bulletCam.bulletMesh.lookAt(endPt);
    bulletCam.bulletMesh.visible = true;
    document.body.classList.add('bullet-cam');
}

// ---- Building Ghost, Placement & Demolition ----
export const ghostMesh = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.22, 3.2),
    new THREE.MeshBasicMaterial({ color: 0x4ade80, wireframe: true })
);
ghostMesh.visible = false;
ghostMesh.userData.yOff = 0.11;
scene.add(ghostMesh);
G.ghostMesh = ghostMesh;

export function updateGhostGeometry(type) {
    if (ghostMesh.geometry) ghostMesh.geometry.dispose();
    if (type === 'wall') {
        ghostMesh.geometry = new THREE.BoxGeometry(3.2, 2.8, 0.25);
        ghostMesh.userData.yOff = 1.4;
    } else if (type === 'fire') {
        ghostMesh.geometry = new THREE.ConeGeometry(0.42, 0.85, 8);
        ghostMesh.userData.yOff = 0.42;
    } else if (type === 'turret') {
        ghostMesh.geometry = new THREE.CylinderGeometry(0.45, 0.55, 1.2, 10);
        ghostMesh.userData.yOff = 0.6;
    } else {
        ghostMesh.geometry = new THREE.BoxGeometry(3.2, 0.22, 3.2);
        ghostMesh.userData.yOff = 0.11;
    }
}

export function buildObject(type, x, z, rot = 0, free = false) {
    if (player.inHouse) {
        G.ui.pushFeed('⚠️ Տան ներսում հնարավոր չէ կառուցել');
        return;
    }
    if (!free && player.wood < 10) {
        G.ui.pushFeed('⚠️ Պետք է 10 Փայտ!');
        return;
    }
    if (!free) {
        player.wood -= 10;
        G.ui.syncUI();
    }
    const g = new THREE.Group();
    const wMat = new THREE.MeshStandardMaterial({ map: woodTex, normalMap: normalTex, roughness: 0.78 });
    const y = groundY(x, z);
    let col = null;

    if (type === 'floor') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.22, 3.2), wMat);
        m.position.y = 0.11;
        g.add(m);
        col = { isFloor: true, x, z, rot, hw: 1.65, hl: 1.65, topY: y + 0.22 };
    } else if (type === 'wall') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.8, 0.25), wMat);
        m.position.y = 1.4;
        g.add(m);
        col = { isWall: true, x, z, rot, hw: 1.6, hl: 0.25, baseY: y, h: 2.8 };
    } else if (type === 'fire') {
        const fl = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 8), new THREE.MeshBasicMaterial({ color: 0xf97316 }));
        fl.position.y = 0.42;
        const pl = new THREE.PointLight(0xff7700, 4.2, 16);
        pl.position.y = 1.1;
        g.add(fl, pl);
        col = { x, z, r: 0.65 };
    } else if (type === 'turret') {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.5, 1.1, 10), new THREE.MeshStandardMaterial({ color: 0x27272a }));
        base.position.y = 0.55;
        const gun = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.2), new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
        gun.position.set(0, 1.1, 0.35);
        g.add(base, gun);
        col = { x, z, r: 0.65 };
    }

    g.position.set(x, y, z);
    g.rotation.y = rot;
    g.traverse(c => { if (c.isMesh) c.castShadow = true; });
    scene.add(g);
    structures.push({ type, mesh: g, col, cd: 0 });
    rebuildStaticGrid();
}

export function demolishStructure(st) {
    const idx = structures.indexOf(st);
    if (idx === -1) return;
    scene.remove(st.mesh);
    st.mesh.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            ms.forEach(m => m.dispose());
        }
    });
    structures.splice(idx, 1);
    player.wood += 5;
    rebuildStaticGrid();
    G.ui.syncUI();
    G.ui.pushFeed('🔨 Կառույցը քանդվեց (+5 Փայտ)');
}
G.fn.demolishStructure = demolishStructure;

// ---- FX, Damage & Respawn ----
export function spawnSparks(pt, col, count = 18) {
    const n = Math.min(count, 24);
    for (let i = 0; i < n; i++) {
        const isFire = col === 0xf97316 || col === 0xfacc15;
        const mat = new THREE.SpriteMaterial({
            map: sparkTex, color: col, transparent: true, opacity: 0.92, depthWrite: false,
            blending: isFire ? THREE.AdditiveBlending : THREE.NormalBlending
        });
        const m = new THREE.Sprite(mat);
        const baseSz = isFire ? (0.35 + Math.random() * 0.45) : (0.16 + Math.random() * 0.22);
        m.scale.setScalar(baseSz);
        m.position.copy(pt);
        scene.add(m);
        particles.push({
            mesh: m, baseSz,
            vx: (Math.random() - 0.5) * 6.5,
            vy: 1.5 + Math.random() * 5.0,
            vz: (Math.random() - 0.5) * 6.5,
            life: 0.45, maxLife: 0.45
        });
    }
}
G.fn.spawnSparks = spawnSparks;

export function addTracer(a, b, color = 0xfacc15, life = 0.12) {
    const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color })
    );
    scene.add(line);
    tracers.push({ line, life });
}
G.fn.addTracer = addTracer;

export function respawnPlayer(srcName) {
    G.ui.pushFeed('💀 Ձեզ սպանեց՝ ' + srcName + ' — վերածնունդ ճամբարում (−10% $)');
    player.cash = Math.floor(player.cash * 0.9);
    player.hp = 100;
    player.armor = 50;
    player.stamina = 100;
    player.hunger = Math.max(player.hunger, 60);
    player.vehicle = null;
    player.mount = null;
    player.wanted = 0;
    player.inHouse = false;
    player.wasSwim = false;
    player.ragdollT = 0;
    player.airVx = 0;
    player.airVz = 0;
    G.ui.toggleXRayScope(false);
    player.x = 0;
    player.z = 8;
    player.y = getTerrainHeight(0, 8);
    player.vy = 0;
    swatUnits.forEach(s => {
        scene.remove(s.mesh);
        (s.officers || []).forEach(o => { if (o.parent) o.parent.remove(o); });
    });
    swatUnits.length = 0;
    creatures.forEach(c => {
        if (c.state === 'HUNT' || c.state === 'FLEE') c.state = 'WANDER';
    });
    G.ui.syncUI();
}

export function damagePlayer(amount, srcName) {
    if (player.hp <= 0) return;
    if (player.armor > 0) {
        const absorbed = Math.min(player.armor, amount * 0.7);
        player.armor -= absorbed;
        amount -= absorbed;
    }
    player.hp -= amount;
    G.camShake = Math.max(G.camShake, 0.12);
    G.hurtFlash = 0.4;
    if (player.hp <= 0) respawnPlayer(srcName);
}
G.fn.damagePlayer = damagePlayer;

const _turFrom = new THREE.Vector3();
const _turTo = new THREE.Vector3();

export function updateStructures(dt) {
    structures.forEach(st => {
        const p = st.mesh.position;
        if (st.type === 'fire') {
            if (!player.inHouse && Math.abs(player.y - p.y) < 3 && Math.hypot(p.x - player.x, p.z - player.z) < 6 && player.hp < 100 && player.hp > 0) {
                player.hp = Math.min(100, player.hp + 5 * dt);
            }
        } else if (st.type === 'turret') {
            st.cd -= dt;
            if (st.cd > 0) return;
            let tgt = null, best = 32;
            creatures.forEach(c => {
                if (c.state === 'DEAD' || c.tamed || !c.spec.aggr) return;
                const dd = Math.hypot(c.mesh.position.x - p.x, c.mesh.position.z - p.z);
                if (dd < best) { best = dd; tgt = c; }
            });
            if (tgt) {
                st.cd = 0.9;
                st.mesh.rotation.y = Math.atan2(tgt.mesh.position.x - p.x, tgt.mesh.position.z - p.z);
                _turFrom.set(p.x, p.y + 1.1, p.z);
                _turTo.set(tgt.mesh.position.x, tgt.mesh.position.y + 1.3, tgt.mesh.position.z);
                addTracer(_turFrom, _turTo, 0x22d3ee);
                damageCreature(tgt, 30, null);
            }
        }
    });
}

export function updateFx(dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
        const t = tracers[i];
        t.life -= dt;
        if (t.life <= 0) {
            scene.remove(t.line);
            t.line.geometry.dispose();
            t.line.material.dispose();
            tracers.splice(i, 1);
        }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.vy -= 22 * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        const gy = getTerrainHeight(p.mesh.position.x, p.mesh.position.z);
        if (p.mesh.position.y < gy) {
            p.mesh.position.y = gy;
            p.vy *= -0.3;
            p.vx *= 0.6;
            p.vz *= 0.6;
        }
        const frac = Math.max(0, p.life / (p.maxLife || 0.45));
        if (p.mesh.material) p.mesh.material.opacity = frac * 0.92;
        p.mesh.scale.setScalar((p.baseSz || 0.25) * (1.25 - 0.55 * frac));
        if (p.life <= 0) {
            scene.remove(p.mesh);
            p.mesh.material.dispose();
            particles.splice(i, 1);
        }
    }
}

// ---- Reload, Weapons & SWAT / Creature Combat ----
export function reloadWeapon() {
    if (bulletCam.active || player.vehicle) return;
    const w = WEAPONS[G.curWeap];
    if (!w || w.mag >= w.max) return;
    if (w.res <= 0) {
        sfx.dryFire();
        G.ui.pushFeed('⚠️ Փամփուշտները վերջացել են! Գնեք Խանութից [U]');
        return;
    }
    const take = Math.min(w.max - w.mag, w.res);
    w.mag += take;
    w.res -= take;
    sfx.reloadClick();
    G.fireCd = Math.max(G.fireCd, 0.35);
    G.ui.syncUI();
    G.ui.pushFeed(`🔄 Լիցքավորված է (${w.mag}/${w.res})`);
}

function applySwatUnitHit(su, officer, dmg, labelPrefix = 'SWAT') {
    if (!su) return;
    if (officer) {
        if (officer.userData.dead) return;
        officer.userData.hp -= dmg;
        if (officer.userData.hp <= 0) {
            officer.userData.dead = true;
            officer.visible = false;
            if (officer.parent) officer.parent.remove(officer);
            player.cash += 100;
            player.wanted = Math.min(5, player.wanted + 1);
            G.ui.pushFeed(`👮 ${labelPrefix} ոստիկանը չեզոքացվեց (+$100 | ★ Wanted Up)`);
            const aliveOfficers = (su.officers || []).filter(o => o && !o.userData.dead);
            if ((su.carDead || su.noCar) && aliveOfficers.length === 0) {
                const idx = swatUnits.indexOf(su);
                if (idx > -1) swatUnits.splice(idx, 1);
            }
            G.ui.syncUI();
        }
        return;
    }
    if (su.carDead) return;
    su.hp -= dmg;
    if (su.hp <= 0) {
        su.carDead = true;
        scene.remove(su.mesh);
        // Check if any deployed officers survive independently outside the wrecked car
        const survivors = (su.officers || []).filter(o => o && !o.userData.dead && o.userData.deployed);
        (su.officers || []).forEach(o => {
            if (o && !o.userData.deployed) {
                o.userData.dead = true;
                if (o.parent) o.parent.remove(o);
            }
        });
        if (survivors.length === 0) {
            const idx = swatUnits.indexOf(su);
            if (idx > -1) swatUnits.splice(idx, 1);
        }
        player.cash += 200;
        player.wanted = Math.min(5, player.wanted + 1);
        G.ui.pushFeed(`🚓 ${su.isTank ? 'Տանկը' : 'Պարեկային SWAT-ը'} ոչնչացվեց (+$200 | ★ Wanted Up)`);
        G.ui.syncUI();
    }
}

export function fireTankCannon(v) {
    if (G.fireCd > 0) return;
    G.fireCd = 1.1;
    sfx.gunshot('rpg');
    G.camShake = 0.55;
    const m = v.mesh, s = Math.sin(m.rotation.y), c = Math.cos(m.rotation.y);
    const startPt = new THREE.Vector3(m.position.x + s * 3.8, m.position.y + 1.95, m.position.z + c * 3.8);
    const dir = new THREE.Vector3(s, -Math.sin(m.rotation.x) - 0.02, c).normalize();
    muzzleFlashLight.position.copy(startPt);
    muzzleFlashLight.intensity = 12;
    spawnSparks(startPt, 0xf97316, 14);
    G.raycaster.set(startPt, dir);
    const hits = G.raycaster.intersectObjects(
        [terrainMesh, ...creatures.filter(cr => cr.state !== 'DEAD').map(cr => cr.mesh), ...swatUnits.map(su => su.mesh)],
        true
    );
    const endPt = hits.length && hits[0].distance < 130 ? hits[0].point : startPt.clone().addScaledVector(dir, 110);
    addTracer(startPt, endPt, 0xffa500, 0.22);
    spawnSparks(endPt, 0xf97316, 42);

    creatures.forEach(cr => {
        if (cr.state === 'DEAD' || cr.tamed) return;
        if (cr.mesh.position.distanceTo(endPt) < 9.5) damageCreature(cr, 450 * player.dmgMult, '💥 ՏԱՆԿԻ ԱՐԿ');
    });
    for (let i = swatUnits.length - 1; i >= 0; i--) {
        const su = swatUnits[i];
        (su.officers || []).forEach(o => {
            if (o && !o.userData.dead && o.userData.deployed && o.position.distanceTo(endPt) < 9.5) {
                applySwatUnitHit(su, o, 450 * player.dmgMult, '💥 ԱՐԿ');
            }
        });
        if (!su.carDead && su.mesh.position.distanceTo(endPt) < 10) {
            applySwatUnitHit(su, null, 600 * player.dmgMult);
        }
    }
}

const _aimTmp = new THREE.Vector2();
const _pelletAim = new THREE.Vector2();

export function fireWeapon(cx, cy) {
    if (player.vehicle && player.vehicle.type === 'tank') {
        fireTankCannon(player.vehicle);
        return;
    }
    if (bulletCam.active || G.fireCd > 0) return;
    const w = WEAPONS[G.curWeap];
    if (w.mag <= 0) {
        if (w.res > 0) {
            reloadWeapon();
        } else {
            sfx.dryFire();
            G.fireCd = 0.28;
            G.ui.pushFeed('⚠️ Փամփուշտները վերջացել են! Գնեք Խանութից [U]');
        }
        return;
    }

    w.mag--;
    G.fireCd = w.rate;
    G.ui.syncUI();
    sfx.gunshot(w.type);
    G.camShake = w.type === 'rpg' ? 0.45 : 0.16;
    G.fpRecoil = 0.14;
    player.aimT = 1.6;
    player.tpRecoil = 1.0;
    if (w.type !== 'bow') {
        player.tpFlashT = 0.06;
        tpFlash.visible = true;
    }
    player.facing = player.yaw + Math.PI;
    if (G.fpM4) G.fpM4.fire();

    if (player.xrayScope) _aimTmp.set(0, 0);
    else _aimTmp.set((cx / W) * 2 - 1, -(cy / H) * 2 + 1);

    player.mesh.updateMatrixWorld(true);
    const startPt = (player.thirdPerson && !player.xrayScope && !player.vehicle)
        ? tpMuzzle.getWorldPosition(new THREE.Vector3())
        : new THREE.Vector3(player.x, player.y + 1.55, player.z);

    if (w.type !== 'bow') {
        muzzleFlashLight.position.copy(startPt);
        muzzleFlashLight.intensity = 6.5;
        creatures.forEach(c => {
            if (!c.spec.aggr && Math.hypot(c.mesh.position.x - player.x, c.mesh.position.z - player.z) < 45) {
                c.state = 'FLEE';
            }
        });
    }

    const liveCreatures = creatures.filter(c => c.state !== 'DEAD' && c !== player.mount);
    const bodyMeshes = liveCreatures.map(c => c.mesh);

    const swatTargets = [];
    swatUnits.forEach((su) => {
        if (!su.carDead && !su.noCar) swatTargets.push({ obj: su.mesh, su, officer: null });
        (su.officers || []).forEach(o => {
            if (o && !o.userData.dead && o.visible) swatTargets.push({ obj: o, su, officer: o });
        });
    });
    const swatObjs = swatTargets.map(x => x.obj);

    // 1. Check X-Ray organ shot first (single aimed ray)
    if (player.xrayScope && w.type !== 'shotgun') {
        G.raycaster.setFromCamera(_aimTmp, camera);
        const allOrgans = [];
        liveCreatures.forEach(c => c.organs.forEach(o => { o.userData.owner = c; allOrgans.push(o); }));
        const organHits = G.raycaster.intersectObjects(allOrgans, false);
        if (organHits.length > 0) {
            const hitOrgan = organHits[0].object;
            const target = hitOrgan.userData.owner;
            const hitPt = organHits[0].point.clone();
            G.ui.toggleXRayScope(false);
            triggerBulletCam(startPt, hitPt, () => {
                spawnSparks(hitPt, 0xff0033, 34);
                damageCreature(target, w.dmg * player.dmgMult * hitOrgan.userData.mult, hitOrgan.userData.organ);
            });
            return;
        }
    }

    // 2. RPG-7 Rocket Launcher with 9.5m splash explosion on ground/body/SWAT/vehicle impact
    if (w.type === 'rpg') {
        G.raycaster.setFromCamera(_aimTmp, camera);
        const rpgTargets = [
            terrainMesh,
            ...bodyMeshes,
            ...swatObjs,
            ...vehicles.filter(v => v !== player.vehicle).map(v => v.mesh)
        ].filter(Boolean);
        const hits = G.raycaster.intersectObjects(rpgTargets, true);
        const endPt = hits.length > 0 && hits[0].distance < 150
            ? hits[0].point.clone()
            : G.raycaster.ray.origin.clone().add(G.raycaster.ray.direction.clone().multiplyScalar(120));

        spawnSparks(endPt, 0xf97316, 42);
        G.camShake = Math.max(G.camShake, 0.55);

        liveCreatures.forEach(cr => {
            const d = cr.mesh.position.distanceTo(endPt);
            if (d < 9.5) {
                const falloff = Math.max(0.35, 1 - d / 10);
                damageCreature(cr, w.dmg * falloff * player.dmgMult, null);
            }
        });
        for (let i = swatUnits.length - 1; i >= 0; i--) {
            const su = swatUnits[i];
            (su.officers || []).forEach(o => {
                if (o && !o.userData.dead && o.userData.deployed) {
                    const d = o.position.distanceTo(endPt);
                    if (d < 9.5) applySwatUnitHit(su, o, w.dmg * Math.max(0.4, 1 - d / 10) * player.dmgMult, '🚀 RPG');
                }
            });
            if (!su.carDead && su.mesh.position.distanceTo(endPt) < 9.5) {
                const d = su.mesh.position.distanceTo(endPt);
                applySwatUnitHit(su, null, w.dmg * Math.max(0.4, 1 - d / 10) * player.dmgMult);
            }
        }
        addTracer(startPt, endPt, 0xf97316, 0.22);
        return;
    }

    // 3. Multi-pellet spread for Tactical Shotgun, single pinpoint ray otherwise
    const pellets = w.type === 'shotgun' ? 7 : 1;
    const spread = w.type === 'shotgun' ? 0.042 : 0;
    const dmgPerPellet = (w.dmg / pellets) * player.dmgMult;

    for (let p = 0; p < pellets; p++) {
        const ox = pellets > 1 ? (Math.random() - 0.5) * spread * 2 : 0;
        const oy = pellets > 1 ? (Math.random() - 0.5) * spread * 2 : 0;
        _pelletAim.set(_aimTmp.x + ox, _aimTmp.y + oy);
        G.raycaster.setFromCamera(_pelletAim, camera);

        let endPt = G.raycaster.ray.origin.clone().add(G.raycaster.ray.direction.clone().multiplyScalar(120));
        const bodyHits = G.raycaster.intersectObjects(bodyMeshes, true);
        if (bodyHits.length > 0) {
            endPt = bodyHits[0].point;
            let o = bodyHits[0].object;
            while (o.parent && !bodyMeshes.includes(o)) o = o.parent;
            const target = liveCreatures.find(c => c.mesh === o);
            if (target) {
                spawnSparks(endPt, 0x991b1b, pellets > 1 ? 6 : 16);
                damageCreature(target, dmgPerPellet, null);
            }
        } else if (swatObjs.length > 0) {
            const sHits = G.raycaster.intersectObjects(swatObjs, true);
            if (sHits.length > 0) {
                endPt = sHits[0].point;
                let o = sHits[0].object;
                while (o.parent && !swatObjs.includes(o)) o = o.parent;
                const found = swatTargets.find(x => x.obj === o);
                if (found) {
                    spawnSparks(endPt, 0xfacc15, pellets > 1 ? 6 : 16);
                    applySwatUnitHit(found.su, found.officer, dmgPerPellet);
                }
            }
        }
        addTracer(startPt, endPt, 0xfacc15, 0.14);
    }
}

// ---- Player & Vehicles Frame Update (zero per-frame scratch allocations) ----
const _plP1 = new THREE.Vector3();
const _plElbR = new THREE.Vector3();
const _plHndR = new THREE.Vector3();
const _plElbL = new THREE.Vector3();
const _plHndL = new THREE.Vector3();
const _plSparkPt = new THREE.Vector3();
const _plObsOut = { x: 0, z: 0, hit: false };
const _qPlDyn = [];
const _plDynSeen = new Set();

export function updatePlayerAndVehicles(dt, rawDt, now) {
    if (player.vehicle) {
        const v = player.vehicle;
        const maxSpd = v.type === 'tank' ? 24 : v.type === 'jeep2' ? 27 : v.type === 'jet' ? 75 : v.type === 'gazelle' ? 40 : v.type === 'md500' ? 38 : v.type === 'boat' ? 22 : v.type === 'mboat' ? 18 : v.type === 'porsche' ? 34 : v.type === 'olds' ? 26 : v.type === 'cop' ? 30 : (v.type === 'atv' ? 24 : 20);
        const thr = (keys['w'] ? 1 : 0) - (keys['s'] ? 0.5 : 0) + (player.joyMag > 0.1 ? -player.joyY : 0);
        const clampedThr = Math.max(-0.5, Math.min(1, thr));
        const accel = clampedThr > 0 ? maxSpd * clampedThr : clampedThr * 24;
        v.speed += (accel - v.speed * 2.0) * dt;

        const steerInput = (keys['a'] ? 1 : 0) - (keys['d'] ? 1 : 0) + (player.joyMag > 0.15 ? -player.joyX : 0);
        const clampedSteer = Math.max(-1, Math.min(1, steerInput));

        if (v.flies) {
            v.mesh.rotation.order = 'YXZ';
            const wantVy = (keys[' '] || keys['Space'] || keys['shift']) ? 18 : (keys['c'] || keys['ctrl']) ? -14 : 0;
            v.vy += (wantVy - v.vy) * Math.min(1, dt * 6);
            const floorY = groundY(v.mesh.position.x, v.mesh.position.z);
            v.mesh.position.y = Math.max(floorY, v.mesh.position.y + v.vy * dt);
            if (v.mesh.position.y <= floorY + 0.01 && v.vy < 0) v.vy = 0;
            v.mesh.rotation.y += clampedSteer * 1.7 * dt;
            const air = v.mesh.position.y > floorY + 0.5;
            const wantPitch = air ? (clampedThr > 0.1 ? 0.18 : clampedThr < -0.1 ? -0.14 : 0) : 0;
            const wantRoll = air ? clampedSteer * 0.22 : 0;
            v.mesh.rotation.x += (wantPitch - v.mesh.rotation.x) * Math.min(1, dt * 5);
            v.mesh.rotation.z += (wantRoll - v.mesh.rotation.z) * Math.min(1, dt * 5);
        } else {
            if (v.type === 'tank') {
                const turn = clampedSteer * 1.85 * (v.speed < -0.5 ? -1 : 1);
                v.mesh.rotation.y += turn * dt;
            } else if (Math.abs(v.speed) > 0.4) {
                const turn = clampedSteer * 2.0 * Math.sign(v.speed);
                v.mesh.rotation.y += turn * dt;
            }
            v.wheels.forEach(w => { w.rotation.x += Math.max(-9, Math.min(9, v.speed * 2.2)) * dt; });
            const st = clampedSteer * 0.55;
            (v.steers || []).forEach(sg => { sg.rotation.y += (st - sg.rotation.y) * Math.min(1, dt * 10); });
            const nx = v.mesh.position.x + Math.sin(v.mesh.rotation.y) * v.speed * dt;
            const nz = v.mesh.position.z + Math.cos(v.mesh.rotation.y) * v.speed * dt;
            if (carBlocked(v, nx, nz, v.mesh.rotation.y)) {
                v.speed *= -0.25;
            } else {
                v.mesh.position.x = nx;
                v.mesh.position.z = nz;
            }
            if (v.isBoat) v.mesh.position.y = -0.35 - v.draft + Math.sin(now * 0.002) * 0.05;
            else alignVehicleToGround(v, dt);
        }
        if (v.flies) {
            v.mesh.position.x += Math.sin(v.mesh.rotation.y) * v.speed * dt;
            v.mesh.position.z += Math.cos(v.mesh.rotation.y) * v.speed * dt;
        }
        if (player.camOffT > 0) player.camOffT -= dt;
        else player.camOff = (player.camOff || 0) * (1 - Math.min(1, dt * 2.5));
        if (keys['q']) { player.camOff = (player.camOff || 0) + dt * 2.2; player.camOffT = 1.2; }
        player.yaw = v.mesh.rotation.y + Math.PI + (player.camOff || 0);
        if (v.steerWheel) {
            const wantSw = clampedSteer * 1.45;
            v.steerWheel.rotation.z += (wantSw - v.steerWheel.rotation.z) * Math.min(1, dt * 10);
        }
        player.x = v.mesh.position.x;
        player.y = v.mesh.position.y;
        player.z = v.mesh.position.z;
        player.mesh.visible = false;
        fpGunGroup.visible = false;
    } else {
        let inFwd = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0) - (player.joyMag > 0.06 ? player.joyY : 0);
        let inRight = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0) + (player.joyMag > 0.06 ? player.joyX : 0);
        const inMag = Math.hypot(inFwd, inRight);
        if (inMag > 1) { inFwd /= inMag; inRight /= inMag; }
        const moving = inMag > 0.08;

        const swim = !player.inHouse && !player.mount && getTerrainHeight(player.x, player.z) < -0.9;
        if (swim && !player.wasSwim) G.ui.pushFeed('🏊 Լողում եք (դանդաղ)');
        player.wasSwim = swim;

        const baseSpd = player.mount ? 13.0 : ((keys['shift'] && player.stamina > 2) ? 9.2 : (player.stealth ? 3.2 : 5.6));
        const spd = (swim ? 0.45 : 1) * baseSpd * dt;
        const fx = -Math.sin(player.yaw) * spd, fz = -Math.cos(player.yaw) * spd;
        const rx = Math.cos(player.yaw) * spd, rz = -Math.sin(player.yaw) * spd;

        const mvX = inFwd * fx + inRight * rx;
        const mvZ = inFwd * fz + inRight * rz;
        let nx = player.x + mvX;
        let nz = player.z + mvZ;

        if (!player.inHouse) {
            resolveStaticObstacles(nx, nz, player.y, 0.35, _plObsOut, true);
            nx = _plObsOut.x;
            nz = _plObsOut.z;
        }
        player.x = nx;
        player.z = nz;

        if (player.airVx || player.airVz) {
            player.x += (player.airVx || 0) * dt;
            player.z += (player.airVz || 0) * dt;
            const drag = Math.max(0, 1 - dt * 0.55);
            player.airVx = (player.airVx || 0) * drag;
            player.airVz = (player.airVz || 0) * drag;
        }

        if (!player.inHouse) {
            dynamicGrid.query(player.x, player.z, 8, _qPlDyn);
            _plDynSeen.clear();
            for (let i = 0; i < _qPlDyn.length; i++) {
                const o = _qPlDyn[i].ref;
                if (!o || _plDynSeen.has(o)) continue;
                _plDynSeen.add(o);
                const cb = o.colBox;
                const hw = (cb ? cb.hw : (o.type === 'tank' ? 1.8 : o.type === 'gazelle' || o.type === 'md500' ? 1.8 : o.type === 'jet' ? 4.8 : o.isBoat ? 2.1 : o.type === 'heli' ? 1.9 : o.type === 'atv' ? 1.15 : 1.45)) + 0.38;
                const hl = (cb ? cb.hl : (o.type === 'tank' ? 3.8 : o.type === 'gazelle' ? 5.2 : o.type === 'md500' ? 3.8 : o.type === 'jet' ? 6.4 : o.isBoat ? 4.1 : o.type === 'heli' ? 3.1 : o.type === 'atv' ? 1.65 : 2.95)) + 0.38;
                const hh = cb ? cb.h : 2.6;
                const dx = player.x - o.mesh.position.x, dz = player.z - o.mesh.position.z;
                const maxR = Math.max(hw, hl) + 2.5;
                if (Math.abs(dx) > maxR || Math.abs(dz) > maxR) continue;
                if (player.y > o.mesh.position.y + hh) continue;
                const s = Math.sin(o.mesh.rotation.y), c = Math.cos(o.mesh.rotation.y);
                const lx = dx * c - dz * s, lz = dx * s + dz * c;
                if (Math.abs(lx) < hw && Math.abs(lz) < hl) {
                    const ex = hw - Math.abs(lx), ez = hl - Math.abs(lz);
                    let pl = lx, pz2 = lz;
                    if (ex < ez) pl = Math.sign(lx || 1) * (hw + 0.05);
                    else pz2 = Math.sign(lz || 1) * (hl + 0.05);
                    player.x = o.mesh.position.x + pl * c + pz2 * s;
                    player.z = o.mesh.position.z - pl * s + pz2 * c;
                }
            }

            for (let si = 0; si < swatUnits.length; si++) {
                const offs = swatUnits[si].officers;
                if (!offs) continue;
                for (let oi = 0; oi < offs.length; oi++) {
                    const cop = offs[oi];
                    if (!cop || cop.userData.dead || !cop.userData.deployed || !cop.visible) continue;
                    const dx = player.x - cop.position.x, dz = player.z - cop.position.z;
                    const d = Math.hypot(dx, dz);
                    if (d < 0.78 && d > 0.001) {
                        player.x = cop.position.x + (dx / d) * 0.78;
                        player.z = cop.position.z + (dz / d) * 0.78;
                    }
                }
            }
        }

        if (player.inHouse) {
            player.x = Math.max(HOUSE_INT.x - HOUSE_INT.half, Math.min(HOUSE_INT.x + HOUSE_INT.half, player.x));
            player.z = Math.max(HOUSE_INT.z - HOUSE_INT.half, Math.min(HOUSE_INT.z + HOUSE_INT.half, player.z));
        }

        const playerFloorY = player.inHouse
            ? HOUSE_INT.y
            : (swim
                ? Math.max(getTerrainHeight(player.x, player.z), -0.35 - 1.3 + Math.sin(now * 0.003) * 0.05)
                : groundY(player.x, player.z));

        player.vy -= 19.6 * dt;
        player.y += player.vy * dt;
        if (player.y <= playerFloorY) {
            if (player.vy < -12 && !swim) {
                player.ragdollT = 1.45;
                _plSparkPt.set(player.x, playerFloorY + 0.2, player.z);
                spawnSparks(_plSparkPt, 0x8b7355, 16);
                G.camShake = Math.max(G.camShake, 0.4);
                if (player.vy < -15) {
                    const fd = Math.min(80, Math.floor((-player.vy - 14) * 3.5));
                    damagePlayer(fd, 'Ընկնելու վնաս');
                }
            }
            player.y = playerFloorY;
            player.vy = 0;
            player.airVx = 0;
            player.airVz = 0;
        }
        if (player.ragdollT > 0) player.ragdollT = Math.max(0, player.ragdollT - dt);

        if (player.mount) {
            player.mount.mesh.position.set(player.x, player.y, player.z);
            player.mount.mesh.rotation.y = player.yaw + Math.PI;
            const mt = player.mount;
            if (mt.backY === undefined) {
                const bb = new THREE.Box3().setFromObject(mt.mesh);
                mt.backY = (bb.max.y - mt.mesh.position.y) * 0.8;
            }
            player.mesh.visible = player.thirdPerson && !player.xrayScope;
            player.mesh.position.set(player.x, player.y + Math.max(0.3, mt.backY - 0.85), player.z);
            player.mesh.rotation.y = player.yaw + Math.PI;
            heroAnim(dt, false);
            fpGunGroup.visible = !player.thirdPerson;
        } else {
            player.mesh.visible = player.thirdPerson && !player.xrayScope;
            fpGunGroup.visible = !player.thirdPerson && !player.xrayScope;
            fpGunGroup.position.z = -0.48 + G.fpRecoil;
            player.mesh.rotation.order = 'YXZ';
            if (player.aimT > 0) player.aimT = Math.max(0, player.aimT - rawDt);
            if (player.tpRecoil > 0) player.tpRecoil = Math.max(0, player.tpRecoil - rawDt * 6);
            if (player.tpFlashT > 0) {
                player.tpFlashT = Math.max(0, player.tpFlashT - rawDt);
                tpFlash.visible = player.tpFlashT > 0;
            }
            const airFall = player.y > playerFloorY + 1.1 && player.vy < -2.5;
            const rag = player.ragdollT > 0;
            const aiming = player.aimT > 0 && !rag && !airFall;
            player.mesh.position.set(player.x, player.y + (rag ? 0.22 : 0), player.z);

            if (aiming) {
                player.facing = player.yaw + Math.PI;
                player.mesh.rotation.y = player.facing;
            } else if (moving && !rag && player.thirdPerson && !player.xrayScope) {
                if (mvX * mvX + mvZ * mvZ > 1e-6) {
                    const targetFacing = Math.atan2(mvX, mvZ);
                    player.facing = player.facing === undefined
                        ? targetFacing
                        : angleLerp(player.facing, targetFacing, Math.min(1, dt * 12));
                }
                player.mesh.rotation.y = player.facing;
            } else if (!player.thirdPerson || player.xrayScope) {
                player.facing = player.yaw + Math.PI;
                player.mesh.rotation.y = player.facing;
            } else if (player.facing !== undefined) {
                player.mesh.rotation.y = player.facing;
            } else {
                player.mesh.rotation.y = player.yaw + Math.PI;
            }

            let wantRx = 0, wantRz = 0;
            if (airFall) {
                const spdF = Math.min(1, Math.abs(player.vy) / 18);
                wantRx = 0.25 + spdF * 0.42 + Math.sin(now * 0.006) * 0.08;
                wantRz = Math.sin(now * 0.007) * 0.16;
            } else if (rag) {
                const rise = player.ragdollT < 0.45 ? player.ragdollT / 0.45 : 1;
                wantRx = Math.PI * 0.48 * rise;
                wantRz = 0.22 * rise;
            }
            player.mesh.rotation.x += (wantRx - player.mesh.rotation.x) * Math.min(1, dt * (rag ? 14 : 6));
            player.mesh.rotation.z += (wantRz - player.mesh.rotation.z) * Math.min(1, dt * 6);
            if (moving && !rag && !airFall) {
                G.walkCycle += dt * 10;
                player.legL.rotation.x = Math.sin(G.walkCycle) * 0.6;
                player.legR.rotation.x = -Math.sin(G.walkCycle) * 0.6;
            } else {
                player.legL.rotation.x = player.legR.rotation.x = 0;
            }
            heroAnim(dt, moving && !rag && !airFall);

            if (airFall && player.heroBones) {
                const b = player.heroBones, t = now * 0.008;
                player.mesh.updateMatrixWorld(true);
                if (b.rArm && b.rFore && b.rHand) {
                    _plElbR.set(-0.55, 1.55 + Math.sin(t) * 0.14, 0.05).applyMatrix4(player.mesh.matrixWorld);
                    _plHndR.set(-0.78, 1.88 + Math.cos(t * 1.1) * 0.18, 0.18).applyMatrix4(player.mesh.matrixWorld);
                    aimBoneToward(b.rArm, b.rFore, _plElbR);
                    aimBoneToward(b.rFore, b.rHand, _plHndR);
                }
                if (b.lArm && b.lFore && b.lHand) {
                    _plElbL.set(0.55, 1.55 - Math.sin(t * 1.05) * 0.14, 0.05).applyMatrix4(player.mesh.matrixWorld);
                    _plHndL.set(0.78, 1.88 - Math.cos(t * 1.15) * 0.18, 0.18).applyMatrix4(player.mesh.matrixWorld);
                    aimBoneToward(b.lArm, b.lFore, _plElbL);
                    aimBoneToward(b.lFore, b.lHand, _plHndL);
                }
                if (b.rUpLeg && b.rLeg) { b.rUpLeg.rotation.x += -0.45 + Math.sin(t * 1.3) * 0.22; b.rLeg.rotation.x += 0.65; }
                if (b.lUpLeg && b.lLeg) { b.lUpLeg.rotation.x += -0.35 - Math.sin(t * 1.3) * 0.22; b.lLeg.rotation.x += 0.55; }
            }

            if (player.thirdPerson && !player.xrayScope) {
                const rec = player.tpRecoil || 0;
                const b = player.heroBones;
                if (aiming) {
                    const pitchOff = Math.max(-0.45, Math.min(0.45, -player.pitch * 0.55));
                    if (b && b.rArm && b.rFore && b.rHand) {
                        player.mesh.updateMatrixWorld(true);
                        _plElbR.set(-0.30, 1.24, 0.14).applyMatrix4(player.mesh.matrixWorld);
                        _plHndR.set(-0.15, 1.32 + pitchOff * 0.28, 0.30).applyMatrix4(player.mesh.matrixWorld);
                        aimBoneToward(b.rArm, b.rFore, _plElbR);
                        aimBoneToward(b.rFore, b.rHand, _plHndR);
                        if (b.lArm && b.lFore && b.lHand) {
                            _plElbL.set(0.24, 1.22, 0.22).applyMatrix4(player.mesh.matrixWorld);
                            _plHndL.set(-0.08, 1.33 + pitchOff * 0.36, 0.50).applyMatrix4(player.mesh.matrixWorld);
                            aimBoneToward(b.lArm, b.lFore, _plElbL);
                            aimBoneToward(b.lFore, b.lHand, _plHndL);
                        }
                        b.rHand.getWorldPosition(_plP1);
                        player.mesh.worldToLocal(_plP1);
                        tpGunHolder.position.set(_plP1.x + 0.02, _plP1.y + 0.02, _plP1.z + 0.12 - rec * 0.08);
                    } else {
                        tpGunHolder.position.set(-0.18, 1.32, 0.36 - rec * 0.08);
                    }
                    tpGunHolder.rotation.set(pitchOff - rec * 0.12, 0, 0);
                } else {
                    if (b && b.rArm && b.rFore && b.rHand && !airFall && !rag) {
                        player.mesh.updateMatrixWorld(true);
                        const bob = moving ? Math.sin(now * 0.011) * 0.04 : Math.sin(now * 0.0025) * 0.012;
                        _plElbR.set(-0.29, 1.15 + bob * 0.5, -0.02).applyMatrix4(player.mesh.matrixWorld);
                        _plHndR.set(-0.20, 1.00 + bob, 0.24).applyMatrix4(player.mesh.matrixWorld);
                        aimBoneToward(b.rArm, b.rFore, _plElbR);
                        aimBoneToward(b.rFore, b.rHand, _plHndR);
                        b.rHand.getWorldPosition(_plP1);
                        player.mesh.worldToLocal(_plP1);
                        tpGunHolder.position.set(_plP1.x, _plP1.y - 0.01, _plP1.z + 0.045);
                        tpGunHolder.rotation.set(0.36 + bob * 0.6, 0.06, 0.04);
                    } else {
                        tpGunHolder.position.set(-0.22, 0.96, 0.14);
                        tpGunHolder.rotation.set(0.42, 0.08, 0.04);
                    }
                }
            }
        }
    }

    // World bounds, falling aircraft, survival stats & nearby interactions
    player.x = Math.max(-LIM, Math.min(LIM, player.x));
    player.z = Math.max(-LIM, Math.min(LIM, player.z));
    vehicles.forEach(v => {
        if (v.flies) {
            if (v.rotors) {
                const wantSpd = player.vehicle === v ? 24 : 0;
                v.rotorSpd = (v.rotorSpd || 0) + (wantSpd - (v.rotorSpd || 0)) * Math.min(1, dt * (wantSpd > 0 ? 2.2 : 0.7));
                if (v.rotorSpd > 0.05) v.rotors.rotation.y += v.rotorSpd * dt;
            }
            if (player.vehicle !== v) {
                const floorY = groundY(v.mesh.position.x, v.mesh.position.z);
                if (v.mesh.position.y > floorY + 0.05) {
                    v.mesh.rotation.order = 'YXZ';
                    v.vy = (v.vy || 0) - 18 * dt;
                    v.mesh.position.y += v.vy * dt;
                    v.mesh.position.x += Math.sin(v.mesh.rotation.y) * (v.speed || 0) * dt;
                    v.mesh.position.z += Math.cos(v.mesh.rotation.y) * (v.speed || 0) * dt;
                    v.speed = (v.speed || 0) * Math.max(0, 1 - dt * 0.5);
                    v.mesh.rotation.x = Math.min(0.65, (v.mesh.rotation.x || 0) + dt * 0.55);
                    v.mesh.rotation.z = (v.mesh.rotation.z || 0) + dt * 0.35;
                    if (v.mesh.position.y <= floorY) {
                        if (v.vy < -7) {
                            _plSparkPt.set(v.mesh.position.x, floorY + 1, v.mesh.position.z);
                            spawnSparks(_plSparkPt, 0xf97316, 30);
                            sfx.gunshot('rpg');
                            G.camShake = Math.max(G.camShake, 0.35);
                        }
                        v.mesh.position.y = floorY;
                        v.vy = 0;
                        v.speed = 0;
                        alignVehicleToGround(v, 0);
                    }
                }
            }
        }
        v.mesh.position.x = Math.max(-LIM, Math.min(LIM, v.mesh.position.x));
        v.mesh.position.z = Math.max(-LIM, Math.min(LIM, v.mesh.position.z));
    });

    const walking = keys['w'] || keys['s'] || keys['a'] || keys['d'] || player.joyMag > 0.08;
    if (!player.vehicle && !player.mount && keys['shift'] && walking && player.stamina > 0) {
        player.stamina = Math.max(0, player.stamina - 16 * dt);
    } else {
        player.stamina = Math.min(100, player.stamina + 12 * dt);
    }
    player.hunger = Math.max(0, player.hunger - 0.15 * dt);
    if (player.hunger <= 0) {
        player.hp -= 1.2 * dt;
        if (player.hp <= 0) respawnPlayer('Սով');
    } else if (player.hunger > 40 && player.hp < 100) {
        player.hp = Math.min(100, player.hp + 0.6 * dt);
    }
    G.hurtFlash = Math.max(0, G.hurtFlash - rawDt * 1.5);
    G.uiTimer += rawDt;
    if (G.uiTimer > 0.1) {
        G.uiTimer = 0;
        G.ui.updateBarsUI();
    }

    let nearTarget = null;
    if (player.inHouse) {
        if (Math.hypot(player.x - HOUSE_INT.x, player.z - (HOUSE_INT.z + HOUSE_INT.doorZ)) < 2.2) {
            nearTarget = { isHouseOut: true, label: 'Դուրս գալ տնից 🚪' };
        } else if (Math.hypot(player.x - (HOUSE_INT.x + HOUSE_INT.bedX), player.z - (HOUSE_INT.z + HOUSE_INT.bedZ)) < 2.4) {
            nearTarget = { isBed: true, label: 'Հանգստանալ մահճակալին (100% HP/Սնունդ) 🛏️' };
        }
    } else if (!player.vehicle && !player.mount) {
        let best = 6.5;
        if (CABIN.door) {
            const hd = Math.hypot(CABIN.door.x - player.x, CABIN.door.z - player.z);
            if (hd < 4.5 && hd < best) {
                best = hd;
                nearTarget = { isHouseIn: true, label: 'Մտնել իմ տուն 🏠' };
            }
        }
        vehicles.forEach(v => {
            const dd = Math.hypot(v.mesh.position.x - player.x, v.mesh.position.z - player.z);
            if (dd < best) { best = dd; nearTarget = { isVehicle: true, ref: v, label: v.name }; }
        });
        traffic.forEach(t => {
            if (t.jack || !t.mesh.visible) return;
            const dd = Math.hypot(t.mesh.position.x - player.x, t.mesh.position.z - player.z);
            if (dd < best) { best = dd; nearTarget = { isTraffic: true, ref: t, label: 'Գողանալ մեքենան (հանել վարորդին) 🚗' }; }
        });
        creatures.forEach(cr => {
            if (!cr.tamed || cr.state === 'DEAD') return;
            const dd = Math.hypot(cr.mesh.position.x - player.x, cr.mesh.position.z - player.z);
            if (dd < best) { best = dd; nearTarget = { isDino: true, ref: cr, label: 'Հեծնել ' + cr.spec.name }; }
        });
        if (!nearTarget && player.mode === 'build') {
            let bestSt = 4.2;
            structures.forEach(st => {
                const dd = Math.hypot(st.mesh.position.x - player.x, st.mesh.position.z - player.z);
                if (dd < bestSt) {
                    bestSt = dd;
                    nearTarget = { isDemolish: true, ref: st, label: 'Քանդել կառույցը (+5 Փայտ) 🔨' };
                }
            });
        }
    }
    G.nearTarget = nearTarget;

    const banner = document.getElementById('interact-banner');
    if (banner) {
        if (nearTarget) {
            banner.style.display = 'block';
            banner.textContent = (isMobile ? 'Սեղմիր՝ ' : 'Սեղմեք [E] — ') + nearTarget.label;
        } else if (player.vehicle && player.vehicle.flies) {
            banner.style.display = 'block';
            banner.textContent = isMobile
                ? '🚁 ⬆️ Վերև | ⬇️ Ներքև | 🚗 Իջնել'
                : '🚁 [Space / Shift] Վերև ⬆️ | [C / Ctrl] Ներքև ⬇️ | [WASD] Թռչել | [E] Իջնել';
        } else if (player.vehicle && player.vehicle.type === 'tank') {
            banner.style.display = 'block';
            banner.textContent = isMobile
                ? '🪖 🔥 Կրակել թնդանոթով | 🚗 Իջնել'
                : '🪖 [WASD] Վարել | [Space / Ձախ կոճակ] Կրակել թնդանոթով 💥 | [E] Իջնել';
        } else if (player.vehicle || player.mount) {
            banner.style.display = 'block';
            banner.textContent = isMobile ? 'Սեղմիր 🚗 — իջնել' : 'Սեղմեք [E] — իջնել';
        } else {
            banner.style.display = 'none';
        }
    }
    if (isMobile) {
        const me = document.getElementById('m-enter');
        const md = document.getElementById('m-down');
        if (me) me.classList.toggle('ready', !!(nearTarget || player.vehicle || player.mount));
        if (md) md.style.display = (player.vehicle && player.vehicle.flies) ? 'flex' : 'none';
    }
}
