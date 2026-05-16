import Header from "@/components/header";
import { useTheme } from "@/context/ThemeContext";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import {
    Dimensions,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const { width } = Dimensions.get("window");

export default function LearnScreen() {
  const { colors } = useTheme();
  const [selectedCategory, setSelectedCategory] = useState("featured");

  const categories = [
    { id: "featured", label: "Featured" },
    { id: "coding", label: "Coding" },
    { id: "design", label: "Design" },
    { id: "business", label: "Business" },
  ];

  const courses = [
    {
      id: 1,
      title: "React Native Basics",
      instructor: "John Doe",
      progress: 65,
      color: ["#7b61ff", "#a855f7"],
    },
    {
      id: 2,
      title: "UI/UX Design",
      instructor: "Sarah Smith",
      progress: 40,
      color: ["#ec4899", "#f43f5e"],
    },
    {
      id: 3,
      title: "Web Development",
      instructor: "Mike Johnson",
      progress: 85,
      color: ["#38bdf8", "#0ea5e9"],
    },
    {
      id: 4,
      title: "Digital Marketing",
      instructor: "Emma Wilson",
      progress: 50,
      color: ["#fbbf24", "#f59e0b"],
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* HEADER */}
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.accent }]}>📚 Learn & Skill Up</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Master new skills at your pace</Text>
        </View>

        {/* CATEGORY TABS */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
        >
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              onPress={() => setSelectedCategory(cat.id)}
              style={[
                styles.categoryBtn,
                selectedCategory === cat.id && { backgroundColor: colors.accent, borderColor: colors.accent },
                { backgroundColor: selectedCategory !== cat.id ? colors.card : undefined, borderColor: colors.border },
              ]}
            >
              <Text
                style={[
                  styles.categoryText,
                  selectedCategory === cat.id && { color: "#fff" },
                  { color: selectedCategory !== cat.id ? colors.textSecondary : undefined },
                ]}
              >
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* COURSES GRID */}
        <View style={styles.coursesContainer}>
          {courses.map((course) => (
            <TouchableOpacity key={course.id} style={styles.courseWrapper}>
              <LinearGradient
                colors={course.color}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.courseCard}
              >
                <Text style={styles.courseTitle}>{course.title}</Text>
                <Text style={styles.courseInstructor}>{course.instructor}</Text>

                {/* PROGRESS BAR */}
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBar,
                      { width: `${course.progress}%` },
                    ]}
                  />
                </View>
                <Text style={styles.progressText}>{course.progress}% Complete</Text>
              </LinearGradient>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerText: {
    paddingHorizontal: 15,
    paddingTop: 10,
    marginBottom: 20,
  },
  title: {
    color: "#38bdf8",
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 14,
    marginTop: 4,
  },
  categoryScroll: {
    paddingHorizontal: 15,
    marginBottom: 20,
  },
  categoryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.15)",
  },
  categoryBtnActive: {
    backgroundColor: "#0ea5e9",
    borderColor: "#0ea5e9",
  },
  categoryText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "600",
  },
  categoryTextActive: {
    color: "#fff",
  },
  coursesContainer: {
    paddingHorizontal: 15,
    marginBottom: 20,
  },
  courseWrapper: {
    marginBottom: 12,
  },
  courseCard: {
    padding: 16,
    borderRadius: 14,
    minHeight: 140,
    justifyContent: "space-between",
  },
  courseTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  courseInstructor: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 12,
    marginBottom: 12,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  progressText: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 11,
    marginTop: 6,
    fontWeight: "500",
  },
});