#!/usr/bin/env python3
"""Part 3: Question 3 slides (S6 architecture diagram, S7 transaction trace)."""
import sys
sys.path.insert(0, "/home/user/hacienda-de-luisana")
from quiz_deck_helpers import *

# =========================================================================== #
# Slide 6 — Question 3: cloud system architecture diagram (PaaS)
# =========================================================================== #
s = add_slide()
header(s, "Question 3 \u2014 Cloud System Architecture (20 pts)",
       "PaaS architecture: users, hosted application, data components, HTTPS, boundaries", "Q3")

# ---- Left: users & clients ----
rect(s, 0.45, 1.25, 2.5, 2.9, fill=CREAM, line=LINE, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, 0.62, 1.36, 2.2, 0.3, "USERS & CLIENT DEVICES", FOREST_D, WHITE, size=9.5)
rect(s, 0.68, 1.82, 0.75, 0.75, fill=WHITE, line=FOREST, line_w=1.2,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, 0.68, 1.88, 0.75, 0.4, "Guest", size=9, bold=True, align=PP_ALIGN.CENTER,
    color=FOREST)
txt(s, 0.68, 2.25, 0.75, 0.3, "website\n(browser)", size=7.5, align=PP_ALIGN.CENTER,
    color=GREY)
rect(s, 1.70, 1.82, 0.75, 0.75, fill=WHITE, line=FOREST, line_w=1.2,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, 1.70, 1.88, 0.75, 0.4, "Admin", size=9, bold=True, align=PP_ALIGN.CENTER,
    color=FOREST)
txt(s, 1.70, 2.25, 0.75, 0.3, "mobile app\n(Android)", size=7.5, align=PP_ALIGN.CENTER,
    color=GREY)
txt(s, 0.62, 2.78, 2.25, 1.3,
    [("Guest books & pays on the website; ", {"size": 8.5}),
     ("Admin runs all operations from the mobile app.", {"size": 8.5})],
    line_spacing=1.0, space_after=0)

# ---- Centre: cloud platform boundary ----
cx, cy, cw, ch = 3.25, 1.20, 6.85, 5.15
rect(s, cx, cy, cw, ch, fill=CLOUD, line=FOREST, line_w=2.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, cx+0.25, cy+0.14, 3.1, 0.34, "CLOUD PLATFORM (PAAS) \u2014 asia-southeast1",
     FOREST_D, WHITE, size=10.5)
# boundary line (access boundary)
rect(s, cx+0.2, cy+0.62, cw-0.4, 0.02, fill=FOREST)

# Provider-managed platform (PaaS)
rect(s, cx+0.25, cy+0.80, cw-0.5, 2.30, fill=WHITE, line=LINE, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, cx+0.40, cy+0.88, 4.0, 0.24, "Provider-managed platform (PaaS)",
    size=9, bold=True, color=FOREST)
prov_stack = ["Managed Firestore (bookings, profiles, site_config/rates, access_logs)",
              "Firebase Auth (sign-in, ID tokens)",
              "Cloud Functions: bookingAvailability, submitBooking",
              "Firebase Hosting / Vercel (website) + Cloud Run / App Engine (Admin app logic)",
              "Realtime Database (ephemeral live-location stream)",
              "Supabase Storage bucket (payment-proof files)"]
yy = cy + 1.12
for p_ in prov_stack:
    txt(s, cx+0.42, yy, cw-0.75, 0.26, "\u2022 " + p_, size=8.3, color=INK)
    yy += 0.265

# Team-managed application layer
rect(s, cx+0.25, cy+3.45, cw-0.5, 1.62, fill=TEAM, line=FOREST, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, cx+0.40, cy+3.53, 4.0, 0.24, "Our team manages (application layer)",
    size=9, bold=True, color=FOREST)
team_stack = ["Application code & deployment (website + Admin app)",
              "Firestore Security Rules & roles (guest/admin)",
              "Security PIN gate & payment-proof verification",
              "ESP32 lock-gateway integration (writes access_logs)",
              "Backup configuration & RPO/RTO targets"]
yy = cy + 3.82
for t_ in team_stack:
    txt(s, cx+0.42, yy, cw-0.75, 0.24, "\u2022 " + t_, size=8.3, color=INK)
    yy += 0.245

# ---- ESP32 lock (right side, partially outside cloud) ----
lx, ly = 10.30, 2.05
rect(s, lx, ly, 2.6, 1.55, fill=WHITE, line=FOREST, line_w=1.25,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, lx+0.15, ly+0.12, 1.6, 0.3, "ESP32 smart lock", FOREST_D, WHITE, size=9)
txt(s, lx+0.15, ly+0.55, 2.3, 0.95,
    [("RFID / Mobile Key verification", {"size": 8.5, "bold": True}),
     ("writes access_logs to Firestore", {"size": 8.5}),
     ("(integration we operate)", {"size": 8, "italic": True, "color": GREY})],
    line_spacing=1.0, space_after=1)

