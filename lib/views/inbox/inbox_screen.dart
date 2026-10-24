import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_constants.dart';
import '../../services/auth_store.dart';
import '../../services/chat_attachment_service.dart';
import '../../services/chat_retention.dart';
import '../../services/live_location_service.dart';
import '../security/secure_action_sheet.dart';
import '../../tutorial/tutorial_controller.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/empty_state.dart';
import 'live_location_panel.dart';
import 'private_chat_image.dart';

/// Guest → Admin messages from `conversations/*`.
///
/// The message limit, the page sizes and the collection names are
/// `AppConstants` — the same place `firestore.rules` and the website keep
/// theirs, and the place a test can reach without compiling a screen.

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
                  .collection(AppConstants.colConversations)
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
                      key: i == 0 ? TourKeys.firstThread : null,
                      tileColor: Colors.white,
                      title: Text(d['last_message']?.toString().isNotEmpty == true
                          ? d['last_message'].toString()
                          : 'New conversation'),
                      subtitle: Text('${d['category'] ?? 'booking'} · ${d['guest_uid'] ?? ''}'),
                      trailing: retentionLabel(d[kRetentionField] as Timestamp?),
                      onTap: () {
                        TourBus.event('open-thread');
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => ThreadScreen(convoId: docs[i].id, guestUid: d['guest_uid']?.toString() ?? ''),
                          ),
                        );
                      },
                    );
                  },
                );
              },
            ),
    );
  }

  /// "Kept 89 more days" / "Clearing soon" — the retention stamp, so the
  /// Admin can see which threads are disposable without opening them.
  static Widget? retentionLabel(Object? stamp) {
    if (stamp is! Timestamp) return null;
    final days = retentionDaysLeft(stamp.toDate()) ?? 0;
    final text = days == 0 ? 'clearing soon' : 'kept $days more day${days == 1 ? '' : 's'}';
    return Text(text, style: const TextStyle(fontSize: 11, color: AppColors.textMuted));
  }
}

class ThreadScreen extends StatefulWidget {
  const ThreadScreen({required this.convoId, required this.guestUid});
  final String convoId;
  final String guestUid;

  @override
  State<ThreadScreen> createState() => ThreadScreenState();
}

class ThreadScreenState extends State<ThreadScreen> {
  final _text = TextEditingController();
  final _attachments = ChatAttachmentService();
  ChatImage? _selectedImage;
  String? _imageMessageId;
  String _sendStage = 'idle';
  String? _composerError;

  bool get _sending => _sendStage != 'idle';

  /// The oldest message loaded, and whether anything older exists. Both come
  /// from a read that happened; neither is guessed from a full collection.
  DocumentSnapshot<Map<String, dynamic>>? _oldest;
  bool _hasMore = false;
  bool _loadingOlder = false;
  bool _showLiveLocation = false;
  LiveLocationService? _liveLocation;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  /// Open or close the live-location panel, and — the first time it opens —
  /// make sure this Admin can read the stream at all.
  ///
  /// `firestore.rules` can read `profiles/{uid}.role`; Realtime Database rules
  /// cannot read Firestore, so a Profile-promoted Admin is admitted through a
  /// mirror node that only an address on the bootstrap allowlist may write.
  /// That is `AuthStore.isAllowlisted`, not a second copy of the list.
  Future<void> _toggleLiveLocation() async {
    if (_showLiveLocation) {
      setState(() => _showLiveLocation = false);
      return;
    }
    // Confirm-tier in the gate (ADR-0015): opening the reader is a grant —
    // it says the Admin chose to watch this Guest's position while they
    // share it. Nothing is stored (ADR-0013); the consent is the Guest's.
    final ok = await showSecureConfirm(
      context,
      title: 'Read their live location?',
      body: 'You will see this Guest\'s position for as long as they keep sharing it — up to the 60 minutes they chose. Nothing is written to Firestore, and they can stop at any moment.',
      confirm: 'Open the reader',
    );
    if (!ok || !mounted) return;
    final service = _liveLocation ??= LiveLocationService();
    final auth = context.read<AuthStore>();
    final uid = auth.uid;
    // Register before the panel opens: the panel's first read must not race
    // the mirror write that admits a Profile-promoted Admin.
    if (uid != null && uid.isNotEmpty) {
      await service.registerReader(uid: uid, allowlisted: AuthStore.isAllowlisted(auth.sessionEmail));
    }
    if (!mounted) return;
    setState(() => _showLiveLocation = true);
  }

