import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth } from "@/lib/firebase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged, User } from "firebase/auth";

export default function SplashScreen() {
  const router = useRouter();

  // 🎬 Animations
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;

  // 🔐 State control
  const [appReady, setAppReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // 🎬 Smooth Animation
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 1000,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
    ]).start();

    // 🔐 Auth Listener
    const unsubscribe = onAuthStateChanged(auth, (usr) => {
      setUser(usr);
    });

    // ⏱ Minimum splash duration (important!)
    const timer = setTimeout(() => {
      setAppReady(true);
    }, 2000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!appReady) return;

    const navigate = async () => {
      const hasOpened = await AsyncStorage.getItem("hasOpened");

      if (user) {
        router.replace("/(drawer)/(tabs)/home");
      } else {
        if (!hasOpened) {
          await AsyncStorage.setItem("hasOpened", "true");
          router.replace("/welcome");
        } else {
          router.replace("/welcome"); // or "/login"
        }
      }
    };

    navigate();
  }, [appReady, user]);

  return (
    <LinearGradient
      colors={["#020617", "#0f172a", "#020617"]}
      style={styles.container}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          
          {/* BRAND */}
          <Animated.View
            style={{
              transform: [{ scale: scaleAnim }, { translateY: translateY }],
              opacity: opacityAnim,
              alignItems: "center",
            }}
          >
            <Text style={styles.emoji}>🎓</Text>
            <Text style={styles.brand}>
              Vidya<Text style={styles.gold}>AI</Text>
            </Text>
          </Animated.View>

          {/* TAGLINE */}
          <Animated.Text style={[styles.tagline, { opacity: opacityAnim }]}>
            Learn • Compete • Earn 🚀
          </Animated.Text>

          {/* POWERED BY */}
          <Animated.Text style={[styles.powered, { opacity: opacityAnim }]}>
            Powered by Shikshakool Academy Pvt. Ltd.
          </Animated.Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ================= STYLES =================

const styles = StyleSheet.create({
  container: { flex: 1 },

  safe: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  center: {
    alignItems: "center",
  },

  emoji: {
    fontSize: 72,
    textAlign: "center",
    marginBottom: 12,
  },

  brand: {
    fontSize: 48,
    fontWeight: "900",
    color: "#fff",
    textAlign: "center",
    letterSpacing: 2,
  },

  gold: {
    color: "#FFD700",
  },

  tagline: {
    color: "#94a3b8",
    marginTop: 18,
    fontSize: 15,
    letterSpacing: 1,
  },

  powered: {
    color: "#64748b",
    marginTop: 8,
    fontSize: 12,
  },
});