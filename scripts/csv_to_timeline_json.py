"""
Converts the TimelineJS3-format CSV into public/data/timeline.json.

This script does exactly one thing: data conversion.
HTML, CSS, and JS are static files managed separately in public/.

Usage (from the project root):
    python scripts/csv_to_timeline_json.py
"""

import csv
import json
import os

BASE        = os.path.join(os.path.dirname(__file__), "..")
CSV_PATH    = os.path.join(BASE, "BuddhismLanka.csv")
JSON_PATH   = os.path.join(BASE, "public", "data", "timeline.json")

# Web path prefix for images stored locally in public/data/images/.
# Any Media or Media Thumbnail value that is a bare filename (no leading
# "http", "/", or ".") will have this prefix prepended automatically, so
# the CSV only needs to contain the filename.
LOCAL_IMAGE_PREFIX = "data/images/"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def build_date(year, month, day, time_str=None):
    """Return a TL date object, or None if year is empty."""
    if not year:
        return None
    d = {"year": int(year)}
    if month:
        d["month"] = int(month)
    if day:
        d["day"] = int(day)
    if time_str:
        parts = time_str.split(":")
        keys = ("hour", "minute", "second")
        for key, val in zip(keys, parts):
            if val:
                d[key] = int(val)
    return d


def resolve_media_url(value):
    """
    If *value* looks like a bare filename (no protocol, no leading slash or dot),
    prepend LOCAL_IMAGE_PREFIX so the browser can find it under public/data/images/.
    Fully-qualified URLs and paths are returned unchanged.
    """
    v = value.strip()
    if v and not v.startswith(("http://", "https://", "/", ".", "data:")):
        return LOCAL_IMAGE_PREFIX + v
    return v


def build_slide(row):
    """Convert one CSV row into a TL slide/event dict."""
    slide = {}

    start = build_date(row["Year"], row["Month"], row["Day"], row["Time"])
    end   = build_date(row["End Year"], row["End Month"], row["End Day"], row["End Time"])
    if start:
        slide["start_date"] = start
    if end:
        slide["end_date"] = end
    if row.get("Display Date"):
        slide["display_date"] = row["Display Date"]

    text_obj = {}
    if row.get("Headline"):
        text_obj["headline"] = row["Headline"]
    if row.get("Text"):
        text_obj["text"] = row["Text"]
    if text_obj:
        slide["text"] = text_obj

    if row.get("Media"):
        media = {"url": resolve_media_url(row["Media"])}
        if row.get("Media Credit"):
            media["credit"] = row["Media Credit"]
        if row.get("Media Caption"):
            media["caption"] = row["Media Caption"]
        # Fall back to the main image when no thumbnail is specified.
        thumbnail = row.get("Media Thumbnail") or row.get("Media")
        media["thumbnail"] = resolve_media_url(thumbnail)
        slide["media"] = media

    if row.get("Group"):
        slide["group"] = row["Group"]

    bg = row.get("Background", "").strip()
    if bg:
        slide["background"] = {"color": bg} if bg.startswith("#") else {"url": bg}

    return slide


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def detect_delimiter(fh):
    """
    Sniff the delimiter from the first line of the file.
    Falls back to comma if Sniffer cannot determine it.
    Rewinds the file handle before returning.
    """
    sample = fh.readline()
    fh.seek(0)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t")
        return dialect.delimiter
    except csv.Error:
        return ","


def main():
    title_slide = None
    events = []

    with open(CSV_PATH, newline="", encoding="utf-8") as fh:
        delimiter = detect_delimiter(fh)
        print(f"Detected delimiter: {'TAB' if delimiter == chr(9) else repr(delimiter)}")
        for row in csv.DictReader(fh, delimiter=delimiter):
            # Skip blank rows
            if not any(row.values()):
                continue
            if not row.get("Headline") and not row.get("Year"):
                continue

            row_type = (row.get("Type") or "").strip().lower()
            slide = build_slide(row)

            if row_type == "title":
                if title_slide is None:   # keep only the first title row
                    title_slide = slide
            elif slide:
                events.append(slide)

    output = {}
    if title_slide:
        output["title"] = title_slide
    output["events"] = events

    os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)
    with open(JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(output, fh, ensure_ascii=False, indent=2)

    print(f"Done. {len(events)} event(s) written to: {JSON_PATH}")


if __name__ == "__main__":
    main()
