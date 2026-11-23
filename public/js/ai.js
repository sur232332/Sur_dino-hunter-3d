import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
    SPECIES, ANIMAL_CFG, PROPS, creatures, swatUnits, player,
    CABIN, keys, G, whenProp, showGlbErr
} from './state.js';
import { scene, normalTex, scaleNormalTex, sparkTex } from './scene.js';
import {
    getTerrainHeight, getRoadCenterX, groundY, angleLerp,
    resolveStaticObstacles, alignVehicleToGround, dynamicGrid
} from './physics.js';
import { sfx } from './audio.js';
import { applyCarGLB } from './vehicles.js';

export function setBodyOpacity(c, o) {
    c.bodyMat.opacity = o;
    if (c.extraMats) {
        c.extraMats.forEach(m => {
            m.transparent = o < 1;
            m.opacity = o;
        });
    }
}

export function applyAnimalModel(cr) {
    const cfg = ANIMAL_CFG[cr.type], gltf = PROPS[cr.type];
    if (!cfg || !gltf || cr.glbApplied) return;
    cr.glbApplied = true;
    const model = SkeletonUtils.clone(gltf.scene);
    const lamps = [];
    model.traverse(o => { if (o.isLight || o.isCamera) lamps.push(o); });
    lamps.forEach(o => o.parent && o.parent.remove(o));

    const holder = new THREE.Group();
    holder.add(model);
    holder.rotation.y = cfg.rotY || 0;

    // Animation first so the measured pose matches reality
    if (gltf.animations.length) {
        cr.mixer = new THREE.AnimationMixer(model);
        if (cfg.clips) {
            cr.clips = {};
            gltf.animations.forEach(a => {
                const n = a.name.toLowerCase();
                const key = n.includes('run') ? 'run' : n.includes('walk') ? 'walk' : n.includes('idle') ? 'idle' : null;
                if (key) {
                    cr.clips[key] = cr.mixer.clipAction(a);
                    if (cfg.speeds && cfg.speeds[key]) cr.clips[key].timeScale = cfg.speeds[key];
                }
            });
            cr.clipNow = 'idle';
            const firstClip = cr.clips.idle || cr.clips.walk;
            if (firstClip) firstClip.play();
        } else {
            cr.mixer.clipAction(gltf.animations[0]).play();
        }
        cr.mixer.update(0.01);
    }
    holder.updateMatrixWorld(true);
    const bones = [];
    model.traverse(o => {
        if (o.isBone) {
            const w = new THREE.Vector3();
            o.getWorldPosition(w);
            bones.push(w);
        }
    });

    if (cfg.auto && bones.length) {
        const bb0 = new THREE.Box3();
        bones.forEach(p => bb0.expandByPoint(p));
        const c0 = bb0.getCenter(new THREE.Vector3()), s0 = bb0.getSize(new THREE.Vector3());
        const alongX = s0.x > s0.z;
        let top = bones[0];
        bones.forEach(p => { if (p.y > top.y) top = p; });
        const dx = alongX ? Math.sign(top.x - c0.x) || 1 : 0;
        const dz = alongX ? 0 : Math.sign(top.z - c0.z) || 1;
        holder.rotation.y = -Math.atan2(dx, dz);
        holder.updateMatrixWorld(true);
        bones.length = 0;
        model.traverse(o => {
            if (o.isBone) {
                const w = new THREE.Vector3();
                o.getWorldPosition(w);
                bones.push(w);
            }
        });
    }

    const bbB = new THREE.Box3();
    if (bones.length) bones.forEach(p => bbB.expandByPoint(p));
    else bbB.setFromObject(holder);
    const sz = bbB.getSize(new THREE.Vector3());
    const raw = Math.max(sz.x, sz.z, 0.001) * (bones.length ? 1.12 : 1);
    const k = cfg.len / raw;
    holder.scale.setScalar(k);
    holder.updateMatrixWorld(true);

    const bb2 = new THREE.Box3();
    if (bones.length) {
        bones.length = 0;
        model.traverse(o => {
            if (o.isBone) {
                const w = new THREE.Vector3();
                o.getWorldPosition(w);
                bones.push(w);
            }
        });
        bones.forEach(p => bb2.expandByPoint(p));
    } else {
        bb2.setFromObject(holder);
    }
    const c2 = bb2.getCenter(new THREE.Vector3());
    const footMin = bones.length ? bb2.min.y - 0.05 : bb2.min.y;
    holder.position.set(-c2.x, -footMin, -c2.z);
    holder.updateMatrixWorld(true);

    cr.mesh.add(holder);
    cr.extraMats = [];
    model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cl = mats.map(m => {
            const n = m.clone();
            n.transparent = false;
            cr.extraMats.push(n);
            return n;
        });
        o.material = Array.isArray(o.material) ? cl : cl[0];
        o.raycast = () => {};
    });

    cr.mesh.children.forEach(ch => {
        if (ch !== holder && !ch.userData.organ) {
            ch.visible = false;
            ch.traverse(m => { if (m.isMesh) m.raycast = () => {}; });
        }
    });

    const fin = new THREE.Box3();
    const tmp = new THREE.Vector3();
    if (bones.length) {
        model.traverse(o => {
            if (o.isBone) {
                o.getWorldPosition(tmp);
                fin.expandByPoint(tmp);
            }
        });
        fin.expandByScalar(0.25);
        fin.min.y = 0;
    } else {
        fin.setFromObject(holder);
    }
    const fs = fin.getSize(new THREE.Vector3()), fc = fin.getCenter(new THREE.Vector3());
    const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(fs.x, fs.y, fs.z),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    proxy.position.copy(fc);
    cr.mesh.add(proxy);

    if (cr.organs) {
        const [heart, lungs, brain] = cr.organs;
        heart.position.set(fc.x, fc.y, fc.z + 0.12 * fs.z);
        lungs.position.set(fc.x, fc.y + 0.06 * fs.y, fc.z + 0.2 * fs.z);
        brain.position.set(fc.x, fc.y + 0.25 * fs.y, fc.z + 0.42 * fs.z);
    }
    if (cfg.still) {
        cr.bob = holder;
        cr.bobY = holder.position.y;
    }
}

