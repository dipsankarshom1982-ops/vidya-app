import { useTheme } from "@/context/ThemeContext";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Animated, {
    SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";

interface TopUser {
  id?: string;
  name?: string;
  profilePic?: string;
  score?: number;
}

const MEDAL = ["🥇", "🥈", "🥉"];

// Format large numbers (e.g., 1234 → 1.2K)
const formatNumber = (num: number | undefined) => {
  if (!num) return "0";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
};

function TopCard({ user, index, scale }: { user: TopUser; index: number; scale: SharedValue<number> }) {
  const { colors } = useTheme();
  const [imageError, setImageError] = useState(false);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(scale.value) }],
  }));

  const hasProfilePic = user.profilePic && !imageError;
  const initials = user.name?.[0]?.toUpperCase() || "?";
  const score = Math.floor(user.score || 0);

  return (
    <Animated.View key={user.id} style={[styles.card, animatedStyle]}>
      <Text style={styles.medal}>{MEDAL[index] || "?"}</Text>

      {hasProfilePic ? (
        <Image
          source={{ uri: user.profilePic }}
          style={styles.avatar}
          onError={() => setImageError(true)}
        />
      ) : (
        <View style={[styles.avatar, styles.fallbackAvatar, { backgroundColor: colors.accent }]}>
          <Text style={[styles.initials, { color: colors.text }]}>{initials}</Text>
        </View>
      )}

      <Text style={[styles.name, { color: colors.text }]}>{user.name || "Unknown"}</Text>
      <Text style={[styles.score, { color: colors.accent }]}>{formatNumber(score)}</Text>
    </Animated.View>
  );
}

export default function TopSkillboard({ data }: { data?: TopUser[] }) {
  const { colors } = useTheme();

  // Create animated values for each position
  const scales = (data || []).map((_, index) =>
    useSharedValue(index === 0 ? 1.2 : index === 1 ? 1.05 : 1)
  );

  if (!data || data.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>🏆 No rankings yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {data.slice(0, 3).map((user, index) => (
        <TopCard
          key={user.id || index}
          user={user}
          index={index}
          scale={scales[index]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-end",
    marginBottom: 20,
    paddingHorizontal: 12,
  },

  emptyContainer: {
    paddingVertical: 30,
    justifyContent: "center",
    alignItems: "center",
  },

  emptyText: {
    fontSize: 14,
  },

  card: {
    alignItems: "center",
    paddingHorizontal: 8,
  },

  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    marginBottom: 6,
  },

  fallbackAvatar: {
    justifyContent: "center",
    alignItems: "center",
  },

  initials: {
    fontWeight: "700",
    fontSize: 16,
  },

  name: {
    fontWeight: "700",
    fontSize: 13,
  },

  score: {
    fontSize: 12,
    marginTop: 4,
  },

  medal: {
    fontSize: 20,
    marginBottom: 4,
  },
});
