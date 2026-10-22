# Payment QR assets

## `gcash-qr.png`

The owner's official GCash payment QR code, supplied on 2026-10-22 as a
720×1346 PNG poster (`image-2.png` in the hand-off). This file is a
**lossless, unresampled crop** of that poster: the QR square plus its white
quiet zone, taken at the poster's own pixel resolution (281×281, no scaling,
no filtering, no regeneration). The instructions at the bottom of the poster
are reproduced by the page copy instead, so the displayed image stays large
enough to scan.

Verified before committing: the crop decodes to exactly the same EMVCo payload
as the full poster —

```
00020101021127830012com.p2pqrpay0111GXCHPHM2XXX02089996440303152170200000006560417DWQM4TK3JDO0HPICD5204601653036085802PH5909AG***A H.6008Pacita 2610412346304AF6A
```

`GXCHPHM2XXX` is GCash's InstaPay acquirer id, `PH` the country, and the
payee name is the masked `AG***A H.` the owner's card prints. That is the
owner's GCash account — not a BDO, Maya or test code.

| File | Used by |
| --- | --- |
| `public/images/payment/gcash-qr.png` | Guest website (Vite serves `public/` at `/`) |
| `assets/images/payment/gcash-qr.png` | Flutter Admin app (byte-identical copy; `assets/` is bundled) |

## Rules

- **Do not regenerate, redraw or "clean up" this QR code.** A generated code
  would point at a different account. Replace the file only with a new image
  from the owner.
- **Do not re-compress it.** Keep it PNG at its native size; the page scales it
  with `image-rendering: pixelated` when enlarged so the modules stay sharp.
- The website reads the path from `OFFICIAL_PAYMENT_INFORMATION`
  (`src/config/officialBusiness.ts`, `qr_image`) and from
  `site_config/payment` when the Admin publishes one. Do not hardcode the path
  in a component.
- The asset is public by design: it carries the payee's masked name, GCash
  acquirer id and a merchant reference, no phone number, no account password
  and no credentials. It must stay reachable without signing in.
