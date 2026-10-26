#!/usr/bin/env python3
"""Part 5: Question 5 slides (S9 recovery flowchart + RPO/RTO)."""
import sys
from pathlib import Path

# The master builder supplies an absolute script directory before it changes the
# working directory. The fallback lets an individual part run from this folder.
if "HDL_QUIZ_DECK_DIR" not in globals():
    HDL_QUIZ_DECK_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HDL_QUIZ_DECK_DIR))
from quiz_deck_helpers import *

# =========================================================================== #
# Slide 9 — Question 5: disruption defence + recovery flowchart
# =========================================================================== #
s = add_slide()
header(s, "Question 5 \u2014 Defend the Design During a Cloud Disruption (20 pts)",
       "Recovery flowchart: detection \u2192 impact \u2192 response \u2192 recovery \u2192 validation \u2192 resumption", "Q5")

txt(s, 0.45, 1.18, 12.45, 0.42,
    "Scenario: the PaaS backend (Firestore / Cloud Functions) becomes unavailable during an important transaction "
    "(a Guest booking submission or an Admin payment verification). Selected model: PaaS.",
    size=10.5, color=GREY, line_spacing=1.0)

# ---- Recovery flowchart ----
boxes = [
    ("1. DETECT", "Monitoring/alerting on function errors &\nbooking-submission failures (team-configured)",
     FOREST),
    ("2. IMPACT ASSESSMENT", "Identify affected users & functions:\nGuests booking/paying; Admin verifying payments &\napproving bookings. Pending holds at risk.",
     AMBER),
    ("3. TEAM / PROVIDER RESPONSE", "Team: verify own code & config, switch to\nfallback communication, log the incident.\nProvider (PaaS): restore platform per SLA; we verify.",
     FOREST),
    ("4. RECOVERY", "Restore from managed Firestore backup to the\nRPO target; replay incomplete transactions; re-issue\nholds where dates were released.",
     FOREST),
    ("5. VALIDATION", "Confirm booking statuses, payment proofs &\naccess logs reconcile; run the booking-lifecycle\ntransition checks before resuming.",
     GREEN),
    ("6. SERVICE RESUMPTION", "Reopen submitBooking / Admin functions;\nnotify affected Guests & Admin; update Activity log.",
     GREEN),
]
bx = 0.45
bw, bh, gap = 1.95, 1.62, 0.15
for i, (t_, d_, col) in enumerate(boxes):
    x = bx + i * (bw + gap)
    rect(s, x, 1.72, bw, bh, fill=WHITE, line=col, line_w=1.5,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    chip(s, x+0.10, 1.82, bw-0.20, 0.32, t_, col, WHITE, size=9)
    txt(s, x+0.10, 2.22, bw-0.20, 1.05, d_, size=7.6, align=PP_ALIGN.CENTER,
        line_spacing=0.95, color=INK)
    if i < len(boxes) - 1:
        arrow(s, x+bw, 2.52, x+bw+gap, 2.52, color=FOREST, weight=1.75)

# Team vs provider responsibilities under PaaS
rect(s, 0.45, 3.62, 6.1, 3.35, fill=TEAM, line=FOREST, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, 0.62, 3.72, 2.6, 0.3, "OUR TEAM (PaaS)", FOREST_D, WHITE, size=10)
bullet_block(s, 0.62, 4.10, 5.75, 2.8, [
    ("Detect via our monitoring ", "& alerting."),
    ("Assess impact ", "on bookings, payments & approvals."),
    ("Restore & validate ", "from backups; replay incomplete transactions."),
    ("Verify provider SLA ", "is met before claiming recovery."),
    ("Communicate ", "with affected Guests and the Admin."),
], size=9, gap=4)

px = 6.75
rect(s, px, 3.62, 6.15, 3.35, fill=CLOUD, line=FOREST, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, px+0.27, 3.72, 2.6, 0.3, "PROVIDER (PaaS)", FOREST_D, WHITE, size=10)
bullet_block(s, px+0.27, 4.10, 5.62, 2.8, [
    ("Restore the platform ", "& managed database per SLA."),
    ("Durable storage & ", "replication of Firestore data."),
    ("Physical infrastructure, ", "OS, runtime & patching."),
    ("Backups ", "(we configure schedule & test restore)."),
], size=9, gap=4)

# RPO / RTO divider strip
rect(s, 0.45, 6.98, 12.45, 0.14, fill=GOLD)

footer(s, 9)

# =========================================================================== #
# Slide 10 — Question 5: RPO / RTO details + responsibilities table
# =========================================================================== #
s = add_slide()
header(s, "Question 5 (cont.) \u2014 RPO, RTO and provider capabilities to verify",
       "Recovery targets and what must be confirmed with the cloud provider", "Q5")

txt(s, 0.45, 1.18, 12.45, 0.28,
    "A target is not a guarantee \u2014 provider capabilities and agreements must be verified before launch.",
    size=10.5, color=GREY)

tbl = make_table(s, 0.45, 1.48, 12.45, 4, 4,
                 [1.55, 3.85, 3.85, 3.20], row_height=0.74)
for c, htext in enumerate(["Item", "Our position (Hacienda de LuisAna)", "Provider dependence",
                           "What must be verified"]):
    set_cell(tbl.cell(0, c), htext, size=10, bold=True, color=WHITE, fill=FOREST,
             align=PP_ALIGN.CENTER)
rows = [
    ("RPO",
     "As little data loss as practicable \u2014 target near-zero for completed bookings and "
     "verified payments; acceptable loss limited to in-flight submissions not yet written to Firestore.",
     "Managed Firestore backup frequency and point-in-time restore (provider capability).",
     "Confirm backup schedule, PITR availability and restore procedure with the provider before launch."),
    ("RTO",
     "Restore booking & payment services within a few hours of a declared outage (target to be agreed "
     "with the provider SLA); manual fallback communication (email/phone) used meanwhile.",
     "Provider restoration time and SLA commitment for Firestore / Cloud Functions in asia-southeast1.",
     "Obtain a written SLA with RTO commitment and test a restore drill before go-live."),
    ("Backup / recovery",
     "Team configures backup schedule and tests restores; incomplete transactions are re-checked against "
     "payment proofs and the Activity log after recovery.",
     "Durable storage, replication and the backup/restore service itself.",
     "Verify backup covers bookings, profiles, payment-proof paths and access_logs; confirm proof files "
     "are recoverable from Supabase Storage."),
]
for r, row in enumerate(rows, start=1):
    fill = CREAM if r % 2 == 1 else WHITE
    set_cell(tbl.cell(r, 0), row[0], size=10, bold=True, color=FOREST, fill=fill,
             align=PP_ALIGN.CENTER)
    for c in range(1, 4):
        set_cell(tbl.cell(r, c), row[c], size=8.8, color=INK, fill=fill)

# Affected users & functions
rect(s, 0.45, 4.72, 12.45, 1.02, fill=CREAM, line=LINE, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, 0.62, 4.80, 2.2, 0.3, "AFFECTED USERS & FUNCTIONS", FOREST_D, WHITE, size=9)
txt(s, 2.90, 4.80, 9.9, 0.88,
    [("Users: ", {"bold": True, "size": 9.3, "color": FOREST}),
     ("Guests submitting or paying for bookings; the Admin verifying payments and approving bookings. ",
      {"size": 9.3}),
     ("Functions affected: ", {"bold": True, "size": 9.3, "color": FOREST}),
     ("booking submission (submitBooking), payment-proof verification, booking approval, and the "
      "ESP32 access-log path. Browsing published rates remains read-only where cached.", {"size": 9.3})],
    line_spacing=1.05, space_after=0)

note_box(s, 0.45, 5.86, 12.45, 1.18,
         "Control available under PaaS (model-specific note)",
         ["\u2022  We control our monitoring, backup schedule, restore tests, incident communication and the "
          "application code; we cannot reach the provider's servers or OS.",
          "\u2022  Provider is responsible for platform restoration per its SLA; we must verify the SLA, backup "
          "frequency, PITR and restore procedure \u2014 these are agreements to confirm, not guarantees we assume.",
          "\u2022  Records are protected by provider-managed durable storage and replication; incomplete transactions "
          "are checked against payment proofs and the append-only Activity log after recovery."],
         size=9.3, gap=4)

footer(s, 10)

print("Part 5 done: slides 9-10")