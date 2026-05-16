import { useTheme } from "@/context/ThemeContext";
import { useNavigation } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEffect, useRef, useState } from "react";

import {
  Animated,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from "firebase/firestore";

// ─── Comment presets ──────────────────────────────────────────
const COMMENT_GROUPS = [
  { title: "Encouragement",    options: ["Very good", "Keep it up", "Well done"] },
  { title: "Skill Praise",     options: ["Excellent work", "Super effort", "Amazing skill"] },
  { title: "Learning Support", options: ["Good try", "Nice learning", "You are improving"] },
];

const { height } = Dimensions.get("window");

type PostStatus = "pending" | "in_review" | "approved" | "rejected";

type Post = {
  id: string;
  mediaUrl: string;
  userId?: string;
  name?: string;
  school?: string;
  profilePic?: string;
  title?: string;
  description?: string;
  likes?: number;
  comments?: number;
  views?: number;
  shares?: number;
  status?: PostStatus;
};

// ─── Status watermark ─────────────────────────────────────────
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

// ─── Main Screen ──────────────────────────────────────────────
export default function Reels() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const params     = useLocalSearchParams<{ index?: string; postId?: string }>();

  const [videos,       setVideos]       = useState<Post[]>([]);
  const [lastDoc,      setLastDoc]      = useState<any>(null);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused,       setPaused]       = useState(false);
  const [ready,        setReady]        = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const viewed      = useRef(new Set<string>());

  // ── Load videos ───────────────────────────────────────────
  useEffect(() => {
    if (params.postId) {
      const load = async () => {
        try {
          const snap = await getDoc(doc(db, "posts", params.postId as string));
          if (snap.exists()) {
            setVideos([{ id: snap.id, ...(snap.data() as Omit<Post, "id">) }]);
          } else {
            setVideos([]);
          }
        } catch (e) {
          console.log("Load reel error:", e);
          setVideos([]);
        }
      };
      load();
      return;
    }

    // Feed — only approved reels
    const q = query(
      collection(db, "posts"),
      where("postType", "==", "reel"),
      where("status",   "==", "approved"),
      orderBy("createdAt", "desc"),
      limit(5)
    );

    const unsub = onSnapshot(q, (snap) => {
      const data: Post[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Post, "id">),
      }));
      setVideos(data);
      setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
    });

    return () => unsub();
  }, [params.postId]);

  // ── Scroll to target index after data loads ───────────────
  useEffect(() => {
    if (videos.length === 0) return;

    let target = 0;

    if (params.postId) {
      const found = videos.findIndex((v) => v.id === params.postId);
      target = found >= 0 ? found : 0;
    } else if (params.index) {
      // Clamp — prevents the "index out of range" crash
      target = Math.min(
        Math.max(parseInt(params.index, 10) || 0, 0),
        videos.length - 1
      );
    }

    setCurrentIndex(target);
    setReady(true);

    if (target === 0) return;

    const timer = setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index: target, animated: false });
    }, 150);

    return () => clearTimeout(timer);
  }, [videos]);

  // ── Load more ─────────────────────────────────────────────
  const loadMore = async () => {
    if (params.postId || !lastDoc || loadingMore) return;
    setLoadingMore(true);
    try {
      const q = query(
        collection(db, "posts"),
        where("postType", "==", "reel"),
        where("status",   "==", "approved"),
        orderBy("createdAt", "desc"),
        startAfter(lastDoc),
        limit(5)
      );
      const snap = await getDocs(q);
      const more: Post[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Post, "id">),
      }));
      setVideos((prev) => [...prev, ...more]);
      setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
    } catch (e) {
      console.log("Load more error:", e);
    } finally {
      setLoadingMore(false);
    }
  };

  // ── Engagement ────────────────────────────────────────────
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
        url:     deepLink,
      });
      if (result.action === Share.sharedAction) {
        await updateDoc(doc(db, "posts", item.id), { shares: increment(1) });
      }
    } catch (e) {
      console.log("Share error:", e);
    }
  };

  // ── Render item ───────────────────────────────────────────
  const renderItem = ({ item, index }: { item: Post; index: number }) => {
    if (index !== 0 && index % 5 === 0) {
      return (
        <View style={[styles.adContainer, { height, backgroundColor: colors.background }]}>
          <Text style={[styles.adText, { color: colors.accent }]}>🔥 Sponsored Ad</Text>
        </View>
      );
    }
    return (
      <VideoItem
        item={item}
        isActive={ready && index === currentIndex}
        paused={paused}
        onPauseToggle={() => setPaused((p) => !p)}
        onLike={handleLike}
        onShare={handleShare}
        onView={handleView}
        navigation={navigation}
        colors={colors}
      />
    );
  };

  // getItemLayout — required for scrollToIndex to work without crash
  const getItemLayout = (_: any, index: number) => ({
    length: height,
    offset: height * index,
    index,
  });

  if (videos.length === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No videos available
        </Text>
        <TouchableOpacity
          style={[styles.uploadBtn, { backgroundColor: colors.accent }]}
          onPress={() => router.push("/skillbattle")}
        >
          <Text style={[styles.uploadBtnText, { color: colors.background }]}>
            Upload First Video ＋
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <FlatList
        ref={flatListRef}
        data={videos}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        // Smooth paging
        pagingEnabled
        snapToInterval={height}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        // Performance — critical for scrollToIndex
        getItemLayout={getItemLayout}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        // Pagination
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        // Track current
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.y / height);
          setCurrentIndex(idx);
        }}
        // Safe fallback — never crashes even if index is wrong
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({
              index:    Math.min(info.index, videos.length - 1),
              animated: false,
            });
          }, 300);
        }}
        showsVerticalScrollIndicator={false}
      />

      {/* Back */}
      <TouchableOpacity
        style={[styles.backBtn, { backgroundColor: colors.accent }]}
        onPress={() => router.push("/(drawer)/(tabs)/home")}
      >
        <Text style={[styles.btnText, { color: colors.background }]}>⬅</Text>
      </TouchableOpacity>

      {/* ＋ → Skill Battle */}
      <TouchableOpacity
        style={[styles.createBtn, { backgroundColor: colors.accent }]}
        onPress={() => router.push("/skillbattle")}
      >
        <Text style={[styles.btnText, { color: colors.background }]}>＋</Text>
      </TouchableOpacity>
    </>
  );
}

