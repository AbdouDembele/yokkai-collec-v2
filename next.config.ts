import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const supabaseImageOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
  : undefined;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.100.20", "192.168.1.16"],
  poweredByHeader: false,
  images: {
    qualities: [75, 85], // Keep cached fronts' quality-75 requests valid.
    remotePatterns:
      supabaseImageOrigin?.protocol === "https:"
        ? [
            new URL(
              "/storage/v1/object/public/card-images/**",
              supabaseImageOrigin
            )
          ]
        : [],
    maximumRedirects: 0
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb"
    }
  },
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origin = supabase ? new URL(supabase).origin : "";
    const connections = [
      origin,
      origin.replace(/^http/, "ws"),
      "https://api.giphy.com",
      "https://cloudflareinsights.com"
    ].filter(Boolean);
    // Static Next.js pages need inline hydration scripts and inline component styles.
    // Keep an explicit staging switch for hosts that have not validated the
    // enforced policy yet. Production enables CSP_ENFORCE at build time.
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://static.cloudflareinsights.com https://challenges.cloudflare.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `connect-src 'self' ${connections.join(" ")}${isDev ? " ws:" : ""}`,
      // Catalogue sources vary; custom images and share downloads also use HTTPS/blob/data.
      "img-src 'self' https: data: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-src https://challenges.cloudflare.com",
      // report-uri for Firefox/Safari; report-to (Reporting API) for Chromium.
      "report-uri /api/security/csp-report",
      "report-to csp-endpoint"
    ].join("; ");
    const site = process.env.NEXT_PUBLIC_SITE_URL;
    const reportEndpoint = `${site?.startsWith("https://") ? new URL(site).origin : ""}/api/security/csp-report`;
    const enforced = [
      csp
        .replace(" https://fonts.googleapis.com", "")
        .replace(" https://fonts.gstatic.com", ""),
      "script-src-attr 'none'",
      "frame-ancestors 'none'"
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: csp },
          {
            key: "Reporting-Endpoints",
            value: `csp-endpoint="${reportEndpoint}"`
          },
          ...(process.env.CSP_ENFORCE === "true"
            ? [{ key: "Content-Security-Policy", value: enforced }]
            : []),
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
          }
        ]
      },
      {
        // GoTrue fetches these templates; Cloudflare only injects scripts into text/html.
        source: "/auth-emails/:path*",
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }]
      },
      {
        source: "/share/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]
      }
    ];
  }
};

export default createNextIntlPlugin()(nextConfig);
