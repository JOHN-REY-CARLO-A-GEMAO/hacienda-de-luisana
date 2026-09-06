import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import 'theme/app_theme.dart';
import 'models/accommodation.dart';
import 'models/booking.dart';
import 'services/auth_store.dart';
import 'services/booking_store.dart';
import 'services/esp32_service.dart';
import 'screens/auth_screen.dart';
import 'screens/dashboard_screen.dart';
import 'utils/validators.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthStore()),
        ChangeNotifierProvider(create: (_) => BookingStore()),
        Provider(create: (_) => Esp32Service()),
      ],
      child: const HaciendaApp(),
    ),
  );
}

class HaciendaApp extends StatelessWidget {
  const HaciendaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Hacienda de LuisAna',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: const AppShell(),
    );
  }
}

// Line 34: AppShell - 5 tabs (IndexedStack + NavigationBar)
class AppShell extends StatefulWidget {
  final int initialTab;
  const AppShell({super.key, this.initialTab = 0});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialTab;
  }

  void _onTabSelected(int index) {
    setState(() {
      _currentIndex = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    final screens = [
      HomeScreen(onNavigateTab: _onTabSelected),
      StayScreen(onNavigateBookTab: () => _onTabSelected(3)),
      const ExploreScreen(),
      const BookScreen(),
      DashboardScreen(onNavigateBook: () => _onTabSelected(3)),
    ];

    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: screens,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: _onTabSelected,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.king_bed_outlined),
            selectedIcon: Icon(Icons.king_bed),
            label: 'Stay',
          ),
          NavigationDestination(
            icon: Icon(Icons.explore_outlined),
            selectedIcon: Icon(Icons.explore),
            label: 'Explore',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_month_outlined),
            selectedIcon: Icon(Icons.calendar_month),
            label: 'Book',
          ),
          NavigationDestination(
            icon: Icon(Icons.vpn_key_outlined),
            selectedIcon: Icon(Icons.vpn_key),
            label: 'Key',
          ),
        ],
      ),
    );
  }
}

// Line 65: HomeScreen
class HomeScreen extends StatefulWidget {
  final Function(int) onNavigateTab;
  const HomeScreen({super.key, required this.onNavigateTab});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final PageController _pageController = PageController();
  int _currentHeroPage = 0;

