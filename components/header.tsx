import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";

import { useTheme } from "@/context/ThemeContext";
import { auth, db } from "@/lib/firebase";
import { Ionicons } from "@expo/vector-icons";
import { DrawerActions, useNavigation } from "@react-navigation/native";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";

type Props = {
  title?: string;
  coins?: number;
  hideMenu?: boolean;
  hideTitle?: boolean;
};

export default function Header({
  title = "VidyaAI",
  coins,
  hideMenu = false,
  hideTitle = false,
}: Props) {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const router = useRouter();

  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [walletCoins, setWalletCoins] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // 📸 Fetch profile picture from database
  useEffect(() => {
    const fetchProfilePic = async () => {
      try {
        if (!auth.currentUser) {
          return;
        }

        const studentDoc = await getDoc(
          doc(db, "students", auth.currentUser.uid)
        );

        const userDoc = await getDoc(
          doc(db, "users", auth.currentUser.uid)
        );

        if (studentDoc.exists() && studentDoc.data()?.profilePic) {
          setProfilePic(studentDoc.data().profilePic);
        }

        if (userDoc.exists() && typeof userDoc.data()?.coins === "number") {
          setWalletCoins(userDoc.data().coins);
          return;
        }

        if (studentDoc.exists()) {
          const studentCoins = studentDoc.data()?.stats?.coins;

          if (typeof studentCoins === "number") {
            setWalletCoins(studentCoins);
          }
        }
      } catch (error) {
        console.log("Error fetching profile picture:", error);
      }
    };

    fetchProfilePic();
  }, []);

  // 🔔 Unread notifications listener
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const q = query(
      collection(db, "notifications", uid, "items"),
      where("read", "==", false)
    );

    const unsub = onSnapshot(q, (snap) => {
      setUnreadCount(snap.size);
    });

    return unsub;
  }, []);

  const handleMenuPress = () => {
    let currentNav: any = navigation;

    while (currentNav) {
      if (typeof currentNav.openDrawer === "function") {
        currentNav.openDrawer();
        return;
      }

      currentNav = currentNav.getParent?.();
    }

    if (navigation?.dispatch) {
      try {
        navigation.dispatch(DrawerActions.openDrawer());
      } catch {
        console.log("Drawer navigation not available for this screen");
      }
    }
  };

  const handleProfilePress = () => {
    router.push("/mypost");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      
      {/* 🔥 HEADER */}
      <View style={styles.header}>

        {/* LEFT */}
        <View style={styles.leftSection}>
          {!hideMenu && (
            <TouchableOpacity onPress={handleMenuPress}>
              <Ionicons name="menu" size={26} color={colors.text} />
            </TouchableOpacity>
          )}

          {!hideTitle && (
            <Text style={[styles.brand, { color: colors.text }]}>
              {title.replace("AI", "")}
              <Text style={styles.gold}>AI</Text>
            </Text>
          )}
        </View>

        {/* RIGHT */}
        <View style={styles.right}>

          {/* COINS */}
          <View style={styles.coinBox}>
            <Ionicons name="logo-bitcoin" size={16} color="#FFD700" />
            <Text style={styles.coinText}>
              {coins ?? walletCoins ?? 120}
            </Text>
          </View>

          {/* NOTIFICATION */}
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push("/notifications")}
          >
            <Ionicons
              name="notifications-outline"
              size={22}
              color={colors.text}
            />
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* PROFILE */}
          <TouchableOpacity onPress={handleProfilePress}>
            <Image
              source={{
                uri:
                  profilePic ||
                  `https://i.pravatar.cc/100?u=${
                    auth.currentUser?.uid || "user"
                  }`,
              }}
              style={styles.avatar}
              defaultSource={{
                uri: `https://i.pravatar.cc/100?u=${
                  auth.currentUser?.uid || "user"
                }`,
              }}
            />
          </TouchableOpacity>

        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#f8f9fa",

    // 🔥 HANDLE STATUS BAR PROPERLY (NO EXTRA GAP)
    paddingTop: 0,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",

    paddingHorizontal: 15,
    paddingVertical: 6,
  },

  leftSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  brand: {
    fontSize: 20,
    fontWeight: "900",
    color: "#000",
  },

  gold: {
    color: "#FFD700",
  },

  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  coinBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },

  coinText: {
    color: "#f59e0b",
    fontWeight: "bold",
    marginLeft: 5,
  },

  iconBtn: {
    padding: 5,
  },

  notifBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "#EF4444",
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },

  notifBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },

  avatar: {
    width: 32,
    height: 32,
    borderRadius: 20,
  },
});