package com.infinitenote.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import java.io.InputStream;

/**
 * Bundled-site launcher (issue #64): serves the static web export from the
 * APK assets through {@link WebViewAssetLoader} on the reserved
 * {@code appassets.androidplatform.net} origin, so the app renders with NO
 * network at all — the F-Droid offline-compliance requirement.
 *
 * Prerequisite: the static export must be synced into
 * {@code app/src/main/assets/www/} (the Gradle {@code syncWebAssets} task
 * copies the repo-root {@code out/} directory produced by
 * {@code bun run build:desktop}). When the assets are missing — e.g. a
 * source-only build without the bun toolchain — the activity falls back to
 * the deployed PWA origin and behaves like the classic online TWA.
 *
 * Storage note: IndexedDB and localStorage are served by the WebView's own
 * profile on the asset origin, so all note data stays inside the app's
 * sandbox — same local-first guarantee as the web app.
 */
public class BundledSiteActivity extends Activity {

    /** Reserved origin androidx.webkit serves APK assets from. */
    static final String ASSET_ORIGIN = "https://appassets.androidplatform.net";

    /** Deployed PWA — also the fallback URL when no assets were synced. */
    static final String LIVE_ORIGIN = "https://shalosi00.github.io/infinitenote/";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // Serve every same-origin request from the APK assets.
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && host.equals("appassets.androidplatform.net")) {
                    return false; // bundled site — keep navigating locally
                }
                // Everything else (external links, mailto:, …) leaves the app.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // no handler for the scheme — nothing sensible to do
                }
                return true;
            }
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // IndexedDB + localStorage
        settings.setDatabaseEnabled(true);
        // The only content source is the asset loader; direct file/content
        // access stays off.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        setContentView(webView);

        if (hasBundledSite()) {
            webView.loadUrl(ASSET_ORIGIN + "/index.html");
        } else {
            webView.loadUrl(LIVE_ORIGIN);
        }
    }

    /** True when the static export was synced into the APK assets. */
    private boolean hasBundledSite() {
        try (InputStream in = getAssets().open("www/index.html")) {
            return true;
        } catch (Exception e) {
            return false;
        }
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
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
