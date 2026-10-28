import { YokaiCard } from "@/components/yokai-card";

const samples = [
  {
    name: "SAM",
    rarity: "C" as const,
    source: "Supabase Storage",
    image:
      "/storage/v1/object/public/card-images/5a85f6d10ebfb4a4895ecfae4d729bc0e57b12dfc96daae91d92f93571e9b559"
  },
  {
    name: "BTS",
    rarity: "LR" as const,
    source: "Supabase Storage",
    image:
      "/storage/v1/object/public/card-images/a2af29d706f2afb1db9ab31b100ef8d3c0450ccca1d8c775d54514f393c02048-678d3b22128b7404"
  },
  {
    name: "Rin Shima",
    rarity: "SR" as const,
    source: "AniList",
    image:
      "https://s4.anilist.co/file/anilistcdn/character/large/b124586-9lGoHg1zZkFr.png"
  },
  {
    name: "Ladybug",
    rarity: "LR" as const,
    source: "Imgur",
    image: "https://i.imgur.com/tpX2zQu.png"
  },
  {
    name: "GIF personnel (fixture)",
    rarity: "SSR" as const,
    source: "Giphy",
    image: "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif"
  }
];

export default async function ImageQualityProof({
  searchParams
}: {
  searchParams: Promise<{ density?: string }>;
}) {
  const density = (await searchParams).density === "3" ? 3 : 1;
  const width = 240 * density;
  return (
    <main style={{ padding: 24, width: width * 2 + 96 }}>
      <h1>Netteté · grille et détail</h1>
      <p>
        Même composant, même largeur {width} pixels, même zoom.{" "}
        {density === 3
          ? "Raster 3× : reconstruction physique, sans émulation du DPR du navigateur."
          : "Densité 1."}{" "}
        Les deux colonnes utilisent l’image originale, sans transformation. Le
        GIF est une fixture personnelle, pas une carte modifiée en production.
      </p>
      {samples.map(sample => {
        const image = sample.image.startsWith("/storage/")
          ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}${sample.image}`
          : sample.image;
        return (
          <section key={sample.name} data-source={sample.source}>
            <h2 style={{ margin: "24px 0 12px" }}>
              {sample.name} · {sample.rarity} · {sample.source}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(2, ${width}px)`,
                gap: 24
              }}
            >
              <div data-view="grid">
                <p>Grille</p>
                <YokaiCard
                  {...sample}
                  image={image}
                  category="ILLUSTRATION"
                  animated={false}
                  imageSizes="(max-width: width * 2 + 96px) 46vw, 190px"
                />
              </div>
              <div data-view="detail">
                <p>Détail</p>
                <YokaiCard
                  {...sample}
                  image={image}
                  category="ILLUSTRATION"
                  animated={false}
                />
              </div>
            </div>
          </section>
        );
      })}
    </main>
  );
}
