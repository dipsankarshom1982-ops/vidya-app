import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { hasPermission } from "../lib/permissions";

const NAV_GROUPS = [
  { section: "OVERVIEW", items: [
    { path: "/",                    label: "📊 Dashboard",          permKey: "dashboard" },
    { path: "/platform-analytics",  label: "📈 Platform Analytics", permKey: "platform-analytics" },
  ]},
  { section: "ADS", items: [
    { path: "/ads",       label: "📢 All Ads",      permKey: "ads" },
    { path: "/ads/new",   label: "➕ Create Ad",    permKey: "ads" },
    { path: "/analytics", label: "📊 Ad Analytics", permKey: "analytics" },
  ]},
  { section: "CONTENT", items: [
    { path: "/banners",          label: "🎯 Banners",          permKey: "banners" },
    { path: "/short-reels",      label: "🎬 Short Reels",      permKey: "short-reels" },   // 🆕
    { path: "/seekho-videos",    label: "📺 Seekho Videos",    permKey: "seekho-videos" },
    { path: "/knowledge-videos", label: "🧠 Knowledge Videos", permKey: "knowledge-videos" },
    { path: "/stories",          label: "📖 Stories",          permKey: "stories" },
    { path: "/partners",         label: "🤝 Partners",         permKey: "partners" },
  ]},
  { section: "CURRICULUM", items: [
    { path: "/courses",  label: "📚 Courses",       permKey: "courses" },
    { path: "/practice", label: "✍️ Practice Sets", permKey: "practice" },
  ]},
  { section: "GAMIFICATION", items: [
    { path: "/contests",         label: "🏁 Contests",         permKey: "contests" },
    { path: "/vidyastar-config", label: "⭐ VidyaStar Config", permKey: "contests" },
    { path: "/quizzes",          label: "🧩 Quizzes",          permKey: "quizzes" },
    { path: "/skill-battles",    label: "⚔️ Skill Battles",    permKey: "skill-battles" },
    { path: "/learnfun",         label: "🎮 LearnFun",         permKey: "learnfun" },
    { path: "/badges",           label: "🏆 Badges & Stars",   permKey: "badges" },
  ]},
  { section: "APP CONFIG", items: [
    { path: "/modules",            label: "🧩 App Modules",  permKey: "modules" },
    { path: "/subscription-plans", label: "💎 Plans",        permKey: "subscription-plans" },
    { path: "/coupons",            label: "🎟️ Coupons",      permKey: "coupons" },
    { path: "/vcoin-rules",        label: "🪙 V-Coin Rules", permKey: "vcoin-rules" },
  ]},
  { section: "USERS", items: [
    { path: "/students",      label: "👥 Students",      permKey: "students" },
    { path: "/subscriptions", label: "💰 Subscriptions", permKey: "subscriptions" },
    { path: "/ai-usage",      label: "🤖 AI Usage",      permKey: "ai-usage" },
  ]},
  { section: "ADMIN", items: [
    { path: "/admins", label: "👑 Admins", permKey: "admins" },
  ]},
];

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { user, logout, isSuperAdmin, permissions } = useAuth();

  const isActive = (path: string) =>
    path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/");

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✨</span>
            <div>
              <p className="text-white font-bold text-sm">GLOOWS365E</p>
              <p className="text-slate-400 text-xs">Admin Portal</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-3">
          {NAV_GROUPS.map(({ section, items }) => {
            const visibleItems = items.filter(({ permKey }) =>
              hasPermission(isSuperAdmin, permissions, permKey)
            );
            if (!visibleItems.length) return null;
            return (
              <div key={section} className="mb-2">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider px-2 py-1.5">
                  {section}
                </p>
                {visibleItems.map(({ path, label }) => (
                  <Link
                    key={path}
                    to={path}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all mb-0.5 ${
                      isActive(path)
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>

        {/* User + Logout */}
        <div className="p-4 border-t border-slate-800 shrink-0">
          <p className="text-slate-400 text-xs truncate mb-2">{user?.email}</p>
          <button
            onClick={logout}
            className="w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors text-left"
          >
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="p-8"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
