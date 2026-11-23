import * as THREE from 'three';
import {
    WEAPONS, player, CABIN, HOUSE_INT, creatures, vehicles, swatUnits,
    keys, G
} from './state.js';
import {
    mountEl, hudCtx, radarCtx, W, H, isMobile, scene, camera, renderer,
    rainPoints, updateSkyAndWeather, isSSAOEnabled, toggleSSAO, toggleBloom
} from './scene.js';
import { getRiverCenterX, getRoadCenterX, getTerrainHeight, groundY } from './physics.js';
import { sfx } from './audio.js';
import { terrainMesh } from './terrain.js';
import { setBodyOpacity, spawnCreature, spawnSwatPatrol } from './ai.js';
import { createVehicle } from './vehicles.js';
import {
    ghostMesh, updateGhostGeometry, buildObject, syncWeaponModels,
    reloadWeapon, fireTankCannon, fireWeapon
} from './player.js';

let joyRectCache = null;
export function invalidateMobileLayout() {
    joyRectCache = null;
}

export function pushFeed(txt) {
    const f = document.getElementById('kill-feed');
    if (!f) return;
    const d = document.createElement('div');
    d.className = 'kf-msg';
    d.textContent = txt;
    f.appendChild(d);
    setTimeout(() => d.remove(), 3500);
}
G.ui.pushFeed = pushFeed;

export function updateBarsUI() {
    const hp = document.getElementById('bar-hp');
    const ar = document.getElementById('bar-ar');
    const st = document.getElementById('bar-st');
    const hu = document.getElementById('bar-hu');
    if (hp) hp.style.width = Math.max(0, player.hp) + '%';
    if (ar) ar.style.width = Math.max(0, player.armor) + '%';
    if (st) st.style.width = Math.max(0, player.stamina) + '%';
    if (hu) hu.style.width = Math.max(0, player.hunger) + '%';
}
G.ui.updateBarsUI = updateBarsUI;

export function syncUI() {
    const w = WEAPONS[G.curWeap];
    const cashEl = document.getElementById('ui-cash');
    const weapEl = document.getElementById('ui-weap');
    if (cashEl) cashEl.textContent = '$' + String(player.cash).padStart(7, '0');
    if (weapEl && w) weapEl.textContent = `${w.name} [${w.mag}/${w.res}]`;
    const wt = document.getElementById('wheel-title');
    if (wt && w) wt.textContent = w.name;
    syncWeaponModels();

    const rWood = document.getElementById('r-wood');
    const rStone = document.getElementById('r-stone');
    const rMeat = document.getElementById('r-meat');
    const rXp = document.getElementById('r-xp');
    if (rWood) rWood.textContent = player.wood;
    if (rStone) rStone.textContent = player.stone;
    if (rMeat) rMeat.textContent = player.meat;
    if (rXp) rXp.textContent = player.xp;

    updateBarsUI();

    const wRow = document.getElementById('ui-stars');
    if (wRow) {
        wRow.classList.toggle('flashing', player.wanted > 0);
        let stHtml = '';
        for (let i = 1; i <= 5; i++) stHtml += `<span class="${i <= player.wanted ? 'on' : 'off'}">★</span>`;
        wRow.innerHTML = stHtml;
    }
}
G.ui.syncUI = syncUI;

export function toggleXRayScope(force = null) {
    player.xrayScope = force !== null ? force : !player.xrayScope;
    const w = WEAPONS[G.curWeap];
    camera.fov = player.xrayScope ? w.zoom : 60;
    camera.updateProjectionMatrix();
    const btnXray = document.getElementById('btn-xray');
    if (btnXray) btnXray.classList.toggle('active', player.xrayScope);

    creatures.forEach(c => {
        if (c.state === 'DEAD') return;
        setBodyOpacity(c, player.xrayScope ? 0.36 : 1.0);
        c.organMats.forEach(m => { m.opacity = player.xrayScope ? 0.95 : 0.0; });
    });
}
G.ui.toggleXRayScope = toggleXRayScope;

