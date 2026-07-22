import type { Metadata } from "next";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import "@mantine/core/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "FC Smart-Manager",
  description: "FC어울림 경기 운영 도구",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" data-mantine-color-scheme="light">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body className="bg-pitch-green min-h-screen">
        <MantineProvider defaultColorScheme="dark">
          <main className="mx-auto max-w-screen-sm p-4">{children}</main>
        </MantineProvider>
      </body>
    </html>
  );
}
