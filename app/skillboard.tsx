import Header from "@/components/header";
import { useTheme } from "@/context/ThemeContext";
import { auth, db } from "@/lib/firebase";
import { claimSkillBattleRewards } from "@/services/vCoinsService";
import { getVCoinForRank, VCOIN_DIST_PCT } from "@/utils/formatVCoins";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Types ────────────────────────────────────────────────────
type LocationScope = "local" | "district" | "state" | "india";
type MonthKey      = string; // "2026-05"
type BoardMode     = "skillbattle" | "vidyastar";
type VsPeriodType  = "daily" | "weekly" | "monthly" | "yearly";

// ─── VidyaStar period helpers ──────────────────────────────────
const vspad = (n: number) => String(n).padStart(2, "0");
function vsWeekNum(d: Date) {
  const oneJan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
}
function vsBuildPeriodKey(type: VsPeriodType, offset = 0): string {
  const d = new Date();
  if (type === "daily") {
    d.setDate(d.getDate() - offset);
    return `daily_${d.getFullYear()}-${vspad(d.getMonth()+1)}-${vspad(d.getDate())}`;
  }
  if (type === "weekly") {
    d.setDate(d.getDate() - offset * 7);
    return `weekly_${d.getFullYear()}-W${vspad(vsWeekNum(d))}`;
  }
  if (type === "monthly") {
    d.setMonth(d.getMonth() - offset);
    return `monthly_${d.getFullYear()}-${vspad(d.getMonth()+1)}`;
  }
  return `yearly_${d.getFullYear() - offset}`;
}
function vsPeriodLabel(key: string): string {
  if (key.startsWith("daily_"))   return key.replace("daily_",   "");
  if (key.startsWith("weekly_"))  return key.replace("weekly_",  "");
  if (key.startsWith("monthly_")) {
    const [y, m] = key.replace("monthly_", "").split("-");
    return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }
  return key.replace("yearly_", "");
}

interface VsBoardEntry {
  userId: string; name: string; profilePic: string;
  school: string; class: string;
  period: string; totalScore: number; contestCount: number; rank: number;
}

interface VsPrizeRow {
  rankMin: number; rankMax: number;
  prizeType: "gift_voucher" | "physical" | "vcoin";
  prizeValue: string; medalEmoji: string; badge: string;
}

interface VsConfig {
  period: VsPeriodType; periodKey: string;
  entryFee: number; totalPool: number; prizeRows: VsPrizeRow[];
}

const VS_PERIOD_TYPES: { key: VsPeriodType; label: string; icon: string }[] = [
  { key: "daily",   label: "Daily",   icon: "📅" },
  { key: "weekly",  label: "Weekly",  icon: "🗓️" },
  { key: "monthly", label: "Monthly", icon: "📆" },
  { key: "yearly",  label: "Yearly",  icon: "🏆" },
];

interface RanksMap {
  local: number; district: number; state: number; india: number;
}

interface BoardEntry {
  userId: string; name: string; profilePic: string;
  school: string; class: string;
  location: { city: string; district: string; state: string; pincode: string; country: string };
  totalLikes: number; totalViews: number; totalWatchtime: number;
  totalShares: number; totalComments: number; totalScore: number;
}

interface StudentMeta {
  name: string; class: string; profilePic: string;
  location: { city: string; district: string; state: string; pincode: string };
}

// ── India cash prize row (admin sets these) ───────────────────
interface CashPrizeRow {
  rankMin:    number;  // e.g. 1
  rankLabel:  string;  // e.g. "Rank 1" or "Rank 4-10"
  rankMax:    number;  // e.g. 1  (for ranges: 4–10)
  cash:       string;  // e.g. "₹15,000"
  extra:      string;  // e.g. "Tablet + Certificate"  (admin-set)
  badge:      string;  // e.g. "Champion"
  medalEmoji: string;  // e.g. "🥇"
}

// ── skillBattles Firestore doc shape ──────────────────────────
// {
//   type:         "sponsored"
//   month:        "2026-05"
//   sponsorName:  string
//   sponsorLogo:  string
//   totalPool:    number   ← admin-set base pool (₹)
//   winnerCount:  number   ← admin-set how many winners get cash
//   cashPrizes:   CashPrizeRow[]  ← auto-generated OR admin-overridden
//   extraPrizes:  { rank: number; extra: string }[]  ← admin-set extras
//   vcoin_india:    number  ← V-Coins for top 10 All India
//   vcoin_state:    number  ← V-Coins for top 10 State
//   vcoin_district: number  ← V-Coins for top 10 District
//   vcoin_local:    number  ← V-Coins for top 10 Local
// }

interface BattleConfig {
  battleId:       string;
  endDate:        string | null;   // ISO date string, null if no set end
  sponsorName:    string;
  sponsorLogo:    string;
  totalPool:      number;
  winnerCount:    number;
  cashPrizes:     CashPrizeRow[];
  vcoin_india:    number;
  vcoin_state:    number;
  vcoin_district: number;
  vcoin_local:    number;
}

// ─── V-Coin config per scope ──────────────────────────────────
const VCOIN_KEY: Record<LocationScope, keyof BattleConfig> = {
  india:    "vcoin_india",
  state:    "vcoin_state",
  district: "vcoin_district",
  local:    "vcoin_local",
};

// ─── Auto prize computation from pool + winnerCount ───────────
// Used only if admin hasn't set cashPrizes manually
// Distribution: 1st=30%, 2nd=20%, 3rd=12%, 4–10=3% ea, rest split equally
const autoCashPrizes = (pool: number, winners: number): CashPrizeRow[] => {
  if (pool <= 0 || winners <= 0) return [];

  const prizes: CashPrizeRow[] = [];
  const tiers = [
    { rMin: 1,  rMax: 1,  pct: 30, maxCash: 9000, medal: "🥇", badge: "Champion"      },
    { rMin: 2,  rMax: 2,  pct: 20, maxCash: 6000, medal: "🥈", badge: "Runner-Up"     },
    { rMin: 3,  rMax: 3,  pct: 12, maxCash: 4000, medal: "🥉", badge: "Rising Star"   },
    { rMin: 4,  rMax: 10, pct: 3,  maxCash: 1500, medal: "🏅", badge: "Top 10 Elite"  },
    { rMin: 11, rMax: 25, pct: 1,  maxCash: 500,  medal: "⭐", badge: "Top 25"        },
  ];

  for (const t of tiers) {
    if (t.rMin > winners) break;
    const rankMax   = Math.min(t.rMax, winners);
    const slotCount = rankMax - t.rMin + 1;
    const perSlot   = Math.min(
      slotCount > 1
        ? (pool * t.pct) / 100 / slotCount
        : (pool * t.pct) / 100,
      t.maxCash
    );
    if (perSlot < 10) continue;

    const rankLabel = t.rMin === rankMax
      ? `Rank ${t.rMin}`
      : `Rank ${t.rMin}–${rankMax}`;

    prizes.push({
      rankMin:    t.rMin,
      rankMax,
      rankLabel,
      cash:       slotCount > 1
        ? `₹${fmtINR(perSlot)} each`
        : `₹${fmtINR(perSlot)}`,
      extra:      "",   // filled from extraPrizes if admin set
      badge:      t.badge,
      medalEmoji: t.medal,
    });
  }
  return prizes;
};

// ─── Constants & helpers ──────────────────────────────────────
const LOCATION_TABS: { key: LocationScope; label: string; icon: string }[] = [
  { key: "local",    label: "Local",    icon: "🏘️" },
  { key: "district", label: "District", icon: "📍" },
  { key: "state",    label: "State",    icon: "🗺️" },
  { key: "india",    label: "India",    icon: "🇮🇳" },
];

const SCORE_WEIGHTS = { likes: 5, views: 1, shares: 8, comments: 3, watchtime: 0.1 };

const getAvailableMonths = (): MonthKey[] => {
  const months: MonthKey[] = [];
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
};

const getMonthLabel = (m: MonthKey) =>
  new Date(Number(m.split("-")[0]), Number(m.split("-")[1]) - 1)
    .toLocaleDateString("en-IN", { month: "long", year: "numeric" });

const getMedalEmoji = (r: number) => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "";
const getMedalColor = (r: number) =>
  r === 1 ? "#FFD700" : r === 2 ? "#C0C0C0" : r === 3 ? "#CD7F32" : "transparent";
const fmt    = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const fmtINR = (n: number) => {
  const r = Math.round(n / 10) * 10;
  return r >= 1000 ? `${(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)}k` : String(r);
};

