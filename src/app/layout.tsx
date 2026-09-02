import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "מאפיה — מי בכפר מסתיר שיניים?",
    template: "%s · מאפיה",
  },
  description: "משחק מאפיה מתמשך בעברית ל־1–8 שחקנים, עם בוטים חכמים שממלאים את הכפר.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/art/icon.png", type: "image/png" }],
    apple: [{ url: "/art/icon.png" }],
  },
  appleWebApp: { capable: true, title: "מאפיה", statusBarStyle: "black-translucent" },
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
    <html lang="he" dir="rtl">
      <body className="font-heebo antialiased">{children}</body>
    </html>
  );
}
