import 'dart:async';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../core/constants/app_constants.dart';
import '../../models/dispute_model.dart';
import '../../services/dispute_service.dart';
import '../bookings/booking_detail_screen.dart';

class DisputesScreen extends StatefulWidget {
  const DisputesScreen({super.key});
  @override State<DisputesScreen> createState() => _DisputesScreenState();
}
class _DisputesScreenState extends State<DisputesScreen> {
  final service = DisputeService();
  final older = <DisputeModel>[];
  String filter = 'all';
  bool loadingOlder = false;
  String? error;
  @override Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.surfaceLight,
    appBar: AppBar(title: const Text('Issues & Disputes'), actions: [
      IconButton(tooltip: 'Case notification inbox', icon: const Icon(Icons.notifications_outlined), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _CaseInbox(service: service)))),
      IconButton(tooltip: 'New operational report', icon: const Icon(Icons.add), onPressed: () => _createCase(context, service)),
    ]),
    body: Column(children: [
      const Padding(padding: EdgeInsets.all(12), child: Text('Cases never execute financial or Booking actions. Use the existing authorized Booking workflow. Urgent safety/access reports are not an emergency-response service.')),
      DropdownButton<String>(value: filter, items: ['all', 'unassigned', 'mine', 'overdue', 'reopening_requested', ...DisputeService.statuses].map((s) => DropdownMenuItem(value: s, child: Text(DisputeModel.label(s)))).toList(), onChanged: (s) => setState(() => filter = s!)),
      if (error != null) Padding(padding: const EdgeInsets.all(8), child: Text(error!, style: const TextStyle(color: Colors.red))),
      Expanded(child: StreamBuilder<List<DisputeModel>>(stream: service.streamAllDisputes(), builder: (context, snapshot) {
        if (snapshot.hasError) return Center(child: Text('Cases unavailable: ${snapshot.error}. No local-success fallback.'));
        if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
        final map = {for (final c in older) c.id: c, for (final c in snapshot.data!) c.id: c};
        final all = map.values.toList()..sort((a, b) => ((b.data['updated_at'] as num?) ?? 0).compareTo((a.data['updated_at'] as num?) ?? 0));
        final uid = FirebaseAuth.instance.currentUser?.uid;
        final rows = all.where((c) {
          if (filter == 'all') return true;
          if (filter == 'unassigned') return !c.inactive && (c.independent ? c.reviewer : c.assignee) == null;
          if (filter == 'reopening_requested') return c.data['reopening_requested'] == true;
          if (filter == 'mine') return c.assignee == uid || c.reviewer == uid;
          if (filter == 'overdue') return !c.inactive && c.data['due_at'] is num && (c.data['due_at'] as num) < DateTime.now().millisecondsSinceEpoch;
          return c.status == filter;
        }).toList();
        return ListView(children: [
          if (rows.isEmpty) const ListTile(title: Text('No cases in this view')),
          ...rows.map((c) => Card(child: ListTile(
            title: Text('${c.reference} · ${DisputeModel.label(c.category)}'),
            subtitle: Text('${DisputeModel.label(c.status)} · ${c.priority}\n${c.internal ? 'INTERNAL operational report' : 'Guest-facing'} · ${c.independent ? c.reviewer ?? 'Waiting for independent reviewer' : c.assignee ?? 'Unassigned'}\n${DisputeModel.date(c.data['updated_at'])}'),
            isThreeLine: true,
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _CaseDetail(id: c.id, service: service))),
          ))),
          TextButton(onPressed: loadingOlder || all.isEmpty ? null : () async {
            setState(() => loadingOlder = true);
            try { final page = await service.olderCases(all.last.id); if (mounted) setState(() => older.addAll(page)); }
            catch (e) { if (mounted) setState(() => error = e.toString()); }
            finally { if (mounted) setState(() => loadingOlder = false); }
          }, child: Text(loadingOlder ? 'Loading…' : 'Load older cases')),
        ]);
      })),
    ]),
  );
}

