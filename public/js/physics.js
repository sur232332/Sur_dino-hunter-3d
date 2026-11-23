import * as THREE from 'three';
import {
    CABIN, HELIPAD, HANGAR,
    treeColliders, structures, vehicles, traffic, swatUnits
} from './state.js';

export function hash2(x, z) {
    const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return n - Math.floor(n);
}

export function noise2D(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x, z, octaves = 4) {
    let val = 0, amp = 0.5, freq = 1.0;
    for (let i = 0; i < octaves; i++) {
        val += amp * noise2D(x * freq, z * freq);
        freq *= 2.02;
        amp *= 0.5;
    }
    return val;
}

export function getRoadCenterX(z) { return -18 + Math.sin(z * 0.015) * 10; }
export function getRiverCenterX(z) { return 32 + Math.cos(z * 0.018) * 16; }

export function getTerrainHeight(x, z) {
    const distRoad = Math.abs(x - getRoadCenterX(z));
    const distRiver = Math.abs(x - getRiverCenterX(z));
    const distCamp = Math.hypot(x, z);
    const distBase = Math.hypot(x + 45, z + 45);

    let h = fbm(x * 0.012, z * 0.012, 4) * 16.5 + noise2D(x * 0.05, z * 0.05) * 2.2 - 5.2;

    if (distCamp < 22) h *= THREE.MathUtils.smoothstep(distCamp, 8, 22);
    if (distBase < 24) h *= THREE.MathUtils.smoothstep(distBase, 12, 24);
    const dPad = Math.hypot(x + 48, z + 32), dHang = Math.hypot(x + 45, z + 62);
    if (dPad < 26) h *= THREE.MathUtils.smoothstep(dPad, 15, 26);
    if (dHang < 30) h *= THREE.MathUtils.smoothstep(dHang, 19, 30);
    if (distRoad < 15.0) h = THREE.MathUtils.lerp(0.14, h, THREE.MathUtils.smoothstep(distRoad, 8.2, 15.0));
    if (distRiver < 16) h = THREE.MathUtils.lerp(-2.6, h, THREE.MathUtils.smoothstep(distRiver, 5, 16));
    return h;
}

export function groundY(x, z) {
    let h = getTerrainHeight(x, z);
    if (HELIPAD.top !== null && Math.abs(x - HELIPAD.x) < HELIPAD.half && Math.abs(z - HELIPAD.z) < HELIPAD.half) {
        h = Math.max(h, HELIPAD.top);
    }
    if (Math.abs(x - getRoadCenterX(z)) < 6.0) {
        h = Math.max(h, 0.22) + 0.12;
    }
    for (let i = 0; i < structures.length; i++) {
        const st = structures[i];
        if (st.type === 'floor' && st.col) {
            const dx = x - st.col.x, dz = z - st.col.z;
            if (Math.abs(dx) > st.col.hw + 0.5 || Math.abs(dz) > st.col.hl + 0.5) continue;
            const s = Math.sin(st.col.rot), c = Math.cos(st.col.rot);
            const lx = dx * c - dz * s, lz = dx * s + dz * c;
            if (Math.abs(lx) <= st.col.hw && Math.abs(lz) <= st.col.hl) {
                h = Math.max(h, st.col.topY);
            }
        }
    }
    return h;
}

export function angleLerp(a, b, t) {
    let d = b - a;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return a + d * t;
}

// 2D Spatial Hash Grid (16m cells) for O(1) collision queries
export class SpatialHashGrid {
    constructor(cellSize = 16) {
        this.cellSize = cellSize;
        this.cells = new Map();
        this._stamp = 1;
    }

    clear() {
        this.cells.clear();
    }

    _key(cx, cz) {
        return ((cx + 512) << 12) | (cz + 512);
    }

