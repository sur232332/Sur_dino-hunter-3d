import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
    G, PROPS, propMixers, player,
    vehicles, pendingPorsche, traffic, fleeing, swatUnits, headLights,
    TRAFFIC_KINDS, DRIVER_TINTS, CABIN, CAMPFIRE, HELIPAD, HANGAR, whenProp
} from './state.js';
import { scene, normalTex } from './scene.js';
import {
    getTerrainHeight, getRoadCenterX, groundY, alignVehicleToGround, carGroundY, angleLerp
} from './physics.js';

export function plainGeo(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const ng = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
        const at = g.attributes[name], n = at.count, sz = at.itemSize, arr = new Float32Array(n * sz);
        for (let i = 0; i < n; i++) {
            arr[i * sz] = at.getX(i);
            if (sz > 1) arr[i * sz + 1] = at.getY(i);
            if (sz > 2) arr[i * sz + 2] = at.getZ(i);
            if (sz > 3) arr[i * sz + 3] = at.getW(i);
        }
        ng.setAttribute(name, new THREE.BufferAttribute(arr, sz));
    }
    return ng;
}

export function setupWheelSpin(v, re, maxRatio) {
    const g = v.mesh;
    const savedRx = g.rotation.x, savedRz = g.rotation.z;
    g.rotation.x = 0; g.rotation.z = 0; g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const cbb = new THREE.Box3().setFromObject(g).applyMatrix4(inv);
    const yLim = maxRatio ? cbb.min.y + (cbb.max.y - cbb.min.y) * maxRatio : Infinity;
    const targets = [];
    g.traverse(o => {
        if (!o.isMesh) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        if (ms.length === 1 && (re.test(ms[0].name || '') || re.test(o.name || ''))) targets.push(o);
    });
    const buckets = [[], [], [], []];
    const tmp = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    targets.forEach(m => {
        const geo = plainGeo(m.geometry);
        const P = geo.attributes.position, nTri = P.count / 3;
        const toCar = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        const lists = [[], [], [], [], []];
        for (let t = 0; t < nTri; t++) {
            A.fromBufferAttribute(P, t * 3);
            B.fromBufferAttribute(P, t * 3 + 1);
            C.fromBufferAttribute(P, t * 3 + 2);
            tmp.copy(A).add(B).add(C).multiplyScalar(1 / 3).applyMatrix4(toCar);
            lists[tmp.y > yLim || (maxRatio && tmp.z < cbb.min.z + (cbb.max.z - cbb.min.z) * 0.10)
                ? 4 : (tmp.x > 0 ? 1 : 0) + (tmp.z > 0 ? 2 : 0)].push(t);
        }
        lists.forEach((ts, q) => {
            if (!ts.length) return;
            const ng = new THREE.BufferGeometry();
            for (const name of Object.keys(geo.attributes)) {
                const at = geo.attributes[name], sz = at.itemSize, arr = new Float32Array(ts.length * 3 * sz);
                ts.forEach((t, i) => { for (let k = 0; k < 3 * sz; k++) arr[i * 3 * sz + k] = at.array[t * 3 * sz + k]; });
                ng.setAttribute(name, new THREE.BufferAttribute(arr, sz));
            }
            if (q < 4) {
                ng.applyMatrix4(toCar);
                buckets[q].push({ geo: ng, mat: m.material });
            } else {
                const nm = new THREE.Mesh(ng, m.material);
                nm.castShadow = true; nm.receiveShadow = true;
                nm.matrix.copy(m.matrix); nm.matrix.decompose(nm.position, nm.quaternion, nm.scale);
                m.parent.add(nm);
            }
        });
        m.parent.remove(m);
    });
    buckets.forEach((list, q) => {
        if (!list.length) return;
        const wb = new THREE.Box3();
        list.forEach(p => { p.geo.computeBoundingBox(); wb.union(p.geo.boundingBox); });
        const c = wb.getCenter(new THREE.Vector3());
        let cxx = 0, czz = 0, cxz = 0, nPts = 0;
        list.forEach(p => {
            p.geo.translate(-c.x, -c.y, -c.z);
            const pos = p.geo.attributes.position;
            const step = Math.max(1, Math.floor(pos.count / 400));
            for (let i = 0; i < pos.count; i += step) {
                const x = pos.getX(i), z = pos.getZ(i);
                cxx += x * x; czz += z * z; cxz += x * z; nPts++;
            }
        });
        if (nPts > 10 && czz > cxx * 1.15) {
            const ang = 0.5 * Math.atan2(2 * cxz, czz - cxx);
            if (Math.abs(ang) > 0.025 && Math.abs(ang) < 0.75) {
                list.forEach(p => p.geo.rotateY(-ang));
            }
        }
        const pivot = new THREE.Group();
        list.forEach(p => { const nm = new THREE.Mesh(p.geo, p.mat); nm.castShadow = true; nm.receiveShadow = true; pivot.add(nm); });
        v.wheels.push(pivot);
        if (q >= 2) {
            const steer = new THREE.Group(); steer.position.copy(c);
            steer.add(pivot); g.add(steer);
            (v.steers = v.steers || []).push(steer);
        } else {
            pivot.position.copy(c); g.add(pivot);
        }
    });
    g.rotation.x = savedRx; g.rotation.z = savedRz; g.updateMatrixWorld(true);
}

