import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
    WORLD_SIZE, CABIN, CAMPFIRE, HELIPAD, HANGAR, HOUSE_INT,
    G, PROPS, propMixers, vehicles, water2Mats, treeColliders, camBlockers, whenProp
} from './state.js';
import {
    scene, sunVec, windUni, injectWind, woodTex, normalTex, terrainDetailTex,
    waterNormalTex, updateSkyAndWeather, isMobile
} from './scene.js';
import {
    fbm, noise2D, getRoadCenterX, getTerrainHeight, rebuildStaticGrid
} from './physics.js';

// Optimized 160x160 terrain (~51,200 tris vs 156,800 previously)
const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 160, 160);
terrainGeo.rotateX(-Math.PI / 2);
const posAttr = terrainGeo.attributes.position;
const colArr = new Float32Array(posAttr.count * 3);

for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i), vz = posAttr.getZ(i);
    posAttr.setY(i, getTerrainHeight(vx, vz));
}
terrainGeo.computeVertexNormals();
const normAttr = terrainGeo.attributes.normal;

const _tmpC = new THREE.Color();
const _cDryGrass = new THREE.Color(0x6b7a2e);
const _cDirt = new THREE.Color(0x6b5236);
const _cSlope = new THREE.Color(0x5c5146);

for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i), vy = posAttr.getY(i), vz = posAttr.getZ(i);
    const ny = normAttr.getY(i);
    const distRoad = Math.abs(vx - getRoadCenterX(vz));
    const micro = (noise2D(vx * 0.35, vz * 0.35) - 0.5) * 0.06;

    if (distRoad < 6.2) {
        _tmpC.setHex(0x4b463d).offsetHSL(0, 0, micro * 0.5);
    } else if (vy < 0.22) {
        _tmpC.setHex(vy < -0.6 ? 0x5a4a35 : 0xb59f74).offsetHSL(0, 0, micro);
    } else if (ny < 0.79) {
        _tmpC.setHex(0x57534e).offsetHSL(0, 0, micro);
    } else {
        const n1 = noise2D(vx * 0.02, vz * 0.02), n2 = noise2D(vx * 0.09 + 31, vz * 0.09 - 17);
        _tmpC.setHex(0x3f5f1c).lerp(_cDryGrass, THREE.MathUtils.smoothstep(n1, 0.45, 0.8));
        if (n2 > 0.72) _tmpC.lerp(_cDirt, (n2 - 0.72) * 2.2);
        if (ny < 0.88) _tmpC.lerp(_cSlope, (0.88 - ny) * 5);
        _tmpC.offsetHSL(0, 0, micro);
    }
    colArr[i * 3] = _tmpC.r;
    colArr[i * 3 + 1] = _tmpC.g;
    colArr[i * 3 + 2] = _tmpC.b;
}
terrainGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

export const terrainMesh = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
    map: terrainDetailTex,
    vertexColors: true,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(1.5, 1.5),
    roughness: 0.88,
    metalness: 0.02
}));
terrainMesh.receiveShadow = true;
scene.add(terrainMesh);
G.terrainMesh = terrainMesh;

// Distant 360-degree mountain ring anchored outside world border
(function buildHorizonMountains() {
    const segs = 128, rings = 6, rIn = WORLD_SIZE * 0.505, rOut = WORLD_SIZE * 0.96;
    const pos = [], col = [], idx = [];
    const mc = new THREE.Color();
    for (let r = 0; r <= rings; r++) {
        const t = r / rings, rad = THREE.MathUtils.lerp(rIn, rOut, t);
        for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * Math.PI * 2, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
            const ridge = Math.sin(t * Math.PI) * (0.4 + 0.6 * fbm(x * 0.009 + 11, z * 0.009 - 7, 4));
            const peak = fbm(x * 0.022, z * 0.022, 3);
            const h = r === 0 ? -4 : (ridge * 105 + peak * 28 - 6);
            pos.push(x, h, z);
            mc.setHex(h > 55 ? 0x6b6760 : h > 28 ? 0x4b5835 : 0x354a24);
            mc.offsetHSL(0, 0, (peak - 0.5) * 0.08);
            col.push(mc.r, mc.g, mc.b);
        }
    }
    const stride = segs + 1;
    for (let r = 0; r < rings; r++) {
        for (let i = 0; i < segs; i++) {
            const a = r * stride + i, b = a + 1, c = a + stride, d = c + 1;
            idx.push(a, b, c, b, d, c);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mtn = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }));
    scene.add(mtn);
})();

