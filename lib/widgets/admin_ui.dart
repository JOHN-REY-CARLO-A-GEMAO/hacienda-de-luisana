import 'package:flutter/material.dart';
import '../core/constants/app_constants.dart';
import '../core/theme/app_theme.dart';
import 'hacienda_card.dart';

/// Reusable pieces of the Admin app's "field ledger" interface.
///
/// These are intentionally small and composable: screens keep their own state
/// and business rules, while headers, filters, sections, feedback and reading
/// widths come from one place.

enum AdminNoticeTone { info, success, caution, danger }

Color adminToneColor(AdminNoticeTone tone) {
  switch (tone) {
    case AdminNoticeTone.success:
      return AppColors.statusSuccess;
    case AdminNoticeTone.caution:
      return AppColors.statusWarning;
    case AdminNoticeTone.danger:
      return AppColors.statusAlert;
    case AdminNoticeTone.info:
      return AppColors.primaryForest;
  }
}

Color adminToneSurface(AdminNoticeTone tone) {
  switch (tone) {
    case AdminNoticeTone.success:
      return AppColors.sageMist;
    case AdminNoticeTone.caution:
      return AppColors.goldMist;
    case AdminNoticeTone.danger:
      return AppColors.dangerMist;
    case AdminNoticeTone.info:
      return AppColors.infoMist;
  }
}

/// Dark pine masthead shared by top-level Admin screens.
///
/// A one-pixel brass rule is the only ornament. Subtitles are operational
/// context, not marketing copy.
class AdminPageHeader extends StatelessWidget implements PreferredSizeWidget {
  final String title;
  final String? subtitle;
  final List<Widget> actions;
  final PreferredSizeWidget? bottom;
  final Widget? leading;
  final bool automaticallyImplyLeading;
  final double toolbarHeight;

  const AdminPageHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.actions = const <Widget>[],
    this.bottom,
    this.leading,
    this.automaticallyImplyLeading = true,
    this.toolbarHeight = 68,
  });

  @override
  Size get preferredSize => Size.fromHeight(
        toolbarHeight + (bottom?.preferredSize.height ?? 0),
      );

  @override
  Widget build(BuildContext context) {
    return AppBar(
      automaticallyImplyLeading: automaticallyImplyLeading,
      leading: leading,
      backgroundColor: AppColors.primaryDark,
      foregroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      toolbarHeight: toolbarHeight,
      titleSpacing: 20,
      centerTitle: false,
      shape: const Border(
        bottom: BorderSide(color: AppColors.accentGold, width: 0.8),
      ),
      title: Semantics(
        header: true,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.serif(
                fontSize: 19,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 2),
              Text(
                subtitle!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTheme.body(
                  fontSize: 12,
                  color: AppColors.accentGoldLight,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: actions.isEmpty
          ? null
          : [
              ...actions,
              const SizedBox(width: 8),
            ],
      bottom: bottom,
    );
  }
}

/// Keeps long operational pages and forms at a readable line length.
class AdminContent extends StatelessWidget {
  final Widget child;
  final double maxWidth;
  final EdgeInsetsGeometry padding;

  const AdminContent({
    super.key,
    required this.child,
    this.maxWidth = AppTheme.pageMaxWidth,
    this.padding = const EdgeInsets.all(AppTheme.gutter),
  });

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth < maxWidth
              ? constraints.maxWidth
              : maxWidth;
          return SizedBox(
            width: width,
            child: Padding(padding: padding, child: child),
          );
        },
      ),
    );
  }
}

/// Side-by-side content on tablet/landscape; a single reading column on phones.
class AdminResponsiveColumns extends StatelessWidget {
  final Widget primary;
  final Widget secondary;
  final double breakpoint;
  final double spacing;

  const AdminResponsiveColumns({
    super.key,
    required this.primary,
    required this.secondary,
    this.breakpoint = AppTheme.compactBreakpoint,
    this.spacing = 16,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < breakpoint) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              primary,
              SizedBox(height: spacing),
              secondary,
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 6, child: primary),
            SizedBox(width: spacing),
            Expanded(flex: 5, child: secondary),
          ],
        );
      },
    );
  }
}

/// One filter choice. Counts come from the caller's real list, never samples.
class AdminFilterItem {
  final String label;
  final int? count;
  final String? semanticsLabel;

  const AdminFilterItem({
    required this.label,
    this.count,
    this.semanticsLabel,
  });
}

/// A compact, accessible filter strip for data-heavy screens.
class AdminFilterStrip extends StatelessWidget {
  final List<AdminFilterItem> items;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final Key? Function(int index)? keyFor;

  const AdminFilterStrip({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onSelected,
    this.keyFor,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'Filter the list',
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 2),
        child: Row(
          children: [
            for (var i = 0; i < items.length; i++) ...[
              AdminFilterChip(
                key: keyFor?.call(i),
                label: items[i].label,
                count: items[i].count,
                selected: selectedIndex == i,
                semanticsLabel: items[i].semanticsLabel,
                onSelected: (_) => onSelected(i),
              ),
              const SizedBox(width: 8),
            ],
          ],
        ),
      ),
    );
  }
}

class AdminFilterChip extends StatelessWidget {
  final String label;
  final int? count;
  final bool selected;
  final ValueChanged<bool> onSelected;
  final String? semanticsLabel;

