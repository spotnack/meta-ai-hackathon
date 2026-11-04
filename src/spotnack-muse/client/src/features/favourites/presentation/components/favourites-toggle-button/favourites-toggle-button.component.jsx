import { TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { FavouritesBarIcon } from "@features/favourites/presentation/components/favourites-icon/favourites-icon.component";

export const FavouritesToggleButton = ({ pageToNavigate }) => {
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.push(pageToNavigate)}>
      <FavouritesBarIcon />
    </TouchableOpacity>
  );
};
