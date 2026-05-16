import { useTheme } from "@/context/ThemeContext";
import { Text, View } from "react-native";

export default function EarningsPro({ data }: any) {
  const { colors } = useTheme();

  if (!data) return null;

  return (
    <View>
      <Text style={{ color: colors.text }}>₹ {data?.earnings ?? 0}</Text>
    </View>
  );
}
