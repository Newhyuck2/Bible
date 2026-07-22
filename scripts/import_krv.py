"""Import 개역한글 (Korean Revised Version, 1961) into data.db.

Source (bolls.life static dump):
  https://bolls.life/static/translations/KRV.json

Unlike GAE (개역개정, the 1998/2005 revision already in data.db), this is the
older 1961 revision it replaced — related but textually distinct (older verb
endings/orthography throughout). The dump is already plain verse text: no
Psalm superscriptions, no acrostic letters, no markup to strip.
"""

from __future__ import annotations

import json
import re
import sqlite3
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data.db"
CACHE = ROOT / "tmp_bibles"

KRV_URL = "https://bolls.life/static/translations/KRV.json"

# bolls book ids 1..66 in canonical order -> book_en used by the verses table.
BOOK_ORDER = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
    "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
    "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
    "Psalms", "Proverbs", "Ecclesiastes", "Song of Songs", "Isaiah",
    "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
    "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
    "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
    "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
]


def download(url: str, filename: str) -> bytes:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / filename
    if not path.exists():
        print(f"Downloading {url}")
        with urllib.request.urlopen(url) as response:
            path.write_bytes(response.read())
    return path.read_bytes()


def collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def parse_krv() -> list[tuple[str, str, int, int, str]]:
    data = json.loads(download(KRV_URL, "KRV.json").decode("utf-8-sig"))
    rows: list[tuple[str, str, int, int, str]] = []
    for row in data:
        if row["book"] > 66:
            continue
        book = BOOK_ORDER[row["book"] - 1]
        text = collapse(row["text"])
        rows.append(("KRV", book, row["chapter"], row["verse"], text))
    return rows


def validate(rows: list[tuple[str, str, int, int, str]], expected: set[tuple[str, int]]) -> None:
    translation = rows[0][0]
    chapters = {(book, chapter) for _, book, chapter, _, _ in rows}
    missing = expected - chapters
    extra = chapters - expected
    if missing or extra:
        raise SystemExit(
            f"{translation}: chapter mismatch missing={sorted(missing)[:5]} extra={sorted(extra)[:5]}"
        )
    keys = [(book, chapter, verse) for _, book, chapter, verse, _ in rows]
    if len(keys) != len(set(keys)):
        raise SystemExit(f"{translation}: duplicate verse keys")
    empty = [key for (_, *key, text) in rows if not text]
    if empty:
        raise SystemExit(f"{translation}: {len(empty)} empty verses, e.g. {empty[:5]}")
    tagged = [(book, chapter, verse) for _, book, chapter, verse, text in rows if "<" in text]
    if tagged:
        raise SystemExit(f"{translation}: leftover markup in {tagged[:5]}")
    print(f"{translation}: {len(rows):,} verses across {len(chapters):,} chapters OK")


def main() -> None:
    connection = sqlite3.connect(DATABASE)
    expected = set(
        connection.execute(
            "SELECT book_en, chapter FROM verses WHERE translation = 'ESV'"
        ).fetchall()
    )

    rows = parse_krv()
    validate(rows, expected)
    connection.execute("DELETE FROM verses WHERE translation = 'KRV'")
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
