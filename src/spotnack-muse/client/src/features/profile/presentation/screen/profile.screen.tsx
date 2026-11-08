import { ThemedText } from "@/shared/theme/themed-text";
import { SafeScreenContainer } from "@/shared/ui/safe-area/screen-container";
import { useAuth } from "@/features/auth/application/auth.context";

import {
  Avatar,
  Container,
  SignOutButton,
  SignOutText,
  Spacer,
  TitleContainer,
} from "./profile.screen.styles";

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
            <Avatar source={{ uri: user.picture }} />
          ) : null}

          {user?.name ? (
            <ThemedText type="subtitle">{user.name}</ThemedText>
          ) : null}

          {user?.email ? (
            <ThemedText themeColor="textSecondary">{user.email}</ThemedText>
          ) : null}

          <Spacer />

          <SignOutButton
            onPress={handleSignOut}
            disabled={isLoading}
            activeOpacity={0.75}
          >
            <SignOutText>
              {isLoading ? "Signing out…" : "Sign out"}
            </SignOutText>
          </SignOutButton>
        </TitleContainer>
      </Container>
    </SafeScreenContainer>
  );
}
