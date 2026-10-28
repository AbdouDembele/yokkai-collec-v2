import { useTranslations } from "next-intl";
import { YokaiCard } from "@/components/yokai-card";
import { AuthCardCustomization } from "@/components/auth-card-customization";
import { AuthDecisionPreview } from "@/components/auth-decision-preview";
import { CardShell } from "@/components/card-shell";
import { AuthCardCarousel } from "@/components/auth-card-carousel";
import { AuthMarketShowcase } from "@/components/auth-market-showcase";
import { AuthBinderShowcase } from "@/components/auth-binder-showcase";
import {
  AUTH_SHOWCASE_CARDS as cards,
  AUTH_MARQUEE_CARDS,
  AUTH_EVOLUTION_CARDS
} from "@/lib/auth/showcase-cards";

export function AuthShowcase({
  infinityPreview = false
}: {
  infinityPreview?: boolean;
}) {
  const t = useTranslations("authShowcase");
  return (
    <section className="yk-auth-showcase" aria-labelledby="auth-showcase-title">
      <div className="yk-auth-showcase-heading">
        <p className="eyebrow">{t("aNewDiscoveryInEveryCard")}</p>
        <h2 id="auth-showcase-title">
          {t("yourFavorites")}
          <br />
          {t("yourCollection")}
          <br />
          <em>{t("yourNextObsession")}</em>
        </h2>
        <p>{t("openAPackFindAFavoriteFromTheFirstPull")}</p>
      </div>

      <AuthCardCarousel>
        <div className="yk-auth-card-ribbon">
          {[0, 1, 2].map(copy => (
            <div
              className="yk-auth-card-set"
              key={copy}
              data-scroll-period={copy === 1 ? "" : undefined}
              data-scroll-clone={copy !== 1 ? "" : undefined}
              aria-hidden={copy !== 1 ? true : undefined}
            >
              {AUTH_MARQUEE_CARDS.map((card, index) => (
                <div
                  className="yk-auth-display-card"
                  key={`${card.name}-${index}`}
                >
                  <YokaiCard
                    {...card}
                    isEvolved={infinityPreview && index % 4 === 0}
                    shiny={infinityPreview && index % 4 === 1}
                    animated={false}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </AuthCardCarousel>

      <div className="yk-auth-feature-list">
        <AuthCardCustomization />
        <article className="yk-auth-feature yk-auth-feature-evolution">
          <div className="yk-auth-feature-copy">
            <span className="yk-auth-feature-number">
              {infinityPreview ? t("text02Infinity") : t("text02TheEvolution")}
            </span>
            <h3>
              {infinityPreview
                ? t("fiveCopiesOneInfinity")
                : t("fiveCopiesOneEvolution")}
            </h3>
            <p>
              {infinityPreview ? (
                t("fuseFiveIdenticalNormalSsrCardsOrThreeIdenticalNormal")
              ) : (
                <>{t("gotDuplicatesFuseFiveIdenticalNormalSsrCardsIntoOne")}</>
              )}
            </p>
            <p>
              {infinityPreview
                ? t("keepYourCustomArtworkWhenYouEvolveShinyAndInfinity")
                : t("shinyAndAlreadyEvolvedCardsCannotBeUsedForEvolution")}
            </p>
          </div>
          <div className="yk-auth-evolution-examples">
            {AUTH_EVOLUTION_CARDS.map(card => (
              <div
                className="yk-auth-evolution-preview"
                data-rarity={card.rarity}
                key={card.id}
              >
                <div className="yk-auth-evolution-heading">
                  <strong>{card.name}</strong>
                  <span>{t("rarityEvolution", { rarity: card.rarity })}</span>
                </div>
                <div className="yk-auth-evolution-flow">
                  <figure className="yk-auth-evolution-card">
                    <figcaption>
                      {t("normalCopies", { rarity: card.rarity })}
                    </figcaption>
                    <div className="yk-auth-evolution-stack">
                      <CardShell interactive={false}>
                        <YokaiCard {...card} />
                        <span
                          className="yk-auth-evolution-count"
                          aria-hidden="true"
                        >
                          ×5
                        </span>
                      </CardShell>
                    </div>
                  </figure>
                  <span className="yk-auth-evolution-arrow" aria-hidden="true">
                    →
                  </span>
                  <figure className="yk-auth-evolution-card">
                    <figcaption>
                      1 {card.rarity} {infinityPreview ? "INFINITY" : "Evolved"}
                    </figcaption>
                    <CardShell interactive={false}>
                      <YokaiCard {...card} isEvolved />
                    </CardShell>
                  </figure>
                </div>
                <p>
                  {infinityPreview
                    ? t("sameCharacterANewInfinityFinish")
                    : t("sameCharacterANewElectricLook")}
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="yk-auth-feature yk-auth-feature-packs">
          <div className="yk-auth-feature-copy">
            <span className="yk-auth-feature-number">
              {t("text03TheReveal")}
            </span>
            <h3>{t("smallPackBigPossibilities")}</h3>
            <p>{t("revealFiveCardsInEveryRegularPackDiscoverNewCharacters")}</p>
            <span className="yk-auth-feature-tag">
              {t("fiveCardsOneNewStory")}
            </span>
          </div>
          <div className="yk-auth-pack-preview" aria-hidden="true">
            {/* Existing pack artwork is shared with the game. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/chrome-regular-booster-v1.png"
              alt=""
              width="952"
              height="1664"
            />
            <span>✦</span>
          </div>
          <AuthDecisionPreview cards={cards} />
        </article>

        <article className="yk-auth-feature">
          <div className="yk-auth-feature-copy">
            <span className="yk-auth-feature-number">
              {t("text04TheCollection")}
            </span>
            <h3>{t("oneMoreCardOneStepCloser")}</h3>
            <p>{t("buildYourAlbumsByUniverseTrackYourProgressAndSpot")}</p>
          </div>
          <div
            className="yk-auth-album-preview"
            aria-label={t("illustrativeAlbumPreviewTwoOfThreeCardsCollected")}
          >
            <div className="yk-auth-preview-label">
              <span>{t("yourAlbum")}</span>
              <b>2 / 3</b>
            </div>
            <div className="yk-auth-album-cards" aria-hidden="true">
              {cards.slice(0, 2).map(card => (
                <YokaiCard key={card.name} {...card} animated={false} />
              ))}
              <div className="yk-auth-missing-card">
                <span>?</span>
              </div>
            </div>
            <div className="yk-auth-album-progress" aria-hidden="true">
              <span />
            </div>
            <p>{t("theNextPieceIsOutThere")}</p>
          </div>
        </article>

        <article className="yk-auth-feature">
          <div className="yk-auth-feature-copy">
            <span className="yk-auth-feature-number">
              {t("text05YourFavoriteWorlds")}
            </span>
            <h3>{t("aBinderForEveryObsession")}</h3>
            <p>{t("yourFavoriteMangaTheSeriesYouCanTStopWatching")}</p>
            <div
              className="yk-auth-binder-tags"
              aria-label={t("binderCategories")}
            >
              <span>Manga</span>
              <span>Series</span>
              <span>Cartoons</span>
              <span>K-pop</span>
            </div>
          </div>
          <div
            className="yk-auth-binder-preview"
            aria-label={t("exampleFavoriteBindersAndCollectionProgress")}
          >
            <span className="yk-auth-preview-label">{t("yourBinders")}</span>
            <div className="yk-auth-binder-tile yk-auth-binder-favorite">
              <div>
                <strong>JUJUTSU KAISEN</strong>
                <span aria-hidden="true">★</span>
              </div>
              <p>
                <b>7</b> {t("text183Cards")}
              </p>
              <div className="yk-auth-binder-progress">
                <span style={{ width: "4%" }} />
              </div>
              <small>{t("text4Complete")}</small>
            </div>
            <div className="yk-auth-binder-tile yk-auth-binder-favorite">
              <div>
                <strong>GAME OF THRONES</strong>
                <span aria-hidden="true">★</span>
              </div>
              <p>
                <b>2</b> {t("text31Cards")}
              </p>
              <div className="yk-auth-binder-progress">
                <span style={{ width: "6%" }} />
              </div>
              <small>{t("text6Complete")}</small>
            </div>
            <div className="yk-auth-binder-tile yk-auth-binder-favorite">
              <div>
                <strong>KPOP</strong>
                <span aria-hidden="true">★</span>
              </div>
              <p>
                <b>3</b> {t("text127Cards")}
              </p>
              <div className="yk-auth-binder-progress">
                <span style={{ width: "2%" }} />
              </div>
              <small>{t("text2Complete")}</small>
            </div>
            <p className="yk-auth-preview-caption">
              {t("exampleBindersEveryCardBringsYouCloser")}
            </p>
          </div>
          <AuthBinderShowcase />
        </article>

        <article className="yk-auth-feature yk-auth-feature-market">
          <div className="yk-auth-feature-copy">
            <span className="yk-auth-feature-number">
              {t("text06TheMarket")}
            </span>
            <h3>{t("findYourNextGreatDeal")}</h3>
            <p>{t("putYourCardsUpForAuctionOrBidOnA")}</p>
          </div>
          <AuthMarketShowcase />
        </article>

        <article className="yk-auth-feature yk-auth-feature-social">
          <div className="yk-auth-feature-copy">
            <span className="yk-auth-feature-number">
              {t("text07TheCommunity")}
            </span>
            <h3>{t("betterFindsBetterTogether")}</h3>
            <p>{t("addFriendsChatAndTradeYourDuplicatesForTheCards")}</p>
          </div>
          <div
            className="yk-auth-chat-preview"
            aria-label={t("illustrativeConversationAndTradePreview")}
          >
            <p>{t("spareCard", { cardName: "NEWJEANS" })}</p>
            <p>
              {t("tradeCard", { cardName: "Luffy" })}
              <span aria-hidden="true">✦</span>
            </p>
            <div>
              <span aria-hidden="true">⇄</span> {t("aNewTradeANewFavorite")}
            </div>
          </div>
        </article>
      </div>
      <p className="yk-auth-showcase-signoff">
        {t("collectWhatYouLoveMakeItYours")}
      </p>
    </section>
  );
}
