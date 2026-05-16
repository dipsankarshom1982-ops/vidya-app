import { useTheme } from "@/context/ThemeContext";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

interface SkillboardItemProps {
  item: {
    id?: string;
    name?: string;
    profilePic?: string;
    score?: number;
    totalViews?: number;
    totalLikes?: number;
  };
  index: number;
}

// Format large numbers (e.g., 1234 → 1.2K)
const formatNumber = (num: number | undefined) => {
  if (!num) return "0";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
};

export default function SkillboardItem({ item, index }: SkillboardItemProps) {
  const { colors } = useTheme();
  const [imageError, setImageError] = useState(false);

  const hasProfilePic = item.profilePic && !imageError;
  const initials = item.name?.[0]?.toUpperCase() || "?";
  const score = Math.floor(item.score || 0);
  const views = formatNumber(item.totalViews);
  const likes = formatNumber(item.totalLikes);

  return (
    <View style={[styles.row, { backgroundColor: colors.card }]}>
      <Text style={[styles.rank, { color: index < 3 ? "#fbbf24" : colors.text }]}>
        #{index + 1}
      </Text>

      {hasProfilePic ? (
        <Image
          source={{ uri: item.profilePic }}
          style={styles.avatar}
          onError={() => setImageError(true)}
        />
      ) : (
        <View style={[styles.avatar, styles.fallbackAvatar, { backgroundColor: colors.accent }]}>
          <Text style={[styles.initials, { color: colors.text }]}>{initials}</Text>
        </View>
      )}

      <View style={{ flex: 1 }}>
        <Text style={[styles.name, { color: colors.text }]}>{item.name || "Unknown"}</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          👁 {views} • ❤️ {likes}
        </Text>
      </View>

      <Text style={styles.score}>{score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    borderRadius: 14,
  },

  rank: {
    width: 30,
    fontWeight: "700",
  },

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },

  fallbackAvatar: {
    justifyContent: "center",
    alignItems: "center",
  },

  initials: {
    fontWeight: "700",
    fontSize: 14,
  },

  name: {
    fontWeight: "600",
  },

  sub: {
    fontSize: 12,
  },

  score: {
    color: "#22c55e",
    fontWeight: "700",
  },
});
