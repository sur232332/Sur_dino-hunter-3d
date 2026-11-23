import * as THREE from 'three';

export const WORLD_SIZE = 660;
export const LIM = 315;

export const SPECIES = {
    deer:    { name: 'Ազնվացեղ Եղջերու (Deer)', col: 0x8c5828, sc: 1.0,  hp: 90,  spd: 7.5, aggr: false, reward: 300 },
    wolf:    { name: 'Գորշ Գայլ (Wolf)',        col: 0x52525b, sc: 0.78, hp: 85,  spd: 8.8, aggr: true,  reward: 280 },
    bear:    { name: 'Գրիզլի Արջ (Bear)',       col: 0x3e2723, sc: 1.35, hp: 240, spd: 6.0, aggr: true,  reward: 500 },
    raptor:  { name: 'Վելոսիրապտոր (Raptor)',   col: 0x7c4722, sc: 1.05, hp: 130, spd: 9.5, aggr: true,  reward: 420 },
    cheetah: { name: 'Գեպարդ (Cheetah)',      col: 0xc89b4a, sc: 1.0,  hp: 110, spd: 12,  aggr: true,  reward: 450 },
    trex:    { name: 'Ալֆա T-Rex Բոսս',         col: 0x384924, sc: 2.1,  hp: 380, spd: 6.8, aggr: true,  reward: 1200 }
};

export const ANIMAL_CFG = {
    deer:    { rotY: 0,            len: 3.0 },
    wolf:    { rotY: 0,            len: 2.7, clips: true },
    bear:    { rotY: -Math.PI / 2, len: 2.6, still: true },
    cheetah: { rotY: -Math.PI / 2, len: 2.4, still: true },
    raptor:  { rotY: Math.PI,      len: 3.3, clips: true, speeds: { idle: 1, walk: 1.4, run: 2.4 } }
};

export const TRAFFIC_KINDS = [
    { key: 'olds',  len: 5.2, rot: Math.PI,      drop: 'M_Dome', wheel: /wheel/i },
    { key: 'cop',   len: 5.4, rot: -Math.PI / 2, drop: null,     wheel: /tire/i },
    { key: 'jeep2', len: 4.0, rot: 0,            drop: null,     wheel: /tires/i, wmax: 0.42 }
];

export const DRIVER_TINTS = [0x60a5fa, 0x34d399, 0xfbbf24, 0xc084fc, 0x94a3b8];

export const WEAPONS = [
    { name: '🎯 .308 SNIPER RIFLE', type: 'sniper',   dmg: 140, mag: 8,  max: 8,  res: 40,  rate: 0.65, zoom: 15 },
    { name: '🔫 AK-47 ASSAULT',     type: 'ak',       dmg: 48,  mag: 30, max: 30, res: 120, rate: 0.13, zoom: 38 },
    { name: '💥 TACTICAL SHOTGUN',  type: 'shotgun',  dmg: 175, mag: 8,  max: 8,  res: 32,  rate: 0.68, zoom: 45 },
    { name: '🏹 COMPOUND BOW',      type: 'bow',      dmg: 110, mag: 1,  max: 1,  res: 25,  rate: 0.50, zoom: 32 },
    { name: '🚀 RPG-7 LAUNCHER',    type: 'rpg',      dmg: 450, mag: 2,  max: 2,  res: 10,  rate: 1.20, zoom: 40 },
    { name: '🔫 CZ SCORPION EVO 3', type: 'scorpion', dmg: 42,  mag: 30, max: 30, res: 150, rate: 0.09, zoom: 42, glb: 'scorpion', len: 0.66 },
    { name: '🔫 THOMPSON M1928',    type: 'thompson', dmg: 46,  mag: 50, max: 50, res: 200, rate: 0.10, zoom: 42, glb: 'thompson', len: 0.82 },
    { name: '🔫 HK UMP-45',         type: 'ump45',    dmg: 58,  mag: 25, max: 25, res: 125, rate: 0.12, zoom: 40, glb: 'ump45',    len: 0.70 }
];

