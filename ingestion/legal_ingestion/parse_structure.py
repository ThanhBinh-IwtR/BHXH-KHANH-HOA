from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Match, Sequence

from .models import LegalNode, NodeKind, PageText, ParseResult, ParseWarning


_CHAPTER_RE = re.compile(
    r"^Chương\s+(?P<number>[IVXLCDM]+|\d+)\b(?:\s*[.:-]?\s*(?P<title>.*))?$",
    re.IGNORECASE,
)
_SECTION_RE = re.compile(
    r"^Mục\s+(?P<number>[IVXLCDM]+|\d+)\b(?:\s*[.:-]?\s*(?P<title>.*))?$",
    re.IGNORECASE,
)
_ARTICLE_RE = re.compile(
    r"^Đi[ềê]u\s+(?P<number>\d+[A-Za-zĐđ]?)\s*[.:-]\s*(?P<title>.*)$",
    re.IGNORECASE,
)
# Fallback for an Article heading whose number was corrupted by OCR (e.g. the
# scanned "Điều 53" read as "Điều Sở"). The number is recovered by sequence.
_ARTICLE_OCR_RE = re.compile(
    r"^Đi[ềê]u\s+(?P<token>[^\s.:]{1,3})\s*[.:]\s+(?P<title>.+)$",
    re.IGNORECASE,
)
# A clause marker; OCR frequently substitutes ',' for '.' and prefixes the line
# with stray strokes ("___1,", "— 1,"). A bare "N," with no prefix is almost
# always a reference enumeration ("1, 2, 3 và 6 Điều 12 ...") and is rejected.
_CLAUSE_RE = re.compile(
    r"^(?P<prefix>[_|~«¬—–\-]+\s*[.]?\s*)?(?P<number>\d+)(?P<term>[.,])\s+(?P<title>.+)$"
)


def _is_valid_clause(match: Match[str]) -> bool:
    return match.group("term") == "." or bool(match.group("prefix"))


def _clause_number_advances(state: "_ParserState", number: str) -> bool:
    if state.clause is None or state.clause.number is None:
        return True
    try:
        return int(number) > int(state.clause.number)
    except ValueError:
        return True
_OCR_CLAUSE_ONE_RE = re.compile(
    r"^(?:LL|II|I\||\|I|L|I)\s+(?P<title>.+)$", re.IGNORECASE
)
_POINT_RE = re.compile(
    r"^(?P<number>[A-Za-zĐđ])\)\s+(?P<title>.+)$",
    re.IGNORECASE,
)
_APPENDIX_RE = re.compile(
    r"^Phụ\s+lục(?:\s+(?P<number>[IVXLCDMT]+|\d+))?(?:\s+(?P<title>.*))?$",
    re.IGNORECASE,
)
_FORM_RE = re.compile(
    r"^Mẫu\s+số\s+(?P<number>\d+[A-Za-z]?)\s*$", re.IGNORECASE
)
_INLINE_ARTICLE_RE = re.compile(
    r"Đi[ềê]u\s+\d+[A-Za-zĐđ]?\s*[.]\s+(?P<title_char>\S)",
    re.IGNORECASE,
)
_INLINE_APPENDIX_RE = re.compile(
    r"Phụ\s+lục\s+(?:[IVXLCDM]+|\d+)\s+(?P<title_char>\S)",
    re.IGNORECASE,
)
_REFERENCE_PREFIX_RE = re.compile(
    r"(?:theo|tại|của|khoản\s+\d+)\s*$", re.IGNORECASE
)


@dataclass
class _NodeDraft:
    node_id: str
    kind: NodeKind
    number: str | None
    title: str | None
    lines: list[str]
    page_from: int
    page_to: int
    parent_id: str | None

    def finish(self) -> LegalNode:
        return LegalNode(
            node_id=self.node_id,
            kind=self.kind,
            number=self.number,
            title=self.title,
            text="\n".join(self.lines),
            page_from=self.page_from,
            page_to=self.page_to,
            parent_id=self.parent_id,
        )


