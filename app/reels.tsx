/**
 * app/reels.tsx  — FIXED
 *
 * Bug fixes applied:
 *
 *  1. BACKGROUND AUDIO
 *     — useFocusEffect: pauses ALL players when screen loses focus
 *       (user navigates away), resumes when screen regains focus.
 *     — AppState listener: pauses when app goes to background,
 *       resumes when app comes back to foreground.
 *     — Each VideoItem already pauses when isActive=false (scroll away),
 *       but now the screen-level pause/resume handles navigation & app state.
 *
 *  2. ANDROID NAV BAR OVERLAY  (edge-to-edge mode)
 *     — app.config.js has edgeToEdgeEnabled:true so expo-navigation-bar
 *       setBehaviorAsync / setVisibilityAsync are NOT supported.
 *     — Fix: useWindowDimensions() gives the real usable height after
 *       the system already accounts for edge-to-edge insets.
 *       Each reel cell uses { height: windowHeight } instead of the
 *       static Dimensions.get("window").height which can be stale.
 *     — useSafeAreaInsets().bottom is applied as paddingBottom on the
 *       action stack and caption so UI elements clear the nav bar.
 */

import { useTheme }          from "@/context/ThemeContext";
import { streamPlaybackUrl } from "@/lib/cloudflareStream";
import { useNavigation }     from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { VideoView, useVideoPlayer }    from "expo-video";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  AppState,
  AppStateStatus,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect }    from "@react-navigation/native";

import { auth, db, functions } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

// SCREEN_WIDTH still used for item layout width
const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ── Comment presets ───────────────────────────────────────────
const COMMENT_GROUPS = [
  { title: "Encouragement",    options: ["Very good", "Keep it up", "Well done"] },
  { title: "Skill Praise",     options: ["Excellent work", "Super effort", "Amazing skill"] },
  { title: "Learning Support", options: ["Good try", "Nice learning", "You are improving"] },
];

type PostStatus = "pending" | "in_review" | "approved" | "rejected";

type Post = {
  id: string;
  mediaUrl: string;
  userId?: string;
  name?: string;
  school?: string;
  class?: string;
  profilePic?: string;
  title?: string;
  description?: string;
  likes?: number;
  comments?: number;
  views?: number;
  shares?: number;
  status?: PostStatus;
  createdAt?: any;
};

// ── Status watermark ──────────────────────────────────────────
const WATERMARK_CONFIG: Partial<Record<PostStatus, { label: string; emoji: string; bg: string }>> = {
  pending:   { label: "PENDING REVIEW", emoji: "⏳", bg: "rgba(243,156,18,0.82)" },
  in_review: { label: "IN REVIEW",      emoji: "🔍", bg: "rgba(52,152,219,0.82)"  },
  rejected:  { label: "REJECTED",       emoji: "❌", bg: "rgba(231,76,60,0.82)"   },
};

function StatusWatermark({ status }: { status?: PostStatus }) {
  if (!status) return null;
  const cfg = WATERMARK_CONFIG[status];
  if (!cfg) return null;
  return (
    <View style={wm.wrapper} pointerEvents="none">
      <View style={wm.dim} />
      <View style={[wm.banner, { backgroundColor: cfg.bg }]}>
        <Text style={wm.bannerText}>{cfg.emoji}  {cfg.label}</Text>
      </View>
    </View>
  );
}

