import type { Metadata } from "next";
import Link from "next/link";
import { UserMenu } from "@/components/UserMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "PickMaster — Mercados Predictivos",
  description:
    "Predict the events that shape the Dominican Republic. Prototipo Fase 1 — sin dinero real.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-center text-xs py-1.5 px-4">
          Prototipo Fase 1 — trading simulado, sin dinero real. USDC y firmas EIP-712
          simulados; blockchain llega en Fase 2 (Base Sepolia).
        </div>
        <header className="border-b border-slate-800 bg-slate-950/80 sticky top-0 z-10 backdrop-blur">
          <nav className="mx-auto max-w-6xl flex items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight text-white">
              Pick<span className="text-emerald-400">Master</span>
            </Link>
            <div className="flex gap-4 text-sm text-slate-300">
              <Link href="/" className="hover:text-white">Mercados</Link>
              <Link href="/portfolio" className="hover:text-white">Portfolio</Link>
              <Link href="/admin" className="hover:text-white">Admin</Link>
              <Link href="/testnet" className="hover:text-white text-emerald-400/80">Testnet ⛓</Link>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <UserMenu />
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t border-slate-800 mt-16 py-6 text-center text-xs text-slate-500">
          PickMaster — Predict the events that shape the Dominican Republic. El precio
          representa la probabilidad implícita del mercado, no una garantía de que el
          evento ocurra.
        </footer>
      </body>
    </html>
  );
}
