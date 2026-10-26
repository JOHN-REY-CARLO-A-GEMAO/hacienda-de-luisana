import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_constants.dart';
import '../../models/guest_crm_model.dart';
import '../../providers/app_providers.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/loading_state.dart';
import 'guest_crm_detail_dialog.dart';
import '../../widgets/admin_ui.dart';

class GuestCrmScreen extends ConsumerStatefulWidget {
  const GuestCrmScreen({super.key});

  @override
  ConsumerState<GuestCrmScreen> createState() => _GuestCrmScreenState();
}

class _GuestCrmScreenState extends ConsumerState<GuestCrmScreen> {
  String _searchQuery = '';

  @override
  Widget build(BuildContext context) {
    final profilesAsync = ref.watch(guestProfilesStreamProvider);
    final currencyFmt = NumberFormat.currency(locale: 'en_PH', symbol: '₱', decimalDigits: 0);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: const AdminPageHeader(
        title: 'Guest records',
        subtitle: 'History, preferences and VIP notes',
      ),
      body: Column(
        children: [
          // Search Input
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search by guest name or phone number…',
                hintStyle: GoogleFonts.inter(fontSize: 13, color: AppColors.textMuted),
                prefixIcon: const Icon(Icons.search, size: 20, color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.surfaceLight,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: AppColors.cardBorder),
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              ),
              onChanged: (val) => setState(() => _searchQuery = val.trim().toLowerCase()),
            ),
          ),
          const Divider(height: 1, color: AppColors.cardBorder),

          // Profiles List
          Expanded(
            child: profilesAsync.when(
              data: (profiles) {
                final filtered = profiles.where((p) {
                  if (_searchQuery.isEmpty) return true;
                  return p.name.toLowerCase().contains(_searchQuery) ||
                      p.phone.replaceAll(' ', '').contains(_searchQuery);
                }).toList();

                if (filtered.isEmpty) {
                  return const EmptyState(
                    icon: Icons.person_search,
                    title: 'No guest profiles found',
                    subtitle: 'Try searching with a different name or number.',
                  );
                }

                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, i) {
                    final guest = filtered[i];
                    return InkWell(
                      onTap: () {
                        showDialog(
                          context: context,
                          builder: (_) => GuestCrmDetailDialog(guest: guest),
                        );
                      },
                      child: _buildCrmCard(guest, currencyFmt),
                    );
                  },
                );
              },
              loading: () => const LoadingState(
                    label: 'Reading guest records…',
                    detail: 'Loading profiles and past stay history.',
                  ),
              error: (err, _) => EmptyState(
                    icon: Icons.cloud_off_outlined,
                    title: 'Guest records could not be read',
                    subtitle:
                        'Check the connection and try again. ${err.toString().split('\n').first}',
                    action: OutlinedButton.icon(
                      onPressed: () => ref.invalidate(guestProfilesStreamProvider),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('Try again'),
                    ),
                  ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCrmCard(GuestCrmModel guest, NumberFormat currencyFmt) {
    return HaciendaCard(
      borderColor:
          guest.isVip ? AppColors.accentGold.withOpacity(0.5) : AppColors.cardBorder,
      borderWidth: guest.isVip ? 1.5 : 1.0,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                backgroundColor: guest.isVip
                    ? AppColors.accentGoldLight
                    : AppColors.primaryForest.withOpacity(0.1),
                child: Icon(
                  guest.isVip ? Icons.star_rounded : Icons.person_outline,
                  color: guest.isVip ? AppColors.accentGoldDark : AppColors.primaryForest,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          guest.name,
                          style: GoogleFonts.inter(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: AppColors.textDark,
                          ),
                        ),
                        if (guest.isVip) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.accentGoldLight,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: AppColors.accentGold),
                            ),
                            child: Text(
                              'VIP guest',
                              style: GoogleFonts.inter(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: AppColors.accentGoldDark,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    Text(
                      '${guest.phone}, ${guest.email}',
                      style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Stats row
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.surfaceLight,
              borderRadius: BorderRadius.circular(12),
            ),
            child: guest.hasHistory
                ? Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      Column(
                        children: [
                          Text('Total visits', style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
                          Text('${guest.totalBookings} stays', style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w700)),
                        ],
                      ),
                      Container(height: 20, width: 1, color: AppColors.cardBorder),
                      Column(
                        children: [
                          Text('Lifetime value', style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
                          Text(currencyFmt.format(guest.lifetimeRevenue),
                              style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.primaryForest)),
                        ],
                      ),
                    ],
                  )
                // No recorded stay and no recorded spend, so no figure is shown.
                // This used to print the ₱15,000 this model defaulted to, which
                // read as a real lifetime value on a profile with no history.
                : Text(
                    'No recorded stays yet.',
                    style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
                  ),
          ),
          const SizedBox(height: 10),

          // Admin notes
          if (guest.notes.trim().isNotEmpty)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.sticky_note_2_outlined, size: 14, color: AppColors.accentGoldDark),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    guest.notes,
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    fontStyle: FontStyle.italic,
                    color: AppColors.textDark.withOpacity(0.85),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