    insert(item, x, z, radius = 1) {
        const cs = this.cellSize;
        const minX = Math.floor((x - radius) / cs);
        const maxX = Math.floor((x + radius) / cs);
        const minZ = Math.floor((z - radius) / cs);
        const maxZ = Math.floor((z + radius) / cs);
        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const k = this._key(cx, cz);
                let bucket = this.cells.get(k);
                if (!bucket) {
                    bucket = [];
                    this.cells.set(k, bucket);
                }
                bucket.push(item);
            }
        }
    }

    query(x, z, radius, out = []) {
        out.length = 0;
        const cs = this.cellSize;
        const minX = Math.floor((x - radius) / cs);
        const maxX = Math.floor((x + radius) / cs);
        const minZ = Math.floor((z - radius) / cs);
        const maxZ = Math.floor((z + radius) / cs);
        const stamp = ++this._stamp;
        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const bucket = this.cells.get(this._key(cx, cz));
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                    const it = bucket[i];
                    if (it._qStamp !== stamp) {
                        it._qStamp = stamp;
                        out.push(it);
                    }
                }
            }
        }
        return out;
    }
}

export const staticGrid = new SpatialHashGrid(16);
export const dynamicGrid = new SpatialHashGrid(16);

export function rebuildStaticGrid() {
    staticGrid.clear();
    for (let i = 0; i < treeColliders.length; i++) {
        const tc = treeColliders[i];
        staticGrid.insert(tc, tc.x, tc.z, tc.r || 1);
    }
    for (let i = 0; i < structures.length; i++) {
        const st = structures[i];
        if (!st.col) continue;
        const r = st.col.r || Math.max(st.col.hw || 1.6, st.col.hl || 1.6);
        staticGrid.insert(st.col, st.col.x, st.col.z, r);
    }
}

export function rebuildDynamicGrid() {
    dynamicGrid.clear();
    for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        const r = v.colBox ? Math.max(v.colBox.hw, v.colBox.hl) : 3.2;
        dynamicGrid.insert({ kind: 'veh', ref: v }, v.mesh.position.x, v.mesh.position.z, r);
    }
    for (let i = 0; i < traffic.length; i++) {
        const t = traffic[i];
        if (!t.mesh.visible) continue;
        const r = t.colBox ? Math.max(t.colBox.hw, t.colBox.hl) : 2.8;
        dynamicGrid.insert({ kind: 'traf', ref: t }, t.mesh.position.x, t.mesh.position.z, r);
    }
    for (let i = 0; i < swatUnits.length; i++) {
        const su = swatUnits[i];
        if (su.noCar || su.carDead) continue;
        const r = su.colBox ? Math.max(su.colBox.hw, su.colBox.hl) : 3.0;
        dynamicGrid.insert({ kind: 'swat', ref: su }, su.mesh.position.x, su.mesh.position.z, r);
    }
}

export function alignVehicleToGround(v, dt = 0) {
    const m = v.mesh;
    m.rotation.order = 'YXZ';
    const s = Math.sin(m.rotation.y), c = Math.cos(m.rotation.y);
    const hw = v.type === 'tank' ? 1.45 : v.type === 'atv' ? 0.65 : 0.95;
    const hl = v.type === 'tank' ? 2.6 : v.type === 'atv' ? 0.9 : 1.7;
    const sample = (lx, lz) => groundY(m.position.x + lx * c + lz * s, m.position.z - lx * s + lz * c);
    const fl = sample(hw, hl), fr = sample(-hw, hl), rl = sample(hw, -hl), rr = sample(-hw, -hl), gc = groundY(m.position.x, m.position.z);
    const avgW = (fl + fr + rl + rr) * 0.25, maxW = Math.max(fl, fr, rl, rr);
    const targetY = Math.max(gc, avgW * 0.7 + maxW * 0.3) + 0.04;
    const targetPitch = THREE.MathUtils.clamp(-Math.atan2((fl + fr) * 0.5 - (rl + rr) * 0.5, hl * 2), -0.42, 0.42);
    const targetRoll = THREE.MathUtils.clamp(Math.atan2((fl + rl) * 0.5 - (fr + rr) * 0.5, hw * 2), -0.35, 0.35);
    m.position.y = targetY;
    if (dt > 0) {
        const k = Math.min(1, dt * 10);
        m.rotation.x += (targetPitch - m.rotation.x) * k;
        m.rotation.z += (targetRoll - m.rotation.z) * k;
    } else {
        m.rotation.x = targetPitch;
        m.rotation.z = targetRoll;
    }
    return targetY;
}

export function carGroundY(v) {
    return alignVehicleToGround(v, 0);
}

