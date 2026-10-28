import type { Card } from "@/lib/data/cards";

export const AUTH_EVOLUTION_CARDS = [
  {
    id: "a70f37b5-61e2-49b9-a7e5-22320255f589",
    name: "GOGETA",
    rarity: "LR",
    category: "ANIME/MANGA",
    anime: "Dragon Ball",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/44cc99db7683b97405482d5eeab86bb90f72cfcf87e96db4df7453c2f326da05"
  },
  {
    id: "8534f44e-58d6-4b7e-89c7-907a75bed2ff",
    name: "HAWKS",
    rarity: "SSR",
    category: "ANIME/MANGA",
    anime: "My Hero Academia",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/5003474c982a73708d258cc460eb65c08dc5fb3252eab7bdebceec45338f833c-2990e815-aac6-46a8-8b3b-e7409d292428"
  }
] satisfies Card[];

// Public catalogue snapshot verified read-only in production on 2026-10-20.
export const AUTH_SHOWCASE_CARDS = [
  {
    id: "60c0cdbe-2ed5-43f9-aac3-c2bdfa5e4867",
    name: "SATORU GOJO",
    rarity: "LR",
    category: "ANIME/MANGA",
    anime: "JUJUTSU KAISEN",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/0b122eaf3920635bf8ad4335f6e75947899db377c029d236b9430aae01891103-af096724-bd5a-454c-984b-26e07822ea94"
  },
  {
    id: "da1a6d29-12c2-4ad9-a018-a3670473e5a4",
    name: "NEWJEANS",
    rarity: "LR",
    category: "ARTIST",
    anime: "KPOP",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/df67d8dfd8ccf2bac4a3b653fd14b3b52f0d331d884ce2c003a12213244a60a4-8967a841-f1bf-44f2-8bc9-9bca7bdb03bf"
  },
  {
    id: "04fb40cb-05ae-4bad-bfa1-881290d2d5bf",
    name: "MONKEY D. LUFFY",
    rarity: "LR",
    category: "ANIME/MANGA",
    anime: "One Piece",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/179acf9606ae902fe7d9779d2f004084d756516cf43e11deb881ad43145d4a89-1462c1e799f9fc87"
  },
  {
    id: "51fd0fc4-a553-4836-801d-466c529339d3",
    name: "BART SIMPSON",
    rarity: "LR",
    category: "SERIE",
    anime: "THE SIMPSONS",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/739d93eb8a8ce24c00a592e97e86a654862b314a93c184e2318ec009ef10dce6"
  },
  {
    id: "1f3656ba-ced5-4d71-9393-5f6c2260bff9",
    name: "TUNG TUNG TUNG SAHUR",
    rarity: "LR",
    category: "BRAINROT",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/bc1618af5ff3e3fd89c638c7a7b7c5cdd5e0dcbb28ad8c107b148966a6795590"
  }
] satisfies Card[];

