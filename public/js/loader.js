import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    G, PROPS, propWaiters, creatures, pendingPorsche, showGlbErr
} from './state.js';
import { scene, camera, renderer } from './scene.js';

function sanitizeMaterial(m) {
    if (!m) return;
    if (m.color && (!isFinite(m.color.r) || !isFinite(m.color.g) || !isFinite(m.color.b))) {
        m.color.setRGB(
            isFinite(m.color.r) ? m.color.r : 0,
            isFinite(m.color.g) ? m.color.g : 0,
            isFinite(m.color.b) ? m.color.b : 0
        );
    }
    if (m.emissive && (!isFinite(m.emissive.r) || !isFinite(m.emissive.g) || !isFinite(m.emissive.b))) {
        m.emissive.setRGB(
            isFinite(m.emissive.r) ? m.emissive.r : 0,
            isFinite(m.emissive.g) ? m.emissive.g : 0,
            isFinite(m.emissive.b) ? m.emissive.b : 0
        );
    }
    if (typeof m.roughness === 'number') {
        m.roughness = isFinite(m.roughness) ? Math.max(0.04, Math.min(1.0, m.roughness)) : 0.7;
    }
    if (typeof m.metalness === 'number') {
        m.metalness = isFinite(m.metalness) ? Math.max(0.0, Math.min(1.0, m.metalness)) : 0.0;
    }
    if (typeof m.emissiveIntensity === 'number') {
        m.emissiveIntensity = isFinite(m.emissiveIntensity) ? Math.max(0.0, Math.min(3.0, m.emissiveIntensity)) : 1.0;
    }
    if (typeof m.transmission === 'number' && m.transmission > 0) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.36;
        m.depthWrite = false;
    }
}

export function sanitizeGLTF(gltf) {
    if (!gltf || !gltf.scene) return;
    gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
            const n = o.geometry.attributes.normal;
            let bad = !n;
            if (n) {
                for (let i = 0; i < n.count && !bad; i++) {
                    const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l = x * x + y * y + z * z;
                    if (!(l > 1e-8) || !isFinite(l)) bad = true;
                }
            }
            if (bad) {
                o.geometry.deleteAttribute('normal');
                o.geometry.computeVertexNormals();
            }
            const p = o.geometry.attributes.position;
            for (let i = 0; i < p.count; i += 7) {
                if (!isFinite(p.getX(i) + p.getY(i) + p.getZ(i))) {
                    o.visible = false;
                    console.warn('NaN vertices hidden', o.name);
                    break;
                }
            }
        }
        if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(sanitizeMaterial);
            else sanitizeMaterial(o.material);
        }
    });
}

const FALLBACK_MANIFEST = {
    props: {
        tree: 'models/tree.glb', grass: 'models/grass.glb', olds: 'models/olds.glb',
        hero: 'models/hero.glb', bear: 'models/bear.glb', cabin: 'models/cabin.glb',
        cop: 'models/cop.glb', deer: 'models/deer.glb', fence: 'models/fence.glb',
        fern: 'models/fern.glb', fire: 'models/fire.glb', lights: 'models/lights.glb',
        raptor: 'models/raptor.glb', rock: 'models/rock.glb', wolf: 'models/wolf.glb',
        m4: 'models/m4.glb', copman: 'models/copman.glb', water2: 'models/water2.glb',
        boat: 'models/boat.glb', mboat: 'models/mboat.glb', jet: 'models/jet.glb',
        mh6: 'models/mh6.glb', jeepm: 'models/jeepm.glb', atvm: 'models/atvm.glb',
        cheetah: 'models/cheetah.glb', gazelle: 'models/gazelle.glb', md500: 'models/md500.glb',
        heliport: 'models/heliport.glb', hangar: 'models/hangar.glb', wreck: 'models/wreck.glb',
        jeep2: 'models/jeep2.glb', pistol: 'models/pistol.glb', scorpion: 'models/scorpion.glb',
        thompson: 'models/thompson.glb', ump45: 'models/ump45.glb', tank: 'models/tank.glb'
    },
    special: {
        trex: 'models/trex.glb',
        porsche: 'models/porsche.glb'
    }
};

