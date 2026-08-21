# Grzegorz Mróz - Personal Portfolio 

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

Welcome to my personal portfolio website! This project showcases my academic background, technical skills, and projects as a Machine Learning Engineer and Computer Science Master's student.

## Overview

This is a modern, single-page portfolio designed to be clean, responsive, and visually engaging. It highlights my expertise in **Machine Learning**, **Data Science**, and **Mathematics**.

**Live Demo:** https://grzmro.github.io/Grzmro.io/

## Key Features

- **Premium Dark Mode Design**: deep blue aesthetics with glassmorphism effects.
- **Fully Responsive**: Optimized for desktop, tablet, and mobile devices.
- **Fast & Lightweight**: Pure HTML/CSS/JS with no heavy frameworks.
- **Interactive Elements**: Smooth scrolling, scroll-reveal animations, and dynamic content.
- **Comprehensive Sections**:
  - **About**: Personal profile and background.
  - **Education**: Academic timeline (Master's & Bachelor's).
  - **Skills**: Categorized technical skills (ML, Data Science, Math).
  - **Projects**: Showcases of key projects like _Football Score Predictor_.
  - **Experience**: Professional history.

## Live demos

Two projects ship as interactive pages rather than screenshots. Both are static —
no backend, no API keys — and both are explicit on the page about which parts run
live and which are recordings.

### `demos/rag/` — RAG Document Assistant

Dense search, BM25 and reciprocal rank fusion are ported from
[Grzmro/RAG](https://github.com/Grzmro/RAG) to `demos/rag/rag-engine.js` and run in the
browser over the vectors exported from that project's Chroma collection. Claude's
answers, citations and groundedness scores are recorded from real evaluation runs,
because generation needs an API key a static page cannot hold.

The citation markers in a recorded answer only line up with the passages on screen
if the port ranks passages exactly as the Python service did, so that is tested
rather than assumed:

```bash
node tools/verify_rag_engine.cjs
```

It replays all 35 curated questions in both retrieval modes — 350 ranked passages —
against `demos/rag/data/golden.json`, which the real `rag.retriever.Retriever`
produced, and fails on any difference in ranking, channel or score.

To regenerate the exported data after changing the corpus or re-running the
evaluations, using the RAG project's own interpreter:

```bash
../RAG/.venv/Scripts/python.exe tools/export_rag_demo.py --rag-repo ../RAG
```

`demos/rag/parity-check.html` is a separate measurement page: it checks the
browser-side query encoder against the one the pipeline uses, and is where the
quantisation numbers quoted in the demo's caveats come from.

### `demos/dreamer/` — World Models & Model-Based RL

Playback of a recorded Pong match from
[Grzmro/dreamer-rssm](https://github.com/Grzmro/dreamer-rssm). Every frame in
`match.json` came out of `viz/recruiter_demo.py` running the Phase 2 checkpoint in
inference mode: the match frames are what the emulator showed, and the "imagination"
strips are decoded `imagine_rollout` predictions from the agent's belief at that
exact step — real model output, not an animation. Regenerate with:

```bash
python viz/recruiter_demo.py +demo.ckpt=experiments/dreamer_pong/checkpoints/dreamer_final.pt +demo.out=experiments/demo/match.json
```

then copy `match.json` into `demos/dreamer/`.

## Technology Stack

- **HTML5**: Semantic structure.
- **CSS3**: Custom properties (variables), Flexbox, Grid, Glassmorphism.
- **JavaScript (ES6+)**: DOM manipulation, Intersection Observer API for animations.
- **Font Awesome**: Icons.
- **Google Fonts**: _Outfit_ (Headings) & _Inter_ (Body).

## Getting Started

To view this project locally:

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/Grzmro/Grzmro.github.io.git
    ```
2.  **Open `index.html`** in your preferred web browser.

That's it! No build steps or package installations required.

## Contact

Feel free to reach out to me for collaborations or opportunities!

- **Email**: [grzegorzmroz555@gmail.com](mailto:grzegorzmroz555@gmail.com)
- **LinkedIn**: [Grzegorz Mróz](https://www.linkedin.com/in/grzegorz-mr%C3%B3z-b63266239)
- **GitHub**: [@Grzmro](https://github.com/Grzmro)

---

_© 2026 Grzegorz Mróz. All Rights Reserved._
