"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; exact?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const navigation: NavGroup[] = [
  {
    label: "达人工作流",
    items: [
      { href: "/discover", label: "达人发现" },
      { href: "/review", label: "达人复筛" },
      { href: "/creators", label: "达人库" },
      { href: "/tasks", label: "建联任务" }
    ]
  },
  {
    label: "自动化",
    items: [{ href: "/agent", label: "Agent 工作台" }]
  },
  {
    label: "数据",
    items: [
      { href: "/import", label: "数据导入" },
      { href: "/revisits", label: "数据回访" }
    ]
  }
];

export function AppSidebar() {
  const pathname = usePathname();

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">K</div>
        <div>
          <strong>KOL CRM</strong>
          <span>达人筛选工作台</span>
        </div>
      </div>
      <nav aria-label="主导航">
        {navigation.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map((item) => (
              <Link className={isActive(item) ? "active" : undefined} href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