const _qStat = [];
const _qDyn = [];

// Consistent OBB collision check using v.colBox dimensions directly
export function carBlocked(v, x, z, rotY) {
    const s = Math.sin(rotY), c = Math.cos(rotY);
    if (v.isBoat) {
        for (const off of [2.5, 0, -2.5]) {
            if (getTerrainHeight(x + s * off, z + c * off) > -0.7) return true;
        }
        for (let i = 0; i < vehicles.length; i++) {
            const o = vehicles[i];
            if (o !== v && o.isBoat && Math.hypot(x - o.mesh.position.x, z - o.mesh.position.z) < 5.5) return true;
        }
        return false;
    }

    const myHw = v.colBox ? v.colBox.hw : (v.type === 'tank' ? 1.55 : v.type === 'atv' ? 0.78 : 1.0);
    const myHl = v.colBox ? v.colBox.hl : (v.type === 'tank' ? 3.2 : v.type === 'atv' ? 1.15 : 2.2);
    const curX = v.mesh.position.x, curZ = v.mesh.position.z;
    const sampOff = Math.max(0.9, myHl - myHw);

    staticGrid.query(x, z, myHl + 4, _qStat);
    dynamicGrid.query(x, z, myHl + 6, _qDyn);

    for (const off of [sampOff, 0, -sampOff]) {
        const px = x + s * off, pz = z + c * off;
        if (getTerrainHeight(px, pz) < -0.25) return true;

        for (let i = 0; i < _qStat.length; i++) {
            const t = _qStat[i];
            if (t.isFloor) continue;
            if (t.isWall) {
                const dx = px - t.x, dz = pz - t.z;
                const ts = Math.sin(t.rot), tc = Math.cos(t.rot);
                const lx = dx * tc - dz * ts, lz = dx * ts + dz * tc;
                if (Math.abs(lx) < t.hw + myHw && Math.abs(lz) < t.hl + myHw) {
                    const nd = Math.hypot(dx, dz), od = Math.hypot(curX + s * off - t.x, curZ + c * off - t.z);
                    if (nd < od) return true;
                }
                continue;
            }
            const rad = t.r + myHw * 0.75;
            const nd = Math.hypot(px - t.x, pz - t.z);
            if (nd < rad && nd < Math.hypot(curX + s * off - t.x, curZ + c * off - t.z)) return true;
        }

        for (let i = 0; i < _qDyn.length; i++) {
            const entry = _qDyn[i];
            const o = entry.ref;
            if (o === v) continue;
            if (o.isBoat) continue;
            if (o.flies && o.mesh.position.y > groundY(o.mesh.position.x, o.mesh.position.z) + 2.5) continue;
            const ohw = o.colBox ? o.colBox.hw : 1.05;
            const ohl = o.colBox ? o.colBox.hl : 2.25;
            const ox = o.mesh.position.x, oz = o.mesh.position.z;
            const dx = px - ox, dz = pz - oz;
            const os = Math.sin(o.mesh.rotation.y), oc = Math.cos(o.mesh.rotation.y);
            const lx = dx * oc - dz * os, lz = dx * os + dz * oc;
            if (Math.abs(lx) < ohw + myHw && Math.abs(lz) < ohl + myHw) {
                if (Math.hypot(x - ox, z - oz) < Math.hypot(curX - ox, curZ - oz)) return true;
            }
        }
    }
    return false;
}

