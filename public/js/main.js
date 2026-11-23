import * as THREE from 'three';
import {
    player, HOUSE_INT, vehicles, propMixers, keys, G, bulletCam
} from './state.js';
import {
    W, H, scene, camera, sky, sunVec, sunDisc, hemiLight, sunLight,
    stars, cloudGroup, RAIN_COUNT, rainGeo, rainPoints, windUni,
    muzzleFlashLight, renderFrame, handleResize, updateSkyAndWeather
} from './scene.js';
import { getTerrainHeight, rebuildDynamicGrid, clipCameraRay } from './physics.js';
import { sfx } from './audio.js';
import { startAssetLoader } from './loader.js';
import { water } from './terrain.js';
import { buildCarSalon, initVehicles } from './vehicles.js';
import { initAnimals, updateCreatures, updateSwat } from './ai.js';
import {
    fpGunGroup, fireWeapon, updatePlayerAndVehicles, updateStructures, updateFx
} from './player.js';
import { initUI, drawRadar, drawHud, invalidateMobileLayout } from './ui.js';

// ---- Boot world, UI and async GLB asset loader ----
initVehicles();
initAnimals();
initUI();
startAssetLoader();

const onViewportResize = () => {
    handleResize();
    invalidateMobileLayout();
};
window.addEventListener('resize', onViewportResize);
window.addEventListener('orientationchange', onViewportResize);

const fpsPill = document.getElementById('fps-pill');
const _tmpV = new THREE.Vector3();
const _bcOff = new THREE.Vector3();
const _bcBias = new THREE.Vector3(0.25, 0.2, 0);

let lastT = performance.now();
let fpsFrames = 0;
let fpsLast = 0;

function animate(now) {
    requestAnimationFrame(animate);
    try {
        animateInner(now);
    } catch (e) {
        const where = ((e.stack || '').split('\n')[1] || '').trim();
        if (window.lastErr !== e.message) {
            window.lastErr = e.message;
            console.error(e);
            G.ui.pushFeed('⚠️ ' + e.message);
        }
        window.debugK = 'ERR: ' + e.message + ' ' + where;
        try { renderFrame(); } catch (_e2) {}
    }
}

