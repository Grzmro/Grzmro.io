/**
 * Playback for the recorded Dreamer match.
 *
 * Nothing here simulates anything. match.json was produced by
 * viz/recruiter_demo.py running the Phase 2 checkpoint in inference mode: every
 * frame in `frames` is what the emulator showed, every frame in `branches` is a
 * decoded imagine_rollout from the posterior belief at that exact step — the
 * same prior-only path the policy was trained on. This file only decides when to
 * put which of them on screen.
 */
(function () {
  'use strict';

  const FPS = 22;
  const DREAM_FPS = 7;
  const PAUSE_AT_BRANCH = 2400; // ms the match holds while the dream plays

  // Pong's six buttons collapse to the three things a person can see the paddle do.
  const MOVE = ['still', 'still', '↑ up', '↓ down', '↑ up', '↓ down'];

  const IDLE_TEXT =
    'Every few seconds the match freezes and the agent unrolls 15 steps ahead. The picture ' +
    'beside it is its actual prediction, not an animation.';
  const LIVE_TEXT =
    'Match paused. The agent is unrolling 15 steps forward from what it sees right now — the ' +
    'image beside it is drawn by its model of the game, not pulled from the emulator.';

  const el = {
    scoreA: document.getElementById('scoreA'),
    scoreB: document.getElementById('scoreB'),
    move: document.getElementById('rMove'),
    step: document.getElementById('rStep'),
    progress: document.getElementById('progress'),
    badge: document.getElementById('dreamBadge'),
    dreamShell: document.getElementById('dreamShell'),
    dreamText: document.getElementById('dreamText'),
    flash: document.getElementById('flash'),
    loading: document.getElementById('loading'),
    play: document.getElementById('play'),
    restart: document.getElementById('restart'),
    mode1: document.getElementById('mode1'),
    mode2: document.getElementById('mode2'),
  };

  const stage = document.getElementById('stage').getContext('2d');
  const dream = document.getElementById('dream').getContext('2d');
  stage.imageSmoothingEnabled = false;
  dream.imageSmoothingEnabled = false;

  const decode = (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    return img;
  };

  let DATA = null;
  let frames = [];
  let dreamAt = new Map();

  let idx = 0;
  let playing = true;
  let showDreams = true;
  let acc = 0;
  let last = performance.now();
  let dreaming = null; // { imgs, until, t, acc }

  function paintScore() {
    const [a, b] = DATA.scores[Math.min(idx, DATA.scores.length - 1)];
    el.scoreA.textContent = a;
    el.scoreB.textContent = b;
  }

  function draw() {
    const img = frames[idx];
    if (img && img.complete) stage.drawImage(img, 0, 0, 64, 64);
    el.step.textContent = idx;
    el.move.textContent = idx > 0 ? MOVE[DATA.actions[idx - 1]] : '—';
    el.progress.style.width = (100 * idx) / (frames.length - 1) + '%';
  }

  function startDream(branch) {
    dreaming = { imgs: branch.imgs, until: performance.now() + PAUSE_AT_BRANCH, t: 0, acc: 0 };
    el.dreamShell.classList.remove('is-idle');
    el.badge.textContent = 'predicting';
    el.badge.classList.add('is-live');
    el.dreamText.textContent = LIVE_TEXT;
  }

  function endDream() {
    dreaming = null;
    el.dreamShell.classList.add('is-idle');
    el.badge.textContent = 'idle';
    el.badge.classList.remove('is-live');
    el.dreamText.textContent = IDLE_TEXT;
  }

  function advance() {
    const prev = DATA.scores[idx];
    idx += 1;
    if (idx >= frames.length) {
      idx = frames.length - 1;
      playing = false;
      el.play.textContent = 'Replay';
      return;
    }
    const now = DATA.scores[idx];
    if (now[0] > prev[0]) {
      el.flash.classList.remove('is-on');
      void el.flash.offsetWidth; // restart the animation
      el.flash.classList.add('is-on');
    }
    paintScore();
    if (showDreams && dreamAt.has(idx)) startDream(dreamAt.get(idx));
  }

  function loop(now) {
    const dt = now - last;
    last = now;

    if (dreaming) {
      dreaming.acc += dt;
      if (dreaming.acc > 1000 / DREAM_FPS) {
        dreaming.acc = 0;
        const img = dreaming.imgs[dreaming.t % dreaming.imgs.length];
        if (img && img.complete) dream.drawImage(img, 0, 0, 64, 64);
        dreaming.t += 1;
      }
      if (now > dreaming.until) endDream();
    } else if (playing) {
      acc += dt;
      while (acc > 1000 / FPS) {
        acc -= 1000 / FPS;
        advance();
      }
      draw();
    }
    requestAnimationFrame(loop);
  }

  function setMode(withDreams) {
    showDreams = withDreams;
    el.mode1.setAttribute('aria-pressed', String(withDreams));
    el.mode2.setAttribute('aria-pressed', String(!withDreams));
    if (!withDreams) endDream();
  }

  function restart() {
    idx = 0;
    acc = 0;
    playing = true;
    endDream();
    el.play.textContent = 'Pause';
    paintScore();
    draw();
  }

  el.mode1.addEventListener('click', () => setMode(true));
  el.mode2.addEventListener('click', () => setMode(false));
  el.restart.addEventListener('click', restart);
  el.play.addEventListener('click', () => {
    if (idx >= frames.length - 1) {
      restart();
      return;
    }
    playing = !playing;
    el.play.textContent = playing ? 'Pause' : 'Resume';
  });

  async function boot() {
    const response = await fetch('match.json');
    if (!response.ok) throw new Error('match.json: HTTP ' + response.status);
    DATA = await response.json();

    frames = DATA.frames.map(decode);
    dreamAt = new Map(
      DATA.branches.map((branch) => [branch.step, { imgs: branch.frames.map(decode) }])
    );

    // The first frame has to be on screen before the loader lifts, or the match
    // opens on an empty rectangle. The rest decode while it plays; draw() skips
    // any frame that is not ready rather than stalling the loop.
    await frames[0].decode();
    el.loading.classList.add('is-hidden');

    paintScore();
    draw();
    last = performance.now();
    requestAnimationFrame(loop);
  }

  boot().catch((err) => {
    console.error(err);
    el.loading.textContent = 'could not load the recorded match';
    el.loading.classList.remove('is-hidden');
  });
})();