const waterRes = isMobile ? 256 : 512;
export const water = new Water(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE), {
    textureWidth: waterRes,
    textureHeight: waterRes,
    waterNormals: waterNormalTex,
    sunDirection: sunVec,
    sunColor: 0xfff4e0,
    waterColor: 0x164a46,
    distortionScale: 2.4,
    alpha: 0.96,
    fog: true
});
water.rotation.x = -Math.PI / 2;
water.position.y = -0.35;
scene.add(water);
G.water = water;
updateSkyAndWeather();

// Asphalt highway ribbon with tapered shoulders
(function buildRoad() {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = '#34363b'; g.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 9000; i++) {
        const v = 40 + Math.random() * 40;
        g.fillStyle = `rgba(${v},${v},${v + 4},0.55)`;
        g.fillRect(Math.random() * 256, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    g.fillStyle = '#e5e7eb'; g.fillRect(12, 0, 5, 512); g.fillRect(239, 0, 5, 512);
    g.fillStyle = '#facc15'; for (let y = 20; y < 512; y += 128) g.fillRect(125, y, 6, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const HALF = 5.8, ZMAX = 316, STEP = 2.0, n = Math.ceil(2 * ZMAX / STEP);
    const prof = [[-1.15, -0.14, 0], [-1, 0.12, 0], [1, 0.12, 1], [1.15, -0.14, 1]];
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
        const z = -ZMAX + i * STEP, cx = getRoadCenterX(z);
        const dx = getRoadCenterX(z + 0.5) - getRoadCenterX(z - 0.5), L = Math.hypot(dx, 1);
        const rx = 1 / L, rz = -dx / L;
        for (const [s, dy, u] of prof) {
            const x = cx + rx * HALF * s, zz = z + rz * HALF * s;
            pos.push(x, Math.max(getTerrainHeight(x, zz), 0.22) + dy, zz);
            uv.push(u, z / 17);
        }
        if (i < n) {
            const a = i * 4;
            for (let k = 0; k < 3; k++) idx.push(a + k, a + 4 + k, a + k + 1, a + k + 1, a + 4 + k, a + 4 + k + 1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    }));
    road.receiveShadow = true;
    scene.add(road);
})();

const dummy = new THREE.Object3D();

function evenPoints(cell, range, ok) {
    const pts = [];
    for (let gx = -range; gx <= range; gx += cell) {
        for (let gz = -range; gz <= range; gz += cell) {
            const x = gx + (Math.random() - 0.5) * cell * 0.6;
            const z = gz + (Math.random() - 0.5) * cell * 0.6;
            if (ok(x, z)) pts.push([x, z]);
        }
    }
    return pts;
}

function bakeVariants(gltf, targetH) {
    const out = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        g.computeBoundingBox();
        const b = g.boundingBox, c = b.getCenter(new THREE.Vector3());
        const k = targetH / Math.max(0.0001, b.max.y - b.min.y);
        g.translate(-c.x, -b.min.y, -c.z);
        g.scale(k, k, k);
        const m = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
        m.transparent = false; m.alphaTest = 0.5; m.side = THREE.DoubleSide;
        m.depthWrite = true; m.metalness = 0; m.roughness = 0.9;
        out.push({ geo: g, mat: m });
    });
    return out;
}

