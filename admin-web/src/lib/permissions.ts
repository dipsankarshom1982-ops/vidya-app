export interface PermissionModule {
  key: string;
  label: string;
  section: string;
}

export const ALL_PERMISSIONS: PermissionModule[] = [
  { key: "dashboard",           label: "📊 Dashboard",           section: "Overview"      },
  { key: "platform-analytics",  label: "📈 Platform Analytics",  section: "Overview"      },
  { key: "ads",                 label: "📢 Ads",                 section: "Ads"           },
  { key: "analytics",           label: "📊 Ad Analytics",        section: "Ads"           },
  { key: "banners",             label: "🎯 Banners",             section: "Content"       },
  { key: "short-reels",         label: "🎬 Short Reels",         section: "Content"       }, // 🆕
  { key: "seekho-videos",       label: "📺 Seekho Videos",       section: "Content"       },
  { key: "knowledge-videos",    label: "🧠 Knowledge Videos",    section: "Content"       },
  { key: "stories",             label: "📖 Stories",             section: "Content"       },
  { key: "partners",            label: "🤝 Partners",            section: "Content"       },
  { key: "courses",             label: "📚 Courses",             section: "Curriculum"    },
  { key: "practice",            label: "✍️ Practice Sets",       section: "Curriculum"    },
  { key: "contests",            label: "🏁 Contests",            section: "Gamification"  },
  { key: "quizzes",             label: "🧩 Quizzes",             section: "Gamification"  },
  { key: "skill-battles",       label: "⚔️ Skill Battles",       section: "Gamification"  },
  { key: "learnfun",            label: "🎮 LearnFun",            section: "Gamification"  },
  { key: "badges",              label: "🏆 Badges & Stars",      section: "Gamification"  },
  { key: "modules",             label: "🧩 App Modules",         section: "App Config"    },
  { key: "subscription-plans",  label: "💎 Plans",               section: "App Config"    },
  { key: "coupons",             label: "🎟️ Coupons",             section: "App Config"    },
  { key: "vcoin-rules",         label: "🪙 V-Coin Rules",        section: "App Config"    },
  { key: "students",            label: "👥 Students",            section: "Users"         },
  { key: "subscriptions",       label: "💰 Subscriptions",       section: "Users"         },
  { key: "ai-usage",            label: "🤖 AI Usage",            section: "Users"         },
];

export const PERMISSION_SECTIONS = Array.from(
  new Set(ALL_PERMISSIONS.map((p) => p.section))
).map((section) => ({
  section,
  items: ALL_PERMISSIONS.filter((p) => p.section === section),
}));

export function hasPermission(
  isSuperAdmin: boolean,
  permissions: string[],
  key: string
): boolean {
  if (isSuperAdmin) return true;
  if (key === "admins") return false;
  return permissions.includes(key) || permissions.includes("all");
}
