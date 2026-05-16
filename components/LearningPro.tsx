import { useTheme } from "@/context/ThemeContext";
import { Text, View } from "react-native";

export default function LearningPro({ data }: any) {
  const { colors } = useTheme();

  if (!data) return null;

  return (
    <View>
      <Text style={{ color: colors.text }}>{data?.currentCourse ?? "Start Learning"}</Text>
      <Text style={{ color: colors.textSecondary }}>{data?.progress ?? 0}%</Text>
    </View>
  );
}
