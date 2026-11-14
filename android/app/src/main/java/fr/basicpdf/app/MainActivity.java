package fr.basicpdf.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Activité principale Android de Basic PDF :
 * - Enregistre le plugin natif avant initialisation Capacitor
 * - Traite les intentions PDF (lecteur par défaut + partage depuis WhatsApp/Gmail)
 * - Isole strictement la WebView en local (aucun accès réseau externe depuis la page)
 * - Applique les marges barre d'état / navigation / clavier virtuel pour éviter tout chevauchement
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BasicPdfAndroidPlugin.class);
        super.onCreate(savedInstanceState);

        // Sécurisation WebView : refuse toute requête réseau externe initiée depuis la page web locale
        if (this.bridge != null) {
            this.bridge.setWebViewClient(new BridgeWebViewClient(this.bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
                ) {
                    if (request != null && request.getUrl() != null) {
                        String scheme = request.getUrl().getScheme();
                        String host = request.getUrl().getHost();
                        if (
                            ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) &&
                            host != null &&
                            !"basicpdf.local".equalsIgnoreCase(host.toLowerCase(Locale.ROOT)) &&
                            !"localhost".equalsIgnoreCase(host.toLowerCase(Locale.ROOT))
                        ) {
                            return new WebResourceResponse(
                                "text/plain",
                                "utf-8",
                                403,
                                "Acces reseau bloque (mode hors ligne)",
                                null,
                                new ByteArrayInputStream("".getBytes(StandardCharsets.UTF_8))
                            );
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }
            });
        }

        // Protection contre le chevauchement barre d'état / barre de navigation / clavier virtuel
        View rootContent = findViewById(android.R.id.content);
        if (rootContent != null) {
            float density = getResources().getDisplayMetrics().density;
            ViewCompat.setOnApplyWindowInsetsListener(rootContent, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() |
                        WindowInsetsCompat.Type.displayCutout()
                );
                Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

                int bottomPadding = Math.max(bars.bottom, ime.bottom);
                view.setPadding(bars.left, bars.top, bars.right, bottomPadding);

                // Signale uniquement les éventuels ajustements clavier à l'interface React
                int imeDp = Math.max(0, Math.round((ime.bottom - bars.bottom) / Math.max(1f, density)));
                BasicPdfAndroidPlugin.updateSystemInsets(0, 0, imeDp);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(rootContent);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        BasicPdfAndroidPlugin.enqueueIncomingIntent(this, intent);
    }
}
