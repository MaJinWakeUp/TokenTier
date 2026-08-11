import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TokenTier — AI model prices, ranked by the work",
  description:
    "Compare current AI API and subscription prices, scenario tier lists, and transparent subscription-to-API call estimates.",
  openGraph: {
    title: "TokenTier — Know what every prompt costs",
    description:
      "Price-aware AI model tier lists, API rates, and subscription break-even estimates.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "TokenTier — Know what every prompt costs",
    description:
      "Price-aware AI model tier lists, API rates, and subscription break-even estimates.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