  final List<String> heroImages = [
    'assets/images/gmaps/img-03.jpg',
    'assets/images/gmaps/img-05.jpg',
    'assets/images/gmaps/img-07.jpg',
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // SliverAppBar 380px with PageView
          SliverAppBar(
            expandedHeight: 380,
            pinned: true,
            flexibleSpace: FlexibleSpaceBar(
              title: Text(
                'Hacienda de LuisAna',
                style: GoogleFonts.cormorantGaramond(
                  color: AppTheme.cream50,
                  fontWeight: FontWeight.bold,
                  shadows: [
                    const Shadow(color: Colors.black54, blurRadius: 8),
                  ],
                ),
              ),
              centerTitle: true,
              background: Stack(
                fit: StackFit.expand,
                children: [
                  PageView.builder(
                    controller: _pageController,
                    onPageChanged: (idx) {
                      setState(() => _currentHeroPage = idx);
                    },
                    itemCount: heroImages.length,
                    itemBuilder: (context, index) {
                      return Image.asset(
                        heroImages[index],
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) {
                          return Container(
                            color: AppTheme.forest800,
                            child: const Center(
                              child: Icon(Icons.landscape, size: 80, color: AppTheme.olive),
                            ),
                          );
                        },
                      );
                    },
                  ),
                  // Gradient overlay
                  Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.black.withOpacity(0.3),
                          Colors.transparent,
                          AppTheme.forest900.withOpacity(0.85),
                        ],
                      ),
                    ),
                  ),
                  // Dot indicator
                  Positioned(
                    bottom: 20,
                    left: 0,
                    right: 0,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(
                        heroImages.length,
                        (index) => AnimatedContainer(
                          duration: const Duration(milliseconds: 300),
                          margin: const EdgeInsets.symmetric(horizontal: 4),
                          width: _currentHeroPage == index ? 24 : 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: _currentHeroPage == index
                                ? AppTheme.goldAccent
                                : Colors.white.withOpacity(0.5),
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Content body
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(20.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Opener — small gold rule + eyebrow kicker
                  Row(
                    children: [
                      Container(
                        width: 30,
                        height: 2,
                        decoration: BoxDecoration(
                          color: AppTheme.goldAccent,
                          borderRadius: BorderRadius.circular(1),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Text(
                        'SLOW LIVING & QUIET LUXURY',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 2.2,
                          color: AppTheme.olive,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'A sanctuary in\nLuisiana, Laguna',
                    style: GoogleFonts.cormorantGaramond(
                      fontSize: 34,
                      height: 1.05,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.forest900,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'Welcome to Hacienda de LuisAna — an exclusive mountain haven where serene nature meets refined quiet luxury. Unplug in our main villa or immerse in nature on elevated forest decks.',
                    style: GoogleFonts.inter(
                      fontSize: 14,
                      color: AppTheme.forest800.withOpacity(0.82),
                      height: 1.6,
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Call To Action Buttons (Book Now / Explore Stays)
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: () => widget.onNavigateTab(3), // Go to Book
                          icon: const Icon(Icons.calendar_today, size: 18),
                          label: const Text('Book Now'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => widget.onNavigateTab(1), // Go to Stay
                          icon: const Icon(Icons.explore, size: 18),
                          label: const Text('Explore Stays'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 30),

                  // Stats card — deep green with gold hairline top accent
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 12),
                    decoration: BoxDecoration(
                      gradient: AppTheme.forestDeep,
                      borderRadius: BorderRadius.circular(AppTheme.radiusCard),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.forest900.withOpacity(0.18),
                          blurRadius: 18,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Stack(
                      children: [
                        Positioned(
                          top: 0,
                          left: 28,
                          right: 28,
                          child: Container(
                            height: 2,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  Colors.transparent,
                                  AppTheme.goldSoft.withOpacity(0.7),
                                  Colors.transparent,
                                ],
                              ),
                            ),
                          ),
                        ),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            _buildStatItem('12', 'Max Guests', Icons.group),
                            Container(width: 1, height: 38, color: Colors.white24),
                            _buildStatItem('2', 'Camping Decks', Icons.deck),
                            Container(width: 1, height: 38, color: Colors.white24),
                            _buildStatItem('4.9★', 'Guest Rating', Icons.star),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),

                  // Featured Cards Section header
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Featured Accommodations',
                              style: GoogleFonts.cormorantGaramond(
                                fontSize: 24,
                                fontWeight: FontWeight.w700,
                                color: AppTheme.forest900,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Hand-picked quiet-luxury stays',
                              style: GoogleFonts.inter(
                                fontSize: 12,
                                color: AppTheme.forest800.withOpacity(0.6),
                              ),
                            ),
                          ],
                        ),
                      ),
                      TextButton(
                        onPressed: () => widget.onNavigateTab(1),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('View All'),
                            SizedBox(width: 2),
                            Icon(Icons.arrow_forward, size: 16),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Horizontal Featured List
                  SizedBox(
                    height: 240,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: accommodationsList.length,
                      itemBuilder: (context, index) {
                        final item = accommodationsList[index];
                        return Container(
                          width: 260,
                          margin: const EdgeInsets.only(right: 16),
                          child: Card(
                            clipBehavior: Clip.antiAlias,
                            child: InkWell(
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => AccommodationDetailScreen(
                                      accommodation: item,
                                      onBookNow: () => widget.onNavigateTab(3),
                                    ),
                                  ),
                                );
                              },
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  // Hero image with quiet scrim + price tag
                                  Expanded(
                                    child: Stack(
                                      fit: StackFit.expand,
                                      children: [
                                        Image.asset(
                                          item.heroImages.first,
                                          fit: BoxFit.cover,
                                          errorBuilder: (_, __, ___) => Container(
                                            color: AppTheme.forest800,
                                            child: const Center(
                                              child: Icon(Icons.home, color: AppTheme.cream50),
                                            ),
                                          ),
                                        ),
                                        // soft bottom scrim for legibility
                                        const DecoratedBox(
                                          decoration: BoxDecoration(
                                            gradient: LinearGradient(
                                              begin: Alignment.topCenter,
                                              end: Alignment.bottomCenter,
                                              colors: [
                                                Colors.transparent,
                                                Color(0x660F1C11),
                                              ],
                                            ),
                                          ),
                                        ),
                                        // category chip
                                        Positioned(
                                          top: 10,
                                          left: 10,
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 10,
                                              vertical: 4,
                                            ),
                                            decoration: BoxDecoration(
                                              color: AppTheme.forest900.withOpacity(0.78),
                                              borderRadius: BorderRadius.circular(AppTheme.radiusPill),
                                              border: Border.all(
                                                color: AppTheme.goldSoft.withOpacity(0.5),
                                              ),
                                            ),
                                            child: Text(
                                              item.category.toUpperCase(),
                                              style: GoogleFonts.inter(
                                                fontSize: 9,
                                                fontWeight: FontWeight.w700,
                                                letterSpacing: 1.1,
                                                color: AppTheme.cream50,
                                              ),
                                            ),
                                          ),
                                        ),
                                        // price tag pill
                                        Positioned(
                                          right: 10,
                                          bottom: 10,
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 10,
                                              vertical: 5,
                                            ),
                                            decoration: BoxDecoration(
                                              color: AppTheme.cream50,
                                              borderRadius: BorderRadius.circular(AppTheme.radiusPill),
                                              boxShadow: [
                                                BoxShadow(
                                                  color: Colors.black.withOpacity(0.18),
                                                  blurRadius: 8,
                                                  offset: const Offset(0, 2),
                                                ),
                                              ],
                                            ),
                                            child: Text(
                                              '₱${NumberFormat('#,###').format(item.pricePerNight)}/night',
                                              style: GoogleFonts.inter(
                                                fontSize: 12,
                                                fontWeight: FontWeight.w700,
                                                color: AppTheme.forest900,
                                              ),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.all(14.0),
                                    child: Row(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Expanded(
                                          child: Text(
                                            item.title,
                                            style: GoogleFonts.cormorantGaramond(
                                              fontSize: 19,
                                              height: 1.1,
                                              fontWeight: FontWeight.w700,
                                              color: AppTheme.forest900,
                                            ),
                                            maxLines: 2,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            const Icon(
                                              Icons.star_rounded,
                                              size: 15,
                                              color: AppTheme.goldAccent,
                                            ),
                                            const SizedBox(width: 2),
                                            Text(
                                              '${item.rating}',
                                              style: GoogleFonts.inter(
                                                fontSize: 12,
                                                fontWeight: FontWeight.w700,
                                                color: AppTheme.forest900,
                                              ),
                                            ),
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
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(String val, String label, IconData icon) {
    return Column(
      children: [
        Icon(icon, color: AppTheme.goldAccent, size: 22),
        const SizedBox(height: 4),
        Text(
          val,
          style: GoogleFonts.cormorantGaramond(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: AppTheme.cream50,
          ),
        ),
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 11,
            color: AppTheme.cream50.withOpacity(0.7),
          ),
        ),
      ],
    );
  }
}

// Line 152: StayScreen
class StayScreen extends StatefulWidget {
  final VoidCallback onNavigateBookTab;
  const StayScreen({super.key, required this.onNavigateBookTab});

  @override
  State<StayScreen> createState() => _StayScreenState();
}

class _StayScreenState extends State<StayScreen> {
  String _selectedFilter = 'All';

  @override
  Widget build(BuildContext context) {
    final filteredList = accommodationsList.where((item) {
      if (_selectedFilter == 'All') return true;
      if (_selectedFilter == 'Main House') return item.category == 'Main House';
      if (_selectedFilter == 'Camping Units') return item.category == 'Camping Units';
      return true;
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Accommodations'),
      ),
      body: Column(
        children: [
          // Filter chips — soft cream bar
          Container(
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
            decoration: BoxDecoration(
              color: AppTheme.cream100.withOpacity(0.55),
              border: Border(
                bottom: BorderSide(color: AppTheme.forest900.withOpacity(0.06)),
              ),
            ),
            child: Row(
              children: [
                Text(
                  'Browse',
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.4,
                    color: AppTheme.olive,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        _buildFilterChip('All'),
                        const SizedBox(width: 8),
                        _buildFilterChip('Main House'),
                        const SizedBox(width: 8),
                        _buildFilterChip('Camping Units'),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Accommodations List
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: filteredList.length,
              itemBuilder: (context, index) {
                final item = filteredList[index];
                return Card(
                  margin: const EdgeInsets.only(bottom: 16),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        height: 190,
                        width: double.infinity,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Image.asset(
                              item.heroImages.first,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Container(
                                color: AppTheme.forest800,
                                child: const Center(
                                  child: Icon(Icons.image, color: Colors.white, size: 50),
                                ),
                              ),
                            ),
                            // scrim to lift the top tag
                            const DecoratedBox(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [Color(0x550F1C11), Colors.transparent],
                                ),
                              ),
                            ),
                            Positioned(
                              top: 12,
                              left: 12,
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
                                decoration: BoxDecoration(
                                  color: AppTheme.cream50,
                                  borderRadius: BorderRadius.circular(AppTheme.radiusPill),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withOpacity(0.16),
                                      blurRadius: 8,
                                      offset: const Offset(0, 2),
                                    ),
                                  ],
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.villa_outlined,
                                        size: 13, color: AppTheme.forest800),
                                    const SizedBox(width: 5),
                                    Text(
                                      item.category.toUpperCase(),
                                      style: GoogleFonts.inter(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w700,
                                        letterSpacing: 1.0,
                                        color: AppTheme.forest900,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    item.title,
                                    style: GoogleFonts.cormorantGaramond(
                                      fontSize: 22,
                                      fontWeight: FontWeight.bold,
                                      color: AppTheme.forest900,
                                    ),
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: AppTheme.olive.withOpacity(0.2),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    'Up to ${item.capacity} guests',
                                    style: GoogleFonts.inter(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                      color: AppTheme.forest900,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              item.description,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.inter(fontSize: 13, color: Colors.black87),
                            ),
                            const SizedBox(height: 12),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'PHP ${NumberFormat('#,###').format(item.pricePerNight)} / night',
                                  style: GoogleFonts.inter(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    color: AppTheme.forest800,
                                  ),
                                ),
                                ElevatedButton(
                                  onPressed: () {
                                    Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) => AccommodationDetailScreen(
                                          accommodation: item,
                                          onBookNow: widget.onNavigateBookTab,
                                        ),
                                      ),
                                    );
                                  },
                                  style: ElevatedButton.styleFrom(
                                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                                  ),
                                  child: const Text('View Details'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label) {
    final isSelected = _selectedFilter == label;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (selected) {
        if (selected) {
          setState(() {
            _selectedFilter = label;
          });
        }
      },
      selectedColor: AppTheme.forest800,
      labelStyle: TextStyle(
        color: isSelected ? AppTheme.cream50 : AppTheme.forest900,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
      ),
    );
  }
}

// Accommodation Detail Page
class AccommodationDetailScreen extends StatelessWidget {
  final Accommodation accommodation;
  final VoidCallback onBookNow;

  const AccommodationDetailScreen({
    super.key,
    required this.accommodation,
    required this.onBookNow,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(accommodation.title),
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // PageView Gallery
            SizedBox(
              height: 250,
              child: PageView.builder(
                itemCount: accommodation.heroImages.length,
                itemBuilder: (context, idx) {
                  return Image.asset(
                    accommodation.heroImages[idx],
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      color: AppTheme.forest800,
                      child: const Center(
                        child: Icon(Icons.landscape, size: 60, color: AppTheme.cream50),
                      ),
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(20.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // category + rating eyebrow
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
                        decoration: BoxDecoration(
                          color: AppTheme.cream100,
                          borderRadius: BorderRadius.circular(AppTheme.radiusPill),
                          border: Border.all(color: AppTheme.olive.withOpacity(0.4)),
                        ),
                        child: Text(
                          accommodation.category.toUpperCase(),
                          style: GoogleFonts.inter(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.2,
                            color: AppTheme.forest800,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Row(
                        children: [
                          const Icon(Icons.star_rounded,
                              color: AppTheme.goldAccent, size: 17),
                          const SizedBox(width: 3),
                          Text(
                            '${accommodation.rating}',
                            style: GoogleFonts.inter(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppTheme.forest900,
                            ),
                          ),
                          Text(
                            '  ·  up to ${accommodation.capacity} guests',
                            style: GoogleFonts.inter(
                              fontSize: 13,
                              color: AppTheme.forest800.withOpacity(0.7),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(
                    accommodation.title,
                    style: GoogleFonts.cormorantGaramond(
                      fontSize: 30,
                      height: 1.05,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.forest900,
                    ),
                  ),
                  const SizedBox(height: 10),
                  // price
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        'from ',
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          color: AppTheme.forest800.withOpacity(0.6),
                        ),
                      ),
                      Text(
                        '₱${NumberFormat('#,###').format(accommodation.pricePerNight)}',
                        style: GoogleFonts.cormorantGaramond(
                          fontSize: 30,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.goldAccent,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '/ night',
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          color: AppTheme.forest800.withOpacity(0.7),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(
                    accommodation.description,
                    style: GoogleFonts.inter(
                      fontSize: 15,
                      height: 1.55,
                      color: AppTheme.forest900.withOpacity(0.88),
                    ),
                  ),
                  const SizedBox(height: 30),

                  // Amenities heading with gold rule
                  Row(
                    children: [
                      Container(
                        width: 22,
                        height: 2,
                        decoration: BoxDecoration(
                          color: AppTheme.goldAccent,
                          borderRadius: BorderRadius.circular(1),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Amenities & Features',
                        style: GoogleFonts.cormorantGaramond(
                          fontSize: 21,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.forest900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  // Amenities Wrap
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: accommodation.amenities.map((amenity) {
                      return Chip(
                        avatar: const Icon(Icons.check_circle_outline, size: 16, color: AppTheme.olive),
                        label: Text(amenity),
                        backgroundColor: AppTheme.cream100,
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      onPressed: () {
                        Navigator.pop(context);
                        onBookNow();
                      },
                      child: const Text('Book This Room', style: TextStyle(fontSize: 16)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Line 183: ExploreScreen (TabBar [Nearby / Gallery])
class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key});

  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _galleryFilter = 'All';

  final List<Map<String, String>> galleryItems = [
    {'image': 'assets/images/gmaps/img-03.jpg', 'title': 'Main House Villa Exterior', 'tag': 'Main House'},
    {'image': 'assets/images/gmaps/img-02.jpg', 'title': 'Infinity Pool & Ridge View', 'tag': 'Main House'},
    {'image': 'assets/images/gmaps/img-01.jpg', 'title': 'Hacienda Main Entrance', 'tag': 'Main House'},
    {'image': 'assets/images/gmaps/img-04.jpg', 'title': 'Morning Mist Mountain Balcony', 'tag': 'Main House'},
    {'image': 'assets/images/gmaps/img-09.jpg', 'title': 'Outdoor Gourmet Dining Deck', 'tag': 'Main House'},
    {'image': 'assets/images/gmaps/img-05.jpg', 'title': 'Forest Deck Glamping Tent', 'tag': 'Camping'},
    {'image': 'assets/images/gmaps/img-06.jpg', 'title': 'Glamping Interior Sanctuary', 'tag': 'Camping'},
    {'image': 'assets/images/gmaps/img-08.jpg', 'title': 'Campfire Pit Evening Glow', 'tag': 'Camping'},
    {'image': 'assets/images/gmaps/img-07.jpg', 'title': 'Serene Riverside Deck', 'tag': 'Nature'},
    {'image': 'assets/images/gmaps/hulugan_falls.jpg', 'title': 'Hulugan Falls Mist', 'tag': 'Nature'},
    {'image': 'assets/images/gmaps/aliw_falls.jpg', 'title': 'Aliw Falls Cascades', 'tag': 'Nature'},
    {'image': 'assets/images/gmaps/caliraya_lake.jpg', 'title': 'Caliraya Lake View', 'tag': 'Nature'},
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _launchMaps(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open map URL: $url')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Explore Luisiana'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppTheme.goldAccent,
          labelColor: AppTheme.cream50,
          unselectedLabelColor: AppTheme.cream50.withOpacity(0.6),
          tabs: const [
            Tab(icon: Icon(Icons.place), text: 'Nearby Attractions'),
            Tab(icon: Icon(Icons.photo_library), text: 'Photo Gallery'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Tab 1: Nearby Spots List
          ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: nearbyList.length,
            itemBuilder: (context, index) {
              final spot = nearbyList[index];
              return Card(
                margin: const EdgeInsets.only(bottom: 16),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      height: 168,
                      width: double.infinity,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          Image.asset(
                            spot.imageUrl,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Container(
                              color: AppTheme.forest800,
                              child: const Center(
                                child: Icon(Icons.landscape, size: 50, color: Colors.white),
                              ),
                            ),
                          ),
                          // soft bottom scrim
                          const DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topCenter,
                                end: Alignment.bottomCenter,
                                colors: [Colors.transparent, Color(0x770F1C11)],
                              ),
                            ),
                          ),
                          Positioned(
                            left: 12,
                            bottom: 12,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: AppTheme.cream50,
                                borderRadius: BorderRadius.circular(AppTheme.radiusPill),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withOpacity(0.18),
                                    blurRadius: 8,
                                    offset: const Offset(0, 2),
                                  ),
                                ],
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.place,
                                      size: 14, color: AppTheme.goldAccent),
                                  const SizedBox(width: 4),
                                  Text(
                                    spot.location,
                                    style: GoogleFonts.inter(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      color: AppTheme.forest900,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            spot.name,
                            style: GoogleFonts.cormorantGaramond(
                              fontSize: 23,
                              fontWeight: FontWeight.w700,
                              color: AppTheme.forest900,
                            ),
                          ),
                          const SizedBox(height: 7),
                          Text(
                            spot.description,
                            style: GoogleFonts.inter(
                              fontSize: 13,
                              height: 1.5,
                              color: AppTheme.forest900.withOpacity(0.85),
                            ),
                          ),
                          const SizedBox(height: 14),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              TextButton.icon(
                                onPressed: () => _launchMaps(spot.mapUrl),
                                icon: const Icon(Icons.map_outlined, size: 17),
                                label: const Text('Open in Maps'),
                                style: TextButton.styleFrom(
                                  foregroundColor: AppTheme.forest800,
                                  backgroundColor: AppTheme.olive.withOpacity(0.12),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 16, vertical: 10),
                                  shape: RoundedRectangleBorder(
                                    borderRadius:
                                        BorderRadius.circular(AppTheme.radiusPill),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),

          // Tab 2: Gallery GridView 2-col with filter All/Main House/Camping/Nature
          Column(
            children: [
              Container(
                padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
                decoration: BoxDecoration(
                  color: AppTheme.cream100.withOpacity(0.55),
                  border: Border(
                    bottom: BorderSide(color: AppTheme.forest900.withOpacity(0.06)),
                  ),
                ),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: ['All', 'Main House', 'Camping', 'Nature'].map((tag) {
                      final isSelected = _galleryFilter == tag;
                      return Padding(
                        padding: const EdgeInsets.only(right: 8.0),
                        child: ChoiceChip(
                          label: Text(tag),
                          selected: isSelected,
                          onSelected: (selected) {
                            if (selected) {
                              setState(() {
                                _galleryFilter = tag;
                              });
                            }
                          },
                          selectedColor: AppTheme.forest800,
                          labelStyle: TextStyle(
                            color: isSelected ? AppTheme.cream50 : AppTheme.forest900,
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ),
              Expanded(
                child: GridView.builder(
                  padding: const EdgeInsets.all(12),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 1.0,
                  ),
                  itemCount: galleryItems.where((item) {
                    if (_galleryFilter == 'All') return true;
                    return item['tag'] == _galleryFilter;
                  }).length,
                  itemBuilder: (context, index) {
                    final items = galleryItems.where((item) {
                      if (_galleryFilter == 'All') return true;
                      return item['tag'] == _galleryFilter;
                    }).toList();
                    final item = items[index];

                    return GestureDetector(
                      onTap: () {
                        // Fullscreen Dialog Preview
                        showDialog(
                          context: context,
                          builder: (_) => Dialog(
                            backgroundColor: Colors.transparent,
                            insetPadding: const EdgeInsets.all(10),
                            child: Stack(
                              alignment: Alignment.topRight,
                              children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(16),
                                  child: Image.asset(
                                    item['image']!,
                                    fit: BoxFit.contain,
                                    errorBuilder: (_, __, ___) => Container(
                                      color: AppTheme.forest800,
                                      height: 300,
                                      child: const Center(
                                        child: Icon(Icons.image, size: 60, color: Colors.white),
                                      ),
                                    ),
                                  ),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.close, color: Colors.white, size: 30),
                                  onPressed: () => Navigator.pop(context),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Image.asset(
                              item['image']!,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Container(
                                color: AppTheme.forest800,
                                child: const Icon(Icons.image, color: Colors.white),
                              ),
                            ),
                            Container(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [
                                    Colors.transparent,
                                    Colors.black.withOpacity(0.6),
                                  ],
                                ),
                              ),
                            ),
                            Positioned(
                              bottom: 8,
                              left: 8,
                              right: 8,
                              child: Text(
                                item['title']!,
                                style: GoogleFonts.inter(
                                  fontSize: 11,
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// Line 214: BookScreen (2-step flow)
class BookScreen extends StatefulWidget {
  const BookScreen({super.key});

  @override
  State<BookScreen> createState() => _BookScreenState();
}

class _BookScreenState extends State<BookScreen> {
  final _formKey = GlobalKey<FormState>();

  String _selectedAccommodation = accommodationsList.first.title;
  DateTime _checkInDate = DateTime.now().add(const Duration(days: 1));
  DateTime _checkOutDate = DateTime.now().add(const Duration(days: 3));
  int _guestCount = 2;

  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Pre-fill contact details when the guest is already signed in.
    final user = context.read<AuthStore>().user;
    if (user != null) {
      _nameController.text = user.name;
      _emailController.text = user.email;
      _phoneController.text = user.phone;
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _selectDate(BuildContext context, bool isCheckIn) async {
    final initialDate = isCheckIn ? _checkInDate : _checkOutDate;
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      builder: (context, child) {
        return Theme(
          data: ThemeData.light().copyWith(
            colorScheme: const ColorScheme.light(
              primary: AppTheme.forest900,
              onPrimary: AppTheme.cream50,
              surface: AppTheme.cream50,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() {
        if (isCheckIn) {
          _checkInDate = picked;
          if (_checkOutDate.isBefore(_checkInDate)) {
            _checkOutDate = _checkInDate.add(const Duration(days: 1));
          }
        } else {
          _checkOutDate = picked;
        }
      });
    }
  }

  /// Availability sanity checks that don't belong to a single field.
  String? _validateTrip() {
    if (!_checkOutDate.isAfter(_checkInDate)) {
      return 'Check-out must be after check-in.';
    }
    final acc = accommodationsList.firstWhere(
      (a) => a.title == _selectedAccommodation,
      orElse: () => accommodationsList.first,
    );
    if (_guestCount > acc.capacity) {
      return '${acc.title} accommodates up to ${acc.capacity} guests.';
    }
    return null;
  }

  Future<void> _submitForm() async {
    if (!_formKey.currentState!.validate()) return;

    final tripError = _validateTrip();
    if (tripError != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tripError)));
      return;
    }

    // Auth gate: guests browse freely but must sign in / register to book.
    final auth = context.read<AuthStore>();
    if (!auth.isAuthenticated) {
      final loggedIn = await Navigator.push<bool>(
        context,
        MaterialPageRoute(
          builder: (_) => const AuthScreen(
            reason: 'Sign in or create an account to complete your booking.',
          ),
        ),
      );
      if (loggedIn != true) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('You can send your booking once you\'re signed in.')),
          );
        }
        return;
      }
      if (!mounted) return;
    }

    // Session may have just started — pre-fill anything still empty.
    final user = context.read<AuthStore>().user;
    if (user != null) {
      if (_nameController.text.trim().isEmpty) _nameController.text = user.name;
      if (_emailController.text.trim().isEmpty) _emailController.text = user.email;
      if (_phoneController.text.trim().isEmpty) _phoneController.text = user.phone;
    }

    final refId =
        'HDL-${DateTime.now().year.toString().substring(2)}${(1000 + DateTime.now().millisecondsSinceEpoch % 8999)}';
    final booking = Booking(
      referenceId: refId,
      guestName: _nameController.text.trim(),
      phone: Validators.normalizePhone(_phoneController.text),
      email: _emailController.text.trim(),
      accommodationTitle: _selectedAccommodation,
      checkInDate: _checkInDate,
      checkOutDate: _checkOutDate,
      guestCount: _guestCount,
      notes: _notesController.text.trim(),
      status: 'pending',
      kycStatus: 'required',
    );

    // Persist to the store and continue to guest verification.
    Provider.of<BookingStore>(context, listen: false).submitBooking(booking);

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => KycScreen(booking: booking),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final DateFormat formatter = DateFormat('EEE, MMM d, yyyy');
    final authUser = context.watch<AuthStore>().user;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Book Your Stay'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Step 1 — numbered header
              Row(
                children: [
                  _StepBadge(number: '1'),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Reservation Details',
                        style: GoogleFonts.cormorantGaramond(
                          fontSize: 23,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.forest900,
                        ),
                      ),
                      Text(
                        'Pick your stay & dates',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          color: AppTheme.forest800.withOpacity(0.6),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Accommodation Dropdown
              DropdownButtonFormField<String>(
                isExpanded: true,
                value: _selectedAccommodation,
                decoration: InputDecoration(
                  labelText: 'Select Accommodation',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  prefixIcon: const Icon(Icons.home, color: AppTheme.forest800),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                ),
                selectedItemBuilder: (context) {
                  return accommodationsList.map((acc) {
                    return Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '${acc.title} (PHP ${NumberFormat('#,###').format(acc.pricePerNight)})',
                        overflow: TextOverflow.ellipsis,
                        maxLines: 1,
                        style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.forest800),
                      ),
                    );
                  }).toList();
                },
                items: accommodationsList.map((acc) {
                  return DropdownMenuItem(
                    value: acc.title,
                    child: Text(
                      '${acc.title} (PHP ${NumberFormat('#,###').format(acc.pricePerNight)})',
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                      style: GoogleFonts.inter(fontSize: 13),
                    ),
                  );
                }).toList(),
                onChanged: (val) {
                  if (val != null) setState(() => _selectedAccommodation = val);
                },
              ),
              const SizedBox(height: 16),

              // Check-in & Check-out Dates
              Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: () => _selectDate(context, true),
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: 'Check-In',
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          prefixIcon: const Icon(Icons.calendar_today, color: AppTheme.forest800),
                        ),
                        child: Text(
                          formatter.format(_checkInDate),
                          style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: InkWell(
                      onTap: () => _selectDate(context, false),
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: 'Check-Out',
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          prefixIcon: const Icon(Icons.calendar_today, color: AppTheme.forest800),
                        ),
                        child: Text(
                          formatter.format(_checkOutDate),
                          style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Guest Count Slider
              Row(
                children: [
                  const Icon(Icons.group, color: AppTheme.forest800),
                  const SizedBox(width: 12),
                  Text(
                    'Guests: $_guestCount',
                    style: GoogleFonts.inter(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  Expanded(
                    child: Slider(
                      value: _guestCount.toDouble(),
                      min: 1,
                      max: 12,
                      divisions: 11,
                      activeColor: AppTheme.forest800,
                      label: '$_guestCount guests',
                      onChanged: (val) => setState(() => _guestCount = val.toInt()),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 28),

              // Step 2 — numbered header
              Row(
                children: [
                  _StepBadge(number: '2'),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Guest Details',
                        style: GoogleFonts.cormorantGaramond(
                          fontSize: 23,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.forest900,
                        ),
                      ),
                      Text(
                        'Who is checking in',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          color: AppTheme.forest800.withOpacity(0.6),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Auth status hint — booking requires a guest account (demo-local).
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: authUser != null
                      ? AppTheme.oliveMist.withOpacity(0.45)
                      : AppTheme.cream100,
                  borderRadius: BorderRadius.circular(AppTheme.radiusField),
                  border: Border.all(
                    color: authUser != null
                        ? AppTheme.olive.withOpacity(0.4)
                        : AppTheme.forest900.withOpacity(0.12),
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      authUser != null ? Icons.verified_outlined : Icons.info_outline,
                      size: 18,
                      color: AppTheme.forest800,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        authUser != null
                            ? 'Booking as ${authUser.name} (${authUser.email})'
                            : 'Browsing as guest — you\'ll be asked to sign in when you submit.',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          height: 1.4,
                          color: AppTheme.forest800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              TextFormField(
                controller: _nameController,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(
                  labelText: 'Full Name',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  prefixIcon: const Icon(Icons.person, color: AppTheme.forest800),
                ),
                validator: Validators.name,
              ),
              const SizedBox(height: 16),

              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(
                  labelText: 'Email Address',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  prefixIcon: const Icon(Icons.mail_outline, color: AppTheme.forest800),
                ),
                validator: Validators.email,
              ),
              const SizedBox(height: 16),

              TextFormField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                decoration: InputDecoration(
                  labelText: 'Mobile Phone Number',
                  hintText: '09XX XXX XXXX',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  prefixIcon: const Icon(Icons.phone, color: AppTheme.forest800),
                ),
                validator: Validators.phone,
              ),
              const SizedBox(height: 16),

              TextFormField(
                controller: _notesController,
                maxLines: 2,
                decoration: InputDecoration(
                  labelText: 'Special Requests / Notes (Optional)',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  prefixIcon: const Icon(Icons.note, color: AppTheme.forest800),
                ),
              ),
              const SizedBox(height: 30),

              SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton.icon(
                  onPressed: _submitForm,
                  icon: Icon(authUser != null ? Icons.arrow_forward : Icons.login),
                  label: Text(
                    authUser != null ? 'Proceed to KYC Verification' : 'Sign In & Proceed',
                    style: const TextStyle(fontSize: 16),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// Line 260: KycScreen & Confirmation
class KycScreen extends StatefulWidget {
  final Booking booking;
  const KycScreen({super.key, required this.booking});

  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  String? _govtIdName;
  String? _receiptName;
  bool _termsAccepted = false;
  bool _isSubmitting = false;

  final ImagePicker _picker = ImagePicker();

  Future<void> _pickImage(bool isGovtId) async {
    try {
      final XFile? image = await _picker.pickImage(source: ImageSource.gallery);
      if (image != null) {
        setState(() {
          if (isGovtId) {
            _govtIdName = image.name;
          } else {
            _receiptName = image.name;
          }
        });
      }
    } catch (e) {
      // Simulated fallback for desktop/emulator/web
      setState(() {
        if (isGovtId) {
          _govtIdName = 'govt_id_simulated_scan.jpg';
        } else {
          _receiptName = 'payment_receipt_simulated.jpg';
        }
      });
    }
  }

  void _submitKyc() async {
    if (_govtIdName == null || _receiptName == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Please upload both your Government ID and payment receipt.')),
      );
      return;
    }

    if (!_termsAccepted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please accept the Terms & Guest Policy to proceed.')),
      );
      return;
    }

    setState(() => _isSubmitting = true);
    await Future.delayed(const Duration(milliseconds: 1200));

    widget.booking.govtIdPath = _govtIdName;
    widget.booking.paymentReceiptPath = _receiptName;

    if (mounted) {
      // Documents received — the booking STAYS pending until the host approves.
      // Demo: a simulated host review confirms it a few seconds later.
      final store = Provider.of<BookingStore>(context, listen: false);
      store.markKycSubmitted(
        widget.booking.referenceId,
        govtIdPath: _govtIdName,
        receiptPath: _receiptName,
      );

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => BookingConfirmationScreen(booking: widget.booking),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('KYC Verification'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 22,
                  height: 2,
                  decoration: BoxDecoration(
                    color: AppTheme.goldAccent,
                    borderRadius: BorderRadius.circular(1),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'GUEST VERIFICATION',
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.8,
                    color: AppTheme.olive,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'Identity & Payment',
              style: GoogleFonts.cormorantGaramond(
                fontSize: 27,
                fontWeight: FontWeight.w700,
                color: AppTheme.forest900,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'To ensure security and quiet-luxury compliance, kindly upload a valid Government ID and the bank deposit receipt for your reservation. Your booking stays pending until our host verifies both.',
              style: GoogleFonts.inter(
                fontSize: 13,
                height: 1.55,
                color: AppTheme.forest800.withOpacity(0.78),
              ),
            ),
            const SizedBox(height: 24),

            // Govt ID Upload
            Card(
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                leading: Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: _govtIdName == null
                        ? AppTheme.cream100
                        : AppTheme.olive.withOpacity(0.18),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppTheme.olive.withOpacity(0.35)),
                  ),
                  child: Icon(
                    _govtIdName == null
                        ? Icons.badge_outlined
                        : Icons.verified_user_outlined,
                    color: AppTheme.forest800,
                    size: 26,
                  ),
                ),
                title: Text(
                  'Government Issued ID',
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.forest900,
                  ),
                ),
                subtitle: Text(
                  _govtIdName == null
                      ? 'Passport, Driver’s License, or UMID'
                      : _govtIdName!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    color: _govtIdName == null
                        ? AppTheme.forest800.withOpacity(0.7)
                        : AppTheme.forest800,
                  ),
                ),
                trailing: TextButton(
                  onPressed: () => _pickImage(true),
                  child: Text(_govtIdName == null ? 'Upload' : 'Change'),
                ),
              ),
            ),
            const SizedBox(height: 14),

            // Payment Receipt Upload
            Card(
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                leading: Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: _receiptName == null
                        ? AppTheme.cream100
                        : AppTheme.olive.withOpacity(0.18),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppTheme.olive.withOpacity(0.35)),
                  ),
                  child: Icon(
                    _receiptName == null
                        ? Icons.receipt_long
                        : Icons.verified_user_outlined,
                    color: AppTheme.forest800,
                    size: 26,
                  ),
                ),
                title: Text(
                  'Payment Deposit Receipt',
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.forest900,
                  ),
                ),
                subtitle: Text(
                  _receiptName == null
                      ? 'GCash / Bank transfer reference'
                      : _receiptName!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    color: _receiptName == null
                        ? AppTheme.forest800.withOpacity(0.7)
                        : AppTheme.forest800,
                  ),
                ),
                trailing: TextButton(
                  onPressed: () => _pickImage(false),
                  child: Text(_receiptName == null ? 'Upload' : 'Change'),
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Terms Checkbox
            Row(
              children: [
                Checkbox(
                  value: _termsAccepted,
                  activeColor: AppTheme.forest800,
                  onChanged: (val) => setState(() => _termsAccepted = val ?? false),
                ),
                Expanded(
                  child: Text(
                    'I agree to Hacienda de LuisAna Quiet Luxury House Rules and Terms of Stay.',
                    style: GoogleFonts.inter(fontSize: 12),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 30),

            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: _isSubmitting ? null : _submitKyc,
                child: _isSubmitting
                    ? const SpinKitThreeBounce(color: AppTheme.cream50, size: 24)
                    : const Text('Submit for Host Verification', style: TextStyle(fontSize: 16)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Booking Confirmation Screen
class BookingConfirmationScreen extends StatelessWidget {
  final Booking booking;
  const BookingConfirmationScreen({super.key, required this.booking});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.cream50,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 112,
                height: 112,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: AppTheme.goldShade,
                  border: Border.all(color: AppTheme.cream50, width: 5),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.goldAccent.withOpacity(0.35),
                      blurRadius: 24,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: const Icon(Icons.check_rounded,
                    color: AppTheme.forest900, size: 64),
              ),
              const SizedBox(height: 26),
              Text(
                'Booking Submitted',
                style: GoogleFonts.cormorantGaramond(
                  fontSize: 34,
                  height: 1.05,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.forest900,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'We received your reservation and KYC documents. '
                'Our host will confirm your stay shortly — your digital key unlocks the moment you\'re confirmed.',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 13,
                  height: 1.5,
                  color: AppTheme.forest800.withOpacity(0.75),
                ),
              ),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 7),
                decoration: BoxDecoration(
                  color: AppTheme.forest900,
                  borderRadius: BorderRadius.circular(AppTheme.radiusPill),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.forest900.withOpacity(0.2),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Text(
                  'Ref · ${booking.referenceId}',
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                    color: AppTheme.goldSoft,
                  ),
                ),
              ),
              const SizedBox(height: 24),

              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                    _buildSummaryRow('Guest Name', booking.guestName),
                    const Divider(),
                    _buildSummaryRow('Accommodation', booking.accommodationTitle),
                    const Divider(),
                    _buildSummaryRow('Check-in', DateFormat('MMM d, yyyy').format(booking.checkInDate)),
                    const Divider(),
                    _buildSummaryRow('Check-out', DateFormat('MMM d, yyyy').format(booking.checkOutDate)),
                    const Divider(),
                    _buildSummaryRow('Total Amount', 'PHP ${NumberFormat('#,###').format(booking.totalPrice)}'),
                  ],
                ),
              ),
            ),
              const SizedBox(height: 32),

              SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton.icon(
                  onPressed: () {
                    // Navigate to AppShell tab index 4 (Key / Guest Dashboard)
                    Navigator.pushAndRemoveUntil(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const AppShell(initialTab: 4),
                      ),
                      (route) => false,
                    );
                  },
                  icon: const Icon(Icons.vpn_key),
                  label: const Text('Go to Guest Dashboard & Digital Key', style: TextStyle(fontSize: 15)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSummaryRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: GoogleFonts.inter(fontSize: 13, color: Colors.black54)),
        Text(value, style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.bold)),
      ],
    );
  }
}

// DashboardScreen & DigitalKeyScreen now live in lib/screens/dashboard_screen.dart

/// Small reusable gold number badge used for step headers in the Book flow.
class _StepBadge extends StatelessWidget {
  final String number;
  const _StepBadge({required this.number});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: AppTheme.goldShade,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: AppTheme.goldAccent.withOpacity(0.35),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Text(
        number,
        style: GoogleFonts.inter(
          fontSize: 15,
          fontWeight: FontWeight.w800,
          color: AppTheme.forest900,
        ),
      ),
    );
  }
}