  const AdminFilterChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onSelected,
    this.count,
    this.semanticsLabel,
  });

  @override
  Widget build(BuildContext context) {
    final countText = count == null ? '' : ', ${count} records';
    return Semantics(
      button: true,
      selected: selected,
      label: semanticsLabel ?? '$label$countText',
      child: ChoiceChip(
        showCheckmark: false,
        selected: selected,
        onSelected: onSelected,
        selectedColor: AppColors.primaryForest,
        backgroundColor: AppColors.cardSurface,
        disabledColor: AppColors.surfaceSunken,
        side: BorderSide(
          color: selected ? AppColors.primaryForest : AppColors.cardBorder,
        ),
        shape: const StadiumBorder(),
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.comfortable,
        label: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: AppTheme.label(
                fontSize: 13,
                color: selected ? Colors.white : AppColors.textDark,
              ),
            ),
            if (count != null) ...[
              const SizedBox(width: 7),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: selected
                      ? Colors.white.withValues(alpha: 0.16)
                      : AppColors.surfaceSunken,
                  borderRadius: BorderRadius.circular(AppTheme.radiusPill),
                ),
                child: Text(
                  '${count!}',
                  style: AppTheme.label(
                    fontSize: 11,
                    color: selected ? Colors.white : AppColors.textMuted,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Section title with an optional plain-language explanation and text action.
class AdminSectionHeading extends StatelessWidget {
  final String title;
  final String? caption;
  final String? actionLabel;
  final VoidCallback? onAction;

  const AdminSectionHeading({
    super.key,
    required this.title,
    this.caption,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTheme.display(fontSize: 19)),
                if (caption != null) ...[
                  const SizedBox(height: 3),
                  Text(caption!, style: AppTheme.body(color: AppColors.textMuted)),
                ],
              ],
            ),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(width: 12),
            Semantics(
              button: true,
              label: actionLabel!,
              child: TextButton(
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A dense metric card for analytics and operations summaries.
class AdminMetricTile extends StatelessWidget {
  final String label;
  final String value;
  final String? detail;
  final IconData icon;
  final Color accent;
  final VoidCallback? onTap;

  const AdminMetricTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.detail,
    this.accent = AppColors.primaryForest,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final content = HaciendaCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: accent),
              const Spacer(),
              if (onTap != null)
                const Icon(Icons.chevron_right, size: 18, color: AppColors.textMuted),
            ],
          ),
          const SizedBox(height: 12),
          Text(label, style: AppTheme.label()),
          const SizedBox(height: 4),
          Text(value, style: AppTheme.metric(fontSize: 24), maxLines: 2),
          if (detail != null) ...[
            const SizedBox(height: 4),
            Text(detail!, style: AppTheme.body(fontSize: 12, color: AppColors.textMuted)),
          ],
        ],
      ),
    );
    if (onTap == null) return content;
    return Semantics(
      button: true,
      label: '$label: $value. Open.',
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.radiusCard),
        onTap: onTap,
        child: content,
      ),
    );
  }
}

/// Inline feedback that names the state in words, with an icon and a tinted
/// surface as secondary cues. Errors are announced to assistive technology.
class AdminInlineNotice extends StatelessWidget {
  final String title;
  final String? message;
  final AdminNoticeTone tone;
  final IconData? icon;
  final Widget? action;

  const AdminInlineNotice({
    super.key,
    required this.title,
    this.message,
    this.tone = AdminNoticeTone.info,
    this.icon,
    this.action,
  });

  IconData get _effectiveIcon {
    if (icon != null) return icon!;
    switch (tone) {
      case AdminNoticeTone.success:
        return Icons.check_circle_outline;
      case AdminNoticeTone.caution:
        return Icons.error_outline;
      case AdminNoticeTone.danger:
        return Icons.report_problem_outline;
      case AdminNoticeTone.info:
        return Icons.info_outline;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = adminToneColor(tone);
    return Semantics(
      container: true,
      liveRegion: tone == AdminNoticeTone.danger,
      label: message == null ? title : '$title. $message',
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: adminToneSurface(tone),
          borderRadius: BorderRadius.circular(AppTheme.radiusPanel),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(_effectiveIcon, size: 20, color: color),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppTheme.title(fontSize: 14, color: color)),
                  if (message != null) ...[
                    const SizedBox(height: 4),
                    Text(message!, style: AppTheme.body(fontSize: 13)),
                  ],
                  if (action != null) ...[
                    const SizedBox(height: 8),
                    action!,
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A label/value line with an icon, used for the facts of a record.
class AdminInfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;

  const AdminInfoRow({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 17, color: AppColors.textMuted),
          const SizedBox(width: 9),
          SizedBox(
            width: 74,
            child: Text(label, style: AppTheme.label(fontSize: 12)),
          ),
          Expanded(
            child: Text(
              value,
              style: AppTheme.body(
                fontSize: 13,
                color: valueColor ?? AppColors.textDark,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Grouped form block with a clear heading and one paper surface.
class AdminFormSection extends StatelessWidget {
  final String title;
  final String? caption;
  final Widget child;

  const AdminFormSection({
    super.key,
    required this.title,
    required this.child,
    this.caption,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AdminSectionHeading(title: title, caption: caption),
        const SizedBox(height: 8),
        HaciendaCard(
          padding: const EdgeInsets.all(18),
          child: child,
        ),
      ],
    );
  }
}

/// A compact value shown inside a dark pine masthead.
class AdminMastheadMetric extends StatelessWidget {
  final String value;
  final String label;
  final IconData icon;

  const AdminMastheadMetric({
    super.key,
    required this.value,
    required this.label,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Semantics(
        container: true,
        label: '$value $label',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 17, color: AppColors.accentGoldLight),
            const SizedBox(height: 7),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.metric(fontSize: 24, color: Colors.white),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.body(
                fontSize: 11,
                color: Colors.white.withValues(alpha: 0.72),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
