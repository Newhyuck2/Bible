"""Import KJV and CNV translations into data.db.

Sources:
  - KJV: open-bibles OSIS XML (1769 Blayney text; preserves LORD/GOD small-caps
    forms and canonical KJV versification).
    https://raw.githubusercontent.com/seven1m/open-bibles/master/eng-kjv.osis.xml
  - CNV: Chinese New Version, Simplified (新译本) from the getBible API v2
    (clean verse text without embedded section headings; keeps the reverence
    space before 神).
    https://api.getbible.net/v2/cns.json

Psalm superscriptions and acrostic titles are omitted from KJV verse text to
match the verse-only convention of the translations already in data.db.
"""

from __future__ import annotations

import html
import json
import re
import sqlite3
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data.db"
CACHE = ROOT / "tmp_bibles"

KJV_URL = "https://raw.githubusercontent.com/seven1m/open-bibles/master/eng-kjv.osis.xml"
CNV_URL = "https://api.getbible.net/v2/cns.json"

# OSIS book code -> book_en used by the verses table (order = canonical order).
OSIS_BOOKS = [
    ("Gen", "Genesis"), ("Exod", "Exodus"), ("Lev", "Leviticus"),
    ("Num", "Numbers"), ("Deut", "Deuteronomy"), ("Josh", "Joshua"),
    ("Judg", "Judges"), ("Ruth", "Ruth"), ("1Sam", "1 Samuel"),
    ("2Sam", "2 Samuel"), ("1Kgs", "1 Kings"), ("2Kgs", "2 Kings"),
    ("1Chr", "1 Chronicles"), ("2Chr", "2 Chronicles"), ("Ezra", "Ezra"),
    ("Neh", "Nehemiah"), ("Esth", "Esther"), ("Job", "Job"),
    ("Ps", "Psalms"), ("Prov", "Proverbs"), ("Eccl", "Ecclesiastes"),
    ("Song", "Song of Songs"), ("Isa", "Isaiah"), ("Jer", "Jeremiah"),
    ("Lam", "Lamentations"), ("Ezek", "Ezekiel"), ("Dan", "Daniel"),
    ("Hos", "Hosea"), ("Joel", "Joel"), ("Amos", "Amos"),
    ("Obad", "Obadiah"), ("Jonah", "Jonah"), ("Mic", "Micah"),
    ("Nah", "Nahum"), ("Hab", "Habakkuk"), ("Zeph", "Zephaniah"),
    ("Hag", "Haggai"), ("Zech", "Zechariah"), ("Mal", "Malachi"),
    ("Matt", "Matthew"), ("Mark", "Mark"), ("Luke", "Luke"),
    ("John", "John"), ("Acts", "Acts"), ("Rom", "Romans"),
    ("1Cor", "1 Corinthians"), ("2Cor", "2 Corinthians"), ("Gal", "Galatians"),
    ("Eph", "Ephesians"), ("Phil", "Philippians"), ("Col", "Colossians"),
    ("1Thess", "1 Thessalonians"), ("2Thess", "2 Thessalonians"),
    ("1Tim", "1 Timothy"), ("2Tim", "2 Timothy"), ("Titus", "Titus"),
    ("Phlm", "Philemon"), ("Heb", "Hebrews"), ("Jas", "James"),
    ("1Pet", "1 Peter"), ("2Pet", "2 Peter"), ("1John", "1 John"),
    ("2John", "2 John"), ("3John", "3 John"), ("Jude", "Jude"),
    ("Rev", "Revelation"),
]
OSIS_TO_NAME = dict(OSIS_BOOKS)
BOOK_ORDER = [name for _, name in OSIS_BOOKS]


def download(url: str, filename: str) -> bytes:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / filename
    if not path.exists():
        print(f"Downloading {url}")
        with urllib.request.urlopen(url) as response:
            path.write_bytes(response.read())
    return path.read_bytes()