function scatter(gltf, targetH, pts, scaleVar, castShadow, wind, yOff = 0) {
    const vars = bakeVariants(gltf, targetH);
    if (!vars.length || !pts.length) return;
    const groups = vars.map(() => []);
    pts.forEach((p, i) => groups[i % vars.length].push(p));
    vars.forEach((v, vi) => {
        const gPts = groups[vi];
        if (!gPts.length) return;
        if (wind) injectWind(v.mat, wind);
        const inst = new THREE.InstancedMesh(v.geo, v.mat, gPts.length);
        inst.castShadow = castShadow;
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        gPts.forEach((p, i) => {
            dummy.position.set(p[0], getTerrainHeight(p[0], p[1]) + yOff, p[1]);
            dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
            dummy.scale.setScalar(1 + (Math.random() - 0.5) * 2 * scaleVar);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        scene.add(inst);
    });
}

// Flat spot finder for the log cabin
const START_KEEP = [[0, 8, 26], [6.5, 5.5, 18], [-3.5, 13, 18], [-8.5, 4, 18], [11, -7, 18], [7, -3, 18]];
function flatSpot(cx, cz, rad) {
    let best = null, bs = 1e9;
    for (let x = -70; x <= 90; x += 3) {
        for (let z = -90; z <= 70; z += 3) {
            if (Math.abs(x - getRoadCenterX(z)) < 14 || Math.hypot(x + 45, z + 45) < 28 || Math.hypot(x - cx, z - cz) > 45 || START_KEEP.some(p => Math.hypot(x - p[0], z - p[1]) < p[2])) continue;
            let lo = 1e9, hi = -1e9;
            for (let a = -1; a <= 1; a++) {
                for (let b = -1; b <= 1; b++) {
                    const h = getTerrainHeight(x + a * rad, z + b * rad);
                    lo = Math.min(lo, h); hi = Math.max(hi, h);
                }
            }
            if (lo < 0.6) continue;
            const sc = (hi - lo) * 3 + Math.hypot(x - cx, z - cz) * 0.4;
            if (sc < bs) { bs = sc; best = { x, z }; }
        }
    }
    return best || { x: cx, z: cz };
}
{
    const spot = flatSpot(12, 20, 7);
    CABIN.x = spot.x;
    CABIN.z = spot.z;
}

// Only scatter GLB foliage (no wasted startup GPU buffers for fallback cones)
let treePts = [];
whenProp('tree', gltf => {
    treePts = evenPoints(15, 270, (x, z) =>
        Math.abs(x - getRoadCenterX(z)) > 10 && Math.hypot(x, z) > 16 &&
        Math.hypot(x + 48, z + 32) > 15 && Math.hypot(x + 45, z + 62) > 17 &&
        Math.hypot(x + 45, z + 45) > 20 && Math.hypot(x - CABIN.x, z - CABIN.z) > 16 &&
        getTerrainHeight(x, z) > 0.4
    );
    scatter(gltf, 12, treePts, 0.18, true, 0.06);
    treePts.forEach(p => treeColliders.push({ x: p[0], z: p[1], r: 0.7 }));
    rebuildStaticGrid();
});

whenProp('grass', gltf => {
    const pts = evenPoints(3.6, 105, (x, z) =>
        Math.abs(x - getRoadCenterX(z)) > 9.5 && getTerrainHeight(x, z) > 0.3 &&
        Math.hypot(x, z) > 13 && Math.hypot(x - CAMPFIRE.x, z - CAMPFIRE.z) > 3.5 &&
        Math.hypot(x + 45, z + 45) > 20 && Math.hypot(x + 48, z + 32) > 15 &&
        Math.hypot(x + 45, z + 62) > 17 && Math.hypot(x - CABIN.x, z - CABIN.z) > 9 &&
        !treePts.some(t => Math.abs(t[0] - x) < 1.2 && Math.abs(t[1] - z) < 1.2)
    );
    scatter(gltf, 1.3, pts, 0.25, false, 0.12);
});

whenProp('rock', gltf => {
    const pts = evenPoints(26, 270, (x, z) =>
        Math.abs(x - getRoadCenterX(z)) > 10 && Math.hypot(x, z) > 16 &&
        Math.hypot(x - CAMPFIRE.x, z - CAMPFIRE.z) > 5 && Math.hypot(x + 45, z + 45) > 22 &&
        Math.hypot(x + 48, z + 32) > 16 && Math.hypot(x + 45, z + 62) > 18 &&
        Math.hypot(x - CABIN.x, z - CABIN.z) > 13 && getTerrainHeight(x, z) > 0.4
    );
    scatter(gltf, 1.9, pts, 0.4, true, 0, -0.45);
    pts.forEach(p => treeColliders.push({ x: p[0], z: p[1], r: 2.1 }));
    rebuildStaticGrid();
});

whenProp('fern', gltf => {
    const pts = evenPoints(6.5, 110, (x, z) =>
        Math.abs(x - getRoadCenterX(z)) > 9.5 && getTerrainHeight(x, z) > 0.3 &&
        Math.hypot(x, z) > 13 && Math.hypot(x - CAMPFIRE.x, z - CAMPFIRE.z) > 4 &&
        Math.hypot(x + 45, z + 45) > 20 && Math.hypot(x + 48, z + 32) > 15 &&
        Math.hypot(x + 45, z + 62) > 17 && Math.hypot(x - CABIN.x, z - CABIN.z) > 8
    );
    scatter(gltf, 1.4, pts, 0.3, false, 0.1);
});

whenProp('cabin', gltf => {
    const model = gltf.scene.clone(true);
    const holder = new THREE.Group(); holder.add(model); holder.updateMatrixWorld(true);
    const sz = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    const k = 11 / Math.max(sz.x, sz.z, 0.001);
    holder.scale.setScalar(k); holder.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(holder), c = bb.getCenter(new THREE.Vector3());
    let lo = 1e9;
    for (let a = 0; a <= 1; a++) {
        for (let b = 0; b <= 1; b++) {
            lo = Math.min(lo, getTerrainHeight(CABIN.x + (a ? 1 : -1) * (bb.max.x - c.x), CABIN.z + (b ? 1 : -1) * (bb.max.z - c.z)));
        }
    }
    holder.position.set(CABIN.x - c.x, lo - bb.min.y - 0.12, CABIN.z - c.z);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(holder);

    const hx = (bb.max.x - bb.min.x) / 2, hz = (bb.max.z - bb.min.z) / 2;
    for (let t = -hx; t <= hx; t += 1.5) {
        treeColliders.push({ x: CABIN.x + t, z: CABIN.z - hz, r: 1 });
        treeColliders.push({ x: CABIN.x + t, z: CABIN.z + hz, r: 1 });
    }
    for (let t = -hz; t <= hz; t += 1.5) {
        treeColliders.push({ x: CABIN.x - hx, z: CABIN.z + t, r: 1 });
        treeColliders.push({ x: CABIN.x + hx, z: CABIN.z + t, r: 1 });
    }
    CABIN.hx = hx;
    CABIN.hz = hz;
    CABIN.h = Math.max(4.5, bb.max.y - bb.min.y + 0.4);
    CABIN.door = { x: CABIN.x, z: CABIN.z - hz - 1.3 };

    const matY = getTerrainHeight(CABIN.door.x, CABIN.door.z) + 0.04;
    const wMat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.9), new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.95 }));
    wMat.position.set(CABIN.door.x, matY, CABIN.door.z);
    const porchLight = new THREE.PointLight(0xffb454, 4.5, 11);
    porchLight.position.set(CABIN.door.x, matY + 2.5, CABIN.door.z + 0.4);
    scene.add(wMat, porchLight);

    camBlockers.push(holder);
    rebuildStaticGrid();
});

