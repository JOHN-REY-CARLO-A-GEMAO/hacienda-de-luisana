import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/constants/app_constants.dart';
import '../../utils/validators.dart';

/// Admin catalog of valid payment references. OCR never writes here.
class PaymentRefsScreen extends StatefulWidget {
  const PaymentRefsScreen({super.key});

  @override
  State<PaymentRefsScreen> createState() => _PaymentRefsScreenState();
}

class _PaymentRefsScreenState extends State<PaymentRefsScreen> {
  final _ref = TextEditingController();
  final _amount = TextEditingController();
  final _search = TextEditingController();
  String _sort = 'reference';
  final List<_RefRow> _rows = [];

  @override
  void dispose() {
    _ref.dispose();
    _amount.dispose();
    _search.dispose();
    super.dispose();
  }

  void _add() {
    final ref = _ref.text.trim().toUpperCase();
    final amt = double.tryParse(_amount.text.trim().replaceAll(',', ''));
    if (ref.isEmpty || !RegExp(r'^[A-Z0-9-]{6,40}$').hasMatch(ref)) {
      _toast('Enter a valid reference (letters, numbers, hyphens).');
      return;
    }
    if (amt == null || amt <= 0) {
      _toast('Enter a valid amount.');
      return;
    }
    if (_rows.any((r) => r.reference == ref)) {
      _toast('That reference is already on the list.');
      return;
    }
    setState(() {
      _rows.add(_RefRow(reference: ref, amount: amt, status: 'available'));
      _ref.clear();
      _amount.clear();
    });
  }

  void _toast(String m) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _confirmDelete(_RefRow row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete reference?'),
        content: Text('Remove ${row.reference} from the valid-payment list?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete')),
        ],
      ),
    );
    if (ok == true) setState(() => _rows.remove(row));
  }

  @override
  Widget build(BuildContext context) {
    final q = _search.text.trim().toLowerCase();
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return r.reference.toLowerCase().contains(q) || r.status.contains(q);
    }).toList()
      ..sort((a, b) {
        switch (_sort) {
          case 'amount':
            return a.amount.compareTo(b.amount);
          case 'status':
            return a.status.compareTo(b.status);
          default:
            return a.reference.compareTo(b.reference);
        }
      });

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text('Payment references', style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'OCR extraction is never verification. Match reference and amount, reject duplicates, record who verified.',
            style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _search,
            decoration: const InputDecoration(labelText: 'Search', prefixIcon: Icon(Icons.search)),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 8),
          DropdownButton<String>(
            value: _sort,
            items: const [
              DropdownMenuItem(value: 'reference', child: Text('Sort by reference')),
              DropdownMenuItem(value: 'amount', child: Text('Sort by amount')),
              DropdownMenuItem(value: 'status', child: Text('Sort by status')),
            ],
            onChanged: (v) => setState(() => _sort = v ?? 'reference'),
          ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _ref,
                  decoration: const InputDecoration(labelText: 'Reference'),
                  inputFormatters: const [],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _amount,
                  decoration: const InputDecoration(labelText: 'Amount'),
                  keyboardType: TextInputType.number,
                ),
              ),
              IconButton(onPressed: _add, icon: const Icon(Icons.add_circle_outline)),
            ],
          ),
          const SizedBox(height: 16),
          if (filtered.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 24),
              child: Text('No references yet. Add valid GCash/bank references the Hacienda issued.'),
            ),
          ...filtered.map(
            (r) => ListTile(
              title: Text(r.reference),
              subtitle: Text('₱${r.amount.toStringAsFixed(2)} · ${r.status}'),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () => _confirmDelete(r),
              ),
            ),
          ),
          const SizedBox(height: 24),
          Text('Verify a Guest submission', style: GoogleFonts.cinzel(fontSize: 16)),
          const SizedBox(height: 8),
          Text(
            Validators.explainPaymentVerify(),
            style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _RefRow {
  _RefRow({required this.reference, required this.amount, required this.status});
  final String reference;
  final double amount;
  String status;
}
