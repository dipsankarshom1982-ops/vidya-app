import { useTheme } from "@/context/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

type Props = {
  item: any;
  onEdit: () => void;
  onDelete: () => void;
};

export default function ProfilePostCard({ item, onEdit, onDelete }: Props) {
  const { colors } = useTheme();
  const [play, setPlay] = useState(false);
  const isPhotoPost = item.postType === "photo";

  const player = useVideoPlayer(item.videoUrl || item.mediaUrl || "", (player) => {
    player.loop = true;
  });

  const handleMenu = () => {
    Alert.alert("Options", "", [
      { text: "Edit", onPress: onEdit },
      { text: "Delete", onPress: onDelete, style: "destructive" },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <View style={[styles.card, { borderColor: colors.border }]}>

      {/* 🔹 HEADER */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <Image
            source={{
              uri:
                item.profilePic ||
                `https://i.pravatar.cc/100?u=${item.userId}`,
            }}
            style={styles.avatar}
          />
          <View>
            <Text style={[styles.name, { color: colors.text }]}>{item.name || "User"}</Text>
            <Text style={[styles.time, { color: colors.textSecondary }]}>
              {item.createdAt?.seconds
                ? new Date(item.createdAt.seconds * 1000).toLocaleString()
                : ""}
            </Text>
          </View>
        </View>

        {/* 🔥 3 DOT MENU */}
        <TouchableOpacity onPress={handleMenu}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* 🔹 VIDEO / THUMBNAIL */}
      {isPhotoPost ? (
        <Image
          source={{
            uri: item.mediaUrl || item.thumbnail || "https://via.placeholder.com/300x200.png",
          }}
          style={styles.thumbnail}
        />
      ) : !play ? (
        <TouchableOpacity onPress={() => setPlay(true)}>
          <Image
            source={{
              uri:
                item.thumbnail ||
                "https://via.placeholder.com/300x200.png",
            }}
            style={styles.thumbnail}
          />

          {/* ▶️ PLAY BUTTON */}
          <View style={styles.playIcon}>
            <Ionicons name="play" size={40} color="#fff" />
          </View>
        </TouchableOpacity>
      ) : (
        <VideoView
          player={player}
          style={styles.thumbnail}
          fullscreenOptions={{ enable: true }}
        />
      )}

      {/* 🔹 CAPTION */}
      <Text style={[styles.caption, { color: colors.text }]}>
        {item.caption || item.description || item.title || ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    borderBottomWidth: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  name: {
    fontWeight: "bold",
  },
  time: {
    fontSize: 12,
  },
  thumbnail: {
    height: 220,
    borderRadius: 12,
  },
  playIcon: {
    position: "absolute",
    top: "40%",
    left: "45%",
  },
  caption: {
    marginTop: 8,
  },
});
