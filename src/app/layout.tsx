import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Manrope, Tiro_Devanagari_Hindi } from "next/font/google";
import { connection } from "next/server";
import { BottomBar, MobileTopBar } from "@/components/shell/BottomBar";
import { Sidebar } from "@/components/shell/Sidebar";
import { THEME_INIT_SCRIPT } from "@/components/shell/theme-script";
import { ToastProvider } from "@/components/ui/Toast";
import { APP_NAME, brand } from "@/lib/brand";
import { getPublicConfig } from "@/lib/config";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT"],
});

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const tiroDeva = Tiro_Devanagari_Hindi({
  variable: "--font-tiro-deva",
  subsets: ["devanagari"],
  weight: "400",
});

export const metadata: Metadata = {
  title: { default: `${APP_NAME}: ${brand.TAGLINE}`, template: `%s | ${APP_NAME}` },
  description: brand.DESCRIPTION,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5efe3" },
    { media: "(prefers-color-scheme: dark)", color: "#15110f" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Env (mock/live mode, business name) is read per request, not baked in at build time.
  await connection();
  const config = getPublicConfig();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${manrope.variable} ${plexMono.variable} ${tiroDeva.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-[100dvh]">
        <a
          href="#main"
          className="sr-only z-50 rounded-bahi bg-ink px-3 py-2 text-sm font-semibold text-paper focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Seedha kaam par jao
        </a>
        <ToastProvider>
          <Sidebar businessName={config.businessName} mode={config.mode} />
          <div className="min-h-[100dvh] md:pl-[var(--sidebar-w)]">
            <MobileTopBar businessName={config.businessName} mode={config.mode} />
            <main id="main" className="ledger-paper min-h-[100dvh] pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
              {children}
            </main>
          </div>
          <BottomBar />
        </ToastProvider>
      </body>
    </html>
  );
}
