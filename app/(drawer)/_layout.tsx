import { Drawer } from "expo-router/drawer";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useTheme } from "@/context/ThemeContext";
import { auth, db } from "@/lib/firebase";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DrawerLayout() {
  const router = useRouter();
  const { colors } = useTheme();
  const user = auth.currentUser;
  
  const [studentProfile, setStudentProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 🔥 FETCH STUDENT PROFILE
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const studentDoc = await getDoc(doc(db, "students", user.uid));
        if (studentDoc.exists()) {
          setStudentProfile(studentDoc.data());
        }
      } catch (error) {
        console.log("Error fetching student profile:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [user]);

  // 🔥 MOCK DATA (fallback)
  const coins = studentProfile?.stats?.coins || 250;
  const level = studentProfile?.stats?.level || 3;
  const xp = studentProfile?.stats?.xp || 60;
  const name = studentProfile?.name || user?.email?.split("@")[0] || "Student";
  const school = studentProfile?.school || "Your School";
  const studentClass = studentProfile?.class || "Class";
  const language = studentProfile?.preferredLanguage || "English";
  const district = studentProfile?.location?.district || "District";
  const state = studentProfile?.location?.state || "State";
  const profilePic = studentProfile?.profilePic || null;

  const handleLogout = async () => {
    if (auth.currentUser?.email) {
      await AsyncStorage.setItem("lastEmail", auth.currentUser.email);
    }
    await signOut(auth);
    router.replace("/login");
  };

  return (
    <Drawer
      screenOptions={{
        headerShown: false,
        drawerStyle: {
          backgroundColor: colors.background,
          width: 300,
        },
      }}
      drawerContent={() => (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
          <View style={styles.container}>

            {/* 🔥 PROFILE CARD */}
            <LinearGradient
              colors={["#7b61ff", "#00c6ff"]}
              style={styles.profileCard}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="large" />
              ) : (
                <>
                  {/* PROFILE PICTURE + FALLBACK AVATAR */}
                  <Image
                    source={{
                      uri: profilePic || "https://i.pravatar.cc/150?u=" + (user?.email || "user"),
                    }}
                    style={styles.avatar}
                  />

                  {/* NAME */}
                  <Text style={styles.name}>{name}</Text>

                  {/* SCHOOL + CLASS + LOCATION + LANGUAGE */}
                  <View style={styles.infoBox}>
                    <Text style={styles.infoText}>🏫 {school}</Text>
                    <Text style={styles.infoText}>📚 Class {studentClass}</Text>
                    <Text style={styles.infoText}>🗣️ {language}</Text>
                    {district && state && (
                      <Text style={styles.infoText}>📍 {district}, {state}</Text>
                    )}
                  </View>

                  {/* 💰 COINS + LEVEL */}
                  <View style={styles.statsRow}>
                    <View style={styles.statBox}>
                      <Text style={styles.statValue}>{coins}</Text>
                      <Text style={styles.statLabel}>Coins</Text>
                    </View>

                    <View style={styles.statBox}>
                      <Text style={styles.statValue}>Lv {level}</Text>
                      <Text style={styles.statLabel}>Level</Text>
                    </View>
                  </View>

                  {/* 🔥 XP BAR */}
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${xp}%` }]} />
                  </View>
                </>
              )}
            </LinearGradient>

            {/* 🔥 MENU */}
            <View style={styles.menu}>
              <DrawerItem
                icon="home"
                label="Home"
                onPress={() => router.push("/(drawer)/(tabs)/home")}
                active
                colors={colors}
              />

              <DrawerItem
                icon="trophy-outline"
                label="Leaderboard"
                onPress={() => router.push("/leaderboard")}
                colors={colors}
              />
             

              <DrawerItem
                icon="wallet-outline"
                label="Wallet"
                onPress={() => console.log("Wallet")}
                colors={colors}
              />

              <DrawerItem
                icon="settings-outline"
                label="Settings"
                onPress={() => router.push("/settings")}
                colors={colors}
              />
              {/* 🏆 SKILL BOARD (UPDATED) */}
              <DrawerItem
                icon="trophy-outline"
                label="Skill Board"
                onPress={() => router.push("/skillboard")}
                colors={colors}
              />
            </View>

            {/* 🔥 LOGOUT */}
            <TouchableOpacity style={[styles.logout, { backgroundColor: `${colors.text}10` }]} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={20} color="#F87171" />
              <Text style={[styles.logoutText, { color: colors.text }]}>Logout</Text>
            </TouchableOpacity>

          </View>
        </SafeAreaView>
      )}
    >
      <Drawer.Screen name="(tabs)" options={{ title: "Home" }} />
    </Drawer>
  );
}

// 🔥 ITEM
function DrawerItem({ icon, label, onPress, active, colors }: any) {
  return (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: active ? `${colors.accent}20` : colors.background }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={active ? colors.accent : colors.textSecondary} />
      <Text style={[styles.label, { color: active ? colors.accent : colors.text }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({

  safeArea: {
    flex: 1,
  },

  container: {
    flex: 1,
    padding: 20,
    justifyContent: "space-between",
  },

  // 🔥 PROFILE CARD
  profileCard: {
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
  },

  avatar: {
    width: 70,
    height: 70,
    borderRadius: 40,
    marginBottom: 10,
  },

  name: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },

  email: {
    color: "#eee",
    fontSize: 12,
    marginBottom: 10,
  },

  infoBox: {
    marginVertical: 12,
    alignItems: "center",
  },

  infoText: {
    color: "#fff",
    fontSize: 12,
    marginVertical: 3,
  },

  statsRow: {
    flexDirection: "row",
    gap: 20,
    marginTop: 10,
  },

  statBox: {
    alignItems: "center",
  },

  statValue: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },

  statLabel: {
    color: "#ddd",
    fontSize: 12,
  },

  progressBar: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 5,
    width: "100%",
    marginTop: 10,
  },

  progressFill: {
    height: "100%",
    backgroundColor: "#fff",
    borderRadius: 5,
  },

  menu: {
    marginTop: 20,
  },

  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },

  activeItem: {
    backgroundColor: "rgba(123,97,255,0.15)",
    borderRadius: 10,
    paddingHorizontal: 10,
  },

  label: {
    color: "#fff",
    marginLeft: 15,
    fontSize: 15,
  },

  logout: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    borderTopWidth: 1,
    borderColor: "#222",
  },

  logoutText: {
    color: "#F87171",
    marginLeft: 10,
    fontSize: 16,
    fontWeight: "600",
  },

});