function setBuildMode(mode) {
    player.mode = mode;
    ghostMesh.visible = (mode === 'build');
    if (mode === 'build') updateGhostGeometry(player.buildType);
    const bHunt = document.getElementById('b-mode-hunt');
    const bBuild = document.getElementById('b-mode-build');
    if (bHunt) bHunt.classList.toggle('active', mode === 'hunt');
    if (bBuild) bBuild.classList.toggle('active', mode === 'build');
}

export function drawRadar() {
    const R = 85, k = R / 70, c = radarCtx;
    const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
    const rgtX = Math.cos(player.yaw), rgtZ = -Math.sin(player.yaw);
    const proj = (wx, wz) => {
        const dx = wx - player.x, dz = wz - player.z;
        return [R + (dx * rgtX + dz * rgtZ) * k, R - (dx * fwdX + dz * fwdZ) * k];
    };
    const edge = (wx, wz) => {
        const [x, y] = proj(wx, wz);
        let ox = x - R, oy = y - R;
        const l = Math.hypot(ox, oy), lim = R - 7;
        if (l > lim) { ox *= lim / l; oy *= lim / l; }
        return [R + ox, R + oy];
    };
    c.clearRect(0, 0, 170, 170);
    c.fillStyle = 'rgba(10, 22, 18, 0.96)';
    c.fillRect(0, 0, 170, 170);

    const strokePath = (fn, color, wWorld) => {
        c.strokeStyle = color;
        c.lineWidth = Math.max(2, wWorld * k);
        c.lineJoin = 'round';
        c.beginPath();
        for (let o = -75; o <= 75; o += 10) {
            const wz = player.z + o;
            const [x, y] = proj(fn(wz), wz);
            if (o === -75) c.moveTo(x, y);
            else c.lineTo(x, y);
        }
        c.stroke();
    };
    strokePath(getRiverCenterX, '#1e4f8f', 12);
    strokePath(getRoadCenterX, '#6b7280', 5);

    const dot = (wx, wz, col, r, sq) => {
        const [x, y] = edge(wx, wz);
        c.fillStyle = col;
        if (sq) c.fillRect(x - r, y - r, r * 2, r * 2);
        else { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
    };
    dot(-45, -45, '#a1a1aa', 4, true);
    dot(0, 0, '#fb923c', 3.5, true);
    vehicles.forEach(v => { if (v !== player.vehicle) dot(v.mesh.position.x, v.mesh.position.z, '#22d3ee', 3, true); });
    creatures.forEach(cr => {
        if (cr.state === 'DEAD') return;
        const col = cr.tamed ? '#4ade80' : (cr.spec.aggr ? '#ef4444' : '#facc15');
        dot(cr.mesh.position.x, cr.mesh.position.z, col, cr.type === 'trex' ? 5 : 3, false);
    });
    const flash = (performance.now() % 500) < 250;
    swatUnits.forEach(s => {
        if (!s.carDead) {
            dot(s.mesh.position.x, s.mesh.position.z, flash ? '#3b82f6' : '#ef4444', 3.5, false);
        } else {
            (s.officers || []).forEach(o => {
                if (o && !o.userData.dead && o.visible) dot(o.position.x, o.position.z, flash ? '#3b82f6' : '#ef4444', 2.8, false);
            });
        }
    });

    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(R, R - 7);
    c.lineTo(R + 5, R + 5);
    c.lineTo(R, R + 2);
    c.lineTo(R - 5, R + 5);
    c.closePath();
    c.fill();
}

export function drawHud() {
    const g = hudCtx, cx = W / 2, cy = H / 2;
    g.clearRect(0, 0, W, H);

    if (player.xrayScope && !player.vehicle) {
        const r = Math.min(W, H) * 0.43;
        g.fillStyle = 'rgba(0,0,0,0.94)';
        g.beginPath(); g.rect(0, 0, W, H); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill('evenodd');
        g.strokeStyle = 'rgba(236,72,153,0.9)'; g.lineWidth = 2;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(cx - r, cy); g.lineTo(cx - 14, cy); g.moveTo(cx + 14, cy); g.lineTo(cx + r, cy);
        g.moveTo(cx, cy - r); g.lineTo(cx, cy - 14); g.moveTo(cx, cy + 14); g.lineTo(cx, cy + r);
        g.stroke();
        g.fillStyle = '#ef4444'; g.beginPath(); g.arc(cx, cy, 2.2, 0, Math.PI * 2); g.fill();
    } else if (player.mode !== 'build' && !player.vehicle) {
        const mx = isMobile ? cx : (G.mouseVec.x + 1) / 2 * W;
        const my = isMobile ? cy : (1 - G.mouseVec.y) / 2 * H;
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(mx - 10, my); g.lineTo(mx - 4, my); g.moveTo(mx + 4, my); g.lineTo(mx + 10, my);
        g.moveTo(mx, my - 10); g.lineTo(mx, my - 4); g.moveTo(mx, my + 4); g.lineTo(mx, my + 10);
        g.stroke();
    }

    const danger = Math.max(G.hurtFlash, player.hp < 30 ? 0.35 : 0);
    if (danger > 0) {
        const grad = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.75);
        grad.addColorStop(0, 'rgba(220,0,0,0)');
        grad.addColorStop(1, 'rgba(220,0,0,' + Math.min(0.6, danger) + ')');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
    }
}

