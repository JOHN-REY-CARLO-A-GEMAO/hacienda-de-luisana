#!/usr/bin/env python3
"""Generate the Topic XIII Cloud Service Model Quiz deck as a Google-Slides-compatible PPTX.

Deliverable: Gemao_JohnReyCarlo.pptx  (editable slides, tables, vector diagrams)
The deck contains: Slide 1 title + 5 content slides per question (10 slides total).
Every diagram is drawn with native PPTX shapes + connectors (editable, not images).
"""
import math
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.oxml.ns import qn
from pptx.enum.text import MSO_AUTO_SIZE

# --------------------------------------------------------------------------- #
# Theme
# --------------------------------------------------------------------------- #
FOREST   = RGBColor(0x1E, 0x3A, 0x2F)   # brand forest green
FOREST_D = RGBColor(0x14, 0x26, 0x1E)
GOLD     = RGBColor(0xD4, 0xAF, 0x37)   # brand gold
CREAM    = RGBColor(0xF7, 0xF3, 0xEA)   # slide background
INK      = RGBColor(0x21, 0x25, 0x2B)   # body text
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
CLOUD    = RGBColor(0xE3, 0xEC, 0xEE)   # cloud provider surface
TEAM     = RGBColor(0xEC, 0xF0, 0xEA)   # our-team surface
GREY     = RGBColor(0x6B, 0x72, 0x80)
LINE     = RGBColor(0xC9, 0xD2, 0xC9)
RED      = RGBColor(0xB3, 0x4A, 0x3A)
GREEN    = RGBColor(0x3A, 0x8B, 0x5C)
AMBER    = RGBColor(0xB8, 0x86, 0x0B)

EMU_IN = 914400

def IN(v): return Emu(int(v * EMU_IN))

# --------------------------------------------------------------------------- #
# Presentation setup
# --------------------------------------------------------------------------- #
prs = Presentation()
prs.slide_width  = IN(13.333)
prs.slide_height = IN(7.5)
BLANK = prs.slide_layouts[6]

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def add_slide():
    return prs.slides.add_slide(BLANK)

def rect(slide, x, y, w, h, fill=None, line=None, line_w=1.0, shadow=False,
         shape=MSO_SHAPE.RECTANGLE, rotation=0):
    sp = slide.shapes.add_shape(shape, IN(x), IN(y), IN(w), IN(h))
    sp.rotation = rotation
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid(); sp.fill.fore_color.rgb = fill
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line; sp.line.width = Pt(line_w)
    sp.shadow.inherit = False
    return sp

def txt(slide, x, y, w, h, runs, size=14, color=INK, bold=False, align=PP_ALIGN.LEFT,
        anchor=MSO_ANCHOR.TOP, line_spacing=1.0, space_after=4, wrap=True,
        shrink=False, autosize=None):
    """runs: str OR list of paragraphs; each paragraph is str OR list of (text,dict) run tuples."""
    tb = slide.shapes.add_textbox(IN(x), IN(y), IN(w), IN(h))
    tf = tb.text_frame
    tf.word_wrap = wrap
    tf.vertical_anchor = anchor
    if autosize is not None:
        tf.auto_size = autosize
    tf.margin_left = IN(0.06); tf.margin_right = IN(0.06)
    tf.margin_top = IN(0.03); tf.margin_bottom = IN(0.03)
    if isinstance(runs, str):
        runs = [runs]
    first = True
    for para in runs:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = align
        p.line_spacing = line_spacing
        p.space_after = Pt(space_after)
        if isinstance(para, str):
            para = [(para, {})]
        elif isinstance(para, tuple) and len(para) == 2 and isinstance(para[0], str) and isinstance(para[1], dict):
            para = [para]
        for text, st in para:
            r = p.add_run(); r.text = text
            f = r.font
            f.size = Pt(st.get("size", size))
            f.bold = st.get("bold", bold)
            f.italic = st.get("italic", False)
            f.name = st.get("font", "Calibri")
            f.color.rgb = st.get("color", color)
    return tb

