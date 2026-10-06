import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";
import KeyboardAwareSheets from "@/components/KeyboardAwareSheets";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Internova | Internship workspace",
  description: "A calm, connected workspace for internships.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Internova",
  },
};

export const viewport = {
  themeColor: "#2563eb",
  // Android Chrome shrinks the page for the keyboard instead of covering it,
  // so modals and forms can scroll the field being typed in into view.
  interactiveWidget: "resizes-content",
};

// Runs before paint so the page never flashes light-then-dark (or vice
// versa) on load — reads the saved preference (or the OS default on a first
// visit) and stamps the class on <html> immediately, ahead of React hydration.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("internova_theme");
    var theme = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (theme === "dark") document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <PwaRegister />
        <KeyboardAwareSheets />
        {children}
      </body>
    </html>
  );
}
