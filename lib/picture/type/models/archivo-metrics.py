# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools>=4.50", "uharfbuzz>=0.40"]
# ///
"""Writes archivo-metrics.ts: the bundled Archivo's advances and kerning at its masters, so glyph-layout.ts can place a
line of glyphs, each at its own weight and width, without measuring the DOM.

    uv run lib/picture/type/models/archivo-metrics.py

Run it again after changing lib/picture/type/studio/Archivo.ttf or CHARS. It checks its own table against fontTools (exact
advances) and HarfBuzz (the kerning a browser applies) at random axis values, and refuses to write if they disagree.

Why masters are enough: a variable font's value at any location is its default plus each variation region's delta
times a scalar that is linear on each axis between the region's start, peak and end. Between neighbouring
breakpoints every value is bilinear in the normalised coordinates, so the table stores each axis's breakpoints
(`stops`) and the font's avar (user values to normalised ones), and bilinear interpolation reproduces the font.
"""

import json
import random
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.models import normalizeValue, piecewiseLinearMap

HERE = Path(__file__).resolve().parent
FONT = HERE.parent.parent / "studio" / "fonts" / "Archivo.ttf"
OUT = HERE / "archivo-metrics.ts"
AXES = ("wght", "wdth")

# What a reel sets in display type: printable ASCII, then typographic marks, currency and arrows.
CHARS = [chr(c) for c in range(0x20, 0x7F)] + list("•·—–×÷±°’‘“”…€£¥¢©®™№→←↑↓")

# Glyphs are drawn one per element, so nothing ligates or changes form: shape pairs the same way.
NO_SUBSTITUTION = {tag: False for tag in ("liga", "clig", "calt", "rlig", "rclt", "ccmp", "locl")}


def main():
    font = TTFont(FONT)
    cmap = font.getBestCmap()
    missing = [c for c in CHARS if ord(c) not in cmap]
    if missing:
        sys.exit(f"Archivo has no glyph for {missing!r}: take them out of CHARS")
    fvar = {a.axisTag: a for a in font["fvar"].axes}
    if set(fvar) != set(AXES):
        sys.exit(f"expected axes {AXES}, the font has {sorted(fvar)}")
    avar = font["avar"].segments if "avar" in font else {}
    stops = {tag: region_breakpoints(font, AXES.index(tag)) for tag in AXES}
    grid = [(w, d) for w in stops["wght"] for d in stops["wdth"]]

    advance = {c: [glyph_width(font, cmap[ord(c)], {"wght": w, "wdth": d}) for w, d in grid] for c in CHARS}
    shaper = Shaper(font, fvar, avar)
    kern = {}
    for w, d in grid:
        shaper.set({"wght": w, "wdth": d})
        for a in CHARS:
            for b in CHARS:
                kern.setdefault(a + b, []).append(shaper.kern(a, b))
    kern = {pair: values for pair, values in kern.items() if any(abs(v) > 1e-9 for v in values)}

    table = {
        "unitsPerEm": font["head"].unitsPerEm,
        "capHeight": font["OS/2"].sCapHeight,
        "ascender": font["hhea"].ascent,
        "descender": font["hhea"].descent,
        "axes": {
            tag: {
                "min": fvar[tag].minValue,
                "default": fvar[tag].defaultValue,
                "max": fvar[tag].maxValue,
                "avar": [[k, v] for k, v in sorted(avar.get(tag, {-1.0: -1.0, 0.0: 0.0, 1.0: 1.0}).items())],
                "stops": stops[tag],
            }
            for tag in AXES
        },
        "advance": {c: [clean(v) for v in values] for c, values in advance.items()},
        "kern": {pair: [clean(v) for v in values] for pair, values in sorted(kern.items())},
    }
    # Checked as it will be written: values rounded, the avar map exact (F2Dot14 values print in full).
    check(font, cmap, table, shaper)
    OUT.write_text(render_ts(table))
    print(f"wrote {OUT.relative_to(HERE.parent.parent.parent)}: {len(CHARS)} characters, {len(kern)} kerning pairs, "
          f"{len(grid)} masters")


def region_breakpoints(font, axis_index):
    """Every normalised coordinate where a variation region of the advances (HVAR) or kerning (GDEF) starts, peaks or
    ends on this axis."""
    points = {-1.0, 0.0, 1.0}
    stores = [font["HVAR"].table.VarStore]
    gdef = font["GDEF"].table
    if getattr(gdef, "VarStore", None):
        stores.append(gdef.VarStore)
    for store in stores:
        for region in store.VarRegionList.Region:
            ax = region.VarRegionAxis[axis_index]
            points.update((ax.StartCoord, ax.PeakCoord, ax.EndCoord))
    return sorted(points)


def glyph_width(font, glyph, normalised):
    # fontTools applies HVAR without rounding, which is what the browser's layout sees at a fractional size.
    return font.getGlyphSet(location=normalised, normalized=True)[glyph].width