// Furnished 3D Cabin Interior Room at y = -42 (isolated from outdoor world)
(function buildHouseInterior() {
    const g = new THREE.Group();
    g.position.set(HOUSE_INT.x, HOUSE_INT.y, HOUSE_INT.z);
    const floorMat = new THREE.MeshStandardMaterial({ map: woodTex, color: 0xb07d4f, roughness: 0.78 });
    const wallMat = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x8b5a2b, roughness: 0.85 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x4a2e16, roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.2, 8.2), floorMat); floor.position.y = -0.1; floor.receiveShadow = true;
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.2, 8.2), ceilMat); ceil.position.y = 3.3;
    const wN = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.4, 0.25), wallMat); wN.position.set(0, 1.6, 4.0);
    const wS = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.4, 0.25), wallMat); wS.position.set(0, 1.6, -4.0);
    const wE = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 8.2), wallMat); wE.position.set(4.0, 1.6, 0);
    const wW = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 8.2), wallMat); wW.position.set(-4.0, 1.6, 0);
    const rug = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.03, 2.4), new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.95 }));
    rug.position.set(0, 0.015, 0.2);
    const exitDoor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.12), new THREE.MeshStandardMaterial({ color: 0x5c3415, roughness: 0.7 }));
    exitDoor.position.set(0, 1.15, -3.84);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.85, roughness: 0.2 }));
    knob.position.set(0.45, 1.05, -3.75);
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 1.5), new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.8 }));
    bedFrame.position.set(HOUSE_INT.bedX, 0.225, HOUSE_INT.bedZ);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.22, 1.38), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9 }));
    mattress.position.set(HOUSE_INT.bedX, 0.54, HOUSE_INT.bedZ);
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.24, 1.40), new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.88 }));
    blanket.position.set(HOUSE_INT.bedX - 0.30, 0.55, HOUSE_INT.bedZ);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 1.1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    pillow.position.set(HOUSE_INT.bedX + 0.75, 0.70, HOUSE_INT.bedZ);
    const hearth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 2.0), new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.92 }));
    hearth.position.set(-3.55, 0.9, 0.4);
    const fireGlow = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 1.0), new THREE.MeshBasicMaterial({ color: 0xf97316 }));
    fireGlow.position.set(-3.2, 0.42, 0.4);
    const fpLight = new THREE.PointLight(0xff8c32, 7.5, 12); fpLight.position.set(-2.5, 1.2, 0.4);
    const tbl = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.72, 1.0), new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.75 }));
    tbl.position.set(-1.5, 0.36, 2.6);
    const sofa = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, 0.85), new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 }));
    sofa.position.set(-0.2, 0.325, 2.9);
    const lampLight = new THREE.PointLight(0xfff1d6, 9, 14); lampLight.position.set(0, 2.95, 0);
    const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff7cc }));
    lampBulb.position.set(0, 3.05, 0);
    g.add(floor, ceil, wN, wS, wE, wW, rug, exitDoor, knob, bedFrame, mattress, blanket, pillow, hearth, fireGlow, fpLight, tbl, sofa, lampLight, lampBulb);
    scene.add(g);
})();

