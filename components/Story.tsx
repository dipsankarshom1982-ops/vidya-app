/**
 * Story.tsx
 * ─────────────────────────────────────────────────────────
 * Educational / Testimonial Stories Module
 * • expo-video (no expo-av, no type errors)
 * • Thumbnail shown first; video plays only on user tap ▶
 * • Video limited to 10 s via videoMaxDuration
 * • Optimised for low-end Android
 *
 * Install:
 *   npx expo install expo-video expo-video-thumbnails
 * ─────────────────────────────────────────────────────────
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useTheme } from "@/context/ThemeContext";

import * as ImagePicker from "expo-image-picker";
import { useVideoPlayer, VideoView } from "expo-video";
import * as VideoThumbnails from "expo-video-thumbnails";

import { getAuth } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from "firebase/storage";

// ─── Constants ────────────────────────────────────────────
const AVATAR_SIZE    = 64;
const IMAGE_DURATION = 5000;
const MAX_VIDEO_SEC  = 10;
const { width: SW }  = Dimensions.get("window");

const db      = getFirestore();
const storage = getStorage();
const auth    = getAuth();

// ─── Types ────────────────────────────────────────────────
interface StoryDoc {
  id: string;
  userId: string;
  userName: string;
  userClass?: number | null;
  mediaUrl: string;
  thumbnailUrl: string;
  type: "image" | "video";
  category: "achievement" | "testimonial";
  title: string;
  description: string;
  relatedFeature?: string;
  likes: number;
  views: number;
  status: "pending" | "approved" | "rejected";
  isFeatured?: boolean;
  createdAt: any;
  expiresAt: any;
}

interface GroupedUser {
  userId: string;
  userName: string;
  stories: StoryDoc[];
}

// ─── Helpers ─────────────────────────────────────────────
interface UserProfile { name: string; userClass: number | null; }

async function fetchUserProfile(uid: string): Promise<UserProfile> {
  for (const col of ["students", "users", "user_story_activit"]) {
    try {
      const snap = await getDoc(doc(db, col, uid));
      if (snap.exists()) {
        const d = snap.data() as any;

        // ── Name ───────────────────────────────────────────
        const firstName     = d.firstName    || d.first_name  || "";
        const lastName      = d.lastName     || d.last_name   || "";
        const fullFromParts = firstName
          ? (firstName + (lastName ? " " + lastName : "")).trim()
          : "";
        const name =
          d.name         ||
          d.fullName     || d.full_name    ||
          d.displayName  || d.display_name ||
          d.studentName  || d.student_name ||
          d.userName     || d.user_name    ||
          fullFromParts  || "";

        // ── Class ──────────────────────────────────────────
        // Try every field name your Firestore schema might use
        const rawClass =
          d.class        ??
          d.className    ??
          d.classNo      ??
          d.class_no     ??
          d.grade        ??
          d.standard     ??
          d.std          ??
          d.userClass    ??
          d.studentClass ??
          null;
        const userClass = rawClass !== null ? Number(rawClass) : null;

        if (name && name !== "Student") {
          return { name, userClass };
        }
      }
    } catch (_) {}
  }
  return {
    name: auth.currentUser?.displayName || "",
    userClass: null,
  };
}

// ═══════════════════════════════════════════════════════════
// VIDEO PLAYER
// Fix summary:
//   • useVideoPlayer source → { uri } object (not bare string)
//   • player.addListener("playingChange") syncs React state
//     to the NATIVE layer — no more stale state bug
//   • key={story.id} on mount ensures a fresh player per story
//   • zIndex: thumbnail(0) → VideoView(2) → touch(3) → UI(5+)
// ═══════════════════════════════════════════════════════════
// StoryVideoPlayer removed — player lives in main component to obey Rules of Hooks

// ═══════════════════════════════════════════════════════════
// PROGRESS BAR
// ═══════════════════════════════════════════════════════════
const ProgressBar = React.memo(({
  total, current, progress,
}: { total: number; current: number; progress: Animated.Value }) => (
  <View style={pb.row}>
    {Array.from({ length: total }).map((_, i) => (
      <View key={i} style={pb.track}>
        <Animated.View
          style={[pb.fill, {
            width: i < current ? "100%"
              : i === current
              ? progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] })
              : "0%",
          }]}
        />
      </View>
    ))}
  </View>
));

const pb = StyleSheet.create({
  row:   { flexDirection: "row", paddingHorizontal: 10, gap: 3 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.35)", overflow: "hidden" },
  fill:  { height: "100%", backgroundColor: "#fff", borderRadius: 2 },
});

// ═══════════════════════════════════════════════════════════
// STORY AVATAR
// ═══════════════════════════════════════════════════════════
const StoryAvatar = React.memo(({ item, onPress }: { item: GroupedUser; onPress: () => void }) => {
  const first   = item.stories[0];
  const thumb   = first?.thumbnailUrl || first?.mediaUrl;
  const isVideo = first?.type === "video";
  const initial = item.userName?.[0]?.toUpperCase() ?? "?";

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={av.wrap}>
      <View style={av.ring}>
        {thumb
          ? <Image source={{ uri: thumb }} style={av.img} resizeMode="cover" fadeDuration={0} />
          : <View style={av.fallback}><Text style={av.initial}>{initial}</Text></View>
        }
        {isVideo && (
          <View style={av.vidBadge}><Text style={av.vidTxt}>▶</Text></View>
        )}
      </View>
      <Text style={av.name} numberOfLines={1}>{item.userName}</Text>
    </TouchableOpacity>
  );
});

const av = StyleSheet.create({
  wrap:     { alignItems: "center", marginHorizontal: 6, width: AVATAR_SIZE + 8 },
  ring:     { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, borderWidth: 2.5, borderColor: "#6C63FF", overflow: "hidden" },
  img:      { width: "100%", height: "100%" },
  fallback: { width: "100%", height: "100%", backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  initial:  { fontSize: 22, fontWeight: "700", color: "#6C63FF" },
  name:     { fontSize: 11, color: "#374151", marginTop: 5, textAlign: "center", maxWidth: AVATAR_SIZE + 8 },
  vidBadge: { position: "absolute", bottom: 2, right: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#fff" },
  vidTxt:   { color: "#fff", fontSize: 7, marginLeft: 1 },
});

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
export default function Story() {
  const { colors } = useTheme();
  const [groupedStories, setGroupedStories] = useState<GroupedUser[]>([]);
  const [viewerVisible,  setViewerVisible]  = useState(false);
  const [currentUser,    setCurrentUser]    = useState(0);
  const [currentStory,   setCurrentStory]   = useState(0);
  const [liked,          setLiked]          = useState(false);
  const [videoPlaying,   setVideoPlaying]   = useState(false);

  // Video player — always at top level, never inside conditional/child
  const player = useVideoPlayer({ uri: "" }, (p) => {
    p.loop  = false;
    p.muted = false;
  });

  useEffect(() => {
    const sub = player.addListener("playingChange", (e) => {
      setVideoPlaying(e.isPlaying);
    });
    return () => sub.remove();
  }, [player]);

  const [uploading,   setUploading]   = useState(false);
  const [uploadPct,   setUploadPct]   = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"uploading" | "saving" | "done">("uploading");
  const uploadAnim = useRef(new Animated.Value(0)).current;

  const progress    = useRef(new Animated.Value(0)).current;
  const progressRef = useRef<Animated.CompositeAnimation | null>(null);

  const user  = auth.currentUser;
  const group = groupedStories[currentUser];
  const story = group?.stories[currentStory];

  // ── Fetch ──────────────────────────────────────────────
  const fetchStories = useCallback(async () => {
    try {
      const q    = query(collection(db, "stories"), where("status", "==", "approved"));
      const snap = await getDocs(q);
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as StoryDoc[];

      // Always resolve real name + class from DB
      // (old uploads saved "Student" and hardcoded class 8)
      const profileCache: Record<string, UserProfile> = {};
      for (const s of docs) {
        if (!profileCache[s.userId]) {
          profileCache[s.userId] = await fetchUserProfile(s.userId);
        }
        const { name, userClass } = profileCache[s.userId];
        if (name && name !== "Student") s.userName = name;
        if (userClass !== null) s.userClass = userClass;
      }

      const map: Record<string, GroupedUser> = {};
      docs.forEach((s) => {
        if (!map[s.userId]) map[s.userId] = { userId: s.userId, userName: s.userName, stories: [] };
        map[s.userId].stories.push(s);
      });
      setGroupedStories(Object.values(map));
    } catch (e) { console.error("fetchStories:", e); }
  }, []);

  useEffect(() => { fetchStories(); }, [fetchStories]);

  // ── Progress (images only) ─────────────────────────────
  const goNext = useCallback(() => {
    progressRef.current?.stop();
    const count = groupedStories[currentUser]?.stories.length ?? 0;
    if (currentStory < count - 1) {
      setCurrentStory((p) => p + 1);
    } else if (currentUser < groupedStories.length - 1) {
      setCurrentUser((p) => p + 1);
      setCurrentStory(0);
    } else {
      setViewerVisible(false);
    }
  }, [currentStory, currentUser, groupedStories]);

  const startProgress = useCallback((isVideo: boolean) => {
    progressRef.current?.stop();
    progress.setValue(0);
    if (isVideo) return;
    progressRef.current = Animated.timing(progress, {
      toValue: 1, duration: IMAGE_DURATION, useNativeDriver: false,
    });
    progressRef.current.start(({ finished }) => { if (finished) goNext(); });
  }, [goNext, progress]);

  // Stable ref to latest story — avoids stale closure in effect without
  // making story a dependency (which would re-fire on every like/view update)
  const storyRef = useRef<StoryDoc | undefined>(undefined);
  storyRef.current = story;

  useEffect(() => {
    if (!viewerVisible) return;
    const s = storyRef.current;
    if (!s) return;

    setLiked(false);
    setVideoPlaying(false);

    if (s.type === "video" && s.mediaUrl) {
      player.pause();
      player.replaceAsync({ uri: s.mediaUrl }).catch(() => {});
      // User must tap ▶ to play
    } else {
      player.pause();
    }

    startProgress(s.type === "video");
  // Only re-run when the actual story identity changes, NOT when metadata updates
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerVisible, currentUser, currentStory]);

  // ── Navigation ─────────────────────────────────────────
  const goPrev = useCallback(() => {
    progressRef.current?.stop();
    if (currentStory > 0) { setCurrentStory((p) => p - 1); }
    else if (currentUser > 0) { setCurrentUser((p) => p - 1); setCurrentStory(0); }
  }, [currentStory, currentUser]);

  const openViewer = useCallback(async (idx: number) => {
    setCurrentUser(idx); setCurrentStory(0); setViewerVisible(true);
    const s = groupedStories[idx]?.stories[0];
    if (s) { try { await updateDoc(doc(db, "stories", s.id), { views: increment(1) }); } catch (_) {} }
  }, [groupedStories]);

  const closeViewer = useCallback(() => {
    progressRef.current?.stop();
    player.pause();
    setViewerVisible(false);
  }, [player]);

  // Video play/pause — called from unified touch layer when story is video type
  const handleVideoPress = useCallback(() => {
    if (videoPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }, [player, videoPlaying]);

  const handleLike = useCallback(async () => {
    if (!story || liked) return;
    setLiked(true);
    try { await updateDoc(doc(db, "stories", story.id), { likes: increment(1) }); } catch (_) {}
  }, [story, liked]);

  // ── Upload ─────────────────────────────────────────────
  const uploadStory = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      videoMaxDuration: MAX_VIDEO_SEC,
      quality: 0.7,
    });
    if (result.canceled) return;

    const asset   = result.assets[0];
    const isVideo = asset.type === "video";

    setUploadPct(0); setUploadPhase("uploading"); setUploading(true); uploadAnim.setValue(0);

    let thumbnailUrl = "";
    if (isVideo) {
      try {
        const { uri: tUri } = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 500 });
        const tBlob = await (await fetch(tUri)).blob();
        const tRef  = ref(storage, `stories/${user?.uid}/${Date.now()}_thumb.jpg`);
        await new Promise<void>((res, rej) => {
          const t = uploadBytesResumable(tRef, tBlob);
          t.on("state_changed", null, rej, res);
        });
        thumbnailUrl = await getDownloadURL(tRef);
      } catch (_) {}
    }

    const storyId  = Date.now().toString();
    const mediaRef = ref(storage, `stories/${user?.uid}/${storyId}`);
    const blob     = await (await fetch(asset.uri)).blob();

    const mediaUrl = await new Promise<string>((resolve, reject) => {
      const task = uploadBytesResumable(mediaRef, blob);
      task.on(
        "state_changed",
        (snap) => {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          setUploadPct(pct);
          Animated.timing(uploadAnim, { toValue: pct / 100, duration: 250, useNativeDriver: false }).start();
        },
        (err) => { setUploading(false); reject(err); },
        async () => resolve(await getDownloadURL(task.snapshot.ref))
      );
    });

    setUploadPhase("saving");
    Animated.timing(uploadAnim, { toValue: 1, duration: 400, useNativeDriver: false }).start();

    const { name: realName, userClass: realClass } = await fetchUserProfile(user?.uid ?? "");
    await setDoc(doc(db, "stories", storyId), {
      userId: user?.uid, userName: realName, userClass: realClass ?? null,
      mediaUrl, thumbnailUrl: thumbnailUrl || mediaUrl,
      type: isVideo ? "video" : "image", category: "achievement",
      title: "", description: "", relatedFeature: "SkillBattle",
      likes: 0, views: 0, status: "pending", isFeatured: false,
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    setUploadPhase("done");
    setTimeout(() => { setUploading(false); fetchStories(); }, 1200);
  }, [user, fetchStories, uploadAnim]);

  // ── Render ─────────────────────────────────────────────
  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={groupedStories}
        keyExtractor={(item) => item.userId}
        removeClippedSubviews
        maxToRenderPerBatch={6}
        windowSize={5}
        initialNumToRender={5}
        getItemLayout={(_, i) => ({ length: AVATAR_SIZE + 20, offset: (AVATAR_SIZE + 20) * i, index: i })}
        renderItem={({ item, index }) => (
          <StoryAvatar item={item} onPress={() => openViewer(index)} />
        )}
        ListHeaderComponent={
          <TouchableOpacity onPress={uploadStory} activeOpacity={0.85} style={s.addWrap}>
            <View style={[s.addCircle, { backgroundColor: colors.card }]}><Text style={s.addPlus}>+</Text></View>
            <Text style={[s.addLabel, { color: colors.textSecondary }]}>Your Story</Text>
          </TouchableOpacity>
        }
      />

      {/* VIEWER */}
      <Modal visible={viewerVisible} animationType="slide" statusBarTranslucent onRequestClose={closeViewer}>
        <View style={s.viewer}>

          {/* Thumbnail — always at base (zIndex 0), covers screen before video loads */}
          <Image
            source={{ uri: story?.thumbnailUrl || story?.mediaUrl }}
            style={s.media}
            resizeMode="cover"
            fadeDuration={0}
          />

          {/* VideoView — rendered above thumbnail, no touch handling of its own */}
          {story?.type === "video" && (
            <VideoView
              player={player}
              style={s.videoLayer}
              contentFit="cover"
              nativeControls={false}
              allowsPictureInPicture={false}
              pointerEvents="none"
            />
          )}

          {/* Scrims — pointer-events none so they never eat touches */}
          <View style={s.scrimTop}    pointerEvents="none" />
          <View style={s.scrimBottom} pointerEvents="none" />

          {/*
            SINGLE UNIFIED TOUCH LAYER
            Covers the whole screen and decides what to do based on tap position.
            Left 35% → prev story
            Right 65% → for VIDEO: play/pause toggle; for IMAGE: next story
            This eliminates all zIndex fighting between play button and tap zones.
          */}
          <View
            style={s.touchLayer}
            onStartShouldSetResponder={() => true}
            onResponderRelease={(e) => {
              const tapX = e.nativeEvent.locationX;
              const isLeft = tapX < SW * 0.35;
              if (isLeft) {
                goPrev();
              } else if (story?.type === "video") {
                handleVideoPress();
              } else {
                goNext();
              }
            }}
          >
            {/* Play / pause icon — purely visual, no touch handling */}
            {story?.type === "video" && (
              <View style={s.playBtnWrap} pointerEvents="none">
                {!videoPlaying && (
                  <View style={s.playBtn}>
                    <Text style={s.playIcon}>▶</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Progress bar */}
          <View style={s.progressWrap} pointerEvents="none">
            <ProgressBar total={group?.stories.length ?? 1} current={currentStory} progress={progress} />
          </View>

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={s.headerAvtWrap}>
                {story?.thumbnailUrl
                  ? <Image source={{ uri: story.thumbnailUrl }} style={s.headerAvt} resizeMode="cover" fadeDuration={0} />
                  : <View style={s.headerAvtFallback}><Text style={s.headerAvtInitial}>{story?.userName?.[0]?.toUpperCase() ?? "?"}</Text></View>
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.studentName} numberOfLines={1}>{story?.userName ?? ""}</Text>
                {!!story?.userClass && <Text style={s.studentSub}>Class {story.userClass}</Text>}
              </View>
            </View>
            <TouchableOpacity onPress={closeViewer} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={s.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Badges */}
          <View style={s.badgeRow} pointerEvents="none">
            {!!story?.category && (
              <View style={[s.badge, story.category === "achievement" ? s.badgeAch : s.badgeTes]}>
                <Text style={s.badgeTxt}>{story.category === "achievement" ? "🏆 Achievement" : "💬 Testimonial"}</Text>
              </View>
            )}
            {story?.isFeatured && (
              <View style={[s.badge, s.badgeFeat]}><Text style={[s.badgeTxt, { color: "#fff" }]}>★ Featured</Text></View>
            )}
          </View>

          {/* Title + Description */}
          <View style={s.info} pointerEvents="none">
            {!!story?.title       && <Text style={s.title} numberOfLines={2}>{story.title}</Text>}
            {!!story?.description && <Text style={s.desc}  numberOfLines={3}>{story.description}</Text>}
          </View>

          {/* Like + Views — these need touches so no pointerEvents="none" */}
          <View style={s.actions}>
            <TouchableOpacity onPress={handleLike} style={s.actionBtn} activeOpacity={0.8}>
              <Text style={s.actionIcon}>{liked ? "❤️" : "🤍"}</Text>
              <Text style={s.actionCount}>{(story?.likes ?? 0) + (liked ? 1 : 0)}</Text>
            </TouchableOpacity>
            <View style={s.actionBtn}>
              <Text style={s.actionIcon}>👁</Text>
              <Text style={s.actionCount}>{story?.views ?? 0}</Text>
            </View>
          </View>

        </View>
      </Modal>

      {/* UPLOAD OVERLAY */}
      <Modal visible={uploading} transparent animationType="fade">
        <View style={s.upOverlay}>
          <View style={s.upCard}>
            <View style={s.upIconCircle}>
              <Text style={{ fontSize: 30 }}>
                {uploadPhase === "done" ? "✅" : uploadPhase === "saving" ? "💾" : "☁️"}
              </Text>
            </View>
            <Text style={s.upTitle}>
              {uploadPhase === "uploading" ? "Uploading story…" : uploadPhase === "saving" ? "Saving…" : "Submitted! 🎉"}
            </Text>
            <Text style={s.upSub}>
              {uploadPhase === "uploading" ? "Please keep the app open" : uploadPhase === "saving" ? "Almost done…" : "Waiting for admin approval"}
            </Text>
            <View style={s.upTrack}>
              <Animated.View
                style={[
                  s.upFill,
                  uploadPhase === "done" && { backgroundColor: "#22C55E" },
                  { width: uploadAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
                ]}
              />
            </View>
            <Text style={s.upPct}>
              {uploadPhase === "done" ? "100%" : uploadPhase === "saving" ? "Saving…" : `${uploadPct}%`}
            </Text>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ═══════════════════════════════════════════════════════════
const s = StyleSheet.create({
  container: { paddingVertical: 10 },

  addWrap:   { alignItems: "center", marginHorizontal: 6, width: AVATAR_SIZE + 8 },
  addCircle: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, borderWidth: 2, borderColor: "#6C63FF", borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  addPlus:   { fontSize: 26, color: "#6C63FF", fontWeight: "300" },
  addLabel:  { fontSize: 11, marginTop: 5, textAlign: "center" },

  viewer: { flex: 1, backgroundColor: "#000" },

  media:      { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 },
  videoLayer:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },
  // Single touch layer — covers full screen, handles ALL taps (prev / play-pause / next)
  touchLayer:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 },
  // Play button is purely visual inside touchLayer — no touch of its own
  playBtnWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  playBtn:     { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(0,0,0,0.58)", alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: "rgba(255,255,255,0.85)" },
  playIcon:    { color: "#fff", fontSize: 30, marginLeft: 6 },

  scrimTop:    { position: "absolute", top: 0, left: 0, right: 0, height: 180, backgroundColor: "rgba(0,0,0,0.38)", zIndex: 4 },
  scrimBottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: 240, backgroundColor: "rgba(0,0,0,0.45)", zIndex: 4 },

  progressWrap: { position: "absolute", top: Platform.OS === "ios" ? 54 : 36, left: 0, right: 0, zIndex: 10 },

  header:            { position: "absolute", top: Platform.OS === "ios" ? 66 : 48, left: 14, right: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 10 },
  headerLeft:        { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  headerAvtWrap:     { width: 40, height: 40, borderRadius: 20, overflow: "hidden", borderWidth: 2, borderColor: "#fff" },
  headerAvt:         { width: "100%", height: "100%" },
  headerAvtFallback: { width: "100%", height: "100%", backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  headerAvtInitial:  { color: "#fff", fontWeight: "700", fontSize: 16 },
  studentName:       { color: "#fff", fontWeight: "700", fontSize: 14, textShadowColor: "rgba(0,0,0,0.7)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  studentSub:        { color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 1 },
  closeBtn:          { padding: 4 },
  closeTxt:          { color: "#fff", fontSize: 20, fontWeight: "700" },

  badgeRow: { position: "absolute", top: Platform.OS === "ios" ? 118 : 100, left: 14, flexDirection: "row", gap: 6, zIndex: 10 },
  badge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeAch: { backgroundColor: "#FEF3C7" },
  badgeTes: { backgroundColor: "#EDE9FE" },
  badgeFeat:{ backgroundColor: "#EC4899" },
  badgeTxt: { fontSize: 11, fontWeight: "600", color: "#374151" },

  info:  { position: "absolute", bottom: 110, left: 16, right: 80, zIndex: 10 },
  title: { color: "#fff", fontSize: 17, fontWeight: "700", marginBottom: 6, textShadowColor: "rgba(0,0,0,0.7)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  desc:  { color: "rgba(255,255,255,0.88)", fontSize: 13, lineHeight: 18 },

  actions:     { position: "absolute", bottom: 100, right: 14, alignItems: "center", gap: 16, zIndex: 10 },
  actionBtn:   { alignItems: "center" },
  actionIcon:  { fontSize: 26 },
  actionCount: { color: "#fff", fontSize: 12, fontWeight: "600", marginTop: 2 },

  // tapLeft / tapRight removed — unified touchLayer handles all navigation

  upOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },
  upCard:       { backgroundColor: "#fff", borderRadius: 20, paddingVertical: 32, paddingHorizontal: 28, width: "100%", alignItems: "center", elevation: 10 },
  upIconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#F3F0FF", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  upTitle:      { fontSize: 17, fontWeight: "700", color: "#111827", marginBottom: 6, textAlign: "center" },
  upSub:        { fontSize: 13, color: "#6B7280", marginBottom: 24, textAlign: "center" },
  upTrack:      { width: "100%", height: 8, borderRadius: 4, backgroundColor: "#E9E7FF", overflow: "hidden", marginBottom: 10 },
  upFill:       { height: "100%", borderRadius: 4, backgroundColor: "#6C63FF" },
  upPct:        { fontSize: 13, fontWeight: "600", color: "#6C63FF" },
});