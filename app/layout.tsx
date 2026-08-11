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
  title: "TokenTier — AI APIs vs subscription plans",
  description:
    "Compare AI API prices with subscription quotas, credits, scenario tier lists, and a transparent API-versus-plan recommender.",
  openGraph: {
    title: "TokenTier — API or plan? Know the difference",
    description:
      "Separate AI API and subscription tier lists, real quota evidence, and workload-based recommendations.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "TokenTier — API or plan? Know the difference",
    description:
      "Separate AI API and subscription tier lists, real quota evidence, and workload-based recommendations.",
  },
};

const themeScript = `
try {
  const savedTheme = localStorage.getItem("tokentier-theme");
  const theme = savedTheme === "light" || savedTheme === "dark"
    ? savedTheme
    : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