function animFor(c, moving) {
    if (!c.clips) return;
    const want = (c.state === 'HUNT' || c.state === 'FLEE') && moving ? 'run' : moving ? 'walk' : 'idle';
    const next = c.clips[want] || c.clips.walk;
    if (!next || c.clipNow === want) return;
    const cur = c.clips[c.clipNow] || c.clips.walk;
    next.reset().play();
    if (cur && cur !== next) cur.crossFadeTo(next, 0.25, false);
    c.clipNow = want;
}

export function applyTrexModel(cr) {
    const gltf = G.trexGLB;
    if (!gltf || cr.glbApplied) return;
    cr.glbApplied = true;
    const model = SkeletonUtils.clone(gltf.scene);
    const holder = new THREE.Group();
    holder.add(model);

    holder.updateMatrixWorld(true);
    const hipB = model.getObjectByName('hip_02_72_72');
    const headB = model.getObjectByName('head_08_9_9');
    if (hipB && headB) {
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        hipB.getWorldPosition(a);
        headB.getWorldPosition(b);
        const dx = b.x - a.x, dz = b.z - a.z;
        holder.rotation.y = Math.atan2(0, 1) - Math.atan2(dx, dz);
    }
    holder.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const k = 4.4 / Math.max(size.z, size.x, 0.001);
    holder.scale.setScalar(k);
    holder.updateMatrixWorld(true);

    const box2 = new THREE.Box3().setFromObject(holder);
    const c2 = box2.getCenter(new THREE.Vector3());
    let footMinY = Infinity;
    const _bp = new THREE.Vector3();
    model.traverse(o => {
        if (o.isBone && /Toe|Foot/i.test(o.name)) {
            o.getWorldPosition(_bp);
            footMinY = Math.min(footMinY, _bp.y);
        }
    });
    const footFloorY = isFinite(footMinY) ? footMinY - 0.06 : box2.min.y;
    holder.position.set(-c2.x, -footFloorY, -c2.z - 0.4);

    cr.mesh.add(holder);
    cr.extraMats = [];
    model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cl = mats.map(m => {
            const n = m.clone();
            n.transparent = false;
            cr.extraMats.push(n);
            return n;
        });
        o.material = Array.isArray(o.material) ? cl : cl[0];
        o.raycast = () => {};
    });

    cr.mesh.children.forEach(ch => {
        if (ch !== holder && !ch.userData.organ) {
            ch.visible = false;
            ch.traverse(m => { if (m.isMesh) m.raycast = () => {}; });
        }
    });

    cr.mesh.updateMatrixWorld(true);
    const bonesL = [];
    model.traverse(o => {
        if (o.isBone) {
            const w = new THREE.Vector3();
            o.getWorldPosition(w);
            bonesL.push({ n: o.name, p: cr.mesh.worldToLocal(w) });
        }
    });
    const bb = new THREE.Box3();
    bonesL.forEach(b => bb.expandByPoint(b.p));
    bb.expandByScalar(0.45);
    const bs = bb.getSize(new THREE.Vector3()), bc = bb.getCenter(new THREE.Vector3());
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    const bodyProxy = new THREE.Mesh(new THREE.BoxGeometry(bs.x, bs.y, bs.z), proxyMat);
    bodyProxy.position.copy(bc);
    cr.mesh.add(bodyProxy);

    const hipP = bonesL.find(b => b.n === 'hip_02_72_72');
    const headP = bonesL.find(b => b.n === 'head_08_9_9');
    if (hipP && headP && cr.organs) {
        const [heart, lungs, brain] = cr.organs;
        heart.position.copy(hipP.p).lerp(headP.p, 0.55);
        heart.position.y -= 0.1;
        lungs.position.copy(hipP.p).lerp(headP.p, 0.62);
        lungs.position.y += 0.1;
        brain.position.copy(headP.p);
        heart.scale.setScalar(2.2);
        lungs.scale.set(2.6, 2.0, 2.4);
        brain.scale.setScalar(2.0);
    }

    if (gltf.animations.length) {
        cr.mixer = new THREE.AnimationMixer(model);
        cr.mixer.clipAction(gltf.animations[0]).play();
    }
}
G.fn.applyTrexModel = applyTrexModel;

