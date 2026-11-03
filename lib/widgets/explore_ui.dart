import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../core/theme/app_theme.dart';

/// Explore-style UI kit — structure copied from the owner-provided reference
/// designs (2026-11-03; see docs/DAILY_FLUTTER_UI_STYLE_GUIDE.md, "Reference
/// set 2"). Per the owner: copy the UI, keep the Hacienda's own colors — every
/// widget below takes its tones from [AppColors], never from the reference.
library;

/// Pill search bar: tinted icon circle + bold title + muted subtitle, all in
/// one rounded-full row (reference: "Start your search / Anywhere · Any week").
class SearchPill extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const SearchPill({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: AppColors.primaryForest,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Icon(icon, color: Colors.white, size: 18),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: GoogleFonts.inter(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textDark)),
                  Text(subtitle,
                      style: GoogleFonts.inter(
                          fontSize: 11, color: AppColors.textMuted)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One category entry: icon tile, optional corner badge ("NEW"), label below.
class ExploreCategory {
  final String label;
  final IconData icon;
  final String? badge;
  final VoidCallback? onTap;

  const ExploreCategory({
    required this.label,
    required this.icon,
    this.badge,
    this.onTap,
  });
}

/// Horizontally scrollable category row (reference: Homes / Experiences /
/// Services with NEW badges under the search pill).
class ExploreCategoryRow extends StatelessWidget {
  final List<ExploreCategory> items;

  const ExploreCategoryRow({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            _category(items[i]),
            if (i < items.length - 1) const SizedBox(width: 18),
          ],
        ],
      ),
    );
  }

  Widget _category(ExploreCategory c) {
    return InkWell(
      onTap: c.onTap,
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: 76,
        child: Column(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceLight,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.cardBorder),
                  ),
                  child: Icon(c.icon, color: AppColors.primaryForest, size: 24),
                ),
                if (c.badge != null)
                  Positioned(
                    top: -7,
                    right: -12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 5, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.statusAlert,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        c.badge!,
                        style: GoogleFonts.inter(
                            fontSize: 8,
                            fontWeight: FontWeight.w700,
                            color: Colors.white),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              c.label,
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textDark),
            ),
          ],
        ),
      ),
    );
  }
}

/// Listing card: media header with a badge pill, then title, a rating/meta
/// row, and a price line (reference: "Guest favorite" cards with ★ 4.82 and
/// "$72 for 2 nights").
class ListingCard extends StatelessWidget {
  final String title;
  final String? subtitle;
  final String? badge;
  final String priceLabel;
  final String? priceSub;
  final IconData? icon;
  final String? imageUrl;
  final double? rating;
  final VoidCallback? onTap;

  const ListingCard({
    super.key,
    required this.title,
    required this.priceLabel,
    this.subtitle,
    this.badge,
    this.priceSub,
    this.icon,
    this.imageUrl,
    this.rating,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.cardBorder),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: 140,
                width: double.infinity,
                child: imageUrl != null
                    ? Image.network(imageUrl!, fit: BoxFit.cover)
                    : Container(
                        color: AppColors.surfaceLight,
                        child: Center(
                          child: Icon(icon ?? Icons.home_outlined,
                              size: 40, color: AppColors.primaryForest),
                        ),
                      ),
              ).withBadge(badge),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: AppTheme.title(fontSize: 15)),
                    if (subtitle != null || rating != null) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          if (rating != null) ...[
                            Icon(Icons.star_rounded,
                                size: 14, color: AppColors.statusAlert),
                            const SizedBox(width: 3),
                            Text(rating!.toStringAsFixed(2),
                                style: GoogleFonts.inter(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.textDark)),
                            if (subtitle != null) const SizedBox(width: 6),
                          ],
                          if (subtitle != null)
                            Expanded(
                              child: Text(subtitle!,
                                  overflow: TextOverflow.ellipsis,
                                  style: GoogleFonts.inter(
                                      fontSize: 11,
                                      color: AppColors.textMuted)),
                            ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Text(priceLabel,
                            style: GoogleFonts.inter(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textDark)),
                        if (priceSub != null)
                          Text(priceSub!,
                              style: GoogleFonts.inter(
                                  fontSize: 11, color: AppColors.textMuted)),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

extension on Widget {
  Widget withBadge(String? badge) {
    if (badge == null) return this;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        this,
        Positioned(
          top: 10,
          left: 10,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.95),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              badge,
              style: GoogleFonts.inter(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textDark),
            ),
          ),
        ),
      ],
    );
  }
}

/// Sticky bottom bar: price block on the left, pill CTA on the right
/// (reference: "$64 night · 4.91 reviews" + [Reserve]).
class StickyActionBar extends StatelessWidget {
  final String priceLabel;
  final String? priceSub;
  final String ctaLabel;
  final VoidCallback? onCta;

  const StickyActionBar({
    super.key,
    required this.priceLabel,
    required this.ctaLabel,
    this.priceSub,
    this.onCta,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.cardBorder)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(priceLabel,
                    style: GoogleFonts.inter(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textDark)),
                if (priceSub != null)
                  Text(priceSub!,
                      style: GoogleFonts.inter(
                          fontSize: 11, color: AppColors.textMuted)),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: onCta,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primaryForest,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(999)),
              padding:
                  const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            ),
            child: Text(ctaLabel,
                style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

/// Radio list row (reference: payment-method list — icon, label, radio right).
class RadioOptionTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String? subtitle;
  final bool selected;
  final VoidCallback? onTap;

  const RadioOptionTile({
    super.key,
    required this.icon,
    required this.label,
    this.subtitle,
    this.selected = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
              color: selected ? AppColors.primaryForest : AppColors.cardBorder,
              width: selected ? 1.5 : 1),
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: AppColors.surfaceLight,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: AppColors.primaryForest, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: GoogleFonts.inter(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textDark)),
                  if (subtitle != null)
                    Text(subtitle!,
                        style: GoogleFonts.inter(
                            fontSize: 11, color: AppColors.textMuted)),
                ],
              ),
            ),
            Container(
              width: 20,
              height: 20,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                    color: selected
                        ? AppColors.primaryForest
                        : AppColors.textMuted,
                    width: 1.5),
              ),
              child: selected
                  ? Center(
                      child: Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: AppColors.primaryForest),
                      ),
                    )
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

/// Centered success check (reference: "You're confirmed!" screen — big tinted
/// circle with a check, headline, subline).
class SuccessCheck extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Color? tone;

  const SuccessCheck({
    super.key,
    required this.title,
    this.subtitle,
    this.tone,
  });

  @override
  Widget build(BuildContext context) {
    final color = tone ?? AppColors.statusSuccess;
    return Column(
      children: [
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            color: color.withOpacity(0.12),
            shape: BoxShape.circle,
          ),
          child: Icon(Icons.check_rounded, color: color, size: 44),
        ),
        const SizedBox(height: 14),
        Text(title,
            textAlign: TextAlign.center, style: AppTheme.title(fontSize: 20)),
        if (subtitle != null) ...[
          const SizedBox(height: 6),
          Text(subtitle!,
              textAlign: TextAlign.center,
              style:
                  GoogleFonts.inter(fontSize: 13, color: AppColors.textMuted)),
        ],
      ],
    );
  }
}
