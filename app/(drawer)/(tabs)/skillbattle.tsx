import Header from "@/components/header";
import { useTheme } from "@/context/ThemeContext";
import { auth, db } from "@/lib/firebase";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Types ────────────────────────────────────────────────────
interface Battle {
  id:               string;
  title:            string;
  description:      string;
  type:             "sponsored";
  sponsor?:         string;
  sponsorLogo?:     string;
  month:            string;
  startDate?:       string;
  endDate?:         string;
  isActive:         boolean;
  eligibleClasses:  unknown;
  totalPool?:       string;
  bannerImage?:     string;
  participantCount: number;
  // V-Coin fields
  vcoin_india?:     number;
  vcoin_state?:     number;
  vcoin_district?:  number;
  vcoin_local?:     number;
}

interface StudentData {
  class:     string;
  name:      string;
  profilePic: string;
  location: {
    city:     string;
    district: string;
    state:    string;
    pincode:  string;
  };
}

// My rank snapshot per battle
interface MyBattleRank {
  battleId:    string;
  indiaRank:   number;
  stateRank:   number;
  districtRank:number;
  localRank:   number;
  totalScore:  number;
  participants:{
    india:    number;
    state:    number;
    district: number;
    local:    number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────
const normalizeEligibleClasses = (raw: unknown): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as (string | number)[]).map(String);
  if (typeof raw === "number") return [String(raw)];
  if (typeof raw === "string" && raw.includes(","))
    return raw.split(",").map((s) => s.trim());
  return [String(raw)];
};

const getTimeLeft = (endDate?: string): string => {
  if (!endDate) return "Ongoing";
  const diff = new Date(endDate).getTime() - Date.now();
  if (isNaN(diff)) return "Ongoing";
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
};

const isEligible = (studentClass: string, eligibleClasses: string[]): boolean => {
  if (eligibleClasses.length === 0) return true;
  return eligibleClasses.includes(String(studentClass));
};

const getMedalEmoji = (r: number) =>
  r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : "";

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const SCORE_WEIGHTS = { likes: 5, views: 1, shares: 8, comments: 3, watchtime: 0.1 };

const computeScore = (p: any): number =>
  (p.likes     || 0) * SCORE_WEIGHTS.likes    +
  (p.views     || 0) * SCORE_WEIGHTS.views    +
  (p.shares    || 0) * SCORE_WEIGHTS.shares   +
  (p.comments  || 0) * SCORE_WEIGHTS.comments +
  (p.watchTime || 0) * SCORE_WEIGHTS.watchtime;

// ─── Rank mini-card ───────────────────────────────────────────
function RankMiniCard({
  icon, label, rank, total, reward, rewardColor, accent,
}: {
  icon: string; label: string; rank: number; total: number;
  reward?: string; rewardColor?: string; accent: string;
}) {
  return (
    <View style={[rankStyles.cell, { borderColor: rank > 0 ? `${accent}40` : "rgba(255,255,255,0.06)", backgroundColor: rank > 0 ? `${accent}10` : "rgba(255,255,255,0.03)" }]}>
      <Text style={rankStyles.icon}>{icon}</Text>
      <Text style={[rankStyles.label, { color: "rgba(255,255,255,0.5)" }]}>{label}</Text>
      <Text style={[rankStyles.rank, { color: rank > 0 ? accent : "rgba(255,255,255,0.2)" }]}>
        {rank > 0 ? (getMedalEmoji(rank) || `#${rank}`) : "—"}
      </Text>
      {rank > 0 && total > 0 && (
        <Text style={[rankStyles.of, { color: "rgba(255,255,255,0.3)" }]}>of {total}</Text>
      )}
      {reward && reward !== "—" && (
        <Text style={[rankStyles.reward, { color: rewardColor ?? "#06d6a0" }]}>{reward}</Text>
      )}
    </View>
  );
}

