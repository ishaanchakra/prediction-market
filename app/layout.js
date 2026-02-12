import { Syne, Space_Mono, Instrument_Serif } from "next/font/google";
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
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${syne.variable} ${spaceMono.variable} ${instrumentSerif.variable}`}>
      <body className="antialiased">
        <Navigation />
        {children}
      </body>
    </html>
  );
}