// ─── Video Item ───────────────────────────────────────────────
interface VideoItemProps {
  item: Post;
  isActive: boolean;
  paused: boolean;
  onPauseToggle: () => void;
  onLike: (item: Post) => Promise<boolean>;
  onShare: (item: Post) => Promise<void>;
  onView: (item: Post) => Promise<void>;
  navigation: any;
  colors: any;
}

function VideoItem({ item, isActive, paused, onPauseToggle, onLike, onShare, onView, navigation, colors }: VideoItemProps) {
  const scaleAnim  = useRef(new Animated.Value(0)).current;
  const watchStart = useRef<number | null>(null);

  const [studentInfo,     setStudentInfo]     = useState<any>(null);
  const [liked,           setLiked]           = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [comments,        setComments]        = useState<any[]>([]);
  const [commentText,     setCommentText]     = useState("");
  const [commentCount,    setCommentCount]    = useState(item.comments || 0);

  const isOwner = auth.currentUser?.uid === item.userId;

  const player = useVideoPlayer(
    item.mediaUrl?.trim() ? item.mediaUrl : null,
    (p) => { p.loop = true; }
  );

  // Play/pause based on active state
  useEffect(() => {
    if (!player) return;
    if (isActive && !paused) {
      watchStart.current = Date.now();
      player.play();
      onView(item);
    } else {
      player.pause();
      if (watchStart.current) {
        const watched = Math.floor((Date.now() - watchStart.current) / 1000);
        if (watched > 2) {
          updateDoc(doc(db, "posts", item.id), { watchTime: increment(watched) }).catch(() => {});
        }
        watchStart.current = null;
      }
    }
  }, [isActive, paused]);

  useEffect(() => {
    if (!item.userId) return;
    getDoc(doc(db, "students", item.userId))
      .then((s) => { if (s.exists()) setStudentInfo(s.data()); })
      .catch(() => {});
  }, [item.userId]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, "posts", item.id, "likes", uid))
      .then((s) => setLiked(s.exists()))
      .catch(() => {});
  }, [item.id]);

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
    } catch (e) { console.log("Comment error:", e); }
  };

  return (
    <>
      <Pressable style={{ height }} onPress={onPauseToggle} onLongPress={handleLikePress}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" />

        {/* Watermark — only shown to post owner when not approved */}
        {isOwner && item.status !== "approved" && (
          <StatusWatermark status={item.status} />
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

        <View style={[styles.caption, { backgroundColor: `${colors.background}80` }]}>
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

        <View style={styles.actionStack}>
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
          color: colors.accent,
          backgroundColor: `${colors.background}80`,
          paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
        }]}>
          👁️ {item.views || 0}
        </Text>
      </Pressable>

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
                <Text style={[styles.modalEmpty, { color: colors.textSecondary }]}>No comments yet</Text>
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
                <Text style={[styles.suggestionGroupTitle, { color: colors.textSecondary }]}>{group.title}</Text>
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
                  backgroundColor: colors.card,
                  color: colors.text,
                  borderColor: colors.border,
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

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  back: { position: "absolute", top: 50, left: 20 },

  actionStack: { position: "absolute", right: 20, bottom: 128, gap: 12 },
  actionBtn:   { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },

  views: { position: "absolute", left: 10, bottom: 60, fontSize: 14, fontWeight: "600" },

  caption: {
    position: "absolute", bottom: 100, left: 10,
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 8, maxWidth: "75%",
  },
  username:    { fontWeight: "bold", fontSize: 14 },
  school:      { fontSize: 12, marginBottom: 4 },
  captionText: { marginTop: 4, fontSize: 13 },

  heart: { position: "absolute", top: "40%", left: "40%" },

  backBtn: {
    position: "absolute", top: 50, left: 20,
    width: 50, height: 50, borderRadius: 25,
    justifyContent: "center", alignItems: "center",
    zIndex: 10, elevation: 8,
  },
  createBtn: {
    position: "absolute", top: 50, right: 20,
    width: 50, height: 50, borderRadius: 25,
    justifyContent: "center", alignItems: "center",
    zIndex: 10, elevation: 8,
  },
  btnText: { fontSize: 24, fontWeight: "bold" },

  adContainer: { justifyContent: "center", alignItems: "center" },
  adText:      { fontSize: 20, fontWeight: "700" },

  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText:      { fontSize: 18, marginBottom: 20, fontWeight: "600" },
  uploadBtn:      { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, elevation: 8 },
  uploadBtnText:  { fontWeight: "700", fontSize: 16 },

  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  modalCard: {
    minHeight: "50%", maxHeight: "80%",
    borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16,
  },
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

  commentCard:   { borderRadius: 12, padding: 12, marginBottom: 10 },
  commentAuthor: { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  commentText:   { fontSize: 14, lineHeight: 20 },

  commentComposer: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  commentInput:    { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  commentSendBtn:  { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  commentSendText: { color: "#fff", fontWeight: "700" },
});