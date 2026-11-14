package fr.basicpdf.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.core.content.IntentCompat;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Plugin natif Android pour Basic PDF :
 * - Réception des PDF ouverts depuis l'extérieur ou comme lecteur par défaut (ACTION_VIEW / ACTION_SEND)
 * - Enregistrement anti-0 Ko via fichier temporaire vérifié puis copie SAF
 * - Partage natif (WhatsApp, e-mail, etc.) via FileProvider
 * - Appareil photo secours pour le scanner de documents
 * - Vérification facultative des mises à jour GitHub avec contrôle SHA-256
 */
@CapacitorPlugin(
    name = "BasicPdfAndroid",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
    }
)
public class BasicPdfAndroidPlugin extends Plugin {

    private static final String DEFAULT_UPDATE_REPO = "MrTeliot38/Basic-PDF";
    private static final Set<String> ALLOWED_UPDATE_HOSTS = new HashSet<>(
        Arrays.asList(
            "api.github.com",
            "github.com",
            "objects.githubusercontent.com",
            "release-assets.githubusercontent.com"
        )
    );
    private static final Pattern REPO_SLUG_PATTERN = Pattern.compile(
        "^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$"
    );
    private static final Pattern SHA_LINE_PATTERN = Pattern.compile(
        "^([a-fA-F0-9]{64})\\s+\\*?(.+)$"
    );
    private static final Pattern SHA_ONLY_PATTERN = Pattern.compile("^[a-fA-F0-9]{64}$");

    private static final List<JSObject> PENDING_INCOMING = new ArrayList<>();
    private static volatile BasicPdfAndroidPlugin activeInstance;
    private static volatile int lastTopPx = 0;
    private static volatile int lastBottomPx = 0;
    private static volatile int lastImePx = 0;

    private final ExecutorService executor = Executors.newCachedThreadPool();

    private byte[] pendingSaveAsBytes = null;
    private File pendingCameraFile = null;

    @Override
    public void load() {
        super.load();
        activeInstance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    /** Enregistre les marges système/clavier détectées par MainActivity et prévient la WebView */
    public static void updateSystemInsets(int topPx, int bottomPx, int imePx) {
        lastTopPx = Math.max(0, topPx);
        lastBottomPx = Math.max(0, bottomPx);
        lastImePx = Math.max(0, imePx);

        BasicPdfAndroidPlugin inst = activeInstance;
        if (inst != null) {
            JSObject data = new JSObject();
            data.put("topPx", lastTopPx);
            data.put("bottomPx", lastBottomPx);
            data.put("imePx", lastImePx);
            inst.notifyListeners("insetsChanged", data);
        }
    }

    /** Lit immédiatement les PDF reçus d'une autre application avant expiration des permissions URI */
    public static void enqueueIncomingIntent(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri extra = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (extra != null) uris.add(extra);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> extras = IntentCompat.getParcelableArrayListExtra(
                intent,
                Intent.EXTRA_STREAM,
                Uri.class
            );
            if (extras != null) uris.addAll(extras);
        }

        if (uris.isEmpty() && intent.getClipData() != null) {
            ClipData clip = intent.getClipData();
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri u = clip.getItemAt(i).getUri();
                if (u != null && !uris.contains(u)) {
                    uris.add(u);
                }
            }
        }

        if (uris.isEmpty()) return;

        List<JSObject> extracted = new ArrayList<>();
        ContentResolver resolver = context.getContentResolver();
        boolean hasWriteFlag = (intent.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0;

        for (Uri uri : uris) {
            try {
                if (hasWriteFlag && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    try {
                        resolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        );
                    } catch (SecurityException ignored) {
                        // Certains fournisseurs (Gmail, WhatsApp) fournissent des accès temporaires uniquement
                    }
                }

                byte[] bytes = readUriBytesLimited(resolver, uri, 80 * 1024 * 1024);
                if (!hasPdfHeader(bytes)) {
                    continue;
                }

                String fileName = sanitizePdfName(queryDisplayName(resolver, uri));
                JSObject item = new JSObject();
                item.put("uri", uri.toString());
                item.put("fileName", fileName);
                item.put("writable", hasWriteFlag && "content".equalsIgnoreCase(uri.getScheme()));
                item.put("base64Data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                extracted.add(item);
            } catch (Exception ignored) {
                // Ignore un URI inaccessible sans faire planter le démarrage
            }
        }

        if (extracted.isEmpty()) return;

        BasicPdfAndroidPlugin inst = activeInstance;
        if (inst != null && inst.hasListeners("incomingPdfs")) {
            JSObject payload = new JSObject();
            JSArray arr = new JSArray();
            for (JSObject obj : extracted) arr.put(obj);
            payload.put("files", arr);
            inst.notifyListeners("incomingPdfs", payload);
        } else {
            synchronized (PENDING_INCOMING) {
                PENDING_INCOMING.addAll(extracted);
            }
        }
    }