  CollectionReference<Map<String, dynamic>> get _messages =>
      FirebaseFirestore.instance.collection(AppConstants.colConversations).doc(widget.convoId).collection(AppConstants.subMessages);

  /// Fetch one older page behind the oldest message already on screen.
  ///
  /// A one-shot read, not a growing listener: a page that has been read is
  /// finished with, so there is nothing for it to keep listening for. The live
  /// listener below stays bounded to the newest page.
  Future<void> _loadOlder() async {
    if (_loadingOlder) return;
    setState(() => _loadingOlder = true);
    try {
      Query<Map<String, dynamic>> query = _messages.orderBy('created_at', descending: true).limit(AppConstants.olderPageSize + 1);
      final cursor = _oldest;
      if (cursor != null) query = query.startAfterDocument(cursor);
      final snap = await query.get();
      final docs = snap.docs.take(AppConstants.olderPageSize).toList();
      setState(() {
        if (docs.isNotEmpty) _oldest = docs.last;
        _hasMore = snap.docs.length > AppConstants.olderPageSize;
      });
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not load earlier messages: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  Future<void> _pickImage() async {
    if (_sending) return;
    try {
      final image = await ChatImagePicker.pick();
      if (image != null && mounted) {
        setState(() {
          _selectedImage = image;
          _imageMessageId = null;
          _composerError = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _composerError = chatAttachmentFailure(error));
    }
  }

  Future<void> _send() async {
    final v = _text.text.trim();
    final image = _selectedImage;
    // An image may carry an optional caption. Text-only messages retain the
    // original non-empty rule and the same 1,000-character backend limit.
    if ((v.isEmpty && image == null) || v.length > AppConstants.messageMax || _sending) return;
    final auth = context.read<AuthStore>();
    final uid = auth.uid;
    if (uid == null || uid.isEmpty) return;
    setState(() {
      _sendStage = image == null ? 'sending' : 'uploading';
      _composerError = null;
    });
    try {
      if (image != null) {
        final messageId = _imageMessageId ??= _messages.doc().id;
        final attachment = await _attachments.upload(
          conversationId: widget.convoId,
          messageId: messageId,
          image: image,
        );
        if (mounted) setState(() => _sendStage = 'sending');
        final reference = _messages.doc(messageId);
        final existing = await reference.get();
        if (existing.exists) {
          final data = existing.data();
          final prior = data == null ? null : ChatAttachment.fromMessage(data);
          if (data?['sender_uid'] != uid ||
              data?['sender_role'] != 'admin' ||
              data?['text'] != v ||
              prior?.path != attachment.path) {
            throw StateError('This message id is already in use. Start a new draft.');
          }
        } else {
          await reference.set({
            'sender_uid': uid,
            'sender_role': 'admin',
            'text': v,
            'created_at': FieldValue.serverTimestamp(),
            'attachment': attachment.toMap(),
          });
        }
      } else {
        await _messages.add({
          'sender_uid': uid,
          'sender_role': 'admin',
          'text': v,
          'created_at': FieldValue.serverTimestamp(),
        });
      }
      await FirebaseFirestore.instance.collection(AppConstants.colConversations).doc(widget.convoId).update({
        'updated_at': FieldValue.serverTimestamp(),
        'last_message': (v.isEmpty ? '📷 Photo' : (v.length > 140 ? v.substring(0, 140) : v)),
        'unread_guest': 1,
      });
      _text.clear();
      if (mounted) {
        setState(() {
          _selectedImage = null;
          _imageMessageId = null;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() => _composerError = image == null
            ? 'Message could not be sent. Check the connection and retry.'
            : chatAttachmentFailure(error));
      }
    } finally {
      if (mounted) setState(() => _sendStage = 'idle');
    }
  }

  @override
  Widget build(BuildContext context) {
    final selectedImage = _selectedImage;
    return Scaffold(
      appBar: AppBar(
        title: Text('Thread', style: GoogleFonts.cinzel(fontSize: 16)),
        actions: [
          IconButton(
            tooltip: _showLiveLocation ? 'Close live location' : 'Live location',
            onPressed: _toggleLiveLocation,
            icon: Icon(_showLiveLocation ? Icons.location_off_outlined : Icons.location_on_outlined),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_showLiveLocation)
            LiveLocationPanel(
              conversationId: widget.convoId,
              guestUid: widget.guestUid.isEmpty ? null : widget.guestUid,
              service: _liveLocation,
              onClose: () => setState(() => _showLiveLocation = false),
            ),
          Expanded(
            child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: _messages
                  .orderBy('created_at', descending: true)
                  .limit(AppConstants.threadPageSize + 1)
                  .snapshots(),
              builder: (context, snap) {
                final docs = snap.data?.docs ?? [];
                if (docs.isEmpty) {
                  return const EmptyState(title: 'No messages yet', subtitle: 'Reply below.');
                }
                // The newest page is all this listener carries; the extra
                // document is how it says whether an older page exists, at no
                // extra read.
                final page = docs.take(AppConstants.threadPageSize).toList();
                if (_oldest == null && page.isNotEmpty) {
                  _oldest = page.last;
                  if (docs.length > AppConstants.threadPageSize) _hasMore = true;
                }
                final older = List.generate(_hasMore ? 1 : 0, (_) => _loadOlderButton());
                return ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.all(16),
                  itemCount: page.length + older.length,
                  itemBuilder: (context, i) {
                    if (i >= page.length) return older[i - page.length];
                    final m = page[i].data();
                    final admin = m['sender_role'] == 'admin';
                    final text = m['text']?.toString() ?? '';
                    final attachment = ChatAttachment.fromMessage(m);
                    return Align(
                      alignment: admin ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: EdgeInsets.all(attachment == null ? 12 : 5),
                        color: admin ? AppColors.primaryForest : Colors.white,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (attachment != null)
                              PrivateChatImage(
                                key: ValueKey(attachment.path),
                                attachment: attachment,
                                caption: text.isEmpty ? null : text,
                                service: _attachments,
                              ),
                            if (text.isNotEmpty)
                              Padding(
                                padding: EdgeInsets.fromLTRB(attachment == null ? 0 : 8, attachment == null ? 0 : 8, attachment == null ? 0 : 8, attachment == null ? 0 : 5),
                                child: Text(
                                  text,
                                  style: TextStyle(color: admin ? Colors.white : AppColors.textDark),
                                ),
                              ),
                          ],
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
            child: Column(
              children: [
                if (_composerError != null)
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(10),
                    color: AppColors.alertDangerSurface,
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            _composerError!,
                            style: const TextStyle(color: AppColors.alertDangerText, fontSize: 12),
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _sending ? null : _send,
                          icon: const Icon(Icons.refresh, size: 16),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                if (selectedImage != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceLight,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.cardBorder),
                    ),
                    child: Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.memory(selectedImage.bytes, width: 56, height: 56, fit: BoxFit.cover),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(selectedImage.name, overflow: TextOverflow.ellipsis),
                              const SizedBox(height: 3),
                              Text(
                                _sendStage == 'uploading'
                                    ? 'Uploading privately…'
                                    : _sendStage == 'sending'
                                        ? 'Sending message…'
                                        : '${(selectedImage.bytes.length / 1024).ceil()} KB · ready to send',
                                style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          tooltip: 'Replace attached image',
                          onPressed: _sending ? null : _pickImage,
                          icon: const Icon(Icons.swap_horiz),
                        ),
                        IconButton(
                          tooltip: 'Remove attached image',
                          onPressed: _sending
                              ? null
                              : () => setState(() {
                                    _selectedImage = null;
                                    _imageMessageId = null;
                                    _composerError = null;
                                  }),
                          icon: const Icon(Icons.close),
                        ),
                      ],
                    ),
                  ),
                Row(
                  children: [
                    IconButton(
                      tooltip: selectedImage == null
                          ? 'Attach JPEG, PNG, or WebP (5 MB maximum)'
                          : 'Replace with JPEG, PNG, or WebP (5 MB maximum)',
                      onPressed: _sending ? null : _pickImage,
                      icon: const Icon(Icons.attach_file),
                    ),
                    Expanded(
                      child: TextField(
                        key: TourKeys.threadComposer,
                        controller: _text,
                        enabled: !_sending,
                        maxLength: AppConstants.messageMax,
                        decoration: InputDecoration(hintText: selectedImage == null ? 'Reply' : 'Add a caption'),
                      ),
                    ),
                    IconButton(
                      tooltip: _sendStage == 'uploading' ? 'Uploading image' : 'Send message',
                      onPressed: _sending ? null : _send,
                      icon: _sending
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.send),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// The "there is more above" control. It fetches once per press and holds
  /// no listener afterwards.
  Widget _loadOlderButton() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Center(
        child: TextButton.icon(
          onPressed: _loadingOlder ? null : _loadOlder,
          icon: _loadingOlder
              ? const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.expand_less, size: 16),
          label: Text(_loadingOlder ? 'Loading…' : 'Load earlier messages'),
        ),
      ),
    );
  }
}