const wm = StyleSheet.create({
  wrapper: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  dim:     { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.38)" },
  banner: {
    position: "absolute", top: 36, left: -48,
    width: 220, paddingVertical: 6, alignItems: "center",
    transform: [{ rotate: "-35deg" }],
  },
  bannerText: { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
});

// ── CF manifest polling ───────────────────────────────────────
const WORKER_URL = process.env.EXPO_PUBLIC_CF_WORKER_URL ?? "";

function extractCfVideoId(url: string): string | null {
  const match = url?.match(/cloudflarestream\.com\/([a-zA-Z0-9]+)\//);
  return match?.[1] ?? null;
}

async function waitForManifest(
  manifestUrl: string,
  onAttempt:   (attempt: number, max: number) => void,
  intervalMs = 10_000,
  maxAttempts = 30
): Promise<boolean> {
  const videoId   = extractCfVideoId(manifestUrl);
  if (!videoId) return false;
  const statusUrl = WORKER_URL ? `${WORKER_URL}/video-status?uid=${videoId}` : null;

  for (let i = 1; i <= maxAttempts; i++) {
    onAttempt(i, maxAttempts);
    try {
      if (statusUrl) {
        const res = await fetch(statusUrl);
        if (res.status === 200) {
          const data = await res.json().catch(() => ({}));
          if (data.readyToStream === true || data.state === "ready") return true;
        } else if (res.status === 404) {
          const mRes = await fetch(manifestUrl, { method: "GET" });
          if (mRes.status === 200) return true;
        }
      } else {
        const res = await fetch(manifestUrl, { method: "GET" });
        if (res.status === 200) return true;
      }
    } catch (e) { console.log(`[CF-poll] attempt ${i} error:`, e); }
    if (i < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// VideoItem
// ─────────────────────────────────────────────────────────────
type CfState = "checking" | "processing" | "ready" | "error";

interface VideoItemProps {
  item:          Post;
  isActive:      boolean;
  paused:        boolean;
  itemHeight:    number;  // from useWindowDimensions — correct for edge-to-edge
  onPauseToggle: () => void;
  onLike:        (item: Post) => Promise<boolean>;
  onShare:       (item: Post) => Promise<void>;
  onView:        (item: Post) => Promise<void>;
  navigation:    any;
  colors:        any;
}

function VideoItem({
  item, isActive, paused, itemHeight,
  onPauseToggle, onLike, onShare, onView, navigation, colors,
}: VideoItemProps) {
  const insets      = useSafeAreaInsets(); // for edge-to-edge bottom padding
  const scaleAnim   = useRef(new Animated.Value(0)).current;
  const watchStart  = useRef<number | null>(null);
  const isActiveRef = useRef(isActive);
  const isPausedRef = useRef(paused);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { isPausedRef.current = paused;    }, [paused]);

  const [studentInfo,     setStudentInfo]     = useState<any>(null);
  const [liked,           setLiked]           = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [comments,        setComments]        = useState<any[]>([]);
  const [commentText,     setCommentText]     = useState("");
  const [commentCount,    setCommentCount]    = useState(item.comments || 0);
  const [cfState,         setCfState]         = useState<CfState>("checking");
  const [pollAttempt,     setPollAttempt]     = useState(0);
  const [pollMax,         setPollMax]         = useState(20);
  const pollingRef = useRef(false);
  const isOwner    = auth.currentUser?.uid === item.userId;

  const playbackUrl = (() => {
    if (!item.mediaUrl) return null;
    const cfMatch = item.mediaUrl.match(/cloudflarestream\.com\/([a-zA-Z0-9]+)/);
    if (cfMatch?.[1]) return streamPlaybackUrl(cfMatch[1]);
    const vdMatch = item.mediaUrl.match(/videodelivery\.net\/([a-zA-Z0-9]+)/);
    if (vdMatch?.[1]) return streamPlaybackUrl(vdMatch[1]);
    if (/^[a-zA-Z0-9]{32}$/.test(item.mediaUrl.trim())) return streamPlaybackUrl(item.mediaUrl.trim());
    return item.mediaUrl;
  })();

  // CF polling
  useEffect(() => {
    if (!playbackUrl || pollingRef.current) return;
    const poll = async () => {
      pollingRef.current = true;
      setCfState("checking");
      const ready = await waitForManifest(
        playbackUrl,
        (a, m) => { setPollAttempt(a); setPollMax(m); if (a > 1) setCfState("processing"); },
        10_000, 30
      );
      pollingRef.current = false;
      setCfState(ready ? "ready" : "error");
    };
    poll();
  }, [playbackUrl]);

  const retryPoll = () => {
    if (pollingRef.current) return;
    pollingRef.current = false;
    setCfState("checking");
    setPollAttempt(0);
    const poll = async () => {
      pollingRef.current = true;
      const ready = await waitForManifest(
        playbackUrl!,
        (a, m) => { setPollAttempt(a); setPollMax(m); setCfState("processing"); },
        10_000, 30
      );
      pollingRef.current = false;
      setCfState(ready ? "ready" : "error");
    };
    poll();
  };

  const [playerReady, setPlayerReady] = useState(false);
  const player = useVideoPlayer(null, (p) => { p.loop = true; });

  useEffect(() => {
    if (cfState !== "ready" || !playbackUrl || !player) return;
    try { player.replace(playbackUrl); } catch (e) {}
  }, [cfState, playbackUrl]);

  useEffect(() => {
    if (!player) return;
    const sub = player.addListener("statusChange", ({ status }: { status: string }) => {
      if (status === "readyToPlay") {
        setPlayerReady(true);
        if (isActiveRef.current && !isPausedRef.current) { player.play(); onView(item); }
      } else if (status === "error") {
        setPlayerReady(false);
      }
    });
    return () => sub.remove();
  }, [player]);

  // ── FIX 1a: play/pause based on isActive + paused ────────
  useEffect(() => {
    if (!player || !playerReady) return;
    if (isActive && !paused) {
      watchStart.current = Date.now();
      player.play();
      onView(item);
    } else {
      player.pause();  // pause when scrolled away OR screen-level paused
      if (watchStart.current) {
        const watched = Math.floor((Date.now() - watchStart.current) / 1000);
        if (watched > 2) updateDoc(doc(db, "posts", item.id), { watchTime: increment(watched) }).catch(() => {});
        watchStart.current = null;
      }
    }
  }, [isActive, paused, playerReady]);

  // Student info
  useEffect(() => {
    if (!item.userId) return;
    getDoc(doc(db, "students", item.userId)).then((s) => { if (s.exists()) setStudentInfo(s.data()); }).catch(() => {});
  }, [item.userId]);

  // Like state
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, "posts", item.id, "likes", uid)).then((s) => setLiked(s.exists())).catch(() => {});
  }, [item.id]);

  // Comments
  useEffect(() => {
    if (!commentsVisible) return;
    const q     = query(collection(db, "posts", item.id, "comments"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setCommentCount(snap.size);
    });
    return () => unsub();
  }, [commentsVisible, item.id]);

  useEffect(() => { setCommentCount(item.comments || 0); }, [item.comments]);

  const handleLikePress = async () => {
    scaleAnim.setValue(0);
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
    setLiked(await onLike(item));
  };

  const handleAddComment = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !commentText.trim()) return;
    try {
      await addDoc(collection(db, "posts", item.id, "comments"), {
        userId: uid, userName: auth.currentUser?.displayName || "Student",
        text: commentText.trim(), createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "posts", item.id), { comments: increment(1) });
      setCommentText("");
    } catch (e) {}
  };

  const renderProcessingOverlay = () => {
    if (cfState === "ready") return null;
    const isChecking   = cfState === "checking";
    const isProcessing = cfState === "processing";
    const isError      = cfState === "error";
    return (
      <View style={styles.processingOverlay}>
        {isError ? (
          <>
            <Text style={styles.processingIcon}>😕</Text>
            <Text style={styles.processingTitle}>Processing taking longer than usual</Text>
            <Text style={styles.processingSubText}>
              Cloudflare Stream is still encoding this video.{"\n"}Check back in a few minutes.
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={retryPoll}>
              <Text style={styles.retryBtnText}>↺  Check Again</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.processingIcon}>{isChecking ? "🔄" : "⚙️"}</Text>
            <Text style={styles.processingTitle}>
              {isChecking ? "Checking video…" : "Video is processing…"}
            </Text>
            <Text style={styles.processingSubText}>
              {isChecking
                ? "Verifying Cloudflare Stream is ready"
                : `Usually takes 1–3 minutes after upload\nAttempt ${pollAttempt} of ${pollMax}`}
            </Text>
            {isProcessing && (
              <View style={styles.progressDots}>
                {Array.from({ length: Math.min(pollAttempt, 10) }).map((_, i) => (
                  <View key={i} style={[styles.progressDot, {
                    backgroundColor: i < pollAttempt ? "#ff9f43" : "rgba(255,255,255,0.2)",
                  }]} />
                ))}
              </View>
            )}
            <Text style={styles.processingHint}>This video will auto-play when ready</Text>
          </>
        )}
      </View>
    );
  };

  return (
    <>
      <Pressable
        style={{ height: itemHeight, width: SCREEN_WIDTH }}
        onPress={onPauseToggle}
        onLongPress={cfState === "ready" ? handleLikePress : undefined}
      >
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
        />
        {renderProcessingOverlay()}

        {isOwner && item.status !== "approved" && (
          <>
            <StatusWatermark status={item.status} />
            {WATERMARK_CONFIG[item.status as PostStatus] && (
              <View style={[styles.ownStatusBar, { backgroundColor: WATERMARK_CONFIG[item.status as PostStatus]!.bg }]}>
                <Text style={styles.ownStatusIcon}>{WATERMARK_CONFIG[item.status as PostStatus]!.emoji}</Text>
                <View style={styles.ownStatusInfo}>
                  <Text style={styles.ownStatusLabel}>{WATERMARK_CONFIG[item.status as PostStatus]!.label}</Text>
                  <Text style={styles.ownStatusSub}>Only visible to you · Auto-publishes when approved</Text>
                </View>
              </View>
            )}
          </>
        )}

        <Animated.View
          style={[styles.heart, { transform: [{ scale: scaleAnim }], opacity: scaleAnim }]}
          pointerEvents="none"
        >
          <Text style={{ fontSize: 80 }}>❤️</Text>
        </Animated.View>

        <TouchableOpacity
          style={[styles.back, { backgroundColor: `${colors.accent}20`, borderRadius: 8, padding: 8 }]}
          onPress={() => navigation.goBack()}
        >
          <Text style={{ fontSize: 18, color: colors.accent }}>⬅</Text>
        </TouchableOpacity>

        <View style={[styles.caption, { backgroundColor: `${colors.background}80`, bottom: 100 + insets.bottom }]}>
          <Text style={[styles.username, { color: colors.text }]}>
            @{studentInfo?.name || item.name || "student"}
          </Text>
          <Text style={[styles.school, { color: colors.textSecondary }]}>
            {studentInfo?.school || item.school || ""}
          </Text>
          {item.title ? (
            <Text style={[styles.captionText, { color: colors.text }]}>{item.title}</Text>
          ) : null}
        </View>

        <View style={[styles.actionStack, { bottom: 128 + insets.bottom }]}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: `${colors.accent}20` }]}
            onPress={handleLikePress}
          >
            <Text style={{ fontSize: 18, color: liked ? colors.accent : colors.text }}>
              ❤️ {item.likes || 0}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: `${colors.accent}20` }]}
            onPress={() => setCommentsVisible(true)}
          >
            <Text style={{ fontSize: 18, color: colors.text }}>💬 {commentCount}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: `${colors.accent}20` }]}
            onPress={() => onShare(item)}
          >
            <Text style={{ fontSize: 18, color: colors.text }}>📤 {item.shares || 0}</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.views, {
          bottom: 60 + insets.bottom,
          color: colors.accent, backgroundColor: `${colors.background}80`,
          paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
        }]}>
          👁️ {item.views || 0}
        </Text>
      </Pressable>

      {/* Comments modal */}
      <Modal visible={commentsVisible} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Comments</Text>
              <TouchableOpacity onPress={() => setCommentsVisible(false)}>
                <Text style={[styles.modalClose, { color: colors.accent }]}>Close</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={comments}
              keyExtractor={(c) => c.id}
              ListEmptyComponent={
                <Text style={[styles.modalEmpty, { color: colors.textSecondary }]}>
                  No comments yet
                </Text>
              }
              renderItem={({ item: c }) => (
                <View style={[styles.commentCard, { backgroundColor: colors.card }]}>
                  <Text style={[styles.commentAuthor, { color: colors.accent }]}>{c.userName || "Student"}</Text>
                  <Text style={[styles.commentText,   { color: colors.text }]}>{c.text}</Text>
                </View>
              )}
            />
            <Text style={[styles.suggestionTitle, { color: colors.text }]}>Suggested comments</Text>
            {COMMENT_GROUPS.map((group) => (
              <View key={group.title} style={styles.suggestionGroup}>
                <Text style={[styles.suggestionGroupTitle, { color: colors.textSecondary }]}>
                  {group.title}
                </Text>
                <View style={styles.suggestionWrap}>
                  {group.options.map((preset) => (
                    <TouchableOpacity
                      key={preset}
                      style={[styles.suggestionChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() => setCommentText(preset)}
                    >
                      <Text style={[styles.suggestionText, { color: colors.text }]}>{preset}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
            <View style={styles.commentComposer}>
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Pick a suggestion or type..."
                placeholderTextColor={colors.textSecondary}
                style={[styles.commentInput, {
                  backgroundColor: colors.card, color: colors.text, borderColor: colors.border,
                }]}
              />
              <TouchableOpacity
                style={[styles.commentSendBtn, { backgroundColor: colors.accent }]}
                onPress={handleAddComment}
              >
                <Text style={styles.commentSendText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
export default function Reels() {
  const { colors }      = useTheme();
  const navigation      = useNavigation();
  const params          = useLocalSearchParams<{ index?: string; postId?: string; filter?: string }>();
  const insets          = useSafeAreaInsets();
  // useWindowDimensions updates when orientation changes and correctly
  // accounts for edge-to-edge insets on Android (edgeToEdgeEnabled:true)
  const { height: windowHeight } = useWindowDimensions();

  const [approvedReels,   setApprovedReels]   = useState<Post[]>([]);
  const [ownPendingReels, setOwnPendingReels] = useState<Post[]>([]);
  const [reelsCursor,     setReelsCursor]     = useState<string | null>(null);
  const [loadingMore,     setLoadingMore]     = useState(false);
  const [currentIndex,    setCurrentIndex]    = useState(0);
  const [paused,          setPaused]          = useState(false);
  const [ready,           setReady]           = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const viewed      = useRef(new Set<string>());
  const hasScrolled = useRef(false);

  // ── FIX 1b: screen-level pause ref shared to all VideoItems ─
  // We pass `paused` state down — when screen loses focus we set
  // paused=true, which propagates to every VideoItem via props.
  const screenPausedRef = useRef(false);

  // ── FIX 2: hide nav bar on Android when screen is focused ───
  useFocusEffect(
    useCallback(() => {
      // Hide status bar for immersive full-screen experience
      StatusBar.setHidden(true, "fade");

      // Resume playback when screen gains focus
      screenPausedRef.current = false;
      setPaused(false);

      return () => {
        // ── FIX 1b: pause everything when leaving screen ──────
        screenPausedRef.current = true;
        setPaused(true);

        // Restore status bar when leaving
        StatusBar.setHidden(false, "fade");
      };
    }, [])
  );

  // ── FIX 1c: pause when app goes to background ─────────────
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        // Only resume if screen is still focused
        if (!screenPausedRef.current) setPaused(false);
      } else {
        // App backgrounded / inactive — pause immediately
        setPaused(true);
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, []);

  const videos = (() => {
    const seen = new Set<string>();
    return [...ownPendingReels, ...approvedReels].filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });
  })();

  const getReelsFeed = httpsCallable<
    { classLevel?: string; cursor?: string; limit?: number },
    { reels: any[]; cursor: string | null }
  >(functions, "getReelsFeed");

  const isSkillBattleFilter = params.filter === "skillbattle";

  const loadSkillBattleReels = async (excludeId?: string): Promise<Post[]> => {
    const q = query(
      collection(db, "posts"),
      where("isSkillBattle", "==", true),
      where("status",        "==", "approved")
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))
      .filter((p) => p.id !== excludeId)
      .sort((a: any, b: any) => (b.views || 0) - (a.views || 0));
  };

  useEffect(() => {
    const loadReels = async () => {
      if (params.postId) {
        try {
          const snap = await getDoc(doc(db, "posts", params.postId as string));
          if (snap.exists()) {
            setApprovedReels([{ id: snap.id, ...(snap.data() as Omit<Post, "id">) }]);
            setReady(true);
            setCurrentIndex(0);
            hasScrolled.current = true;
          }
        } catch (e) {}

        if (isSkillBattleFilter) {
          try {
            const rest = await loadSkillBattleReels(params.postId as string);
            setApprovedReels((prev) => { const t = prev[0]; return t ? [t, ...rest] : rest; });
          } catch (e) {}
        } else {
          try {
            const { data } = await getReelsFeed({});
            const fp = (data.reels as Post[]).filter((p) => p.id !== params.postId);
            setApprovedReels((prev) => { const t = prev[0]; return t ? [t, ...fp] : fp; });
            setReelsCursor(data.cursor);
          } catch (e) {}
        }
        return;
      }

      if (isSkillBattleFilter) {
        try { const r = await loadSkillBattleReels(); setApprovedReels(r); setReady(true); } catch (e) {}
        return;
      }

      try {
        const { data } = await getReelsFeed({});
        setApprovedReels(data.reels as Post[]);
        setReelsCursor(data.cursor);
      } catch (e) {}
    };
    loadReels();
  }, [params.postId, params.filter]);

  useEffect(() => {
    let unsubQ: (() => void) | null = null;
    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (unsubQ) { unsubQ(); unsubQ = null; }
      if (!user) { setOwnPendingReels([]); return; }
      const q = query(collection(db, "posts"), where("userId", "==", user.uid));
      unsubQ = onSnapshot(q, (snap) => {
        setOwnPendingReels(
          snap.docs
            .filter((d) => {
              const dt = d.data();
              return isSkillBattleFilter
                ? dt.isSkillBattle === true  && dt.status !== "approved"
                : dt.postType     === "reel" && dt.status !== "approved";
            })
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        );
      }, () => setOwnPendingReels([]));
    });
    return () => { unsubAuth(); if (unsubQ) unsubQ(); };
  }, [isSkillBattleFilter]);

  useEffect(() => {
    if (videos.length === 0 || hasScrolled.current) return;
    let target = 0;
    if (params.postId) {
      const found = videos.findIndex((v) => v.id === params.postId);
      target = found >= 0 ? found : 0;
    } else if (params.index) {
      target = Math.min(Math.max(parseInt(params.index, 10) || 0, 0), videos.length - 1);
    }
    hasScrolled.current = true;
    setCurrentIndex(target);
    setReady(true);
    if (target === 0) return;
    const timer = setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index: target, animated: false });
    }, 150);
    return () => clearTimeout(timer);
  }, [videos]);

  const loadMore = async () => {
    if (isSkillBattleFilter || !reelsCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data } = await getReelsFeed({ cursor: reelsCursor, limit: 5 });
      setApprovedReels((prev) => [...prev, ...(data.reels as Post[])]);
      setReelsCursor(data.cursor);
    } catch (e) {}
    finally { setLoadingMore(false); }
  };

  const handleView = async (item: Post) => {
    if (viewed.current.has(item.id)) return;
    viewed.current.add(item.id);
    await updateDoc(doc(db, "posts", item.id), { views: increment(1) });
  };

  const handleLike = async (item: Post): Promise<boolean> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return false;
    const likeRef = doc(db, "posts", item.id, "likes", uid);
    const snap    = await getDoc(likeRef);
    if (snap.exists()) {
      await deleteDoc(likeRef);
      await updateDoc(doc(db, "posts", item.id), { likes: increment(-1) });
      return false;
    }
    await setDoc(likeRef, { liked: true, userId: uid, createdAt: serverTimestamp() });
    await updateDoc(doc(db, "posts", item.id), { likes: increment(1) });
    return true;
  };

  const handleShare = async (item: Post) => {
    try {
      const deepLink = `vidya://post/${item.id}`;
      const result   = await Share.share({
        message: `${item.title || "Vidya Reel"}\n\n${item.description || ""}\n\nOpen in Vidya: ${deepLink}`.trim(),
        url: deepLink,
      });
      if (result.action === Share.sharedAction) {
        await updateDoc(doc(db, "posts", item.id), { shares: increment(1) });
      }
    } catch (e) {}
  };

  const renderItem = ({ item, index }: { item: Post; index: number }) => {
    if (index !== 0 && index % 5 === 0) {
      return (
        <View style={[styles.adContainer, { height: windowHeight, backgroundColor: colors.background }]}>
          <Text style={[styles.adText, { color: colors.accent }]}>🔥 Sponsored Ad</Text>
        </View>
      );
    }
    return (
      <VideoItem
        item={item}
        isActive={ready && index === currentIndex}
        paused={paused}
        itemHeight={windowHeight}
        onPauseToggle={() => setPaused((p) => !p)}
        onLike={handleLike}
        onShare={handleShare}
        onView={handleView}
        navigation={navigation}
        colors={colors}
      />
    );
  };

  const getItemLayout = (_: any, index: number) => ({
    length: windowHeight,
    offset: windowHeight * index,
    index,
  });

  if (videos.length === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No videos available</Text>
        <TouchableOpacity
          style={[styles.uploadBtn, { backgroundColor: colors.accent }]}
          onPress={() => router.push("/skillbattle")}
        >
          <Text style={[styles.uploadBtnText, { color: colors.background }]}>Upload First Video ＋</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    // Edge-to-edge mode: the view takes the full window height.
    // useSafeAreaInsets().bottom is passed into VideoItem so action
    // buttons and captions are offset above the nav bar.
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FlatList
        ref={flatListRef}
        data={videos}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        pagingEnabled
        snapToInterval={windowHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        getItemLayout={getItemLayout}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        onMomentumScrollEnd={(e) => {
          setCurrentIndex(Math.round(e.nativeEvent.contentOffset.y / windowHeight));
        }}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({
              index: Math.min(info.index, videos.length - 1), animated: false,
            });
          }, 300);
        }}
        showsVerticalScrollIndicator={false}
      />
      <TouchableOpacity
        style={[styles.backBtn, { backgroundColor: colors.accent }]}
        onPress={() => router.push("/(drawer)/(tabs)/home")}
      >
        <Text style={[styles.btnText, { color: colors.background }]}>⬅</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.createBtn, { backgroundColor: colors.accent }]}
        onPress={() => router.push("/skillbattle")}
      >
        <Text style={[styles.btnText, { color: colors.background }]}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  back: { position: "absolute", top: 50, left: 20 },

  ownStatusBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  ownStatusIcon:  { fontSize: 22 },
  ownStatusInfo:  { flex: 1 },
  ownStatusLabel: { color: "#fff", fontSize: 13, fontWeight: "800" },
  ownStatusSub:   { color: "rgba(255,255,255,0.78)", fontSize: 11, marginTop: 1 },

  actionStack: { position: "absolute", right: 20, gap: 12 },  // bottom set dynamically via insets
  actionBtn:   { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  views:       { position: "absolute", left: 10, fontSize: 14, fontWeight: "600" },  // bottom set dynamically

  caption: {
    position: "absolute", left: 10,  // bottom set dynamically via insets
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, maxWidth: "75%",
  },
  username:    { fontWeight: "bold", fontSize: 14 },
  school:      { fontSize: 12, marginBottom: 4 },
  captionText: { marginTop: 4, fontSize: 13 },
  heart:       { position: "absolute", top: "40%", left: "40%" },

  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.82)",
    justifyContent:  "center",
    alignItems:      "center",
    gap:             10,
    paddingHorizontal: 32,
  },
  processingIcon:    { fontSize: 48, marginBottom: 4 },
  processingTitle:   { color: "#fff", fontSize: 16, fontWeight: "800", textAlign: "center" },
  processingSubText: { color: "rgba(255,255,255,0.6)", fontSize: 12, textAlign: "center", lineHeight: 18 },
  processingHint:    { color: "rgba(255,159,67,0.8)", fontSize: 11, fontWeight: "600", marginTop: 4 },
  progressDots:      { flexDirection: "row", gap: 5, marginTop: 4 },
  progressDot:       { width: 8, height: 8, borderRadius: 4 },
  retryBtn:          { marginTop: 12, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  retryBtnText:      { color: "#fff", fontSize: 14, fontWeight: "700" },

  adContainer:    { justifyContent: "center", alignItems: "center" },
  adText:         { fontSize: 20, fontWeight: "700" },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText:      { fontSize: 18, marginBottom: 20, fontWeight: "600" },
  uploadBtn:      { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, elevation: 8 },
  uploadBtnText:  { fontWeight: "700", fontSize: 16 },

  backBtn:   { position: "absolute", top: 50, left: 20, width: 50, height: 50, borderRadius: 25, justifyContent: "center", alignItems: "center", zIndex: 10, elevation: 8 },
  createBtn: { position: "absolute", top: 50, right: 20, width: 50, height: 50, borderRadius: 25, justifyContent: "center", alignItems: "center", zIndex: 10, elevation: 8 },
  btnText:   { fontSize: 24, fontWeight: "bold" },

  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  modalCard:     { minHeight: "50%", maxHeight: "80%", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  modalHeader:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  modalTitle:    { fontSize: 18, fontWeight: "700" },
  modalClose:    { fontSize: 14, fontWeight: "700" },
  modalEmpty:    { textAlign: "center", marginTop: 20 },

  suggestionTitle:      { fontSize: 13, fontWeight: "700", marginBottom: 8 },
  suggestionGroup:      { marginBottom: 10 },
  suggestionGroupTitle: { fontSize: 12, fontWeight: "700", marginBottom: 6 },
  suggestionWrap:       { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  suggestionChip:       { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  suggestionText:       { fontSize: 12, fontWeight: "600" },
  commentCard:          { borderRadius: 12, padding: 12, marginBottom: 10 },
  commentAuthor:        { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  commentText:          { fontSize: 14, lineHeight: 20 },
  commentComposer:      { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  commentInput:         { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  commentSendBtn:       { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  commentSendText:      { color: "#fff", fontWeight: "700" },
});
