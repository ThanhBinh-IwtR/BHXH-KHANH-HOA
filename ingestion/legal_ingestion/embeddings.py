from __future__ import annotations

import hashlib
import json
import math
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Iterator, Protocol, Sequence

from .chunking import LegalChunkRecord


DEFAULT_DIMENSIONS = 1024  # legal_chunks.embedding is vector(1024) (BAAI/bge-m3)


class EmbeddingError(RuntimeError):
    """Provider failure; the message carries the HTTP status, never credentials."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class EmbeddingProvider(Protocol):
    model: str

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


Opener = Callable[..., object]


class HuggingFaceEmbeddingProvider:
    """Feature-extraction client for the same endpoint the runtime adapter uses."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float = 60.0,
        max_attempts: int = 3,
        opener: Opener = urllib.request.urlopen,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.model = model
        self._api_key = api_key
        self._endpoint = huggingface_model_endpoint(base_url, model)
        self._timeout = timeout_seconds
        self._max_attempts = max(1, max_attempts)
        self._opener = opener
        self._sleep = sleep

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        body = json.dumps({"inputs": list(texts)}, ensure_ascii=False).encode("utf-8")
        last_error: EmbeddingError | None = None
        for attempt in range(1, self._max_attempts + 1):
            request = urllib.request.Request(
                self._endpoint,
                data=body,
                method="POST",
                headers={
                    "content-type": "application/json",
                    "authorization": f"Bearer {self._api_key}",
                },
            )
            try:
                with self._opener(request, timeout=self._timeout) as response:  # type: ignore[attr-defined]
                    payload = json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                last_error = EmbeddingError(f"Embedding HTTP {error.code}", status=error.code)
                # 401/403/404/422 are permanent; 429 and 5xx (model loading) are retried.
                if error.code != 429 and error.code < 500:
                    raise last_error from None
                retry_after = _retry_after_seconds(error.headers.get("retry-after"))
                if attempt < self._max_attempts:
                    self._sleep(retry_after if retry_after is not None else 2.0 * attempt)
                continue
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = EmbeddingError(f"Embedding network error: {type(error).__name__}")
                if attempt < self._max_attempts:
                    self._sleep(2.0 * attempt)
                continue
            vectors = parse_embedding_payload(payload, len(texts))
            if vectors is None:
                raise EmbeddingError("Embedding response shape was invalid")
            return vectors
        assert last_error is not None
        raise last_error


def huggingface_model_endpoint(base_url: str, model: str) -> str:
    normalized = base_url.rstrip("/")
    if not normalized.endswith("/hf-inference"):
        normalized = f"{normalized}/hf-inference"
    return f"{normalized}/models/{model}/pipeline/feature-extraction"


def parse_embedding_payload(payload: object, input_count: int) -> list[list[float]] | None:
    """Accept one vector per input, or token vectors that are mean-pooled."""
    if input_count == 1 and _is_vector(payload):
        return [list(payload)]  # type: ignore[arg-type]
    if not isinstance(payload, list):
        return None
    if len(payload) == input_count:
        vectors = [_pool(entry) for entry in payload]
        if all(vector is not None for vector in vectors):
            return vectors  # type: ignore[return-value]
    if input_count == 1:
        # Token vectors for a single input without a batch dimension.
        pooled = _pool(payload)
        return [pooled] if pooled is not None else None
    return None


def _pool(value: object) -> list[float] | None:
    if _is_vector(value):
        return list(value)  # type: ignore[arg-type]
    if not isinstance(value, list) or not value or not all(_is_vector(entry) for entry in value):
        return None
    dimensions = len(value[0])
    if any(len(entry) != dimensions for entry in value):
        return None
    return [sum(entry[index] for entry in value) / len(value) for index in range(dimensions)]


def _is_vector(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(isinstance(entry, (int, float)) and math.isfinite(entry) for entry in value)
    )


def _retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Resumable cache
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CachedEmbedding:
    chunk_id: str
    model: str
    text_sha256: str
    embedding: tuple[float, ...]