export function spawnCreature(type, x, z, tamed = false) {
    const spec = SPECIES[type];
    const root = new THREE.Group();
    const isDino = (type === 'raptor' || type === 'trex');

    const bodyMat = new THREE.MeshPhysicalMaterial({
        color: spec.col,
        normalMap: isDino ? scaleNormalTex : normalTex,
        normalScale: new THREE.Vector2(isDino ? 1.8 : 1.1, isDino ? 1.8 : 1.1),
        roughness: isDino ? 0.36 : 0.72,
        clearcoat: isDino ? 0.45 : 0.05,
        clearcoatRoughness: 0.25,
        sheen: isDino ? 0.1 : 0.65,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color(0xffe4c4),
        transparent: true,
        opacity: 1.0
    });

    const eyeMat = new THREE.MeshBasicMaterial({ color: spec.aggr ? 0xfacc15 : 0x111827 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xe7dfd3, roughness: 0.4 });

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.66, 20, 16), bodyMat);
    torso.scale.set(0.85, 0.96, 1.58);
    torso.position.y = 1.16;

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 0.88, 12), bodyMat);
    neck.position.set(0, 1.64, 0.82);
    neck.rotation.x = 0.42;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.86), bodyMat);
    head.position.set(0, 1.98, 1.16);

    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.52), bodyMat);
    snout.position.set(0, 1.91, 1.54);

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), eyeMat);
    eyeL.position.set(-0.22, 2.05, 1.32);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), eyeMat);
    eyeR.position.set(0.22, 2.05, 1.32);

    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.1, 1.12, 10), bodyMat);
    legL.position.set(-0.33, 0.56, 0.38);
    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.1, 1.12, 10), bodyMat);
    legR.position.set(0.33, 0.56, -0.38);
    let legBL = null, legBR = null;

    root.add(torso, neck, head, snout, eyeL, eyeR, legL, legR);

    if (!isDino) {
        legL.position.set(-0.32, 0.56, 0.52);
        legR.position.set(0.32, 0.56, 0.52);
        legBL = legL.clone(); legBL.position.set(-0.32, 0.56, -0.58);
        legBR = legR.clone(); legBR.position.set(0.32, 0.56, -0.58);
        root.add(legBL, legBR);

        if (type === 'deer') {
            [-0.2, 0.2].forEach(ax => {
                const mainBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, 0.72, 7), boneMat);
                mainBeam.position.set(ax, 2.42, 1.02);
                mainBeam.rotation.z = ax > 0 ? -0.42 : 0.42;
                const tine1 = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.35, 6), boneMat);
                tine1.position.set(ax * 1.45, 2.52, 1.18);
                tine1.rotation.x = 0.5;
                const tine2 = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.32, 6), boneMat);
                tine2.position.set(ax * 1.6, 2.68, 0.96);
                tine2.rotation.z = ax > 0 ? -0.8 : 0.8;
                root.add(mainBeam, tine1, tine2);
            });
        }
    } else {
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.35, 12), bodyMat);
        tail.rotation.x = -Math.PI / 2.15;
        tail.position.set(0, 1.18, -1.62);
        const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.68), bodyMat);
        jaw.position.set(0, 1.74, 1.32);
        jaw.rotation.x = 0.18;
        root.add(tail, jaw);

        for (let t = -0.14; t <= 0.14; t += 0.07) {
            const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 5), boneMat);
            tooth.rotation.x = Math.PI;
            tooth.position.set(t, 1.84, 1.56);
            root.add(tooth);
        }
        for (let s = 0; s < 6; s++) {
            const spine = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 6), boneMat);
            spine.position.set(0, 1.72 - s * 0.06, 0.45 - s * 0.36);
            root.add(spine);
        }
    }

    const heartMat = new THREE.MeshBasicMaterial({ color: 0xff0033, depthTest: false, transparent: true, opacity: 0 });
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 14), heartMat);
    heart.position.set(0, 1.2, 0.52);
    heart.renderOrder = 999;
    heart.userData = { organ: 'ՍԻՐՏ (HEART)', mult: 3.5 };

    const lungMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false, transparent: true, opacity: 0 });
    const lungs = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), lungMat);
    lungs.scale.set(1.2, 0.85, 1.1);
    lungs.position.set(0, 1.28, 0.22);
    lungs.renderOrder = 998;
    lungs.userData = { organ: 'ԹՈՔԵՐ (LUNGS)', mult: 2.2 };

    const brainMat = new THREE.MeshBasicMaterial({ color: 0xc084fc, depthTest: false, transparent: true, opacity: 0 });
    const brain = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), brainMat);
    brain.position.set(0, 2.02, 1.08);
    brain.renderOrder = 999;
    brain.userData = { organ: 'ՈՒՂԵՂ (BRAIN)', mult: 4.0 };

    root.add(heart, lungs, brain);

    root.scale.setScalar(spec.sc);
    root.position.set(x, getTerrainHeight(x, z), z);
    root.rotation.y = Math.random() * 6.28;
    root.traverse(c => {
        if (c.isMesh && !c.userData.organ) {
            c.castShadow = true;
            c.receiveShadow = true;
        }
    });
    scene.add(root);

    const cr = {
        type, spec, mesh: root, bodyMat, legL, legR, legBL, legBR,
        organs: [heart, lungs, brain], organMats: [heartMat, lungMat, brainMat],
        hp: spec.hp, tamed, state: 'WANDER', ph: Math.random() * 6, attackCd: 0
    };
    creatures.push(cr);
    if (type === 'trex') {
        applyTrexModel(cr);
    } else if (ANIMAL_CFG[type]) {
        whenProp(type, () => {
            try {
                applyAnimalModel(cr);
            } catch (e) {
                cr.glbApplied = false;
                console.error('animal GLB', type, e);
                showGlbErr('Կենդանի GLB սխալ: ' + type + ' — ' + (e && e.message || e));
            }
        });
    }
    return cr;
}
G.fn.spawnCreature = spawnCreature;

export function damageCreature(c, dmg, organName) {
    if (!c || c.state === 'DEAD') return;
    c.hp -= dmg;
    if (c.spec.aggr) c.state = 'HUNT';
    else c.state = 'FLEE';

    if (c.hp <= 0) {
        c.state = 'DEAD';
        setBodyOpacity(c, 1.0);
        c.organMats.forEach(m => { m.opacity = 0; });
        c.mesh.rotation.z = Math.PI / 2;
        const bonus = organName ? c.spec.reward * 2 : c.spec.reward;
        player.cash += bonus;
        player.xp += 100;
        player.meat += 2;
        sfx.roar(c.type === 'trex');
        G.ui.syncUI();
        G.ui.pushFeed(organName
            ? `🫀 CRITICAL ${organName} SHOT! ${c.spec.name} (+$${bonus})`
            : `🎯 Որսացաք՝ ${c.spec.name} (+$${bonus})`);
    }
}

