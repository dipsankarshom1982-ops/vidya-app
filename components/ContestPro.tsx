import { useTheme } from "@/context/ThemeContext";
import { Text, View } from "react-native";

export default function ContestPro() {
  const { colors } = useTheme();

  return (
    <View style={{ margin: 16, padding: 16, backgroundColor: colors.card, borderRadius: 16 }}>
      <Text style={{ color: colors.text, fontSize: 16 }}>🔥 Live Contest</Text>
      <Text style={{ color: colors.textSecondary }}>Class 10 Science - Win 500 Coins</Text>
    </View>
  );
}
