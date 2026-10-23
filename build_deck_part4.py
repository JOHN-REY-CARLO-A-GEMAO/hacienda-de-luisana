#!/usr/bin/env python3
"""Part 4: Question 4 slides (S8 Physical DFD diagram, S9 DFD essay)."""
import sys
sys.path.insert(0, "/home/user/hacienda-de-luisana")
from quiz_deck_helpers import *

# =========================================================================== #
# Slide 8 — Question 4: Physical DFD (Submit Booking process)
# =========================================================================== #
s = add_slide()
header(s, "Question 4 \u2014 Physical DFD (20 pts)",
       "Physical DFD: Process 1.0 \u201cSubmit Booking through Cloud Application\u201d", "Q4")

txt(s, 0.45, 1.18, 12.45, 0.28,
    "Selected major process: a Guest submits a Booking (website \u2192 PaaS backend \u2192 Firestore). "
    "Deployment annotations show where processing and storage occur.", size=10.5, color=GREY)

# ---- External entities (left) ----
rect(s, 0.45, 1.55, 2.55, 2.15, fill=CREAM, line=LINE, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, 0.62, 1.64, 2.2, 0.3, "EXTERNAL ENTITIES", FOREST_D, WHITE, size=9)
rect(s, 0.65, 2.02, 0.62, 0.62, fill=WHITE, line=FOREST, line_w=1.2,
     shape=MSO_SHAPE.OVAL)
txt(s, 0.65, 2.10, 0.62, 0.3, "G", size=10, bold=True, align=PP_ALIGN.CENTER,
    color=FOREST)
txt(s, 0.60, 2.66, 0.72, 0.3, "Guest", size=9, bold=True, align=PP_ALIGN.CENTER,
    color=INK)
txt(s, 0.60, 2.92, 0.72, 0.7, "(website, browser)", size=7.5, align=PP_ALIGN.CENTER,
    color=GREY)
rect(s, 1.60, 2.02, 0.62, 0.62, fill=WHITE, line=FOREST, line_w=1.2,
     shape=MSO_SHAPE.OVAL)
txt(s, 1.60, 2.10, 0.62, 0.3, "A", size=10, bold=True, align=PP_ALIGN.CENTER,
    color=FOREST)
txt(s, 1.55, 2.66, 0.72, 0.3, "Admin", size=9, bold=True, align=PP_ALIGN.CENTER,
    color=INK)
txt(s, 1.55, 2.94, 0.72, 0.7, "(mobile app)", size=7.5, align=PP_ALIGN.CENTER,
    color=GREY)

# ---- Process (centre-left) ----
rect(s, 3.40, 1.55, 2.75, 1.62, fill=FOREST, line=FOREST,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, 3.55, 1.70, 2.45, 0.3, "1.0 Submit Booking through", size=10, bold=True,
    color=WHITE, align=PP_ALIGN.CENTER)
txt(s, 3.55, 1.98, 2.45, 0.3, "Cloud Application", size=10, bold=True, color=WHITE,
    align=PP_ALIGN.CENTER)
txt(s, 3.55, 2.28, 2.45, 0.8,
    [("Deployed on ", {"size": 8, "color": RGBColor(0xD8,0xE0,0xD8)}),
     ("PaaS (Cloud Function)", {"size": 8, "bold": True, "color": GOLD}),
     (", asia-southeast1", {"size": 8, "color": RGBColor(0xD8,0xE0,0xD8)})],
    align=PP_ALIGN.CENTER, line_spacing=1.0, space_after=0)