function dryAnimalSpot(cx, cz, rx, rz) {
    for (let tries = 0; tries < 30; tries++) {
        const x = cx + (Math.random() - 0.5) * rx;
        const z = cz + (Math.random() - 0.5) * rz;
        if (getTerrainHeight(x, z) > 0.45 && Math.abs(x - getRoadCenterX(z)) > 7 &&
            Math.hypot(x + 45, z + 45) > 22 && Math.hypot(x + 48, z + 32) > 16 &&
            Math.hypot(x + 45, z + 62) > 18 && Math.hypot(x - CABIN.x, z - CABIN.z) > 14) {
            return [x, z];
        }
    }
    return [cx, cz];
}

export function initAnimals() {
    for (let i = 0; i < 6; i++) { const [x, z] = dryAnimalSpot(-10, -52, 60, 55); spawnCreature('deer', x, z); }
    for (let i = 0; i < 4; i++) { const [x, z] = dryAnimalSpot(58, -47, 45, 45); spawnCreature('wolf', x, z); }
    for (let i = 0; i < 3; i++) { const [x, z] = dryAnimalSpot(-63, 52, 35, 35); spawnCreature('bear', x, z); }
    for (let i = 0; i < 3; i++) { const [x, z] = dryAnimalSpot(85, -5, 35, 45); spawnCreature('cheetah', x, z); }
    for (let i = 0; i < 4; i++) { const [x, z] = dryAnimalSpot(62, 58, 45, 45); spawnCreature('raptor', x, z); }

    let best = null;
    for (let r = 50; r <= 90 && !best; r += 3) {
        for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2;
            const x = Math.cos(a) * r, z = 8 + Math.sin(a) * r;
            if (getTerrainHeight(x, z) > 1.2 && getTerrainHeight(x + 6, z) > 1 && getTerrainHeight(x - 6, z) > 1 &&
                getTerrainHeight(x, z + 6) > 1 && getTerrainHeight(x, z - 6) > 1) {
                let dry = true;
                for (let t = 1; t < 16 && dry; t++) {
                    dry = getTerrainHeight(x * (1 - t / 16), z + (8 - z) * (t / 16)) > -0.3;
                }
                if (dry) { best = [x, z]; break; }
            }
        }
    }
    best = best || [-35, -75];
    spawnCreature('trex', best[0], best[1]);
    spawnCreature('raptor', -8, 12, true);
}

// ---- Policeman: armed SWAT officers holding PT92 Pistol GLB ----
const _ikP1 = new THREE.Vector3(), _ikP2 = new THREE.Vector3(), _ikD1 = new THREE.Vector3(), _ikD2 = new THREE.Vector3();
const _ikQ = new THREE.Quaternion(), _ikPQ = new THREE.Quaternion(), _ikBQ = new THREE.Quaternion();
const _aimPt = new THREE.Vector3(), _rElbow = new THREE.Vector3(), _lElbow = new THREE.Vector3();

export function aimBoneToward(bone, child, worldTarget) {
    if (!bone || !child || !bone.parent) return;
    bone.getWorldPosition(_ikP1);
    child.getWorldPosition(_ikP2);
    _ikD1.subVectors(_ikP2, _ikP1);
    _ikD2.subVectors(worldTarget, _ikP1);
    if (_ikD1.lengthSq() < 1e-6 || _ikD2.lengthSq() < 1e-6) return;
    _ikD1.normalize();
    _ikD2.normalize();
    _ikQ.setFromUnitVectors(_ikD1, _ikD2);
    bone.parent.getWorldQuaternion(_ikPQ);
    bone.getWorldQuaternion(_ikBQ);
    bone.quaternion.copy(_ikPQ.invert().multiply(_ikQ).multiply(_ikBQ));
    bone.updateMatrixWorld(true);
}

export function makeOfficer() {
    const gl = PROPS.copman;
    if (!gl) return null;
    const model = SkeletonUtils.clone(gl.scene);
    const mx = new THREE.AnimationMixer(model);
    const acts = {};
    gl.animations.forEach(a => { acts[a.name] = mx.clipAction(a); });
    if (acts.idle) { acts.idle.play(); mx.update(0.01); }

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
    if (!isFinite(minY)) {
        const bb = new THREE.Box3().setFromObject(holder);
        minY = bb.min.y;
        maxY = bb.max.y;
    }
    const k = 1.8 / Math.max(0.001, (maxY - minY) * 1.08);
    holder.scale.setScalar(k);
    holder.position.y = -minY * k;
    model.traverse(o => {
        if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            o.frustumCulled = false;
            o.raycast = () => {};
        }
    });

    const root = new THREE.Group();
    root.add(holder);

    // Reliable non-skinned hit proxy for officer shooting
    const hitProxy = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 1.85, 0.55),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    hitProxy.position.set(0, 0.92, 0);
    root.add(hitProxy);

    const gun = new THREE.Group();
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sparkTex, color: 0xffd166, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending
    }));
    flash.scale.setScalar(0.32);
    flash.visible = false;
    const muzzle = new THREE.Object3D();

    const attachPolicePistol = (gltf) => {
        gun.children.slice().forEach(ch => { if (ch !== flash && ch !== muzzle) gun.remove(ch); });
        const raw = gltf.scene.clone(true);
        const rm = [];
        raw.traverse(n => {
            if (/^magazine$/i.test(n.name || '')) rm.push(n);
            else if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
        });
        rm.forEach(n => n.parent && n.parent.remove(n));
        raw.rotation.set(0, Math.PI / 2, 0);
        const sc = 0.26 / 1.51;
        raw.scale.setScalar(sc);
        raw.position.set(0, 0.10 * sc, 0.72 * sc);
        gun.add(raw);
        muzzle.position.set(0, 0.082, 0.215);
        flash.position.set(0, 0.082, 0.235);
    };

    if (PROPS.pistol) {
        attachPolicePistol(PROPS.pistol);
    } else {
        const gunMat = new THREE.MeshStandardMaterial({ color: 0x181a1e, metalness: 0.78, roughness: 0.32 });
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.048, 0.22), gunMat);
        slide.position.set(0, 0.06, 0.08);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.10, 0.042), gunMat);
        grip.rotation.x = -0.22;
        gun.add(slide, grip);
        muzzle.position.set(0, 0.07, 0.20);
        flash.position.set(0, 0.07, 0.22);
        whenProp('pistol', attachPolicePistol);
    }
    gun.add(flash, muzzle);
    gun.position.set(-0.08, 1.38, 0.48);
    root.add(gun);

    const bones = {};
    model.traverse(o => {
        if (!o.isBone) return;
        if (/RightArm/i.test(o.name)) bones.rArm = o;
        else if (/RightForeArm/i.test(o.name)) bones.rFore = o;
        else if (/RightHand/i.test(o.name) && !/Thumb|Index|Middle|Ring|Pinky/i.test(o.name)) bones.rHand = o;
        else if (/LeftArm/i.test(o.name)) bones.lArm = o;
        else if (/LeftForeArm/i.test(o.name)) bones.lFore = o;
        else if (/LeftHand/i.test(o.name) && !/Thumb|Index|Middle|Ring|Pinky/i.test(o.name)) bones.lHand = o;
    });
    root.userData = {
        hp: 65, maxHp: 65, dead: false,
        mixer: mx, acts, now: 'idle', gun, muzzle, flash,
        flashT: 0, recoil: 0, deployed: false, side: 1, bones
    };
    return root;
}
G.fn.makeOfficer = makeOfficer;

