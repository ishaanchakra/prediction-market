import { Syne, Space_Mono, Instrument_Serif } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import Navigation from "./components/Navigation";

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-syne",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata = {
  title: "Cornell Prediction Market",
  description: "Trade on Cornell predictions",
  icons: {
    icon: "/predict-cornell-icon.png",
    apple: "/predict-cornell-icon.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${syne.variable} ${spaceMono.variable} ${instrumentSerif.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#080808" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="antialiased">
        <Suspense fallback={null}>
          <Navigation />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
