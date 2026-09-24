# ADR-0008 — Guest website, Admin mobile (restates ADR-0007)

## Status

Accepted (existing architecture; not a new split).

## Decision

The **mobile-app requirement is fulfilled by the Admin Flutter app**. Guests use the responsive website. We do not ship a second Guest app in this repo.

## Consequence

Client booking, payment proof, chat, and ratings run on the website against the same Firebase project the Admin app reads.
