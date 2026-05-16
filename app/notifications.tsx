import { useTheme } from "@/context/ThemeContext";
import { auth, db } from "@/lib/firebase";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Notification = {
  id: string;
  title: string;
  body: string;
  type: "achievement" | "contest" | "reward" | "system" | "ai";
  read: boolean;
  createdAt: any;
};

const TYPE_META: Record<
  Notification["type"],
  { icon: string; color: string; bg: string }
> = {
  achievement: { icon: "🏆", color: "#FFD700", bg: "rgba(255,215,0,0.12)" },
  contest: { icon: "⚔️", color: "#818CF8", bg: "rgba(129,140,248,0.12)" },
  reward: { icon: "🪙", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  system: { icon: "📢", color: "#38BDF8", bg: "rgba(56,189,248,0.12)" },
  ai: { icon: "🤖", color: "#A78BFA", bg: "rgba(167,139,250,0.12)" },
};

function timeAgo(ts: any): string {
  if (!ts?.toDate) return "";
  const diff = Date.now() - ts.toDate().getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationsScreen() {
  const { colors, isDarkMode } = useTheme();
  const router = useRouter();
  const uid = auth.currentUser?.uid;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "notifications", uid, "items"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const items: Notification[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Notification, "id">),
      }));
      setNotifications(items);
      setLoading(false);
    });

    return unsub;
  }, [uid]);

  const markAllRead = async () => {
    if (!uid) return;
    const unread = notifications.filter((n) => !n.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((n) => {
      batch.update(doc(db, "notifications", uid, "items", n.id), {
        read: true,
      });
    });
    await batch.commit();
  };

  const markOneRead = async (id: string) => {
    if (!uid) return;
    await updateDoc(doc(db, "notifications", uid, "items", id), { read: true });
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const renderItem = ({ item }: { item: Notification }) => {
    const meta = TYPE_META[item.type] ?? TYPE_META.system;
    return (
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: item.read
              ? colors.card
              : isDarkMode
              ? "rgba(99,102,241,0.08)"
              : "rgba(99,102,241,0.05)",
            borderColor: item.read ? colors.border : "rgba(99,102,241,0.25)",
          },
        ]}
        onPress={() => markOneRead(item.id)}
        activeOpacity={0.75}
      >
        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: meta.bg }]}>
          <Text style={styles.iconText}>{meta.icon}</Text>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text
              style={[
                styles.title,
                { color: colors.text, fontWeight: item.read ? "600" : "800" },
              ]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {!item.read && <View style={styles.unreadDot} />}
          </View>
          <Text
            style={[styles.body, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {item.body}
          </Text>
          <Text style={[styles.time, { color: meta.color }]}>
            {timeAgo(item.createdAt)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      {/* HEADER */}
      <LinearGradient
        colors={
          isDarkMode
            ? ["#0f172a", "#1e1b4b"]
            : ["#f8fafc", "#f1f5f9"]
        }
        style={styles.header}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Notifications
          </Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>

        {unreadCount > 0 ? (
          <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </LinearGradient>

      {/* BODY */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🔔</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            All caught up!
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            No notifications yet. We'll let you know when something exciting
            happens.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  backBtn: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
  },
  badge: {
    backgroundColor: "#EF4444",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
  markAllBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "rgba(99,102,241,0.12)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  markAllText: {
    color: "#818CF8",
    fontSize: 12,
    fontWeight: "700",
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 20,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 14,
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#6366F1",
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
