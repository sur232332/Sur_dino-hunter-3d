import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { G, headLights, water2Mats } from './state.js';
import { fbm, noise2D } from './physics.js';

export const mountEl = document.getElementById('game-mount');
export const hudCanvas = document.getElementById('hud-canvas');
export const hudCtx = hudCanvas.getContext('2d');
export const radarCanvas = document.getElementById('radar-canvas');
export const radarCtx = radarCanvas.getContext('2d');

export let W = hudCanvas.width = window.innerWidth;
export let H = hudCanvas.height = window.innerHeight;

export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
if (isMobile) document.body.classList.add('is-mobile');

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xd99b66, G.extFogDensity);

export const camera = new THREE.PerspectiveCamera(60, W / H, 0.25, 1600);

function showWebGLError(err) {
    const bs = document.getElementById('boot-splash');
    if (bs) bs.remove();
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020617;color:#f8fafc;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;';
    ov.innerHTML = '<div style="font-size:24px;font-weight:900;color:#ef4444;">⚠️ WebGL չի աշխատում / WebGL Error</div>'
        + '<div style="max-width:460px;font-size:14px;color:#cbd5e1;line-height:1.5;">Ձեր սարքում կամ բրաուզերում WebGL գրաֆիկան անջատված է։ Միացրեք Hardware Acceleration-ը կամ փորձեք կրկին։</div>'
        + '<div style="font-size:12px;color:#94a3b8;font-family:monospace;">' + String(err && err.message ? err.message : err) + '</div>'
        + '<button id="webgl-retry" style="padding:10px 22px;border-radius:8px;border:none;background:#ec4899;color:#fff;font-weight:900;font-size:14px;cursor:pointer;">🔄 Կրկին փորձել (Retry)</button>';
    document.body.appendChild(ov);
    const btn = ov.querySelector('#webgl-retry');
    if (btn) btn.onclick = () => location.reload();
}

let _renderer;
try {
    _renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
    _renderer.setSize(W, H);
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.0 : 1.5));
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _renderer.toneMapping = THREE.ACESFilmicToneMapping;
    _renderer.toneMappingExposure = 1.22;
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountEl.appendChild(_renderer.domElement);
} catch (err) {
    showWebGLError(err);
    throw err;
}
export const renderer = _renderer;

// PBR Environment Reflections (IBL) from real outdoor Sky
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();
const skyEnvScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(100);
skyEnvScene.add(envSky);
let envRT = null;

// Post-processing state (desktop enabled at startup, mobile lazy-created only if SSAO is enabled)
let composer = null;
let ssaoPass = null;
let bloomPass = null;
let smaaPass = null;
const gradeUniforms = {
    tDiffuse: { value: null },
    uWarmth: { value: 0.05 },
    uNight: { value: 0.0 }
};

