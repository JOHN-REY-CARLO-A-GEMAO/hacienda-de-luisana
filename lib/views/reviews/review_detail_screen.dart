import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;

import '../../core/constants/app_constants.dart';
import '../../models/review_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/review_policy.dart';
import '../../services/review_service.dart';
import 'reviews_screen.dart' show StarRow, StatusPillLike;

/// One Review, and the three things only the Admin may do about it.
///
/// Answer it, moderate it, put a testimonial on the website. Each of the three
/// is a separate button with its own confirmation, because they are three
/// different decisions: replying is a courtesy, hiding is a judgement about what
/// belongs on the site, and publishing is the one that puts a Guest's words in
/// front of people who have never met them.
///
/// The Guest's own words are shown here as they wrote them and cannot be edited
/// from this screen by anything — `firestore.rules` does not give the Admin
/// `stars` or `text` at all. A review the Admin dislikes is hidden, with the
/// decision on the Booking's Activity log; it is never rewritten to five stars.
class ReviewDetailScreen extends ConsumerStatefulWidget {
  const ReviewDetailScreen({super.key, required this.review, this.onChanged});

  final ReviewModel review;
  final VoidCallback? onChanged;

  @override
  ConsumerState<ReviewDetailScreen> createState() => _ReviewDetailScreenState();
}

class _ReviewDetailScreenState extends ConsumerState<ReviewDetailScreen> {
  late ReviewModel _review = widget.review;
  final TextEditingController _reply = TextEditingController();
  final TextEditingController _name = TextEditingController();
  bool _saving = false;
  String? _problem;
  PublicReviewModel? _published;
  bool _checkedPublished = false;

  ReviewService get _service => ref.read(reviewServiceProvider);

  String get _adminUid => legacy.Provider.of<AuthStore>(context, listen: false).uid ?? 'unknown';

  @override
  void initState() {
    super.initState();
    _reply.text = _review.adminResponse;
    _loadPublished();
  }