Future<void> _createCase(BuildContext context, DisputeService service, {DisputeModel? source}) async {
  final description = TextEditingController(); final booking = TextEditingController(text: source?.bookingId ?? '');
  String category = source?.category ?? 'other'; bool internal = source == null; bool busy = false; String? error;
  await showDialog<void>(context: context, barrierDismissible: false, builder: (ctx) => StatefulBuilder(builder: (ctx, update) => AlertDialog(
    title: Text(source == null ? 'Create case' : 'Share a guest-facing summary'),
    content: SizedBox(width: 480, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Text('Internal notes are NEVER copied. A guest-facing case requires a verified Booking owner. Enter only the information intended for that Guest.'),
      if (source == null) SwitchListTile(title: const Text('Internal operational report'), value: internal, onChanged: busy ? null : (v) => update(() => internal = v)),
      DropdownButtonFormField<String>(initialValue: category, items: DisputeService.categories.map((c) => DropdownMenuItem(value: c, child: Text(DisputeModel.label(c)))).toList(), onChanged: busy ? null : (v) => category = v!),
      TextField(controller: booking, decoration: const InputDecoration(labelText: 'Booking document ID (optional for internal reports)')),
      TextField(controller: description, maxLines: 5, maxLength: 4000, decoration: const InputDecoration(labelText: 'Description / deliberately shared summary (10+ characters)')),
      if (error != null) Text(error!, style: const TextStyle(color: Colors.red)),
    ]))),
    actions: [TextButton(onPressed: busy ? null : () => Navigator.pop(ctx), child: const Text('Back')), FilledButton(onPressed: busy ? null : () async {
      if (description.text.trim().length < 10) { update(() => error = 'Describe the concern in at least 10 characters.'); return; }
      update(() { busy = true; error = null; });
      try {
        await service.command({'action': 'create', 'category': category, 'description': description.text.trim(), 'internal': internal, if (booking.text.trim().isNotEmpty) 'bookingId': booking.text.trim(), if (source != null) 'sourceCase': source.id});
        if (ctx.mounted) Navigator.pop(ctx);
      } catch (e) { if (ctx.mounted) update(() { error = 'Not confirmed: $e. Retry unchanged information.'; busy = false; }); }
    }, child: Text(busy ? 'Checking submission…' : 'Review complete — submit'))],
  )));
  description.dispose(); booking.dispose();
}

