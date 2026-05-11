import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LalShaluk TV",
  description: "Professional live TV streaming platform with multi-channel support and HD playback.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="dark" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
