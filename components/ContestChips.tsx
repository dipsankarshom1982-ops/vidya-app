// components/ContestChips.tsx

import { useTheme } from "@/context/ThemeContext";
import { joinContest } from "@/services/joinContest";
import { Alert, FlatList, Text, TouchableOpacity, View } from "react-native";

const ContestItem = ({ item, userId }: any) => {
  const { colors } = useTheme();

  const handleJoin = async () => {
    try {
      await joinContest(userId, item);
      Alert.alert("Success", "Joined successfully!");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  return (
    <View style={{ padding: 12, backgroundColor: colors.background, marginBottom: 10, borderRadius: 10 }}>
      <Text style={{ color: colors.text }}>{item.title}</Text>

      {item.status === "active" ? (
        <TouchableOpacity onPress={handleJoin}>
          <Text style={{ color: colors.accent, marginTop: 5 }}>Participate Now</Text>
        </TouchableOpacity>
      ) : (
        <Text style={{ color: colors.textSecondary, marginTop: 5 }}>Not Active</Text>
      )}
    </View>
  );
};

export const ContestChips = ({ title, data, userId }: any) => {
  const { colors } = useTheme();

  return (
    <View style={{ marginVertical: 10 }}>
      <Text style={{ fontSize: 18, fontWeight: "bold", color: colors.text }}>{title}</Text>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ContestItem item={item} userId={userId} />
        )}
      />
    </View>
  );
};
