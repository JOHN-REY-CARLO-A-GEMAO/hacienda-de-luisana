package com.haciendadeluisana.client2;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodChannel;

/** Android Storage Access Framework: user selects individual files, no storage permission. */
public class MainActivity extends FlutterActivity {
    private static final int PICK = 7411, SAVE = 7412, LIMIT = 10 * 1024 * 1024;
    private MethodChannel.Result pending;
    private byte[] pendingSave;
    @Override public void configureFlutterEngine(FlutterEngine engine) {
        super.configureFlutterEngine(engine);
        new MethodChannel(engine.getDartExecutor().getBinaryMessenger(), "hacienda/case-files").setMethodCallHandler((call, result) -> {
            if (pending != null) { result.error("BUSY", "Finish the current file selection first.", null); return; }
            try {
                if (call.method.equals("pick")) {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp", "application/pdf"});
                    pending = result; startActivityForResult(intent, PICK);
                } else if (call.method.equals("save")) {
                    pendingSave = Base64.decode((String) call.argument("base64"), Base64.DEFAULT);
                    if (pendingSave.length > LIMIT) throw new IllegalArgumentException("File too large");
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType((String) call.argument("type"));
                    intent.putExtra(Intent.EXTRA_TITLE, (String) call.argument("name"));
                    pending = result; startActivityForResult(intent, SAVE);
                } else result.notImplemented();
            } catch (Exception e) { pending = null; pendingSave = null; result.error("FILE", "File selection is unavailable.", null); }
        });
    }
    @Override public void onActivityResult(int request, int status, Intent data) {
        super.onActivityResult(request, status, data);
        if ((request != PICK && request != SAVE) || pending == null) return;
        MethodChannel.Result result = pending; pending = null;
        if (status != Activity.RESULT_OK || data == null || data.getData() == null) { pendingSave = null; result.success(null); return; }
        Uri uri = data.getData();
        try {
            if (request == SAVE) {
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null || pendingSave == null) throw new IllegalArgumentException();
                    out.write(pendingSave);
                }
                result.success(true);
            } else {
                String name = "evidence";
                try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (column >= 0) name = cursor.getString(column);
                    }
                }
                String type = getContentResolver().getType(uri);
                try (InputStream in = getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    if (in == null) throw new IllegalArgumentException();
                    byte[] buffer = new byte[65536]; int read;
                    while ((read = in.read(buffer)) != -1) { if (out.size() + read > LIMIT) throw new IllegalArgumentException(); out.write(buffer, 0, read); }
                    Map<String, Object> file = new HashMap<>();
                    file.put("name", name); file.put("type", type == null ? "application/octet-stream" : type);
                    file.put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)); result.success(file);
                }
            }
        } catch (Exception e) { result.error("FILE", "Could not read/write the selected file (maximum 10 MB).", null); }
        finally { pendingSave = null; }
    }
}
