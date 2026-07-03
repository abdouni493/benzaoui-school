import type { Metadata } from "next";
import { Geist, Geist_Mono, Cairo } from "next/font/google";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { DynamicFavicon } from "@/components/controls/DynamicFavicon";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cairo = Cairo({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
});

export const metadata: Metadata = {
  title: "BENZAOUI SCHOOL",
  description:
    "Gestion d'école privée — abonnements, présence par carte RFID, soldes, paiements.",
};

/** Sets theme + direction from persisted settings before first paint to
 *  avoid a flash. Mirrors the logic in lib/store/settings.ts. */
const noFlashScript = `
(function () {
  try {
    var raw = localStorage.getItem('ecole-settings');
    var st = raw ? (JSON.parse(raw).state || {}) : {};
    var theme = st.theme || 'dark-red';
    var lang = st.language || 'fr';
    var el = document.documentElement;
    el.setAttribute('data-theme', theme);
    el.setAttribute('lang', lang);
    el.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      dir="ltr"
      data-theme="dark-red"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="min-h-full">
        <SessionProvider>
          <DynamicFavicon />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
