import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Heebo, Suez_One } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-heebo",
  display: "swap",
});

const display = Suez_One({
  subsets: ["hebrew", "latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "AiYara — אחד מהחברים שלכם הוא זאב",
    template: "%s · AiYara",
  },
  description: "עיירה, זאבים ובוטים. משחק בעברית ל־5–12 שחקנים: חצי שעה על הספה, או עיירה שחיה ימים. שחקני AI ממלאים כל כיסא ריק.",
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
      <body className={`${heebo.className} antialiased`}>{children}</body>
    </html>
  );
}