function animateInner(now) {
    if (!G.gameReady) {
        lastT = now;
        return;
    }

    const rawDt = Math.min(0.05, (now - lastT) / 1000);
    fpsFrames++;
    if (now - fpsLast >= 500) {
        const fpsVal = Math.round(fpsFrames * 1000 / Math.max(1, now - fpsLast));
        if (fpsPill) {
            fpsPill.textContent = 'v60 | ' + fpsVal + ' FPS' + (window.debugK ? ' | ' + window.debugK : '');
        }
        fpsFrames = 0;
        fpsLast = now;
    }
    lastT = now;

    const dt = bulletCam.active ? rawDt * 0.18 : rawDt;
    const elapsed = now / 1000;

    windUni.uTime.value = elapsed;
    if (water && water.material && water.material.uniforms && water.material.uniforms['time']) {
        water.material.uniforms['time'].value += dt * 0.75;
    }
    if (G.fireCd > 0) G.fireCd -= rawDt;
    if (G.mobileFiring && G.fireCd <= 0) fireWeapon(W / 2, H / 2);
    if (G.camShake > 0) G.camShake = Math.max(0, G.camShake - rawDt * 1.5);
    if (muzzleFlashLight.intensity > 0) muzzleFlashLight.intensity = Math.max(0, muzzleFlashLight.intensity - rawDt * 45);
    if (G.fpRecoil > 0) G.fpRecoil = Math.max(0, G.fpRecoil - rawDt * 0.85);

    if (player.xrayScope) sfx.heartbeat();

    // Underground cabin isolation: hide exterior water, rain, and fog while indoors
    if (G.water) G.water.visible = !player.inHouse;
    if (G.water2Holder) G.water2Holder.visible = !player.inHouse;
    rainPoints.visible = !player.inHouse && (G.weatherMode > 0);
    if (scene.fog) scene.fog.density = player.inHouse ? 0 : G.extFogDensity;

    if (rainPoints.visible) {
        const rp = rainGeo.attributes.position;
        for (let i = 0; i < RAIN_COUNT; i++) {
            let y = rp.getY(i) - 28 * rawDt;
            if (y < 0) y = 38;
            rp.setY(i, y);
        }
        rp.needsUpdate = true;
        rainPoints.position.set(player.x, player.y, player.z);
    }

    // 1. Cinematic slow-mo bullet cam override
    if (bulletCam.active) {
        fpGunGroup.visible = false;
        bulletCam.progress += rawDt * 1.35;
        bulletCam.bulletMesh.position.lerpVectors(bulletCam.start, bulletCam.end, Math.min(1, bulletCam.progress));
        _bcOff.subVectors(bulletCam.end, bulletCam.start).normalize().multiplyScalar(-1.6);
        camera.position.copy(bulletCam.bulletMesh.position).add(_bcOff).add(_bcBias);
        camera.lookAt(bulletCam.end);

        if (bulletCam.progress >= 1.0) {
            bulletCam.active = false;
            bulletCam.bulletMesh.visible = false;
            document.body.classList.remove('bullet-cam');
            if (bulletCam.onArrive) bulletCam.onArrive();
        }
        renderFrame();
        return;
    }

    // 2. Spatial hash & core simulation updates
    rebuildDynamicGrid();
    updatePlayerAndVehicles(dt, rawDt, now);
    updateCreatures(dt);
    for (let i = 0; i < propMixers.length; i++) propMixers[i].update(dt);
    updateSwat(dt);
    updateStructures(dt);
    updateFx(dt);

    // 3. Day/night cycle, clouds, stars, footsteps & engine audio
    if (G.timePreset === 3) {
        G.autoT += rawDt * 0.05;
        G.autoElev = Math.sin(G.autoT) * 62;
        G.skyTimer -= rawDt;
        if (G.skyTimer <= 0) {
            G.skyTimer = 0.3;
            updateSkyAndWeather();
            if (player.inHouse && scene.fog) scene.fog.density = 0;
        }
    }
    cloudGroup.children.forEach(c => {
        c.position.x += rawDt * (G.weatherMode > 0 ? 4 : 1.6);
        if (c.position.x > 320) c.position.x = -320;
    });
    stars.position.copy(camera.position);

    const isWalking = !player.vehicle && !player.mount && (keys['w'] || keys['s'] || keys['a'] || keys['d'] || player.joyMag > 0.08);
    if (isWalking) {
        G.stepTimer -= dt;
        if (G.stepTimer <= 0) {
            sfx.step(!!keys['shift']);
            G.stepTimer = keys['shift'] ? 0.3 : (player.stealth ? 0.7 : 0.45);
        }
    }
    if (player.vehicle) {
        sfx.setEngine(true, Math.min(1, Math.abs(player.vehicle.speed) / 26), player.vehicle.flies);
    } else {
        sfx.setEngine(false, 0, false);
    }

    if (G.weatherMode === 2 && !player.inHouse) {
        G.lightningTimer -= rawDt;
        if (G.lightningTimer <= 0) {
            G.lightningTimer = 4 + Math.random() * 9;
            hemiLight.intensity = 4.5;
            setTimeout(() => {
                updateSkyAndWeather();
                if (player.inHouse && scene.fog) scene.fog.density = 0;
            }, 110);
        }
    }

    // 4. Camera follow (1st-person, car salon, or fast analytical 3rd-person chase cam)
    const inCarSalon = !!(
        player.vehicle &&
        (player.vehCam || 0) === 2 &&
        !player.vehicle.flies &&
        !player.vehicle.isBoat &&
        player.vehicle.type !== 'atv' &&
        player.vehicle.type !== 'tank'
    );
    const wantNear = (!player.thirdPerson && !player.vehicle && !player.mount && !player.xrayScope) ? 0.06 : inCarSalon ? 0.08 : 0.25;
    if (camera.near !== wantNear) {
        camera.near = wantNear;
        camera.updateProjectionMatrix();
    }

    vehicles.forEach(v => {
        const showSalon = player.vehicle === v && inCarSalon;
        if (v.salonRoot) v.salonRoot.visible = showSalon;
        if (showSalon && !v.salonHidden) {
            v.salonHidden = v.mesh.children.filter(ch => ch.visible && ch !== v.salonRoot);
            v.salonHidden.forEach(ch => { ch.visible = false; });
        } else if (!showSalon && v.salonHidden) {
            v.salonHidden.forEach(ch => { ch.visible = true; });
            v.salonHidden = null;
        }
    });

    camera.rotation.order = 'YXZ';
    const scopedNow = player.xrayScope && !player.vehicle;
    if (scopedNow || (!player.thirdPerson && !player.vehicle && !player.mount)) {
        camera.position.set(player.x, player.y + 1.62, player.z);
        camera.rotation.set(-player.pitch, player.yaw, 0);
    } else {
        const vc = player.vehicle ? (player.vehCam || 0) : -1;
        if (vc === 2) {
            const v = player.vehicle;
            if (!v.cockpit) buildCarSalon(v);
            v.mesh.updateMatrixWorld(true);
            _tmpV.copy(v.cockpit).applyMatrix4(v.mesh.matrixWorld);
            camera.position.copy(_tmpV);
            camera.rotation.set(
                -player.pitch * 0.4 - v.mesh.rotation.x,
                v.mesh.rotation.y + Math.PI + (player.camOff || 0),
                -v.mesh.rotation.z * 0.6
            );
        } else {
            let dist = player.inHouse
                ? 2.7
                : player.vehicle
                    ? (player.vehicle.type === 'jet' ? 20 : player.vehicle.type === 'gazelle' ? 17 : player.vehicle.type === 'tank' ? 12 : player.vehicle.flies ? 13 : player.vehicle.isBoat ? 12 : 8.5)
                    : (player.mount ? 8 : 5.4);
            if (vc === 1) dist *= 0.6;
            const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
            const tx = player.x, ty = player.y + (player.vehicle ? 1.6 : 1.5), tz = player.z;
            let cx = tx + Math.sin(player.yaw) * dist * cp;
            let cz = tz + Math.cos(player.yaw) * dist * cp;
            let cy = ty + (player.inHouse ? 0.35 : 0.7) + sp * dist;

            if (player.inHouse) {
                cx = Math.max(HOUSE_INT.x - 3.65, Math.min(HOUSE_INT.x + 3.65, cx));
                cz = Math.max(HOUSE_INT.z - 3.65, Math.min(HOUSE_INT.z + 3.65, cz));
                cy = Math.max(HOUSE_INT.y + 0.5, Math.min(HOUSE_INT.y + 2.95, cy));
            } else {
                const gy = getTerrainHeight(cx, cz) + 0.6;
                if (cy < gy) cy = gy;
            }
            camera.position.set(cx, cy, cz);
            if (!player.inHouse) {
                clipCameraRay(tx, ty, tz, camera.position, player.vehicle);
            }
            camera.lookAt(tx, ty, tz);
        }
    }

    if (G.camShake > 0) {
        camera.position.x += (Math.random() - 0.5) * G.camShake;
        camera.position.y += (Math.random() - 0.5) * G.camShake;
    }

    // 5. Sky / sun shadow frustum follows player
    sky.position.copy(camera.position);
    sunDisc.position.copy(camera.position).addScaledVector(sunVec, 620);
    _tmpV.copy(sunVec);
    if (_tmpV.y < 0.1) {
        _tmpV.x *= -1;
        _tmpV.z *= -1;
        _tmpV.y = 0.45;
        _tmpV.normalize();
    }
    sunLight.position.set(player.x, player.y, player.z).addScaledVector(_tmpV, 110);
    sunLight.target.position.set(player.x, player.y, player.z);
    sunLight.target.updateMatrixWorld();

    // 6. HUD + Radar + Render
    drawRadar();
    drawHud();
    renderFrame();
}

requestAnimationFrame(animate);
