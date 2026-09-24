import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/constants/app_constants.dart';
import '../../widgets/empty_state.dart';

/// Guest ↔ Admin messages from `conversations/*`.
class InboxScreen extends StatelessWidget {
  const InboxScreen({super.key});

  bool get _cloud {
    try {
      return Firebase.apps.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text('Guest messages', style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
      body: !_cloud
          ? const EmptyState(
              icon: Icons.chat_bubble_outline,
              title: 'No Firebase on this device',
              subtitle: 'Connect the Admin app to the same Firebase project as the website to see Guest threads.',
            )
          : StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: FirebaseFirestore.instance
                  .collection('conversations')
                  .orderBy('updated_at', descending: true)
                  .limit(50)
                  .snapshots(),
              builder: (context, snap) {
                if (snap.hasError) {
                  return EmptyState(
                    icon: Icons.error_outline,
                    title: 'Could not load messages',
                    subtitle: '${snap.error}',
                  );
                }
                if (!snap.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final docs = snap.data!.docs;
                if (docs.isEmpty) {
                  return const EmptyState(
                    icon: Icons.chat_bubble_outline,
                    title: 'No open conversations',
                    subtitle: 'When a Guest messages from the website, the thread appears here.',
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: docs.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, i) {
                    final d = docs[i].data();
                    return ListTile(
                      tileColor: Colors.white,
                      title: Text(d['last_message']?.toString().isNotEmpty == true
                          ? d['last_message'].toString()
                          : 'New conversation'),
                      subtitle: Text('${d['category'] ?? 'booking'} · ${d['guest_uid'] ?? ''}'),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => _ThreadScreen(convoId: docs[i].id, guestUid: d['guest_uid']?.toString() ?? ''),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
    );
  }
}

class _ThreadScreen extends StatefulWidget {
  const _ThreadScreen({required this.convoId, required this.guestUid});
  final String convoId;
  final String guestUid;

  @override
  State<_ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends State<_ThreadScreen> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final v = _text.text.trim();
    if (v.isEmpty || v.length > 2000) return;
    final auth = context.read<AuthStore>();
    final uid = auth.uid;
    if (uid == null || uid.isEmpty) return;
    await FirebaseFirestore.instance
        .collection('conversations')
        .doc(widget.convoId)
        .collection('messages')
        .add({
      'sender_uid': uid,
      'sender_role': 'admin',
      'text': v,
      'created_at': FieldValue.serverTimestamp(),
    });
    await FirebaseFirestore.instance.collection('conversations').doc(widget.convoId).update({
      'updated_at': FieldValue.serverTimestamp(),
      'last_message': v.length > 140 ? v.substring(0, 140) : v,
      'unread_guest': 1,
    });
    _text.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Thread', style: GoogleFonts.cinzel(fontSize: 16))),
      body: Column(
        children: [
          Expanded(
            child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: FirebaseFirestore.instance
                  .collection('conversations')
                  .doc(widget.convoId)
                  .collection('messages')
                  .orderBy('created_at', descending: true)
                  .limit(40)
                  .snapshots(),
              builder: (context, snap) {
                final docs = snap.data?.docs ?? [];
                if (docs.isEmpty) {
                  return const EmptyState(title: 'No messages yet', subtitle: 'Reply below.');
                }
                return ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.all(16),
                  itemCount: docs.length,
                  itemBuilder: (context, i) {
                    final m = docs[i].data();
                    final admin = m['sender_role'] == 'admin';
                    return Align(
                      alignment: admin ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        color: admin ? AppColors.primaryForest : Colors.white,
                        child: Text(
                          m['text']?.toString() ?? '',
                          style: TextStyle(color: admin ? Colors.white : AppColors.textDark),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _text,
                    decoration: const InputDecoration(hintText: 'Reply'),
                  ),
                ),
                IconButton(onPressed: _send, icon: const Icon(Icons.send)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
