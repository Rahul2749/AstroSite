import type { Metadata } from "next";
import "./globals.css";
import "./hero.css";

export const metadata: Metadata = {
  title: "Vedā — The sky you were born under",
  description: "Thoughtful Vedic astrology consultations. Explore the twelve Rashis and find a little clarity for the path ahead.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