whenProp('fence', gltf => whenProp('cabin', () => {
    const model = gltf.scene.clone(true);
    const h0 = new THREE.Group(); h0.add(model); h0.updateMatrixWorld(true);
    const s0 = new THREE.Box3().setFromObject(h0).getSize(new THREE.Vector3());
    if (s0.z > s0.x) model.rotation.y = Math.PI / 2;
    h0.updateMatrixWorld(true);
    const s1 = new THREE.Box3().setFromObject(h0).getSize(new THREE.Vector3());
    const SEG = 3.6, k = SEG / Math.max(s1.x, 0.001);
    const ax = (CABIN.hx || 5.5) + 3.5, az = (CABIN.hz || 5.5) + 3.5;
    const put = (x, z, rot) => {
        const seg = model.clone(true), h = new THREE.Group(); h.add(seg);
        h.scale.setScalar(k); h.rotation.order = 'YXZ'; h.rotation.y = rot; h.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(h), c = b.getCenter(new THREE.Vector3());
        const dx = Math.cos(rot) * (SEG * 0.5), dz = -Math.sin(rot) * (SEG * 0.5);
        const h1 = getTerrainHeight(x - dx, z - dz), h2 = getTerrainHeight(x + dx, z + dz);
        const midY = Math.min(getTerrainHeight(x, z), (h1 + h2) * 0.5);
        h.position.set(x - c.x, midY - b.min.y - 0.14, z - c.z);
        h.rotation.z = THREE.MathUtils.clamp(Math.atan2(h2 - h1, SEG), -0.35, 0.35);
        seg.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(h);
        for (let t = -SEG / 2; t <= SEG / 2; t += 1.2) {
            treeColliders.push({ x: x + (rot ? 0 : t), z: z + (rot ? t : 0), r: 0.35 });
        }
    };
    const nx = Math.max(1, Math.round(2 * ax / SEG)), nz = Math.max(1, Math.round(2 * az / SEG));
    const stepX = 2 * ax / nx, stepZ = 2 * az / nz;
    for (let i = 0; i < nx; i++) {
        const x = CABIN.x - ax + stepX * (i + 0.5);
        put(x, CABIN.z - az, 0);
        if (Math.abs(x - CABIN.x) > stepX * 0.6) put(x, CABIN.z + az, 0);
    }
    for (let i = 0; i < nz; i++) {
        const z = CABIN.z - az + stepZ * (i + 0.5);
        put(CABIN.x - ax, z, Math.PI / 2);
        put(CABIN.x + ax, z, Math.PI / 2);
    }
    rebuildStaticGrid();
}));