@dataclass
class _ParserState:
    drafts: list[_NodeDraft] = field(default_factory=list)
    warnings: list[ParseWarning] = field(default_factory=list)
    counters: dict[NodeKind, int] = field(default_factory=dict)
    chapter: _NodeDraft | None = None
    section: _NodeDraft | None = None
    article: _NodeDraft | None = None
    clause: _NodeDraft | None = None
    point: _NodeDraft | None = None
    appendix: _NodeDraft | None = None
    form: _NodeDraft | None = None
    last_article_int: int | None = None

    @property
    def current(self) -> _NodeDraft | None:
        return (
            self.point
            or self.clause
            or self.article
            or self.form
            or self.appendix
            or self.section
            or self.chapter
        )

    def add_node(
        self,
        kind: NodeKind,
        match: Match[str] | None,
        line: str,
        page_number: int,
        parent: _NodeDraft | None,
        number_override: str | None = None,
        title_override: str | None = None,
    ) -> _NodeDraft:
        occurrence = self.counters.get(kind, 0) + 1
        self.counters[kind] = occurrence
        number = (
            number_override
            if number_override is not None
            else match.group("number") if match is not None else None
        )
        if kind == "point" and number is not None:
            number = number.lower()
        if title_override is not None:
            title_value = title_override
        elif match is not None and "title" in match.groupdict():
            title_value = (match.group("title") or "").strip()
        else:
            title_value = ""
        draft = _NodeDraft(
            node_id=f"{kind}-{occurrence:04d}",
            kind=kind,
            number=number,
            title=title_value or None,
            lines=[line],
            page_from=page_number,
            page_to=page_number,
            parent_id=parent.node_id if parent is not None else None,
        )
        self.drafts.append(draft)
        self.touch_ancestors(parent, page_number)
        return draft

    def touch_ancestors(
        self, node: _NodeDraft | None, page_number: int
    ) -> None:
        while node is not None:
            node.page_to = max(node.page_to, page_number)
            node = next(
                (item for item in self.drafts if item.node_id == node.parent_id),
                None,
            )

    def append_continuation(self, line: str, page_number: int) -> None:
        current = self.current
        if current is None:
            current = self.add_node(
                "paragraph", None, line, page_number, parent=None
            )
        else:
            current.lines.append(line)
            current.page_to = max(current.page_to, page_number)
            if current.title is None and current.kind in {
                "chapter",
                "section",
                "article",
            }:
                current.title = line.strip() or None
            self.touch_ancestors(current, page_number)


def parse_pages(pages: Sequence[PageText]) -> ParseResult:
    """Parse Vietnamese legal headings with a deterministic state machine."""
    state = _ParserState()

    for page in pages:
        for line_number, raw_line in enumerate(page.text.splitlines(), start=1):
            for logical_line in _logical_lines(raw_line):
                line = logical_line.strip()
                if not line:
                    continue

                if (match := _APPENDIX_RE.match(line)) and _is_strong_appendix_heading(
                    match
                ):
                    raw_number = match.group("number") or str(
                        state.counters.get("appendix", 0) + 1
                    )
                    normalized_number = _normalize_appendix_number(raw_number)
                    state.appendix = state.add_node(
                        "appendix",
                        match,
                        line,
                        page.page_number,
                        parent=None,
                        number_override=f"phu-luc-{normalized_number}",
                        title_override=line,
                    )
                    state.form = None
                    state.chapter = state.section = state.article = None
                    state.clause = state.point = None
                    continue

                if state.appendix is not None and (match := _FORM_RE.match(line)):
                    form_number = f"mau-{match.group('number').lower()}"
                    if state.form is not None and state.form.number == form_number:
                        state.form.page_to = max(state.form.page_to, page.page_number)
                        state.touch_ancestors(state.form, page.page_number)
                        continue
                    state.form = state.add_node(
                        "appendix",
                        match,
                        line,
                        page.page_number,
                        parent=state.appendix,
                        number_override=form_number,
                        title_override=line,
                    )
                    state.article = state.clause = state.point = None
                    continue

                # Chapter/section headings are meaningful only in the main body.
                # Form templates often contain these words as labels, and running
                # text often cites "Chương V Luật ..." — a real heading has no
                # title on its line or an all-uppercase title, never a sentence.
                if (
                    state.appendix is None
                    and (match := _CHAPTER_RE.match(line))
                    and _is_strong_heading(match)
                ):
                    state.chapter = state.add_node(
                        "chapter", match, line, page.page_number, parent=None
                    )
                    state.section = state.article = state.clause = state.point = None
                    continue

                if (
                    state.appendix is None
                    and (match := _SECTION_RE.match(line))
                    and _is_strong_heading(match)
                ):
                    state.section = state.add_node(
                        "section", match, line, page.page_number, parent=state.chapter
                    )
                    state.article = state.clause = state.point = None
                    continue

                if match := _ARTICLE_RE.match(line):
                    parent = (
                        (state.form or state.appendix)
                        if state.appendix is not None
                        else (state.section or state.chapter)
                    )
                    state.article = state.add_node(
                        "article", match, line, page.page_number, parent=parent
                    )
                    state.clause = state.point = None
                    state.last_article_int = _leading_int(match.group("number"))
                    continue

                # Recover an Article heading whose number OCR corrupted, using the
                # strict sequential numbering that legal articles guarantee.
                if (
                    state.appendix is None
                    and state.last_article_int is not None
                    and (ocr_match := _ARTICLE_OCR_RE.match(line))
                    and not ocr_match.group("token")[0].isdigit()
                    and _looks_like_article_title(ocr_match.group("title"))
                ):
                    inferred = str(state.last_article_int + 1)
                    state.article = state.add_node(
                        "article",
                        ocr_match,
                        line,
                        page.page_number,
                        parent=state.section or state.chapter,
                        number_override=inferred,
                        title_override=ocr_match.group("title").strip(),
                    )
                    state.clause = state.point = None
                    state.last_article_int += 1
                    continue

                if (
                    state.article is not None
                    and state.clause is None
                    and (match := _OCR_CLAUSE_ONE_RE.match(line))
                ):
                    state.clause = state.add_node(
                        "clause",
                        match,
                        line,
                        page.page_number,
                        parent=state.article,
                        number_override="1",
                    )
                    state.point = None
                    continue

                if (match := _CLAUSE_RE.match(line)) and _is_valid_clause(match):
                    if state.article is None:
                        if state.appendix is not None:
                            state.append_continuation(line, page.page_number)
                            continue
                        _add_orphan_warning(
                            state,
                            "orphan_clause",
                            "Clause found outside an Article",
                            page,
                            line_number,
                            line,
                        )
                        state.append_continuation(line, page.page_number)
                        continue
                    # Clause numbers increase monotonically within an Article. A
                    # detected number that does not advance is a wrapped reference
                    # ("... các khoản 1, 2 và 5. Điều 12 ...") mis-read by OCR.
                    if not _clause_number_advances(state, match.group("number")):
                        state.append_continuation(line, page.page_number)
                        continue
                    state.clause = state.add_node(
                        "clause", match, line, page.page_number, parent=state.article
                    )
                    state.point = None
                    continue

                if match := _POINT_RE.match(line):
                    if state.clause is None:
                        if state.appendix is not None:
                            state.append_continuation(line, page.page_number)
                            continue
                        _add_orphan_warning(
                            state,
                            "orphan_point",
                            "Point found outside a Clause",
                            page,
                            line_number,
                            line,
                        )
                        state.append_continuation(line, page.page_number)
                        continue
                    state.point = state.add_node(
                        "point", match, line, page.page_number, parent=state.clause
                    )
                    continue

                state.append_continuation(line, page.page_number)

    return ParseResult(
        nodes=tuple(draft.finish() for draft in state.drafts),
        warnings=tuple(state.warnings),
    )