function initComposer() {
    if (composer) return;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    ssaoPass = new SSAOPass(scene, camera, W, H);
    ssaoPass.kernelRadius = 11;
    ssaoPass.minDistance = 0.002;
    ssaoPass.maxDistance = 0.11;
    composer.addPass(ssaoPass);

    const nanKillPass = new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); bvec4 bad = bvec4(c.r != c.r || c.r > 65000.0, c.g != c.g || c.g > 65000.0, c.b != c.b || c.b > 65000.0, c.a != c.a); if (any(bad) || any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(min(c.rgb, vec3(60.0)), c.a); }'
    });
    composer.addPass(nanKillPass);

    bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.34, 0.55, 0.88);
    composer.addPass(bloomPass);

    composer.addPass(new OutputPass());

    const gtaGradePass = new ShaderPass({
        uniforms: gradeUniforms,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
            uniform sampler2D tDiffuse; uniform float uWarmth; uniform float uNight; varying vec2 vUv;
            void main(){
                vec4 tex = texture2D(tDiffuse, vUv);
                vec3 c = tex.rgb;
                c = mix(c, c * c * (3.0 - 2.0 * c), 0.16);
                float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
                c = mix(vec3(luma), c, mix(1.16, 1.04, uNight));
                c *= mix(vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.35, 1.0 - uWarmth * 0.6), vec3(0.92, 0.97, 1.08), uNight);
                vec2 d = vUv - 0.5;
                float vig = 1.0 - dot(d, d) * 0.42;
                gl_FragColor = vec4(clamp(c * vig, 0.0, 1.0), tex.a);
            }`
    });
    composer.addPass(gtaGradePass);

    smaaPass = new SMAAPass(W * renderer.getPixelRatio(), H * renderer.getPixelRatio());
    composer.addPass(smaaPass);
}

if (!isMobile) {
    initComposer();
} else {
    const sb = document.getElementById('btn-ssao');
    if (sb) {
        sb.classList.remove('active');
        sb.textContent = '✨ Ultra SSAO: ԱՆՋԱՏՎԱԾ';
    }
}

export function isSSAOEnabled() {
    return !!(ssaoPass && ssaoPass.enabled);
}

export function toggleSSAO() {
    if (!composer) {
        initComposer();
        ssaoPass.enabled = true;
    } else {
        ssaoPass.enabled = !ssaoPass.enabled;
    }
    return ssaoPass.enabled;
}

export function toggleBloom() {
    if (!composer) initComposer();
    bloomPass.enabled = !bloomPass.enabled;
    return bloomPass.enabled;
}

export function renderFrame() {
    if (composer && (!isMobile || (ssaoPass && ssaoPass.enabled))) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

export function handleResize() {
    W = hudCanvas.width = window.innerWidth;
    H = hudCanvas.height = window.innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    if (composer) composer.setSize(W, H);
    if (ssaoPass) ssaoPass.setSize(W, H);
}

export const sky = new Sky();
sky.scale.setScalar(1400);
scene.add(sky);
export const sunVec = new THREE.Vector3();

export const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(28, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xfffae0, fog: false })
);
scene.add(sunDisc);

export const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x2e401c, 0.65);
scene.add(hemiLight);

export const sunLight = new THREE.DirectionalLight(0xffe6b8, 3.1);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
const _sd = 68;
sunLight.shadow.camera.left = -_sd;
sunLight.shadow.camera.right = _sd;
sunLight.shadow.camera.top = _sd;
sunLight.shadow.camera.bottom = -_sd;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 210;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.02;
scene.add(sunLight);
scene.add(sunLight.target);

const _c2 = new THREE.Color();

// Stars (visible at night)
const starsGeo = new THREE.BufferGeometry();
{
    const sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        sp.set([Math.cos(a) * r * 420, Math.abs(u) * 420 + 10, Math.sin(a) * r * 420], i * 3);
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
}
const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
export const stars = new THREE.Points(starsGeo, starsMat);
stars.frustumCulled = false;
scene.add(stars);

// Clouds
const cloudMat = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false, opacity: 0.6 });
})();
export const cloudGroup = new THREE.Group();
for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(cloudMat), w = 70 + Math.random() * 90;
    sp.scale.set(w, w * (0.3 + Math.random() * 0.2), 1);
    sp.position.set((Math.random() - 0.5) * 640, 95 + Math.random() * 45, (Math.random() - 0.5) * 640);
    cloudGroup.add(sp);
}
scene.add(cloudGroup);

export const RAIN_COUNT = isMobile ? 1200 : 2600;
export const rainGeo = new THREE.BufferGeometry();
{
    const rainPos = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i++) {
        rainPos[i * 3] = (Math.random() - 0.5) * 95;
        rainPos[i * 3 + 1] = Math.random() * 42;
        rainPos[i * 3 + 2] = (Math.random() - 0.5) * 95;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
}
export const rainPoints = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.18, transparent: true, opacity: 0.68 }));
rainPoints.visible = false;
scene.add(rainPoints);

export const windUni = { uTime: { value: 0 } };
export function injectWind(mat, amp = 0.2) {
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = windUni.uTime;
        sh.vertexShader = `uniform float uTime;\n` + sh.vertexShader.replace(
            '#include <begin_vertex>',
            `vec3 transformed = vec3(position);
             float w = sin(uTime * 2.5 + instanceMatrix[3][0]*0.22 + instanceMatrix[3][2]*0.22) * ${amp} * max(0.0, position.y);
             transformed.x += w;`
        );
    };
}

export function makeCanvasTex(size, fn) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    fn(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return t;
}

export const normalTex = makeCanvasTex(512, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
            const hL = fbm((x - 1) * 0.08, y * 0.08, 4);
            const hR = fbm((x + 1) * 0.08, y * 0.08, 4);
            const hD = fbm(x * 0.08, (y - 1) * 0.08, 4);
            const hU = fbm(x * 0.08, (y + 1) * 0.08, 4);
            const nx = (hL - hR) * 2.8;
            const ny = (hD - hU) * 2.8;
            const nz = 1.0 / Math.hypot(nx, ny, 1.0);
            const idx = (y * s + x) * 4;
            d[idx]     = Math.floor(((nx * nz) * 0.5 + 0.5) * 255);
            d[idx + 1] = Math.floor(((ny * nz) * 0.5 + 0.5) * 255);
            d[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
            d[idx + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
});
normalTex.repeat.set(28, 28);

export const scaleNormalTex = makeCanvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#8080ff'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 12) {
        for (let x = 0; x < s; x += 12) {
            const ox = x + ((y / 12) % 2) * 6;
            const grad = ctx.createRadialGradient(ox, y, 1, ox + 2, y + 2, 6);
            grad.addColorStop(0, '#a8a8ff');
            grad.addColorStop(1, '#5858e8');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(ox, y, 5.5, 0, Math.PI * 2); ctx.fill();
        }
    }
});
scaleNormalTex.repeat.set(6, 6);

export const woodTex = makeCanvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#5c3a1e'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) {
        ctx.fillStyle = y % 64 === 0 ? '#694222' : '#523218';
        ctx.fillRect(0, y, s, 30);
        ctx.strokeStyle = '#2d1a0b'; ctx.lineWidth = 3; ctx.strokeRect(0, y, s, 32);
    }
    for (let i = 0; i < 1200; i++) {
        ctx.fillStyle = 'rgba(25, 12, 4, 0.18)';
        ctx.fillRect(Math.random() * s, Math.random() * s, 28, 2);
    }
});

export const terrainDetailTex = makeCanvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 18000; i++) {
        const v = 165 + Math.floor((Math.random() - 0.5) * 90);
        ctx.fillStyle = `rgb(${v},${Math.min(255, v + 8)},${Math.max(0, v - 8)})`;
        const w = 1 + Math.random() * 2.5, h = 2 + Math.random() * 6;
        ctx.fillRect(Math.random() * s, Math.random() * s, w, h);
    }
    for (let i = 0; i < 1400; i++) {
        const v = 115 + Math.floor(Math.random() * 80);
        ctx.fillStyle = `rgba(${v},${v},${v - 5},0.45)`;
        ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.5, 0, Math.PI * 2); ctx.fill();
    }
});
terrainDetailTex.repeat.set(46, 46);
terrainDetailTex.colorSpace = THREE.SRGBColorSpace;

export const waterNormalTex = makeCanvasTex(256, (ctx, s) => {
    const img = ctx.createImageData(s, s), d = img.data;
    for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
            const u = (x / s) * Math.PI * 2, v = (y / s) * Math.PI * 2;
            const nx = Math.cos(u * 3 + Math.sin(v * 2)) * 0.22 + Math.cos(u * 7 - v * 5) * 0.1;
            const ny = Math.sin(v * 3 + Math.cos(u * 2)) * 0.22 + Math.sin(v * 7 + u * 4) * 0.1;
            const nz = 1.0 / Math.hypot(nx, ny, 1.0);
            const idx = (y * s + x) * 4;
            d[idx]     = Math.floor(((nx * nz) * 0.5 + 0.5) * 255);
            d[idx + 1] = Math.floor(((ny * nz) * 0.5 + 0.5) * 255);
            d[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
            d[idx + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
});

export const sparkTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
})();

export const muzzleFlashLight = new THREE.PointLight(0xffaa33, 0, 12);
scene.add(muzzleFlashLight);

let _lastSkyEl = null;
let _lastSkyW = -1;

export function updateSkyAndWeather() {
    const elevations = [13, 54, -8];
    const el = G.timePreset === 3 ? G.autoElev : elevations[G.timePreset];
    const phi = THREE.MathUtils.degToRad(90 - el);
    const theta = THREE.MathUtils.degToRad(135);
    sunVec.setFromSphericalCoords(1, phi, theta);
    sky.material.uniforms['sunPosition'].value.copy(sunVec);
    sky.material.uniforms['turbidity'].value = el < 20 ? 8.5 : 3.5;
    sky.material.uniforms['rayleigh'].value = el < 20 ? 2.6 : 1.4;
    sunDisc.position.copy(sunVec).multiplyScalar(620);

    const A = [
        { e: -8, sun: 0x6088cc, si: 0.55, hi: 0.28, fog: 0x09101d, disc: 0x93c5fd },
        { e: 13, sun: 0xff944d, si: 2.75, hi: 0.55, fog: 0xd99b66, disc: 0xffb76b },
        { e: 54, sun: 0xfff6e5, si: 3.2,  hi: 0.75, fog: 0xa8c8e0, disc: 0xffffff }
    ];
    const [a, b] = el <= A[1].e ? [A[0], A[1]] : [A[1], A[2]];
    const t = THREE.MathUtils.clamp((el - a.e) / (b.e - a.e), 0, 1);
    sunLight.color.setHex(a.sun).lerp(_c2.setHex(b.sun), t);
    sunLight.intensity = THREE.MathUtils.lerp(a.si, b.si, t);
    hemiLight.intensity = THREE.MathUtils.lerp(a.hi, b.hi, t);
    scene.fog.color.setHex(a.fog).lerp(_c2.setHex(b.fog), t);
    sunDisc.material.color.setHex(a.disc).lerp(_c2.setHex(b.disc), t);

    const night = THREE.MathUtils.clamp((6 - el) / 14, 0, 1);
    const dayFactor = 1 - night;
    starsMat.opacity = G.weatherMode > 0 ? night * 0.25 : night;
    cloudMat.color.copy(scene.fog.color).lerp(_c2.setHex(0xffffff), 0.45 * dayFactor).multiplyScalar(G.weatherMode > 0 ? 0.55 : 1);
    cloudMat.opacity = G.weatherMode > 0 ? 0.88 : 0.55;
    sunDisc.visible = el > -1.5 && G.weatherMode === 0;
    scene.environmentIntensity = THREE.MathUtils.lerp(0.18, 0.95, dayFactor) * (G.weatherMode > 0 ? 0.55 : 1.0);
    gradeUniforms.uNight.value = night;
    gradeUniforms.uWarmth.value = el < 24 && el > -2 ? 0.075 : 0.03;
    headLights.forEach(L => { L.intensity = THREE.MathUtils.lerp(0.0, 14.0, Math.max(night, el < 16 ? 0.45 : 0)); });

    if (_lastSkyEl === null || Math.abs(_lastSkyEl - el) > 2.5 || _lastSkyW !== G.weatherMode) {
        _lastSkyEl = el;
        _lastSkyW = G.weatherMode;
        envSky.material.uniforms['sunPosition'].value.copy(sunVec);
        envSky.material.uniforms['turbidity'].value = sky.material.uniforms['turbidity'].value;
        envSky.material.uniforms['rayleigh'].value = sky.material.uniforms['rayleigh'].value;
        if (envRT) envRT.dispose();
        envRT = pmremGenerator.fromScene(skyEnvScene, 0.04);
        scene.environment = envRT.texture;
    }
    if (G.water && G.water.material && G.water.material.uniforms) {
        G.water.material.uniforms['sunColor'].value.copy(sunLight.color).multiplyScalar(THREE.MathUtils.lerp(0.18, 1.0, dayFactor));
        G.water.material.uniforms['waterColor'].value.setHex(0x07131c).lerp(_c2.setHex(0x164a46), dayFactor);
    }
    if (water2Mats.length) {
        const wCol = _c2.setHex(0x0a1e26).lerp(new THREE.Color(0x326f78), dayFactor);
        water2Mats.forEach(m => { m.color.copy(wCol); m.opacity = THREE.MathUtils.lerp(0.18, 0.30, dayFactor); });
    }
    if (G.weatherMode > 0) {
        G.extFogDensity = 0.0072;
        sunLight.intensity *= 0.55;
    } else {
        G.extFogDensity = 0.0036;
    }
    scene.fog.density = G.extFogDensity;
}

updateSkyAndWeather();
