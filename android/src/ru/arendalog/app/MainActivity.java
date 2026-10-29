package ru.arendalog.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {

    private static final String APP_HOST = "arendalog.local";
    private static final String APP_URL = "https://" + APP_HOST + "/index.html";
    private static final int FILE_CHOOSER_CODE = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private Uri photoUri;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setBackgroundDrawableResource(android.R.color.black);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 15 (targetSdk 35) принудительно рисует окно под системной строкой состояния,
        // из-за чего часы и значки уведомлений наезжают на заголовок приложения.
        // Добавляем отступы по вставкам системы — содержимое начинается ниже строки состояния.
        applySystemBarInsets(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setBackgroundColor(0xFF0E1116);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && APP_HOST.equals(uri.getHost())) {
                    WebResourceResponse r = serveAsset(uri.getPath());
                    if (r != null) return r;
                    return new WebResourceResponse("text/plain", "UTF-8",
                            new ByteArrayInputStream("not found".getBytes()));
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && APP_HOST.equals(uri.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) { }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;
                photoUri = null;
                try {
                    Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
                    gallery.addCategory(Intent.CATEGORY_OPENABLE);
                    gallery.setType("image/*");

                    // дополнительный пункт «камера»: снимаем сразу в галерею
                    Intent[] extra = new Intent[0];
                    try {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.Images.Media.DISPLAY_NAME, "arendalog_" + System.currentTimeMillis() + ".jpg");
                        cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                        Uri out = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                        if (out != null) {
                            photoUri = out;
                            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                            camera.putExtra(MediaStore.EXTRA_OUTPUT, out);
                            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            extra = new Intent[]{camera};
                        }
                    } catch (Exception ignored) { }

                    Intent chooser = Intent.createChooser(gallery, "Снять фото или выбрать файл");
                    if (extra.length > 0) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra);
                    startActivityForResult(chooser, FILE_CHOOSER_CODE);
                    return true;
                } catch (Exception e) {
                    pendingFileCallback = null;
                    return false;
                }
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    private void applySystemBarInsets(final FrameLayout root) {
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    android.graphics.Insets bars = insets.getInsets(
                            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                    return insets;
                }
            });
        } else {
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                @SuppressWarnings("deprecation")
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                            insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                    return insets;
                }
            });
        }
        root.requestApplyInsets();
    }

    private WebResourceResponse serveAsset(String path) {
        if (path == null) return null;
        String clean = path.startsWith("/") ? path.substring(1) : path;
        int q = clean.indexOf('?');
        if (q >= 0) clean = clean.substring(0, q);
        if (clean.isEmpty()) clean = "index.html";
        try {
            InputStream is = getAssets().open(clean);
            String mime = mimeFor(clean);
            return new WebResourceResponse(mime, "UTF-8", is);
        } catch (Exception e) {
            return null;
        }
    }

    private static String mimeFor(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_CODE) {
            if (pendingFileCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK) {
                    if (data != null && data.getData() != null) {
                        result = new Uri[]{data.getData()};
                    } else if (data != null && data.getClipData() != null) {
                        int n = data.getClipData().getItemCount();
                        result = new Uri[n];
                        for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                    } else if (photoUri != null) {
                        result = new Uri[]{photoUri};
                    }
                }
                pendingFileCallback.onReceiveValue(result);
                pendingFileCallback = null;
                photoUri = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    /* ══════════════ Мост для JS ══════════════ */
    private class AndroidBridge {

        @JavascriptInterface
        public String postBinary(String url, String bodyB64, String contentType) {
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setRequestMethod("POST");
                con.setDoOutput(true);
                con.setConnectTimeout(20000);
                con.setReadTimeout(25000);
                con.setRequestProperty("Content-Type", contentType == null ? "application/timestamp-query" : contentType);
                con.setRequestProperty("Accept", "application/timestamp-reply");
                con.setRequestProperty("User-Agent", "ArendaLog/1.0");
                byte[] body = Base64.decode(bodyB64, Base64.DEFAULT);
                OutputStream os = con.getOutputStream();
                os.write(body);
                os.flush();
                os.close();

                int code = con.getResponseCode();
                InputStream in = (code >= 200 && code < 300) ? con.getInputStream() : con.getErrorStream();
                byte[] resp = readAll(in);
                JSONObject o = new JSONObject();
                if (code >= 200 && code < 300) {
                    o.put("ok", true);
                    o.put("bodyB64", Base64.encodeToString(resp, Base64.NO_WRAP));
                } else {
                    o.put("ok", false);
                    o.put("error", "HTTP " + code);
                }
                o.put("httpCode", code);
                return o.toString();
            } catch (Exception e) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("ok", false);
                    o.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
                    return o.toString();
                } catch (Exception ignored) {
                    return "{\"ok\":false,\"error\":\"network\"}";
                }
            } finally {
                if (con != null) con.disconnect();
            }
        }

        @JavascriptInterface
        public long serverTime() {
            String[] urls = {
                    "https://www.google.com/generate_204",
                    "https://example.com/",
                    "https://cloudflare.com/cdn-cgi/trace"
            };
            for (String u : urls) {
                HttpURLConnection con = null;
                try {
                    con = (HttpURLConnection) new URL(u).openConnection();
                    con.setRequestMethod("HEAD");
                    con.setConnectTimeout(6000);
                    con.setReadTimeout(6000);
                    con.setRequestProperty("User-Agent", "ArendaLog/1.0");
                    con.connect();
                    long t = con.getHeaderFieldDate("Date", 0);
                    if (t > 0) return t;
                } catch (Exception ignored) {
                } finally {
                    if (con != null) con.disconnect();
                }
            }
            return 0;
        }

        @JavascriptInterface
        public String headUrl(String url) {
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setRequestMethod("HEAD");
                con.setConnectTimeout(6000);
                con.setReadTimeout(6000);
                con.connect();
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("date", con.getHeaderFieldDate("Date", 0));
                o.put("code", con.getResponseCode());
                return o.toString();
            } catch (Exception e) {
                return "{\"ok\":false}";
            } finally {
                if (con != null) con.disconnect();
            }
        }

        @JavascriptInterface
        public String saveFile(String name, String b64, String mime) {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                JSONObject o = new JSONObject();
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) throw new Exception("не удалось создать файл");
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    os.write(data);
                    os.flush();
                    os.close();
                    o.put("ok", true);
                    o.put("path", "Загрузки/" + safe);
                    return o.toString();
                }
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) dir = getFilesDir();
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, safe);
                FileOutputStream fos = new FileOutputStream(f);
                fos.write(data);
                fos.flush();
                fos.close();
                JSONObject o2 = new JSONObject();
                o2.put("ok", true);
                o2.put("path", f.getAbsolutePath());
                return o2.toString();
            } catch (Exception e) {
                try {
                    return new JSONObject().put("ok", false).put("error", e.getMessage()).toString();
                } catch (Exception ignored) {
                    return "{\"ok\":false}";
                }
            }
        }

        @JavascriptInterface
        public void printPage() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                        String job = "АрендаЛог";
                        PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(job);
                        pm.print(job, adapter, new PrintAttributes.Builder().build());
                    } catch (Exception ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) v.vibrate(ms);
            } catch (Exception ignored) { }
        }

        /* скачивает APK обновления и открывает системный установщик */
        @JavascriptInterface
        public String installUpdate(final String url) {
            try {
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            final File apk = downloadApk(url);
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    fireInstall(apk);
                                }
                            });
                        } catch (final Exception e) {
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    Toast.makeText(MainActivity.this,
                                            "Не удалось скачать обновление: " + e.getMessage(),
                                            Toast.LENGTH_LONG).show();
                                }
                            });
                        }
                    }
                }).start();
                return "{\"ok\":true}";
            } catch (Exception e) {
                return "{\"ok\":false}";
            }
        }

        private File downloadApk(String url) throws Exception {
            File file = new File(getCacheDir(), "update.apk");
            if (file.exists() && !file.delete()) throw new Exception("файл занят");
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(120000);
            InputStream in = null;
            FileOutputStream out = new FileOutputStream(file);
            try {
                conn.connect();
                in = conn.getInputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            } finally {
                if (in != null) in.close();
                out.close();
                conn.disconnect();
            }
            return file;
        }

        private void fireInstall(File apk) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(
                        Uri.parse("content://" + getPackageName() + ".apk/update.apk"),
                        "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception e) {
                Toast.makeText(MainActivity.this,
                        "Разрешите установку приложений из этого источника и повторите",
                        Toast.LENGTH_LONG).show();
            }
        }

        @JavascriptInterface
        public String deviceInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("android", Build.VERSION.RELEASE);
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("app", "1.0");
                return o.toString();
            } catch (Exception e) {
                return "{\"model\":\"android\"}";
            }
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        if (in == null) return new byte[0];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }
}