export function cropModel(model, keep) {
    model.updateMatrixWorld(true);
    const rm = [], A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    model.traverse(o => {
        if (!o.isMesh) return;
        const g = plainGeo(o.geometry);
        const P = g.attributes.position, keepT = [];
        for (let t = 0; t < P.count / 3; t++) {
            A.fromBufferAttribute(P, t * 3).applyMatrix4(o.matrixWorld);
            B.fromBufferAttribute(P, t * 3 + 1).applyMatrix4(o.matrixWorld);
            C.fromBufferAttribute(P, t * 3 + 2).applyMatrix4(o.matrixWorld);
            A.add(B).add(C).multiplyScalar(1 / 3);
            if (keep(A.x, A.y, A.z)) keepT.push(t);
        }
        if (!keepT.length) { rm.push(o); return; }
        const ng = new THREE.BufferGeometry();
        for (const name of Object.keys(g.attributes)) {
            const at = g.attributes[name], sz = at.itemSize, arr = new at.array.constructor(keepT.length * 3 * sz);
            keepT.forEach((t, i) => { for (let k = 0; k < 3 * sz; k++) arr[i * 3 * sz + k] = at.array[t * 3 * sz + k]; });
            ng.setAttribute(name, new THREE.BufferAttribute(arr, sz, at.normalized));
        }
        o.geometry = ng;
    });
    rm.forEach(o => o.parent && o.parent.remove(o));
}

export function applyCarGLB(v, gltf, len, rotY, dropMat, wheelRe, keep, wheelMaxRatio) {
    const model = gltf.scene.clone(true);
    if (keep) cropModel(model, keep);
    if (dropMat) {
        const rm = [];
        model.traverse(o => {
            if (o.isMesh) {
                const ms = Array.isArray(o.material) ? o.material : [o.material];
                if (ms.some(m => m.name === dropMat)) rm.push(o);
            }
        });
        rm.forEach(o => o.parent && o.parent.remove(o));
    }
    const holder = new THREE.Group(); holder.add(model); holder.rotation.y = rotY; holder.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    holder.scale.setScalar(len / Math.max(size.z, 0.001)); holder.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(holder), c2 = b2.getCenter(new THREE.Vector3());
    const sz2 = b2.getSize(new THREE.Vector3());
    holder.position.set(-c2.x, -b2.min.y, -c2.z);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    v.mesh.add(holder);
    v.colBox = {
        hw: Math.max(0.75, sz2.x * 0.46),
        hl: Math.max(1.10, sz2.z * 0.46),
        h: Math.max(1.50, sz2.y + 0.25)
    };
    if (wheelRe) setupWheelSpin(v, wheelRe, wheelMaxRatio);
}

export function applyPorsche(v) {
    if (!G.porscheGLB) { pendingPorsche.push(v); return; }
    const model = G.porscheGLB.scene.clone(true);
    const holder = new THREE.Group();
    holder.add(model);
    holder.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    const k = 5.7 / Math.max(size.z, 0.001);
    holder.scale.setScalar(k);
    holder.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(holder), c2 = b2.getCenter(new THREE.Vector3());
    const sz2 = b2.getSize(new THREE.Vector3());
    holder.position.set(-c2.x, -b2.min.y, -c2.z);
    v.colBox = {
        hw: Math.max(0.75, sz2.x * 0.46),
        hl: Math.max(1.10, sz2.z * 0.46),
        h: Math.max(1.50, sz2.y + 0.25)
    };
    model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
    });
    v.mesh.add(holder);
    setupWheelSpin(v, /rim|tire/i);
}
G.fn.applyPorsche = applyPorsche;

function makePoliceBoat(v) {
    v.mesh.traverse(o => {
        if (!o.isMesh) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        const cl = ms.map(m => { const n = m.clone(); n.color = new THREE.Color(0x8fb0ff); return n; });
        o.material = Array.isArray(o.material) ? cl : cl[0];
    });
    v.mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(v.mesh.matrixWorld).invert();
    const bb = new THREE.Box3().setFromObject(v.mesh).applyMatrix4(inv);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#1e3a8a'; g.fillRect(0, 96, 512, 32);
    g.font = 'bold 84px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('POLICE', 256, 50);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    const len = (bb.max.z - bb.min.z) * 0.42, hgt = len / 4;
    for (const side of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), signMat);
        p.position.set(side * (bb.max.x + 0.03), bb.min.y + (bb.max.y - bb.min.y) * 0.42, (bb.min.z + bb.max.z) / 2);
        p.rotation.y = side * Math.PI / 2;
        v.mesh.add(p);
    }
    const red = new THREE.MeshBasicMaterial({ color: 0xff2020 }), blue = new THREE.MeshBasicMaterial({ color: 0x2050ff });
    const lr = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.25), red), lb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.25), blue);
    const topY = bb.max.y + 0.09, zc = (bb.min.z + bb.max.z) / 2;
    lr.position.set(-0.3, topY, zc); lb.position.set(0.3, topY, zc);
    const pl = new THREE.PointLight(0xff2020, 8, 14, 2); pl.position.set(0, topY + 0.3, zc);
    v.mesh.add(lr, lb, pl);
    let t = 0;
    propMixers.push({
        update(dt) {
            t += dt; const on = Math.floor(t * 4) % 2 === 0;
            red.color.setHex(on ? 0xff2020 : 0x330000);
            blue.color.setHex(on ? 0x000833 : 0x2050ff);
            pl.color.setHex(on ? 0xff2020 : 0x2050ff);
        }
    });
    v.name = 'Ոստիկանական Նավակ 🚔🚤';
}