whenProp('heliport', gltf => {
    const model = gltf.scene.clone(true);
    const holder = new THREE.Group(); holder.add(model); holder.updateMatrixWorld(true);
    const rm = [];
    model.traverse(o => {
        if (o.isMesh) {
            const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3());
            if (sz.y < Math.max(sz.x, sz.z) * 0.002 || /^Object_(3|6)$/.test(o.name)) rm.push(o);
        }
    });
    rm.forEach(o => o.parent && o.parent.remove(o));
    holder.updateMatrixWorld(true);
    const sz = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    const k = (HELIPAD.half * 2) / Math.max(sz.x, sz.z, 0.001);
    holder.scale.setScalar(k); holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(holder), c = b.getCenter(new THREE.Vector3());
    holder.position.set(HELIPAD.x - c.x, getTerrainHeight(HELIPAD.x, HELIPAD.z) - b.min.y - 0.05, HELIPAD.z - c.z);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(holder); holder.updateMatrixWorld(true); camBlockers.push(holder);
    const rc = new THREE.Raycaster(new THREE.Vector3(HELIPAD.x + 2.5, 500, HELIPAD.z + 2.5), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObject(holder, true)[0];
    HELIPAD.top = hit ? hit.point.y : new THREE.Box3().setFromObject(holder).min.y + (b.max.y - b.min.y) * 0.65;
    vehicles.forEach(v => {
        if (v.flies && Math.abs(v.mesh.position.x - HELIPAD.x) < HELIPAD.half && Math.abs(v.mesh.position.z - HELIPAD.z) < HELIPAD.half) {
            v.mesh.position.y = HELIPAD.top;
        }
    });
});

whenProp('wreck', gltf => {
    const model = gltf.scene.clone(true);
    const holder = new THREE.Group(); holder.add(model); holder.updateMatrixWorld(true);
    const sz = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    const k = 5.6 / Math.max(sz.x, sz.z, 0.001);
    holder.scale.setScalar(k); holder.rotation.order = 'YXZ'; holder.rotation.y = 0.6; holder.updateMatrixWorld(true);
    const zc = 34, xc = getRoadCenterX(zc) + 9;
    const b = new THREE.Box3().setFromObject(holder), c = b.getCenter(new THREE.Vector3());
    let lo = 1e9;
    for (const [dx, dz] of [[0, 0], [2, 2], [-2, -2], [2, -2], [-2, 2]]) lo = Math.min(lo, getTerrainHeight(xc + dx, zc + dz));
    const hF = getTerrainHeight(xc + Math.sin(0.6) * 2, zc + Math.cos(0.6) * 2);
    const hB = getTerrainHeight(xc - Math.sin(0.6) * 2, zc - Math.cos(0.6) * 2);
    const hL = getTerrainHeight(xc + Math.cos(0.6) * 1.2, zc - Math.sin(0.6) * 1.2);
    const hR = getTerrainHeight(xc - Math.cos(0.6) * 1.2, zc + Math.sin(0.6) * 1.2);
    holder.rotation.x = THREE.MathUtils.clamp(-Math.atan2(hF - hB, 4), -0.35, 0.35);
    holder.rotation.z = THREE.MathUtils.clamp(Math.atan2(hL - hR, 2.4), -0.35, 0.35);
    holder.position.set(xc - c.x, lo - b.min.y - 0.12, zc - c.z);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(holder);
    for (let t = -2.2; t <= 2.2; t += 1.1) {
        treeColliders.push({ x: xc + Math.sin(0.6) * t, z: zc + Math.cos(0.6) * t, r: 1.2 });
    }
    rebuildStaticGrid();
});

whenProp('hangar', gltf => {
    const model = gltf.scene.clone(true);
    const holder = new THREE.Group(); holder.add(model); holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(holder), c = b.getCenter(new THREE.Vector3());
    holder.position.set(HANGAR.x - c.x, getTerrainHeight(HANGAR.x, HANGAR.z) - b.min.y - 0.05, HANGAR.z - c.z);
    model.traverse(o => {
        if (o.isMesh) {
            o.castShadow = true; o.receiveShadow = true;
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            ms.forEach(m => { m.side = THREE.DoubleSide; });
        }
    });
    scene.add(holder); camBlockers.push(holder);
    const hx = (b.max.x - b.min.x) / 2, hz = (b.max.z - b.min.z) / 2;
    HANGAR.hx = hx;
    HANGAR.hz = hz;
    HANGAR.h = Math.max(5.5, b.max.y - b.min.y);
    for (let t = -hz; t <= hz; t += 1.2) {
        treeColliders.push({ x: HANGAR.x - hx, z: HANGAR.z + t, r: 0.4 });
        treeColliders.push({ x: HANGAR.x + hx, z: HANGAR.z + t, r: 0.4 });
    }
    rebuildStaticGrid();
});

