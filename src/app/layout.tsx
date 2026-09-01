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
  description: "שמונה שמות. מי הזאב.",
  manifest: "/manifest.json",
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