class Shaper:
    """HarfBuzz at one location, for kerning: GPOS pair adjustments, with their variation deltas unrounded."""

    def __init__(self, font, fvar, avar):
        self.fvar, self.avar = fvar, avar
        upem = font["head"].unitsPerEm
        self.hb = hb.Font(hb.Face(hb.Blob.from_file_path(str(FONT))))
        self.hb.scale = (upem * 64, upem * 64)

    def set(self, normalised):
        self.hb.set_variations({tag: self.user(tag, v) for tag, v in normalised.items()})

    def set_user(self, user):
        self.hb.set_variations(user)

    def user(self, tag, normalised):
        """The user value HarfBuzz takes for a normalised coordinate: avar inverted, then fvar's range."""
        inverse = {v: k for k, v in self.avar.get(tag, {}).items()}
        n = piecewiseLinearMap(normalised, inverse) if inverse else normalised
        a = self.fvar[tag]
        return a.defaultValue + n * ((a.defaultValue - a.minValue) if n < 0 else (a.maxValue - a.defaultValue))

    def placements(self, text, kern):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf, {**NO_SUBSTITUTION, "kern": kern})
        if len(buf.glyph_infos) != len(text):
            raise ValueError(f"{text!r} didn't shape to one glyph per character")
        return buf.glyph_positions

    def kern(self, a, b):
        """How far kerning moves b's origin from where a's advance alone puts it, in font units."""
        on, off = self.placements(a + b, True), self.placements(a + b, False)
        rel = lambda p: p[0].x_advance + p[1].x_offset - p[0].x_offset
        return (rel(on) - rel(off)) / 64

    def advances(self, text, kern=True):
        return [p.x_advance / 64 for p in self.placements(text, kern)]


def normalise(table, tag, user):
    """User value to the table's normalised coordinate, as glyph-layout.ts does it."""
    axis = table["axes"][tag]
    n = normalizeValue(user, (axis["min"], axis["default"], axis["max"]))
    return piecewiseLinearMap(n, dict(axis["avar"]))


def interpolate(table, values, user):
    """Bilinear in normalised coordinates between the stops either side, as glyph-layout.ts does it."""
    cells = []
    for tag in AXES:
        stops, n = table["axes"][tag]["stops"], normalise(table, tag, user[tag])
        i = max(0, min(len(stops) - 2, next((j for j in range(len(stops) - 1) if n <= stops[j + 1]), len(stops) - 2)))
        cells.append((i, (n - stops[i]) / (stops[i + 1] - stops[i])))
    (wi, wf), (di, df) = cells
    cols = len(table["axes"]["wdth"]["stops"])
    at = lambda w, d: values[w * cols + d]
    return ((1 - wf) * ((1 - df) * at(wi, di) + df * at(wi, di + 1))
            + wf * ((1 - df) * at(wi + 1, di) + df * at(wi + 1, di + 1)))


def check(font, cmap, table, shaper):
    """The table against the font at random locations: advances exactly (fontTools), kerning to HarfBuzz's 1/64."""
    rng = random.Random(7)
    worst_advance = worst_kern = 0.0
    pairs = list(table["kern"])
    for _ in range(60):
        user = {tag: rng.uniform(table["axes"][tag]["min"], table["axes"][tag]["max"]) for tag in AXES}
        gs = font.getGlyphSet(location=user)
        for c in CHARS:
            worst_advance = max(worst_advance, abs(interpolate(table, table["advance"][c], user) - gs[cmap[ord(c)]].width))
        shaper.set_user(user)
        for pair in rng.sample(pairs, 80):
            worst_kern = max(worst_kern, abs(interpolate(table, table["kern"][pair], user) - shaper.kern(*pair)))
        # A pair the table leaves out must not kern anywhere.
        a, b = rng.choice(CHARS), rng.choice(CHARS)
        if a + b not in table["kern"] and abs(shaper.kern(a, b)) > 1e-9:
            sys.exit(f"{a + b!r} kerns at {user} but not at any master")
    print(f"checked: advances within {worst_advance:.2g} units of fontTools, kerning within {worst_kern:.2g} of HarfBuzz")
    if worst_advance > 0.01 or worst_kern > 0.05:
        sys.exit("the table doesn't reproduce the font: its variation model isn't what this script assumes")


def clean(v):
    r = round(v, 3)
    return int(r) if r == int(r) else r


def exact(v):
    return str(int(v)) if v == int(v) else repr(v)


def render_ts(table):
    axes = table["axes"]
    lines = [
        "// archivo-metrics.ts: GENERATED by archivo-metrics.py from lib/picture/type/studio/Archivo.ttf. Don't edit it: change the",
        "// script's CHARS or the font, then `uv run lib/picture/type/models/archivo-metrics.py`.",
        "//",
        "// Archivo's advance for each character and kerning for each pair that has any, in font units, at every combination",
        "// of the axes' `stops` (weight-major). Stops are normalised coordinates where the font's variation regions break,",
        "// so values between them are bilinear and glyph-layout.ts interpolates them exactly; `avar` maps fvar-normalised",
        "// weight onto them (Archivo's weight is not linear in its axis).",
        "",
        "import type { VariableFontMetrics } from './glyph-layout.ts';",
        "",
        "export const ARCHIVO_METRICS: VariableFontMetrics = {",
        f"  unitsPerEm: {table['unitsPerEm']},",
        f"  capHeight: {table['capHeight']},",
        f"  ascender: {table['ascender']},",
        f"  descender: {table['descender']},",
        "  axes: {",
    ]
    for tag, a in axes.items():
        avar = ", ".join(f"[{exact(k)}, {exact(v)}]" for k, v in a["avar"])
        stops = ", ".join(exact(s) for s in a["stops"])
        lines.append(f"    {tag}: {{ min: {clean(a['min'])}, default: {clean(a['default'])}, max: {clean(a['max'])}, "
                     f"avar: [{avar}], stops: [{stops}] }},")
    lines.append("  },")
    for name in ("advance", "kern"):
        lines.append(f"  {name}: {{")
        for key, values in table[name].items():
            lines.append(f"    {json.dumps(key, ensure_ascii=False)}: [{', '.join(str(v) for v in values)}],")
        lines.append("  },")
    lines.append("};")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
