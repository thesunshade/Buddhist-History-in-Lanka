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
import re

BASE        = os.path.join(os.path.dirname(__file__), "..")
CSV_PATH    = os.path.join(BASE, "BuddhismLanka.csv")
JSON_PATH   = os.path.join(BASE, "public", "data", "timeline.json")

# Web path prefix for images stored locally in public/data/images/.
# Any Media or Media Thumbnail value that is a bare filename (no leading
# "http", "/", or ".") will have this prefix prepended automatically, so
# the CSV only needs to contain the filename.
LOCAL_IMAGE_PREFIX = "data/images/"

IMAGE_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif", ".bmp", ".tiff", ".ico"
)


# ---------------------------------------------------------------------------
# Color Variable Helpers
# ---------------------------------------------------------------------------

def find_colors_file(base_dir):
    """Find the color variables file (prefers colors.yaml, then .yml, then .json)."""
    for filename in ("colors.yaml", "colors.yml", "colors.json"):
        path = os.path.join(base_dir, filename)
        if os.path.isfile(path):
            return path
    return os.path.join(base_dir, "colors.yaml")


def parse_yaml_key_values(fh):
    """
    Lightweight YAML parser for simple key-value mappings.
    Handles quoted values, unquoted hex codes (#...), comments, and empty lines
    without requiring third-party libraries.
    """
    colors = {}
    for line in fh:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue

        key, _, val = line.partition(":")
        key = key.strip().strip("\"'")
        val = val.strip()

        if val.startswith(('"', "'")):
            quote = val[0]
            end_quote = val.find(quote, 1)
            val = val[1:end_quote].strip() if end_quote != -1 else val.strip(quote).strip()
        else:
            if val.startswith("#"):
                # Value starts with '#' (unquoted hex). Strip inline comments separated by whitespace.
                parts = val.split(None, 1)
                val = parts[0]
            else:
                # Strip inline comment after whitespace + '#'
                if " #" in val or "\t#" in val:
                    val = re.split(r'\s+#', val, maxsplit=1)[0].strip()

        if key and val:
            colors[key] = val
    return colors


def load_color_variables(path):
    """
    Load color mapping from a YAML or JSON file.
    Uses PyYAML if installed; otherwise falls back to the built-in parser
    so no external dependencies are needed.
    """
    if not os.path.isfile(path):
        return {}

    if path.endswith(".json"):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception as e:
            print(f"Warning: Failed to parse JSON from {path}: {e}")
            return {}

    # Try PyYAML if installed
    try:
        import yaml
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
            if isinstance(data, dict):
                # If PyYAML treated unquoted #hex as a comment, fallback to built-in parser
                if all(v is not None for v in data.values()):
                    return {str(k).strip(): str(v).strip() for k, v in data.items() if k is not None}
    except ImportError:
        pass
    except Exception as e:
        print(f"Warning: PyYAML parse error on {path}: {e}")

    # Fallback to built-in lightweight YAML parser
    with open(path, "r", encoding="utf-8") as fh:
        return parse_yaml_key_values(fh)


def parse_background(value, color_vars=None):
    """
    Parse the Background field value into a TimelineJS background dict.

    Supports:
      - Custom variables defined in color_vars (e.g. 'monk' -> '#ef8215')
      - Hex colors with or without '#' (e.g. '#ef8215' or 'ef8215')
      - CSS color functions (rgb, rgba, hsl, hsla, etc.)
      - Named CSS colors (maroon, navy, black, etc.)
      - Image URLs and filenames (e.g. 'bg.jpg', 'https://example.com/bg.png')

    Returns:
      dict: {'color': ...} or {'url': ...}, or None if empty.
    """
    v = (value or "").strip()
    if not v:
        return None

    # Resolve color variables (supports chained lookups like monk -> saffron -> #ef8215)
    depth = 0
    while color_vars and depth < 5:
        if v in color_vars:
            v = color_vars[v].strip()
            depth += 1
        elif v.lower() in color_vars:
            v = color_vars[v.lower()].strip()
            depth += 1
        else:
            break

    lower_v = v.lower()

    # Image background check
    is_image = (
        lower_v.startswith(("http://", "https://", "//", "data:image/"))
        or any(lower_v.endswith(ext) for ext in IMAGE_EXTENSIONS)
        or ("/" in v and not lower_v.startswith(("rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color")))
        or "\\" in v
    )
    if is_image:
        return {"url": resolve_media_url(v)}

    # Hex color (normalize 3, 4, 6, 8 hex digits to start with '#')
    hex_clean = v.lstrip("#")
    if v.startswith("#") or (len(hex_clean) in (3, 4, 6, 8) and all(c in "0123456789abcdefABCDEF" for c in hex_clean)):
        color_val = v if v.startswith("#") else f"#{v}"
        return {"color": color_val}

    # Any other CSS color (rgb, rgba, hsl, hsla, named colors, etc.)
    return {"color": v}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def build_date(year, month, day, time_str=None, context=""):
    """Return a TL date object, or None if year is empty or invalid."""
    if not year:
        return None
    try:
        d = {"year": int(year.strip())}
    except (ValueError, AttributeError):
        ctx_info = f" in row '{context}'" if context else ""
        print(f"\033[31mWarning\033[0m: Invalid year value {repr(year)}{ctx_info}. Expected a numeric year.")
        return None

    if month:
        try:
            d["month"] = int(month.strip())
        except (ValueError, AttributeError):
            pass
    if day:
        try:
            d["day"] = int(day.strip())
        except (ValueError, AttributeError):
            pass
    if time_str:
        parts = time_str.split(":")
        keys = ("hour", "minute", "second")
        for key, val in zip(keys, parts):
            if val:
                try:
                    d[key] = int(val.strip())
                except (ValueError, AttributeError):
                    pass
    return d


def resolve_media_url(value):
    """
    If *value* looks like a bare filename (no protocol, no leading slash or dot),
    prepend LOCAL_IMAGE_PREFIX so the browser can find it under public/data/images/.
    Fully-qualified URLs, paths, and inline HTML (e.g. <blockquote> strings
    accepted by TimelineJS) are returned unchanged.
    """
    v = value.strip()
    if v and not v.startswith(("http://", "https://", "/", ".", "data:", "<")):
        return LOCAL_IMAGE_PREFIX + v
    return v


def build_slide(row, color_vars=None):
    """Convert one CSV row into a TL slide/event dict."""
    slide = {}
    headline = row.get("Headline", "")

    start = build_date(row.get("Year"), row.get("Month"), row.get("Day"), row.get("Time"), context=headline)
    end   = build_date(row.get("End Year"), row.get("End Month"), row.get("End Day"), row.get("End Time"), context=headline)
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
        bg_obj = parse_background(bg, color_vars=color_vars)
        if bg_obj:
            slide["background"] = bg_obj

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

    colors_file = find_colors_file(BASE)
    color_vars = load_color_variables(colors_file)
    if color_vars:
        print(f"Loaded {len(color_vars)} color variable(s) from: {colors_file}")

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
            slide = build_slide(row, color_vars=color_vars)

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