function splitRotor(v) {
    const g = v.mesh;
    const sRx = g.rotation.x, sRz = g.rotation.z;
    g.rotation.x = 0; g.rotation.z = 0; g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const bb = new THREE.Box3().setFromObject(g).applyMatrix4(inv);
    const H = bb.max.y - bb.min.y, W = bb.max.x - bb.min.x, L = bb.max.z - bb.min.z;
    const cx = (bb.min.x + bb.max.x) * 0.5, cz = (bb.min.z + bb.max.z) * 0.5;
    const meshes = []; g.traverse(o => { if (o.isMesh && o.visible && o !== v.rotors) meshes.push(o); });

    const rotorMeshes = [];
    const rotorBox = new THREE.Box3();
    meshes.forEach(o => {
        const mb = new THREE.Box3().setFromObject(o).applyMatrix4(inv);
        const ms = mb.getSize(new THREE.Vector3());
        if (ms.x > W * 0.55 && ms.z > W * 0.45 && ms.y < H * 0.25 && mb.min.y > bb.min.y + H * 0.55) {
            rotorMeshes.push(o);
            rotorBox.union(mb);
        }
    });
    if (rotorMeshes.length) {
        const hub = rotorBox.getCenter(new THREE.Vector3());
        const pivot = new THREE.Group();
        pivot.position.set(hub.x, hub.y, hub.z);
        g.add(pivot); g.updateMatrixWorld(true);
        rotorMeshes.forEach(o => pivot.attach(o));
        if (v.rotors) v.rotors.visible = false;
        v.rotors = pivot;
        v.rotorSpd = 0;
        g.rotation.x = sRx; g.rotation.z = sRz; g.updateMatrixWorld(true);
        return;
    }

    const thr = bb.max.y - H * 0.10;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), M = new THREE.Matrix4();
    const parts = [];
    meshes.forEach(o => {
        const geo = plainGeo(o.geometry);
        const P = geo.attributes.position, n = P.count / 3; M.multiplyMatrices(inv, o.matrixWorld);
        const top = [], rest = [];
        for (let t = 0; t < n; t++) {
            A.fromBufferAttribute(P, t * 3).applyMatrix4(M);
            B.fromBufferAttribute(P, t * 3 + 1).applyMatrix4(M);
            C.fromBufferAttribute(P, t * 3 + 2).applyMatrix4(M);
            const tx = (A.x + B.x + C.x) / 3, ty = (A.y + B.y + C.y) / 3, tz = (A.z + B.z + C.z) / 3;
            const isTailFin = Math.abs(tx - cx) < W * 0.08 && Math.abs(tz - cz) > L * 0.34;
            (ty > thr && !isTailFin ? top : rest).push(t);
        }
        if (!top.length) return;
        const build = (ts, bake) => {
            const ng = new THREE.BufferGeometry();
            for (const name of Object.keys(geo.attributes)) {
                const at = geo.attributes[name], sz = at.itemSize, arr = new Float32Array(ts.length * 3 * sz);
                ts.forEach((t, i) => { for (let k = 0; k < 3 * sz; k++) arr[i * 3 * sz + k] = at.array[t * 3 * sz + k]; });
                ng.setAttribute(name, new THREE.BufferAttribute(arr, sz));
            }
            if (bake) ng.applyMatrix4(M);
            return ng;
        };
        const rg = build(top, true);
        rg.computeBoundingBox(); rotorBox.union(rg.boundingBox);
        parts.push({ geo: rg, mat: o.material });
        o.geometry = build(rest, false);
    });
    if (parts.length) {
        const hub = rotorBox.getCenter(new THREE.Vector3());
        const pivot = new THREE.Group(); pivot.position.set(hub.x, hub.y, hub.z);
        parts.forEach(p => { p.geo.translate(-hub.x, -hub.y, -hub.z); const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = true; pivot.add(m); });
        g.add(pivot);
        if (v.rotors) v.rotors.visible = false;
        v.rotors = pivot;
    }
    v.rotorSpd = 0;
    g.rotation.x = sRx; g.rotation.z = sRz; g.updateMatrixWorld(true);
}

// Shared civilian driver material cache (avoids duplicating materials on every traffic car)
const _driverMatCache = new Map();
const _tmpTintCol = new THREE.Color();

function getSharedTintedMat(origMat, tintHex) {
    const key = tintHex + ':' + origMat.uuid;
    let cached = _driverMatCache.get(key);
    if (!cached) {
        cached = origMat.clone();
        if (cached.color) cached.color.lerp(_tmpTintCol.setHex(tintHex), 0.5);
        _driverMatCache.set(key, cached);
    }
    return cached;
}

function makeDriver(isCop = false) {
    const gl = (isCop && PROPS.copman) ? PROPS.copman : PROPS.hero;
    if (!gl) return null;
    const model = SkeletonUtils.clone(gl.scene);
    const mx = new THREE.AnimationMixer(model), acts = {};
    gl.animations.forEach(a => { acts[a.name] = mx.clipAction(a); });
    if (acts.idle) { acts.idle.play(); mx.update(0.01); }
    const holder = new THREE.Group(); holder.add(model); holder.updateMatrixWorld(true);
    let minY = Infinity, maxY = -Infinity; const bp = new THREE.Vector3();
    model.traverse(o => { if (o.isBone) { o.getWorldPosition(bp); minY = Math.min(minY, bp.y); maxY = Math.max(maxY, bp.y); } });
    const k = (isCop ? 1.8 : 1.7) / Math.max(0.001, (maxY - minY) * 1.08);
    holder.scale.setScalar(k); holder.position.y = -minY * k;
    const tintHex = isCop ? null : DRIVER_TINTS[Math.floor(Math.random() * DRIVER_TINTS.length)];
    model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.frustumCulled = true;
        if (o.geometry && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if (tintHex !== null && o.material) {
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            const cl = ms.map(m => getSharedTintedMat(m, tintHex));
            o.material = Array.isArray(o.material) ? cl : cl[0];
        }
    });
    const obj = new THREE.Group(); obj.add(holder);
    return { obj, mx, acts, now: 'idle' };
}

