import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../models/review_model.dart';
import '../../providers/app_providers.dart';
import '../../services/review_policy.dart';
import '../../services/review_service.dart';
import '../../widgets/empty_state.dart';
import 'review_detail_screen.dart';

/// What Guests wrote about stays they finished.
///
/// A page at a time, and a page is what the screen shows: the collection grows
/// with the number of stays the hacienda has ever had, and answering last
/// week's review does not need the ones from 2019. The filters are part of the
/// query rather than a pass over everything that was loaded, so narrowing the
/// list costs a read of the matches and not of the collection.
///
/// The three numbers at the top are deliberately two different averages. The
/// one on this screen counts every Review the Admin can see; the one on the
/// website counts only what has been published to it. They are not the same
/// number and pretending otherwise would be the easiest lie in the app.
class ReviewsScreen extends ConsumerStatefulWidget {
  const ReviewsScreen({super.key, this.service});

  /// Injected by a test; the app takes the one `reviewServiceProvider` builds.
  final ReviewService? service;

  @override
  ConsumerState<ReviewsScreen> createState() => _ReviewsScreenState();
}

class _ReviewsScreenState extends ConsumerState<ReviewsScreen> {
  final List<ReviewModel> _reviews = [];
  final Map<String, PublicReviewModel> _published = {};

  ReviewService get _service => widget.service ?? ref.read(reviewServiceProvider);

  ReviewFilter _filter = const ReviewFilter.all();
  ReviewStatistics _stats = ReviewStatistics.empty;
  DocumentSnapshot<Map<String, dynamic>>? _cursor;
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    _reviews.clear();
    _cursor = null;
    try {
      final page = await _service.listReviews(_filter);
      _reviews.addAll(page.reviews);
      _cursor = page.last;
      _hasMore = page.hasMore;
      _stats = await _service.statistics(_reviews);
      await _loadPublishedFlags();
    } catch (error) {
      _error = 'Could not load reviews: $error';
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Which of the loaded Reviews are on the website, so the list can say so.
  Future<void> _loadPublishedFlags() async {
    for (final review in _reviews) {
      final live = await _service.publishedTestimonial(review.id);
      if (live != null) _published[review.id] = live;
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await _service.listReviews(_filter, after: _cursor);
      _reviews.addAll(page.reviews);
      _cursor = page.last;
      _hasMore = page.hasMore;
      await _loadPublishedFlags();
    } catch (error) {
      _error = 'Could not load more reviews: $error';
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Guest Reviews',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        actions: [
          Tooltip(
            message: 'Refresh reviews',
            child: IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
          ),
        ],
      ),
      body: Column(
        children: [
          _StatisticsBar(stats: _stats),
          _FilterBar(
            filter: _filter,
            onChanged: (next) {
              setState(() => _filter = next);
              _load();
            },
          ),
          const Divider(height: 1, color: AppColors.cardBorder),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _reviews.isEmpty) {
      return EmptyState(
        icon: Icons.cloud_off_outlined,
        title: 'Reviews could not load',
        subtitle: _error!,
      );
    }
    if (_reviews.isEmpty) {
      return EmptyState(
        icon: Icons.rate_review_outlined,
        title: _filter.isEverything
            ? 'No reviews yet'
            : 'No reviews match that',
        subtitle: _filter.isEverything
            ? 'Guests can rate a stay once they have checked out. Their words appear here, and you decide what is published.'
            : 'Try a different filter — nothing here carries that rating or that state.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
      itemCount: _reviews.length + (_hasMore ? 1 : 0),
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        if (index == _reviews.length) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Center(
              child: _loadingMore
                  ? const CircularProgressIndicator()
                  : OutlinedButton.icon(
                      onPressed: _loadMore,
                      icon: const Icon(Icons.expand_more),
                      label: Text('Load ${kReviewPageSize} more'),
                    ),
            ),
          );
        }
        final review = _reviews[index];
        return ReviewTile(
          review: review,
          published: _published[review.id],
          onChanged: _load,
        );
      },
    );
  }
}

/// The numbers. Read before the list, because a review nobody has read yet is
/// a decision the Admin has not made.
class _StatisticsBar extends StatelessWidget {
  const _StatisticsBar({required this.stats});

  final ReviewStatistics stats;

  @override
  Widget build(BuildContext context) {
    final average = stats.average;
    return Container(
      color: AppColors.primaryDark,
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            label: average == null
                ? 'No published reviews yet'
                : 'Average ${average.toStringAsFixed(1)} out of 5 from ${stats.count} published reviews',
            child: ExcludeSemantics(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    average?.toStringAsFixed(1) ?? '—',
                    style: GoogleFonts.playfairDisplay(
                      fontSize: 40,
                      color: AppColors.accentGoldLight,
                      height: 1,
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.only(bottom: 5, left: 4),
                    child: Icon(Icons.star, color: AppColors.accentGold, size: 22),
                  ),
                  const Spacer(),
                  Text(
                    '$stats.published published',
                    style: GoogleFonts.inter(fontSize: 12, color: Colors.white70),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _Chip(label: '${stats.count} total', tone: AppColors.primaryForestLight),
              if (stats.pending > 0) _Chip(label: '${stats.pending} waiting', tone: AppColors.statusWarning),
              if (stats.hidden > 0) _Chip(label: '${stats.hidden} hidden', tone: AppColors.textMuted),
            ],
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.tone});

  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: tone.withOpacity(0.35),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(label, style: GoogleFonts.inter(fontSize: 11, color: Colors.white)),
      );
}

