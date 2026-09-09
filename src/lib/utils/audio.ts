// Web Audio API Synthesizer & Speech Synthesis (TTS)

class AudioSynthesizer {
  private audioCtx: AudioContext | null = null;

  private initContext() {
    if (!this.audioCtx && typeof window !== "undefined") {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
  }

  public playSuccessBeep() {
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc1 = this.audioCtx.createOscillator();
      const gain1 = this.audioCtx.createGain();

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now); // Tone 1 (A5)
      osc1.frequency.setValueAtTime(1760, now + 0.1); // Tone 2 (A6)

      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      osc1.connect(gain1);
      gain1.connect(this.audioCtx.destination);

      osc1.start(now);
      osc1.stop(now + 0.3);
    } catch {
      // Ignore audio autoplay policy errors
    }
  }

  public playChime() {
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, idx) => {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        const start = now + idx * 0.08;

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.12, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(start);
        osc.stop(start + 0.35);
      });
    } catch {
      // Ignore audio autoplay policy errors
    }
  }

  public playErrorBeep() {
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(180, now + 0.15);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch {
      // Ignore audio autoplay policy errors
    }
  }

  public playWarningBeep() {
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, now);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch {
      // Ignore audio autoplay policy errors
    }
  }

  private cachedVoices: SpeechSynthesisVoice[] = [];
  private voicesInitialized = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.initVoices();
    }
  }

  private initVoices() {
    if (
      this.voicesInitialized ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }
    this.voicesInitialized = true;
    const update = () => {
      try {
        const v = window.speechSynthesis.getVoices();
        if (v && v.length > 0) {
          this.cachedVoices = v;
        }
      } catch {
        // Ignore voice loading error
      }
    };
    update();
    if (typeof window.speechSynthesis.addEventListener === "function") {
      window.speechSynthesis.addEventListener("voiceschanged", update);
    } else {
      window.speechSynthesis.onvoiceschanged = update;
    }
  }

  private getIndonesianVoice(): SpeechSynthesisVoice | undefined {
    this.initVoices();
    if (
      !this.cachedVoices.length &&
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      try {
        this.cachedVoices = window.speechSynthesis.getVoices();
      } catch {
        // Sintesis suara adalah pelengkap, bukan syarat: WebView tanpa mesin
        // TTS harus tetap bisa memindai. Terminal yang bisu lebih baik
        // daripada terminal yang menolak bekerja.
      }
    }

    const isIndo = (v: SpeechSynthesisVoice) =>
      v.lang.startsWith("id") ||
      v.lang.includes("ID") ||
      v.name.toLowerCase().includes("indonesian") ||
      v.name.toLowerCase().includes("indonesia");

    // Offline-first: utamakan voice lokal (localService === true) agar tidak membutuhkan koneksi internet
    const localIndo = this.cachedVoices.find(
      (v) => isIndo(v) && v.localService === true,
    );
    if (localIndo) return localIndo;

    // Fallback: suara Indo apa pun jika flag localService tidak terpasang
    const anyIndo = this.cachedVoices.find(isIndo);
    if (anyIndo) return anyIndo;

    // Fallback: suara lokal sistem apa pun
    return this.cachedVoices.find((v) => v.localService === true);
  }

  /**
   * Hentikan ucapan yang sedang berjalan.
   *
   * `speechSynthesis` adalah layanan tingkat browser, bukan milik komponen:
   * ucapan yang sudah dimulai TERUS berbunyi meskipun layarnya ditinggalkan
   * atau aplikasinya dilatarbelakangkan. Di terminal gerbang itu berarti nama
   * personil tetap diumumkan setelah operator berpindah halaman. Pemanggil
   * WAJIB memanggil ini saat unmount dan saat kamera dihentikan.
   */
  public stopSpeaking() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore speech synthesis errors
    }
  }

  public speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      this.initVoices();
      window.speechSynthesis.cancel(); // Cancel prior speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "id-ID";
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      // Cari suara bahasa Indonesia jika tersedia (prioritas offline localService)
      const idVoice = this.getIndonesianVoice();
      if (idVoice) {
        utterance.voice = idVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore speech synthesis errors
    }
  }
}

export const audioSynth = new AudioSynthesizer();