function handleInteractKey() {
    const nearTarget = G.nearTarget;
    if (player.vehicle) {
        const v = player.vehicle, vm = v.mesh, s = Math.sin(vm.rotation.y), c = Math.cos(vm.rotation.y);
        const sideDist = v.colBox ? v.colBox.hw + 0.95 : (v.type === 'jet' ? 5.2 : v.flies ? 3.2 : 2.35);
        player.x = vm.position.x + sideDist * c;
        player.z = vm.position.z - sideDist * s;
        const gnd = groundY(player.x, player.z);
        if (v.isBoat) {
            player.y = Math.max(gnd, -1.60);
            player.vy = 0;
            player.airVx = 0;
            player.airVz = 0;
            player.wasSwim = false;
        } else {
            player.y = v.flies ? Math.max(gnd, vm.position.y) : gnd;
            const bailed = v.flies && player.y > gnd + 0.8;
            player.vy = bailed ? Math.max(-2, (v.vy || 0) * 0.45 + 1.5) : 0;
            player.airVx = bailed ? s * (v.speed || 0) * 0.55 + c * 2.2 : 0;
            player.airVz = bailed ? c * (v.speed || 0) * 0.55 - s * 2.2 : 0;
        }
        player.vehicle = null;
    } else if (player.mount) {
        player.mount = null;
    } else if (nearTarget && nearTarget.isHouseIn) {
        player.inHouse = true;
        player.x = HOUSE_INT.x;
        player.y = HOUSE_INT.y;
        player.z = HOUSE_INT.z + HOUSE_INT.doorZ + 0.6;
        player.vy = 0;
        player.yaw = Math.PI;
        pushFeed('🏠 Բարի գալուստ տուն! Մոտեցիր մահճակալին՝ հանգստանալու համար։');
    } else if (nearTarget && nearTarget.isHouseOut) {
        player.inHouse = false;
        const dx = CABIN.door ? CABIN.door.x : CABIN.x;
        const dz = CABIN.door ? CABIN.door.z - 0.6 : CABIN.z - 7;
        player.x = dx;
        player.z = dz;
        player.y = getTerrainHeight(dx, dz);
        player.vy = 0;
        pushFeed('🚪 Դուրս եկաք տնից');
    } else if (nearTarget && nearTarget.isBed) {
        player.hp = 100;
        player.armor = 100;
        player.stamina = 100;
        player.hunger = 100;
        syncUI();
        pushFeed('🛏️ Լիարժեք հանգստացաք (+100% HP / Զրահ / Սնունդ)');
    } else if (nearTarget && nearTarget.isTraffic) {
        G.fn.startCarjack(nearTarget.ref);
    } else if (nearTarget && nearTarget.isVehicle) {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        player.vehicle = nearTarget.ref;
        player.vehCam = player.thirdPerson ? 0 : 2;
        pushFeed(player.vehicle.flies
            ? '🚁 [Space / Shift] Վերև | [C / Ctrl] Ներքև | [WASD] Թռչել'
            : '🎥 [V] — փոխել տեսքը. 3-րդ սեղմումը՝ կապոտի (1-ին դեմք) տեսք');
        toggleXRayScope(false);
    } else if (nearTarget && nearTarget.isDino) {
        player.mount = nearTarget.ref;
        toggleXRayScope(false);
    } else if (nearTarget && nearTarget.isDemolish) {
        G.fn.demolishStructure(nearTarget.ref);
    }
}

