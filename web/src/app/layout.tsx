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
  title: "Bakunawa — Dominance Prediction Market",
  description:
    "Forecast the winner and the margin of victory. One shared parimutuel pool per event, priced transparently, settled on Stellar.",
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
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <WalletProvider>
          <Header />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
          <footer className="border-t border-neutral-800 py-4 text-center text-xs text-neutral-500">
            Bakunawa · dominance prediction market on Stellar testnet · multipliers
            are relative weights, never fixed odds
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