const computeScore = (p: any): number =>
  (p.likes     || 0) * SCORE_WEIGHTS.likes    +
  (p.views     || 0) * SCORE_WEIGHTS.views    +
  (p.shares    || 0) * SCORE_WEIGHTS.shares   +
  (p.comments  || 0) * SCORE_WEIGHTS.comments +
  (p.watchTime || 0) * SCORE_WEIGHTS.watchtime;

const getScopeLabel = (scope: LocationScope, meta: StudentMeta | null): string => {
  if (!meta) return "";
  switch (scope) {
    case "local":    return meta.location.pincode  || "Local";
    case "district": return meta.location.district || "District";
    case "state":    return meta.location.state    || "State";
    case "india":    return "All India 🇮🇳";
  }
};

const getCashPrize = (prizes: CashPrizeRow[], rank: number): string => {
  if (!prizes?.length || rank === 0) return "—";
  return prizes.find((p) => rank >= p.rankMin && rank <= p.rankMax)?.cash ?? "—";
};

// ─── Component ────────────────────────────────────────────────
export default function SkillboardScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  // ── Board mode toggle ─────────────────────────────────────
  const [boardMode,      setBoardMode]      = useState<BoardMode>("skillbattle");

  // ── VidyaStar state ───────────────────────────────────────
  const [vsPeriodType,   setVsPeriodType]   = useState<VsPeriodType>("monthly");
  const [vsPeriodKey,    setVsPeriodKey]    = useState(vsBuildPeriodKey("monthly"));
  const [vsEntries,      setVsEntries]      = useState<VsBoardEntry[]>([]);
  const [vsConfig,       setVsConfig]       = useState<VsConfig | null>(null);
  const [vsLoading,      setVsLoading]      = useState(false);
  const [vsRefreshing,   setVsRefreshing]   = useState(false);

  const [activeScope,    setActiveScope]    = useState<LocationScope>("india");
  const [activeMonth,    setActiveMonth]    = useState<MonthKey>(getAvailableMonths()[0]);
  const [loading,        setLoading]        = useState(true);
  const [entries,        setEntries]        = useState<BoardEntry[]>([]);
  const [studentMeta,    setStudentMeta]    = useState<StudentMeta | null>(null);
  const [myEntry,        setMyEntry]        = useState<BoardEntry | null>(null);
  const [myRanks,        setMyRanks]        = useState<RanksMap>({ local: 0, district: 0, state: 0, india: 0 });
  const [participantCounts, setParticipantCounts] = useState<Record<LocationScope, number>>(
    { local: 0, district: 0, state: 0, india: 0 }
  );
  const [battle,         setBattle]         = useState<BattleConfig | null>(null);
  const [battleLoading,  setBattleLoading]  = useState(false);
  const [claimedCoins,   setClaimedCoins]   = useState(0);
  const claimAttemptRef  = useRef<string | null>(null);  // tracks last battleId claimed
  const claimToastAnim   = useRef(new Animated.Value(0)).current;

  const availableMonths = getAvailableMonths();

  // Accent — sponsored orange always
  const accent  = "#ff9f43";
  const accent2 = "#ff6b6b";

  const myRank      = myRanks[activeScope] ?? 0;
  const myVCoins    = battle ? getVCoinForRank(battle[VCOIN_KEY[activeScope]] as number, myRank) : 0;
  const activeCash  = activeScope === "india" ? battle?.cashPrizes ?? [] : [];

  // ── 1. Student meta ───────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const snap = await getDoc(doc(db, "students", uid));
        if (!snap.exists()) return;
        const d   = snap.data();
        const cls = d.class !== undefined ? String(d.class) : "";
        setStudentMeta({
          name: d.name ?? "", class: cls, profilePic: d.profilePic ?? "",
          location: {
            city:     d.location?.city     ?? "",
            district: d.location?.district ?? "",
            state:    d.location?.state    ?? "",
            pincode:  d.location?.pincode  ?? "",
          },
        });
      } catch (e) { console.log("student meta:", e); }
    };
    load();
  }, []);

  // ── 2. Fetch battle config ────────────────────────────────
  // skillBattles/{id}: type, month, sponsorName, sponsorLogo,
  //   totalPool, winnerCount, cashPrizes (optional override),
  //   extraPrizes [{rank, extra}],
  //   vcoin_india, vcoin_state, vcoin_district, vcoin_local
  useEffect(() => {
    const load = async () => {
      setBattleLoading(true);
      try {
        const snap = await getDocs(query(
          collection(db, "skillBattles"),
          where("type",  "==", "sponsored"),
          where("month", "==", activeMonth)
        ));
        if (snap.empty) { setBattle(null); return; }

        const battleDoc = snap.docs[0];
        const d = battleDoc.data();

        // Use admin-set cashPrizes if present, else auto-generate from pool+winners
        const adminPrizes: CashPrizeRow[] = d.cashPrizes ?? [];
        const extraMap: Record<number, string> = {};
        ((d.extraPrizes as { rank: number; extra: string }[]) ?? [])
          .forEach((ep) => { extraMap[ep.rank] = ep.extra; });

        const rawPrizes = adminPrizes.length > 0
          ? adminPrizes
          : autoCashPrizes(d.totalPool ?? 0, d.winnerCount ?? 0);

        // Merge extra prizes from admin
        const mergedPrizes = rawPrizes.map((p) => ({
          ...p,
          extra: extraMap[p.rankMin] ?? p.extra ?? "",
        }));

        setBattle({
          battleId:       battleDoc.id,
          endDate:        d.endDate        ?? null,
          sponsorName:    d.sponsorName    ?? "Official Sponsor",
          sponsorLogo:    d.sponsorLogo    ?? "🏪",
          totalPool:      d.totalPool      ?? 0,
          winnerCount:    d.winnerCount    ?? 0,
          cashPrizes:     mergedPrizes,
          vcoin_india:    d.vcoin_india    ?? 0,
          vcoin_state:    d.vcoin_state    ?? 0,
          vcoin_district: d.vcoin_district ?? 0,
          vcoin_local:    d.vcoin_local    ?? 0,
        });
      } catch (e) {
        console.log("battle config:", e);
        setBattle(null);
      } finally {
        setBattleLoading(false);
      }
    };
    load();
  }, [activeMonth]);

  // ── 3. Build leaderboard for active scope ─────────────────
  const buildLeaderboard = useCallback(async () => {
    if (!studentMeta) return;
    setLoading(true);
    try {
      const cls = studentMeta.class;
      const scopeConstraint = (() => {
        switch (activeScope) {
          case "local":    return where("location.pincode",  "==", studentMeta.location.pincode);
          case "district": return where("location.district", "==", studentMeta.location.district);
          case "state":    return where("location.state",    "==", studentMeta.location.state);
          default:         return null;
        }
      })();

      const snap = await getDocs(query(
        collection(db, "posts"),
        where("isSkillBattle", "==", true),
        where("status",        "==", "approved"),
        where("class",         "==", cls),
        where("month",         "==", activeMonth),
        ...(scopeConstraint ? [scopeConstraint] : [])
      ));

      const userMap = new Map<string, BoardEntry & { postCount: number }>();
      snap.docs.forEach((d) => {
        const p   = d.data();
        const uid = p.userId as string;
        if (!uid) return;
        const score = computeScore(p);
        const prev  = userMap.get(uid);
        if (prev) {
          prev.totalLikes     += p.likes     || 0;
          prev.totalViews     += p.views     || 0;
          prev.totalWatchtime += p.watchTime || 0;
          prev.totalShares    += p.shares    || 0;
          prev.totalComments  += p.comments  || 0;
          prev.totalScore     += score;
          prev.postCount++;
        } else {
          userMap.set(uid, {
            userId: uid, name: p.name ?? "", profilePic: p.profilePic ?? "",
            school: p.school ?? "", class: p.class ?? cls, location: p.location ?? {},
            totalLikes: p.likes || 0, totalViews: p.views || 0,
            totalWatchtime: p.watchTime || 0, totalShares: p.shares || 0,
            totalComments: p.comments || 0, totalScore: score, postCount: 1,
          });
        }
      });

      const sorted = Array.from(userMap.values()).sort((a, b) => b.totalScore - a.totalScore);
      setEntries(sorted);
      setParticipantCounts((prev) => ({ ...prev, [activeScope]: sorted.length }));

      const myUid = auth.currentUser?.uid;
      const myIdx = sorted.findIndex((e) => e.userId === myUid);
      setMyEntry(myIdx >= 0 ? sorted[myIdx] : null);
      setMyRanks((prev) => ({ ...prev, [activeScope]: myIdx >= 0 ? myIdx + 1 : 0 }));
    } catch (e) {
      console.log("leaderboard:", e);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [studentMeta, activeScope, activeMonth]);

  useEffect(() => {
    if (studentMeta) buildLeaderboard();
  }, [buildLeaderboard]);

  // ── 4. Build all 4 ranks simultaneously ───────────────────
  const buildAllRanks = useCallback(async () => {
    if (!studentMeta) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const cls = studentMeta.class;

    const scopes: { scope: LocationScope; extra: any }[] = [
      { scope: "local",    extra: where("location.pincode",  "==", studentMeta.location.pincode)  },
      { scope: "district", extra: where("location.district", "==", studentMeta.location.district) },
      { scope: "state",    extra: where("location.state",    "==", studentMeta.location.state)    },
      { scope: "india",    extra: null },
    ];

    const newRanks:  RanksMap                      = { local: 0, district: 0, state: 0, india: 0 };
    const newCounts: Record<LocationScope, number> = { local: 0, district: 0, state: 0, india: 0 };

    await Promise.all(scopes.map(async ({ scope, extra }) => {
      try {
        const snap = await getDocs(query(
          collection(db, "posts"),
          where("isSkillBattle", "==", true),
          where("status",        "==", "approved"),
          where("class",         "==", cls),
          where("month",         "==", activeMonth),
          ...(extra ? [extra] : [])
        ));
        const scoreMap = new Map<string, number>();
        snap.docs.forEach((d) => {
          const p = d.data();
          if (!p.userId) return;
          scoreMap.set(p.userId, (scoreMap.get(p.userId) ?? 0) + computeScore(p));
        });
        const sorted     = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]);
        const idx        = sorted.findIndex(([u]) => u === uid);
        newRanks[scope]  = idx >= 0 ? idx + 1 : 0;
        newCounts[scope] = sorted.length;
      } catch (e) { console.log(`rank[${scope}]:`, e); }
    }));

    setMyRanks(newRanks);
    setParticipantCounts(newCounts);
  }, [studentMeta, activeMonth]);

  useEffect(() => {
    if (studentMeta) buildAllRanks();
  }, [buildAllRanks]);

  // ── 5. Auto-credit V-Coins when battle has ended ──────────
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !battle || !battle.battleId || !battle.endDate) return;

    // Only proceed if battle has actually ended
    if (new Date(battle.endDate) >= new Date()) return;

    // Skip if already attempted for this battleId this session
    if (claimAttemptRef.current === battle.battleId) return;
    claimAttemptRef.current = battle.battleId;

    // Skip if user has no rank in any scope
    if (!Object.values(myRanks).some((r) => r > 0)) return;

    claimSkillBattleRewards({
      uid,
      battleId:    battle.battleId,
      battleMonth: activeMonth,
      ranks:       myRanks,
      vcoins: {
        vcoin_india:    battle.vcoin_india,
        vcoin_state:    battle.vcoin_state,
        vcoin_district: battle.vcoin_district,
        vcoin_local:    battle.vcoin_local,
      },
    }).then((totalCredited) => {
      if (totalCredited <= 0) return;
      setClaimedCoins(totalCredited);
      // Animate toast in, hold, then fade out
      Animated.sequence([
        Animated.timing(claimToastAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.delay(3000),
        Animated.timing(claimToastAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }).catch(() => { /* silent — user can claim next time */ });
  }, [battle, myRanks, activeMonth, claimToastAnim]);

  // ── 6. VidyaStar data loading ─────────────────────────────
  const loadVidyastar = useCallback(async () => {
    setVsLoading(true);
    try {
      const [boardSnap, configSnap] = await Promise.all([
        getDocs(query(
          collection(db, "vidyastarBoard"),
          where("period", "==", vsPeriodKey),
          orderBy("totalScore", "desc")
        )),
        getDoc(doc(db, "vidyastarConfig", vsPeriodKey)),
      ]);
      setVsEntries(boardSnap.docs.map((d) => ({ ...d.data() } as VsBoardEntry)));
      setVsConfig(configSnap.exists() ? (configSnap.data() as VsConfig) : null);
    } catch (e) {
      console.log("loadVidyastar:", e);
      setVsEntries([]);
    } finally {
      setVsLoading(false);
    }
  }, [vsPeriodKey]);

  useEffect(() => {
    if (boardMode === "vidyastar") loadVidyastar();
  }, [boardMode, loadVidyastar]);

  const onVsRefresh = async () => {
    setVsRefreshing(true);
    await loadVidyastar();
    setVsRefreshing(false);
  };

  // ─── Render helpers ───────────────────────────────────────

  // ── Sponsor banner ────────────────────────────────────────
  const renderSponsorBanner = () => {
    if (!battle) return null;
    return (
      <View style={styles.sponsorBanner}>
        <LinearGradient
          colors={["rgba(255,209,102,0.2)", "rgba(6,214,160,0.1)"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        />
        <Text style={styles.sponsorLogo}>{battle.sponsorLogo}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.sponsorName}>{battle.sponsorName}</Text>
          <Text style={styles.sponsorTag}>Official Sponsor · {getMonthLabel(activeMonth)}</Text>
        </View>
        <View style={styles.sponsorPoolBox}>
          <Text style={styles.sponsorPoolAmt}>₹{fmtINR(battle.totalPool)}</Text>
          <Text style={styles.sponsorPoolLbl}>India Pool</Text>
        </View>
      </View>
    );
  };

  // ── India Cash Prize track ────────────────────────────────
  const renderCashPrizeTrack = () => {
    if (activeScope !== "india") return null;

    if (battleLoading) {
      return (
        <View style={[styles.prizeCard, { borderColor: "rgba(255,159,67,0.3)", padding: 20, alignItems: "center" }]}>
          <ActivityIndicator color={accent} />
          <Text style={{ color: accent, marginTop: 8, fontSize: 12 }}>Loading prizes...</Text>
        </View>
      );
    }

    if (!battle || !battle.cashPrizes.length) {
      return (
        <View style={[styles.prizeCard, { borderColor: "rgba(255,159,67,0.2)", padding: 16, alignItems: "center" }]}>
          <Text style={{ color: "rgba(255,159,67,0.6)", fontSize: 12 }}>
            No prizes set for {getMonthLabel(activeMonth)}
          </Text>
        </View>
      );
    }

    return (
      <View style={[styles.prizeCard, { borderColor: "rgba(255,159,67,0.35)" }]}>
        {/* Header */}
        <LinearGradient
          colors={["rgba(255,159,67,0.18)", "rgba(255,107,107,0.08)"]}
          style={styles.prizeCardHeader}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        >
          <View>
            <Text style={styles.prizeCardTitle}>🏆 Cash Prize Pool · All India</Text>
            <Text style={styles.prizeCardSub}>
              {battle.sponsorName} · ₹{fmtINR(battle.totalPool)} · {battle.winnerCount} winners
            </Text>
          </View>
          <View style={styles.participantBadge}>
            <Text style={styles.participantCount}>{participantCounts.india}</Text>
            <Text style={styles.participantLabel}>players</Text>
          </View>
        </LinearGradient>

        {/* Prize rows */}
        {battle.cashPrizes.map((prize, i) => {
          const isMe = myRank > 0 && myRank >= prize.rankMin && myRank <= prize.rankMax;
          return (
            <View
              key={i}
              style={[
                styles.prizeRow,
                { borderBottomColor: "rgba(255,159,67,0.1)" },
                isMe && { backgroundColor: "rgba(255,159,67,0.12)" },
              ]}
            >
              <Text style={styles.prizeMedal}>{prize.medalEmoji}</Text>
              <View style={{ flex: 1 }}>
                <View style={styles.prizeRankRow}>
                  <Text style={[styles.prizeRankLabel, { color: colors.text }]}>
                    {prize.rankLabel}
                  </Text>
                  {isMe && (
                    <View style={styles.youPrizeBadge}>
                      <Text style={styles.youPrizeText}>← YOU</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.prizeBadgeName, { color: "rgba(255,159,67,0.65)" }]}>
                  {prize.badge}
                </Text>
                {/* Extra prizes set by admin */}
                {prize.extra ? (
                  <Text style={styles.prizeExtra}>🎁 {prize.extra}</Text>
                ) : null}
              </View>
              <Text style={styles.prizeCash}>{prize.cash}</Text>
            </View>
          );
        })}
      </View>
    );
  };

  // ── V-Coin reward card (for local/district/state) ─────────
  const renderVCoinCard = () => {
    if (activeScope === "india") return null;

    const baseCoins = battle ? (battle[VCOIN_KEY[activeScope]] as number) : 0;
    const scopeLabel = LOCATION_TABS.find((t) => t.key === activeScope)?.label ?? "";
    const scopeIcon  = LOCATION_TABS.find((t) => t.key === activeScope)?.icon  ?? "";

    if (!battle || baseCoins === 0) {
      return (
        <View style={[styles.vcoinCard, { borderColor: "rgba(99,179,237,0.25)" }]}>
          <Text style={[styles.vcoinCardEmpty, { color: colors.textSecondary }]}>
            No V-Coin rewards set for {scopeLabel} scope this month
          </Text>
        </View>
      );
    }

    return (
      <View style={[styles.vcoinCard, { borderColor: "rgba(99,179,237,0.35)" }]}>
        <LinearGradient
          colors={["rgba(99,179,237,0.15)", "rgba(129,140,248,0.08)"]}
          style={styles.vcoinCardHeader}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        >
          <View>
            <Text style={styles.vcoinCardTitle}>
              🪙 V-Coin Rewards · {scopeIcon} {scopeLabel}
            </Text>
            <Text style={styles.vcoinCardSub}>
              Top 10 {scopeLabel} winners earn V-Coins · {getMonthLabel(activeMonth)}
            </Text>
          </View>
          <View style={styles.participantBadge}>
            <Text style={[styles.participantCount, { color: "#63b3ed" }]}>
              {participantCounts[activeScope]}
            </Text>
            <Text style={[styles.participantLabel, { color: "rgba(99,179,237,0.6)" }]}>players</Text>
          </View>
        </LinearGradient>

        {/* Top 10 rows */}
        {Array.from({ length: Math.min(10, participantCounts[activeScope] || 10) }, (_, i) => {
          const rank   = i + 1;
          const coins  = getVCoinForRank(baseCoins, rank);
          const isMe   = myRank === rank;
          const isTop3 = rank <= 3;
          return (
            <View
              key={rank}
              style={[
                styles.vcoinRow,
                { borderBottomColor: "rgba(99,179,237,0.08)" },
                isMe && { backgroundColor: "rgba(99,179,237,0.1)" },
              ]}
            >
              {/* Rank */}
              <View style={styles.vcoinRankCol}>
                {isTop3
                  ? <Text style={{ fontSize: 18 }}>{getMedalEmoji(rank)}</Text>
                  : <Text style={[styles.vcoinRankNum, { color: colors.textSecondary }]}>#{rank}</Text>
                }
              </View>

              {/* Label */}
              <View style={{ flex: 1 }}>
                <Text style={[styles.vcoinRankLabel, { color: colors.text }]}>
                  Rank {rank}
                  {isMe && <Text style={styles.youVcoinTag}> YOU</Text>}
                </Text>
                {/* Show % so students understand distribution */}
                <Text style={[styles.vcoinPct, { color: colors.textSecondary }]}>
                  {VCOIN_DIST_PCT[rank - 1]}% of pool
                </Text>
              </View>

              {/* V-Coins */}
              <View style={styles.vcoinAmount}>
                <Text style={styles.vcoinAmountText}>🪙 {coins}</Text>
                <Text style={styles.vcoinAmountLabel}>V-Coins</Text>
              </View>
            </View>
          );
        })}

        {/* Footer: show relative to other scopes */}
        <View style={[styles.vcoinFooter, { borderTopColor: "rgba(99,179,237,0.12)" }]}>
          <Text style={[styles.vcoinFooterText, { color: colors.textSecondary }]}>
            🏘️ Local: {battle.vcoin_local}  ·  📍 District: {battle.vcoin_district}  ·  🗺️ State: {battle.vcoin_state}
          </Text>
        </View>
      </View>
    );
  };

  // ── My Rank Grid (all 4 scopes) ───────────────────────────
  const renderMyRankGrid = () => {
    if (!Object.values(myRanks).some((r) => r > 0) || !myEntry) return null;

    return (
      <View style={[styles.myRankGrid, { borderColor: `${accent}40`, backgroundColor: `${accent}08` }]}>
        <Text style={[styles.myRankGridTitle, { color: accent }]}>
          🎯 {studentMeta?.name} · {getMonthLabel(activeMonth)}
        </Text>
        <Text style={[styles.myRankGridSub, { color: colors.textSecondary }]}>
          Class {studentMeta?.class} · Tap scope to switch
        </Text>
        <View style={styles.myRankGridRow}>
          {LOCATION_TABS.map((tab) => {
            const rank     = myRanks[tab.key] ?? 0;
            const isActive = tab.key === activeScope;
            const pCount   = participantCounts[tab.key];

            // Reward preview per scope
            const rewardLine = (() => {
              if (!battle) return null;
              if (tab.key === "india" && rank > 0) {
                const cash = getCashPrize(battle.cashPrizes, rank);
                if (cash !== "—") return <Text style={styles.myRankGridCash}>{cash}</Text>;
              }
              if (tab.key !== "india" && rank > 0 && rank <= 10) {
                const coins = getVCoinForRank(battle[VCOIN_KEY[tab.key]] as number, rank);
                if (coins > 0)
                  return <Text style={styles.myRankGridVcoin}>🪙 {coins}</Text>;
              }
              return null;
            })();

            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.myRankGridItem,
                  {
                    backgroundColor: isActive ? `${accent}22` : colors.card,
                    borderColor:     isActive ? accent : colors.border,
                  },
                ]}
                onPress={() => setActiveScope(tab.key)}
              >
                <Text style={styles.myRankGridIcon}>{tab.icon}</Text>
                <Text style={[styles.myRankGridLabel, { color: colors.textSecondary }]}>
                  {tab.label}
                </Text>
                <Text style={[styles.myRankGridRank, { color: accent }]}>
                  {rank > 0 ? (getMedalEmoji(rank) || `#${rank}`) : "—"}
                </Text>
                {rank > 0 && pCount > 0 && (
                  <Text style={[styles.myRankGridOf, { color: colors.textSecondary }]}>
                    of {pCount}
                  </Text>
                )}
                {rewardLine}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  // ── My Card ───────────────────────────────────────────────
  const renderMyCard = () => {
    if (!myEntry || !studentMeta) return null;
    const rank       = myRank;
    const top10Score = entries[9]?.totalScore ?? 0;
    const gap        = top10Score > myEntry.totalScore ? top10Score - myEntry.totalScore : 0;
    const pct        = top10Score > 0
      ? Math.max(15, Math.min(90, Math.round((myEntry.totalScore / top10Score) * 100)))
      : 15;

    const rewardDisplay = (() => {
      if (!battle) return null;
      if (activeScope === "india" && rank > 0) {
        const cash = getCashPrize(battle.cashPrizes, rank);
        if (cash !== "—") return { label: "Prize", value: cash, color: "#06d6a0" };
      }
      if (activeScope !== "india" && rank > 0 && rank <= 10) {
        const coins = getVCoinForRank(battle[VCOIN_KEY[activeScope]] as number, rank);
        if (coins > 0) return { label: "V-Coins", value: `🪙 ${coins}`, color: "#63b3ed" };
      }
      return null;
    })();

    return (
      <View style={[styles.myCard, { borderColor: `${accent}40` }]}>
        <LinearGradient
          colors={["#050c1f", "#0f1635", "#1a1b4b"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        />
        <View style={styles.myCardTop}>
          {studentMeta.profilePic ? (
            <Image source={{ uri: studentMeta.profilePic }} style={[styles.myAvatar, { borderColor: accent }]} />
          ) : (
            <View style={[styles.myAvatarPlaceholder, { backgroundColor: `${accent}25`, borderColor: accent }]}>
              <Text style={[styles.myAvatarInitial, { color: accent }]}>
                {studentMeta.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.myName, { color: colors.text }]}>{studentMeta.name}</Text>
            <View style={styles.myMetaRow}>
              <View style={[styles.myScopeBadge, { backgroundColor: `${accent}18`, borderColor: `${accent}35` }]}>
                <Text style={[styles.myScopeBadgeText, { color: accent }]}>
                  {getScopeLabel(activeScope, studentMeta)}
                </Text>
              </View>
              {/* Reward badge */}
              {rewardDisplay && (
                <View style={[styles.rewardBadge, { borderColor: `${rewardDisplay.color}40`, backgroundColor: `${rewardDisplay.color}12` }]}>
                  <Text style={[styles.rewardBadgeText, { color: rewardDisplay.color }]}>
                    {rewardDisplay.value}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View style={[styles.myRankBox, { borderColor: `${accent}45`, backgroundColor: `${accent}12` }]}>
            <Text style={[styles.myRankNum, { color: "#ffd166" }]}>
              {rank > 0 ? `#${rank}` : "—"}
            </Text>
            <Text style={[styles.myRankLabel, { color: "#ffd16680" }]}>
              of {participantCounts[activeScope]}
            </Text>
          </View>
        </View>

        <View style={styles.myStatsRow}>
          {[
            { v: myEntry.totalScore.toLocaleString(), l: "Score"   },
            { v: fmt(myEntry.totalLikes),              l: "Likes"   },
            { v: fmt(myEntry.totalViews),              l: "Views"   },
            { v: fmt(myEntry.totalShares),             l: "Shares"  },
            ...(rewardDisplay ? [{ v: rewardDisplay.value, l: rewardDisplay.label }] : []),
          ].map((s, i) => (
            <View key={i} style={[styles.myStatItem, { backgroundColor: "rgba(255,255,255,0.05)" }]}>
              <Text style={[styles.myStatVal, { color: accent }]}>{s.v}</Text>
              <Text style={[styles.myStatLbl, { color: colors.textSecondary }]}>{s.l}</Text>
            </View>
          ))}
        </View>

        {gap > 0 && (
          <View>
            <View style={styles.progressLabelRow}>
              <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>Progress to Top 10</Text>
              <Text style={[styles.progressLabel, { color: "#ffd166" }]}>{top10Score} pts needed</Text>
            </View>
            <View style={[styles.progressBg, { backgroundColor: "rgba(255,255,255,0.07)" }]}>
              <LinearGradient
                colors={[accent, accent2]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[styles.progressFill, { width: `${pct}%` }]}
              />
            </View>
            <Text style={[styles.progressHint, { color: "#ffd166" }]}>
              🔥 <Text style={{ color: "#fff", fontWeight: "900" }}>{gap} pts</Text> away from Top 10!
            </Text>
          </View>
        )}
      </View>
    );
  };

  // ── Podium ────────────────────────────────────────────────
  const renderPodium = () => {
    const top3  = entries.slice(0, 3);
    if (!top3.length) return null;
    const order      = [top3[1], top3[0], top3[2]].filter(Boolean);
    const heights    = [90, 120, 72];
    const ranks      = [2, 1, 3];
    const barColors  = ["#a8a8c0CC", "#FFD700DD", "#cd7f32CC"]; // silver, gold, bronze

    return (
      <View style={styles.podiumRow}>
        {order.map((entry, i) => {
          const r = ranks[i];
          const rewardStr = (() => {
            if (!battle) return null;
            if (activeScope === "india") return getCashPrize(battle.cashPrizes, r);
            const coins = getVCoinForRank(battle[VCOIN_KEY[activeScope]] as number, r);
            return coins > 0 ? `🪙 ${coins}` : null;
          })();
          return (
            <View key={entry.userId} style={styles.podiumItem}>
              <View style={styles.podiumAvatarWrap}>
                {r === 1 && <Text style={styles.crown}>👑</Text>}
                {entry.profilePic ? (
                  <Image source={{ uri: entry.profilePic }} style={[styles.podiumAvatar, r === 1 && styles.podiumAvatarLarge, { borderColor: getMedalColor(r) }]} />
                ) : (
                  <View style={[styles.podiumAvatarPlaceholder, r === 1 && styles.podiumAvatarLarge, { borderColor: getMedalColor(r), backgroundColor: `${accent}25` }]}>
                    <Text style={[styles.podiumInitial, { color: accent }]}>{entry.name?.charAt(0).toUpperCase() || "S"}</Text>
                  </View>
                )}
                <Text style={styles.podiumMedal}>{getMedalEmoji(r)}</Text>
              </View>
              <Text style={[styles.podiumName, { color: colors.text }]} numberOfLines={1}>{entry.name}</Text>
              <Text style={[styles.podiumScore, { color: accent }]}>{fmt(entry.totalScore)} pts</Text>
              {rewardStr && rewardStr !== "—" && (
                <Text style={[styles.podiumReward, {
                  color: activeScope === "india" ? "#06d6a0" : "#63b3ed",
                  backgroundColor: activeScope === "india" ? "rgba(6,214,160,0.1)" : "rgba(99,179,237,0.1)",
                }]}>{rewardStr}</Text>
              )}
              <View style={[styles.podiumBar, { height: heights[i], backgroundColor: barColors[i] }]} />
            </View>
          );
        })}
      </View>
    );
  };

  // ── Leaderboard row ───────────────────────────────────────
  const renderRow = ({ item, index }: { item: BoardEntry; index: number }) => {
    const rank    = index + 4;
    const isMe    = item.userId === auth.currentUser?.uid;
    const isTop10 = rank <= 10;

    // Reward column
    const rewardStr = (() => {
      if (!battle) return "—";
      if (activeScope === "india") return getCashPrize(battle.cashPrizes, rank);
      if (rank <= 10) {
        const coins = getVCoinForRank(battle[VCOIN_KEY[activeScope]] as number, rank);
        return coins > 0 ? `🪙 ${coins}` : "—";
      }
      return "—";
    })();

    const isCoins = rewardStr !== "—" && rewardStr.startsWith("🪙");
    const isCash  = rewardStr !== "—" && !isCoins;

    return (
      <View style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        isTop10 && { borderLeftColor: accent, borderLeftWidth: 3 },
        isMe    && { backgroundColor: `${accent}10`, borderColor: `${accent}50` },
      ]}>
        <View style={styles.rowAvatarCol}>
          {item.profilePic
            ? <Image source={{ uri: item.profilePic }} style={styles.rowAvatar} />
            : <View style={[styles.rowAvatarPlaceholder, { backgroundColor: `${accent}20` }]}>
                <Text style={[styles.rowAvatarInitial, { color: accent }]}>{item.name?.charAt(0).toUpperCase() || "S"}</Text>
              </View>
          }
        </View>
        <View style={styles.rowInfoCol}>
          <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
            {item.name}{isMe && <Text style={styles.youTag}> YOU</Text>}
          </Text>
          <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.school} · {item.class}
          </Text>
          <Text style={[styles.rowLoc, { color: colors.textSecondary }]} numberOfLines={1}>
            📍 {[item.location?.city, item.location?.district].filter(Boolean).join(", ")}
          </Text>
        </View>
        <View style={styles.rowScoreCol}>
          <Text style={[styles.rowScore, { color: accent }]}>{fmt(item.totalScore)}</Text>
          <Text style={[styles.rowScoreLbl, { color: colors.textSecondary }]}>pts</Text>
        </View>
        <View style={styles.rowRankCol}>
          {rank <= 3
            ? <Text style={styles.rowRankEmoji}>{getMedalEmoji(rank)}</Text>
            : <Text style={[styles.rowRankNum, { color: colors.textSecondary }]}>#{rank}</Text>
          }
        </View>
        <View style={styles.rowRewardCol}>
          <Text style={[
            styles.rowReward,
            isCash  && { color: "#06d6a0", backgroundColor: "rgba(6,214,160,0.1)"  },
            isCoins && { color: "#63b3ed", backgroundColor: "rgba(99,179,237,0.1)" },
            !isCash && !isCoins && { color: colors.textSecondary },
          ]}>{rewardStr}</Text>
        </View>
        <View style={styles.spRibbon}>
          <Text style={styles.spRibbonText}>SP</Text>
        </View>
      </View>
    );
  };

  // ── VidyaStar tab renderer ────────────────────────────────
  const renderVidyaStarTab = () => {
    const myUid    = auth.currentUser?.uid;
    const myEntry  = vsEntries.find((e) => e.userId === myUid) ?? null;
    const top3     = vsEntries.slice(0, 3);
    const rest     = vsEntries.slice(3);

    const getPrize = (rank: number): string => {
      if (!vsConfig?.prizeRows?.length || rank === 0) return "";
      const row = vsConfig.prizeRows.find((r) => rank >= r.rankMin && rank <= r.rankMax);
      if (!row) return "";
      if (row.prizeType === "vcoin")        return `🪙 ${row.prizeValue}`;
      if (row.prizeType === "gift_voucher") return `🎁 ${row.prizeValue}`;
      return `📦 ${row.prizeValue}`;
    };

    return (
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={vsRefreshing} onRefresh={onVsRefresh} tintColor="#7c3aed" />}
        showsVerticalScrollIndicator={false}
      >
        {/* Period type tabs */}
        <View style={styles.vsTabRow}>
          {VS_PERIOD_TYPES.map((pt) => (
            <TouchableOpacity key={pt.key}
              style={[styles.vsTab, vsPeriodType === pt.key && styles.vsTabActive]}
              onPress={() => { setVsPeriodType(pt.key); setVsPeriodKey(vsBuildPeriodKey(pt.key)); }}
            >
              <Text style={styles.vsTabIcon}>{pt.icon}</Text>
              <Text style={[styles.vsTabLabel, { color: vsPeriodType === pt.key ? "#a5b4fc" : colors.textSecondary }]}>{pt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Period chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {[0, 1, 2].map((offset) => {
            const k = vsBuildPeriodKey(vsPeriodType, offset);
            return (
              <TouchableOpacity key={k}
                style={[styles.monthChip, { borderColor: vsPeriodKey === k ? "#7c3aed" : "rgba(124,58,237,0.2)", backgroundColor: vsPeriodKey === k ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.04)", marginLeft: offset === 0 ? 0 : 8 }]}
                onPress={() => setVsPeriodKey(k)}
              >
                <Text style={[styles.monthChipText, { color: vsPeriodKey === k ? "#fff" : colors.textSecondary }]}>{vsPeriodLabel(k)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Config / prize card */}
        {vsConfig ? (
          <View style={styles.vsPrizeCard}>
            <View style={styles.vsPrizeHeader}>
              <View>
                <Text style={styles.vsPrizeTitle}>🏆 VidyaStar Prizes · {vsPeriodLabel(vsPeriodKey)}</Text>
                {vsConfig.totalPool > 0 && (
                  <Text style={styles.vsPrizeSub}>Pool: ₹{vsConfig.totalPool} (gift vouchers)</Text>
                )}
              </View>
              {vsConfig.entryFee > 0 && (
                <View style={styles.vsEntryBadge}>
                  <Text style={styles.vsEntryText}>₹{vsConfig.entryFee} Entry</Text>
                </View>
              )}
            </View>
            {vsConfig.prizeRows?.map((row, i) => {
              const myRank = myEntry?.rank ?? 0;
              const isMe   = myRank > 0 && myRank >= row.rankMin && myRank <= row.rankMax;
              return (
                <View key={i} style={[styles.vsPrizeRow, isMe && { backgroundColor: "rgba(124,58,237,0.12)" }]}>
                  <Text style={styles.vsMedal}>{row.medalEmoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.vsRankLabel, { color: colors.text }]}>
                      {row.rankMin === row.rankMax ? `Rank ${row.rankMin}` : `Rank ${row.rankMin}–${row.rankMax}`}
                      {isMe ? <Text style={styles.vsYouTag}> ← YOU</Text> : null}
                    </Text>
                    {!!row.badge && <Text style={styles.vsBadge}>{row.badge}</Text>}
                  </View>
                  <Text style={[styles.vsPrizeValue,
                    row.prizeType === "gift_voucher" && { color: "#10b981" },
                    row.prizeType === "physical"     && { color: "#f59e0b" },
                    row.prizeType === "vcoin"        && { color: "#63b3ed" },
                  ]}>
                    {row.prizeType === "gift_voucher" ? `🎁 ${row.prizeValue}`
                      : row.prizeType === "physical" ? `📦 ${row.prizeValue}`
                      : `🪙 ${row.prizeValue}`}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={[styles.vsPrizeCard, { paddingVertical: 16, alignItems: "center" }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>No prize config for this period yet</Text>
          </View>
        )}

        {/* My card */}
        {myEntry && (
          <View style={[styles.vsMyCard, { borderColor: "#7c3aed55" }]}>
            <Text style={styles.vsMyName}>🎯 {myEntry.name || "You"}</Text>
            <View style={styles.vsMyRow}>
              <View style={styles.vsMyBox}>
                <Text style={styles.vsMyVal}>{myEntry.totalScore}</Text>
                <Text style={styles.vsMyLbl}>Total Pts</Text>
              </View>
              <View style={styles.vsMyBox}>
                <Text style={styles.vsMyVal}>#{myEntry.rank}</Text>
                <Text style={styles.vsMyLbl}>Rank</Text>
              </View>
              <View style={styles.vsMyBox}>
                <Text style={styles.vsMyVal}>{myEntry.contestCount}</Text>
                <Text style={styles.vsMyLbl}>Contests</Text>
              </View>
              {!!getPrize(myEntry.rank) && (
                <View style={styles.vsMyBox}>
                  <Text style={[styles.vsMyVal, { fontSize: 11, color: "#10b981" }]}>{getPrize(myEntry.rank)}</Text>
                  <Text style={styles.vsMyLbl}>Prize</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Loading */}
        {vsLoading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#7c3aed" />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading rankings…</Text>
          </View>
        )}

        {/* Empty */}
        {!vsLoading && vsEntries.length === 0 && (
          <View style={styles.centered}>
            <Text style={{ fontSize: 44 }}>⭐</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No rankings yet</Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Complete VidyaStar quizzes{"\n"}to appear on this board!
            </Text>
          </View>
        )}

        {/* Podium top 3 */}
        {!vsLoading && top3.length > 0 && (
          <View style={styles.podiumRow}>
            {[top3[1], top3[0], top3[2]].filter(Boolean).map((entry, i) => {
              const r = [2, 1, 3][i];
              const medals = ["🥈", "🥇", "🥉"];
              const heights = [90, 120, 72];
              const barColors = ["#a8a8c0CC", "#FFD700DD", "#cd7f32CC"];
              const prize = getPrize(r);
              return (
                <View key={entry.userId} style={styles.podiumItem}>
                  <View style={styles.podiumAvatarWrap}>
                    {r === 1 && <Text style={styles.crown}>👑</Text>}
                    {entry.profilePic ? (
                      <Image source={{ uri: entry.profilePic }} style={[styles.podiumAvatar, r === 1 && styles.podiumAvatarLarge, { borderColor: getMedalColor(r) }]} />
                    ) : (
                      <View style={[styles.podiumAvatarPlaceholder, r === 1 && styles.podiumAvatarLarge, { borderColor: getMedalColor(r), backgroundColor: "rgba(124,58,237,0.25)" }]}>
                        <Text style={[styles.podiumInitial, { color: "#a78bfa" }]}>{(entry.name || "S").charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                    <Text style={styles.podiumMedal}>{medals[i]}</Text>
                  </View>
                  <Text style={[styles.podiumName, { color: colors.text }]} numberOfLines={1}>{entry.name || "Student"}</Text>
                  <Text style={[styles.podiumScore, { color: "#a78bfa" }]}>{entry.totalScore} pts</Text>
                  {!!prize && <Text style={[styles.podiumReward, { color: "#10b981", backgroundColor: "rgba(16,185,129,0.1)" }]}>{prize}</Text>}
                  <View style={[styles.podiumBar, { height: heights[i], backgroundColor: barColors[i] }]} />
                </View>
              );
            })}
          </View>
        )}

        {/* Rest of list */}
        {!vsLoading && rest.map((entry, i) => {
          const rank  = i + 4;
          const isMe  = entry.userId === myUid;
          const prize = getPrize(rank);
          return (
            <View key={entry.userId} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }, isMe && { backgroundColor: "rgba(124,58,237,0.1)", borderColor: "rgba(124,58,237,0.5)" }]}>
              <View style={styles.rowAvatarCol}>
                {entry.profilePic ? (
                  <Image source={{ uri: entry.profilePic }} style={styles.rowAvatar} />
                ) : (
                  <View style={[styles.rowAvatarPlaceholder, { backgroundColor: "rgba(124,58,237,0.2)" }]}>
                    <Text style={[styles.rowAvatarInitial, { color: "#a78bfa" }]}>{(entry.name || "S").charAt(0).toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <View style={styles.rowInfoCol}>
                <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                  {entry.name || "Student"}{isMe ? <Text style={styles.youTag}> YOU</Text> : null}
                </Text>
                <Text style={[styles.rowSub, { color: colors.textSecondary }]}>{entry.school} · Class {entry.class}</Text>
                <Text style={[styles.rowSub, { color: colors.textSecondary }]}>{entry.contestCount} contest{entry.contestCount !== 1 ? "s" : ""}</Text>
              </View>
              <View style={styles.rowScoreCol}>
                <Text style={[styles.rowScore, { color: "#a78bfa" }]}>{entry.totalScore}</Text>
                <Text style={[styles.rowScoreLbl, { color: colors.textSecondary }]}>pts</Text>
              </View>
              <View style={styles.rowRankCol}>
                {rank <= 3 ? <Text style={styles.rowRankEmoji}>{getMedalEmoji(rank)}</Text>
                  : <Text style={[styles.rowRankNum, { color: colors.textSecondary }]}>#{rank}</Text>}
              </View>
              <View style={styles.rowRewardCol}>
                {!!prize && <Text style={[styles.rowReward, { color: "#10b981", backgroundColor: "rgba(16,185,129,0.08)" }]}>{prize}</Text>}
              </View>
            </View>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  };

  // ── Main ──────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header hideMenu={true} />

      {/* V-Coins credited toast */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.claimToast,
          {
            opacity:   claimToastAnim,
            transform: [{ translateY: claimToastAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
          },
        ]}
      >
        <Text style={styles.claimToastText}>🪙 +{claimedCoins} V-Coins credited!</Text>
      </Animated.View>

      <LinearGradient colors={["#060414", "#0f0a2e", "#1a1548"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.topHeader}>
        {renderSponsorBanner()}

        <View style={styles.titleRow}>
          <View>
            <Text style={styles.appTitle}>🏅 Skill Battle Board</Text>
            <Text style={styles.appSubtitle}>
              Class {studentMeta?.class} · {getScopeLabel(activeScope, studentMeta)}
            </Text>
          </View>
        </View>

        {/* Month chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll}>
          {availableMonths.map((m) => {
            const active = m === activeMonth;
            return (
              <TouchableOpacity key={m} style={[styles.monthChip, { borderColor: active ? accent : "rgba(255,255,255,0.07)", backgroundColor: active ? `${accent}35` : "rgba(255,255,255,0.04)" }]} onPress={() => setActiveMonth(m)}>
                <Text style={[styles.monthChipText, { color: active ? "#fff" : colors.textSecondary }]}>{getMonthLabel(m)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Scope tabs */}
        <View style={styles.locTabs}>
          {LOCATION_TABS.map((tab) => {
            const active = activeScope === tab.key;
            const pCount = participantCounts[tab.key];
            // Reward indicator per tab
            const tabReward = (() => {
              if (!battle) return null;
              if (tab.key === "india") return `₹${fmtINR(battle.totalPool)}`;
              const coins = battle[VCOIN_KEY[tab.key]] as number;
              return coins > 0 ? `🪙${coins}` : null;
            })();

            return (
              <TouchableOpacity key={tab.key} style={[styles.locTab, active && { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]} onPress={() => setActiveScope(tab.key)}>
                <Text style={styles.locTabIcon}>{tab.icon}</Text>
                <Text style={[styles.locTabLabel, { color: active ? "#fff" : colors.textSecondary }]}>{tab.label}</Text>
                <Text style={[styles.locTabScope, { color: active ? `${accent}CC` : colors.textSecondary }]} numberOfLines={1}>
                  {getScopeLabel(tab.key, studentMeta)}
                </Text>
                {tabReward && (
                  <Text style={[styles.locTabReward, { color: tab.key === "india" ? "#06d6a0" : "#63b3ed" }]}>
                    {tabReward}
                  </Text>
                )}
                {pCount > 0 && (
                  <View style={[styles.locTabCount, { backgroundColor: active ? `${accent}35` : "rgba(255,255,255,0.07)" }]}>
                    <Text style={[styles.locTabCountText, { color: active ? "#fff" : colors.textSecondary }]}>{pCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </LinearGradient>

      <FlatList
        data={entries.slice(3)}
        keyExtractor={(item) => item.userId}
        renderItem={renderRow}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            {/* Scope pill */}
            <View style={[styles.scopePill, { backgroundColor: "rgba(255,159,67,0.1)", borderColor: "rgba(255,159,67,0.3)" }]}>
              <Text style={[styles.scopePillText, { color: accent }]}>
                🏅 {getScopeLabel(activeScope, studentMeta)} · Class {studentMeta?.class} · {getMonthLabel(activeMonth)} · {participantCounts[activeScope]} players
              </Text>
            </View>

            {renderMyCard()}
            {renderMyRankGrid()}
            {renderCashPrizeTrack()}
            {renderVCoinCard()}

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>🏆 Rankings</Text>
              <Text style={[styles.sectionCount, { color: colors.textSecondary }]}>{entries.length} students</Text>
            </View>

            <View style={styles.colLabels}>
              <Text style={[styles.colLbl, { color: colors.textSecondary, width: 50 }]}>Player</Text>
              <Text style={[styles.colLbl, { color: colors.textSecondary, flex: 1 }]}>Name</Text>
              <Text style={[styles.colLbl, { color: colors.textSecondary, width: 44, textAlign: "center" }]}>Pts</Text>
              <Text style={[styles.colLbl, { color: colors.textSecondary, width: 36, textAlign: "center" }]}>Rank</Text>
              <Text style={[styles.colLbl, { color: colors.textSecondary, width: 60, textAlign: "right" }]}>
                {activeScope === "india" ? "Prize" : "V-Coins"}
              </Text>
            </View>

            {loading && (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={accent} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Computing ranks...</Text>
              </View>
            )}
            {!loading && entries.length >= 1 && renderPodium()}
            {!loading && entries.length === 0 && (
              <View style={styles.centered}>
                <Text style={{ fontSize: 44 }}>🏅</Text>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No entries yet</Text>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No approved Class {studentMeta?.class} reels{"\n"}
                  in {getScopeLabel(activeScope, studentMeta)}{"\n"}
                  for {getMonthLabel(activeMonth)}.{"\n\n"}
                  Upload skill reels to appear here!
                </Text>
              </View>
            )}
            {!loading && entries.length > 3 && (
              <Text style={[styles.rankListLabel, { color: colors.textSecondary }]}>
                Rankings 4 – {entries.length}
              </Text>
            )}
          </>
        }
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, position: "relative" },

  claimToast: {
    position:        "absolute",
    top:             60,
    alignSelf:       "center",
    backgroundColor: "#1a1a2e",
    borderRadius:    24,
    paddingHorizontal: 20,
    paddingVertical:   10,
    borderWidth:     1.5,
    borderColor:     "#F59E0B",
    zIndex:          99,
    shadowColor:     "#F59E0B",
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.35,
    shadowRadius:    8,
    elevation:       8,
  },
  claimToastText: {
    color:      "#F59E0B",
    fontWeight: "800",
    fontSize:   14,
    letterSpacing: 0.3,
  },
  listContent: { paddingBottom: 40 },
  centered:    { alignItems: "center", paddingVertical: 40, gap: 12 },
  loadingText: { fontSize: 14, fontWeight: "500" },
  emptyTitle:  { fontSize: 18, fontWeight: "800", marginTop: 8 },
  emptyText:   { fontSize: 13, fontWeight: "500", textAlign: "center", lineHeight: 22 },

  topHeader: { paddingHorizontal: 16, paddingBottom: 0 },

  sponsorBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 11, marginBottom: 10, overflow: "hidden", borderWidth: 1.5, borderColor: "rgba(255,159,67,0.55)", position: "relative" },
  sponsorLogo:    { fontSize: 28 },
  sponsorName:    { fontSize: 13, fontWeight: "900", color: "#ffd166" },
  sponsorTag:     { fontSize: 10, color: "rgba(255,209,102,0.75)", fontWeight: "700", marginTop: 1 },
  sponsorPoolBox: { alignItems: "flex-end" },
  sponsorPoolAmt: { fontSize: 16, fontWeight: "900", color: "#06d6a0" },
  sponsorPoolLbl: { fontSize: 9, color: "rgba(6,214,160,0.7)", fontWeight: "700", textTransform: "uppercase" },

  titleRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  appTitle:    { fontSize: 24, fontWeight: "900", color: "#fff", letterSpacing: 0.3 },
  appSubtitle: { fontSize: 12, fontWeight: "700", marginTop: 2, color: "#ff9f43" },

  monthScroll: { marginBottom: 12 },
  monthChip:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, marginRight: 8 },
  monthChipText: { fontSize: 12, fontWeight: "800" },

  locTabs:  { flexDirection: "row", gap: 6, paddingBottom: 14 },
  locTab:   { flex: 1, alignItems: "center", gap: 2, paddingVertical: 8, borderRadius: 14, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.04)" },
  locTabIcon:    { fontSize: 16 },
  locTabLabel:   { fontSize: 10, fontWeight: "800" },
  locTabScope:   { fontSize: 8, fontWeight: "600", textAlign: "center", maxWidth: 72 },
  locTabReward:  { fontSize: 8, fontWeight: "800" },
  locTabCount:   { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, marginTop: 1 },
  locTabCountText: { fontSize: 8, fontWeight: "800" },

  scopePill:     { marginHorizontal: 14, marginTop: 12, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  scopePillText: { fontSize: 10, fontWeight: "800" },

  // My Card
  myCard:              { marginHorizontal: 14, marginBottom: 10, borderRadius: 20, borderWidth: 1, padding: 13, overflow: "hidden", position: "relative" },
  myCardTop:           { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  myAvatar:            { width: 46, height: 46, borderRadius: 23, borderWidth: 2.5 },
  myAvatarPlaceholder: { width: 46, height: 46, borderRadius: 23, borderWidth: 2.5, justifyContent: "center", alignItems: "center" },
  myAvatarInitial:     { fontSize: 18, fontWeight: "900" },
  myName:              { fontSize: 14, fontWeight: "900" },
  myMetaRow:           { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" },
  myScopeBadge:        { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, borderWidth: 1 },
  myScopeBadgeText:    { fontSize: 9, fontWeight: "800" },
  rewardBadge:         { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, borderWidth: 1 },
  rewardBadgeText:     { fontSize: 9, fontWeight: "800" },
  myRankBox:           { alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1.5 },
  myRankNum:           { fontSize: 22, fontWeight: "900", lineHeight: 24 },
  myRankLabel:         { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  myStatsRow:          { flexDirection: "row", gap: 6, marginBottom: 10 },
  myStatItem:          { flex: 1, borderRadius: 9, padding: 7, alignItems: "center" },
  myStatVal:           { fontSize: 12, fontWeight: "900" },
  myStatLbl:           { fontSize: 8, fontWeight: "700", marginTop: 1 },
  progressLabelRow:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  progressLabel:       { fontSize: 9, fontWeight: "700" },
  progressBg:          { height: 7, borderRadius: 5, overflow: "hidden", marginBottom: 5 },
  progressFill:        { height: "100%", borderRadius: 5 },
  progressHint:        { fontSize: 10, fontWeight: "800" },

  // My Rank Grid
  myRankGrid:      { marginHorizontal: 14, marginBottom: 10, borderRadius: 16, borderWidth: 1.5, padding: 12 },
  myRankGridTitle: { fontSize: 12, fontWeight: "800", marginBottom: 2 },
  myRankGridSub:   { fontSize: 10, fontWeight: "600", marginBottom: 10 },
  myRankGridRow:   { flexDirection: "row", gap: 7 },
  myRankGridItem:  { flex: 1, alignItems: "center", padding: 9, borderRadius: 12, borderWidth: 1, gap: 2 },
  myRankGridIcon:  { fontSize: 17 },
  myRankGridLabel: { fontSize: 9, fontWeight: "700" },
  myRankGridRank:  { fontSize: 16, fontWeight: "900" },
  myRankGridOf:    { fontSize: 8, fontWeight: "600" },
  myRankGridCash:  { fontSize: 9, fontWeight: "800", color: "#06d6a0" },
  myRankGridVcoin: { fontSize: 9, fontWeight: "800", color: "#63b3ed" },

  // Cash prize card (India only)
  prizeCard:       { marginHorizontal: 14, marginBottom: 10, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  prizeCardHeader: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  prizeCardTitle:  { fontSize: 13, fontWeight: "800", color: "#ff9f43" },
  prizeCardSub:    { fontSize: 9, color: "rgba(255,159,67,0.6)", fontWeight: "700" },
  participantBadge:  { alignItems: "center", backgroundColor: "rgba(255,159,67,0.12)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  participantCount:  { fontSize: 16, fontWeight: "900", color: "#ff9f43" },
  participantLabel:  { fontSize: 8, fontWeight: "700", color: "rgba(255,159,67,0.6)", textTransform: "uppercase" },
  prizeRow:       { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  prizeMedal:     { fontSize: 18, width: 24, textAlign: "center" },
  prizeRankRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  prizeRankLabel: { fontSize: 11, fontWeight: "800" },
  youPrizeBadge:  { backgroundColor: "rgba(255,209,102,0.2)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  youPrizeText:   { fontSize: 9, color: "#ffd166", fontWeight: "900" },
  prizeBadgeName: { fontSize: 9, fontWeight: "700" },
  prizeExtra:     { fontSize: 9, fontWeight: "700", color: "#ff9f43", marginTop: 2 },
  prizeCash:      { fontSize: 14, fontWeight: "900", color: "#06d6a0" },

  // V-Coin card (local/district/state)
  vcoinCard:       { marginHorizontal: 14, marginBottom: 10, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  vcoinCardHeader: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  vcoinCardTitle:  { fontSize: 13, fontWeight: "800", color: "#63b3ed" },
  vcoinCardSub:    { fontSize: 9, color: "rgba(99,179,237,0.6)", fontWeight: "700" },
  vcoinCardEmpty:  { fontSize: 12, fontWeight: "500", textAlign: "center", padding: 16 },
  vcoinRow:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1 },
  vcoinRankCol:    { width: 28, alignItems: "center" },
  vcoinRankNum:    { fontSize: 11, fontWeight: "900" },
  vcoinRankLabel:  { fontSize: 11, fontWeight: "800" },
  youVcoinTag:     { fontSize: 9, color: "#63b3ed", fontWeight: "900" },
  vcoinPct:        { fontSize: 9, fontWeight: "600" },
  vcoinAmount:     { alignItems: "flex-end" },
  vcoinAmountText: { fontSize: 13, fontWeight: "900", color: "#63b3ed" },
  vcoinAmountLabel:{ fontSize: 8, fontWeight: "700", color: "rgba(99,179,237,0.6)" },
  vcoinFooter:     { paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1 },
  vcoinFooterText: { fontSize: 10, fontWeight: "600", textAlign: "center" },

  // Podium
  podiumRow:               { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", marginHorizontal: 14, marginBottom: 12, gap: 6 },
  podiumItem:              { flex: 1, alignItems: "center" },
  podiumAvatarWrap:        { position: "relative", marginBottom: 5 },
  podiumAvatar:            { width: 48, height: 48, borderRadius: 24, borderWidth: 3 },
  podiumAvatarLarge:       { width: 58, height: 58, borderRadius: 29 },
  podiumAvatarPlaceholder: { width: 48, height: 48, borderRadius: 24, borderWidth: 3, justifyContent: "center", alignItems: "center" },
  podiumInitial:           { fontSize: 18, fontWeight: "800" },
  crown:                   { position: "absolute", top: -12, left: "50%", fontSize: 14, zIndex: 1 },
  podiumMedal:             { position: "absolute", bottom: -3, right: -3, fontSize: 13 },
  podiumName:              { fontSize: 11, fontWeight: "800", textAlign: "center", maxWidth: 74 },
  podiumScore:             { fontSize: 12, fontWeight: "900", marginBottom: 2 },
  podiumReward:            { fontSize: 10, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, marginBottom: 3 },
  podiumBar:               { width: "100%", borderTopLeftRadius: 8, borderTopRightRadius: 8 },

  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 14, marginBottom: 6, marginTop: 4 },
  sectionTitle:  { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  sectionCount:  { fontSize: 9, fontWeight: "700" },
  colLabels:     { flexDirection: "row", alignItems: "center", marginHorizontal: 14, marginBottom: 4, paddingHorizontal: 4 },
  colLbl:        { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  rankListLabel: { marginHorizontal: 14, marginBottom: 8, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },

  // Leaderboard row
  row:                  { flexDirection: "row", alignItems: "center", marginHorizontal: 14, marginBottom: 7, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, position: "relative", overflow: "hidden" },
  rowAvatarCol:         { width: 46, marginRight: 8 },
  rowAvatar:            { width: 40, height: 40, borderRadius: 20 },
  rowAvatarPlaceholder: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  rowAvatarInitial:     { fontSize: 15, fontWeight: "900" },
  rowInfoCol:           { flex: 1, marginRight: 4 },
  rowName:              { fontSize: 12, fontWeight: "800" },
  youTag:               { fontSize: 9, color: "#ffd166", fontWeight: "900" },
  rowSub:               { fontSize: 9, marginTop: 1 },
  rowLoc:               { fontSize: 9, marginTop: 1 },
  rowScoreCol:          { width: 44, alignItems: "center", marginRight: 2 },
  rowScore:             { fontSize: 13, fontWeight: "900", lineHeight: 15 },
  rowScoreLbl:          { fontSize: 8, fontWeight: "700" },
  rowRankCol:           { width: 34, alignItems: "center", marginRight: 2 },
  rowRankEmoji:         { fontSize: 17 },
  rowRankNum:           { fontSize: 11, fontWeight: "900" },
  rowRewardCol:         { width: 60, alignItems: "flex-end" },
  rowReward:            { fontSize: 10, fontWeight: "800", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 7, textAlign: "right" },
  spRibbon:             { position: "absolute", top: 0, right: 0, backgroundColor: "#c026d3", paddingHorizontal: 6, paddingVertical: 3, borderBottomLeftRadius: 8, borderTopRightRadius: 14 },
  spRibbonText:         { fontSize: 8, fontWeight: "900", color: "#fff", letterSpacing: 0.5 },
});