/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";
import type { Rarity } from "@/lib/data/cards";
import {
  ShareCard,
  fetchCatalogueImage,
  font,
  ink,
  logo,
  nameFont,
  rarityTokens
} from "@/lib/server/card-share-image";

export const alt =
  "Yokkai Collec' — Open packs. Pull legends. A fan of collectible cards: anime, K-pop, NBA, video games and film.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// A build without Supabase access renders bare frames; refresh them daily.
export const revalidate = 86400;

// Fixed, curated selection (left to right) so the embed stays stable.
// `image` is the object name in the public card-images bucket.
const showcase: {
  id: string;
  cardName: string;
  franchise: string | null;
  category: string;
  rarity: Rarity;
  image: string;
}[] = [
  {
    id: "e822576e-d591-4aa6-807b-37d0fc872ecd",
    cardName: "GRIMM",
    franchise: "Hollow Knight",
    category: "Video games",
    rarity: "SR",
    image: "91f2191173cf931695d109d8454417937485d4daaa520421b54e059c4324db4a"
  },
  {
    id: "56ab73d6-d91e-4fb1-8723-ab4a19c28571",
    cardName: "WINTER",
    franchise: "K-pop",
    category: "Artist",
    rarity: "SSR",
    image:
      "0de2c1dea6e9930448afb721dba8ea1643247030803524174546e68ef5ac838a-95d5d767a3e1c9f3"
  },
  {
    id: "04fb40cb-05ae-4bad-bfa1-881290d2d5bf",
    cardName: "MONKEY D. LUFFY",
    franchise: "One Piece",
    category: "Anime",
    rarity: "LR",
    image:
      "179acf9606ae902fe7d9779d2f004084d756516cf43e11deb881ad43145d4a89-1462c1e799f9fc87"
  },
  {
    id: "758c759b-fa33-4d46-a70f-78272ac84d77",
    cardName: "KEVIN DURANT",
    franchise: "NBA",
    category: "Sport",
    rarity: "SSR",
    image:
      "7de46e5120fda4c6341a16d5854aa9e7327976d41e80bc5cf8603b261a83f06e-fb4775f9-2f85-4b73-ab22-26cc08abfe9f"
  },
  {
    id: "4828ccfc-0367-4848-8b01-6013051ccbb8",
    cardName: "PAPRIKA",
    franchise: null,
    category: "Film",
    rarity: "SR",
    image: "6be078f56bf4b921d63f1a9691e4d9a943376ff5727d57b9f4018bd34efebdc5"
  }
];
// Fan placement inside the 550×630 box at x=570: center card in front.
const fan = [
  { left: 10, top: 196, width: 170, rotate: -15, z: 1 },
  { left: 65, top: 158, width: 205, rotate: -7, z: 2 },
  { left: 150, top: 118, width: 250, rotate: 0, z: 5 },
  { left: 280, top: 158, width: 205, rotate: 7, z: 4 },
  { left: 370, top: 196, width: 170, rotate: 15, z: 3 }
];
// Deterministic star field: [x, y, size, opacity].
const stars = [
  [84, 38, 2, 0.7],
  [212, 588, 2, 0.5],
  [356, 40, 3, 0.8],
  [470, 470, 2, 0.4],
  [548, 22, 2, 0.6],
  [640, 600, 3, 0.5],
  [702, 34, 2, 0.7],
  [1012, 28, 2, 0.6],
  [1150, 92, 3, 0.7],
  [1172, 340, 2, 0.5],
  [1130, 604, 2, 0.6],
  [28, 300, 2, 0.5],
  [560, 300, 2, 0.4],
  [300, 520, 2, 0.35],
  [880, 18, 2, 0.5]
];

export default async function Image() {
  const storage = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/card-images/`;
  const [sora, cinzel, brand, cards] = await Promise.all([
    font,
    nameFont,
    logo,
    Promise.all(
      showcase.map(async card => ({
        ...card,
        shiny: false,
        catalogueImageUrl: storage + card.image,
        colors: await rarityTokens(card.rarity, false),
        // A failed fetch returns null and ShareCard keeps the bare rarity frame.
        art: await fetchCatalogueImage(storage + card.image)
      }))
    )
  ]);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        color: ink[1],
        fontFamily: "Sora",
        backgroundColor: "#04050d",
        backgroundImage:
          "radial-gradient(circle at 74% 48%, rgba(124,84,255,.42) 0%, rgba(58,96,214,.22) 30%, transparent 58%), radial-gradient(circle at 10% 0%, #121a35 0%, transparent 55%), radial-gradient(circle at 0% 100%, #1a0f30 0%, transparent 50%)"
      }}
    >
      {stars.map(([x, y, s, o]) => (
        <div
          key={`${x}-${y}`}
          style={{
            display: "flex",
            position: "absolute",
            left: x,
            top: y,
            width: s,
            height: s,
            borderRadius: s,
            background: "#fff",
            opacity: o
          }}
        />
      ))}
      {/* Eclipse: dark disc with a violet-blue corona behind the fan. */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 585,
          top: 55,
          width: 520,
          height: 520,
          borderRadius: 520,
          background:
            "radial-gradient(circle at 50% 50%, #04050d 0%, #04050d 66%, rgba(150,120,255,.55) 70%, rgba(80,120,255,.18) 76%, transparent 82%)",
          boxShadow: "0 0 90px 10px rgba(110,90,255,.35)"
        }}
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 570,
          top: 0,
          width: 550,
          height: 630
        }}
      >
        {cards
          .map((card, index) => ({ card, place: fan[index] }))
          .sort((a, b) => a.place.z - b.place.z)
          .map(({ card, place }) => (
            <div
              key={card.id}
              style={{
                display: "flex",
                position: "absolute",
                left: place.left,
                top: place.top,
                transform: `rotate(${place.rotate}deg)`
              }}
            >
              <ShareCard
                card={card}
                colors={card.colors}
                image={card.art}
                width={place.width}
              />
            </div>
          ))}
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 72,
          top: 64,
          bottom: 64,
          width: 560,
          flexDirection: "column",
          justifyContent: "space-between"
        }}
      >
        <img
          alt=""
          src={brand}
          width={230}
          height={Math.round((230 * 941) / 1672)}
        />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 76,
              lineHeight: 1.04,
              letterSpacing: -1.5
            }}
          >
            <span style={{ display: "flex" }}>Open packs.</span>
            <span style={{ display: "flex", color: "#F2CB6B" }}>
              Pull legends.
            </span>
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 22,
              fontSize: 30,
              lineHeight: 1.3,
              color: ink[2]
            }}
          >
            Collect, trade and bid with players worldwide.
          </div>
        </div>
        <div style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "16px 30px",
              borderRadius: 999,
              background: "linear-gradient(90deg,#FFE7A3,#E8B847)",
              color: "#140b02",
              fontSize: 30,
              boxShadow: "0 0 36px rgba(242,203,107,.45)"
            }}
          >
            Play free
          </div>
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Sora", data: sora, weight: 700, style: "normal" },
        { name: "Cinzel", data: cinzel, weight: 700, style: "normal" }
      ]
    }
  );
}