def bullet_block(slide, x, y, w, h, items, size=13, color=INK, gap=6,
                 bullet_color=GOLD, lead_color=None, line_spacing=1.0):
    """items: list of (lead, rest) or plain str. lead is bolded."""
    tb = slide.shapes.add_textbox(IN(x), IN(y), IN(w), IN(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = IN(0.05); tf.margin_right = IN(0.05)
    tf.margin_top = IN(0.03); tf.margin_bottom = IN(0.03)
    first = True
    for item in items:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.line_spacing = line_spacing
        p.space_after = Pt(gap)
        r = p.add_run(); r.text = "\u25AA  "
        r.font.size = Pt(size); r.font.color.rgb = bullet_color; r.font.bold = True
        if isinstance(item, str):
            item = (None, item)
        lead, rest = item
        if lead:
            rl = p.add_run(); rl.text = lead
            rl.font.size = Pt(size); rl.font.bold = True
            rl.font.color.rgb = lead_color or FOREST
        rr = p.add_run(); rr.text = rest
        rr.font.size = Pt(size); rr.font.color.rgb = color
    return tb

def header(slide, kicker, title, num=None):
    rect(slide, 0, 0, 13.333, 0.16, fill=FOREST)
    txt(slide, 0.55, 0.30, 11.0, 0.30, kicker.upper(), size=11, color=GOLD, bold=True)
    txt(slide, 0.55, 0.56, 12.2, 0.62, title, size=26, color=FOREST, bold=True)
    if num:
        txt(slide, 12.35, 0.30, 0.55, 0.5, num, size=13, color=GOLD, bold=True,
            align=PP_ALIGN.RIGHT)

def footer(slide, page_no, total=10):
    rect(slide, 0, 7.22, 13.333, 0.28, fill=FOREST_D)
    txt(slide, 0.55, 7.245, 9.5, 0.22,
        "Hacienda de LuisAna  \u2022  Topic XIII \u2014 Cloud Service Model Quiz  \u2022  Cloud services used as hosting/implementation platform",
        size=8.5, color=RGBColor(0xD8, 0xE0, 0xD8))
    txt(slide, 12.35, 7.245, 0.55, 0.22, f"{page_no} / {total}",
        size=8.5, color=RGBColor(0xD8, 0xE0, 0xD8), align=PP_ALIGN.RIGHT)

def chip(slide, x, y, w, h, text, fill, text_color=WHITE, size=11, bold=True,
         line=None, shape=MSO_SHAPE.ROUNDED_RECTANGLE):
    sp = rect(slide, x, y, w, h, fill=fill, line=line, shape=shape)
    tf = sp.text_frame; tf.word_wrap = True
    tf.margin_left = IN(0.05); tf.margin_right = IN(0.05)
    tf.margin_top = IN(0.02); tf.margin_bottom = IN(0.02)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = text
    r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = text_color
    return sp

def arrow(slide, x1, y1, x2, y2, color=FOREST, weight=2.0, dash=None, head=True):
    """Straight connector with an arrowhead."""
    cn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, IN(x1), IN(y1), IN(x2), IN(y2))
    cn.line.color.rgb = color
    cn.line.width = Pt(weight)
    if dash:
        ln = cn.line._get_or_add_ln()
        d = ln.makeelement(qn('a:prstDash'), {'val': dash}); ln.append(d)
    if head:
        ln = cn.line._get_or_add_ln()
        h = ln.makeelement(qn('a:tailEnd'), {'type': 'triangle', 'w': 'med', 'len': 'med'})
        ln.append(h)
    cn.shadow.inherit = False
    return cn

def elbow(slide, pts, color=FOREST, weight=2.0, dash=None):
    """pts: list of (x,y). Draws an elbow polyline using right-angle connectors."""
    # We emulate a polyline by chaining straight connectors; simplest robust approach:
    cn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, IN(pts[0][0]), IN(pts[0][1]),
                                    IN(pts[-1][0]), IN(pts[-1][1]))
    cn.line.color.rgb = color
    cn.line.width = Pt(weight)
    if dash:
        ln = cn.line._get_or_add_ln()
        d = ln.makeelement(qn('a:prstDash'), {'val': dash}); ln.append(d)
    h = ln.makeelement(qn('a:tailEnd'), {'type': 'triangle', 'w': 'med', 'len': 'med'})
    ln.append(h)
    cn.shadow.inherit = False
    # Set adjustment values to force right-angle elbow: adj 1 = bend position
    try:
        prst = cn._element.spPr
        from pptx.oxml.ns import qn as _qn
        cust = prst.makeelement(qn('a:custGeom'), {})
        # Keep it simple: fall back to straight line if custom geom fails
    except Exception:
        pass
    return cn

