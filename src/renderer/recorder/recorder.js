'use strict';
/**
 * Fenêtre invisible dédiée à la capture micro.
 *
 * Deux régimes :
 *   - classique : un seul enregistrement, envoyé quand l'utilisateur arrête ;
 *   - direct    : on découpe sur les silences et on envoie chaque phrase dès
 *                 qu'elle est finie, pour que le texte s'écrive pendant qu'on parle.
 *
 * Le flux micro reste ouvert entre deux dictées : le rouvrir coûte 200 à 500 ms
 * et fait clignoter l'indicateur micro du système.
 *
 * Tout ce qui est logué en « [rec] » remonte dans le terminal.
 */

let stream = null;
let recorder = null;
let chunks = [];
let audioCtx = null;
let analyser = null;
let levelTimer = null;

let live = false;
let cancelled = false;
let stopping = false; // arrêt définitif demandé par l'utilisateur
let segmentStartedAt = 0;

/* Détection de fin de phrase */
const SILENCE_RMS = 0.012; // en dessous, on considère qu'il n'y a pas de voix
const SILENCE_TO_CUT_MS = 700; // durée de blanc qui clôt une phrase
const MIN_SPEECH_MS = 600; // en deçà, ce n'est pas une phrase mais un bruit
const MAX_SEGMENT_MS = 15000; // on coupe de force pour ne pas accumuler
let speechMs = 0;
let silenceMs = 0;

const log = (...a) => console.log('[rec]', ...a);

const MIME = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4'
].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

log('format retenu =', MIME || 'défaut du navigateur');

/* ------------------------------------------------------------------ */
/* Flux micro                                                          */
/* ------------------------------------------------------------------ */

async function ensureStream() {
  if (stream && stream.active) {
    log('flux déjà ouvert');
    return stream;
  }
  log('appel getUserMedia…');
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  const track = stream.getAudioTracks()[0];
  log('flux obtenu :', track ? track.label || '(micro sans nom)' : 'aucune piste');

  track?.addEventListener('ended', () => {
    log('la piste micro a été coupée par le système');
    stream = null;
  });

  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.75;
  src.connect(analyser);
  return stream;
}

/* ------------------------------------------------------------------ */
/* Niveau sonore + découpage sur les silences                          */
/* ------------------------------------------------------------------ */

const TICK_MS = 60;

function startLevelMeter() {
  const buf = new Uint8Array(analyser.frequencyBinCount);
  let quiet = 0;

  levelTimer = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);

    if (rms < 0.002) quiet++;
    else quiet = 0;
    if (quiet === 50) log('attention : 3 s de silence absolu, vérifiez l’entrée micro');

    // Compression douce : la voix normale remplit la barre sans saturer.
    window.souffle.sendLevel(Math.min(1, Math.pow(rms * 4.2, 0.7)));

    if (!live || stopping || cancelled) return;

    if (rms >= SILENCE_RMS) {
      speechMs += TICK_MS;
      silenceMs = 0;
    } else if (speechMs > 0) {
      silenceMs += TICK_MS;
    }

    const elapsed = Date.now() - segmentStartedAt;
    const endOfSentence = speechMs >= MIN_SPEECH_MS && silenceMs >= SILENCE_TO_CUT_MS;
    const tooLong = elapsed >= MAX_SEGMENT_MS && speechMs >= MIN_SPEECH_MS;

    if (endOfSentence || tooLong) {
      log(`fin de phrase détectée (${speechMs} ms de voix, ${silenceMs} ms de blanc)`);
      cutSegment();
    }
  }, TICK_MS);
}

function stopLevelMeter() {
  clearInterval(levelTimer);
  levelTimer = null;
}

/* ------------------------------------------------------------------ */
/* Enregistrement                                                      */
/* ------------------------------------------------------------------ */

function beginSegment() {
  chunks = [];
  speechMs = 0;
  silenceMs = 0;
  segmentStartedAt = Date.now();

  recorder = new MediaRecorder(
    stream,
    MIME ? { mimeType: MIME, audioBitsPerSecond: 64000 } : undefined
  );
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = handleSegmentEnd;
  recorder.onerror = (e) => {
    log('MediaRecorder en erreur :', e.error?.name);
    window.souffle.sendError(`Enregistrement interrompu (${e.error?.name || 'inconnu'})`);
  };
  recorder.start();
}

/** Clôt la phrase en cours ; une nouvelle démarre aussitôt derrière. */
function cutSegment() {
  if (recorder && recorder.state === 'recording') recorder.stop();
}

async function handleSegmentEnd() {
  const durationMs = Date.now() - segmentStartedAt;
  const parts = chunks;
  // On lit le type MAINTENANT : beginSegment() va remplacer `recorder` juste après.
  const mime = recorder.mimeType || 'audio/webm';
  chunks = [];

  if (cancelled) {
    log('annulé, audio jeté');
    return;
  }

  const blob = new Blob(parts, { type: mime });
  const isFinal = !live || stopping;
  log(`${isFinal ? 'enregistrement terminé' : 'phrase envoyée'} : ${blob.size} octets en ${durationMs} ms`);

  // En mode direct, on relance la capture AVANT l'envoi réseau : le blanc
  // entre deux phrases doit être aussi court que possible.
  if (live && !stopping) beginSegment();

  const buffer = new Uint8Array(await blob.arrayBuffer());
  window.souffle.sendAudio({
    buffer,
    mime,
    durationMs,
    segment: live,
    final: isFinal
  });
}

async function start(opts = {}) {
  try {
    cancelled = false;
    stopping = false;
    live = Boolean(opts.live);
    chunks = [];

    await ensureStream();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    beginSegment();
    startLevelMeter();
    log(`enregistrement démarré${live ? ' (mode direct)' : ''}`);
    window.souffle.sendStarted();
  } catch (err) {
    log('échec du démarrage :', err.name, err.message);
    window.souffle.sendError(
      err.name === 'NotAllowedError' ? 'Micro refusé par le système'
      : err.name === 'NotFoundError' ? 'Aucun micro détecté'
      : `Micro indisponible (${err.name})`
    );
  }
}

function stop() {
  stopping = true;
  stopLevelMeter();
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
  } else {
    log('arrêt demandé mais aucun enregistrement en cours (état =', recorder?.state || 'néant', ')');
    window.souffle.sendError('La capture n’avait pas démarré');
  }
}

function cancel() {
  cancelled = true;
  stopping = true;
  stopLevelMeter();
  if (recorder && recorder.state === 'recording') recorder.stop();
  chunks = [];
}

window.souffle.onStart(start);
window.souffle.onStop(stop);
window.souffle.onCancel(cancel);
log('fenêtre de capture prête');