function spawnTraffic(kind, z, dir) {
    const g = new THREE.Group(); scene.add(g);
    const t = { mesh: g, wheels: [], dir, z, speed: 0, vmax: 11 + Math.random() * 7, type: 'traffic', kind };
    applyCarGLB(t, PROPS[kind.key], kind.len, kind.rot, kind.drop, kind.wheel, kind.keep, kind.wmax);
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g).applyMatrix4(new THREE.Matrix4().copy(g.matrixWorld).invert());
    const wid = bb.max.x - bb.min.x, hgt = bb.max.y - bb.min.y, len = bb.max.z - bb.min.z;
    const bodyX = Math.min(bb.max.x - 0.08, wid * 0.43);
    t.seat = { x: wid * 0.18, y: bb.min.y + hgt * 0.04, z: -0.08 };
    t.doorX = bodyX;
    t.driver = makeDriver(kind.key === 'cop');
    if (t.driver) {
        t.driver.obj.position.set(t.seat.x, bb.min.y + hgt * 0.14, t.seat.z);
        t.driver.obj.scale.setScalar(0.76);
        t.driver.obj.visible = true;
        g.add(t.driver.obj);
    }

    const doorPivot = new THREE.Group();
    const dLen = Math.min(1.12, len * 0.24), dHgt = Math.min(0.68, hgt * 0.46);
    const doorCol = kind.key === 'cop' ? 0x1e293b : kind.key === 'jeep2' ? 0x991b1b : 0x475569;
    const dPanel = new THREE.Mesh(new THREE.BoxGeometry(0.07, dHgt, dLen), new THREE.MeshStandardMaterial({ color: doorCol, roughness: 0.35, metalness: 0.5 }));
    dPanel.position.set(0, dHgt * 0.5, -dLen * 0.5);
    const dWin = new THREE.Mesh(new THREE.BoxGeometry(0.04, dHgt * 0.46, dLen * 0.82), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.8, transparent: true, opacity: 0.72 }));
    dWin.position.set(0, dHgt + dHgt * 0.23, -dLen * 0.5);
    const dHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.15), new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.85, roughness: 0.2 }));
    dHandle.position.set(0.045, dHgt * 0.78, -dLen * 0.8);
    doorPivot.add(dPanel, dWin, dHandle);
    doorPivot.position.set(bodyX + 0.02, bb.min.y + hgt * 0.24, dLen * 0.45);
    doorPivot.visible = false;
    g.add(doorPivot);
    t.doorPivot = doorPivot;

    const doorCabin = new THREE.Group();
    const cabBack = new THREE.Mesh(new THREE.BoxGeometry(0.04, dHgt * 1.40, dLen * 0.94), new THREE.MeshStandardMaterial({ color: 0x080a0f, roughness: 0.95 }));
    cabBack.position.set(bodyX + 0.005, bb.min.y + hgt * 0.24 + dHgt * 0.70, -dLen * 0.05);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.8 });
    const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.14, 0.44), seatMat);
    seatBase.position.set(bodyX - 0.12, bb.min.y + hgt * 0.34, -0.18);
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.50, 0.12), seatMat);
    seatBack.position.set(bodyX - 0.12, bb.min.y + hgt * 0.56, -0.38); seatBack.rotation.x = -0.18;
    const dashBar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.20, 0.22), new THREE.MeshStandardMaterial({ color: 0x161920, roughness: 0.6 }));
    dashBar.position.set(bodyX - 0.12, bb.min.y + hgt * 0.58, dLen * 0.28);
    const swRing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.022, 8, 18), new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.4, metalness: 0.5 }));
    swRing.position.set(bodyX - 0.08, bb.min.y + hgt * 0.62, dLen * 0.15); swRing.rotation.x = 0.35;
    doorCabin.add(cabBack, seatBase, seatBack, dashBar, swRing);
    doorCabin.visible = false;
    g.add(doorCabin);
    t.doorCabin = doorCabin;

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    traffic.push(t);
}

whenProp('olds', () => whenProp('cop', () => whenProp('jeep2', () => whenProp('hero', () => whenProp('copman', () => {
    for (let i = 0; i < 12; i++) spawnTraffic(TRAFFIC_KINDS[i % TRAFFIC_KINDS.length], -290 + i * 52, i % 2 ? 1 : -1);
    propMixers.push({ update: updateTraffic });
})))));

export function startCarjack(t) {
    t.jack = { time: 0 }; t.speed = 0;
    if (t.doorPivot) { t.doorPivot.visible = true; t.doorPivot.rotation.y = 0; }
    if (t.doorCabin) t.doorCabin.visible = true;
    G.ui.pushFeed('🚪 Բացում եք դուռը և հանում վարորդին...');
}
G.fn.startCarjack = startCarjack;

function finishCarjack(t) {
    if (t.doorPivot) { t.doorPivot.rotation.y = 0; t.doorPivot.visible = false; }
    if (t.doorCabin) t.doorCabin.visible = false;
    const key = t.kind.key === 'jeepm' ? 'jeep' : t.kind.key;
    const names = { jeep2: 'Jeep Wrangler 🚙', olds: 'Oldsmobile Cutlass Supreme 1971 🚗', cop: 'Chapman 73 Cop Cruiser 🚓', jeep: '4x4 Ռազմական Ջիպ 🚙' };
    const v = { type: key, name: names[key] || 'Մեքենա', mesh: t.mesh, rotors: null, wheels: t.wheels, steers: t.steers, colBox: t.colBox, speed: 0, vy: 0, flies: false };
    vehicles.push(v);
    t.done = true;
    player.vehicle = v;
    player.vehCam = player.thirdPerson ? 0 : 2;
    G.ui.toggleXRayScope(false);
    if (key === 'cop') {
        player.wanted = Math.min(5, (player.wanted || 0) + 1);
        G.ui.syncUI();
        G.ui.pushFeed('🚨 Ոստիկանական մեքենա գողացաք (+1 աստղ)');
    }
    setTimeout(() => spawnTraffic(t.kind, -312 * t.dir, t.dir), 4000);
}

