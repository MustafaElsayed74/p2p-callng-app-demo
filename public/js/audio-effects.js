// Audio Effects Synthesizer using Web Audio API (Zero external audio files needed)
class AudioEffects {
  constructor() {
    this.ctx = null;
    this.ringbackInterval = null;
    this.ringtoneInterval = null;
    this.activeNodes = [];
  }

  init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  stopAll() {
    if (this.ringbackInterval) {
      clearInterval(this.ringbackInterval);
      this.ringbackInterval = null;
    }
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
    this.activeNodes.forEach(node => {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch (e) {}
    });
    this.activeNodes = [];
  }

  // Ringback Tone (what the caller hears: "Tuuut... Tuuut...")
  playRingback() {
    this.init();
    this.stopAll();

    const playBurst = () => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      // 440Hz + 480Hz standard ringback frequencies
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
      gain.gain.setValueAtTime(0.08, now + 1.2);
      gain.gain.linearRampToValueAtTime(0, now + 1.3);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.3);
      osc2.stop(now + 1.3);

      this.activeNodes.push(osc1, osc2, gain);
    };

    playBurst();
    this.ringbackInterval = setInterval(playBurst, 3000);
  }

  // Incoming Call Ringtone (pleasant melodic chime for the receiver)
  playIncomingRingtone() {
    this.init();
    this.stopAll();

    const notes = [
      { f: 523.25, time: 0 },    // C5
      { f: 659.25, time: 0.15 }, // E5
      { f: 783.99, time: 0.3 },  // G5
      { f: 1046.50, time: 0.45 },// C6
      { f: 880.00, time: 0.7 },  // A5
      { f: 1046.50, time: 0.9 }  // C6
    ];

    const playMelody = () => {
      if (!this.ctx) return;
      const baseTime = this.ctx.currentTime;

      notes.forEach(note => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(note.f, baseTime + note.time);

        gain.gain.setValueAtTime(0, baseTime + note.time);
        gain.gain.linearRampToValueAtTime(0.12, baseTime + note.time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, baseTime + note.time + 0.28);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(baseTime + note.time);
        osc.stop(baseTime + note.time + 0.3);
        this.activeNodes.push(osc, gain);
      });
    };

    playMelody();
    this.ringtoneInterval = setInterval(playMelody, 2200);
  }

  // Call Connected Chime (Success)
  playCallConnected() {
    this.init();
    this.stopAll();
    const now = this.ctx.currentTime;
    const pitches = [587.33, 739.99, 880.00]; // D5, F#5, A5

    pitches.forEach((pitch, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(pitch, now + i * 0.12);

      gain.gain.setValueAtTime(0.1, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.3);
    });
  }

  // Call Ended Tone (Disconnect beep)
  playCallEnded() {
    this.init();
    this.stopAll();
    const now = this.ctx.currentTime;
    const pitches = [520, 380];

    pitches.forEach((pitch, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, now + i * 0.18);

      gain.gain.setValueAtTime(0.12, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.25);
    });
  }

  // Incoming Message Chime (Soft ping)
  playMessageReceived() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(987.77, now); // B5
    osc.frequency.exponentialRampToValueAtTime(1318.51, now + 0.08); // E6

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  // Emoji Reaction Pop Sound
  playReactionPop() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.12);
  }
}

// Global Sound Instance
window.soundFx = new AudioEffects();
