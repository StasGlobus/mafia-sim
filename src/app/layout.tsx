import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-heebo",
});

export const metadata: Metadata = {
  title: "מאפיה",
  description: "8 שמות. מי הזאב.",
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
  themeColor: "#120e0c",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="font-heebo antialiased">{children}</body>
    </html>
  );
}
