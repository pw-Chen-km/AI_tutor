import type { Metadata } from "next";
import { Outfit, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import 'highlight.js/styles/github-dark.css';
import { SessionProvider } from "@/components/providers/session-provider";

const outfit = Outfit({
    subsets: ["latin"],
    variable: "--font-outfit",
    display: "swap",
    weight: ["400", "500", "600", "700", "800"],
});

const sourceSans = Source_Sans_3({
    subsets: ["latin"],
    variable: "--font-source-sans",
    display: "swap",
    weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
    title: "AI Teaching Assistant",
    description: "Generate curriculum materials using AI - drills, labs, homework, and exams",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={`${outfit.variable} ${sourceSans.variable}`}>
            <body className="font-sans antialiased">
                <SessionProvider>
                    {children}
                </SessionProvider>
            </body>
        </html>
    );
}
