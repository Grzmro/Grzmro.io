/**
 * Drives the RAG demo page.
 *
 * Stages 1 and 2 are computed here and now, by rag-engine.js, over the vectors
 * in data/corpus.json. Stages 3 and 4 are lookups into recorded evaluation runs.
 * The split is load-bearing, not cosmetic: the citation markers in a recorded
 * answer only line up with the passages on screen because the ported retrieval
 * reproduces the run that produced that answer, which tools/verify_rag_engine.cjs
 * checks for every question in both modes.
 */
(function () {
  'use strict';

  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';
  const ENCODER = 'Xenova/bge-small-en-v1.5';

  const el = {
    select: document.getElementById('questionSelect'),
    questionNote: document.getElementById('questionNote'),
    modeDense: document.getElementById('modeDense'),
    modeHybrid: document.getElementById('modeHybrid'),
    modeNote: document.getElementById('modeNote'),
    freeInput: document.getElementById('freeInput'),
    loadModel: document.getElementById('loadModel'),
    modelStatus: document.getElementById('modelStatus'),
    passages: document.getElementById('passages'),
    contextBlock: document.getElementById('contextBlock'),
    contextText: document.getElementById('contextText'),
    answerSrc: document.getElementById('answerSrc'),
    answerSlot: document.getElementById('answerSlot'),
    judgeSlot: document.getElementById('judgeSlot'),
    runsTable: document.getElementById('runsTable'),
  };

  const MODE_NOTES = {
    dense: 'Cosine similarity over bge-small embeddings — the single-channel baseline.',
    hybrid:
      'The dense ranking fused with a BM25 ranking by reciprocal rank, so exact tokens that ' +
      'embeddings squash away still surface.',
  };

  let corpus = null;
  let questions = [];
  let answers = null;
  let runs = null;
  let retriever = null;

  let mode = 'dense';
  let current = null; // { id, question, vec, recorded }
  let encoder = null;

  /* ---------------------------------------------------------------- utils */

  const escapeHtml = (text) =>
    text.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);

  /**
   * Render a recorded answer: escape first, then re-introduce the small amount
   * of formatting the model actually emits, and turn [n] markers into controls
   * that point at the passage they cite.
   */
  function renderAnswerText(text) {
    return escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(
        /\[(\d+)\]/g,
        (_, n) => '<button class="rag-cite" data-cite="' + n + '">[' + n + ']</button>'
      );
  }

  const pct = (value) => (value === null || value === undefined ? '—' : value.toFixed(1) + '%');

  /* ------------------------------------------------------------- stage 1 */

  function renderPassages(hits) {
    const cited = new Set(currentCitations());

    el.passages.innerHTML = hits
      .map((hit) => {
        const scores = [
          '<span>dense <b>' + hit.score.toFixed(3) + '</b></span>',
        ];
        if (hit.lexicalScore !== null) {
          scores.push('<span>bm25 <b>' + hit.lexicalScore.toFixed(2) + '</b></span>');
        }
        if (hit.fusionScore !== null) {
          scores.push('<span>rrf <b>' + hit.fusionScore.toFixed(4) + '</b></span>');
        }

        // The dense relevance is a 0..1 scale, so the meter is honest as a
        // direct width. A lexical-only hit has no dense score to draw.
        const meter = hit.channel === 'lexical' ? 0 : Math.max(0, Math.min(1, hit.score)) * 100;

        return (
          '<article class="rag-passage' +
          (cited.has(hit.index) ? ' is-cited' : '') +
          '" id="passage-' +
          hit.index +
          '">' +
          '<div class="rag-passage-head">' +
          '<span class="rag-marker">[' + hit.index + ']</span>' +
          '<span class="rag-source">' + escapeHtml(hit.chunk.id) + '</span>' +
          '<span class="rag-chan is-' + hit.channel + '">' + hit.channel + '</span>' +
          '<span class="rag-scores">' + scores.join('') + '</span>' +
          '</div>' +
          '<div class="rag-meter"><i style="width:' + meter.toFixed(1) + '%"></i></div>' +
          '<div class="rag-passage-text">' + escapeHtml(hit.chunk.text.trim()) + '</div>' +
          '<button class="rag-expand">show full passage</button>' +
          '</article>'
        );
      })
      .join('');

    el.passages.querySelectorAll('.rag-expand').forEach((button) => {
      button.addEventListener('click', () => {
        const body = button.previousElementSibling;
        const open = body.classList.toggle('is-open');
        button.textContent = open ? 'collapse' : 'show full passage';
      });
    });
  }

  /** Which passage numbers the recorded answer actually cites. */
  function currentCitations() {
    if (!current || !current.recorded) return [];
    const markers = current.recorded.answer.match(/\[(\d+)\]/g) || [];
    return markers.map((m) => parseInt(m.slice(1, -1), 10));
  }

  /* ------------------------------------------------------------- stage 3 */

  function renderAnswer(hits) {
    if (!current.recorded) {
      el.answerSrc.textContent = 'not recorded';
      el.answerSlot.innerHTML =
        '<div class="rag-empty">' +
        '<strong>No recorded answer for this question.</strong> Generation needs an API key, ' +
        'and inventing one here would defeat the point of the whole project. What you can see ' +
        'is everything up to that call: the passages this wording retrieved, and the exact ' +
        'context block the model would have been handed.' +
        '</div>';
      el.judgeSlot.innerHTML =
        '<div class="rag-empty">Scored only for the curated evaluation questions.</div>';
      return;
    }

    const recorded = current.recorded;
    el.answerSrc.textContent = 'recorded · ' + answers.answer_model;

    const foot = [
      '<span>model: ' + escapeHtml(answers.answer_model) + '</span>',
      '<span>retrieval: ' + mode + '</span>',
      '<span>cited: ' +
        (recorded.cited_sources.length ? escapeHtml(recorded.cited_sources.join(', ')) : 'nothing') +
        '</span>',
    ].join('');

    if (recorded.abstained) {
      // An abstention can still cite: several of these decline one half of a
      // two-part question while answering the other from a real passage. Those
      // markers stay clickable, or the highlighted passage looks unexplained.
      const detail = recorded.answer.replace(/^INSUFFICIENT_CONTEXT:\s*/, '');
      el.answerSlot.innerHTML =
        '<div class="rag-answer">' +
        '<div class="rag-abstain">' +
        '<i class="fas fa-shield-halved"></i>' +
        '<div>' +
        '<span class="rag-abstain-tag">INSUFFICIENT_CONTEXT — declined</span>' +
        '<div class="rag-answer-body">' + renderAnswerText(detail) + '</div>' +
        '</div></div>' +
        '<div class="rag-answer-foot">' + foot + '</div>' +
        '</div>';
    } else {
      el.answerSlot.innerHTML =
        '<div class="rag-answer">' +
        '<div class="rag-answer-body">' + renderAnswerText(recorded.answer) + '</div>' +
        '<div class="rag-answer-foot">' + foot + '</div>' +
        '</div>';
    }

    el.answerSlot.querySelectorAll('.rag-cite').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById('passage-' + button.dataset.cite);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.remove('is-flash');
        void target.offsetWidth; // restart the animation
        target.classList.add('is-flash');
      });
    });

    renderJudge(recorded);
  }

  /* ------------------------------------------------------------- stage 4 */

  function renderJudge(recorded) {
    const dangling = recorded.dangling_citations.length;
    const missing = recorded.must_contain_missing.length;

    const checks = [
      ['retrieval recall', recorded.retrieval_hit],
      ['abstention correct', recorded.abstention_correct],
      ['no dangling markers', dangling === 0],
      ['required content present', missing === 0],
    ];

    // Only "grounded" is a clean pass. Everything else the judge can return —
    // partially_grounded is the one that actually occurs — is worth flagging,
    // so anything short of grounded gets the warning treatment rather than a
    // neutral chip that reads like a pass at a glance.
    const verdictClass = recorded.verdict === 'grounded' ? 'is-good' : 'is-warn';

    el.judgeSlot.innerHTML =
      '<div class="rag-judge">' +
      '<div class="rag-judge-top">' +
      '<div class="rag-score"><b>' + recorded.groundedness + '</b><span>/ 5 groundedness</span></div>' +
      '<span class="demo-badge ' + verdictClass + '">' + escapeHtml(recorded.verdict) + '</span>' +
      '<span class="demo-badge">judge: ' + escapeHtml(answers.judge_model) + '</span>' +
      '</div>' +
      (recorded.judge_reasoning
        ? '<p class="rag-judge-reason">“' + escapeHtml(recorded.judge_reasoning) + '”</p>'
        : '') +
      (recorded.unsupported_claims.length
        ? '<p class="rag-judge-reason">Unsupported: ' +
          escapeHtml(recorded.unsupported_claims.join('; ')) +
          '</p>'
        : '') +
      '<div class="rag-checks">' +
      checks
        .map(
          ([label, pass]) =>
            '<div class="rag-check ' + (pass ? 'is-pass' : 'is-fail') + '">' +
            '<i class="fas fa-' + (pass ? 'check' : 'xmark') + '"></i>' +
            label +
            '</div>'
        )
        .join('') +
      '</div></div>';
  }

  /* ---------------------------------------------------------------- run */

  function run() {
    const hits = retriever.search(current.question, current.vec, { mode });
    // Passages first: which of them the answer cites is already known, because
    // the recorded answer is resolved when the question or the mode changes.
    renderPassages(hits);
    el.contextText.textContent = RagEngine.formatContext(hits);
    renderAnswer(hits);
  }

  function selectQuestion(id) {
    const question = questions.find((q) => q.id === id);
    if (!question) return;
    current = {
      id: question.id,
      question: question.question,
      vec: question.vec,
      recorded: (answers.by_question[question.id] || {})[mode] || null,
      meta: question,
    };

    const bits = [];
    if (!question.answerable) {
      bits.push('<strong>Unanswerable by construction</strong> — the pipeline is expected to decline.');
    }
    if (question.set === 'hard') {
      bits.push('From the discrimination set, built to separate retrieval configurations.');
    }
    if (question.note) bits.push(escapeHtml(question.note));
    el.questionNote.innerHTML = bits.join(' ');

    el.freeInput.value = '';
    run();
  }

  function setMode(next) {
    mode = next;
    el.modeDense.setAttribute('aria-pressed', String(next === 'dense'));
    el.modeHybrid.setAttribute('aria-pressed', String(next === 'hybrid'));
    el.modeNote.textContent = MODE_NOTES[next];
    if (!current) return;
    current.recorded = (answers.by_question[current.id] || {})[mode] || null;
    run();
  }

  /* ------------------------------------------------------------ free text */

  async function loadEncoder() {
    el.loadModel.disabled = true;
    el.modelStatus.textContent = 'fetching the runtime…';

    const { pipeline, env } = await import(TRANSFORMERS_URL);
    env.allowLocalModels = false;

    el.modelStatus.textContent = 'downloading bge-small-en-v1.5 (8-bit)…';
    encoder = await pipeline('feature-extraction', ENCODER, {
      dtype: 'q8',
      progress_callback: (progress) => {
        if (progress.status === 'progress' && progress.total) {
          const done = ((progress.loaded / progress.total) * 100).toFixed(0);
          el.modelStatus.textContent = 'downloading ' + progress.file + ' — ' + done + '%';
        }
      },
    });

    el.modelStatus.textContent =
      'encoder ready — questions you type are embedded in this tab and never leave it.';
    el.loadModel.textContent = 'Model loaded';
    el.freeInput.disabled = false;
    el.freeInput.placeholder = 'Ask anything about the three indexed documents…';
    el.freeInput.focus();
  }

  async function runFreeText(text) {
    const query = text.trim();
    if (!query || !encoder) return;

    // CLS pooling, matching how fastembed encodes for this checkpoint; the query
    // prefix is whatever the exporter found the service actually applies.
    const output = await encoder(corpus.query_prefix + query, { pooling: 'cls', normalize: true });

    current = {
      id: null,
      question: query,
      vec: Array.from(output.data),
      recorded: null,
      meta: null,
    };
    el.select.value = '';
    el.questionNote.innerHTML =
      'Your wording, embedded here. Retrieval is real; the answer stage stays empty by design.';
    el.contextBlock.open = true;
    run();
  }

  /* --------------------------------------------------------------- table */

  function renderRuns() {
    const rows = Object.entries(runs).map(([key, run]) => ({ key, ...run }));
    rows.sort(
      (a, b) => a.set.localeCompare(b.set) || a.config.localeCompare(b.config)
    );

    const columns = [
      ['mean_groundedness', 'groundedness', (v) => v.toFixed(2)],
      ['must_contain_pass_pct', 'required content', pct],
      ['abstention_accuracy_pct', 'abstention', pct],
      ['citation_validity_pct', 'citations valid', pct],
      ['hallucination_rate_pct', 'hallucination', pct],
    ];

    // Best-in-set gets marked so the hard set's spread is visible at a glance.
    // A column where every configuration ties is left unmarked: on the
    // regression set almost all of them do, and highlighting a four-way tie
    // reads as a finding when it is the opposite of one.
    const best = {};
    ['regression', 'hard'].forEach((set) => {
      columns.forEach(([field]) => {
        const values = rows.filter((row) => row.set === set).map((row) => row.summary[field]);
        best[set + field] =
          Math.min(...values) === Math.max(...values)
            ? null
            : field === 'hallucination_rate_pct'
              ? Math.min(...values)
              : Math.max(...values);
      });
    });

    el.runsTable.innerHTML =
      '<thead><tr>' +
      '<th>configuration</th><th>set</th><th>questions</th>' +
      columns.map(([, label]) => '<th>' + label + '</th>').join('') +
      '</tr></thead><tbody>' +
      rows
        .map(
          (row) =>
            '<tr>' +
            '<td>' + escapeHtml(row.config) + '</td>' +
            '<td>' + row.set + '</td>' +
            '<td>' + row.summary.questions + '</td>' +
            columns
              .map(([field, , format]) => {
                const value = row.summary[field];
                const target = best[row.set + field];
                const isBest = target !== null && value === target;
                return '<td class="' + (isBest ? 'is-best' : '') + '">' + format(value) + '</td>';
              })
              .join('') +
            '</tr>'
        )
        .join('') +
      '</tbody>' +
      el.runsTable.innerHTML; // keep the <caption> the markup already carries
  }

  /* ---------------------------------------------------------------- boot */

  function populateSelect() {
    const groups = [
      ['regression', 'Regression set — broad coverage'],
      ['hard', 'Discrimination set — built to separate configurations'],
    ];
    el.select.innerHTML = groups
      .map(([set, label]) => {
        const options = questions
          .filter((q) => q.set === set)
          .map(
            (q) =>
              '<option value="' + q.id + '">' +
              (q.answerable ? '' : '⊘ ') +
              escapeHtml(q.question) +
              '</option>'
          )
          .join('');
        return '<optgroup label="' + label + '">' + options + '</optgroup>';
      })
      .join('');
  }

  async function boot() {
    const [corpusData, questionData, answerData, runData] = await Promise.all(
      ['corpus.json', 'questions.json', 'answers.json', 'runs.json'].map((name) =>
        fetch('data/' + name).then((response) => {
          if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
          return response.json();
        })
      )
    );

    corpus = corpusData;
    questions = questionData;
    answers = answerData;
    runs = runData;
    retriever = new RagEngine.Retriever(corpus);

    populateSelect();
    renderRuns();
    setMode('dense');

    // Opens on the question where the retrieval mode changes the outcome: dense
    // alone misses the passage and the model declines, hybrid finds it.
    const opening = questions.find((q) => q.id === 'trap-who-approves') || questions[0];
    el.select.value = opening.id;
    selectQuestion(opening.id);

    el.select.addEventListener('change', () => selectQuestion(el.select.value));
    el.modeDense.addEventListener('click', () => setMode('dense'));
    el.modeHybrid.addEventListener('click', () => setMode('hybrid'));
    el.loadModel.addEventListener('click', () => {
      loadEncoder().catch((err) => {
        console.error(err);
        el.modelStatus.textContent = 'could not load the encoder: ' + err.message;
        el.loadModel.disabled = false;
      });
    });
    el.freeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runFreeText(el.freeInput.value);
    });
  }

  boot().catch((err) => {
    console.error(err);
    el.passages.innerHTML =
      '<div class="rag-empty">Could not load the demo data: ' + escapeHtml(err.message) + '</div>';
  });
})();