function updateTraffic(dt) {
    fleeing.forEach(f => {
        f.time += dt;
        const o = f.d.obj, dx = o.position.x - player.x, dz = o.position.z - player.z, dd = Math.hypot(dx, dz) || 1;
        o.rotation.y = angleLerp(o.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 8));
        o.position.x += dx / dd * 4.5 * dt; o.position.z += dz / dd * 4.5 * dt;
        o.position.y = getTerrainHeight(o.position.x, o.position.z);
        f.d.mx.update(dt);
        if (f.time > 7) { scene.remove(o); f.gone = true; }
    });
    for (let i = fleeing.length - 1; i >= 0; i--) if (fleeing[i].gone) fleeing.splice(i, 1);

    traffic.forEach(t => {
        if (t.jack) {
            t.jack.time += dt;
            const tm = t.jack.time, d = t.driver;
            if (t.doorPivot) {
                if (tm < 0.38) t.doorPivot.rotation.y = -THREE.MathUtils.smoothstep(tm, 0, 0.38) * 1.18;
                else if (tm < 0.95) t.doorPivot.rotation.y = -1.18;
                else t.doorPivot.rotation.y = -(1 - THREE.MathUtils.smoothstep(tm, 0.95, 1.30)) * 1.18;
            }
            if (d && !t.jack.out && tm >= 0.30) {
                if (!t.jack.stepped) {
                    t.jack.stepped = true;
                    d.obj.visible = true;
                    d.obj.scale.setScalar(1);
                    if (d.acts.idle) d.acts.idle.stop();
                    (d.acts.walk || d.acts.run).reset().play();
                }
                const k = Math.min(1, (tm - 0.30) / 0.58);
                d.obj.position.set(t.seat.x + k * (t.doorX - t.seat.x + 1.05), t.seat.y * (1 - k), t.seat.z - k * 0.2);
                d.obj.rotation.y = Math.PI * 0.5;
                d.mx.update(dt);
                if (k >= 1) {
                    t.jack.out = true; scene.attach(d.obj);
                    if (t.kind.key === 'cop') {
                        const pos = d.obj.position.clone();
                        scene.remove(d.obj);
                        const cop = G.fn.makeOfficer();
                        if (cop) {
                            cop.userData.deployed = true;
                            cop.userData.side = 1;
                            cop.position.set(pos.x, groundY(pos.x, pos.z), pos.z);
                            cop.rotation.set(0, Math.atan2(player.x - pos.x, player.z - pos.z), 0);
                            cop.visible = true;
                            scene.add(cop);
                            const anchor = new THREE.Object3D();
                            anchor.position.copy(cop.position);
                            swatUnits.push({ mesh: anchor, noCar: true, hp: 65, shootCd: 0.55, officers: [cop] });
                        }
                        player.wanted = Math.min(5, player.wanted + 1);
                        G.ui.syncUI();
                        G.ui.pushFeed('🚓 Ոստիկանը դուրս եկավ և հարձակվում է քեզ վրա (+1 ⭐)!');
                    } else {
                        d.acts.walk && d.acts.walk.stop();
                        (d.acts.run || d.acts.walk).reset().play();
                        fleeing.push({ d, time: 0 });
                    }
                }
            }
            if (tm >= 1.32 && !t.done) finishCarjack(t);
            return;
        }
        let want = t.vmax;
        traffic.forEach(o => {
            if (o !== t && o.dir === t.dir) {
                const ahead = (o.z - t.z) * t.dir;
                if (ahead > 0 && ahead < 18) want = Math.min(want, ahead < 9 ? 0 : o.speed * 0.9);
            }
        });
        const laneX = getRoadCenterX(t.z) - t.dir * 2.55;
        const blockers = [];
        if (!player.inHouse) blockers.push({ x: player.x, z: player.z });
        vehicles.forEach(v => { if (!v.flies && !v.isBoat) blockers.push({ x: v.mesh.position.x, z: v.mesh.position.z }); });
        swatUnits.forEach(su => blockers.push({ x: su.mesh.position.x, z: su.mesh.position.z }));

        blockers.forEach((b, bi) => {
            const ahead = (b.z - t.z) * t.dir;
            const isPlayer = bi === 0 && !player.inHouse;
            if (ahead > -1 && ahead < (isPlayer ? 16 : 12) && Math.abs(b.x - laneX) < (isPlayer ? 3.2 : 2.4)) want = 0;
        });
        t.speed += Math.max(-14 * dt, Math.min(5 * dt, want - t.speed));
        t.z += t.dir * t.speed * dt;
        if (t.z * t.dir > 314) {
            let entry = -314;
            traffic.forEach(o => { if (o !== t && o.dir === t.dir) entry = Math.min(entry, o.z * t.dir - 18); });
            t.z = Math.max(-345, entry) * t.dir; t.speed = 0;
        }
        const x = getRoadCenterX(t.z) - t.dir * 2.55, slope = Math.cos(t.z * 0.015) * 0.15;
        t.mesh.position.set(x, 0, t.z);
        t.mesh.visible = Math.abs(t.z) < 318;
        t.mesh.rotation.y = Math.atan2(slope * t.dir, t.dir);
        t.mesh.position.y = carGroundY(t);
        t.wheels.forEach(w => { w.rotation.x += Math.min(9, t.speed * 2.2) * dt; });
    });
    for (let i = traffic.length - 1; i >= 0; i--) if (traffic[i].done) traffic.splice(i, 1);
}