// LR selection verified read-only against production on 2026-10-24.
// MEME and NOVEL currently have no LR catalogue cards.
export const AUTH_MARQUEE_CARDS = [
  ...AUTH_SHOWCASE_CARDS,
  {
    id: "2ba1b589-365d-4579-a53e-45d579733346",
    name: "BATMAN",
    rarity: "LR",
    category: "COMICS",
    anime: "DC Comics",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/6fbb06831e22dac6a00f5fcd1ba7e7360c9b6b4e391d95721204b388d0c21573"
  },
  {
    id: "f7c7f69a-9ccb-48dc-9467-3495bb5b5ab7",
    name: "ERIC CARTMAN",
    rarity: "LR",
    category: "SERIE",
    anime: "SOUTH PARK",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/2a5e646571538f25b73a2f7625dfb8cf28914d140305552db2e7984a8175be13"
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
    id: "4945c9cb-7a90-4c57-a7f0-13aefd5c9233",
    name: "HATSUNE MIKU",
    rarity: "LR",
    category: "VOCALOID",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/dd26b2006e236b4a28e891fc09756fb39315654f6f0ccf108decc0d0269fb0be"
  },
  {
    id: "ea35f4d2-f197-4b91-9d14-9cb47e82124d",
    name: "HANNAH MONTANA / MILEY STEWART",
    rarity: "LR",
    category: "DISNEY CHANNEL",
    anime: "Hannah Montana",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/2d56657b3670d7528d6f9ffbe5a1b7b1c0ee35dce59b325b47fb6c2d6469b99b"
  },
  {
    id: "ac5cac6e-0679-40d7-81b1-ff66bbe49906",
    name: "AVATAR",
    rarity: "LR",
    category: "FILM",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/15796aef938d1dd7198c4600c06120772c8da06617a4c44aa063d377c2b1b521"
  },
  {
    id: "d1a23ad6-5781-492e-8df6-b8e25d370ae7",
    name: "MRBEAST",
    rarity: "LR",
    category: "INTERNET PERSONALITY",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/b1e2aace6c926dc9f4261eb6e28b4a4eb50b525d27f900e97f00f15db89ca22c"
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
    id: "f9836b76-5554-40c3-abba-1ce35cb4998e",
    name: "RHEA RIPLEY",
    rarity: "LR",
    category: "WWE",
    anime: "WWE",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/b2bb0e054c351fe8d8cf27aa8c35918b55a030bc7a23056be38f13d6eac95ba5"
  },
  {
    id: "ca04b370-f356-4015-9a4a-0f33e2cf9ea0",
    name: "KIM DOKJA",
    rarity: "LR",
    category: "MANWHA",
    anime: "Omniscient Reader's Viewpoint",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/ee7205210e4d636fb752a8f47c5f6d5314c7164011e6128ce1ed54181a497d07"
  },
  {
    id: "b3526c46-7709-4e1a-8124-ae8ff52813f6",
    name: "LIONEL MESSI",
    rarity: "LR",
    category: "SPORT",
    anime: "FOOTBALL",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/646fc92737633a7cb75e1647b1a54dd334f0b2f837eac39fd42035f71d8a79f5"
  },
  {
    id: "47ee3a26-b7de-484d-b4a9-70ea71a202d3",
    name: "MICHAEL JACKSON",
    rarity: "LR",
    category: "ARTIST",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/4a21497ebd83659592b360bf096146665e722f7e0b3e56eb574deece81fc0566"
  },
  {
    id: "edaf03ca-678c-4c11-b1ba-c0ca018f07c2",
    name: "KRATOS",
    rarity: "LR",
    category: "VIDEO GAMES",
    anime: "God of War (2018)",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/d74cbcde30e15c63297142ac108f6cebf992fd25a55d770dbcc11f1d1ffc534a"
  },
  {
    id: "79fd1494-705d-45b3-ac73-f1bb95cf8ead",
    name: "PIKACHU",
    rarity: "LR",
    category: "VIDEO GAMES",
    anime: "POKEMON BLUE/RED",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/8da7afe30df7daba076dd00f0260bbf6c3e1bc74717205142236a654495a43fe"
  },
  {
    id: "43c915ef-f160-443a-b176-35a938fe5c6a",
    name: "ARIANA GRANDE",
    rarity: "LR",
    category: "ARTIST",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/2a15bb1593be33562f5ad76aa496b6b00714354e33f13efc22325895abe82ad2"
  },
  {
    id: "97e24ab4-bf7f-4397-a7e9-1d22199993a5",
    name: "ARYA STARK",
    rarity: "LR",
    category: "SERIE",
    anime: "GAME OF THRONES",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/3c8342050956c1653ee55a52e6406ff8b5ddee4fbe049d757138afa35bac11ff-8cd789fd-f141-46d6-95d5-30dd93473c2b"
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
  {
    id: "284df512-dc3b-4741-912d-2716e7c5e09d",
    name: "KASANE TETO",
    rarity: "LR",
    category: "VOCALOID",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/b0c1aeb15d21cbdbd4f569c465240819eabd1738108b4c95a7f0fe61c8543d7a"
  },
  {
    id: "3e608dc8-fe87-472c-bc25-3a1746c8600f",
    name: "THE UNDERTAKER",
    rarity: "LR",
    category: "WWE",
    image:
      "https://api.yokkai-collec.com/storage/v1/object/public/card-images/620ef2da342f2066a3ecc0021ea9cf388a609375c1950df59fe34b66781ff6a5"
  }
] satisfies Card[];
