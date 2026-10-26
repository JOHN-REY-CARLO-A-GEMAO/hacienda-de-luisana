#!/usr/bin/env python3
"""Part 1: Title slide (S1) + Question 1 slides (S2, S3)."""
import sys
from pathlib import Path

# The master builder supplies an absolute script directory before it changes the
# working directory. The fallback lets an individual part run from this folder.
if "HDL_QUIZ_DECK_DIR" not in globals():
    HDL_QUIZ_DECK_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HDL_QUIZ_DECK_DIR))
from quiz_deck_helpers import *

# =========================================================================== #
# Slide 1 — Title slide
# =========================================================================== #
s = add_slide()
rect(s, 0, 0, 13.333, 7.5, fill=FOREST)
rect(s, 0, 0, 13.333, 0.14, fill=GOLD)
rect(s, 0, 7.36, 13.333, 0.14, fill=GOLD)

txt(s, 0.9, 1.05, 11.5, 0.4, "TOPIC XIII \u2014 CLOUD SERVICE MODEL DESIGN QUIZ",
    size=15, color=GOLD, bold=True)
txt(s, 0.9, 1.5, 11.7, 1.7,
    [[("Essay and Drawing ", {"size": 34, "bold": True, "color": WHITE})],
     [("Based on the Approved Thesis/Capstone System", {"size": 28, "color": RGBColor(0xD8,0xE0,0xD8)})]],
    line_spacing=1.05)

txt(s, 0.9, 3.25, 11.7, 0.35, "Total: 100 points  \u2022  Suggested time: 90 minutes",
    size=13, color=GOLD)

