import { useTranslations } from "next-intl";
import { YokaiCard, type YokaiCardProps } from "@/components/yokai-card";

export function AuthDecisionPreview({ cards }: { cards: YokaiCardProps[] }) {
  const t = useTranslations("authDecisionPreview");
  return (
    <div className="yk-auth-decision-preview">
      <div className="yk-auth-decision-heading">
        <div>
          <span className="yk-auth-feature-number">
            {t("dailyDecisionPack")}
          </span>
          <h4>{t("whichOneWillYouChoose")}</h4>
          <p>{t("revealFiveCardsKeepOneTurnTheOthersIntoKaras")}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/chrome-decision-booster-v1.png"
          alt="Decision Pack"
          width="952"
          height="1664"
          loading="lazy"
        />
      </div>
      <div className="yk-auth-decision-demo">
        <div className="yk-decision-banner">
          <p className="font-display text-karas">{t("chooseYourCard")}</p>
          <p className="text-ink-2">
            {t("fivePossibilitiesOnlyOneJoinsYourCollection")}
          </p>
        </div>
        <ol
          className="yk-reveal-grid"
          aria-label={t("exampleDecisionPackRevealWithFiveCards")}
        >
          {cards.map((card, index) => (
            <li className="yk-reveal-slot" key={`${card.name}-${index}`}>
              <YokaiCard {...card} animated={false} />
            </li>
          ))}
        </ol>
      </div>
      <p className="yk-auth-decision-caption">
        <small>{t("illustrativeRevealRaritiesVary")}</small>
      </p>
    </div>
  );
}