class _CaseDetail extends StatefulWidget {
  final String id; final DisputeService service;
  const _CaseDetail({required this.id, required this.service});
  @override State<_CaseDetail> createState() => _CaseDetailState();
}
class _CaseDetailState extends State<_CaseDetail> {
  final message = TextEditingController();
  final selected = <CaseFile>[];
  final ready = <CaseFile, String>{};
  final olderActivity = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
  bool busy = false; String? error; String progress = '';
  @override void dispose() { message.dispose(); super.dispose(); }
  Future<void> send(DisputeModel c, String action, [Map<String, dynamic> fields = const {}]) async {
    setState(() { busy = true; error = null; progress = 'Waiting for server acknowledgement…'; });
    try {
      final attachments = <String>[];
      if (action == 'message') for (final file in selected) {
        final id = ready[file] ?? await widget.service.uploadEvidence(c, file, (s) { if (mounted) setState(() => progress = s); });
        ready[file] = id; attachments.add(id);
      }
      await widget.service.command({'action': action, 'caseId': c.id, 'expectedVersion': c.version, 'text': message.text.trim(), if (attachments.isNotEmpty) 'attachmentIds': attachments, ...fields});
      if (mounted) setState(() { message.clear(); selected.clear(); ready.clear(); progress = 'Action confirmed.'; });
    } catch (e) { if (mounted) setState(() { error = '$e'; progress = 'Not confirmed. Refresh/review before retrying; unchanged retries reuse the operation.'; }); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> manage(DisputeModel c) async {
    String action = 'note'; String target = FirebaseAuth.instance.currentUser?.uid ?? '';
    String priority = c.priority; String evidenceId = ''; bool completed = false; bool restrict = true;
    final rationale = TextEditingController();
    final execution = TextEditingController(); final summary = TextEditingController();
    DateTime due = DateTime.now().add(const Duration(days: 7));
    List<Map<String, dynamic>> directory = [];
    try { directory = await widget.service.directory(); } catch (e) { if (mounted) setState(() => error = e.toString()); return; }
    if (!mounted) return;
    final actions = <String>['note', 'assign', 'priority', 'hold', 'evidence_decision', 'link',
      if (!c.inactive) ...['review', 'request_info', 'extend_deadline', 'await_staff', 'propose', 'escalate', 'resolve', 'complete_remedy', 'final_decision', 'duplicate'],
      if (['resolved', 'under_review', 'awaiting_guest'].contains(c.status)) 'close',
      if (c.inactive) ...['request_reopen', 'approve_reopen', 'deny_reopen', 'enforce_remedy'],
    ];
    await showDialog<void>(context: context, builder: (ctx) => StatefulBuilder(builder: (ctx, update) => AlertDialog(
      title: const Text('Record a case action'),
      content: SizedBox(width: 480, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('Only permitted transitions succeed. Financial/Booking actions must be executed separately. A complainant cannot decide their own case; appeals require an eligible independent reviewer.'),
        DropdownButtonFormField<String>(initialValue: action, isExpanded: true, items: actions.map((a) => DropdownMenuItem(value: a, child: Text(DisputeModel.label(a)))).toList(), onChanged: (v) => update(() => action = v!)),
        if (action == 'assign') DropdownButtonFormField<String>(initialValue: directory.any((a) => a['uid'] == target) ? target : null, isExpanded: true, decoration: const InputDecoration(labelText: 'Admin (backend verifies independence)'), items: directory.map((a) => DropdownMenuItem(value: a['uid'] as String, child: Text(a['name'] as String))).toList(), onChanged: (v) => target = v!),
        if (action == 'priority') DropdownButtonFormField<String>(initialValue: priority, items: ['urgent', 'high', 'normal', 'low'].map((p) => DropdownMenuItem(value: p, child: Text(p))).toList(), onChanged: (v) => priority = v!),
        if (['duplicate', 'link', 'evidence_decision'].contains(action)) TextField(decoration: InputDecoration(labelText: action == 'evidence_decision' ? 'Evidence ID (from evidence list)' : 'Related/primary case document ID'), onChanged: (v) => evidenceId = v.trim()),
        if (['hold', 'evidence_decision'].contains(action)) CheckboxListTile(title: Text(action == 'hold' ? 'Place retention hold (otherwise release)' : 'Keep restricted (otherwise release restriction)'), value: restrict, onChanged: (v) => update(() => restrict = v!)),
        if (['propose', 'resolve', 'complete_remedy', 'final_decision', 'evidence_decision'].contains(action)) CheckboxListTile(title: Text(action == 'evidence_decision' ? 'Approve permanent sensitive-file deletion (hold must be absent)' : 'Remedy completed OR reasoned determination with no outstanding remedy'), value: completed, onChanged: (v) => update(() => completed = v!)),
        if (['await_staff', 'propose', 'hold', 'enforce_remedy', 'extend_deadline'].contains(action)) TextButton(onPressed: () async {
          final picked = await showDatePicker(context: ctx, initialDate: due, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)));
          if (picked != null) update(() => due = DateTime(picked.year, picked.month, picked.day, 17));
        }, child: Text('Due/review date: ${DisputeModel.date(due.millisecondsSinceEpoch)}')),
        TextField(controller: rationale, maxLines: 5, maxLength: 4000, decoration: InputDecoration(labelText: ['note', 'hold', 'assign', 'priority', 'evidence_decision', 'link'].contains(action) ? 'Private rationale / note' : 'Guest-visible findings / explanation')),
        if (['propose', 'resolve', 'final_decision', 'complete_remedy'].contains(action)) TextField(controller: execution, decoration: const InputDecoration(labelText: 'Financial execution: booking-activity:<id>, external:<reference>, or no-remedy:<basis>')),
        if (['propose', 'resolve', 'final_decision'].contains(action)) TextField(controller: summary, maxLines: 3, decoration: const InputDecoration(labelText: 'Privacy-safe evidence summary (required if evidence restricted)')),
        const Text('Do not put sensitive evidence contents in notes. Independent decisions must include a privacy-safe explanation the affected Guest can answer. No automatic acceptance from silence.'),
      ]))),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Back')), FilledButton(onPressed: () {
        final fields = <String, dynamic>{'text': rationale.text.trim(), 'targetUid': target, 'priority': priority, 'dueAt': due.millisecondsSinceEpoch, 'completed': completed, 'restricted': restrict, 'outcome': c.data['withdrawal_requested'] == true ? 'withdrawn' : 'abandoned', 'executionRef': execution.text.trim(), 'summary': summary.text.trim(), if (['duplicate', 'link'].contains(action)) 'targetCase': evidenceId, if (action == 'evidence_decision') 'evidenceId': evidenceId};
        Navigator.pop(ctx);
        send(c, action, fields);
      }, child: const Text('Confirm action'))],
    )));
    rationale.dispose(); execution.dispose(); summary.dispose();
  }
  @override Widget build(BuildContext context) => StreamBuilder<DisputeModel>(stream: widget.service.streamCase(widget.id), builder: (context, snapshot) {
    if (snapshot.hasError) return Scaffold(appBar: AppBar(), body: Center(child: Text('Case unavailable: ${snapshot.error}')));
    if (!snapshot.hasData) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final c = snapshot.data!;
    return Scaffold(appBar: AppBar(title: Text(c.reference), actions: [IconButton(tooltip: 'Manage case', onPressed: busy ? null : () => manage(c), icon: const Icon(Icons.rule))]), body: ListView(padding: const EdgeInsets.all(16), children: [
      Text('${DisputeModel.label(c.status)} · ${c.priority} · ${c.internal ? 'INTERNAL' : 'Guest-facing'}', style: Theme.of(context).textTheme.titleMedium),
      Text(c.description), Text('Assigned: ${c.assignee ?? 'Unassigned'}\nIndependent reviewer: ${c.reviewer ?? 'Not assigned'}\nDue: ${DisputeModel.date(c.data['due_at'])}'),
      if (c.independent) const Text('Strict independent review. No eligible reviewer means pending—not self-review.'),
      if (c.resolution != null) Card(child: Padding(padding: const EdgeInsets.all(12), child: Text('Findings / resolution:\n${c.resolution}\n${c.data['remedy_pending'] == true ? 'Remedy outstanding' : 'No outstanding remedy recorded'}'))),
      if (c.bookingId.isNotEmpty) TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => BookingDetailScreen(bookingId: c.bookingId))), child: const Text('Inspect Booking / existing payment and refund workflow')),
      if (c.internal) TextButton(onPressed: busy ? null : () => _createCase(context, widget.service, source: c), child: const Text('Share a deliberate guest-facing summary')),
      StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(stream: widget.service.privateRecord(c.id), builder: (context, snap) {
        final p = snap.data?.data();
        return Text('PRIVATE · Hold: ${p?['hold'] == true ? 'Yes; review ${DisputeModel.date(p?['hold_review_at'])}' : 'No'}\nExceptional reopening requested: ${p?['reopening_requested'] == true ? p?['request_reason'] : 'No'}');
      }),
      const Divider(), const Text('Evidence — authenticated access; downloads cannot be recalled'),
      StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(stream: widget.service.evidence(c.id), builder: (context, snap) {
        if (snap.hasError) return Text('Evidence unavailable: ${snap.error}');
        return Column(children: (snap.data?.docs ?? []).map((file) => ListTile(title: Text(file.data()['name'].toString()), subtitle: Text('ID: ${file.id}\n${file.data()['restricted'] == true ? 'RESTRICTED · designated access is recorded' : 'Validated'}'), trailing: IconButton(tooltip: 'Download evidence', icon: const Icon(Icons.download), onPressed: busy ? null : () async { try { await widget.service.downloadEvidence(file.id); } catch (e) { if (mounted) setState(() => error = e.toString()); } }))).toList());
      }),
      const Divider(), const Text('Case Activity log'),
      StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(stream: widget.service.activity(c.id), builder: (context, snap) {
        if (snap.hasError) return Text('Activity unavailable: ${snap.error}');
        final docs = snap.data?.docs ?? [];
        final all = {for (final d in olderActivity) d.id: d, for (final d in docs) d.id: d}.values.toList()..sort((a, b) => ((a.data()['created_at'] as num?) ?? 0).compareTo((b.data()['created_at'] as num?) ?? 0));
        return Column(children: [for (final doc in all) ListTile(title: Text(DisputeModel.label(doc.data()['action'].toString())), subtitle: Text('${DisputeModel.date(doc.data()['created_at'])} · ${doc.data()['actor_role']}\n${doc.data()['text'] ?? ''}')),
          if (docs.length == 40) TextButton(onPressed: () async { try { final cursor = olderActivity.isEmpty ? docs.last : olderActivity.last; final page = await widget.service.olderActivity(c.id, cursor); if (mounted) setState(() => olderActivity.addAll(page.docs)); } catch (e) { if (mounted) setState(() => error = e.toString()); } }, child: const Text('Load older activity')),
        ]);
      }),
      const Divider(), const Text('PRIVATE Admin notes — never sent to Guest queries'),
      StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(stream: widget.service.notes(c.id), builder: (context, snap) => Column(children: (snap.data?.docs ?? []).map((doc) => ListTile(title: Text(doc.data()['text'].toString()), subtitle: Text('${doc.data()['actor_uid']} · ${DisputeModel.date(doc.data()['created_at'])}'))).toList())),
      if (error != null) Text(error!, style: const TextStyle(color: Colors.red)), if (progress.isNotEmpty) Text(progress),
      if (!c.inactive) ...[
        TextField(controller: message, maxLines: 4, maxLength: 4000, decoration: const InputDecoration(labelText: 'Guest-visible message (internal for operational reports)')),
        for (final file in selected) ListTile(title: Text(file.name), trailing: IconButton(tooltip: 'Remove unsent attachment', onPressed: busy ? null : () => setState(() => selected.remove(file)), icon: const Icon(Icons.close))),
        TextButton(onPressed: busy || selected.length >= 5 ? null : () async { try { final file = await CaseFiles.pick(); if (file != null && mounted) setState(() => selected.add(file)); } catch (e) { if (mounted) setState(() => error = e.toString()); } }, child: const Text('Add JPEG / PNG / WebP / PDF (10 MB, five per message)')),
        FilledButton(onPressed: busy ? null : () => send(c, 'message'), child: Text(busy ? 'Checking action…' : 'Send message and evidence')),
      ],
      const Padding(padding: EdgeInsets.only(top: 12), child: Text('Unsent text/files stay in memory only. Leaving this screen loses the draft. Temporary uploads expire after 24 hours. PDF requires configured malware scanning.')),
    ]));
  });
}

