import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";

export default function StudentRegister() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pincode, setPincode] = useState("");
  const [school, setSchool] = useState("");
  const [board, setBoard] = useState("");
  const [section, setSection] = useState("");
  const [studentClass, setStudentClass] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const [profilePic, setProfilePic] = useState<string | null>(null);

  const [stateVal, setStateVal] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");

  const [dob, setDob] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

  const [interests, setInterests] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const boards = ["CBSE", "ICSE", "State Board", "Other"];
  
  const classOptions = ["5", "6", "7", "8", "9", "10", "11", "12",];
  
  const languageOptions = [
    "English",
    "Hindi",
    "Tamil",
    "Telugu",
    "Kannada",
    "Malayalam",
    "Marathi",
    "Gujarati",
    "Bengali",
    "Punjabi",
    "Odia",
    "Urdu"
  ];

  const interestOptions = [
    "Maths","Science","Coding","AI","Robotics",
    "Cricket","Football","Art","Music","GK","Other"
  ];

  // 📍 Auto Location
  const fetchLocation = async (pin: string) => {
    if (pin.length !== 6) return;

    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const data = await res.json();

      if (data[0].Status === "Success") {
        const info = data[0].PostOffice[0];
        setStateVal(info.State);
        setDistrict(info.District);
        setCity(info.Name);
      }
    } catch (err) {
      console.log(err);
    }
  };

  // 📸 PICK PROFILE PICTURE
  const pickProfilePicture = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });

      if (!result.canceled) {
        // Store the local URI temporarily for preview
        // It will be uploaded to Firebase Storage during registration
        setProfilePic(result.assets[0].uri);
      }
    } catch (error) {
      console.log("Image picker error:", error);
    }
  };

  const toggleInterest = (item: string) => {
    if (interests.includes(item)) {
      setInterests(interests.filter(i => i !== item));
    } else {
      setInterests([...interests, item]);
    }
  };

  // 📅 Handle date picker
  const handleDateChange = (event: any, date: any) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    if (date) {
      setSelectedDate(date);
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      setDob(`${day}/${month}/${year}`);
    }
  };

  // 🎂 Calculate age from DOB
  const calculateAge = (dobString: string): number => {
    const [day, month, year] = dobString.split("/").map(Number);
    const today = new Date();
    let age = today.getFullYear() - year;

    const isBeforeBirthday =
      today.getMonth() < month - 1 ||
      (today.getMonth() === month - 1 && today.getDate() < day);

    if (isBeforeBirthday) {
      age--;
    }

    return age;
  };

  const validate = () => {
    if (!name || !phone || !pincode || !school || !board || !dob || !studentClass || !preferredLanguage) {
      return "Please fill all required fields";
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return "Invalid phone number";
    }
    if (!/^\d{6}$/.test(pincode)) {
      return "Invalid pincode";
    }
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
      return "DOB must be in DD/MM/YYYY format";
    }
    const age = calculateAge(dob);
    if (age < 5 || age > 25) {
      return "Age must be between 5 and 25";
    }
   return null;
  };

  const handleRegister = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }

    try {
      setLoading(true);
      setError("");

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const user = auth.currentUser;
      if (!user) {
        setError("User not logged in. Please login first.");
        return;
      }

      const finalInterests = interests.includes("Other")
        ? [...interests.filter(i => i !== "Other"), customInterest]
        : interests;

      const age = calculateAge(dob);

      // � UPLOAD PROFILE PICTURE TO FIREBASE STORAGE
      let profilePicUrl = "";
      if (profilePic && profilePic.startsWith("file://")) {
        try {
          const storage = getStorage();
          const filename = `profilePics/${user.uid}/profile-${Date.now()}.jpg`;
          const storageRef = ref(storage, filename);
          
          const response = await fetch(profilePic);
          const blob = await response.blob();
          await uploadBytes(storageRef, blob);
          profilePicUrl = await getDownloadURL(storageRef);
        } catch (uploadError) {
          console.log("Profile picture upload error:", uploadError);
          // Continue without profile pic if upload fails
          profilePicUrl = "";
        }
      } else if (profilePic) {
        // Already a URL from storage
        profilePicUrl = profilePic;
      }

      // 🔥 FIRESTORE SAVE
      await setDoc(doc(db, "students", user.uid), {
        name,
        phone,
        school,
        board,
        section,
        class: studentClass,
        preferredLanguage,
        profilePic: profilePicUrl,

        dob,
        age,

        location: {
          state: stateVal,
          district,
          city,
          pincode,
        },

        interests: finalInterests,

        stats: {
          xp: 0,
          level: 1,
          coins: 200,
          streak: 0,
        },

        learningProfile: {
          goal: "Improve learning",
          dailyTarget: 30,
        },

        onboardingComplete: true,
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, "users", user.uid), {
        role: "student",
        roles: ["student"],
        coins: 200,
        onboardingComplete: true,
        createdAt: serverTimestamp(),
      }, { merge: true });

      setError("");
      setTimeout(() => {
        router.replace("/(drawer)/(tabs)/home" as any);
      }, 500);

    } catch (e: any) {
      console.log("Registration error:", e.code, e.message);
      setError(e.message || "Registration failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <LinearGradient
        colors={["#020617", "#1E1B4B", "#312E81"]}
        style={styles.container}
      >
        <StatusBar barStyle="light-content" />

        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.brand}>
            Vidya<Text style={styles.gold}>AI</Text>
          </Text>

          <Text style={styles.title}>Create Your Profile 🚀</Text>

          {/* Inputs */}
          {/* PROFILE PICTURE */}
          <TouchableOpacity style={styles.profilePicContainer} onPress={pickProfilePicture}>
            {profilePic ? (
              <Image source={{ uri: profilePic }} style={styles.profilePicPreview} />
            ) : (
              <View style={styles.profilePicPlaceholder}>
                <Text style={styles.profilePicText}>📸</Text>
                <Text style={styles.profilePicLabel}>Add Profile Picture</Text>
              </View>
            )}
          </TouchableOpacity>

          <TextInput style={styles.input} placeholder="Full Name *" placeholderTextColor="#aaa" value={name} onChangeText={setName} />

          <TextInput style={styles.input} placeholder="Parent Phone *" keyboardType="phone-pad" maxLength={10} placeholderTextColor="#aaa" value={phone} onChangeText={setPhone} />

          <TextInput
            style={styles.input}
            placeholder="Pincode *"
            keyboardType="number-pad"
            maxLength={6}
            placeholderTextColor="#aaa"
            value={pincode}
            onChangeText={(text) => {
              setPincode(text);
              fetchLocation(text);
            }}
          />

          {/* Auto location */}
          {stateVal ? <Text style={styles.auto}>📍 {city}, {district}, {stateVal}</Text> : null}

          <TextInput style={styles.input} placeholder="School Name *" placeholderTextColor="#aaa" value={school} onChangeText={setSchool} />

          <TouchableOpacity onPress={() => setShowDatePicker(true)}>
            <View style={styles.input}>
              <Text style={[{ color: dob ? "#fff" : "#aaa" }]}>
                {dob || "Date of Birth * (DD/MM/YYYY)"}
              </Text>
            </View>
          </TouchableOpacity>

          {showDatePicker && (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={handleDateChange}
              maximumDate={new Date()}
              textColor="#fff"
            />
          )}

          {Platform.OS === "ios" && showDatePicker && (
            <TouchableOpacity style={styles.closeDatePicker} onPress={() => setShowDatePicker(false)}>
              <Text style={styles.closeDatePickerText}>Done</Text>
            </TouchableOpacity>
          )}

          {/* Board */}
          <Text style={styles.label}>Board *</Text>
          <View style={styles.row}>
            {boards.map(b => (
              <TouchableOpacity key={b} style={[styles.chip, board === b && styles.active]} onPress={() => setBoard(b)}>
                <Text style={styles.chipText}>{b}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* CLASS */}
          <Text style={styles.label}>Class *</Text>
          <View style={styles.row}>
            {classOptions.map(c => (
              <TouchableOpacity key={c} style={[styles.chip, studentClass === c && styles.active]} onPress={() => setStudentClass(c)}>
                <Text style={styles.chipText}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* PREFERRED LANGUAGE */}
          <Text style={styles.label}>Preferred Language *</Text>
          <View style={styles.row}>
            {languageOptions.map(lang => (
              <TouchableOpacity key={lang} style={[styles.chip, preferredLanguage === lang && styles.active]} onPress={() => setPreferredLanguage(lang)}>
                <Text style={styles.chipText}>{lang}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Interests */}
          <Text style={styles.label}>Interests</Text>
          <View style={styles.row}>
            {interestOptions.map(i => (
              <TouchableOpacity key={i} style={[styles.chip, interests.includes(i) && styles.active]} onPress={() => toggleInterest(i)}>
                <Text style={styles.chipText}>{i}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {interests.includes("Other") && (
            <TextInput
              placeholder="Enter your interest"
              placeholderTextColor="#aaa"
              style={styles.input}
              value={customInterest}
              onChangeText={setCustomInterest}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* Button */}
          <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
            <LinearGradient colors={["#6366F1","#8B5CF6"]} style={styles.buttonInner}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue →</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },

  brand: { fontSize: 34, fontWeight: "900", color: "#fff", textAlign: "center" },
  gold: { color: "#FFD700" },

  title: { fontSize: 20, color: "#c7d2fe", textAlign: "center", marginBottom: 20 },

  profilePicContainer: {
    marginBottom: 20,
    borderRadius: 14,
    overflow: "hidden",
    height: 140,
  },

  profilePicPreview: {
    width: "100%",
    height: "100%",
    borderRadius: 14,
  },

  profilePicPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#555",
    borderRadius: 14,
  },

  profilePicText: {
    fontSize: 48,
    marginBottom: 8,
  },

  profilePicLabel: {
    color: "#aaa",
    fontSize: 12,
  },

  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    color: "#fff",
  },

  auto: { color: "#34D399", marginBottom: 10 },

  label: { color: "#c7d2fe", marginTop: 10 },

  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#555",
  },

  active: {
    backgroundColor: "#6366F1",
    borderColor: "#6366F1",
  },

  chipText: { color: "#fff" },

  error: { color: "#F87171", marginTop: 10, textAlign: "center" },

  button: { marginTop: 20, borderRadius: 30, overflow: "hidden" },

  buttonInner: { paddingVertical: 16, alignItems: "center" },

  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  closeDatePicker: {
    backgroundColor: "#6366F1",
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 10,
    alignItems: "center",
  },

  closeDatePickerText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
});