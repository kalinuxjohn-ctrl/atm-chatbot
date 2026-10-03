/**
 * Mesure le volume du microphone (0 → 1) pour animer le mode vocal au rythme
 * réel de la voix. Réutilise le flux déjà ouvert par la reconnaissance vocale :
 * le micro n'est donc demandé qu'une seule fois.
 *
 * @param {MediaStream} stream flux audio du micro
 * @param {(level: number) => void} onLevel appelé à chaque image
 * @returns {() => void} arrête la mesure (le flux, lui, est fermé par son propriétaire)
 */
export function startAudioLevelMonitor(stream, onLevel) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!stream || !AudioContextClass) return () => {};

  const audioContext = new AudioContextClass();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.frequencyBinCount);

  let frameId = 0;
  const tick = () => {
    analyser.getByteFrequencyData(samples);
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    onLevel(Math.min(1, average / 90));
    frameId = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelAnimationFrame(frameId);
    void audioContext.close();
    onLevel(0);
  };
}
