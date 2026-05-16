import { useTheme } from "@/context/ThemeContext";
import { auth, db, storage } from "@/lib/firebase";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import * as VideoThumbnails from "expo-video-thumbnails";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
  UploadTaskSnapshot,
} from "firebase/storage";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Types ───────────────────────────────────────────────────
type PostStatus = "pending" | "in_review" | "approved" | "rejected";

interface StudentData {
  name: string;
  class: string;
  school: string;
  profilePic: string;
  location: {
    city: string;
    district: string;
    state: string;
    pincode: string;
  };
}

interface MyPost {
  id: string;
  mediaUrl: string;
  thumbnail: string;
  status: PostStatus;
  createdAt: any;
  rejectionReason?: string;
}

// ─── Status watermark config ──────────────────────────────────
// Only pending/in_review/rejected show a watermark; approved = clean
const WATERMARK_CONFIG: Partial<
  Record<PostStatus, { label: string; emoji: string; color: string; bg: string }>
> = {
  pending: {
    label: "PENDING REVIEW",
    emoji: "⏳",
    color: "#fff",
    bg:    "rgba(243,156,18,0.82)",
  },
  in_review: {
    label: "IN REVIEW",
    emoji: "🔍",
    color: "#fff",
    bg:    "rgba(52,152,219,0.82)",
  },
  rejected: {
    label: "REJECTED",
    emoji: "❌",
    color: "#fff",
    bg:    "rgba(231,76,60,0.82)",
  },
};

// ─── Status badge config (for the tracker list) ───────────────
const STATUS_CONFIG: Record<
  PostStatus,
  { label: string; emoji: string; color: string; bg: string; description: string }
> = {
  pending: {
    label:       "Pending Review",
    emoji:       "⏳",
    color:       "#f39c12",
    bg:          "#f39c1218",
    description: "Waiting to be reviewed by our team.",
  },
  in_review: {
    label:       "In Review",
    emoji:       "🔍",
    color:       "#3498db",
    bg:          "#3498db18",
    description: "Our team is currently reviewing your reel.",
  },
  approved: {
    label:       "Approved ✓ Live",
    emoji:       "✅",
    color:       "#2ecc71",
    bg:          "#2ecc7118",
    description: "Your reel is live in the battle feed!",
  },
  rejected: {
    label:       "Rejected",
    emoji:       "❌",
    color:       "#e74c3c",
    bg:          "#e74c3c18",
    description: "Your reel did not meet the guidelines.",
  },
};

// ─── Eligible classes ─────────────────────────────────────────
const ELIGIBLE_CLASSES = ["5", "6", "7", "8", "9", "10", "11", "12"];

// ─── Post limit (rejected don't count) ───────────────────────
const checkPostLimit = async (
  battleId: string,
  uid: string
): Promise<boolean> => {
  const q = query(
    collection(db, "posts"),
    where("battleId", "==", battleId),
    where("userId",   "==", uid),
    where("status",   "not-in", ["rejected"])
  );
  const snap = await getDocs(q);
  if (snap.size >= 4) {
    Alert.alert("Limit Reached", "You can upload maximum 4 reels per battle.");
    return false;
  }
  return true;
};

// ─── Status Watermark Overlay ─────────────────────────────────
// Drop this component onto any thumbnail/video card in your feed
export function PostStatusWatermark({ status }: { status: PostStatus }) {
  const cfg = WATERMARK_CONFIG[status];
  if (!cfg) return null; // approved — render nothing

  return (
    <View style={wmStyles.wrapper} pointerEvents="none">
      {/* Dark overlay so video is visually dimmed */}
      <View style={wmStyles.dim} />
      {/* Diagonal banner */}
      <View style={[wmStyles.banner, { backgroundColor: cfg.bg }]}>
        <Text style={wmStyles.bannerText}>
          {cfg.emoji}  {cfg.label}
        </Text>
      </View>
    </View>
  );
}

const wmStyles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    borderRadius: 14,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  banner: {
    position:        "absolute",
    top:             18,
    left:            -38,
    width:           180,
    paddingVertical: 5,
    alignItems:      "center",
    transform:       [{ rotate: "-35deg" }],
  },
  bannerText: {
    color:      "#fff",
    fontSize:   10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
});