// Resolve circle vs static obstacles + structures in spatial hash grid
export function resolveStaticObstacles(x, z, y, actorR, outPos, pushOut = true) {
    staticGrid.query(x, z, actorR + 3.5, _qStat);
    let nx = x, nz = z, blocked = false;
    for (let i = 0; i < _qStat.length; i++) {
        const t = _qStat[i];
        if (t.isFloor) continue;
        if (t.isWall) {
            if (y > (t.baseY || 0) + (t.h || 2.8)) continue;
            const dx = nx - t.x, dz = nz - t.z;
            const s = Math.sin(t.rot), c = Math.cos(t.rot);
            const lx = dx * c - dz * s, lz = dx * s + dz * c;
            const hw = t.hw + actorR, hl = t.hl + actorR;
            if (Math.abs(lx) < hw && Math.abs(lz) < hl) {
                blocked = true;
                if (!pushOut) { outPos.hit = true; return outPos; }
                const ex = hw - Math.abs(lx), ez = hl - Math.abs(lz);
                let pl = lx, pz2 = lz;
                if (ex < ez) pl = Math.sign(lx || 1) * hw;
                else pz2 = Math.sign(lz || 1) * hl;
                nx = t.x + pl * c + pz2 * s;
                nz = t.z - pl * s + pz2 * c;
            }
            continue;
        }
        const rad = t.r + actorR;
        const dx = nx - t.x, dz = nz - t.z;
        if (Math.abs(dx) < rad && Math.abs(dz) < rad) {
            const d = Math.hypot(dx, dz);
            if (d < rad && d > 1e-4) {
                blocked = true;
                if (!pushOut) { outPos.hit = true; return outPos; }
                nx = t.x + (dx / d) * rad;
                nz = t.z + (dz / d) * rad;
            }
        }
    }
    outPos.x = nx;
    outPos.z = nz;
    outPos.hit = blocked;
    return outPos;
}

// Analytical segment vs oriented bounding box intersection (returns t in [0, 1] or >1 if miss)
function intersectSegmentOBB(ox, oy, oz, dx, dy, dz, bx, by, bz, rotY, hw, hh, hl) {
    const s = Math.sin(rotY), c = Math.cos(rotY);
    const rx = ox - bx, ry = oy - by, rz = oz - bz;
    const lox = rx * c - rz * s, loy = ry, loz = rx * s + rz * c;
    const ldx = dx * c - dz * s, ldy = dy, ldz = dx * s + dz * c;

    let tmin = 0.0, tmax = 1.0;
    const slab = (p, d, mn, mx) => {
        if (Math.abs(d) < 1e-7) return p >= mn && p <= mx;
        let t1 = (mn - p) / d, t2 = (mx - p) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        return tmin <= tmax;
    };
    if (!slab(lox, ldx, -hw, hw)) return 2.0;
    if (!slab(loy, ldy, 0.0, hh)) return 2.0;
    if (!slab(loz, ldz, -hl, hl)) return 2.0;
    return tmin;
}

// Fast analytical 3rd-person camera clipping (zero triangle raycasts, zero allocations)
export function clipCameraRay(tx, ty, tz, camPos, excludeVehicle) {
    const dx = camPos.x - tx, dy = camPos.y - ty, dz = camPos.z - tz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.6) return;

    let bestT = 1.0;
    const cabinY = getTerrainHeight(CABIN.x, CABIN.z) - 0.15;
    const tc = intersectSegmentOBB(tx, ty, tz, dx, dy, dz, CABIN.x, cabinY, CABIN.z, 0, CABIN.hx + 0.35, CABIN.h || 5.8, CABIN.hz + 0.35);
    if (tc > 0.05 && tc < bestT) bestT = tc;

    const hangarY = getTerrainHeight(HANGAR.x, HANGAR.z) - 0.1;
    const th = intersectSegmentOBB(tx, ty, tz, dx, dy, dz, HANGAR.x, hangarY, HANGAR.z, 0, HANGAR.hx + 0.3, HANGAR.h || 6.8, HANGAR.hz + 0.3);
    if (th > 0.05 && th < bestT) bestT = th;

    dynamicGrid.query(tx, tz, 18, _qDyn);
    for (let i = 0; i < _qDyn.length; i++) {
        const o = _qDyn[i].ref;
        if (o === excludeVehicle) continue;
        const cb = o.colBox;
        const hw = cb ? cb.hw : 1.4, hl = cb ? cb.hl : 2.5, hh = cb ? cb.h : 2.4;
        const tv = intersectSegmentOBB(
            tx, ty, tz, dx, dy, dz,
            o.mesh.position.x, o.mesh.position.y, o.mesh.position.z,
            o.mesh.rotation.y, hw + 0.2, hh + 0.2, hl + 0.2
        );
        if (tv > 0.05 && tv < bestT) bestT = tv;
    }

    if (bestT < 1.0) {
        const pull = Math.max(0.22, bestT - 0.45 / len);
        camPos.set(tx + dx * pull, ty + dy * pull, tz + dz * pull);
    }
}
