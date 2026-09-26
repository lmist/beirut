/** A deliberately quiet, procedural soundscape. No recordings or licensed music. */
export class DriveSound {
  constructor() { this.enabled = true; this.ctx = null; this.gear = 0; }
  unlock() {
    if (!this.enabled) return;
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return;
    if (!this.ctx) {
      this.ctx = new Audio();
      const ctx = this.ctx;
      this.master = ctx.createGain(); this.master.gain.value = .55;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20; compressor.ratio.value = 4;
      this.master.connect(compressor).connect(ctx.destination);
      this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
      this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 250;
      this.filter.connect(this.engineGain).connect(this.master);
      this.engine = ctx.createOscillator(); this.engine.type = 'triangle';
      this.harmonic = ctx.createOscillator(); this.harmonic.type = 'sine';
      const harmonicGain = ctx.createGain(); harmonicGain.gain.value = .32;
      this.engine.connect(this.filter); this.harmonic.connect(harmonicGain).connect(this.filter);
      this.engine.start(); this.harmonic.start();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      let smooth = 0;
      for (let i = 0; i < samples.length; i++) {
        smooth = (smooth + (Math.random() * 2 - 1) * .025) / 1.025;
        samples[i] = smooth * 3.5;
      }
      this.noise = ctx.createBufferSource(); this.noise.buffer = buffer; this.noise.loop = true;
      this.ambientFilter = ctx.createBiquadFilter(); this.ambientFilter.type = 'lowpass'; this.ambientFilter.frequency.value = 900;
      this.ambientGain = ctx.createGain(); this.ambientGain.gain.value = 0;
      this.noise.connect(this.ambientFilter).connect(this.ambientGain).connect(this.master);
      this.roadFilter = ctx.createBiquadFilter(); this.roadFilter.type = 'highpass'; this.roadFilter.frequency.value = 600;
      this.roadGain = ctx.createGain(); this.roadGain.gain.value = 0;
      this.noise.connect(this.roadFilter).connect(this.roadGain).connect(this.master);
      this.noise.start();
    }
    this.ctx.resume().catch(() => {});
  }
  update(speed, driving, throttle, { active = driving } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, velocity = Math.abs(speed);
    const audible = this.enabled && active;
    // A four-speed automatic's repeating rev range rather than pitch tied directly to km/h.
    const bands = [0, 6, 13, 22];
    this.gear = velocity > 22 ? 3 : velocity > 13 ? 2 : velocity > 6 ? 1 : 0;
    const revs = 750 + (velocity - bands[this.gear]) * (this.gear === 0 ? 290 : 180) + (throttle ? 480 : 0);
    const fundamental = Math.max(28, revs / 60 * 2);
    this.engine.frequency.setTargetAtTime(fundamental, t, .18);
    this.harmonic.frequency.setTargetAtTime(fundamental * 2.01, t, .18);
    this.filter.frequency.setTargetAtTime(150 + revs * .095, t, .2);
    this.engineGain.gain.setTargetAtTime(audible && driving ? .046 + (throttle ? .025 : 0) : 0, t, .18);
    this.roadGain.gain.setTargetAtTime(audible && driving ? Math.min(.14, velocity * .004) : 0, t, .4);
    this.ambientGain.gain.setTargetAtTime(audible ? .018 + Math.sin(t * .14) * .004 : 0, t, .7);
  }
  horn() {
    this.unlock(); if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    for (const frequency of [310, 390]) {
      const oscillator = this.ctx.createOscillator(), gain = this.ctx.createGain();
      oscillator.type = 'sawtooth'; oscillator.frequency.value = frequency;
      const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1200;
      gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(.026, t + .018); gain.gain.exponentialRampToValueAtTime(.001, t + .33);
      oscillator.connect(filter).connect(gain).connect(this.master); oscillator.start(); oscillator.stop(t + .34);
      oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
    }
  }
  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this.unlock();
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? .55 : 0, this.ctx.currentTime, .04);
    return this.enabled;
  }
}