def parse_kjv() -> list[tuple[str, str, int, int, str]]:
    xml = download(KJV_URL, "eng-kjv.osis.xml").decode("utf-8")
    # Drop footnotes and (canonical or not) titles entirely.
    xml = re.sub(r"<note\b[^>]*>.*?</note>", " ", xml, flags=re.DOTALL)
    xml = re.sub(r"<title\b[^>]*>.*?</title>", " ", xml, flags=re.DOTALL)

    rows: list[tuple[str, str, int, int, str]] = []
    pattern = re.compile(
        r'<verse osisID="([^"]+)" sID="[^"]*"[^>]*/>(.*?)<verse eID=', re.DOTALL
    )
    for osis_id, body in pattern.findall(xml):
        # A milestone can carry several IDs for linked verses; none occur in
        # this file, but fail loudly if that ever changes.
        if " " in osis_id:
            raise SystemExit(f"Linked verses not supported: {osis_id}")
        book_code, chapter, verse = osis_id.rsplit(".", 2)
        book = OSIS_TO_NAME.get(book_code)
        if book is None:  # apocrypha or unexpected book
            continue
        text = html.unescape(re.sub(r"<[^>]+>", " ", body))
        text = re.sub(r"\s+", " ", text).strip()
        rows.append(("KJV", book, int(chapter), int(verse), text))
    return rows


def parse_cnv() -> list[tuple[str, str, int, int, str]]:
    data = json.loads(download(CNV_URL, "cns.json").decode("utf-8-sig"))
    books = data["books"]
    if len(books) != 66:
        raise SystemExit(f"CNV: expected 66 books, found {len(books)}")

    rows: list[tuple[str, str, int, int, str]] = []
    for index, book in enumerate(books):
        name = BOOK_ORDER[index]
        for chapter in book["chapters"]:
            for verse in chapter["verses"]:
                text = verse["text"].replace("﻿", "")
                # Trim ASCII whitespace only: a leading U+3000 is the
                # traditional reverence space before 神 and must survive.
                text = re.sub(r"\s+", " ", text.replace("　", "\x00"))
                text = text.replace("\x00", "　").strip(" ")
                rows.append(("CNV", name, chapter["chapter"], verse["verse"], text))
    return rows


def validate(rows: list[tuple[str, str, int, int, str]], expected: set[tuple[str, int]]) -> None:
    translation = rows[0][0]
    chapters = {(book, chapter) for _, book, chapter, _, _ in rows}
    missing = expected - chapters
    extra = chapters - expected
    if missing or extra:
        raise SystemExit(f"{translation}: chapter mismatch missing={sorted(missing)[:5]} extra={sorted(extra)[:5]}")
    keys = [(book, chapter, verse) for _, book, chapter, verse, _ in rows]
    if len(keys) != len(set(keys)):
        raise SystemExit(f"{translation}: duplicate verse keys")
    empty = [key for (_, *key, text) in rows if not text]
    if empty:
        raise SystemExit(f"{translation}: {len(empty)} empty verses, e.g. {empty[:5]}")
    print(f"{translation}: {len(rows):,} verses across {len(chapters):,} chapters OK")


def main() -> None:
    connection = sqlite3.connect(DATABASE)
    expected = set(
        connection.execute(
            "SELECT book_en, chapter FROM verses WHERE translation = 'ESV'"
        ).fetchall()
    )

    for rows in (parse_kjv(), parse_cnv()):
        validate(rows, expected)
        translation = rows[0][0]
        connection.execute("DELETE FROM verses WHERE translation = ?", (translation,))
        connection.executemany(
            "INSERT INTO verses (translation, book_en, chapter, verse, text) VALUES (?, ?, ?, ?, ?)",
            rows,
        )

    connection.commit()
    for translation, count in connection.execute(
        "SELECT translation, COUNT(*) FROM verses GROUP BY translation ORDER BY translation"
    ):
        print(f"  {translation}: {count:,}")
    connection.close()


if __name__ == "__main__":
    main()