const rankStyles = StyleSheet.create({
  cell:   { flex: 1, alignItems: "center", borderRadius: 12, borderWidth: 1, paddingVertical: 8, gap: 2 },
  icon:   { fontSize: 16 },
  label:  { fontSize: 8, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  rank:   { fontSize: 15, fontWeight: "900" },
  of:     { fontSize: 7, fontWeight: "600" },
  reward: { fontSize: 8, fontWeight: "800" },
});

// ─── Component ────────────────────────────────────────────────
export default function SkillBattleScreen() {
  const { colors } = useTheme();
  const router     = useRouter();

  const [battles,    setBattles]    = useState<Battle[]>([]);
  const [student,    setStudent]    = useState<StudentData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState("");
  // Map of battleId → my rank data
  const [myRanks,    setMyRanks]    = useState<Record<string, MyBattleRank>>({});
  const [ranksLoading, setRanksLoading] = useState(false);

  // ── Fetch student ─────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const snap = await getDoc(doc(db, "students", uid));
        if (snap.exists()) {
          const d = snap.data();
          setStudent({
            class:      d.class !== undefined ? String(d.class) : "",
            name:       d.name        ?? "",
            profilePic: d.profilePic  ?? "",
            location: {
              city:     d.location?.city     ?? "",
              district: d.location?.district ?? "",
              state:    d.location?.state    ?? "",
              pincode:  d.location?.pincode  ?? "",
            },
          });
        }
      } catch (e) { console.error("fetchStudent:", e); }
    };
    load();
  }, []);

  // ── Fetch battles ─────────────────────────────────────────
  const fetchBattles = useCallback(async () => {
    setFetchError("");
    try {
      const snap = await getDocs(collection(db, "skillBattles"));
      const data = snap.docs.map((d) => {
        const raw     = d.data();
        const cleaned: Record<string, unknown> = {};
        Object.entries(raw).forEach(([k, v]) => { cleaned[k.trim()] = v; });
        return { id: d.id, ...cleaned } as Battle;
      });

      const active = data
        .filter((b) => b.isActive === true)
        .sort((a, b) => {
          const da = new Date(a.startDate ?? a.month ?? "").getTime() || 0;
          const db_ = new Date(b.startDate ?? b.month ?? "").getTime() || 0;
          return db_ - da;
        });

      // ── Count real participants live from posts collection ──
      // participantCount in skillBattles doc is often 0/stale
      // Count unique userId values per battleId in approved posts
      const enriched = await Promise.all(
        active.map(async (battle) => {
          try {
            const pSnap = await getDocs(query(
              collection(db, "posts"),
              where("battleId",    "==", battle.id),
              where("isSkillBattle","==", true),
              where("status",      "==", "approved")
            ));
            // Count unique students (one student may have multiple posts)
            const uniqueUsers = new Set(pSnap.docs.map((d) => d.data().userId));
            return { ...battle, participantCount: uniqueUsers.size };
          } catch (_) {
            return battle;
          }
        })
      );

      setBattles(enriched);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("fetchBattles:", msg);
      setFetchError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchBattles(); }, [fetchBattles]);
  useFocusEffect(useCallback(() => { fetchBattles(); }, [fetchBattles]));

  // ── Compute my ranks for all active battles ───────────────
  useEffect(() => {
    if (!student || battles.length === 0) return;

    const computeAllRanks = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      setRanksLoading(true);

      const result: Record<string, MyBattleRank> = {};

      await Promise.all(
        battles.map(async (battle) => {
          try {
            const cls = student.class;

            // 4 scope queries in parallel for this battle
            const scopeConfigs = [
              { scope: "india",    extra: null },
              { scope: "state",    extra: where("location.state",   "==", student.location.state)   },
              { scope: "district", extra: where("location.district","==", student.location.district) },
              { scope: "local",    extra: where("location.pincode", "==", student.location.pincode)  },
            ] as const;

            const scopeResults = await Promise.all(
              scopeConfigs.map(async ({ scope, extra }) => {
                const constraints = [
                  where("isSkillBattle", "==", true),
                  where("status",        "==", "approved"),
                  where("class",         "==", cls),
                  where("month",         "==", battle.month),
                  ...(extra ? [extra] : []),
                ];
                const snap = await getDocs(query(collection(db, "posts"), ...constraints));

                const scoreMap = new Map<string, number>();
                snap.docs.forEach((d) => {
                  const p = d.data();
                  if (!p.userId) return;
                  scoreMap.set(p.userId, (scoreMap.get(p.userId) ?? 0) + computeScore(p));
                });

                const sorted    = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]);
                const myIdx     = sorted.findIndex(([u]) => u === uid);
                const myScore   = myIdx >= 0 ? sorted[myIdx][1] : 0;

                return {
                  scope,
                  rank:         myIdx >= 0 ? myIdx + 1 : 0,
                  participants: sorted.length,
                  score:        myScore,
                };
              })
            );

            const india    = scopeResults.find((r) => r.scope === "india")!;
            const state    = scopeResults.find((r) => r.scope === "state")!;
            const district = scopeResults.find((r) => r.scope === "district")!;
            const local    = scopeResults.find((r) => r.scope === "local")!;

            result[battle.id] = {
              battleId:     battle.id,
              indiaRank:    india.rank,
              stateRank:    state.rank,
              districtRank: district.rank,
              localRank:    local.rank,
              totalScore:   india.score,
              participants: {
                india:    india.participants,
                state:    state.participants,
                district: district.participants,
                local:    local.participants,
              },
            };
          } catch (e) {
            console.log(`rank error [${battle.id}]:`, e);
          }
        })
      );

      setMyRanks(result);
      setRanksLoading(false);
    };

    computeAllRanks();
  }, [student, battles]);

  const onRefresh = () => { setRefreshing(true); fetchBattles(); };

  // ── Battle card ───────────────────────────────────────────
  const renderBattle = ({ item }: { item: Battle }) => {
    const eligibleClasses = normalizeEligibleClasses(item.eligibleClasses);
    const eligible        = student ? isEligible(student.class, eligibleClasses) : true;
    const timeLeft        = getTimeLeft(item.endDate);
    const ended           = timeLeft === "Ended";
    const accent          = "#ff9f43";
    const firstClass      = eligibleClasses[0] ?? "";
    const lastClass       = eligibleClasses[eligibleClasses.length - 1] ?? "";
    const myRank          = myRanks[item.id];

    // V-Coin reward display for each scope
    const vcoinIndia    = item.vcoin_india    ?? 0;
    const vcoinState    = item.vcoin_state    ?? 0;
    const vcoinDistrict = item.vcoin_district ?? 0;
    const vcoinLocal    = item.vcoin_local    ?? 0;

    const getVCoinReward = (baseCoins: number, rank: number): string => {
      if (rank === 0 || rank > 10 || baseCoins === 0) return "—";
      const pcts = [30, 20, 14, 10, 8, 4, 4, 3, 3, 4];
      const coins = Math.round((baseCoins * (pcts[rank - 1] ?? 0)) / 100);
      return coins > 0 ? `🪙 ${coins}` : "—";
    };

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: "rgba(255,159,67,0.4)" }]}>

        {/* ── Header ── */}
        <LinearGradient
          colors={["#2a1500", "#1a0e00"]}
          style={styles.cardHeader}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        >
          {item.bannerImage ? (
            <Image source={{ uri: item.bannerImage }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          ) : null}
          <View style={styles.overlay} />

          {/* Sponsor badge */}
          <View style={[styles.typeBadge, { backgroundColor: accent }]}>
            <Text style={styles.typeBadgeText}>🏅 Sponsored Battle</Text>
          </View>

          {/* Timer */}
          <View style={[styles.timerBadge, ended && { backgroundColor: "rgba(255,107,107,0.25)" }]}>
            {!ended && timeLeft !== "Ongoing" && (
              <Ionicons name="time-outline" size={11} color="#ffd166" />
            )}
            <Text style={[styles.timerText, ended && { color: "#ff6b9d" }]}>{timeLeft}</Text>
          </View>

          <Text style={styles.cardTitle} numberOfLines={2}>{item.title || "Skill Battle"}</Text>
          {item.sponsor ? (
            <Text style={styles.sponsorText}>Powered by {item.sponsor}</Text>
          ) : null}
        </LinearGradient>

        {/* ── Body ── */}
        <View style={styles.cardBody}>

          {item.description ? (
            <Text style={[styles.description, { color: colors.textSecondary }]} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}

          {/* ── Stats row ── */}
          <View style={styles.statsRow}>
            {/* Participants */}
            <View style={[styles.statChip, { backgroundColor: "rgba(255,159,67,0.1)", borderColor: "rgba(255,159,67,0.25)" }]}>
              <Ionicons name="people" size={13} color={accent} />
              <Text style={[styles.statChipText, { color: accent }]}>
                {fmt(item.participantCount ?? 0)} joined
              </Text>
            </View>
            {/* Month */}
            <View style={[styles.statChip, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.statChipText, { color: colors.textSecondary }]}>{item.month}</Text>
            </View>
            {/* Class */}
            <View style={[styles.statChip, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Ionicons name="school-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.statChipText, { color: colors.textSecondary }]}>
                Class 5–12
              </Text>
            </View>
          </View>

          {/* ── Prize pool ── */}
          {item.totalPool ? (
            <View style={[styles.prizePool, { backgroundColor: "rgba(255,159,67,0.08)", borderColor: "rgba(255,159,67,0.25)" }]}>
              <Text style={styles.prizePoolIcon}>🏆</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.prizePoolLabel}>India Prize Pool</Text>
                <Text style={styles.prizePoolAmt}>{item.totalPool}</Text>
              </View>
              {/* V-Coin summary */}
              <View style={styles.vcoinSummary}>
                {vcoinIndia    > 0 && <Text style={styles.vcoinSummaryText}>🪙 India: {vcoinIndia}</Text>}
                {vcoinState    > 0 && <Text style={styles.vcoinSummaryText}>🪙 State: {vcoinState}</Text>}
                {vcoinDistrict > 0 && <Text style={styles.vcoinSummaryText}>🪙 Dist: {vcoinDistrict}</Text>}
              </View>
            </View>
          ) : null}

          {/* ── MY RANK CONTAINER ── */}
          {student && myRank && myRank.totalScore > 0 ? (
            <View style={styles.myRankContainer}>
              <LinearGradient
                colors={["#1a0e00", "#2a1500"]}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              />

              {/* Header row */}
              <View style={styles.myRankHeader}>
                <View style={styles.myRankLeft}>
                  {student.profilePic ? (
                    <Image source={{ uri: student.profilePic }} style={styles.myRankAvatar} />
                  ) : (
                    <View style={[styles.myRankAvatarPlaceholder, { backgroundColor: `${accent}25` }]}>
                      <Text style={[styles.myRankAvatarInitial, { color: accent }]}>
                        {student.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View>
                    <Text style={styles.myRankName}>{student.name}</Text>
                    <Text style={styles.myRankScore}>
                      {myRank.totalScore.toLocaleString()} pts · Class {student.class}
                    </Text>
                  </View>
                </View>
                <View style={styles.myRankScoreBadge}>
                  <Text style={styles.myRankScoreBadgeText}>
                    {ranksLoading ? "..." : myRank.indiaRank > 0 ? `#${myRank.indiaRank}` : "—"}
                  </Text>
                  <Text style={styles.myRankScoreBadgeLabel}>India Rank</Text>
                </View>
              </View>

              {/* 4-scope grid */}
              {ranksLoading ? (
                <View style={{ alignItems: "center", paddingVertical: 8 }}>
                  <ActivityIndicator size="small" color={accent} />
                  <Text style={{ color: "rgba(255,159,67,0.6)", fontSize: 10, marginTop: 4 }}>
                    Computing your ranks...
                  </Text>
                </View>
              ) : (
                <View style={styles.myRankGrid}>
                  <RankMiniCard
                    icon="🇮🇳" label="India"
                    rank={myRank.indiaRank}
                    total={myRank.participants.india}
                    reward={item.totalPool && myRank.indiaRank > 0 && myRank.indiaRank <= 10 ? "Cash 💰" : undefined}
                    rewardColor="#06d6a0"
                    accent={accent}
                  />
                  <RankMiniCard
                    icon="🗺️" label="State"
                    rank={myRank.stateRank}
                    total={myRank.participants.state}
                    reward={getVCoinReward(vcoinState, myRank.stateRank)}
                    rewardColor="#63b3ed"
                    accent={accent}
                  />
                  <RankMiniCard
                    icon="📍" label="District"
                    rank={myRank.districtRank}
                    total={myRank.participants.district}
                    reward={getVCoinReward(vcoinDistrict, myRank.districtRank)}
                    rewardColor="#63b3ed"
                    accent={accent}
                  />
                  <RankMiniCard
                    icon="🏘️" label="Local"
                    rank={myRank.localRank}
                    total={myRank.participants.local}
                    reward={getVCoinReward(vcoinLocal, myRank.localRank)}
                    rewardColor="#63b3ed"
                    accent={accent}
                  />
                </View>
              )}

              {/* View full skillboard button */}
              <TouchableOpacity
                style={styles.skillboardBtn}
                onPress={() => router.push({
                  pathname: "/skillboard",
                  params: { battleId: item.id, month: item.month },
                })}
              >
                <LinearGradient
                  colors={[accent, "#ff6b6b"]}
                  style={styles.skillboardBtnGradient}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                >
                  <Ionicons name="trophy" size={15} color="#fff" />
                  <Text style={styles.skillboardBtnText}>View Full Skillboard</Text>
                  <Ionicons name="chevron-forward" size={15} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
            /* Not yet ranked — show a subtle prompt */
            student && eligible && !ended ? (
              <View style={[styles.noRankBanner, { borderColor: "rgba(255,159,67,0.2)", backgroundColor: "rgba(255,159,67,0.06)" }]}>
                <Text style={styles.noRankIcon}>🎯</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.noRankTitle, { color: accent }]}>You're not ranked yet</Text>
                  <Text style={[styles.noRankSub, { color: colors.textSecondary }]}>
                    Upload a reel to enter the battle and earn ranks!
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.skillboardBtnSmall}
                  onPress={() => router.push({
                    pathname: "/skillboard",
                    params: { battleId: item.id, month: item.month },
                  })}
                >
                  <Text style={[styles.skillboardBtnSmallText, { color: accent }]}>Leaderboard →</Text>
                </TouchableOpacity>
              </View>
            ) : null
          )}

          {/* Not eligible */}
          {student && !eligible ? (
            <View style={[styles.ineligibleBanner, { backgroundColor: "rgba(255,107,157,0.1)", borderColor: "rgba(255,107,157,0.3)" }]}>
              <Ionicons name="lock-closed-outline" size={13} color="#ff6b9d" />
              <Text style={styles.ineligibleText}>
                Class {student.class} not eligible · Requires Class 5–12
              </Text>
            </View>
          ) : null}

          {/* CTA */}
          <TouchableOpacity
            style={[
              styles.ctaBtn,
              {
                backgroundColor: ended || (student && !eligible) ? colors.border : accent,
                opacity:         ended || (student && !eligible) ? 0.55 : 1,
              },
            ]}
            disabled={ended || (student ? !eligible : false)}
            onPress={() => router.push({
              pathname:  "/create-post",
              params: {
                battleId:    item.id,
                battleTitle: item.title,
                battleType:  item.type,
                month:       item.month,
              },
            })}
          >
            <Ionicons name={ended ? "lock-closed" : "videocam"} size={16} color="#fff" />
            <Text style={styles.ctaBtnText}>
              {ended
                ? "Battle Ended"
                : student && !eligible
                  ? "Not Eligible"
                  : "🚀 Upload Reel"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ── Main ──────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header />

      {/* Student notice */}
      {student ? (
        <View style={[styles.notice, { backgroundColor: `${colors.accent}12`, borderColor: `${colors.accent}30` }]}>
          <Ionicons name="person-circle-outline" size={16} color={colors.accent} />
          <Text style={[styles.noticeText, { color: colors.accent }]}>
            {student.name} · Class {student.class} · {student.location.district}
          </Text>
        </View>
      ) : null}

      {/* Error */}
      {fetchError ? (
        <View style={[styles.errorBanner, { backgroundColor: "rgba(255,107,157,0.1)", borderColor: "rgba(255,107,157,0.3)" }]}>
          <Ionicons name="warning-outline" size={14} color="#ff6b9d" />
          <Text style={styles.errorText}>{fetchError}</Text>
          <TouchableOpacity onPress={fetchBattles}>
            <Text style={[styles.retryText, { color: colors.accent }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading battles...</Text>
        </View>
      ) : (
        <FlatList
          data={battles}
          keyExtractor={(item) => item.id}
          renderItem={renderBattle}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={{ fontSize: 44 }}>🎯</Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No Active Battles</Text>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Check back soon for new skill battles!
              </Text>
              <TouchableOpacity
                style={[styles.retryBtn, { backgroundColor: colors.accent }]}
                onPress={fetchBattles}
              >
                <Text style={styles.retryBtnText}>🔄 Refresh</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1 },
  centered:    { alignItems: "center", paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 14, fontWeight: "500" },
  emptyTitle:  { fontSize: 18, fontWeight: "800", marginTop: 8 },
  emptyText:   { fontSize: 13, fontWeight: "500", textAlign: "center" },

  notice:     { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 16, marginTop: 10, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  noticeText: { fontSize: 11, fontWeight: "700", flex: 1 },

  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  errorText:   { flex: 1, fontSize: 11, fontWeight: "600", color: "#ff6b9d" },
  retryText:   { fontSize: 11, fontWeight: "800" },
  retryBtn:    { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 4 },
  retryBtnText:{ color: "#fff", fontSize: 13, fontWeight: "700" },

  list: { padding: 16, gap: 16, paddingBottom: 40 },

  card: { borderRadius: 20, overflow: "hidden", borderWidth: 1.5, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5 },

  cardHeader: { height: 150, padding: 14, justifyContent: "flex-end", position: "relative" },
  overlay:    { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.52)" },

  typeBadge:     { position: "absolute", top: 12, left: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  typeBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },

  timerBadge: { position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,209,102,0.2)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  timerText:  { color: "#ffd166", fontSize: 11, fontWeight: "700" },

  cardTitle:   { color: "#fff", fontSize: 16, fontWeight: "900", lineHeight: 22 },
  sponsorText: { color: "rgba(255,159,67,0.85)", fontSize: 10, fontWeight: "700", marginTop: 3 },

  cardBody:    { padding: 14, gap: 10 },
  description: { fontSize: 13, fontWeight: "500", lineHeight: 18 },

  statsRow:      { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  statChip:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  statChipText:  { fontSize: 11, fontWeight: "700" },

  prizePool:         { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 12 },
  prizePoolIcon:     { fontSize: 22 },
  prizePoolLabel:    { fontSize: 9, fontWeight: "700", color: "rgba(255,159,67,0.7)", textTransform: "uppercase" },
  prizePoolAmt:      { fontSize: 16, fontWeight: "900", color: "#ff9f43" },
  vcoinSummary:      { gap: 2, alignItems: "flex-end" },
  vcoinSummaryText:  { fontSize: 9, fontWeight: "700", color: "#63b3ed" },

  // ── My Rank Container ──
  myRankContainer: {
    borderRadius: 16, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,159,67,0.35)",
    padding: 12, gap: 10, position: "relative",
  },
  myRankHeader:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  myRankLeft:       { flexDirection: "row", alignItems: "center", gap: 9 },
  myRankAvatar:     { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: "#ff9f43" },
  myRankAvatarPlaceholder: { width: 38, height: 38, borderRadius: 19, justifyContent: "center", alignItems: "center" },
  myRankAvatarInitial:     { fontSize: 16, fontWeight: "900" },
  myRankName:       { fontSize: 13, fontWeight: "800", color: "#fff" },
  myRankScore:      { fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.5)" },
  myRankScoreBadge: { alignItems: "center", backgroundColor: "rgba(255,159,67,0.15)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,159,67,0.3)" },
  myRankScoreBadgeText:  { fontSize: 18, fontWeight: "900", color: "#ffd166" },
  myRankScoreBadgeLabel: { fontSize: 8, fontWeight: "800", color: "rgba(255,209,102,0.6)", textTransform: "uppercase" },

  myRankGrid: { flexDirection: "row", gap: 6 },

  skillboardBtn:          { borderRadius: 12, overflow: "hidden", marginTop: 2 },
  skillboardBtnGradient:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11 },
  skillboardBtnText:      { color: "#fff", fontSize: 13, fontWeight: "800" },

  noRankBanner:     { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 12 },
  noRankIcon:       { fontSize: 22 },
  noRankTitle:      { fontSize: 12, fontWeight: "800" },
  noRankSub:        { fontSize: 10, fontWeight: "500", marginTop: 2 },
  skillboardBtnSmall:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,159,67,0.3)" },
  skillboardBtnSmallText: { fontSize: 11, fontWeight: "800" },

  ineligibleBanner: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, borderWidth: 1, padding: 9 },
  ineligibleText:   { color: "#ff6b9d", fontSize: 11, fontWeight: "700", flex: 1 },

  ctaBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13, borderRadius: 14 },
  ctaBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});