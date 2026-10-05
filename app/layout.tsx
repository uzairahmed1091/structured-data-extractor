import type { Metadata } from "next";
import { Analytics } from "@/components/analytics";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

const title = "Cited Extract — typed JSON from documents, with receipts";
const description =
  "Define a schema, paste a document or drop in a PDF, get validated JSON where every value cites the exact span it came from and missing fields come back null.";

export const metadata: Metadata = {
  // Makes the link-preview image URL absolute. The image itself is app/opengraph-image.png,
  // picked up by file convention, as are favicon.ico and apple-icon.png.
  metadataBase: new URL("https://structured-data-extractor.vercel.app"),
  title,
  description,
  openGraph: { title, description, type: "website", url: "/", siteName: "Cited Extract" },
  twitter: { card: "summary_large_image", title, description },
};

/**
 * Runs before first paint so the page never flashes the wrong theme. A saved choice wins;
 * otherwise follow the OS. Kept in sync with THEME_KEY in components/theme-toggle.tsx.
 */
const themeScript = `(function(){try{var t=localStorage.getItem("ce-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The script above sets data-theme on <html> before React hydrates, so the attribute
    // legitimately differs from the server render.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        {children}
        {/* Cookieless page views and referrers. The referrer is the point: it says
            whether anyone arrives from the Upwork portfolio tile or the GitHub repo,
            which is the only way to tell if either is doing anything. */}
        <Analytics />
      </body>
    </html>
  );
}
