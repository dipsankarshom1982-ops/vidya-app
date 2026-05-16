import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "@/lib/firebase";
import {
  signInWithEmailAndPassword
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    AsyncStorage.getItem("lastEmail").then((saved) => {
      if (saved) setEmail(saved);
    });
  }, []);

  // 🔐 LOGIN
  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter email and password");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setMessage("");

      const userCred = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password.trim()
      );

      const user = userCred.user;

      const snap = await getDoc(doc(db, "students", user.uid));

      if (!snap.exists()) {
        // Student record doesn't exist, need to complete registration
        setMessage("Redirecting to complete your profile...");
        setTimeout(() => {
          router.replace("/(auth)/register");
        }, 500);
        return;
      }

      // Check if onboarding is complete
      const onboardingComplete = snap.data()?.onboardingComplete ?? false;

      if (!onboardingComplete) {
        setMessage("Complete your profile setup...");
        setTimeout(() => {
          router.replace("/(auth)/register");
        }, 500);
        return;
      }

      // ✅ Login successful - redirect to home
      setMessage("Login successful!");
      setTimeout(() => {
        router.replace("/(drawer)/(tabs)/home");
      }, 500);

    } catch (err: any) {
      console.log("Login error:", err.code, err.message);
      
      switch (err.code) {
        case "auth/user-not-found":
          setError("Account not found. Please sign up first.");
          break;
        case "auth/wrong-password":
          setError("Incorrect password");
          break;
        case "auth/invalid-email":
          setError("Invalid email format");
          break;
        case "auth/invalid-credential":
          setError("Invalid email or password");
          break;
        case "auth/user-disabled":
          setError("Account has been disabled");
          break;
        default:
          setError(err.message || "Login failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // 🔑 FORGOT PASSWORD - Redirect to password reset page
  const handleForgotPassword = () => {
    router.push({ pathname: "/password-reset", params: { email: email.trim() } } as any);
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <LinearGradient
          colors={["#020617", "#1E1B4B", "#312E81"]}
          style={styles.container}
        >
          <StatusBar barStyle="light-content" />

          <Text style={styles.logo}>🎓</Text>

          <Text style={styles.brand}>
            Vidya<Text style={styles.gold}>AI</Text>
          </Text>

          <Text style={styles.title}>Welcome Back 👋</Text>
          <Text style={styles.subtitle}>
            Continue your learning journey
          </Text>

          {/* EMAIL */}
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>📧 Email</Text>
            <View style={styles.inputBox}>
              <TextInput
                placeholder="Enter your email"
                placeholderTextColor="#999"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
          </View>

          {/* PASSWORD + EYE */}
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>🔐 Password</Text>
            <View style={styles.inputBox}>
              <View style={styles.passwordRow}>
                <TextInput
                  placeholder="Enter your password"
                  placeholderTextColor="#999"
                  secureTextEntry={secure}
                  style={[styles.input, { flex: 1 }]}
                  value={password}
                  onChangeText={setPassword}
                />

                <TouchableOpacity onPress={() => setSecure(!secure)}>
                  <Text style={styles.eye}>
                    {secure ? "👁️‍🗨️" : "🙈"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* FORGOT PASSWORD */}
          <TouchableOpacity 
            style={styles.forgotButton}
            onPress={handleForgotPassword}
          >
            <Text style={styles.forgotText}>🔑 Forgot Password?</Text>
          </TouchableOpacity>

          {/* ERROR / SUCCESS */}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {message ? <Text style={styles.success}>{message}</Text> : null}

          {/* LOGIN BUTTON */}
          <TouchableOpacity
            style={[styles.button, loading && { opacity: 0.7 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            <LinearGradient
              colors={["#6366F1", "#8B5CF6"]}
              style={styles.buttonInner}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Login →</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* SIGNUP */}
          <TouchableOpacity onPress={() => router.push("/signup")}>
            <Text style={styles.footer}>
              Don’t have an account?{" "}
              <Text style={styles.link}>Sign up</Text>
            </Text>
          </TouchableOpacity>

        </LinearGradient>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
  },

  logo: {
    fontSize: 60,
    textAlign: "center",
    marginBottom: 10,
    marginTop: 20,
  },

  brand: {
    fontSize: 36,
    fontWeight: "900",
    color: "#fff",
    textAlign: "center",
    letterSpacing: 1,
  },

  gold: {
    color: "#FFD700",
    fontSize: 36,
  },

  title: {
    fontSize: 24,
    color: "#fff",
    textAlign: "center",
    marginTop: 15,
    fontWeight: "800",
  },

  subtitle: {
    textAlign: "center",
    color: "#c7d2fe",
    marginBottom: 35,
    fontSize: 14,
    marginTop: 8,
  },

  inputWrapper: {
    marginBottom: 18,
  },

  label: {
    color: "#c7d2fe",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },

  inputBox: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },

  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  eye: {
    fontSize: 18,
    color: "#aaa",
    marginLeft: 10,
  },

  forgot: {
    color: "#A78BFA",
    textAlign: "right",
    marginBottom: 10,
    fontSize: 13,
  },

  forgotButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(167, 139, 250, 0.1)",
    borderWidth: 1,
    borderColor: "#A78BFA",
    marginBottom: 20,
    marginTop: 5,
  },

  forgotText: {
    color: "#A78BFA",
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
  },

  input: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },

  error: {
    color: "#FF6B6B",
    textAlign: "center",
    marginBottom: 12,
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255, 107, 107, 0.1)",
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#FF6B6B",
  },

  success: {
    color: "#4ADE80",
    textAlign: "center",
    marginBottom: 12,
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(74, 222, 128, 0.1)",
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#4ADE80",
  },

  button: {
    borderRadius: 30,
    overflow: "hidden",
    marginTop: 10,
  },

  buttonInner: {
    paddingVertical: 16,
    alignItems: "center",
    borderRadius: 28,
  },

  buttonText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.5,
  },

  footer: {
    color: "#c7d2fe",
    textAlign: "center",
    marginTop: 25,
    fontSize: 14,
  },

  link: {
    color: "#FFD700",
    fontWeight: "700",
    fontSize: 14,
  },
});