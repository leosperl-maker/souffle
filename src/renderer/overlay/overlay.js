'use strict';

const pill = document.getElementById('pill');
const label = document.getElementById('label');
const hint = document.getElementById('hint');
const timer = document.getElementById('timer');
const bars = [...document.querySelectorAll('#bars span')];

let startedAt = 0;
let tick = null;
let audioCtx = null;
let lastState = null;

/* ---------- sons générés (aucun fichier à embarquer) ---------- */

function beep(freq, duration = 0.09, gain = 0.045) {
  try {
    audioCtx = audioCtx || new AudioContext();
    const osc = audioCtx.createOscillator();
    const vol = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    vol.gain.setValueAtTime(0, audioCtx.currentTime);
    vol.gain.linearRampToValueAtTime(gain, audioCtx.currentTime + 0.012);
    vol.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(vol).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration + 0.02);
  } catch {
    /* pas de sortie audio : sans conséquence */
  }
}

/* ---------- rendu ---------- */

/* La pilule est cliquable pendant la dictée : c'est le filet de secours si le
   raccourci n'est pas délivré par le système. */
pill.addEventListener('click', () => {
  if (pill.dataset.state === 'recording') window.souffle.stop();
});
pill.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (pill.dataset.state === 'recording') window.souffle.cancel();
});

const COPY = {
  recording: ['Écoute…', 'Cliquez pour terminer'],
  working: ['Transcription…', 'Un instant'],
  done: ['Inséré', ''],
  error: ['Erreur', '']
};

function render({ state, message, step, words, sounds, pasted, live, segments }) {
  pill.dataset.state = state;
  const [l, h] = COPY[state] || ['', ''];
  label.textContent =
    state === 'error' ? message || l
    : state === 'done' && pasted === false ? 'Copié'
    : state === 'recording' && live ? 'Direct'
    : l;
  hint.textContent =
    state === 'working' && step ? step
    : state === 'done' && words ? `${words} mot${words > 1 ? 's' : ''}`
    : state === 'error' ? 'Réglages de Souffle'
    : state === 'recording' && live
      ? segments
        ? `${segments} phrase${segments > 1 ? 's' : ''} écrite${segments > 1 ? 's' : ''}`
        : 'Le texte s’écrit au fil des phrases'
      : h;

  // En mode direct, l'état « recording » est réémis à chaque phrase écrite :
  // le chrono et le bip ne doivent repartir qu'au vrai début de la dictée.
  const entering = state !== lastState;
  lastState = state;

  if (state === 'recording') {
    if (!entering) return;
    startedAt = Date.now();
    clearInterval(tick);
    tick = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    timer.textContent = '0:00';
    if (sounds) beep(660);
  } else {
    clearInterval(tick);
    tick = null;
    bars.forEach((b) => (b.style.height = '6px'));
    if (state === 'done' && sounds) beep(880, 0.08);
    if (state === 'error' && sounds) beep(220, 0.16);
  }
}

/* Chaque barre réagit avec un décalage : ça se lit comme une vraie onde. */
const WEIGHTS = [0.55, 0.85, 1, 0.85, 0.55];

function renderLevel(level) {
  bars.forEach((bar, i) => {
    const h = 6 + level * WEIGHTS[i] * 20 + Math.random() * 2.5;
    bar.style.height = `${Math.min(26, h).toFixed(1)}px`;
  });
}

window.souffle.onState(render);
window.souffle.onLevel(renderLevel);
