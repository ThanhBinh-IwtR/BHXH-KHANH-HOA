from __future__ import annotations

import os
from pathlib import Path
from typing import MutableMapping


def load_env_file(path: Path, environ: MutableMapping[str, str] | None = None) -> None:
    """Load KEY=VALUE lines from a dotenv file without overriding existing values.

    Only the syntax used by `.env.example` is supported: comments, blank lines,
    optional `export ` prefixes and single/double-quoted values.
    """
    target = os.environ if environ is None else environ
    if not path.is_file():
        raise FileNotFoundError(f"Environment file not found: {path}")
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key and key not in target:
            target[key] = value


def require_env(name: str, environ: MutableMapping[str, str] | None = None) -> str:
    """Return a non-empty setting or raise without echoing any secret value."""
    source = os.environ if environ is None else environ
    value = source.get(name, "").strip()
    if not value:
        raise KeyError(f"{name} is required but empty or missing")
    return value
