# Facebook CDN Image URLs — Hacienda de LuisAna

These are direct CDN links from the official Facebook page:
https://www.facebook.com/haciendadeluisiana/photos

**Source:** Provided by client on 2026-09-06.

**IMPORTANT:** These URLs contain expiring tokens (`oe=...`). They may stop working
after the token expiration date. When that happens, replace them with fresh CDN
URLs from the Facebook page, or download the photos and save them locally in
`/public/images/fb/` and update `src/config/site.ts` accordingly.

## Image Mapping

| File ID | Facebook Photo ID | Aspect | Content | Used in |
|---------|-------------------|--------|---------|---------|
| fb-01 | 787083560_1756248286510139 | tall | Pine trees + stone pathway in foggy garden | Gallery: Outdoors, Experiences: Nature Escape |
| fb-02 | 784821378_1756248206510147 | tall | Foggy lawn with A-frame cabins in distance | Gallery: Camping, Accommodations: House A |
| fb-03 | 786520124_1756247993176835 | wide | White fence disappearing into heavy fog | Gallery: Outdoors, Experiences: Quiet Retreat |
| fb-04 | 786392812_1756247933176841 | tall | Norfolk pines + red ti plants in foggy garden | Gallery: Outdoors |
| fb-05 | 776453559_1745025087632459 | wide | Living room with TV and sofa | Gallery: Main House, Experiences: Family Bonding |
| fb-06 | 774193415_1745025190965782 | tall | Dining area with flowers and garden view | Gallery: Main House, Experiences: Small Gatherings |
| fb-07 | 778568552_1745025164299118 | tall | Wooden piano and staircase to loft | Gallery: Main House |
| fb-08 | 774266193_1745025057632462 | square | HDL welcome sign at the main gate | Gallery: Hacienda |

## How to refresh expired URLs

1. Open https://www.facebook.com/haciendadeluisiana/photos in your browser
2. Right-click each photo → "Open image in new tab"
3. Copy the new URL from the address bar
4. Update `src/config/site.ts` → `FB_CDN` object
