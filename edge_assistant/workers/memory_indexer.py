"""One-shot personal memory indexing script for Qdrant."""

from __future__ import annotations

import argparse
import time
import uuid
from pathlib import Path
from typing import Iterable

from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, PointStruct, VectorParams
from sentence_transformers import SentenceTransformer

QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
COLLECTION = "shreyansh_memory"
EMBED_MODEL = "all-MiniLM-L6-v2"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 100
MIN_CHUNK_LEN = 50
ALLOWED_SUFFIXES = {".txt", ".md", ".py", ".json"}


def _log(message: str) -> None:
    print(f"[MEMORY] {message}", flush=True)


def _iter_files(folders: list[str]) -> Iterable[Path]:
    for folder in folders:
        root = Path(folder)
        if not root.exists():
            _log(f"skip missing folder: {folder}")
            continue
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.lower() in ALLOWED_SUFFIXES:
                yield path


def _chunk_text(text: str) -> list[str]:
    cleaned = text.strip()
    if len(cleaned) < MIN_CHUNK_LEN:
        return []

    step = max(CHUNK_SIZE - CHUNK_OVERLAP, 1)
    chunks: list[str] = []
    for start in range(0, len(cleaned), step):
        chunk = cleaned[start : start + CHUNK_SIZE]
        if len(chunk.strip()) >= MIN_CHUNK_LEN:
            chunks.append(chunk)
        if start + CHUNK_SIZE >= len(cleaned):
            break
    return chunks


def _ensure_collection(client: QdrantClient) -> None:
    collections = {item.name for item in client.get_collections().collections}
    if COLLECTION in collections:
        return
    client.create_collection(
        collection_name=COLLECTION,
        vectors_config=VectorParams(size=384, distance=Distance.COSINE),
    )
    _log(f"created collection: {COLLECTION}")


def _resolve_type_for_path(path: Path, folders: list[str], types: list[str]) -> str:
    for idx, folder in enumerate(folders):
        root = Path(folder)
        try:
            path.relative_to(root)
            if idx < len(types):
                return types[idx]
            break
        except Exception:
            continue
    return "general"


def run(folders: list[str], types: list[str]) -> None:
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    _ensure_collection(client)

    embedder = SentenceTransformer(EMBED_MODEL)

    for filepath in _iter_files(folders):
        try:
            text = filepath.read_text(encoding="utf-8", errors="ignore")
            chunks = _chunk_text(text)
            if not chunks:
                continue

            vectors = embedder.encode(chunks)
            source_type = _resolve_type_for_path(filepath, folders, types)
            indexed_at = time.time()

            points: list[PointStruct] = []
            for chunk, vector in zip(chunks, vectors):
                points.append(
                    PointStruct(
                        id=str(uuid.uuid4()),
                        vector=vector.tolist(),
                        payload={
                            "text": chunk,
                            "source": str(filepath),
                            "type": source_type,
                            "indexed_at": indexed_at,
                        },
                    )
                )

            client.upsert(collection_name=COLLECTION, points=points)
            _log(f"Indexed {len(chunks)} chunks from {filepath}")
        except Exception as exc:
            _log(f"failed indexing {filepath}: {exc}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Index personal files into Qdrant")
    parser.add_argument("--folders", nargs="+", required=True, help="Folder paths to scan")
    parser.add_argument("--types", nargs="*", default=[], help="Optional source types aligned by folder order")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(args.folders, args.types)
