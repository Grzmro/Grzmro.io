"""Export the real RAG project into static data the portfolio demo runs on.

Nothing here calls an LLM. Retrieval is offline, so every number this writes is
produced by the project's own code paths rather than re-derived:

  corpus.json    the chunks actually in Chroma, with their bge-small vectors
  questions.json both curated eval sets, with the vector fastembed gives the query
  answers.json   Claude's recorded answers from eval/baselines (4 configurations)
  runs.json      the eval summaries those answers were scored in
  golden.json    what rag.retriever.Retriever returns for every question, so the
                 browser reimplementation can be checked against it rather than
                 trusted

Usage (from the portfolio repo, with the RAG project's interpreter):
    ../RAG/.venv/Scripts/python.exe tools/export_rag_demo.py --rag-repo ../RAG
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import replace
from pathlib import Path


def undo_mojibake(text: str) -> str:
    """Repair utf-8-read-as-cp1252 damage in recorded answers.

    The eval runner did not pin its file encoding when these reports were
    written, so a pound sign survives as two characters. Questions are re-read
    from YAML instead of repaired, but the answers exist only inside the reports.
    """
    if not isinstance(text, str) or "Â" not in text:
        return text
    try:
        return text.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def round_vec(vec, places: int = 6) -> list[float]:
    """Trim the vectors before they ship: 384 floats per chunk and per question."""
    return [round(float(x), places) for x in vec]


# BGE checkpoints are documented as asymmetric — the query side carries an
# instruction prefix the passage side does not — and rag.embeddings encodes both
# sides through fastembed's separate query/passage entry points on that basis.
# For BAAI/bge-small-en-v1.5, fastembed 0.8 turns out to produce the identical
# vector either way. The browser has to match whatever is actually happening, not
# whatever is documented, so the prefix is probed rather than assumed.
BGE_PREFIX = "Represent this sentence for searching relevant passages: "


def detect_query_prefix(embeddings) -> str:
    import numpy as np

    probe = "How many days of paid annual leave do full-time employees get?"
    query_vec = np.asarray(embeddings.embed_query(probe))
    passage_vec = np.asarray(embeddings.embed_documents([probe])[0])
    if float(np.dot(query_vec, passage_vec)) > 0.9999:
        return ""

    prefixed = np.asarray(embeddings.embed_documents([BGE_PREFIX + probe])[0])
    if float(np.dot(query_vec, prefixed)) > 0.9999:
        return BGE_PREFIX

    raise RuntimeError(
        "The query encoder differs from the passage encoder by something other "
        "than the known BGE prefix; the browser cannot reproduce it."
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rag-repo", required=True, type=Path)
    parser.add_argument("--out", default=Path("demos/rag/data"), type=Path)
    args = parser.parse_args()

    out_dir = args.out.resolve()
    rag_repo = args.rag_repo.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # rag.config resolves paths and .env relative to its own package root, so the
    # process has to stand inside the project for Chroma to be found.
    os.chdir(rag_repo)
    sys.path.insert(0, str(rag_repo))

    import yaml

    from rag.config import Settings
    from rag.embeddings import build_embeddings
    from rag.hybrid import tokenize
    from rag.retriever import Retriever
    from rag.store import get_vectorstore

    settings = Settings.from_env()
    settings = replace(settings, retrieval_mode="dense", rerank_provider="none", rerank_model="")

    embeddings = build_embeddings(settings)
    query_prefix = detect_query_prefix(embeddings)
    print("query prefix     {!r}".format(query_prefix))

    # --- corpus: text and vectors straight out of the collection -------------
    store = get_vectorstore(settings)
    got = store._collection.get(include=["documents", "metadatas", "embeddings"])  # noqa: SLF001

    order = sorted(range(len(got["ids"])), key=lambda i: got["ids"][i])
    chunks = []
    for i in order:
        meta = got["metadatas"][i]
        text = got["documents"][i]
        chunks.append(
            {
                "id": got["ids"][i],
                "source": meta.get("source", "unknown"),
                "title": meta.get("title", ""),
                "chunk_index": meta.get("chunk_index", 0),
                "start_index": meta.get("start_index", 0),
                "text": text,
                "tokens": len(tokenize(text)),
                "vec": round_vec(got["embeddings"][i]),
            }
        )

    corpus = {
        "embedding_model": settings.embedding_model,
        "embedding_provider": settings.embedding_provider,
        "dim": len(chunks[0]["vec"]),
        "chunk_size": settings.chunk_size,
        "chunk_overlap": settings.chunk_overlap,
        "top_k": settings.top_k,
        "bm25": {"k1": settings.bm25_k1, "b": settings.bm25_b},
        "rrf_k": settings.rrf_k,
        # Empty for this checkpoint — see detect_query_prefix. Recorded rather
        # than assumed so the browser embeds free-text queries the same way the
        # service does, whichever way that turns out to be.
        "query_prefix": query_prefix,
        "chunks": chunks,
    }
    (out_dir / "corpus.json").write_text(json.dumps(corpus, ensure_ascii=False), encoding="utf-8")
    print("corpus.json      {} chunks, dim={}".format(len(chunks), corpus["dim"]))

    # --- questions: both sets, with the vector fastembed gives the query -----
    question_files = ((Path("eval/questions.yaml"), False), (Path("eval/questions-hard.yaml"), True))
    questions = []
    for path, hard in question_files:
        for entry in yaml.safe_load(path.read_text(encoding="utf-8")):
            questions.append(
                {
                    "id": entry["id"],
                    "question": entry["question"],
                    "answerable": entry.get("answerable", True),
                    "expected_sources": entry.get("expected_sources", []),
                    "must_contain": entry.get("must_contain", []),
                    "note": entry.get("note", ""),
                    "set": "hard" if hard else "regression",
                    "vec": round_vec(embeddings.embed_query(entry["question"])),
                }
            )
    (out_dir / "questions.json").write_text(
        json.dumps(questions, ensure_ascii=False), encoding="utf-8"
    )
    n_hard = sum(1 for q in questions if q["set"] == "hard")
    print("questions.json   {} questions ({} hard)".format(len(questions), n_hard))

    # --- answers and run summaries from the recorded evaluations -------------
    configs = {
        "dense": "dense.json",
        "dense-rerank": "dense-rerank.json",
        "hybrid": "hybrid.json",
        "hybrid-rerank": "hybrid-rerank.json",
    }
    by_question: dict[str, dict] = {}
    runs: dict[str, dict] = {}
    for config, filename in configs.items():
        for suffix, prefix in (("", ""), ("-hard", "hard-")):
            report_path = Path("eval/baselines") / (prefix + filename)
            if not report_path.exists():
                continue
            report = json.loads(report_path.read_text(encoding="utf-8"))
            runs[config + suffix] = {
                "config": config,
                "set": "hard" if suffix else "regression",
                "summary": report["summary"],
                "settings": report["settings"],
            }
            for result in report["results"]:
                slot = by_question.setdefault(result["id"], {})
                slot[config] = {
                    "answer": undo_mojibake(result["answer"]),
                    "abstained": result["abstained"],
                    "retrieved_sources": result["retrieved_sources"],
                    "cited_sources": result["cited_sources"],
                    "dangling_citations": result["dangling_citations"],
                    "groundedness": result["groundedness"],
                    "verdict": result["verdict"],
                    "judge_reasoning": undo_mojibake(result.get("judge_reasoning", "")),
                    "unsupported_claims": [
                        undo_mojibake(claim) for claim in result.get("unsupported_claims", [])
                    ],
                    "must_contain_missing": result.get("must_contain_missing", []),
                    "retrieval_hit": result["retrieval_hit"],
                    "abstention_correct": result["abstention_correct"],
                    "flagged": result.get("flagged", False),
                }

    first_run = next(iter(runs.values()))
    answers = {
        "answer_model": first_run["settings"]["answer_model"],
        "judge_model": first_run["settings"]["judge_model"],
        "configs": list(configs),
        "by_question": by_question,
    }
    (out_dir / "answers.json").write_text(json.dumps(answers, ensure_ascii=False), encoding="utf-8")
    (out_dir / "runs.json").write_text(json.dumps(runs, ensure_ascii=False), encoding="utf-8")
    print("answers.json     {} questions x {} configurations".format(len(by_question), len(configs)))
    print("runs.json        {} evaluation runs".format(len(runs)))

    # --- golden fixture: what the real retriever returns ---------------------
    # The browser reimplements dense search, BM25 and RRF. This is the file that
    # decides whether that reimplementation is faithful or merely plausible.
    golden: dict[str, dict] = {}
    for mode in ("dense", "hybrid"):
        retriever = Retriever(replace(settings, retrieval_mode=mode))
        for question in questions:
            hits = retriever.search(question["question"])
            golden.setdefault(question["id"], {})[mode] = [
                {
                    "index": hit.index,
                    "chunk_id": hit.chunk_id,
                    "score": round(hit.score, 6),
                    "lexical_score": (
                        None if hit.lexical_score is None else round(hit.lexical_score, 6)
                    ),
                    "fusion_score": (
                        None if hit.fusion_score is None else round(hit.fusion_score, 6)
                    ),
                    "channel": hit.channel,
                }
                for hit in hits
            ]
    (out_dir / "golden.json").write_text(json.dumps(golden, ensure_ascii=False), encoding="utf-8")
    print("golden.json      {} questions x 2 retrieval modes".format(len(golden)))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