class _CaseInbox extends StatefulWidget {
  final DisputeService service; const _CaseInbox({required this.service});
  @override State<_CaseInbox> createState() => _CaseInboxState();
}
class _CaseInboxState extends State<_CaseInbox> {
  List<Map<String, dynamic>> items = []; String? error; Timer? timer;
  @override void initState() { super.initState(); load(); timer = Timer.periodic(const Duration(seconds: 60), (_) => load()); }
  @override void dispose() { timer?.cancel(); super.dispose(); }
  Future<void> load() async { try { final rows = await widget.service.inbox(); if (mounted) setState(() { items = rows; error = null; }); } catch (e) { if (mounted) setState(() => error = e.toString()); } }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Case notifications'), actions: [IconButton(tooltip: 'Refresh inbox', onPressed: load, icon: const Icon(Icons.refresh))]), body: ListView(children: [
    const ListTile(title: Text('Persistent in-app inbox'), subtitle: Text('No email/SMS/background push guarantee. Read state is individual, including shared Admin alerts.')),
    if (error != null) ListTile(title: Text(error!)),
    if (items.length >= 50) TextButton(onPressed: () async { try { final rows = await widget.service.inbox(items.last['id'] as String); if (mounted) setState(() => items = {for (final n in [...items, ...rows]) n['id']: n}.values.toList()); } catch (e) { if (mounted) setState(() => error = e.toString()); } }, child: const Text('Load older notifications')),
    ...items.map((n) => ListTile(title: Text(n['title'].toString()), subtitle: Text('${n['message']}\n${DisputeModel.date(n['created_at'])}'), leading: Icon(n['read'] == true ? Icons.drafts_outlined : Icons.mark_email_unread_outlined), onTap: () async { try { await widget.service.readNotification(n['id'] as String); if (context.mounted) await Navigator.push(context, MaterialPageRoute(builder: (_) => _CaseDetail(id: n['case_id'] as String, service: widget.service))); await load(); } catch (e) { if (mounted) setState(() => error = e.toString()); } })),
  ]));
}
