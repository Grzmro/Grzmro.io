/**
 * Check the browser retrieval port against the Python service that produced it.
 *
 * golden.json holds what rag.retriever.Retriever actually returned for all 35
 * curated questions in both retrieval modes. This replays each one through
 * demos/rag/rag-engine.js and fails on any difference in ranking, channel, or
 * score beyond the tolerance that rounding the exported vectors to six decimals
 * can explain.
 *
 *   node tools/verify_rag_engine.cjs
 */

const fs = require('fs');
const path = require('path');

const RagEngine = require('../demos/rag/rag-engine.js');

const DATA = path.join(__dirname, '..', 'demos', 'rag', 'data');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));

const corpus = readJson('corpus.json');
const questions = readJson('questions.json');
const golden = readJson('golden.json');

// The exported vectors are rounded to 6 decimals, so a score can drift in the
// 5th. Anything larger is a real disagreement, not rounding.
const SCORE_TOLERANCE = 1e-4;
// BM25 runs on text, not on rounded vectors, so it should agree exactly.
const LEXICAL_TOLERANCE = 1e-6;

const retriever = new RagEngine.Retriever(corpus);
const failures = [];
let comparisons = 0;
let maxScoreDrift = 0;

for (const question of questions) {
  for (const mode of ['dense', 'hybrid']) {
    const expected = golden[question.id][mode];
    const actual = retriever.search(question.question, question.vec, { mode });
    const where = `${question.id} / ${mode}`;

    if (actual.length !== expected.length) {
      failures.push(`${where}: returned ${actual.length} passages, expected ${expected.length}`);
      continue;
    }

    expected.forEach((want, i) => {
      const got = actual[i];
      comparisons++;

      if (got.chunkId !== want.chunk_id) {
        failures.push(
          `${where}: rank ${i + 1} is ${got.chunkId}, expected ${want.chunk_id}`
        );
        return;
      }
      if (got.channel !== want.channel) {
        failures.push(
          `${where}: ${got.chunkId} came from "${got.channel}", expected "${want.channel}"`
        );
      }

      const scoreDrift = Math.abs(got.score - want.score);
      maxScoreDrift = Math.max(maxScoreDrift, scoreDrift);
      if (scoreDrift > SCORE_TOLERANCE) {
        failures.push(
          `${where}: ${got.chunkId} scored ${got.score.toFixed(6)}, expected ${want.score.toFixed(6)}`
        );
      }

      if (want.lexical_score !== null) {
        if (got.lexicalScore === null) {
          failures.push(`${where}: ${got.chunkId} has no lexical score, expected one`);
        } else if (Math.abs(got.lexicalScore - want.lexical_score) > LEXICAL_TOLERANCE) {
          failures.push(
            `${where}: ${got.chunkId} BM25 ${got.lexicalScore.toFixed(6)}, expected ${want.lexical_score.toFixed(6)}`
          );
        }
      }

      if (want.fusion_score !== null && got.fusionScore !== null) {
        if (Math.abs(got.fusionScore - want.fusion_score) > LEXICAL_TOLERANCE) {
          failures.push(
            `${where}: ${got.chunkId} RRF ${got.fusionScore.toFixed(6)}, expected ${want.fusion_score.toFixed(6)}`
          );
        }
      }
    });
  }
}

console.log(`${questions.length} questions x 2 modes, ${comparisons} ranked passages compared`);
console.log(`largest dense-score drift: ${maxScoreDrift.toExponential(2)}`);

if (failures.length) {
  console.error(`\n${failures.length} mismatch(es):`);
  failures.slice(0, 25).forEach((f) => console.error('  ' + f));
  if (failures.length > 25) console.error(`  ... and ${failures.length - 25} more`);
  process.exit(1);
}

console.log('the browser port matches the Python retriever exactly');
