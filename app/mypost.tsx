import PostCard from "@/components/ProfilePostCard";
import { useTheme } from "@/context/ThemeContext";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function MyPostScreen() {
  const { colors } = useTheme();
  const [userData, setUserData] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    fetchUser();
    fetchPosts();
  }, [auth.currentUser]);

  // 🔹 USER
  const fetchUser = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const snap = await getDoc(doc(db, "students", uid));
    if (snap.exists()) setUserData(snap.data());
  };

  // 🔹 POSTS
  const fetchPosts = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const q = query(
      collection(db, "posts"),
      where("userId", "==", uid)
    );

    const snapshot = await getDocs(q);

    const data = snapshot.docs.map((doc) => {
      const d = doc.data();

      return {
        id: doc.id,
        mediaUrl: d.mediaUrl,
        postType: d.postType,
        videoUrl: d.mediaUrl,
        caption: d.description,
        thumbnail: d.thumbnail || (d.postType === "photo" ? d.mediaUrl : null),
        name: d.name,
        profilePic: d.profilePic,
        createdAt: d.createdAt,
        userId: d.userId,
      };
    });

    setPosts(data);
  };

  // 🔴 DELETE
  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, "posts", id));
    fetchPosts();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>

      {/* 🔹 PROFILE */}
      {userData && (
        <View style={[styles.profileBox, { borderColor: colors.border }]}>
          <Image
            source={{
              uri:
                userData.profilePic ||
                `https://i.pravatar.cc/100?u=${auth.currentUser?.uid}`,
            }}
            style={styles.avatar}
          />
          <Text style={[styles.name, { color: colors.text }]}>{userData.name}</Text>
          <Text style={[styles.info, { color: colors.textSecondary }]}>{userData.school}</Text>
          <Text style={[styles.info, { color: colors.textSecondary }]}>{userData.district}</Text>
        </View>
      )}

      {/* 🔹 POSTS */}
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostCard
            item={item}
            onEdit={() => console.log("Edit", item.id)}
            onDelete={() => handleDelete(item.id)}
          />
        )}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.text }]}>No posts yet</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  profileBox: {
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  name: {
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 10,
  },
  info: {},
  empty: {
    textAlign: "center",
    marginTop: 20,
  },
});