function poseOfficerHands(o) {
    const ud = o.userData, b = ud.bones;
    if (!b || !b.rArm || !b.rFore || !b.rHand || !ud.gun) return;
    o.updateMatrixWorld(true);
    if (ud.now === 'run' && ud.recoil <= 0.05) {
        b.rHand.getWorldPosition(_ikP1);
        o.worldToLocal(_ikP1);
        ud.gun.position.set(_ikP1.x, _ikP1.y - 0.02, _ikP1.z + 0.05);
        ud.gun.rotation.set(0.45, 0, 0);
        return;
    }
    const t = performance.now() * 0.004 + (ud.side || 1) * 1.7;
    const walkBob = ud.now === 'walk' ? Math.sin(t * 2.4) * 0.045 : Math.sin(t) * 0.018;
    const swayX = Math.cos(t * 0.9) * 0.025;
    const kickY = (ud.recoil || 0) * 0.075, kickZ = (ud.recoil || 0) * 0.06;

    _aimPt.set(-0.06 + swayX, 1.38 + walkBob + kickY, 0.56 - kickZ).applyMatrix4(o.matrixWorld);
    _rElbow.set(-0.27 + swayX * 0.5, 1.28 + walkBob * 0.6 + kickY * 0.4, 0.24 - kickZ * 0.5).applyMatrix4(o.matrixWorld);
    aimBoneToward(b.rArm, b.rFore, _rElbow);
    aimBoneToward(b.rFore, b.rHand, _aimPt);
    b.rHand.getWorldPosition(_ikP1);
    if (b.lArm && b.lFore && b.lHand) {
        _lElbow.set(0.24 + swayX * 0.5, 1.26 + walkBob * 0.6 + kickY * 0.4, 0.26 - kickZ * 0.5).applyMatrix4(o.matrixWorld);
        aimBoneToward(b.lArm, b.lFore, _lElbow);
        aimBoneToward(b.lFore, b.lHand, _ikP1);
    }
    o.worldToLocal(_ikP1);
    ud.gun.position.set(_ikP1.x, _ikP1.y - 0.01, _ikP1.z + 0.055 - ud.recoil * 0.04);
    ud.gun.rotation.x -= ud.recoil * 0.22;
}

export function spawnSwatPatrol() {
    const roadZ = Math.max(-300, Math.min(300, player.z - 65));
    const roadX = getRoadCenterX(roadZ);
    const g = new THREE.Group();
    const tankCount = swatUnits.filter(u => u.isTank).length;
    const spawnTank = player.wanted >= 5 && PROPS.tank && tankCount < 2;
    const wrap = { mesh: g, wheels: [] };
    if (spawnTank) {
        applyCarGLB(wrap, PROPS.tank, 7.2, 0, null, null);
    } else if (PROPS.cop) {
        applyCarGLB(wrap, PROPS.cop, 5.4, -Math.PI / 2, null, null);
    } else {
        const swatMat = new THREE.MeshPhysicalMaterial({ color: 0x1e3a8a, roughness: 0.35, clearcoat: 0.3 });
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.78, 0.32), swatMat);
        torso.position.y = 1.15;
        g.add(torso);
    }
    const lx = roadX + (swatUnits.length % 2 ? 2.5 : -2.5);
    const roadZ2 = roadZ - swatUnits.length * 10;
    g.position.set(lx, groundY(lx, roadZ2), roadZ2);
    scene.add(g);

    const officers = [];
    if (!spawnTank) {
        for (const side of [-1, 1]) {
            const o = makeOfficer();
            if (!o) break;
            o.userData.side = side;
            o.position.x = side * 2.0;
            o.position.z = 0.8;
            o.visible = false;
            g.add(o);
            officers.push(o);
        }
    } else {
        G.ui.pushFeed('🪖 5 ԱՍՏՂ! Բանակային Panzer IV ՏԱՆԿԸ գալիս է քո դեմ!');
    }
    swatUnits.push({
        mesh: g,
        type: spawnTank ? 'tank' : 'cop',
        isTank: spawnTank,
        carDead: false,
        colBox: wrap.colBox,
        hp: spawnTank ? 520 : 160,
        shootCd: spawnTank ? 2.0 : 1.2,
        officers
    });
}
G.fn.spawnSwatPatrol = spawnSwatPatrol;

