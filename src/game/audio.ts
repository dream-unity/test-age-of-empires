type Bus = { master: GainNode; music: GainNode; sfx: GainNode };

export class GameAudio {
  ctx: AudioContext | null = null;
  bus: Bus | null = null;
  unlocked = false;
  muted = false;
  musicVol = 0.22;
  sfxVol = 0.55;
  private musicTimer = 0;
  private lastNote = 0;

  unlock() {
    if (this.unlocked && this.ctx?.state === "running") return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!this.ctx) {
      this.ctx = new AC({ latencyHint: "interactive" });
      const master = this.ctx.createGain();
      const music = this.ctx.createGain();
      const sfx = this.ctx.createGain();
      music.connect(master);
      sfx.connect(master);
      master.connect(this.ctx.destination);
      this.bus = { master, music, sfx };
      this.apply();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.unlocked = true;
  }

  apply() {
    if (!this.bus || !this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : 1;
    this.bus.master.gain.setTargetAtTime(m, t, 0.02);
    this.bus.music.gain.setTargetAtTime(this.musicVol * this.musicVol, t, 0.04);
    this.bus.sfx.gain.setTargetAtTime(this.sfxVol * this.sfxVol, t, 0.02);
  }

  setMusic(v: number) {
    this.musicVol = v;
    this.apply();
  }
  setSfx(v: number) {
    this.sfxVol = v;
    this.apply();
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.apply();
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  private beep(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0) {
    if (!this.ctx || !this.bus || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.bus.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  click() {
    this.beep(720, 0.05, "square", 0.07);
  }
  place() {
    this.beep(180, 0.12, "triangle", 0.12, -60);
  }
  chop() {
    this.beep(140 + Math.random() * 40, 0.07, "sawtooth", 0.08, -80);
  }
  mine() {
    this.beep(420 + Math.random() * 50, 0.06, "square", 0.05);
  }
  attack() {
    this.beep(90 + Math.random() * 40, 0.09, "sawtooth", 0.11, -40);
  }
  die() {
    this.beep(220, 0.28, "triangle", 0.1, -160);
  }
  notify() {
    this.beep(520, 0.1, "square", 0.08);
    setTimeout(() => this.beep(680, 0.12, "square", 0.07), 80);
  }
  fanfare() {
    [392, 494, 587, 784].forEach((f, i) => setTimeout(() => this.beep(f, 0.22, "triangle", 0.1), i * 140));
  }
  defeat() {
    [330, 247, 196].forEach((f, i) => setTimeout(() => this.beep(f, 0.32, "triangle", 0.1, -20), i * 180));
  }

  tick(dt: number) {
    if (!this.ctx || !this.bus || this.muted || this.musicVol < 0.02) return;
    this.musicTimer += dt;
    if (this.musicTimer - this.lastNote < 1.15) return;
    this.lastNote = this.musicTimer;
    const scale = [196, 220, 247, 294, 330, 392];
    const f = scale[Math.floor(Math.random() * scale.length)];
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    osc.connect(g);
    g.connect(this.bus.music);
    osc.start(t);
    osc.stop(t + 1.1);
  }
}

export const audio = new GameAudio();
