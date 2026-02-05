import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Navigation from "./components/Navigation";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata = {
  title: "Cornell Prediction Markets",
  description: "Forecast campus events. Build your reputation.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} font-sans antialiased bg-cream`}>
        <Navigation />
        {children}
      </body>
    </html>
  );
}