// ─── Component ────────────────────────────────────────────────
export default function CreateReelScreen() {
  const { colors } = useTheme();
  const router     = useRouter();
  const params     = useLocalSearchParams<{
    battleId:    string;
    battleTitle: string;
    battleType:  string;
    month:       string;
  }>();

  const isSp   = params.battleType === "sponsored";
  const accent = isSp ? "#ff9f43" : colors.accent;

  // ── State ──────────────────────────────────────────────────
  const [student,        setStudent]        = useState<StudentData | null>(null);
  const [videoAsset,     setVideoAsset]     = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [thumbnail,      setThumbnail]      = useState<string | null>(null);
  const [loading,        setLoading]        = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [notEligible,    setNotEligible]    = useState<boolean>(false);
  const [myPosts,        setMyPosts]        = useState<MyPost[]>([]);
  const [showMyPosts,    setShowMyPosts]    = useState<boolean>(true);

  const progressAnim = useRef(new Animated.Value(0)).current;

  const player = useVideoPlayer(videoAsset?.uri ?? null, (p) => {
    p.loop = true;
    p.play();
  });

  // ── Fetch student profile ──────────────────────────────────
  useEffect(() => {
    const loadStudent = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const snap = await getDoc(doc(db, "students", uid));
      if (!snap.exists()) return;
      const d   = snap.data();
      const cls = d.class !== undefined ? String(d.class) : "";
      setStudent({
        name:       d.name       ?? "",
        class:      cls,
        school:     d.school     ?? "",
        profilePic: d.profilePic ?? "",
        location: {
          city:     d.location?.city     ?? "",
          district: d.location?.district ?? "",
          state:    d.location?.state    ?? "",
          pincode:  d.location?.pincode  ?? "",
        },
      });
      if (!ELIGIBLE_CLASSES.includes(cls)) setNotEligible(true);
    };
    loadStudent();
  }, []);

  // ── Real-time listener: my posts in this battle ────────────
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !params.battleId) return;

    const q = query(
      collection(db, "posts"),
      where("battleId", "==", params.battleId),
      where("userId",   "==", uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      const posts: MyPost[] = snap.docs.map((d) => ({
        id:              d.id,
        mediaUrl:        d.data().mediaUrl        ?? "",
        thumbnail:       d.data().thumbnail       ?? "",
        status:          (d.data().status as PostStatus) ?? "pending",
        createdAt:       d.data().createdAt,
        rejectionReason: d.data().rejectionReason ?? "",
      }));
      posts.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setMyPosts(posts);
    });

    return () => unsub();
  }, [params.battleId]);

  // ── Pick video ─────────────────────────────────────────────
  const pickVideo = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"] as ImagePicker.MediaType[],
      quality:    0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      const file = result.assets[0];
      setVideoAsset(file);
      setThumbnail(null);
      try {
        const { uri: thumb } = await VideoThumbnails.getThumbnailAsync(file.uri, { time: 1000 });
        setThumbnail(thumb);
      } catch (_) {}
    }
  };

  // ── Upload reel ────────────────────────────────────────────
  const uploadReel = async (): Promise<void> => {
    const uid = auth.currentUser?.uid;
    if (!uid)             { Alert.alert("Please login first.");                                               return; }
    if (!student)         { Alert.alert("Profile not found.");                                                return; }
    if (!videoAsset)      { Alert.alert("Please select a video.");                                            return; }
    if (notEligible)      { Alert.alert("Not eligible", "Only Class 5–12 students can upload skill reels."); return; }
    if (!params.battleId) { Alert.alert("No battle selected.");                                               return; }

    const allowed = await checkPostLimit(params.battleId, uid);
    if (!allowed) return;

    setLoading(true);
    setUploadProgress(0);
    progressAnim.setValue(0);

    try {
      const response = await globalThis.fetch(videoAsset.uri);
      const blob     = await response.blob();

      // Path matches Storage rules: reels/{uid}/{fileName}
      const fileRef    = ref(storage, `reels/${uid}/${Date.now()}.mp4`);
      const uploadTask = uploadBytesResumable(fileRef, blob, {
        contentType: videoAsset.mimeType ?? "video/mp4",
      });

      const mediaUrl: string = await new Promise<string>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot: UploadTaskSnapshot) => {
            const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            setUploadProgress(pct);
            Animated.timing(progressAnim, {
              toValue: pct, duration: 300, useNativeDriver: false,
            }).start();
          },
          (error) => {
            reject(
              error.code === "storage/unauthorized"
                ? new Error("Upload permission denied. Please contact support.")
                : error
            );
          },
          async () => resolve(await getDownloadURL(uploadTask.snapshot.ref))
        );
      });

      // Save with status: "pending" — admin will change to in_review → approved/rejected
      await addDoc(collection(db, "posts"), {
        userId:     uid,
        name:       student.name,
        school:     student.school,
        class:      student.class,
        profilePic: student.profilePic,
        battleId:      params.battleId,
        battleTitle:   params.battleTitle,
        battleType:    params.battleType,
        isSkillBattle: true,
        postType:      "reel",
        month:         params.month,
        location: {
          city:     student.location.city,
          district: student.location.district,
          state:    student.location.state,
          pincode:  student.location.pincode,
          country:  "India",
        },
        mediaUrl,
        thumbnail: thumbnail ?? "",
        // ── Moderation fields ──────────────────────────────
        status:          "pending",  // pending | in_review | approved | rejected
        rejectionReason: "",         // filled by admin on reject
        reviewedAt:      null,
        reviewedBy:      "",
        // Engagement
        likes: 0, views: 0, shares: 0, comments: 0, watchTime: 0,
        createdAt: serverTimestamp(),
      });

      setVideoAsset(null);
      setThumbnail(null);
      setShowMyPosts(true);

      Alert.alert(
        "🎉 Submitted!",
        "Your reel is pending admin review.\n\nIt will show a watermark in the feed until approved.",
        [{ text: "OK" }]
      );
    } catch (e: unknown) {
      Alert.alert("Upload Failed", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Not eligible screen ────────────────────────────────────
  if (notEligible) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.centered}>
          <Text style={{ fontSize: 50 }}>🔒</Text>
          <Text style={[styles.notEligibleTitle, { color: colors.text }]}>Not Eligible</Text>
          <Text style={[styles.notEligibleText,  { color: colors.textSecondary }]}>
            Skill Battle is only available for{"\n"}students in Class 5 to 12.
            {"\n\n"}You are currently in Class {student?.class || "unknown"}.
          </Text>
          <TouchableOpacity
            style={[styles.backToListBtn, { backgroundColor: colors.accent }]}
            onPress={() => router.back()}
          >
            <Text style={styles.backToListBtnText}>← Back to Battles</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main UI ────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Back */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>

        {/* Battle banner */}
        <LinearGradient
          colors={isSp ? ["#2a1500", "#1a0e00"] : ["#170d40", "#0d1a4a"]}
          style={styles.battleBanner}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        >
          <View style={[styles.battleTypePill, { backgroundColor: isSp ? "#ff9f43" : accent }]}>
            <Text style={styles.battleTypePillText}>
              {isSp ? "🏅 Sponsored Battle" : "🎓 Free Battle"}
            </Text>
          </View>
          <Text style={styles.battleBannerTitle}>{params.battleTitle}</Text>
          <Text style={styles.battleBannerMonth}>📅 {params.month}</Text>
        </LinearGradient>

        {/* Student info card */}
        {student && (
          <View style={[styles.studentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {student.profilePic ? (
              <Image source={{ uri: student.profilePic }} style={styles.studentAvatar} />
            ) : (
              <View style={[styles.studentAvatarPlaceholder, { backgroundColor: `${accent}20` }]}>
                <Text style={[styles.studentAvatarInitial, { color: accent }]}>
                  {student.name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.studentName, { color: colors.text }]}>{student.name}</Text>
              <Text style={[styles.studentMeta, { color: colors.textSecondary }]}>
                {student.school} · Class {student.class}
              </Text>
              <Text style={[styles.studentMeta, { color: colors.textSecondary }]}>
                📍 {student.location.district}, {student.location.state}
              </Text>
            </View>
            <View style={[styles.eligibleBadge, { backgroundColor: `${accent}18`, borderColor: `${accent}35` }]}>
              <Text style={[styles.eligibleBadgeText, { color: accent }]}>✅ Eligible</Text>
            </View>
          </View>
        )}

        {/* ── My Submissions tracker ───────────────────────── */}
        {myPosts.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => setShowMyPosts((v) => !v)}
            >
              <View style={styles.sectionHeaderLeft}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  📋 My Submissions
                </Text>
                <View style={[styles.countBadge, { backgroundColor: `${accent}20` }]}>
                  <Text style={[styles.countBadgeText, { color: accent }]}>
                    {myPosts.length}/4
                  </Text>
                </View>
              </View>
              <Ionicons
                name={showMyPosts ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {showMyPosts && (
              <View style={styles.postsList}>
                {myPosts.map((post, index) => {
                  const cfg = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.pending;
                  return (
                    <View
                      key={post.id}
                      style={[
                        styles.postRow,
                        index > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                      ]}
                    >
                      {/* Thumbnail with watermark overlay */}
                      <View style={styles.postThumbWrap}>
                        {post.thumbnail ? (
                          <Image source={{ uri: post.thumbnail }} style={styles.postThumb} />
                        ) : (
                          <View style={[styles.postThumbEmpty, { backgroundColor: `${accent}15` }]}>
                            <Text style={{ fontSize: 20 }}>🎬</Text>
                          </View>
                        )}
                        {/* Watermark — only visible for non-approved */}
                        <PostStatusWatermark status={post.status} />
                      </View>

                      {/* Info */}
                      <View style={{ flex: 1, gap: 5 }}>
                        <Text style={[styles.postLabel, { color: colors.text }]}>
                          Reel #{index + 1}
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
                          <Text style={[styles.statusText, { color: cfg.color }]}>
                            {cfg.emoji}  {cfg.label}
                          </Text>
                        </View>
                        <Text style={[styles.statusDesc, { color: colors.textSecondary }]}>
                          {cfg.description}
                        </Text>
                        {post.status === "rejected" && post.rejectionReason ? (
                          <View style={styles.rejectionBox}>
                            <Text style={styles.rejectionLabel}>Admin note:</Text>
                            <Text style={styles.rejectionText}>{post.rejectionReason}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Info box */}
        <View style={[styles.infoBox, { backgroundColor: `${accent}10`, borderColor: `${accent}30` }]}>
          <Ionicons name="information-circle-outline" size={16} color={accent} />
          <Text style={[styles.infoBoxText, { color: accent }]}>
            Battle title and description are set by admin. Just upload your best skill reel!
          </Text>
        </View>

        {/* Video picker */}
        <TouchableOpacity
          style={[
            styles.videoPicker,
            { backgroundColor: colors.card, borderColor: videoAsset ? accent : colors.border },
            videoAsset && { borderWidth: 2 },
          ]}
          onPress={pickVideo}
          activeOpacity={0.85}
        >
          {videoAsset ? (
            <>
              <VideoView player={player} style={styles.videoPreview} nativeControls={false} />
              <View style={styles.videoOverlay}>
                <View style={styles.changeVideoBtn}>
                  <Ionicons name="camera" size={16} color="#fff" />
                  <Text style={styles.changeVideoText}>Change Video</Text>
                </View>
              </View>
              {thumbnail && (
                <Image source={{ uri: thumbnail }} style={styles.thumbnailPreview} />
              )}
            </>
          ) : (
            <View style={styles.videoPickerEmpty}>
              <LinearGradient
                colors={[`${accent}20`, `${accent}08`]}
                style={styles.videoPickerGradient}
              >
                <Text style={{ fontSize: 48 }}>🎬</Text>
                <Text style={[styles.videoPickerTitle, { color: colors.text }]}>
                  Upload Your Skill Reel
                </Text>
                <Text style={[styles.videoPickerSub, { color: colors.textSecondary }]}>
                  Tap to select a video from gallery
                </Text>
                <View style={[styles.videoPickerBtn, { backgroundColor: accent }]}>
                  <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                  <Text style={styles.videoPickerBtnText}>Choose Video</Text>
                </View>
              </LinearGradient>
            </View>
          )}
        </TouchableOpacity>

        {/* Rules */}
        <View style={[styles.rulesBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.rulesTitle, { color: colors.text }]}>📋 Rules</Text>
          {[
            "Video must be your original skill content",
            "Max 4 reels per battle",
            "Only Class 5–12 students can participate",
            "No inappropriate content",
            "Location is auto-detected from your profile",
            "All reels go through admin review before approval",
          ].map((rule, i) => (
            <View key={i} style={styles.ruleRow}>
              <Text style={[styles.ruleDot, { color: accent }]}>•</Text>
              <Text style={[styles.ruleText, { color: colors.textSecondary }]}>{rule}</Text>
            </View>
          ))}
        </View>

        {/* Upload progress */}
        {loading && (
          <View style={[styles.progressBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.progressLabel, { color: colors.text }]}>
              📤 Uploading... {Math.round(uploadProgress)}%
            </Text>
            <View style={[styles.progressBg, { backgroundColor: "rgba(255,255,255,0.07)" }]}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: accent,
                    width: progressAnim.interpolate({
                      inputRange: [0, 100], outputRange: ["0%", "100%"],
                    }),
                  },
                ]}
              />
            </View>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: accent, opacity: !videoAsset || loading ? 0.6 : 1 },
          ]}
          onPress={uploadReel}
          disabled={!videoAsset || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="rocket" size={18} color="#fff" />
              <Text style={styles.submitBtnText}>Submit to Battle 🚀</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  centered:  { flex: 1, justifyContent: "center", alignItems: "center", padding: 30, gap: 16 },

  backBtn:  { flexDirection: "row", alignItems: "center", gap: 8, padding: 16 },
  backText: { fontSize: 15, fontWeight: "600" },

  notEligibleTitle:  { fontSize: 22, fontWeight: "900", textAlign: "center" },
  notEligibleText:   { fontSize: 14, fontWeight: "500", textAlign: "center", lineHeight: 22 },
  backToListBtn:     { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  backToListBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  battleBanner: {
    marginHorizontal: 16, marginBottom: 14,
    borderRadius: 18, padding: 16, gap: 6,
  },
  battleTypePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, marginBottom: 4,
  },
  battleTypePillText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  battleBannerTitle:  { color: "#fff", fontSize: 18, fontWeight: "900", lineHeight: 24 },
  battleBannerMonth:  { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "600" },

  studentCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginBottom: 12,
    padding: 12, borderRadius: 14, borderWidth: 1,
  },
  studentAvatar:            { width: 46, height: 46, borderRadius: 23 },
  studentAvatarPlaceholder: { width: 46, height: 46, borderRadius: 23, justifyContent: "center", alignItems: "center" },
  studentAvatarInitial:     { fontSize: 18, fontWeight: "900" },
  studentName:  { fontSize: 14, fontWeight: "800" },
  studentMeta:  { fontSize: 11, fontWeight: "500", marginTop: 1 },
  eligibleBadge:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  eligibleBadgeText: { fontSize: 10, fontWeight: "800" },

  section: {
    marginHorizontal: 16, marginBottom: 14,
    borderRadius: 14, borderWidth: 1, overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", padding: 14,
  },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle:      { fontSize: 13, fontWeight: "800" },
  countBadge:        { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  countBadgeText:    { fontSize: 11, fontWeight: "800" },

  postsList: { paddingHorizontal: 14, paddingBottom: 14 },
  postRow:   { flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 12 },

  postThumbWrap:  { position: "relative", width: 56, height: 80, borderRadius: 14, overflow: "hidden" },
  postThumb:      { width: 56, height: 80, borderRadius: 0 },
  postThumbEmpty: { width: 56, height: 80, justifyContent: "center", alignItems: "center" },

  postLabel:   { fontSize: 12, fontWeight: "700" },
  statusBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText:  { fontSize: 11, fontWeight: "800" },
  statusDesc:  { fontSize: 11, fontWeight: "500", lineHeight: 16 },

  rejectionBox: {
    marginTop: 4, padding: 8,
    backgroundColor: "#e74c3c15",
    borderRadius: 8, borderLeftWidth: 3, borderLeftColor: "#e74c3c",
  },
  rejectionLabel: { color: "#e74c3c", fontSize: 10, fontWeight: "800" },
  rejectionText:  { color: "#e74c3c", fontSize: 11, fontWeight: "500", marginTop: 2 },

  infoBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    marginHorizontal: 16, marginBottom: 14,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  infoBoxText: { fontSize: 12, fontWeight: "600", flex: 1, lineHeight: 18 },

  videoPicker: {
    marginHorizontal: 16, marginBottom: 14,
    borderRadius: 18, borderWidth: 1.5,
    overflow: "hidden", minHeight: 220,
  },
  videoPreview:   { width: "100%", height: 220 },
  videoOverlay:   { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", padding: 12 },
  changeVideoBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
  },
  changeVideoText:   { color: "#fff", fontSize: 12, fontWeight: "700" },
  thumbnailPreview:  {
    position: "absolute", bottom: 12, left: 12,
    width: 48, height: 72, borderRadius: 8,
    borderWidth: 2, borderColor: "#fff",
  },
  videoPickerEmpty:    { flex: 1 },
  videoPickerGradient: {
    flex: 1, minHeight: 220,
    justifyContent: "center", alignItems: "center",
    gap: 10, padding: 24,
  },
  videoPickerTitle:   { fontSize: 16, fontWeight: "800", textAlign: "center" },
  videoPickerSub:     { fontSize: 13, fontWeight: "500", textAlign: "center" },
  videoPickerBtn:     {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 20, marginTop: 6,
  },
  videoPickerBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  rulesBox:   { marginHorizontal: 16, marginBottom: 16, padding: 14, borderRadius: 14, borderWidth: 1, gap: 8 },
  rulesTitle: { fontSize: 14, fontWeight: "800", marginBottom: 4 },
  ruleRow:    { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  ruleDot:    { fontSize: 16, lineHeight: 20 },
  ruleText:   { fontSize: 12, fontWeight: "500", flex: 1, lineHeight: 18 },

  progressBox:   { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  progressLabel: { fontSize: 12, fontWeight: "600" },
  progressBg:    { height: 8, borderRadius: 5, overflow: "hidden" },
  progressFill:  { height: "100%", borderRadius: 5 },

  submitBtn: {
    marginHorizontal: 16, marginBottom: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 16, borderRadius: 16,
  },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});