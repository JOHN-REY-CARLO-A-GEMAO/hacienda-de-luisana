# Facebook photos — Hacienda de LuisAna

Source: https://www.facebook.com/haciendadeluisiana/photos
Provided by client on 2026-09-06.

**These photos are not on this site, and this folder holds no image files.**

They were once hotlinked straight from Facebook's CDN. Each URL carried an
expiring token (`oe=...`), all eight expired, and nothing backed them on disk.
A tile whose image fails to load falls back to a gradient placeholder showing
only its caption, so every one of them rendered as a text-only card — see
`SmartImage`. The URLs were removed from `src/config/site.ts` on 2026-10-04
rather than refreshed, because a hotlink that breaks the page on someone else's
schedule does not belong in a shipped site.

The `FB_CDN` constant that held them is gone. Nothing references it.

## The photo inventory

Kept so these shots are not lost, and so they can be re-added properly.

| File ID | Facebook Photo ID | Aspect | Content | Was used in |
|---------|-------------------|--------|---------|-------------|
| fb-01 | 787083560_1756248286510139 | tall | Pine trees + stone pathway in foggy garden | Gallery: Outdoors, Experiences: Nature Escape |
| fb-02 | 784821378_1756248206510147 | tall | Foggy lawn with A-frame cabins in distance | Gallery: Camping, Accommodations: House A |
| fb-03 | 786520124_1756247993176835 | wide | White fence disappearing into heavy fog | Gallery: Outdoors, Experiences: Quiet Retreat |
| fb-04 | 786392812_1756247933176841 | tall | Norfolk pines + red ti plants in foggy garden | Gallery: Outdoors |
| fb-05 | 776453559_1745025087632459 | wide | Living room with TV and sofa | Gallery: Main House, Experiences: Family Bonding |
| fb-06 | 774193415_1745025190965782 | tall | Dining area with flowers and garden view | Gallery: Main House, Experiences: Small Gatherings |
| fb-07 | 778568552_1745025164299118 | tall | Wooden piano and staircase to loft | Gallery: Main House |
| fb-08 | 774266193_1745025057632462 | square | HDL welcome sign at the main gate | Gallery: Hacienda |

## To bring these photos back

Download them. Do not hotlink.

1. Open https://www.facebook.com/haciendadeluisiana/photos
2. Save each photo you want (right-click → "Save image as…")
3. Put the file in `public/images/gmaps/` — keep the `snake_case` naming those
   files already use; do not overwrite them
4. Add a `GALLERY` entry in `src/config/site.ts` pointing at `/images/gmaps/<file>`
   (`EXPERIENCES[].image` and `ACCOMMODATIONS[].images[]` take the same form)
5. Run the tests — `test/web/gallery-images.test.ts` fails on any referenced
   path that is not in `public/`, and on any image in `public/images/` that
   nothing references

A re-added photo must be in `public/`. A URL that resolves from someone else's
server is not on the site; it is a promise you cannot keep.