export function createVehicle(vType, x, z) {
    const g = new THREE.Group();
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.45, metalness: 0.65 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111317, normalMap: normalTex, roughness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x93c5fd, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.45, depthWrite: false });
    const headLightMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });
    let rotors = null;
    const wheels = [];

    if (vType === 'jeep') {
        const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x3b4d36, roughness: 0.26, metalness: 0.45, clearcoat: 0.92, clearcoatRoughness: 0.12 });
        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.8, 4.35), bodyMat); hull.position.y = 0.88;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.85, 2.15), darkMat); cab.position.set(0, 1.62, -0.28);
        const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.68, 0.08), glassMat); windshield.position.set(0, 1.62, 0.82);
        const mgGun = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.45, 10), darkMat);
        mgGun.rotation.x = Math.PI / 2; mgGun.position.set(0, 2.22, 0.2);
        const hlL = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), headLightMat); hlL.position.set(-0.72, 0.95, 2.18);
        const hlR = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), headLightMat); hlR.position.set(0.72, 0.95, 2.18);
        [[-1.08, 0.46, 1.38], [1.08, 0.46, 1.38], [-1.08, 0.46, -1.38], [1.08, 0.46, -1.38]].forEach(([wx, wy, wz]) => {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 16).rotateZ(Math.PI / 2), tireMat);
            w.position.set(wx, wy, wz);
            g.add(w); wheels.push(w);
        });
        const spot = new THREE.SpotLight(0xfffbeb, 6, 55, 0.55, 0.45);
        spot.position.set(0, 1.1, 2.15); spot.target.position.set(0, 0.1, 18);
        headLights.push(spot);
        g.add(hull, cab, windshield, mgGun, hlL, hlR, spot, spot.target);
    } else if (vType === 'porsche' || vType === 'olds' || vType === 'cop') {
        const spot = new THREE.SpotLight(0xfffbeb, 6, 55, 0.5, 0.45);
        spot.position.set(0, 0.85, 2.2); spot.target.position.set(0, 0.1, 18);
        headLights.push(spot);
        g.add(spot, spot.target);
    } else if (vType === 'atv') {
        const atvMat = new THREE.MeshPhysicalMaterial({ color: 0xdc2626, roughness: 0.22, metalness: 0.5, clearcoat: 0.95 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.55, 2.15), atvMat); body.position.y = 0.68;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.95, 10), darkMat);
        bar.rotation.z = Math.PI / 2; bar.position.set(0, 1.12, 0.55);
        [[-0.68, 0.34, 0.72], [0.68, 0.34, 0.72], [-0.68, 0.34, -0.72], [0.68, 0.34, -0.72]].forEach(([wx, wy, wz]) => {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14).rotateZ(Math.PI / 2), tireMat);
            w.position.set(wx, wy, wz);
            g.add(w); wheels.push(w);
        });
        g.add(body, bar);
    } else if (vType === 'jeep2' || vType === 'tank') {
        const spot = new THREE.SpotLight(0xfffbeb, 6, 58, 0.55, 0.45);
        spot.position.set(0, vType === 'tank' ? 1.5 : 1.0, vType === 'tank' ? 2.8 : 2.0);
        spot.target.position.set(0, 0.2, 20);
        headLights.push(spot);
        g.add(spot, spot.target);
    } else if (vType === 'heli') {
        const heliMat = new THREE.MeshPhysicalMaterial({ color: 0x27272a, roughness: 0.25, metalness: 0.78, clearcoat: 0.85 });
        const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.25, 20, 16), heliMat);
        cockpit.scale.set(0.95, 0.9, 1.75); cockpit.position.y = 1.65;
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.12, 16, 14), glassMat);
        canopy.scale.set(0.88, 0.78, 1.35); canopy.position.set(0, 1.78, 0.55);
        const tailBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 3.8, 12), heliMat);
        tailBoom.rotation.x = Math.PI / 2; tailBoom.position.set(0, 1.75, -2.8);
        rotors = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.05, 0.36), darkMat);
        rotors.position.set(0, 2.75, 0);
        g.add(cockpit, canopy, tailBoom, rotors);
    }

    g.position.set(x, groundY(x, z), z);
    g.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    scene.add(g);

    const v = {
        type: vType,
        name: vType === 'tank' ? 'Panzer IV Տանկ 🪖' : vType === 'jeep2' ? 'Jeep Wrangler 🚙' : vType === 'gazelle' ? 'SA342 Gazelle 🚁' : vType === 'md500' ? 'MD 500 🚁' : vType === 'jet' ? 'A-14B Stealth Fighter ✈️' : vType === 'boat' ? 'Patrol Boat PBR 🚤' : vType === 'mboat' ? 'Military Boat 🛥️' : vType === 'cop' ? 'Chapman 73 Cop Cruiser 🚓' : vType === 'olds' ? 'Oldsmobile Cutlass Supreme 1971 🚗' : vType === 'porsche' ? 'Porsche 911 Turbo 🏎️' : vType === 'jeep' ? '4x4 Ռազմական Ջիպ 🚙' : (vType === 'atv' ? 'Արագ Կվադրոցիկլ 🏍️' : 'Մարտական Ուղղաթիռ 🚁'),
        mesh: g, rotors, wheels, speed: 0, vy: 0,
        flies: ['heli', 'jet', 'gazelle', 'md500'].includes(vType),
        isBoat: vType === 'boat' || vType === 'mboat'
    };
    vehicles.push(v);
    if (!v.flies && !v.isBoat) setTimeout(() => { v.mesh.position.y = carGroundY(v); }, 0);
    if (vType === 'porsche') applyPorsche(v);
    if (v.isBoat) {
        v.draft = vType === 'boat' ? 0.75 : 0.6;
        g.position.y = -0.35 - v.draft;
        whenProp(vType, gl => {
            applyCarGLB(v, gl, vType === 'boat' ? 9 : 8, vType === 'boat' ? Math.PI / 2 : 0, null, null);
            if (vType === 'boat') makePoliceBoat(v);
        });
    }
    if (vType === 'jeep' || vType === 'atv') {
        whenProp(vType === 'jeep' ? 'jeepm' : 'atvm', gl => {
            g.children.forEach(ch => { if (ch.isMesh) ch.visible = false; });
            v.wheels.length = 0;
            if (vType === 'jeep') applyCarGLB(v, gl, 4.3, -0.1745, null, null, px => px > 0);
            else applyCarGLB(v, gl, 2.2, 0, null, /^Wheel/i);
        });
    }
    if (vType === 'gazelle') whenProp('gazelle', gl => { applyCarGLB(v, gl, 12, 0, null, null); splitRotor(v); alignVehicleToGround(v, 0); });
    if (vType === 'md500') whenProp('md500', gl => { applyCarGLB(v, gl, 8, 0, null, null); splitRotor(v); alignVehicleToGround(v, 0); });
    if (vType === 'jeep2') whenProp('jeep2', gl => applyCarGLB(v, gl, 4.0, 0, null, /tires/i, null, 0.42));
    if (vType === 'tank') whenProp('tank', gl => { applyCarGLB(v, gl, 7.2, 0, null, null); alignVehicleToGround(v, 0); });
    if (vType === 'jet') whenProp('jet', gl => applyCarGLB(v, gl, 14, 0, null, null));
    if (vType === 'heli') {
        whenProp('mh6', gl => {
            g.children.forEach(ch => { if (ch.isMesh) ch.visible = false; });
            if (v.rotors) v.rotors.visible = false;
            applyCarGLB(v, gl, 8.5, Math.PI / 2, null, null);
            splitRotor(v);
            alignVehicleToGround(v, 0);
        });
    }
    if (vType === 'cop') whenProp('cop', gl => applyCarGLB(v, gl, 5.4, -Math.PI / 2, null, /tire/i));
    if (vType === 'olds') whenProp('olds', gl => applyCarGLB(v, gl, 5.2, Math.PI, 'M_Dome', /wheel/i));
    return v;
}
G.fn.createVehicle = createVehicle;

