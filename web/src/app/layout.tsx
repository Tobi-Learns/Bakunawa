import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet-context";
import { Header } from "@/components/header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Bakunawa - Dominance Prediction Market",
    template: "%s | Bakunawa",
  },
  description:
    "The prediction market that rewards conviction: forecast the winner and how big they'll win. The bolder your call, the bigger your share. Settled trustlessly on Stellar.",
  // Icons come from the file-based conventions: app/favicon.ico, app/icon.png,
  // app/apple-icon.png (generated from public/brand/bakunawa-logo-mark.png).
  openGraph: {
    title: "Bakunawa - Dominance Prediction Market",
    description:
      "Forecast the winner and how big. A Stellar prediction market where the pool rewards conviction.",
    url: "/",
    siteName: "Bakunawa",
    images: [{ url: "/brand/bakunawa-logo-wide.png", width: 1536, height: 1024 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bakunawa - Dominance Prediction Market",
    description:
      "Forecast the winner and how big. A Stellar prediction market where the pool rewards conviction.",
    images: ["/brand/bakunawa-logo-wide.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-neutral-950 text-neutral-100">
        <WalletProvider>
          <Header />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8">{children}</main>
          <footer className="border-t border-neutral-800 py-4 text-center text-xs text-neutral-500">
            Bakunawa · dominance prediction market on Stellar testnet · share prices are
            probabilities; payouts are a parimutuel pool split, not a fixed $1
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