def _logical_lines(raw_line: str) -> list[str]:
    split_offsets: set[int] = set()
    for match in _INLINE_ARTICLE_RE.finditer(raw_line):
        if match.start() == 0 or not match.group("title_char").isupper():
            continue
        prefix = raw_line[: match.start()].rstrip()
        if _REFERENCE_PREFIX_RE.search(prefix):
            continue
        split_offsets.add(match.start())
    for match in _INLINE_APPENDIX_RE.finditer(raw_line):
        if match.start() == 0 or not match.group("title_char").isupper():
            continue
        split_offsets.add(match.start())

    parts: list[str] = []
    start = 0
    for offset in sorted(split_offsets):
        parts.append(raw_line[start:offset].rstrip())
        start = offset
    parts.append(raw_line[start:])
    split_headings = "\n".join(part for part in parts if part.strip())
    return split_headings.splitlines()


def _leading_int(number: str) -> int | None:
    digits = re.match(r"\d+", number)
    return int(digits.group()) if digits else None


def _looks_like_article_title(title: str) -> bool:
    """Guard the OCR Article-number recovery against sentences and references."""
    stripped = title.strip()
    if len(stripped) < 6:
        return False
    first_alpha = next((char for char in stripped if char.isalpha()), "")
    return bool(first_alpha) and first_alpha.isupper()


def _is_strong_heading(match: Match[str]) -> bool:
    """A real Chương/Mục/Phụ lục heading has an empty or all-uppercase title.

    Running text frequently cites structures of *other* laws at the start of a
    line (e.g. "Chương V Luật Bảo hiểm xã hội số 41/2024/QH15."); those carry a
    mixed-case sentence as the title and must not open a new structural node.
    """
    title = (match.group("title") or "").strip()
    if not title:
        return True
    letters = [character for character in title if character.isalpha()]
    return bool(letters) and all(character.isupper() for character in letters)


# Backwards-compatible alias.
_is_strong_appendix_heading = _is_strong_heading


def _normalize_appendix_number(raw_number: str) -> str:
    normalized = raw_number.lower()
    if "t" in normalized and all(character in "ivxlcdmt" for character in normalized):
        normalized = normalized.replace("t", "i")
    return normalized


def _add_orphan_warning(
    state: _ParserState,
    code: str,
    message: str,
    page: PageText,
    line_number: int,
    line: str,
) -> None:
    state.warnings.append(
        ParseWarning(
            code=code,
            message=message,
            page_number=page.page_number,
            line_number=line_number,
            line=line,
        )
    )
