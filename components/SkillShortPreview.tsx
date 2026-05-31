/**
 * components/SkillShortPreview.tsx
 * ─────────────────────────────────────────────────────────────
 * Home page horizontal preview strip.
 * Shows TWO rows:
 *   1. 🎬 Short Reels  — admin-curated (short_reels collection),
 *                         personalised by class/language/state/interest
 *   2. 🏆 Skill Battle  — approved student battle reels (existing logic)
 *
 * Tapping either row opens reels.tsx with the correct tab.
 */

import { useAppTranslation } from "@/context/LanguageContext";
import { useTheme }          from "@/context/ThemeContext";
import { auth, db }          from "@/lib/firebase";
import { Ionicons }          from "@expo/vector-icons";
import { LinearGradient }    from "expo-linear-gradient";
import { router }            from "expo-router";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ── Battle reel status config ─────────────────────────────────
const STATUS_CFG: Record<string, { emoji: string; label: string; bg: string }> = {
  pending:   { emoji: "⏳", label: "Pending Review", bg: "rgba(243,156,18,0.92)" },
  in_review: { emoji: "🔍", label: "In Review",      bg: "rgba(52,152,219,0.92)"  },
  rejected:  { emoji: "❌", label: "Rejected",        bg: "rgba(231,76,60,0.92)"   },
};

// ── Category color map ────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  Motivation:       "#FF6B6B",
  "Study Tips":     "#4ECDC4",
  "Science Facts":  "#45B7D1",
  "Math Tricks":    "#96CEB4",
  "Current Affairs":"#FFEAA7",
  "Career Guidance":"#DDA0DD",
  "Life Skills":    "#98D8C8",
  "Exam Hacks":     "#F7DC6F",
  "Fun Learning":   "#85C1E9",
  General:          "#AED6F1",
};

interface StudentProfile {
  class?: string;
  language?: string;
  location?: { state?: string };
  interests?: string[];
}

interface ShortReelPreview {
  id: string;
  title: string;
  category?: string;
  thumbnail?: string;
  views?: number;
  likes?: number;
  featured?: boolean;
  targetClass?: string[];
  targetLanguage?: string[];
  targetState?: string[];
  targetInterest?: string[];
}

// ── Personalization scoring ───────────────────────────────────
function scoreReel(reel: ShortReelPreview, student: StudentProfile | null): number {
  if (!student) return reel.featured ? 3 : 0;
  let score = 0;
  const tc = reel.targetClass    ?? ["All"];
  const tl = reel.targetLanguage ?? ["All"];
  const ts = reel.targetState    ?? ["All"];
  const ti = reel.targetInterest ?? ["All"];
  if (tc.includes("All") || (student.class && tc.includes(student.class)))               score += 10;
  if (tl.includes("All") || (student.language && tl.includes(student.language)))         score += 8;
  if (ts.includes("All") || (student.location?.state && ts.includes(student.location.state))) score += 5;
  if (ti.includes("All"))                                                                  score += 2;
  else if (student.interests?.some((i) => ti.includes(i)))                               score += 6;
  if (reel.featured) score += 3;
  return score;
}