function swingLegs(c, amount) {
    const s = Math.sin(c.walk) * amount;
    c.legL.rotation.x = s;
    c.legR.rotation.x = -s;
    if (c.legBL) {
        c.legBL.rotation.x = -s;
        c.legBR.rotation.x = s;
    }
}

const _crObsOut = { x: 0, z: 0, hit: false };
const _qCrDyn = [];
const _swObsOut = { x: 0, z: 0, hit: false };
const _qSwDyn = [];
const _swatFrom = new THREE.Vector3();
const _swatTo = new THREE.Vector3();

export function updateCreatures(dt) {
    creatures.forEach(c => {
        const m = c.mesh;
        if (c.walk === undefined) c.walk = 0;
        if (c.mixer && c.state !== 'DEAD') {
            const mv = c.state === 'HUNT' || c.state === 'FLEE' || c.wGo || (c.tamed && c.followT > 0);
            c.mixer.update(c.clips ? dt : dt * (mv ? (c.state === 'HUNT' || c.state === 'FLEE' ? 1.6 : 0.8) : 0.05));
        }

        if (c.state === 'DEAD') {
            if (!c.settled) {
                c.settled = true;
                m.updateMatrixWorld(true);
                const bb = new THREE.Box3().setFromObject(m);
                const gy = getTerrainHeight(m.position.x, m.position.z);
                if (isFinite(bb.min.y)) m.position.y += gy - bb.min.y - 0.08;
                else m.position.y = gy;
            }
            return;
        }
        if (c === player.mount) {
            const movingMount = keys['w'] || keys['s'] || keys['a'] || keys['d'] || player.joyMag > 0.1;
            if (movingMount) c.walk += dt * 14;
            swingLegs(c, (keys['w'] || keys['s'] || player.joyMag > 0.1) ? 0.7 : 0);
            return;
        }

        // Underground cabin isolation: outside animals cannot target or swarm player at (0,0)
        if (player.inHouse && c.state === 'HUNT') {
            c.state = 'WANDER';
        }

        const px = m.position.x, pz = m.position.z;
        const dx = player.x - px, dz = player.z - pz;
        const dist = Math.hypot(dx, dz) || 0.001;
        const sc = c.spec.sc;
        let speed = 0, dirX = 0, dirZ = 0;

        if (c.tamed) {
            if (c.followT > 0) c.followT -= dt;
            if (!player.inHouse && c.followT > 0 && dist > 7) {
                dirX = dx;
                dirZ = dz;
                speed = Math.min(c.spec.spd * 1.1, 3 + dist * 0.6);
            }
        } else if (c.state === 'FLEE') {
            dirX = -dx;
            dirZ = -dz;
            speed = c.spec.spd * 1.15;
            if (dist > 70) c.state = 'WANDER';
        } else {
            if (!player.inHouse) {
                const sense = player.stealth ? 9 : 24;
                let diff = Math.atan2(dx, dz) - m.rotation.y;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                const sees = Math.abs(diff) < 0.7 || dist < 6;
                const hunters = creatures.reduce((n, o) => n + (o.state === 'HUNT' && o.spec.aggr ? 1 : 0), 0);
                if (c.spec.aggr && c.state !== 'HUNT' && dist < sense && sees && hunters < 2 && player.hp > 0) {
                    c.state = 'HUNT';
                    if (c.type === 'trex') {
                        sfx.roar(true);
                        G.ui.pushFeed('🦖 Ալֆա T-Rex-ը նկատեց ձեզ!');
                    }
                }
            }

            if (c.state === 'HUNT' && !player.inHouse) {
                if (dist > 55) {
                    c.state = 'WANDER';
                } else if (dist > 2.4 * sc + 0.6) {
                    dirX = dx;
                    dirZ = dz;
                    speed = c.spec.spd * (c.type === 'trex' ? 0.55 : 0.8);
                } else {
                    dirX = dx;
                    dirZ = dz;
                    c.attackCd -= dt;
                    if (c.attackCd <= 0 && Math.abs(player.y - m.position.y) < 3.5) {
                        c.attackCd = 1.1;
                        const dmg = c.type === 'trex' ? 28 : c.type === 'bear' ? 18 : c.type === 'raptor' ? 12 : 9;
                        G.fn.damagePlayer(dmg, c.spec.name);
                        sfx.roar(false);
                    }
                }
            } else {
                c.wt = (c.wt === undefined ? 0 : c.wt) - dt;
                if (c.wt <= 0) {
                    c.wt = 3 + Math.random() * 5;
                    c.wAng = Math.random() * Math.PI * 2;
                    c.wGo = Math.random() < 0.65;
                }
                if (c.wGo) {
                    dirX = Math.sin(c.wAng);
                    dirZ = Math.cos(c.wAng);
                    speed = c.type === 'trex' ? 1.2 : 1.6;
                }
            }
        }

        if (dirX !== 0 || dirZ !== 0) {
            m.rotation.y = angleLerp(m.rotation.y, Math.atan2(dirX, dirZ), Math.min(1, dt * 6));
        }
        if (speed > 0) {
            let nx = px + Math.sin(m.rotation.y) * speed * dt;
            let nz = pz + Math.cos(m.rotation.y) * speed * dt;
            const crR = c.type === 'trex' ? 1.85 : c.type === 'bear' ? 1.1 : 0.78;
            let blocked = false;

            resolveStaticObstacles(nx, nz, getTerrainHeight(nx, nz), crR, _crObsOut, true);
            if (_crObsOut.hit) {
                nx = _crObsOut.x;
                nz = _crObsOut.z;
                blocked = true;
            }

            dynamicGrid.query(nx, nz, crR + 4.5, _qCrDyn);
            for (let i = 0; i < _qCrDyn.length; i++) {
                const o = _qCrDyn[i].ref;
                if (!o || o.isBoat || (o.flies && o.mesh.position.y > groundY(o.mesh.position.x, o.mesh.position.z) + 2)) continue;
                const rad = (o.colBox ? Math.max(o.colBox.hw, o.colBox.hl) * 0.8 : 2.0) + crR;
                const ddx = nx - o.mesh.position.x, ddz = nz - o.mesh.position.z;
                if (Math.abs(ddx) < rad && Math.abs(ddz) < rad) {
                    const dd = Math.hypot(ddx, ddz);
                    if (dd < rad && dd > 0.001) {
                        nx = o.mesh.position.x + (ddx / dd) * rad;
                        nz = o.mesh.position.z + (ddz / dd) * rad;
                        blocked = true;
                    }
                }
            }

            if (!player.vehicle && !player.inHouse) {
                const pRad = crR + 0.55;
                const ddx = nx - player.x, ddz = nz - player.z;
                const dd = Math.hypot(ddx, ddz);
                if (dd < pRad && dd > 0.001) {
                    nx = player.x + (ddx / dd) * pRad;
                    nz = player.z + (ddz / dd) * pRad;
                }
            }
            const hN = getTerrainHeight(nx, nz), hNow = getTerrainHeight(px, pz);
            if (Math.abs(nx) < 310 && Math.abs(nz) < 310 && (hN > -0.45 || hN > hNow + 0.005)) {
                m.position.x = nx;
                m.position.z = nz;
                if (blocked && c.state === 'WANDER') c.wAng = (c.wAng || 0) + 0.9;
            } else {
                c.wt = 0;
                c.wAng = (c.wAng || 0) + Math.PI * (0.7 + Math.random() * 0.6);
            }
            c.walk += dt * speed * 1.5;
            swingLegs(c, Math.min(0.7, 0.15 + speed * 0.07));
        } else {
            swingLegs(c, 0);
        }
        m.position.y = getTerrainHeight(m.position.x, m.position.z);
        animFor(c, speed > 0.3);
        if (c.bob) {
            c.bob.position.y = c.bobY + (speed > 0.3 ? Math.abs(Math.sin(c.walk * 1.4)) * 0.06 : 0);
        }
    });
}