export function buildCarSalon(v) {
    v.mesh.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(v.mesh).applyMatrix4(new THREE.Matrix4().copy(v.mesh.matrixWorld).invert());
    const hgt = bb.max.y - bb.min.y, wid = bb.max.x - bb.min.x;
    v.cockpit = new THREE.Vector3(
        v.flies || v.isBoat || v.type === 'atv' || v.type === 'tank' ? 0 : wid * 0.2,
        v.type === 'tank' ? bb.max.y + 0.35 : bb.min.y + hgt * (v.type === 'atv' ? 1.18 : 0.80),
        v.type === 'tank' ? 0.25 : v.type === 'atv' ? -0.25 : -0.15
    );
    if (v.flies || v.isBoat || v.type === 'atv' || v.type === 'tank') return;

    const salon = new THREE.Group();
    const leather = new THREE.MeshStandardMaterial({ color: 0x181a20, roughness: 0.78, metalness: 0.08 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x2c303a, roughness: 0.4, metalness: 0.65 });
    const cabinDark = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.9 });
    const hoodCol = v.type === 'porsche' ? 0xc0c6cf : v.type === 'cop' ? 0x111827 : v.type === 'jeep2' ? 0x991b1b : v.type === 'jeep' ? 0x3b4d36 : 0x334155;
    const hoodMat = new THREE.MeshPhysicalMaterial({ color: hoodCol, roughness: 0.25, metalness: 0.55, clearcoat: 0.9 });
    const cx = v.cockpit.x, cy = v.cockpit.y, cz = v.cockpit.z;

    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.36, 0.62), leather); dash.position.set(0, cy - 0.36, cz + 0.68);
    const dashTop = new THREE.Mesh(new THREE.BoxGeometry(1.80, 0.06, 0.68), leather); dashTop.position.set(0, cy - 0.17, cz + 0.70);
    const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.48, 1.35), leather); consoleBox.position.set(-0.02, cy - 0.56, cz + 0.12);
    const shifter = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.22, 10), trim); shifter.position.set(-0.02, cy - 0.26, cz + 0.22); shifter.rotation.x = 0.2;
    const shiftKnob = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 12), leather); shiftKnob.position.set(-0.02, cy - 0.15, cz + 0.24);
    const cabFloor = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.08, 2.2), cabinDark); cabFloor.position.set(0, cy - 0.78, cz + 0.10);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.08, 1.85), leather); cabRoof.position.set(0, cy + 0.44, cz - 0.48);
    const cabBack = new THREE.Mesh(new THREE.BoxGeometry(1.76, 1.25, 0.14), cabinDark); cabBack.position.set(0, cy - 0.18, cz - 1.25);
    const passSeat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.16), leather); passSeat.position.set(-cx, cy - 0.30, cz - 0.28); passSeat.rotation.x = -0.18;
    const steerCol = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.34, 12).rotateX(Math.PI / 2), cabinDark); steerCol.position.set(cx, cy - 0.28, cz + 0.46); steerCol.rotation.x = -0.25;

    const gCv = document.createElement('canvas'); gCv.width = 512; gCv.height = 192;
    const gx = gCv.getContext('2d');
    gx.fillStyle = '#070b12'; gx.fillRect(0, 0, 512, 192);
    for (const [ox, lbl] of [[140, 'KM/H'], [372, 'RPM']]) {
        gx.strokeStyle = '#38bdf8'; gx.lineWidth = 6; gx.beginPath(); gx.arc(ox, 102, 70, Math.PI * 0.75, Math.PI * 2.25); gx.stroke();
        gx.strokeStyle = '#ef4444'; gx.lineWidth = 6; gx.beginPath(); gx.arc(ox, 102, 70, Math.PI * 1.95, Math.PI * 2.25); gx.stroke();
        gx.fillStyle = '#e2e8f0'; gx.font = 'bold 24px monospace'; gx.textAlign = 'center'; gx.fillText(lbl, ox, 148);
        gx.strokeStyle = '#f97316'; gx.lineWidth = 4; gx.beginPath(); gx.moveTo(ox, 102); gx.lineTo(ox - 34, 62); gx.stroke();
    }
    const gTex = new THREE.CanvasTexture(gCv); gTex.colorSpace = THREE.SRGBColorSpace;
    const gauges = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.17), new THREE.MeshBasicMaterial({ map: gTex }));
    gauges.position.set(cx, cy - 0.24, cz + 0.38); gauges.rotation.y = Math.PI;

    const sCv = document.createElement('canvas'); sCv.width = 256; sCv.height = 160;
    const sx = sCv.getContext('2d');
    sx.fillStyle = '#0b1924'; sx.fillRect(0, 0, 256, 160);
    sx.strokeStyle = '#22c55e'; sx.lineWidth = 4; sx.beginPath(); sx.moveTo(40, 140); sx.quadraticCurveTo(130, 80, 190, 25); sx.stroke();
    sx.fillStyle = '#38bdf8'; sx.font = 'bold 20px sans-serif'; sx.fillText('GPS ACTIVE', 16, 28);
    const sTex = new THREE.CanvasTexture(sCv); sTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.17), new THREE.MeshBasicMaterial({ map: sTex }));
    screen.position.set(-0.02, cy - 0.24, cz + 0.37); screen.rotation.y = Math.PI;

    const swRoot = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 12, 32), leather);
    const spoke1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.036, 0.025), trim);
    const spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.17, 0.025), trim); spoke2.position.y = -0.09;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 18).rotateX(Math.PI / 2), leather);
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.024, 16), new THREE.MeshBasicMaterial({ color: 0xfacc15 })); badge.position.z = -0.022; badge.rotation.y = Math.PI;
    const spin = new THREE.Group(); spin.add(rim, spoke1, spoke2, hub, badge);
    swRoot.add(spin);
    swRoot.position.set(cx, cy - 0.25, cz + 0.31); swRoot.rotation.x = -0.32;

    const pL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.78, 0.10), leather); pL.position.set(0.84, cy + 0.12, cz + 0.56); pL.rotation.set(-0.55, 0, 0.10);
    const pR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.78, 0.10), leather); pR.position.set(-0.84, cy + 0.12, cz + 0.56); pR.rotation.set(-0.55, 0, -0.10);
    const bL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.95, 0.14), leather); bL.position.set(0.88, cy + 0.02, cz - 0.45);
    const bR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.95, 0.14), leather); bR.position.set(-0.88, cy + 0.02, cz - 0.45);
    const roofBar = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.10, 0.20), leather); roofBar.position.set(0, cy + 0.43, cz + 0.36);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.065, 0.03), trim); mirror.position.set(0, cy + 0.31, cz + 0.44);
    const smL = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.11, 0.07), hoodMat); smL.position.set(0.98, cy - 0.12, cz + 0.58);
    const smR = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.11, 0.07), hoodMat); smR.position.set(-0.98, cy - 0.12, cz + 0.58);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.14, 1.65), hoodMat); hood.position.set(0, cy - 0.25, cz + 1.60); hood.rotation.x = 0.05;
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 2.0), leather); sideL.position.set(0.88, cy - 0.46, cz - 0.05);
    const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 2.0), leather); sideR.position.set(-0.88, cy - 0.46, cz - 0.05);

    salon.add(dash, dashTop, consoleBox, shifter, shiftKnob, cabFloor, cabRoof, cabBack, passSeat, steerCol, gauges, screen, swRoot, pL, pR, bL, bR, roofBar, mirror, smL, smR, hood, sideL, sideR);
    v.mesh.add(salon);
    v.salonRoot = salon;
    v.steerWheel = spin;
}

