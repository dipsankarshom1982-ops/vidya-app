import { useTheme } from "@/context/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";

import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

export default function SkillShortPreview() {
  const { colors } = useTheme();
  const [reels, setReels] = useState<any[]>([]);

  // 🎥 FETCH ONLY APPROVED SKILL BATTLE REELS
  const fetchReels = useCallback(async () => {
    try {
      // Only fetch approved posts — pending/in_review/rejected stay hidden from feed
      const q = query(
        collection(db, "posts"),
        where("isSkillBattle", "==", true),
        where("status",        "==", "approved")
      );
      const snap = await getDocs(q);

      const data = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // Sort by views descending, take top 10
      const sorted = data
        .sort((a: any, b: any) => (b.views || 0) - (a.views || 0))
        .slice(0, 10);

      setReels(sorted);
    } catch (error) {
      console.log("SkillShort error:", error);
      setReels([]);
    }
  }, []);

  useEffect(() => {
    fetchReels();
  }, [fetchReels]);

  // 🔄 REFRESH ON SCREEN FOCUS
  useFocusEffect(
    useCallback(() => {
      fetchReels();
    }, [fetchReels])
  );

  // 🎯 RENDER ITEM
  const renderItem = ({ item }: any) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        router.push({
          pathname: "/reels",
          // ✅ Pass post id — let the reels screen find its own index
          // This avoids out-of-range crash when reels screen has a
          // different list size than this preview
          params: { postId: item.id },
        })
      }
      activeOpacity={0.8}
    >
      <Image
        source={{
          uri:
            item.thumbnail ||
            item.mediaUrl ||
            "https://via.placeholder.com/120x180?text=No+Video",
        }}
        style={styles.image}
      />

      {/* 🎥 GRADIENT OVERLAY */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.8)"]}
        style={styles.gradient}
      />

      {/* ▶️ PLAY BUTTON */}
      <View style={styles.playContainer}>
        <Ionicons name="play" size={16} color="#fff" />
      </View>

      {/* 🔥 VIEWS */}
      <Text style={styles.views}>🔥 {item.views || 0}</Text>

      {/* 📝 TITLE */}
      {item.title && (
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>
      )}

      {/* 🎯 BADGE */}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>⚡ Battle</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>
        🔥 Skill Battle Shorts
      </Text>

      {reels.length > 0 ? (
        <FlatList
          horizontal
          data={reels}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No skill battle videos yet
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    marginVertical:   15,
    paddingHorizontal: 15,
  },

  title: {
    color:        "#fff",
    fontSize:     20,
    fontWeight:   "800",
    marginBottom: 12,
  },

  card: {
    marginRight:     12,
    borderRadius:    14,
    overflow:        "hidden",
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.25,
    shadowRadius:    6,
    elevation:       5,
    backgroundColor: "#fff",
  },

  image: {
    width:           120,
    height:          180,
    borderRadius:    12,
    backgroundColor: "#e5e7eb",
  },

  gradient: {
    position:     "absolute",
    top:          0,
    left:         0,
    right:        0,
    bottom:       0,
    borderRadius: 12,
  },

  views: {
    position:        "absolute",
    bottom:          8,
    left:            8,
    backgroundColor: "rgba(0,0,0,0.6)",
    color:           "#fff",
    fontSize:        12,
    fontWeight:      "600",
    paddingHorizontal: 6,
    paddingVertical:   3,
    borderRadius:    4,
  },

  playContainer: {
    position:        "absolute",
    top:             "50%",
    left:            "50%",
    marginLeft:      -15,
    marginTop:       -15,
    backgroundColor: "rgba(255,255,255,0.3)",
    width:           30,
    height:          30,
    borderRadius:    15,
    justifyContent:  "center",
    alignItems:      "center",
    borderWidth:     2,
    borderColor:     "#fff",
  },

  cardTitle: {
    position:   "absolute",
    bottom:     32,
    left:       8,
    right:      8,
    color:      "#fff",
    fontSize:   11,
    fontWeight: "600",
    lineHeight: 14,
  },

  badge: {
    position:        "absolute",
    top:             8,
    left:            8,
    backgroundColor: "rgba(252,33,33,0.9)",
    paddingHorizontal: 8,
    paddingVertical:   4,
    borderRadius:    6,
  },

  badgeText: {
    color:      "#fff",
    fontSize:   11,
    fontWeight: "bold",
  },

  empty: {
    height:         150,
    justifyContent: "center",
    alignItems:     "center",
  },

  emptyText: {
    color:      "#94a3b8",
    fontSize:   14,
    fontWeight: "500",
  },
});