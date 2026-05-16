import { useTheme } from "@/context/ThemeContext";
import { FlatList, Image, StyleSheet, Text, View } from "react-native";

const exploreData = Array.from({ length: 8 }).map((_, i) => ({
  id: i.toString(),
  image: `https://picsum.photos/300/300?random=${i}`,
}));

export default function Explore() {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>🔍 Explore</Text>

      <FlatList
        data={exploreData}
        numColumns={2}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Image source={{ uri: item.image }} style={styles.image} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },

  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
  },

  image: {
    width: "48%",
    height: 150,
    borderRadius: 10,
    margin: "1%",
  },
});
