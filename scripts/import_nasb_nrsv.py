"""Import NASB and NRSV translations into data.db.

Sources (bolls.life static dumps):
  - NASB: New American Standard Bible (1995).
    https://bolls.life/static/translations/NASB.json
  - NRSV: New Revised Standard Version, recovered from the NRSVCE dump
    (the Catholic Edition shares the NRSV text for the 66 protestant-canon
    books, with the deuterocanonical insertions removed here).
    https://bolls.life/static/translations/NRSVCE.json

Cleanup applied to match the verse-only convention of data.db:
  - NASB: Psalm superscriptions ("For the choir director. A Psalm of David.")
    and Psalm 119 acrostic letters ("Aleph.") are merged into verse text by
    bolls and are stripped; [bracketed] italic markers are unwrapped.
  - NRSV: <b>section headings</b> are dropped, <b><i>Selah</i></b> is kept as
    text, <br> poetry breaks become spaces. Catholic-canon insertions are
    removed: Daniel 13-14, the Prayer of Azariah (Daniel 3:24-90, with 91-97
    renumbered back to 24-30), and the Greek Additions to Esther (merged by
    bolls into Esther 1:1, 3:13, 5:1, 8:12 and 10:4-13). Addition D replaces
    Hebrew Esther 5:1-2 in the Catholic edition, so those two verses are
    restored from the standard NRSV text (checked against bible.oremus.org).
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

NASB_URL = "https://bolls.life/static/translations/NASB.json"
NRSVCE_URL = "https://bolls.life/static/translations/NRSVCE.json"

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

# NASB Psalm superscriptions arrive merged into verse 1 as leading sentences
# drawn from a small fixed vocabulary; sentences are consumed while they
# match. 116 psalms carry a superscription (all but the 34 orphan psalms).
TITLE_SENTENCE = re.compile(
    r"^(?:An? (?:Psalm|Song|Shiggaion|Mikhtam|Maskil|Prayer)\b"
    r"|For the choir director\b"
    r"|Maskil of\b)"
)
TITLED_PSALM_COUNT = 116

# Hebrew-text Esther 5:1-2 (standard NRSV). The Catholic edition replaces
# these two verses with Addition D, so the bolls NRSVCE dump lacks them.
NRSV_ESTHER_5_1 = (
    "On the third day Esther put on her royal robes and stood in the inner "
    "court of the king’s palace, opposite the king’s hall. The king was "
    "sitting on his royal throne inside the palace opposite the entrance to "
    "the palace."
)
NRSV_ESTHER_5_2 = (
    "As soon as the king saw Queen Esther standing in the court, she won his "
    "favor and he held out to her the golden scepter that was in his hand. "
    "Then Esther approached and touched the top of the scepter."
)


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


def strip_psalm_title(text: str, chapter: int, verse: int, stripped: list) -> str:
    if verse != 1:
        return text
    if chapter == 119:
        # Only the first stanza carries its acrostic letter in this dump.
        return text.removeprefix("Aleph. ")
    remainder = text
    found_title = False
    while True:
        match = re.match(r"(.+?\.)\s+", remainder)
        if not match or not TITLE_SENTENCE.match(match.group(1)):
            break
        remainder = remainder[match.end():]
        found_title = True
    if not found_title:
        return text
    # Psalm 18's superscription ends "...And he said," after the title
    # sentences proper.
    remainder = re.sub(r"^And he said,\s+", "", remainder)
    stripped.append(chapter)
    return remainder


def parse_nasb() -> list[tuple[str, str, int, int, str]]:
    data = json.loads(download(NASB_URL, "NASB.json").decode("utf-8-sig"))
    rows: list[tuple[str, str, int, int, str]] = []
    stripped_titles: list[int] = []
    for row in data:
        if row["book"] > 66:
            continue
        book = BOOK_ORDER[row["book"] - 1]
        # bolls marks the NASB's italic (supplied) words with brackets.
        text = collapse(html.unescape(row["text"]).replace("[", "").replace("]", ""))
        if book == "Psalms":
            text = strip_psalm_title(text, row["chapter"], row["verse"], stripped_titles)
        rows.append(("NASB", book, row["chapter"], row["verse"], text))
    if len(stripped_titles) != TITLED_PSALM_COUNT:
        raise SystemExit(
            f"NASB: stripped {len(stripped_titles)} psalm titles, expected {TITLED_PSALM_COUNT}"
        )
    return rows


def clean_nrsv_text(text: str) -> str:
    # Keep italic Selah markers as text, drop bolded section headings.
    text = re.sub(r"<b>\s*<i>([^<]*)</i>\s*</b>", r" \1 ", text)
    text = re.sub(r"<b>.*?</b>", " ", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    return collapse(html.unescape(text))


def parse_nrsv() -> list[tuple[str, str, int, int, str]]:
    data = json.loads(download(NRSVCE_URL, "NRSVCE.json").decode("utf-8-sig"))
    rows: list[tuple[str, str, int, int, str]] = []
    for row in data:
        if row["book"] > 66:
            continue
        book = BOOK_ORDER[row["book"] - 1]
        chapter, verse, text = row["chapter"], row["verse"], row["text"]

        if book == "Daniel":
            if chapter in (13, 14):
                continue  # Susanna, Bel and the Dragon
            if chapter == 3:
                if 24 <= verse <= 90:
                    continue  # Prayer of Azariah / Song of the Three Jews
                if verse >= 91:
                    verse -= 67  # Hebrew 3:24-30 sit at 91-97 in the Greek numbering
        elif book == "Esther":
            if chapter == 10 and verse >= 4:
                continue  # Addition F and postscript
            if (chapter, verse) == (1, 1):
                text = text.split("<b>END OF ADDITION A</b>")[-1]
            elif (chapter, verse) == (3, 13):
                text = text.split("<b>ADDITION B</b>")[0]
            elif (chapter, verse) == (8, 12):
                text = text.split("<b>ADDITION E</b>")[0]
            elif (chapter, verse) == (5, 1):
                # Additions C and D only; the Hebrew verses are restored below.
                rows.append(("NRSV", book, 5, 1, NRSV_ESTHER_5_1))
                rows.append(("NRSV", book, 5, 2, NRSV_ESTHER_5_2))
                continue

        rows.append(("NRSV", book, chapter, verse, clean_nrsv_text(text)))
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

    for rows in (parse_nasb(), parse_nrsv()):
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