@dataclass(frozen=True)
class EmbeddingSummary:
    model: str
    cache_path: Path
    normative_chunks: int
    reused: int
    embedded: int


def embedding_cache_path(artifact_dir: Path, model: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", model.lower()).strip("-")
    return artifact_dir / f"embeddings-{slug}.jsonl"


def embedding_text(chunk: LegalChunkRecord) -> str:
    """Text embedded for a chunk: breadcrumb header plus body, as searched at runtime."""
    return chunk.search_text


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_embedding_cache(
    cache_path: Path, *, model: str, dimensions: int = DEFAULT_DIMENSIONS
) -> dict[str, CachedEmbedding]:
    """Last valid entry per chunk for this model; corrupt or partial lines are ignored."""
    entries: dict[str, CachedEmbedding] = {}
    if not cache_path.is_file():
        return entries
    for line in cache_path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue  # an interrupted write leaves at most one partial line
        vector = row.get("embedding")
        if row.get("model") != model or not _is_vector(vector) or len(vector) != dimensions:
            continue
        entries[row["chunk_id"]] = CachedEmbedding(
            chunk_id=row["chunk_id"],
            model=model,
            text_sha256=row.get("text_sha256", ""),
            embedding=tuple(float(value) for value in vector),
        )
    return entries


def current_embeddings(
    chunks: Iterable[LegalChunkRecord],
    cache_path: Path,
    *,
    model: str,
    dimensions: int = DEFAULT_DIMENSIONS,
) -> dict[str, tuple[float, ...]]:
    """Embeddings whose cached text hash still matches the chunk text."""
    cache = load_embedding_cache(cache_path, model=model, dimensions=dimensions)
    result: dict[str, tuple[float, ...]] = {}
    for chunk in chunks:
        entry = cache.get(chunk.chunk_id)
        if entry is not None and entry.text_sha256 == text_sha256(embedding_text(chunk)):
            result[chunk.chunk_id] = entry.embedding
    return result


def embed_chunks(
    chunks: Sequence[LegalChunkRecord],
    provider: EmbeddingProvider,
    cache_path: Path,
    *,
    batch_size: int = 16,
    dimensions: int = DEFAULT_DIMENSIONS,
    on_batch: Callable[[int, int], None] | None = None,
) -> EmbeddingSummary:
    """Embed every normative chunk that is not already cached for this model.

    Each batch is appended and flushed before the next request, so an
    interrupted run resumes from the last completed batch instead of from zero.
    Appendix/form chunks are never retrieved and are not embedded.
    """
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    normative = [chunk for chunk in chunks if chunk.chunk_type == "normative"]
    cached = current_embeddings(normative, cache_path, model=provider.model, dimensions=dimensions)
    pending = [chunk for chunk in normative if chunk.chunk_id not in cached]
    embedded = 0
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("a", encoding="utf-8", newline="\n") as cache:
        for batch in _batches(pending, batch_size):
            texts = [embedding_text(chunk) for chunk in batch]
            vectors = provider.embed(texts)
            if len(vectors) != len(batch):
                raise EmbeddingError("Embedding provider returned a different number of vectors")
            for chunk, text, vector in zip(batch, texts, vectors):
                if len(vector) != dimensions or not _is_vector(vector):
                    raise EmbeddingError(
                        f"Embedding has {len(vector)} dimensions; expected {dimensions}"
                    )
                cache.write(
                    json.dumps(
                        {
                            "chunk_id": chunk.chunk_id,
                            "model": provider.model,
                            "text_sha256": text_sha256(text),
                            "embedding": [float(value) for value in vector],
                        }
                    )
                    + "\n"
                )
            cache.flush()
            embedded += len(batch)
            if on_batch is not None:
                on_batch(embedded, len(pending))
    return EmbeddingSummary(
        model=provider.model,
        cache_path=cache_path,
        normative_chunks=len(normative),
        reused=len(cached),
        embedded=embedded,
    )


def _batches(items: Sequence[LegalChunkRecord], size: int) -> Iterator[Sequence[LegalChunkRecord]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]