const fmt = (n?: number) => {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

// ─────────────────────────────────────────────────────────────
// Short Reels Row
// ─────────────────────────────────────────────────────────────
function ShortReelsRow() {
  const { colors }  = useTheme();
  const { t }       = useAppTranslation();
  const [reels,   setReels]   = useState<ShortReelPreview[]>([]);
  const [student, setStudent] = useState<StudentProfile | null>(null);

  // Load student profile
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, "students", uid)).then((s) => {
      if (s.exists()) setStudent(s.data() as StudentProfile);
    }).catch(() => {});
  }, []);

  // Load & personalise short reels
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "short_reels"), where("status", "==", "active")),
      (snap) => {
        const all: ShortReelPreview[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ShortReelPreview, "id">) }));
        const sorted = all
          .map((r) => ({ r, s: scoreReel(r, student) }))
          .sort((a, b) => b.s - a.s)
          .map(({ r }) => r)
          .slice(0, 12);
        setReels(sorted);
      },
      () => setReels([])
    );
    return () => unsub();
  }, [student]);

  if (reels.length === 0) return null;

  return (
    <View style={sr.section}>
      {/* Header */}
      <View style={sr.header}>
        <View style={sr.headerLeft}>
          <Text style={{ fontSize: 20 }}>🎬</Text>
          <View>
            <Text style={[sr.title, { color: colors.text }]}>Short Reels</Text>
            <Text style={[sr.sub, { color: colors.textSecondary }]}>Curated by Vidya AI</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[sr.seeAllBtn, { borderColor: "#6C63FF" }]}
          onPress={() => router.push({ pathname: "/reels", params: { tab: "short" } })}
        >
          <Text style={[sr.seeAllText, { color: "#6C63FF" }]}>See All</Text>
          <Ionicons name="chevron-forward" size={14} color="#6C63FF" />
        </TouchableOpacity>
      </View>

      {/* Horizontal scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={sr.scrollContent}
        decelerationRate="fast"
        snapToInterval={132}
        snapToAlignment="start"
      >
        {/* "Watch All" card */}
        <TouchableOpacity
          style={sr.watchAllCard}
          onPress={() => router.push({ pathname: "/reels", params: { tab: "short" } })}
          activeOpacity={0.85}
        >
          <LinearGradient colors={["#6C63FF", "#8B5CF6"]} style={sr.watchAllGrad}>
            <Text style={{ fontSize: 28 }}>▶</Text>
            <Text style={sr.watchAllText}>Watch{"\n"}All</Text>
            <Text style={sr.watchAllCount}>{reels.length} reels</Text>
          </LinearGradient>
        </TouchableOpacity>

        {reels.map((reel, idx) => {
          const catColor = CAT_COLORS[reel.category ?? ""] ?? "#6C63FF";
          return (
            <TouchableOpacity
              key={reel.id}
              style={sr.card}
              onPress={() => router.push({ pathname: "/reels", params: { tab: "short", startIndex: idx } })}
              activeOpacity={0.85}
            >
              {/* Thumbnail */}
              {reel.thumbnail ? (
                <Image source={{ uri: reel.thumbnail }} style={sr.image} resizeMode="cover" />
              ) : (
                <View style={[sr.image, { backgroundColor: catColor + "33", alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ fontSize: 30 }}>🎬</Text>
                </View>
              )}

              <LinearGradient colors={["transparent", "rgba(0,0,0,0.75)"]} style={StyleSheet.absoluteFillObject} />

              {/* Play button */}
              <View style={sr.playBtn}>
                <Ionicons name="play" size={16} color="#fff" />
              </View>

              {/* Featured badge */}
              {reel.featured && (
                <View style={sr.featuredBadge}>
                  <Text style={sr.featuredText}>⭐</Text>
                </View>
              )}

              {/* Category */}
              <View style={[sr.catBadge, { backgroundColor: catColor + "cc" }]}>
                <Text style={sr.catText}>{reel.category ?? "General"}</Text>
              </View>

              {/* Title */}
              <Text style={sr.cardTitle} numberOfLines={2}>{reel.title}</Text>

              {/* Stats */}
              <View style={sr.statsRow}>
                <Text style={sr.stat}>👁 {fmt(reel.views)}</Text>
                <Text style={sr.stat}>❤️ {fmt(reel.likes)}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const CARD_W = 120;
const CARD_H = 185;

const sr = StyleSheet.create({
  section:     { marginBottom: 8 },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
  headerLeft:  { flexDirection: "row", alignItems: "center", gap: 10 },
  title:       { fontSize: 16, fontWeight: "800" },
  sub:         { fontSize: 12, marginTop: 1 },
  seeAllBtn:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5 },
  seeAllText:  { fontSize: 13, fontWeight: "700" },
  scrollContent:{ paddingHorizontal: 16, gap: 10 },
  watchAllCard: { width: CARD_W * 0.78, height: CARD_H, borderRadius: 14, overflow: "hidden" },
  watchAllGrad: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  watchAllText: { color: "#fff", fontSize: 15, fontWeight: "900", textAlign: "center" },
  watchAllCount:{ color: "rgba(255,255,255,0.75)", fontSize: 11 },
  card:        { width: CARD_W, height: CARD_H, borderRadius: 14, overflow: "hidden", elevation: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 5 },
  image:       { width: CARD_W, height: CARD_H },
  playBtn:     { position: "absolute", top: "50%", left: "50%", marginTop: -14, marginLeft: -14, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  featuredBadge:{ position: "absolute", top: 7, right: 7, backgroundColor: "rgba(0,0,0,0.5)", width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featuredText: { fontSize: 10 },
  catBadge:    { position: "absolute", bottom: 40, left: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  catText:     { color: "#fff", fontSize: 9, fontWeight: "800" },
  cardTitle:   { position: "absolute", bottom: 20, left: 6, right: 6, color: "#fff", fontSize: 10, fontWeight: "700", lineHeight: 13 },
  statsRow:    { position: "absolute", bottom: 6, left: 6, right: 6, flexDirection: "row", gap: 8 },
  stat:        { color: "rgba(255,255,255,0.75)", fontSize: 9 },
});

// ─────────────────────────────────────────────────────────────
// Skill Battle Row (original, preserved)
// ─────────────────────────────────────────────────────────────
function SkillBattleRow() {
  const { colors } = useTheme();
  const { t }      = useAppTranslation();
  const [reels,      setReels]      = useState<any[]>([]);
  const [ownPending, setOwnPending] = useState<any[]>([]);

  useEffect(() => {
    const q = query(
      collection(db, "posts"),
      where("isSkillBattle", "==", true),
      where("status",        "==", "approved")
    );
    const unsub = onSnapshot(q, (snap) => {
      const sorted = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (b.views || 0) - (a.views || 0))
        .slice(0, 10);
      setReels(sorted);
    }, () => setReels([]));
    return () => unsub();
  }, []);

  useEffect(() => {
    let unsubQuery: (() => void) | null = null;
    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (unsubQuery) { unsubQuery(); unsubQuery = null; }
      if (!user) { setOwnPending([]); return; }
      const q = query(collection(db, "posts"), where("userId", "==", user.uid));
      unsubQuery = onSnapshot(q, (snap) => {
        setOwnPending(
          snap.docs
            .filter((d) => { const dt = d.data(); return dt.isSkillBattle === true && dt.status !== "approved"; })
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        );
      }, () => setOwnPending([]));
    });
    return () => { unsubAuth(); if (unsubQuery) unsubQuery(); };
  }, []);

  const allItems = [...ownPending, ...reels];
  if (allItems.length === 0) return null;

  const renderItem = ({ item }: any) => {
    const statusCfg = STATUS_CFG[item.status];
    return (
      <TouchableOpacity
        style={bt.card}
        onPress={() => router.push({ pathname: "/reels", params: { postId: item.id, filter: "skillbattle" } })}
        activeOpacity={0.8}
      >
        <Image source={{ uri: item.thumbnail || item.profilePic || "" }} style={bt.image} resizeMode="cover" />
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.75)"]} style={bt.gradient} />

        <View style={bt.playContainer}>
          <Ionicons name="play" size={14} color="#fff" />
        </View>

        {item.name && (
          <Text style={bt.cardTitle} numberOfLines={2}>{item.name}</Text>
        )}

        <Text style={bt.views}>{fmt(item.views)} 👁</Text>

        {statusCfg && (
          <View style={[bt.statusPill, { backgroundColor: statusCfg.bg }]}>
            <Text style={bt.statusPillText}>{statusCfg.emoji} {statusCfg.label}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={bt.section}>
      <View style={bt.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 20 }}>🏆</Text>
          <View>
            <Text style={[bt.title, { color: colors.text }]}>{t("skillShorts") ?? "Skill Battle Reels"}</Text>
            <Text style={[bt.sub, { color: colors.textSecondary }]}>Top approved reels</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => router.push({ pathname: "/reels", params: { filter: "skillbattle" } })}>
          <Text style={bt.viewAll}>{t("viewAll") ?? "View All"}</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={allItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      />
    </View>
  );
}

const bt = StyleSheet.create({
  section:      { marginBottom: 8 },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
  title:        { fontSize: 16, fontWeight: "800" },
  sub:          { fontSize: 12, marginTop: 1 },
  viewAll:      { fontSize: 13, fontWeight: "700", color: "#f97316" },
  card:         { width: 120, height: 180, borderRadius: 14, overflow: "hidden", elevation: 5, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6 },
  image:        { width: 120, height: 180, backgroundColor: "#e5e7eb" },
  gradient:     { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12 },
  playContainer:{ position: "absolute", top: "50%", left: "50%", marginLeft: -15, marginTop: -15, backgroundColor: "rgba(255,255,255,0.3)", width: 30, height: 30, borderRadius: 15, justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: "#fff" },
  cardTitle:    { position: "absolute", bottom: 32, left: 8, right: 8, color: "#fff", fontSize: 11, fontWeight: "600", lineHeight: 14 },
  views:        { position: "absolute", bottom: 8, left: 8, backgroundColor: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, fontWeight: "600", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  statusPill:   { position: "absolute", bottom: 8, right: 8, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6 },
  statusPillText: { color: "#fff", fontSize: 10, fontWeight: "800" },
});

// ─────────────────────────────────────────────────────────────
// Default export — both rows together
// ─────────────────────────────────────────────────────────────
export default function SkillShortPreview() {
  return (
    <View>
      <ShortReelsRow />
      <SkillBattleRow />
    </View>
  );
}
