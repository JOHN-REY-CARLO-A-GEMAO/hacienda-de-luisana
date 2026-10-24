package com.haciendadeluisana.client2;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodChannel;

/** Per-image Android Storage Access Framework picker; no storage permission. */
public class MainActivity extends FlutterActivity {
    private static final int PICK = 7411, LIMIT = 5 * 1024 * 1024;
    private MethodChannel.Result pending;

    @Override public void configureFlutterEngine(FlutterEngine engine) {
        super.configureFlutterEngine(engine);
        new MethodChannel(engine.getDartExecutor().getBinaryMessenger(), "hacienda/message-attachments").setMethodCallHandler((call, result) -> {
            if (pending != null) { result.error("BUSY", "Finish the current image selection first.", null); return; }
            if (!call.method.equals("pick")) { result.notImplemented(); return; }
            try {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp"});
                pending = result;
                startActivityForResult(intent, PICK);
            } catch (Exception e) {
                pending = null;
                result.error("IMAGE", "Image selection is unavailable.", null);
            }
        });
    }

    @Override public void onActivityResult(int request, int status, Intent data) {
        super.onActivityResult(request, status, data);
        if (request != PICK || pending == null) return;
        MethodChannel.Result result = pending;
        pending = null;
        if (status != Activity.RESULT_OK || data == null || data.getData() == null) {
            result.success(null);
            return;
        }
        Uri uri = data.getData();
        try {
            String name = "image";
            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (column >= 0) name = cursor.getString(column);
                }
            }
            String type = getContentResolver().getType(uri);
            try (InputStream in = getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                if (in == null) throw new IllegalArgumentException();
                byte[] buffer = new byte[65536];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (out.size() + read > LIMIT) throw new IllegalArgumentException();
                    out.write(buffer, 0, read);
                }
                Map<String, Object> image = new HashMap<>();
                image.put("name", name);
                // Some document providers cannot supply a MIME type. Preserve
                // that as empty so Dart may use its allowlisted suffix fallback;
                // an explicitly unsupported type is still rejected.
                image.put("type", type == null ? "" : type);
                image.put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                result.success(image);
            }
        } catch (Exception e) {
            result.error("IMAGE", "Could not read the selected image (maximum 5 MB).", null);
        }
    }
}
