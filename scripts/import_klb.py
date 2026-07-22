"""Import 현대인의 성경 (Korean Living Bible, 1985, 생명의말씀사) into data.db.

Source: a local SQLite cache exported from the CrossBible app (provided
directly, not downloaded by this script), which stores its own offline
verse cache in the exact same (translation, book_en, chapter, verse, text)
shape as data.db's own verses table. Point CACHE_DB at that file and run.

No bulk JSON/API exists for this translation elsewhere (checked
bolls.life, getbible.net, and public GitHub dumps), so this is the only
source used for it.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data.db"
CACHE_DB = ROOT / "crossbible-cache-1784732038.db"
TRANSLATION = "KLB"


def main() -> None:
    if not CACHE_DB.exists():
        raise SystemExit(f"Cache database not found: {CACHE_DB}")

    cache = sqlite3.connect(f"file:{CACHE_DB.as_posix()}?mode=ro", uri=True)
    rows = cache.execute(
        "SELECT translation, book_en, chapter, verse, text "
        "FROM verses WHERE translation = ? ORDER BY rowid",
        (TRANSLATION,),
    ).fetchall()
    if not rows:
        raise SystemExit(f"No {TRANSLATION} rows found in {CACHE_DB}")
    cache.close()

    connection = sqlite3.connect(DATABASE)
    expected = set(
        connection.execute(
            "SELECT book_en, chapter FROM verses WHERE translation = 'ESV'"
        ).fetchall()
    )

    chapters = {(book, chapter) for _, book, chapter, _, _ in rows}
    missing = sorted(expected - chapters)
    extra = sorted(chapters - expected)
    if missing or extra:
        raise SystemExit(f"{TRANSLATION}: chapter mismatch missing={missing[:5]} extra={extra[:5]}")
    keys = [(book, chapter, verse) for _, book, chapter, verse, _ in rows]
    if len(keys) != len(set(keys)):
        raise SystemExit(f"{TRANSLATION}: duplicate verse keys")
    empty = [key for (_, *key, text) in rows if not text or not text.strip()]
    if empty:
        raise SystemExit(f"{TRANSLATION}: {len(empty)} empty verses, e.g. {empty[:5]}")
    tagged = [key for (_, *key, text) in rows if "<" in text]
    if tagged:
        raise SystemExit(f"{TRANSLATION}: leftover markup in {tagged[:5]}")
    print(f"{TRANSLATION}: {len(rows):,} verses across {len(chapters):,} chapters OK")

    connection.execute("DELETE FROM verses WHERE translation = ?", (TRANSLATION,))
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
