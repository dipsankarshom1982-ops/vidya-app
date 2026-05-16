import { useTheme } from "@/context/ThemeContext";
import { Text, View } from "react-native";

export default function StatsPro({ data }: any) {
  const { colors } = useTheme();

  if (!data) return null; // 🔥 REQUIRED

  return (
    <View>
      <Text style={{ color: colors.text }}>{data?.courses ?? 0}</Text>
      <Text style={{ color: colors.text }}>{data?.streak ?? 0}</Text>
      <Text style={{ color: colors.text }}>{data?.coins ?? 0}</Text>
      <Text style={{ color: colors.text }}>{data?.rank ?? 0}</Text>
    </View>
  );
}
