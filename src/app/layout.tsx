import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Frank_Ruhl_Libre, Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-heebo",
  display: "swap",
});

const display = Frank_Ruhl_Libre({
  subsets: ["hebrew", "latin"],
  weight: ["400", "700", "900"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "AiYara — מי בעיירה מסתיר שיניים?",
    template: "%s · AiYara",
  },
  description: "עיירה, זאבים ובוטים. משחק מאפיה בעברית ל־5–12 שחקנים, במשחק מהיר של דקות או במשחק מתמשך של ימים. שחקני AI ממלאים כל כיסא ריק.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/art/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/art/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/art/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "AiYara", statusBarStyle: "black-translucent" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0909",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${display.variable}`}>
      <body className="font-heebo antialiased">{children}</body>
    </html>
  );
}