export function initVehicles() {
    createVehicle('jeep', 6.5, 5.5);
    let best = null;
    for (let r = 6; r < 40 && !best; r += 2) {
        for (let k = 0; k < 24 && !best; k++) {
            const a = k / 24 * Math.PI * 2, x = Math.cos(a) * r, z = 8 + Math.sin(a) * r;
            const h = getTerrainHeight(x, z);
            if (h < 0.6 || Math.abs(getTerrainHeight(x + 2, z) - h) > 0.35 || Math.abs(getTerrainHeight(x, z + 3) - h) > 0.35) continue;
            if (Math.abs(x - getRoadCenterX(z)) < 7 || Math.hypot(x - 6.5, z - 5.5) < 7 || Math.hypot(x + 8.5, z - 4) < 6 || Math.hypot(x - 11, z + 7) < 5 || Math.hypot(x, z - 8) < 4) continue;
            best = [x, z];
        }
    }
    createVehicle('porsche', best ? best[0] : 3, best ? best[1] : 16);
    const px = best ? best[0] : 3, pz = best ? best[1] : 16;
    let jb = null;
    for (let r = 6; r < 40 && !jb; r += 2) {
        for (let k = 0; k < 24 && !jb; k++) {
            const a = k / 24 * Math.PI * 2, x = Math.cos(a) * r, z = 8 + Math.sin(a) * r, h = getTerrainHeight(x, z);
            if (h < 0.6 || Math.abs(getTerrainHeight(x + 2, z) - h) > 0.35 || Math.abs(getTerrainHeight(x, z + 3) - h) > 0.35) continue;
            if (Math.abs(x - getRoadCenterX(z)) < 7 || Math.hypot(x - px, z - pz) < 7 || Math.hypot(x - 6.5, z - 5.5) < 7 || Math.hypot(x + 8.5, z - 4) < 6 || Math.hypot(x - 11, z + 7) < 5 || Math.hypot(x, z - 8) < 4) continue;
            jb = [x, z];
        }
    }
    createVehicle('jeep2', jb ? jb[0] : -2, jb ? jb[1] : 18);
    createVehicle('atv', -8.5, 4.0);
    createVehicle('heli', HELIPAD.x, HELIPAD.z);
    createVehicle('jet', HANGAR.x, HANGAR.z);
    createVehicle('gazelle', -30, -46);
    createVehicle('md500', -32, -28);
    createVehicle('tank', -44, -47);

    const spots = [];
    for (let r = 10; r < 140 && spots.length < 2; r += 3) {
        for (let k = 0; k < 36 && spots.length < 2; k++) {
            const a = k / 36 * Math.PI * 2, x = Math.cos(a) * r, z = 8 + Math.sin(a) * r;
            let ok = true;
            for (let dx = -5; dx <= 5 && ok; dx += 2.5) for (let dz = -5; dz <= 5 && ok; dz += 2.5) ok = getTerrainHeight(x + dx, z + dz) < -1.0;
            if (ok && spots.every(p => Math.hypot(p[0] - x, p[1] - z) > 14)) spots.push([x, z]);
        }
    }
    if (spots[0]) createVehicle('boat', spots[0][0], spots[0][1]);
    if (spots[1]) createVehicle('mboat', spots[1][0], spots[1][1]);
}