  @override
  void dispose() {
    _reply.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _loadPublished() async {
    final live = await _service.publishedTestimonial(_review.id);
    if (!mounted) return;
    setState(() {
      _published = live;
      _checkedPublished = true;
    });
  }

  /// Run one Admin action, saying plainly what went wrong if it did.
  ///
  /// The screen says what it is about to do before it does it, and says what
  /// happened afterwards. A moderation button that silently fails is how a
  /// review nobody is reading stays on the website.
  Future<void> _act(Future<void> Function() action, String success) async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _problem = null;
    });
    try {
      await action();
      // Re-read rather than patch: the stamps the rules require are server
      // timestamps, so the value on the device is not the value stored.
      final refreshed = await _service.fetch(_review.id);
      if (!mounted) return;
      if (refreshed != null) setState(() => _review = refreshed);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(success)));
      widget.onChanged?.call();
    } catch (error) {
      if (mounted) setState(() => _problem = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _replyToReview() {
    final text = _reply.text.trim();
    return _act(() => _service.respond(_review.id, text, _adminUid), 'Your reply is saved.');
  }

  Future<void> _setStatus(String status, String what) {
    return _act(() => _service.setStatus(_review.id, status, _adminUid), 'The review is $what.');
  }

  Future<void> _publish() {
    return _act(() async {
      await _service.publish(
        reviewId: _review.id,
        stars: _review.stars,
        excerpt: _review.text,
        displayName: _name.text,
        stayedAt: _review.createdAt ?? DateTime.now(),
      );
      await _loadPublished();
    }, 'The testimonial is on the website.');
  }

  Future<void> _unpublish() {
    return _act(() async {
      await _service.unpublish(_review.id);
      await _loadPublished();
    }, 'The testimonial is off the website.');
  }

  @override
  Widget build(BuildContext context) {
    final staysOnSite = _published != null;
    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Review',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 48),
        children: [
          _header(),
          const SizedBox(height: 16),
          if (_review.text.isNotEmpty)
            _card(
              'What the Guest wrote',
              child: Text(
                _review.text,
                style: GoogleFonts.inter(fontSize: 14, height: 1.55, color: AppColors.textDark),
              ),
            )
          else
            _card(
              'What the Guest wrote',
              child: Text(
                'Nothing — this review is a rating on its own. There is no quote to publish.',
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontStyle: FontStyle.italic,
                  color: AppColors.textMuted,
                ),
              ),
            ),
          if (_review.categories.isNotEmpty) _categories(),
          _replyCard(),
          _publishCard(staysOnSite),
          _moderateCard(),
          if (_problem != null) ...[
            const SizedBox(height: 12),
            Text(_problem!, style: GoogleFonts.inter(fontSize: 12, color: AppColors.statusAlert)),
          ],
        ],
      ),
    );
  }

  Widget _header() => Card(
        elevation: 0,
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.cardBorder),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  StarRow(stars: _review.stars, size: 20),
                  const SizedBox(width: 10),
                  Expanded(child: Text(starLabel(_review.stars), style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted))),
                  StatusPillLike(_review.status),
                ],
              ),
              const Divider(height: 24, color: AppColors.cardBorder),
              // The Booking this is about, and nothing else about the Guest:
              // no email, no phone, no payment reference. Those live on the
              // Booking, which is one tap away, and a list of complaints about
              // a person is no place to keep their contact details.
              _line('Stay', 'Booking ${_review.reference}'),
              if (_review.createdAt != null)
                _line('Written', _formatDate(_review.createdAt!)),
              if (_review.updatedAt != null)
                _line(
                  'Changed',
                  '${_formatDate(_review.updatedAt!)} — the Guest may still change it',
                ),
              if (_review.moderatedAt != null && _review.moderatedBy != null)
                _line('Moderated', '${_formatDate(_review.moderatedAt!)} by the Admin'),
            ],
          ),
        ),
      );

  Widget _line(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 70,
              child: Text(label, style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
            ),
            Expanded(
              child: Text(value, style: GoogleFonts.inter(fontSize: 12, color: AppColors.textDark)),
            ),
          ],
        ),
      );

  Widget _categories() => _card(
        'How they rated the details',
        child: Column(
          children: kReviewCategories.map((category) {
            final value = _review.categories[category.key];
            if (value == null) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(category.label, style: GoogleFonts.inter(fontSize: 12)),
                  ),
                  StarRow(stars: value, size: 14),
                ],
              ),
            );
          }).toList(),
        ),
      );

  Widget _replyCard() => _card(
        'Your reply',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Goes to the Guest on their review. Their words are not changed by it.',
              style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _reply,
              maxLines: 4,
              maxLength: kAdminResponseMax,
              decoration: const InputDecoration(
                hintText: 'Thank you for staying with us!',
                border: OutlineInputBorder(),
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                onPressed: _saving ? null : _replyToReview,
                icon: const Icon(Icons.send, size: 16),
                label: Text(_review.hasAdminResponse ? 'Update the reply' : 'Send the reply'),
              ),
            ),
          ],
        ),
      );

  Widget _publishCard(bool staysOnSite) => _card(
        'The website',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Publishing puts these words in front of visitors, under a name. '
              'It is a separate document from the review: the Guest\'s identity, '
              'their booking and this reply are not part of it, and the rules '
              'refuse any document carrying them (ADR-0014).',
              style: GoogleFonts.inter(fontSize: 11, height: 1.5, color: AppColors.textMuted),
            ),
            const SizedBox(height: 12),
            if (staysOnSite) ...[
              _publishedQuote(),
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: _saving ? null : _unpublish,
                  icon: const Icon(Icons.visibility_off_outlined, size: 16),
                  label: const Text('Take it down'),
                ),
              ),
            ] else ...[
              if (_review.publishRefusal != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    _review.publishRefusal!,
                    style: GoogleFonts.inter(fontSize: 12, color: AppColors.statusWarning),
                  ),
                ),
              TextField(
                controller: _name,
                decoration: const InputDecoration(
                  labelText: 'Show it as',
                  helperText: 'A first name and initial, or leave this empty for "Guest"',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  onPressed: _saving || _review.publishRefusal != null ? null : _publish,
                  icon: const Icon(Icons.public, size: 16),
                  label: const Text('Publish the testimonial'),
                ),
              ),
            ],
            if (_checkedPublished && !staysOnSite)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Nothing from this review is on the website.',
                  style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                ),
              ),
          ],
        ),
      );

  Widget _publishedQuote() => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.accentGoldLight.withOpacity(0.35),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('“${_published!.excerpt}”', style: GoogleFonts.inter(fontSize: 13, fontStyle: FontStyle.italic)),
            const SizedBox(height: 6),
            Text(
              '— ${_published!.displayName} · ${_published!.month}',
              style: GoogleFonts.inter(fontSize: 11, color: AppColors.accentGoldDark),
            ),
          ],
        ),
      );

  Widget _moderateCard() => _card(
        'Moderation',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Hiding keeps the review and records why. Nothing is deleted, and a '
              'negative review is never removed because it is negative.',
              style: GoogleFonts.inter(fontSize: 11, height: 1.5, color: AppColors.textMuted),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                if (!_review.isPublished)
                  ActionChip(
                    avatar: const Icon(Icons.check, size: 16),
                    label: const Text('Publish'),
                    onPressed: _saving ? null : () => _setStatus('published', 'published'),
                  ),
                if (!_review.isHidden)
                  ActionChip(
                    avatar: const Icon(Icons.visibility_off_outlined, size: 16),
                    label: const Text('Hide'),
                    onPressed: _saving ? null : () => _setStatus('hidden', 'hidden'),
                  ),
                if (!_review.isPending)
                  ActionChip(
                    avatar: const Icon(Icons.schedule, size: 16),
                    label: const Text('Send back to waiting'),
                    onPressed: _saving ? null : () => _setStatus('pending', 'waiting'),
                  ),
              ],
            ),
          ],
        ),
      );

  Widget _card(String title, {required Widget child}) => Card(
        elevation: 0,
        color: Colors.white,
        margin: const EdgeInsets.only(bottom: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.cardBorder),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: GoogleFonts.inter(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                  color: AppColors.primaryForest,
                ),
              ),
              const SizedBox(height: 10),
              child,
            ],
          ),
        ),
      );

  static String _formatDate(DateTime date) =>
      '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
}