# Candidate block
cand = rect(s, 0.9, 3.95, 7.6, 2.15, fill=RGBColor(0x2A, 0x47, 0x38),
            line=GOLD, line_w=1.2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
tf = cand.text_frame; tf.word_wrap = True
tf.margin_left = IN(0.25); tf.margin_right = IN(0.25); tf.margin_top = IN(0.18)
p = tf.paragraphs[0]; p.alignment = PP_ALIGN.LEFT
r = p.add_run(); r.text = "CANDIDATE DETAILS"
r.font.size = Pt(11); r.font.bold = True; r.font.color.rgb = GOLD
for label in ["Name:  John Rey Carlo A. Gemao",
              "Section / Group:  ______________________",
              "Approved Thesis Title:",
              "   Property Management, Smart Lock (RFID + Mobile Key / ESP32)",
              "   & Tracking System for Hacienda de LuisAna",
              "   Luisiana, Laguna, Philippines",
              "Date:  ______________________"]:
    pp = tf.add_paragraph(); pp.alignment = PP_ALIGN.LEFT; pp.space_before = Pt(5)
    rr = pp.add_run(); rr.text = label
    rr.font.size = Pt(12); rr.font.color.rgb = WHITE

txt(s, 8.85, 3.95, 3.55, 2.15,
    [[("Scope limit", {"size": 12, "bold": True, "color": GOLD})],
     [("Limited to IaaS, PaaS, SaaS. Provider names are optional;", {"size": 10.5, "color": RGBColor(0xD8,0xE0,0xD8)})],
     [("naming a provider alone does not identify its service model.", {"size": 10.5, "color": RGBColor(0xD8,0xE0,0xD8)})],
     [("SaaS = an existing provider-managed application.", {"size": 10.5, "color": RGBColor(0xD8,0xE0,0xD8)})],
     [("Hosting your own app online \u2260 SaaS.", {"size": 10.5, "color": RGBColor(0xD8,0xE0,0xD8)})]],
    line_spacing=1.1, space_after=5)

txt(s, 0.9, 6.55, 11.5, 0.5,
    "Hacienda de LuisAna \u2014 private countryside stay in Luisiana, Laguna  \u2022  "
    "Guest website (React + Vite + Firebase)  \u2022  Admin mobile app (Flutter)",
    size=10.5, color=RGBColor(0xB9, 0xC9, 0xBF))
txt(s, 0.9, 6.95, 11.5, 0.3,
    "Presented as an editable PowerPoint file, ready to upload to Google Slides.",
    size=9.5, color=RGBColor(0x9F, 0xB0, 0x9F))

# =========================================================================== #
# Slide 2 — Question 1: comparison table
# =========================================================================== #
s = add_slide()
header(s, "Question 1 \u2014 Compare the Three Cloud Service Models (20 pts)",
       "IaaS, PaaS, SaaS applied to Hacienda de LuisAna", "Q1")

tbl = make_table(s, 0.45, 1.10, 12.45, 4, 5,
                 [1.15, 3.30, 2.70, 2.70, 2.60], row_height=0.82)
hdr = ["Model", "Possible application to Hacienda de LuisAna",
       "What our team manages", "What the cloud provider manages",
       "Main advantage and limitation"]
for c, htext in enumerate(hdr):
    set_cell(tbl.cell(0, c), htext, size=10.5, bold=True, color=WHITE,
             fill=FOREST, align=PP_ALIGN.CENTER if c == 0 else PP_ALIGN.LEFT)

rows = [
    ("IaaS",
     "Rent virtual machines (asia-southeast1) and self-install the Guest website, "
     "Admin app backend, Firestore-emulated database, Realtime Database and ESP32 "
     "lock gateway; we run and patch the OS, runtime and web server ourselves.",
     "OS patching & hardening, runtime (Node/Flutter server), web server (Nginx), "
     "application code deployment, database engine & indexes, backups, monitoring, "
     "security groups, Guest/Admin identity on the VMs.",
     "Physical servers, storage, networking, virtualisation layer, hypervisor, "
     "data-centre power/cooling.",
     "Advantage: full control to match the two-role, two-app architecture and the "
     "smart-lock gateway. Limitation: we operate everything above the hardware "
     "\u2014 high ops burden for a two-person team."),
    ("PaaS",
     "Deploy the website on Firebase Hosting / Vercel and Admin app logic as "
     "Cloud Run or App Engine services; use managed Firestore, Firebase Auth and "
     "Cloud Functions (asia-southeast1) for booking submission and availability.",
     "Application code, data configuration (site_config/rates), user permissions & "
     "roles, Firestore rules, Security PIN gate, OCR settings, deployment & CI/CD.",
     "Servers, OS, runtime, scaling, patching, load balancing, underlying "
     "infrastructure and data-centre facilities.",
     "Advantage: matches the existing Firebase/Vercel stack and small team; no "
     "server ops. Limitation: less control over the ESP32 lock gateway and exact "
     "database tuning."),
    ("SaaS",
     "Subscribe to an existing property-management / booking SaaS and use its "
     "calendar, payments and guest messaging as-is, keeping the smart-lock and "
     "custom refund policy only in spreadsheets or manual processes.",
     "Subscription settings, user accounts & permissions within the SaaS, data "
     "entry, configuration of the offered features only.",
     "Entire application, database, servers, OS, runtime, updates, security and "
     "availability of the SaaS platform.",
     "Advantage: near-zero build and ops work. Limitation: the approved system "
     "(RFID/Mobile Key via ESP32, custom 50% downpayment + deposit, two-role "
     "split, Privacy Act compliance) cannot be met by a generic SaaS \u2014 so a "
     "pure SaaS choice fails the requirements."),
]
for r, row in enumerate(rows, start=1):
    fill = CREAM if r % 2 == 1 else WHITE
    set_cell(tbl.cell(r, 0), row[0], size=10, bold=True, color=FOREST, fill=fill,
             align=PP_ALIGN.CENTER)
    for c in range(1, 5):
        set_cell(tbl.cell(r, c), row[c], size=9, color=INK, fill=fill)

note_box(s, 0.45, 5.62, 12.45, 1.42,
         "Assumptions (Question 1)",
         ["\u2022  One project region: asia-southeast1 (Singapore), close to Luisiana, Laguna.",
          "\u2022  \"Provider\" means the managed cloud behind each model; no single provider is named as the answer.",
          "\u2022  The system stays the approved scope: two roles (Guest website, Admin app), booking lifecycle, payment-proof upload, smart-lock access log.",
          "\u2022  Direct ESP32 lock control is not exposed by PaaS/SaaS platforms, so it must stay under our team or a dedicated integration."])
footer(s, 2)

# =========================================================================== #
# Slide 3 — Question 1: sketches + essay focus
# =========================================================================== #
s = add_slide()
header(s, "Question 1 (cont.) \u2014 User-access sketches and requirement fit",
       "Three small labeled sketches: how users access the system under each model", "Q1")

# Sketch A — IaaS
bx, by, bw, bh = 0.45, 1.25, 4.0, 3.05
rect(s, bx, by, bw, bh, fill=CREAM, line=LINE, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, bx+0.12, by+0.10, bw-0.24, 0.3, "IaaS \u2014 we rent VMs", size=11.5,
    bold=True, color=FOREST)
# users
rect(s, bx+0.25, by+0.52, 1.15, 0.5, fill=WHITE, line=FOREST, line_w=1.2,
     shape=MSO_SHAPE.OVAL)
txt(s, bx+0.25, by+0.56, 1.15, 0.42, "Guests +\nAdmin", size=8, align=PP_ALIGN.CENTER,
    color=INK)
# internet
arrow(s, bx+1.55, by+0.77, bx+2.55, by+0.77, color=FOREST, weight=1.75)
txt(s, bx+1.62, by+0.55, 1.0, 0.28, "HTTPS", size=8.5, color=GREY, align=PP_ALIGN.CENTER)
# VM stack (provider at bottom, team on top)
rect(s, bx+2.15, by+1.20, 1.55, 1.55, fill=CLOUD, line=FOREST, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, bx+2.20, by+1.26, 1.45, 0.24, "Provider: physical", size=8,
    color=INK, align=PP_ALIGN.CENTER)
txt(s, bx+2.20, by+1.44, 1.45, 0.22, "server + hypervisor", size=8,
    color=INK, align=PP_ALIGN.CENTER)
rect(s, bx+2.15, by+2.02, 1.55, 0.62, fill=TEAM, line=FOREST, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, bx+2.20, by+2.06, 1.45, 0.22, "Team: OS,", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+2.20, by+2.22, 1.45, 0.22, "runtime, app code", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+0.10, by+2.62, bw-0.2, 0.38, "Team builds & runs the whole stack.", size=8,
    color=GREY)

# Sketch B — PaaS
bx = 4.75
rect(s, bx, by, bw, bh, fill=CREAM, line=LINE, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, bx+0.12, by+0.10, bw-0.24, 0.3, "PaaS \u2014 managed platform", size=11.5,
    bold=True, color=FOREST)
rect(s, bx+0.25, by+0.52, 1.15, 0.5, fill=WHITE, line=FOREST, line_w=1.2,
     shape=MSO_SHAPE.OVAL)
txt(s, bx+0.25, by+0.56, 1.15, 0.42, "Guests +\nAdmin", size=8, align=PP_ALIGN.CENTER,
    color=INK)
arrow(s, bx+1.55, by+0.77, bx+2.55, by+0.77, color=FOREST, weight=1.75)
txt(s, bx+1.62, by+0.55, 1.0, 0.28, "HTTPS", size=8.5, color=GREY, align=PP_ALIGN.CENTER)
rect(s, bx+2.15, by+1.20, 1.55, 1.55, fill=CLOUD, line=FOREST, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, bx+2.20, by+1.26, 1.45, 0.24, "Provider: servers,", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+2.20, by+1.44, 1.45, 0.22, "OS, runtime", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+2.20, by+1.62, 1.45, 0.22, "+ scaling", size=8, color=INK, align=PP_ALIGN.CENTER)
rect(s, bx+2.15, by+2.02, 1.55, 0.62, fill=TEAM, line=FOREST, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, bx+2.20, by+2.06, 1.45, 0.22, "Team: app code", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+2.20, by+2.22, 1.45, 0.22, "+ data config", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+0.10, by+2.62, bw-0.2, 0.38, "Team ships code; provider runs the platform.", size=8,
    color=GREY)

# Sketch C — SaaS
bx = 9.05
rect(s, bx, by, bw, bh, fill=CREAM, line=LINE, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, bx+0.12, by+0.10, bw-0.24, 0.3, "SaaS \u2014 subscribed app", size=11.5,
    bold=True, color=FOREST)
rect(s, bx+0.25, by+0.52, 1.15, 0.5, fill=WHITE, line=FOREST, line_w=1.2,
     shape=MSO_SHAPE.OVAL)
txt(s, bx+0.25, by+0.56, 1.15, 0.42, "Guests +\nAdmin", size=8, align=PP_ALIGN.CENTER,
    color=INK)
arrow(s, bx+1.55, by+0.77, bx+2.55, by+0.77, color=FOREST, weight=1.75)
txt(s, bx+1.62, by+0.55, 1.0, 0.28, "HTTPS", size=8.5, color=GREY, align=PP_ALIGN.CENTER)
rect(s, bx+2.15, by+1.20, 1.55, 1.55, fill=CLOUD, line=FOREST, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, bx+2.20, by+1.26, 1.45, 0.24, "Provider: entire", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+2.20, by+1.44, 1.45, 0.22, "application +", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+2.20, by+1.62, 1.45, 0.22, "infrastructure", size=8, color=INK,
    align=PP_ALIGN.CENTER)
rect(s, bx+2.15, by+2.02, 1.55, 0.62, fill=TEAM, line=FOREST, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, bx+2.20, by+2.06, 1.45, 0.22, "Team: settings &", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+2.20, by+2.22, 1.45, 0.22, "data entry only", size=8, color=INK,
    align=PP_ALIGN.CENTER)
txt(s, bx+0.10, by+2.62, bw-0.2, 0.38, "Generic SaaS cannot meet RFID/lock & custom payment scope.", size=8,
    color=RED)

# Essay focus block
rect(s, 0.45, 4.45, 12.45, 2.60, fill=RGBColor(0xEE, 0xF3, 0xEE),
     line=FOREST, line_w=1.0, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, 0.62, 4.56, 12.1, 0.3, "Essay focus \u2014 which requirements are easiest / hardest under each model",
    size=12, bold=True, color=FOREST)
bullet_block(s, 0.62, 4.92, 12.1, 2.05, [
    ("Easiest under IaaS:  ", "full control over the ESP32 smart-lock gateway and the two-role split "
     "(Guest website vs Admin app); we choose the OS, runtime and database engine."),
    ("Hardest under IaaS:  ", "operating everything above the hardware \u2014 patching, backups, "
     "monitoring and availability fall on our small team, which has limited ops capacity."),
    ("Easiest under PaaS:  ", "matches the existing Firebase Hosting / Vercel website and Cloud Functions "
     "stack; no server ops, built-in scaling for the booking calendar."),
    ("Hardest under PaaS:  ", "limited control over the ESP32 lock connection and exact Firestore "
     "tuning; the lock stays a separate integration we must manage."),
    ("Hardest under SaaS (a blocker):  ", "an existing property-management SaaS cannot deliver the approved "
     "custom scope \u2014 RFID/Mobile Key via ESP32, 50% downpayment + refundable deposit, two-role "
     "split, and Data Privacy Act handling of payment proofs \u2014 so pure SaaS fails the requirements."),
], size=10.5, gap=5)
footer(s, 3)

print("Part 1 done: slides 1-3")