# ---- Connections ----
# Guest -> platform (HTTPS)
arrow(s, 1.43, 2.20, 3.30, 2.30, color=FOREST, weight=2.0)
txt(s, 2.05, 2.10, 1.2, 0.22, "HTTPS", size=8.5, color=GREY, align=PP_ALIGN.CENTER)
# Admin app -> platform (HTTPS)
arrow(s, 2.08, 2.55, 3.30, 3.30, color=FOREST, weight=2.0)
txt(s, 2.40, 2.98, 0.9, 0.2, "HTTPS", size=8.5, color=GREY, align=PP_ALIGN.CENTER)
# Platform -> ESP32 (integration)
arrow(s, 10.10, 2.80, 10.32, 2.80, color=FOREST, weight=1.75)
txt(s, 10.02, 2.55, 0.95, 0.22, "access_logs", size=8, color=GREY, align=PP_ALIGN.CENTER)

# Access-boundary label (just below cloud box)
txt(s, cx+0.25, cy+ch+0.04, cw-0.5, 0.24,
    "Access boundary: guests reach only their own bookings; the Admin app reads all records via role-based rules.",
    size=7.8, color=GREY, align=PP_ALIGN.CENTER)

# ---- Backup & monitoring strip ----
rect(s, 0.45, 6.55, 12.45, 0.66, fill=RGBColor(0xEC, 0xF0, 0xEA),
     line=GREEN, line_w=1.0, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, 0.62, 6.61, 1.9, 0.3, "BACKUP & MONITORING", GREEN, WHITE, size=8.5)
txt(s, 2.62, 6.61, 10.2, 0.52,
    [("Managed Firestore backups (provider) + team-configured backup schedule & restore tests; ",
      {"size": 8.4}),
     ("monitoring & alerting on function errors (team/provider shared).", {"size": 8.4})],
    line_spacing=1.0, space_after=0)

footer(s, 6)

# =========================================================================== #
# Slide 7 — Question 3: transaction trace essay
# =========================================================================== #
s = add_slide()
header(s, "Question 3 (cont.) \u2014 Transaction trace & design fit",
       "Tracing one major transaction: a Guest submits a booking", "Q3")

txt(s, 0.45, 1.22, 12.45, 0.3,
    "Transaction: Guest selects dates, uploads a downpayment screenshot, and submits a Pending booking.",
    size=11.5, bold=True, color=FOREST)

steps = [
    ("1. Browse & quote", "Guest opens the website (HTTPS). The calendar projection comes from "
     "bookingAvailability (a Cloud Function reading private Bookings + Published rates) \u2014 "
     "no other Guest's data is exposed."),
    ("2. Sign in & pay offline", "Guest signs in (Firebase Auth, anonymous or linked account), chooses a "
     "payment plan, and transfers the downpayment manually to the published GCash/bank account."),
    ("3. Upload proof", "Guest uploads the screenshot to Supabase Storage (payments/{uid}/{ref}/proof.png); "
     "client-side OCR pre-fills the reference number (OCR is a hint, not verification)."),
    ("4. Submit (server boundary)", "submitBooking callable binds the Booking to the caller's UID, validates "
     "dates, the 30-day Manila lead time, the quote and the payment snapshot, then writes the Pending Booking "
     "and first Activity event in one Firestore transaction (serialized with booking_inventory_locks)."),
    ("5. Admin review", "Admin app re-checks date overlap and approves/rejects the screenshot under the "
     "Security PIN gate; approval sets Approved and firmly holds the dates."),
]
yy = 1.62
for i, (t_, d_) in enumerate(steps):
    chip(s, 0.45, yy, 2.05, 0.42, t_, FOREST, WHITE, size=10)
    txt(s, 2.62, yy+0.02, 10.2, 0.85, d_, size=9.3, line_spacing=1.0, space_after=0)
    yy += 0.92

# Design-fit essay
rect(s, 0.45, 6.18, 12.45, 0.92, fill=CREAM, line=LINE, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, 0.62, 6.26, 12.1, 0.78,
    [("Design fit: ", {"bold": True, "size": 9.8, "color": FOREST}),
     ("PaaS supports this scale and scope \u2014 low-volume, sporadic estate traffic; server-side transaction "
      "boundary (submitBooking) prevents double-booking the last unit; the two-role split and Security PIN "
      "gate run as application code we control; the ESP32 lock remains a separate integration we operate. "
      "Assumption: Cloud Functions are deployed on the Blaze plan in asia-southeast1.", {"size": 9.8})],
    line_spacing=1.05, space_after=0)

footer(s, 7)

print("Part 3 done: slides 6-7")