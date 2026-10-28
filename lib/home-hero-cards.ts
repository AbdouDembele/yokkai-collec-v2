import { AUTH_MARQUEE_CARDS } from "@/lib/auth/showcase-cards";
import type { Card } from "@/lib/data/cards";

// Public catalogue snapshot verified read-only on 2026-10-20.
export const HOME_HERO_CARDS = [
  AUTH_MARQUEE_CARDS[0],
  {
    id: "86a0b085-c625-4dd5-a440-7270f33352a6",
    name: "DANTE",
    rarity: "LR",
    category: "VIDEO GAMES",
    anime: "Devil May Cry",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/a469772efc08f62a2f1c75cca876c1ebf4b5355dc0d25f3f2530b043ca2acc29"
  },
  {
    id: "93d5b918-6714-4019-90c3-22001fede6cc",
    name: "ANAKIN SKYWALKER",
    rarity: "LR",
    category: "SAGA",
    anime: "STAR WARS",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/54270a908939ade4238160d1d9c043a39b37a7bf3c2e49c9a9a83f3768d60c8b"
  },
  {
    id: "3e608dc8-fe87-472c-bc25-3a1746c8600f",
    name: "THE UNDERTAKER",
    rarity: "LR",
    category: "WWE",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/620ef2da342f2066a3ecc0021ea9cf388a609375c1950df59fe34b66781ff6a5"
  },
  {
    id: "d059cfda-f206-46fd-8f4a-a8b9e57e71b8",
    name: "PHINEAS FLYNN",
    rarity: "LR",
    category: "DISNEY CHANNEL",
    anime: "Phineas and Ferb",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/19ba53ac2bde32f0d18835c521e645bdc6f8d941d2c8dba73dee1c406060d974-22efa6fd0c927aca"
  },
  {
    id: "0d0845ab-2d02-4cc9-a524-3fb939e7169e",
    name: "FAKER",
    rarity: "LR",
    category: "ESPORT",
    anime: "(P) League of Legends",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/4151d9b5439a8cd20d5d64d65b367933746f9681109cf2eeedf53f30d3664895"
  },
  {
    id: "d3d7a486-d003-4f53-977a-e1100b285f55",
    name: "KOBE BRYANT",
    rarity: "LR",
    category: "SPORT",
    anime: "NBA",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/558f473ead278049e6c0dd168d1805656aa2c4c51b93d3d043025db48878cfaa-0b18bafe4ae95851"
  },
  AUTH_MARQUEE_CARDS[1],
  AUTH_MARQUEE_CARDS[5],
  AUTH_MARQUEE_CARDS[3],
  AUTH_MARQUEE_CARDS[4]
] satisfies Card[];