export function initUI() {
    syncUI();

    let isDragging = false, downX = 0, downY = 0;

    renderer.domElement.addEventListener('mousedown', e => {
        if (isMobile) return;
        if (e.button === 2) { toggleXRayScope(); return; }
        downX = e.clientX;
        downY = e.clientY;
        isDragging = true;
    });

    window.addEventListener('mousemove', e => {
        if (isMobile) return;
        G.mouseVec.x = (e.clientX / W) * 2 - 1;
        G.mouseVec.y = -(e.clientY / H) * 2 + 1;

        if (player.mode === 'build' && terrainMesh) {
            G.raycaster.setFromCamera(G.mouseVec, camera);
            const hits = G.raycaster.intersectObject(terrainMesh);
            if (hits.length > 0) {
                ghostMesh.position.copy(hits[0].point);
                ghostMesh.position.y += (ghostMesh.userData.yOff || 0.25);
                ghostMesh.rotation.y = player.buildRot;
            }
        }
        if (isDragging) {
            const sens = player.xrayScope ? 0.0012 : 0.0042;
            if (player.vehicle) {
                player.camOff = (player.camOff || 0) - e.movementX * sens;
                player.camOffT = 1.5;
            }
            player.yaw -= e.movementX * sens;
            player.pitch = Math.max(-0.8, Math.min(1.1, player.pitch + e.movementY * sens));
        }
    });

    window.addEventListener('mouseup', e => {
        if (isMobile || !isDragging) return;
        isDragging = false;
        if (Math.hypot(e.clientX - downX, e.clientY - downY) < 6 && e.button === 0) {
            if (player.mode === 'build') {
                buildObject(player.buildType, ghostMesh.position.x, ghostMesh.position.z, player.buildRot, false);
            } else {
                fireWeapon(e.clientX, e.clientY);
            }
        }
    });
    window.addEventListener('contextmenu', e => e.preventDefault());

    // Consolidated keyboard listener (no duplicate listeners)
    window.addEventListener('keydown', e => {
        const code = e.code;
        if (code === 'Tab' || code === 'Space') e.preventDefault();
        if (e.repeat) return;
        keys[code] = true;

        if (code === 'KeyW' || code === 'ArrowUp') keys['w'] = true;
        if (code === 'KeyQ') keys['q'] = true;
        if (code === 'KeyS' || code === 'ArrowDown') keys['s'] = true;
        if (code === 'KeyA' || code === 'ArrowLeft') keys['a'] = true;
        if (code === 'KeyD' || code === 'ArrowRight') keys['d'] = true;
        if (code === 'ShiftLeft' || code === 'ShiftRight') keys['shift'] = true;
        if (code === 'ControlLeft' || code === 'ControlRight') keys['ctrl'] = true;
        if (code === 'Space') keys[' '] = true;
        if (code === 'KeyC') keys['c'] = true;
        if (code === 'KeyG') keys['g'] = true;

        if (code === 'KeyV' && player.vehicle) {
            player.vehCam = ((player.vehCam || 0) + 1) % 3;
            pushFeed(['🎥 Հեռու տեսք', '🎥 Մոտիկ տեսք', '🎥 Ղեկի / Կապոտի տեսք'][player.vehCam]);
        } else if (code === 'KeyV') {
            player.thirdPerson = !player.thirdPerson;
            const bc = document.getElementById('btn-cam');
            if (bc) bc.textContent = player.thirdPerson ? '🎥 3-րդ Դեմք [V]' : '👁️ 1-ին Դեմք [V]';
        }
        if (code === 'KeyZ') toggleXRayScope();
        if (code === 'KeyL') {
            const on = toggleBloom();
            pushFeed('Bloom: ' + (on ? 'ON' : 'OFF'));
        }
        if (code === 'KeyH') {
            const tm = creatures.filter(c => c.tamed && c.state !== 'DEAD');
            tm.forEach(c => { c.followT = 15; });
            pushFeed(tm.length ? '📣 Ընտանի կենդանիները գալիս են ձեր հետևից (15 վ)' : 'Ընտանի կենդանի չունեք');
        }
        if (code === 'KeyF') {
            if (player.meat > 0 && player.hunger < 95) {
                player.meat--;
                player.hunger = Math.min(100, player.hunger + 30);
                player.hp = Math.min(100, player.hp + 10);
                syncUI();
                pushFeed('🍖 Կերաք միս (+30 սնունդ)');
            } else {
                pushFeed(player.meat > 0 ? 'Դուք կուշտ եք' : '⚠️ Միս չկա');
            }
        }
        if (code === 'KeyK') {
            const rc = new THREE.Raycaster();
            rc.setFromCamera(new THREE.Vector2(0, 0), camera);
            const hits = rc.intersectObjects(scene.children, true).filter(
                h => h.object.visible && h.object.material && h.object.material.visible !== false
            );
            let txt = 'K: ոչինչ';
            if (hits.length) {
                const h = hits[0];
                const chain = [];
                let o = h.object;
                while (o && chain.length < 6) {
                    chain.push((o.name || o.type).slice(0, 24));
                    o = o.parent;
                }
                txt = 'K: ' + chain.join(' < ') + ' | ' + (h.object.geometry && h.object.geometry.type) + ' | ' + h.distance.toFixed(1) + 'm';
            }
            window.debugK = txt;
            pushFeed(txt);
        }
        if (code === 'KeyC' && (!player.vehicle || !player.vehicle.flies)) {
            player.stealth = !player.stealth;
        }
        if (code === 'KeyR') {
            if (player.mode === 'build') {
                player.buildRot += Math.PI / 4;
                ghostMesh.rotation.y = player.buildRot;
            } else {
                reloadWeapon();
            }
        }
        if (code === 'KeyU' || code === 'Escape') {
            const sm = document.getElementById('shop-modal');
            if (sm) sm.style.display = (code === 'KeyU' && sm.style.display !== 'flex') ? 'flex' : 'none';
        }
        if (code === 'KeyB') {
            setBuildMode(player.mode === 'hunt' ? 'build' : 'hunt');
        }
        if (code === 'Tab') {
            const ww = document.getElementById('weapon-wheel');
            if (ww) ww.style.display = ww.style.display === 'flex' ? 'none' : 'flex';
        }
        if (code >= 'Digit1' && code <= 'Digit8') {
            G.curWeap = Number(code.replace('Digit', '')) - 1;
            document.querySelectorAll('.w-slot').forEach((s, i) => s.classList.toggle('active', i === G.curWeap));
            syncUI();
        }
        if (code === 'Space' && player.vehicle && player.vehicle.type === 'tank') {
            fireTankCannon(player.vehicle);
        }
        if (code === 'Space' && !player.vehicle && player.vy === 0) {
            player.vy = 7.8;
        }
        if (code === 'KeyE') handleInteractKey();
    });

    window.addEventListener('keyup', e => {
        const code = e.code;
        keys[code] = false;
        if (code === 'KeyW' || code === 'ArrowUp') keys['w'] = false;
        if (code === 'KeyQ') keys['q'] = false;
        if (code === 'KeyS' || code === 'ArrowDown') keys['s'] = false;
        if (code === 'KeyA' || code === 'ArrowLeft') keys['a'] = false;
        if (code === 'KeyD' || code === 'ArrowRight') keys['d'] = false;
        if (code === 'ShiftLeft' || code === 'ShiftRight') keys['shift'] = false;
        if (code === 'ControlLeft' || code === 'ControlRight') keys['ctrl'] = false;
        if (code === 'Space') keys[' '] = false;
        if (code === 'KeyC') keys['c'] = false;
        if (code === 'KeyG') keys['g'] = false;
    });

    document.addEventListener('click', e => {
        if (e.target && e.target.tagName === 'BUTTON') e.target.blur();
    });

    // Top toolbar & Mission expand toggle
    const missionEl = document.getElementById('mission-txt');
    if (missionEl) missionEl.onclick = () => missionEl.classList.toggle('expanded');

    document.getElementById('btn-cam').onclick = () => {
        if (player.vehicle) {
            player.vehCam = ((player.vehCam || 0) + 1) % 3;
            pushFeed(['🎥 Հեռու տեսք', '🎥 Մոտիկ տեսք', '🎥 Ղեկի / Կապոտի տեսք'][player.vehCam]);
            return;
        }
        player.thirdPerson = !player.thirdPerson;
        document.getElementById('btn-cam').textContent = player.thirdPerson ? '🎥 3-րդ Դեմք [V]' : '👁️ 1-ին Դեմք [V]';
    };
    document.getElementById('btn-xray').onclick = () => toggleXRayScope();
    document.getElementById('btn-weather').onclick = e => {
        G.weatherMode = (G.weatherMode + 1) % 3;
        rainPoints.visible = !player.inHouse && (G.weatherMode > 0);
        e.target.textContent = ['☀️ Եղանակ՝ Արևոտ', '🌧️ Եղանակ՝ Անձրև', '⛈️ Եղանակ՝ Ամպրոպ'][G.weatherMode];
        sfx.setRain(G.weatherMode);
        updateSkyAndWeather();
    };
    document.getElementById('btn-time').onclick = e => {
        G.timePreset = (G.timePreset + 1) % 4;
        e.target.textContent = ['🌇 Ժամ՝ Մայրամուտ', '☀️ Ժամ՝ Կեսօր', '🌙 Ժամ՝ Գիշեր', '🔄 Ժամ՝ Ավտո (ցիկլ)'][G.timePreset];
        updateSkyAndWeather();
    };

    const btnSsao = document.getElementById('btn-ssao');
    if (btnSsao) {
        const syncSsaoBtn = (on) => {
            btnSsao.classList.toggle('active', on);
            btnSsao.textContent = on ? '✨ Ultra SSAO: ՄԻԱՑՎԱԾ' : '✨ Ultra SSAO: ԱՆՋԱՏՎԱԾ';
        };
        syncSsaoBtn(isSSAOEnabled());
        btnSsao.onclick = () => syncSsaoBtn(toggleSSAO());
    }

    document.getElementById('btn-shop').onclick = () => { document.getElementById('shop-modal').style.display = 'flex'; };
    document.getElementById('close-shop').onclick = () => { document.getElementById('shop-modal').style.display = 'none'; };
    document.getElementById('btn-wanted').onclick = () => {
        player.wanted = Math.min(5, player.wanted + 1);
        spawnSwatPatrol();
        spawnSwatPatrol();
        syncUI();
        pushFeed('🚓 GTA WANTED LEVEL UP! Ռեյնջերների SWAT ջոկատը մոտենում է մայրուղով!');
    };

    // Build mode buttons + active state sync + matching ghost geometry
    const bHunt = document.getElementById('b-mode-hunt');
    const bBuild = document.getElementById('b-mode-build');
    if (bHunt) bHunt.onclick = () => setBuildMode('hunt');
    if (bBuild) bBuild.onclick = () => setBuildMode('build');

    const btypeBtns = Array.from(document.querySelectorAll('[data-btype]'));
    btypeBtns.forEach(btn => {
        btn.onclick = () => {
            player.buildType = btn.dataset.btype;
            btypeBtns.forEach(b => b.classList.toggle('active', b === btn));
            setBuildMode('build');
        };
    });

    // Weapon Wheel slots
    document.querySelectorAll('.w-slot').forEach(s => {
        s.onclick = () => {
            G.curWeap = Number(s.dataset.w);
            document.querySelectorAll('.w-slot').forEach((el, i) => el.classList.toggle('active', i === G.curWeap));
            document.getElementById('weapon-wheel').style.display = 'none';
            syncUI();
        };
    });

    // Upgrade Shop handlers
    document.getElementById('buy-dmg').onclick = () => {
        if (player.cash >= 800) { player.cash -= 800; player.dmgMult += 0.35; syncUI(); pushFeed('⚡ Զենքերի հզորությունը +35%!'); }
    };
    document.getElementById('buy-heal').onclick = () => {
        if (player.cash >= 300) { player.cash -= 300; player.hp = 100; player.armor = 100; syncUI(); pushFeed('🛡️ Առողջությունը և Զրահը վերականգնվեցին!'); }
    };
    document.getElementById('buy-ammo').onclick = () => {
        if (player.cash >= 400) {
            player.cash -= 400;
            WEAPONS.forEach(w => { w.mag = w.max; w.res += w.max * 3; });
            syncUI();
            pushFeed('📦 Բոլոր փամփուշտները լիցքավորվեցին!');
        }
    };
    document.getElementById('buy-heli').onclick = () => {
        if (player.cash >= 1200) {
            player.cash -= 1200;
            createVehicle('heli', player.x + 5, player.z - 5);
            syncUI();
            pushFeed('🚁 Մարտական Ուղղաթիռը վայրէջք կատարեց ձեր կողքին!');
        }
    };
    document.getElementById('buy-dino').onclick = () => {
        if (player.cash >= 900) {
            player.cash -= 900;
            spawnCreature('raptor', player.x - 4, player.z - 4, true);
            syncUI();
            pushFeed('🦖 Վարժեցված Ռապտորը պատրաստ է հեծնելու [E]!');
        }
    };

    // Mobile Multi-Touch Controls (cached joyRect + continuous analog vector)
    const joyBase = document.getElementById('m-joy-base');
    const joyKnob = document.getElementById('m-joy-knob');
    const mFire = document.getElementById('m-fire');
    const mJump = document.getElementById('m-jump');
    const mDown = document.getElementById('m-down');
    const mEnter = document.getElementById('m-enter');
    const mWeap = document.getElementById('m-weap');
    const bannerEl = document.getElementById('interact-banner');
    let joyId = null, lookId = null, lookX = 0, lookY = 0;

    const resetJoy = () => {
        joyId = null;
        if (joyKnob) joyKnob.style.transform = 'translate(0px, 0px)';
        player.joyX = 0;
        player.joyY = 0;
        player.joyMag = 0;
        keys['w'] = keys['s'] = keys['a'] = keys['d'] = keys['shift'] = false;
    };

    const updateJoy = (t) => {
        if (!joyBase || !joyKnob) return;
        const r = joyRectCache || (joyRectCache = joyBase.getBoundingClientRect());
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const maxR = Math.max(20, r.width * 0.42);
        let dx = t.clientX - cx, dy = t.clientY - cy;
        const rawDist = Math.hypot(dx, dy);
        if (rawDist > maxR && rawDist > 0) {
            dx = (dx / rawDist) * maxR;
            dy = (dy / rawDist) * maxR;
        }
        joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        const nx = dx / maxR, ny = dy / maxR;
        const mag = Math.min(1, rawDist / maxR);
        player.joyX = nx;
        player.joyY = ny;
        player.joyMag = mag;

        // Keep boolean keys in sync for dinosaur mount animation & UI checks
        const inCar = !!player.vehicle && !player.vehicle.flies;
        keys['a'] = nx < -0.22;
        keys['d'] = nx > 0.22;
        keys['s'] = ny > 0.30;
        keys['w'] = ny < -0.20 || (inCar && (keys['a'] || keys['d']) && ny < 0.15);
        keys['shift'] = !player.vehicle && mag > 0.82 && ny < -0.35;
    };

    if (joyBase) {
        joyBase.addEventListener('touchstart', e => {
            e.preventDefault();
            e.stopPropagation();
            sfx.startAmbient();
            joyRectCache = joyBase.getBoundingClientRect();
            if (joyId === null && e.changedTouches.length) {
                joyId = e.changedTouches[0].identifier;
                updateJoy(e.changedTouches[0]);
            }
        }, { passive: false });
        joyBase.addEventListener('touchmove', e => {
            e.preventDefault();
            e.stopPropagation();
            for (const t of e.changedTouches) {
                if (t.identifier === joyId) updateJoy(t);
            }
        }, { passive: false });
        const endJoy = e => {
            for (const t of e.changedTouches) {
                if (t.identifier === joyId) resetJoy();
            }
        };
        joyBase.addEventListener('touchend', endJoy);
        joyBase.addEventListener('touchcancel', endJoy);
    }

    const applyLookDelta = (dx, dy) => {
        const sens = player.xrayScope ? 0.0022 : 0.0062;
        if (player.vehicle) {
            player.camOff = (player.camOff || 0) - dx * sens;
            player.camOffT = 2.0;
        } else {
            player.yaw -= dx * sens;
            player.pitch = Math.max(-0.55, Math.min(0.85, player.pitch + dy * sens * 0.8));
        }
    };
    mountEl.addEventListener('touchstart', e => {
        if (!isMobile) return;
        e.preventDefault();
        sfx.startAmbient();
        for (const t of e.changedTouches) {
            if (lookId === null && t.identifier !== joyId) {
                lookId = t.identifier;
                lookX = t.clientX;
                lookY = t.clientY;
            }
        }
    }, { passive: false });
    mountEl.addEventListener('touchmove', e => {
        if (!isMobile || lookId === null) return;
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier === lookId) {
                applyLookDelta(t.clientX - lookX, t.clientY - lookY);
                lookX = t.clientX;
                lookY = t.clientY;
            }
        }
    }, { passive: false });
    const endLook = e => {
        for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
    };
    mountEl.addEventListener('touchend', endLook);
    mountEl.addEventListener('touchcancel', endLook);

    if (mEnter) mEnter.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); handleInteractKey(); }, { passive: false });
    if (bannerEl) bannerEl.addEventListener('click', () => { if (isMobile) handleInteractKey(); });
    if (mWeap) mWeap.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        const ww = document.getElementById('weapon-wheel');
        if (ww) ww.style.display = ww.style.display === 'flex' ? 'none' : 'flex';
    }, { passive: false });

    if (mFire) {
        let fireId = null, fX = 0, fY = 0;
        mFire.addEventListener('touchstart', e => {
            e.preventDefault();
            e.stopPropagation();
            sfx.startAmbient();
            const t = e.changedTouches[0];
            if (t) { fireId = t.identifier; fX = t.clientX; fY = t.clientY; }
            G.mobileFiring = true;
            mFire.classList.add('pressed');
            fireWeapon(W / 2, H / 2);
        }, { passive: false });
        mFire.addEventListener('touchmove', e => {
            e.preventDefault();
            e.stopPropagation();
            for (const t of e.changedTouches) {
                if (t.identifier === fireId) {
                    applyLookDelta(t.clientX - fX, t.clientY - fY);
                    fX = t.clientX;
                    fY = t.clientY;
                }
            }
        }, { passive: false });
        const stopFire = e => {
            for (const t of e.changedTouches) {
                if (t.identifier === fireId) {
                    fireId = null;
                    G.mobileFiring = false;
                    mFire.classList.remove('pressed');
                }
            }
        };
        mFire.addEventListener('touchend', stopFire);
        mFire.addEventListener('touchcancel', stopFire);
    }

    if (mJump) {
        mJump.addEventListener('touchstart', e => {
            e.preventDefault();
            e.stopPropagation();
            keys[' '] = true;
            mJump.classList.add('pressed');
            if (!player.vehicle && player.vy === 0) player.vy = 7.8;
        }, { passive: false });
        const stopJump = () => { keys[' '] = false; mJump.classList.remove('pressed'); };
        mJump.addEventListener('touchend', stopJump);
        mJump.addEventListener('touchcancel', stopJump);
    }

    if (mDown) {
        mDown.addEventListener('touchstart', e => {
            e.preventDefault();
            e.stopPropagation();
            keys['c'] = true;
            mDown.classList.add('pressed');
        }, { passive: false });
        const stopDown = () => { keys['c'] = false; mDown.classList.remove('pressed'); };
        mDown.addEventListener('touchend', stopDown);
        mDown.addEventListener('touchcancel', stopDown);
    }
}
