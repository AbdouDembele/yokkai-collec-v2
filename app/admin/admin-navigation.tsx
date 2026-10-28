"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin/cards", label: "Card publishing" },
  { href: "/admin/players", label: "Player administration" },
  { href: "/admin/reports", label: "Reports" }
];

export function AdminNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin navigation" className="yk-tabs">
      {items.map(item => (
        <Link
          aria-current={pathname.startsWith(item.href) ? "page" : undefined}
          className={`yk-tab ${pathname.startsWith(item.href) ? "border-cyan-400 bg-cyan-400/10 text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.16)]" : ""}`}
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
