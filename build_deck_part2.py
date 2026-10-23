#!/usr/bin/env python3
"""Part 2: Question 2 slides (S4 selection justification, S5 responsibility diagram)."""
import sys
sys.path.insert(0, "/home/user/hacienda-de-luisana")
from quiz_deck_helpers import *

# =========================================================================== #
# Slide 4 — Question 2: selection + justification
# =========================================================================== #
s = add_slide()
header(s, "Question 2 \u2014 Select and Justify Your Cloud Service Model (20 pts)",
       "Selected primary model: PaaS (Firebase-as-a-platform on the website side)",
       "Q2")

# Selection banner
chip(s, 0.45, 1.18, 3.6, 0.5, "PRIMARY MODEL: PAAS", FOREST, WHITE, size=12)
txt(s, 0.45, 1.78, 12.4, 0.3,
    "Platform as a Service \u2014 the Guest website runs on Firebase Hosting / Vercel and the Admin "
    "app logic runs as managed platform services (Cloud Run / App Engine) backed by managed Firestore, "
    "Firebase Auth and Cloud Functions, region asia-southeast1.",
    size=11, color=INK, line_spacing=1.05)

bullet_block(s, 0.45, 2.20, 6.30, 4.75, [
    ("Approved functions & customization:  ",
     "the system needs a custom two-role split (Guest website, Admin mobile app), a booking lifecycle "
     "with date holds, payment-proof upload, published rates, and an ESP32 smart-lock gateway. PaaS lets us "
     "write and deploy exactly that application code while the platform runs the servers."),
    ("Expected users & workload:  ",
     "low-to-moderate, sporadic traffic (a countryside estate, not a hotel chain). PaaS scales to zero and "
     "scales up automatically \u2014 we pay for actual use, not idle VMs."),
    ("Team technical skills:  ",
     "the team already builds the React/Vite website and Flutter app on Firebase; no one is hired to operate "
     "Linux VMs, so removing server ops is a fit."),
    ("Budget & maintenance capacity:  ",
     "small operation \u2014 free/low-cost Firebase tiers plus pay-as-you-go functions suit a limited budget "
     "and there is no dedicated sysadmin to patch OSes."),
    ("Security & access:  ",
     "Firebase Auth + Firestore Security Rules enforce the guest/admin split and payment invariants at the "
     "database layer; the Admin app adds a Security PIN gate. The provider handles physical security and "
     "server patching."),
], size=10.5, gap=7)

# Alternatives + trade-off panel (right)
rect(s, 6.95, 2.20, 5.95, 4.75, fill=CREAM, line=LINE, line_w=1.0,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, 7.12, 2.32, 5.6, 0.3, "Comparison with the two alternatives + trade-off",
    size=12, bold=True, color=FOREST)
bullet_block(s, 7.12, 2.66, 5.62, 4.15, [
    ("vs IaaS:  ", "IaaS would give full control over the ESP32 lock gateway and the database engine, "
     "but we would have to patch OSes, run backups and monitor servers ourselves \u2014 too much ops for "
     "our team and budget."),
    ("vs SaaS:  ", "a generic property-management SaaS cannot meet the approved scope (RFID/Mobile Key "
     "via ESP32, custom 50% downpayment + deposit, two-role split). Pure SaaS fails the requirements."),
    ("Trade-off:  ", "PaaS gives up direct control over the ESP32 lock connection and fine-grained "
     "database tuning \u2014 the lock stays a separate integration we manage, and we accept the platform's "
     "managed-service limits."),
    ("Addressing it:  ", "keep the ESP32 lock gateway as a small integration we operate (it only writes "
     "access logs to Firestore), use Cloud Functions for the server-side transaction boundary, and verify "
     "provider SLAs/backups before launch."),
], size=10, gap=6)

footer(s, 4)

# =========================================================================== #
# Slide 5 — Question 2: responsibility diagram
# =========================================================================== #
s = add_slide()
header(s, "Question 2 (cont.) \u2014 Responsibility diagram",
       "PaaS: \u201cOur Team Manages\u201d vs \u201cCloud Provider Manages\u201d", "Q2")

# Left column — Our Team
rect(s, 0.45, 1.22, 5.85, 4.55, fill=TEAM, line=FOREST, line_w=1.5,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, 0.75, 1.36, 2.9, 0.4, "OUR TEAM MANAGES", FOREST_D, WHITE, size=11)
team_items = [
    "Application code (website + Admin app)",
    "Firestore data configuration (site_config/rates)",
    "User permissions & roles (guest / admin)",
    "Firestore Security Rules (authorization)",
    "Security PIN gate (ADR-0015)",
    "OCR settings & payment-proof review",
    "Deployment & CI/CD (Vercel / Firebase Hosting)",
    "ESP32 lock-gateway integration",
    "Backups configuration & testing",
    "Monitoring & incident response",
]
yy = 1.86
for i, it in enumerate(team_items):
    rect(s, 0.72, yy+0.02, 0.22, 0.22, fill=GOLD, shape=MSO_SHAPE.OVAL)
    txt(s, 1.06, yy, 5.1, 0.32, it, size=9.8, color=INK)
    yy += 0.365

# Right column — Cloud Provider
px = 6.95
rect(s, px, 1.22, 5.95, 4.55, fill=CLOUD, line=FOREST, line_w=1.5,
     shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, px+0.30, 1.36, 3.3, 0.4, "CLOUD PROVIDER MANAGES", FOREST_D, WHITE, size=11)
prov_items = [
    "Physical servers & data-centre facilities",
    "Operating systems & virtualisation",
    "Runtime environment & scaling",
    "Networking, load balancing & HTTPS termination",
    "Database engine, storage & replication",
    "Firebase Auth identity service",
    "Server patching, uptime & physical security",
]
yy = 1.86
for i, it in enumerate(prov_items):
    rect(s, px+0.27, yy+0.02, 0.22, 0.22, fill=GOLD, shape=MSO_SHAPE.OVAL)
    txt(s, px+0.60, yy, 5.2, 0.32, it, size=9.8, color=INK)
    yy += 0.38

# Shared band in the middle-bottom
rect(s, 0.45, 5.95, 12.45, 0.95, fill=RGBColor(0xF3, 0xEA, 0xDC),
     line=AMBER, line_w=1.25, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
chip(s, 0.70, 6.06, 2.2, 0.3, "SHARED", AMBER, RGBColor(0x7A, 0x54, 0x00), size=9.5)
txt(s, 3.05, 6.06, 9.7, 0.78,
    [("Shared responsibility: ", {"bold": True, "size": 10, "color": RGBColor(0x7A,0x54,0x00)}),
     ("data protection (we configure backup rules & RPO/RTO targets; the provider durably stores and "
      "replicates the data), identity verification (we enforce roles in rules; the provider runs Auth), "
      "and security (we write the rules; the provider secures the platform).", {"size": 10})],
    line_spacing=1.05, space_after=0)

footer(s, 5)

print("Part 2 done: slides 4-5")