# Payment QR assets

## `gcash-qr.png`

The owner's official GCash payment QR code, supplied as a 720×1346 PNG poster
(`image-2.png` in the hand-off). This file is a **lossless, unresampled crop**
of that poster: the QR square plus its white quiet zone, taken at the poster's
own pixel resolution (281×281, no scaling, no filtering, no regeneration). The
instructions at the bottom of the poster are reproduced by the page copy
instead, so the displayed image stays large enough to scan.

Verified before committing: the crop decodes to exactly the same EMVCo payload
as the full poster —

```
00020101021127830012com.p2pqrpay0111GXCHPHM2XXX02089996440303152170200000006560417DWQM4TK3JDO0HPICD5204601653036085802PH5909AG***A H.6008Pacita 2610412346304AF6A
```

`GXCHPHM2XXX` is GCash's InstaPay acquirer id, `PH` the country, and the
payee name is the masked `AG***A H.` the owner's card prints.

## `bdo-qr.png`

The owner's official BDO InstaPay payment QR code, supplied as a 720×1261 PNG
poster (`image-1.png` in the hand-off). Like `gcash-qr.png`, this file is a
**lossless, unresampled crop** of that poster: the 422×422 QR module grid plus
its 24 px white quiet zone on all four sides (470×470 at `+125+505`, no
scaling, no filtering, no regeneration). The transfer-fee note printed beneath
the code on the poster (`BDO to BDO transfers are free. Fees may apply for
non-BDO transfers.`) is carried in the page copy beside the code.

Verified before committing: the crop decodes to the exact same EMVCo payload
as the full poster —

```
00020101021227590012com.p2pqrpay0111BNORPHMMXXX020899964403041200543801368252046016530360854041.005802PH5904Aida6011Makati City630429F4
```

`BNORPHMMXXX` is BDO Unibank's InstaPay acquirer BIC, `PH` the country, and
`Aida` (`••••••••3682`) the owner's BDO account.

| File | Used by |
| --- | --- |
| `public/images/payment/gcash-qr.png` | Guest website (Vite serves `public/` at `/`) |
| `assets/images/payment/gcash-qr.png` | Flutter Admin app (byte-identical copy; `assets/` is bundled) |
| `public/images/payment/bdo-qr.png` | Guest website (Vite serves `public/` at `/`) |
| `assets/images/payment/bdo-qr.png` | Flutter Admin app (byte-identical copy; `assets/` is bundled) |

## Rules

- **Do not regenerate, redraw or "clean up" these QR codes.** A generated code
  would point at a different account. Replace a file only with a new image
  from the owner.
- **Do not re-compress them.** Keep them PNG at their native size; the page
  scales them with `image-rendering: pixelated` when enlarged so the modules
  stay sharp.
- The website reads the paths from `OFFICIAL_PAYMENT_INFORMATION`
  (`src/config/officialBusiness.ts`, `qr_image`) and from
  `site_config/payment` when the Admin publishes one. Do not hardcode the paths
  in a component.
- The assets are public by design: they carry the payee's masked name,
  InstaPay acquirer id and merchant reference, no account password and no
  credentials. They must stay reachable without signing in.