export async function startAssetLoader() {
    window.gameReady = false;
    G.gameReady = false;

    const bs = document.getElementById('boot-splash');
    if (bs) bs.remove();

    const ov = document.createElement('div');
    ov.id = 'asset-loader-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:radial-gradient(circle at center,#1e293b 0%,#020617 100%);color:#facc15;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:800;font-size:22px;gap:14px;transition:opacity 0.45s ease;padding:20px;text-align:center;';
    ov.innerHTML = '<div style="letter-spacing:1px">🦖 DINO HUNTER — Բեռնվում է...</div>'
        + '<div id="ld-pct" style="font:900 44px monospace;color:#fff;text-shadow:0 0 18px rgba(250,204,21,0.6)">0%</div>'
        + '<div style="width:min(440px,82vw);height:16px;background:#1e293b;border:1px solid rgba(255,255,255,0.2);border-radius:9px;overflow:hidden"><div id="ld-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#f59e0b,#facc15,#4ade80);transition:width .18s ease"></div></div>'
        + '<div id="ld-txt" style="font-size:14px;color:#cbd5e1">Ստուգվում են ֆայլերը...</div>'
        + '<div id="ld-actions" style="display:none;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:8px;">'
        + '<button id="ld-retry" style="padding:9px 18px;border-radius:8px;border:none;background:#ef4444;color:#fff;font-weight:800;cursor:pointer;">🔄 Կրկին փորձել</button>'
        + '<button id="ld-skip" style="padding:9px 18px;border-radius:8px;border:none;background:#22c55e;color:#000;font-weight:800;cursor:pointer;">▶️ Սկսել առկա մոդելներով</button>'
        + '</div>';
    document.body.appendChild(ov);

    const barEl = ov.querySelector('#ld-bar');
    const pctEl = ov.querySelector('#ld-pct');
    const txtEl = ov.querySelector('#ld-txt');
    const actEl = ov.querySelector('#ld-actions');

    const finishLoading = () => {
        if (G.gameReady) return;
        clearTimeout(watchdog);
        pctEl.textContent = '100%';
        barEl.style.width = '100%';
        txtEl.textContent = 'Պատրաստ է! (100%)';
        setTimeout(() => {
            try { renderer.compile(scene, camera); } catch (e) {}
            G.gameReady = true;
            window.gameReady = true;
            ov.style.opacity = '0';
            setTimeout(() => ov.remove(), 480);
        }, 180);
    };

    ov.querySelector('#ld-retry').onclick = () => location.reload();
    ov.querySelector('#ld-skip').onclick = () => finishLoading();

    const watchdog = setTimeout(() => {
        if (!G.gameReady) {
            txtEl.textContent = '⚠️ Բեռնումը սպասվածից երկար է տևում — կարող եք կրկին փորձել կամ սկսել հիմա';
            actEl.style.display = 'flex';
        }
    }, 45000);

    let manifest = FALLBACK_MANIFEST;
    try {
        const res = await fetch('models/manifest.json');
        if (res.ok) manifest = await res.json();
    } catch (e) {
        console.warn('manifest.json load failed, using fallback:', e);
    }

    const jobs = [];
    for (const [key, url] of Object.entries(manifest.props || {})) {
        jobs.push({ kind: 'prop', key, url });
    }
    for (const [key, url] of Object.entries(manifest.special || {})) {
        jobs.push({ kind: 'special', key, url });
    }

    const total = jobs.length;
    let settled = 0;

    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, itemsLoaded, itemsTotal) => {
        const denom = Math.max(total, itemsTotal || total);
        const pct = Math.min(99, Math.round((Math.max(settled, itemsLoaded) / denom) * 100));
        barEl.style.width = pct + '%';
        pctEl.textContent = pct + '%';
    };
    manager.onLoad = () => {
        if (settled >= total) finishLoading();
    };
    manager.onError = (url) => {
        console.warn('Asset failed in LoadingManager:', url);
    };

    const loader = new GLTFLoader(manager);
    let cursor = 0;
    const CONCURRENCY = 4;

    const loadOne = (job) => new Promise((resolve) => {
        loader.load(
            job.url,
            (gltf) => {
                try {
                    sanitizeGLTF(gltf);
                    if (job.kind === 'special' && job.key === 'trex') {
                        G.trexGLB = gltf;
                        creatures.filter(c => c.type === 'trex').forEach(cr => G.fn.applyTrexModel(cr));
                    } else if (job.kind === 'special' && job.key === 'porsche') {
                        G.porscheGLB = gltf;
                        pendingPorsche.splice(0).forEach(v => G.fn.applyPorsche(v));
                    } else {
                        PROPS[job.key] = gltf;
                        (propWaiters[job.key] || []).splice(0).forEach(cb => {
                            try { cb(gltf); } catch (cbErr) {
                                console.error('whenProp error:', job.key, cbErr);
                                showGlbErr('GLB callback սխալ: ' + job.key + ' — ' + cbErr.message);
                            }
                        });
                    }
                } catch (err) {
                    console.error('GLB postprocess error:', job.key, err);
                    showGlbErr('GLB սխալ: ' + job.key + ' — ' + (err && err.message || err));
                } finally {
                    settled++;
                    const pct = Math.min(100, Math.round((settled / total) * 100));
                    barEl.style.width = pct + '%';
                    pctEl.textContent = pct + '%';
                    txtEl.textContent = `${job.key} • ${settled} / ${total}`;
                    resolve();
                }
            },
            undefined,
            (err) => {
                console.warn('GLB չբեռնվեց:', job.key, err);
                showGlbErr('GLB չբեռնվեց: ' + job.key + ' (' + job.url + ')');
                settled++;
                const pct = Math.min(100, Math.round((settled / total) * 100));
                barEl.style.width = pct + '%';
                pctEl.textContent = pct + '%';
                txtEl.textContent = `${job.key} (չբեռնվեց) • ${settled} / ${total}`;
                resolve();
            }
        );
    });

    async function worker() {
        while (cursor < jobs.length) {
            const job = jobs[cursor++];
            await loadOne(job);
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, jobs.length); i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    finishLoading();
}
