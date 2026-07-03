"""Export data.db into browser-friendly static JSON files for GitHub Pages."""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data.db"
OUTPUT = ROOT / "data"

TRANSLATIONS = [
    {"id": "ESV", "label": "ESV", "name": "English Standard Version"},
    {"id": "NIV", "label": "NIV", "name": "New International Version"},
    {"id": "GAE", "label": "개역개정", "name": "Korean Revised Version"},
    {"id": "SAENEW", "label": "새번역", "name": "Korean New Translation"},
    {"id": "WLB", "label": "우리말", "name": "Woorimal Bible"},
]

KOREAN_BOOK_NAMES = [
    "창세기", "출애굽기", "레위기", "민수기", "신명기", "여호수아", "사사기", "룻기",
    "사무엘상", "사무엘하", "열왕기상", "열왕기하", "역대상", "역대하", "에스라", "느헤미야",
    "에스더", "욥기", "시편", "잠언", "전도서", "아가", "이사야", "예레미야", "예레미야애가",
    "에스겔", "다니엘", "호세아", "요엘", "아모스", "오바댜", "요나", "미가", "나훔", "하박국",
    "스바냐", "학개", "스가랴", "말라기", "마태복음", "마가복음", "누가복음", "요한복음",
    "사도행전", "로마서", "고린도전서", "고린도후서", "갈라디아서", "에베소서", "빌립보서",
    "골로새서", "데살로니가전서", "데살로니가후서", "디모데전서", "디모데후서", "디도서",
    "빌레몬서", "히브리서", "야고보서", "베드로전서", "베드로후서", "요한일서", "요한이서",
    "요한삼서", "유다서", "요한계시록",
]


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def slugify(index: int, name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"{index + 1:02d}-{normalized}"


def main() -> None:
    if not DATABASE.exists():
        raise SystemExit(f"Database not found: {DATABASE}")

    connection = sqlite3.connect(f"file:{DATABASE.as_posix()}?mode=ro", uri=True)
    connection.execute("PRAGMA query_only=ON")

    if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise SystemExit("SQLite quick_check failed")

    book_rows = connection.execute(
        """
        SELECT book_en, COUNT(DISTINCT chapter)
        FROM verses
        WHERE translation = 'ESV'
        GROUP BY book_en
        ORDER BY MIN(rowid)
        """
    ).fetchall()
    if len(book_rows) != 66 or len(KOREAN_BOOK_NAMES) != 66:
        raise SystemExit(f"Expected 66 books, found {len(book_rows)}")

    books = []
    for index, ((english_name, chapter_count), korean_name) in enumerate(
        zip(book_rows, KOREAN_BOOK_NAMES, strict=True)
    ):
        books.append(
            {
                "id": index,
                "en": english_name,
                "ko": korean_name,
                "slug": slugify(index, english_name),
                "chapters": chapter_count,
            }
        )

    expected_chapters = {
        (book["en"], chapter)
        for book in books
        for chapter in range(1, book["chapters"] + 1)
    }
    for translation in TRANSLATIONS:
        actual = set(
            connection.execute(
                "SELECT DISTINCT book_en, chapter FROM verses WHERE translation = ?",
                (translation["id"],),
            ).fetchall()
        )
        missing = sorted(expected_chapters - actual)
        extra = sorted(actual - expected_chapters)
        if missing or extra:
            raise SystemExit(
                f"Chapter mismatch for {translation['id']}: missing={missing}, extra={extra}"
            )

    translation_ids = [item["id"] for item in TRANSLATIONS]
    placeholders = ",".join("?" for _ in translation_ids)
    total_chapters = 0

    for book in books:
        for chapter in range(1, book["chapters"] + 1):
            rows = connection.execute(
                f"""
                SELECT translation, verse, text
                FROM verses
                WHERE book_en = ? AND chapter = ? AND translation IN ({placeholders})
                ORDER BY verse
                """,
                (book["en"], chapter, *translation_ids),
            ).fetchall()
            verses: dict[int, dict[str, str]] = {}
            for translation, verse, text in rows:
                verses.setdefault(verse, {})[translation] = text
            payload = {
                "b": book["id"],
                "c": chapter,
                "v": [[verse, texts] for verse, texts in sorted(verses.items())],
            }
            write_json(OUTPUT / "chapters" / book["slug"] / f"{chapter}.json", payload)
            total_chapters += 1

    book_indexes = {book["en"]: book["id"] for book in books}
    verse_counts: dict[str, int] = {}
    for translation in TRANSLATIONS:
        rows = connection.execute(
            """
            SELECT book_en, chapter, verse, text
            FROM verses
            WHERE translation = ?
            ORDER BY rowid
            """,
            (translation["id"],),
        ).fetchall()
        search_rows = [
            [book_indexes[book], chapter, verse, text]
            for book, chapter, verse, text in rows
        ]
        verse_counts[translation["id"]] = len(search_rows)
        write_json(OUTPUT / "search" / f"{translation['id']}.json", search_rows)

    manifest = {
        "version": 1,
        "translations": TRANSLATIONS,
        "books": books,
        "stats": {
            "chapters": total_chapters,
            "verses": verse_counts,
        },
    }
    write_json(OUTPUT / "manifest.json", manifest)
    connection.close()

    print(f"Exported {len(books)} books and {total_chapters} chapter files")
    for translation, count in verse_counts.items():
        print(f"  {translation}: {count:,} verses")


if __name__ == "__main__":
    main()
