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

const publicSiteUrl = new URL("https://majinwakeup.github.io/TokenTier/");
const socialImageUrl = new URL("og.png", publicSiteUrl);

export const metadata: Metadata = {
  metadataBase: publicSiteUrl,
  title: "TokenTier — AI APIs vs subscription plans",
  description:
    "Compare AI API prices with subscription quotas, credits, scenario tier lists, and a transparent API-versus-plan recommender.",
  alternates: {
    canonical: "https://majinwakeup.github.io/TokenTier/",
  },
  icons: {
    icon: [{ url: new URL("favicon.svg", publicSiteUrl), type: "image/svg+xml" }],
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "TokenTier — API or plan? Know the difference",
    description:
      "Separate AI API and subscription tier lists, real quota evidence, and workload-based recommendations.",
    type: "website",
    url: publicSiteUrl,
    siteName: "TokenTier",
    images: [{
      url: socialImageUrl,
      width: 1200,
      height: 630,
      alt: "TokenTier — compare AI APIs and subscription plans",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TokenTier — API or plan? Know the difference",
    description:
      "Separate AI API and subscription tier lists, real quota evidence, and workload-based recommendations.",
    images: [socialImageUrl],
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