export function updateSwat(dt) {
    // Pause outside SWAT swarming, targeting and attacks when player is inside cabin
    if (player.inHouse) return;

    if (player.wanted > 0) {
        G.swatTimer -= dt;
        const needTank = player.wanted >= 5 && PROPS.tank && swatUnits.filter(u => u.isTank).length < 2;
        if (G.swatTimer <= 0 && (swatUnits.length < 1 + player.wanted || needTank)) {
            spawnSwatPatrol();
            G.swatTimer = needTank ? 3.5 : 1;
        }
        if (swatUnits.length === 0) {
            G.wantedTimer += dt;
            if (G.wantedTimer > 15) {
                G.wantedTimer = 0;
                player.wanted--;
                G.ui.syncUI();
                G.ui.pushFeed('★ Wanted level-ը նվազեց');
            }
        } else {
            G.wantedTimer = 0;
        }
    }

    swatUnits.forEach(s => {
        if ((s.noCar || s.carDead) && s.officers && s.officers.length > 0 && s.officers[0]) {
            s.mesh.position.copy(s.officers[0].position);
        }
        const sx = s.mesh.position.x, sz = s.mesh.position.z;
        const dx = player.x - sx, dz = player.z - sz;
        const dist = Math.hypot(dx, dz) || 0.001;
        const stopDist = s.isTank ? 26 : 20;

        if (!s.noCar && !s.carDead && dist > stopDist) {
            s.mesh.rotation.y = angleLerp(s.mesh.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * (s.isTank ? 2.2 : 4)));
            const sp = (s.isTank ? 10.5 : 14) * dt;
            let px = sx + (dx / dist) * sp;
            let pz = sz + (dz / dist) * sp;

            dynamicGrid.query(px, pz, 8, _qSwDyn);
            for (let i = 0; i < _qSwDyn.length; i++) {
                const entry = _qSwDyn[i];
                const o = entry.ref;
                if (!o || o === s) continue;
                if (entry.kind === 'traf') {
                    const ex = px - o.mesh.position.x, ez = pz - o.mesh.position.z;
                    const d = Math.hypot(ex, ez);
                    if (d < 6 && d > 0.01) { px += (ex / d) * (6 - d); pz += (ez / d) * (6 - d); }
                } else if (entry.kind === 'swat') {
                    const ex = px - o.mesh.position.x, ez = pz - o.mesh.position.z;
                    const d = Math.hypot(ex, ez);
                    if (d < 7 && d > 0.01) { px += (ex / d) * (7 - d) * 0.5; pz += (ez / d) * (7 - d) * 0.5; }
                }
            }
            resolveStaticObstacles(px, pz, s.mesh.position.y, s.isTank ? 2.2 : 1.4, _swObsOut, true);
            px = _swObsOut.x;
            pz = _swObsOut.z;

            if (getTerrainHeight(px, pz) > -0.2) {
                s.mesh.position.x = px;
                s.mesh.position.z = pz;
                alignVehicleToGround(s, dt);
            }
        }

        if (s.officers) {
            for (let oi = 0; oi < s.officers.length; oi++) {
                const o = s.officers[oi];
                if (!o || o.userData.dead) continue;
                const ud = o.userData;
                if (!ud.deployed) {
                    if (!s.carDead && dist <= 24) {
                        ud.deployed = true;
                        const sn = Math.sin(s.mesh.rotation.y), cs = Math.cos(s.mesh.rotation.y);
                        const wx = s.mesh.position.x + ud.side * 2.2 * cs + 0.6 * sn;
                        const wz = s.mesh.position.z - ud.side * 2.2 * sn + 0.6 * cs;
                        if (o.parent) o.parent.remove(o);
                        o.position.set(wx, groundY(wx, wz), wz);
                        o.rotation.set(0, Math.atan2(player.x - wx, player.z - wz), 0);
                        o.visible = true;
                        scene.add(o);
                    } else {
                        o.visible = false;
                        continue;
                    }
                }
                const odx = player.x - o.position.x, odz = player.z - o.position.z;
                const odist = Math.hypot(odx, odz) || 0.001;
                o.rotation.y = angleLerp(o.rotation.y, Math.atan2(odx, odz), Math.min(1, dt * 8));
                let spd = 0, want = 'idle';
                if (odist > 14) { spd = 4.2; want = 'run'; }
                else if (odist > 7.5) { spd = 2.0; want = 'walk'; }
                if (spd > 0) {
                    const strafe = want === 'walk' ? ud.side * 0.45 : 0;
                    const mx = (odx / odist - (odz / odist) * strafe) * spd * dt;
                    const mz = (odz / odist + (odx / odist) * strafe) * spd * dt;
                    let nx = o.position.x + mx, nz = o.position.z + mz;

                    resolveStaticObstacles(nx, nz, o.position.y, 0.52, _swObsOut, true);
                    nx = _swObsOut.x;
                    nz = _swObsOut.z;

                    dynamicGrid.query(nx, nz, 4.0, _qSwDyn);
                    for (let di = 0; di < _qSwDyn.length; di++) {
                        const v = _qSwDyn[di].ref;
                        if (!v || v.isBoat || (v.flies && v.mesh.position.y > groundY(v.mesh.position.x, v.mesh.position.z) + 2)) continue;
                        const vRad = (v.colBox ? Math.max(v.colBox.hw, v.colBox.hl) * 0.8 : 1.9) + 0.5;
                        const ex = nx - v.mesh.position.x, ez = nz - v.mesh.position.z;
                        const ed = Math.hypot(ex, ez);
                        if (ed < vRad && ed > 0.01) {
                            nx = v.mesh.position.x + (ex / ed) * vRad;
                            nz = v.mesh.position.z + (ez / ed) * vRad;
                        }
                    }

                    if (getTerrainHeight(nx, nz) > -0.25) {
                        o.position.x = nx;
                        o.position.z = nz;
                    }
                }
                o.position.y = groundY(o.position.x, o.position.z);
                if (ud.acts && ud.now !== want && ud.acts[want]) {
                    ud.acts[want].reset().play();
                    if (ud.acts[ud.now]) ud.acts[ud.now].crossFadeTo(ud.acts[want], 0.22, false);
                    ud.now = want;
                }
                if (ud.mixer) ud.mixer.update(dt);
                if (ud.flashT > 0) {
                    ud.flashT -= dt;
                    if (ud.flashT <= 0 && ud.flash) ud.flash.visible = false;
                }
                if (ud.recoil > 0) ud.recoil = Math.max(0, ud.recoil - dt * 2.5);
                if (ud.gun) {
                    const bob = spd > 0 ? Math.sin(performance.now() * 0.012) * 0.02 : 0;
                    ud.gun.position.set(-0.14, 1.32 + bob, 0.36 - ud.recoil * 0.1);
                    const pitchAim = THREE.MathUtils.clamp(-Math.atan2((player.y + 1.2) - (o.position.y + 1.32), odist), -0.45, 0.45);
                    ud.gun.rotation.x = pitchAim;
                }
                poseOfficerHands(o);
            }
        }

        if (s.isTank) {
            s.mesh.rotation.y = angleLerp(s.mesh.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 1.8));
            if (dist <= 48) {
                s.shootCd -= dt;
                if (s.shootCd <= 0) {
                    s.shootCd = 2.6 + Math.random() * 0.9;
                    const sn = Math.sin(s.mesh.rotation.y), cs = Math.cos(s.mesh.rotation.y);
                    _swatFrom.set(sx + sn * 3.8, s.mesh.position.y + 1.95, sz + cs * 3.8);
                    _swatTo.set(player.x + (Math.random() - 0.5) * 3.2, player.y + 0.8, player.z + (Math.random() - 0.5) * 3.2);
                    sfx.gunshot('rpg');
                    G.fn.spawnSparks(_swatFrom, 0xf97316, 12);
                    G.fn.spawnSparks(_swatTo, 0xf97316, 26);
                    G.fn.addTracer(_swatFrom, _swatTo, 0xffa500, 0.22);
                    G.camShake = Math.max(G.camShake, 0.28);
                    if (Math.hypot(_swatTo.x - player.x, _swatTo.z - player.z) < 4.0) {
                        G.fn.damagePlayer(22, '🪖 Բանակային Տանկ');
                    }
                }
            }
        } else {
            const active = (s.officers || []).filter(o => o && !o.userData.dead && o.userData.deployed && o.visible);
            const canShoot = active.length > 0 || (!s.carDead && dist <= 24);
            if (canShoot && dist <= 32) {
                s.shootCd -= dt;
                if (s.shootCd <= 0) {
                    s.shootCd = 1.0 + Math.random() * 0.6;
                    const shooter = active.length ? active[Math.floor(Math.random() * active.length)] : null;
                    if (Math.random() < 0.5) G.fn.damagePlayer(7 + player.wanted * 1.5, 'SWAT');
                    if (shooter && shooter.userData.muzzle) {
                        shooter.updateMatrixWorld(true);
                        shooter.userData.muzzle.getWorldPosition(_swatFrom);
                        shooter.userData.recoil = 1.0;
                        if (shooter.userData.flash) {
                            shooter.userData.flash.visible = true;
                            shooter.userData.flashT = 0.07;
                        }
                    } else {
                        _swatFrom.set(sx, s.mesh.position.y + 1.1, sz);
                    }
                    _swatTo.set(player.x, player.y + 1.25, player.z);
                    G.fn.addTracer(_swatFrom, _swatTo, 0xffd166);
                }
            }
        }
    });
}