# ---- Data stores (right) ----
stores = [
    ("DS1", "bookings (Firestore)\nPending Booking + Activity event", "provider-managed\nrepository"),
    ("DS2", "site_config/rates\nPublished rates + lead time", "provider-managed\nrepository"),
    ("DS3", "payment-proofs (Supabase Storage)\nscreenshot file", "provider-managed\nrepository"),
]
sx = 6.55
for i, (tag, name, dep) in enumerate(stores):
    yy = 1.50 + i * 0.96
    rect(s, sx, yy, 2.6, 0.82, fill=CLOUD, line=LINE, line_w=1.0,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    txt(s, sx+0.10, yy+0.05, 2.42, 0.22, tag + "  " + name.split("\n")[0],
        size=8.2, bold=True, color=FOREST)
    txt(s, sx+0.10, yy+0.27, 2.42, 0.24, name.split("\n")[1],
        size=7.4, color=INK)
    txt(s, sx+0.10, yy+0.51, 2.42, 0.24, dep, size=6.8, color=GREY,
        align=PP_ALIGN.CENTER)

# ---- Data flows (single direction, named, noun-based) ----
# Guest -> Process: booking request + payment proof ref
arrow(s, 3.00, 2.20, 3.38, 2.20, color=FOREST, weight=1.75)
txt(s, 2.72, 1.96, 0.30, 0.5, "stay\ndates,\ndownpayment\nproof ref,\nclaimed amount",
    size=6.8, color=GREY, align=PP_ALIGN.RIGHT, line_spacing=0.9)
# Process -> DS1: write Pending Booking + activity
arrow(s, 6.13, 2.20, 6.52, 2.20, color=FOREST, weight=1.75)
txt(s, 6.16, 1.94, 0.36, 0.5, "write\nPending Booking\n+ activity",
    size=6.8, color=GREY, align=PP_ALIGN.LEFT, line_spacing=0.9)
# Process -> DS2: read rates
arrow(s, 6.13, 2.72, 6.52, 2.72, color=FOREST, weight=1.75)
txt(s, 6.16, 2.74, 0.36, 0.5, "read\npublished rates\n+ lead time",
    size=6.8, color=GREY, align=PP_ALIGN.LEFT, line_spacing=0.9)
# Process -> DS3: store proof path (diagonal up-right into DS3)
arrow(s, 6.12, 3.00, 6.66, 3.30, color=FOREST, weight=1.75)
txt(s, 6.72, 3.06, 1.90, 0.42, "store payment-proof path",
    size=6.8, color=GREY, align=PP_ALIGN.LEFT, line_spacing=0.9)
# Process -> Guest: booking ref + status
arrow(s, 3.38, 3.30, 3.00, 3.30, color=FOREST, weight=1.75)
txt(s, 2.72, 3.06, 0.30, 0.45, "booking\nreference\n+ Pending\nstatus",
    size=6.8, color=GREY, align=PP_ALIGN.RIGHT, line_spacing=0.9)

# Deployment note
rect(s, 0.45, 4.12, 12.45, 0.62, fill=RGBColor(0xEE, 0xF3, 0xEE),
     line=FOREST, line_w=1.0, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, 0.62, 4.18, 12.1, 0.52,
    [("Deployment annotations: ", {"bold": True, "size": 8.8, "color": FOREST}),
     ("Processing occurs in the PaaS Cloud Function (asia-southeast1); storage occurs in provider-managed "
      "Firestore and Supabase Storage. The Admin app (process 2.0) reviews and approves.", {"size": 8.8})],
    line_spacing=1.0, space_after=0)

# Model-specific note
note_box(s, 0.45, 4.88, 12.45, 2.06,
         "How the PaaS model affects this process (essay focus)",
         ["\u2022  Team configures/controls: the submitBooking function code, validation (dates, 30-day Manila "
          "lead time, quote, payment snapshot), Firestore Security Rules, and the booking_inventory_lock that "
          "serializes competing submissions.",
          "\u2022  Provider manages: server, OS, runtime, scaling, Firestore engine/replication, Supabase Storage; "
          "internal provider details are not exposed or invented.",
          "\u2022  Logical DFD preserved: external inputs (stay dates, proof, claimed amount) and outputs (booking "
          "reference, Pending status) match the logical model; entity-to-store transfers route through "
          "process 1.0 (no direct entity-to-store flow).",
          "\u2022  Assumption: Cloud Functions deployed on Blaze in asia-southeast1 and "
          "site_config/booking.callable_booking_required set so direct client writes are closed."],
         size=9.0, gap=4)
footer(s, 8)

print("Part 4 done: slide 8")