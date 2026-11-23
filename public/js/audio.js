// Web Audio synthesizer with on-demand engine oscillators

class SoundSystem {
    constructor() {
        this.ctx = null;
        this.lastBeat = 0;
        this.amb = false;
        this.rainGain = null;
        this.engFilter = null;
        this.engGain = null;
        this.eng = null;
        this.eng2 = null;
        this.engSub = null;
        this.engStopping = false;
    }

    init() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
    }

    gunshot(type = 'sniper') {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        if (type === 'bow') {
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(320, now);
            o.frequency.exponentialRampToValueAtTime(90, now + 0.14);
            g.gain.setValueAtTime(0.18, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
            o.connect(g); g.connect(this.ctx.destination);
            o.start(); o.stop(now + 0.15);
            return;
        }
        const dur = type === 'rpg' ? 0.65 : 0.28;
        const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        const tau = this.ctx.sampleRate * (type === 'rpg' ? 0.18 : 0.06);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / tau);
        const src = this.ctx.createBufferSource(); src.buffer = buf;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = type === 'rpg' ? 320 : 950;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.38, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        src.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
        src.start();
    }

    dryFire() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(950, now);
        o.frequency.exponentialRampToValueAtTime(220, now + 0.045);
        g.gain.setValueAtTime(0.14, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(now + 0.05);
    }

    reloadClick() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        [0, 0.14].forEach((off, idx) => {
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(idx ? 640 : 420, now + off);
            o.frequency.exponentialRampToValueAtTime(180, now + off + 0.06);
            g.gain.setValueAtTime(0.16, now + off);
            g.gain.exponentialRampToValueAtTime(0.001, now + off + 0.06);
            o.connect(g); g.connect(this.ctx.destination);
            o.start(now + off); o.stop(now + off + 0.065);
        });
    }

    heartbeat() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        if (now - this.lastBeat < 0.75) return;
        this.lastBeat = now;
        [0, 0.16].forEach(offset => {
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(75, now + offset);
            o.frequency.exponentialRampToValueAtTime(28, now + offset + 0.12);
            g.gain.setValueAtTime(0.24, now + offset);
            g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.13);
            o.connect(g); g.connect(this.ctx.destination);
            o.start(now + offset); o.stop(now + offset + 0.14);
        });
    }

    roar(heavy = true) {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(heavy ? 110 : 260, now);
        o.frequency.exponentialRampToValueAtTime(heavy ? 36 : 95, now + (heavy ? 0.9 : 0.45));
        g.gain.setValueAtTime(0.25, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.9 : 0.45));
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(now + (heavy ? 0.92 : 0.46));
    }

    _noise(sec = 2) {
        const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return b;
    }

    startAmbient() {
        this.init();
        if (this.amb || !this.ctx) return;
        const c = this.ctx;
        this.amb = true;
        const w = c.createBufferSource(); w.buffer = this._noise(3); w.loop = true;
        const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420;
        const wg = c.createGain(); wg.gain.value = 0.05;
        const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
        const lg = c.createGain(); lg.gain.value = 0.03;
        lfo.connect(lg); lg.connect(wg.gain); lfo.start();
        w.connect(wf); wf.connect(wg); wg.connect(c.destination); w.start();

        const r = c.createBufferSource(); r.buffer = this._noise(2); r.loop = true;
        const rf = c.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1800;
        this.rainGain = c.createGain(); this.rainGain.gain.value = 0;
        r.connect(rf); rf.connect(this.rainGain); this.rainGain.connect(c.destination); r.start();
    }

    _startEngineOsc() {
        if (!this.ctx || !this.amb || this.eng) return;
        const c = this.ctx;
        this.engFilter = c.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 180; this.engFilter.Q.value = 1.4;
        this.engGain = c.createGain(); this.engGain.gain.value = 0;
        this.eng = c.createOscillator(); this.eng.type = 'triangle'; this.eng.frequency.value = 48;
        this.eng2 = c.createOscillator(); this.eng2.type = 'triangle'; this.eng2.frequency.value = 72;
        this.engSub = c.createOscillator(); this.engSub.type = 'sine'; this.engSub.frequency.value = 28;
        const g1 = c.createGain(); g1.gain.value = 0.55;
        const g2 = c.createGain(); g2.gain.value = 0.30;
        const gSub = c.createGain(); gSub.gain.value = 0.45;
        this.eng.connect(g1); g1.connect(this.engFilter);
        this.eng2.connect(g2); g2.connect(this.engFilter);
        this.engSub.connect(gSub); gSub.connect(this.engFilter);
        this.engFilter.connect(this.engGain); this.engGain.connect(c.destination);
        this.eng.start(); this.eng2.start(); this.engSub.start();
        this.engStopping = false;
    }

    _stopEngineOsc() {
        if (!this.eng || this.engStopping) return;
        this.engStopping = true;
        const c = this.ctx;
        const now = c ? c.currentTime : 0;
        if (this.engGain && c) this.engGain.gain.setTargetAtTime(0, now, 0.05);
        const o1 = this.eng, o2 = this.eng2, o3 = this.engSub, flt = this.engFilter, gn = this.engGain;
        this.eng = this.eng2 = this.engSub = this.engFilter = this.engGain = null;
        setTimeout(() => {
            try { o1.stop(); o1.disconnect(); } catch (e) {}
            try { o2.stop(); o2.disconnect(); } catch (e) {}
            try { o3.stop(); o3.disconnect(); } catch (e) {}
            try { flt && flt.disconnect(); } catch (e) {}
            try { gn && gn.disconnect(); } catch (e) {}
            this.engStopping = false;
        }, 160);
    }

    setRain(level) {
        if (this.rainGain && this.ctx) {
            this.rainGain.gain.setTargetAtTime([0, 0.07, 0.12][level] || 0, this.ctx.currentTime, 0.4);
        }
    }

    setEngine(active, norm, heli = false) {
        if (!this.amb || !this.ctx) return;
        if (!active) {
            if (this.eng) this._stopEngineOsc();
            return;
        }
        if (!this.eng) this._startEngineOsc();
        if (!this.eng) return;
        const t = this.ctx.currentTime;
        this.engGain.gain.setTargetAtTime((heli ? 0.09 : 0.075) + norm * 0.065, t, 0.16);
        const base = heli ? 22 + norm * 14 : 46 + norm * 68;
        this.eng.frequency.setTargetAtTime(base, t, 0.14);
        this.eng2.frequency.setTargetAtTime(heli ? base * 2.02 : base * 1.498, t, 0.14);
        this.engSub.frequency.setTargetAtTime(base * 0.5, t, 0.14);
        this.engFilter.frequency.setTargetAtTime(heli ? 140 + norm * 160 : 170 + norm * 320, t, 0.18);
    }

    step(run = false) {
        if (!this.ctx || !this.amb) return;
        const c = this.ctx;
        const b = c.createBuffer(1, Math.floor(c.sampleRate * 0.09), c.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.02));
        const s = c.createBufferSource(); s.buffer = b;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = run ? 700 : 450;
        const g = c.createGain(); g.gain.value = run ? 0.22 : 0.14;
        s.connect(f); f.connect(g); g.connect(c.destination); s.start();
    }
}

export const sfx = new SoundSystem();