    @PluginMethod
    public void getSystemInsets(PluginCall call) {
        JSObject res = new JSObject();
        res.put("topPx", lastTopPx);
        res.put("bottomPx", lastBottomPx);
        res.put("imePx", lastImePx);
        call.resolve(res);
    }

    @PluginMethod
    public void getPendingIncomingPdfs(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (PENDING_INCOMING) {
            for (JSObject item : PENDING_INCOMING) {
                arr.put(item);
            }
            PENDING_INCOMING.clear();
        }
        JSObject res = new JSObject();
        res.put("files", arr);
        call.resolve(res);
    }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo pInfo = ctx
                .getPackageManager()
                .getPackageInfo(ctx.getPackageName(), 0);
            JSObject res = new JSObject();
            res.put("versionName", pInfo.versionName != null ? pInfo.versionName : "0.1.0");
            res.put("versionCode", (int) PackageInfoCompat.getLongVersionCode(pInfo));
            res.put("sdkInt", Build.VERSION.SDK_INT);
            res.put("defaultUpdateRepo", DEFAULT_UPDATE_REPO);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Impossible de lire les informations de version Android.", e);
        }
    }

    /** Sauvegarde directe sur une URI déjà ouverte : toujours via fichier temporaire anti-0 Ko */
    @PluginMethod
    public void savePdfDirect(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String base64 = call.getString("base64Data", "");
        String fileName = sanitizePdfName(call.getString("fileName", "document.pdf"));

        if (uriStr.isEmpty() || base64.isEmpty()) {
            JSObject needsPicker = new JSObject();
            needsPicker.put("ok", false);
            needsPicker.put("needsSaveAs", true);
            call.resolve(needsPicker);
            return;
        }

        executor.execute(() -> {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (!hasPdfHeader(bytes)) {
                    JSObject bad = new JSObject();
                    bad.put("ok", false);
                    bad.put("error", "Le document PDF généré est vide ou invalide.");
                    call.resolve(bad);
                    return;
                }

                Uri destUri = Uri.parse(uriStr);
                long written = writePdfSafelyViaTempFile(getContext(), destUri, bytes);

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("uri", uriStr);
                res.put("fileName", fileName);
                res.put("bytesWritten", written);
                call.resolve(res);
            } catch (Exception e) {
                JSObject fallback = new JSObject();
                fallback.put("ok", false);
                fallback.put("needsSaveAs", true);
                fallback.put("error", "Enregistrement direct non autorisé à cet emplacement.");
                call.resolve(fallback);
            }
        });
    }

    /** Ouvre le sélecteur Android (SAF) puis écrit via fichier temporaire vérifié (anti-0 Ko) */
    @PluginMethod
    public void savePdfAs(PluginCall call) {
        String fileName = sanitizePdfName(call.getString("fileName", "document.pdf"));
        String base64 = call.getString("base64Data", "");
        if (base64.isEmpty()) {
            call.reject("Aucune donnée PDF à enregistrer.");
            return;
        }

        byte[] decoded = Base64.decode(base64, Base64.DEFAULT);
        if (!hasPdfHeader(decoded)) {
            call.reject("Document PDF invalide ou vide (0 Ko).");
            return;
        }

        pendingSaveAsBytes = decoded;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "onSavePdfAsResult");
    }

    @ActivityCallback
    private void onSavePdfAsResult(PluginCall call, ActivityResult result) {
        byte[] bytes = pendingSaveAsBytes;
        pendingSaveAsBytes = null;

        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject canceled = new JSObject();
            canceled.put("ok", false);
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }

        Uri destUri = result.getData().getData();
        if (destUri == null || bytes == null || bytes.length == 0) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("error", "Destination invalide ou document vide.");
            call.resolve(err);
            return;
        }

        executor.execute(() -> {
            try {
                long written = writePdfSafelyViaTempFile(getContext(), destUri, bytes);
                try {
                    getContext()
                        .getContentResolver()
                        .takePersistableUriPermission(
                            destUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        );
                } catch (SecurityException ignored) {
                    // Autorisation facultative selon le fournisseur de stockage
                }

                String savedName = sanitizePdfName(
                    queryDisplayName(getContext().getContentResolver(), destUri)
                );
                JSObject ok = new JSObject();
                ok.put("ok", true);
                ok.put("uri", destUri.toString());
                ok.put("fileName", savedName);
                ok.put("bytesWritten", written);
                call.resolve(ok);
            } catch (Exception e) {
                JSObject err = new JSObject();
                err.put(
                    "ok",
                    false
                );
                err.put(
                    "error",
                    "Échec de l’écriture sur l’appareil (protection anti-fichier vide) : " +
                    e.getMessage()
                );
                call.resolve(err);
            }
        });
    }

    /** Partage le PDF par WhatsApp, Gmail ou toute appli Android via FileProvider */
    @PluginMethod
    public void sharePdf(PluginCall call) {
        String fileName = sanitizePdfName(call.getString("fileName", "document.pdf"));
        String base64 = call.getString("base64Data", "");
        if (base64.isEmpty()) {
            call.reject("Aucune donnée PDF à partager.");
            return;
        }

        executor.execute(() -> {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (!hasPdfHeader(bytes)) {
                    JSObject bad = new JSObject();
                    bad.put("ok", false);
                    bad.put("error", "Le PDF à partager est vide ou invalide.");
                    call.resolve(bad);
                    return;
                }

                File shareDir = new File(getContext().getCacheDir(), "shared");
                if (!shareDir.exists() && !shareDir.mkdirs()) {
                    throw new IOException("Dossier temporaire indisponible.");
                }

                File outFile = new File(shareDir, fileName);
                writeBytesAtomicallyToFile(outFile, bytes);

                Uri contentUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    outFile
                );

                Intent sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.setType("application/pdf");
                sendIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                sendIntent.putExtra(Intent.EXTRA_SUBJECT, fileName);
                sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(sendIntent, "Partager le PDF");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(chooser);

                JSObject ok = new JSObject();
                ok.put("ok", true);
                call.resolve(ok);
            } catch (Exception e) {
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("error", "Impossible d’ouvrir le menu de partage Android.");
                call.resolve(err);
            }
        });
    }

    @PluginMethod
    public void requestCameraPermission(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
            return;
        }
        requestPermissionForAlias("camera", call, "cameraPermissionCallback");
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", getPermissionState("camera") == PermissionState.GRANTED);
        call.resolve(res);
    }

    /** Secours natif Android pour capturer une page via l'appareil photo système */
    @PluginMethod
    public void captureDocumentPhoto(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraBeforePhotoCallback");
            return;
        }
        launchCameraCaptureIntent(call);
    }

    @PermissionCallback
    private void cameraBeforePhotoCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            launchCameraCaptureIntent(call);
        } else {
            JSObject denied = new JSObject();
            denied.put("error", "Permission caméra refusée dans les réglages Android.");
            call.resolve(denied);
        }
    }

    private void launchCameraCaptureIntent(PluginCall call) {
        try {
            File camDir = new File(getContext().getCacheDir(), "camera");
            if (!camDir.exists() && !camDir.mkdirs()) {
                throw new IOException("Dossier caméra indisponible.");
            }
            File photoFile = new File(camDir, "scan_" + UUID.randomUUID() + ".jpg");
            pendingCameraFile = photoFile;

            Uri photoUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                photoFile
            );

            Intent camIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            camIntent.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);
            camIntent.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
            startActivityForResult(call, camIntent, "onCameraPhotoResult");
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("error", "Impossible d’ouvrir l’appareil photo Android.");
            call.resolve(err);
        }
    }

    @ActivityCallback
    private void onCameraPhotoResult(PluginCall call, ActivityResult result) {
        File photoFile = pendingCameraFile;
        pendingCameraFile = null;

        if (call == null) return;
        if (
            result.getResultCode() != Activity.RESULT_OK ||
            photoFile == null ||
            !photoFile.exists() ||
            photoFile.length() == 0
        ) {
            if (photoFile != null && photoFile.exists()) {
                photoFile.delete();
            }
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }

        executor.execute(() -> {
            try {
                String dataUrl = loadOrientedJpegDataUrl(photoFile, 2400);
                JSObject res = new JSObject();
                res.put("imageDataUrl", dataUrl);
                call.resolve(res);
            } catch (Exception e) {
                JSObject err = new JSObject();
                err.put("error", "Impossible de lire la photo capturée.");
                call.resolve(err);
            } finally {
                photoFile.delete();
            }
        });
    }

    @PluginMethod
    public void openDefaultAppsSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                intent = new Intent(Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                intent = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ok = new JSObject();
            ok.put("opened", true);
            call.resolve(ok);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                JSObject ok = new JSObject();
                ok.put("opened", true);
                call.resolve(ok);
            } catch (Exception inner) {
                JSObject fail = new JSObject();
                fail.put("opened", false);
                call.resolve(fail);
            }
        }
    }

    /** Vérification strictement manuelle sur GitHub Releases (jamais automatique) */
    @PluginMethod
    public void checkForUpdates(PluginCall call) {
        String rawSlug = call.getString("repoSlug", DEFAULT_UPDATE_REPO);
        String slug = sanitizeRepoSlug(rawSlug != null ? rawSlug : DEFAULT_UPDATE_REPO);
        if (slug == null) {
            call.reject("Dépôt GitHub invalide (exemple attendu : MrTeliot38/Basic-PDF).");
            return;
        }

        executor.execute(() -> {
            try {
                PackageInfo pInfo = getContext()
                    .getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
                String currentVer = pInfo.versionName != null ? pInfo.versionName : "0.1.0";
                int currentCode = (int) PackageInfoCompat.getLongVersionCode(pInfo);

                String apiUrl = "https://api.github.com/repos/" + slug + "/releases/latest";
                String jsonText = new String(
                    downloadBytesFromAllowedHttps(apiUrl, "application/vnd.github+json"),
                    StandardCharsets.UTF_8
                );
                JSONObject release = new JSONObject(jsonText);
                String tag = release.optString("tag_name", currentVer);
                String latestVer = tag.replaceFirst("^[vV]", "");
                Integer latestCode = tryComputeVersionCode(latestVer);
                boolean updateAvailable =
                    (latestCode != null && latestCode > currentCode) ||
                    compareSemver(latestVer, currentVer) > 0;

                String apkUrl = null;
                String apkName = null;
                String sumsUrl = null;
                String sidecarShaUrl = null;

                JSONArray assets = release.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.optJSONObject(i);
                        if (asset == null) continue;
                        String name = asset.optString("name", "");
                        String dl = asset.optString("browser_download_url", "");
                        String lower = name.toLowerCase(Locale.ROOT);
                        if (lower.endsWith(".apk") && isAllowedHttpsUrl(dl)) {
                            apkUrl = dl;
                            apkName = name;
                        } else if ("sha256sums.txt".equals(lower) && isAllowedHttpsUrl(dl)) {
                            sumsUrl = dl;
                        } else if (lower.endsWith(".apk.sha256") && isAllowedHttpsUrl(dl)) {
                            sidecarShaUrl = dl;
                        }
                    }
                }

                String expectedSha = null;
                if (apkName != null) {
                    if (sidecarShaUrl != null) {
                        String sidecarText = new String(
                            downloadBytesFromAllowedHttps(sidecarShaUrl, "*/*"),
                            StandardCharsets.UTF_8
                        );
                        expectedSha = extractShaFromSums(sidecarText, apkName);
                    }
                    if (expectedSha == null && sumsUrl != null) {
                        String sumsText = new String(
                            downloadBytesFromAllowedHttps(sumsUrl, "*/*"),
                            StandardCharsets.UTF_8
                        );
                        expectedSha = extractShaFromSums(sumsText, apkName);
                    }
                }

                JSObject res = new JSObject();
                res.put("currentVersion", currentVer);
                res.put("currentVersionCode", currentCode);
                res.put("latestVersion", latestVer);
                if (latestCode != null) res.put("latestVersionCode", latestCode);
                res.put("updateAvailable", updateAvailable);
                res.put("apkUrl", apkUrl);
                res.put("apkFileName", apkName);
                res.put("expectedSha256", expectedSha);
                res.put("releaseNotes", release.optString("body", ""));
                res.put("releasePageUrl", release.optString("html_url", ""));
                call.resolve(res);
            } catch (Exception e) {
                call.reject(
                    "Impossible de vérifier les mises à jour sur GitHub pour ce dépôt.",
                    e
                );
            }
        });
    }

    /** Télécharge l'APK depuis GitHub, vérifie son SHA-256 bit à bit, puis lance l'installateur */
    @PluginMethod
    public void downloadAndInstallUpdate(PluginCall call) {
        String apkUrl = call.getString("apkUrl", "");
        String apkFileName = call.getString("apkFileName", "basic-pdf-update.apk");
        String expectedSha = call.getString("expectedSha256", "");

        if (!isAllowedHttpsUrl(apkUrl)) {
            call.reject("URL de téléchargement refusée (domaine non officiel GitHub).");
            return;
        }
        if (expectedSha == null || !SHA_ONLY_PATTERN.matcher(expectedSha.trim()).matches()) {
            call.reject("Empreinte SHA-256 attendue absente ou invalide.");
            return;
        }

        executor.execute(() -> {
            File partFile = null;
            try {
                byte[] apkBytes = downloadBytesFromAllowedHttps(apkUrl, "application/octet-stream");
                if (apkBytes.length == 0) {
                    throw new IOException("APK téléchargé vide (0 Ko).");
                }

                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                byte[] actualHash = digest.digest(apkBytes);
                byte[] expectedHash = hexToBytes(expectedSha.trim().toLowerCase(Locale.ROOT));
                if (!MessageDigest.isEqual(actualHash, expectedHash)) {
                    throw new SecurityException(
                        "Contrôle SHA-256 échoué : le fichier APK a été altéré ou corrompu."
                    );
                }

                String safeApkName = new File(apkFileName).getName().replaceAll("[^a-zA-Z0-9._-]", "_");
                if (!safeApkName.toLowerCase(Locale.ROOT).endsWith(".apk")) {
                    safeApkName = safeApkName + ".apk";
                }

                File updDir = new File(getContext().getCacheDir(), "updates");
                if (!updDir.exists() && !updDir.mkdirs()) {
                    throw new IOException("Dossier de mise à jour indisponible.");
                }

                partFile = new File(updDir, safeApkName + ".part");
                File finalApk = new File(updDir, safeApkName);
                writeBytesAtomicallyToFile(partFile, apkBytes);
                if (finalApk.exists()) {
                    finalApk.delete();
                }
                if (!partFile.renameTo(finalApk)) {
                    throw new IOException("Impossible de préparer l'APK vérifié.");
                }

                if (
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                    !getContext().getPackageManager().canRequestPackageInstalls()
                ) {
                    Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    permIntent.setData(Uri.parse("package:" + getContext().getPackageName()));
                    permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(permIntent);

                    JSObject needPerm = new JSObject();
                    needPerm.put("ok", true);
                    needPerm.put("needsUnknownSourcePermission", true);
                    needPerm.put("actualSha256", bytesToHex(actualHash));
                    needPerm.put("apkPath", finalApk.getAbsolutePath());
                    call.resolve(needPerm);
                    return;
                }

                Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    finalApk
                );
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK
                );
                getActivity().startActivity(installIntent);

                JSObject ok = new JSObject();
                ok.put("ok", true);
                ok.put("installerLaunched", true);
                ok.put("actualSha256", bytesToHex(actualHash));
                ok.put("apkPath", finalApk.getAbsolutePath());
                call.resolve(ok);
            } catch (Exception e) {
                if (partFile != null && partFile.exists()) {
                    partFile.delete();
                }
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("error", e.getMessage());
                call.resolve(err);
            }
        });
    }

    /**
     * Écriture double passe anti-0 Ko :
     * 1) Écrit et synchronise (fsync) le PDF complet dans un fichier cache local privé
     * 2) Vérifie taille > 0 puis copie vers l'URI SAF finale et vérifie le volume écrit
     */
    private static long writePdfSafelyViaTempFile(Context context, Uri destUri, byte[] bytes)
        throws IOException {
        if (bytes == null || bytes.length == 0) {
            throw new IOException("PDF vide refusé (0 Ko).");
        }
        File tempFile = new File(
            context.getCacheDir(),
            "save_tmp_" + UUID.randomUUID().toString() + ".pdf"
        );
        try {
            writeBytesAtomicallyToFile(tempFile, bytes);
            if (!tempFile.exists() || tempFile.length() != bytes.length || tempFile.length() == 0) {
                throw new IOException("Échec de vérification du fichier temporaire.");
            }

            ContentResolver cr = context.getContentResolver();
            long copied = 0;
            OutputStream rawOut;
            try {
                rawOut = cr.openOutputStream(destUri, "wt");
            } catch (Exception modeEx) {
                rawOut = cr.openOutputStream(destUri, "w");
            }
            if (rawOut == null) {
                throw new IOException("Flux d'écriture Android indisponible.");
            }

            try (
                InputStream in = new BufferedInputStream(new FileInputStream(tempFile));
                OutputStream out = rawOut
            ) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    copied += n;
                }
                out.flush();
            }

            if (copied != bytes.length || copied == 0) {
                throw new IOException("Écriture incomplète (" + copied + " octets).");
            }

            try (AssetFileDescriptor afd = cr.openAssetFileDescriptor(destUri, "r")) {
                if (afd != null && afd.getLength() == 0) {
                    throw new IOException("Le fichier enregistré est resté à 0 Ko.");
                }
            } catch (IOException checkEx) {
                throw checkEx;
            } catch (Exception ignored) {
                // Certains fournisseurs virtuels refusent stat en lecture juste après fermeture
            }

            return copied;
        } finally {
            if (tempFile.exists()) {
                tempFile.delete();
            }
        }
    }

    private static void writeBytesAtomicallyToFile(File destFile, byte[] bytes) throws IOException {
        try (FileOutputStream fos = new FileOutputStream(destFile, false)) {
            fos.write(bytes);
            fos.flush();
            try {
                fos.getFD().sync();
            } catch (Exception ignored) {
                // Sync matériel selon système de fichiers
            }
        }
    }

    private static boolean hasPdfHeader(byte[] bytes) {
        return (
            bytes != null &&
            bytes.length >= 5 &&
            bytes[0] == '%' &&
            bytes[1] == 'P' &&
            bytes[2] == 'D' &&
            bytes[3] == 'F' &&
            bytes[4] == '-'
        );
    }

    private static byte[] readUriBytesLimited(ContentResolver cr, Uri uri, int maxBytes)
        throws IOException {
        try (
            InputStream in = cr.openInputStream(uri);
            ByteArrayOutputStream out = new ByteArrayOutputStream()
        ) {
            if (in == null) return new byte[0];
            byte[] buf = new byte[16384];
            int total = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > maxBytes) {
                    throw new IOException("Fichier PDF trop volumineux (> 80 Mo).");
                }
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static String queryDisplayName(ContentResolver cr, Uri uri) {
        if ("content".equalsIgnoreCase(uri.getScheme())) {
            try (
                Cursor c = cr.query(
                    uri,
                    new String[] { OpenableColumns.DISPLAY_NAME },
                    null,
                    null,
                    null
                )
            ) {
                if (c != null && c.moveToFirst()) {
                    int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) {
                        String val = c.getString(idx);
                        if (val != null && !val.trim().isEmpty()) {
                            return val;
                        }
                    }
                }
            } catch (Exception ignored) {
                // Repli vers le segment d'URI
            }
        }
        String last = uri.getLastPathSegment();
        return last != null && !last.trim().isEmpty() ? last : "document.pdf";
    }

    private static String sanitizePdfName(String raw) {
        String cleaned = (raw == null ? "document.pdf" : raw)
            .replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_")
            .trim();
        if (cleaned.isEmpty()) cleaned = "document.pdf";
        if (!cleaned.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
            cleaned = cleaned + ".pdf";
        }
        if (cleaned.length() <= 80) return cleaned;
        return cleaned.substring(0, 76) + ".pdf";
    }

    private static String loadOrientedJpegDataUrl(File file, int maxSidePx) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);

        int inSample = 1;
        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        while (longest / inSample > maxSidePx * 2) {
            inSample *= 2;
        }

        BitmapFactory.Options decodeOpts = new BitmapFactory.Options();
        decodeOpts.inSampleSize = inSample;
        Bitmap bmp = BitmapFactory.decodeFile(file.getAbsolutePath(), decodeOpts);
        if (bmp == null) throw new IOException("Bitmap illisible.");

        int rotation = 0;
        try {
            ExifInterface exif = new ExifInterface(file.getAbsolutePath());
            int orient = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            );
            if (orient == ExifInterface.ORIENTATION_ROTATE_90) rotation = 90;
            else if (orient == ExifInterface.ORIENTATION_ROTATE_180) rotation = 180;
            else if (orient == ExifInterface.ORIENTATION_ROTATE_270) rotation = 270;
        } catch (Exception ignored) {
            // Garde l'orientation brute si EXIF absent
        }

        Bitmap oriented = bmp;
        if (rotation != 0) {
            Matrix mat = new Matrix();
            mat.postRotate(rotation);
            oriented = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), mat, true);
            if (oriented != bmp) bmp.recycle();
        }

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        oriented.compress(Bitmap.CompressFormat.JPEG, 92, baos);
        oriented.recycle();
        return "data:image/jpeg;base64," + Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
    }

    private static String sanitizeRepoSlug(String raw) {
        String cleaned = raw
            .trim()
            .replaceFirst("^https?://github\\.com/", "")
            .replaceFirst("\\.git$", "")
            .replaceAll("/+$", "");
        return REPO_SLUG_PATTERN.matcher(cleaned).matches() ? cleaned : null;
    }

    private static boolean isAllowedHttpsUrl(String rawUrl) {
        try {
            URL url = new URL(rawUrl);
            return (
                "https".equalsIgnoreCase(url.getProtocol()) &&
                ALLOWED_UPDATE_HOSTS.contains(url.getHost().toLowerCase(Locale.ROOT))
            );
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] downloadBytesFromAllowedHttps(String startUrl, String accept)
        throws IOException {
        String curUrl = startUrl;
        for (int hops = 0; hops < 5; hops++) {
            if (!isAllowedHttpsUrl(curUrl)) {
                throw new SecurityException("Redirection hors domaine GitHub bloquée.");
            }
            HttpURLConnection conn = (HttpURLConnection) new URL(curUrl).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(45000);
            conn.setRequestProperty("Accept", accept);
            conn.setRequestProperty("User-Agent", "Basic-PDF-Android");

            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null) throw new IOException("Redirection vide.");
                curUrl = loc;
                continue;
            }
            if (code < 200 || code >= 300) {
                conn.disconnect();
                throw new IOException("Erreur HTTP GitHub " + code);
            }
            try (
                InputStream in = new BufferedInputStream(conn.getInputStream());
                ByteArrayOutputStream out = new ByteArrayOutputStream()
            ) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
                return out.toByteArray();
            } finally {
                conn.disconnect();
            }
        }
        throw new IOException("Trop de redirections.");
    }

    private static String extractShaFromSums(String content, String targetFileName) {
        String lowerTarget = targetFileName.toLowerCase(Locale.ROOT);
        for (String lineRaw : content.split("\\r?\\n")) {
            String line = lineRaw.trim();
            if (line.isEmpty()) continue;
            Matcher named = SHA_LINE_PATTERN.matcher(line);
            if (named.matches()) {
                String name = new File(named.group(2).trim()).getName().toLowerCase(Locale.ROOT);
                if (name.equals(lowerTarget)) {
                    return named.group(1).toLowerCase(Locale.ROOT);
                }
            } else if (SHA_ONLY_PATTERN.matcher(line).matches()) {
                return line.toLowerCase(Locale.ROOT);
            }
        }
        return null;
    }

    private static Integer tryComputeVersionCode(String version) {
        try {
            String clean = version.replaceFirst("^[vV]", "").split("[-+]")[0];
            String[] parts = clean.split("\\.");
            int major = parts.length > 0 ? Integer.parseInt(parts[0]) : 0;
            int minor = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
            int patch = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
            return major * 10000 + minor * 100 + patch;
        } catch (Exception e) {
            return null;
        }
    }

    private static int compareSemver(String a, String b) {
        String[] pa = a.split("[-+]")[0].split("\\.");
        String[] pb = b.split("[-+]")[0].split("\\.");
        int len = Math.max(pa.length, Math.max(pb.length, 3));
        for (int i = 0; i < len; i++) {
            int va = i < pa.length ? parseIntSafe(pa[i]) : 0;
            int vb = i < pb.length ? parseIntSafe(pb[i]) : 0;
            if (va > vb) return 1;
            if (va < vb) return -1;
        }
        return 0;
    }

    private static int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return 0;
        }
    }

    private static byte[] hexToBytes(String hex) {
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.ROOT, "%02x", b));
        }
        return sb.toString();
    }
}
