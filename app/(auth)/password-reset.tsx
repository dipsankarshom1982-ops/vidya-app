import { auth } from "@/lib/firebase";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { sendPasswordResetEmail } from "firebase/auth";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function PasswordReset() {
  const router = useRouter();
  const { email: initialEmail } = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(initialEmail ?? "");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleReset = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError("Please enter your email address");
      return;
    }
    if (!/\S+@\S+\.\S+/.test(normalized)) {
      setError("Invalid email format");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await sendPasswordResetEmail(auth, normalized);
      setSent(true);
    } catch (err: any) {
      if (err.code === "auth/user-not-found") {
        setError("No account found with this email address");
      } else if (err.code === "auth/invalid-email") {
        setError("Invalid email address");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <LinearGradient colors={["#020617", "#0F172A", "#1E1B4B"]} style={styles.gradient}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* BACK BUTTON */}
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color="#94A3B8" />
              <Text style={styles.backText}>Back to Login</Text>
            </TouchableOpacity>

            {/* ICON */}
            <View style={styles.iconCircle}>
              <LinearGradient colors={["#6366F1", "#8B5CF6"]} style={styles.iconGradient}>
                <Ionicons name="lock-closed" size={32} color="#FFFFFF" />
              </LinearGradient>
            </View>

            {/* HEADING */}
            <Text style={styles.title}>Reset your password</Text>
            <Text style={styles.subtitle}>
              Enter the email address linked to your account and we'll send you a
              secure reset link.
            </Text>

            {sent ? (
              /* ── SUCCESS STATE ── */
              <View style={styles.successCard}>
                <View style={styles.successIconWrap}>
                  <Text style={styles.successEmoji}>📬</Text>
                </View>
                <Text style={styles.successTitle}>Email sent!</Text>
                <Text style={styles.successBody}>
                  We've sent a password reset link to
                </Text>
                <Text style={styles.successEmail}>{email.trim().toLowerCase()}</Text>
                <Text style={styles.successHint}>
                  Check your spam folder if you don't see it within a few minutes.
                </Text>
                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={() => router.replace("/login")}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={["#6366F1", "#8B5CF6"]} style={styles.doneBtnInner}>
                    <Text style={styles.doneBtnText}>Back to Login</Text>
                    <Ionicons name="arrow-forward" size={16} color="#fff" />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* ── FORM ── */}
                <View style={styles.form}>
                  {/* Label */}
                  <Text style={styles.label}>Email address</Text>

                  {/* Input */}
                  <View
                    style={[
                      styles.inputWrap,
                      error ? styles.inputWrapError : null,
                    ]}
                  >
                    <Ionicons
                      name="mail-outline"
                      size={18}
                      color="#64748B"
                      style={styles.inputIcon}
                    />
                    <TextInput
                      placeholder="you@example.com"
                      placeholderTextColor="#64748B"
                      style={styles.input}
                      value={email}
                      onChangeText={(t) => {
                        setEmail(t);
                        if (error) setError("");
                      }}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  {/* Error */}
                  {error ? (
                    <View style={styles.errorRow}>
                      <Ionicons name="alert-circle" size={14} color="#F87171" />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}

                  {/* Helper */}
                  {!error && (
                    <Text style={styles.helper}>
                      We'll only send a link if this email is registered with VidyaAI.
                    </Text>
                  )}
                </View>

                {/* BUTTON */}
                <TouchableOpacity
                  onPress={handleReset}
                  disabled={!email.trim() || loading}
                  style={[styles.btn, (!email.trim() || loading) && styles.btnDisabled]}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={["#6366F1", "#8B5CF6"]} style={styles.btnInner}>
                    {loading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Text style={styles.btnText}>Send Reset Link</Text>
                        <Ionicons name="send" size={16} color="#fff" />
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                {/* DIVIDER */}
                <View style={styles.dividerRow}>
                  <View style={styles.divider} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.divider} />
                </View>

                {/* FOOTER */}
                <TouchableOpacity onPress={() => router.back()} style={styles.loginLink}>
                  <Text style={styles.loginLinkText}>
                    Remembered your password?{" "}
                    <Text style={styles.loginLinkHighlight}>Sign in</Text>
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },
  gradient: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },

  /* Back */
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 8,
    marginBottom: 32,
  },
  backText: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "500",
  },

  /* Icon */
  iconCircle: {
    alignSelf: "center",
    marginBottom: 28,
    borderRadius: 36,
    overflow: "hidden",
    shadowColor: "#6366F1",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  iconGradient: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Heading */
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#F8FAFC",
    textAlign: "center",
    letterSpacing: 0.3,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 36,
    paddingHorizontal: 8,
  },

  /* Form */
  form: {
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#CBD5E1",
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#334155",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  inputWrapError: {
    borderColor: "#F87171",
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: "#F1F5F9",
    fontWeight: "500",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  errorText: {
    color: "#F87171",
    fontSize: 13,
    fontWeight: "500",
  },
  helper: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 8,
    lineHeight: 17,
  },

  /* Button */
  btn: {
    borderRadius: 14,
    overflow: "hidden",
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 14,
  },
  btnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  /* Divider */
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 24,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: "#1E293B",
  },
  dividerText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "500",
  },

  /* Footer */
  loginLink: {
    alignItems: "center",
  },
  loginLinkText: {
    color: "#94A3B8",
    fontSize: 14,
  },
  loginLinkHighlight: {
    color: "#818CF8",
    fontWeight: "700",
  },

  /* Success */
  successCard: {
    backgroundColor: "#0F172A",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#1E293B",
    padding: 28,
    alignItems: "center",
  },
  successIconWrap: {
    marginBottom: 16,
  },
  successEmoji: {
    fontSize: 56,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#F8FAFC",
    marginBottom: 12,
  },
  successBody: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    marginBottom: 6,
  },
  successEmail: {
    fontSize: 15,
    fontWeight: "700",
    color: "#818CF8",
    marginBottom: 16,
    textAlign: "center",
  },
  successHint: {
    fontSize: 12,
    color: "#475569",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 24,
  },
  doneBtn: {
    borderRadius: 14,
    overflow: "hidden",
    width: "100%",
  },
  doneBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 15,
    borderRadius: 14,
  },
  doneBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
