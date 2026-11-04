import { Image, TouchableOpacity, StyleSheet } from "react-native";

import { ThemedText } from "@/shared/theme/themed-text";
import { ThemedView } from "@/shared/theme/themed-view";
import { SafeScreenContainer } from "@/shared/ui/safe-area/screen-container";
import { useAuth } from "@/features/auth/application/auth.context";

import { Container, TitleContainer } from "./profile.screen.styles";

/**
 * Profile screen: displays user info and provides a sign-out option.
 * @returns {React.JSX.Element} Profile screen.
 */
export default function ProfileScreen() {
  const { user, signOut, isLoading } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <SafeScreenContainer>
      <Container>
        <TitleContainer>
          <ThemedText type="title">Profile</ThemedText>

          {user?.picture ? (
            <Image
              source={{ uri: user.picture }}
              style={styles.avatar}
            />
          ) : null}

          {user?.name ? (
            <ThemedText type="subtitle">{user.name}</ThemedText>
          ) : null}

          {user?.email ? (
            <ThemedText themeColor="textSecondary">{user.email}</ThemedText>
          ) : null}

          <ThemedView style={styles.spacer} />

          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
            disabled={isLoading}
            activeOpacity={0.75}
          >
            <ThemedText style={styles.signOutText}>
              {isLoading ? "Signing out…" : "Sign out"}
            </ThemedText>
          </TouchableOpacity>
        </TitleContainer>
      </Container>
    </SafeScreenContainer>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginVertical: 8,
  },
  spacer: {
    height: 24,
  },
  signOutButton: {
    borderRadius: 25,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    paddingVertical: 12,
    paddingHorizontal: 32,
    alignItems: "center",
  },
  signOutText: {
    color: "#ff6b6b",
    fontWeight: "600",
    fontSize: 15,
  },
});