whenProp('lights', gltf => {
    gltf.scene.updateMatrixWorld(true);
    const parts = [];
    gltf.scene.traverse(o => { if (o.isMesh && o.name.startsWith('polySurface59')) parts.push(o); });
    if (!parts.length) return;
    const geos = parts.map(o => { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); return g; });
    const bb = new THREE.Box3(); geos.forEach(g => { g.computeBoundingBox(); bb.union(g.boundingBox); });
    const c = bb.getCenter(new THREE.Vector3()), k = 7.5 / Math.max(0.001, bb.max.y - bb.min.y);
    geos.forEach(g => { g.translate(-c.x, -bb.min.y, -c.z); g.scale(k, k, k); });
    const mats = parts.map(o => {
        const m = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
        if (/light/i.test(o.name)) { m.emissive = new THREE.Color(0xffd27a); m.emissiveIntensity = 1.6; }
        return m;
    });
    let side = 1;
    for (let z = -300; z <= 300; z += 32) {
        const sNow = side;
        const x = getRoadCenterX(z) + sNow * 7.0; side = -side;
        const dx = getRoadCenterX(z + 0.5) - getRoadCenterX(z - 0.5);
        const roadYaw = Math.atan2(dx, 1);
        const g = new THREE.Group();
        geos.forEach((geo, i) => { const m = new THREE.Mesh(geo, mats[i]); m.castShadow = !isMobile; g.add(m); });
        g.position.set(x, getTerrainHeight(x, z) - 0.08, z);
        g.rotation.y = roadYaw + (sNow > 0 ? Math.PI : 0);
        scene.add(g);
        treeColliders.push({ x, z, r: 0.3 });
    }
    rebuildStaticGrid();
});

whenProp('fire', gltf => {
    const model = SkeletonUtils.clone(gltf.scene);
    const holder = new THREE.Group(); holder.add(model); holder.updateMatrixWorld(true);
    const sz = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    const k = 1.6 / Math.max(sz.x, sz.z, 0.001);
    holder.scale.setScalar(k); holder.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(holder), c = bb.getCenter(new THREE.Vector3());
    holder.position.set(CAMPFIRE.x - c.x, getTerrainHeight(CAMPFIRE.x, CAMPFIRE.z) - bb.min.y - 0.03, CAMPFIRE.z - c.z);
    model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
    scene.add(holder);
    if (gltf.animations.length) {
        const mx = new THREE.AnimationMixer(model);
        mx.clipAction(gltf.animations[0]).play();
        propMixers.push(mx);
    }
    const L = new THREE.PointLight(0xff8a3d, 25, 16, 2);
    L.position.set(CAMPFIRE.x, getTerrainHeight(CAMPFIRE.x, CAMPFIRE.z) + 0.9, CAMPFIRE.z);
    scene.add(L);
    let tt = 0;
    propMixers.push({ update(dt) { tt += dt; L.intensity = 22 + Math.sin(tt * 13) * 3 + Math.sin(tt * 31.7) * 2.5 + Math.random() * 2; } });
    treeColliders.push({ x: CAMPFIRE.x, z: CAMPFIRE.z, r: 0.7 });
    rebuildStaticGrid();
});

whenProp('water2', gltf => {
    const model = gltf.scene.clone(true);
    const holder = new THREE.Group(); holder.add(model); holder.updateMatrixWorld(true);
    const sz = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    const kx = WORLD_SIZE / Math.max(sz.x, 0.001), kz = WORLD_SIZE / Math.max(sz.z, 0.001);
    const ky = 0.08 / 5.5;
    holder.scale.set(kx, ky, kz); holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(holder), c = b.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, -0.32 - c.y, -c.z);
    const sharedMat = new THREE.MeshStandardMaterial({
        color: 0x326f78, transparent: true, opacity: 0.28, depthWrite: false,
        roughness: 0.35, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        envMapIntensity: 0.25
    });
    model.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false; o.receiveShadow = true;
        const orig = Array.isArray(o.material) ? o.material[0] : o.material;
        const m = sharedMat.clone();
        if (orig && orig.map) {
            m.map = orig.map;
            m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
            m.map.repeat.set(40, 40);
            m.map.needsUpdate = true;
        }
        o.material = m;
        water2Mats.push(m);
    });
    scene.add(holder);
    G.water2Holder = holder;
    updateSkyAndWeather();
    if (gltf.animations.length) {
        const clip = gltf.animations[0].clone();
        clip.tracks = clip.tracks.filter(t => t.name.endsWith('morphTargetInfluences'));
        if (clip.tracks.length) {
            const mx = new THREE.AnimationMixer(model);
            mx.clipAction(clip).play();
            propMixers.push(mx);
        }
    }
});