/// Stars, status and a search — all of them narrowing the query, not the list.
class _FilterBar extends StatefulWidget {
  const _FilterBar({required this.filter, required this.onChanged});

  final ReviewFilter filter;
  final ValueChanged<ReviewFilter> onChanged;

  @override
  State<_FilterBar> createState() => _FilterBarState();
}

class _FilterBarState extends State<_FilterBar> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _choice('Everything', widget.filter.status == null && widget.filter.stars == null,
                    () => widget.onChanged(ReviewFilter(search: _search.text))),
                ...kReviewStatuses.map(
                  (status) => Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: _choice(
                      status[0].toUpperCase() + status.substring(1),
                      widget.filter.status == status,
                      () => widget.onChanged(ReviewFilter(status: status, search: _search.text)),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search, size: 20),
                    hintText: 'Search the words a Guest wrote…',
                    isDense: true,
                  ),
                  onSubmitted: (value) =>
                      widget.onChanged(ReviewFilter(search: value, status: widget.filter.status)),
                ),
              ),
              const SizedBox(width: 10),
              DropdownButton<int?>(
                value: widget.filter.stars,
                hint: const Text('Any rating'),
                isDense: true,
                items: [
                  const DropdownMenuItem<int?>(value: null, child: Text('Any rating')),
                  ...[5, 4, 3, 2, 1].map(
                    (n) => DropdownMenuItem<int?>(value: n, child: Text('$n star${n == 1 ? '' : 's'}')),
                  ),
                ],
                onChanged: (value) =>
                    widget.onChanged(ReviewFilter(stars: value, status: widget.filter.status)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _choice(String label, bool selected, VoidCallback onTap) => ChoiceChip(
        label: Text(label, style: GoogleFonts.inter(fontSize: 12)),
        selected: selected,
        selectedColor: AppColors.primaryForest,
        backgroundColor: AppColors.surfaceLight,
        side: BorderSide(color: selected ? AppColors.primaryForest : AppColors.cardBorder),
        onSelected: (_) => onTap(),
      );
}

/// One Review, in the list.
class ReviewTile extends StatelessWidget {
  const ReviewTile({super.key, required this.review, this.published, this.onChanged});

  final ReviewModel review;
  final PublicReviewModel? published;
  final VoidCallback? onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppColors.cardBorder),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ReviewDetailScreen(review: review, onChanged: onChanged),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  StarRow(stars: review.stars),
                  const SizedBox(width: 8),
                  Text(
                    starLabel(review.stars),
                    style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                  ),
                  const Spacer(),
                  StatusPillLike(review.status),
                ],
              ),
              if (review.text.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  review.text,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(fontSize: 13, height: 1.45, color: AppColors.textDark),
                ),
              ] else ...[
                const SizedBox(height: 8),
                Text(
                  'A rating, with no words.',
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    fontStyle: FontStyle.italic,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
              if (review.hasAdminResponse) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    const Icon(Icons.reply, size: 14, color: AppColors.primaryForest),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'You replied',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          color: AppColors.primaryForest,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 10),
              Row(
                children: [
                  Text(
                    'Booking ${review.reference}',
                    style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                  ),
                  const Spacer(),
                  if (published != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.accentGoldLight,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        'On the website',
                        style: GoogleFonts.inter(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: AppColors.accentGoldDark,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A row of stars that says what it means.
///
/// The stars are drawn from an icon font, which a screen reader reads as
/// nothing at all, so the row carries a label instead: "3 out of 5 stars —
/// Average". A Guest who gave three stars because the room was fine but the
/// drive was not deserves that sentence to be legible too.
class StarRow extends StatelessWidget {
  const StarRow({super.key, required this.stars, this.size = 16});

  final int stars;
  final double size;

  @override
  Widget build(BuildContext context) => Semantics(
        label: starLabel(stars),
        excludeSemantics: true,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(
            5,
            (i) => Icon(
              Icons.star,
              size: size,
              color: i < stars ? AppColors.accentGold : AppColors.cardBorder,
            ),
          ),
        ),
      );
}

/// `pending` / `published` / `hidden`, in the app's own colours.
class StatusPillLike extends StatelessWidget {
  const StatusPillLike(this.status, {super.key});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'published' => ('Published', AppColors.statusSuccess),
      'hidden' => ('Hidden', AppColors.textMuted),
      _ => ('Waiting', AppColors.statusWarning),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }
}

