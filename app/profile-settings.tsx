import Header from "@/components/header";
import { useTheme } from "@/context/ThemeContext";
import { auth, db, storage } from "@/lib/firebase";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { deleteUser, User } from "firebase/auth";
import { deleteDoc, doc, DocumentData, getDoc, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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

// ─── Constants ─────────────────────────────────────────────
const CLASS_OPTIONS: string[] = [
  "4", "5", "6", "7", "8",
  "9", "10", "11", "12",
  
];

const LANGUAGES: string[] = [
  "Bengali", "Hindi", "English", "Manipuri", "Assamese", "Tamil", "Telugu",
];

const BOARDS: string[] = [
  "CBSE", "ICSE", "State Board", "IB", "IGCSE",
];

const INTEREST_OPTIONS: string[] = [
  "GK", "Science", "Math", "History", "Geography", "English", "Coding", "Arts",
];

// ─── Types ─────────────────────────────────────────────────
type IconName = React.ComponentProps<typeof Ionicons>["name"];
type KeyboardType = "default" | "numeric" | "email-address" | "phone-pad";
type AutoCapitalize = "none" | "sentences" | "words" | "characters";

interface StudentLocation {
  city: string;
  district: string;
  pincode: string;
  state: string;
}

interface StudentData extends DocumentData {
  name?: string;
  phone?: string;
  school?: string;
  class?: string | number;
  board?: string;
  age?: number;
  dob?: string;
  preferredLanguage?: string;
  profilePic?: string;
  interests?: string[];
  location?: StudentLocation;
  updatedAt?: string;
}

interface SectionTitleProps {
  icon: string;
  label: string;
}

interface FieldProps {
  label: string;
  icon: IconName;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  keyboardType?: KeyboardType;
  autoCapitalize?: AutoCapitalize;
}

interface ChipRowProps {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (opt: string) => void;
}

// ─── Component ─────────────────────────────────────────────
export default function ProfileSettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  // ─── UI State ───────────────────────────────────────────
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState<boolean>(false);

  // ─── Form State ─────────────────────────────────────────
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [school, setSchool] = useState<string>("");
  const [studentClass, setStudentClass] = useState<string>("");
  const [board, setBoard] = useState<string>("");
  const [age, setAge] = useState<string>("");
  const [dob, setDob] = useState<string>("");
  const [preferredLanguage, setPreferredLanguage] = useState<string>("");
  const [profilePic, setProfilePic] = useState<string>("");
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [city, setCity] = useState<string>("");
  const [district, setDistrict] = useState<string>("");
  const [pincode, setPincode] = useState<string>("");
  const [stateVal, setStateVal] = useState<string>("");
  const [original, setOriginal] = useState<StudentData | null>(null);

  // ─── Fetch profile ───────────────────────────────────────
  useEffect(() => {
    const fetchProfile = async (): Promise<void> => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) {
          Alert.alert("Error", "No user logged in.");
          router.back();
          return;
        }
        const snap = await getDoc(doc(db, "students", uid));
        if (!snap.exists()) {
          Alert.alert("Error", "Profile not found.");
          return;
        }
        const d = snap.data() as StudentData;
        populateState(d);
        setOriginal(d);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        Alert.alert("Error", msg);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  // ─── Populate state ──────────────────────────────────────
  const populateState = (d: StudentData): void => {
    setName(d.name ?? "");
    setPhone(d.phone ?? "");
    setSchool(d.school ?? "");
    // ✅ safe — handles both string "9" and number 9 from Firestore
    setStudentClass(d.class !== undefined ? String(d.class) : "");
    setBoard(d.board ?? "");
    setAge(d.age !== undefined ? String(d.age) : "");
    setDob(d.dob ?? "");
    setPreferredLanguage(d.preferredLanguage ?? "");
    setProfilePic(d.profilePic ?? "");
    setLocalImage(null);
    setInterests(d.interests ?? []);
    setCity(d.location?.city ?? "");
    setDistrict(d.location?.district ?? "");
    setPincode(d.location?.pincode ?? "");
    setStateVal(d.location?.state ?? "");
  };

  // ─── Pick image ──────────────────────────────────────────
  const handlePickImage = async (): Promise<void> => {
    if (!isEditing) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission Denied", "Please allow access to your photo library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"] as ImagePicker.MediaType[],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.length > 0) {
      setLocalImage(result.assets[0].uri);
    }
  };

  // ─── Upload to Storage ───────────────────────────────────
  const uploadImageToStorage = async (
    localUri: string,
    uid: string
  ): Promise<string> => {
    setIsUploadingPhoto(true);
    setUploadProgress(0);
    try {
      const response = await fetch(localUri);
      const blob = await response.blob();
      const storageRef = ref(storage, `profilePics/${uid}.jpg`);
      const uploadTask = uploadBytesResumable(storageRef, blob);

      return await new Promise<string>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const progress = Math.round(
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            );
            setUploadProgress(progress);
          },
          (error) => {
            console.error("Upload error:", error);
            reject(error);
          },
          async () => {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(downloadURL);
          }
        );
      });
    } finally {
      setIsUploadingPhoto(false);
      setUploadProgress(0);
    }
  };

  // ─── Remove photo ────────────────────────────────────────
  const handleRemovePhoto = (): void => {
    if (!isEditing) return;
    Alert.alert("Remove Photo", "Remove your current profile photo?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          setLocalImage(null);
          setProfilePic("");
        },
      },
    ]);
  };

  // ─── Save to Firestore ───────────────────────────────────
  const handleSave = async (): Promise<void> => {
    if (!name.trim()) {
      Alert.alert("Validation", "Name is required.");
      return;
    }
    setSaving(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Not authenticated");

      let finalPhotoURL: string = profilePic;

      if (localImage) {
        finalPhotoURL = await uploadImageToStorage(localImage, uid);
      }

      if (!profilePic && !localImage && original?.profilePic) {
        try {
          await deleteObject(ref(storage, `profilePics/${uid}.jpg`));
        } catch (_) { /* file may not exist */ }
      }

      const updatePayload: StudentData = {
        name: name.trim(),
        phone: String(phone).trim(),
        school: school.trim(),
        class: String(studentClass).trim(),   // ✅ always string
        board: board.trim(),
        age: age ? parseInt(age, 10) : undefined,
        dob: dob.trim(),
        preferredLanguage,
        profilePic: finalPhotoURL,
        interests,
        location: {
          city: city.trim(),
          district: district.trim(),
          pincode: pincode.trim(),
          state: stateVal.trim(),
        },
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, "students", uid), updatePayload);
      setProfilePic(finalPhotoURL);
      setLocalImage(null);
      setOriginal((prev) => ({ ...prev, ...updatePayload }));
      setIsEditing(false);
      Alert.alert("✅ Saved", "Profile updated successfully.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      Alert.alert("Error", "Failed to save: " + msg);
    } finally {
      setSaving(false);
    }
  };

  // ─── Cancel ──────────────────────────────────────────────
  const handleCancel = (): void => {
    if (original) populateState(original);
    setIsEditing(false);
  };

  // ─── Toggle interest ─────────────────────────────────────
  const toggleInterest = (item: string): void => {
    if (!isEditing) return;
    setInterests((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  // ─── Delete account ──────────────────────────────────────
  const handleDelete = (): void => {
    Alert.alert(
      "⚠️ Delete Account",
      "This permanently deletes your Vidya AI profile and cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              const uid = auth.currentUser?.uid;
              if (!uid) throw new Error("Not authenticated");
              try {
                await deleteObject(ref(storage, `profilePics/${uid}.jpg`));
              } catch (_) { /* ignore */ }
              await deleteDoc(doc(db, "students", uid));
              await deleteUser(auth.currentUser as User);
              router.replace("/");
            } catch (e: unknown) {
              const err = e as { code?: string; message?: string };
              if (err.code === "auth/requires-recent-login") {
                Alert.alert(
                  "Re-login Required",
                  "Please log out and log back in, then try again."
                );
              } else {
                Alert.alert("Error", err.message ?? "Unknown error");
              }
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  // ─── Sub-components ──────────────────────────────────────
  const SectionTitle = ({ icon, label }: SectionTitleProps) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionIcon}>{icon}</Text>
      <Text style={[styles.sectionLabel, { color: colors.accent }]}>{label}</Text>
    </View>
  );

  const Field = ({
    label,
    icon,
    value,
    onChangeText,
    placeholder,
    keyboardType = "default",
    autoCapitalize = "words",
  }: FieldProps) => (
    <View style={styles.fieldWrapper}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.card,
            borderColor: isEditing ? colors.accent : colors.border,
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={17}
          color={isEditing ? colors.accent : colors.textSecondary}
        />
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          editable={isEditing}
        />
        {!isEditing && (
          <Ionicons name="lock-closed-outline" size={13} color={colors.border} />
        )}
      </View>
    </View>
  );

  const ChipRow = ({ label, options, selected, onToggle }: ChipRowProps) => (
    <View style={styles.fieldWrapper}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((opt: string) => {
          const active = selected.includes(opt);
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onToggle(opt)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.accent : colors.card,
                  borderColor: active ? colors.accent : colors.border,
                  opacity: !isEditing && !active ? 0.4 : 1,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? "#fff" : colors.text }]}>
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // ─── Display image ───────────────────────────────────────
  const displayImage: string | null = localImage ?? profilePic ?? null;

  // ─── Loading ─────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Header hideMenu={true} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading profile...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Main UI ─────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header hideMenu={true} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* PAGE TITLE */}
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.accent }]}>👤 Profile Settings</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {isEditing ? "Editing your details..." : "View and update your personal details"}
            </Text>
          </View>

          {/* ── AVATAR ───────────────────────────────── */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarWrapper}>
              {displayImage ? (
                <Image
                  source={{ uri: displayImage }}
                  style={[styles.avatarImage, { borderColor: colors.accent }]}
                />
              ) : (
                <View
                  style={[
                    styles.avatarPlaceholder,
                    {
                      backgroundColor: `${colors.accent}20`,
                      borderColor: colors.accent,
                    },
                  ]}
                >
                  <Text style={[styles.avatarInitial, { color: colors.accent }]}>
                    {name ? name.charAt(0).toUpperCase() : "S"}
                  </Text>
                </View>
              )}
              {isEditing && (
                <TouchableOpacity
                  style={[styles.cameraButton, { backgroundColor: colors.accent }]}
                  onPress={handlePickImage}
                >
                  <Ionicons name="camera" size={16} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.avatarName, { color: colors.text }]}>
              {name || "Student"}
            </Text>

            {isUploadingPhoto && (
              <>
                <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${uploadProgress}%` as `${number}%`,
                        backgroundColor: colors.accent,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.uploadText, { color: colors.textSecondary }]}>
                  Uploading... {uploadProgress}%
                </Text>
              </>
            )}

            {/* Badges */}
            <View style={styles.avatarBadgeRow}>
              {studentClass ? (
                <View style={[styles.badge, { backgroundColor: `${colors.accent}20` }]}>
                  <Text style={[styles.badgeText, { color: colors.accent }]}>
                    {studentClass}
                  </Text>
                </View>
              ) : null}
              {board ? (
                <View style={[styles.badge, { backgroundColor: `${colors.accent}20` }]}>
                  <Text style={[styles.badgeText, { color: colors.accent }]}>{board}</Text>
                </View>
              ) : null}
            </View>

            {/* Photo action buttons */}
            {isEditing && (
              <View style={styles.photoActions}>
                <TouchableOpacity
                  style={[styles.photoBtn, { borderColor: colors.accent }]}
                  onPress={handlePickImage}
                >
                  <Ionicons name="image-outline" size={15} color={colors.accent} />
                  <Text style={[styles.photoBtnText, { color: colors.accent }]}>
                    {localImage ? "Change Photo" : "Upload Photo"}
                  </Text>
                </TouchableOpacity>
                {displayImage ? (
                  <TouchableOpacity
                    style={[styles.photoBtn, { borderColor: "#FF4D4D" }]}
                    onPress={handleRemovePhoto}
                  >
                    <Ionicons name="trash-outline" size={15} color="#FF4D4D" />
                    <Text style={[styles.photoBtnText, { color: "#FF4D4D" }]}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>

          {/* ── FORM ─────────────────────────────────── */}
          <View style={styles.formContainer}>

            {/* Basic Info */}
            <SectionTitle icon="🧑" label="Basic Information" />
            <Field
              label="Full Name"
              icon="person-outline"
              value={name}
              onChangeText={setName}
              placeholder="Enter full name"
            />
            <Field
              label="Phone Number"
              icon="call-outline"
              value={phone}
              onChangeText={setPhone}
              placeholder="Enter phone number"
              keyboardType="phone-pad"
              autoCapitalize="none"
            />
            <Field
              label="Date of Birth"
              icon="calendar-outline"
              value={dob}
              onChangeText={setDob}
              placeholder="MM/DD/YYYY"
              autoCapitalize="none"
            />
            <Field
              label="Age"
              icon="hourglass-outline"
              value={age}
              onChangeText={setAge}
              placeholder="Enter age"
              keyboardType="numeric"
              autoCapitalize="none"
            />

            {/* Academic Details */}
            <SectionTitle icon="📚" label="Academic Details" />
            <Field
              label="School / Institution"
              icon="business-outline"
              value={school}
              onChangeText={setSchool}
              placeholder="Enter school name"
            />

            {/* ✅ Class as chip selector — Class 4 to Bachelor Degree */}
            <ChipRow
              label="Class / Grade"
              options={CLASS_OPTIONS}
              selected={studentClass ? [studentClass] : []}
              onToggle={(opt: string) => {
                if (isEditing) setStudentClass(opt === studentClass ? "" : opt);
              }}
            />

            <ChipRow
              label="Board"
              options={BOARDS}
              selected={board ? [board] : []}
              onToggle={(opt: string) => {
                if (isEditing) setBoard(opt === board ? "" : opt);
              }}
            />
            <ChipRow
              label="Preferred Language"
              options={LANGUAGES}
              selected={preferredLanguage ? [preferredLanguage] : []}
              onToggle={(opt: string) => {
                if (isEditing)
                  setPreferredLanguage(opt === preferredLanguage ? "" : opt);
              }}
            />
            <ChipRow
              label="Interests"
              options={INTEREST_OPTIONS}
              selected={interests}
              onToggle={toggleInterest}
            />

            {/* Location */}
            <SectionTitle icon="📍" label="Location" />
            <Field
              label="City"
              icon="location-outline"
              value={city}
              onChangeText={setCity}
              placeholder="Enter city"
            />
            <Field
              label="District"
              icon="map-outline"
              value={district}
              onChangeText={setDistrict}
              placeholder="Enter district"
            />
            <Field
              label="State"
              icon="flag-outline"
              value={stateVal}
              onChangeText={setStateVal}
              placeholder="Enter state"
            />
            <Field
              label="Pincode"
              icon="pin-outline"
              value={pincode}
              onChangeText={setPincode}
              placeholder="Enter pincode"
              keyboardType="numeric"
              autoCapitalize="none"
            />
          </View>

          {/* ── ACTION BUTTONS ───────────────────────── */}
          <View style={styles.actionsContainer}>
            {!isEditing ? (
              <TouchableOpacity
                style={[styles.editButton, { backgroundColor: colors.accent }]}
                onPress={() => setIsEditing(true)}
              >
                <Ionicons name="create-outline" size={20} color="#fff" />
                <Text style={styles.buttonText}>Edit Profile</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={[styles.cancelButton, { borderColor: colors.border }]}
                  onPress={handleCancel}
                  disabled={saving}
                >
                  <Text style={[styles.cancelText, { color: colors.textSecondary }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    { backgroundColor: colors.accent, opacity: saving ? 0.7 : 1 },
                  ]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-outline" size={20} color="#fff" />
                      <Text style={styles.buttonText}>Save Changes</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* ── DANGER ZONE ──────────────────────────── */}
          <View
            style={[
              styles.dangerZone,
              { borderColor: "#FF4D4D30", backgroundColor: "#FF4D4D08" },
            ]}
          >
            <Text style={[styles.dangerTitle, { color: "#FF4D4D" }]}>⚠️ Danger Zone</Text>
            <Text style={[styles.dangerHint, { color: colors.textSecondary }]}>
              Deleting your account removes all your Vidya AI data permanently.
            </Text>
            <TouchableOpacity
              style={[styles.dangerRow, { opacity: deleting ? 0.6 : 1 }]}
              onPress={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#FF4D4D" />
              ) : (
                <Ionicons name="trash-outline" size={16} color="#FF4D4D" />
              )}
              <Text style={styles.dangerText}>Delete My Account</Text>
            </TouchableOpacity>
          </View>

          {/* ── BACK BUTTON ──────────────────────────── */}
          <TouchableOpacity
            style={[
              styles.backButton,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
            <Text style={[styles.backText, { color: colors.text }]}>Back to Settings</Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 14 },
  loadingText: { fontSize: 14, fontWeight: "500" },

  headerText: { paddingHorizontal: 20, paddingVertical: 15 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 4 },
  subtitle: { fontSize: 14, fontWeight: "500" },

  // Avatar
  avatarSection: { alignItems: "center", marginVertical: 16, gap: 6 },
  avatarWrapper: { position: "relative", marginBottom: 4 },
  avatarImage: { width: 96, height: 96, borderRadius: 48, borderWidth: 3 },
  avatarPlaceholder: {
    width: 96, height: 96, borderRadius: 48, borderWidth: 3,
    justifyContent: "center", alignItems: "center",
  },
  avatarInitial: { fontSize: 40, fontWeight: "800" },
  cameraButton: {
    position: "absolute", bottom: 0, right: 0,
    width: 30, height: 30, borderRadius: 15,
    justifyContent: "center", alignItems: "center",
    borderWidth: 2, borderColor: "#fff",
  },
  avatarName: { fontSize: 18, fontWeight: "800", marginTop: 2 },
  avatarBadgeRow: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap", justifyContent: "center" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  photoActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  photoBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  photoBtnText: { fontSize: 13, fontWeight: "600" },

  // Progress
  progressBar: { width: 180, height: 6, borderRadius: 3, overflow: "hidden", marginTop: 4 },
  progressFill: { height: "100%", borderRadius: 3 },
  uploadText: { fontSize: 12, fontWeight: "500", marginTop: 2 },

  // Form
  formContainer: { paddingHorizontal: 20, gap: 14, marginTop: 4 },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 10, marginBottom: 2,
  },
  sectionIcon: { fontSize: 18 },
  sectionLabel: { fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  fieldWrapper: { gap: 5 },
  label: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  inputRow: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, gap: 10,
  },
  input: { flex: 1, fontSize: 15, fontWeight: "500" },

  // Chips
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: "600" },

  // Actions
  actionsContainer: { paddingHorizontal: 20, marginTop: 24, marginBottom: 4 },
  editButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12,
  },
  editActions: { flexDirection: "row", gap: 12 },
  cancelButton: {
    flex: 1, borderWidth: 1, borderRadius: 12,
    paddingVertical: 14, alignItems: "center", justifyContent: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600" },
  saveButton: {
    flex: 2, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Danger
  dangerZone: {
    marginHorizontal: 20, marginTop: 28, padding: 16,
    borderRadius: 12, borderWidth: 1, gap: 8,
  },
  dangerTitle: { fontSize: 14, fontWeight: "700" },
  dangerHint: { fontSize: 12, fontWeight: "500", lineHeight: 18 },
  dangerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  dangerText: { color: "#FF4D4D", fontSize: 14, fontWeight: "600" },

  // Back
  backButton: {
    marginHorizontal: 20, marginTop: 20, marginBottom: 40,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
  },
  backText: { fontSize: 15, fontWeight: "600" },
});