def labeled_box(slide, x, y, w, h, title, body, fill, title_color=WHITE, body_color=INK,
                title_size=13, body_size=10.5, line=None, line_w=1.0, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
                body_bold=False, title_bold=True, anchor=MSO_ANCHOR.TOP, pad=0.12,
                align=PP_ALIGN.CENTER):
    sp = rect(slide, x, y, w, h, fill=fill, line=line, line_w=line_w, shape=shape)
    tf = sp.text_frame; tf.word_wrap = True
    tf.margin_left = IN(pad); tf.margin_right = IN(pad)
    tf.margin_top = IN(0.08); tf.margin_bottom = IN(0.06)
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]; p.alignment = align; p.line_spacing = 0.95
    r = p.add_run(); r.text = title
    r.font.size = Pt(title_size); r.font.bold = title_bold; r.font.color.rgb = title_color
    if body:
        p2 = tf.add_paragraph(); p2.alignment = align; p2.line_spacing = 0.95
        p2.space_before = Pt(3)
        if isinstance(body, str):
            body = [body]
        for b in body:
            rr = p2.add_run(); rr.text = b
            rr.font.size = Pt(body_size); rr.font.bold = body_bold; rr.font.color.rgb = body_color
    return sp

def note_box(slide, x, y, w, h, title, body_lines, fill=RGBColor(0xFB, 0xF3, 0xDC),
             line=AMBER, title_color=RGBColor(0x8A, 0x5A, 0x00), body_color=INK,
             title_size=11, body_size=9.5, size=None, gap=5):
    if size is not None:
        body_size = size
    sp = rect(slide, x, y, w, h, fill=fill, line=line, line_w=1.25,
              shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    tf = sp.text_frame; tf.word_wrap = True
    tf.margin_left = IN(0.12); tf.margin_right = IN(0.12)
    tf.margin_top = IN(0.08); tf.margin_bottom = IN(0.08)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.LEFT; p.line_spacing = 1.0
    r = p.add_run(); r.text = title
    r.font.size = Pt(title_size); r.font.bold = True; r.font.color.rgb = title_color
    for b in body_lines:
        p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.LEFT; p2.line_spacing = 1.0
        p2.space_after = Pt(gap)
        rr = p2.add_run(); rr.text = b
        rr.font.size = Pt(body_size); rr.font.color.rgb = body_color
    return sp

def set_cell(cell, text, size=10, bold=False, color=INK, fill=None, align=PP_ALIGN.LEFT,
             anchor=MSO_ANCHOR.MIDDLE, font="Calibri"):
    if fill is not None:
        cell.fill.solid(); cell.fill.fore_color.rgb = fill
    cell.vertical_anchor = anchor
    cell.margin_left = IN(0.08); cell.margin_right = IN(0.08)
    cell.margin_top = IN(0.04); cell.margin_bottom = IN(0.04)
    tf = cell.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; p.alignment = align
    parts = text.split("\n") if isinstance(text, str) else [text]
    first = True
    for part in parts:
        pp = p if first else tf.add_paragraph()
        first = False
        pp.alignment = align; pp.line_spacing = 0.95
        r = pp.add_run(); r.text = part
        r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = color; r.font.name = font

def make_table(slide, x, y, w, rows, cols, col_widths, row_height=0.4):
    gfx = slide.shapes.add_table(rows, cols, IN(x), IN(y), IN(w), IN(row_height * rows))
    tbl = gfx.table
    # kill banding style
    tbl.first_row = False; tbl.horz_banding = False
    for i, cw in enumerate(col_widths):
        tbl.columns[i].width = IN(cw)
    for r in range(rows):
        tbl.rows[r].height = IN(row_height)
    return tbl

def shadow_off(sp):
    try:
        sp.shadow.inherit = False
    except Exception:
        pass

print("helpers loaded")