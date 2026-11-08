// Funções de áudio puras (sem acesso ao navegador), testáveis no Vitest.
// Entrada para o Gemini: PCM 16-bit, 16 kHz. Saída do Gemini: PCM 16-bit, 24 kHz.

export const IN_RATE = 16000;
export const OUT_RATE = 24000;

/** Reduz a taxa de amostragem por média simples; guarda estado entre blocos. */
export function createDownsampler(inRate: number, outRate = IN_RATE) {
  const ratio = inRate / outRate;
  let acc = 0;
  let n = 0;
  let phase = 0;
  return function push(float32: ArrayLike<number>): number[] {
    const out: number[] = [];
    for (let i = 0; i < float32.length; i++) {
      acc += float32[i];
      n++;
      phase += 1;
      if (phase >= ratio) {
        out.push(acc / n);
        acc = 0;
        n = 0;
        phase -= ratio;
      }
    }
    return out;
  };
}

export function floatsToInt16(floats: ArrayLike<number>) {
  const out = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function int16ToBase64(int16: Int16Array) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

export function base64ToFloat32(b64: string) {
  const bin = atob(b64);
  const len = bin.length - (bin.length % 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 0x8000;
  return out;
}

/** Raiz da média dos quadrados (volume) de um bloco de áudio. */
export function rms(data: ArrayLike<number>) {
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}