export const player = {
    mesh: new THREE.Group(),
    legL: null,
    legR: null,
    x: 0,
    y: 0,
    z: 8,
    vy: 0,
    yaw: 0,
    pitch: 0.15,
    hp: 100,
    armor: 100,
    stamina: 100,
    hunger: 92,
    cash: 3500,
    xp: 150,
    wood: 80,
    stone: 50,
    meat: 6,
    wanted: 0,
    dmgMult: 1.0,
    thirdPerson: true,
    xrayScope: false,
    stealth: false,
    inHouse: false,
    joyX: 0,
    joyY: 0,
    joyMag: 0,
    ragdollT: 0,
    airVx: 0,
    airVz: 0,
    aimT: 0,
    tpRecoil: 0,
    tpFlashT: 0,
    vehicle: null,
    mount: null,
    mode: 'hunt',
    buildType: 'floor',
    buildRot: 0,
    facing: undefined,
    wasSwim: false,
    heroMixer: null,
    heroActs: null,
    heroNow: 'idle',
    heroBones: null
};

export const CABIN = { x: 12, z: 20, hx: 5.5, hz: 5.5, h: 5.8, door: null };
export const CAMPFIRE = { x: 11, z: -7 };
export const HELIPAD = { x: -48, z: -32, half: 10, top: null };
export const HANGAR = { x: -45, z: -62, hx: 8.5, hz: 10.5, h: 6.8 };
export const HOUSE_INT = { x: 0, y: -42, z: 0, half: 3.4, doorZ: -3.2, bedX: 2.3, bedZ: 2.1 };

export const PROPS = {};
export const propWaiters = {};
export const propMixers = [];

export const creatures = [];
export const vehicles = [];
export const pendingPorsche = [];
export const traffic = [];
export const fleeing = [];
export const swatUnits = [];
export const structures = [];
export const tracers = [];
export const particles = [];
export const headLights = [];
export const water2Mats = [];
export const treeColliders = [];
export const camBlockers = [];
export const keys = {};

export const G = {
    gameReady: false,
    curWeap: 0,
    fireCd: 0,
    fpRecoil: 0,
    camShake: 0,
    weatherMode: 0,
    timePreset: 0,
    autoElev: 20,
    autoT: 0.35,
    skyTimer: 0,
    stepTimer: 0,
    uiTimer: 0,
    wantedTimer: 0,
    swatTimer: 0,
    lightningTimer: 6,
    hurtFlash: 0,
    walkCycle: 0,
    nearTarget: null,
    mobileFiring: false,
    extFogDensity: 0.0036,
    trexGLB: null,
    porscheGLB: null,
    fpM4: null,
    water: null,
    water2Holder: null,
    terrainMesh: null,
    ghostMesh: null,
    fpGunGroup: null,
    tpGunHolder: null,
    tpDefaultGuns: {},
    fpCustomGuns: {},
    tpCustomGuns: {},
    tpMuzzle: null,
    tpFlash: null,
    raycaster: new THREE.Raycaster(),
    mouseVec: new THREE.Vector2(),
    ui: {
        syncUI: () => {},
        updateBarsUI: () => {},
        pushFeed: () => {},
        toggleXRayScope: () => {},
        syncWeaponModels: () => {}
    },
    fn: {
        applyTrexModel: () => {},
        applyPorsche: () => {},
        makeOfficer: () => null,
        spawnCreature: () => null,
        spawnSwatPatrol: () => {},
        startCarjack: () => {},
        createVehicle: () => null,
        demolishStructure: () => {}
    }
};

export const bulletCam = {
    active: false,
    bulletMesh: null,
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    progress: 0,
    onArrive: null
};

export function whenProp(name, cb) {
    if (PROPS[name]) cb(PROPS[name]);
    else (propWaiters[name] = propWaiters[name] || []).push(cb);
}

export function showGlbErr(msg) {
    const b = document.getElementById('err-box');
    if (!b) return;
    b.style.display = 'block';
    b.textContent = (b.textContent ? b.textContent + '\n' : '') + msg;
    setTimeout(() => { b.style.display = 'none'; b.textContent = ''; }, 25000);
}
